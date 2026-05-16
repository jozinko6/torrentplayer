@echo off
title TorrentStream Desktop
cd /d "%~dp0"

echo ============================================
echo   TorrentStream Desktop (Electron)
echo ============================================
echo.

:: Kontrola ci uz proxy bezi na porte 8080
netstat -ano 2>nul | findstr ":8080 " >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] CORS proxy uz bezi na porte 8080
) else (
    echo [INFO] Spustam CORS proxy na porte 8080...
    start "CORS Proxy" cmd /c "node proxy-server.js"
    timeout /t 2 /nobreak >nul
    echo [OK] CORS proxy spusteny
)
echo.

:: Spustenie Electron aplikacie
echo [INFO] Spustam Electron aplikaciu...
echo WebTorrent bezi v Node.js rezime - podporuje vsetky trackery (UDP, HTTP, WebSocket)
echo.
npm start
pause
