# Marker Detection Test Script for Windows PowerShell
# Usage: .\test-detection.ps1

Write-Host "`n=== Marker Detection Test ===" -ForegroundColor Cyan
Write-Host "Starting test sequence...`n" -ForegroundColor White

# Step 1: Clear old logs
Write-Host "[1/4] Clearing old logs..." -ForegroundColor Yellow
adb logcat -c
Start-Sleep -Milliseconds 500

# Step 2: Stop app if running
Write-Host "[2/4] Stopping app (if running)..." -ForegroundColor Yellow
adb shell am force-stop com.markerscanner
Start-Sleep -Milliseconds 500

# Step 3: Launch app
Write-Host "[3/4] Launching MarkerScanner app..." -ForegroundColor Green
adb shell am start -n com.markerscanner/.MainActivity
Start-Sleep -Seconds 2

# Step 4: Monitor logs
Write-Host "[4/4] Monitoring detection logs..." -ForegroundColor Cyan
Write-Host "--------------------------------------" -ForegroundColor Gray
Write-Host "Watching for marker detections..." -ForegroundColor White
Write-Host "Press Ctrl+C to stop monitoring`n" -ForegroundColor Gray
Write-Host "--------------------------------------`n" -ForegroundColor Gray

# Monitor with color coding
adb logcat | ForEach-Object {
    if ($_ -match "Feature-centric detection initialized") {
        Write-Host "✓ " -ForegroundColor Green -NoNewline
        Write-Host $_ -ForegroundColor Green
    }
    elseif ($_ -match "MARKER_1 detected") {
        Write-Host "✓ " -ForegroundColor Cyan -NoNewline
        Write-Host $_ -ForegroundColor Cyan
    }
    elseif ($_ -match "Densities:") {
        Write-Host "  " -NoNewline
        Write-Host $_ -ForegroundColor White
    }
    elseif ($_ -match "Valid MARKER_1 detected at rotation") {
        Write-Host "✓ " -ForegroundColor Green -NoNewline
        Write-Host $_ -ForegroundColor Green
    }
    elseif ($_ -match "Detection|Marker|FrameProcessor") {
        Write-Host "  " -NoNewline
        Write-Host $_ -ForegroundColor Gray
    }
    elseif ($_ -match "ERROR|FATAL|Exception") {
        Write-Host "✗ " -ForegroundColor Red -NoNewline
        Write-Host $_ -ForegroundColor Red
    }
}
