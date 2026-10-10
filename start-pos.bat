@echo off
rem ============================================================================
rem  Starts the POS server on localhost, and (optionally) the ngrok support tunnel.
rem  Works from whichever folder it lives in. Normally launched hidden by
rem  start-pos.vbs; double-click it to see what it does.
rem
rem  The POS never depends on ngrok: with no internet, ngrok keeps retrying in the
rem  background while the POS runs normally on localhost.
rem ============================================================================

rem ---- settings (override from outside with e.g.  set USE_NGROK=0) -----------
if not defined PORT       set PORT=3000
if not defined DB_PORT    set DB_PORT=5432
rem 1 = also start the ngrok support tunnel, 0 = POS only
if not defined USE_NGROK  set USE_NGROK=1
rem Leave empty for the ngrok account's default domain, or set a fixed one:
rem   set NGROK_URL=https://your-domain.ngrok-free.dev
if not defined NGROK_URL  set NGROK_URL=
rem Lock the tunnel behind a Google sign-in: put your ngrok traffic policy in a file named
rem ngrok-policy.yml in this folder (see Part 11 of CLIENT-SETUP.md) - nothing to set here.
rem ----------------------------------------------------------------------------

cd /d "%~dp0"

rem 1. The support tunnel first, in the background of this same hidden window, so
rem    it can never hold up or break the POS. Skipped if it is already running.
if not "%USE_NGROK%"=="1" goto :server
tasklist /fi "imagename eq ngrok.exe" 2>nul | find /i "ngrok.exe" >nul
if %errorlevel%==0 goto :server
start "" /b cmd /c ""%~dp0start-ngrok.bat""

:server
rem 2. Already running (e.g. the shortcut was started twice)? Nothing more to do.
netstat -ano | findstr /r /c:":%PORT% .*LISTENING" >nul
if %errorlevel%==0 goto :eof

rem 3. Wait for PostgreSQL, up to 60 s. The server starts regardless after that and
rem    recovers by itself once the database appears.
set /a tries=0
:waitdb
powershell -NoProfile -Command "try { (New-Object Net.Sockets.TcpClient('127.0.0.1', %DB_PORT%)).Close(); exit 0 } catch { exit 1 }" >nul 2>&1
if %errorlevel%==0 goto :run
set /a tries+=1
if %tries% geq 30 goto :run
timeout /t 2 /nobreak >nul
goto :waitdb

:run
rem 4. The POS server. This window stays open for as long as the server runs.
echo ==== %DATE% %TIME%  starting POS on port %PORT% ==== >> pos-server.log
call npm start -- -p %PORT% >> pos-server.log 2>&1
