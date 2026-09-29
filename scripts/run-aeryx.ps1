param(
  [switch]$NoShell,
  [switch]$Quiet
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$port = 23799
$statusUrl = "http://127.0.0.1:$port/status"
$shellExe = Join-Path $root 'src-tauri\target\release\aeryx-shell.exe'
$taskName = 'Aeryx Daemon'

function Say($m) { Write-Host "[aeryx] $m" }

function Test-Daemon {
  try {
    $r = Invoke-WebRequest -Uri $statusUrl -TimeoutSec 3 -UseBasicParsing -ErrorAction Stop
    return $r.StatusCode -eq 200
  } catch { return $false }
}

function Fail($m) {
  Say $m
  if (-not $Quiet) {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show($m, 'Aeryx', 'OK', 'Error') | Out-Null
  }
  exit 1
}

if (Test-Daemon) {
  Say 'daemon already up'
} else {
  if (-not (Test-Path (Join-Path $root 'dist\aeryxd.mjs'))) {
    Fail "Aeryx is not built: dist\aeryxd.mjs is missing. Run 'npm run build' in $root first."
  }
  $task = $null
  try { $task = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop } catch {}
  if ($task) {
    Say "starting through the '$taskName' task"
    Start-ScheduledTask -TaskName $taskName
  } else {
    Say 'no scheduled task registered — starting directly'
    Start-Process powershell -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $root 'scripts\start-daemon.ps1') -WindowStyle Hidden
  }

  $deadline = (Get-Date).AddSeconds(45)
  while (-not (Test-Daemon)) {
    if ((Get-Date) -gt $deadline) {
      Fail "The daemon did not come up within 45s. Look at data\daemon.err.log in $root."
    }
    Start-Sleep -Milliseconds 700
  }
  Say 'daemon up'
}

if ($NoShell) { Say 'shell not requested — done'; exit 0 }

$running = Get-Process -Name 'aeryx-shell' -ErrorAction SilentlyContinue
if ($running) {
  Say 'shell already running — bringing it forward'
  $w = New-Object -ComObject WScript.Shell
  $withWindow = $running | Where-Object { $_.MainWindowTitle } | Select-Object -First 1
  if ($withWindow) { $null = $w.AppActivate($withWindow.Id) }
  exit 0
}

if (Test-Path $shellExe) {
  Say 'opening the shell'
  Start-Process $shellExe
} else {
  Say 'no shell binary — opening the Lair in the browser instead'
  Start-Process 'http://127.0.0.1:23799/lair'
  if (-not $Quiet) {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show(
      "Aeryx is up, but the desktop shell has not been built on this machine, so the Lair opened in your browser instead.`n`nTo get the shell: run 'npm run shell:build' in $root, then click this icon again.",
      'Aeryx', 'OK', 'Information') | Out-Null
  }
}
