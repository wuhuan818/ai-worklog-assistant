param([switch]$SkipBuild)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$report = Join-Path $root 'artifacts\test-results\stage06-data-continuity.json'
try {
  if (-not $SkipBuild) {
    & (Join-Path $PSScriptRoot 'build-backend.ps1')
    if ($LASTEXITCODE) { throw 'build-backend failed' }
  }
  Push-Location (Join-Path $root 'apps\vscode-extension')
  npm.cmd run compile
  if ($LASTEXITCODE) { throw 'extension compile failed' }
  $e2eSucceeded = $false
  for ($attempt = 1; $attempt -le 3; $attempt++) {
    npm.cmd run test:e2e:data-continuity
    if ($LASTEXITCODE -eq 0) { $e2eSucceeded = $true; break }
    Write-Warning "data continuity E2E transient host failure on attempt $attempt"
  }
  if (-not $e2eSucceeded) { throw 'data continuity E2E failed after 3 attempts' }
  Pop-Location
  $result = Get-Content -Raw -Encoding UTF8 $report | ConvertFrom-Json
  if ($result.status -ne 'passed' -or -not $result.sameWorkspaceRecovered -or -not $result.crossWorkspaceConflictDetected -or $result.crossWorkspaceEventLeakCount -ne 0) { throw 'machine report did not satisfy continuity contract' }
  'DATA_CONTINUITY=PASS'
} catch {
  try { Pop-Location } catch {}
  Write-Error "DATA_CONTINUITY=FAIL: $($_.Exception.Message)"
  exit 1
}
