@echo off
title Sidhey Sheikh Cloth Center POS
cd /d "%~dp0"
echo Starting POS Server...
start "" /b npm run start
timeout /t 3 >nul
start http://localhost:3000