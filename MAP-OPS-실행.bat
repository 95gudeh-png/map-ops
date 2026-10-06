@echo off
chcp 65001 > nul
cd /d "%~dp0"

rem ===== 포트 번호: 바꾸려면 아래 숫자만 고치시오 (1024~65535) =====
rem 주의: 포트가 바뀌면 주소가 달라져 이전 포트에서 만든 맵은 보이지 않소(내보내기/가져오기로 옮길 것)
set PORT=5173
rem =================================================================

set URL=http://localhost:%PORT%

rem 이미 켜져 있으면(다른 검은 창에서 실행 중) 새로 켜지 않고 브라우저만 연다
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing %URL% -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }" > nul 2> nul
if not errorlevel 1 (
  echo MAP OPS 가 이미 실행 중이오. 브라우저로 여오: %URL%
  start "" %URL%
  timeout /t 3 > nul
  exit /b 0
)

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
echo  MAP OPS 를 시작하오. 잠시 후 브라우저가 열리오: %URL%
echo  이 검은 창을 닫으면 앱도 꺼지오. 맵 데이터는 브라우저에 저장되어 남소.
echo  (평소에는 https://95gudeh-png.github.io/map-ops/ 를 쓰면 이 창이 필요 없소)
echo.
call npm run dev -- --port %PORT% --open
echo.
echo 앱이 꺼졌거나 시작하지 못했소. 위의 메시지를 확인하시오.
echo 포트 %PORT% 를 다른 프로그램이 쓰고 있다면 이 파일 위쪽의 PORT 숫자를 바꾸시오.
pause
