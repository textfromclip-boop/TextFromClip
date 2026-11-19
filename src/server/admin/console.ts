// Private admin dashboard, served by the Worker at a secret address.
//
// - Lives at https://<site>/<ADMIN_PATH> where ADMIN_PATH is a secret (16-64 chars). Any other path,
//   or no ADMIN_PATH configured, behaves exactly like an unknown page (the normal website), so the
//   console cannot be discovered by guessing and is not part of the website's JavaScript bundle.
// - Sign-in with ADMIN_TOKEN (>= 24 chars). 5 attempts per 15 minutes per IP.
// - Session: HttpOnly, SameSite=Strict cookie scoped to the secret path, signed with COOKIE_SECRET
//   and bound to the current ADMIN_TOKEN (changing the token signs everyone out). 12 hours.
// - Strict CSP (nonce scripts, no external resources), no-store, noindex, no referrer.
import { hmacSha256Hex, randomToken, sha256Hex, timingSafeEqual } from '../utils/crypto';
import { parseCookies } from '../utils/quotasAndCache';
import { checkRateLimit } from '../utils/rate-limiter';
import { getAdminDashboardData } from '../utils/visitAnalytics';

export const ADMIN_PATH_RE = /^[A-Za-z0-9_-]{16,64}$/;
const SESSION_SECONDS = 12 * 3600;
const COOKIE_NAME = 'lfc_admin';

export interface AdminDeps {
  getClientIp: (c: any) => string;
  getCookieSecret: (c: any) => string;
  isSecureRequest: (c: any) => boolean;
}

export function resolveAdminPath(env: any): string | null {
  const p = typeof env?.ADMIN_PATH === 'string' ? env.ADMIN_PATH.trim() : '';
  return ADMIN_PATH_RE.test(p) ? p : null;
}

function adminToken(env: any): string | null {
  const t = typeof env?.ADMIN_TOKEN === 'string' ? env.ADMIN_TOKEN : '';
  return t.length >= 24 ? t : null;
}

async function sessionSignature(secret: string, token: string, exp: number): Promise<string> {
  const fp = (await sha256Hex(`adm-token:${token}`)).slice(0, 24);
  return hmacSha256Hex(secret, `lfc:adm:${exp}:${fp}`);
}

export async function createAdminSession(secret: string, token: string, nowSec = Math.floor(Date.now() / 1000)) {
  const exp = nowSec + SESSION_SECONDS;
  return `${exp}.${await sessionSignature(secret, token, exp)}`;
}

export async function verifyAdminSession(value: string | undefined, secret: string, token: string, nowSec = Math.floor(Date.now() / 1000)) {
  if (!value || typeof value !== 'string') return false;
  const [expStr, sig] = value.split('.');
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp <= nowSec || !sig) return false;
  return timingSafeEqual(sig, await sessionSignature(secret, token, exp));
}

function securityHeaders(c: any, nonce?: string) {
  c.header('Cache-Control', 'no-store');
  c.header('X-Robots-Tag', 'noindex, nofollow');
  c.header('Referrer-Policy', 'no-referrer');
  c.header(
    'Content-Security-Policy',
    nonce
      ? `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`
      : `default-src 'none'; frame-ancestors 'none'`
  );
}

function sameOrigin(c: any): boolean {
  const origin = c.req.header('origin');
  if (!origin) return false;
  try {
    return new URL(origin).host === new URL(c.req.url).host;
  } catch {
    return false;
  }
}

/**
 * Handles a request if it is for the admin console; returns null otherwise so the caller falls
 * through to the normal website.
 */
