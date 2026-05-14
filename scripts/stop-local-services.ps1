$ErrorActionPreference = "Stop"

$ports = @(32123, 5173, 5174)
$connections = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $ports -contains $_.LocalPort }

$processIds = $connections |
  Select-Object -ExpandProperty OwningProcess -Unique |
  Where-Object { $_ -and $_ -ne $PID }

foreach ($processId in $processIds) {
  Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
}

Write-Host "Stopped local Codex bridge/panel services on ports: $($ports -join ', ')"
