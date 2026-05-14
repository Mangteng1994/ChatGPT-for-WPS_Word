$ErrorActionPreference = "Stop"

$installScript = Join-Path $PSScriptRoot "install-wps-codex.ps1"
$stopScript = Join-Path $PSScriptRoot "stop-local-services.ps1"

if (-not (Test-Path -LiteralPath $installScript)) {
  throw "Install script not found: $installScript"
}

if (-not (Test-Path -LiteralPath $stopScript)) {
  throw "Stop script not found: $stopScript"
}

Write-Host "Stopping current local services..."
& $stopScript

Write-Host "Rebuilding local install state..."
& $installScript

Write-Host "Repair complete."
