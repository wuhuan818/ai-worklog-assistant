$ErrorActionPreference='Stop'
$root = Split-Path -Parent $PSScriptRoot
$server = Join-Path $root 'artifacts\backend\ai-worklog-server.exe'
$extension = Join-Path $root 'apps\vscode-extension'
if (-not (Test-Path $server)) { throw "Packaged backend not found: $server. Run scripts/build-backend.ps1 first." }
New-Item -ItemType Directory -Force -Path (Join-Path $extension 'server') | Out-Null
Copy-Item -Force $server (Join-Path $extension 'server\ai-worklog-server.exe')
Push-Location $extension
npm.cmd run compile
# Tests are compiled alongside the extension because they share the TypeScript
# project.  They are not runtime assets and must not enter the release VSIX.
Get-ChildItem -Path (Join-Path $extension 'dist') -Recurse -Filter '*.test.js' | Remove-Item -Force
Get-ChildItem -Path (Join-Path $extension 'dist') -Recurse -Filter '*.test.js.map' | Remove-Item -Force
Pop-Location
Write-Output "Extension compiled with packaged backend: $extension\server\ai-worklog-server.exe"
