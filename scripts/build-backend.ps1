$ErrorActionPreference='Stop'
$root = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $root 'artifacts\backend'
$work = Join-Path $root 'artifacts\pyinstaller'
New-Item -ItemType Directory -Force -Path $dist,$work | Out-Null
python -m PyInstaller --noconfirm --clean --onefile --name ai-worklog-server --distpath $dist --workpath $work --specpath $work (Join-Path $root 'apps\local-server\app\main.py')
Write-Output "Backend artifact: $dist\ai-worklog-server.exe"
