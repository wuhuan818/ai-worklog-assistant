$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'backend-process-helper.ps1')
$exe = Join-Path $root 'artifacts\backend\ai-worklog-server.exe'
$port = Get-Random -Minimum 18000 -Maximum 28000
$token = 'stage-03-' + [Guid]::NewGuid().ToString('N')
$dataDir = Join-Path ([IO.Path]::GetTempPath()) ('ai-worklog-task-' + [Guid]::NewGuid().ToString('N'))
$rootPid = 0
$baseline = @(Get-BackendPidsByPath -ExecutablePath $exe)

function Pass([string]$Name, [bool]$Condition, [string]$Detail='') {
  if (-not $Condition) { throw "$Name failed $Detail" }
  Write-Output "$Name=PASS"
}

try {
  Pass 'PACKAGED_BACKEND' (Test-Path -LiteralPath $exe) $exe
  New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
  $rootPid = Start-TestBackend -ExecutablePath $exe -DataDir $dataDir -Token $token -Port $port -Stage 'first'
  Wait-BackendHealthy -Port $port -RootPid $rootPid -TimeoutSeconds 15 -Stage 'first'
  $headers = @{ Authorization = "Bearer $token" }
  $project = Invoke-RestMethod "http://127.0.0.1:$port/projects" -Method Post -Headers $headers -ContentType 'application/json' -Body (@{ name='Stage 03'; workspace_path=(Join-Path $dataDir 'workspace') } | ConvertTo-Json) -TimeoutSec 10
  $projectId = $project.id; Pass 'CREATE_PROJECT' ($null -ne $projectId)
  $listed = @(Invoke-RestMethod "http://127.0.0.1:$port/projects" -Headers $headers -TimeoutSec 10)
  Pass 'LIST_PROJECTS' (@($listed | Where-Object { $_.id -eq $projectId }).Count -eq 1)
  $task = Invoke-RestMethod "http://127.0.0.1:$port/tasks" -Method Post -Headers $headers -ContentType 'application/json' -Body (@{ name='Persistence task'; project_id=$projectId } | ConvertTo-Json) -TimeoutSec 10
  $taskId = $task.id; $startedAt = $task.started_at; Pass 'START_TASK' ($task.status -eq 'active')
  $active = Invoke-RestMethod "http://127.0.0.1:$port/tasks/active" -Headers $headers -TimeoutSec 10; Pass 'ACTIVE_TASK' ($active.id -eq $taskId)
  Start-Sleep -Seconds 3
  Stop-TestBackendTree -RootPid $rootPid -TimeoutSeconds 10 -Port $port -ExecutablePath $exe -ProtectedPids $baseline; $rootPid = 0
  $rootPid = Start-TestBackend -ExecutablePath $exe -DataDir $dataDir -Token $token -Port $port -Stage 'restart'
  Wait-BackendHealthy -Port $port -RootPid $rootPid -TimeoutSeconds 15 -Stage 'restart'
  $recovered = Invoke-RestMethod "http://127.0.0.1:$port/tasks/active" -Headers $headers -TimeoutSec 10
  Pass 'TASK_RECOVERY' ($recovered.id -eq $taskId -and $recovered.started_at -eq $startedAt -and $recovered.status -eq 'active')
  $ended = Invoke-RestMethod "http://127.0.0.1:$port/tasks/$taskId/end" -Method Post -Headers $headers -TimeoutSec 10
  Pass 'END_TASK' ($ended.status -eq 'completed' -and $null -ne $ended.ended_at -and $ended.duration_seconds -ge 3)
  $emptyResponse = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$port/tasks/active" -Headers $headers -TimeoutSec 10
  Pass 'NO_ACTIVE_TASK' ($emptyResponse.Content.Trim() -eq 'null')
  $db = Join-Path $dataDir 'worklog.db'
  $check = & python (Join-Path $root 'scripts\verify-sqlite-task.py') $db
  Pass 'SQLITE_PERSISTENCE' ($check -match '^1 1')
  Stop-TestBackendTree -RootPid $rootPid -TimeoutSeconds 10 -Port $port -ExecutablePath $exe -ProtectedPids $baseline; $rootPid = 0
  Assert-NoBackendProcess -ExecutablePath $exe -AllowedPids $baseline
  Write-Output 'TASK_LIFECYCLE=PASS'
} catch {
  Write-Error "TASK_LIFECYCLE=FAIL: $($_.Exception.Message)"
  exit 1
} finally {
  if ($rootPid -gt 0) { try { Stop-TestBackendTree -RootPid $rootPid -TimeoutSeconds 10 -Port $port -ExecutablePath $exe -ProtectedPids $baseline } catch { Write-Error "cleanup failed: $($_.Exception.Message)" } }
  if (Test-Path -LiteralPath $dataDir) { Remove-Item -LiteralPath $dataDir -Recurse -Force -ErrorAction SilentlyContinue }
}
