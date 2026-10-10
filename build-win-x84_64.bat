@echo off
rem live-streamer: one-click build for Windows x64.
rem Builds the C++ core (build/core) and the Electron app, same as:
rem     python scripts\build.py --generator "Visual Studio 17 2022" --toolset v143 [--config Debug^|Release]
setlocal
cd /d "%~dp0"

set "PY=python"
where python >nul 2>nul || set "PY=py -3"

%PY% "scripts\build.py" --generator "Visual Studio 17 2022" --toolset v143 %*
set "CODE=%ERRORLEVEL%"

echo.
if not "%CODE%"=="0" (
  echo [build-win-x84_64] FAILED, exit code %CODE%
) else (
  echo [build-win-x84_64] OK
)

rem 双击运行时停一下方便看结果，带参数运行（终端 / CI）不停
if "%~1"=="" pause
exit /b %CODE%
