/**
 * B14-13: after the one Make Call click, the helper minimises the AirDroid window that click went to (Brad,
 * 2026-10-10: AirDroid stayed in front after the dial and he had to click back into IAOS). It minimises only that
 * window, only after the click was sent and AirDroid has processed it, and never closes it, ends the call, chooses
 * another window or retries. A refused dial minimises nothing.
 *
 * Inert and offline. It never touches the real AirDroid, a phone or a call. Rendered windows, all built here:
 *   - harness/airdroid-fake/FakeAirDroid.cs (with --taskbar): the fake Dialpad, an unowned main window like the real
 *     AirDroid's; it logs every number change, Make Call click, and MINIMIZED / RESTORED change. The helper finds it
 *     only through -TestProcessName.
 *   - harness/airdroid-fake/FakeWindow.cs: unrelated windows (a browser and an editor stand-in).
 * Windows are found by process id or by their unique test titles, never by "AirDroid", so a real AirDroid that may
 * be running is never looked at. Guard files are temporary.
 *
 * Windows desktop session only. It shares the machine-wide Local\IAOS-AirDroid-Dial lock with the other helper
 * suites, so never run two helper suites at once.
 */
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const REPO = path.resolve(APP, '..');
const TOOLS = path.join(REPO, 'tools', 'airdroid-prepare-call');
const HANDLER = path.join(TOOLS, 'IaosAirdroidHandler.ps1');
const FAKE = 'IaosFakeAirDroid';
const PAUSE_MS = 4000;

if (process.platform !== 'win32') {
  console.log('SKIP all minimise checks (not Windows; the helper is Windows-only)');
  process.exit(0);
}

const TMP = path.join(APP, '.tmp-airdroid-minimize-test');
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
const AIR_LOG = path.join(TMP, 'fake-airdroid.log');

let checks = 0;
let failures = 0;
function check(name, actual, expected) {
  checks += 1;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
}

const PS = ['-NoProfile', '-ExecutionPolicy', 'Bypass'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let guardN = 0;
const freshGuard = () => path.join(TMP, `guard-${++guardN}.json`);
const handlerArgs = (n, { guard = freshGuard(), pauseMs = 0 } = {}) => [`iaos-airdroid:call?number=${n}`, '-NoPause',
  '-TestProcessName', FAKE, '-GuardFile', guard, ...(pauseMs ? ['-TestPauseMs', String(pauseMs)] : [])];

/**
 * Window tool. "state <pid>" reports the visible top-level window of that process; "title <exact title>" reports the
 * window with that exact title; "fg" reports the foreground window. Report: "found|iconic|left,top,right,bottom|title",
 * or "none". Read-only.
 * (No variable here may be named $t or $w: PowerShell names are case-insensitive and would replace $T.)
 */
const WIN = path.join(TMP, 'win-tool.ps1');
fs.writeFileSync(WIN, [
  'param([string]$Action, [string]$Key = "")',
  "Add-Type -Namespace T -Name W -MemberDefinition @'",
  '[StructLayout(LayoutKind.Sequential)] public struct RC { public int L, Tp, R, B; }',
  '[DllImport("user32.dll")] public static extern IntPtr GetTopWindow(IntPtr h);',
  '[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();',
  '[DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint f);',
  '[DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint cmd);',
  '[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);',
  '[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);',
  '[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RC r);',
  '[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);',
  '[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n);',
  "'@",
  '$T = [T.W]',
  'function Text($h) { $s = New-Object System.Text.StringBuilder 1024; [void]$T::GetWindowText($h, $s, 1024); $s.ToString() }',
  '$hit = [IntPtr]::Zero',
  "if ($Action -eq 'fg') { $hit = $T::GetAncestor($T::GetForegroundWindow(), 3) }",
  "$h = if ($Action -eq 'fg') { [IntPtr]::Zero } else { $T::GetTopWindow([IntPtr]::Zero) }",
  'while ($h -ne [IntPtr]::Zero) {',
  '  if ($T::IsWindowVisible($h)) {',
  '    $procId = [uint32]0; [void]$T::GetWindowThreadProcessId($h, [ref]$procId)',
  "    if (($Action -eq 'state' -and \"$procId\" -eq $Key) -or ($Action -eq 'title' -and (Text $h) -eq $Key)) { $hit = $h; break }",
  '  }',
  '  $h = $T::GetWindow($h, 2)',
  '}',
  "if ($hit -eq [IntPtr]::Zero) { Write-Output 'none'; exit 0 }",
  '$r = New-Object T.W+RC; [void]$T::GetWindowRect($hit, [ref]$r)',
  'Write-Output ("found|{0}|{1},{2},{3},{4}|{5}" -f $T::IsIconic($hit), $r.L, $r.Tp, $r.R, $r.B, (Text $hit))',
].join('\n'));
const win = (action, key) => (spawnSync('powershell.exe', [...PS, '-File', WIN, action, String(key)], { encoding: 'utf8' }).stdout || '').trim();
const airState = () => win('state', air.pid);
const iconic = (report) => report.split('|')[1];

/** Lock probe: one long-lived process holding a handle to the mutex (as in the concurrency test). */
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

const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean) : [])
  .map((l) => { const m = l.match(/^(\S+) (\S+) ?(.*)$/); return { at: Date.parse(m[1]), kind: m[2], text: m[3] }; });
