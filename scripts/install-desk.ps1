param([switch]$Status, [switch]$Remove)

$ErrorActionPreference = 'Stop'
$root  = Split-Path -Parent $PSScriptRoot
$name  = 'Aeryx Desk'
$entry = Join-Path $root 'dist\session-agent.mjs'
$node  = (Get-Command node -ErrorAction SilentlyContinue).Source

function Say($m) { Write-Host "  $m" -ForegroundColor Cyan }

if ($Status) {
    $t = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
    if ($t) {
        $info = Get-ScheduledTaskInfo -TaskName $name
        Say "desk task : $($t.State)"
        Say "last run  : $($info.LastRunTime) (result $($info.LastTaskResult))"
        Say "runs as   : $($t.Principal.UserId)"
    } else { Say "desk task : not registered" }
    $listening = Get-NetTCPConnection -LocalPort 23800 -State Listen -ErrorAction SilentlyContinue
    Say "desk now  : $(if ($listening) { "listening (pid $($listening[0].OwningProcess))" } else { 'not running' })"
    exit 0
}

if ($Remove) {
    if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $name -Confirm:$false
        Say "desk task removed - core will report no hands after the next logon"
    } else { Say "nothing to remove" }
    exit 0
}

if (-not $node)              { Write-Host "node not on PATH" -ForegroundColor Red; exit 1 }
if (-not (Test-Path $entry)) { Write-Host "$entry missing - run npm run build" -ForegroundColor Red; exit 1 }

$logDir = Join-Path $root 'data'
New-Item -ItemType Directory -Force $logDir | Out-Null
$log = Join-Path $logDir 'desk.out.log'

$argLine = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -Command ' +
           '"& { & ''' + $node + ''' ''' + $entry + ''' *>> ''' + $log + ''' }"'

$action  = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $argLine -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive

if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $name -Confirm:$false
    Say "replaced the existing task"
}
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger `
    -Settings $settings -Principal $principal `
    -Description 'Aeryx desk - the half with a screen. Attaches to core at logon.' | Out-Null

Say "registered - the desk starts at every logon, logging to data\desk.out.log"
Write-Host ""
Write-Host "Start it now without waiting for a logon:  Start-ScheduledTask -TaskName '$name'" -ForegroundColor Gray
Write-Host "Check:                                     install-desk.ps1 -Status" -ForegroundColor Gray
Write-Host ""
