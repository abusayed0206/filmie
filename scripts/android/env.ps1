# Sets the Android toolchain for this PowerShell session. Dot-source it:
#   . .\scripts\android\env.ps1
$ErrorActionPreference = 'Stop'

$Sdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
$Jdk = Join-Path $env:LOCALAPPDATA 'Android\jdk-21'
$Ndk = Join-Path $Sdk 'ndk\29.0.14206865'

if (-not (Test-Path (Join-Path $Jdk 'bin\java.exe'))) {
  throw "JDK 21 not found at $Jdk. Run .\scripts\android\setup.ps1 once."
}
if (-not (Test-Path (Join-Path $Sdk 'platform-tools\adb.exe'))) {
  throw "Android SDK not found at $Sdk. Install Android Studio or the command-line tools first."
}
if (-not (Test-Path (Join-Path $Ndk 'toolchains\llvm\prebuilt\windows-x86_64\bin\clang.exe'))) {
  throw "NDK r29 not found at $Ndk. Run .\scripts\android\setup.ps1 once."
}

$env:ANDROID_HOME = $Sdk
$env:ANDROID_SDK_ROOT = $Sdk
$env:JAVA_HOME = $Jdk
$env:NDK_HOME = $Ndk
$env:ANDROID_NDK_HOME = $Ndk
$env:CARGO_PROFILE_DEV_DEBUG = '0'
$env:Path = @(
  (Join-Path $Jdk 'bin'),
  (Join-Path $Ndk 'toolchains\llvm\prebuilt\windows-x86_64\bin'),
  (Join-Path $Sdk 'platform-tools'),
  (Join-Path $Sdk 'cmdline-tools\latest\bin'),
  (Join-Path $Sdk 'build-tools\37.0.0'),
  $env:Path
) -join ';'

Write-Host "ANDROID_HOME=$Sdk"
Write-Host "JAVA_HOME=$Jdk"
Write-Host "NDK_HOME=$Ndk"
