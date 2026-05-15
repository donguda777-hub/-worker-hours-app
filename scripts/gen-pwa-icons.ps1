Add-Type -AssemblyName System.Drawing
function Save-Icon([int]$size, [string]$path) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.Clear([System.Drawing.Color]::FromArgb(255, 15, 23, 42))
  $g.Dispose()
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}
$root = Split-Path -Parent $PSScriptRoot
Save-Icon 192 (Join-Path $root "public\icon-192.png")
Save-Icon 512 (Join-Path $root "public\icon-512.png")
Write-Host "OK"
