param(
  [switch]$Headless,
  [switch]$NoBuild
)
# Builds x86_64, starts the 'filmie' AVD and installs the APK. Requires setup.ps1 -Emulator.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'env.ps1')

$emulator = Join-Path $env:ANDROID_HOME 'emulator\emulator.exe'
if (-not (Test-Path $emulator)) { throw 'Emulator not installed. Run .\scripts\android\setup.ps1 -Emulator.' }

Write-Host 'Acceleration check:'
& $emulator -accel-check 2>&1 | Select-Object -First 5

if (-not $NoBuild) {
  & (Join-Path $PSScriptRoot 'build.ps1') -Target x86_64
}

$running = (& adb devices) | Where-Object { $_ -match 'emulator-\d+\s+device\s*$' }
if (-not $running) {
  # A phone image with 2 GB ran the system UI out of memory and blocked the app, so give it more room.
  $arguments = @('-avd', 'filmie', '-no-snapshot', '-no-boot-anim', '-gpu', 'swiftshader_indirect', '-memory', '4096', '-cores', '4')
  if ($Headless) { $arguments += '-no-window' }
  Start-Process -FilePath $emulator -ArgumentList $arguments
  & adb wait-for-device
  while ($true) {
    $booted = ((& adb shell getprop sys.boot_completed) 2>$null).Trim()
    if ($booted -eq '1') { break }
    Start-Sleep -Seconds 3
  }
  # Animations only make a software-rendered emulator look slower than the app is.
  foreach ($s in 'window_animation_scale', 'transition_animation_scale', 'animator_duration_scale') {
    & adb shell settings put global $s 0
  }
}

& (Join-Path $PSScriptRoot 'install.ps1') -Apk (Join-Path $PSScriptRoot '..\..\dist\android\Filmie-x86_64-debug.apk')
