$ErrorActionPreference='Stop'
$env:PYTEST_DISABLE_PLUGIN_AUTOLOAD='1'
python -m pytest apps/local-server/tests -q
Push-Location apps/vscode-extension; npm.cmd run compile; Pop-Location
