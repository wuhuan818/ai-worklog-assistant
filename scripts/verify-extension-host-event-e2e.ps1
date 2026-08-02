$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$extension = Join-Path $root 'apps\vscode-extension'
$reportDir = Join-Path $root 'artifacts\test-results'
$report = Join-Path $reportDir 'stage04-extension-host-e2e.json'
$deadline = [DateTime]::UtcNow.AddMinutes(5)
try {
  if (-not (Test-Path -LiteralPath (Join-Path $root 'artifacts\backend\ai-worklog-server.exe'))) { & powershell.exe -ExecutionPolicy Bypass -File (Join-Path $root 'scripts\build-backend.ps1') }
  & powershell.exe -ExecutionPolicy Bypass -File (Join-Path $root 'scripts\build-extension.ps1')
  if ($LASTEXITCODE -ne 0) { throw "build-extension failed with exit code $LASTEXITCODE" }
  Push-Location $extension
  npm.cmd run test:e2e:event-capture
  $exitCode = $LASTEXITCODE
  Pop-Location
  if ($exitCode -ne 0) { throw "Extension Host E2E failed with exit code $exitCode" }
  if (-not (Test-Path -LiteralPath $report)) { throw "E2E report missing: $report" }
  $result = Get-Content -LiteralPath $report -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($result.status -notlike 'passed*') { throw "E2E report status was $($result.status)" }
  if ([DateTime]::UtcNow -gt $deadline) { throw 'E2E exceeded five-minute timeout' }
  Write-Output 'STAGE4_EXTENSION_HOST_E2E=PASS'
} catch { Write-Error "STAGE4_EXTENSION_HOST_E2E=FAIL: $($_.Exception.Message)"; exit 1 }
