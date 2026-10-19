# Predicted vs realized daily range, rendered to PNG with GDI+.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$csv = Join-Path $PSScriptRoot '..\data\range_bands_oos.csv'

$rows = Import-Csv $csv | ForEach-Object {
    [pscustomobject]@{
        Date = $_.date
        Open = [double]$_.open
        Act  = ([double]$_.actual_high - [double]$_.actual_low) / [double]$_.open
        Pred = ([double]$_.high_p50 - [double]$_.low_p50) / [double]$_.open
    }
}
$n = $rows.Count

# 20-day rolling mean of realized range
$roll = New-Object 'double[]' $n
for ($i = 0; $i -lt $n; $i++) {
    $a = [Math]::Max(0, $i - 19)
    $s = 0.0; $c = 0
    for ($j = $a; $j -le $i; $j++) { $s += $rows[$j].Act; $c++ }
    $roll[$i] = $s / $c
}

$W = 1600; $H = 800
$ml = 108; $mt = 104; $mr = 46; $mb = 74
$pw = $W - $ml - $mr; $ph = $H - $mt - $mb
$yMax = 0.05   # clip at 5% so the 2020 spikes don't flatten everything

function Get-PX([double]$i) { [double]($ml + ($i / ($n - 1)) * $pw) }
function Get-PY([double]$v) { [double]($mt + (1 - ([Math]::Min($v, $yMax) / $yMax)) * $ph) }

$bmp = New-Object System.Drawing.Bitmap($W, $H)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
$g.Clear([System.Drawing.Color]::White)

$fontTitle = New-Object System.Drawing.Font('Segoe UI', 19, [System.Drawing.FontStyle]::Bold)
$fontSub = New-Object System.Drawing.Font('Segoe UI', 11.5)
$fontAxis = New-Object System.Drawing.Font('Segoe UI', 10.5)
$cInk = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(22, 32, 44))
$cMuted = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(96, 110, 128))
$cGrid = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(232, 237, 243), 1)
$cAxis = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(154, 168, 184), 1)

for ($t = 0; $t -le 5; $t++) {
    $v = $yMax * $t / 5
    $py = Get-PY $v
    $g.DrawLine($cGrid, [float]$ml, [float]$py, [float]($W - $mr), [float]$py)
    $label = ([string][math]::Round($v * 100, 0)) + '%'
    $sz = $g.MeasureString($label, $fontAxis)
    $g.DrawString($label, $fontAxis, $cMuted, [float]($ml - 12 - $sz.Width), [float]($py - $sz.Height / 2))
}

# actual, raw
$penAct = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(206, 214, 224), 1.0)
$pa = New-Object 'System.Drawing.PointF[]' $n
for ($i = 0; $i -lt $n; $i++) { $pa[$i] = New-Object System.Drawing.PointF([float](Get-PX $i), [float](Get-PY $rows[$i].Act)) }
$g.DrawLines($penAct, $pa)

# actual, 20d mean
$penRoll = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(120, 132, 148), 2.0)
$pr = New-Object 'System.Drawing.PointF[]' $n
for ($i = 0; $i -lt $n; $i++) { $pr[$i] = New-Object System.Drawing.PointF([float](Get-PX $i), [float](Get-PY $roll[$i])) }
$g.DrawLines($penRoll, $pr)

# predicted median range
$penPred = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(31, 78, 121), 2.0)
$pp = New-Object 'System.Drawing.PointF[]' $n
for ($i = 0; $i -lt $n; $i++) { $pp[$i] = New-Object System.Drawing.PointF([float](Get-PX $i), [float](Get-PY $rows[$i].Pred)) }
$g.DrawLines($penPred, $pp)

# x labels
$lastYear = ''
for ($i = 0; $i -lt $n; $i++) {
    $yr = $rows[$i].Date.Substring(0, 4)
    if ($yr -ne $lastYear -and $rows[$i].Date.Substring(5, 2) -eq '01') {
        $lastYear = $yr
        $px = Get-PX $i
        $g.DrawLine($cAxis, [float]$px, [float]($mt + $ph), [float]$px, [float]($mt + $ph + 6))
        $sz = $g.MeasureString($yr, $fontAxis)
        $g.DrawString($yr, $fontAxis, $cMuted, [float]($px - $sz.Width / 2), [float]($mt + $ph + 12))
    }
}

# legend
$lgY = $H - 30
$g.DrawLine((New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(31, 78, 121), 2.4)), [float]$ml, [float]$lgY, [float]($ml + 26), [float]$lgY)
$g.DrawString('predicted median range (model)', $fontAxis, $cMuted, [float]($ml + 32), [float]($lgY - 9))
$g.DrawLine((New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(120, 132, 148), 2.4)), [float]($ml + 260), [float]$lgY, [float]($ml + 286), [float]$lgY)
$g.DrawString('realized range, 20-day mean', $fontAxis, $cMuted, [float]($ml + 292), [float]($lgY - 9))
$g.DrawLine((New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(206, 214, 224), 1.6)), [float]($ml + 500), [float]$lgY, [float]($ml + 526), [float]$lgY)
$g.DrawString('realized range, daily', $fontAxis, $cMuted, [float]($ml + 532), [float]($lgY - 9))

$g.DrawString('Nasdaq Composite - forecast vs realized daily high-low range (out-of-sample)', $fontTitle, $cInk, [float]$ml, 34)
$g.DrawString("$($rows[0].Date) to $($rows[$n-1].Date)  |  $($n.ToString('N0')) sessions, model refit monthly, no lookahead  |  y-axis clipped at 5%", $fontSub, $cMuted, [float]$ml, 66)

$out = Join-Path $PSScriptRoot '..\charts\range_forecast_validation.png'
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Output "wrote $out ($((Get-Item $out).Length) bytes)"


