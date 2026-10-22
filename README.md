# Painel de Sistemas — Lube Distribuidora

Portal organizacional que centraliza o acesso às plataformas internas da Lube
Distribuidora, com login restrito ao domínio `@lube.com.br` e painel
administrativo para gestão de usuários, sistemas e permissões.

Site estático (HTML + CSS + JS puro, sem build) com Supabase cuidando de
autenticação e banco de dados.

## Estrutura

```
index.html      portal: tela de login + vitrine dos sistemas liberados
admin.html      painel administrativo (só abre para perfis is_admin)
styles.css      sistema visual do portal (cores, tipografia, animações)
admin.css       estilos do painel administrativo
app.js          animações: scroll, caminhão, ícones SVG, busca, carrossel
portal.js       sessão, permissões e montagem dos cartões
admin.js        CRUD de usuários, sistemas, permissões e log de acessos
icones.js       ícones dos sistemas (desenhados no padrão Lube ou imagem)
marca.js        marca "L" em SVG para páginas que não carregam o app.js
config.js       URL e chave pública do Supabase
middleware.ts   guarda da Sentinela na porta do portal (FECHADO = null)
sentinela-guarda.ts  núcleo do guarda (cópia de guarda/sentinela-guarda.ts)
office/         LUBE OFFICE: Drive, editor, modelos (todo usuário ativo)
sentinela/      painel da Sentinela Lube (só administrador)
guarda/         núcleo, modelo de middleware, testes e guia de instalação
db/             SQL completo do banco (tabelas, gatilhos e políticas)
supabase/       Edge Functions admin-users, sentinela (central) e office
docs/           especificação da Sentinela
assets/         imagens
```

`db/`, `supabase/`, `guarda/`, `docs/`, `.claude/` e este README ficam fora do site
publicado (`.vercelignore`): o endereço devolve 404.

## Como funciona o acesso

A tela inicial tem dois caminhos: **Entrar** e **Primeiro acesso**.

### Primeiro acesso

A pessoa informa nome, e-mail corporativo e cria a própria senha. O cadastro
nasce **pendente**: ninguém entra sozinho. O TI vê o pedido no topo da lista de
usuários, com a etiqueta *Aguardando*, e clica em **Liberar** escolhendo quais
sistemas aquela pessoa pode ver.

> **Ajuste necessário no Supabase.** Em *Authentication → Sign In / Providers →
> Email*, desligue **Confirm email**. Com essa opção ligada o Supabase tenta
> mandar um e-mail de confirmação, e o SMTP padrão só entrega para membros do
> projeto — o colaborador ficaria travado. Como todo cadastro passa pela
> aprovação do TI, a confirmação por e-mail não faz falta. Se preferir mantê-la,
> configure um SMTP próprio.

### Entrar

1. A pessoa entra com **usuário + senha**. Se digitar só `nome.sobrenome`, o
   portal completa para `nome.sobrenome@lube.com.br`.
2. O Supabase valida a senha (guardada com hash, nunca em texto).
3. O portal mostra **todos os sistemas cadastrados**. Os liberados vêm
   primeiro e abrem normalmente; os demais aparecem em cinza, com cadeado e o
   aviso de que falta autorização — assim a pessoa sabe o que existe e o que
   pedir ao TI.
4. Cada login e cada abertura de sistema fica registrada na tabela `acessos`.

**Exceção para e-mail de fora (consultores).** A tabela `emails_externos` guarda os
e-mails fora do domínio que o TI liberou, um a um — hoje só
`melissa@manceboconsulting.com`. Para esses, a pessoa digita o e-mail completo
(o `@lube.com.br` não é acrescentado) e o painel admin também aceita o e-mail
completo no campo "Usuário". Qualquer outro e-mail externo continua recusado. Para
liberar mais um (só o administrador, direto no SQL Editor do Supabase):

```sql
insert into public.emails_externos (email, observacao)
values ('nome@empresa.com', 'quem é / por quê');
```

A restrição de domínio roda **dentro do banco** (gatilho em `auth.users`), não no
JavaScript — não dá para burlar pelo navegador. As tabelas usam Row Level
Security: sem sessão válida a API não devolve nada, e um usuário comum só
enxerga o próprio perfil e os próprios sistemas.

### SAC — chamado do RCA (sistema de fora)

