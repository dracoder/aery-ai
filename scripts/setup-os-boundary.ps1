param([switch]$Rollback)
$ErrorActionPreference = 'Stop'

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
  ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  $args2 = @('-NoProfile','-ExecutionPolicy','Bypass','-File',$PSCommandPath)
  if ($Rollback) { $args2 += '-Rollback' }
  Start-Process powershell -Verb RunAs -ArgumentList $args2 -Wait
  exit
}

$root    = Split-Path -Parent $PSScriptRoot
$workspace = $null
$cfgPath = Join-Path $root 'aeryx.config.json'
if (Test-Path -LiteralPath $cfgPath) { try { $workspace = (Get-Content -LiteralPath $cfgPath -Raw | ConvertFrom-Json).brain.workspace } catch {} }
if (-not $workspace) { $workspace = Join-Path $env:USERPROFILE 'AeryxWorkspace' }
$ffmpegDir = $null
if ($env:AERYX_FFMPEG) { $ffmpegDir = Split-Path -Parent $env:AERYX_FFMPEG }
else { $ff = Get-Command ffmpeg -ErrorAction SilentlyContinue; if ($ff) { $ffmpegDir = Split-Path -Parent $ff.Source } }
$account = 'aeryx-brain'
$me      = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$secrets = Join-Path $root 'secrets'
$cred    = Join-Path $secrets 'warden.cred'
Add-Type -AssemblyName System.Security

function Say($m) { Write-Host "  $m" }

