/**
 * B14-13: the IAOS call lock covers the whole prepare-and-dial sequence (Bones review, blocking finding 1), and the
 * automatic path shows no "press Make Call yourself" instruction (finding 2).
 *
 * Inert and offline. It never touches AirDroid, a phone or a call: it builds a fake AirDroid Dialpad
 * (scripts/harness/airdroid-fake/FakeAirDroid.cs -> IaosFakeAirDroid.exe) and runs the real handler, PrepareCall.ps1
 * and DialCall.ps1 against it with -TestProcessName IaosFakeAirDroid. The fake logs every change of its number field
 * and every Make Call click, with the field's text at that moment. Guard files are temporary. The registered
 * command passes none of the test parameters.
 *
 * Controlled pauses (-TestPauseMs, honoured only with -TestProcessName) hold the dialling launch just before its
 * final number check and again just before dispatch. During each pause a competing launch is attempted, and the
 * test checks that the Dialpad was not changed between the first launch's prefill and its click.
 *
 * Windows only; elsewhere every check is skipped and reported.
 */
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const REPO = path.resolve(APP, '..');
const TOOLS = path.join(REPO, 'tools', 'airdroid-prepare-call');
const HANDLER = path.join(TOOLS, 'IaosAirdroidHandler.ps1');
const PREPARE = path.join(TOOLS, 'PrepareCall.ps1');
const DIAL = path.join(TOOLS, 'DialCall.ps1');
const FAKE = 'IaosFakeAirDroid';
const PAUSE_MS = 5000;

if (process.platform !== 'win32') {
  console.log('SKIP all concurrency checks (not Windows; the helper is Windows-only)');
  process.exit(0);
}

const TMP = path.join(APP, '.tmp-airdroid-dial-concurrency-test');
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
const LOG = path.join(TMP, 'fake.log');
const EXE = path.join(TMP, `${FAKE}.exe`);

let checks = 0;
let failures = 0;
function check(name, actual, expected) {
  checks += 1;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
}

const PS = ['-NoProfile', '-ExecutionPolicy', 'Bypass'];
const ps = (file, args) => spawnSync('powershell.exe', [...PS, '-File', file, ...args], { encoding: 'utf8' });
const link = (n) => `iaos-airdroid:call?number=${n}`;
let guardN = 0;
const freshGuard = () => path.join(TMP, `guard-${++guardN}.json`);
const handlerArgs = (n, guard, pauseMs = 0) => [link(n), '-NoPause', '-TestProcessName', FAKE, '-GuardFile', guard, ...(pauseMs ? ['-TestPauseMs', String(pauseMs)] : [])];

/**
 * Lock probe: FREE (released cleanly), BUSY (held by a live process) or ABANDONED (a process exited holding it).
 * The probe is one long-lived process that keeps a handle to the mutex open for the whole run. Without an open
 * handle Windows deletes a named mutex when its last holder exits, so an abandoned lock would look FREE.
 */
let probe;
function startProbe() {
  const script = path.join(TMP, 'lock-probe.ps1');
  fs.writeFileSync(script, [
    "$m = New-Object System.Threading.Mutex($false, 'Local\\IAOS-AirDroid-Dial')",
    'while ($null -ne ($line = [Console]::In.ReadLine())) {',
    "  try { if ($m.WaitOne(0)) { $m.ReleaseMutex(); [Console]::Out.WriteLine('FREE') } else { [Console]::Out.WriteLine('BUSY') } }",
    "  catch [System.Threading.AbandonedMutexException] { $m.ReleaseMutex(); [Console]::Out.WriteLine('ABANDONED') }",
    '  [Console]::Out.Flush()',
    '}',
  ].join('\n'));
  probe = { child: spawn('powershell.exe', [...PS, '-File', script]), buffer: '', waiting: [] };
  probe.child.stdout.on('data', (d) => {
    probe.buffer += d;
    let i;
    while ((i = probe.buffer.indexOf('\n')) > -1) {
      const answer = probe.buffer.slice(0, i).trim();
      probe.buffer = probe.buffer.slice(i + 1);
      if (answer && probe.waiting.length) probe.waiting.shift()(answer);
    }
  });
}
const lockState = () => new Promise((resolve) => { probe.waiting.push(resolve); probe.child.stdin.write('?\n'); });

/** The fake's log lines since `from`: [{ kind: 'TEXT'|'CLICK'|'READY', text }]. */
const logLines = () => fs.readFileSync(LOG, 'utf8').split(/\r?\n/).filter(Boolean)
  .map((l) => { const m = l.match(/^\S+ (READY|TEXT|CLICK) ?(.*)$/); return m ? { kind: m[1], text: m[2] } : { kind: 'BAD', text: l }; });
const since = (n) => logLines().slice(n);

