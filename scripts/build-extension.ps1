$ErrorActionPreference='Stop'
$root = Split-Path -Parent $PSScriptRoot
$server = Join-Path $root 'artifacts\backend\ai-worklog-server.exe'
$extension = Join-Path $root 'apps\vscode-extension'
if (-not (Test-Path $server)) { throw "Packaged backend not found: $server. Run scripts/build-backend.ps1 first." }
New-Item -ItemType Directory -Force -Path (Join-Path $extension 'server') | Out-Null
Copy-Item -Force $server (Join-Path $extension 'server\ai-worklog-server.exe')
Push-Location $extension
npm.cmd run compile
Pop-Location
Write-Output "Extension compiled with packaged backend: $extension\server\ai-worklog-server.exe"
