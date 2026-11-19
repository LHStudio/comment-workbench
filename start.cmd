@echo off
setlocal
cd /d "%~dp0"
set "PYTHONUTF8=1"
python -c "import flask, wordcloud, PIL" >nul 2>&1
if errorlevel 1 (
  python -m pip install -r requirements.txt
  if errorlevel 1 goto failed
)
python server.py %*
if not errorlevel 1 exit /b 0
:failed
echo Startup failed. See the message above.
pause
exit /b 1
