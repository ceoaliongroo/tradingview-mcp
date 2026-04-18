param(
    [Parameter(Mandatory = $true)]
    [string]$Path
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrResult, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]

function Await-WinRtResult {
    param(
        [Parameter(Mandatory = $true)]
        [Type]$ResultType,
        [Parameter(Mandatory = $true)]
        $Operation
    )

    $method = [System.WindowsRuntimeSystemExtensions].GetMethods() |
        Where-Object {
            $_.Name -eq 'AsTask' -and
            $_.IsGenericMethodDefinition -and
            $_.GetGenericArguments().Count -eq 1
        } |
        Select-Object -First 1

    if (-not $method) {
        throw 'Could not find System.WindowsRuntimeSystemExtensions.AsTask<TResult>.'
    }

    $generic = $method.MakeGenericMethod($ResultType)
    $task = $generic.Invoke($null, @($Operation))
    return $task.GetAwaiter().GetResult()
}

function Convert-BoundingRect {
    param($Rect)
    if (-not $Rect) {
        return $null
    }

    $x = $null
    $y = $null
    $width = $null
    $height = $null

    foreach ($candidate in @('X', 'x')) {
        if ($Rect.PSObject.Properties.Name -contains $candidate) { $x = [int]$Rect.$candidate; break }
    }
    foreach ($candidate in @('Y', 'y')) {
        if ($Rect.PSObject.Properties.Name -contains $candidate) { $y = [int]$Rect.$candidate; break }
    }
    foreach ($candidate in @('Width', 'width')) {
        if ($Rect.PSObject.Properties.Name -contains $candidate) { $width = [int]$Rect.$candidate; break }
    }
    foreach ($candidate in @('Height', 'height')) {
        if ($Rect.PSObject.Properties.Name -contains $candidate) { $height = [int]$Rect.$candidate; break }
    }

    return @{
        x = $x
        y = $y
        width = $width
        height = $height
    }
}

$resolvedPath = [System.IO.Path]::GetFullPath($Path)
$file = Await-WinRtResult -ResultType ([Windows.Storage.StorageFile]) -Operation ([Windows.Storage.StorageFile]::GetFileFromPathAsync($resolvedPath))
$stream = Await-WinRtResult -ResultType ([Windows.Storage.Streams.IRandomAccessStream]) -Operation ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read))
$decoder = Await-WinRtResult -ResultType ([Windows.Graphics.Imaging.BitmapDecoder]) -Operation ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream))
$bitmap = Await-WinRtResult -ResultType ([Windows.Graphics.Imaging.SoftwareBitmap]) -Operation ($decoder.GetSoftwareBitmapAsync())
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()

if (-not $engine) {
    throw 'Windows OCR engine is not available for the current user profile languages.'
}

$result = Await-WinRtResult -ResultType ([Windows.Media.Ocr.OcrResult]) -Operation ($engine.RecognizeAsync($bitmap))

$lines = @()
foreach ($line in $result.Lines) {
    $words = @()
    foreach ($word in $line.Words) {
        $wordRect = $null
        if ($word.PSObject.Properties.Name -contains 'BoundingRect') {
            $wordRect = $word.BoundingRect
        } elseif ($word.PSObject.Properties.Name -contains 'Bounds') {
            $wordRect = $word.Bounds
        } elseif ($word.PSObject.Properties.Name -contains 'Rectangle') {
            $wordRect = $word.Rectangle
        }
        $words += @{
            text = $word.Text
            bounds = Convert-BoundingRect -Rect $wordRect
        }
    }

    $lineRect = $null
    if ($line.PSObject.Properties.Name -contains 'BoundingRect') {
        $lineRect = $line.BoundingRect
    } elseif ($line.PSObject.Properties.Name -contains 'Bounds') {
        $lineRect = $line.Bounds
    } elseif ($line.PSObject.Properties.Name -contains 'Rectangle') {
        $lineRect = $line.Rectangle
    }
    $lines += @{
        text = $line.Text
        bounds = Convert-BoundingRect -Rect $lineRect
        words = $words
    }
}

@{
    success = $true
    text = $result.Text
    line_count = $lines.Count
    lines = $lines
} | ConvertTo-Json -Depth 6
