@echo off
chcp 65001 >nul
title 國一下英語複習 - 手機版伺服器
echo ============================================
echo   國一下英語複習（康軒．內部版）
echo   請用手機連上與本電腦相同的 Wi-Fi
echo ============================================
echo.
echo 本機 IP：
ipconfig | findstr /C:"IPv4"
echo.
echo 手機瀏覽器輸入： 上面的 IPv4 位址加  :8090
echo 例如  192.168.0.45:8090
echo.
echo 通行密碼：1019
echo 停止伺服器：關閉本視窗即可
echo ============================================
python -m http.server 8090 --bind 0.0.0.0
pause