/** Starts a launch and resolves when `marker` appears in its output; `done` resolves with { code, out }. */
function startLaunch(file, args, marker) {
  const child = spawn('powershell.exe', [...PS, '-File', file, ...args]);
  let out = '';
  let seen;
  const atMarker = new Promise((resolve, reject) => {
    seen = resolve;
    setTimeout(() => reject(new Error(`timed out waiting for "${marker}"`)), 60000);
  });
  child.stdout.on('data', (d) => { out += d; if (marker && out.includes(marker)) seen(); });
  child.stderr.on('data', (d) => { out += d; });
  const done = new Promise((resolve) => child.on('close', (code) => resolve({ code, out })));
  return { atMarker, done };
}

/** A writer outside IAOS that ignores the lock (stands in for anything else typing into AirDroid). */
function rogueSetText(text) {
  const script = path.join(TMP, 'rogue-set-text.ps1');
  fs.writeFileSync(script, [
    "$ErrorActionPreference = 'Stop'",
    'Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes',
    "Add-Type -Namespace Rogue -Name N -MemberDefinition '[DllImport(\"user32.dll\", CharSet=CharSet.Unicode)] public static extern System.IntPtr SendMessage(System.IntPtr h, uint m, System.IntPtr w, string l);'",
    `$p = Get-Process -Name ${FAKE}`,
    '$A = [System.Windows.Automation.AutomationElement]',
    '$w = $A::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children, (New-Object System.Windows.Automation.PropertyCondition($A::ProcessIdProperty, $p.Id)))',
    "$e = @($w.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition) | Where-Object { $_.Current.ClassName -match '\\.EDIT\\.' })[0]",
    `[void][Rogue.N]::SendMessage([IntPtr]$e.Current.NativeWindowHandle, 0x000C, [IntPtr]::Zero, '${text}')`,
  ].join('\n'));
  const r = spawnSync('powershell.exe', [...PS, '-File', script], { encoding: 'utf8' });
  if (r.status !== 0) console.log(`rogue writer output: ${r.stdout}${r.stderr}`);
  return r.status;
}

/** Scenario: launch A pauses at `marker`; `compete` runs during that pause. Returns A's result and the log since A. */
async function contended(numberA, marker, compete) {
  const from = logLines().length;
  const a = startLaunch(HANDLER, handlerArgs(numberA, freshGuard(), PAUSE_MS), `TEST PAUSE ${marker}`);
  await a.atMarker;
  const competitor = compete();
  const lockDuringPause = await lockState();
  const resultA = await a.done;
  return { resultA, competitor, lockDuringPause, lines: since(from) };
}
const texts = (lines) => lines.filter((l) => l.kind === 'TEXT').map((l) => l.text);
const clicks = (lines) => lines.filter((l) => l.kind === 'CLICK').map((l) => l.text);

