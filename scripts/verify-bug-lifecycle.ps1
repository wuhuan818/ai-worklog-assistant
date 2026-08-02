$ErrorActionPreference = 'Stop'

# Stage 5: exercises the packaged server and its SQLite persistence.  This is
# intentionally an API-level verifier; Extension Host capture is covered by the
# separate Extension Host E2E suite.
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'backend-process-helper.ps1')
$exe = Join-Path $root 'artifacts\backend\ai-worklog-server.exe'
$port = Get-Random -Minimum 28001 -Maximum 38000
$token = 'stage-05-' + [Guid]::NewGuid().ToString('N')
$dataDir = Join-Path ([IO.Path]::GetTempPath()) ('ai-worklog-bug-' + [Guid]::NewGuid().ToString('N'))
$rootPid = 0
$baseline = @()

function Pass([string]$Name, [bool]$Condition) {
  if (-not $Condition) { throw "$Name failed" }
  Write-Output "$Name=PASS"
}
function PostJson([string]$Url, $Body, $Headers) {
  Invoke-RestMethod $Url -Method Post -Headers $Headers -ContentType 'application/json' -Body ($Body | ConvertTo-Json -Depth 10) -TimeoutSec 10
}
function ExpectStatus([int]$Status, [scriptblock]$Action, [string]$Name) {
  try { & $Action; throw "$Name unexpectedly succeeded" }
  catch {
    $response = $_.Exception.Response
    $actual = if ($null -ne $response) { [int]$response.StatusCode } else { 0 }
    Pass $Name ($actual -eq $Status)
  }
}
function GetItems($Response) { if ($null -ne $Response.items) { return @($Response.items) }; return @($Response) }
function FindBug($Items, [string]$Id) { return @($Items | Where-Object { $_.id -eq $Id })[0] }
function EventBugId($Event) { if ($null -ne $Event.bug_id) { return $Event.bug_id }; return $Event.bugId }

