$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'backend-process-helper.ps1')
$exe = Join-Path $root 'artifacts\backend\ai-worklog-server.exe'
$port = Get-Random -Minimum 41001 -Maximum 50000
$token = 'stage09-packaged-' + [Guid]::NewGuid().ToString('N')
$dataDir = Join-Path ([IO.Path]::GetTempPath()) ('ai-worklog-stage09-packaged-' + [Guid]::NewGuid().ToString('N'))
$rootPid = 0
$baseline = @()

try {
  if (-not (Test-Path -LiteralPath $exe)) { throw "Packaged backend is missing: $exe" }
  $baseline = @(Get-BackendPidsByPath -ExecutablePath $exe)
  New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
  $rootPid = Start-TestBackend -ExecutablePath $exe -DataDir $dataDir -Token $token -Port $port -Stage 'stage09-packaged-routes'
  Wait-BackendHealthy -Port $port -RootPid $rootPid -TimeoutSeconds 20 -Stage 'stage09-packaged-routes' | Out-Null
  $health = Invoke-RestMethod "http://127.0.0.1:$port/health" -TimeoutSec 5
  if ($health.features -notcontains 'ai-summary-generation-v1') { throw 'Packaged backend does not advertise ai-summary-generation-v1' }
  $paths = (Invoke-RestMethod "http://127.0.0.1:$port/openapi.json" -TimeoutSec 5).paths.PSObject.Properties.Name
  $required = @('/ai/context-packages/{context_id}/summary-generations','/ai/generation-jobs/{job_id}','/ai/generation-jobs/{job_id}/cancel','/tasks/{task_id}/ai/summary-drafts','/ai/summary-drafts/{draft_id}')
  foreach ($route in $required) { if ($paths -notcontains $route) { throw "Missing Stage 09 packaged route: $route" } }
  Write-Output 'PACKAGED_STAGE09_ROUTES=PASS'
} finally {
  if ($rootPid -gt 0) { try { Stop-TestBackendTree -RootPid $rootPid -TimeoutSeconds 10 -Port $port -ExecutablePath $exe -Token $token -ProtectedPids $baseline | Out-Null } catch {} }
  if (Test-Path -LiteralPath $dataDir) { Remove-Item -LiteralPath $dataDir -Recurse -Force -ErrorAction SilentlyContinue }
}
