@echo off
setlocal
cd /d "%~dp0.."
echo [careers10-arena] Installing Python dependencies for current user...
python -m pip install --user -r requirements.txt
echo.
echo Done.
endlocal

