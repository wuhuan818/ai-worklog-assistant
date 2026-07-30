$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'backend-process-helper.ps1')
$exe = Join-Path $root 'artifacts\backend\ai-worklog-server.exe'
$port = Get-Random -Minimum 18000 -Maximum 28000
$token = 'stage-04-' + [Guid]::NewGuid().ToString('N')
$dataDir = Join-Path ([IO.Path]::GetTempPath()) ('ai-worklog-event-' + [Guid]::NewGuid().ToString('N'))
$rootPid = 0; $baseline = @(Get-BackendPidsByPath -ExecutablePath $exe)
function Pass([string]$name, [bool]$ok) { if (-not $ok) { throw "$name failed" }; Write-Output "$name=PASS" }
function PostJson([string]$url, $body, $headers) { Invoke-RestMethod $url -Method Post -Headers $headers -ContentType 'application/json' -Body ($body | ConvertTo-Json -Depth 10) -TimeoutSec 10 }
try {
  if (-not (Test-Path -LiteralPath $exe)) { & (Join-Path $root 'scripts\build-backend.ps1') }
  New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
  $rootPid = Start-TestBackend -ExecutablePath $exe -DataDir $dataDir -Token $token -Port $port -Stage 'events'
  Wait-BackendHealthy -Port $port -RootPid $rootPid -TimeoutSeconds 15 -Stage 'events'
  $h = @{ Authorization = "Bearer $token" }; $p = PostJson "http://127.0.0.1:$port/projects" @{name='Event Verify'} $h; $projectId = $p.id; $task = PostJson "http://127.0.0.1:$port/tasks" @{name='Capture';project_id=$projectId} $h; $taskId = $task.id
  $types = @('file_changed','file_saved','diagnostics_changed','vscode_task_started','vscode_task_ended','debug_session_started','debug_session_terminated','manual_note')
  $events = @($types | ForEach-Object { @{client_event_id=[Guid]::NewGuid().ToString();event_type=$_;source='vscode';occurred_at=[DateTime]::UtcNow.ToString('o');payload=@{kind=$_}} })
  $first = PostJson "http://127.0.0.1:$port/tasks/$taskId/events/batch" @{events=$events} $h; Pass 'BATCH_INSERT' ($first.inserted -eq 8 -and $first.duplicates -eq 0)
  $second = PostJson "http://127.0.0.1:$port/tasks/$taskId/events/batch" @{events=$events} $h; Pass 'IDEMPOTENCY' ($second.inserted -eq 0 -and $second.duplicates -eq 8)
  $list = Invoke-RestMethod "http://127.0.0.1:$port/tasks/$taskId/events?limit=20" -Headers $h -TimeoutSec 10; Pass 'QUERY' ($list.total -eq 8 -and $list.items.Count -eq 8)
  $summary = Invoke-RestMethod "http://127.0.0.1:$port/tasks/$taskId/events/summary" -Headers $h -TimeoutSec 10; Pass 'SUMMARY' ($summary.total -eq 8 -and $summary.by_type.manual_note -eq 1)
  Stop-TestBackendTree -RootPid $rootPid -TimeoutSeconds 10 -Port $port -ExecutablePath $exe -ProtectedPids $baseline; $rootPid=0
  $rootPid = Start-TestBackend -ExecutablePath $exe -DataDir $dataDir -Token $token -Port $port -Stage 'restart'; Wait-BackendHealthy -Port $port -RootPid $rootPid -TimeoutSeconds 15 -Stage 'restart'
  $recovered = Invoke-RestMethod "http://127.0.0.1:$port/tasks/$taskId/events/summary" -Headers $h -TimeoutSec 10; Pass 'RESTART_RECOVERY' ($recovered.total -eq 8)
  $ended = Invoke-RestMethod "http://127.0.0.1:$port/tasks/$taskId/end" -Method Post -Headers $h -TimeoutSec 10; Pass 'END_TASK' ($ended.status -eq 'completed')
  try { PostJson "http://127.0.0.1:$port/tasks/$taskId/events/batch" @{events=$events[0..0]} $h; throw 'expected 409' } catch { Pass 'COMPLETED_REJECTS' ($_.Exception.Response.StatusCode.value__ -eq 409) }
  Write-Output 'EVENT_CAPTURE=PASS'
} catch { Write-Error "EVENT_CAPTURE=FAIL: $($_.Exception.Message)"; exit 1 } finally { if ($rootPid -gt 0) { try { Stop-TestBackendTree -RootPid $rootPid -TimeoutSeconds 10 -Port $port -ExecutablePath $exe -ProtectedPids $baseline } catch {} }; if (Test-Path $dataDir) { Remove-Item $dataDir -Recurse -Force -ErrorAction SilentlyContinue } }
