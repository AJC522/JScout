@echo off
rem Starts JScout on Windows: double-click this file.
rem The first run installs what JScout needs and builds it (scripts\start.mjs does the work); then
rem JScout opens in your browser. Close this window, or press Ctrl+C in it, to stop JScout.
setlocal
title JScout
pushd "%~dp0"

if not exist "scripts\start.mjs" (
  echo JScout.bat has to stay in the JScout folder, next to the "scripts" folder.
  echo If you opened it from inside a ZIP file, extract the whole ZIP first.
  echo.
  pause
  exit /b 1
)

rem Node.js installed a moment ago may not be on this window's PATH yet.
where node >nul 2>nul
if errorlevel 1 if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"

where node >nul 2>nul
if errorlevel 1 (
  echo JScout needs Node.js, which is not installed on this computer.
  echo.
  echo   1. Press a key to open https://nodejs.org/ and install the LTS version.
  echo   2. Double-click JScout.bat again.
  echo.
  pause
  start "" "https://nodejs.org/"
  exit /b 1
)

call node scripts\start.mjs %*
if not %errorlevel%==0 (
  echo.
  echo JScout stopped because of a problem. The message above says what went wrong.
  echo.
  pause
)
