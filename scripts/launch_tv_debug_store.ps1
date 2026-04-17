param(
  [int]$Port = 9222
)

$AppId = '31178TradingViewInc.TradingView_q4jpyh43s5mv6!TradingView.Desktop'

Write-Host "Launching TradingView Store app via AppsFolder: $AppId"

$command = 'start "" "shell:AppsFolder\' + $AppId + '" --remote-debugging-port=' + $Port
& cmd.exe /c $command

if ($LASTEXITCODE -ne 0) {
  Write-Host "Failed to launch TradingView Store app."
  exit 1
}

exit 0
