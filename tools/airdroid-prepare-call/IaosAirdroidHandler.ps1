<#
.SYNOPSIS
  B14-13: handler for the IAOS AirDroid Call launch link.

.DESCRIPTION
  Windows passes the whole link as one argument when a registered "iaos-airdroid:" link is opened. This handler:
    1. Parses the link strictly. Exactly one form is accepted:
         iaos-airdroid:call?number=NNNNNNNNNN
       where NNNNNNNNNN is a 10-digit US number whose area code and exchange start with 2-9.
       Anything else (extra parameters, other actions, letters, extensions, encoded characters) is refused.
    2. Passes the 10 digits to PrepareCall.ps1 (same folder) as a named parameter, never by string
       concatenation into a command line.

    3. Runs the reviewed prefill helper, PrepareCall.ps1, which places the number in AirDroid's already-open Dialpad
       and verifies the exact readback.
    4. Only if that succeeds, runs DialCall.ps1 with the same digits: it rechecks the number, identifies Make Call,
       clicks it once (no retry) and refuses a duplicate dial. Brad's one IAOS Call click is the authorization; there
       is no second confirmation. End Call and Enter are never touched.

  -ParseOnly prints the parsed number (or the refusal) and touches nothing. It is used by the offline tests.

.NOTES
  Exit codes: 0 click sent once (or parse OK with -ParseOnly); 20 link refused; otherwise PrepareCall.ps1's code if
  it failed (nothing dialled), else DialCall.ps1's code.
#>
param(
  [Parameter(Position = 0)][string]$Uri = '',
  [switch]$ParseOnly,
  [switch]$NoPause
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

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'PrepareCall.ps1') -Number $number
$code = $LASTEXITCODE
if ($code -eq 0) {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'DialCall.ps1') -Number $number
  $code = $LASTEXITCODE
}
if ($code -ne 0 -and -not $NoPause) { Read-Host 'Press Enter to close this window' | Out-Null }
exit $code
