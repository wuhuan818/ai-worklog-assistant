$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'backend-process-helper.ps1')
$exe = Join-Path $root 'artifacts\backend\ai-worklog-server.exe'
$dataDir = Join-Path ([IO.Path]::GetTempPath()) ('ai-worklog-watchdog-' + [guid]::NewGuid().ToString('N'))
$token = 'watchdog-' + [guid]::NewGuid().ToString('N')
$port = Get-Random -Minimum 30000 -Maximum 38000
$backendPid = 0

try {
  if (-not (Test-Path -LiteralPath $exe)) { throw "Packaged backend is required: $exe" }
  New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
  $output = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'start-backend-parent-helper.ps1') -ExecutablePath $exe -DataDir $dataDir -Token $token -Port $port
  if ($LASTEXITCODE -ne 0) { throw 'Parent helper did not exit cleanly' }
  $backendPid = [int]($output | Select-Object -Last 1)
  Wait-BackendHealthy -Port $port -RootPid $backendPid -TimeoutSeconds 10 -Stage 'parent-watchdog'
  # The helper has already ended. The only permitted outcome is the backend
  # watchdog independently detecting that loss and stopping within the bound.
  if (-not (Wait-BackendProcessTreeExit -RootPid $backendPid -TimeoutSeconds 10 -Port $port)) { throw "Backend PID $backendPid survived parent death" }
  Write-Output 'BACKEND_PARENT_WATCHDOG=PASS'
} catch {
  Write-Error "BACKEND_PARENT_WATCHDOG=FAIL: $($_.Exception.Message)"
  exit 1
} finally {
  # This is a last-resort cleanup only for the exact PID created above; it is
  # never a pass condition and never searches/kills by image name.
  if ($backendPid -gt 0 -and (Get-Process -Id $backendPid -ErrorAction SilentlyContinue)) {
    try { & taskkill.exe /PID $backendPid /T /F *> $null } catch { }
  }
  Remove-Item -LiteralPath $dataDir -Recurse -Force -ErrorAction SilentlyContinue
}
