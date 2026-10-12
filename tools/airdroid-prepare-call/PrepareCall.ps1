<#
.SYNOPSIS
  IAOS "Prepare Call" prototype for AirDroid Personal (standalone, not part of IAOS).

.DESCRIPTION
  1. Validates and normalises the phone number. The field is never touched if the number is invalid.
  2. B14-13 visible Dialpad (Brad, 2026-10-12): AirDroid is opened once with its Dialpad and kept VISIBLE beside IAOS
     (it may be a small window in a corner). Among AirDroid's visible, not-minimised "AirDroid" windows, exactly one
     must hold the Dialpad (step 3's guarded lookup). It is used as it is: nothing is started, restored, brought
     forward, moved, resized or minimised. None, or more than one: stop with a plain instruction, never a guess.
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
  Runs every check, including the guarded lookup, but changes nothing.

.PARAMETER Automatic
  B14-13: used by IaosAirdroidHandler.ps1, which dials automatically next. Suppresses the standalone instruction to
  press Make Call yourself. Standalone prefill keeps that instruction.

.PARAMETER CallerHoldsLock
  B14-13: the caller (IaosAirdroidHandler.ps1) already holds the IAOS call lock for the whole prepare-and-dial
  sequence. This script then only confirms the lock is held (exit 10 if it is not) instead of taking it, which would
  deadlock against the caller. Without it, standalone use takes the lock itself, so a prefill can never change the
  Dialpad during an automatic dial.

.PARAMETER TestProcessName
  Offline tests only: the process name of the inert fake AirDroid window. Never passed by the registered handler.

.NOTES
  Exit codes:
    0 prepared, or the CheckOnly checks passed
    2 invalid number
    3 AirDroid is not running, or more than one visible AirDroid window shows a Dialpad
    4 no visible AirDroid window shows the Dialpad (not open, hidden or minimised)
    5 Dialpad field ambiguous (more than one candidate)
    6 readback mismatch (field cleared)
    7 unexpected error
    10 another IAOS call is in progress (nothing changed), or -CallerHoldsLock given but the lock is not held
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)][string]$Number = '',
  [switch]$CheckOnly,
  [switch]$Automatic,
  [switch]$CallerHoldsLock,
  [string]$TestProcessName = ''
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
public static string GetText(IntPtr h) { var sb = new StringBuilder(256); SendMessage(h, 0x000D, (IntPtr)256, sb); return sb.ToString(); }
'@
  }
  $N = [IaosPrepareCall.Native]
  $AE = [System.Windows.Automation.AutomationElement]
  $Walker = [System.Windows.Automation.TreeWalker]::RawViewWalker

  # ---- 2/3. Exactly one VISIBLE AirDroid window showing the Dialpad, and in it exactly one visible number field ----
  $procs = @(Get-Process -Name $processName -ErrorAction SilentlyContinue)
  if ($procs.Count -eq 0) { Stop-With 3 "AirDroid is not running. Open AirDroid > My devices > your phone > Dialpad, and keep that AirDroid window visible beside IAOS (it may be small, in a corner). Then click Call again." }
  $mains = @()
  foreach ($p in $procs) {
    $cond = New-Object System.Windows.Automation.AndCondition(
      (New-Object System.Windows.Automation.PropertyCondition($AE::ProcessIdProperty, $p.Id)),
      (New-Object System.Windows.Automation.PropertyCondition($AE::NameProperty, 'AirDroid')),
      (New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, [System.Windows.Automation.ControlType]::Window)))
    $mains += @($AE::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $cond))
  }
  # Guarded lookup: visible EDIT fields inside a visible device page form "frmAirCloud".
  function Walk($el, [int]$depth, [bool]$inForm) {
    if ($depth -gt 30) { return }
    $c = $el.Current
    $h = [IntPtr]$c.NativeWindowHandle
    $f = $inForm -or ($c.Name -eq 'frmAirCloud' -and $h -ne [IntPtr]::Zero -and $N::IsWindowVisible($h))
    if ($f -and $c.ClassName -match '\.EDIT\.' -and $h -ne [IntPtr]::Zero -and $N::IsWindowVisible($h)) { $script:hits += $el }
    $ch = $Walker.GetFirstChild($el)
    while ($ch -ne $null) { Walk $ch ($depth + 1) $f; $ch = $Walker.GetNextSibling($ch) }
  }
  $withDialpad = @(); $minimised = 0
  foreach ($w in $mains) {
    $wh = [IntPtr]$w.Current.NativeWindowHandle
    if (-not $N::IsWindowVisible($wh)) { continue }
    if ($N::IsIconic($wh)) { $minimised++; continue }
    $script:hits = @(); Walk $w 0 $false
    if ($script:hits.Count -gt 0) { $withDialpad += [pscustomobject]@{ Window = $w; Fields = $script:hits } }
  }
  if ($withDialpad.Count -eq 0) {
    if ($minimised) { Stop-With 4 "AirDroid is minimised. Restore it yourself (do not close it), with your phone's Dialpad open. Open AirDroid > My devices > your phone > Dialpad, and keep that AirDroid window visible beside IAOS (it may be small, in a corner). Then click Call again." }
    Stop-With 4 "No visible AirDroid window shows the Dialpad. Nothing was changed. Open AirDroid > My devices > your phone > Dialpad, and keep that AirDroid window visible beside IAOS (it may be small, in a corner). Then click Call again."
  }
  if ($withDialpad.Count -gt 1) { Stop-With 3 "$($withDialpad.Count) visible AirDroid windows show a Dialpad; IAOS will not choose between them. Keep only one AirDroid Dialpad open. Nothing was changed." }
  $main = $withDialpad[0].Window
  $script:hits = @($withDialpad[0].Fields)
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
  Write-Host "PREPARED: $digits is in the AirDroid Dialpad (exact readback)." -ForegroundColor Green
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
