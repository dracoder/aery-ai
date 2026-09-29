$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { throw "csc.exe not found at $csc" }
$src = Join-Path $root 'scripts\warden.cs'
$out = Join-Path $root 'dist\warden.exe'
& $csc /nologo /optimize+ /target:exe /platform:x64 /out:$out /r:System.Security.dll $src
if ($LASTEXITCODE -ne 0) { throw "csc failed with $LASTEXITCODE" }
Write-Output "warden built -> $out"
