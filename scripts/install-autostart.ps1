param([switch]$WithShell, [switch]$Remove)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$taskName = 'Aeryx Daemon'
$startup = [Environment]::GetFolderPath('Startup')
$shellLink = Join-Path $startup 'Aeryx Shell.lnk'
$shellExe = Join-Path $root 'src-tauri\target\release\aeryx-shell.exe'

function Say($m) { Write-Host "[autostart] $m" }

if ($Remove) {
  try { Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction Stop; Say "task '$taskName' removed" }
  catch { Say "no task '$taskName' registered" }
  if (Test-Path $shellLink) { Remove-Item $shellLink -Force; Say 'shell startup shortcut removed' }
  Say 'Aeryx will no longer start at logon. Nothing else was touched.'
  exit 0
}

if (-not (Test-Path (Join-Path $root 'dist\aeryxd.mjs'))) {
  Write-Error "no build at dist\aeryxd.mjs - run 'npm run build' first"
  exit 1
}

$startScript = Join-Path $root 'scripts\start-daemon.ps1'
$taskArgs = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $startScript + '"'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $taskArgs -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$trigger.Delay = 'PT30S'
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings `
  -Description 'aeryxd - Aeryx resident daemon (loopback + tailnet, PIN-gated)' -Force | Out-Null
Say "task '$taskName' registered - the daemon starts 30s after logon"

if ($WithShell) {
  if (-not (Test-Path $shellExe)) {
    Say "shell not built at $shellExe - run 'npx tauri build --no-bundle' first; skipping"
  } else {
    $ws = New-Object -ComObject WScript.Shell
    $lnk = $ws.CreateShortcut($shellLink)
    $lnk.TargetPath = $shellExe
    $lnk.WorkingDirectory = $root
    $lnk.Description = 'Aeryx - HUD, tray and global hotkeys'
    $lnk.Save()
    Say 'shell startup shortcut created - the HUD waits for the daemon, then appears'
  }
}

Say 'done. Undo with: -Remove'
