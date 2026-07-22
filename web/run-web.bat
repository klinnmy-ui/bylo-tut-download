@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-web-hidden.ps1"
if errorlevel 1 (
  echo.
  echo Ne udalos zapustit web-versiyu. Podrobnosti ukazany vyshe.
  pause
  exit /b 1
)
exit /b 0
