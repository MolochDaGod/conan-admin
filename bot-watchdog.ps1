# GRUDGE EXILES — Bot Watchdog
# Monitors bot.js and restarts it if it crashes.
# Run via: powershell -NoProfile -ExecutionPolicy Bypass -File bot-watchdog.ps1

$BOT_DIR = "D:\conan-admin"
$LOG = "$BOT_DIR\watchdog.log"

function Log($msg) {
  $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  "$ts $msg" | Out-File -Append $LOG
  Write-Host "$ts $msg"
}

Log "[Watchdog] Starting bot watchdog..."

while ($true) {
  # Check if bot is already running
  $existing = Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object {
    (Get-CimInstance Win32_Process -Filter "ProcessId=$($_.Id)").CommandLine -like "*bot.js*"
  }

  if ($existing) {
    # Bot is running, wait and check again
    Start-Sleep -Seconds 30
    continue
  }

  # Bot is not running — start it
  Log "[Watchdog] Bot not running, starting..."
  $proc = Start-Process -FilePath "node" -ArgumentList "$BOT_DIR\bot.js" -WorkingDirectory $BOT_DIR -RedirectStandardOutput "$BOT_DIR\bot-stdout.log" -RedirectStandardError "$BOT_DIR\bot-stderr.log" -WindowStyle Hidden -PassThru

  Log "[Watchdog] Bot started (PID $($proc.Id))"

  # Wait for process to exit
  $proc.WaitForExit()
  $exitCode = $proc.ExitCode
  Log "[Watchdog] Bot exited with code $exitCode"

  # Brief pause before restart to avoid rapid crash loops
  Log "[Watchdog] Restarting in 10s..."
  Start-Sleep -Seconds 10
}
