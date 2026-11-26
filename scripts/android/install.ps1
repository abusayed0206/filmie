param(
  [string]$Apk = '',
  [switch]$Uninstall
)
# Installs the newest local APK, or -Apk a specific one, and opens the app.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'env.ps1')

$Repo = Resolve-Path (Join-Path $PSScriptRoot '..\..')
if (-not $Apk) {
  $Apk = Get-ChildItem (Join-Path $Repo 'dist\android\*.apk') -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
}
if (-not $Apk -or -not (Test-Path $Apk)) { throw 'No APK found. Run build.ps1 first, or pass -Apk <path>.' }

$devices = (& adb devices) | Where-Object { $_ -match '\sdevice\s*$' }
if (-not $devices) { throw 'No phone or emulator. Connect a phone with USB debugging on, or start the emulator.' }

if ($Uninstall) {
  Write-Host 'Uninstalling app.filmie...'
  & adb uninstall app.filmie
}

Write-Host "Installing $Apk..."
$result = & adb install -r $Apk 2>&1
$result
if ($result -match 'INSTALL_FAILED_UPDATE_INCOMPATIBLE') {
  throw 'The installed app has a different debug key (CI vs local). Run this script with -Uninstall.'
}
if ($result -notmatch 'Success') { throw 'adb install failed.' }

& adb shell am start -n app.filmie/.MainActivity | Out-Null
Write-Host 'Started Filmie.'
