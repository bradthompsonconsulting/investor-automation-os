<#
.SYNOPSIS
  IAOS "Prepare Call" prototype for AirDroid Personal (standalone, not part of IAOS).

.DESCRIPTION
  1. Validates and normalises the phone number. The field is never touched if the number is invalid.
  1c. With -StartIfNotRunning (the IAOS handler passes it): if AirDroid is not running, starts it and waits a bounded
     time (-ReadyTimeoutSec, default 60) until exactly one AirDroid main window shows exactly one Dialpad number field
     (the same guarded lookup as step 3). The wait only looks; it changes nothing. If that does not happen in time it
     stops (exit 8) with a clear message, and no number is entered and no call is placed.
  2. Finds exactly one running AirDroid main window and brings it forward.
  3. Finds the already-open Dialpad number field with the guarded lookup: exactly one visible standard
     Windows text field (class *.EDIT.*) inside AirDroid's visible device page form "frmAirCloud".
     It stops if there is none, or more than one.
  4. Replaces the field's text with WM_SETTEXT, so no keystrokes are sent and Enter is never pressed.
  5. Reads the field back and requires an exact match. On a mismatch it clears the field, so a wrong
     number is never left ready to dial.

  It never dials, never presses Make Call / End Call / queued dialing, never navigates AirDroid, and never
  reads AirDroid's configuration or log files. It does not read the field's existing contents, only their
  length.

.PARAMETER Number
  US/NANP number in common forms: 2025550147, 202-555-0147, (202) 555-0147, +1 202 555 0147.

.PARAMETER CheckOnly
  Runs every check, including the guarded lookup, but changes nothing and does not bring AirDroid forward.

.PARAMETER Automatic
  B14-13: used by IaosAirdroidHandler.ps1, which dials automatically next. Suppresses the standalone instruction to
  press Make Call yourself. Standalone prefill keeps that instruction.

.PARAMETER CallerHoldsLock
  B14-13: the caller (IaosAirdroidHandler.ps1) already holds the IAOS call lock for the whole prepare-and-dial
  sequence. This script then only confirms the lock is held (exit 10 if it is not) instead of taking it, which would
  deadlock against the caller. Without it, standalone use takes the lock itself, so a prefill can never change the
  Dialpad during an automatic dial.

.PARAMETER StartIfNotRunning
  B14-13: start AirDroid when it is not running, then wait for its Dialpad (step 1c). Ignored with -CheckOnly.

.PARAMETER ReadyTimeoutSec
  B14-13: how long step 1c waits, 5 to 180 seconds (default 60).

.PARAMETER TestProcessName
  Offline tests only: the process name of the inert fake AirDroid window. Never passed by the registered handler.

.PARAMETER TestLaunchPath / TestLaunchArgs
  Offline tests only (require -TestProcessName): the fake AirDroid program step 1c starts instead of AirDroid.

.NOTES
  Exit codes:
    0 prepared, or the CheckOnly checks passed
    2 invalid number
    3 AirDroid is not running, or its main window was not found / is ambiguous
    4 Dialpad field not found (Dialpad not open)
    5 Dialpad field ambiguous (more than one candidate)
    6 readback mismatch (field cleared)
    7 unexpected error
    8 AirDroid was started (or could not be started) but its Dialpad was not ready in time; nothing was entered
    10 another IAOS call is in progress (nothing changed), or -CallerHoldsLock given but the lock is not held
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)][string]$Number = '',
  [switch]$CheckOnly,
  [switch]$Automatic,
  [switch]$CallerHoldsLock,
  [switch]$StartIfNotRunning,
  [ValidateRange(5, 180)][int]$ReadyTimeoutSec = 60,
  [string]$TestProcessName = '',
  [string]$TestLaunchPath = '',
  [string]$TestLaunchArgs = ''
)
$ErrorActionPreference = 'Stop'
$processName = if ($TestProcessName) { $TestProcessName } else { 'AirDroid' }

function Stop-With([int]$code, [string]$msg) {
  Write-Host "PREPARE CALL STOPPED: $msg" -ForegroundColor Red
  exit $code
}

