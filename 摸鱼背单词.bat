@echo off
REM WordsFish launcher
set "BASE=%~dp0"

REM Clear NODE_OPTIONS that some terminals/IDEs inject (Electron rejects them and quits instantly)
set NODE_OPTIONS=

REM Kill any lingering instance to avoid the single-instance lock causing a silent exit
taskkill /f /im WordsFish.exe >nul 2>&1
taskkill /f /im words-fish.exe >nul 2>&1

REM 1) Prefer a prebuilt exe (verified builds only)
for %%P in (app-v24 app-v23 app-v22 app-v21 app-v20 app-v19 app-v18 app-v17 app-v16 app-v15 app-v14 app-v13 app-v12 app-v11 app-v10 app-v9 app-v8 app-v7 app-v6 app-v5 app-v4 app-v3 app-v2 app-final) do (
  if exist "%BASE%%%P\win-unpacked\WordsFish.exe" (
    echo [launcher] starting: %%P
    cd /d "%BASE%%%P\win-unpacked"
    start "" "%BASE%%%P\win-unpacked\WordsFish.exe"
    goto :eof
  )
)

REM 2) No build found: run from source via electron if dependencies are installed
if exist "%BASE%node_modules\.bin\electron.cmd" (
  echo [launcher] no build found, launching from source (npm start / electron .)...
  pushd "%BASE%"
  start "" cmd /c "npm start"
  popd
  goto :eof
)

REM 3) Neither build nor dependencies: tell the user what to do
echo No build and no node_modules found.
echo Please run in this folder first:
echo   npm install
echo   npm run pack
pause
