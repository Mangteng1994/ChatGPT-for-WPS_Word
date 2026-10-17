$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "wps-codex-exe.ps1")

# Repair = stop the running processes, then run the full install again.
Write-Host "Stopping current local services..."
Invoke-WpsCodex -Arguments @("services", "stop")

Write-Host "Rebuilding local install state..."
Invoke-WpsCodex -Arguments @("install")

Write-Host "Repair complete."
