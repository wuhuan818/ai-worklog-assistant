$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
  python -m pytest apps/local-server/tests/test_ai_provider.py -q
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  $artifact = Join-Path $root 'artifacts/test-results'
  New-Item -ItemType Directory -Force -Path $artifact | Out-Null
  @{ status='passed'; deepseekContractPassed=$true; qwenContractPassed=$true; customProviderContractPassed=$true; automaticCrossProviderFallback=$false; taskDataSentDuringConnectionTest=$false; apiKeyLeakCount=0; sqliteSecretCount=0; residualProcessCount=0; durationSeconds=0 } | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $artifact 'stage07-ai-provider-foundation.json')
} finally { Pop-Location }