if ($Rollback) {
  Write-Host "Rolling the OS boundary back..."
  try { icacls $root /reset /T /C /Q | Out-Null; Say "install-root ACLs reset to inherited" } catch { Say "ACL reset: $_" }
  $nodeDir = Split-Path -Parent (Get-Command node -ErrorAction SilentlyContinue).Source
  foreach ($p in @($workspace, $ffmpegDir, $nodeDir)) {
    if ($p) { try { icacls $p /remove $account /C /Q | Out-Null } catch {} }
  }
  try {
    $prof = Get-CimInstance Win32_UserProfile | Where-Object { $_.LocalPath -like "*\$account" }
    if ($prof) { Remove-CimInstance $prof; Say "profile removed" }
  } catch { Say "profile removal: $_" }
  try { Remove-LocalUser -Name $account; Say "account removed" } catch { Say "account: $_" }
  try { Remove-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon\SpecialAccounts\UserList' -Name $account -ErrorAction Stop } catch {}
  if (Test-Path $cred) { Remove-Item $cred -Force; Say "credential removed" }
  Write-Host "Done. Set brain.runAs back to 'self' in aeryx.config.json and restart the daemon."
  exit
}

Write-Host "Setting up the OS boundary (account: $account, root: $root)..."

$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$bytes = New-Object byte[] 24; $rng.GetBytes($bytes)
$password = 'Aa1!' + [Convert]::ToBase64String($bytes)
$sec = ConvertTo-SecureString $password -AsPlainText -Force
if (Get-LocalUser -Name $account -ErrorAction SilentlyContinue) {
  Set-LocalUser -Name $account -Password $sec
  Say "account exists -- password rotated"
} else {
  New-LocalUser -Name $account -Password $sec -PasswordNeverExpires -AccountNeverExpires `
    -Description "Aeryx brain -- launched by the Warden" | Out-Null
  Say "account created"
}
try { Add-LocalGroupMember -Group 'Users' -Member $account -ErrorAction Stop } catch {}
$reg = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon\SpecialAccounts\UserList'
if (-not (Test-Path $reg)) { New-Item -Path $reg -Force | Out-Null }
New-ItemProperty -Path $reg -Name $account -Value 0 -PropertyType DWord -Force | Out-Null
Say "hidden from the login screen"

New-Item -ItemType Directory -Force $secrets | Out-Null
$protected = [Convert]::ToBase64String(
  [System.Security.Cryptography.ProtectedData]::Protect(
    [System.Text.Encoding]::UTF8.GetBytes($password), $null,
    [System.Security.Cryptography.DataProtectionScope]::CurrentUser))
Set-Content -Path $cred -Value @($account, $protected) -Encoding ascii
icacls $secrets /inheritance:r /grant:r "SYSTEM:(OI)(CI)F" "BUILTIN\Administrators:(OI)(CI)F" "${me}:(OI)(CI)F" /Q | Out-Null
Say "credential stored (DPAPI, $me only)"

icacls $root /inheritance:r /grant:r "SYSTEM:(OI)(CI)F" "BUILTIN\Administrators:(OI)(CI)F" "${me}:(OI)(CI)F" "${account}:(OI)(CI)RX" /Q | Out-Null
icacls "$root\*" /reset /T /C /Q | Out-Null
icacls $secrets /inheritance:r /grant:r "SYSTEM:(OI)(CI)F" "BUILTIN\Administrators:(OI)(CI)F" "${me}:(OI)(CI)F" /Q | Out-Null
Say "install root: brain = read+execute"

New-Item -ItemType Directory -Force (Join-Path $root 'data') | Out-Null
New-Item -ItemType Directory -Force (Join-Path $root 'backups') | Out-Null
icacls (Join-Path $root 'data') /grant "${account}:(OI)(CI)M" /Q | Out-Null
Say "data\  : brain = modify (audit db + WAL siblings + brain-claude)"
icacls (Join-Path $root 'backups') /grant "${account}:(RX,WD,AD)" /Q | Out-Null
$anchor = Join-Path $root 'backups\.chain-anchor.json'
if (Test-Path $anchor) { icacls $anchor /grant "${account}:M" /Q | Out-Null }
Say "backups\: brain = create-file + anchor rewrite; daemon's backups untouchable"

$brainClaude = Join-Path $root 'data\brain-claude'
New-Item -ItemType Directory -Force $brainClaude | Out-Null
$srcCred = Join-Path $env:USERPROFILE '.claude\.credentials.json'
if (Test-Path $srcCred) { Copy-Item $srcCred (Join-Path $brainClaude '.credentials.json') -Force; Say "SDK credentials provisioned" }
else { Say "WARNING: $srcCred not found -- the brain will have no Anthropic auth until provisioned" }

New-Item -ItemType Directory -Force $workspace | Out-Null
icacls $workspace /grant "${account}:(OI)(CI)M" /Q | Out-Null
Say "$workspace : brain = modify (its workspace; the install root keeps its own ACL)"
if ($ffmpegDir) { icacls $ffmpegDir /grant "${account}:(OI)(CI)RX" /Q | Out-Null; Say "$ffmpegDir : read+execute (ffmpeg)" }
$nodeDir = Split-Path -Parent (Get-Command node -ErrorAction SilentlyContinue).Source
if ($nodeDir) { icacls $nodeDir /grant "${account}:(OI)(CI)RX" /Q | Out-Null; Say "$nodeDir : read+execute" }

Write-Host "`nVerification (via the Warden):"
$warden = Join-Path $root 'dist\warden.exe'
if (Test-Path $warden) {
  $who = & $warden --cred $cred -- cmd /c whoami 2>&1
  Say "runs as: $who"
  & $warden --cred $cred -- cmd /c "echo x > `"$root\src\.boundary-probe`"" 2>&1 | Out-Null
  if (Test-Path "$root\src\.boundary-probe") { Remove-Item "$root\src\.boundary-probe"; Say "FAIL: the brain could write src\ -- do not enable warden mode" }
  else { Say "OK: write to src\ refused by the OS" }
  & $warden --cred $cred -- cmd /c "echo x > `"$root\data\.boundary-probe`"" 2>&1 | Out-Null
  if (Test-Path "$root\data\.boundary-probe") { Remove-Item "$root\data\.boundary-probe"; Say "OK: write to data\ allowed" }
  else { Say "FAIL: the brain cannot write data\ -- the audit chain would stop; do not enable warden mode" }
} else {
  Say "dist\warden.exe missing -- run npm run build:warden, then re-run this script for verification"
}

Write-Host "`nNext: set brain.runAs to 'warden' in aeryx.config.json, restart the daemon,"
Write-Host "then run: node scripts/test-boundary-live.mjs"