try {
  if (-not (Test-Path -LiteralPath $exe)) { & (Join-Path $PSScriptRoot 'build-backend.ps1') }
  $baseline = @(Get-BackendPidsByPath -ExecutablePath $exe)
  New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
  $headers = @{ Authorization = "Bearer $token" }

  $rootPid = Start-TestBackend -ExecutablePath $exe -DataDir $dataDir -Token $token -Port $port -Stage 'bug-lifecycle'
  Wait-BackendHealthy -Port $port -RootPid $rootPid -TimeoutSeconds 15 -Stage 'bug-lifecycle'
  $project = PostJson "http://127.0.0.1:$port/projects" @{ name = 'Bug lifecycle verify' } $headers
  $task = PostJson "http://127.0.0.1:$port/tasks" @{ name = 'Investigate lifecycle'; project_id = $project.id } $headers
  $taskId = $task.id
  $bugA = PostJson "http://127.0.0.1:$port/tasks/$taskId/bugs" @{ title = 'Bug A'; severity = 'high'; tags = @('verify') } $headers
  $bugB = PostJson "http://127.0.0.1:$port/tasks/$taskId/bugs" @{ title = 'Bug B'; severity = 'medium' } $headers
  Pass 'CREATE_BUGS' ($bugA.status -eq 'open' -and $bugB.status -eq 'open')

  $activation = PostJson "http://127.0.0.1:$port/tasks/$taskId/bugs/$($bugA.id)/activate" @{} $headers
  $activeA = if ($null -ne $activation.active_bug) { $activation.active_bug } else { $activation }
  Pass 'ACTIVATE_A' ($activeA.id -eq $bugA.id -and $activeA.status -eq 'active')
  # bug_id is the Stage 5 wire contract; bugId keeps the verifier compatible
  # with clients/servers that use the existing TypeScript camelCase alias.
  $eventA = @{ client_event_id = [Guid]::NewGuid().ToString(); event_type = 'file_saved'; source = 'verify'; occurred_at = [DateTime]::UtcNow.ToString('o'); payload = @{ marker = 'a' }; bug_id = $bugA.id; bugId = $bugA.id }
  $sentA = PostJson "http://127.0.0.1:$port/tasks/$taskId/events/batch" @{ events = @($eventA) } $headers
  Pass 'EVENT_A_WRITTEN' ($sentA.inserted -eq 1)
  $note = PostJson "http://127.0.0.1:$port/tasks/$taskId/bugs/$($bugA.id)/notes" @{ client_note_id = [Guid]::NewGuid().ToString(); text = 'stage five verifier note' } $headers
  Pass 'NOTE_A_WRITTEN' ($null -ne $note.id)

  $switch = PostJson "http://127.0.0.1:$port/tasks/$taskId/bugs/$($bugB.id)/activate" @{} $headers
  $switched = if ($null -ne $switch.active_bug) { $switch.active_bug } else { $switch }
  Pass 'SWITCH_TO_B' ($switched.id -eq $bugB.id -and $switched.status -eq 'active')
  $bugs = @(GetItems (Invoke-RestMethod "http://127.0.0.1:$port/tasks/$taskId/bugs?limit=20" -Headers $headers -TimeoutSec 10))
  Pass 'A_AUTO_PAUSED' ((FindBug $bugs $bugA.id).status -eq 'paused')
  $eventB = @{ client_event_id = [Guid]::NewGuid().ToString(); event_type = 'file_saved'; source = 'verify'; occurred_at = [DateTime]::UtcNow.ToString('o'); payload = @{ marker = 'b' }; bug_id = $bugB.id; bugId = $bugB.id }
  Pass 'EVENT_B_WRITTEN' ((PostJson "http://127.0.0.1:$port/tasks/$taskId/events/batch" @{ events = @($eventB) } $headers).inserted -eq 1)
  $eventsA = @(GetItems (Invoke-RestMethod "http://127.0.0.1:$port/tasks/$taskId/bugs/$($bugA.id)/events?limit=20" -Headers $headers -TimeoutSec 10))
  $eventsB = @(GetItems (Invoke-RestMethod "http://127.0.0.1:$port/tasks/$taskId/bugs/$($bugB.id)/events?limit=20" -Headers $headers -TimeoutSec 10))
  Pass 'EVENT_ASSOCIATION' ($eventsA.Count -eq 1 -and (EventBugId $eventsA[0]) -eq $bugA.id -and $eventsB.Count -eq 1 -and (EventBugId $eventsB[0]) -eq $bugB.id)

  $resolution = PostJson "http://127.0.0.1:$port/tasks/$taskId/bugs/$($bugB.id)/resolve" @{ resolution_summary = 'Verified lifecycle'; verification = 'API verifier' } $headers
  Pass 'RESOLVE_B' ($resolution.status -eq 'resolved')
  $resolutions = @(GetItems (Invoke-RestMethod "http://127.0.0.1:$port/tasks/$taskId/bugs/$($bugB.id)/resolutions" -Headers $headers -TimeoutSec 10))
  Pass 'RESOLUTION_HISTORY' ($resolutions.Count -eq 1)
  $reopened = PostJson "http://127.0.0.1:$port/tasks/$taskId/bugs/$($bugB.id)/reopen" @{} $headers
  Pass 'REOPEN_B' ($reopened.status -eq 'open')
  $null = PostJson "http://127.0.0.1:$port/tasks/$taskId/bugs/$($bugB.id)/activate" @{} $headers

  Stop-TestBackendTree -RootPid $rootPid -TimeoutSeconds 10 -Port $port -ExecutablePath $exe -ProtectedPids $baseline; $rootPid = 0
  $rootPid = Start-TestBackend -ExecutablePath $exe -DataDir $dataDir -Token $token -Port $port -Stage 'bug-restart'
  Wait-BackendHealthy -Port $port -RootPid $rootPid -TimeoutSeconds 15 -Stage 'bug-restart'
  $current = Invoke-RestMethod "http://127.0.0.1:$port/tasks/$taskId/bugs/current" -Headers $headers -TimeoutSec 10
  $recoveredBugs = @(GetItems (Invoke-RestMethod "http://127.0.0.1:$port/tasks/$taskId/bugs?limit=20" -Headers $headers -TimeoutSec 10))
  $recoveredNotes = @(GetItems (Invoke-RestMethod "http://127.0.0.1:$port/tasks/$taskId/bugs/$($bugA.id)/notes" -Headers $headers -TimeoutSec 10))
  Pass 'RESTART_RECOVERY' ($current.bug.id -eq $bugB.id -and $recoveredBugs.Count -eq 2 -and $recoveredNotes.Count -eq 1)

  $pending = @{ client_event_id = [Guid]::NewGuid().ToString(); event_type = 'manual_note'; source = 'verify'; occurred_at = [DateTime]::UtcNow.ToString('o'); payload = @{ marker = 'pending' }; bug_id = $bugB.id; bugId = $bugB.id }
  Pass 'PENDING_EVENT_WRITTEN' ((PostJson "http://127.0.0.1:$port/tasks/$taskId/events/batch" @{ events = @($pending) } $headers).inserted -eq 1)
  $ended = Invoke-RestMethod "http://127.0.0.1:$port/tasks/$taskId/end" -Method Post -Headers $headers -TimeoutSec 10
  Pass 'END_TASK' ($ended.status -eq 'completed')
  $afterEnd = Invoke-RestMethod "http://127.0.0.1:$port/tasks/$taskId/bugs/current" -Headers $headers -TimeoutSec 10
  Pass 'END_AUTO_PAUSES' ($null -eq $afterEnd.bug)
  ExpectStatus 409 { PostJson "http://127.0.0.1:$port/tasks/$taskId/bugs/$($bugB.id)/pause" @{} $headers } 'COMPLETED_REJECTS_MODIFICATION'
  $dbPath = Join-Path $dataDir 'worklog.db'
  $sqliteCheck = @'
import sqlite3, sys
db, task_id, bug_a, bug_b = sys.argv[1:]
con = sqlite3.connect(db)
assert con.execute('select count(*) from bugs where task_id=?', (task_id,)).fetchone()[0] == 2
assert con.execute('select count(*) from bug_notes where bug_id=?', (bug_a,)).fetchone()[0] == 1
assert con.execute('select count(*) from bug_resolutions where bug_id=?', (bug_b,)).fetchone()[0] == 1
assert con.execute('select count(*) from worklog_events where task_id=? and bug_id is not null', (task_id,)).fetchone()[0] == 3
assert con.execute("select count(*) from bugs where task_id=? and status='active'", (task_id,)).fetchone()[0] == 0
'@
  $sqliteCheck | & python - $dbPath $taskId $bugA.id $bugB.id
  Pass 'SQLITE_PERSISTENCE' ($LASTEXITCODE -eq 0)
  Write-Output 'BUG_LIFECYCLE=PASS'
} catch {
  Write-Error "BUG_LIFECYCLE=FAIL: $($_.Exception.Message)"
  exit 1
} finally {
  if ($rootPid -gt 0) { try { Stop-TestBackendTree -RootPid $rootPid -TimeoutSeconds 10 -Port $port -ExecutablePath $exe -ProtectedPids $baseline } catch {} }
  if (Test-Path -LiteralPath $dataDir) { Remove-Item -LiteralPath $dataDir -Recurse -Force -ErrorAction SilentlyContinue }
}
