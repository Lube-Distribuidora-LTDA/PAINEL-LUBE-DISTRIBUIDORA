@echo off
rem ===========================================================================
rem  LUBE OFFICE - instala o motor de edicao (ONLYOFFICE) na VM SRV-IA.
rem
rem  Rode NA SRV-IA, de duplo clique. Ele pede administrador no meio do
rem  caminho - isso e esperado. No fim ele mostra a chave do motor para voce
rem  cadastrar no Supabase (OFFICE_JWT_SECRET) e confere se o painel ja
rem  enxerga o editor.
rem
rem  Rodar de novo e seguro: o que ja estiver instalado fica.
rem ===========================================================================
setlocal
cd /d "%~dp0"

echo.
echo   LUBE OFFICE - motor de edicao na SRV-IA
echo   =======================================
echo.
echo   Vai instalar o ONLYOFFICE Docs (~900 MB, com PostgreSQL e RabbitMQ) na porta
echo   8090 e um tunel da Cloudflare que deixa o painel alcancar o editor sem
echo   abrir porta no firewall. Leva de 15 a 40 minutos, quase tudo download.
echo.
pause

powershell -ExecutionPolicy Bypass -File "instalacao\instalar_motor.ps1"
