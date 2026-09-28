$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
$testOut = Join-Path (Get-Location) '.build\native-integration'
$release = Join-Path (Get-Location) 'release\Moye-1.1.0'
New-Item -ItemType Directory -Force $testOut | Out-Null
Copy-Item -LiteralPath (Join-Path $release 'Microsoft.Web.WebView2.Core.dll') -Destination $testOut -Force
Copy-Item -LiteralPath (Join-Path $release 'Microsoft.Web.WebView2.WinForms.dll') -Destination $testOut -Force
Copy-Item -LiteralPath (Join-Path $release 'WebView2Loader.dll') -Destination $testOut -Force
Copy-Item -LiteralPath (Join-Path $release 'ui') -Destination $testOut -Recurse -Force
$core = Join-Path $testOut 'Microsoft.Web.WebView2.Core.dll'
$forms = Join-Path $testOut 'Microsoft.Web.WebView2.WinForms.dll'
$testExe = Join-Path $testOut 'NativeIntegrationTests.exe'
& 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe' /nologo /target:exe /main:NativeIntegrationTests /platform:x64 /codepage:65001 "/out:$testExe" /r:System.dll /r:System.Core.dll /r:System.Drawing.dll /r:System.Windows.Forms.dll /r:System.Web.Extensions.dll "/r:$core" "/r:$forms" '.\native\Document.cs' '.\native\Program.cs' '.\tests\NativeIntegrationTests.cs'
if ($LASTEXITCODE -ne 0) { throw 'Integration test compilation failed' }
& $testExe (Join-Path (Get-Location) ('test-results\integration-' + [Guid]::NewGuid().ToString('N')))
if ($LASTEXITCODE -ne 0) { throw 'Native integration tests failed' }
