$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $root 'artifacts\backend\ai-worklog-server.exe'
$port = 8877
$token = 'stage-02-verification-token'
$dataDir = Join-Path ([IO.Path]::GetTempPath()) ('ai-worklog-lifecycle-' + [Guid]::NewGuid().ToString('N'))
$results = [ordered]@{}
$process = $null

function Assert-Pass([string]$name, [bool]$condition, [string]$detail = '') {
  if (-not $condition) { throw "$name failed $detail" }
  $script:results[$name] = 'PASS'
  Write-Output "$name=PASS"
}

function Start-Backend {
  $env:WORKLOG_DATA_DIR = $dataDir
  $env:WORKLOG_SESSION_TOKEN = $token
  $env:WORKLOG_PORT = [string]$port
  $info = [Diagnostics.ProcessStartInfo]::new()
  $info.FileName = $exe
  $info.WorkingDirectory = Split-Path -Parent $exe
  $info.UseShellExecute = $false
  $info.CreateNoWindow = $true
  $started = [Diagnostics.Process]::new()
  $started.StartInfo = $info
  if (-not $started.Start()) { throw 'unable to start backend executable' }
  $script:process = $started
}

function Get-Health {
  Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$port/health" -TimeoutSec 2
}

function Wait-Healthy {
  for ($i = 0; $i -lt 40; $i++) {
    try {
      $response = Get-Health
      if ($response.StatusCode -eq 200 -and $response.Content -match '"status"\s*:\s*"ok"') { return $true }
    } catch {
      if ($process.HasExited) { throw "backend exited before health check (code $($process.ExitCode))" }
    }
    Start-Sleep -Milliseconds 250
  }
  return $false
}

function Stop-OwnedBackend {
  if ($null -eq $process) { return }
  if ($process.HasExited) { return }
  # PyInstaller one-file creates a child process. Kill only this launcher's
  # PID tree; never terminate by image name, which could affect another user.
  $ownedPid = $process.Id
  $oldPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  & taskkill.exe /PID $ownedPid /T /F *> $null
  $ErrorActionPreference = $oldPreference
  if (-not $process.WaitForExit(5000)) { throw "owned backend PID $($process.Id) did not exit" }
}

function Get-ArtifactProcesses {
  Get-Process ai-worklog-server -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe }
}

try {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'scripts\build-backend.ps1')
  Assert-Pass 'PYINSTALLER_BUILD' (Test-Path -LiteralPath $exe) $exe
  New-Item -ItemType Directory -Force -Path $dataDir | Out-Null

  Start-Backend
  Assert-Pass 'START' (-not $process.HasExited) "PID $($process.Id)"
  Assert-Pass 'HEALTH_FIRST_START' (Wait-Healthy)
  $unauthorized = $false
  try { Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$port/projects" -TimeoutSec 2 | Out-Null } catch { $response = $_.Exception.Response; $unauthorized = $null -ne $response -and [int]$response.StatusCode -eq 401 }
  Assert-Pass 'TOKEN_REJECTION' $unauthorized
  $authorized = Invoke-WebRequest -UseBasicParsing -Headers @{ Authorization = "Bearer $token" } -Uri "http://127.0.0.1:$port/projects" -TimeoutSec 2
  Assert-Pass 'TOKEN_ACCEPTANCE' ($authorized.StatusCode -eq 200)
  Assert-Pass 'USER_DATA_DIR' (Test-Path -LiteralPath (Join-Path $dataDir 'worklog.db')) $dataDir

  $firstPid = $process.Id
  Stop-OwnedBackend
  Assert-Pass 'STOP' $process.HasExited "PID $firstPid"
  Assert-Pass 'DATA_PRESERVED_AFTER_STOP' (Test-Path -LiteralPath (Join-Path $dataDir 'worklog.db'))

  Start-Backend
  Assert-Pass 'RESTART' (-not $process.HasExited) "PID $($process.Id)"
  Assert-Pass 'HEALTH_AFTER_RESTART' (Wait-Healthy)
  Stop-OwnedBackend
  Assert-Pass 'FINAL_STOP' $process.HasExited
  Assert-Pass 'NO_ARTIFACT_PROCESS' (@(Get-ArtifactProcesses).Count -eq 0) $exe
  Write-Output 'BACKEND_LIFECYCLE=PASS'
} catch {
  Write-Error "BACKEND_LIFECYCLE=FAIL: $($_.Exception.Message)"
  exit 1
} finally {
  Stop-OwnedBackend
  if (Test-Path -LiteralPath $dataDir) { Remove-Item -LiteralPath $dataDir -Recurse -Force -ErrorAction SilentlyContinue }
}
