param(
  [switch]$Emulator,
  [switch]$Force
)
# One-time local Android setup for Filmie: JDK 21, SDK packages, NDK r29 and the UI-check dependency.
$ErrorActionPreference = 'Stop'
$Android = Join-Path $env:LOCALAPPDATA 'Android'
$Sdk = Join-Path $Android 'Sdk'
$Jdk = Join-Path $Android 'jdk-21'
$Ndk = Join-Path $Sdk 'ndk\29.0.14206865'
$Repo = Resolve-Path (Join-Path $PSScriptRoot '..\..')

New-Item -ItemType Directory -Force $Android, $Sdk | Out-Null

if ($Force -and (Test-Path $Jdk)) { Remove-Item -Recurse -Force $Jdk }
if (-not (Test-Path (Join-Path $Jdk 'bin\java.exe'))) {
  Write-Host 'Downloading Temurin JDK 21...'
  $zip = Join-Path $env:TEMP 'filmie-jdk21.zip'
  $tmp = Join-Path $env:TEMP 'filmie-jdk21'
  Remove-Item -Recurse -Force $tmp, $zip -ErrorAction SilentlyContinue
  Invoke-WebRequest -UseBasicParsing -Uri 'https://api.adoptium.net/v3/binary/latest/21/ga/windows/x64/jdk/hotspot/normal/eclipse' -OutFile $zip
  Expand-Archive -Path $zip -DestinationPath $tmp -Force
  $inner = Get-ChildItem $tmp -Directory | Select-Object -First 1
  Move-Item $inner.FullName $Jdk
  Remove-Item -Recurse -Force $tmp, $zip
}

$env:JAVA_HOME = $Jdk
$env:Path = "$Jdk\bin;$env:Path"
& "$Jdk\bin\java.exe" -version 2>&1 | Select-Object -First 1

$sdkmanager = Join-Path $Sdk 'cmdline-tools\latest\bin\sdkmanager.bat'
if (-not (Test-Path $sdkmanager)) {
  throw "sdkmanager not found at $sdkmanager. Install Android Studio or the command-line tools first."
}
$packages = @('build-tools;37.0.0', 'ndk;29.0.14206865')
Write-Host 'Installing Android SDK packages (skips anything already present)...'
& $sdkmanager --sdk_root=$Sdk --install @packages
if ($LASTEXITCODE -ne 0) { throw 'sdkmanager failed. Run it once with --licenses and accept them, then retry.' }

if ($Emulator) {
  $image = 'system-images;android-36;google_apis;x86_64'
  Write-Host "Installing emulator and $image..."
  & $sdkmanager --sdk_root=$Sdk --install 'emulator' $image
  if ($LASTEXITCODE -ne 0) { throw 'Could not install the emulator image.' }
  $avdmanager = Join-Path $Sdk 'cmdline-tools\latest\bin\avdmanager.bat'
  $avds = & $avdmanager list avd 2>&1
  if ($avds -notmatch 'Name: filmie') {
    'no' | & $avdmanager create avd -n filmie -k $image -d pixel_6 --force
  }
}

$extensions = Join-Path $Repo 'src-tauri\extensions'
if (-not (Test-Path $extensions)) { New-Item -ItemType Directory -Force $extensions | Out-Null }

if (-not (Test-Path (Join-Path $Repo '.env.local'))) {
  Write-Warning 'No .env.local in the repo root. Create it with TMDB=... and TRAKT=... before building.'
}

$uiDir = Join-Path $PSScriptRoot 'ui'
Write-Host 'Installing the UI-check dependency (Playwright Core, no browser download)...'
npm install --prefix $uiDir --save-dev playwright-core --no-audit --no-fund

& (Join-Path $PSScriptRoot 'env.ps1')
Write-Host ''
Write-Host 'Local Android toolchain ready.'
Write-Host '  Build:   .\scripts\android\build.ps1'
Write-Host '  Install: .\scripts\android\install.ps1 -Uninstall'
Write-Host '  Logs:    .\scripts\android\logcat.ps1'
Write-Host '  UI:      npm --prefix scripts/android/ui run check'
if ($Emulator) { Write-Host '  Emulator: .\scripts\android\emulator.ps1' }
