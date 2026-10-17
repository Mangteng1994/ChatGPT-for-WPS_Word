$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "wps-codex-exe.ps1")

# 'install' registers the WPS add-in, creates the logon autostart task,
# and starts the local services.
Invoke-WpsCodex -Arguments @("install")
