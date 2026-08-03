$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$extensionRoot = Join-Path $root 'apps\vscode-extension'
$runner = Join-Path $extensionRoot 'test\runAiContextSmokeE2E.js'

Push-Location $extensionRoot
try {
  npm.cmd run compile
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  if (-not (Test-Path -LiteralPath $runner)) { throw 'Stage 08 Extension Host smoke runner is missing' }
  # Invoke directly: the launcher itself uses argument arrays (no shell) and
  # its 90-second VS Code timeout.  This also avoids Start-Process inheriting
  # duplicate Windows Path/PATH entries from certain developer shells.
  & node.exe $runner
  if ($LASTEXITCODE -ne 0) { throw "Stage 08 Extension Host smoke failed: $LASTEXITCODE" }
  Write-Output 'STAGE08_EXTENSION_HOST_SMOKE=PASS'
} finally {
  Pop-Location
}
