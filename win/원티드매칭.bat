@echo off
chcp 65001 > nul
title Wanted Job Matcher
echo Wanted Job Matcher 를 실행합니다...
echo.
wsl -e bash -lc "cd ~/scrap && ./run.sh"
echo.
echo ================================================================
echo  창을 닫으려면 아무 키나 누르세요.
echo ================================================================
pause > nul
