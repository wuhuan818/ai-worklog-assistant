$ErrorActionPreference='Stop'
Push-Location apps/vscode-extension; npm.cmd run compile; Pop-Location
