@echo off
chcp 65001 > nul
setlocal enabledelayedexpansion

echo ========================================
echo   Zero Friction Brain 플러그인 설치
echo ========================================
echo.

:: Vault 경로 입력받기
set /p VAULT_PATH="Obsidian Vault 경로를 입력하세요: "

:: 경로 앞뒤 따옴표 제거
set VAULT_PATH=!VAULT_PATH:"=!

:: 경로 존재 확인
if not exist "!VAULT_PATH!" (
    echo.
    echo [오류] 경로가 존재하지 않습니다: !VAULT_PATH!
    pause
    exit /b 1
)

:: .obsidian 폴더 확인
if not exist "!VAULT_PATH!\.obsidian" (
    echo.
    echo [오류] Obsidian vault가 아닙니다. .obsidian 폴더가 없습니다.
    pause
    exit /b 1
)

:: 플러그인 폴더 생성
set PLUGIN_PATH=!VAULT_PATH!\.obsidian\plugins\zero-friction-brain
if not exist "!PLUGIN_PATH!" (
    mkdir "!PLUGIN_PATH!"
    echo [생성] 플러그인 폴더 생성됨
)

:: 스크립트 위치 확인
set SCRIPT_DIR=%~dp0

:: 파일 복사
echo.
echo 파일 복사 중...

copy /Y "!SCRIPT_DIR!main.js" "!PLUGIN_PATH!\" > nul
if errorlevel 1 (
    echo [오류] main.js 복사 실패
    pause
    exit /b 1
)
echo   - main.js 복사됨

copy /Y "!SCRIPT_DIR!manifest.json" "!PLUGIN_PATH!\" > nul
if errorlevel 1 (
    echo [오류] manifest.json 복사 실패
    pause
    exit /b 1
)
echo   - manifest.json 복사됨

copy /Y "!SCRIPT_DIR!styles.css" "!PLUGIN_PATH!\" > nul 2>&1
if exist "!SCRIPT_DIR!styles.css" (
    echo   - styles.css 복사됨
)

echo.
echo ========================================
echo   설치 완료!
echo ========================================
echo.
echo 다음 단계:
echo   1. Obsidian 재시작
echo   2. 설정 → 커뮤니티 플러그인 → Zero Friction Brain 활성화
echo   3. 플러그인 설정에서 Gemini API 키 입력
echo   4. [폴더 생성] 버튼 클릭
echo.
pause
