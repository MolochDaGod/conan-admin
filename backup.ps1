# GRUDGE EXILES — Server Backup Script
# Run manually or via Task Scheduler
# Backs up: game saves, configs, admin panel, and logs

param(
    [string]$BackupRoot = "D:\backups\conan",
    [int]$KeepDays = 7
)

$ErrorActionPreference = "Stop"
$timestamp = Get-Date -Format "yyyy-MM-dd_HH-mm"
$backupDir = Join-Path $BackupRoot $timestamp

Write-Host "=== GRUDGE EXILES Backup ===" -ForegroundColor Red
Write-Host "Target: $backupDir" -ForegroundColor Yellow

# Create backup directory
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null

# 1. Game database and saves
$savedDir = "D:\ConanServer\ConanSandbox\Saved"
if (Test-Path $savedDir) {
    Write-Host "[1/4] Backing up game saves..." -ForegroundColor Cyan
    $saveDest = Join-Path $backupDir "Saved"
    # Copy the critical files: game.db, ServerSettings, Engine.ini
    New-Item -ItemType Directory -Path "$saveDest\Config\WindowsServer" -Force | Out-Null
    
    # Game database (the big one)
    $gameDb = Get-ChildItem $savedDir -Filter "game*.db" -Recurse -ErrorAction SilentlyContinue
    foreach ($db in $gameDb) {
        Copy-Item $db.FullName -Destination $saveDest -Force
        Write-Host "  -> $($db.Name) ($([math]::Round($db.Length/1MB, 1)) MB)" -ForegroundColor Gray
    }
    
    # Config files
    $configSrc = Join-Path $savedDir "Config\WindowsServer"
    if (Test-Path $configSrc) {
        Copy-Item "$configSrc\*" -Destination "$saveDest\Config\WindowsServer" -Force
        Write-Host "  -> Server configs" -ForegroundColor Gray
    }
} else {
    Write-Host "[1/4] SKIP: No Saved directory found" -ForegroundColor Yellow
}

# 2. Admin panel source
Write-Host "[2/4] Backing up admin panel..." -ForegroundColor Cyan
$adminDest = Join-Path $backupDir "conan-admin"
New-Item -ItemType Directory -Path $adminDest -Force | Out-Null
Copy-Item "D:\conan-admin\server.js" -Destination $adminDest -Force
Copy-Item "D:\conan-admin\package.json" -Destination $adminDest -Force
Copy-Item "D:\conan-admin\public" -Destination "$adminDest\public" -Recurse -Force
Write-Host "  -> server.js, package.json, public/" -ForegroundColor Gray

# 3. Cloudflare tunnel config
Write-Host "[3/4] Backing up tunnel config..." -ForegroundColor Cyan
$tunnelDest = Join-Path $backupDir "cloudflared"
New-Item -ItemType Directory -Path $tunnelDest -Force | Out-Null
Copy-Item "C:\Users\david\.cloudflared\config-conan.yml" -Destination $tunnelDest -Force
# Copy tunnel credentials (not the cert, just the tunnel json)
$tunnelCred = Get-ChildItem "C:\Users\david\.cloudflared" -Filter "2a20e3d9*.json" -ErrorAction SilentlyContinue
if ($tunnelCred) {
    Copy-Item $tunnelCred.FullName -Destination $tunnelDest -Force
    Write-Host "  -> Tunnel credentials + config" -ForegroundColor Gray
}

# 4. Recent logs (last log file only, not full history)
Write-Host "[4/4] Backing up recent logs..." -ForegroundColor Cyan
$logSrc = "D:\ConanServer\ConanSandbox\Saved\Logs\ConanSandbox.log"
if (Test-Path $logSrc) {
    Copy-Item $logSrc -Destination $backupDir -Force
    $logSize = [math]::Round((Get-Item $logSrc).Length / 1MB, 1)
    Write-Host "  -> ConanSandbox.log ($logSize MB)" -ForegroundColor Gray
}

# Compress the backup
Write-Host "`nCompressing..." -ForegroundColor Cyan
$archivePath = "$backupDir.zip"
Compress-Archive -Path $backupDir -DestinationPath $archivePath -Force
$archiveSize = [math]::Round((Get-Item $archivePath).Length / 1MB, 1)
Write-Host "  -> $archivePath ($archiveSize MB)" -ForegroundColor Green

# Remove uncompressed directory
Remove-Item $backupDir -Recurse -Force

# Prune old backups
Write-Host "`nPruning backups older than $KeepDays days..." -ForegroundColor Cyan
$cutoff = (Get-Date).AddDays(-$KeepDays)
$old = Get-ChildItem $BackupRoot -Filter "*.zip" | Where-Object { $_.LastWriteTime -lt $cutoff }
foreach ($f in $old) {
    Remove-Item $f.FullName -Force
    Write-Host "  Removed: $($f.Name)" -ForegroundColor DarkGray
}
if (-not $old) { Write-Host "  Nothing to prune." -ForegroundColor DarkGray }

# Summary
$remaining = (Get-ChildItem $BackupRoot -Filter "*.zip" -ErrorAction SilentlyContinue).Count
Write-Host "`n=== Backup Complete ===" -ForegroundColor Green
Write-Host "Archive: $archivePath" -ForegroundColor Yellow
Write-Host "Total backups on disk: $remaining" -ForegroundColor Yellow