async function startWindow(exe, log, extra = []) {
  const child = spawn(exe, [log, ...extra], { stdio: 'ignore' });
  for (let i = 0; i < 100 && !read(log).some((l) => l.kind === 'READY'); i += 1) await sleep(100);
  return child;
}
function build(cs, exe) {
  const r = spawnSync('powershell.exe', [...PS, '-Command',
    `Add-Type -TypeDefinition (Get-Content -Raw '${path.join(__dirname, 'harness', 'airdroid-fake', cs)}') ` +
    `-ReferencedAssemblies System.Windows.Forms,System.Drawing -OutputAssembly '${exe}' -OutputType WindowsApplication`], { encoding: 'utf8' });
  if (r.status !== 0 || !fs.existsSync(exe)) { console.error(r.stderr); process.exit(10); }
}
function startLaunch(args, text) {
  const child = spawn('powershell.exe', [...PS, '-File', HANDLER, ...args]);
  let out = '';
  let seen;
  const atMarker = new Promise((resolve, reject) => { seen = resolve; setTimeout(() => reject(new Error(`timed out waiting for "${text}"`)), 60000); });
  child.stdout.on('data', (d) => { out += d; if (out.includes(text)) seen(); });
  child.stderr.on('data', (d) => { out += d; });
  const done = new Promise((resolve) => child.on('close', (code) => resolve({ code, out })));
  return { atMarker, done };
}
const launch = (n, opts) => {
  const r = spawnSync('powershell.exe', [...PS, '-File', HANDLER, ...handlerArgs(n, opts)], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout || '' };
};
const CONNECTED_CLAIM = (out) => /call (?:is |was )?(?:connected|placed|answered)/i.test(out.replace(/whether the call connected/g, ''));

