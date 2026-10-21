@echo off
rem ===========================================================================
rem  LUBE OFFICE - diz numa frase se o editor esta no ar e, se nao estiver, por que.
rem  Rode NA SRV-IA. Nao muda nada.
rem ===========================================================================
setlocal
if exist "C:\BI\OFFICE\diagnostico_motor.ps1" (
  powershell -ExecutionPolicy Bypass -File "C:\BI\OFFICE\diagnostico_motor.ps1"
) else (
  cd /d "%~dp0"
  powershell -ExecutionPolicy Bypass -File "instalacao\diagnostico_motor.ps1"
)
echo.
pause
