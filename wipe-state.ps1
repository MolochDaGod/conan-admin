# GRUDGE EXILES — Wipe State Manager
# Saves the current game database as a "wipe template" that preserves map rooms,
# admin buildings, and other permanent structures across server wipes.
#
# Usage:
#   .\wipe-state.ps1 -Action save     # Snapshot current world as wipe template
#   .\wipe-state.ps1 -Action restore   # Wipe server and restore from template
#   .\wipe-state.ps1 -Action info      # Show current wipe state info

param(
    [Parameter(Mandatory=$true)]
    [ValidateSet("save", "restore", "info")]
    [string]$Action,

    [string]$ConanDir = "D:\ConanServer",
    [string]$WipeStateDir = "D:\backups\conan\wipe-state"
)

$ErrorActionPreference = "Stop"
$savedDir = Join-Path $ConanDir "ConanSandbox\Saved"
$metaFile = Join-Path $WipeStateDir "wipe-state.json"

function Get-GameDbs {
    return Get-ChildItem $savedDir -Filter "game*.db" -ErrorAction SilentlyContinue
}

switch ($Action) {
    "save" {
        Write-Host "`n=== GRUDGE EXILES — Save Wipe State ===" -ForegroundColor Red

        # Verify game databases exist
        $dbs = Get-GameDbs
        if (-not $dbs) {
            Write-Host "ERROR: No game*.db files found in $savedDir" -ForegroundColor Red
            exit 1
        }

        # Create wipe state directory
        New-Item -ItemType Directory -Path $WipeStateDir -Force | Out-Null

        # Copy game databases
        Write-Host "Saving game databases..." -ForegroundColor Cyan
        foreach ($db in $dbs) {
            Copy-Item $db.FullName -Destination $WipeStateDir -Force
            $sizeMB = [math]::Round($db.Length / 1MB, 1)
            Write-Host "  -> $($db.Name) ($sizeMB MB)" -ForegroundColor Gray
        }

        # Save metadata
        $meta = @{
            savedAt = (Get-Date -Format "o")
            savedBy = $env:USERNAME
            serverRunning = $null -ne (Get-Process "ConanSandboxServer-Win64-Shipping" -ErrorAction SilentlyContinue)
            files = @($dbs | ForEach-Object { @{ name = $_.Name; sizeMB = [math]::Round($_.Length/1MB,1) } })
        }
        $meta | ConvertTo-Json -Depth 3 | Set-Content $metaFile -Encoding UTF8
        Write-Host "`nWipe state saved to: $WipeStateDir" -ForegroundColor Green
        Write-Host "Files: $($dbs.Count) database(s)" -ForegroundColor Yellow
        Write-Host "`nWhen you wipe, run: .\wipe-state.ps1 -Action restore" -ForegroundColor Yellow
    }

    "restore" {
        Write-Host "`n=== GRUDGE EXILES — Restore Wipe State ===" -ForegroundColor Red

        # Verify wipe state exists
        $wipeDbFiles = Get-ChildItem $WipeStateDir -Filter "game*.db" -ErrorAction SilentlyContinue
        if (-not $wipeDbFiles) {
            Write-Host "ERROR: No wipe state found in $WipeStateDir" -ForegroundColor Red
            Write-Host "Run '.\wipe-state.ps1 -Action save' first." -ForegroundColor Yellow
            exit 1
        }

        # Show what we're restoring
        if (Test-Path $metaFile) {
            $meta = Get-Content $metaFile -Raw | ConvertFrom-Json
            Write-Host "Restoring wipe state from: $($meta.savedAt)" -ForegroundColor Cyan
        }

        # Confirm
        Write-Host "`nWARNING: This will replace the current game database with the wipe template." -ForegroundColor Yellow
        Write-Host "All player progress since the wipe state was saved will be LOST." -ForegroundColor Yellow
        $confirm = Read-Host "Type 'WIPE' to confirm"
        if ($confirm -ne "WIPE") {
            Write-Host "Aborted." -ForegroundColor Gray
            exit 0
        }

        # Stop server if running
        $proc = Get-Process "ConanSandboxServer-Win64-Shipping" -ErrorAction SilentlyContinue
        if ($proc) {
            Write-Host "`nStopping server..." -ForegroundColor Cyan
            Stop-Process -Name "ConanSandboxServer-Win64-Shipping" -Force -ErrorAction SilentlyContinue
            Stop-Process -Name "ConanSandboxServer" -Force -ErrorAction SilentlyContinue
            Start-Sleep -Seconds 5
            Write-Host "  Server stopped." -ForegroundColor Gray
        }

        # Backup current state before wiping (safety net)
        $preWipeDir = Join-Path (Split-Path $WipeStateDir) "pre-wipe-$(Get-Date -Format 'yyyy-MM-dd_HH-mm')"
        New-Item -ItemType Directory -Path $preWipeDir -Force | Out-Null
        $currentDbs = Get-GameDbs
        foreach ($db in $currentDbs) {
            Copy-Item $db.FullName -Destination $preWipeDir -Force
            Write-Host "  Pre-wipe backup: $($db.Name) -> $preWipeDir" -ForegroundColor DarkGray
        }

        # Delete current game databases
        Write-Host "`nRemoving current databases..." -ForegroundColor Cyan
        foreach ($db in $currentDbs) {
            Remove-Item $db.FullName -Force
            Write-Host "  Deleted: $($db.Name)" -ForegroundColor Gray
        }

        # Restore wipe state
        Write-Host "Restoring wipe state..." -ForegroundColor Cyan
        foreach ($db in $wipeDbFiles) {
            Copy-Item $db.FullName -Destination $savedDir -Force
            $sizeMB = [math]::Round($db.Length / 1MB, 1)
            Write-Host "  Restored: $($db.Name) ($sizeMB MB)" -ForegroundColor Gray
        }

        # Start server
        Write-Host "`nStarting server..." -ForegroundColor Cyan
        $serverExe = Join-Path $ConanDir "ConanSandboxServer.exe"
        Start-Process $serverExe -ArgumentList "-log -RCONEnabled=1 -RCONPort=25575 -RCONPassword=grudgercon2026" -WorkingDirectory $ConanDir
        Write-Host "  Server starting... allow 30-60 seconds for full boot." -ForegroundColor Gray

        Write-Host "`n=== Wipe Complete ===" -ForegroundColor Green
        Write-Host "Map rooms and admin structures restored." -ForegroundColor Yellow
        Write-Host "Pre-wipe backup saved to: $preWipeDir" -ForegroundColor Yellow
    }

    "info" {
        Write-Host "`n=== GRUDGE EXILES — Wipe State Info ===" -ForegroundColor Red

        if (-not (Test-Path $WipeStateDir)) {
            Write-Host "No wipe state saved yet." -ForegroundColor Yellow
            Write-Host "Run '.\wipe-state.ps1 -Action save' after placing map rooms." -ForegroundColor Gray
            exit 0
        }

        $wipeDbFiles = Get-ChildItem $WipeStateDir -Filter "game*.db" -ErrorAction SilentlyContinue
        if (-not $wipeDbFiles) {
            Write-Host "Wipe state directory exists but contains no databases." -ForegroundColor Yellow
            exit 0
        }

        if (Test-Path $metaFile) {
            $meta = Get-Content $metaFile -Raw | ConvertFrom-Json
            Write-Host "Saved at: $($meta.savedAt)" -ForegroundColor Cyan
            Write-Host "Saved by: $($meta.savedBy)" -ForegroundColor Cyan
        }

        Write-Host "Files:" -ForegroundColor Cyan
        foreach ($db in $wipeDbFiles) {
            $sizeMB = [math]::Round($db.Length / 1MB, 1)
            Write-Host "  $($db.Name) — $sizeMB MB" -ForegroundColor Gray
        }

        # Compare with current
        $currentDbs = Get-GameDbs
        if ($currentDbs) {
            $currentSize = [math]::Round(($currentDbs | Measure-Object -Property Length -Sum).Sum / 1MB, 1)
            $wipeSize = [math]::Round(($wipeDbFiles | Measure-Object -Property Length -Sum).Sum / 1MB, 1)
            Write-Host "`nCurrent DB: $currentSize MB | Wipe state: $wipeSize MB" -ForegroundColor Yellow
        }
    }
}
