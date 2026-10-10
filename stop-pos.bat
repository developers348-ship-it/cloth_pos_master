@echo off
rem Stops the POS server and the ngrok tunnel started by start-pos.bat.
rem Only touches what is listening on the POS port and the ngrok tunnel,
rem not every program on the PC.
if not defined PORT set PORT=3000

rem The tunnel's retry loop first, otherwise it would start ngrok again.
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'start-ngrok\.bat' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
taskkill /im ngrok.exe /f >nul 2>&1

rem The POS server (and with it the hidden window that launched it).
powershell -NoProfile -Command "Get-NetTCPConnection -State Listen -LocalPort %PORT% -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }"

echo POS and ngrok stopped.
