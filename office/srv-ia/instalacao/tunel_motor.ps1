# tunel_motor.ps1
#
# LUBE OFFICE - mantem o motor de edicao alcancavel pela internet.
# Roda para sempre, como SYSTEM, pela tarefa agendada "LUBE OFFICE - Motor"
# (que o INSTALAR MOTOR.bat cria e que liga junto com a SRV-IA).
#
#  1. confere o ONLYOFFICE local (http://localhost:8090); se nao responde, reinicia os servicos dele
#  2. abre o tunel rapido da Cloudflare (cloudflared) e le o endereco https://....trycloudflare.com
#  3. avisa o endereco ao painel e repete o aviso de 5 em 5 minutos (o painel considera
#     o editor fora do ar se ficar 15 minutos sem aviso)
#  4. se o endereco publico parar de responder 3 vezes seguidas, abre outro tunel
#
# Tudo vai para C:\BI\OFFICE\motor.log; a situacao atual fica em C:\BI\OFFICE\estado.json.

. (Join-Path $PSScriptRoot 'office_comum.ps1')
$ErrorActionPreference = 'Continue'

Escrever-Log ('tunel: iniciando (' + $OFFICE.Versao + ')')

while ($true) {
    $proc = $null
    try {
        if (-not (Test-Path -LiteralPath $OFFICE.Chave)) {
            Gravar-Estado @{ etapa = 'sem_chave'; erro = 'Falta a chave do motor: rode o INSTALAR MOTOR.bat.' }
            Start-Sleep -Seconds 60
            continue
        }
        $chave = (Get-Content -LiteralPath $OFFICE.Chave -Raw).Trim()

        # 1. motor local
        if (-not (Motor-Saudavel $OFFICE.Local)) {
            Escrever-Log 'tunel: o ONLYOFFICE local nao respondeu; reiniciando os servicos dele'
            foreach ($s in (Servicos-Motor)) { try { Restart-Service -InputObject $s -Force -ErrorAction Stop } catch {} }
            Start-Sleep -Seconds 60
            if (-not (Motor-Saudavel $OFFICE.Local)) {
                Gravar-Estado @{ etapa = 'motor_fora'; erro = ('O ONLYOFFICE nao responde em ' + $OFFICE.Local) }
                Start-Sleep -Seconds 60
                continue
            }
        }

        # 2. tunel
        Get-Process -Name cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $OFFICE.LogTunel -ErrorAction SilentlyContinue
        $proc = Start-Process -FilePath $OFFICE.Cloudflared -WindowStyle Hidden -PassThru `
                -ArgumentList @('tunnel', '--no-autoupdate', '--url', $OFFICE.Local, '--logfile', ('"' + $OFFICE.LogTunel + '"'))
        $url = $null
        for ($i = 0; $i -lt 60 -and -not $url; $i++) {
            Start-Sleep -Seconds 2
            if ($proc.HasExited) { break }
            $url = Ler-UrlTunel $OFFICE.LogTunel
        }
        if (-not $url) {
            Escrever-Log 'tunel: o cloudflared nao deu endereco (veja tunel.log)'
            Gravar-Estado @{ etapa = 'tunel_sem_endereco'; erro = 'O tunel da Cloudflare nao abriu (veja C:\BI\OFFICE\tunel.log).' }
            Start-Sleep -Seconds 30
            continue
        }
        Escrever-Log ('tunel: endereco ' + $url)
        # o endereco novo leva alguns segundos para responder
        for ($i = 0; $i -lt 30; $i++) { if (Motor-Saudavel $url) { break }; Start-Sleep -Seconds 3 }

        # 3. avisa o painel e repete de 5 em 5 minutos enquanto o tunel e o motor estiverem vivos
        $falhasSeguidas = 0
        while (-not $proc.HasExited) {
            $r = Registrar-Motor $url $chave
            if ($r.ok) {
                Gravar-Estado @{ etapa = 'no_ar'; url = $url; registrado = $true }
            } else {
                Escrever-Log ('tunel: o painel recusou o aviso - ' + $r.mensagem)
                Gravar-Estado @{ etapa = 'aviso_recusado'; url = $url; registrado = $false; erro = $r.mensagem; status = $r.status }
            }
            for ($k = 0; $k -lt 10 -and -not $proc.HasExited; $k++) { Start-Sleep -Seconds 30 }
            if (Motor-Saudavel $url) { $falhasSeguidas = 0 } else { $falhasSeguidas++ }
            if ($falhasSeguidas -ge 3) {
                Escrever-Log 'tunel: o endereco publico parou de responder; abrindo outro tunel'
                break
            }
        }
        if ($proc.HasExited) { Escrever-Log ('tunel: o cloudflared parou (codigo ' + $proc.ExitCode + '); abrindo de novo') }
    } catch {
        Escrever-Log ('tunel: erro - ' + $_.Exception.Message)
        Start-Sleep -Seconds 30
    } finally {
        try { if ($proc -and -not $proc.HasExited) { $proc.Kill() } } catch {}
    }
}
