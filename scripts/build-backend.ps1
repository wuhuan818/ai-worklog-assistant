$ErrorActionPreference='Stop'
python -m PyInstaller --onefile --name ai-worklog-server apps/local-server/app/main.py
