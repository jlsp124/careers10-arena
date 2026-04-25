@echo off
setlocal
cd /d "%~dp0.."
echo [Cortisol Host] Starting LAN host on 0.0.0.0:8080 ...
echo [Cortisol Host] The host will print:
echo   - Detected local IPs
echo   - Join URL
echo   - Moderation access count
echo   - runtime_data live/sync paths
echo   - MAX_UPLOAD_MB / RETENTION_HOURS
echo.
python server\app.py --host 0.0.0.0 --port 8080
endlocal
