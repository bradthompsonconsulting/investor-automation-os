<#
.SYNOPSIS
  IAOS "Prepare Call" prototype for AirDroid Personal (standalone, not part of IAOS).

.DESCRIPTION
  1. Validates and normalises the phone number. The field is never touched if the number is invalid.
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

.NOTES
  Exit codes:
    0 prepared, or the CheckOnly checks passed
    2 invalid number
    3 AirDroid is not running, or its main window was not found / is ambiguous
    4 Dialpad field not found (Dialpad not open)
    5 Dialpad field ambiguous (more than one candidate)
    6 readback mismatch (field cleared)
    7 unexpected error
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)][string]$Number = '',
  [switch]$CheckOnly
)
$ErrorActionPreference = 'Stop'

function Stop-With([int]$code, [string]$msg) {
  Write-Host "PREPARE CALL STOPPED: $msg" -ForegroundColor Red
  exit $code
}

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

  # ---- 2. Exactly one AirDroid main window ----
  $procs = @(Get-Process -Name AirDroid -ErrorAction SilentlyContinue)
  if ($procs.Count -eq 0) { Stop-With 3 "AirDroid is not running. Start AirDroid and open the Dialpad (My devices > your phone > Dialpad)." }
  $mains = @()
  foreach ($p in $procs) {
    $cond = New-Object System.Windows.Automation.AndCondition(
      (New-Object System.Windows.Automation.PropertyCondition($AE::ProcessIdProperty, $p.Id)),
      (New-Object System.Windows.Automation.PropertyCondition($AE::NameProperty, 'AirDroid')),
      (New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, [System.Windows.Automation.ControlType]::Window)))
    $mains += @($AE::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $cond))
  }
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
  function Walk($el, [int]$depth, [bool]$inForm) {
    if ($depth -gt 30) { return }
    $c = $el.Current
    $h = [IntPtr]$c.NativeWindowHandle
    $f = $inForm -or ($c.Name -eq 'frmAirCloud' -and $h -ne [IntPtr]::Zero -and $N::IsWindowVisible($h))
    if ($f -and $c.ClassName -match '\.EDIT\.' -and $h -ne [IntPtr]::Zero -and $N::IsWindowVisible($h)) { $script:hits += $el }
    $ch = $Walker.GetFirstChild($el)
    while ($ch -ne $null) { Walk $ch ($depth + 1) $f; $ch = $Walker.GetNextSibling($ch) }
  }
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
  Write-Host "Check the number on screen, then press Make Call yourself."
  exit 0
}
catch {
  Write-Host "PREPARE CALL STOPPED: unexpected error: $($_.Exception.Message)" -ForegroundColor Red
  exit 7
}
