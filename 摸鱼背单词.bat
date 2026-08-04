@echo off
REM 摸鱼背单词 - 启动器
REM 自动选择最新构建：优先 packout6（含悬浮窗知识视图精简布局 + 尺寸上限），
REM 其次 packout5 / packout4 / packout3 / packout2 / packout / release / dist
REM 启动前自动从 packout6 补齐所选构建目录可能缺失的关键运行时 DLL（ffmpeg.dll 等），
REM 彻底避免 Windows 加载器弹"找不到 xxx.dll"而 electron 还没起来就直接挂掉。
set "BASE=%~dp0"
set "GOLD=%BASE%packout6\win-unpacked"

REM 关键：清除可能由外部终端/IDE（如 WorkBuddy 会话）注入的 NODE_OPTIONS
REM （含 --use-system-ca 等）。Electron 启动时会继承该变量，不认这些参数会直接报错秒退。
set NODE_OPTIONS=
REM 关闭可能残留的旧实例（单实例锁，旧进程会阻止新版本启动）
taskkill /f /im WordsFish.exe >nul 2>&1

REM 兜底：如果黄金构建 packout6 存在，先确保它自己 DLL 齐全（防御性）
call :ensure_dlls "%GOLD%"

REM 按优先级选构建并启动
for %%P in (packout6 packout5 packout4 packout3 packout2 packout release dist) do (
  if exist "%BASE%%%P\win-unpacked\WordsFish.exe" (
    call :ensure_dlls "%BASE%%%P\win-unpacked"
    echo [启动器] 正在启动: %%P
    cd /d "%BASE%%%P\win-unpacked"
    start "" "%BASE%%%P\win-unpacked\WordsFish.exe"
    goto :eof
  )
)
echo 未找到 WordsFish.exe，请先运行 npm run pack 打包。
pause
goto :eof

:ensure_dlls
set "DIR=%~1"
if not exist "%DIR%\NUL" goto :eof
if not exist "%GOLD%\NUL" goto :eof
for %%F in (ffmpeg.dll icudtl.dat d3dcompiler_47.dll libEGL.dll libGLESv2.dll) do (
  if not exist "%DIR%\%%F" (
    if exist "%GOLD%\%%F" (
      copy /y "%GOLD%\%%F" "%DIR%\" >nul 2>&1
      if errorlevel 1 (
        echo [启动器] 补齐 %%F 到 %DIR% 失败，请检查权限/杀软
      ) else (
        echo [启动器] 已补齐缺失的 %%F
      )
    )
  )
)
goto :eof