@echo off
setlocal
cd /d "%~dp0.."
echo [Cortisol Client] Opening Client launcher...
python client\client_app.py
endlocal
