$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$extensionRoot = Join-Path $root 'apps\vscode-extension'
$runner = Join-Path $extensionRoot 'test\runAiContextSmokeE2E.js'

Push-Location $extensionRoot
try {
  npm.cmd run compile
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  if (-not (Test-Path -LiteralPath $runner)) { throw 'Stage 08 Extension Host smoke runner is missing' }
  # Start-Process receives an executable plus argument list (no shell), and the
  # bounded child owns its isolated VS Code profile/diagnostics.
  $child = Start-Process -FilePath 'node.exe' -ArgumentList @($runner) -WorkingDirectory $extensionRoot -PassThru -NoNewWindow
  if (-not $child.WaitForExit(90000)) {
    try { Stop-Process -Id $child.Id -Force -ErrorAction Stop } catch {}
    throw 'Stage 08 Extension Host smoke exceeded its 90 second hard timeout'
  }
  if ($child.ExitCode -ne 0) { throw "Stage 08 Extension Host smoke failed: $($child.ExitCode)" }
  Write-Output 'STAGE08_EXTENSION_HOST_SMOKE=PASS'
} finally {
  Pop-Location
}
