@echo off
chcp 65001 > nul
cd /d "%~dp0"

where npm > nul 2> nul
if errorlevel 1 (
  echo Node.js가 설치되어 있지 않소. https://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 실행하시오.
  pause
  exit /b 1
)

if not exist node_modules (
  echo 처음 실행이라 필요한 파일을 설치하오. 1~2분 걸리오...
  call npm install
)

echo.
echo  MAP OPS 를 시작하오. 잠시 후 브라우저가 열리오: http://localhost:5173
echo  이 검은 창을 닫으면 앱도 꺼지오. 맵 데이터는 브라우저에 저장되어 남소.
echo.
call npm run dev -- --open
pause
