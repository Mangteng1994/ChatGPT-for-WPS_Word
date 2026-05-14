$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")

Start-Process -FilePath "powershell.exe" -ArgumentList @(
  "-NoExit",
  "-ExecutionPolicy",
  "Bypass",
  "-File",
  (Join-Path $PSScriptRoot "start-local-services.ps1")
) -WorkingDirectory $root -WindowStyle Minimized
