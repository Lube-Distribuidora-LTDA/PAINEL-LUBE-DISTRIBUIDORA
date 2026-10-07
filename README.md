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
sentinela/      painel da Sentinela Lube (só administrador)
guarda/         núcleo, modelo de middleware, testes e guia de instalação
db/             SQL completo do banco (tabelas, gatilhos e políticas)
supabase/       Edge Functions admin-users e sentinela (central)
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

### SAQ — chamado do RCA, sem login

Abaixo do formulário de login há um atalho **"SAQ · Abrir chamado ao SAC"** que leva ao
[SAQ](https://saq-lube.vercel.app/), um sistema à parte (repositório e projeto próprios). Decisão do
Júlio (2026-10-07): os RCAs abrem chamado **sem precisar de conta no portal**. O portal só
leva até lá: não passa sessão, passe nem nada do login. Quem protege o SAQ é ele mesmo — só manda
comprovante para o e-mail de um RCA ativo no WinThor — e o guarda da Sentinela dele, com
`exige_login = false`. Mudou o endereço do SAQ? Troque o `href` da `.gate__saq` no `index.html`.

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
