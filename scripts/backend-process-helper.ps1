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

function Stop-TestBackendTree([int]$RootPid, [int]$TimeoutSeconds, [string]$Port, [string]$ExecutablePath, [int[]]$ProtectedPids = @()) {
  if ($RootPid -le 0) { return $true }
  Write-BackendTrace -Stage 'stop-before' -RootPid $RootPid -Port $Port
  $ErrorActionPreference = 'Continue'
  & taskkill.exe /PID $RootPid /T /F *> $null
  $killExit = $LASTEXITCODE
  $ErrorActionPreference = 'Stop'
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    $remaining = @()
    if ($ExecutablePath) { $remaining = @(Get-BackendPidsByPath -ExecutablePath $ExecutablePath | Where-Object { $ProtectedPids -notcontains $_ }) }
    if ($remaining.Count -eq 0) { break }
    foreach ($candidatePid in $remaining) { Stop-Process -Id $candidatePid -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Milliseconds 200
  } while ((Get-Date) -lt $deadline)
  $remaining = if ($ExecutablePath) { @(Get-BackendPidsByPath -ExecutablePath $ExecutablePath | Where-Object { $ProtectedPids -notcontains $_ }) } else { @(Get-BackendProcessTree -RootPid $RootPid) }
  if ($remaining.Count -ne 0) { throw "backend process tree did not exit within ${TimeoutSeconds}s (root PID $RootPid, taskkill exit $killExit, remaining $($remaining -join ','))" }
  Write-Output "PROCESS_TREE_STOP=PASS root=$RootPid"
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
