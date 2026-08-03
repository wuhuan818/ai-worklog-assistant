$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location (Join-Path $root 'apps\vscode-extension')
try {
  $env:STAGE7_SMOKE_MODE = 'persistence'
  npm.cmd run test:e2e:ai-provider-smoke
  if ($LASTEXITCODE -ne 0) { throw "AI profile persistence E2E failed: $LASTEXITCODE" }
} finally { Remove-Item Env:STAGE7_SMOKE_MODE -ErrorAction SilentlyContinue; Pop-Location }
