@echo off
setlocal
cd /d "%~dp0.."
echo [Cortisol Host] Opening Host control window...
python host\host_app.py
endlocal
