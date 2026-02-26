@echo off
setlocal
cd /d "%~dp0.."
echo [careers10-arena] Starting LAN server on 0.0.0.0:8080 ...
echo [careers10-arena] The server will print:
echo   - Detected local IPs
echo   - Join URL
echo   - Admin status
echo   - Uploads path
echo   - MAX_UPLOAD_MB / RETENTION_HOURS
echo.
python server\app.py --host 0.0.0.0 --port 8080
endlocal

