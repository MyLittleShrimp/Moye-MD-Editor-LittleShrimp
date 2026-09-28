param([ValidatePattern('^Moye(?:-\d+\.\d+\.\d+)?$')][string]$OutputName = 'Moye')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root
$package = Join-Path $root '.build/webview2'
$out = Join-Path (Join-Path $root 'release') $OutputName
if (-not (Test-Path (Join-Path $package 'lib/net462/Microsoft.Web.WebView2.Core.dll'))) {
    New-Item -ItemType Directory -Force '.build' | Out-Null
    & node --input-type=module -e "import {writeFile} from 'node:fs/promises'; const r=await fetch('https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/1.0.3800.47/microsoft.web.webview2.1.0.3800.47.nupkg'); if(!r.ok) throw new Error(r.status); await writeFile('.build/webview2.zip',Buffer.from(await r.arrayBuffer()));"
    if ($LASTEXITCODE -ne 0) { throw 'WebView2 SDK download failed' }
    Expand-Archive -LiteralPath '.build/webview2.zip' -DestinationPath $package -Force
}
& npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'UI build failed' }
New-Item -ItemType Directory -Force $out | Out-Null
$uiPath = [System.IO.Path]::GetFullPath((Join-Path $out 'ui'))
$expectedUiPath = [System.IO.Path]::GetFullPath((Join-Path (Join-Path (Join-Path $root 'release') $OutputName) 'ui'))
if ($uiPath -ne $expectedUiPath) { throw 'Unexpected UI output path; refusing to clean' }
if (Test-Path -LiteralPath $uiPath) { Remove-Item -LiteralPath $uiPath -Recurse -Force }
New-Item -ItemType Directory -Force $uiPath | Out-Null
Copy-Item 'dist/*' -Destination (Join-Path $out 'ui') -Recurse -Force
Copy-Item (Join-Path $package 'lib/net462/Microsoft.Web.WebView2.Core.dll') $out -Force
Copy-Item (Join-Path $package 'lib/net462/Microsoft.Web.WebView2.WinForms.dll') $out -Force
Copy-Item (Join-Path $package 'runtimes/win-x64/native/WebView2Loader.dll') $out -Force
& powershell -NoProfile -ExecutionPolicy Bypass -File scripts/make-icon.ps1 -OutputPath (Join-Path $out 'moye.ico')
if ($LASTEXITCODE -ne 0) { throw 'Icon build failed' }
$csc = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$core = Join-Path $out 'Microsoft.Web.WebView2.Core.dll'
$forms = Join-Path $out 'Microsoft.Web.WebView2.WinForms.dll'
$exe = Join-Path $out 'Moye.exe'
& $csc /nologo /target:winexe /platform:x64 /optimize+ /codepage:65001 "/out:$exe" "/win32icon:$out\moye.ico" '/win32manifest:native\app.manifest' /r:System.dll /r:System.Core.dll /r:System.Drawing.dll /r:System.Windows.Forms.dll /r:System.Web.Extensions.dll "/r:$core" "/r:$forms" '.\native\Document.cs' '.\native\Program.cs'
if ($LASTEXITCODE -ne 0) { throw 'Native build failed' }
Copy-Item 'native/Moye.exe.config' $out -Force
Copy-Item 'docs/USER_GUIDE.md' (Join-Path $out 'README.md') -Force
Copy-Item 'LICENSE' (Join-Path $out 'LICENSE') -Force
Copy-Item 'examples' $out -Recurse -Force
& node scripts/licenses.mjs $out
if ($LASTEXITCODE -ne 0) { throw 'License collection failed' }
Write-Output "Built: $exe"
