# Render the Nasdaq Composite CSV to a PNG chart using GDI+ (no external deps).
# Monthly high/low range bars + month-end close line.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$csv = Join-Path $PSScriptRoot '..\data\nasdaq_composite_IXIC_daily_2015-2026.csv'
$rows = Import-Csv $csv | ForEach-Object {
    [pscustomobject]@{
        Date  = $_.Date
        High  = [double]$_.High
        Low   = [double]$_.Low
        Close = [double]$_.Close
    }
}

# aggregate to months
$months = New-Object System.Collections.ArrayList
$cur = $null
foreach ($r in $rows) {
    $key = $r.Date.Substring(0, 7)
    if ($null -eq $cur -or $cur.Key -ne $key) {
        $cur = [pscustomobject]@{ Key = $key; High = $r.High; Low = $r.Low; Close = $r.Close }
        [void]$months.Add($cur)
    }
    if ($r.High -gt $cur.High) { $cur.High = $r.High }
    if ($r.Low -lt $cur.Low) { $cur.Low = $r.Low }
    $cur.Close = $r.Close
}
$m = $months.Count

$W = 1600; $H = 860
$ml = 118; $mt = 104; $mr = 46; $mb = 78
$pw = $W - $ml - $mr; $ph = $H - $mt - $mb

$min = ($months | Measure-Object Low -Minimum).Minimum
$max = ($months | Measure-Object High -Maximum).Maximum
$pad = ($max - $min) * 0.05
$y0 = $min - $pad; $y1 = $max + $pad

function Get-PX([double]$i) { [double]($ml + ($i / ($m - 1)) * $pw) }
function Get-PY([double]$v) { [double]($mt + (1 - ($v - $y0) / ($y1 - $y0)) * $ph) }

$bmp = New-Object System.Drawing.Bitmap($W, $H)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
$g.Clear([System.Drawing.Color]::White)

$fontTitle = New-Object System.Drawing.Font('Segoe UI', 19, [System.Drawing.FontStyle]::Bold)
$fontSub = New-Object System.Drawing.Font('Segoe UI', 11.5)
$fontAxis = New-Object System.Drawing.Font('Segoe UI', 10.5)
$fontMark = New-Object System.Drawing.Font('Segoe UI', 10.5, [System.Drawing.FontStyle]::Bold)
$cInk = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(22, 32, 44))
$cMuted = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(96, 110, 128))
$cGrid = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(232, 237, 243), 1)
$cAxis = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(154, 168, 184), 1)

# gridlines + y labels
$ticks = 7
for ($t = 0; $t -le $ticks; $t++) {
    $v = $y0 + (($y1 - $y0) * $t / $ticks)
    $py = Get-PY $v
    $g.DrawLine($cGrid, [float]$ml, [float]$py, [float]($W - $mr), [float]$py)
    $label = ([double][math]::Round($v)).ToString('N0')
    $sz = $g.MeasureString($label, $fontAxis)
    $g.DrawString($label, $fontAxis, $cMuted, [float]($ml - 12 - $sz.Width), [float]($py - $sz.Height / 2))
}

# monthly high-low bars
$penRange = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(140, 172, 209), 2.6)
$penRange.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$penRange.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
for ($i = 0; $i -lt $m; $i++) {
    $px = Get-PX $i
    $yHi = Get-PY $months[$i].High
    $yLo = Get-PY $months[$i].Low
    $g.DrawLine($penRange, [float]$px, [float]$yHi, [float]$px, [float]$yLo)
}

# month-end close line
$penLine = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(31, 78, 121), 2.0)
$penLine.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
$pts = New-Object 'System.Drawing.PointF[]' $m
for ($i = 0; $i -lt $m; $i++) {
    $pts[$i] = New-Object System.Drawing.PointF([float](Get-PX $i), [float](Get-PY $months[$i].Close))
}
$g.DrawLines($penLine, $pts)

# x labels: January of each year
$lastYear = ''
for ($i = 0; $i -lt $m; $i++) {
    $yr = $months[$i].Key.Substring(0, 4)
    if ($yr -ne $lastYear -and $months[$i].Key.Substring(5, 2) -eq '01') {
        $lastYear = $yr
        $px = Get-PX $i
        $g.DrawLine($cAxis, [float]$px, [float]($mt + $ph), [float]$px, [float]($mt + $ph + 6))
        $sz = $g.MeasureString($yr, $fontAxis)
        $g.DrawString($yr, $fontAxis, $cMuted, [float]($px - $sz.Width / 2), [float]($mt + $ph + 12))
    }
}

# markers at all-time high / low of the daily series
$hiIdx = 0; $loIdx = 0
for ($i = 1; $i -lt $rows.Count; $i++) {
    if ($rows[$i].High -gt $rows[$hiIdx].High) { $hiIdx = $i }
    if ($rows[$i].Low -lt $rows[$loIdx].Low) { $loIdx = $i }
}
$cRed = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(176, 58, 46))
$cGreen = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(30, 107, 82))
$hiKey = $rows[$hiIdx].Date.Substring(0, 7); $loKey = $rows[$loIdx].Date.Substring(0, 7)
$hiM = 0; $loM = 0
for ($i = 0; $i -lt $m; $i++) {
    if ($months[$i].Key -eq $hiKey) { $hiM = $i }
    if ($months[$i].Key -eq $loKey) { $loM = $i }
}

foreach ($spec in @(@($hiM, 'high ', $true), @($loM, 'low ', $false))) {
    $i = $spec[0]; $isHigh = $spec[2]
    $px = Get-PX $i
    if ($isHigh) { $val = $months[$i].High } else { $val = $months[$i].Low }
    $py = Get-PY $val
    if ($isHigh) { $br = $cRed } else { $br = $cGreen }
    $g.FillEllipse($br, [float]($px - 4), [float]($py - 4), 8, 8)
    $txt = $spec[1] + ([double]$val).ToString('N0')
    $sz = $g.MeasureString($txt, $fontMark)
    if ($isHigh) { $ty = $py - $sz.Height - 6 } else { $ty = $py + 6 }
    $tx = [math]::Min([math]::Max($px - $sz.Width / 2, $ml), $W - $mr - $sz.Width)
    $g.DrawString($txt, $fontMark, $br, [float]$tx, [float]$ty)
}

# frame + titles
$g.DrawLine($cAxis, [float]$ml, [float]($mt + $ph), [float]($W - $mr), [float]($mt + $ph))
$g.DrawString('Nasdaq Composite (^IXIC) - monthly high / low range and month-end close', $fontTitle, $cInk, [float]$ml, 34)
$sub = "$($rows[0].Date) to $($rows[$rows.Count-1].Date)  |  $($rows.Count.ToString('N0')) daily sessions in $m months  |  pale bars = monthly high-low range"
$g.DrawString($sub, $fontSub, $cMuted, [float]$ml, 66)
$g.DrawString('Daily data in the CSV. Source: Tencent kline feed (usIXIC); 3 sessions corrected against Eastmoney and api.nasdaq.com', $fontAxis, $cMuted, [float]$ml, [float]($H - 28))

$out = Join-Path $PSScriptRoot '..\charts\nasdaq_composite_IXIC_chart.png'
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Output "wrote $out ($((Get-Item $out).Length) bytes), months=$m"

