@echo off
setlocal
cd /d "%~dp0"
set "ARENA_NODE=node"
where node >nul 2>nul
if errorlevel 1 (
  set "ARENA_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
)
if "%ARENA_NODE%"=="node" goto run
if exist "%ARENA_NODE%" goto run
echo Install Node.js 22 or newer, then double-click this file again.
echo Node.js is needed only on the host laptop. Other players just use a browser.
pause
exit /b 1
:run
echo Starting Network Arena. Keep this window open during play.
"%ARENA_NODE%" server.mjs
pause
