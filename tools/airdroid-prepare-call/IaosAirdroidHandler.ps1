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

  INTERIM: the single Make Call activation step is designed (docs/B14-13_AIRDROID_PREPARE_CALL.md) but paused, so
  this handler currently runs only the reviewed prefill helper, PrepareCall.ps1: it replaces the number in AirDroid's
  already-open Dialpad and verifies the readback. It never dials, never presses Enter and never touches Make Call or
  End Call.

  -ParseOnly prints the parsed number (or the refusal) and touches nothing. It is used by the offline tests.

.NOTES
  Exit codes: 0 prepared (or parse OK with -ParseOnly); 20 link refused; PrepareCall.ps1's own codes otherwise.
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

$helper = Join-Path $PSScriptRoot 'PrepareCall.ps1'
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $helper -Number $number
$code = $LASTEXITCODE
if ($code -ne 0 -and -not $NoPause) { Read-Host 'Press Enter to close this window' | Out-Null }
exit $code
