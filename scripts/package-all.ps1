$ErrorActionPreference='Stop'
& "$PSScriptRoot\build-extension.ps1"
if (Get-Command npx.cmd -ErrorAction SilentlyContinue) { Push-Location apps/vscode-extension; npx.cmd @vscode/vsce package; Pop-Location }
