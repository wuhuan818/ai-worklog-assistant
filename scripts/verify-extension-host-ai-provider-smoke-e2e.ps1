$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location (Join-Path $root 'apps\vscode-extension')
try {
  npm.cmd run compile
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  npm.cmd run test:e2e:ai-provider-smoke
  if ($LASTEXITCODE -ne 0) { throw "AI Provider smoke E2E failed: $LASTEXITCODE" }
} finally { Pop-Location }