export async function handleAdminRequest(c: any, deps: AdminDeps): Promise<Response | null> {
  const adminPath = resolveAdminPath(c.env);
  if (!adminPath) return null;
  const path: string = c.req.path;
  const base = `/${adminPath}`;
  if (path !== base && path !== `${base}/` && !path.startsWith(`${base}/`)) return null;

  const token = adminToken(c.env);
  const secret = deps.getCookieSecret(c);
  const sub = path.slice(base.length).replace(/\/+$/, '') || '/';
  const ip = deps.getClientIp(c);
  const method = c.req.method;
  if (!token) {
    securityHeaders(c);
    return c.text('Admin is not configured: set ADMIN_TOKEN (at least 24 characters).', 503);
  }
  const signedIn = await verifyAdminSession(parseCookies(c.req.header('cookie'))[COOKIE_NAME], secret, token);
  const cookieBase = `Path=${base}; HttpOnly; SameSite=Strict${deps.isSecureRequest(c) ? '; Secure' : ''}`;

  if (sub === '/' && method === 'GET') {
    const nonce = randomToken(16);
    securityHeaders(c, nonce);
    return c.html(renderAdminHtml(nonce, base, signedIn));
  }

  if (sub === '/login' && method === 'POST') {
    securityHeaders(c);
    if (!sameOrigin(c)) return c.json({ ok: false, error: 'Bad request.' }, 403);
    const limit = await checkRateLimit(`admin-login:${ip}`, 5, 900, c.env.DB, true);
    if (!limit.allowed) {
      return c.json({ ok: false, error: `Too many attempts. Try again in ${Math.ceil(limit.resetInSeconds / 60)} minutes.` }, 429);
    }
    const body = await c.req.json().catch(() => ({}));
    const presented = typeof body?.password === 'string' ? body.password : '';
    if (!presented || !timingSafeEqual(presented, token)) {
      return c.json({ ok: false, error: 'Wrong password.' }, 401);
    }
    c.header('Set-Cookie', `${COOKIE_NAME}=${await createAdminSession(secret, token)}; Max-Age=${SESSION_SECONDS}; ${cookieBase}`);
    return c.json({ ok: true });
  }

  if (sub === '/logout' && method === 'POST') {
    securityHeaders(c);
    if (!sameOrigin(c)) return c.json({ ok: false, error: 'Bad request.' }, 403);
    c.header('Set-Cookie', `${COOKIE_NAME}=; Max-Age=0; ${cookieBase}`);
    return c.json({ ok: true });
  }

  if (sub === '/data' && method === 'GET') {
    securityHeaders(c);
    if (!signedIn) return c.json({ ok: false, error: 'Signed out.' }, 401);
    const limit = await checkRateLimit(`admin-data:${ip}`, 60, 60, c.env.DB, false);
    if (!limit.allowed) return c.json({ ok: false, error: 'Slow down.' }, 429);
    const days = Number(c.req.query('days') || '1');
    const data = await getAdminDashboardData(c.env, c.env.DB, days);
    return c.json({ ok: true, data });
  }

  securityHeaders(c);
  return c.text('Not found', 404);
}

