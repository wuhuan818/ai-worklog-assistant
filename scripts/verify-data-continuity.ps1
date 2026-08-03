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
  npm.cmd run test:e2e:data-continuity
  if ($LASTEXITCODE) { throw 'data continuity E2E failed; rerun only after inspecting its preserved diagnostics' }
  Pop-Location
  $result = Get-Content -Raw -Encoding UTF8 $report | ConvertFrom-Json
  if ($result.status -ne 'passed' -or -not $result.sameWorkspaceRecovered -or -not $result.crossWorkspaceConflictDetected -or $result.crossWorkspaceEventLeakCount -ne 0) { throw 'machine report did not satisfy continuity contract' }
  'DATA_CONTINUITY=PASS'
} catch {
  try { Pop-Location } catch {}
  Write-Error "DATA_CONTINUITY=FAIL: $($_.Exception.Message)"
  exit 1
}
