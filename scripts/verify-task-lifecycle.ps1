$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $root 'artifacts\backend\ai-worklog-server.exe'
$port = Get-Random -Minimum 18000 -Maximum 28000
$token = 'stage-03-task-lifecycle-token'
$dataDir = Join-Path ([IO.Path]::GetTempPath()) ('ai-worklog-task-' + [Guid]::NewGuid().ToString('N'))
$process = $null
function Pass([string]$name, [bool]$condition, [string]$detail='') { if (-not $condition) { throw "$name failed $detail" }; Write-Output "$name=PASS" }
function Start-Backend {
  $env:WORKLOG_DATA_DIR=$dataDir; $env:WORKLOG_SESSION_TOKEN=$token; $env:WORKLOG_PORT=[string]$port
  $info=[Diagnostics.ProcessStartInfo]::new(); $info.FileName=$exe; $info.WorkingDirectory=(Split-Path $exe); $info.UseShellExecute=$false; $info.CreateNoWindow=$true
  $started=[Diagnostics.Process]::new(); $started.StartInfo=$info; if(-not $started.Start()){throw 'backend start failed'}; $script:process=$started
}
function Wait-Healthy { for($i=0;$i -lt 50;$i++){try{if((Invoke-RestMethod "http://127.0.0.1:$port/health" -TimeoutSec 2).status -eq 'ok'){return $true}}catch{}; Start-Sleep -Milliseconds 200}; return $false }
function Stop-Backend { if($null -ne $script:process -and -not $script:process.HasExited){ & taskkill.exe /PID $script:process.Id /T /F *> $null; for($i=0;$i -lt 50 -and -not $script:process.HasExited;$i++){Start-Sleep -Milliseconds 100} } }
try {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'scripts\build-backend.ps1')
  Pass 'PYINSTALLER_BUILD' (Test-Path $exe)
  New-Item -ItemType Directory -Force -Path $dataDir | Out-Null; Start-Backend; Pass 'HEALTH_FIRST_START' (Wait-Healthy)
  $headers=@{Authorization="Bearer $token"}; $project=Invoke-RestMethod "http://127.0.0.1:$port/projects" -Method Post -Headers $headers -ContentType 'application/json' -Body (@{name='Stage 03';workspace_path=(Join-Path $dataDir 'workspace')}|ConvertTo-Json) -TimeoutSec 10; $projectId=$project.id; Pass 'CREATE_PROJECT' ($null -ne $projectId)
  $listed=Invoke-RestMethod "http://127.0.0.1:$port/projects" -Headers $headers -TimeoutSec 10; Pass 'LIST_PROJECTS' (@($listed)|Where-Object id -eq $projectId).Count -eq 1
  $task=Invoke-RestMethod "http://127.0.0.1:$port/tasks" -Method Post -Headers $headers -ContentType 'application/json' -Body (@{name='Persistence task';project_id=$projectId}|ConvertTo-Json) -TimeoutSec 10; $taskId=$task.id; Pass 'START_TASK' ($task.status -eq 'active')
  $active=Invoke-RestMethod "http://127.0.0.1:$port/tasks/active" -Headers $headers -TimeoutSec 10; Pass 'ACTIVE_TASK' ($active.id -eq $task.id); Start-Sleep -Seconds 3; $startedAt=$task.started_at; Stop-Backend; Start-Backend; Pass 'HEALTH_AFTER_RESTART' (Wait-Healthy)
  $recovered=Invoke-RestMethod "http://127.0.0.1:$port/tasks/active" -Headers $headers -TimeoutSec 10; Pass 'TASK_RECOVERY' ($recovered.id -eq $task.id -and $recovered.started_at -eq $startedAt)
  $ended=Invoke-RestMethod "http://127.0.0.1:$port/tasks/$($task.id)/end" -Method Post -Headers $headers -TimeoutSec 10; Pass 'END_TASK' ($ended.status -eq 'completed' -and $ended.ended_at -and $ended.duration_seconds -ge 3)
  $empty=Invoke-RestMethod "http://127.0.0.1:$port/tasks/active" -Headers $headers -TimeoutSec 10; Pass 'NO_ACTIVE_TASK' ($null -eq $empty)
  $db=Join-Path $dataDir 'worklog.db'; $check=& python -c "import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); print(c.execute('select count(*) from projects').fetchone()[0], c.execute('select count(*) from tasks where status=\"completed\"').fetchone()[0])" $db; Pass 'SQLITE_PERSISTENCE' ($check -match '^1 1')
  Stop-Backend; Pass 'NO_RESIDUAL_PROCESS' ($script:process.HasExited); Write-Output 'TASK_LIFECYCLE=PASS'
} catch { Write-Error "TASK_LIFECYCLE=FAIL: $($_.Exception.Message)"; exit 1 } finally { Stop-Backend; if(Test-Path $dataDir){Remove-Item $dataDir -Recurse -Force -ErrorAction SilentlyContinue} }
