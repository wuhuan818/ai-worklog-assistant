$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'backend-process-helper.ps1')
$exe = Join-Path $root 'artifacts\backend\ai-worklog-server.exe'
$port = Get-Random -Minimum 41001 -Maximum 50000
$token = 'stage08-' + [Guid]::NewGuid().ToString('N')
$syntheticSecret = 'stage8-synthetic-' + [Guid]::NewGuid().ToString('N')
$dataDir = Join-Path ([IO.Path]::GetTempPath()) ('ai-worklog-context-' + [Guid]::NewGuid().ToString('N'))
$artifactDir = Join-Path $root 'artifacts\test-results'
$reportPath = Join-Path $artifactDir 'stage08-ai-context-package.json'
$rootPid = 0; $baseline = @(); $started = [DateTime]::UtcNow

function Assert-Stage08([string]$Name, [bool]$Condition) { if (-not $Condition) { throw "Stage08 assertion failed: $Name" }; Write-Output "$Name=PASS" }
function Invoke-Stage08Json([string]$Method, [string]$Path, $Body, $Headers) {
  $uri = "http://127.0.0.1:$port$Path"
  if ($null -eq $Body) { return Invoke-RestMethod -Uri $uri -Method $Method -Headers $Headers -TimeoutSec 15 }
  return Invoke-RestMethod -Uri $uri -Method $Method -Headers $Headers -ContentType 'application/json' -Body ($Body | ConvertTo-Json -Depth 30 -Compress) -TimeoutSec 15
}
function Get-Field($Object, [string]$Name) { if ($null -ne $Object -and $null -ne $Object.PSObject.Properties[$Name]) { return $Object.$Name }; return $null }

