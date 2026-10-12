/**
 * B14-13 visible Dialpad (Brad, 2026-10-12): AirDroid is opened once with its Dialpad and kept VISIBLE beside IAOS
 * (it may be a small corner window). IAOS Call enters the number, verifies it, brings that one identified Dialpad
 * window in front once (2026-10-12: on the VivoBook a click sent while AirDroid was behind IAOS placed no call),
 * clicks Make Call once, and leaves AirDroid where it is. Nothing is started, restored, moved, resized or
 * minimised. If exactly
 * one visible Dialpad cannot be identified it stops with a plain instruction and never guesses between windows.
 *
 * The fake reproduces the VivoBook diagnostic's layout (one AirDroid process; the main window holds two "frmAirCloud"
 * pages, one hidden, and the Dialpad; a second unowned "AirDroid" form with five text fields and no Dialpad).
 *
 * Inert and offline: fake windows only (harness/airdroid-fake/FakeAirDroid.cs), found only through -TestProcessName.
 * Never touches the real AirDroid, a phone or a call. Windows desktop session only; it shares the machine-wide
 * Local\IAOS-AirDroid-Dial lock with the other helper suites, so never run two helper suites at once.
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

if (process.platform !== 'win32') {
  console.log('SKIP all visible-Dialpad checks (not Windows; the helper is Windows-only)');
  process.exit(0);
}

const TMP = path.join(APP, '.tmp-airdroid-visible-test');
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let n = 0;
const fresh = (stem) => path.join(TMP, `${stem}-${++n}`);
const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean) : [])
  .map((l) => { const m = l.match(/^(\S+) (\S+) ?(.*)$/); return { at: Date.parse(m[1]), kind: m[2], text: m[3] }; });
const kinds = (log, from = 0) => read(log).slice(from).map((l) => l.kind);
const fakeCount = () => (spawnSync('tasklist', ['/FI', `IMAGENAME eq ${FAKE}.exe`, '/NH'], { encoding: 'utf8' }).stdout || '')
  .split(/\r?\n/).filter((l) => l.startsWith(FAKE)).length;
const killFakes = async () => { spawnSync('taskkill', ['/IM', `${FAKE}.exe`, '/F'], { stdio: 'ignore' }); for (let i = 0; i < 50 && fakeCount(); i += 1) await sleep(100); };
const launch = (number, guard = fresh('guard') + '.json') => {
  const r = spawnSync('powershell.exe', [...PS, '-File', HANDLER, `iaos-airdroid:call?number=${number}`, '-NoPause', '-TestProcessName', FAKE, '-GuardFile', guard], { encoding: 'utf8', timeout: 120000 });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), guard };
};
const checkDialpad = () => { const r = spawnSync('powershell.exe', [...PS, '-File', DIAL, '-CheckOnly', '-TestProcessName', FAKE], { encoding: 'utf8' }); return { code: r.status, out: r.stdout || '' }; };
async function startFake(flags) {
  await killFakes();
  const log = fresh('air') + '.log';
  const child = spawn(EXE, [log, '--taskbar', ...flags], { stdio: 'ignore' });
  for (let i = 0; i < 100 && !(read(log).some((l) => l.kind === 'READY') && (!flags.some((f) => f.startsWith('--second')) || read(log).some((l) => l.kind === 'SECOND-READY'))); i += 1) await sleep(100);
  await sleep(300);
  return { child, log };
}
/** Window state of the fake's main "AirDroid" window, read-only: "visible|minimised|w x h". */
const STATE = path.join(TMP, 'state.ps1');
fs.writeFileSync(STATE, [
  "Add-Type -Namespace S -Name W -MemberDefinition @'",
  '[StructLayout(LayoutKind.Sequential)] public struct RC { public int L, T, R, B; }',
  'public delegate bool P(IntPtr h, IntPtr l);',
  '[DllImport("user32.dll")] public static extern bool EnumWindows(P f, IntPtr l);',
  '[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);',
  '[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);',
  '[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);',
  '[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RC r);',
  '[DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint c);',
  '[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n);',
  "'@",
  `$ids = @(Get-Process -Name ${FAKE} -ErrorAction SilentlyContinue | ForEach-Object { [uint32]$_.Id })`,
  '$out = New-Object System.Collections.ArrayList',
  '[S.W]::EnumWindows({ param($h, $l) $p = [uint32]0; [void][S.W]::GetWindowThreadProcessId($h, [ref]$p); $sb = New-Object System.Text.StringBuilder 64; [void][S.W]::GetWindowText($h, $sb, 64)',
  '  if ($ids -contains $p -and $sb.ToString() -eq "AirDroid" -and [S.W]::GetWindow($h, 4) -eq [IntPtr]::Zero -and [S.W]::IsWindowVisible($h)) { $r = New-Object S.W+RC; [void][S.W]::GetWindowRect($h, [ref]$r); [void]$out.Add(("{0}|{1}|{2}x{3}" -f [S.W]::IsWindowVisible($h), [S.W]::IsIconic($h), ($r.R - $r.L), ($r.B - $r.T))) }; $true }, [IntPtr]::Zero) | Out-Null',
  '$out -join ";"',
].join('\n'));
const visibleWindows = () => (spawnSync('powershell.exe', [...PS, '-File', STATE], { encoding: 'utf8' }).stdout || '').trim();

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
const OPEN = /Open AirDroid > My devices > your phone > Dialpad, and keep that AirDroid window visible beside IAOS/;
const CHANGES = ['TEXT', 'CLICK', 'CLICK-IGNORED', 'MINIMIZED', 'RESTORED', 'HIDDEN', 'OTHER-SHOWN'];
const CONNECTED = (out) => /call (?:is |was )?(?:connected|placed|answered)/i.test(out.replace(/whether the call connected|is not a connected call|whether AirDroid dialled or the call connected/g, ''));

