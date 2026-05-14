$ErrorActionPreference = "Stop"

$addonName = "codex-for-wps-word-local-addin"
$addonType = "wps"
$addonUrl = "http://127.0.0.1:3889/"

$publishDir = Join-Path $env:APPDATA "kingsoft\wps\jsaddons"
$publishXmlPath = Join-Path $publishDir "publish.xml"

New-Item -ItemType Directory -Path $publishDir -Force | Out-Null

if (Test-Path -LiteralPath $publishXmlPath) {
  try {
    [xml]$xml = Get-Content -LiteralPath $publishXmlPath -Raw
  } catch {
    $xml = New-Object System.Xml.XmlDocument
    $xml.LoadXml('<?xml version="1.0" encoding="UTF-8"?><jsplugins></jsplugins>')
  }
} else {
  $xml = New-Object System.Xml.XmlDocument
  $xml.LoadXml('<?xml version="1.0" encoding="UTF-8"?><jsplugins></jsplugins>')
}

if ($null -eq $xml.SelectSingleNode("/jsplugins")) {
  $xml.RemoveAll()
  $declaration = $xml.CreateXmlDeclaration("1.0", "UTF-8", $null)
  [void]$xml.AppendChild($declaration)
  $root = $xml.CreateElement("jsplugins")
  [void]$xml.AppendChild($root)
}

$rootNode = $xml.SelectSingleNode("/jsplugins")
$nodes = @($rootNode.SelectNodes("jspluginonline"))

$target = $null
foreach ($node in $nodes) {
  if ($node.GetAttribute("name") -eq $addonName -and $node.GetAttribute("type") -eq $addonType) {
    $target = $node
    break
  }
}

if (-not $target) {
  $target = $xml.CreateElement("jspluginonline")
  [void]$rootNode.AppendChild($target)
}

$target.SetAttribute("name", $addonName)
$target.SetAttribute("type", $addonType)
$target.SetAttribute("url", $addonUrl)
$target.SetAttribute("enable", "enable_dev")
$target.SetAttribute("debug", "")
$target.SetAttribute("install", "null")
$target.SetAttribute("customDomain", "")

$settings = New-Object System.Xml.XmlWriterSettings
$settings.Indent = $true
$settings.Encoding = New-Object System.Text.UTF8Encoding($false)
$writer = [System.Xml.XmlWriter]::Create($publishXmlPath, $settings)
$xml.Save($writer)
$writer.Close()

Write-Host "Registered WPS add-in in publish.xml: $addonName => $addonUrl"
