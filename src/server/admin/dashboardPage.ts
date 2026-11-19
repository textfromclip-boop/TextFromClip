// HTML for the private admin console (Cloudflare-Web-Analytics-style dashboard).
// Self-contained: no external scripts, styles or fonts; strict nonce CSP; all data rendered with
// textContent / setAttribute (never innerHTML), because paths, cities and referrers come from visitors.
import { WORLD_MAP_PATHS, WORLD_MAP_VIEWBOX } from './worldMap';

const MAP_JSON = JSON.stringify(WORLD_MAP_PATHS);

export function renderAdminHtml(nonce: string, base: string, signedIn: boolean): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="only light">
<title>LearnFromClip Analytics</title>
<style nonce="${nonce}">
:root{color-scheme:light only;--paper:#F7F7F5;--surface:#FFFFFF;--ink:#021433;--muted:#5B6476;--faint:#8A91A0;--rule:#E3E3DE;--accent:#2E62F4;--accent-wash:rgba(46,98,244,.14);--track:#ECECE8;--map-empty:#E6E6E1;--map-stroke:#FFFFFF;
--seq1:#DCE6FD;--seq2:#A9C0FA;--seq3:#7096F6;--seq4:#3F6EF0;--seq5:#1F49C7;--good:#15803D;--warn:#B45309;--bad:#B91C1C}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.wrap{max-width:1240px;margin:0 auto;padding:0 16px 40px}
.top{position:sticky;top:0;z-index:5;background:var(--paper);border-bottom:1px solid var(--rule);margin:0 -16px 16px;padding:10px 16px}
.bar{display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center;justify-content:space-between;max-width:1240px;margin:0 auto}
.brand{font-weight:700;font-size:16px}.brand span{color:var(--muted);font-weight:500}
.live{display:inline-flex;align-items:center;gap:6px;font-size:13px;color:var(--muted)}
.dot{width:8px;height:8px;border-radius:50%;background:var(--good)}
.controls{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
button,select{font:inherit;color:var(--ink);background:var(--surface);border:1px solid var(--rule);border-radius:8px;padding:7px 11px;cursor:pointer}
button:hover,select:hover{border-color:var(--faint)}
button:focus-visible,select:focus-visible,input:focus-visible,[tabindex]:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.tabs{display:flex;gap:4px;border-bottom:1px solid var(--rule);margin:0 0 14px;overflow-x:auto}
.tabs button{border:0;border-bottom:2px solid transparent;border-radius:0;background:none;padding:10px 12px;color:var(--muted);font-weight:600;white-space:nowrap}
.tabs button[aria-selected="true"]{color:var(--ink);border-bottom-color:var(--accent)}
.filters{display:flex;flex-wrap:wrap;gap:8px;align-items:center;min-height:34px;margin-bottom:14px;color:var(--muted);font-size:13px}
.chip{display:inline-flex;align-items:center;gap:6px;background:var(--accent-wash);color:var(--ink);border:1px solid transparent;border-radius:999px;padding:4px 6px 4px 11px;font-size:13px}
.chip button{border:0;background:none;padding:0 4px;font-size:15px;line-height:1;color:var(--muted)}
.card{background:var(--surface);border:1px solid var(--rule);border-radius:12px;padding:16px;min-width:0}
.card h2{font-size:13px;font-weight:600;margin:0 0 12px;color:var(--ink)}
.card h2 small{font-weight:400;color:var(--muted)}
.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border-bottom:1px solid var(--rule);margin:-16px -16px 14px;border-radius:12px 12px 0 0;overflow:hidden}
.metric{border-top-color:transparent!important}.metric[aria-pressed="true"]{border-top-color:var(--accent)!important}
.metric{border:0;border-radius:0;background:none;text-align:left;padding:14px 16px 12px;border-top:3px solid transparent;border-right:1px solid var(--rule)}
.metric:last-child{border-right:0}
.metric[aria-pressed="true"]{border-top-color:var(--accent);background:var(--accent-wash)}
.metric .l{font-size:12px;color:var(--muted);font-weight:600}
.metric .v{font-size:26px;font-weight:700;font-variant-numeric:tabular-nums;margin:2px 0}
.delta{font-size:12px;font-weight:600}.delta.up{color:var(--good)}.delta.down{color:var(--bad)}.delta.flat{color:var(--muted)}
@media (max-width:700px){.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.metric:nth-child(2){border-right:0}.metric:nth-child(-n+2){border-bottom:1px solid var(--rule)}}
.chart svg{display:block;width:100%;height:auto;overflow:visible}
.chart text{fill:var(--faint);font-size:11px}
.grid{display:grid;gap:14px;margin-top:14px}
.g2{grid-template-columns:repeat(auto-fit,minmax(340px,1fr))}
.g3{grid-template-columns:repeat(auto-fit,minmax(260px,1fr))}
.mapcard{display:grid;grid-template-columns:minmax(0,2fr) minmax(260px,1fr);gap:18px;align-items:start}
@media (max-width:820px){.mapcard{grid-template-columns:1fr}}
.map svg{display:block;width:100%;height:auto}
.map path{stroke:var(--map-stroke);stroke-width:.6;cursor:pointer}
.map path:hover{opacity:.8}
.legend{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted);margin-top:8px}
.legend i{display:inline-block;width:22px;height:8px;border-radius:2px}
.rows{list-style:none;margin:0;padding:0}
.rows li{position:relative;display:flex;justify-content:space-between;gap:10px;align-items:center;padding:7px 8px;border-radius:6px;cursor:pointer;margin-bottom:3px;overflow:hidden}
.rows li:hover{outline:1px solid var(--rule)}
.rows li .fill{position:absolute;left:0;top:0;bottom:0;background:var(--accent-wash);border-radius:6px;z-index:0}
.rows li .k,.rows li .n{position:relative;z-index:1}
.rows li .k{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rows li .n{font-variant-numeric:tabular-nums;font-weight:600}
.rows li.empty{cursor:default;color:var(--muted)}
.more{margin-top:6px;font-size:12px}
table{width:100%;border-collapse:collapse;font-size:13px;font-variant-numeric:tabular-nums}
th,td{text-align:left;padding:7px 6px;border-bottom:1px solid var(--rule);vertical-align:top}
th{color:var(--muted);font-weight:600;font-size:12px}
td.r,th.r{text-align:right}
.scroll{overflow-x:auto}
.muted{color:var(--muted)}.small{font-size:12px}
.card .v{font-size:22px;font-weight:700;font-variant-numeric:tabular-nums;margin-top:4px}
.tip{position:fixed;pointer-events:none;background:var(--ink);color:var(--paper);padding:7px 10px;border-radius:7px;font-size:12px;display:none;z-index:20;max-width:240px}
.tip b{display:block;font-size:15px}
.vitals{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px}
.vital .v{font-size:30px;font-weight:700;font-variant-numeric:tabular-nums}
.rating{display:inline-block;font-size:12px;font-weight:700;padding:2px 8px;border-radius:999px;border:1px solid currentColor;margin-left:8px;vertical-align:middle}
.rating.good{color:var(--good)}.rating.ni{color:var(--warn)}.rating.poor{color:var(--bad)}.rating.none{color:var(--muted)}
.dist{display:flex;height:10px;border-radius:5px;overflow:hidden;margin:12px 0 6px;background:var(--track);gap:2px}
.dist span{display:block;height:100%}
.dist .good{background:var(--good)}.dist .ni{background:var(--warn)}.dist .poor{background:var(--bad)}
.keys{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:12px;color:var(--muted)}
.keys b{color:var(--ink)}
.meter{height:12px;background:var(--track);border-radius:6px;overflow:hidden;margin:10px 0}
.meter span{display:block;height:100%;border-radius:6px}
.login{max-width:360px;margin:14vh auto;background:var(--surface);border:1px solid var(--rule);border-radius:14px;padding:24px}
.login h1{font-size:18px;margin:0 0 4px}
.login input{width:100%;font:inherit;padding:10px 12px;border:1px solid var(--rule);border-radius:8px;background:var(--paper);color:var(--ink);margin:12px 0 6px}
.login button{width:100%;background:var(--ink);color:var(--paper);border-color:var(--ink);padding:10px;margin-top:6px}
.err{color:var(--bad);font-size:13px;min-height:18px}
.loading{opacity:.55;transition:opacity .15s}
.feed td:first-child{white-space:nowrap;color:var(--muted)}
</style>
</head>
<body>
<div id="app" data-base="${base}" data-signed-in="${signedIn ? '1' : '0'}"></div>
<div class="tip" id="tip" role="status" aria-live="polite"></div>
<script type="application/json" nonce="${nonce}" id="worldmap" data-viewbox="${WORLD_MAP_VIEWBOX}">${MAP_JSON}</script>
<script nonce="${nonce}">
(function(){
var app=document.getElementById('app');
var BASE=app.getAttribute('data-base');
var state={days:1,tab:'traffic',metric:'visits',filters:{},data:null};
var timer=null;
var MAP=JSON.parse(document.getElementById('worldmap').textContent);
var MAP_VIEWBOX=document.getElementById('worldmap').getAttribute('data-viewbox');
var regionNames=null;try{regionNames=new Intl.DisplayNames(['en'],{type:'region'});}catch(e){}
var SVG='http://www.w3.org/2000/svg';
var METRICS={visits:'Visits',views:'Page views',visitors:'Visitors',bounceRate:'Bounce rate'};
var FILTER_LABELS={country:'Country',city:'City',path:'Page',referrer:'Source',device:'Device',browser:'Browser',os:'OS'};

function el(tag,attrs,children){
  var n=document.createElement(tag);
  if(attrs){for(var k in attrs){var v=attrs[k];if(v==null)continue;
    if(k==='text')n.textContent=v;else if(k==='cls')n.className=v;
    else if(k.slice(0,2)==='on')n.addEventListener(k.slice(2),v);else n.setAttribute(k,v);}}
  (children||[]).forEach(function(ch){if(ch!=null)n.appendChild(typeof ch==='string'?document.createTextNode(ch):ch);});
  return n;
}
function sv(tag,attrs){var n=document.createElementNS(SVG,tag);for(var k in attrs)n.setAttribute(k,attrs[k]);return n;}
function fmt(n){n=Number(n||0);if(n>=1e6)return (n/1e6).toFixed(1).replace(/\\.0$/,'')+'M';if(n>=1e4)return (n/1e3).toFixed(1).replace(/\\.0$/,'')+'k';return n.toLocaleString('en-US');}
function usd(n){n=Number(n||0);return n>0&&n<0.01?'$'+n.toFixed(4):'$'+n.toFixed(2);}
function flag(cc){if(!cc||cc.length!==2||cc==='??')return '🌐';return String.fromCodePoint(127397+cc.charCodeAt(0),127397+cc.charCodeAt(1));}
function cname(cc){if(!cc||cc==='??')return 'Unknown';try{return (regionNames&&regionNames.of(cc))||cc;}catch(e){return cc;}}
function ago(sec){var d=Math.max(0,Math.floor(Date.now()/1000-sec));if(d<60)return d+'s ago';if(d<3600)return Math.floor(d/60)+'m ago';if(d<86400)return Math.floor(d/3600)+'h ago';return Math.floor(d/86400)+'d ago';}
function dayLabel(iso){try{return new Date(iso+'T00:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'UTC'});}catch(e){return iso;}}
var tip=document.getElementById('tip');
function showTip(x,y,value,label){tip.textContent='';tip.appendChild(el('b',{text:value}));tip.appendChild(document.createTextNode(label));tip.style.display='block';var w=tip.offsetWidth||160;tip.style.left=Math.max(8,Math.min(window.innerWidth-w-8,x+14))+'px';tip.style.top=Math.max(8,y-56)+'px';}
function hideTip(){tip.style.display='none';}

// ---- sign-in
function showLogin(msg){
  if(timer){clearInterval(timer);timer=null;}
  app.textContent='';
  var err=el('div',{cls:'err',role:'alert',text:msg||''});
  var input=el('input',{type:'password',autocomplete:'current-password','aria-label':'Admin password',placeholder:'Admin password'});
  app.appendChild(el('form',{cls:'login',onsubmit:function(ev){
    ev.preventDefault();err.textContent='';
    fetch(BASE+'/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:input.value}),credentials:'same-origin'})
      .then(function(r){return r.json();})
      .then(function(j){if(j&&j.ok){input.value='';start();}else{err.textContent=(j&&j.error)||'Sign-in failed.';}})
      .catch(function(){err.textContent='Network error.';});
  }},[el('h1',{text:'LearnFromClip Analytics'}),el('p',{cls:'muted',text:'Private. Sign in with the admin password.'}),input,err,el('button',{type:'submit',text:'Sign in'})]));
  input.focus();
}

// ---- data
function query(){
  var q='?days='+state.days;
  for(var k in state.filters)q+='&'+encodeURIComponent(k)+'='+encodeURIComponent(state.filters[k]);
  return q;
}
function load(){
  var main=document.getElementById('main');if(main)main.classList.add('loading');
  fetch(BASE+'/data'+query(),{credentials:'same-origin'})
    .then(function(r){if(r.status===401){showLogin('Your session ended. Sign in again.');return null;}return r.json();})
    .then(function(j){if(!j)return;if(j.ok){state.data=j.data;render();}else if(main)main.classList.remove('loading');})
    .catch(function(){if(main)main.classList.remove('loading');});
}
function setFilter(key,value){state.filters[key]=value;load();}
function clearFilter(key){delete state.filters[key];load();}

// ---- shell
function start(){app.textContent='';app.appendChild(el('div',{cls:'wrap'},[el('p',{cls:'muted',text:'Loading…'})]));load();if(!timer)timer=setInterval(function(){if(document.visibilityState==='visible')load();},60000);}

function render(){
  var d=state.data;
  app.textContent='';
  var wrap=el('div',{cls:'wrap'});
  var rangeSel=el('select',{'aria-label':'Time range',onchange:function(e){state.days=Number(e.target.value);load();}},
    [[1,'Today (hourly)'],[7,'Last 7 days'],[30,'Last 30 days'],[90,'Last 90 days']].map(function(o){var op=el('option',{value:String(o[0]),text:o[1]});if(o[0]===state.days)op.selected=true;return op;}));
  var live=d.traffic?d.traffic.liveNow:0;
  wrap.appendChild(el('div',{cls:'top'},[el('div',{cls:'bar'},[
    el('div',null,[el('div',{cls:'brand'},['LearnFromClip ',el('span',{text:'Web Analytics'})]),el('div',{cls:'small muted',text:'Updated '+new Date(d.generatedAt).toLocaleTimeString()+' · days are UTC'})]),
    el('span',{cls:'live'},[el('span',{cls:'dot','aria-hidden':'true'}),fmt(live)+' live now']),
    el('div',{cls:'controls'},[rangeSel,el('button',{text:'Refresh',onclick:load}),el('button',{text:'Sign out',onclick:function(){fetch(BASE+'/logout',{method:'POST',headers:{'content-type':'application/json'},body:'{}',credentials:'same-origin'}).then(function(){showLogin('Signed out.');});}})])
  ])]));
  var tabs=[['traffic','Traffic'],['speed','Speed (Web Vitals)'],['usage','AI & usage']];
  wrap.appendChild(el('div',{cls:'tabs',role:'tablist'},tabs.map(function(t){return el('button',{role:'tab','aria-selected':String(state.tab===t[0]),text:t[1],onclick:function(){state.tab=t[0];render();}});})));
  var chips=[];
  for(var k in state.filters){(function(k){var v=state.filters[k];var shown=k==='country'?flag(v)+' '+cname(v):v;chips.push(el('span',{cls:'chip'},[FILTER_LABELS[k]+': '+shown,el('button',{'aria-label':'Remove filter '+FILTER_LABELS[k],text:'×',onclick:function(){clearFilter(k);}})]));})(k);}
  wrap.appendChild(el('div',{cls:'filters'},chips.length?[el('span',{text:'Filtered by'})].concat(chips):[el('span',{text:'Tap any country, page, source or device below to filter everything by it.'})]));
  var main=el('div',{id:'main'});
  wrap.appendChild(main);
  app.appendChild(wrap);
  if(!d.hasDatabase){main.appendChild(el('p',{text:'No database is connected, so there is nothing to show.'}));return;}
  if(state.tab==='traffic')renderTraffic(main,d);else if(state.tab==='speed')renderSpeed(main,d);else renderUsage(main,d);
}

function rangeWord(){return state.days===1?'yesterday (same time)':'previous '+state.days+' days';}
function deltaEl(cur,prev,lowerIsBetter){
  if(!prev&&!cur)return el('span',{cls:'delta flat',text:'— vs '+rangeWord()});
  if(!prev)return el('span',{cls:'delta '+(lowerIsBetter?'flat':'up'),text:'new vs '+rangeWord()});
  var pct=Math.round((cur-prev)/prev*100);
  if(pct===0)return el('span',{cls:'delta flat',text:'0% vs '+rangeWord()});
  var better=lowerIsBetter?pct<0:pct>0;
  return el('span',{cls:'delta '+(better?'up':'down'),text:(pct>0?'▲ ':'▼ ')+Math.abs(pct)+'% vs '+rangeWord()});
}
function metricValue(t,m){return m==='bounceRate'?t.bounceRate+'%':fmt(t[m]);}
function listMetric(){return state.metric==='bounceRate'?'visitors':state.metric;}

// ---- Traffic
function renderTraffic(main,d){
  var t=d.traffic;
  var card=el('section',{cls:'card'});
  card.appendChild(el('div',{cls:'metrics'},Object.keys(METRICS).map(function(m){
    return el('button',{cls:'metric','aria-pressed':String(state.metric===m),onclick:function(){state.metric=m;render();}},[
      el('div',{cls:'l',text:METRICS[m]}),el('div',{cls:'v',text:metricValue(t.current,m)}),deltaEl(t.current[m],t.previous[m],m==='bounceRate')]);
  })));
  var seriesMetric=state.metric==='bounceRate'?'visitors':state.metric;
  card.appendChild(el('div',{cls:'chart'},[areaChart(t.series,seriesMetric)]));
  card.appendChild(el('div',{cls:'small muted',text:(state.metric==='bounceRate'?'Chart shows visitors. ':'')+'Visits = arrivals on the site; page views = every page opened; visitors = different people per day; bounce = left after one page.'}));
  main.appendChild(card);

  var lm=listMetric();
  var countries=t.breakdowns.country||[];
  main.appendChild(el('div',{cls:'grid'},[el('section',{cls:'card'},[el('h2',null,['Countries ',el('small',{text:'· '+METRICS[lm]})]),el('div',{cls:'mapcard'},[worldMap(countries,lm),rowList(countries,lm,'country',function(r){return flag(r.k)+' '+cname(r.k);},10)])])]));

  main.appendChild(el('div',{cls:'grid g2'},[
    listCard('Pages',t.breakdowns.path,lm==='visits'?'views':lm,'path',function(r){return r.k;}),
    listCard('Sources (where visitors came from)',t.breakdowns.referrer,lm,'referrer',function(r){return r.k==='Direct'?'Direct / none':r.k;})
  ]));
  main.appendChild(el('div',{cls:'grid g3'},[
    listCard('Device types',t.breakdowns.device,lm,'device',function(r){return r.k;}),
    listCard('Browsers',t.breakdowns.browser,lm,'browser',function(r){return r.k;}),
    listCard('Operating systems',t.breakdowns.os,lm,'os',function(r){return r.k;})
  ]));
  main.appendChild(el('div',{cls:'grid g2'},[
    listCard('Cities',t.breakdowns.city,lm,'city',function(r){return flag(r.country)+' '+r.k;}),
    feedCard(t.recent)
  ]));
}

function niceMax(v){if(v<=4)return 4;var p=Math.pow(10,Math.floor(Math.log10(v)));var n=v/p;return (n<=1?1:n<=2?2:n<=5?5:10)*p;}
function areaChart(series,m){
  // Drawn at the real on-screen width so labels stay readable on phones.
  var W=Math.max(300,Math.min(1180,(window.innerWidth||1000)-66)),H=W<600?190:260,L=40,R=10,T=12,B=28,n=series.length;
  var vals=series.map(function(s){return s[m];});
  var max=niceMax(Math.max.apply(null,vals.map(function(v){return v||0;}).concat([1])));
  var svg=sv('svg',{viewBox:'0 0 '+W+' '+H,role:'img','aria-label':METRICS[m]+' over time'});
  function x(i){return L+(n<=1?0:(W-L-R)*i/(n-1));}
  function y(v){return T+(H-T-B)*(1-v/max);}
  for(var g=0;g<=4;g++){var gv=max*g/4;var gy=y(gv);svg.appendChild(sv('line',{x1:L,x2:W-R,y1:gy,y2:gy,stroke:'currentColor','stroke-opacity':g===0?'.25':'.08'}));var tx=sv('text',{x:L-8,y:gy+4,'text-anchor':'end'});tx.textContent=fmt(gv);svg.appendChild(tx);}
  var line='',area='',started=false,lastX=0,firstX=0;
  vals.forEach(function(v,i){if(v==null)return;var px=x(i),py=y(v);if(!started){line+='M'+px+','+py;area+='M'+px+','+y(0)+'L'+px+','+py;firstX=px;started=true;}else{line+='L'+px+','+py;area+='L'+px+','+py;}lastX=px;});
  if(started){area+='L'+lastX+','+y(0)+'Z';svg.appendChild(sv('path',{d:area,fill:'var(--accent-wash)'}));svg.appendChild(sv('path',{d:line,fill:'none',stroke:'var(--accent)','stroke-width':'2','stroke-linejoin':'round'}));}
  var every=Math.max(1,Math.ceil(n/Math.max(3,Math.min(state.days===1?8:7,Math.floor(W/80)))));
  series.forEach(function(s,i){if(i%every!==0&&i!==n-1)return;var tx=sv('text',{x:x(i),y:H-8,'text-anchor':i===0?'start':i===n-1?'end':'middle'});tx.textContent=state.days===1?s.label:dayLabel(s.label);svg.appendChild(tx);});
  var cross=sv('line',{y1:T,y2:H-B,stroke:'currentColor','stroke-opacity':'.35',visibility:'hidden'});
  var dot=sv('circle',{r:'5',fill:'var(--accent)',stroke:'var(--surface)','stroke-width':'2',visibility:'hidden'});
  svg.appendChild(cross);svg.appendChild(dot);
  var hit=sv('rect',{x:L,y:T,width:W-L-R,height:H-T-B,fill:'transparent',tabindex:'0','aria-label':'Move across the chart to read values'});
  function at(i,cx,cy){var v=vals[i];if(v==null){cross.setAttribute('visibility','hidden');dot.setAttribute('visibility','hidden');hideTip();return;}
    cross.setAttribute('x1',x(i));cross.setAttribute('x2',x(i));cross.setAttribute('visibility','visible');dot.setAttribute('cx',x(i));dot.setAttribute('cy',y(v));dot.setAttribute('visibility','visible');
    showTip(cx,cy,fmt(v)+' '+METRICS[m].toLowerCase(),state.days===1?'Today '+series[i].label+' UTC':dayLabel(series[i].label));}
  var focusIdx=n-1;
  hit.addEventListener('pointermove',function(e){var r=svg.getBoundingClientRect();var px=(e.clientX-r.left)/r.width*W;var i=Math.round((px-L)/((W-L-R)/Math.max(1,n-1)));i=Math.max(0,Math.min(n-1,i));at(i,e.clientX,e.clientY);});
  hit.addEventListener('pointerleave',function(){cross.setAttribute('visibility','hidden');dot.setAttribute('visibility','hidden');hideTip();});
  hit.addEventListener('keydown',function(e){if(e.key==='ArrowLeft')focusIdx=Math.max(0,focusIdx-1);else if(e.key==='ArrowRight')focusIdx=Math.min(n-1,focusIdx+1);else return;e.preventDefault();var r=svg.getBoundingClientRect();at(focusIdx,r.left+x(focusIdx)/W*r.width,r.top+40);});
  hit.addEventListener('blur',function(){hideTip();});
  svg.appendChild(hit);
  var table=el('table',null,[el('thead',null,[el('tr',null,[el('th',{text:state.days===1?'Hour (UTC)':'Day'}),el('th',{cls:'r',text:'Visits'}),el('th',{cls:'r',text:'Page views'}),el('th',{cls:'r',text:'Visitors'})])])]);
  var tb=el('tbody');series.slice().reverse().forEach(function(s){if(s.views==null)return;tb.appendChild(el('tr',null,[el('td',{text:state.days===1?s.label:dayLabel(s.label)}),el('td',{cls:'r',text:fmt(s.visits)}),el('td',{cls:'r',text:fmt(s.views)}),el('td',{cls:'r',text:fmt(s.visitors)})]));});table.appendChild(tb);
  return el('div',null,[svg,el('details',null,[el('summary',{cls:'small muted',text:'Show as table'}),el('div',{cls:'scroll'},[table])])]);
}

function worldMap(rows,m){
  // Scale only over countries that are on the map ("Unknown" has no shape).
  var by={};var max=0;rows.forEach(function(r){var v=Number(r[m])||0;by[r.k]=v;if(MAP[r.k]&&v>max)max=v;});
  var svg=sv('svg',{viewBox:MAP_VIEWBOX,role:'img','aria-label':'World map of '+METRICS[m].toLowerCase()+' by country'});
  function color(v){if(!v)return 'var(--map-empty)';var r=v/max;return r>0.8?'var(--seq5)':r>0.6?'var(--seq4)':r>0.4?'var(--seq3)':r>0.2?'var(--seq2)':'var(--seq1)';}
  Object.keys(MAP).forEach(function(cc){
    var v=by[cc]||0;
    var p=sv('path',{d:MAP[cc],fill:color(v)});
    p.addEventListener('pointermove',function(e){showTip(e.clientX,e.clientY,fmt(v)+' '+METRICS[m].toLowerCase(),flag(cc)+' '+cname(cc));});
    p.addEventListener('pointerleave',hideTip);
    p.addEventListener('click',function(){hideTip();setFilter('country',cc);});
    svg.appendChild(p);
  });
  var legend=el('div',{cls:'legend'},['Fewer']);
  ['--seq1','--seq2','--seq3','--seq4','--seq5'].forEach(function(c){var i=el('i');i.style.background='var('+c+')';legend.appendChild(i);});
  legend.appendChild(document.createTextNode('More · tap a country to filter'));
  return el('div',{cls:'map'},[svg,legend]);
}

function rowList(rows,m,filterKey,nameFn,limit){
  rows=(rows||[]).slice().sort(function(a,b){return (Number(b[m])||0)-(Number(a[m])||0);});
  var max=rows.reduce(function(a,r){return Math.max(a,Number(r[m])||0);},0)||1;
  var ul=el('ul',{cls:'rows'});
  var shown=rows.slice(0,limit);
  function draw(list){ul.textContent='';list.forEach(function(r){
    var v=Number(r[m])||0;var fill=el('span',{cls:'fill'});fill.style.width=Math.max(1,v/max*100)+'%';
    var name=nameFn(r);
    ul.appendChild(el('li',{tabindex:'0',role:'button',title:'Filter by '+name,onclick:function(){setFilter(filterKey,r.k);},onkeydown:function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();setFilter(filterKey,r.k);}}},[fill,el('span',{cls:'k',text:name}),el('span',{cls:'n',text:fmt(v)})]));
  });if(!list.length)ul.appendChild(el('li',{cls:'empty',text:'No data for this range.'}));}
  draw(shown);
  var box=el('div',null,[ul]);
  if(rows.length>limit){var more=el('button',{cls:'more',text:'Show all '+rows.length,onclick:function(){draw(rows);more.remove();}});box.appendChild(more);}
  return box;
}
function listCard(title,rows,m,key,nameFn){return el('section',{cls:'card'},[el('h2',null,[title+' ',el('small',{text:'· '+METRICS[m]})]),rowList(rows,m,key,nameFn,8)]);}

function feedCard(rows){
  var tb=el('tbody');
  (rows||[]).forEach(function(r){
    tb.appendChild(el('tr',null,[el('td',{text:ago(r.at)}),el('td',null,[el('div',{text:flag(r.country)+' '+(r.city?r.city+', ':'')+cname(r.country)}),el('div',{cls:'small muted',text:r.device+' · '+r.browser+' · '+r.os})]),el('td',null,[el('div',{text:r.path}),el('div',{cls:'small muted',text:(r.entry?'arrived from '+(r.referrer||'direct'):'next page')})])]));
  });
  if(!rows||!rows.length)tb.appendChild(el('tr',null,[el('td',{cls:'muted',text:'No visits yet.'})]));
  return el('section',{cls:'card'},[el('h2',{text:'Latest page views'}),el('div',{cls:'scroll'},[el('table',{cls:'feed'},[el('thead',null,[el('tr',null,[el('th',{text:'When'}),el('th',{text:'Where'}),el('th',{text:'Page'})])]),tb])])]);
}

// ---- Speed
var VITALS=[
  ['lcp','Largest Contentful Paint (LCP)','How long until the main content is visible.','ms'],
  ['inp','Interaction to Next Paint (INP)','How fast the page responds to a tap or key press.','ms'],
  ['cls','Cumulative Layout Shift (CLS)','How much the page jumps around while loading.',''],
  ['ttfb','Time to First Byte (TTFB)','How fast the server starts answering.','ms'],
  ['load','Page load time','Until the page has fully loaded.','ms']
];
function vfmt(v,unit){if(v==null)return '—';if(unit==='')return v.toFixed(2);return v>=1000?(v/1000).toFixed(2)+' s':Math.round(v)+' ms';}
function rate(name,v,th){if(v==null)return ['none','No data'];var t=th[name];return v<=t[0]?['good','Good']:v<=t[1]?['ni','Needs improvement']:['poor','Poor'];}
function renderSpeed(main,d){
  var v=d.vitals;
  if(v.ignoredFilters&&v.ignoredFilters.length)main.appendChild(el('p',{cls:'small muted',text:'Speed data has no city or source, so those filters are ignored on this tab.'}));
  main.appendChild(el('p',{cls:'small muted',text:'Measured on real students\\' devices, 75th percentile (3 in 4 page loads are at least this fast). '+fmt(v.samples)+' page loads measured. Google uses LCP, INP and CLS for search ranking.'}));
  var grid=el('div',{cls:'vitals'});
  VITALS.forEach(function(x){
    var m=v.metrics[x[0]];var r=rate(x[0],m.p75,v.thresholds);var total=m.good+m.needsImprovement+m.poor;
    var dist=el('div',{cls:'dist',role:'img','aria-label':total?Math.round(m.good/total*100)+'% good, '+Math.round(m.needsImprovement/total*100)+'% needs improvement, '+Math.round(m.poor/total*100)+'% poor':'No samples'});
    if(total){[['good',m.good],['ni',m.needsImprovement],['poor',m.poor]].forEach(function(p){if(!p[1])return;var s=el('span',{cls:p[0]});s.style.width=(p[1]/total*100)+'%';dist.appendChild(s);});}
    var pc=function(n){return total?Math.round(n/total*100)+'%':'—';};
    grid.appendChild(el('section',{cls:'card vital'},[
      el('h2',{text:x[1]}),
      el('div',null,[el('span',{cls:'v',text:vfmt(m.p75,x[3])}),el('span',{cls:'rating '+r[0],text:r[1]})]),
      el('div',{cls:'small muted',text:x[2]}),
      dist,
      el('div',{cls:'keys'},[el('span',null,['Good ',el('b',{text:pc(m.good)})]),el('span',null,['Needs improvement ',el('b',{text:pc(m.needsImprovement)})]),el('span',null,['Poor ',el('b',{text:pc(m.poor)})]),el('span',{text:fmt(m.samples)+' samples'})])
    ]));
  });
  main.appendChild(grid);
  var devRows=(v.devices||[]).map(function(x){var r=rate('lcp',x.lcpP75,v.thresholds);return el('tr',null,[el('td',{text:x.device}),el('td',{cls:'r',text:vfmt(x.lcpP75,'ms')}),el('td',null,[el('span',{cls:'rating '+r[0],text:r[1]})]),el('td',{cls:'r',text:fmt(x.samples)})]);});
  var pageRows=(v.pages||[]).map(function(x){var r=rate('lcp',x.lcpP75,v.thresholds);return el('tr',{tabindex:'0',onclick:function(){setFilter('path',x.path);}},[el('td',{text:x.path}),el('td',{cls:'r',text:vfmt(x.lcpP75,'ms')}),el('td',null,[el('span',{cls:'rating '+r[0],text:r[1]})]),el('td',{cls:'r',text:fmt(x.samples)})]);});
  function tbl(first,rows,empty){return el('div',{cls:'scroll'},[el('table',null,[el('thead',null,[el('tr',null,[el('th',{text:first}),el('th',{cls:'r',text:'LCP (p75)'}),el('th',{text:'Rating'}),el('th',{cls:'r',text:'Samples'})])]),el('tbody',null,rows.length?rows:[el('tr',null,[el('td',{cls:'muted',text:empty})])])])]);}
  main.appendChild(el('div',{cls:'grid g2'},[
    el('section',{cls:'card'},[el('h2',{text:'By device type'}),tbl('Device',devRows,'No samples yet.')]),
    el('section',{cls:'card'},[el('h2',{text:'Slowest pages'}),tbl('Page',pageRows,'No samples yet.')])
  ]));
}

// ---- AI & usage
function renderUsage(main,d){
  var u=d.usage,b=u.budget,ai=u.aiToday;
  var pct=b.budgetUsd>0?Math.min(100,Math.round(b.spentUsd/b.budgetUsd*100)):100;
  var meter=el('span');meter.style.width=pct+'%';meter.style.background=pct>=100?'var(--bad)':pct>=75?'var(--warn)':'var(--good)';
  var hrs=Math.floor(b.resetsInSeconds/3600),mins=Math.ceil((b.resetsInSeconds%3600)/60);
  var card=el('section',{cls:'card'},[el('h2',{text:'Free AI today'}),
    el('div',null,[el('strong',{text:usd(b.spentUsd)+' of '+usd(b.budgetUsd)+' daily budget'}),el('span',{cls:'rating '+(b.ok?'good':'poor'),text:b.ok?'Running':'Paused until reset'})]),
    el('div',{cls:'meter',role:'img','aria-label':pct+'% of the daily AI budget used'},[meter]),
    el('div',{cls:'small muted',text:'Resets in '+hrs+' h '+mins+' min (00:00 UTC). New packs today: '+fmt(u.packsToday.made)+' · reused for free: '+fmt(u.packsToday.reused)+' · audio transcribed: '+fmt(ai.transcriptionMinutes)+' min.'}),
    el('div',{cls:'small muted',text:'Estimate. The exact bill is in Cloudflare → AI → Workers AI.'})]);
  var tiles=el('div',{cls:'grid g3'},[
    statCard('Students at the free AI limit today',fmt(u.studentsAtDailyAiLimitToday)),
    statCard('Accounts',fmt(u.users.total)+' ('+fmt(u.users.newInRange)+' new in range)'),
    statCard('Saved for reuse',fmt(u.library.transcripts)+' transcripts · '+fmt(u.library.packs)+' packs')
  ]);
  var aiRows=(u.aiPerDay||[]).map(function(r){var cost=(r.whisperSeconds/60)*0.000513+(r.inTokens/1e6)*0.35+(r.outTokens/1e6)*0.75;return el('tr',null,[el('td',{text:dayLabel(r.day)}),el('td',{cls:'r',text:usd(cost)}),el('td',{cls:'r',text:fmt(r.packMisses)}),el('td',{cls:'r',text:fmt(r.packHits)}),el('td',{cls:'r',text:fmt(Math.round(r.whisperSeconds/60))})]);});
  var maxEv=(u.events||[]).reduce(function(a,r){return Math.max(a,r.count);},0)||1;
  var evList=el('ul',{cls:'rows'},(u.events||[]).map(function(r){var f=el('span',{cls:'fill'});f.style.width=(r.count/maxEv*100)+'%';return el('li',{cls:'empty'},[f,el('span',{cls:'k',text:r.name.replace(/_/g,' ')}),el('span',{cls:'n',text:fmt(r.count)})]);}));
  if(!(u.events||[]).length)evList.appendChild(el('li',{cls:'empty',text:'No actions in this range.'}));
  main.appendChild(card);main.appendChild(tiles);
  main.appendChild(el('div',{cls:'grid g2'},[
    el('section',{cls:'card'},[el('h2',{text:'AI per day'}),el('div',{cls:'scroll'},[el('table',null,[el('thead',null,[el('tr',null,[el('th',{text:'Day'}),el('th',{cls:'r',text:'Est. cost'}),el('th',{cls:'r',text:'New packs'}),el('th',{cls:'r',text:'Reused'}),el('th',{cls:'r',text:'Audio min'})])]),el('tbody',null,aiRows.length?aiRows:[el('tr',null,[el('td',{cls:'muted',text:'No AI use yet.'})])])])])]),
    el('section',{cls:'card'},[el('h2',null,['Student actions ',el('small',{text:'· since '+dayLabel(u.fromDate)})]),evList])
  ]));
  main.appendChild(el('p',{cls:'small muted',text:'Visits and speed samples are kept 90 days. No IP addresses are stored. Your own visits on browsers where you signed in here are not counted.'}));
}
function statCard(label,value){return el('section',{cls:'card'},[el('div',{cls:'small muted',text:label}),el('div',{cls:'v',text:value})]);}

var resizeTimer=null;var lastW=window.innerWidth;
window.addEventListener('resize',function(){if(!state.data||Math.abs(window.innerWidth-lastW)<40)return;lastW=window.innerWidth;clearTimeout(resizeTimer);resizeTimer=setTimeout(render,200);});
if(app.getAttribute('data-signed-in')==='1')start();else showLogin('');
})();
</script>
</body>
</html>`;
}
