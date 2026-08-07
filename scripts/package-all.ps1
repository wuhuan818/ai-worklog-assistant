$ErrorActionPreference='Stop'
& "$PSScriptRoot\build-extension.ps1"
Push-Location (Join-Path $PSScriptRoot '..\apps\vscode-extension')
try {
  npx.cmd --no-install @vscode/vsce package
  if ($LASTEXITCODE -ne 0) { throw 'VSIX packaging failed. Run npm.cmd ci in apps/vscode-extension first.' }
} finally { Pop-Location }
