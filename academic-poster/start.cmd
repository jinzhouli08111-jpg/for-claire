@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 正在启动本地预览…
start "" http://localhost:8080
node serve.mjs 8080
if errorlevel 1 (
  echo.
  echo 启动失败：请确认已安装 Node.js（node -v 能看到版本号）
  pause
)
