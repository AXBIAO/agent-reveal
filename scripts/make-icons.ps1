# 生成扩展图标：深色圆角底 + 三个彩色光标（一次性脚本，结果已提交到 extension/icons）
Add-Type -AssemblyName System.Drawing
$out = Join-Path $PSScriptRoot '..\extension\icons'
New-Item -ItemType Directory -Force $out | Out-Null

function New-Cursor([float]$x, [float]$y, [float]$s) {
  $pts = @(
    [System.Drawing.PointF]::new($x, $y),
    [System.Drawing.PointF]::new($x + 7.5 * $s, $y + 19 * $s),
    [System.Drawing.PointF]::new($x + 10.1 * $s, $y + 11.1 * $s),
    [System.Drawing.PointF]::new($x + 18 * $s, $y + 8.5 * $s)
  )
  return ,$pts
}

foreach ($size in 16, 32, 48, 128) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.Clear([System.Drawing.Color]::Transparent)
  $r = $size * 0.22
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddArc(0, 0, 2 * $r, 2 * $r, 180, 90)
  $path.AddArc($size - 2 * $r - 1, 0, 2 * $r, 2 * $r, 270, 90)
  $path.AddArc($size - 2 * $r - 1, $size - 2 * $r - 1, 2 * $r, 2 * $r, 0, 90)
  $path.AddArc(0, $size - 2 * $r - 1, 2 * $r, 2 * $r, 90, 90)
  $path.CloseFigure()
  $g.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(24, 24, 27))), $path)
  $u = $size / 32.0
  $cursors = @(
    @{ x = 4;  y = 4;  c = '#ff4d4f' },
    @{ x = 18; y = 6;  c = '#2f7bff' },
    @{ x = 10; y = 17; c = '#16b364' }
  )
  foreach ($cur in $cursors) {
    [System.Drawing.PointF[]]$pts = New-Cursor ($cur.x * $u) ($cur.y * $u) (0.5 * $u)
    $g.FillPolygon((New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml($cur.c))), $pts)
    if ($size -ge 32) { $g.DrawPolygon((New-Object System.Drawing.Pen ([System.Drawing.Color]::White), (1.2 * $u)), $pts) }
  }
  $bmp.Save((Join-Path $out "$size.png"), [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}
Get-ChildItem $out | Select-Object Name, Length
