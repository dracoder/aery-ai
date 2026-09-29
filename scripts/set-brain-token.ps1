param([switch]$Status, [switch]$Remove)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Security
$root    = Split-Path -Parent $PSScriptRoot
$secrets = Join-Path $root 'secrets'
$cred    = Join-Path $secrets 'brain-token.cred'

function Say($m) { Write-Host "  $m" -ForegroundColor Cyan }

if ($Status) {
    if (Test-Path $cred) {
        $i = Get-Item $cred
        Say "brain token: PRESENT ($($i.Length) bytes, set $($i.LastWriteTime))"
        try {
            $blob = [Convert]::FromBase64String((Get-Content $cred -Raw).Trim())
            $null = [System.Security.Cryptography.ProtectedData]::Unprotect(
                $blob, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
            Say "decrypts cleanly under this account"
        } catch {
            Write-Host "  PRESENT BUT UNREADABLE under this account - re-run without -Status to replace it." -ForegroundColor Red
            exit 1
        }
    } else {
        Say "brain token: not set (the brain falls back to a copy of your credential)"
    }
    exit 0
}

if ($Remove) {
    if (Test-Path $cred) { Remove-Item $cred -Force; Say "removed - the brain falls back to copying your credential at next start" }
    else { Say "nothing to remove" }
    exit 0
}

Write-Host ""
Write-Host "Paste the token from 'claude setup-token'." -ForegroundColor Yellow
Write-Host "It will not echo. It is not stored in plaintext and never leaves this machine." -ForegroundColor DarkGray
Write-Host ""

$sec = Read-Host -AsSecureString "Brain token"
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
try { $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }

if ([string]::IsNullOrWhiteSpace($plain)) { Write-Host "  nothing entered - aborted." -ForegroundColor Red; exit 1 }
$plain = $plain.Trim()
if ($plain.Length -lt 40 -or $plain -notmatch '^sk-ant-[a-zA-Z0-9-]+$') {
    Write-Host "  that does not look like a setup-token credential (expected sk-ant-...)." -ForegroundColor Red
    Write-Host "  Run 'claude setup-token' and paste the whole token, with no quotes." -ForegroundColor Red
    exit 1
}

New-Item -ItemType Directory -Force $secrets | Out-Null
$protected = [Convert]::ToBase64String(
    [System.Security.Cryptography.ProtectedData]::Protect(
        [System.Text.Encoding]::UTF8.GetBytes($plain), $null,
        [System.Security.Cryptography.DataProtectionScope]::CurrentUser))
Set-Content -Path $cred -Value $protected -Encoding ascii
$plain = $null

$me = "$env:USERDOMAIN\$env:USERNAME"
icacls $secrets /inheritance:r /grant:r "SYSTEM:(OI)(CI)F" "BUILTIN\Administrators:(OI)(CI)F" "${me}:(OI)(CI)F" /Q | Out-Null

Say "stored, DPAPI-protected, readable only by $me"
Write-Host ""
Write-Host "Next: set brain.syncCredential to false in aeryx.config.json, then restart the daemon." -ForegroundColor Yellow
Write-Host "The daemon refuses to copy your credential while this token exists either way." -ForegroundColor DarkGray
Write-Host "Check any time:  scripts\set-brain-token.ps1 -Status"
Write-Host ""
