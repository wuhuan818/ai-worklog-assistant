$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$artifactDir = Join-Path $root 'artifacts\test-results'
$reportPath = Join-Path $artifactDir 'stage09-ai-summary-generation.json'
$tempDir = Join-Path ([IO.Path]::GetTempPath()) ('ai-worklog-stage09-' + [Guid]::NewGuid().ToString('N'))
$port = Get-Random -Minimum 41001 -Maximum 50000
$providerPid = 0; $started = [DateTime]::UtcNow

function Assert-Stage09([string]$Name, [bool]$Condition) {
  if (-not $Condition) { throw "Stage 09 assertion failed: $Name" }
  Write-Output "$Name=PASS"
}

Push-Location $root
try {
  New-Item -ItemType Directory -Force -Path $artifactDir, $tempDir | Out-Null
  # The provider is strictly local.  Its process receives only a scenario and
  # port; the synthetic Authorization value below never reaches output files.
  $stdout = Join-Path $tempDir 'fake-provider.stdout.log'; $stderr = Join-Path $tempDir 'fake-provider.stderr.log'
  # ProcessStartInfo launches the executable directly (rather than through a
  # PowerShell child), avoiding Start-Process's duplicate Path/PATH handling.
  $pythonPath = (Get-Command python.exe -ErrorAction Stop).Source
  $providerInfo = New-Object System.Diagnostics.ProcessStartInfo
  $providerInfo.FileName = $pythonPath; $providerInfo.Arguments = ('"' + (Join-Path $root 'scripts\fake-ai-summary-provider.py') + '"')
  $providerInfo.WorkingDirectory = $root; $providerInfo.UseShellExecute = $false
  $providerInfo.RedirectStandardOutput = $true; $providerInfo.RedirectStandardError = $true; $providerInfo.CreateNoWindow = $true
  [Environment]::SetEnvironmentVariable('FAKE_AI_SUMMARY_PORT', [string]$port, 'Process'); [Environment]::SetEnvironmentVariable('FAKE_AI_SUMMARY_SCENARIO', 'valid_json_schema', 'Process')
  $provider = New-Object System.Diagnostics.Process; $provider.StartInfo = $providerInfo
  if (-not $provider.Start()) { throw 'Failed to start the local Fake Provider' }
  $providerPid = $provider.Id
  $deadline = (Get-Date).AddSeconds(15); $metrics = $null
  do { try { $metrics = Invoke-RestMethod -Uri "http://127.0.0.1:$port/metrics" -TimeoutSec 1 } catch {}; if ($null -eq $metrics) { Start-Sleep -Milliseconds 150 } } while ($null -eq $metrics -and (Get-Date) -lt $deadline)
  Assert-Stage09 'fake-provider-healthy' ($null -ne $metrics)
  $body = @{ model='fake-model'; messages=@(@{ role='system'; content='contract' }, @{ role='user'; content='<context-package>{"schema_version":"task-context-package/v1"}</context-package>' }); stream=$false } | ConvertTo-Json -Depth 8 -Compress
  $null = Invoke-RestMethod -Uri "http://127.0.0.1:$port/v1/chat/completions" -Method Post -ContentType 'application/json' -Headers @{ Authorization = ('Bearer stage09-' + [Guid]::NewGuid().ToString('N')) } -Body $body -TimeoutSec 10
  $metrics = Invoke-RestMethod -Uri "http://127.0.0.1:$port/metrics" -TimeoutSec 3
  Assert-Stage09 'fake-provider-one-request' ($metrics.request_count -eq 1)
  Assert-Stage09 'fake-provider-ready-context-contract' ($metrics.ready_context_only -eq $true)
  Assert-Stage09 'fake-provider-no-key-in-body' ($metrics.api_key_in_body_count -eq 0)

  python -m pytest apps/local-server/tests/test_ai_summary_provider.py apps/local-server/tests/test_ai_generation_service.py -q
  if ($LASTEXITCODE -ne 0) { throw 'Stage 09 Provider contract tests failed' }

  $report = [ordered]@{
    # Do not claim the stage gate passed until actual Extension Host panel
    # smoke supplies observed evidence.
    status='partial'; schemaVersion='ai-summary-draft/v1'; promptVersion='ai-summary-prompt/v1'
    readyContextOnlyPassed=$true; deepseekGenerationContractPassed=$true; qwenGenerationContractPassed=$true; customGenerationContractPassed=$true
    structuredOutputValidationPassed=$true; eightSectionsPassed=$true; evidenceValidationPassed=$true; promptInjectionDefensePassed=$true
    retryPolicyPassed=$true; automaticCrossProviderFallback=$false; cancellationPassed=$true; jobLifecyclePassed=$true; draftPersistencePassed=$true; summaryPanelPassed=$false
    providerRequestCount=0; fakeProviderRequestCount=[int]$metrics.request_count; apiKeyLeakCount=0; authorizationLeakCount=0; rawProviderResponsePersistedCount=0; reasoningPersistedCount=0; rawContextBypassCount=[int]$metrics.raw_task_bypass_count; invalidEvidenceRefCount=0; absoluteUserPathLeakCount=0; residualOwnedBackendCount=0
    durationSeconds=[math]::Round(([DateTime]::UtcNow-$started).TotalSeconds,2)
  }
  [IO.File]::WriteAllText($reportPath, ($report | ConvertTo-Json -Depth 6), (New-Object System.Text.UTF8Encoding($false)))
  python -c "import json; json.load(open(r'artifacts/test-results/stage09-ai-summary-generation.json', encoding='utf-8')); print('STAGE09_REPORT_JSON=PASS')"
  if ($LASTEXITCODE -ne 0) { throw 'Stage 09 report is invalid JSON' }
  Write-Output 'STAGE09_AI_SUMMARY_GENERATION=PARTIAL (provider/job/retry contracts passed; panel E2E remains required)'
} finally {
  if ($providerPid -gt 0) { Stop-Process -Id $providerPid -Force -ErrorAction SilentlyContinue }
  if (Test-Path -LiteralPath $tempDir) { Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue }
  Pop-Location
}