let air = null;
(async () => {
  const procs = [];
  try {
    // ---- Static: DialCall's minimise step (the handler and the page are unchanged from f32a17e) ----
    {
      const lf = (text) => text.replace(/\r\n/g, '\n');
      const strip = (src) => lf(src).replace(/<#[\s\S]*?#>/g, '').split('\n').filter((l) => !/^\s*#/.test(l)).map((l) => l.replace(/\s#\s.*$/, '')).join('\n');
      const dial = strip(fs.readFileSync(path.join(TOOLS, 'DialCall.ps1'), 'utf8'));
      const up = dial.indexOf('PostMessage($target, 0x0202');
      const sent = dial.indexOf('CLICK SENT ONCE');
      const min = dial.indexOf('ShowWindowAsync($mainH, 6)');
      const step = dial.slice(sent, dial.indexOf('\ncatch {', sent));
      check('static: the minimise comes only after the single click is sent, on the success path',
        [up > -1 && sent > up && min > sent, (dial.match(/\$N::ShowWindowAsync\(/g) || []).length, (dial.match(/0x0201/g) || []).length], [true, 1, 1]);
      check('static: it waits for AirDroid to process the click first (bounded), then minimises',
        [/WaitForInputIdle\(3000\)/.test(step), step.indexOf('WaitForInputIdle(3000)') < step.indexOf('ShowWindowAsync')], [true, true]);
      check('static: only the AirDroid main window that holds the clicked Make Call panel is minimised (SW_MINIMIZE, nothing else)',
        [/\$mainH = \[IntPtr\]\$mains\[0\]\.Current\.NativeWindowHandle/.test(step), /if \(\$N::IsWindow\(\$mainH\) -and \$N::IsChild\(\$mainH, \$target\)\) \{ \[void\]\$N::ShowWindowAsync\(\$mainH, 6\) \}/.test(step)],
        [true, true]);
      check('static: the step closes nothing, ends nothing, chooses no other window, sends no keystrokes and does not retry',
        [/0x0010|0x0112|WM_CLOSE|CloseMainWindow|Stop-Process|taskkill|Kill\(|End Call|SetForegroundWindow|BringWindowToTop|SendKeys|keybd_event|SendInput|PostMessage|SendMessage/i.test(step),
          (step.match(/ShowWindowAsync/g) || []).length],
        [false, 1]);
      check('static: a minimise problem is only reported; the result stays 0 (the click was sent)',
        [/\} catch \{ Write-Host "AIRDROID NOT MINIMISED: [^\n]*\}\s*\n\s*exit 0/.test(step), /AIRDROID NOT MINIMISED: Windows did not minimise it/.test(step)], [true, true]);
      const handler = lf(fs.readFileSync(HANDLER, 'utf8'));
      const launcher = lf(fs.readFileSync(path.join(APP, 'src', 'lib', 'airdroid-launch.ts'), 'utf8'));
      check('static: no title marker, origin lookup or browser selection anywhere (the focus-return approach is not here)',
        [/\(IAOS call|originMarker|Find-Origin|Restore-Origin/.test(handler), /document\.title|\(IAOS call/.test(launcher), /launch=/.test(handler + launcher)],
        [false, false, false]);
    }

    // ---- Build the fakes ----
    const AIR_EXE = path.join(TMP, `${FAKE}.exe`);
    const WIN_EXE = path.join(TMP, 'IaosFakeWindow.exe');
    build('FakeAirDroid.cs', AIR_EXE);
    build('FakeWindow.cs', WIN_EXE);
    startProbe();
    check('lock is free before the tests (no IAOS call in progress)', await lockState(), 'FREE');
    air = await startWindow(AIR_EXE, AIR_LOG, ['--taskbar']);   // unowned, like the real AirDroid main window
    procs.push(air);
    const u1Title = 'Seller Call - Google Chrome (IAOS minimise test)';
    const u2Title = 'notes.txt - Notepad (IAOS minimise test)';
    const u1Log = path.join(TMP, 'u1.log');
    const u2Log = path.join(TMP, 'u2.log');
    procs.push(await startWindow(WIN_EXE, u1Log, [u1Title]));
    procs.push(await startWindow(WIN_EXE, u2Log, [u2Title]));
    await sleep(500);
    const before = { air: airState(), u1: win('title', u1Title), u2: win('title', u2Title) };
    check('setup: the fake Dialpad and two unrelated windows are open and not minimised',
      [iconic(before.air), iconic(before.u1), iconic(before.u2)], ['False', 'False', 'False']);
    const since = (from, kind) => read(AIR_LOG).slice(from).filter((l) => l.kind === kind);

    // ---- 1. A dial: one click, then exactly that AirDroid window minimises ----
    {
      const from = read(AIR_LOG).length;
      const r = launch('2025550201');
      await sleep(300);
      const clicks = since(from, 'CLICK');
      const mins = since(from, 'MINIMIZED');
      check('dial: exit 0, exactly one click on the number', [r.code, clicks.map((c) => c.text)], [0, ['2025550201']]);
      check('dial: the AirDroid window minimised once, AFTER the click', [mins.length, mins.length === 1 && clicks.length === 1 && mins[0].at > clicks[0].at], [1, true]);
      check('dial: that window is minimised now, not closed (the fake AirDroid is still running)', [iconic(airState()), air.exitCode], ['True', null]);
      check('dial: says AirDroid was minimised, and does not claim a connected call',
        [/CLICK SENT ONCE/.test(r.out), /AIRDROID MINIMISED/.test(r.out), /does not know whether the call connected/.test(r.out), CONNECTED_CLAIM(r.out)], [true, true, true, false]);
      check('dial: the unrelated windows are untouched (same place and size, not minimised, still open, same title)',
        [win('title', u1Title), win('title', u2Title)], [before.u1, before.u2]);
      console.log(`INFO after the minimise, Windows put this in front: ${win('fg', '') || '(not reported)'}`);
      check('dial: lock released cleanly', await lockState(), 'FREE');
    }

    // ---- 2. The next call: the prefill step restores AirDroid, then one click, then it minimises again ----
    const guard2 = freshGuard();
    {
      const from = read(AIR_LOG).length;
      const r = launch('2025550202', { guard: guard2 });
      await sleep(300);
      const log = read(AIR_LOG).slice(from);
      const order = log.filter((l) => ['RESTORED', 'TEXT', 'CLICK', 'MINIMIZED'].includes(l.kind)).map((l) => l.kind);
      check('next call: AirDroid restored, number placed, one click, minimised again (in that order)',
        [r.code, order[0], order.filter((k) => k === 'CLICK').length, order[order.length - 1], since(from, 'CLICK').map((c) => c.text)],
        [0, 'RESTORED', 1, 'MINIMIZED', ['2025550202']]);
      check('next call: the unrelated windows are still untouched', [win('title', u1Title), win('title', u2Title)], [before.u1, before.u2]);
    }

    // ---- 3. Refused dials minimise nothing ----
    {
      // The number in the Dialpad changes before the final check: DialCall stops (exit 9), no click.
      const from = read(AIR_LOG).length;
      const a = startLaunch(handlerArgs('2025550203', { pauseMs: PAUSE_MS }), 'TEST PAUSE before final number check');
      await a.atMarker;
      const rogue = path.join(TMP, 'rogue-set-text.ps1');
      fs.writeFileSync(rogue, [
        'Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes',
        "Add-Type -Namespace Rogue -Name N -MemberDefinition '[DllImport(\"user32.dll\", CharSet=CharSet.Unicode)] public static extern System.IntPtr SendMessage(System.IntPtr h, uint m, System.IntPtr w, string l);'",
        `$p = Get-Process -Id ${air.pid}`,
        '$A = [System.Windows.Automation.AutomationElement]',
        '$main = $A::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children, (New-Object System.Windows.Automation.PropertyCondition($A::ProcessIdProperty, $p.Id)))',
        "$e = @($main.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition) | Where-Object { $_.Current.ClassName -match '\\.EDIT\\.' })[0]",
        "[void][Rogue.N]::SendMessage([IntPtr]$e.Current.NativeWindowHandle, 0x000C, [IntPtr]::Zero, '2125550299')",
      ].join('\n'));
      spawnSync('powershell.exe', [...PS, '-File', rogue]);
      const d = await a.done;
      await sleep(500);
      check('refused dial (number changed before the click, exit 9): no click, AirDroid NOT minimised, no minimise message',
        [d.code, since(from, 'CLICK').length, since(from, 'MINIMIZED').length, iconic(airState()), /AIRDROID MINIMISED|AIRDROID NOT MINIMISED/.test(d.out)],
        [9, 0, 0, 'False', false]);

      // The same number again within 30 s (same guard record): duplicate refused before the Dialpad is touched.
      const from2 = read(AIR_LOG).length;
      const dup = launch('2025550202', { guard: guard2 });
      await sleep(300);
      check('refused duplicate (exit 10): nothing typed, no click, AirDroid NOT minimised',
        [dup.code, read(AIR_LOG).slice(from2).filter((l) => ['TEXT', 'CLICK', 'MINIMIZED'].includes(l.kind)).length, iconic(airState())],
        [10, 0, 'False']);

      // Another IAOS call holds the lock: refused before anything is touched. The holder releases the lock itself
      // when it reads a line (killing it would leave the lock abandoned).
      const holder = spawn('powershell.exe', [...PS, '-Command',
        "$m = New-Object System.Threading.Mutex($false, 'Local\\IAOS-AirDroid-Dial'); [void]$m.WaitOne(0); [Console]::Out.WriteLine('HELD'); [Console]::Out.Flush(); [void][Console]::In.ReadLine(); $m.ReleaseMutex(); [Console]::Out.WriteLine('RELEASED'); [Console]::Out.Flush()"]);
      let holderOut = '';
      holder.stdout.on('data', (dd) => { holderOut += dd; });
      const holderSaid = async (text) => { for (let i = 0; i < 200 && !holderOut.includes(text); i += 1) await sleep(50); return holderOut.includes(text); };
      await holderSaid('HELD');
      const from3 = read(AIR_LOG).length;
      const busy = launch('2025550204');
      check('refused while another call holds the lock (exit 10): nothing typed, no click, AirDroid NOT minimised',
        [busy.code, read(AIR_LOG).slice(from3).filter((l) => ['TEXT', 'CLICK', 'MINIMIZED'].includes(l.kind)).length, iconic(airState())],
        [10, 0, 'False']);
      holder.stdin.write('\n');
      check('lock holder released the lock itself', await holderSaid('RELEASED'), true);
      await sleep(300);
      check('refused dials: the unrelated windows are still untouched', [win('title', u1Title), win('title', u2Title)], [before.u1, before.u2]);
      check('refused dials: lock released cleanly', await lockState(), 'FREE');
    }

    check('across all launches: the fake Dialpad saw exactly one click per completed dial (2)', read(AIR_LOG).filter((l) => l.kind === 'CLICK').length, 2);
  } catch (error) {
    failures += 1;
    console.log(`FAIL harness error: ${error && error.stack ? error.stack : error}`);
  } finally {
    for (const c of procs) c.kill();
    if (probe) probe.child.stdin.end();
    for (const exe of [`${FAKE}.exe`, 'IaosFakeWindow.exe']) spawnSync('taskkill', ['/IM', exe, '/F'], { stdio: 'ignore' });
  }
  console.log('\nfake Dialpad log:\n' + (fs.existsSync(AIR_LOG) ? fs.readFileSync(AIR_LOG, 'utf8') : '(none)'));
  await sleep(300);
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\n${checks - failures}/${checks} checks passed`);
  process.exit(failures ? 1 : 0);
})();
