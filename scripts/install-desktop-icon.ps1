param([switch]$StartMenu, [switch]$Remove)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$desktop = [Environment]::GetFolderPath('Desktop')
$programs = [Environment]::GetFolderPath('Programs')
$name = 'Aeryx.lnk'
$desktopLink = Join-Path $desktop $name
$menuLink = Join-Path $programs $name
$icon = Join-Path $root 'src-tauri\icons\icon.ico'
$launcher = Join-Path $root 'scripts\run-aeryx.ps1'

function Say($m) { Write-Host "[icon] $m" -ForegroundColor Cyan }

if ($Remove) {
  foreach ($l in @($desktopLink, $menuLink)) {
    if (Test-Path $l) { Remove-Item $l -Force; Say "removed $l" } else { Say "nothing at $l" }
  }
  exit 0
}

if (-not (Test-Path $launcher)) { Write-Error "missing $launcher"; exit 1 }

$argline = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcher`""

function New-Link($path) {
  $w = New-Object -ComObject WScript.Shell
  $s = $w.CreateShortcut($path)
  $s.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
  $s.Arguments = $argline
  $s.WorkingDirectory = $root
  $s.WindowStyle = 7
  $s.Description = 'Start Aeryx and open the shell'
  if (Test-Path $icon) { $s.IconLocation = "$icon,0" } else { Say 'no icon.ico — the shortcut takes the PowerShell icon' }
  $s.Save()
  Say "created $path"
}

New-Link $desktopLink
if ($StartMenu) { New-Link $menuLink }

Say 'Double-click it: the daemon comes up if it is down, then the shell opens.'
Say 'Remove any time:  scripts\install-desktop-icon.ps1 -Remove'
