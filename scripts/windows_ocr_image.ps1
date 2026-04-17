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
    return @{
        x = [int]$Rect.X
        y = [int]$Rect.Y
        width = [int]$Rect.Width
        height = [int]$Rect.Height
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
        $words += @{
            text = $word.Text
            bounds = Convert-BoundingRect -Rect $word.BoundingRect
        }
    }

    $lines += @{
        text = $line.Text
        bounds = Convert-BoundingRect -Rect $line.BoundingRect
        words = $words
    }
}

@{
    success = $true
    text = $result.Text
    line_count = $lines.Count
    lines = $lines
} | ConvertTo-Json -Depth 6
