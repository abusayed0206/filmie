param(
  [switch]$Clear,
  [switch]$All
)
# Streams the app's logcat. WebView console errors appear under the chromium tag.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'env.ps1')

$devices = (& adb devices) | Where-Object { $_ -match '\sdevice\s*$' }
if (-not $devices) { throw 'No phone or emulator connected.' }
if ($Clear) { & adb logcat -c }

$appPid = ((& adb shell pidof -s app.filmie) 2>$null).Trim()
if ($All -or -not $appPid) {
  & adb logcat -v time
} else {
  & adb logcat -v time --pid=$appPid |
    Select-String -Pattern 'filmie|Rust|Tauri|chromium|AndroidRuntime|rustls|certificate|trakt|tmdb'
}
