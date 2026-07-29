$ErrorActionPreference='Stop'
python -m pip install -r apps/local-server/requirements.txt
Push-Location apps/vscode-extension; npm.cmd install; Pop-Location
