@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 正在启动本地服务器... 浏览器会自动打开。
echo 关闭这个黑窗口即可退出。
start "" http://127.0.0.1:8777/index.html
python -m http.server 8777 --bind 127.0.0.1
