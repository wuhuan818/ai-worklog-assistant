$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'backend-process-helper.ps1')
$exe = Join-Path $root 'artifacts\backend\ai-worklog-server.exe'
$port = Get-Random -Minimum 18000 -Maximum 28000
$token = 'helper-' + [Guid]::NewGuid().ToString('N')
$dataDir = Join-Path ([IO.Path]::GetTempPath()) ('ai-worklog-helper-' + [Guid]::NewGuid().ToString('N'))
$baseline = @(Get-BackendPidsByPath -ExecutablePath $exe)
$rootPid = 0
try {
  New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
  $rootPid = Start-TestBackend -ExecutablePath $exe -DataDir $dataDir -Token $token -Port $port -Stage 'helper'
  Wait-BackendHealthy -Port $port -RootPid $rootPid -TimeoutSeconds 15 -Stage 'helper'
  Stop-TestBackendTree -RootPid $rootPid -TimeoutSeconds 10 -Port $port -ExecutablePath $exe -ProtectedPids $baseline
  $rootPid = 0
  Stop-TestBackendTree -RootPid $rootPid -TimeoutSeconds 2 -Port $port -ExecutablePath $exe -ProtectedPids $baseline
  Assert-NoBackendProcess -ExecutablePath $exe -AllowedPids $baseline
  Write-Output 'BACKEND_PROCESS_HELPER=PASS'
} catch {
  Write-Error "BACKEND_PROCESS_HELPER=FAIL: $($_.Exception.Message)"
  exit 1
} finally {
  if ($rootPid -gt 0) { try { Stop-TestBackendTree -RootPid $rootPid -TimeoutSeconds 10 -Port $port -ExecutablePath $exe -ProtectedPids $baseline } catch { Write-Error "cleanup failed: $($_.Exception.Message)" } }
  if (Test-Path -LiteralPath $dataDir) { Remove-Item -LiteralPath $dataDir -Recurse -Force -ErrorAction SilentlyContinue }
}
