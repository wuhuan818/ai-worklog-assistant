$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'backend-process-helper.ps1')
$exe = Join-Path $root 'artifacts\backend\ai-worklog-server.exe'
$baseline = @(Get-BackendPidsByPath -ExecutablePath $exe)
$rootDir = Join-Path ([IO.Path]::GetTempPath()) ('ai-worklog-multi-instance-' + [guid]::NewGuid().ToString('N'))
$pidA = 0; $pidB = 0
try {
  if (-not (Test-Path -LiteralPath $exe)) { throw "Packaged backend is required: $exe" }
  New-Item -ItemType Directory -Force -Path $rootDir | Out-Null
  $portA = Get-Random -Minimum 39000 -Maximum 43000; $portB = $portA + 1
  $tokenA = 'instance-a-' + [guid]::NewGuid().ToString('N'); $tokenB = 'instance-b-' + [guid]::NewGuid().ToString('N')
  $pidA = Start-TestBackend -ExecutablePath $exe -DataDir (Join-Path $rootDir 'a') -Token $tokenA -Port $portA -Stage 'instance-a'
  $pidB = Start-TestBackend -ExecutablePath $exe -DataDir (Join-Path $rootDir 'b') -Token $tokenB -Port $portB -Stage 'instance-b'
  Wait-BackendHealthy -Port $portA -RootPid $pidA -TimeoutSeconds 10 -Stage 'instance-a'
  Wait-BackendHealthy -Port $portB -RootPid $pidB -TimeoutSeconds 10 -Stage 'instance-b'
  $result = Invoke-RestMethod -Method Post -Headers @{ Authorization = "Bearer $tokenA" } -ContentType 'application/json' -Body '{"generation":0}' -Uri "http://127.0.0.1:$portA/runtime/shutdown" -TimeoutSec 2
  if (-not $result.accepted -or -not (Wait-BackendProcessTreeExit -RootPid $pidA -TimeoutSeconds 10 -Port $portA)) { throw 'Instance A did not exit gracefully' }
  $pidA = 0
  $healthB = Invoke-RestMethod -Headers @{ Authorization = "Bearer $tokenB" } -Uri "http://127.0.0.1:$portB/health" -TimeoutSec 2
  if ($healthB.status -ne 'ok') { throw 'Closing instance A interrupted instance B' }
  $result = Invoke-RestMethod -Method Post -Headers @{ Authorization = "Bearer $tokenB" } -ContentType 'application/json' -Body '{"generation":0}' -Uri "http://127.0.0.1:$portB/runtime/shutdown" -TimeoutSec 2
  if (-not $result.accepted -or -not (Wait-BackendProcessTreeExit -RootPid $pidB -TimeoutSeconds 10 -Port $portB)) { throw 'Instance B did not exit gracefully' }
  $pidB = 0
  Assert-NoBackendProcess -ExecutablePath $exe -AllowedPids $baseline
  Write-Output 'BACKEND_MULTI_INSTANCE_ISOLATION=PASS'
} catch { Write-Error "BACKEND_MULTI_INSTANCE_ISOLATION=FAIL: $($_.Exception.Message)"; exit 1 }
finally {
  foreach ($ownedPid in @($pidA,$pidB)) { if ($ownedPid -gt 0) { try { & taskkill.exe /PID $ownedPid /T /F *> $null } catch { } } }
  Remove-Item -LiteralPath $rootDir -Recurse -Force -ErrorAction SilentlyContinue
}
