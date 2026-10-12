<#
.SYNOPSIS
  B14-13: handler for the IAOS AirDroid Call launch link.

.DESCRIPTION
  Windows passes the whole link as one argument when a registered "iaos-airdroid:" link is opened. This handler:
    1. Parses the link strictly. Exactly one form is accepted:
         iaos-airdroid:call?number=NNNNNNNNNN
       where NNNNNNNNNN is a 10-digit US number whose area code and exchange start with 2-9.
       Anything else (extra parameters, other actions, letters, extensions, encoded characters) is refused.
    2. Takes the IAOS call lock (named mutex Local\IAOS-AirDroid-Dial, no wait) BEFORE anything touches the Dialpad,
       and holds it until the whole prepare-and-dial sequence has finished. A competing launch that finds the lock
       taken stops at once (exit 10) and changes nothing. The lock is released in a finally block on every exit path,
       before any "Press Enter" pause, so a stopped window never blocks the next call.
    3. Duplicate check: DialCall.ps1 -GuardOnly refuses the same number dialled in the last 30 seconds before the
       Dialpad is touched.
    4. Runs the reviewed prefill helper, PrepareCall.ps1 -Automatic, which places the number in AirDroid's already-open
       Dialpad and verifies the exact readback. -Automatic suppresses its "press Make Call yourself" instruction,
       which is meant only for standalone prefill.
    5. Only if that succeeds, runs DialCall.ps1 with the same digits: it rechecks the number, identifies Make Call,
       clicks it once (no retry) and records the dial for the duplicate check. Brad's one IAOS Call click is the
       authorization; there is no second confirmation. End Call and Enter are never touched.
  Steps 3 to 5 run as child processes with -CallerHoldsLock: they do not take the lock themselves (that would
  deadlock against this process), they only confirm it is held.

  The digits are passed as a named parameter, never by string concatenation into a command line.

  -ParseOnly prints the parsed number (or the refusal) and touches nothing. It is used by the offline tests.
  -TestProcessName, -TestPauseMs and -GuardFile exist only for the inert offline concurrency tests (a fake AirDroid
  window); the registered command passes none of them.

.NOTES
  Exit codes: 0 click sent once (or parse OK with -ParseOnly); 20 link refused; 10 another IAOS call is in progress
  (nothing changed) or duplicate refused; otherwise the code of the step that stopped (nothing dialled).
#>
param(
  [Parameter(Position = 0)][string]$Uri = '',
  [switch]$ParseOnly,
  [switch]$NoPause,
  [string]$TestProcessName = '',
  [int]$TestPauseMs = 0,
  [string]$GuardFile = ''
)

function Get-IaosAirdroidNumber([string]$link) {
  if ($null -eq $link) { return $null }
  $m = [regex]::Match($link.Trim(), '^iaos-airdroid:call\?number=([2-9]\d{2}[2-9]\d{6})/?$')
  if (-not $m.Success) { return $null }
  return $m.Groups[1].Value
}

$number = Get-IaosAirdroidNumber $Uri
if ($ParseOnly) {
  if ($number) { Write-Output "PARSED $number"; exit 0 }
  Write-Output 'REFUSED'; exit 20
}

if (-not $number) {
  Write-Host 'PREPARE CALL STOPPED: this link is not a valid IAOS AirDroid link. Nothing was changed.' -ForegroundColor Red
  if (-not $NoPause) { Read-Host 'Press Enter to close this window' | Out-Null }
  exit 20
}

$extra = @()
if ($TestProcessName) { $extra += @('-TestProcessName', $TestProcessName) }
$dialExtra = @() + $extra
if ($GuardFile) { $dialExtra += @('-GuardFile', $GuardFile) }
if ($TestPauseMs -gt 0) { $dialExtra += @('-TestPauseMs', $TestPauseMs) }
function Invoke-Step([string]$script, [string[]]$arguments) {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot $script) -Number $number -CallerHoldsLock @arguments | Out-Host
  return $LASTEXITCODE
}

$code = 7
$mutex = $null
$held = $false
try {
  $mutex = New-Object System.Threading.Mutex($false, 'Local\IAOS-AirDroid-Dial')
  try { $held = $mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $held = $true }
  if (-not $held) {
    Write-Host 'CALL STOPPED: another IAOS call is in progress. Nothing was changed.' -ForegroundColor Red
    $code = 10
  } else {
    $code = Invoke-Step 'DialCall.ps1' (@('-GuardOnly') + $dialExtra)
    if ($code -eq 0) { $code = Invoke-Step 'PrepareCall.ps1' (@('-Automatic') + $extra) }
    if ($code -eq 0) { $code = Invoke-Step 'DialCall.ps1' $dialExtra }
  }
}
catch {
  Write-Host "CALL STOPPED: unexpected error: $($_.Exception.Message)" -ForegroundColor Red
  $code = 7
}
finally {
  if ($held) { $mutex.ReleaseMutex() }
  if ($mutex) { $mutex.Dispose() }
}
if ($code -ne 0 -and -not $NoPause) { Read-Host 'Press Enter to close this window' | Out-Null }
exit $code
