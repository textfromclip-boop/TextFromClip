// Runs the paid-plan quota rules against a REAL local D1 (not the in-memory test store), so the
// conditional-UPDATE SQL for daily + rolling-period caps is exercised exactly as in production.
// Usage: node e2e/quota-sql.mjs   (expects migrations applied to .wrangler/e2e, see run-all.sh)
import { join } from 'node:path';
import { build } from 'esbuild';
import { getPlatformProxy } from 'wrangler';

const ROOT = new URL('..', import.meta.url).pathname;
await build({
  entryPoints: [join(ROOT, 'src/server/utils/quotasAndCache.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: join(ROOT, 'e2e/.build/quotas.mjs'),
  logLevel: 'error',
});
const q = await import(join(ROOT, 'e2e/.build/quotas.mjs') + `?t=${Date.now()}`);
const proxy = await getPlatformProxy({
  configPath: join(ROOT, 'e2e/wrangler.e2e.toml'),
  persist: { path: join(ROOT, '.wrangler/e2e/v3') },
});
const db = proxy.env.DB;
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const day = (n) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};
const tag = Date.now().toString(36);
const reserve = (actorKey, plan) => q.reserveQuota({ actorKey, plan, delta: { aiHalfUnits: 2 }, db });

// 1. Daily cap on a paid plan
{
  const actor = `user:sql-daily-${tag}`;
  let ok = 0;
  for (let i = 0; i < 24; i++) if ((await reserve(actor, 'prep_pass')).ok) ok++;
  check('D1: paid daily cap is 20 AI actions', ok === 20, `${ok} granted of 24`);
}

// 2. Rolling 7-day cap on the Exam Week Pass
{
  const actor = `user:sql-week-${tag}`;
  for (const n of [1, 2, 3]) await q.consumeQuota({ actorKey: actor, utcDate: day(n), aiHalfUnits: 38, db });
  let ok = 0;
  for (let i = 0; i < 10; i++) if ((await reserve(actor, 'exam_pass')).ok) ok++;
  const s = await q.getDailyQuotaStatus({ actorKey: actor, plan: 'exam_pass', db });
  check('D1: Exam Week Pass stops at 60 per 7 days', ok === 3 && s.aiPeriodUsed === 60 && s.aiPeriodReached === true, `${ok} granted, period ${s.aiPeriodUsed}/${s.aiPeriodLimit}`);
}

// 3. Rolling 30-day cap, and old usage rolling off
{
  const actor = `user:sql-month-${tag}`;
  await q.consumeQuota({ actorKey: actor, utcDate: day(45), aiHalfUnits: 400, db }); // outside the window
  for (let n = 1; n <= 6; n++) await q.consumeQuota({ actorKey: actor, utcDate: day(n), aiHalfUnits: 38, db }); // 114 used
  let ok = 0;
  for (let i = 0; i < 10; i++) if ((await reserve(actor, 'monthly')).ok) ok++;
  check('D1: Monthly/Prep stop at 120 per 30 days; older usage does not count', ok === 6, `${ok} granted (114 + 6 = 120)`);
}

// 4. Parallel requests cannot overshoot the period cap
{
  const actor = `user:sql-race-${tag}`;
  for (const n of [1, 2, 3]) await q.consumeQuota({ actorKey: actor, utcDate: day(n), aiHalfUnits: 38, db }); // 57
  const rs = await Promise.all(Array.from({ length: 12 }, () => reserve(actor, 'exam_pass')));
  check('D1: 12 parallel requests grant exactly the 3 remaining', rs.filter((r) => r.ok).length === 3, `${rs.filter((r) => r.ok).length} granted`);
}

// 5. Free plan unchanged
{
  const actor = `anon:sql-free-${tag}`;
  let ok = 0;
  for (let i = 0; i < 6; i++) if ((await q.reserveQuota({ actorKey: actor, networkFallbackKey: `ip:sql-${tag}`, plan: 'free', delta: { aiHalfUnits: 2 }, db })).ok) ok++;
  check('D1: free plan still 3 AI actions a day', ok === 3, `${ok} granted of 6`);
}

await proxy.dispose();
console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