function renderAdminHtml(nonce: string, base: string, signedIn: boolean): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>LearnFromClip Admin</title>
<style nonce="${nonce}">
:root{--paper:#F7F7F5;--surface:#FFFFFF;--ink:#021433;--muted:#5B6476;--rule:#E3E3DE;--accent:#2E62F4;--accent-soft:#EEF2FE;--warn:#B45309;--bad:#B91C1C;--good:#15803D;--track:#ECECE8}
@media (prefers-color-scheme:dark){:root{--paper:#121211;--surface:#1a1a19;--ink:#EDEDEA;--muted:#A3A39E;--rule:#2C2C2A;--accent:#5A84F8;--accent-soft:#1E2640;--warn:#F59E0B;--bad:#F87171;--good:#4ADE80;--track:#2A2A28}}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.wrap{max-width:1180px;margin:0 auto;padding:16px}
header{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;margin-bottom:14px}
h1{font-size:18px;margin:0;font-weight:700}
h2{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:0 0 10px;font-weight:600}
.muted{color:var(--muted);font-size:13px}
button{font:inherit;border:1px solid var(--rule);background:var(--surface);color:var(--ink);border-radius:8px;padding:7px 12px;cursor:pointer}
button[aria-pressed="true"]{background:var(--ink);color:var(--paper);border-color:var(--ink)}
button:focus-visible,input:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:14px 0}
.tile{background:var(--surface);border:1px solid var(--rule);border-radius:12px;padding:12px 14px}
.tile .v{font-size:26px;font-weight:700;font-variant-numeric:tabular-nums;margin-top:2px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:12px}
.card{background:var(--surface);border:1px solid var(--rule);border-radius:12px;padding:14px;min-width:0}
.list{list-style:none;margin:0;padding:0}
.list li{display:grid;grid-template-columns:minmax(0,1fr) 110px 52px;gap:10px;align-items:center;padding:5px 0;border-bottom:1px solid var(--rule)}
.list li:last-child{border-bottom:0}
.list .name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.list .n{text-align:right;font-variant-numeric:tabular-nums;font-weight:600}
.bar{height:8px;background:var(--track);border-radius:4px;overflow:hidden}
.bar span{display:block;height:100%;background:var(--accent);border-radius:4px}
.meter{height:12px;background:var(--track);border-radius:6px;overflow:hidden;margin:8px 0}
.meter span{display:block;height:100%;border-radius:6px}
table{width:100%;border-collapse:collapse;font-size:13px;font-variant-numeric:tabular-nums}
th,td{text-align:left;padding:6px 4px;border-bottom:1px solid var(--rule)}
th{color:var(--muted);font-weight:600}
td.r,th.r{text-align:right}
.scroll{overflow-x:auto}
.feed li{grid-template-columns:62px minmax(0,1fr)}
.feed .meta{color:var(--muted);font-size:12px}
svg text{fill:var(--muted);font-size:11px}
.tip{position:fixed;pointer-events:none;background:var(--ink);color:var(--paper);padding:6px 9px;border-radius:6px;font-size:12px;display:none;z-index:9}
.tip b{display:block;font-size:14px}
.login{max-width:360px;margin:12vh auto;background:var(--surface);border:1px solid var(--rule);border-radius:14px;padding:22px}
.login input{width:100%;font:inherit;padding:10px 12px;border:1px solid var(--rule);border-radius:8px;background:var(--paper);color:var(--ink);margin:10px 0}
.login button{width:100%;background:var(--ink);color:var(--paper);border-color:var(--ink);padding:10px}
.err{color:var(--bad);font-size:13px;min-height:18px}
.loading{opacity:.55;transition:opacity .2s}
details summary{cursor:pointer;color:var(--muted);font-size:13px;margin-top:8px}
</style>
</head>
<body>
<div id="app" data-base="${base}" data-signed-in="${signedIn ? '1' : '0'}"></div>
<div class="tip" id="tip" role="status"></div>
<script nonce="${nonce}">
(function(){
var app=document.getElementById('app');
var BASE=app.getAttribute('data-base');
var days=1;
var timer=null;
var regionNames=null;
try{regionNames=new Intl.DisplayNames(['en'],{type:'region'});}catch(e){}

function el(tag,attrs,children){
  var n=document.createElement(tag);
  if(attrs){for(var k in attrs){
    if(k==='text')n.textContent=attrs[k];
    else if(k==='cls')n.className=attrs[k];
    else if(k.slice(0,2)==='on')n.addEventListener(k.slice(2),attrs[k]);
    else n.setAttribute(k,attrs[k]);
  }}
  (children||[]).forEach(function(ch){if(ch!=null)n.appendChild(typeof ch==='string'?document.createTextNode(ch):ch);});
  return n;
}
function fmt(n){return Number(n||0).toLocaleString('en-US');}
function usd(n){n=Number(n||0);return n<0.01&&n>0?'$'+n.toFixed(4):'$'+n.toFixed(2);}
function flag(cc){if(!cc||cc.length!==2||cc==='??')return '🌐';return String.fromCodePoint(127397+cc.charCodeAt(0),127397+cc.charCodeAt(1));}
function countryName(cc){if(!cc||cc==='??')return 'Unknown';try{return regionNames?regionNames.of(cc):cc;}catch(e){return cc;}}
function ago(sec){var d=Math.max(0,Math.floor(Date.now()/1000-sec));if(d<60)return d+'s ago';if(d<3600)return Math.floor(d/60)+'m ago';if(d<86400)return Math.floor(d/3600)+'h ago';return Math.floor(d/86400)+'d ago';}

function showLogin(msg){
  if(timer){clearInterval(timer);timer=null;}
  app.textContent='';
  var err=el('div',{cls:'err',role:'alert',text:msg||''});
  var input=el('input',{type:'password',id:'pw',autocomplete:'current-password','aria-label':'Admin password',placeholder:'Admin password'});
  var form=el('form',{cls:'login',onsubmit:function(ev){
    ev.preventDefault();err.textContent='';
    fetch(BASE+'/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:input.value}),credentials:'same-origin'})
      .then(function(r){return r.json().then(function(j){return {s:r.status,j:j};});})
      .then(function(x){if(x.j&&x.j.ok){input.value='';showDashboard();}else{err.textContent=(x.j&&x.j.error)||'Sign-in failed.';}})
      .catch(function(){err.textContent='Network error.';});
  }},[el('h1',{text:'LearnFromClip Admin'}),el('p',{cls:'muted',text:'Private. Sign in with the admin password.'}),input,err,el('button',{type:'submit',text:'Sign in'})]);
  app.appendChild(form);input.focus();
}

// One row per day for the last n days, ending at toDay; days without visits show as 0.
function fillDays(rows,n,toDay){
  var byDay={};rows.forEach(function(r){byDay[r.day]=r;});
  var out=[];var end=Date.parse(toDay+'T00:00:00Z');
  for(var i=n-1;i>=0;i--){var day=new Date(end-i*86400000).toISOString().slice(0,10);out.push(byDay[day]||{day:day,visitors:0,views:0});}
  return out;
}

function listCard(title,rows,nameFn,valueKey,emptyText){
  var max=rows.reduce(function(m,r){return Math.max(m,Number(r[valueKey])||0);},0)||1;
  var ul=el('ul',{cls:'list'});
  rows.forEach(function(r){
    var v=Number(r[valueKey])||0;
    var fill=el('span');fill.style.width=Math.max(2,Math.round(v/max*100))+'%';
    ul.appendChild(el('li',null,[el('span',{cls:'name',title:nameFn(r)},[nameFn(r)]),el('div',{cls:'bar','aria-hidden':'true'},[fill]),el('span',{cls:'n',text:fmt(v)})]));
  });
  if(!rows.length)ul.appendChild(el('li',null,[el('span',{cls:'muted',text:emptyText||'No data yet.'})]));
  return el('section',{cls:'card'},[el('h2',{text:title}),ul]);
}

function dayChart(rows,key,label){
  var W=640,H=170,pad=24,n=rows.length;
  var svgNS='http://www.w3.org/2000/svg';
  var svg=document.createElementNS(svgNS,'svg');
  svg.setAttribute('viewBox','0 0 '+W+' '+H);svg.setAttribute('width','100%');svg.setAttribute('role','img');
  svg.setAttribute('aria-label',label+' per day');
  var max=rows.reduce(function(m,r){return Math.max(m,Number(r[key])||0);},0)||1;
  var slot=(W-pad*2)/Math.max(1,n);var bw=Math.max(3,Math.min(28,slot-4));
  var tip=document.getElementById('tip');
  var base=document.createElementNS(svgNS,'line');base.setAttribute('x1',pad);base.setAttribute('x2',W-pad);base.setAttribute('y1',H-22);base.setAttribute('y2',H-22);base.setAttribute('stroke','currentColor');base.setAttribute('opacity','.15');svg.appendChild(base);
  rows.forEach(function(r,i){
    var v=Number(r[key])||0;var h=Math.round((H-40)*v/max);
    var x=pad+i*slot+(slot-bw)/2;
    var g=document.createElementNS(svgNS,'g');g.setAttribute('tabindex','0');
    var hit=document.createElementNS(svgNS,'rect');hit.setAttribute('x',pad+i*slot);hit.setAttribute('y',8);hit.setAttribute('width',slot);hit.setAttribute('height',H-30);hit.setAttribute('fill','transparent');
    var b=document.createElementNS(svgNS,'rect');b.setAttribute('x',x);b.setAttribute('y',H-22-Math.max(h,v?2:0));b.setAttribute('width',bw);b.setAttribute('height',Math.max(h,v?2:0));b.setAttribute('rx',Math.min(4,bw/2));b.setAttribute('fill','var(--accent)');
    g.appendChild(hit);g.appendChild(b);
    function show(ev){tip.textContent='';tip.appendChild(el('b',{text:fmt(v)}));tip.appendChild(document.createTextNode(label+' · '+r.day));tip.style.display='block';var rc=(ev&&ev.clientX!=null&&ev.type!=='focus')?{x:ev.clientX,y:ev.clientY}:{x:g.getBoundingClientRect().left,y:g.getBoundingClientRect().top};tip.style.left=Math.min(window.innerWidth-160,rc.x+12)+'px';tip.style.top=(rc.y-48)+'px';b.setAttribute('opacity','.75');}
    function hide(){tip.style.display='none';b.setAttribute('opacity','1');}
    g.addEventListener('pointermove',show);g.addEventListener('pointerleave',hide);g.addEventListener('focus',show);g.addEventListener('blur',hide);
    svg.appendChild(g);
    if(n<=16||i===0||i===n-1||i%Math.ceil(n/8)===0){var t=document.createElementNS(svgNS,'text');t.setAttribute('x',pad+i*slot+slot/2);t.setAttribute('y',H-6);t.setAttribute('text-anchor','middle');t.textContent=r.day.slice(5);svg.appendChild(t);}
  });
  var top=document.createElementNS(svgNS,'text');top.setAttribute('x',pad);top.setAttribute('y',12);top.textContent='max '+fmt(max);svg.appendChild(top);
  var table=el('table',null,[el('thead',null,[el('tr',null,[el('th',{text:'Day'}),el('th',{cls:'r',text:label})])])]);
  var tb=el('tbody');rows.slice().reverse().forEach(function(r){tb.appendChild(el('tr',null,[el('td',{text:r.day}),el('td',{cls:'r',text:fmt(r[key])})]));});table.appendChild(tb);
  return el('div',null,[svg,el('details',null,[el('summary',{text:'Show as table'}),el('div',{cls:'scroll'},[table])])]);
}

function tile(label,value,sub){return el('div',{cls:'tile'},[el('div',{cls:'muted',text:label}),el('div',{cls:'v',text:value}),sub?el('div',{cls:'muted',text:sub}):null]);}

function render(d){
  app.textContent='';
  var head=el('header',null,[
    el('div',null,[el('h1',{text:'LearnFromClip Admin'}),el('div',{cls:'muted',text:'Updated '+new Date(d.generatedAt).toLocaleTimeString()+' · times in UTC days'})]),
    el('div',{cls:'row'},[1,7,30,90].map(function(n){return el('button',{'aria-pressed':String(days===n),text:n===1?'Today':n+' days',onclick:function(){days=n;load();}});}).concat([
      el('button',{text:'Refresh',onclick:function(){load();}}),
      el('button',{text:'Sign out',onclick:function(){fetch(BASE+'/logout',{method:'POST',headers:{'content-type':'application/json'},body:'{}',credentials:'same-origin'}).then(function(){showLogin('Signed out.');});}})
    ]))
  ]);
  app.appendChild(el('div',{cls:'wrap',id:'wrap'},[head]));
  var wrap=document.getElementById('wrap');
  if(!d.hasDatabase){wrap.appendChild(el('p',{text:'No database is connected, so there is nothing to show.'}));return;}

  var v=d.visitors,b=d.budget,ai=d.aiToday;
  var todayAi=d.aiPerDay.filter(function(r){return r.day===d.range.to;})[0];
  var rangeLabel=days===1?'today':'last '+days+' days';
  wrap.appendChild(el('div',{cls:'tiles'},[
    tile('Live now',fmt(v.liveNow),'visitors in the last 5 min'),
    tile('Visitors today',fmt(v.today.visitors),fmt(v.today.views)+' page views'),
    days>1?tile('Visitors '+rangeLabel,fmt(v.range.visitors),fmt(v.range.views)+' page views · daily uniques added up'):null,
    tile('New packs today',fmt(todayAi?todayAi.packMisses:0),fmt(todayAi?todayAi.packHits:0)+' reused for free'),
    tile('At free AI limit',fmt(d.studentsAtDailyAiLimitToday),'students today'),
    tile('Accounts',fmt(d.users.total),fmt(d.users.newInRange)+' new '+rangeLabel)
  ]));

  var pct=b.budgetUsd>0?Math.min(100,Math.round(b.spentUsd/b.budgetUsd*100)):100;
  var meterFill=el('span');meterFill.style.width=pct+'%';meterFill.style.background=pct>=100?'var(--bad)':pct>=75?'var(--warn)':'var(--good)';
  var hrs=Math.floor(b.resetsInSeconds/3600),mins=Math.ceil((b.resetsInSeconds%3600)/60);
  var aiCard=el('section',{cls:'card'},[
    el('h2',{text:'AI today'}),
    el('div',{cls:'row'},[el('strong',{text:usd(b.spentUsd)+' of '+usd(b.budgetUsd)+' daily budget'}),el('span',{cls:'muted',text:'· '+(b.ok?usd(b.remainingUsd)+' left':'paused: new AI work stops until reset')})]),
    el('div',{cls:'meter',role:'img','aria-label':pct+'% of the daily AI budget used'},[meterFill]),
    el('div',{cls:'muted',text:(b.ok?'Status: running':'Status: PAUSED')+' · resets in '+hrs+' h '+mins+' min (00:00 UTC)'}),
    el('div',{cls:'muted',text:'Transcription '+fmt(ai.transcriptionMinutes)+' min · pack reuse '+ai.packCacheHitRate+'% · transcript reuse '+ai.transcriptCacheHitRate+'%'}),
    el('div',{cls:'muted',text:'This is an estimate. The exact bill is in Cloudflare → Workers AI.'})
  ]);

  var aiRows=d.aiPerDay.map(function(r){
    var cost=(r.whisperSeconds/60)*0.000513+(r.inTokens/1e6)*0.35+(r.outTokens/1e6)*0.75;
    return el('tr',null,[el('td',{text:r.day}),el('td',{cls:'r',text:usd(cost)}),el('td',{cls:'r',text:fmt(r.packMisses)}),el('td',{cls:'r',text:fmt(r.packHits)}),el('td',{cls:'r',text:fmt(Math.round(r.whisperSeconds/60))})]);
  }).reverse();
  var aiTable=el('section',{cls:'card'},[el('h2',{text:'AI per day'}),el('div',{cls:'scroll'},[el('table',null,[
    el('thead',null,[el('tr',null,[el('th',{text:'Day'}),el('th',{cls:'r',text:'Est. cost'}),el('th',{cls:'r',text:'New packs'}),el('th',{cls:'r',text:'Reused'}),el('th',{cls:'r',text:'Audio min'})])]),
    el('tbody',null,aiRows.length?aiRows:[el('tr',null,[el('td',{text:'No AI use yet.'})])])
  ])])]);

  var feed=el('ul',{cls:'list feed'});
  d.recent.forEach(function(r){
    var where=flag(r.country)+' '+(r.city?r.city+', ':'')+countryName(r.country);
    feed.appendChild(el('li',null,[el('span',{cls:'muted',text:ago(r.at)}),el('div',null,[el('div',{cls:'name',text:where+' → '+r.path}),el('div',{cls:'meta',text:(r.referrer||'Direct')+' · '+r.device+' · '+r.browser+' · '+r.os})])]));
  });
  if(!d.recent.length)feed.appendChild(el('li',null,[el('span',{cls:'muted',text:'No visits recorded yet.'})]));

  wrap.appendChild(el('div',{cls:'grid'},[
    aiCard,
    el('section',{cls:'card'},[el('h2',{text:'Visitors per day'}),dayChart(fillDays(v.perDay,Math.max(days,14),d.range.to),'visitors','Visitors')]),
    listCard('Countries · '+rangeLabel,d.countries,function(r){return flag(r.country)+' '+countryName(r.country);},'visitors'),
    listCard('Cities · '+rangeLabel,d.cities,function(r){return flag(r.country)+' '+r.city;},'visitors'),
    listCard('Where visitors came from',d.sources,function(r){return r.source;},'visitors'),
    listCard('Pages',d.pages,function(r){return r.path;},'views'),
    listCard('Devices',d.devices,function(r){return r.name;},'visitors'),
    listCard('Browsers',d.browsers,function(r){return r.name;},'visitors'),
    listCard('Operating systems',d.systems,function(r){return r.name;},'visitors'),
    listCard('Student actions · '+rangeLabel,d.events,function(r){return r.name.replace(/_/g,' ');},'count','No actions yet.'),
    aiTable,
    el('section',{cls:'card'},[el('h2',{text:'Latest visits'}),feed]),
    el('section',{cls:'card'},[el('h2',{text:'Library'}),el('div',{cls:'muted',text:fmt(d.library.transcripts)+' saved transcripts · '+fmt(d.library.packs)+' saved packs (reused for free)'}),el('div',{cls:'muted',text:'Visits are kept 90 days. No IP addresses are stored.'})])
  ]));
}

function load(){
  var w=document.getElementById('wrap');if(w)w.classList.add('loading');
  fetch(BASE+'/data?days='+days,{credentials:'same-origin'})
    .then(function(r){if(r.status===401){showLogin('');return null;}return r.json();})
    .then(function(j){if(!j)return;if(j.ok)render(j.data);else if(w){w.classList.remove('loading');}})
    .catch(function(){if(w)w.classList.remove('loading');});
}
function showDashboard(){app.textContent='';app.appendChild(el('div',{cls:'wrap',id:'wrap'},[el('p',{cls:'muted',text:'Loading…'})]));load();if(!timer)timer=setInterval(load,60000);}

if(app.getAttribute('data-signed-in')==='1')showDashboard();else showLogin('');
})();
</script>
</body>
</html>`;
}
