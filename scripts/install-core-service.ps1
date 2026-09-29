
param([switch]$Status, [switch]$Remove, [switch]$ForService, [switch]$RunAsOwner)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Security
$root    = Split-Path -Parent $PSScriptRoot
$name     = 'AeryxCore'
$taskName = 'Aeryx Core'
$display  = 'Aeryx Core'
$cred    = Join-Path $root 'secrets\warden.cred'
$node    = (Get-Command node -ErrorAction SilentlyContinue).Source
$entry   = Join-Path $root 'dist\aeryxd.mjs'

function Say($m) { Write-Host "  $m" -ForegroundColor Cyan }

$admin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
         ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if ($Status) {
    $core = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($core) {
        $info = Get-ScheduledTaskInfo -TaskName $taskName
        Say "core boot task: $($core.State) as $($core.Principal.UserId)"
        Say "last run      : $($info.LastRunTime) (result $($info.LastTaskResult))"
    } else { Say "core boot task: not registered" }
    $svc = Get-Service -Name $name -ErrorAction SilentlyContinue
    if ($svc) { Say "legacy service: still present ($($svc.Status)) - run -Remove to clean it up" }
    $task = Get-ScheduledTask -TaskName 'Aeryx Daemon' -ErrorAction SilentlyContinue
    Say "logon task    : $(if ($task) { $task.State } else { 'not registered' })"
    $listening = Get-NetTCPConnection -LocalPort 23799 -State Listen -ErrorAction SilentlyContinue
    Say "core now      : $(if ($listening) { "listening (pid $($listening[0].OwningProcess))" } else { 'not running' })"
    if (Test-Path $cred) {
        try {
            $b = [Convert]::FromBase64String((Get-Content $cred)[1].Trim())
            $null = [System.Security.Cryptography.ProtectedData]::Unprotect($b, $null, 'CurrentUser')
            Say "warden.cred: present and decrypts for YOU (scope is not knowable from here)"
        } catch { Say "warden.cred: present but does NOT decrypt under this account" }
    } else { Say "warden.cred: absent" }
    exit 0
}

if (-not $admin) { Write-Host "This needs an elevated PowerShell." -ForegroundColor Yellow; exit 1 }

if ($Remove) {
    if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
        Say "core boot task removed"
    } else { Say "core boot task was not registered" }
    $svc = Get-Service -Name $name -ErrorAction SilentlyContinue
    if ($svc) {
        if ($svc.Status -ne 'Stopped') { Stop-Service -Name $name -Force; Start-Sleep -Seconds 2 }
        sc.exe --% delete AeryxCore
        Say "legacy Windows service removed"
    }
    Say "the logon task is untouched - re-register it with install-autostart.ps1 if you retired it"
    exit 0
}

if (-not $node)             { Write-Host "node not on PATH" -ForegroundColor Red; exit 1 }
if (-not (Test-Path $entry)){ Write-Host "$entry missing - run npm run build" -ForegroundColor Red; exit 1 }

$cfgPath = Join-Path $root 'aeryx.config.json'
$runAs = 'self'
if (Test-Path $cfgPath) {
    try { $runAs = (Get-Content $cfgPath -Raw | ConvertFrom-Json).brain.runAs } catch {}
}
Say "brain.runAs: $runAs"

if ($runAs -eq 'warden') {
    if (-not (Test-Path $cred)) {
        Write-Host "  brain.runAs is 'warden' but $cred is missing - run setup-os-boundary.ps1 first." -ForegroundColor Red
        exit 1
    }
    if ($true) {
        if (-not $ForService) {
            Write-Host ""
            Write-Host "  STOP. secrets\warden.cred is protected under your account, so the" -ForegroundColor Yellow
            Write-Host "  service (LocalSystem) could not decrypt it and the brain would not start." -ForegroundColor Yellow
            Write-Host ""
            Write-Host "  Re-run with -ForService to re-protect it with LocalMachine scope." -ForegroundColor Yellow
            Write-Host "  Cost, stated once: any process that can READ that file could then decrypt" -ForegroundColor Yellow
            Write-Host "  it. The ACL becomes the whole protection - and the brain account still has" -ForegroundColor Yellow
            Write-Host "  no read there, which is the boundary that matters. BitLocker covers the" -ForegroundColor Yellow
            Write-Host "  stolen-drive case. Your call." -ForegroundColor Yellow
            Write-Host ""
            exit 1
        }
        $lines = Get-Content $cred
        $pw = [System.Security.Cryptography.ProtectedData]::Unprotect(
            [Convert]::FromBase64String($lines[1].Trim()), $null, 'CurrentUser')
        $reprotected = [Convert]::ToBase64String(
            [System.Security.Cryptography.ProtectedData]::Protect($pw, $null, 'LocalMachine'))
        [Array]::Clear($pw, 0, $pw.Length)
        Set-Content -Path $cred -Value @($lines[0], $reprotected) -Encoding ascii
        Say "warden.cred re-protected with LocalMachine scope"
        Say "(whether LocalSystem can truly read it is proven by the brain starting, not by a check here)"
    }
}

$existingSvc = Get-Service -Name $name -ErrorAction SilentlyContinue
if ($existingSvc) {
    if ($existingSvc.Status -ne 'Stopped') { Stop-Service -Name $name -Force; Start-Sleep -Seconds 2 }
    sc.exe --% delete AeryxCore
    Start-Sleep -Seconds 1
    Say "removed the earlier (non-functional) Windows service"
}

$logDir = Join-Path $root 'data'
New-Item -ItemType Directory -Force $logDir | Out-Null
$outLog = Join-Path $logDir 'core.out.log'

$argLine = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -Command ' +
           '"& { & ''' + $node + ''' ''' + $entry + ''' --role core *>> ''' + $outLog + ''' }"'

$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $argLine -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtStartup
$trigger.Delay = 'PT60S'
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
if ($RunAsOwner) {
    $owner = "$env:USERDOMAIN\$env:USERNAME"
    $principal = New-ScheduledTaskPrincipal -UserId $owner -LogonType S4U -RunLevel Highest
    Say "core will run as $owner (S4U - no password stored anywhere)"
} else {
    $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    Say "core will run as SYSTEM"
}

if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Say "replaced the existing boot task"
}
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
    -Settings $settings -Principal $principal `
    -Description 'Aeryx core - the half that thinks. Starts at boot as SYSTEM; the desk attaches at logon.' | Out-Null

$made = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if (-not $made) { Write-Host "  boot task registration FAILED." -ForegroundColor Red; exit 1 }
Say "boot task registered: '$taskName' as $($principal.UserId), 60s after startup, logs to data\core.out.log"

Write-Host ""
Write-Host "NOT started yet - deliberately." -ForegroundColor Yellow
Write-Host "The logon task may still be registered and running a daemon on :23799." -ForegroundColor DarkGray
Write-Host "Two daemons would race for the port. Do this in order:" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  1. scripts\install-autostart.ps1 -Remove          # retire the logon task" -ForegroundColor Gray
Write-Host "  2. stop any running daemon (or just reboot)" -ForegroundColor Gray
Write-Host "  3. Start-ScheduledTask -TaskName 'Aeryx Core'    # or just reboot" -ForegroundColor Gray
Write-Host "  4. scripts\install-desk.ps1                      # the desk, at logon" -ForegroundColor Gray
Write-Host ""
Write-Host "Undo at any point:  install-core-service.ps1 -Remove" -ForegroundColor DarkGray
Write-Host ""