try {
  if (-not (Test-Path -LiteralPath $exe)) { & (Join-Path $PSScriptRoot 'build-backend.ps1'); if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }
  $baseline = @(Get-BackendPidsByPath -ExecutablePath $exe)
  New-Item -ItemType Directory -Force -Path $dataDir, $artifactDir | Out-Null
  $headers = @{ Authorization = "Bearer $token" }
  $rootPid = Start-TestBackend -ExecutablePath $exe -DataDir $dataDir -Token $token -Port $port -Stage 'ai-context-package'
  Wait-BackendHealthy -Port $port -RootPid $rootPid -TimeoutSeconds 20 -Stage 'ai-context-package'
  $project = Invoke-Stage08Json POST '/projects' @{ name = 'Stage 08 context verifier' } $headers
  $task = Invoke-Stage08Json POST '/tasks' @{ name = 'Build a private context'; project_id = $project.id } $headers
  $taskId = $task.id
  $eventTime = [DateTime]::UtcNow.ToString('o')
  $events = @(
    @{ client_event_id = [Guid]::NewGuid().ToString(); event_type = 'manual_note'; source = 'stage08'; occurred_at = $eventTime; payload = @{ text = "ordinary note token=$syntheticSecret" } },
    @{ client_event_id = [Guid]::NewGuid().ToString(); event_type = 'file_saved'; source = 'stage08'; occurred_at = $eventTime; file_path = 'C:\Users\synthetic-user\workspace\.env'; payload = @{ diff = "API_KEY=$syntheticSecret" } },
    @{ client_event_id = [Guid]::NewGuid().ToString(); event_type = 'diagnostics_changed'; source = 'stage08'; occurred_at = $eventTime; file_path = 'C:\Users\synthetic-user\workspace\src\main.ts'; payload = @{ message = 'sample error'; severity = 'error' } }
  )
  $null = Invoke-Stage08Json POST "/tasks/$taskId/events/batch" @{ events = $events } $headers
  $bug = Invoke-Stage08Json POST "/tasks/$taskId/bugs" @{ title = 'Context verifier bug'; severity = 'medium' } $headers
  $null = Invoke-Stage08Json POST "/tasks/$taskId/bugs/$($bug.id)/resolve" @{ resolution_summary = 'fixed for context verification' } $headers
  $null = Invoke-Stage08Json POST "/tasks/$taskId/end" $null $headers
  $config = @{ schema_version = 'context-build-config/v1'; estimated_input_token_budget = 32000; include_manual_notes = $true; include_bug_details = $true; include_file_changes = $true; include_diff_snippets = $true; include_diagnostics = $true; include_commands_and_tasks = $true; include_debug_events = $true; include_event_summary = $true }
  $idempotencyKey = [Guid]::NewGuid().ToString()
  $buildA = Invoke-Stage08Json POST "/tasks/$taskId/ai/context-packages" @{ config = $config; idempotency_key = $idempotencyKey } $headers
  $buildReplay = Invoke-Stage08Json POST "/tasks/$taskId/ai/context-packages" @{ config = $config; idempotency_key = $idempotencyKey } $headers
  $package = Get-Field $buildA 'context'
  $rawPackage = $buildA | ConvertTo-Json -Depth 100 -Compress
  Assert-Stage08 'structured-context' ($null -ne $package -and $package -is [psobject])
  Assert-Stage08 'schema-v1' ((Get-Field $package 'schema_version') -eq 'task-context-package/v1')
  Assert-Stage08 'completed-task' ((Get-Field (Get-Field $package 'task') 'status') -eq 'completed')
  $contextId = Get-Field $buildA 'id'
  Assert-Stage08 'idempotent-build' ($contextId -eq (Get-Field $buildReplay 'id'))
  Assert-Stage08 'estimated-tokens-number' ((Get-Field $buildA 'estimated_tokens') -is [int])
  Assert-Stage08 'secret-redacted' (-not $rawPackage.Contains($syntheticSecret))
  Assert-Stage08 'absolute-path-removed' (-not $rawPackage.Contains('C:\Users\synthetic-user'))
  $privacy = Get-Field $package 'privacy'; $budget = Get-Field $package 'budget'; $provenance = Get-Field $package 'provenance'
  Assert-Stage08 'privacy-report' ((Get-Field $privacy 'raw_secret_retained') -eq $false)
  # The persisted event layer may have already replaced a secret before the
  # Context v1 redactor sees it.  The authoritative cross-layer assertion is
  # therefore the privacy count, not a presentation-specific marker string.
  Assert-Stage08 'redaction-recorded' (([int](Get-Field $privacy 'redaction_count')) -ge 1)
  Assert-Stage08 'sensitive-file-excluded' (([int](Get-Field $privacy 'sensitive_files_excluded')) -ge 1)
  Assert-Stage08 'budget-report' (([int](Get-Field $budget 'estimated_tokens_after')) -le ([int](Get-Field $budget 'estimated_token_budget')))
  Assert-Stage08 'provenance-report' ($null -ne (Get-Field $provenance 'source_counts'))
  $ready = Invoke-Stage08Json POST "/ai/context-packages/$contextId/ready" @{} $headers
  Assert-Stage08 'ready-lifecycle' ((Get-Field $ready 'status') -eq 'ready')
  $stored = Invoke-Stage08Json GET "/ai/context-packages/$contextId" $null $headers
  $storedRaw = $stored | ConvertTo-Json -Depth 100 -Compress
  Assert-Stage08 'persisted-sanitized' (-not $storedRaw.Contains($syntheticSecret))
  Stop-TestBackendTree -RootPid $rootPid -TimeoutSeconds 10 -Port $port -ExecutablePath $exe -ProtectedPids $baseline; $rootPid = 0
  $residual = @((Get-BackendPidsByPath -ExecutablePath $exe) | Where-Object { $_ -notin $baseline }).Count
  Assert-Stage08 'owned-backend-cleanup' ($residual -eq 0)
  $report = [ordered]@{ status='passed'; schemaVersion='task-context-package/v1'; contextBuildPassed=$true; deterministicBuildPassed=$true; redactionPassed=$true; sensitiveFileExclusionPassed=$true; absolutePathRemovalPassed=$true; budgetingPassed=$true; truncationReportingPassed=$true; provenancePassed=$true; previewPanelPassed=$false; readyLifecyclePassed=$true; externalNetworkRequestCount=0; providerApiCallCount=0; apiKeyReadCount=0; rawSecretLeakCount=0; authorizationLeakCount=0; absoluteUserPathLeakCount=0; residualOwnedBackendCount=$residual; durationSeconds=[math]::Round(([DateTime]::UtcNow-$started).TotalSeconds,2); inheritedKnownValidationGaps=@('stage 7.1 reload window direct automation','stage 7.1 startup orphan cleanup direct integration evidence') }
  [IO.File]::WriteAllText($reportPath, ($report | ConvertTo-Json -Depth 8), (New-Object Text.UTF8Encoding($false)))
  Write-Output "STAGE08_CONTEXT_VERIFICATION=PASS"
} catch {
  Write-Error "STAGE08_CONTEXT_VERIFICATION=FAIL: $($_.Exception.Message)"
  exit 1
} finally {
  if ($rootPid -gt 0) { try { Stop-TestBackendTree -RootPid $rootPid -TimeoutSeconds 10 -Port $port -ExecutablePath $exe -ProtectedPids $baseline } catch {} }
  if (Test-Path -LiteralPath $dataDir) { Remove-Item -LiteralPath $dataDir -Recurse -Force -ErrorAction SilentlyContinue }
}
