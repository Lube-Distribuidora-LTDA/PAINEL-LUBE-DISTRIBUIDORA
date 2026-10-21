# diagnostico_motor.ps1
#
# LUBE OFFICE - diz numa frase por que o editor esta (ou nao esta) no ar, e mostra
# o que conferiu. Nao muda nada. Rode pelo DIAGNOSTICO MOTOR.bat, na SRV-IA.

. (Join-Path $PSScriptRoot 'office_comum.ps1')
$ErrorActionPreference = 'Continue'

function Linha([string]$rotulo, [string]$valor, [string]$cor = 'Gray') {
    Write-Host ('  ' + $rotulo.PadRight(26) + $valor) -ForegroundColor $cor
}

Write-Host ''
Write-Host '================================================================' -ForegroundColor Cyan
Write-Host ' LUBE OFFICE - diagnostico do motor de edicao' -ForegroundColor Cyan
Write-Host '================================================================' -ForegroundColor Cyan
Write-Host ''

$mem = Memoria-GB
Linha 'Maquina' $env:COMPUTERNAME
Linha 'Memoria' ('{0} GB no total, {1} GB livres' -f $mem.total, $mem.livre)

$instalado = Test-Path -LiteralPath $OFFICE.Motor
Linha 'ONLYOFFICE instalado' ($(if ($instalado) { 'sim, em ' + $OFFICE.Motor } else { 'NAO' })) ($(if ($instalado) { 'Green' } else { 'Red' }))

$servicos = Servicos-Motor
foreach ($s in $servicos) { Linha ('Servico ' + $s.Name) ([string]$s.Status) ($(if ($s.Status -eq 'Running') { 'Green' } else { 'Red' })) }

$local = Motor-Saudavel $OFFICE.Local
Linha 'Motor local' ($(if ($local) { 'responde em ' + $OFFICE.Local } else { 'NAO responde em ' + $OFFICE.Local })) ($(if ($local) { 'Green' } else { 'Red' }))

$temChave = Test-Path -LiteralPath $OFFICE.Chave
Linha 'Chave do motor' ($(if ($temChave) { 'existe (C:\BI\OFFICE\motor.chave)' } else { 'NAO existe' })) ($(if ($temChave) { 'Green' } else { 'Red' }))

$tarefa = Get-ScheduledTask -TaskName $OFFICE.Tarefa -ErrorAction SilentlyContinue
Linha 'Tarefa agendada' ($(if ($tarefa) { [string]$tarefa.State } else { 'NAO existe' })) ($(if ($tarefa -and $tarefa.State -eq 'Running') { 'Green' } else { 'Yellow' }))

$cf = Get-Process -Name cloudflared -ErrorAction SilentlyContinue
Linha 'Tunel (cloudflared)' ($(if ($cf) { 'rodando' } else { 'parado' })) ($(if ($cf) { 'Green' } else { 'Red' }))

$estado = Ler-Estado
$url = $null
if ($estado) {
    $url = [string]$estado.url
    Linha 'Ultima situacao' ([string]$estado.etapa + ' (' + [string]$estado.em + ')')
    if ($url) { Linha 'Endereco publico' $url }
    if ($estado.erro) { Linha 'Erro' ([string]$estado.erro) 'Red' }
}
$publico = $false
if ($url) {
    $publico = Motor-Saudavel $url
    Linha 'Motor pela internet' ($(if ($publico) { 'responde' } else { 'NAO responde' })) ($(if ($publico) { 'Green' } else { 'Red' }))
}

Write-Host ''
Write-Host '  Ultimas linhas do motor.log:' -ForegroundColor Cyan
if (Test-Path -LiteralPath $OFFICE.Log) { Get-Content -LiteralPath $OFFICE.Log -Tail 12 | ForEach-Object { Write-Host ('    ' + $_) } }

# a conclusao numa frase
$conclusao = $null
if (-not $instalado) { $conclusao = 'O ONLYOFFICE nao esta instalado: rode o INSTALAR MOTOR.bat.' }
elseif (-not $local) { $conclusao = 'O ONLYOFFICE esta instalado mas nao responde: veja os servicos em vermelho acima (o tunel tenta reiniciar sozinho a cada minuto).' }
elseif (-not $temChave) { $conclusao = 'Falta a chave do motor: rode o INSTALAR MOTOR.bat de novo.' }
elseif (-not $tarefa) { $conclusao = 'Falta a tarefa agendada: rode o INSTALAR MOTOR.bat de novo.' }
elseif (-not $cf) { $conclusao = 'O tunel esta parado: a tarefa "' + $OFFICE.Tarefa + '" deveria estar rodando (Agendador de Tarefas).' }
elseif ($estado -and $estado.etapa -eq 'aviso_recusado' -and $estado.status -eq 503) { $conclusao = 'Falta cadastrar o segredo OFFICE_JWT_SECRET no Supabase (o INSTALAR MOTOR.bat mostra a chave).' }
elseif ($estado -and $estado.etapa -eq 'aviso_recusado' -and $estado.status -eq 403) { $conclusao = 'A chave cadastrada no Supabase nao e a desta maquina: cadastre de novo o OFFICE_JWT_SECRET com a chave de C:\BI\OFFICE\motor.chave.' }
elseif ($estado -and $estado.etapa -eq 'aviso_recusado') { $conclusao = 'O painel recusou o aviso: ' + [string]$estado.erro }
elseif ($url -and -not $publico) { $conclusao = 'O motor responde aqui dentro, mas nao pela internet: o tunel deve abrir outro endereco em ate 15 minutos.' }
elseif ($estado -and $estado.etapa -eq 'no_ar' -and $publico) { $conclusao = 'Tudo certo: o editor esta no ar em ' + $url + ' e o painel sabe disso.' }
else { $conclusao = 'Situacao indefinida: mande este print para o Claude.' }

Write-Host ''
Write-Host ('  >> ' + $conclusao) -ForegroundColor $(if ($conclusao.StartsWith('Tudo certo')) { 'Green' } else { 'Yellow' })
Write-Host ''
