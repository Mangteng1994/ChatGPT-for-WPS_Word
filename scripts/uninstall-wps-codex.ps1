$ErrorActionPreference = "Stop"

$taskName = "CodexForWpsWord-AutoStart"
$addonName = "codex-for-wps-word-local-addin"
$addonType = "wps"
$publishXmlPath = Join-Path $env:APPDATA "kingsoft\wps\jsaddons\publish.xml"
$stopScript = Join-Path $PSScriptRoot "stop-local-services.ps1"

function Remove-AutostartTask {
  $hasScheduledTaskCmdlets = $null -ne (Get-Command Get-ScheduledTask -ErrorAction SilentlyContinue)
  if ($hasScheduledTaskCmdlets) {
    $existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($existingTask) {
      Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction Stop
      Write-Host "Removed autostart task: $taskName"
    } else {
      Write-Host "Autostart task not found. Skip."
    }
    return
  }

  cmd.exe /d /c "schtasks /Delete /TN `"$taskName`" /F >nul 2>nul" | Out-Null
  Write-Host "Removed autostart task (schtasks): $taskName"
}

function Remove-AddonRegistration {
  if (-not (Test-Path -LiteralPath $publishXmlPath)) {
    Write-Host "publish.xml not found. Skip add-in unregister."
    return
  }

  [xml]$xml = Get-Content -LiteralPath $publishXmlPath -Raw
  $rootNode = $xml.SelectSingleNode("/jsplugins")
  if ($null -eq $rootNode) {
    Write-Host "publish.xml has no jsplugins node. Skip add-in unregister."
    return
  }

  $removed = $false
  $nodes = @($rootNode.SelectNodes("jspluginonline"))
  foreach ($node in $nodes) {
    if ($null -eq $node) { continue }
    if ($node.GetAttribute("name") -eq $addonName -and $node.GetAttribute("type") -eq $addonType) {
      [void]$rootNode.RemoveChild($node)
      $removed = $true
    }
  }

  if ($removed) {
    $settings = New-Object System.Xml.XmlWriterSettings
    $settings.Indent = $true
    $settings.Encoding = New-Object System.Text.UTF8Encoding($false)
    $writer = [System.Xml.XmlWriter]::Create($publishXmlPath, $settings)
    $xml.Save($writer)
    $writer.Close()
    Write-Host "Removed WPS add-in registration: $addonName"
  } else {
    Write-Host "WPS add-in registration not found. Skip."
  }
}

if (Test-Path -LiteralPath $stopScript) {
  Write-Host "Stopping local services..."
  & $stopScript
}

Write-Host "Removing autostart task..."
Remove-AutostartTask

Write-Host "Removing WPS add-in registration..."
Remove-AddonRegistration

Write-Host "Uninstall complete."
