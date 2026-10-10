@echo off
rem Launched by Windows Task Scheduler (task: POS_Database_Backup).
rem Runs from the project folder and appends everything to backup.log.
cd /d "%~dp0.."
echo ==== %DATE% %TIME% ==== >> backup.log
call npm run backup:run >> backup.log 2>&1
exit /b %ERRORLEVEL%
