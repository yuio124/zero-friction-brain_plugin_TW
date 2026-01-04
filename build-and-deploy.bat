@echo off
chcp 65001 > nul
setlocal

echo ========================================
echo   Zero Friction Brain 빌드 및 배포
echo ========================================
echo.

cd /d "%~dp0"

:: 빌드
echo [1/2] 빌드 중...
call npm run build
if errorlevel 1 (
    echo [오류] 빌드 실패
    pause
    exit /b 1
)
echo       빌드 완료!

:: 현재 vault에 배포 (프로젝트 폴더가 vault인 경우)
set CURRENT_VAULT=%~dp0..
set PLUGIN_PATH=!CURRENT_VAULT!\.obsidian\plugins\zero-friction-brain

if exist "!PLUGIN_PATH!" (
    echo.
    echo [2/2] 현재 vault에 배포 중...
    copy /Y "main.js" "!PLUGIN_PATH!\" > nul
    copy /Y "manifest.json" "!PLUGIN_PATH!\" > nul
    copy /Y "styles.css" "!PLUGIN_PATH!\" > nul 2>&1
    echo       배포 완료!
    echo.
    echo Obsidian을 재시작하세요.
) else (
    echo.
    echo [참고] 다른 vault에 설치하려면 install-plugin.bat을 실행하세요.
)

echo.
pause
