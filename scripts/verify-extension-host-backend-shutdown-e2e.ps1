$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location (Join-Path $root 'apps\vscode-extension')
try {
  npm.cmd run compile
  if ($LASTEXITCODE -ne 0) { throw 'Extension compile failed' }
  node test/runBackendShutdownE2E.js
  if ($LASTEXITCODE -ne 0) { throw 'Backend shutdown Extension Host E2E failed' }
  Write-Output 'EXTENSION_HOST_BACKEND_SHUTDOWN_E2E=PASS'
} finally { Pop-Location }
