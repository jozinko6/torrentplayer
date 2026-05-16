@echo off
title CORS Proxy
cd /d "%~dp0"
echo ============================================
echo   CORS Proxy Server
echo ============================================
echo.
echo Proxy bezi na http://localhost:8080
echo.
echo Pouzitie: Vyhladavanie v TorrentStream PWA
echo bude automaticky pouzivat tuto proxy.
echo.
echo Pre ukoncenie stlacte Ctrl+C
echo ============================================
echo.
node proxy-server.js
pause
