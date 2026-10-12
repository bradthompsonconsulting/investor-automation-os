<#
.SYNOPSIS
  B14-13: presses AirDroid's Make Call once for a number PrepareCall.ps1 has just placed in the Dialpad.

.DESCRIPTION
  Runs only after PrepareCall.ps1 exits 0. Brad's one IAOS Call click is the authorization; there is no second
  confirmation. It never retries and never touches End Call, Enter or AirDroid's configuration or log files.

    1. Duplicate guard: one call at a time (the IAOS call lock, named mutex Local\IAOS-AirDroid-Dial), and the same
       number is refused if it was dialled in the last -GuardSeconds seconds (a double launch must not call twice).
       In the automatic path IaosAirdroidHandler.ps1 holds the lock for the whole prepare-and-dial sequence and passes
       -CallerHoldsLock; standalone use takes the lock here.
    2. Live Dialpad: exactly one visible frmAirCloud form holding exactly one visible number field, which must read
       exactly the expected digits.
    3. Make Call, identified structurally (the rule validated against Brad's pointing on 2026-10-09):
         - exactly one 12-key grid in that form (12 sibling panels, each under 200x80);
         - exactly one visible sibling panel at least 90% of the grid's width whose top is at or below the grid's
           bottom (the full-width panel below the keypad);
         - that panel is visible and enabled, and is not inside the call-status panel.
    4. Recheck immediately before the click: the number field still reads exactly the expected digits, and the panel
       still exists, is visible, enabled, inside the same form, with the same rectangle.
    5. Records the dial for the duplicate guard, then sends one click message pair at the panel's centre. No retry.

  The click is a posted window message. Whether AirDroid acted on it is not visible to this script; it reports only
  "click sent once", never that a call was placed.

.PARAMETER Number      The 10 digits PrepareCall.ps1 prepared.
.PARAMETER CheckOnly   Runs steps 1 to 4 read-only; does not click or record a dial. Without -Number it is the
                       "check the Dialpad" mode (CHECK-DIALPAD.cmd): it finds the one visible Dialpad window, its number
                       field and Make Call, reports the window's size, and types and clicks nothing.
.PARAMETER GuardOnly   Runs only the duplicate guard against -GuardFile (offline tests); never looks at AirDroid.
.PARAMETER GuardFile   Where the last dial is recorded (default: %LOCALAPPDATA%\IAOS\airdroid-last-dial.json).
.PARAMETER CallerHoldsLock  The caller already holds the IAOS call lock (B14-13 handler). Only confirms it is held
                       (exit 10 if not) instead of taking it, which would deadlock against the caller.
.PARAMETER TestProcessName  Offline tests only: process name of the inert fake AirDroid window.
.PARAMETER TestPauseMs  Offline tests only, and only together with -TestProcessName: pauses before the final number
                       check and again between that check and the click, so a competing launch can be attempted.

.NOTES
  Exit codes:
    0  click sent once (or CheckOnly / GuardOnly passed)
    2  invalid number
    3  AirDroid not running, or more than one visible AirDroid window shows a Dialpad
    4  no visible AirDroid window shows the live Dialpad (not open, hidden or minimised), or it is ambiguous
    7  unexpected error
    8  Make Call panel not found, ambiguous, inside the call-status panel, or not enabled
    9  number or panel did not match / changed before the click; nothing clicked
    10 duplicate refused (same number dialled moments ago, or another IAOS call in progress), or -CallerHoldsLock
       given but the lock is not held
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)][string]$Number = '',
  [switch]$CheckOnly,
  [switch]$GuardOnly,
  [string]$GuardFile = (Join-Path $env:LOCALAPPDATA 'IAOS\airdroid-last-dial.json'),
  [int]$GuardSeconds = 30,
  [switch]$CallerHoldsLock,
  [string]$TestProcessName = '',
  [int]$TestPauseMs = 0
)
$ErrorActionPreference = 'Stop'
$processName = if ($TestProcessName) { $TestProcessName } else { 'AirDroid' }

function Wait-TestPause([string]$where) {
  if ($TestProcessName -and $TestPauseMs -gt 0) { Write-Host "TEST PAUSE $where"; Start-Sleep -Milliseconds $TestPauseMs }
}

