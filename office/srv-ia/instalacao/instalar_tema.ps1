param(
    [switch]$JaElevado
)

# instalar_tema.ps1
#
# LUBE OFFICE - coloca o tema da Lube (Lube Claro) no motor de edicao
# (ONLYOFFICE Docs) da SRV-IA. Nao reinicia o motor: quem estiver editando continua.
#
# Como rodar (NA SRV-IA): P:\INTEGRACAO BI\OFFICE\INSTALAR TEMA LUBE.bat
#
#   Parte 1 (sua janela)   copia os scripts e os temas para C:\BI\OFFICE (a janela
#                          elevada nao enxerga o P:)
#   Parte 2 (administrador) copia os temas para a pasta de temas do ONLYOFFICE e espera
#                          o motor oferecer os dois (ate 6 minutos; ele relista a pasta
#                          a cada ~5 minutos)
#
# Rodar de novo e seguro: troca os temas pela versao do kit.

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'office_comum.ps1')
$ErrorActionPreference = 'Stop'

function Pausar {
    Write-Host ''
    Write-Host 'Pressione ENTER para fechar esta janela...' -ForegroundColor Cyan
    try { Read-Host | Out-Null } catch { Start-Sleep -Seconds 60 }
}

$identidade = [Security.Principal.WindowsIdentity]::GetCurrent()
$ehAdmin = (New-Object Security.Principal.WindowsPrincipal($identidade)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

# ===========================================================================
# PARTE 1 - sua janela: copia scripts e temas para C:\BI\OFFICE
# ===========================================================================
if (-not $JaElevado) {
    Write-Host ''
    Write-Host '================================================================' -ForegroundColor Cyan
    Write-Host ' LUBE OFFICE - temas da Lube no editor' -ForegroundColor Cyan
    Write-Host '================================================================' -ForegroundColor Cyan
    Write-Host ''
    if (-not (Test-Path -LiteralPath $OFFICE.Motor)) {
        Write-Host ('O ONLYOFFICE nao esta nesta maquina (' + $env:COMPUTERNAME + '). Rode na SRV-IA.') -ForegroundColor Red
        Pausar; return
    }
    New-Item -ItemType Directory -Force -Path $OFFICE.Temas | Out-Null
    foreach ($a in @('office_comum.ps1', 'instalar_tema.ps1')) {
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot $a) -Destination (Join-Path $OFFICE.Pasta $a) -Force
        Write-Host ('  copiado  ' + $a) -ForegroundColor Green
    }
    foreach ($f in @(Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot '..\temas') -File | Where-Object { $_.Name -like 'theme-lube-*.json' -or $_.Name -eq 'tema-lube.html' })) {
        Copy-Item -LiteralPath $f.FullName -Destination (Join-Path $OFFICE.Temas $f.Name) -Force
        Write-Host ('  copiado  ' + $f.Name) -ForegroundColor Green
    }
    $euElevado = Join-Path $OFFICE.Pasta 'instalar_tema.ps1'
    if ($ehAdmin) {
        & $euElevado -JaElevado
        return
    }
    Write-Host ''
    Write-Host 'Agora preciso de administrador para gravar na pasta do ONLYOFFICE.' -ForegroundColor Yellow
    Write-Host 'Se a janela nao abrir, cole esta linha num PowerShell como administrador:'
    Write-Host ('   powershell -ExecutionPolicy Bypass -NoExit -File "' + $euElevado + '" -JaElevado') -ForegroundColor White
    try {
        Start-Process powershell.exe -Verb RunAs -ErrorAction Stop -ArgumentList @(
            '-ExecutionPolicy', 'Bypass', '-NoExit', '-File', ('"' + $euElevado + '"'), '-JaElevado')
        Write-Host 'Janela de administrador aberta. Acompanhe por la.' -ForegroundColor Green
    } catch {
        Write-Host ('Nao consegui pedir administrador: ' + $_.Exception.Message) -ForegroundColor Red
    }
    exit 0
}

# ===========================================================================
# PARTE 2 - administrador
# ===========================================================================
try {
    if (-not $ehAdmin) { throw 'Esta parte precisa de administrador.' }
    Write-Host ''
    Write-Host '>> Copiando os temas para o ONLYOFFICE' -ForegroundColor Cyan
    $ids = Instalar-TemasLube $OFFICE.Temas
    if ($ids.Count -lt 1) { throw ('Nenhum tema em ' + $OFFICE.Temas) }
    foreach ($i in $ids) { Write-Host ('   ok  ' + $i) -ForegroundColor Green }
    Escrever-Log ('tema: copiados ' + ($ids -join ', '))

    Write-Host ''
    Write-Host '>> Esperando o motor oferecer os temas (ate 6 minutos)' -ForegroundColor Cyan
    $fim = (Get-Date).AddMinutes(6)
    do {
        $no = Temas-NoMotor
        $faltam = @($ids | Where-Object { $no -notcontains $_ })
        if ($faltam.Count -eq 0) { break }
        Start-Sleep -Seconds 20
    } while ((Get-Date) -lt $fim)

    $pagina = Pagina-TemaNoMotor
    if ($pagina) { Write-Host '   ok  tema-lube.html (as cores ja chegam prontas na primeira abertura)' -ForegroundColor Green }
    else { Write-Host '   !   tema-lube.html nao respondeu no motor: o editor abre, mas o tema so pinta depois de escolhido no menu' -ForegroundColor Yellow }

    Write-Host ''
    if ($faltam.Count -eq 0) {
        Escrever-Log ('tema: PRONTO, o motor oferece os temas da Lube; pagina do tema ' + $(if ($pagina) { 'ok' } else { 'sem resposta' }))
        Write-Host '================================================================' -ForegroundColor Green
        Write-Host ' PRONTO: o editor ja oferece o tema Lube Claro.' -ForegroundColor Green
        Write-Host '================================================================' -ForegroundColor Green
    } else {
        Escrever-Log ('tema: copiado, mas o motor ainda nao lista ' + ($faltam -join ', '))
        Write-Host ('Os arquivos foram copiados, mas o motor ainda nao lista: ' + ($faltam -join ', ')) -ForegroundColor Yellow
        Write-Host 'Espere mais 5 minutos e rode de novo. Se continuar, reinicie a SRV-IA fora do horario.' -ForegroundColor Yellow
    }
} catch {
    Escrever-Log ('tema: FALHOU ' + $_.Exception.Message)
    Write-Host ''
    Write-Host ('FALHOU: ' + $_.Exception.Message) -ForegroundColor Red
}
Pausar
