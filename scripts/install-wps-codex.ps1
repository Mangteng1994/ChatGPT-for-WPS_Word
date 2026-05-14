$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$taskName = "CodexForWpsWord-AutoStart"
$startScript = Join-Path $PSScriptRoot "start-local-services.ps1"
$checkScript = Join-Path $PSScriptRoot "check-local-services.ps1"
$registerScript = Join-Path $PSScriptRoot "register-wps-addin.ps1"

function Ensure-Path([string]$PathValue, [string]$Label) {
  if (-not (Test-Path -LiteralPath $PathValue)) {
    throw "$Label not found: $PathValue"
  }
}

function Set-AutoStartTask {
  $psExe = (Get-Command powershell.exe -ErrorAction Stop).Source
  $taskCommand = "`"$psExe`" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$startScript`""
  $runUser = "$env:USERDOMAIN\$env:USERNAME"
  $hasScheduledTaskCmdlets = $null -ne (Get-Command Get-ScheduledTask -ErrorAction SilentlyContinue)

  if ($hasScheduledTaskCmdlets) {
    $existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($existingTask) {
      try {
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction Stop
      } catch {
        Write-Host "Existing task delete skipped: $($_.Exception.Message)"
      }
    }

    $action = New-ScheduledTaskAction -Execute $psExe -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$startScript`""
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $runUser
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description "Autostart local services for Codex for WPS Word" -Force | Out-Null
    return
  }

  cmd.exe /d /c "schtasks /Delete /TN `"$taskName`" /F >nul 2>nul" | Out-Null
  cmd.exe /d /c "schtasks /Create /TN `"$taskName`" /SC ONLOGON /IT /RL LIMITED /RU `"$runUser`" /TR `"$taskCommand`" /F" | Out-Null
}

Ensure-Path $startScript "Start script"
Ensure-Path $checkScript "Health check script"
Ensure-Path $registerScript "Register script"

Write-Host "Project root: $root"
Write-Host "Registering WPS add-in..."
& $registerScript

Write-Host "Creating autostart task: $taskName"
Set-AutoStartTask

Write-Host "Starting local services..."
& $startScript

Write-Host "Running health check..."
& $checkScript

Write-Host ""
Write-Host "Install complete."
Write-Host "Auto-start task: $taskName"
