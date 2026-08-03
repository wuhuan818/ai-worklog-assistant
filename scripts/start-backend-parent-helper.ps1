param(
  [Parameter(Mandatory=$true)][string]$ExecutablePath,
  [Parameter(Mandatory=$true)][string]$DataDir,
  [Parameter(Mandatory=$true)][string]$Token,
  [Parameter(Mandatory=$true)][int]$Port
)
$ErrorActionPreference = 'Stop'
# This script intentionally exits immediately after launching the backend. Its
# PID is passed as the backend's ownership parent, which makes the watchdog
# test exercise a real parent-process death rather than a test-side kill.
$env:WORKLOG_DATA_DIR = $DataDir
$env:WORKLOG_SESSION_TOKEN = $Token
$env:WORKLOG_PORT = [string]$Port
$env:WORKLOG_EXTENSION_HOST_PID = [string]$PID
$env:WORKLOG_EXTENSION_INSTANCE_ID = [guid]::NewGuid().ToString('N')
$env:WORKLOG_BACKEND_GENERATION = '1'
$child = Start-Process -FilePath $ExecutablePath -WorkingDirectory (Split-Path -Parent $ExecutablePath) -PassThru -WindowStyle Hidden
Write-Output $child.Id
