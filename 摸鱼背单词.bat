@echo off
REM 摸鱼背单词 - 启动器
REM 自动选择最新构建：优先 packout2（最新双模式版），其次 packout / release / dist
set "BASE=%~dp0"

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
