$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
New-Item -ItemType Directory -Force 'test-results' | Out-Null
& 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe' /nologo /target:exe /platform:x64 /codepage:65001 '/out:test-results\DocumentTests.exe' /r:System.dll /r:System.Core.dll '.\native\Document.cs' '.\tests\DocumentTests.cs'
if ($LASTEXITCODE -ne 0) { throw 'Test compilation failed' }
& './test-results/DocumentTests.exe' (Join-Path (Get-Location) ('test-results/files-' + [Guid]::NewGuid().ToString('N')))
if ($LASTEXITCODE -ne 0) { throw 'Document tests failed' }
