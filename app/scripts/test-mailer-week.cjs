/**
 * B15-12 (INV-110) -- Mailers "This Week" window.
 *
 * Walkthrough 2 (Wed 2026-10-07) showed "week of Sept 26–Oct 2"; Pass 1
 * (Wed 2026-09-30) showed Sept 19–25. The window was the Saturday–Friday
 * week ending the Friday on/BEFORE today, which is the current week only on
 * a Friday. It is now the Saturday–Friday week CONTAINING today, in
 * America/Chicago -- the existing convention, unchanged otherwise.
 *
 * Offline. Compiles netlify/functions/lib/mailer-shared.ts and runs:
 *   - computeWeekWindow across week rollover, the UTC/Chicago date boundary,
 *     both DST transitions, month and year ends;
 *   - proof that the Friday digest's window is unchanged (every scheduled
 *     13:00 UTC Friday of 2026-2027 gives the same window both ways);
 *   - the REAL buildMailerDigest with fetch stubbed in memory (no network),
 *     showing the This Week / Overdue buckets follow the corrected window and
 *     that every other rule (completion, address, business flag, undated
 *     tasks) is unchanged. Reads only: the stub records every request.
 *
 * NEGATIVE CONTROL: the previous rule is reproduced below (previousWindow)
 * and must show the reported dates; run against the previous module, this
 * suite fails.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const TMP = path.join(APP, '.tmp-mailer-week-test');
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'package.json'), '{"type":"commonjs"}');
try {
  execFileSync(process.execPath, [
    path.join(APP, 'node_modules', 'typescript', 'bin', 'tsc'),
    path.join(APP, 'netlify/functions/lib/mailer-shared.ts'),
    '--outDir', TMP, '--rootDir', APP, '--module', 'commonjs',
    '--target', 'es2020', '--strict', '--skipLibCheck', '--lib', 'es2020,dom',
  ], { cwd: APP, stdio: 'inherit' });
} catch (error) {
  console.error('ABORT: TypeScript compilation failed. Nothing tested.');
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(10);
}
process.env.IAOS_ENV = 'test';
const { computeWeekWindow, buildMailerDigest } = require(path.join(TMP, 'netlify/functions/lib/mailer-shared.js'));
fs.rmSync(TMP, { recursive: true, force: true });

/** Literal call-site count taken from the finished file, never back-filled from a passing run. */
const FLOOR = 25;
let checks = 0;
let failures = 0;
function check(name, actual, expected) {
  checks += 1;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ` expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`}`);
  if (!ok) failures += 1;
}

const win = (iso) => { const w = computeWeekWindow(new Date(iso)); return `${w.weekStartCT}..${w.weekEndCT}`; };
const ctDate = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const dow = (ymd) => new Date(`${ymd}T12:00:00Z`).getUTCDay();
const shift = (ymd, n) => { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
/** The previous rule, reproduced for the negative control and the digest-equality proof. */
function previousWindow(now) {
  const today = ctDate(now);
  const end = shift(today, -((dow(today) - 5 + 7) % 7));
  return `${shift(end, -6)}..${end}`;
}

// ============================================================
// The reported dates.
// ============================================================
check('Walkthrough 2, Wed 2026-10-07: the current week, Sat Oct 3 – Fri Oct 9', win('2026-10-07T17:00:00Z'), '2026-10-03..2026-10-09');
check('Pass 1, Wed 2026-09-30: Sat Sept 26 – Fri Oct 2', win('2026-09-30T17:00:00Z'), '2026-09-26..2026-10-02');
check('CONTROL: the previous rule gives exactly the reported stale windows',
  [previousWindow(new Date('2026-10-07T17:00:00Z')), previousWindow(new Date('2026-09-30T17:00:00Z'))], ['2026-09-26..2026-10-02', '2026-09-19..2026-09-25']);

// ============================================================
// Week rollover and the Chicago date boundary.
// ============================================================
{
  const days = ['03', '04', '05', '06', '07', '08', '09'].map((d) => win(`2026-10-${d}T17:00:00Z`));
  check('every day Sat Oct 3 … Fri Oct 9 is in the same week', [...new Set(days)], ['2026-10-03..2026-10-09']);
}
check('Fri Oct 9 23:59:59 CDT (04:59:59Z Sat) is still that week', win('2026-10-10T04:59:59Z'), '2026-10-03..2026-10-09');
check('Sat Oct 10 00:00 CDT (05:00Z) rolls to the next week', win('2026-10-10T05:00:00Z'), '2026-10-10..2026-10-16');
check('Saturday in UTC but Friday evening in Chicago stays in the Friday\'s week', win('2026-10-10T02:00:00Z'), '2026-10-03..2026-10-09');
check('CST: Fri Nov 13 23:59:59 CST (05:59:59Z) is the week of Nov 7–13', win('2026-11-14T05:59:59Z'), '2026-11-07..2026-11-13');
check('CST: Sat Nov 14 00:00 CST (06:00Z) rolls to Nov 14–20', win('2026-11-14T06:00:00Z'), '2026-11-14..2026-11-20');
check('DST ends Sun Nov 1 2026 (01:30 CST): week of Oct 31 – Nov 6', [win('2026-11-01T06:30:00Z'), win('2026-11-01T07:30:00Z')], ['2026-10-31..2026-11-06', '2026-10-31..2026-11-06']);
check('DST begins Sun Mar 8 2026 (03:30 CDT): week of Mar 7–13', win('2026-03-08T08:30:00Z'), '2026-03-07..2026-03-13');
check('month end: Sat Oct 31 starts its own week', win('2026-10-31T17:00:00Z'), '2026-10-31..2026-11-06');
check('year end: Thu Dec 31 2026 is in the week ending Fri Jan 1 2027', win('2026-12-31T18:00:00Z'), '2026-12-26..2027-01-01');
{
  // Every hour of 2026: the window is 7 days, Saturday to Friday, and contains today (Chicago).
  const bad = [];
  for (let t = Date.UTC(2026, 0, 1); t < Date.UTC(2027, 0, 1); t += 3600_000) {
    const now = new Date(t);
    const { weekStartCT: s, weekEndCT: e } = computeWeekWindow(now);
    const today = ctDate(now);
    if (dow(s) !== 6 || dow(e) !== 5 || shift(s, 6) !== e || today < s || today > e) bad.push(now.toISOString());
  }
  check('every hour of 2026: a Saturday–Friday week that contains today in Chicago', bad.slice(0, 3), []);
}

// ============================================================
// The Friday digest is unchanged.
// ============================================================
{
  const diffs = [];
  let fridays = 0;
  for (let t = Date.UTC(2026, 0, 2, 13); t < Date.UTC(2028, 0, 1); t += 7 * 86_400_000) {
    const now = new Date(t);   // 13:00 UTC every Friday (netlify.toml: schedule = "0 13 * * 5")
    fridays += 1;
    if (dow(ctDate(now)) !== 5) diffs.push(`${now.toISOString()} is not Friday in Chicago`);
    if (win(now.toISOString()) !== previousWindow(now)) diffs.push(now.toISOString());
  }
  check('every scheduled digest run (13:00 UTC Fridays, 2026–2027) is a Friday in Chicago with the same window as before', [fridays > 100, diffs], [true, []]);
}
check('the digest schedule is still 13:00 UTC Fridays', /\[functions\."mailer-digest"\]\s*\n\s*schedule = "0 13 \* \* 5"/.test(fs.readFileSync(path.join(APP, 'netlify.toml'), 'utf8').replace(/\r\n/g, '\n')), true);

// ============================================================
// Buckets follow the corrected window (the real buildMailerDigest, fetch stubbed).
// ============================================================
async function digestAt(nowIso) {
  const contacts = [
    { id: 'c1', firstName: 'Ann', lastName: 'Home', address1: '1 Main St', city: 'Austin', state: 'TX', postalCode: '78701' },
    { id: 'c2', contactName: 'Woodleigh Holdings LLC', address1: '2 Oak St', city: 'Austin', state: 'TX', postalCode: '78702' },
    { id: 'c3', firstName: 'Cal', lastName: 'Noaddr', address1: '', city: '', state: '', postalCode: '' },
  ];
  const task = (id, title, dueDate, completed = false) => ({ id, title, dueDate, completed });
  const tasks = {
    c1: [
      task('due-mon-oct5', 'Hot mail — Touch 1 (PRIMARY)', '2026-10-05T15:00:00.000Z'),
      task('due-fri-oct9-late', 'Hot mail — Touch 2 (POSTCARD)', '2026-10-10T04:30:00.000Z'),   // Fri 23:30 CDT
      task('due-fri-oct2-late', 'Warm mail — Touch 1 (PRIMARY)', '2026-10-03T04:30:00.000Z'),   // Fri Oct 2 23:30 CDT
      task('due-sat-oct10', 'Low mail — Touch 1 (POSTCARD)', '2026-10-10T15:00:00.000Z'),
      task('done-oct6', 'Hot mail — Touch 3 (PRIMARY)', '2026-10-06T15:00:00.000Z', true),
      task('undated', 'Warm mail — Touch 2 (POSTCARD)', ''),
      task('not-a-mailer', 'Call back about roof', '2026-10-06T15:00:00.000Z'),
    ],
    c2: [task('business-oct8', 'Warm mail — Touch 1 (PRIMARY)', '2026-10-08T15:00:00.000Z')],
    c3: [task('noaddr-oct7', 'Low mail — Touch 1 (PRIMARY)', '2026-10-07T15:00:00.000Z')],
  };
  const requests = [];
  const realFetch = global.fetch;
  global.fetch = async (url, init) => {
    const u = new URL(String(url));
    requests.push(`${(init && init.method) || 'GET'} ${u.pathname}`);
    const body = u.pathname === '/contacts' ? { contacts, meta: {} } : { tasks: tasks[u.pathname.split('/')[2]] || [] };
    return { ok: true, status: 200, json: async () => body };
  };
  try {
    const d = await buildMailerDigest('fixture-token', new Date(nowIso));
    const ids = (groups) => groups.flatMap((g) => g.rows.map((r) => r.taskId)).sort();
    return { window: `${d.weekStartCT}..${d.weekEndCT}`, ready: ids(d.thisWeekReady), business: ids(d.thisWeekBusiness), overdue: ids(d.overdue), noAddress: d.noAddress.map((r) => r.taskId).sort(), totals: d.totals, requests };
  } finally {
    global.fetch = realFetch;
  }
}

(async () => {
  const d = await digestAt('2026-10-07T17:00:00Z');
  check('Wed Oct 7: the digest window is the current week', d.window, '2026-10-03..2026-10-09');
  check('This Week — Ready holds the tasks due Mon Oct 5 and Fri Oct 9 (23:30 CDT)', d.ready, ['due-fri-oct9-late', 'due-mon-oct5']);
  check('Overdue holds last week\'s Fri Oct 2 (23:30 CDT) task, and the undated task as before', d.overdue, ['due-fri-oct2-late', 'undated']);
  check('a task due next Saturday is in neither bucket', [...d.ready, ...d.business, ...d.overdue].includes('due-sat-oct10'), false);
  check('business-flag, completion, no-address and non-mailer rules are unchanged',
    [d.business, d.noAddress, [...d.ready, ...d.overdue].includes('done-oct6'), [...d.ready, ...d.overdue].includes('not-a-mailer')],
    [['business-oct8'], ['noaddr-oct7'], false, false]);
  check('totals agree with the buckets', [d.totals.ready, d.totals.business, d.totals.overdue, d.totals.noAddress], [2, 1, 2, 1]);
  const fri = await digestAt('2026-10-09T13:00:00Z');
  check('the Friday digest run (Fri Oct 9, 13:00 UTC) buckets the same week', [fri.window, fri.ready, fri.overdue], ['2026-10-03..2026-10-09', ['due-fri-oct9-late', 'due-mon-oct5'], ['due-fri-oct2-late', 'undated']]);
  const sat = await digestAt('2026-10-10T05:00:00Z');
  check('Sat Oct 10 00:00 CDT: the week rolls over; the Oct 10 task is This Week and the previous week\'s tasks (incl. business-flagged) are overdue',
    [sat.window, sat.ready, sat.overdue], ['2026-10-10..2026-10-16', ['due-sat-oct10'], ['business-oct8', 'due-fri-oct2-late', 'due-fri-oct9-late', 'due-mon-oct5', 'undated']]);
  check('reads only: every request is a GET of contacts or a contact\'s tasks', [...new Set([...d.requests, ...fri.requests, ...sat.requests])].every((r) => /^GET \/contacts(\/c\d\/tasks)?$/.test(r)), true);

  console.log('');
  console.log('checksRun=' + checks + ' failures=' + failures + ' floor=' + FLOOR);
  if (checks !== FLOOR) {
    console.error('FAILED: expected exactly ' + FLOOR + ' checks, ran ' + checks + '. A case was added or removed without updating FLOOR.');
    process.exit(2);
  }
  if (failures > 0) { console.error('FAILED'); process.exit(1); }
  console.log('OK');
})().catch((e) => { console.error(e); process.exit(1); });
