@echo off
rem live-streamer: one-click schema codegen (flatc -> C++/TS).
rem Same as: python scripts\schema.py [--clean] [--no-fetch] [--flatc=...]
setlocal
cd /d "%~dp0"

set "PY=python"
where python >nul 2>nul || set "PY=py -3"

%PY% "scripts\schema.py" %*
set "CODE=%ERRORLEVEL%"

echo.
if not "%CODE%"=="0" (
  echo [schema-win-x84_64] FAILED, exit code %CODE%
) else (
  echo [schema-win-x84_64] OK
)

rem 双击运行时停一下方便看结果，带参数运行（终端 / CI）不停
if "%~1"=="" pause
exit /b %CODE%
