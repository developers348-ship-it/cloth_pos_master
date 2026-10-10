@echo off
rem ============================================================================
rem  Keeps the ngrok support tunnel up. Started by start-pos.bat.
rem  If ngrok exits (no internet at boot, network drop), it tries again in 30 s.
rem  To stop it for good, run stop-pos.bat (closing only ngrok.exe is not enough:
rem  this loop would start it again).
rem
rem  Uses the ngrok account saved with:  ngrok config add-authtoken YOUR_TOKEN
rem ============================================================================
cd /d "%~dp0"
if not defined PORT set PORT=3000

rem Optional lock in front of the tunnel (the Google sign-in policy from Part 11 of
rem CLIENT-SETUP.md). Used automatically when ngrok-policy.yml sits next to this file;
rem set NGROK_POLICY to use a file somewhere else.
if not defined NGROK_POLICY if exist "%~dp0ngrok-policy.yml" set "NGROK_POLICY=%~dp0ngrok-policy.yml"

where ngrok >nul 2>&1
if errorlevel 1 (
  echo ngrok is not installed or not on PATH - tunnel not started. >> ngrok.log
  exit /b 1
)

set "OPTS=--log=stdout --log-level=warn"
if defined NGROK_URL set "OPTS=%OPTS% --url %NGROK_URL%"
if defined NGROK_POLICY set OPTS=%OPTS% --traffic-policy-file "%NGROK_POLICY%"

:run
ngrok http %PORT% %OPTS% >> ngrok.log 2>&1
timeout /t 30 /nobreak >nul
goto :run