(async () => {
  try {
    // ---- Static: the active calling path starts, restores, moves and minimises nothing ----
    {
      const lf = (t) => t.replace(/\r\n/g, '\n');
      const strip = (src) => lf(src).replace(/<#[\s\S]*?#>/g, '').split('\n').filter((l) => !/^\s*#/.test(l)).map((l) => l.replace(/\s#\s.*$/, '')).join('\n');
      const all = ['IaosAirdroidHandler.ps1', 'PrepareCall.ps1', 'DialCall.ps1'].map((f) => strip(fs.readFileSync(path.join(TOOLS, f), 'utf8'))).join('\n');
      check('static: no auto-start, restore, move, resize or minimise anywhere in the calling path',
        /StartIfNotRunning|Start-Process|ShowWindow|SetWindowPos|MoveWindow|SW_MINIMIZE|SW_RESTORE/.test(all), false);
      const prepHandler = ['IaosAirdroidHandler.ps1', 'PrepareCall.ps1'].map((f) => strip(fs.readFileSync(path.join(TOOLS, f), 'utf8'))).join('\n');
      const dialSrc = strip(fs.readFileSync(DIAL, 'utf8'));
      const front = dialSrc.slice(dialSrc.indexOf('$mainH = [IntPtr]$mainEl.Current.NativeWindowHandle'), dialSrc.indexOf("Wait-TestPause 'before dispatch'"));
      check('static: the bring-forward is in DialCall only: one BringWindowToTop and one SetForegroundWindow, on the identified Dialpad window, before the dial is recorded and clicked',
        [/SetForegroundWindow|BringWindowToTop|AttachThreadInput/.test(prepHandler), (dialSrc.match(/\$N::SetForegroundWindow\(/g) || []).length, (dialSrc.match(/\$N::BringWindowToTop\(/g) || []).length,
          /\[void\]\$N::BringWindowToTop\(\$mainH\); \[void\]\$N::SetForegroundWindow\(\$mainH\)/.test(front), dialSrc.indexOf('SetForegroundWindow($mainH)') < dialSrc.indexOf('Set-Content -LiteralPath $GuardFile')],
        [false, 1, 1, true, true]);
      check('static: not in front -> exit 11 before anything is recorded or clicked; the number is read again after it is in front',
        [/if \(-not \$inFront\) \{ Stop-With 11/.test(front), /if \(\$N::GetText\(\$field\) -cne \$Number\) \{ Stop-With 9/.test(front.slice(front.indexOf('if (-not $inFront)')))], [true, true]);
      const handler = strip(fs.readFileSync(HANDLER, 'utf8'));
      check('static: the handler runs the duplicate check, then PrepareCall -Automatic, then DialCall, under the lock',
        [/Invoke-Step 'PrepareCall\.ps1' \(@\('-Automatic'\) \+ \$extra\)/.test(handler), handler.indexOf("(@('-GuardOnly')") < handler.indexOf("Invoke-Step 'PrepareCall.ps1'")], [true, true]);
      for (const f of ['PrepareCall.ps1', 'DialCall.ps1']) {
        const src = strip(fs.readFileSync(path.join(TOOLS, f), 'utf8'));
        check(`static (${f}): exactly one visible, not-minimised AirDroid window showing the Dialpad; none or several stop; never the first`,
          [/if \(-not \$N::IsWindowVisible\((\$wh|\$mh)\)\) \{ continue \}/.test(src), /if \(\$N::IsIconic\((\$wh|\$mh)\)\) \{ \$minimised\+\+; continue \}/.test(src),
            /if \(\$withDialpad\.Count -gt 1\) \{ Stop-With 3/.test(src), /\$mains\[0\]/.test(src)], [true, true, true, false]);
      }
    }

    // ---- Build the fake ----
    const build = spawnSync('powershell.exe', [...PS, '-Command',
      `Add-Type -TypeDefinition (Get-Content -Raw '${path.join(__dirname, 'harness', 'airdroid-fake', 'FakeAirDroid.cs')}') ` +
      `-ReferencedAssemblies System.Windows.Forms,System.Drawing -OutputAssembly '${EXE}' -OutputType WindowsApplication`], { encoding: 'utf8' });
    if (build.status !== 0 || !fs.existsSync(EXE)) { console.error(build.stderr); process.exit(10); }
    startProbe();
    check('setup: lock free, no fake AirDroid running', [await lockState(), fakeCount()], ['FREE', 0]);

    // ---- 1. The VivoBook layout, Dialpad visible: three consecutive calls; AirDroid left visible every time ----
    {
      const { log } = await startFake(['--hidden-page', '--second-form']);
      const before = visibleWindows();
      check('VivoBook layout: exactly one visible AirDroid window (the Dialpad window), not minimised', before.split(';').length === 1 && before.startsWith('True|False'), true);
      const c = checkDialpad();
      check('check the Dialpad (no number): exit 0; one visible Dialpad window, field and Make Call identified; nothing typed or clicked',
        [c.code, /DIALPAD CHECK PASSED: one visible AirDroid Dialpad window/.test(c.out), /Make Call identified, visible and enabled/.test(c.out), kinds(log).filter((k) => CHANGES.includes(k))], [0, true, true, []]);
      for (const num of ['2025550401', '2025550402', '2025550403']) {
        const from = read(log).length;
        const r = launch(num);
        await sleep(400);
        const ev = read(log).slice(from);
        check(`call ${num}: exit 0; the number entered once, verified, ONE click on it; nothing minimised, restored, hidden or shown`,
          [r.code, ev.filter((l) => l.kind === 'TEXT').map((l) => l.text), ev.filter((l) => l.kind === 'CLICK').map((l) => l.text), ev.filter((l) => ['MINIMIZED', 'RESTORED', 'HIDDEN', 'OTHER-SHOWN'].includes(l.kind)).length],
          [0, [num], [num], 0]);
        check(`call ${num}: AirDroid is still visible, same size, not minimised; the output makes no connected-call claim`,
          [visibleWindows(), /CLICK SENT ONCE/.test(r.out), /AirDroid left visible where it is\. CLICK SENT is not a connected call/.test(r.out), CONNECTED(r.out)],
          [before, true, true, false]);
      }
      check('after three calls: lock released', await lockState(), 'FREE');

      // Duplicate within 30 s, and another call holding the lock: refused before the Dialpad is touched.
      const guard = fresh('guard') + '.json';
      launch('2025550404', guard);
      const from = read(log).length;
      const dup = launch('2025550404', guard);
      check('duplicate within 30 s: exit 10; nothing typed or clicked', [dup.code, kinds(log, from).filter((k) => CHANGES.includes(k))], [10, []]);
      const holder = spawn('powershell.exe', [...PS, '-Command',
        "$m = New-Object System.Threading.Mutex($false, 'Local\\IAOS-AirDroid-Dial'); [void]$m.WaitOne(0); [Console]::Out.WriteLine('HELD'); [Console]::Out.Flush(); [void][Console]::In.ReadLine(); $m.ReleaseMutex(); [Console]::Out.WriteLine('RELEASED'); [Console]::Out.Flush()"]);
      let hOut = '';
      holder.stdout.on('data', (d) => { hOut += d; });
      const said = async (t) => { for (let i = 0; i < 200 && !hOut.includes(t); i += 1) await sleep(50); return hOut.includes(t); };
      await said('HELD');
      const from2 = read(log).length;
      const busy = launch('2025550405');
      check('another IAOS call holds the lock: exit 10; nothing typed or clicked', [busy.code, kinds(log, from2).filter((k) => CHANGES.includes(k))], [10, []]);
      holder.stdin.write('\n');
      check('lock holder released the lock itself', await said('RELEASED'), true);
    }

    // ---- 2. The second AirDroid form is also VISIBLE (no Dialpad): the Dialpad window is still the only choice ----
    {
      const { log } = await startFake(['--hidden-page', '--second-form', '--second-visible']);
      check('second form visible: two visible "AirDroid" windows', visibleWindows().split(';').length, 2);
      const r = launch('2025550411');
      await sleep(400);
      check('second form visible: exit 0; ONE click on the number in the Dialpad window', [r.code, read(log).filter((l) => l.kind === 'CLICK').map((l) => l.text)], [0, ['2025550411']]);
    }

    // ---- 3. Small corner window ----
    {
      const { log } = await startFake(['--hidden-page', '--second-form', '--size=300x470']);
      const c = checkDialpad();
      console.log(`INFO small-window Dialpad check reports: ${(c.out.match(/Dialpad window \([^)]*\)/) || ['?'])[0]} (physical pixels; the helper is DPI-aware)`);
      check('small window (300x470): the Dialpad check passes and reports the window size', [c.code, /Dialpad window \(\d+x\d+ at -?\d+,-?\d+\)/.test(c.out)], [0, true]);
      const r = launch('2025550421');
      await sleep(400);
      check('small window: exit 0, ONE click; the window keeps its size', [r.code, read(log).filter((l) => l.kind === 'CLICK').map((l) => l.text), visibleWindows()], [0, ['2025550421'], 'True|False|300x470']);
    }

    // ---- 5. VivoBook (2026-10-12): AirDroid BEHIND IAOS, and a Make Call that ignores clicks while in the background ----
    //         "CLICK SENT" (the helper posted the click) is not "CLICK" (the fake accepted it), and neither is a call.
    {
      const WIN_EXE = path.join(TMP, 'IaosFakeWindow.exe');
      const wb = spawnSync('powershell.exe', [...PS, '-Command',
        `Add-Type -TypeDefinition (Get-Content -Raw '${path.join(__dirname, 'harness', 'airdroid-fake', 'FakeWindow.cs')}') ` +
        `-ReferencedAssemblies System.Windows.Forms,System.Drawing -OutputAssembly '${WIN_EXE}' -OutputType WindowsApplication`], { encoding: 'utf8' });
      if (wb.status !== 0) throw new Error(wb.stderr);
      const FRONT = path.join(TMP, 'front.ps1');
      fs.writeFileSync(FRONT, [
        'param([string]$Title)',
        "Add-Type -Namespace F -Name W -MemberDefinition @'",
        '[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string c, string t);',
        '[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);',
        '[DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);',
        '[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();',
        '[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, IntPtr p);',
        '[DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();',
        '[DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool x);',
        '[DllImport("user32.dll")] public static extern void keybd_event(byte v, byte s, uint f, UIntPtr e);',
        "'@",
        '$h = [F.W]::FindWindow([NullString]::Value, $Title); $t = [F.W]::GetWindowThreadProcessId([F.W]::GetForegroundWindow(), [IntPtr]::Zero); $me = [F.W]::GetCurrentThreadId()',
        "if ($h -eq [IntPtr]::Zero) { 'NO-WINDOW'; exit }",
        '# Test-only: a synthetic Alt press releases the foreground lock so this test tool can arrange the windows.',
        '[F.W]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero); [F.W]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)',
        '$a = $false; if ($t -ne 0 -and $t -ne $me) { $a = [F.W]::AttachThreadInput($me, $t, $true) }; [void][F.W]::BringWindowToTop($h); [void][F.W]::SetForegroundWindow($h); if ($a) { [void][F.W]::AttachThreadInput($me, $t, $false) }',
        'Start-Sleep -Milliseconds 300; if ([F.W]::GetForegroundWindow() -eq $h) { "FRONT" } else { "NOT-FRONT" }',
      ].join('\n'));
      const iaosTitle = 'Seller Call - IAOS stand-in (visible-Dialpad test)';
      const toFront = () => (spawnSync('powershell.exe', [...PS, '-File', FRONT, iaosTitle], { encoding: 'utf8' }).stdout || '').trim();
      const { log } = await startFake(['--hidden-page', '--second-form', '--require-active']);
      const LDIR = path.join(TMP, 'launcher'); fs.mkdirSync(LDIR, { recursive: true });
      const stand = spawn(WIN_EXE, [path.join(TMP, 'stand.log'), iaosTitle, '--grant-foreground', '--launcher', LDIR], { stdio: 'ignore' });
      /** Click Call in the browser stand-in: it launches the real handler in its own console, as Chrome does. */
      const launchFromStandIn = async (number, guard = fresh('guard') + '.json') => {
        const out = path.join(LDIR, `out-${number}.txt`);
        try { fs.rmSync(path.join(LDIR, 'exit.txt')); } catch { /* none yet */ }
        const cmd = `Start-Transcript -Path '${out}' | Out-Null; & '${HANDLER}' 'iaos-airdroid:call?number=${number}' -NoPause -TestProcessName ${FAKE} -GuardFile '${guard}'; $c = $LASTEXITCODE; Stop-Transcript | Out-Null; exit $c`;
        fs.writeFileSync(path.join(LDIR, 'launch.txt'), ['powershell.exe', `-NoProfile -ExecutionPolicy Bypass -Command "${cmd}"`].join('\r\n'));
        for (let i = 0; i < 600 && !fs.existsSync(path.join(LDIR, 'exit.txt')); i += 1) await sleep(100);
        return { code: fs.existsSync(path.join(LDIR, 'exit.txt')) ? Number(fs.readFileSync(path.join(LDIR, 'exit.txt'), 'utf8')) : null, out: fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '', guard };
      };
      for (let i = 0; i < 50 && !read(path.join(TMP, 'stand.log')).some((l) => l.kind === 'READY'); i += 1) await sleep(100);
      await sleep(300);
      check('behind IAOS: the IAOS stand-in (granting foreground, as the browser does for the link it launches) is in front of AirDroid before the call',
        [toFront(), read(path.join(TMP, 'stand.log')).some((l) => l.kind === 'GRANTED')], ['FRONT', true]);
      const before = visibleWindows();
      const r = await launchFromStandIn('2025550451');
      await sleep(500);
      const ev = read(log);
      check('behind IAOS: exit 0; AirDroid brought in front once; the click ACCEPTED (CLICK, not CLICK-IGNORED) on the number',
        [r.code, /AirDroid Dialpad brought in front\./.test(r.out), ev.filter((l) => l.kind === 'CLICK').map((l) => l.text), ev.filter((l) => l.kind === 'CLICK-IGNORED').length], [0, true, ['2025550451'], 0]);
      check('behind IAOS: the output says click sent, not a connected call; AirDroid same size, not minimised, nothing restored or shown',
        [/CLICK SENT ONCE/.test(r.out), /CLICK SENT is not a connected call/.test(r.out), CONNECTED(r.out), visibleWindows(), ev.filter((l) => ['MINIMIZED', 'RESTORED', 'HIDDEN', 'OTHER-SHOWN'].includes(l.kind)).length],
        [true, true, false, before, 0]);

      // Windows refuses the bring-forward: nothing is clicked and the dial is not recorded (so a retry is not blocked).
      check('refused foreground: the IAOS stand-in is in front again', toFront(), 'FRONT');
      const guard = fresh('guard') + '.json';
      const prep = spawnSync('powershell.exe', [...PS, '-File', PREPARE, '-Number', '2025550452', '-TestProcessName', FAKE], { encoding: 'utf8' });
      const from = read(log).length;
      const d = spawnSync('powershell.exe', [...PS, '-File', DIAL, '-Number', '2025550452', '-TestProcessName', FAKE, '-GuardFile', guard, '-TestRefuseForeground'], { encoding: 'utf8' });
      check('refused foreground: exit 11 with the plain instruction; no click of any kind; the dial is not recorded',
        [prep.status, d.status, /Windows did not bring the AirDroid Dialpad in front, so the click was not sent/.test(d.stdout), read(log).slice(from).filter((l) => /^CLICK/.test(l.kind)).length, fs.existsSync(guard)],
        [0, 11, true, 0, false]);
      // ---- 6. Layout shift at activation (2026-10-12): after the bring-forward, the target is rechecked for validity,
      //         ancestry and geometry; any change stops before the dial is recorded or anything is clicked. ----
      for (const [mode, reason] of [
        ['move', /moved\s+or\s+resized/], ['resize', /moved\s+or\s+resized/], ['window', /moved\s+or\s+resized/],
        ['reparent', /no\s+longer\s+inside\s+the\s+same\s+Dialpad/], ['replace', /no\s+longer\s+the\s+same\s+visible,\s+enabled\s+control/],
        ['hide', /no\s+longer\s+the\s+same\s+visible,\s+enabled\s+control/], ['field', /no\s+longer\s+inside\s+the\s+same\s+Dialpad/],
      ]) {
        const fk = await startFake(['--hidden-page', '--second-form', '--require-active', `--shift-on-activate=${mode}`]);
        toFront();
        const g = fresh('guard') + '.json';
        const num = `20255505${String(10 + mode.length).padStart(2, '0')}`;
        const rr = await launchFromStandIn(num, g);
        await sleep(400);
        const evs = read(fk.log);
        console.log(`INFO shift ${mode}: ${JSON.stringify(rr.out.slice(Math.max(0, rr.out.indexOf('DIAL STOPPED')), rr.out.indexOf('DIAL STOPPED') + 400))}`);
        check(`layout shift at activation (${mode}): exit 9 "changed when AirDroid came in front" (${reason.source}); no click of any kind; the dial not recorded`,
          [evs.some((l) => l.kind === 'SHIFTED'), rr.code, /Make\s+Call\s+changed\s+when\s+AirDroid\s+came\s+in\s+front/.test(rr.out), reason.test(rr.out), evs.filter((l) => /^CLICK/.test(l.kind)).length,
            fs.existsSync(g) && fs.readFileSync(g, 'utf8').includes(num)],
          [true, 9, true, true, 0, false]);
      }
      {
        // Control inside the suite: the same activation with no layout change still clicks once.
        const fk = await startFake(['--hidden-page', '--second-form', '--require-active']);
        toFront();
        const rr = await launchFromStandIn('2025550599');
        await sleep(400);
        check('no layout change at activation: exit 0, ONE accepted click', [rr.code, read(fk.log).filter((l) => l.kind === 'CLICK').map((l) => l.text)], [0, ['2025550599']]);
      }
      check('static: the post-activation recheck (validity, ancestry, geometry) comes after the bring-forward and before the dial is recorded',
        (() => { const d = fs.readFileSync(DIAL, 'utf8'); const a = d.indexOf('SetForegroundWindow($mainH)'), b = d.indexOf('# ---- 4c.'), c2 = d.indexOf('Set-Content -LiteralPath $GuardFile'); return a > -1 && a < b && b < c2
          && /\$N::IsChild\(\$formH, \$target\) -and \$N::IsChild\(\$mainH, \$formH\)/.test(d) && /\$sameAfter = \(\$after\.L -eq \$rect\.L/.test(d); })(), true);

      // A real refusal: an IAOS stand-in in front that does NOT grant foreground. Windows refuses; nothing is clicked.
      stand.kill();
      await sleep(300);
      const title2 = 'Seller Call - IAOS stand-in without grant (visible-Dialpad test)';
      const stand2 = spawn(WIN_EXE, [path.join(TMP, 'stand2.log'), title2], { stdio: 'ignore' });
      for (let i = 0; i < 50 && !read(path.join(TMP, 'stand2.log')).some((l) => l.kind === 'READY'); i += 1) await sleep(100);
      await sleep(300);
      const front2 = (spawnSync('powershell.exe', [...PS, '-File', FRONT, title2], { encoding: 'utf8' }).stdout || '').trim();
      const from3 = read(log).length;
      const guard3 = fresh('guard') + '.json';
      const r3 = launch('2025550453', guard3);   // launched by the background test runner, not by the window in front
      await sleep(400);
      check('Windows refuses the bring-forward (no grant): exit 11 with the plain instruction; no click of any kind; the dial not recorded',
        [front2, r3.code, /Windows did not bring the AirDroid Dialpad in front, so the click was not sent/.test(r3.out), read(log).slice(from3).filter((l) => /^CLICK/.test(l.kind)).length, fs.existsSync(guard3) && /2025550453/.test(fs.readFileSync(guard3, 'utf8'))],
        ['FRONT', 11, true, 0, false]);
      stand2.kill();
      check('-TestRefuseForeground is inert without -TestProcessName (static)', /if \(\$TestProcessName -and \$TestRefuseForeground\) \{ \$inFront = \$false \}/.test(fs.readFileSync(DIAL, 'utf8')), true);
    }

    // ---- 4. Stops with a plain instruction; nothing restored, started, typed or clicked ----
    for (const [label, flags, re, code] of [
      ['minimised (on the taskbar)', ['--hidden-page', '--second-form', '--start-minimized'], /AirDroid is minimised\. Restore it yourself/, 4],
      ['hidden in the tray', ['--hidden-page', '--second-form', '--start-hidden', '--tray'], /No visible AirDroid window shows the Dialpad/, 4],
      ['open but the Dialpad not shown', ['--no-dialpad', '--second-form'], /No visible AirDroid window shows the Dialpad/, 4],
      ['two visible Dialpad windows', ['--second-dialpad', '--second-visible'], /2 visible AirDroid windows show a Dialpad; IAOS will not choose between them/, 3],
    ]) {
      const { log } = await startFake(flags);
      const before = visibleWindows();
      const r = launch('2025550431');
      await sleep(400);
      check(`${label}: exit ${code} with the plain instruction; nothing typed, clicked, restored or shown; windows unchanged`,
        [r.code, re.test(r.out), code === 4 ? OPEN.test(r.out) : true, kinds(log).filter((k) => ['TEXT', 'CLICK', 'RESTORED', 'OTHER-SHOWN'].includes(k)), visibleWindows()],
        [code, true, true, [], before]);
      const c = checkDialpad();
      check(`${label}: the Dialpad check also stops (exit ${code})`, c.code, code);
    }
    await killFakes();
    {
      const r = launch('2025550441');
      check('AirDroid not running: exit 3 with the plain instruction; nothing is started', [r.code, /AirDroid is not running\. Open AirDroid/.test(r.out), fakeCount()], [3, true, 0]);
      check('after the refusals: lock released', await lockState(), 'FREE');
    }
  } catch (error) {
    failures += 1;
    console.log(`FAIL harness error: ${error && error.stack ? error.stack : error}`);
  } finally {
    if (probe) probe.child.stdin.end();
    spawnSync('taskkill', ['/IM', `${FAKE}.exe`, '/F'], { stdio: 'ignore' });
  }
  await sleep(300);
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\n${checks - failures}/${checks} checks passed`);
  process.exit(failures ? 1 : 0);
})();
