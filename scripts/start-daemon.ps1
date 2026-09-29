param([switch]$Force)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$entry = Join-Path $root 'dist\aeryxd.mjs'
$outLog = Join-Path $root 'data\daemon.out.log'
$errLog = Join-Path $root 'data\daemon.err.log'
$port = if ($env:AERYX_PORT) { [int]$env:AERYX_PORT } else { 23799 }

function Say($m) { Write-Host "[start-daemon] $m" }

if (-not (Test-Path $entry)) {
  Write-Error "no build at $entry - run 'npm run build' first"
  exit 1
}
if (-not (Test-Path (Join-Path $root 'data'))) {
  New-Item -ItemType Directory (Join-Path $root 'data') | Out-Null
}

$listeners = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
if ($listeners.Count -gt 0) {
  if (-not $Force) {
    $alive = $false
    try {
      Invoke-WebRequest -Uri "http://127.0.0.1:$port/status" -UseBasicParsing -TimeoutSec 5 | Out-Null
      $alive = $true
    } catch { $alive = $false }
    if ($alive) { Say "already running and answering on $port - nothing to do (use -Force to restart)"; exit 0 }
    Say "port $port held but not answering - sweeping the orphan"
  } else {
    Say "-Force: stopping whatever holds port $port"
  }
  foreach ($pid_ in ($listeners | Select-Object -ExpandProperty OwningProcess -Unique)) {
    try { Stop-Process -Id $pid_ -Force -ErrorAction Stop; Say "stopped pid $pid_" } catch {}
  }
  Start-Sleep -Seconds 2
}

Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -and $_.CommandLine -like '*dist\voice.mjs*' } |
  ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force; Say "stopped orphaned voice child pid $($_.ProcessId)" } catch {} }

$node = (Get-Command node).Source
Start-Process $node -ArgumentList 'dist\aeryxd.mjs' -WorkingDirectory $root -WindowStyle Hidden `
  -RedirectStandardOutput $outLog -RedirectStandardError $errLog

$deadline = (Get-Date).AddSeconds(30)
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 2
  try {
    $s = (Invoke-WebRequest -Uri "http://127.0.0.1:$port/status" -UseBasicParsing -TimeoutSec 5).Content | ConvertFrom-Json
    $chain = 'BROKEN'
    if ($s.chainIntact) { $chain = 'intact' }
    Say "up on $port - brain $($s.brain), chain $chain"
    exit 0
  } catch {}
}
Write-Error "daemon did not answer on $port within 30s - see $errLog"
exit 1
