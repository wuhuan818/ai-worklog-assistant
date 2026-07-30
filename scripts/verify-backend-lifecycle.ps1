$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'backend-process-helper.ps1')
$exe = Join-Path $root 'artifacts\backend\ai-worklog-server.exe'
$port = Get-Random -Minimum 18000 -Maximum 28000
$token = 'stage-02-' + [Guid]::NewGuid().ToString('N')
$dataDir = Join-Path ([IO.Path]::GetTempPath()) ('ai-worklog-lifecycle-' + [Guid]::NewGuid().ToString('N'))
$rootPid = 0
$baseline = @(Get-BackendPidsByPath -ExecutablePath $exe)

function Pass([string]$Name, [bool]$Condition, [string]$Detail='') {
  if (-not $Condition) { throw "$Name failed $Detail" }
  Write-Output "$Name=PASS"
}

try {
  if (-not (Test-Path -LiteralPath $exe)) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'scripts\build-backend.ps1')
  }
  Pass 'PYINSTALLER_BUILD' (Test-Path -LiteralPath $exe) $exe
  New-Item -ItemType Directory -Force -Path $dataDir | Out-Null

  $rootPid = Start-TestBackend -ExecutablePath $exe -DataDir $dataDir -Token $token -Port $port -Stage 'first'
  Pass 'START' (@(Get-BackendProcessTree -RootPid $rootPid).Count -gt 0) "root PID $rootPid"
  Wait-BackendHealthy -Port $port -RootPid $rootPid -TimeoutSeconds 15 -Stage 'first'
  Start-Sleep -Seconds 5
  $unauthorized = $false
  try { Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$port/projects" -TimeoutSec 2 | Out-Null }
  catch { $response = $_.Exception.Response; $unauthorized = $null -ne $response -and [int]$response.StatusCode -eq 401 }
  Pass 'TOKEN_REJECTION' $unauthorized
  $authorized = Invoke-WebRequest -UseBasicParsing -Headers @{ Authorization = "Bearer $token" } -Uri "http://127.0.0.1:$port/projects" -TimeoutSec 2
  Pass 'TOKEN_ACCEPTANCE' ($authorized.StatusCode -eq 200)
  Pass 'USER_DATA_DIR' (Test-Path -LiteralPath (Join-Path $dataDir 'worklog.db')) $dataDir
  Stop-TestBackendTree -RootPid $rootPid -TimeoutSeconds 10 -Port $port -ExecutablePath $exe -ProtectedPids $baseline
  Pass 'DATA_PRESERVED_AFTER_STOP' (Test-Path -LiteralPath (Join-Path $dataDir 'worklog.db'))

  $firstPid = $rootPid
  $rootPid = Start-TestBackend -ExecutablePath $exe -DataDir $dataDir -Token $token -Port $port -Stage 'restart'
  Pass 'RESTART' ($rootPid -ne $firstPid) "old=$firstPid new=$rootPid"
  Wait-BackendHealthy -Port $port -RootPid $rootPid -TimeoutSeconds 15 -Stage 'restart'
  Start-Sleep -Seconds 5
  Stop-TestBackendTree -RootPid $rootPid -TimeoutSeconds 10 -Port $port -ExecutablePath $exe -ProtectedPids $baseline
  $rootPid = 0
  Assert-NoBackendProcess -ExecutablePath $exe -AllowedPids $baseline
  Write-Output 'BACKEND_LIFECYCLE=PASS'
} catch {
  Write-Error "BACKEND_LIFECYCLE=FAIL: $($_.Exception.Message)"
  exit 1
} finally {
  if ($rootPid -gt 0) { try { Stop-TestBackendTree -RootPid $rootPid -TimeoutSeconds 10 -Port $port -ExecutablePath $exe -ProtectedPids $baseline } catch { Write-Error "cleanup failed: $($_.Exception.Message)" } }
  if (Test-Path -LiteralPath $dataDir) { Remove-Item -LiteralPath $dataDir -Recurse -Force -ErrorAction SilentlyContinue }
}
