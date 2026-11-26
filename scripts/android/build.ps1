param(
  [ValidateSet('aarch64', 'x86_64')]
  [string]$Target = 'aarch64',
  [switch]$Install,
  [switch]$SkipInit
)
# Builds a debug APK with the local toolchain and the real keys from .env.local.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'env.ps1')

$Repo = Resolve-Path (Join-Path $PSScriptRoot '..\..')
Set-Location $Repo

if (-not (Test-Path '.env.local')) {
  throw 'Missing .env.local in the repo root. It must contain TMDB=... and TRAKT=... for build.rs.'
}
if (-not (Test-Path 'src-tauri\icons\android')) {
  throw 'Missing src-tauri\icons\android. Run tauri icon src-tauri\icons\icon.svg, or restore the folder from git.'
}

if (-not $SkipInit -and -not (Test-Path 'src-tauri\gen\android')) {
  Write-Host 'Generating the Android Studio project...'
  & npx --yes '@tauri-apps/cli@2' android init --ci --skip-targets-install
  if ($LASTEXITCODE -ne 0) { throw 'tauri android init failed.' }
}

if (Test-Path 'src-tauri\gen\android\app\src\main\res') {
  Copy-Item 'src-tauri\icons\android\*' 'src-tauri\gen\android\app\src\main\res' -Recurse -Force
}

Write-Host "Building the $Target debug APK..."
Push-Location 'src-tauri'
try {
  & npx --yes '@tauri-apps/cli@2' android build --debug --apk --ci --target $Target
  if ($LASTEXITCODE -ne 0) { throw 'tauri android build failed.' }
} finally {
  Pop-Location
}

$apk = Get-ChildItem 'src-tauri\gen\android\app\build\outputs\apk' -Recurse -Filter '*.apk' -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $apk) { throw 'No APK was produced.' }

$dest = Join-Path $Repo "dist\android\Filmie-$Target-debug.apk"
New-Item -ItemType Directory -Force (Split-Path $dest) | Out-Null
Copy-Item $apk.FullName $dest -Force
$size = [math]::Round((Get-Item $dest).Length / 1MB, 1)
Write-Host "APK: $dest ($size MB)"

if ($Install) {
  & (Join-Path $PSScriptRoot 'install.ps1') -Apk $dest
}
