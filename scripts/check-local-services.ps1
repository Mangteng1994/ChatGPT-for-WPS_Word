$ErrorActionPreference = "Stop"

$services = @(
  @{ Name = "WPS add-in host"; Url = "http://127.0.0.1:3889/"; Expected = "Codex Local Addin Entry" },
  @{ Name = "codex bridge"; Url = "http://127.0.0.1:32123/health"; Expected = '"service":"codex-bridge"' },
  @{ Name = "WPS panel"; Url = "http://127.0.0.1:5173/index.html"; Expected = "Codex for WPS Word" }
)

$failed = @()

foreach ($service in $services) {
  try {
    $response = Invoke-WebRequest -Uri $service.Url -UseBasicParsing -TimeoutSec 3
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
