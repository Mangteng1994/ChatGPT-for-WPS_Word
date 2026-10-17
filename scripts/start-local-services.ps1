$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "wps-codex-exe.ps1")

# Register the WPS add-in first (idempotent), then bring the local services up.
Invoke-WpsCodex -Arguments @("register")
Invoke-WpsCodex -Arguments @("services", "start")
