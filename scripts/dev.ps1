$ErrorActionPreference='Stop'
python -m uvicorn app.main:app --app-dir apps/local-server --host 127.0.0.1 --port 8765
