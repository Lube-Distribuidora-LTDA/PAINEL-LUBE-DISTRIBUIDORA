# office_comum.ps1
#
# LUBE OFFICE - pecas comuns aos scripts do motor de edicao na SRV-IA.
# Os outros scripts carregam este com:  . (Join-Path $PSScriptRoot 'office_comum.ps1')
#
# O motor (ONLYOFFICE Docs) roda na SRV-IA e sai para a internet por um tunel
# rapido da Cloudflare (trycloudflare.com), sem abrir porta no firewall e sem
# dominio. O endereco do tunel muda quando ele reinicia; por isso a SRV-IA avisa
# o endereco ao painel (Edge Function office, porta /motor/registrar), assinado
# com a chave do motor (a mesma do segredo OFFICE_JWT_SECRET no Supabase).

[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$ProgressPreference = 'SilentlyContinue'

$OFFICE = @{
    Pasta   = 'C:\BI\OFFICE'
    Porta   = 8090
    Funcao  = 'https://wkkdcsqwlxjxorutrbnx.supabase.co/functions/v1/office'
    Motor   = Join-Path $env:ProgramFiles 'ONLYOFFICE\DocumentServer'
    Tarefa  = 'LUBE OFFICE - Motor'
    Versao  = '1.0.0 (2026-10-21)'
    UrlInstalador   = 'https://download.onlyoffice.com/install/documentserver/windows/onlyoffice-documentserver.exe'
    UrlCloudflared  = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe'
    Segredos        = 'https://supabase.com/dashboard/project/wkkdcsqwlxjxorutrbnx/functions/secrets'
}
$OFFICE.Chave       = Join-Path $OFFICE.Pasta 'motor.chave'
$OFFICE.Estado      = Join-Path $OFFICE.Pasta 'estado.json'
$OFFICE.Log         = Join-Path $OFFICE.Pasta 'motor.log'
$OFFICE.LogTunel    = Join-Path $OFFICE.Pasta 'tunel.log'
$OFFICE.Cloudflared = Join-Path $OFFICE.Pasta 'cloudflared.exe'
$OFFICE.LocalJson   = Join-Path $OFFICE.Motor 'config\local.json'
# 127.0.0.1 e nao localhost: no Windows o localhost pode ir para o IPv6 (::1) e o motor escuta no IPv4
$OFFICE.Local       = 'http://127.0.0.1:' + $OFFICE.Porta

function Escrever-Log([string]$texto) {
    $linha = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '  ' + $texto
    try { Add-Content -LiteralPath $OFFICE.Log -Value $linha -Encoding UTF8 } catch {}
    try {
        if ((Get-Item -LiteralPath $OFFICE.Log).Length -gt 2MB) {
            $fim = Get-Content -LiteralPath $OFFICE.Log -Tail 2000
            Set-Content -LiteralPath $OFFICE.Log -Value $fim -Encoding UTF8
        }
    } catch {}
}

function B64Url([byte[]]$bytes) {
    return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function Novo-Segredo {
    $b = New-Object byte[] 36
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
    return (B64Url $b)
}

# JWT HS256, o mesmo formato que a Edge Function confere
function Assinar-Jwt([hashtable]$dados, [string]$chave, [int]$validade = 300) {
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    $agora = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    $dados['iat'] = $agora
    $dados['exp'] = $agora + $validade
    $cab = B64Url ($utf8.GetBytes('{"alg":"HS256","typ":"JWT"}'))
    $corpo = B64Url ($utf8.GetBytes(($dados | ConvertTo-Json -Compress)))
    $hmac = [Security.Cryptography.HMACSHA256]::new($utf8.GetBytes($chave))
    $sig = B64Url ($hmac.ComputeHash($utf8.GetBytes("$cab.$corpo")))
    return "$cab.$corpo.$sig"
}

# o cloudflared escreve o endereco do tunel rapido no log
function Ler-UrlTunel([string]$arquivo) {
    if (-not (Test-Path -LiteralPath $arquivo)) { return $null }
    $texto = [string](Get-Content -LiteralPath $arquivo -Raw -ErrorAction SilentlyContinue)
    $m = [regex]::Matches($texto, 'https://[a-z0-9-]+\.trycloudflare\.com')
    if ($m.Count -gt 0) { return $m[$m.Count - 1].Value }
    return $null
}

function Motor-Saudavel([string]$base) {
    try {
        $r = Invoke-WebRequest -UseBasicParsing -Uri ($base.TrimEnd('/') + '/healthcheck') -TimeoutSec 15
        # sem Content-Type o PowerShell 5.1 devolve bytes em vez de texto
        $txt = if ($r.Content -is [byte[]]) { [Text.Encoding]::UTF8.GetString($r.Content) } else { [string]$r.Content }
        return ($txt.Trim() -eq 'true')
    } catch { return $false }
}

# tema da Lube no editor (Lube Claro): um JSON por tema na pasta de temas do
# ONLYOFFICE. O motor relista a pasta sozinho (themes.json, cache de ~5 minutos); nao reinicia nada.
# A tema-lube.html vai numa pasta propria (lube): o painel abre ela escondida antes do editor,
# para as cores do tema ja estarem prontas na primeira abertura.
$OFFICE.Temas      = Join-Path $OFFICE.Pasta 'temas'
$OFFICE.TemasMotor = Join-Path $OFFICE.Motor 'web-apps\apps\common\main\resources\themes'
$OFFICE.LubeMotor  = Join-Path $OFFICE.Motor 'web-apps\apps\common\main\resources\lube'

function Instalar-TemasLube([string]$origem) {
    if (-not (Test-Path -LiteralPath $OFFICE.TemasMotor)) { throw ('Pasta de temas do ONLYOFFICE nao encontrada: ' + $OFFICE.TemasMotor) }
    $ids = @()
    foreach ($f in @(Get-ChildItem -LiteralPath $origem -Filter 'theme-lube-*.json' -File)) {
        $t = [IO.File]::ReadAllText($f.FullName) | ConvertFrom-Json
        if ($t.id -ne $f.BaseName -or $null -eq $t.colors) { throw ('Tema invalido: ' + $f.Name) }
        Copy-Item -LiteralPath $f.FullName -Destination (Join-Path $OFFICE.TemasMotor $f.Name) -Force
        $ids += [string]$t.id
    }
    # tema da Lube que saiu do kit sai do motor tambem (o Lube Escuro, retirado em 2026-10-22)
    foreach ($velho in @(Get-ChildItem -LiteralPath $OFFICE.TemasMotor -Filter 'theme-lube-*.json' -File)) {
        if ($ids -notcontains $velho.BaseName) { Remove-Item -LiteralPath $velho.FullName -Force }
    }
    $pagina = Join-Path $origem 'tema-lube.html'
    if (Test-Path -LiteralPath $pagina) {
        New-Item -ItemType Directory -Force -Path $OFFICE.LubeMotor | Out-Null
        Copy-Item -LiteralPath $pagina -Destination (Join-Path $OFFICE.LubeMotor 'tema-lube.html') -Force
    }
    return $ids
}

# a pagina tema-lube.html responde pelo motor?
function Pagina-TemaNoMotor {
    try {
        $r = Invoke-WebRequest -UseBasicParsing -Uri ($OFFICE.Local + '/web-apps/apps/common/main/resources/lube/tema-lube.html') -TimeoutSec 15
        return ($r.StatusCode -eq 200)
    } catch { return $false }
}

# ids dos temas que o motor ja oferece ({"themes":[conteudo de cada arquivo da pasta]})
function Temas-NoMotor {
    try { $r = Invoke-RestMethod -UseBasicParsing -Uri ($OFFICE.Local + '/themes.json') -TimeoutSec 15 } catch { return @() }
    return @($r.themes | ForEach-Object { $_.id } | Where-Object { $_ })
}

function Memoria-GB {
    $so = Get-CimInstance Win32_OperatingSystem
    return @{ total = [math]::Round($so.TotalVisibleMemorySize / 1MB, 1); livre = [math]::Round($so.FreePhysicalMemory / 1MB, 1) }
}

function Servicos-Motor {
    return @(Get-Service -ErrorAction SilentlyContinue | Where-Object { $_.Name -like 'ds-*' -or $_.DisplayName -like 'ONLYOFFICE*' })
}

# avisa ao painel o endereco do motor; devolve ok, mensagem e status HTTP
function Registrar-Motor([string]$url, [string]$chave) {
    $mem = Memoria-GB
    $token = Assinar-Jwt @{
        url = $url; maquina = $env:COMPUTERNAME; versao = $OFFICE.Versao
        memoria_gb = $mem.total; motor_ok = (Motor-Saudavel $OFFICE.Local)
    } $chave
    try {
        $r = Invoke-RestMethod -Method Post -Uri ($OFFICE.Funcao + '/motor/registrar') -ContentType 'application/json' `
             -Body (@{ token = $token } | ConvertTo-Json -Compress) -TimeoutSec 30
        return @{ ok = $true; mensagem = 'registrado'; url = [string]$r.url; status = 200 }
    } catch {
        $msg = $_.Exception.Message
        try { $corpo = $_.ErrorDetails.Message | ConvertFrom-Json; if ($corpo.erro) { $msg = [string]$corpo.erro } } catch {}
        $status = 0
        try { $status = [int]$_.Exception.Response.StatusCode } catch {}
        return @{ ok = $false; mensagem = $msg; status = $status }
    }
}

function Gravar-Estado([hashtable]$e) {
    $e['em'] = (Get-Date).ToString('s')
    try { ($e | ConvertTo-Json -Compress) | Set-Content -LiteralPath $OFFICE.Estado -Encoding UTF8 } catch {}
}

function Ler-Estado {
    if (-not (Test-Path -LiteralPath $OFFICE.Estado)) { return $null }
    try { return (Get-Content -LiteralPath $OFFICE.Estado -Raw | ConvertFrom-Json) } catch { return $null }
}

# local.json do ONLYOFFICE: liga a assinatura JWT nas tres portas e grava a chave
function Definir-Valor($obj, [string[]]$caminho, $valor) {
    $atual = $obj
    for ($i = 0; $i -lt $caminho.Length - 1; $i++) {
        $nome = $caminho[$i]
        if (-not ($atual.PSObject.Properties.Name -contains $nome) -or $null -eq $atual.$nome) {
            $atual | Add-Member -NotePropertyName $nome -NotePropertyValue ([pscustomobject]@{}) -Force
        }
        $atual = $atual.$nome
    }
    $atual | Add-Member -NotePropertyName $caminho[$caminho.Length - 1] -NotePropertyValue $valor -Force
}

function Configurar-Jwt([string]$arquivo, [string]$chave) {
    $obj = [pscustomobject]@{}
    if (Test-Path -LiteralPath $arquivo) {
        $txt = [IO.File]::ReadAllText($arquivo)
        if ($txt.Trim()) { $obj = $txt | ConvertFrom-Json }
        $copia = $arquivo + '.antes-lube-office'
        if (-not (Test-Path -LiteralPath $copia)) { Copy-Item -LiteralPath $arquivo -Destination $copia }
    }
    foreach ($p in @('browser', 'request.inbox', 'request.outbox')) {
        Definir-Valor $obj (('services.CoAuthoring.token.enable.' + $p).Split('.')) $true
    }
    foreach ($p in @('inbox', 'outbox', 'session', 'browser')) {
        Definir-Valor $obj (('services.CoAuthoring.secret.' + $p + '.string').Split('.')) $chave
    }
    [IO.File]::WriteAllText($arquivo, ($obj | ConvertTo-Json -Depth 30), (New-Object System.Text.UTF8Encoding($false)))
}
