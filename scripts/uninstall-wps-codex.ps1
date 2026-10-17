$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "wps-codex-exe.ps1")

# The repo tree is never deleted; an installed copy cleans up its own directory.
Invoke-WpsCodex -Arguments @("uninstall", "--keep-files")
