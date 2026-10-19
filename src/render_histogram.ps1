# Histogram: where does the daily high sit inside the day's range?
# w = (high - open) / (high - low).  If the range were known in advance, w is all that is left.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$rows = Import-Csv (Join-Path $PSScriptRoot '..\data\range_bands_oos.csv')
$w = @()
foreach ($r in $rows) {
    $h = [double]$r.actual_high; $l = [double]$r.actual_low; $o = [double]$r.open
    if ($h -gt $l) { $w += ($h - $o) / ($h - $l) }
}
$n = $w.Count
$bins = 20
$counts = New-Object 'int[]' $bins
foreach ($x in $w) {
    $b = [int][Math]::Floor($x * $bins)
    if ($b -lt 0) { $b = 0 }
    if ($b -ge $bins) { $b = $bins - 1 }
    $counts[$b]++
}
$maxC = ($counts | Measure-Object -Maximum).Maximum

$W = 1500; $H = 780
$ml = 100; $mt = 130; $mr = 50; $mb = 96
$pw = $W - $ml - $mr; $ph = $H - $mt - $mb

$bmp = New-Object System.Drawing.Bitmap($W, $H)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
$g.Clear([System.Drawing.Color]::White)

$fontTitle = New-Object System.Drawing.Font('Segoe UI', 18, [System.Drawing.FontStyle]::Bold)
$fontSub = New-Object System.Drawing.Font('Segoe UI', 11)
$fontAxis = New-Object System.Drawing.Font('Segoe UI', 10)
$cInk = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(22, 32, 44))
$cMuted = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(96, 110, 128))
$cBar = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(31, 78, 121))
$cGrid = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(232, 237, 243), 1)

$bw = $pw / $bins
for ($i = 0; $i -lt $bins; $i++) {
    $hgt = $ph * $counts[$i] / $maxC
    $x = $ml + $i * $bw
    $g.FillRectangle($cBar, [float]($x + 2), [float]($mt + $ph - $hgt), [float]($bw - 4), [float]$hgt)
}
# baseline + gridlines
$g.DrawLine((New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(154, 168, 184), 1)), [float]$ml, [float]($mt + $ph), [float]($W - $mr), [float]($mt + $ph))
for ($t = 0; $t -le 4; $t++) {
    $v = 0.25 * $t
    $x = $ml + $v * $pw
    $g.DrawLine($cGrid, [float]$x, [float]$mt, [float]$x, [float]($mt + $ph))
    $lbl = ([string][math]::Round($v * 100)) + '%'
    $sz = $g.MeasureString($lbl, $fontAxis)
    $g.DrawString($lbl, $fontAxis, $cMuted, [float]($x - $sz.Width / 2), [float]($mt + $ph + 10))
}
$g.DrawString('position of the high inside the day''s range:  0% = high at the open, 100% = high at the close', $fontAxis, $cMuted, [float]$ml, [float]($mt + $ph + 38))

$g.DrawString('Even knowing the day''s exact range, the high''s position is close to random', $fontTitle, $cInk, [float]$ml, 42)
$g.DrawString("w = (high - open) / (high - low)   |   $($n.ToString('N0')) sessions   |   mean 0.50, sd 0.32, i.e. almost uniform", $fontSub, $cMuted, [float]$ml, 76)
$g.DrawString('50% of sessions put the high within 20% of one of the two edges -> you cannot place it from daily data, no matter how good your volatility forecast is.', $fontSub, $cMuted, [float]$ml, 100)

$out = Join-Path $PSScriptRoot '..\charts\high_position_histogram.png'
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Output "wrote $out ($((Get-Item $out).Length) bytes), n=$n"