$mutex = $null
try {
  # ---- 1. Validate before touching anything ----
  if ([string]::IsNullOrWhiteSpace($Number)) { Stop-With 2 "No number given. Usage: PrepareCall.cmd `"202-555-0147`"" }
  if ($Number -notmatch '^[\d\s\-\.\(\)\+]+$') { Stop-With 2 "Invalid number: only digits, spaces, - . ( ) and a leading + are allowed. Extensions and letters are not." }
  if (($Number.IndexOf('+') -gt 0) -or (($Number -split '\+').Count -gt 2)) { Stop-With 2 "Invalid number: '+' is only allowed once, at the start." }
  $digits = ($Number -replace '\D', '')
  if ($digits.Length -eq 11 -and $digits.StartsWith('1')) { $digits = $digits.Substring(1) }
  if ($digits.Length -ne 10) { Stop-With 2 "Invalid number: expected 10 digits (US), optionally with a leading 1 or +1. Got $($digits.Length) digits." }
  if ($digits[0] -lt [char]'2' -or $digits[3] -lt [char]'2') { Stop-With 2 "Invalid number: area code and exchange must not start with 0 or 1." }
  Write-Host "Number validated: $digits"

  # ---- 1b. IAOS call lock (B14-13): held for the whole sequence; taken here only in standalone use ----
  $lock = New-Object System.Threading.Mutex($false, 'Local\IAOS-AirDroid-Dial')
  $got = $false
  try { $got = $lock.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $got = $true }
  if ($CallerHoldsLock) {
    if ($got) { $lock.ReleaseMutex(); $lock.Dispose(); Stop-With 10 "The IAOS call lock is not held by the caller. Nothing was changed." }
    $lock.Dispose()
  } else {
    if (-not $got) { $lock.Dispose(); Stop-With 10 "Another IAOS call is in progress. Nothing was changed." }
    $mutex = $lock
  }

  Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
  if (-not ('IaosPrepareCall.Native' -as [type])) {
    Add-Type -Namespace IaosPrepareCall -Name Native -UsingNamespace System.Text -MemberDefinition @'
[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, string l);
[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, StringBuilder l);
[DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, IntPtr pid);
[DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
[DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
[DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
public static string GetText(IntPtr h) { var sb = new StringBuilder(256); SendMessage(h, 0x000D, (IntPtr)256, sb); return sb.ToString(); }
'@
  }
  $N = [IaosPrepareCall.Native]
  $AE = [System.Windows.Automation.AutomationElement]
  $Walker = [System.Windows.Automation.TreeWalker]::RawViewWalker

  function Find-Mains {
    $found = @()
    foreach ($p in @(Get-Process -Name $processName -ErrorAction SilentlyContinue)) {
      $cond = New-Object System.Windows.Automation.AndCondition(
        (New-Object System.Windows.Automation.PropertyCondition($AE::ProcessIdProperty, $p.Id)),
        (New-Object System.Windows.Automation.PropertyCondition($AE::NameProperty, 'AirDroid')),
        (New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, [System.Windows.Automation.ControlType]::Window)))
      $found += @($AE::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $cond))
    }
    return $found
  }
  # Step 3's guarded lookup: exactly one visible EDIT inside the visible device page form "frmAirCloud".
  $script:hits = @()
  function Walk($el, [int]$depth, [bool]$inForm) {
    if ($depth -gt 30) { return }
    $c = $el.Current
    $h = [IntPtr]$c.NativeWindowHandle
    $f = $inForm -or ($c.Name -eq 'frmAirCloud' -and $h -ne [IntPtr]::Zero -and $N::IsWindowVisible($h))
    if ($f -and $c.ClassName -match '\.EDIT\.' -and $h -ne [IntPtr]::Zero -and $N::IsWindowVisible($h)) { $script:hits += $el }
    $ch = $Walker.GetFirstChild($el)
    while ($ch -ne $null) { Walk $ch ($depth + 1) $f; $ch = $Walker.GetNextSibling($ch) }
  }

  # ---- 1c. Start AirDroid if it is not running, then wait (bounded, look-only) for its Dialpad ----
  # A test run (-TestProcessName) starts only its own -TestLaunchPath, never the real AirDroid.
  if ($StartIfNotRunning -and -not $CheckOnly -and (-not $TestProcessName -or $TestLaunchPath) -and @(Get-Process -Name $processName -ErrorAction SilentlyContinue).Count -eq 0) {
    $notReady = "No number was entered and no call was placed. Open AirDroid > My devices > your phone > Dialpad, then click Call again."
    if ($TestLaunchPath) {
      if (-not $TestProcessName) { Stop-With 8 "A test launch path needs a test process name." }
      $exe = $TestLaunchPath
    } else {
      $exe = Join-Path ${env:ProgramFiles(x86)} 'AirDroid\AirDroid.exe'
      if (-not (Test-Path -LiteralPath $exe)) { $exe = Join-Path $env:ProgramFiles 'AirDroid\AirDroid.exe' }
    }
    if (-not (Test-Path -LiteralPath $exe)) { Stop-With 8 "AirDroid is not running and AirDroid.exe was not found to start it. $notReady" }
    Write-Host "AirDroid is not running: starting it and waiting up to $ReadyTimeoutSec seconds for your phone's Dialpad..."
    try {
      if ($TestLaunchArgs) { [void](Start-Process -FilePath $exe -ArgumentList $TestLaunchArgs -PassThru) }
      else { [void](Start-Process -FilePath $exe -PassThru) }
    } catch { Stop-With 8 "AirDroid could not be started ($($_.Exception.Message)). $notReady" }
    $deadline = (Get-Date).AddSeconds($ReadyTimeoutSec)
    $state = 'AirDroid has not opened its window yet'
    while ($true) {
      $m = @(Find-Mains)
      if ($m.Count -eq 1) {
        $script:hits = @(); Walk $m[0] 0 $false
        if ($script:hits.Count -eq 1) { break }
        $state = if ($script:hits.Count -eq 0) { 'AirDroid is open, but its Dialpad is not (or your phone is not connected yet)' } else { "AirDroid shows $($script:hits.Count) candidate Dialpad fields" }
      } elseif ($m.Count -gt 1) { $state = "AirDroid shows $($m.Count) main windows" }
      if ((Get-Date) -ge $deadline) { Stop-With 8 "AirDroid was started but was not ready within $ReadyTimeoutSec seconds: $state. $notReady" }
      Start-Sleep -Milliseconds 1000
    }
    $script:hits = @()
    Write-Host "AirDroid is ready: one Dialpad found."
  }

  # ---- 2. Exactly one AirDroid main window ----
  $procs = @(Get-Process -Name $processName -ErrorAction SilentlyContinue)
  if ($procs.Count -eq 0) { Stop-With 3 "AirDroid is not running. Start AirDroid and open the Dialpad (My devices > your phone > Dialpad)." }
  $mains = @(Find-Mains)
  if ($mains.Count -ne 1) { Stop-With 3 "Expected exactly one AirDroid main window, found $($mains.Count)." }
  $main = $mains[0]
  $mainH = [IntPtr]$main.Current.NativeWindowHandle

  # ---- 2b. Bring forward (skipped in CheckOnly) ----
  $foreground = 'not attempted (CheckOnly)'
  if (-not $CheckOnly) {
    if ($N::IsIconic($mainH)) { [void]$N::ShowWindow($mainH, 9) }  # SW_RESTORE
    $fgThread = $N::GetWindowThreadProcessId($N::GetForegroundWindow(), [IntPtr]::Zero)
    $me = $N::GetCurrentThreadId()
    $attached = $false
    if ($fgThread -ne 0 -and $fgThread -ne $me) { $attached = $N::AttachThreadInput($me, $fgThread, $true) }
    [void]$N::BringWindowToTop($mainH); [void]$N::SetForegroundWindow($mainH)
    if ($attached) { [void]$N::AttachThreadInput($me, $fgThread, $false) }
    Start-Sleep -Milliseconds 400
    $foreground = if ($N::GetForegroundWindow() -eq $mainH) { 'yes' } else { 'NO (Windows refused focus; AirDroid may stay behind)' }
  }

  # ---- 3. Guarded lookup: exactly one visible EDIT inside visible frmAirCloud ----
  $script:hits = @()
  Walk $main 0 $false
  if ($script:hits.Count -eq 0) { Stop-With 4 "Dialpad number field not found. Open AirDroid > My devices > your phone > Dialpad, then try again." }
  if ($script:hits.Count -gt 1) { Stop-With 5 "Dialpad field is ambiguous: $($script:hits.Count) candidate fields found. Nothing was changed." }
  $field = [IntPtr]$script:hits[0].Current.NativeWindowHandle
  $existingLen = [int]$N::SendMessage($field, 0x000E, [IntPtr]::Zero, [IntPtr]::Zero)   # WM_GETTEXTLENGTH, content not read
  Write-Host "Dialpad field found (exactly one). Existing text length: $existingLen."

  if ($CheckOnly) {
    Write-Host "CHECK ONLY: all checks passed; nothing was changed." -ForegroundColor Green
    exit 0
  }

  # ---- 4. Replace (no keystrokes, no Enter) ----
  [void]$N::SendMessage($field, 0x000C, [IntPtr]::Zero, $digits)   # WM_SETTEXT
  Start-Sleep -Milliseconds 200

  # ---- 5. Exact readback ----
  $read = $N::GetText($field)
  if ($read -cne $digits) {
    [void]$N::SendMessage($field, 0x000C, [IntPtr]::Zero, '')
    Stop-With 6 "Readback did not match (expected $digits, read '$read'). The field was cleared. Do not call."
  }
  Write-Host "PREPARED: $digits is in the AirDroid Dialpad (exact readback). AirDroid in front: $foreground." -ForegroundColor Green
  # Standalone prefill only: in the automatic handler path DialCall.ps1 presses Make Call next, without confirmation.
  if (-not $Automatic) { Write-Host "Check the number on screen, then press Make Call yourself." }
  exit 0
}
catch {
  Write-Host "PREPARE CALL STOPPED: unexpected error: $($_.Exception.Message)" -ForegroundColor Red
  exit 7
}
finally {
  if ($mutex) { $mutex.ReleaseMutex(); $mutex.Dispose() }
}
