# Shared helpers for the repo-mode PowerShell scripts.
#
# Service logic (add-in registration, start/stop, watchdog, doctor) lives inside
# the Rust executable. These scripts only locate the exe and forward arguments,
# so there is never a second implementation to keep in sync.

$script:WpsCodexRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

function Get-WpsCodexExe {
  if ($env:CODEX_RUST_BIN) {
    if (Test-Path -LiteralPath $env:CODEX_RUST_BIN) {
      return (Resolve-Path -LiteralPath $env:CODEX_RUST_BIN).Path
    }
    throw "CODEX_RUST_BIN does not exist: $env:CODEX_RUST_BIN"
  }

  $candidates = @(
    (Join-Path $script:WpsCodexRoot "services\codex-bridge-rust\target\debug\codex-for-wps-word-rust.exe"),
    (Join-Path $script:WpsCodexRoot "services\codex-bridge-rust\target\release\codex-for-wps-word-rust.exe")
  )
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) {
      return $candidate
    }
  }

  throw "Service executable not found. Run 'npm run rust:build' in the repo root first."
}

function Add-WpsCodexRuntimePath {
  # Dev builds on the gnullvm target load libunwind.dll. Make sure its directory
  # is on PATH so calling the exe directly does not fail with a missing DLL.
  $llvmBin = "C:\Tools\llvm-mingw-ucrt\bin"
  if ($env:LLVM_MINGW_BIN) {
    $llvmBin = $env:LLVM_MINGW_BIN
  }
  if ($llvmBin -and (Test-Path -LiteralPath (Join-Path -Path $llvmBin -ChildPath "libunwind.dll"))) {
    if ($env:PATH -notlike "*$llvmBin*") {
      $env:PATH = "$llvmBin;$env:PATH"
    }
  }
}

function Invoke-WpsCodex {
  param([Parameter(Mandatory = $true)][string[]]$Arguments)

  Add-WpsCodexRuntimePath
  $exe = Get-WpsCodexExe
  & $exe @Arguments
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0) {
    throw "Service command failed (exit $exitCode): $($Arguments -join ' ')"
  }
}
