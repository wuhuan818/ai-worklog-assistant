$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$extensionRoot = Join-Path $root 'apps\vscode-extension'
$runner = Join-Path $extensionRoot 'test\runAiSummarySmokeE2E.js'

Push-Location $extensionRoot
try {
  npm.cmd run compile
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  if (-not (Test-Path -LiteralPath $runner)) {
    throw 'Stage 09 Extension Host smoke runner is missing. This verifier does not claim a passing E2E without a loaded suite.'
  }
  & node.exe $runner
  if ($LASTEXITCODE -ne 0) { throw "Stage 09 Extension Host smoke failed: $LASTEXITCODE" }
  Write-Output 'STAGE09_EXTENSION_HOST_SMOKE=PASS'
} finally { Pop-Location }
