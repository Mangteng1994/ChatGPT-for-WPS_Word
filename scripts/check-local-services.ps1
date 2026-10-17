$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "wps-codex-exe.ps1")

Invoke-WpsCodex -Arguments @("services", "check")
