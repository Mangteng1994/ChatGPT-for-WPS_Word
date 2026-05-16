$ErrorActionPreference = "Stop"

$services = @(
  @{ Name = "WPS add-in host"; Url = "http://127.0.0.1:3889/__codex/service/ping"; Method = "POST"; Body = "{}"; Expected = '"ok":true' },
  @{ Name = "codex bridge"; Url = "http://127.0.0.1:32123/health"; Expected = '"service":"codex-bridge"' },
  @{ Name = "WPS panel"; Url = "http://127.0.0.1:5173/index.html"; Expected = "Codex for WPS Word" }
)

$failed = @()

foreach ($service in $services) {
  try {
    $method = if ($service.Method) { [string]$service.Method } else { "GET" }
    $body = if ($service.Body) { [string]$service.Body } else { "" }
    $params = @{
      Uri = $service.Url
      UseBasicParsing = $true
      TimeoutSec = 3
      Method = $method
    }
    if ($method -ne "GET" -and $method -ne "HEAD") {
      $params.Body = $body
      $params.ContentType = "application/json"
    }
    $response = Invoke-WebRequest @params
    $content = [string]$response.Content
    if ($response.StatusCode -eq 200 -and $content.Contains($service.Expected)) {
      Write-Host "OK: $($service.Name) $($service.Url)"
    } else {
      $failed += "$($service.Name) returned unexpected content from $($service.Url)"
    }
  } catch {
    $failed += "$($service.Name) is not reachable at $($service.Url): $($_.Exception.Message)"
  }
}

if ($failed.Count -gt 0) {
  Write-Host "FAILED:"
  foreach ($item in $failed) {
    Write-Host "- $item"
  }
  exit 1
}

Write-Host "All local Codex services are healthy."
