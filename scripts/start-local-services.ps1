$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$registerScript = Join-Path $PSScriptRoot "register-wps-addin.ps1"
$addonHostScript = Join-Path $PSScriptRoot "wps-addon-host.mjs"
$logDir = Join-Path $root "logs"

New-Item -ItemType Directory -Path $logDir -Force | Out-Null

function Write-Log([string]$Message) {
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  Write-Host $line
  Add-Content -LiteralPath (Join-Path $logDir "start-local-services.log") -Value $line -Encoding UTF8
}

function Test-Port([int]$Port) {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $result = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
    if (-not $result.AsyncWaitHandle.WaitOne(300)) { return $false }
    $client.EndConnect($result)
    return $true
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

function Test-HttpContent([string]$Url, [string]$Expected) {
  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
    return ($response.StatusCode -eq 200 -and ([string]$response.Content).Contains($Expected))
  } catch {
    return $false
  }
}

function Wait-ServiceHealthy([string]$Url, [string]$Expected, [int]$TimeoutSeconds) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-HttpContent $Url $Expected) { return $true }
    Start-Sleep -Milliseconds 500
  }
  return (Test-HttpContent $Url $Expected)
}

function Get-PortOwner([int]$Port) {
  $connection = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if (-not $connection) { return $null }

  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($connection.OwningProcess)" -ErrorAction SilentlyContinue
  if (-not $process) { return $null }

  return [PSCustomObject]@{
    ProcessId = $process.ProcessId
    Name = $process.Name
    CommandLine = $process.CommandLine
  }
}

function Clear-StaleProjectProcess([int]$Port, [string]$ServiceName) {
  $owner = Get-PortOwner $Port
  if (-not $owner) { return }

  if (($owner.CommandLine -as [string]).Contains($root)) {
    Write-Log "Stopping stale ${ServiceName} owner on port ${Port}: pid=$($owner.ProcessId) $($owner.Name)"
    Stop-Process -Id $owner.ProcessId -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
    return
  }

  Write-Log "Port ${Port} is occupied by a non-project process: pid=$($owner.ProcessId) $($owner.Name) $($owner.CommandLine)"
}

function Resolve-Executable([string]$Name, [string[]]$Fallbacks) {
  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if ($cmd -and $cmd.Source) {
    return $cmd.Source
  }

  foreach ($candidate in $Fallbacks) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) {
      return $candidate
    }
  }

  throw "Cannot find executable: $Name. Checked PATH and: $($Fallbacks -join ', ')"
}

function Start-LoggedProcess(
  [string]$Name,
  [string]$FilePath,
  [string[]]$ArgumentList,
  [string]$WorkingDirectory
) {
  $safeName = $Name
  foreach ($char in [char[]]'\/:*?"<>|') {
    $safeName = $safeName.Replace([string]$char, "-")
  }
  $stdout = Join-Path $logDir "$safeName.out.log"
  $stderr = Join-Path $logDir "$safeName.err.log"
  $launcher = Join-Path $logDir "$safeName.cmd"
  Write-Log "Starting ${Name}: $FilePath $($ArgumentList -join ' ')"

  $quotedFilePath = '"' + ($FilePath -replace '"', '""') + '"'
  $quotedArgs = @()
  foreach ($arg in $ArgumentList) {
    $quotedArgs += '"' + ($arg -replace '"', '""') + '"'
  }
  $command = "$quotedFilePath $($quotedArgs -join ' ') >> ""$stdout"" 2>> ""$stderr"""
  $launcherContent = @(
    "@echo off",
    "cd /d ""$WorkingDirectory""",
    $command
  )
  Set-Content -LiteralPath $launcher -Value $launcherContent -Encoding ASCII

  Start-Process `
    -FilePath "cmd.exe" `
    -ArgumentList @("/d", "/c", "`"$launcher`"") `
    -WorkingDirectory $WorkingDirectory `
    -WindowStyle Hidden | Out-Null
}

function Start-NpmScript([string]$ScriptName) {
  $npmPath = Resolve-Executable "npm.cmd" @(
    (Join-Path $env:ProgramFiles "nodejs\npm.cmd"),
    (Join-Path ${env:ProgramFiles(x86)} "nodejs\npm.cmd"),
    (Join-Path $env:APPDATA "npm\npm.cmd")
  )
  Start-LoggedProcess "npm-$ScriptName" $npmPath @("run", $ScriptName) $root
}

function Start-AddonHost() {
  $nodePath = Resolve-Executable "node.exe" @(
    (Join-Path $env:ProgramFiles "nodejs\node.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "nodejs\node.exe")
  )
  Start-LoggedProcess "wps-addon-host" $nodePath @($addonHostScript) $root
}

Write-Log "Start requested. root=$root"

if (Test-Path -LiteralPath $registerScript) {
  Write-Log "Registering WPS add-in"
  & $registerScript
}

$serviceChecks = @(
  @{ Name = "WPS add-in host"; Port = 3889; Url = "http://127.0.0.1:3889/"; Expected = "Codex Local Addin Entry"; Starter = "addin" },
  @{ Name = "codex bridge"; Port = 32123; Url = "http://127.0.0.1:32123/health"; Expected = '"service":"codex-bridge"'; Starter = "bridge" },
  @{ Name = "WPS panel"; Port = 5173; Url = "http://127.0.0.1:5173/index.html"; Expected = "Codex for WPS Word"; Starter = "panel" }
)

foreach ($service in $serviceChecks) {
  if ((Test-Port $service.Port) -and -not (Test-HttpContent $service.Url $service.Expected)) {
    Clear-StaleProjectProcess $service.Port $service.Name
  }
}

if (-not (Test-HttpContent "http://127.0.0.1:3889/" "Codex Local Addin Entry")) {
  Start-AddonHost
} else {
  Write-Log "WPS add-in host is already healthy on port 3889"
}

if (-not (Test-HttpContent "http://127.0.0.1:32123/health" '"service":"codex-bridge"')) {
  Start-NpmScript "bridge:dev"
} else {
  Write-Log "codex bridge is already healthy on port 32123"
}

if (-not (Test-HttpContent "http://127.0.0.1:5173/index.html" "Codex for WPS Word")) {
  Start-NpmScript "panel:dev"
} else {
  Write-Log "WPS panel is already healthy on port 5173"
}

$failed = @()
foreach ($check in $serviceChecks) {
  if (Wait-ServiceHealthy $check.Url $check.Expected 20) {
    Write-Log "$($check.Name) is healthy at $($check.Url)"
  } else {
    $owner = Get-PortOwner $check.Port
    if ($owner) {
      $failed += "$($check.Name) ($($check.Port), pid=$($owner.ProcessId), $($owner.Name))"
      Write-Log "FAILED: $($check.Name) is not healthy at $($check.Url). Port owner: pid=$($owner.ProcessId) $($owner.Name) $($owner.CommandLine)"
    } else {
      $failed += "$($check.Name) ($($check.Port), no listener)"
      Write-Log "FAILED: $($check.Name) is not healthy at $($check.Url). No listener on port $($check.Port)"
    }
  }
}

if ($failed.Count -gt 0) {
  $message = "Some local services failed to start: $($failed -join ', '). Logs: $logDir"
  Write-Log $message
  throw $message
}

Write-Log "All local services are ready"
