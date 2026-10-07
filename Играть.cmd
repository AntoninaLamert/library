@echo off
setlocal
chcp 65001 >nul
set "QUEST_NODE="
for %%I in (node.exe) do set "QUEST_NODE=%%~$PATH:I"
if not defined QUEST_NODE set "QUEST_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not exist "%QUEST_NODE%" (
  echo Не найден Node.js. Установите Node.js или откройте игру через Codex.
  pause
  exit /b 1
)
"%QUEST_NODE%" "%~dp0tools\launch.cjs"
if errorlevel 1 pause
