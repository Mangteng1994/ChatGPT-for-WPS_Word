$ErrorActionPreference = "Stop"

# Stops the bridge (and legacy panel ports) but keeps the 3889 add-in host alive,
# so the WPS ribbon "start local services" action can still answer.
. (Join-Path $PSScriptRoot "wps-codex-exe.ps1")

Invoke-WpsCodex -Arguments @("services", "stop")
