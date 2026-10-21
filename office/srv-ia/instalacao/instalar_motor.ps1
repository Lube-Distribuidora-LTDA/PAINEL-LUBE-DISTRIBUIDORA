param(
    [switch]$JaElevado
)

# instalar_motor.ps1
#
# LUBE OFFICE - instala o motor de edicao (ONLYOFFICE Docs Community) NA VM SRV-IA
# e deixa ele alcancavel pelo painel, sem abrir porta no firewall.
#
# Como rodar (uma vez so, NA SRV-IA): P:\INTEGRACAO BI\OFFICE\INSTALAR MOTOR.bat
#
# O que ele faz:
#   Parte 1 (sua janela)   copia os scripts para C:\BI\OFFICE (a janela elevada nao enxerga o P:)
#   Parte 2 (administrador)
#     1. confere memoria e disco
#     2. baixa e instala o ONLYOFFICE na porta 8090 (~900 MB; o instalador baixa
#        sozinho o que faltar: PostgreSQL, RabbitMQ, Erlang)
#     3. cria a chave do motor (C:\BI\OFFICE\motor.chave, so administrador le) e liga a
#        assinatura JWT no ONLYOFFICE
#     4. baixa o cloudflared (tunel da Cloudflare) e cria a tarefa "LUBE OFFICE - Motor",
#        que roda como SYSTEM desde que a maquina liga
#     5. pede para voce cadastrar a chave no Supabase (OFFICE_JWT_SECRET) e confere,
#        de ponta a ponta, se o painel ja enxerga o editor
#
# Rodar de novo e seguro: o que ja estiver instalado fica, e a chave continua a mesma.

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'office_comum.ps1')
$ErrorActionPreference = 'Stop'

function Pausar {
    Write-Host ''
    Write-Host 'Pressione ENTER para fechar esta janela...' -ForegroundColor Cyan
    try { Read-Host | Out-Null } catch { Start-Sleep -Seconds 60 }
}
function Passo([string]$texto) { Write-Host ''; Write-Host ('>> ' + $texto) -ForegroundColor Cyan; Escrever-Log ('instalar: ' + $texto) }
function Ok([string]$texto) { Write-Host ('   ok  ' + $texto) -ForegroundColor Green; Escrever-Log ('instalar: ok ' + $texto) }
function Aviso([string]$texto) { Write-Host ('   !   ' + $texto) -ForegroundColor Yellow; Escrever-Log ('instalar: aviso ' + $texto) }
function Falhar([string]$texto) { Escrever-Log ('instalar: FALHOU ' + $texto); throw $texto }

function Baixar([string]$url, [string]$destino, [long]$minimoBytes) {
    if ((Test-Path -LiteralPath $destino) -and (Get-Item -LiteralPath $destino).Length -ge $minimoBytes) { return }
    $tmp = $destino + '.baixando'
    Remove-Item -LiteralPath $tmp -ErrorAction SilentlyContinue
    try {
        Start-BitsTransfer -Source $url -Destination $tmp -ErrorAction Stop
    } catch {
        Aviso ('BITS nao conseguiu (' + $_.Exception.Message + '); baixando direto')
        Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $tmp
    }
    if ((Get-Item -LiteralPath $tmp).Length -lt $minimoBytes) { Falhar ('O download de ' + $url + ' veio incompleto.') }
    Move-Item -LiteralPath $tmp -Destination $destino -Force
}