(async () => {
  let fake;
  try {
    // ---- Build and start the fake Dialpad ----
    const build = spawnSync('powershell.exe', [...PS, '-Command',
      `Add-Type -TypeDefinition (Get-Content -Raw '${path.join(__dirname, 'harness', 'airdroid-fake', 'FakeAirDroid.cs')}') ` +
      `-ReferencedAssemblies System.Windows.Forms,System.Drawing -OutputAssembly '${EXE}' -OutputType WindowsApplication`], { encoding: 'utf8' });
    if (build.status !== 0 || !fs.existsSync(EXE)) { console.error(build.stderr); process.exit(10); }
    startProbe();
    check('lock is free before the tests (no IAOS call in progress)', await lockState(), 'FREE');
    fake = spawn(EXE, [LOG], { stdio: 'ignore' });
    for (let i = 0; i < 100 && !(fs.existsSync(LOG) && logLines().some((l) => l.kind === 'READY')); i += 1) await new Promise((r) => setTimeout(r, 100));
    check('fake Dialpad started', logLines().some((l) => l.kind === 'READY'), true);

    // ---- Baseline: one automatic launch prefills, then clicks once; no manual instruction ----
    {
      const from = logLines().length;
      const r = ps(HANDLER, handlerArgs('2025550147', freshGuard()));
      const lines = since(from);
      check('automatic launch: exit 0, prefill then exactly one click on the prepared number',
        [r.status, texts(lines), clicks(lines)], [0, ['2025550147'], ['2025550147']]);
      check('automatic launch: no "press Make Call yourself" instruction; reports one click sent',
        [/Make Call yourself/i.test(r.stdout), /CLICK SENT ONCE/.test(r.stdout)], [false, true]);
      check('automatic launch: lock released cleanly (not abandoned)', await lockState(), 'FREE');
    }

    // ---- Standalone prefill keeps its guidance ----
    {
      const from = logLines().length;
      const r = ps(PREPARE, ['-Number', '2025550148', '-TestProcessName', FAKE]);
      check('standalone prefill: exit 0, number placed, no click, and it still says "press Make Call yourself"',
        [r.status, texts(since(from)), clicks(since(from)), /Check the number on screen, then press Make Call yourself\./.test(r.stdout)],
        [0, ['2025550148'], [], true]);
      check('standalone prefill: lock released cleanly', await lockState(), 'FREE');
    }

    // ---- Competing launches during the pause before the final number check ----
    for (const [label, file, args] of [
      ['second automatic launch (different number)', HANDLER, handlerArgs('2145550101', freshGuard())],
      ['standalone prefill', PREPARE, ['-Number', '2145550102', '-TestProcessName', FAKE]],
      ['standalone dial', DIAL, ['-Number', '2145550103', '-TestProcessName', FAKE, '-GuardFile', freshGuard()]],
    ]) {
      const s = await contended('2025550160', 'before final number check', () => ps(file, args));
      check(`pause before final number check: lock held by the dialling launch`, s.lockDuringPause, 'BUSY');
      check(`pause before final number check: competing ${label} stops with exit 10 and says a call is in progress`,
        [s.competitor.status, /in progress/i.test(s.competitor.stdout)], [10, true]);
      check(`pause before final number check, competing ${label}: Dialpad changed only by the dialling launch's prefill; one click on its number`,
        [s.resultA.code, texts(s.lines), clicks(s.lines)], [0, ['2025550160'], ['2025550160']]);
      check(`after competing ${label}: lock released cleanly`, await lockState(), 'FREE');
    }

    // ---- Competing launches during the pause between the final number check and dispatch ----
    for (const [label, file, args] of [
      ['second automatic launch (different number)', HANDLER, handlerArgs('2145550104', freshGuard())],
      ['standalone prefill', PREPARE, ['-Number', '2145550105', '-TestProcessName', FAKE]],
    ]) {
      const s = await contended('2025550161', 'before dispatch', () => ps(file, args));
      check(`pause before dispatch: competing ${label} stops with exit 10`, s.competitor.status, 10);
      check(`pause before dispatch, competing ${label}: no Dialpad change after the final check; one click on the checked number`,
        [s.resultA.code, texts(s.lines), clicks(s.lines)], [0, ['2025550161'], ['2025550161']]);
      check(`after competing ${label} (dispatch pause): lock released cleanly`, await lockState(), 'FREE');
    }

    // ---- The final number check still catches a writer that ignores the lock: nothing clicked ----
    {
      const s = await contended('2025550162', 'before final number check', () => rogueSetText('2125550199'));
      check('writer outside IAOS changes the number during the pause: final check stops the dial (exit 9), no click',
        [s.competitor, s.resultA.code, texts(s.lines), clicks(s.lines)], [0, 9, ['2025550162', '2125550199'], []]);
      check('after the stopped dial (exit 9): lock released cleanly', await lockState(), 'FREE');
    }

    // ---- Duplicate: the same number again within 30 s is refused before the Dialpad is touched ----
    {
      const guard = freshGuard();
      ps(HANDLER, handlerArgs('2025550163', guard));
      const from = logLines().length;
      const r = ps(HANDLER, handlerArgs('2025550163', guard));
      check('duplicate launch within 30 s: exit 10, Dialpad untouched, no click', [r.status, texts(since(from)), clicks(since(from))], [10, [], []]);
      check('after the duplicate refusal: lock released cleanly', await lockState(), 'FREE');
    }

    // ---- Children refuse to act when told the caller holds the lock but nobody does ----
    {
      const from = logLines().length;
      const p = ps(PREPARE, ['-Number', '2025550164', '-CallerHoldsLock', '-Automatic', '-TestProcessName', FAKE]);
      const d = ps(DIAL, ['-Number', '2025550164', '-CallerHoldsLock', '-TestProcessName', FAKE, '-GuardFile', freshGuard()]);
      check('-CallerHoldsLock without the lock held: prefill and dial both stop (exit 10), nothing changed or clicked',
        [p.status, d.status, texts(since(from)), clicks(since(from))], [10, 10, [], []]);
      check('after the -CallerHoldsLock refusals: lock free', await lockState(), 'FREE');
    }

    // ---- Failure path: no AirDroid window -> stops, lock released cleanly ----
    {
      const r = ps(HANDLER, [link('2025550165'), '-NoPause', '-TestProcessName', 'IaosNoSuchProcess', '-GuardFile', freshGuard()]);
      check('no AirDroid window: handler stops with PrepareCall\'s exit 3', r.status, 3);
      check('after the exit-3 stop: lock released cleanly', await lockState(), 'FREE');
    }

    // ---- The test pauses are inert without -TestProcessName ----
    {
      const dialSrc = fs.readFileSync(DIAL, 'utf8');
      check('pause seam only acts with -TestProcessName and -TestPauseMs',
        /function Wait-TestPause\([^)]*\) \{\s*if \(\$TestProcessName -and \$TestPauseMs -gt 0\)/.test(dialSrc), true);
    }
  } catch (error) {
    failures += 1;
    console.log(`FAIL harness error: ${error && error.stack ? error.stack : error}`);
  } finally {
    if (fake) fake.kill();
    if (probe) probe.child.stdin.end();
    spawnSync('taskkill', ['/IM', `${FAKE}.exe`, '/F'], { stdio: 'ignore' });
  }
  console.log('\nfake Dialpad log:\n' + (fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8') : '(none)'));
  await new Promise((r) => setTimeout(r, 300));
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\n${checks - failures}/${checks} checks passed`);
  process.exit(failures ? 1 : 0);
})();
