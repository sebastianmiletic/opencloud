@echo off
REM Start Open Cloud local server and open browser (Windows)

cd /d "%~dp0"

echo Preparing Open Cloud...

REM Try to kill any existing python server.py process
for /f "tokens=2" %%a in ('tasklist ^| findstr "python.exe"') do (
    wmic process where "ProcessId=%%a" get CommandLine 2>nul | findstr "server.py" >nul && (
        taskkill /PID %%a /F >nul 2>&1
    )
)

REM Find Python
set PYTHON_CMD=
for %%c in (python3 python py) do (
    where %%c >nul 2>&1 && (
        set PYTHON_CMD=%%c
        goto :found_python
    )
)

echo ERROR: Python is required but not found.
echo Install from https://python.org and try again.
exit /b 1

:found_python
start /b %PYTHON_CMD% server.py > server.log 2>&1

REM Wait for port file
echo Starting server...
set PORT=
for /l %%i in (1,1,60) do (
    if exist server_port.txt (
        set /p PORT=<server_port.txt
        goto :got_port
    )
    timeout /t 1 /nobreak >nul
)

if "%PORT%"=="" (
    echo ERROR: Server did not write port file in time
    type server.log
    exit /b 1
)

:got_port
REM Wait for HTTP response
set READY=0
for /l %%i in (1,1,60) do (
    curl -s -o nul --max-time 1 "http://localhost:%PORT%/" >nul 2>&1 && (
        set READY=1
        goto :server_ready
    )
    timeout /t 1 /nobreak >nul
)

if "%READY%"=="0" (
    echo ERROR: Server did not respond on port %PORT%
    type server.log
    exit /b 1
)

:server_ready
if not "%PORT%"=="8080" (
    echo Port 8080 was busy. Using fallback port %PORT%.
    echo Your data is still safe, but bookmarks should point to http://localhost:%PORT%/
)
echo Open Cloud is ready: http://localhost:%PORT%/
start http://localhost:%PORT%/
