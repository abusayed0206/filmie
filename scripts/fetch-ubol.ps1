# Downloads the pinned uBlock Origin Lite (Edge build, GPLv3) into src-tauri/extensions/ubol.
# It is git-ignored because it is 31 MB of third-party code. Bump the version and hash together.
$version = '2026.1116.1650'
$sha256 = '9f98592f541d85271bd65eac6527d0e12d7f11d5bdff1e1414d6ae54cb60040c'
$zip = Join-Path $env:TEMP "uBOLite_$version.edge.zip"
$dest = Join-Path $PSScriptRoot '..\src-tauri\extensions\ubol'

Invoke-WebRequest -UseBasicParsing -OutFile $zip "https://github.com/uBlockOrigin/uBOL-home/releases/download/$version/uBOLite_$version.edge.zip"
if ((Get-FileHash -Algorithm SHA256 $zip).Hash -ne $sha256) { Remove-Item $zip; throw 'uBO Lite hash mismatch, not installing.' }
if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
Expand-Archive -Path $zip -DestinationPath $dest
Remove-Item $zip
"uBO Lite $version installed in $dest"
