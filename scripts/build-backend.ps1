$ErrorActionPreference='Stop'
$root = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $root 'artifacts\backend'
$buildRoot = Join-Path $root 'artifacts\build\backend'
$lockDirectory = Join-Path $root 'artifacts\build'
$lockPath = Join-Path $lockDirectory 'backend-build.lock.json'
New-Item -ItemType Directory -Force -Path $dist,$buildRoot,$lockDirectory | Out-Null

function Test-LockOwnerAlive([object]$lock) {
  if (-not $lock.pid) { return $false }
  $process = Get-Process -Id ([int]$lock.pid) -ErrorAction SilentlyContinue
  if (-not $process) { return $false }
  try { return $process.StartTime.ToUniversalTime().ToString('o') -eq [string]$lock.processStartTime } catch { return $false }
}

if (Test-Path -LiteralPath $lockPath) {
  try { $previous = Get-Content -LiteralPath $lockPath -Raw -Encoding UTF8 | ConvertFrom-Json } catch { $previous = $null }
  if ($previous -and (Test-LockOwnerAlive $previous)) { throw "A verified backend build is already running (PID $($previous.pid)); refusing to share its build directory." }
  Remove-Item -LiteralPath $lockPath -Force
}

$self = Get-Process -Id $PID
$lock = [ordered]@{ schemaVersion='backend-build-lock/v1'; pid=$PID; processStartTime=$self.StartTime.ToUniversalTime().ToString('o'); startedAt=(Get-Date).ToUniversalTime().ToString('o'); workDirectory='pending' }
$stream = $null
try {
  # CreateNew is the atomic acquisition primitive: concurrent builders cannot
  # both claim the lock after observing a missing file.
  $stream = [System.IO.File]::Open($lockPath, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
  $runId = [guid]::NewGuid().ToString('N')
  $work = Join-Path $buildRoot $runId
  $runDist = Join-Path $work 'dist'
  $lock.workDirectory = ('artifacts/build/backend/' + $runId)
  $bytes = [System.Text.Encoding]::UTF8.GetBytes(($lock | ConvertTo-Json -Compress))
  $stream.Write($bytes, 0, $bytes.Length); $stream.Flush(); $stream.Dispose(); $stream = $null
  New-Item -ItemType Directory -Force -Path $work,$runDist | Out-Null
  python -m PyInstaller --noconfirm --clean --onefile --name ai-worklog-server --distpath $runDist --workpath $work --specpath $work (Join-Path $root 'apps\local-server\app\main.py')
  $candidate = Join-Path $runDist 'ai-worklog-server.exe'
  if (-not (Test-Path -LiteralPath $candidate)) { throw 'PyInstaller completed without ai-worklog-server.exe' }
  Copy-Item -LiteralPath $candidate -Destination (Join-Path $dist 'ai-worklog-server.exe') -Force
  Write-Output "Backend artifact: $dist\ai-worklog-server.exe"
} finally {
  if ($stream) { $stream.Dispose() }
  Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
}
