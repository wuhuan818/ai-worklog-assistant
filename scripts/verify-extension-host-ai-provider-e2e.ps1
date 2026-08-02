$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$extension = Join-Path $root 'apps\vscode-extension'
try {
  & powershell.exe -ExecutionPolicy Bypass -File (Join-Path $root 'scripts\build-backend.ps1')
  Push-Location $extension
  npm.cmd run compile
  npm.cmd run test:e2e:ai-provider
  if ($LASTEXITCODE -ne 0) { throw "AI Provider Extension Host E2E failed: $LASTEXITCODE" }
} finally { Pop-Location }
