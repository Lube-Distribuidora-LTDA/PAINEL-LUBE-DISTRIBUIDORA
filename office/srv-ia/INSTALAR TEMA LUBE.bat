@echo off
rem ===========================================================================
rem  LUBE OFFICE - coloca os temas da Lube (Lube Claro e Lube Noite) no editor.
rem
rem  Rode NA SRV-IA, de duplo clique. Ele pede administrador no meio do
rem  caminho - isso e esperado. Nao reinicia o motor: quem estiver editando
rem  continua. Leva de 1 a 6 minutos (o motor relista os temas sozinho).
rem
rem  Rodar de novo e seguro.
rem ===========================================================================
setlocal
cd /d "%~dp0"

echo.
echo   LUBE OFFICE - temas da Lube no editor
echo   =====================================
echo.
pause

powershell -ExecutionPolicy Bypass -File "instalacao\instalar_tema.ps1"
