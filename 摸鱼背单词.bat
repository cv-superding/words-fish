@echo off
REM 摸鱼背单词 - 启动器
REM 自动选择最新构建：优先 packout2（最新双模式版），其次 packout / release / dist
set "BASE=%~dp0"

REM 关键：清除可能由外部终端/IDE（如 WorkBuddy 会话）注入的 NODE_OPTIONS
REM （含 --use-system-ca 等）。Electron 启动时会继承该变量，不认这些参数会直接报错秒退。
set NODE_OPTIONS=
REM 关闭可能残留的旧实例（按单实例锁，旧进程会阻止新版本启动）
taskkill /f /im WordsFish.exe >nul 2>&1

if exist "%BASE%\packout2\win-unpacked\WordsFish.exe" (
  cd /d "%BASE%\packout2\win-unpacked"
  start "" "%BASE%\packout2\win-unpacked\WordsFish.exe"
  goto :eof
)
if exist "%BASE%\packout\win-unpacked\WordsFish.exe" (
  cd /d "%BASE%\packout\win-unpacked"
  start "" "%BASE%\packout\win-unpacked\WordsFish.exe"
  goto :eof
)
if exist "%BASE%\release\win-unpacked\WordsFish.exe" (
  cd /d "%BASE%\release\win-unpacked"
  start "" "%BASE%\release\win-unpacked\WordsFish.exe"
  goto :eof
)
if exist "%BASE%\dist\win-unpacked\WordsFish.exe" (
  cd /d "%BASE%\dist\win-unpacked"
  start "" "%BASE%\dist\win-unpacked\WordsFish.exe"
  goto :eof
)
echo 未找到 WordsFish.exe，请先运行 npm run pack 打包。
pause
