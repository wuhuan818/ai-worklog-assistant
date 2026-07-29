$ErrorActionPreference='Stop'
$root = Split-Path -Parent $PSScriptRoot
$env:PYTEST_DISABLE_PLUGIN_AUTOLOAD='1'
$results = @()
python -m pytest (Join-Path $root 'apps\local-server\tests') -q
if ($LASTEXITCODE -ne 0) { throw 'Backend tests failed' }
$results += 'PYTEST=PASS'
Push-Location (Join-Path $root 'apps\vscode-extension')
npm.cmd ci
npm.cmd run compile
if ($LASTEXITCODE -ne 0) { throw 'TypeScript compile failed' }
$results += 'TYPESCRIPT_COMPILE=PASS'
npm.cmd run lint
if ($LASTEXITCODE -ne 0) { throw 'TypeScript lint failed' }
$results += 'TYPESCRIPT_LINT=PASS'
npm.cmd test
if ($LASTEXITCODE -ne 0) { throw 'Extension tests failed' }
$results += 'EXTENSION_TEST=PASS'
Pop-Location
& (Join-Path $root 'scripts\build-backend.ps1')
if ($LASTEXITCODE -ne 0) { throw 'PyInstaller build failed' }
$results += 'PYINSTALLER_BUILD=PASS'
python (Join-Path $root 'scripts\smoke_backend.py') --executable (Join-Path $root 'artifacts\backend\ai-worklog-server.exe')
if ($LASTEXITCODE -ne 0) { throw 'Packaged backend smoke test failed' }
$results += 'PACKAGED_BACKEND_SMOKE=PASS'
Write-Output '=== v0.1.1-verification summary ==='
$results | ForEach-Object { Write-Output $_ }
