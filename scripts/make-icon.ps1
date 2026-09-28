param([string]$OutputPath = 'release/Moye/moye.ico')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$bitmap = New-Object System.Drawing.Bitmap 64,64
$canvas = [System.Drawing.Graphics]::FromImage($bitmap)
$canvas.SmoothingMode = 'AntiAlias'
$canvas.Clear([System.Drawing.Color]::FromArgb(73,104,75))
$pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255,254,250)),3
$canvas.DrawLine($pen, 20, 46, 43, 20)
$canvas.DrawBezier($pen, 22, 40, 7, 22, 38, 7, 46, 14)
$canvas.DrawBezier($pen, 46, 14, 56, 37, 35, 48, 22, 40)
$canvas.DrawLine($pen, 29, 36, 29, 24)
$icon = [System.Drawing.Icon]::FromHandle($bitmap.GetHicon())
$stream = [System.IO.File]::Create([System.IO.Path]::GetFullPath($OutputPath))
$icon.Save($stream)
$stream.Dispose()
$icon.Dispose()
$pen.Dispose()
$canvas.Dispose()
$bitmap.Dispose()