$identidade = [Security.Principal.WindowsIdentity]::GetCurrent()
$ehAdmin = (New-Object Security.Principal.WindowsPrincipal($identidade)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

# ===========================================================================
# PARTE 1 - sua janela: copia os scripts para C:\BI\OFFICE
# ===========================================================================
if (-not $JaElevado) {
    Write-Host ''
    Write-Host '================================================================' -ForegroundColor Cyan
    Write-Host ' LUBE OFFICE - instalar o motor de edicao' -ForegroundColor Cyan
    Write-Host '================================================================' -ForegroundColor Cyan
    Write-Host ''
    if ($env:COMPUTERNAME -ne 'SRV-IA') {
        Write-Host ('ATENCAO: esta maquina e a ' + $env:COMPUTERNAME + ', nao a SRV-IA.') -ForegroundColor Yellow
        Write-Host 'O motor do LUBE OFFICE foi combinado para rodar na SRV-IA (decisao do Julio, 2026-10-21).' -ForegroundColor Yellow
        $resp = Read-Host 'Digite SIM para instalar nesta maquina assim mesmo'
        if ($resp -ne 'SIM') { Write-Host 'Nada foi instalado.'; Pausar; return }
    }
    New-Item -ItemType Directory -Force -Path $OFFICE.Pasta | Out-Null
    foreach ($a in @('office_comum.ps1', 'instalar_motor.ps1', 'tunel_motor.ps1', 'diagnostico_motor.ps1')) {
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot $a) -Destination (Join-Path $OFFICE.Pasta $a) -Force
        Write-Host ('  copiado  ' + $a) -ForegroundColor Green
    }
    $euElevado = Join-Path $OFFICE.Pasta 'instalar_motor.ps1'
    if ($ehAdmin) {
        & $euElevado -JaElevado
        return
    }
    Write-Host ''
    Write-Host 'Agora preciso de administrador para instalar o ONLYOFFICE e criar a tarefa.' -ForegroundColor Yellow
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
    if (-not $ehAdmin) { Falhar 'Esta parte precisa de administrador.' }
    New-Item -ItemType Directory -Force -Path $OFFICE.Pasta | Out-Null
    $instaladores = Join-Path $OFFICE.Pasta 'instaladores'
    New-Item -ItemType Directory -Force -Path $instaladores | Out-Null

    Write-Host ''
    Write-Host '================================================================' -ForegroundColor Cyan
    Write-Host ' LUBE OFFICE - instalacao do motor (administrador)' -ForegroundColor Cyan
    Write-Host '================================================================' -ForegroundColor Cyan

    # 1. memoria e disco
    Passo 'Conferindo memoria e disco'
    $mem = Memoria-GB
    $disco = [math]::Round((Get-PSDrive -Name C).Free / 1GB, 1)
    Write-Host ('   memoria: {0} GB no total, {1} GB livres; disco C: {2} GB livres' -f $mem.total, $mem.livre, $disco)
    if ($disco -lt 40) { Falhar ('Disco C: com ' + $disco + ' GB livres; o ONLYOFFICE pede pelo menos 40 GB.') }
    if ($mem.total -lt 6 -or $mem.livre -lt 2.5) {
        Aviso 'Pouca memoria para o ONLYOFFICE junto com as cargas (ele usa de 2 a 4 GB).'
        $resp = Read-Host 'Digite SIM para continuar assim mesmo'
        if ($resp -ne 'SIM') { Write-Host 'Nada foi instalado.'; Pausar; return }
    } else { Ok 'memoria e disco suficientes' }

    # 2. ONLYOFFICE
    Passo 'Instalando o ONLYOFFICE Docs (motor de edicao)'
    if (Test-Path -LiteralPath (Join-Path $OFFICE.Motor 'server')) {
        Ok ('ja instalado em ' + $OFFICE.Motor)
    } else {
        $ocupada = Get-NetTCPConnection -LocalPort $OFFICE.Porta -State Listen -ErrorAction SilentlyContinue
        if ($ocupada) { Falhar ('A porta ' + $OFFICE.Porta + ' ja esta em uso por outro programa (processo ' + $ocupada[0].OwningProcess + ').') }
        $exe = Join-Path $instaladores 'onlyoffice-documentserver.exe'
        Write-Host '   baixando o instalador (~900 MB); pode levar de 10 a 30 minutos...'
        Baixar $OFFICE.UrlInstalador $exe 500MB
        Ok 'instalador baixado'
        Write-Host '   instalando (o instalador baixa sozinho o PostgreSQL, o RabbitMQ e o Erlang se faltarem)...'
        $p = Start-Process -FilePath $exe -Wait -PassThru -ArgumentList @('/SILENT', '/SUPPRESSMSGBOXES', '/NORESTART', ('/DS_PORT=' + $OFFICE.Porta))
        if ($p.ExitCode -ne 0) { Falhar ('O instalador do ONLYOFFICE terminou com o codigo ' + $p.ExitCode + '.') }
        Ok 'ONLYOFFICE instalado'
    }

    # 3. chave do motor + JWT ligado no ONLYOFFICE
    Passo 'Configurando a chave do motor'
    $chaveNova = $false
    if (Test-Path -LiteralPath $OFFICE.Chave) {
        $chave = (Get-Content -LiteralPath $OFFICE.Chave -Raw).Trim()
        Ok 'chave ja existia (continua a mesma)'
    } else {
        $chave = Novo-Segredo
        Set-Content -LiteralPath $OFFICE.Chave -Value $chave -NoNewline -Encoding ASCII
        $chaveNova = $true
        Ok 'chave nova criada'
    }
    # so administrador e SYSTEM leem a chave
    & icacls.exe $OFFICE.Chave /inheritance:r /grant:r '*S-1-5-32-544:(F)' '*S-1-5-18:(F)' | Out-Null
    Configurar-Jwt $OFFICE.LocalJson $chave
    Ok 'assinatura JWT ligada no ONLYOFFICE (copia do local.json original guardada ao lado)'
    foreach ($s in (Servicos-Motor)) { try { Restart-Service -InputObject $s -Force -ErrorAction Stop } catch { Aviso ('nao reiniciou ' + $s.Name) } }
    Write-Host '   esperando o motor responder...'
    $vivo = $false
    for ($i = 0; $i -lt 60 -and -not $vivo; $i++) { Start-Sleep -Seconds 3; $vivo = Motor-Saudavel $OFFICE.Local }
    if (-not $vivo) { Falhar ('O ONLYOFFICE nao respondeu em ' + $OFFICE.Local + '/healthcheck depois de 3 minutos.') }
    Ok ('motor respondendo em ' + $OFFICE.Local)

    # 4. tunel + tarefa
    Passo 'Preparando o tunel da Cloudflare e a tarefa agendada'
    Baixar $OFFICE.UrlCloudflared $OFFICE.Cloudflared 10MB
    Ok 'cloudflared baixado'
    $acao = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument (
        '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + (Join-Path $OFFICE.Pasta 'tunel_motor.ps1') + '"')
    $gatilho = New-ScheduledTaskTrigger -AtStartup
    $quem = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    $conf = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
            -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
    Register-ScheduledTask -TaskName $OFFICE.Tarefa -Action $acao -Trigger $gatilho -Principal $quem -Settings $conf -Force | Out-Null
    Stop-ScheduledTask -TaskName $OFFICE.Tarefa -ErrorAction SilentlyContinue
    Get-Process -Name cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $OFFICE.Estado -ErrorAction SilentlyContinue
    Start-ScheduledTask -TaskName $OFFICE.Tarefa
    Ok ('tarefa "' + $OFFICE.Tarefa + '" criada e ligada (roda como SYSTEM, desde que a maquina liga)')

    # 5. chave no Supabase + conferencia de ponta a ponta
    Passo 'Cadastrar a chave no Supabase'
    try { Set-Clipboard -Value $chave } catch {}
    Write-Host ''
    Write-Host '   A chave do motor ja esta copiada (Ctrl+V). Cadastre no Supabase:' -ForegroundColor White
    Write-Host ('     1. abra ' + $OFFICE.Segredos) -ForegroundColor White
    Write-Host '     2. Add new secret  >  Name: OFFICE_JWT_SECRET  >  Value: Ctrl+V  >  Save' -ForegroundColor White
    Write-Host '        (se ja existir um OFFICE_JWT_SECRET, troque o valor por este)' -ForegroundColor Gray
    Write-Host ''
    Write-Host ('   Se o Ctrl+V nao colar, a chave esta em ' + $OFFICE.Chave + ' (so administrador abre).') -ForegroundColor Gray
    if (-not $chaveNova) { Write-Host '   (Se voce ja cadastrou esta chave antes, so aperte ENTER.)' -ForegroundColor Gray }
    Read-Host '   Depois de salvar no Supabase, aperte ENTER aqui' | Out-Null

    Passo 'Conferindo se o painel enxerga o editor (ate 3 minutos)'
    $final = $null
    for ($i = 0; $i -lt 36; $i++) {
        Start-Sleep -Seconds 5
        $e = Ler-Estado
        if ($e -and $e.url) {
            # forca um aviso agora, sem esperar os 5 minutos da tarefa
            $r = Registrar-Motor ([string]$e.url) $chave
            if ($r.ok) { $final = @{ ok = $true; url = [string]$e.url }; break }
            $final = @{ ok = $false; url = [string]$e.url; erro = $r.mensagem; status = $r.status }
            if ($r.status -eq 403 -or $r.status -eq 503) { Start-Sleep -Seconds 10 }
        } elseif ($e -and $e.erro) {
            $final = @{ ok = $false; erro = [string]$e.erro }
        }
    }

    Write-Host ''
    if ($final -and $final.ok) {
        Write-Host '================================================================' -ForegroundColor Green
        Write-Host ' PRONTO: o editor do LUBE OFFICE esta no ar.' -ForegroundColor Green
        Write-Host ('   motor: ' + $final.url) -ForegroundColor Green
        Write-Host '   Abra o LUBE OFFICE no painel e abra qualquer arquivo: ele edita ali dentro.' -ForegroundColor Green
        Write-Host '================================================================' -ForegroundColor Green
        Escrever-Log ('instalar: PRONTO, motor em ' + $final.url)
    } else {
        Write-Host '================================================================' -ForegroundColor Yellow
        Write-Host ' O motor esta instalado, mas o painel ainda nao enxerga o editor.' -ForegroundColor Yellow
        if ($final -and $final.status -eq 503) { Write-Host '   Falta o segredo OFFICE_JWT_SECRET no Supabase (passo 5).' -ForegroundColor Yellow }
        elseif ($final -and $final.status -eq 403) { Write-Host '   A chave do Supabase e diferente desta. Cadastre de novo o OFFICE_JWT_SECRET (Ctrl+V).' -ForegroundColor Yellow }
        elseif ($final -and $final.erro) { Write-Host ('   ' + $final.erro) -ForegroundColor Yellow }
        else { Write-Host '   O tunel ainda nao deu endereco.' -ForegroundColor Yellow }
        Write-Host '   A tarefa continua tentando de 5 em 5 minutos sozinha. Para ver como esta: DIAGNOSTICO MOTOR.bat' -ForegroundColor Yellow
        Write-Host '================================================================' -ForegroundColor Yellow
    }
} catch {
    Write-Host ''
    Write-Host ('NAO TERMINOU: ' + $_.Exception.Message) -ForegroundColor Red
    Write-Host ('O passo a passo esta em ' + $OFFICE.Log) -ForegroundColor Red
    Escrever-Log ('instalar: erro - ' + $_.Exception.Message)
}
Pausar
