@echo off
REM 摸鱼背单词 - 启动器
REM 自动选择构建：优先 app-v2 / app-final（均为已验证的 asar:true 干净构建），
REM 不回退到 app-build / packout* / release / dist（这些是旧的损坏构建，会闪退）
set "BASE=%~dp0"

REM 关键：清除可能由外部终端/IDE 注入的 NODE_OPTIONS（electron 不认这些参数会直接报错秒退）
set NODE_OPTIONS=

REM 关闭可能残留的旧实例（大小写都杀，避免单实例锁导致新实例静默退出/闪退）
taskkill /f /im WordsFish.exe >nul 2>&1
taskkill /f /im words-fish.exe >nul 2>&1

REM 按优先级选构建并启动（只认已验证构建）
for %%P in (app-v8 app-v7 app-v6 app-v5 app-v4 app-v3 app-v2 app-final) do (
  if exist "%BASE%%%P\win-unpacked\WordsFish.exe" (
    echo [启动器] 正在启动: %%P
    cd /d "%BASE%%%P\win-unpacked"
    start "" "%BASE%%%P\win-unpacked\WordsFish.exe"
    goto :eof
  )
)
echo 未找到已验证的构建（app-v2 或 app-final）。请先运行 npm run pack 打包。
pause
