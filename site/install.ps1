& {
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$AeryxDir = if ($env:AERYX_DIR) { $env:AERYX_DIR } else { Join-Path $env:LOCALAPPDATA 'Aeryx\runtime' }
$Release = if ($env:AERYX_RELEASE) { $env:AERYX_RELEASE } else { 'https://github.com/dracoder/aery-ai/releases/latest/download' }
$WantApp = $env:AERYX_APP -eq '1'
$Source = $env:AERYX_SOURCE
$DevSource = 'https://github.com/dracoder/aery-ai/archive/refs/heads/main.tar.gz'
$NodeVersion = '20.19.1'
$ReleaseKeys = 'BrGv7gJgfFwCNYb+Bv1SHoBiVkkIHLUvzhuQT4RC05Q='

function Fail($msg) { throw "aeryx install: $msg" }

function Invoke-Native([scriptblock]$Command) {
  $old = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { & $Command } finally { $ErrorActionPreference = $old }
}

function Add-UserPath($dir) {
  $k = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
  $p = $k.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
  if (($p -split ';') -contains $dir) { return }
  $k.SetValue('Path', ((@($p, $dir) | Where-Object { $_ }) -join ';'), [Microsoft.Win32.RegistryValueKind]::ExpandString)
  [Environment]::SetEnvironmentVariable('AERYX_PATH_REFRESH', '1', 'User')
  [Environment]::SetEnvironmentVariable('AERYX_PATH_REFRESH', $null, 'User')
}

$arch = switch ($env:PROCESSOR_ARCHITECTURE) { 'ARM64' { 'arm64' } 'AMD64' { 'x64' } default { Fail "unsupported CPU $env:PROCESSOR_ARCHITECTURE" } }
if (-not (Get-Command tar.exe -ErrorAction SilentlyContinue)) { Fail 'tar.exe is required (Windows 10 1803 or later)' }

$cli = Join-Path $AeryxDir 'app\scripts\aeryx-cli.mjs'
$shim = Join-Path $AeryxDir 'bin\aeryx.cmd'

$script:Sums = $null
function Get-ReleaseSums {
  if ($null -eq $script:Sums) {
    $dir = Join-Path ([IO.Path]::GetTempPath()) ("aeryx-sums-" + [Guid]::NewGuid())
    New-Item -ItemType Directory -Path $dir | Out-Null
    try {
      try { Invoke-WebRequest "$Release/SHA256SUMS" -OutFile "$dir\SHA256SUMS" -UseBasicParsing } catch { $script:Sums = ''; return $script:Sums }
      try { Invoke-WebRequest "$Release/SHA256SUMS.sig" -OutFile "$dir\SHA256SUMS.sig" -UseBasicParsing } catch { Fail 'the release has no signature, so nothing was installed' }
      Set-Content -LiteralPath "$dir\verify.js" -Encoding ASCII -Value "const [keys,file,sigFile]=process.argv.slice(2);const c=require('crypto'),fs=require('fs');const data=fs.readFileSync(file),sig=Buffer.from(fs.readFileSync(sigFile,'utf8').trim(),'base64');process.exit(keys.split(',').some((k)=>c.verify(null,data,c.createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),Buffer.from(k,'base64')]),format:'der',type:'spki'}),sig))?0:1);"
      $node = Join-Path $AeryxDir 'node\node.exe'
      Invoke-Native { & $node "$dir\verify.js" $ReleaseKeys "$dir\SHA256SUMS" "$dir\SHA256SUMS.sig" }
      if ($LASTEXITCODE -ne 0) { Fail 'the release signature is not valid, so nothing was installed' }
      $script:Sums = [IO.File]::ReadAllText("$dir\SHA256SUMS")
    } finally {
      Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
  return $script:Sums
}
function Test-Verified($name, $file) {
  $expected = ((Get-ReleaseSums) -split "`n" | Where-Object { $_ -match " $([regex]::Escape($name))$" } | ForEach-Object { ($_ -split '\s+')[0] }) | Select-Object -First 1
  return [bool]$expected -and ((Get-FileHash $file -Algorithm SHA256).Hash.ToLower() -eq $expected.ToLower())
}

function Install-App($tmp) {
  $asset = 'Aeryx-windows-x64-setup.exe'
  Write-Host 'Downloading the Aeryx desktop app...'
  try {
    if (-not (Get-ReleaseSums)) { throw 'no release' }
    Invoke-WebRequest "$Release/$asset" -OutFile "$tmp\$asset" -UseBasicParsing
  } catch {
    Write-Host 'The desktop app is not released yet - the web version is installed.'
    return $false
  }
  if (-not (Test-Verified $asset "$tmp\$asset")) { Fail 'the desktop app download failed its checksum' }
  $p = Start-Process -FilePath "$tmp\$asset" -ArgumentList '/S' -Wait -PassThru
  if ($p.ExitCode -ne 0) { Fail "the desktop app installer exited with $($p.ExitCode)" }
  Write-Host 'Installed the Aeryx desktop app (Start menu: Aeryx).'
  return $true
}

function Open-Aeryx($appInstalled) {
  $exe = Join-Path $env:LOCALAPPDATA 'Aeryx\Aeryx.exe'
  if ($appInstalled -and (Test-Path -LiteralPath $exe)) {
    Invoke-Native { & $shim start --no-open }
    if ($env:AERYX_NO_OPEN -ne '1') { Start-Process -FilePath $exe }
  } else {
    Invoke-Native { & $shim start }
  }
}

if (-not (Test-Path -LiteralPath $cli) -and (Test-Path -LiteralPath $AeryxDir) -and -not (Test-Path -LiteralPath (Join-Path $AeryxDir '.aeryx-install')) -and (Get-ChildItem -LiteralPath $AeryxDir -Force | Select-Object -First 1)) {
  Fail "$AeryxDir exists and is not an Aeryx install - set AERYX_DIR to another folder"
}

$tmp = Join-Path ([IO.Path]::GetTempPath()) ("aeryx-" + [Guid]::NewGuid())
New-Item -ItemType Directory -Path $tmp | Out-Null

if (Test-Path -LiteralPath $cli) {
  try {
    Write-Host "Aeryx is already installed in $AeryxDir - updating instead."
    Invoke-Native { & $shim update }
    if ($LASTEXITCODE -ne 0) { Fail 'update failed' }
    if ($WantApp) { Open-Aeryx (Install-App $tmp) }
  } finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
  }
  return
}

New-Item -ItemType Directory -Force -Path $AeryxDir | Out-Null
New-Item -ItemType File -Force -Path (Join-Path $AeryxDir '.aeryx-install') | Out-Null

try {
  $pkg = "node-v$NodeVersion-win-$arch"
  Write-Host "Downloading Node $NodeVersion (win-$arch)..."
  Invoke-WebRequest "https://nodejs.org/dist/v$NodeVersion/$pkg.zip" -OutFile "$tmp\node.zip" -UseBasicParsing
  $sums = (Invoke-WebRequest "https://nodejs.org/dist/v$NodeVersion/SHASUMS256.txt" -UseBasicParsing).Content
  $expected = ($sums -split "`n" | Where-Object { $_ -match " $([regex]::Escape("$pkg.zip"))$" } | ForEach-Object { ($_ -split '\s+')[0] }) | Select-Object -First 1
  $actual = (Get-FileHash "$tmp\node.zip" -Algorithm SHA256).Hash.ToLower()
  if (-not $expected -or $actual -ne $expected.ToLower()) { Fail 'Node download failed its checksum' }
  Invoke-Native { tar.exe -xf "$tmp\node.zip" -C $tmp }
  if ($LASTEXITCODE -ne 0) { Fail 'could not unpack Node' }
  $nodeDir = Join-Path $AeryxDir 'node'
  if (Test-Path -LiteralPath $nodeDir) { Remove-Item -LiteralPath $nodeDir -Recurse -Force }
  Move-Item -LiteralPath (Join-Path $tmp $pkg) -Destination $nodeDir

  Write-Host 'Fetching Aeryx...'
  $app = Join-Path $AeryxDir 'app'
  New-Item -ItemType Directory -Force -Path $app | Out-Null
  if ($Source -and (Test-Path -LiteralPath $Source -PathType Container)) {
    Invoke-Native { robocopy $Source $app /E /NFL /NDL /NJH /NJS /NP /XD node_modules .git dist data backups secrets | Out-Null }
    if ($LASTEXITCODE -ge 8) { Fail 'could not copy the source folder' }
  } else {
    $archive = $Source
    if (-not $Source) {
      $archive = "$tmp\aeryx.tar.gz"
      $fromRelease = $false
      if (Get-ReleaseSums) {
        try { Invoke-WebRequest "$Release/aeryx-source.tar.gz" -OutFile $archive -UseBasicParsing; $fromRelease = $true } catch { }
      }
      if ($fromRelease) {
        if (-not (Test-Verified 'aeryx-source.tar.gz' $archive)) { Fail 'the Aeryx source failed its checksum' }
      } else {
        Write-Host 'No release yet - installing the development branch.'
        Invoke-WebRequest $DevSource -OutFile $archive -UseBasicParsing
      }
    } elseif ($Source -match '^https://') { Invoke-WebRequest $Source -OutFile "$tmp\aeryx.tar.gz" -UseBasicParsing; $archive = "$tmp\aeryx.tar.gz" }
    Invoke-Native { tar.exe -xzf $archive -C $app --strip-components=1 }
    if ($LASTEXITCODE -ne 0) { Fail 'could not unpack the source archive' }
  }

  $bin = Join-Path $AeryxDir 'bin'
  New-Item -ItemType Directory -Force -Path $bin | Out-Null
  Set-Content -LiteralPath $shim -Encoding ASCII -Value "@`"%~dp0..\node\node.exe`" `"%~dp0..\app\scripts\aeryx-cli.mjs`" %*"

  Invoke-Native { & $shim setup }
  if ($LASTEXITCODE -ne 0) { Fail 'setup failed' }

  Add-UserPath $bin
  $env:Path = "$bin;$env:Path"

  $appInstalled = $false
  if ($WantApp) { $appInstalled = Install-App $tmp }
  Open-Aeryx $appInstalled
  Write-Host ''
  Write-Host 'Aeryx is installed. In a new terminal:'
  Write-Host '  aeryx status | stop | start | update | autostart on | uninstall'
} finally {
  Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
}