Abaixo do formulário de login há um atalho **"SAC · Abrir chamado"** que leva ao
[SAC](https://sac-lube.vercel.app/), um sistema à parte (repositório e projeto próprios). Decisão do
Júlio (2026-10-07): os RCAs abrem chamado **sem precisar de conta no portal**. O portal só
leva até lá: não passa sessão, passe nem nada do login. Quem protege o SAC é ele mesmo — só manda
comprovante para o e-mail de um RCA ativo no WinThor — e o guarda da Sentinela dele, com
`exige_login = false`. Mudou o endereço do SAC? Troque o `href` da `.gate__sac` no `index.html`.

**Contas do SAC (2026-10-09).** O SAC ganhou login próprio ("Entrar" / "Primeiro acesso") **nesta mesma base de
login**, mas as contas são do SAC, não do painel: o gatilho `handle_new_user` desvia quem chega com
`raw_user_meta_data->>'sistema' = 'sac'` para `public.sac_usuarios` (**pendente**), **sem** criar `profiles` — por
isso uma conta do SAC nunca abre o painel (e, se tentar entrar aqui, `portal.js` sai da sessão e aponta o atalho
do SAC). O resto da regra do domínio (@lube.com.br ou `emails_externos`) continua igual. Migração
`sac_acesso_v1` = `db/03_sac_acesso.sql` (15 testes numa transação desfeita antes de aplicar). No painel admin,
a aba **"SAC · externos"** mostra as contas (Liberar, Recusar, Bloquear, Senha, Remover) e os acessos do SAC
(`sac_acessos`); cadastro novo aparece com selo na aba, faixa no topo e o número no título da página, e o
admin confere de minuto em minuto. "Acessos do painel" continua só com o painel.

### Painel administrativo

Conta administradora: **cpd@lube.com.br** (na tela de login basta digitar `cpd`).

Entre no portal como administrador e clique em **Painel admin** na barra
superior (o link só aparece para quem é admin; abrir `admin.html` direto sem
permissão devolve para o portal).

- **Usuários** — liberar quem pediu primeiro acesso, criar contas direto (com
  senha provisória), editar nome/cargo, promover a administrador, ativar e
  desativar, redefinir senha e remover. As permissões de sistema são marcadas
  na mesma tela, com a opção **Todos os sistemas**: quem tem essa marcação
  enxerga tudo, inclusive as plataformas cadastradas depois, sem precisar
  voltar aqui para liberar uma a uma. Marcando "Todos", aparece uma segunda
  lista, **"Liberar tudo, exceto:"** — dá para tirar sistemas específicos de
  quem tem acesso total (ex.: todo mundo vê tudo, menos o Painel ICMS).
- **Sistemas** — cadastrar, editar, reordenar, ativar/desativar e excluir as
  plataformas que aparecem no portal. O ícone é escolhido numa galeria visual;
  o botão **Novo ícone** cria mais opções, que ficam salvas como predefinidas
  para os próximos cadastros. Um ícone novo pode ser *desenhado no padrão Lube*
  (você digita as linhas e vê a prévia na hora) ou *enviado como imagem*
  (PNG/JPG/SVG/WEBP até 2 MB, guardado no Storage do Supabase).
- **Acessos** — últimos 200 registros de entrada e abertura de sistemas.

Criar usuário, trocar senha e remover passam pela Edge Function `admin-users`,
que confere o JWT e o `is_admin` no servidor antes de agir. A chave de serviço
do Supabase fica só lá dentro — nunca no repositório.

## Sentinela Lube (segurança)

A Sentinela protege os sistemas da Lube na Vercel. Em cada sistema roda um
**guarda** (`middleware.ts` + `sentinela-guarda.ts`) que olha toda requisição,
barra ataques e manda os eventos para a **central** (Edge Function `sentinela`,
schema `sentinela` neste mesmo Supabase). Especificação em
`docs/SENTINELA-ESPECIFICACAO.md`; instalação em `guarda/LEIA-ME.md`.

- **Painel**: `/sentinela/` (globo 3D, eventos, bloqueios, IA). Só abre para
  administrador: as funções `public.sentinela_*` que alimentam o painel exigem
  `is_admin()` e não devolvem nada para os demais.
- **Passe**: ao abrir um sistema, o portal pede à central um passe de uso único
  (vale 90 s, só para quem tem permissão no sistema) e abre o sistema com ele; o
  guarda do sistema troca o passe por uma sessão de 8 h. Sistema com
  `exige_login = true` em `sentinela.sistemas` só deixa entrar quem chegou pelo portal.
- **O portal não é fechado**: aqui é a tela de login, então `FECHADO = null` no
  `middleware.ts` e `exige_login = false` em `sentinela.sistemas`. No modo
  `observar` o guarda registra tudo e só barra o que é ataque certo (o suspeito
  vira "seria bloqueado"); no modo `proteger` barra também o suspeito.
- **Saúde**: `/.sentinela/saude` mostra se o guarda recebe o token da Vercel
  (`oidc`) e se a lista da central chegou (`lista.ok`).
- Mudou o núcleo em `guarda/`? Copie para a raiz (`sentinela-guarda.ts`) e rode
  `node guarda/teste/guarda.teste.mjs`.

## LUBE OFFICE (documentos, planilhas e apresentações)

Desde 2026-10-21, em `/office/`. Todo usuário ativo do painel tem o seu, sem
liberação por sistema: o link **Office** fica no menu do portal, com o número de
avisos não lidos.

- **Drive** (`office/index.html`): Meus arquivos, Compartilhados comigo,
  Recentes, Modelos da Lube e Lixeira; criar documento, planilha, apresentação
  ou pasta; enviar do computador (botão ou arrastar); renomear, mover;
  compartilhar com uma pessoa ou com **todos da Lube**, como ver, comentar ou
  editar (a pasta passa o acesso para tudo o que está dentro); versões com quem e
  quando, e voltar a qualquer uma; atividade do arquivo; sino de avisos
  (compartilhamento, @menção em comentário e envio).
- **Nada se baixa** (Júlio, 2026-10-21): nem no Drive, nem nas versões, nem
  dentro do editor (`permissions.download = false`). O arquivo sai do painel só
  pelo **Enviar** (quem pode editar): para **pessoas do painel** (ganham acesso,
  se ainda não têm, e um aviso no sino) e/ou por **e-mail de fora** (anexo de até
  20 MB, um e-mail por destinatário, pela caixa do Office com o nome de quem
  enviou e resposta para ele). Todo envio fica na atividade do arquivo.
- **Editor** (`office/editor.html?id=`): abre o **ONLYOFFICE Docs** dentro do
  painel, com a configuração assinada pela função. Sem o motor no ar, a página
  diz se ele está sendo ligado ou fora do ar (e desde quando).
- **Vida na tela**: aurora no fundo, entrada em cascata, luz que segue o mouse com
  leve inclinação nos cartões, marcador da lateral que desliza, transição entre
  seções (View Transitions), o ícone que "decola" ao abrir um arquivo e **arrastar um
  arquivo ou pasta para outra pasta** (ou para a trilha) para mover, com Desfazer.
  Quem pede menos movimento no sistema (`prefers-reduced-motion`) não vê animação.
- **Banco**: schema `office` neste Supabase (`db/04_office.sql`, `db/05_office_envio_motor.sql` e `db/07_office_ia.sql`), separado das
  tabelas do portal. RLS ligado e sem políticas: o navegador **nunca** fala com o
  schema. Tudo passa pela Edge Function `office`, que chama as funções
  `public.office_srv_*` com a chave de serviço; cada função confere o papel de
  quem pediu (dono 4 · editar 3 · comentar 2 · ver 1). Nada se apaga: excluir
  manda para a lixeira.
- **Arquivos**: bucket privado `office`, um objeto por versão
  (`arquivos/<id>/<carimbo>.<ext>`). O envio vai direto do navegador ao Storage
  por um link assinado que a função gera para o caminho reservado.
- **Edge Function `office`** (`supabase/functions/office`, sem `verify_jwt`
  porque tem três portas e confere sozinha): `POST /office` recebe as ações do
  navegador com o JWT da sessão; `POST /office/motor` recebe o arquivo salvo pelo
  ONLYOFFICE e grava a versão nova; `POST /office/motor/registrar` recebe da
  SRV-IA o endereço do motor. As duas portas do motor exigem token JWT da chave
  do motor. Segredos (cadastrados pelo TI em Supabase › Edge Functions ›
  Secrets): `OFFICE_JWT_SECRET` (a chave do motor, que o instalador da SRV-IA
  gera e mostra), `OFFICE_SMTP_USER` e `OFFICE_SMTP_PASS` (a caixa de e-mail do
  Enviar; porta 465, porque o Supabase bloqueia a 25 e a 587) e, opcional,
  `OFFICE_MOTOR_URL` (endereço fixo; sem ele vale o que a SRV-IA registrou). Sem
  eles o Drive funciona, o editor avisa que está sendo ligado e o Enviar por
  e-mail avisa que falta a caixa. Testes: `node --test supabase/functions/office/teste/motor.test.mjs`.
- **Motor na SRV-IA** (`office/srv-ia/`, cópia em `P:\INTEGRAÇÃO BI\OFFICE`):
  `INSTALAR MOTOR.bat` instala o ONLYOFFICE Docs Community na porta 8090, cria a
  chave do motor (`C:\BI\OFFICE\motor.chave`), liga a assinatura JWT e cria a
  tarefa **LUBE OFFICE - Motor** (SYSTEM, desde que a máquina liga). A tarefa
  abre um **túnel rápido da Cloudflare** (`*.trycloudflare.com`, sem porta aberta
  e sem domínio), avisa o endereço ao painel e repete o aviso de 5 em 5 minutos;
  sem aviso por 15 minutos, o painel mostra o editor fora do ar.
  `DIAGNOSTICO MOTOR.bat` diz numa frase o que está errado.
  **No ar desde 2026-10-21** (ONLYOFFICE 10.0 na SRV-IA, 16 GB).
- **Teste de ponta a ponta do motor** (sem login no painel): `POST /office/motor/teste`
  com uma senha temporária gravada no banco por quem tem acesso SQL
  (`office.config`, chave `teste_motor`; modelo em `db/06_office_teste_motor.sql`).
  Ela cria um arquivo "Teste do motor" na conta indicada e devolve a configuração
  assinada do editor; abrir, editar e fechar tem que gerar a versão nova com origem
  `editor`. Depois: mandar o arquivo para a lixeira e apagar a senha.
- **Altura do editor**: o ONLYOFFICE troca o espaço reservado pela própria
  moldura; o `editor.css` dá o tamanho a `.ed-palco > iframe` (sem isso ela fica
  com 150 px).
- **IA da Lube** (desde 2026-10-21; decisões do Júlio: **Claude Haiku 5.5**, teto de
  **US$ 10 por dia** somando a Lube toda, todo usuário ativo):
  - **No editor**: botão **IA da Lube** (Ctrl+Shift+I) abre um painel ao lado do
    documento. A pessoa pede, com texto e até 4 fotos (quadro, anotação à mão,
    tabela impressa), e a IA escreve **dentro** do arquivo: no Word, blocos com a
    cara da Lube (no lugar da seleção, se pedido); no Excel, uma aba com título,
    faixa vermelha, cabeçalho azul, fórmulas, total e gráfico; no PowerPoint, slides
    desenhados um a um, com transição e animação em cada elemento.
  - **No Drive**: **Criar com IA** (cartão no topo, menu Novo ou tecla `I`) e
    **Transformar com IA** no menu de cada arquivo (lê Word, Excel, PowerPoint, PDF,
    TXT ou CSV e cria outro tipo; o original não muda). O Drive cria o arquivo a
    partir de `office/modelos/ia-*` (documento já com cabeçalho e rodapé da Lube),
    guarda o pedido no navegador e abre o editor, onde a IA monta tudo; o arquivo
    ganha o nome que a IA sugerir.
  - **Como funciona**: a ação `ia` da função `office` pede ao Claude um **plano em
    JSON** (structured outputs; nunca HTML nem código) e o plugin escondido
    `office/ia/` (`executor.js`) executa o plano no documento pela API do ONLYOFFICE
    (`callCommand`). A página do editor fala direto com o plugin (mesma origem do
    portal): o canal oficial `onExternalPluginMessage` só existe na edição paga do
    ONLYOFFICE. O plugin só entra na configuração de quem pode editar, e só depois
    que o portal publica `office/ia/config.json` (o `vercel.json` libera o CORS
    dessa pasta, porque quem lê o `config.json` é o editor, em outro endereço).
  - **Custo e teto**: cada pedido custa em geral **menos de 1 centavo de dólar**
    (US$ 0,0005 a 0,0015 nos testes). Tudo fica em `office.ia_uso` (quem, o quê,
    tokens, custo); o teto do dia e o modelo ficam em `office.config` (`ia`),
    mudáveis sem publicar (`db/07_office_ia.sql`). A chave é a mesma
    `ANTHROPIC_API_KEY` da Sentinela, neste projeto.
  - **Testes**: `node --test supabase/functions/office/teste/ia.test.mjs`. De ponta a
    ponta sem login: `office/editor.html?ext=pptx#teste=<senha temporária>` abre um
    "Teste do motor" com a IA (só arquivos "Teste do motor", também como origem do
    Transformar).
- **Modelos** (`office/modelos/`): em branco e com a marca da Lube (proposta,
  ata, relatório mensal, apresentação). Gerados por
  `python office/ferramentas/gerar_modelos.py` (precisa de python-docx,
  python-pptx, openpyxl e Pillow).
- **Demonstração**: `http://localhost:4321/office/?demo=1` com dados sintéticos
  (`office/demo.js`, só na máquina; fica fora do site pelo `.vercelignore`).
- Quem chega ao Office sem sessão vai para `/?voltar=office` e, depois do login,
  volta para `/office/`.

## Banco de dados

Projeto Supabase: **painel-lube-acesso** (`wkkdcsqwlxjxorutrbnx`, região
sa-east-1). O SQL aplicado está em `db/01_schema.sql`.

| Tabela | Para que serve |
|---|---|
| `profiles` | usuários do painel (nome, cargo, admin, ativo, acesso total) |
| `sistemas` | plataformas cadastradas |
| `permissoes` | quem enxerga qual sistema |
| `permissoes_excecao` | sistemas retirados de quem tem `acesso_total` (ignorada para quem não tem) |
| `acessos` | registro de entradas e aberturas |
| `icones` | ícones predefinidos dos sistemas |

A chave em `config.js` é a *anon key*: ela é pública por natureza e não dá
acesso a nada sozinha — quem decide o que pode ser lido são as políticas RLS.

## Rodar localmente

```bash
python -m http.server 4321
```

Depois abra <http://localhost:4321>.

## Publicar na Vercel

Não há etapa de build. Conecte este repositório na Vercel e configure:

- Framework Preset: **Other**
- Build Command: *(vazio)*
- Output Directory: `.`

## Trocar a ilustração do caminhão pela foto oficial

A transição entre o topo escuro e a área de sistemas usa um caminhão que
atravessa a tela — hoje desenhado em SVG. Para usar a foto oficial, salve a
imagem como `assets/caminhao-lube.png` (PNG com fundo transparente, caminhão de
perfil voltado para a direita, ~1600px de largura). O `app.js` detecta o arquivo
e substitui o SVG sozinho.

## Cache dos arquivos

Os `<script>` e `<link>` de `index.html` e `admin.html` carregam com
`?v=AAAAMMDD`. Ao publicar uma alteração em JS ou CSS, **atualize essa data nos
dois arquivos** — é o que faz o navegador buscar a versão nova em vez de usar a
guardada em cache.

## Busca e carrossel

- A busca ignora acentos e maiúsculas e casa várias palavras ao mesmo tempo.
  Procura no título, na área, na descrição e no slug do sistema.
- `Esc` limpa a busca; o botão × também.
- O carrossel aceita setas do teclado, arraste com o mouse, toque no celular e
  os botões `<` `>`.

## Contatos do TI

O botão **Falar com o TI**, no rodapé, abre dois atalhos de WhatsApp:

| Pessoa | Telefone | Link |
|---|---|---|
| Júlio | +55 (27) 98881-9807 | `https://wa.me/5527988819807` |
| Alexandre | +55 (27) 99273-6082 | `https://wa.me/5527992736082` |

Para trocar um número, edite o `href` do `.contact__item` em `index.html` no
formato `55` + DDD + número, sem espaços.

## Pendências recomendadas

1. **Trocar a senha do administrador** no primeiro acesso.
2. **Desligar o "Confirm email"** no Supabase (veja o aviso em *Primeiro acesso*).
3. **Ligar a proteção contra senhas vazadas** no Supabase
   (Authentication → Policies → *Leaked password protection*).
4. **Proteger os sistemas na origem**. O cadeado no portal é sinalização, não
   barreira: quem tiver o link abre a aplicação direto. Isto passa a ser feito
   pela Sentinela (veja acima): guarda instalado em cada sistema e, depois,
   `exige_login = true` sistema a sistema em `sentinela.sistemas`.

## Identidade

- Paleta: azul Lube `#1E2B8C`, vermelho `#EE1B24`, fundos `#030616` / `#060B29`,
  claros `#FFFFFF` / `#FAFAFA`.
- Tipografia: Archivo (100–900, com itálicos) + JetBrains Mono para rótulos.
- A navbar troca de cor sozinha conforme a seção que estiver atrás dela.
- `prefers-reduced-motion` desliga as animações.
