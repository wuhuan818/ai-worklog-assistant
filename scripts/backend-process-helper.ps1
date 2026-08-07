# Windows PowerShell 5.1-compatible helpers for owning and stopping one test backend tree.

function Write-BackendTrace([string]$Stage, [int]$RootPid, [string]$Port) {
  $timestamp = (Get-Date).ToString('o')
  $tree = @(Get-BackendProcessTree -RootPid $RootPid)
  $items = @($tree | ForEach-Object { "$($_.ProcessId):$($_.Name):parent=$($_.ParentProcessId):exit=$($_.ExitCode)" })
  Write-Output ("TRACE stage={0} time={1} root={2} port={3} tree={4}" -f $Stage,$timestamp,$RootPid,$Port,($items -join ','))
}

function Get-BackendProcessTree([int]$RootPid) {
  $all = @()
  try { $all = @(Get-CimInstance Win32_Process -ErrorAction Stop) }
  catch { try { $all = @(Get-WmiObject Win32_Process -ErrorAction Stop) } catch { $all = @() } }
  if ($all.Count -eq 0) {
    $root = Get-Process -Id $RootPid -ErrorAction SilentlyContinue
    if ($null -ne $root) { return @([pscustomobject]@{ ProcessId=$root.Id; ParentProcessId=0; Name=$root.ProcessName; ExitCode=$null }) }
    return @()
  }
  $ids = New-Object 'System.Collections.Generic.HashSet[int]'
  [void]$ids.Add($RootPid)
  $changed = $true
  while ($changed) {
    $changed = $false
    foreach ($item in $all) {
      if ($ids.Contains([int]$item.ParentProcessId) -and $ids.Add([int]$item.ProcessId)) { $changed = $true }
    }
  }
  return @($all | Where-Object { $ids.Contains([int]$_.ProcessId) } | Select-Object ProcessId,ParentProcessId,Name,ExitCode)
}

function Wait-BackendProcessTreeExit([int]$RootPid, [int]$TimeoutSeconds, [string]$Port) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    $tree = @(Get-BackendProcessTree -RootPid $RootPid)
    if ($tree.Count -eq 0) { return $true }
    Start-Sleep -Milliseconds 200
  } while ((Get-Date) -lt $deadline)
  Write-BackendTrace -Stage 'stop-timeout' -RootPid $RootPid -Port $Port
  return $false
}

function Stop-TestBackendTree([int]$RootPid, [int]$TimeoutSeconds, [string]$Port, [string]$ExecutablePath, [string]$Token = '', [int[]]$ProtectedPids = @()) {
  if ($RootPid -le 0) { return $true }
  Write-BackendTrace -Stage 'stop-before' -RootPid $RootPid -Port $Port
  # The verifier owns only RootPid. Never scan and kill every process that
  # happens to use the same EXE path; pre-existing instances are deliberately
  # protected by the ownership boundary.
  $owned = Get-Process -Id $RootPid -ErrorAction SilentlyContinue
  if ($null -eq $owned) { Write-Output "PROCESS_TREE_STOP=PASS root=$RootPid outcome=already-exited"; return $true }
  if ($ExecutablePath -and $owned.Path -ne $ExecutablePath) { throw "owned PID $RootPid executable identity changed" }
  $outcome = 'graceful'
  if ($Token) {
    try { Invoke-RestMethod -Method Post -Headers @{ Authorization = "Bearer $Token" } -ContentType 'application/json' -Body '{"generation":0}' -Uri "http://127.0.0.1:$Port/runtime/shutdown" -TimeoutSec 2 | Out-Null } catch { $outcome = 'shutdown-unavailable' }
  } else { $outcome = 'no-token' }
  if (-not (Wait-BackendProcessTreeExit -RootPid $RootPid -TimeoutSeconds ([Math]::Min(5, $TimeoutSeconds)) -Port $Port)) {
    $outcome = 'terminate'
    Stop-Process -Id $RootPid -ErrorAction SilentlyContinue
    if (-not (Wait-BackendProcessTreeExit -RootPid $RootPid -TimeoutSeconds ([Math]::Min(3, $TimeoutSeconds)) -Port $Port)) {
      $outcome = 'kill'
      Stop-Process -Id $RootPid -Force -ErrorAction SilentlyContinue
      if (-not (Wait-BackendProcessTreeExit -RootPid $RootPid -TimeoutSeconds $TimeoutSeconds -Port $Port)) { throw "owned backend process tree did not exit (root PID $RootPid)" }
    }
  }
  Write-Output "PROCESS_TREE_STOP=PASS root=$RootPid outcome=$outcome"
  return $true
}

function Get-BackendPidsByPath([string]$ExecutablePath) {
  return @(Get-Process -Name ([IO.Path]::GetFileNameWithoutExtension($ExecutablePath)) -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -eq $ExecutablePath } | Select-Object -ExpandProperty Id)
}

function Assert-NoBackendProcess([string]$ExecutablePath, [int[]]$AllowedPids = @()) {
  $remaining = @(Get-BackendPidsByPath -ExecutablePath $ExecutablePath | Where-Object { $AllowedPids -notcontains $_ })
  if ($remaining.Count -ne 0) { throw "unowned backend process remains: $($remaining -join ',')" }
  Write-Output 'NO_RESIDUAL_PROCESS=PASS'
}

function Start-TestBackend([string]$ExecutablePath, [string]$DataDir, [string]$Token, [int]$Port, [string]$Stage) {
  $env:WORKLOG_DATA_DIR = $DataDir
  $env:WORKLOG_SESSION_TOKEN = $Token
  $env:WORKLOG_PORT = [string]$Port
  # If this verifier is interrupted, the backend watchdog observes its owner
  # exit and shuts down instead of becoming a detached packaged EXE.
  $env:WORKLOG_EXTENSION_HOST_PID = [string]$PID
  $started = Start-Process -FilePath $ExecutablePath -WorkingDirectory (Split-Path -Parent $ExecutablePath) -PassThru -WindowStyle Hidden
  Write-Host "START_BACKEND=PASS stage=$Stage root=$($started.Id) port=$Port data=$DataDir"
  return $started.Id
}

function Wait-BackendHealthy([int]$Port, [int]$RootPid, [int]$TimeoutSeconds, [string]$Stage) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    try {
      $response = Invoke-RestMethod "http://127.0.0.1:$Port/health" -TimeoutSec 2
      if ($response.status -eq 'ok') { Write-Output "HEALTHY=PASS stage=$Stage root=$RootPid"; return $true }
    } catch { }
    if (@(Get-BackendProcessTree -RootPid $RootPid).Count -eq 0) { throw "backend exited before health check (root PID $RootPid)" }
    Start-Sleep -Milliseconds 200
  } while ((Get-Date) -lt $deadline)
  throw "health check timed out after ${TimeoutSeconds}s (stage $Stage, port $Port, root PID $RootPid)"
}
