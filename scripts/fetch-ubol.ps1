# Downloads the pinned uBlock Origin Lite (Edge build, GPLv3) into src-tauri/extensions/ubol.
# It is git-ignored because it is 31 MB of third-party code. Bump the version and hash together.
$version = '2026.1026.1812'
$sha256 = '12a3be6e4c24c932677208bd0b8fff0689676ef2b0db689cfe794b02e0ed69fc'
$zip = Join-Path $env:TEMP "uBOLite_$version.edge.zip"
$dest = Join-Path $PSScriptRoot '..\src-tauri\extensions\ubol'

Invoke-WebRequest -UseBasicParsing -OutFile $zip "https://github.com/uBlockOrigin/uBOL-home/releases/download/$version/uBOLite_$version.edge.zip"
if ((Get-FileHash -Algorithm SHA256 $zip).Hash -ne $sha256) { Remove-Item $zip; throw 'uBO Lite hash mismatch, not installing.' }
if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
Expand-Archive -Path $zip -DestinationPath $dest
Remove-Item $zip
"uBO Lite $version installed in $dest"
