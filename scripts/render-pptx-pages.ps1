[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$InputPath,

    [Parameter(Mandatory = $true)]
    [string]$OutputDir
)

$ErrorActionPreference = "Stop"
$powerPoint = $null
$presentation = $null

try {
    $resolvedInput = (Resolve-Path -LiteralPath $InputPath).Path
    $resolvedOutput = [System.IO.Path]::GetFullPath($OutputDir)
    [System.IO.Directory]::CreateDirectory($resolvedOutput) | Out-Null

    $powerPoint = New-Object -ComObject PowerPoint.Application
    $powerPoint.DisplayAlerts = 1
    try { $powerPoint.AutomationSecurity = 3 } catch { }

    $presentation = $powerPoint.Presentations.Open($resolvedInput, $true, $false, $false)
    $slideWidth = [double]$presentation.PageSetup.SlideWidth
    $slideHeight = [double]$presentation.PageSetup.SlideHeight
    $pixelWidth = 1920
    $pixelHeight = [Math]::Max(1, [Math]::Round($pixelWidth * $slideHeight / $slideWidth))

    for ($index = 1; $index -le $presentation.Slides.Count; $index++) {
        $slide = $presentation.Slides.Item($index)
        try {
            $filename = "slide-{0:D4}.png" -f $index
            $outputPath = Join-Path $resolvedOutput $filename
            $slide.Export($outputPath, "PNG", $pixelWidth, $pixelHeight)
            if (-not (Test-Path -LiteralPath $outputPath)) {
                throw "PowerPoint did not export slide $index."
            }
        }
        finally {
            if ($null -ne $slide) {
                [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($slide)
            }
        }
    }

    Write-Output ("rendered={0}" -f $presentation.Slides.Count)
}
finally {
    if ($null -ne $presentation) {
        try { $presentation.Close() } catch { }
        [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($presentation)
    }
    if ($null -ne $powerPoint) {
        try { $powerPoint.Quit() } catch { }
        [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($powerPoint)
    }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}