function Stop-With([int]$code, [string]$msg) {
  Write-Host "DIAL STOPPED: $msg" -ForegroundColor Red
  exit $code
}

$mutex = $null
try {
  $structureOnly = $CheckOnly -and -not $Number   # "check the Dialpad": no number, nothing typed or clicked
  if (-not $structureOnly -and $Number -notmatch '^[2-9]\d{2}[2-9]\d{6}$') { Stop-With 2 "Invalid number: expected the 10 prepared US digits." }

  # ---- 1. Duplicate guard ----
  $lock = New-Object System.Threading.Mutex($false, 'Local\IAOS-AirDroid-Dial')
  $got = $false
  try { $got = $lock.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $got = $true }
  if ($CallerHoldsLock) {
    if ($got) { $lock.ReleaseMutex(); $lock.Dispose(); Stop-With 10 "The IAOS call lock is not held by the caller. Nothing was clicked." }
    $lock.Dispose()
  } else {
    if (-not $got) { $lock.Dispose(); Stop-With 10 "Another IAOS call is in progress. Nothing was clicked." }
    $mutex = $lock
  }
  if (-not $structureOnly -and (Test-Path -LiteralPath $GuardFile)) {
    $last = $null
    try { $last = Get-Content -LiteralPath $GuardFile -Raw | ConvertFrom-Json } catch { $last = $null }
    if ($last -and $last.number -eq $Number) {
      $age = ((Get-Date).ToUniversalTime() - [datetime]::Parse($last.at).ToUniversalTime()).TotalSeconds
      if ($age -ge 0 -and $age -lt $GuardSeconds) { Stop-With 10 "$Number was dialled $([int]$age)s ago. Duplicate refused; nothing was clicked." }
    }
  }
  if ($GuardOnly) { Write-Host "GUARD OK: $Number may be dialled."; exit 0 }

  Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
  if (-not ('IaosDialCall.N' -as [type])) {
    Add-Type -Namespace IaosDialCall -Name N -UsingNamespace System.Text -MemberDefinition @'
[StructLayout(LayoutKind.Sequential)] public struct RC { public int L, T, R, B; }
[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
[DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RC r);
[DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RC r);
[DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr h);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
[DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr h);
[DllImport("user32.dll")] public static extern bool IsChild(IntPtr parent, IntPtr child);
[DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, StringBuilder l);
public static string GetText(IntPtr h) { var sb = new StringBuilder(256); SendMessage(h, 0x000D, (IntPtr)256, sb); return sb.ToString(); }
'@
  }
  $N = [IaosDialCall.N]
  [void]$N::SetProcessDPIAware()
  $A = [System.Windows.Automation.AutomationElement]
  $W = [System.Windows.Automation.TreeWalker]::RawViewWalker
  function Get-Rc([IntPtr]$h) { $x = New-Object IaosDialCall.N+RC; [void]$N::GetWindowRect($h, [ref]$x); $x }
  function Get-Edits([IntPtr]$form) {
    @($A::FromHandle($form).FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition) |
      Where-Object { $_.Current.ClassName -match '\.EDIT\.' -and $N::IsWindowVisible([IntPtr]$_.Current.NativeWindowHandle) })
  }

  # ---- 2. The ONE visible AirDroid window that shows the live Dialpad (Brad, 2026-10-12: kept visible beside IAOS) ----
  $procs = @(Get-Process -Name $processName -ErrorAction SilentlyContinue)
  if ($procs.Count -eq 0) { Stop-With 3 "AirDroid is not running. Open AirDroid > My devices > your phone > Dialpad, and keep that AirDroid window visible beside IAOS (it may be small, in a corner). Then click Call again." }
  $mains = @()
  foreach ($p in $procs) {
    $cond = New-Object System.Windows.Automation.AndCondition(
      (New-Object System.Windows.Automation.PropertyCondition($A::ProcessIdProperty, $p.Id)),
      (New-Object System.Windows.Automation.PropertyCondition($A::NameProperty, 'AirDroid')),
      (New-Object System.Windows.Automation.PropertyCondition($A::ControlTypeProperty, [System.Windows.Automation.ControlType]::Window)))
    $mains += @($A::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $cond))
  }
  function Find-Forms($el, [int]$d) { if ($d -gt 30) { return }; $c = $el.Current; $h = [IntPtr]$c.NativeWindowHandle
    if ($c.Name -eq 'frmAirCloud' -and $h -ne [IntPtr]::Zero -and $N::IsWindowVisible($h)) { $script:forms[[int64]$h] = $el }
    $ch = $W.GetFirstChild($el); while ($ch -ne $null) { Find-Forms $ch ($d + 1); $ch = $W.GetNextSibling($ch) } }
  $withDialpad = @(); $minimised = 0
  foreach ($m in $mains) {
    $mh = [IntPtr]$m.Current.NativeWindowHandle
    if (-not $N::IsWindowVisible($mh)) { continue }
    if ($N::IsIconic($mh)) { $minimised++; continue }
    $script:forms = @{}
    Find-Forms $m 0
    $lv = @($script:forms.Keys | Where-Object { (Get-Edits ([IntPtr]$_)).Count -eq 1 })
    if ($lv.Count -gt 0) { $withDialpad += [pscustomobject]@{ Window = $m; Live = $lv } }
  }
  if ($withDialpad.Count -eq 0) {
    if ($minimised) { Stop-With 4 "AirDroid is minimised. Restore it yourself (do not close it), with your phone's Dialpad open. Nothing was clicked. Open AirDroid > My devices > your phone > Dialpad, and keep that AirDroid window visible beside IAOS (it may be small, in a corner). Then click Call again." }
    Stop-With 4 "No visible AirDroid window shows the Dialpad. Nothing was clicked. Open AirDroid > My devices > your phone > Dialpad, and keep that AirDroid window visible beside IAOS (it may be small, in a corner). Then click Call again."
  }
  if ($withDialpad.Count -gt 1) { Stop-With 3 "$($withDialpad.Count) visible AirDroid windows show a Dialpad; IAOS will not choose between them. Keep only one AirDroid Dialpad open. Nothing was clicked." }
  $mainEl = $withDialpad[0].Window
  $live = @($withDialpad[0].Live)
  if ($live.Count -ne 1) { Stop-With 4 "Live Dialpad not unique: $($live.Count) forms hold one number field. Nothing was clicked." }
  $formH = [IntPtr]$live[0]
  $field = [IntPtr](Get-Edits $formH)[0].Current.NativeWindowHandle
  if (-not $structureOnly -and $N::GetText($field) -cne $Number) { Stop-With 9 "The Dialpad does not hold exactly $Number. Nothing was clicked." }

  # ---- 3. Make Call: the one full-width panel below the one 12-key grid ----
  $script:grids = @()
  function Find-Grid($el, [int]$d) { if ($d -gt 30) { return }
    $kids = @(); $ch = $W.GetFirstChild($el); while ($ch -ne $null) { $kids += $ch; $ch = $W.GetNextSibling($ch) }
    if ($kids.Count -ge 13) {
      $keys = @($kids | Where-Object { $q = Get-Rc ([IntPtr]$_.Current.NativeWindowHandle); ($q.R - $q.L) -lt 200 -and ($q.B - $q.T) -lt 80 })
      if ($keys.Count -eq 12) { $script:grids += , @($kids, $keys) } }
    foreach ($k in $kids) { Find-Grid $k ($d + 1) } }
  Find-Grid $A::FromHandle($formH) 0
  if ($script:grids.Count -ne 1) { Stop-With 8 "Keypad not unique ($($script:grids.Count)). Nothing was clicked." }
  $kids = $script:grids[0][0]
  $kr = @($script:grids[0][1] | ForEach-Object { Get-Rc ([IntPtr]$_.Current.NativeWindowHandle) })
  $gL = ($kr | ForEach-Object L | Measure-Object -Minimum).Minimum
  $gR = ($kr | ForEach-Object R | Measure-Object -Maximum).Maximum
  $gB = ($kr | ForEach-Object B | Measure-Object -Maximum).Maximum
  $wide = @($kids | Where-Object { $h = [IntPtr]$_.Current.NativeWindowHandle; $q = Get-Rc $h
    ($q.R - $q.L) -ge 0.9 * ($gR - $gL) -and $q.T -ge $gB -and $N::IsWindowVisible($h) })
  if ($wide.Count -ne 1) { Stop-With 8 "Make Call panel not unique ($($wide.Count)). Nothing was clicked." }
  $target = [IntPtr]$wide[0].Current.NativeWindowHandle
  $rect = Get-Rc $target
  $status = @($A::FromHandle($formH).FindAll([System.Windows.Automation.TreeScope]::Descendants,
    (New-Object System.Windows.Automation.PropertyCondition($A::NameProperty, 'Unknown'))) | ForEach-Object { $N::GetParent([IntPtr]$_.Current.NativeWindowHandle) })
  if (@($status | Where-Object { $target -eq $_ -or $N::IsChild($_, $target) }).Count) { Stop-With 8 "The candidate panel is inside the call-status panel. Nothing was clicked." }
  if (-not ($N::IsWindowVisible($target) -and $N::IsWindowEnabled($target))) { Stop-With 8 "Make Call is not visible and enabled. Nothing was clicked." }

  # ---- 4. Recheck immediately before the click ----
  $now = Get-Rc $target
  $same = ($now.L -eq $rect.L -and $now.T -eq $rect.T -and $now.R -eq $rect.R -and $now.B -eq $rect.B)
  $ok = $N::IsWindow($target) -and $N::IsWindowVisible($target) -and $N::IsWindowEnabled($target) -and $N::IsWindowVisible($formH) -and $N::IsChild($formH, $target) -and $same
  if (-not $ok) { Stop-With 9 "Make Call changed before the click. Nothing was clicked." }
  Wait-TestPause 'before final number check'
  if ($structureOnly) {
    $wr = Get-Rc ([IntPtr]$mainEl.Current.NativeWindowHandle); $fr = Get-Rc $field
    Write-Host ("DIALPAD CHECK PASSED: one visible AirDroid Dialpad window ({0}x{1} at {2},{3}); number field visible ({4}x{5}); Make Call identified, visible and enabled ({6}x{7}). Nothing was typed or clicked; no call." -f ($wr.R - $wr.L), ($wr.B - $wr.T), $wr.L, $wr.T, ($fr.R - $fr.L), ($fr.B - $fr.T), ($now.R - $now.L), ($now.B - $now.T)) -ForegroundColor Green
    exit 0
  }
  if ($N::GetText($field) -cne $Number) { Stop-With 9 "The Dialpad number changed before the click. Nothing was clicked." }
  if ($CheckOnly) { Write-Host "CHECK ONLY: Make Call identified (panel $target) and $Number is in the Dialpad; nothing was clicked." -ForegroundColor Green; exit 0 }

  Wait-TestPause 'before dispatch'

  # ---- 5. Record the dial (so a second launch is refused), then one click ----
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $GuardFile) | Out-Null
  [ordered]@{ number = $Number; at = (Get-Date).ToUniversalTime().ToString('o') } | ConvertTo-Json -Compress | Set-Content -LiteralPath $GuardFile -Encoding UTF8
  $cr = New-Object IaosDialCall.N+RC; [void]$N::GetClientRect($target, [ref]$cr)
  $x = [int](($cr.R - $cr.L) / 2); $y = [int](($cr.B - $cr.T) / 2); $lp = [IntPtr](($y -shl 16) -bor ($x -band 0xFFFF))
  [void]$N::PostMessage($target, 0x0200, [IntPtr]::Zero, $lp)   # WM_MOUSEMOVE
  [void]$N::PostMessage($target, 0x0201, [IntPtr]1, $lp)        # WM_LBUTTONDOWN
  Start-Sleep -Milliseconds 80
  [void]$N::PostMessage($target, 0x0202, [IntPtr]::Zero, $lp)   # WM_LBUTTONUP
  Write-Host "CLICK SENT ONCE to Make Call for $Number. No retry." -ForegroundColor Green

  # B14-13 visible Dialpad (Brad, 2026-10-12): AirDroid is left exactly as it is -- visible beside IAOS. Nothing is
  # minimised, moved or brought forward. IAOS does not know whether the call connected; check your phone.
  Write-Host 'AirDroid left as it was (visible). IAOS does not know whether the call connected; check your phone.'
  exit 0
}
catch {
  Write-Host "DIAL STOPPED: unexpected error: $($_.Exception.Message)" -ForegroundColor Red
  exit 7
}
finally {
  if ($mutex) { $mutex.ReleaseMutex(); $mutex.Dispose() }
}
