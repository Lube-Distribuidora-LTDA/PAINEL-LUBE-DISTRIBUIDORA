# SENTINELA LUBE — regra de rede da Lube (desenho v1.1, 2026-10-23)

> v1.1 (mesmo dia, depois da revisão adversária): afrouxar a regra passa pela central e só vale de
> dentro da rede (§4.4); "Todos em exigir" não inclui o portal; exigir só com o guarda visto na produção;
> o portal só exige depois da parte D (LUBE OFFICE); sem login, a regra vale em todo sistema com slug;
> a espera da lista na regra de rede é de 2,5 s; a saúde mostra a idade do bloco `rede`; dica na página
> de bloqueio; emergência por SQL cadastra o /64 em IPv6. O roteiro (§20) é a ordem única dos passos.

Pedido do gestor geral, trazido pelo Júlio em 2026-10-23: além do login do Painel Lube e da Sentinela,
o painel e os sistemas internos **só abrem para quem está ligado na rede da empresa**.

Este documento é o contrato das três peças que vão ser construídas (central, guarda e telas). Quem
implementa segue os nomes, as assinaturas e os formatos JSON daqui. Se algo estiver ambíguo, escolha o
caminho mais seguro e diga no relatório o que decidiu. A especificação geral continua sendo
`docs/SENTINELA-ESPECIFICACAO.md`; ela ganha uma seção sobre a rede quando isto for publicado.

> Este repositório é público. Aqui não entra e-mail, nome de pessoa nem IP de casa de ninguém. Os dados
> medidos aparecem agregados.

---

## 0. Resumo

- **Rede da Lube** = uma lista própria de IPs ou faixas (`sentinela.redes`), cadastrada pelo TI. Ela não
  tem nada a ver com as "redes confiáveis" (`sentinela.confiaveis`), que são aprendidas pelo login e
  vencem em 7 dias. Login de casa deixa a casa "confiável"; nunca deixa a casa "rede da Lube".
- **Cada sistema tem o seu modo de rede**: `desligado`, `observar` ou `exigir`. A central manda ao guarda
  o modo, as redes e as liberações. Com `desligado` o guarda 1.3.0 se comporta igual ao 1.2.0: dá para
  instalar em todos sem mudar nada para ninguém.
- **Observar** registra "seria bloqueado: fora da rede da Lube" e não barra. **Exigir** barra. Só com o
  OK do Júlio.
- **Liberação** por pessoa (e-mail do portal), com início, fim (no máximo **30 dias**), motivo e quem
  liberou. Vence sozinha. O TI cria e encerra no painel da Sentinela.
- **O guarda confere a rede a cada pedido.** A sessão de 8 h pega na empresa e levada para casa não vale
  fora. A central também não emite passe fora da rede para quem não está liberado.
- **A tela de login do portal sempre abre** (os RCAs usam o atalho do SAC nela, e o liberado precisa
  entrar). Depois do login, quem está fora e não está liberado vê: "Este sistema só abre na rede da Lube.
  Este aparelho não está na rede da Lube. Se precisa acessar de fora, fale com o TI." (mais uma dica para
  quem está na Lube no 4G, §9).
- **Afrouxar a regra só de dentro.** Com algum sistema exigindo a rede, cadastrar rede, liberar pessoa,
  observar e desligar só passam pela central e de dentro de uma rede da Lube (ou com liberação). Senha de
  administrador, de fora, não desliga a regra pelo banco (§4.4). O SQL Editor do Supabase continua sendo a
  saída de emergência.
- **Máquinas passam só com prova**: o robô do Gestão TI (já entra pelo `CRON_SECRET`) e o aquecedor do
  Reposições (passa a entrar por um segredo próprio). Nunca por cabeçalho que o cliente forja.
- **Emergência** (a operadora trocou o IP do escritório): uma linha no SQL Editor do Supabase, ou um botão
  no portal que só aparece para administrador quando pelo menos 3 pessoas da Lube foram barradas do mesmo
  IP nas últimas 2 horas.
- **SAC e Supervisor Lube ficam de fora** (são usados na rua). O banco marca os dois como isentos.
- **Limite**: a trava vale para o que passa pela Vercel. Banco aberto à chave pública (RH, Saída de
  Veículos, ICMS) e chamada direta ao Supabase com um token válido não passam pelo guarda (§17). O
  **LUBE OFFICE** ainda não confere a rede: o portal só passa a exigir depois da parte D (§13, passo 8c).

---

## 1. O pedido e as decisões

### Do Júlio (2026-10-23)
1. Escopo: o portal e os sistemas internos (os 10 que hoje exigem login, mais o Reposições). Ficam de
   fora o SAC e o Supervisor Lube.
2. Exceção: só quem o TI liberar, com prazo (ex.: o gestor comercial viajando, o TI à noite). Cada
   entrada de fora fica registrada na Sentinela.
3. "Todo mundo enquanto estiver na rede da Lube pode acessar; fora da rede não pode." A rede conhecida é
   a do escritório. Pode existir outra internet da Lube ainda não conhecida (link reserva, filial).

### Do Claude principal (seguidas aqui)
- A central controla a regra (modo por sistema, lista de redes, liberações). Guarda 1.3.0 com modo
  `desligado` = 1.2.0. Depois `observar` e, com o OK do Júlio, `exigir`.
- Fora da rede a tela de login abre; depois do login vem a página clara, sem detalhe técnico. A central
  não emite passe fora da rede para quem não está liberado; o guarda confere a rede a cada pedido.
- Liberação por pessoa, com início, fim, motivo e quem liberou; vence sozinha; só administrador cria e
  encerra.
- Telas: "Rede da Lube", "Liberados fora da rede" e "Tentativas de fora", com "liberar esta pessoa" e
  "isto é uma rede da Lube?".
- Sempre passam: `/.sentinela/*`, o agendador da Vercel e as chamadas entre servidores que já se
  autenticam com segredo próprio, e o que o desenho provar que é máquina da Lube autenticada.
- Emergência com passo a passo e um jeito seguro já pronto.

### Decisões deste desenho (o porquê está em cada seção)
- O modo de rede **não** vai numa coluna nova de `sentinela.sistemas`: vai numa tabela nova,
  `sentinela.rede_sistemas`, ligada pelo `projeto_id`. Motivo: `alter table` em `sentinela.sistemas` e
  `sentinela.config` trava as duas tabelas mais lidas da Sentinela (todo `/lista` e todo `/evento`)
  enquanto a transação durar, e o teste roda em transação revertida **com os guardas no ar**. Tabela
  nova não trava nada que já existe (§4.8).
- A migração **não** cadastra a rede do escritório: o TI cadastra pela tela (ou o Claude principal, com o
  OK do Júlio, numa linha de SQL). A regra é "lista cadastrada pelo TI".
- A lista do guarda leva o **SHA-256 do e-mail** de quem está liberado, nunca o e-mail.
- Prazo máximo da liberação: **30 dias** (configurável de 1 a 90 só por SQL, para afrouxar ser um ato
  pensado).
- Faixa mínima de rede: **/24 em IPv4 e /48 em IPv6**. IP interno (192.168..., 10..., 100.64...) é
  recusado: a Vercel só vê o IP público.
- A regra de rede **nunca bloqueia IP** nem cria bloqueio na lista. Ela só decide se aquele pedido passa.

### Decisões da revisão (v1.1, 2026-10-23)
- **Afrouxar passa pela central** (`sentinela_srv_rede_acao`), que manda o IP do pedido. Com algum sistema
  exigindo, o banco só aceita rede nova, liberar, observar e desligar de dentro de uma rede da Lube ou de
  admin com liberação ativa; `sentinela_rede_acao` (direto pelo banco) recusa essas quatro. Apertar
  (remover rede, encerrar, exigir) vale de qualquer lugar e pelos dois caminhos (§4.4).
- **Exigir só com o guarda 1.3.0 visto na produção** (`ultimo_ambiente = 'production'`): a versão em
  `sentinela.sistemas` é de quem mandou o último evento, e uma prévia não prova nada.
- **"Todos em exigir" não inclui o portal** (`'*'` em exigir = sistemas com `exige_login`). O portal passa a
  exigir à parte, por último, e só com o LUBE OFFICE conferindo a rede (parte D).
- **Sem login, a regra vale em todo sistema com slug** (antes: só com "exige login"). Desligar o login de um
  sistema (por engano, ou com a senha de um admin de fora) não o abre para fora da rede. O portal (sem slug)
  continua abrindo a tela de login de qualquer lugar.
- **A regra espera a lista nova por até 2,5 s** (antes 700 ms) numa instância parada: a central fria à noite
  fazia o liberado levar 403 e passar ao recarregar.
- **A saúde mostra a idade do bloco `rede`** (`lista.rede_idade_s`): é por ela que se vê que a central parou
  de mandar o bloco (os guardas seguem com o último por até 24 h). O prazo de 24 h ficou: encurtar trocaria
  um bloco congelado (visível) por uma regra que some sozinha (fail-open silencioso).
- **IP do escritório fora do repositório público**: exemplos com IPs de documentação (203.0.113.x).

---

## 2. O que medimos (banco do Painel, 14 dias até 2026-10-23)

| o quê | resultado |
|---|---|
| Acessos com login vindos do escritório | 1 IP (o IP está na nota SENTINELA LUBE do cérebro, não aqui): cerca de 3.340 eventos com login, 9 pessoas, 10 sistemas; 240 logins no portal |
| Acessos com login fora do escritório | 2 pessoas, de 2 cidades, em 2 sistemas (cerca de 130 eventos), mais 1 login só no portal, de uma terceira cidade |
| IPv6 | nenhum evento em IPv6. O IP que a central vê no login (Supabase) é o mesmo que o guarda vê (Vercel) nos 3 IPs com login |
| Robô do Gestão TI | 28 chamadas (2 por dia): `GET /api/cron/ler-emails` às 08:29 e `GET /api/cron/cobrar` às 09:27 (Brasília), user-agent `vercel-cron/1.0`, **um IP diferente da Amazon (Ashburn, EUA) a cada dia**, identidade `robo do gestao ti (agendador da vercel)` com origem `sessao_app`, decisão `liberado`, regra `cron` |
| Outras chamadas de máquina nos sistemas fechados | nenhuma. Os sistemas fechados só têm acesso com login, `sem_login`, `lista`, `robo` e `buscador` |
| Reposições | sem guarda: não aparece nos eventos. O aquecedor da `SRV-IA` chama `GET /api/dados` de 5 em 5 min (e falha com `CERTIFICATE_VERIFY_FAILED` desde 14/10) |
| Conta de fora do domínio | 1 (a consultora externa). Tem permissão **só no Reposições**. Entrou 1 vez, em 07/10, do escritório |
| Redes confiáveis ativas | 3, todas aprendidas por login (escritório e dois IPs de fora). Prova de que `confiaveis` não serve como "rede da Lube" |

**Como o robô do Gestão TI passa hoje.** O `src/middleware.ts` do Gestão TI confere
`Authorization: Bearer <CRON_SECRET>` em `/api/cron/` (segredo de 16+ caracteres, em tempo constante) e,
se bater, chama o guarda com `opcoes.identidade = { email: 'robo do gestao ti (agendador da vercel)',
origem: 'sessao_app' }`. O guarda trata isso como identidade: não cai em robô nem em `sem_login`. O IP
muda todo dia e é da Amazon, então **IP nenhum serve para liberar o robô**. O que prova que é ele é o
segredo, conferido pelo próprio app. O desenho reaproveita isso (§11).

**Como o agendador da Vercel aparece.** Só no Gestão TI (o único com `crons` no `vercel.json`). O
user-agent `vercel-cron/1.0` sozinho não prova nada (qualquer um manda): ele vira a exceção `cron`, que
nunca dispensa o login. Continua assim.

**O que isso diz sobre ligar a regra.** Pelos 14 dias medidos, com tudo em `exigir`, seriam barradas 2
pessoas (as duas teriam sido liberadas com prazo), mais o robô e o aquecedor se não ganharem a marca de
máquina (§11), mais a consultora se usar o Reposições de fora.

---

## 3. Visão geral

```
 navegador ──login──▶ Supabase Auth (portal)        [abre de qualquer lugar]
     │
     ├─ POST central/rede (Bearer) ─▶ central ─▶ sentinela_srv_rede_decidir(ip, pessoa, portal)
     │      ◀─ {acao: seguir | observar | bloquear}     └─ grava em sentinela.rede_fora (se fora)
     │      bloquear → portal sai da sessão e mostra "só abre na rede da Lube"
     │
     ├─ clique no cartão ─ POST central/passe ─▶ srv_permissao + srv_rede_decidir(ip, pessoa, sistema)
     │      ◀─ passe (90 s)  ou  403 fora_da_rede
     │
     └─ GET sistema/?sentinela_passe=… ─▶ GUARDA 1.3.0 (Vercel, a cada pedido)
             lista da central (20 s): modo de rede, redes, liberados (hash do e-mail)
             x-real-ip dentro de uma rede?  liberado?  máquina?  →  segue | observa | 403
```

- **A central é a primeira barreira** (não dá passe; avisa o portal). **O guarda é a definitiva**: ele
  vê o IP pela Vercel, que o visitante não consegue forjar, e confere em todo pedido.
- **O portal só mostra.** Ele é estático e o dado dele vem do Supabase direto, então o que o portal faz
  é tirar a sessão e mostrar a página (§7). A proteção do dado do próprio portal (LUBE OFFICE) fica para
  a parte D (§13).

---

## 4. Banco (migração nova `sentinela_v2_rede`, arquivo `db/13_sentinela_rede.sql`)

Mesmas regras do `db/02_sentinela.sql`: sem `begin/commit` próprio (aplicar numa transação só), pode
rodar de novo (`if not exists`, `create or replace`, seeds sem duplicar), `search_path` fixo
(`sentinela, public, extensions, pg_temp`), toda `srv_*` começa com `perform sentinela.so_central()`,
toda função de painel começa com o `is_admin()`. **Nenhuma tabela ou função existente muda.**

### 4.1 Tabelas novas (RLS ligado, sem políticas)

```
sentinela.rede_config (1 linha; id boolean pk default true check (id))
  liberacao_max_dias   int not null default 30 check (liberacao_max_dias between 1 and 90)
  emergencia_pessoas   int not null default 3  check (emergencia_pessoas between 2 and 20)
  emergencia_horas     int not null default 2  check (emergencia_horas between 1 and 24)
  limpeza_em           timestamptz                 -- última limpeza de rede_fora
  atualizado_em        timestamptz not null default now(), atualizado_por text
  (só muda por SQL; o painel só lê)

sentinela.rede_sistemas  (modo de rede de cada sistema; sem linha = desligado)
  projeto_id   text primary key                    -- = sentinela.sistemas.projeto_id (não muda ao renomear o projeto)
  modo         text not null default 'desligado' check (modo in ('desligado','observar','exigir'))
  isento       boolean not null default false      -- SAC e Supervisor: fora da regra por decisão do Júlio
  modo_em      timestamptz, modo_por text
  check (not isento or modo = 'desligado')
  (sem FK para sentinela.sistemas de propósito: FK trava a tabela referenciada na criação; a junção é por projeto_id)

sentinela.redes  (as redes da Lube)
  id           bigint generated always as identity primary key
  rede         cidr not null
  descricao    text not null check (char_length(btrim(descricao)) between 3 and 120)
  origem       text not null default 'manual' check (origem in ('manual','sugestao','emergencia'))
  criado_em    timestamptz not null default now(), criado_por text not null
  removido_em  timestamptz, removido_por text
  check ((family(rede) = 4 and masklen(rede) >= 24) or (family(rede) = 6 and masklen(rede) >= 48))
  unique index redes_ativa_uk on (rede) where removido_em is null
  index gist (rede inet_ops) where removido_em is null
  ATIVA = removido_em is null.  Nada se apaga: remover = removido_em/removido_por.

sentinela.rede_liberacoes  (liberados fora da rede)
  id           bigint generated always as identity primary key
  user_id      uuid not null                       -- public.profiles.id (sem FK: o histórico fica se a conta sair)
  email        text not null check (email = lower(email) and email ~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$')
  inicio       timestamptz not null default now()
  fim          timestamptz not null
  motivo       text not null check (char_length(btrim(motivo)) between 5 and 300)
  criado_em    timestamptz not null default now(), criado_por text not null
  encerrado_em timestamptz, encerrado_por text
  check (fim > inicio and fim <= inicio + interval '90 days')
  index (user_id) where encerrado_em is null;  index (fim) where encerrado_em is null
  ATIVA = encerrado_em is null and inicio <= now() and fim > now() e perfil ativo.
  No máximo uma aberta (não encerrada e não vencida) por pessoa: a função de liberar encerra a anterior.

sentinela.rede_fora  (acessos de fora que a central viu: login no portal e pedido de passe)
  id           bigint generated always as identity primary key
  criado_em    timestamptz not null default now()
  ultimo_em    timestamptz not null default now()
  vezes        int not null default 1
  ip           inet                                -- null = a central não recebeu IP
  user_id      uuid, email text
  origem       text not null check (origem in ('portal','passe'))
  projeto      text not null                       -- 'painel-lube-distribuidora' no login do portal
  decisao      text not null check (decisao in ('bloqueado','observado','liberado'))
  liberacao_id bigint, ua text
  index (ultimo_em desc); index (ip, ultimo_em desc); index (user_id, ultimo_em desc)
  Junta repetição: mesma (ip, user_id, origem, projeto, decisao) com ultimo_em há menos de 10 min →
  vezes + 1 e ultimo_em = now(), sem linha nova. Linhas com mais de sentinela.config.retencao_dias (90)
  saem na limpeza diária (§4.3).
```

Os eventos do guarda continuam em `sentinela.eventos` (regras novas `fora_da_rede`, `rede_liberado` e
`rede_maquina`, §10). `rede_fora` existe porque o portal e o passe não passam pelo guarda: sem ela, quem é
barrado no portal não apareceria em "Tentativas de fora".

### 4.2 Ajudantes (schema `sentinela`, sem acesso pela API)

```
sentinela.rede_lube_valida(p text) returns cidr
  Igual a sentinela.rede_valida no estilo (erro 22023 com texto para a tela, prefixo 'sentinela: '), com:
  - IP sem máscara vira /32 (IPv4) ou /128 (IPv6); ::ffff:a.b.c.d vira IPv4;
  - bits de host ligados → erro com a forma certa ("use 203.0.113.0/24");
  - mais larga que /24 (IPv4) ou /48 (IPv6) → "rede ampla demais: incluiria outros clientes da
    operadora (mínimo /24 em IPv4 e /48 em IPv6)";
  - privada ou reservada (0/8, 10/8, 100.64/10, 127/8, 169.254/16, 172.16/12, 192.168/16, 224/4,
    240/4, ::/128, ::1/128, fc00::/7, fe80::/10, ff00::/8) → "é um IP interno da rede; cadastre o IP
    público, que aparece em <portal>/.sentinela/saude".
sentinela.rede_que_contem(p_ip inet) returns bigint     -- id da rede ativa mais específica que contém o IP, ou null
sentinela.email_hash(p text) returns text                -- encode(extensions.digest(lower(btrim(p)), 'sha256'), 'hex')
sentinela.guarda_tem_rede(p_versao text) returns boolean -- 'sentinela-guarda/X.Y.Z' com X.Y.Z >= 1.3.0
sentinela.rede_modo(p_projeto text) returns text         -- modo do sistema pelo nome (sem linha ou isento → 'desligado')
sentinela.liberacao_ativa(p_user_id uuid) returns sentinela.rede_liberacoes   -- ativa e perfil ativo, ou null
sentinela.rede_trava() returns boolean                   -- (v1.1) algum sistema ativo, não isento, em 'exigir'
sentinela.rede_afrouxa(p_acao text, p_dados jsonb) returns boolean   -- (v1.1) rede_nova, liberar, rede_modo ≠ exigir
sentinela.rede_acao_exec(p_email text, p_acao text, p_dados jsonb, p_ip text default null) returns jsonb
  -- (v1.1) o que as ações do painel fazem; sem porta nenhuma (nem service_role): só as duas funções de ação o chamam.
  -- p_ip (só pela central) vai no registro: acoes_admin.dados ganha "ip_admin".
```

### 4.3 Funções do servidor (só `service_role`; assinaturas EXATAS)

```
public.sentinela_srv_rede_lista(p_projeto text) returns jsonb        -- stable
  → {"v":1,"gerado_em":iso,"modo":"desligado|observar|exigir",
     "redes":["203.0.113.7/32", ...],                                -- todas as ativas, máx. 200
     "liberados":[{"h":"<64 hex>","ate":iso}]}                       -- máx. 500; [] quando modo = desligado
  modo = rede_sistemas.modo do sistema (pelo projeto_id de sentinela.sistemas.projeto = p_projeto e
  ativo); sistema desconhecido, inativo, sem linha ou isento → 'desligado'.
  Rede de segurança: modo 'exigir' sem nenhuma rede ativa sai como 'observar' (não tranca a empresa).
  "h" = sentinela.email_hash(email); "ate" = fim da liberação; só liberações ATIVAS de perfil ativo.

public.sentinela_srv_rede_decidir(p_ip text, p_user_id uuid, p_email text, p_projeto text,
                                  p_origem text, p_ua text) returns jsonb          -- volatile
  p_origem ∈ ('portal','passe') e p_projeto em sentinela.sistemas, senão 22023.
  → {"modo":"..","na_rede":bool,"rede":{"id":n,"descricao":".."}|null,
     "liberado":{"id":n,"ate":iso,"motivo":".."}|null,
     "acao":"seguir|observar|bloquear","ip":"..."|null,
     "emergencia":{"possivel":bool,"pessoas":n}|null}
  Regras, nesta ordem:
    modo desligado                          → seguir (não grava)
    IP dentro de uma rede ativa             → seguir (não grava)
    liberação ativa da pessoa               → seguir   (grava 'liberado')
    modo observar (ou exigir sem rede ativa)→ observar (grava 'observado')
    modo exigir                             → bloquear (grava 'bloqueado')
  IP nulo ou inválido = fora da rede. "emergencia" só vem para administrador ativo fora da rede: possivel
  = pelo menos rede_config.emergencia_pessoas OUTRAS pessoas ativas barradas ('bloqueado') deste mesmo IP
  nas últimas rede_config.emergencia_horas horas (rede_fora + eventos fora_da_rede bloqueados com
  identidade). Para quem não é admin, "emergencia" = null.
  Limpeza: se rede_config.limpeza_em tem mais de 1 dia, apaga de rede_fora o que passou de
  config.retencao_dias e grava limpeza_em (no máximo 5 mil linhas por vez).

public.sentinela_srv_rede_emergencia(p_ip text, p_user_id uuid) returns jsonb
  O botão de emergência do portal (§12). Confere, nesta ordem: perfil ativo e is_admin
  (senão {"ok":false,"motivo":"so_admin"}); IP válido e público ("ip_invalido"); IP fora das redes
  ("ja_cadastrada"); as mesmas provas do "emergencia.possivel" ("sem_provas", com "pessoas":n).
  Passou → insere a rede (/32 em IPv4, /64 em IPv6), origem 'emergencia', descricao
  'emergência: IP novo do escritório (N pessoas barradas)', criado_por = e-mail do admin; grava em
  sentinela.acoes_admin ('rede_emergencia', com as provas) → {"ok":true,"id":n,"rede":"x/32"}.

public.sentinela_srv_rede_acao(p_user_id uuid, p_ip text, p_acao text, p_dados jsonb) returns jsonb   -- (v1.1)
  O painel da Sentinela pela central (POST /rede com "acao", §5.3). Confere: perfil ativo e is_admin
  (senão {"ok":false,"codigo":"42501","erro":"sentinela: acesso restrito ao TI"}); se a ação afrouxa a regra
  (rede_afrouxa) e há sistema exigindo (rede_trava), o IP do pedido tem de estar numa rede ativa ou o admin
  ter liberação ativa (senão 42501 "sentinela: você está fora da rede da Lube: ..."). Passou → as mesmas
  ações de sentinela_rede_acao (§4.4), com o IP no registro. Recusa do executor (22023, P0002, 42501) volta
  como {"ok":false,"codigo":"<sqlstate>","erro":"sentinela: ..."}, sem gravar nada.
```

### 4.4 Funções do painel (`authenticated` + `is_admin()` na primeira linha)

```
public.sentinela_rede_painel(p_dias int default 14) returns jsonb   -- p_dias de 1 a 90
  {"agora":iso,"max_dias":30,
   "redes":[{"id","rede","descricao","origem","criado_em","criado_por","acessos":n,"pessoas":n,"ultimo":iso|null}],
   "sistemas":[{"projeto","projeto_id","nome","url","modo","isento","modo_em","modo_por","exige_login",
                "guarda_versao","guarda_rede":bool,"ultimo_ambiente","ultimo_sinal":iso|null,
                -- guarda_rede (v1.1) = 1.3.0 ou mais novo E último sinal da produção
                "fora":{"pessoas":n,"barrados":n,"observados":n,"liberados":n,"sem_regra":n}}],
   "liberacoes":[{"id","user_id","email","nome","inicio","fim","motivo","criado_em","criado_por",
                  "encerrado_em","encerrado_por","estado":"ativa|agendada|vencida|encerrada",
                  "entradas":n,"ultima_entrada":iso|null}],          -- abertas + as que acabaram em 30 dias, máx. 200
   "fora":[{"email"|null,"nome"|null,"user_id"|null,"ip","pais","regiao","cidade","projetos":[..],
            "vezes":n,"barrados":n,"observados":n,"liberados":n,"sem_regra":n,"primeiro","ultimo",
            "situacao":"barrado|seria_barrado|liberado|regra_desligada",
            "liberacao":{"id","fim"}|null,"pessoas_no_ip":n}],        -- por (pessoa, IP), último desc, máx. 300
   "sugestoes":[{"ip","pais","regiao","cidade","pessoas":n,"acessos":n,"dias":n,"primeiro","ultimo"}],  -- máx. 20
   "pessoas":[{"id","nome","email"}],                                -- perfis ativos (para o "Liberar pessoa")
   "contagens":{"exigir":n,"observar":n,"desligado":n,"isentos":n,"redes":n,
                "liberacoes_ativas":n,"barrados_24h":n,"pessoas_barradas_24h":n,
                "seriam_barrados_24h":n,"pessoas_seriam_24h":n,      -- (v1.1) observados em 24 h (fase de medir)
                "exigir_sem_guarda":n}}                              -- (v1.1) exigindo sem guarda_rede (Instant Rollback?)
  "fora" junta, na janela: (a) eventos com regra fora_da_rede ou rede_liberado; (b) eventos com identidade
  de pessoa (tem '@'; nome de robô fica de fora) cujo IP não está em nenhuma rede ativa (é a PRÉVIA: com a
  regra desligada, mostra quem seria pego — vira "regra_desligada"); (c) rede_fora. Local (país, UF,
  cidade) vem de sentinela.ips. "situacao" = a do acesso mais recente. "pessoas_no_ip" = pessoas
  distintas com login vistas desse IP na janela.
  "sugestoes": IPs fora de toda rede ativa com pelo menos 2 pessoas ativas distintas (login no portal em
  sentinela.identidades ou eventos com identidade) em pelo menos 2 dias diferentes da janela; sem saída
  Tor e sem bloqueio certo ativo; mais pessoas primeiro.
  Robô (nome sem '@') nunca entra em "fora" nem em "sugestoes".

public.sentinela_rede_acao(p_acao text, p_dados jsonb) returns jsonb
  Mesmo estilo de sentinela_acao: dados objeto JSON até 20 KB; erros prontos para a tela com prefixo
  'sentinela: ' (22023 validação, P0002 não encontrado); ação recusada não grava; ação aceita grava em
  sentinela.acoes_admin (email = auth.jwt()->>'email', acao abaixo, dados).
  (v1.1) Direto pelo banco o pedido chega sem o IP. Com algum sistema exigindo a rede (rede_trava), as ações
  que afrouxam a regra (rede_nova, liberar, rede_modo observar/desligado) dão 42501 "sentinela: com sistema
  exigindo a rede, cadastrar rede, liberar pessoa, observar e desligar passam pela central ...": o painel as
  manda por POST /rede (sentinela_srv_rede_acao, §4.3). Sem isso, a senha de um admin, de fora, desligaria a
  regra para ele mesmo (a casa como rede da Lube, liberar-se por 30 dias ou '*' desligado). Apertar
  (rede_remover, encerrar, rede_modo exigir) segue valendo aqui.
  'rede_nova'    {"rede":"ip ou cidr","descricao":"..","origem"?:"manual|sugestao"}
                 sentinela.rede_lube_valida; recusa rede ativa igual ou que já contém/está contida em outra
                 ativa ("já coberta pela rede #id") → {"ok":true,"id":n,"rede":".."}
  'rede_remover' {"id":n}  recusa remover a ÚLTIMA rede ativa enquanto algum sistema estiver em exigir
                 ("passe os sistemas para observar antes") → {"ok":true}
  'rede_modo'    {"projeto":"<nome do projeto>|*","modo":"desligado|observar|exigir"}
                 '*' = todos os sistemas ativos não isentos; (v1.1) em 'exigir', só os que exigem login: o
                 portal (exige_login = false) passa a exigir à parte, por último. Recusa: isento; projeto
                 inexistente (P0002); 'exigir' sem rede ativa; 'exigir' em sistema cujo guarda_versao não é
                 1.3.0 ou mais OU cujo último sinal não veio da produção (ultimo_ambiente; nulo conta como
                 antigo; a mensagem lista os sistemas que faltam; nada muda se um falhar). Sem exigir "sinal
                 recente": sistema pouco usado ficaria sem sinal no fim de semana.
                 Grava modo_em/modo_por → {"ok":true,"alterados":["projeto",...]}
  'liberar'      {"user_id":uuid,"fim":iso,"inicio"?:iso,"motivo":".."}
                 perfil existe e está ativo; e-mail do perfil em ASCII; inicio padrão now(), entre now()−5 min e
                 now()+30 dias; fim > now()+5 min; fim − inicio ≤ rede_config.liberacao_max_dias; motivo 5–300.
                 Liberação aberta da mesma pessoa é encerrada (encerrado_por = 'substituída por #<novo id>')
                 → {"ok":true,"id":n,"fim":iso,"substituida":id|null}
  'encerrar'     {"id":n}  aberta → encerrado_em/encerrado_por; já encerrada ou vencida → P0002 → {"ok":true}
  acoes_admin.acao: 'rede_nova', 'rede_remover', 'rede_modo', 'rede_liberar', 'rede_encerrar'.
```

### 4.5 Emergência por SQL (schema `sentinela`, só no SQL Editor)

```
sentinela.emergencia_rede(p_ip text, p_descricao text default 'emergência: IP novo do escritório') returns text
  rede_lube_valida + insere (origem 'emergencia', criado_por 'sql-emergencia') + acoes_admin.
  Devolve a frase "rede #id cadastrada: x/32 (vale em até 30 s)". (v1.1) IPv6 sem máscara vira o /64 dele
  (como o botão do portal): cada computador do escritório sai com um endereço próprio no mesmo prefixo.
sentinela.emergencia_pausar_rede() returns text
  todo 'exigir' vira 'observar' (modo_por 'sql-emergencia'); grava em acoes_admin a lista do que mudou
  (para voltar pelo painel). Devolve "N sistemas passaram de exigir para observar: ...".
sentinela.emergencia_liberar(p_email text, p_horas int default 12, p_motivo text default 'emergência: TI fora da rede') returns text
  liberação de até 72 h para um perfil ativo (para o TI chegar às telas de fora).
Cada uma recusa (42501) quando chamada pelos papéis da API (anon, authenticated, service_role), além do
revoke abaixo. São o "plano C" do §12.
```

### 4.6 Privilégios

```
revoke all on sentinela.rede_config, sentinela.rede_sistemas, sentinela.redes,
              sentinela.rede_liberacoes, sentinela.rede_fora from public, anon, authenticated;
revoke all on all sequences in schema sentinela from public, anon, authenticated;
revoke execute nos ajudantes e nas emergencia_* from public, anon, authenticated (emergencia_* também de service_role);
revoke execute on public.sentinela_srv_rede_lista(text), public.sentinela_srv_rede_decidir(text,uuid,text,text,text,text),
                  public.sentinela_srv_rede_emergencia(text,uuid), public.sentinela_srv_rede_acao(uuid,text,text,jsonb)
                  from public, anon, authenticated;
grant  execute nas quatro srv_rede_* to service_role;
revoke execute on sentinela.rede_acao_exec(text,text,jsonb,text) também de service_role (só as funções de ação o chamam);
revoke execute on public.sentinela_rede_painel(int), public.sentinela_rede_acao(text,jsonb) from public, anon;
grant  execute nas duas to authenticated;
```

### 4.7 Seeds

```
insert into sentinela.rede_config (id) values (true) on conflict do nothing;
insert into sentinela.rede_sistemas (projeto_id, isento) values
  ('prj_HnjGoS8pFCFCIDD17iz3nvQ1LoB1', true),   -- sac-lube
  ('prj_qq6Fj5E22JGIdPTVDrxDpJVDzBdn', true)    -- supervisor-lube
  on conflict (projeto_id) do update set isento = true, modo = 'desligado';
-- Reposições entra na central ANTES do primeiro deploy do guarda (lição do Trade, 2026-10-14):
insert into sentinela.sistemas (projeto_id, projeto, nome, url, sistema_slug, exige_login, arquivos_proibidos)
values ('prj_IjVNqbwMq19wyDsAE0mfJZ7r3OIJ', 'reposicoes-web', 'Reposições e Chamados',
        'https://reposicoes-web.vercel.app', 'reposicoes', true,
        array['^/db/', '^/servidor_local\.js$', '^/package(-lock)?\.json$'])
on conflict (projeto_id) do nothing;
```

A rede do escritório **não** entra na migração (§1). Registrar a linha do Reposições antes do guarda não
muda nada para ninguém: sem guarda (`ultimo_sinal` nulo) o `/passe` já devolve a URL sem passe.

### 4.8 Armadilha de operação: teste em transação com os guardas no ar

O teste roda no banco de produção dentro de `begin ... rollback`. Tudo o que a transação trava fica
travado até o `rollback`. Por isso a migração 13 **não tem `alter table` em tabela existente** e não
cria FK para elas. Mesmo assim, o teste:
- começa com `set local lock_timeout = '3s'` e `set local statement_timeout = '30s'`;
- tem de terminar em poucos segundos (sem `pg_sleep`, sem varrer `eventos` inteiro);
- roda em horário calmo (almoço ou depois das 18h) e de uma vez (migração + teste no mesmo `execute_sql`).

---

## 5. Central (Edge Function `sentinela`, versão 1.1.0)

Arquivos: `supabase/functions/sentinela/central.ts` e `http.ts` (o `index.ts` não muda). Testes em
`teste/central.test.ts` e `teste/http.test.ts`.

### 5.1 `/lista` leva o bloco `rede`
- Em paralelo com `srv_lista` e as chaves: `rpc('sentinela_srv_rede_lista', { p_projeto })`, com cache em
  memória de **10 s por projeto** (encerrar uma liberação chega aos guardas em até ~30 s: 10 s aqui +
  20 s da lista do guarda).
- Resposta: `{...srv_lista, chaves, rede}`. Se a RPC falhar ou vier fora do formato, a lista sai **sem**
  `rede` (o guarda mantém a última que recebeu, §6.2) e o log avisa uma vez por instância.
- Guardas antigos ignoram a chave `rede` (o `compilarLista` só lê as chaves que conhece).

### 5.2 `/passe` confere a rede
Depois do `srv_permissao` permitido e do e-mail resolvido, e **antes** do ramo `guarda_ativo`:

```
const rede = await decidirRede(ip, u.sub, email, projeto, 'passe', ua);   // null se a RPC falhar
if (rede && rede.acao === 'bloquear')
  return erro(403, 'fora_da_rede', 'Este sistema só abre na rede da Lube.', cors);
```

- Falha da RPC = segue e emite o passe (registra no log). Quem barra de verdade é o guarda.
- `observar` e liberado: passe normal (a RPC já gravou em `rede_fora`).

### 5.3 Rota nova `POST /rede` (navegador)
- `http.ts`: `ROTAS.rede = { metodo: 'POST', navegador: true }`. CORS, `Origin` do portal e
  `content-type: application/json` obrigatórios, como `/identidade`. Limitador 30/min por IP (/64 em IPv6).
- `Authorization: Bearer <access token do portal>`; perfil ativo conferido por
  `srv_permissao(sub, null)` (como `/identidade`): sem perfil ativo → 403 `perfil_inativo`.
- Corpo `{}` → `srv_rede_decidir(ip, sub, email, 'painel-lube-distribuidora', 'portal', ua)` →

```
200 {"ok":true,"modo":"exigir","na_rede":false,"acao":"bloquear",
     "liberado":null | {"ate":iso},
     "ip":"203.0.113.7",                       -- o IP do próprio usuário (a página de bloqueio não mostra)
     "emergencia":null | {"possivel":true,"pessoas":7}}     -- só para administrador
```

- Corpo `{"emergencia": true}` → `srv_rede_emergencia(ip, sub)` →
  `200 {"ok":true,"cadastrada":{"id":n,"rede":"203.0.113.7/32"}}` ou
  `403 {"erro":"so_admin"|"sem_provas"|"ja_cadastrada"|"ip_invalido","detalhe":"..."}`.
- (v1.1) Corpo `{"acao":"rede_nova|rede_remover|rede_modo|liberar|encerrar","dados":{...}}` → ação do painel
  da Sentinela: `srv_rede_acao(sub, ip, acao, dados)` (§4.3), com o IP do pedido e a pessoa do token (o corpo
  não escolhe nenhum dos dois) → `200 {"ok":true,"resultado":{...}}`, ou `403 {"erro":"acao_recusada",
  "codigo":"42501","detalhe":"sentinela: ..."}` (não admin, fora da rede), ou `400` com o mesmo formato (22023,
  P0002); ação desconhecida ou `dados` que não é objeto → `400 acao_invalida` sem chamar o banco; banco fora →
  `503 indisponivel`. O painel manda por aqui as ações que afrouxam a regra.
- Banco fora → `200 {"ok":true,"acao":"seguir","indisponivel":true}` (o portal segue; os guardas barram).
- IP do cliente: a mesma `ipCliente` de hoje (`cf-connecting-ip` → `x-real-ip` → 1º do `x-forwarded-for`).
  **Antes do modo observar, provar que o Supabase sobrescreve um `cf-connecting-ip` forjado** (§15.4,
  pendência antiga da invariante 2). Se não sobrescrever, trocar a leitura antes de seguir.

### 5.4 O resto
- `VERSAO = '1.1.0'`. Nada muda em `/sessao`, `/evento`, `/identidade`, `/tentativa` nem na IA.
- O portal chama `/identidade` só depois de um `/rede` que não mandou bloquear (§7.1): login de fora
  barrado não deixa o IP "confiável".

---

## 6. Guarda 1.3.0 (`guarda/sentinela-guarda.ts`)

### 6.1 Contrato novo
```ts
export const VERSAO = 'sentinela-guarda/1.3.0';
type Opcoes = {
  identidade?: { email: string; origem: 'sessao_app'; maquina?: boolean };   // maquina: novo
  fechado?: Fechado | null;
};
```
- `maquina: true` só vale com `origem 'sessao_app'` e nome de robô no formato da central
  (`/^rob[oô] [a-z0-9 ()._-]{3,80}$/`, testado em minúsculas). E-mail de pessoa com `maquina: true` não é
  máquina. Quem marca é o app, **depois** de conferir o segredo dele (§11).

### 6.2 Lista
- `compilarLista` lê `d.rede`: `modo` (desconhecido → `observar`), `redes` (cada uma por `lerRede`;
  inválida é ignorada), `liberados` (`h` com 64 hex, `ate` ISO → mapa `h → ate ms`; no máx. 500).
  Guarda também `em` (quando chegou) e `vazia` (nenhuma rede válida).
- Lista nova **sem** `rede` (central antiga ou RPC fora): usa a última `rede` recebida, se tiver menos
  de **24 h** (variável do módulo `ultimaRede`); senão, sem regra de rede.
- Lista de reserva do modo fechado (partida a frio com a central fora): sem regra de rede (§17).

### 6.3 Onde a regra entra
Ordem do 1.2.0, com o passo novo no fim (só decide quem **ia passar**):

```
ataque certo → lista → arquivo proibido → exceções → buscador/robô/não navegador
→ passe (troca; a rede é conferida na troca, §6.5) → sem_login → REDE (novo) → segue
```

```
regraRede(lista, ip, ev, maquina, caminho):
  r = lista.rede; se não há r, ou r.modo = 'desligado', ou caminho começa com '/.sentinela/' → nada
  se o IP está em r.redes → nada (dentro da rede; nem registra)
  se não há identidade e o sistema não tem slug → nada (o portal: a tela de login abre). (v1.1) Num sistema
     com slug, sem login também passa pela regra, mesmo com "exige login" desligado
  modo = r.modo; se modo = 'exigir' e r.vazia → modo = 'observar'
  se a lista tem mais de 2 min → espera a renovação (v1.1: até 2,5 s, o prazo da central) e decide com a nova
  se maquina → liberado, regra 'rede_maquina' (ou mantém 'cron' se a exceção já marcou), motivo
               '... · fora da rede da Lube: máquina autenticada pelo sistema'
  se identidade e liberados[sha256(minúsculas(email))] > agora, com lista de até 2 min
             → liberado, regra 'rede_liberado', motivo 'fora da rede da Lube · liberado pelo TI até <iso>'
  modo 'exigir'  → 403 (§6.4), bloqueado, regra 'fora_da_rede', motivo 'fora da rede da Lube'
  modo 'observar'→ segue, observado, regra 'fora_da_rede', motivo 'seria bloqueado: fora da rede da Lube'
```

- **IP vazio ou inválido = fora.**
- **Nunca** preenche o mapa local de bloqueio, nunca pede bloqueio à central, nunca toca no cookie.
- O hash do e-mail usa `crypto.subtle.digest('SHA-256')` com cache por lista (máx. 500).
- Se já havia um suspeito observado (ex.: bloqueio suspeito da lista com login), a regra do evento é a da
  rede e a outra vai no motivo (`· também lista: ...`), para "Tentativas de fora" não perder o acesso.
- Rede confiável (`confiaveis`) **não** dispensa a regra de rede.

### 6.4 O que acontece em cada modo

| situação (pedido que ia passar) | desligado | observar | exigir |
|---|---|---|---|
| `/.sentinela/*` (saúde) | segue | segue | segue |
| IP numa rede da Lube | segue | segue | segue |
| fora, máquina autenticada pelo sistema | segue | segue · `rede_maquina` | segue · `rede_maquina` |
| fora, pessoa liberada (lista de até 2 min) | segue | segue · `rede_liberado` | segue · `rede_liberado` |
| fora, pessoa com sessão ou login do app, sem liberação | segue | segue · observado `fora_da_rede` | **403** · bloqueado `fora_da_rede` |
| fora, sem login, sistema fechado, rota protegida | 302/401 `sem_login` (antes da rede) | igual | igual |
| fora, sem login, rota pública de sistema fechado | segue | segue · observado | **403** |
| fora, sem login, sistema com slug e "exige login" desligado (v1.1) | segue | segue · observado | **403** |
| fora, sem login, sistema sem slug (portal) | segue | segue (sem registro de rede) | segue |
| `exigir` com lista de redes vazia | — | — | vira observar (não tranca ninguém) |

Respostas do 403 de rede:
- **Página** (GET/HEAD de página, inclusive dentro do iframe do portal): HTML do §9.1. Cabeçalhos:
  `cache-control: no-store`, `x-robots-tag: noindex`, `x-sentinela: rede`, `x-content-type-options:
  nosniff`, `referrer-policy: no-referrer`, a CSP da página de bloqueio de hoje.
- **API, arquivo e outros métodos**: `403 {"erro":"fora_da_rede","mensagem":"Este sistema só abre na rede
  da Lube. Este aparelho não está na rede da Lube. Se precisa acessar de fora, fale com o TI.","portal":"<portal>"}`.
- Sem código de incidente e sem IP (o TI acha a pessoa em "Tentativas de fora").

### 6.5 Troca do passe fora da rede
A troca continua igual até a central devolver a sessão. Com o e-mail em mãos, o guarda roda a regra:
- `exigir` e não liberado → **403 página**, sem `Set-Cookie` de sessão (e sem a marca de falha); evento
  bloqueado `fora_da_rede`, motivo `fora da rede da Lube · passe trocado, sessão não entregue`. Só
  acontece se o passe foi pego dentro e usado fora em 90 s, ou se a central viu outro IP.
- `observar` ou liberado → 302 com o cookie, como hoje; evento com a regra de rede e o motivo
  `... · entrada pelo Painel Lube`.

### 6.6 Saúde
`/.sentinela/saude` ganha `lista.rede`: `"lista": {"ok", "idade_s", "modo", "rede": "desligado|observar|exigir"|null,
"rede_idade_s": n|null}` (só o modo e, v1.1, a idade do bloco em segundos; nunca as redes nem os liberados).
`rede_idade_s` acima de ~120 com `idade_s` pequeno = a central está mandando a lista sem o bloco (central
antiga, `srv_rede_lista` falhando) e o guarda segue com o último (até 24 h). O Guardião aceita as chaves a
mais (lê só `guarda`, `oidc` e `lista.ok/idade_s/modo`). Continua respondendo de qualquer lugar e antes de tudo: é por ele que o TI
descobre o IP de onde está (campo `ip`) e que o Guardião confere os sites.

### 6.7 Compatibilidade
- Lista sem `rede` ou com `modo: 'desligado'` → **mesmo resultado do 1.2.0 em todos os casos** (a
  bateria atual inteira tem de passar sem mudar nenhuma expectativa, fora a versão e a lista de chaves de
  `lista` no teste da saúde, que ganha `rede`).
- Sem dependência nova; continua rodando em nodejs, edge e no middleware do Next (o Edge Runtime tem
  `crypto.subtle.digest`).
- O núcleo é o mesmo arquivo em todos os sistemas (SHA-256 igual em todos, como no 1.1.0 e no 1.2.0).

---

## 7. O login no portal fora da rede

### 7.1 Fluxo
1. A tela de login abre de qualquer lugar (o guarda do portal não barra quem não tem login; o atalho do
   SAC continua ali).
2. Login no Supabase Auth, como hoje. Perfil carregado e ativo.
3. **Antes** de qualquer outra coisa (antes do `?voltar=office`, de `mostrarPortal()`, de `/identidade`
   e de buscar os sistemas): `POST /rede` com prazo de 3 s.
   - `bloquear` (não admin, ou admin sem provas de emergência) → `sb.auth.signOut()` e
     `location.replace('/fora-da-rede.html?de=painel')`. Nada do painel carrega. Sem sessão, o LUBE
     OFFICE e o admin também não abrem (eles mandam para o login).
   - `bloquear` com `emergencia.possivel` (só admin) → cartão de emergência (§12.2), sem sair da sessão.
   - `observar` → segue normal, sem aviso (é fase de observação).
   - `seguir` com `liberado` → segue e mostra o aviso discreto "Acesso de fora da empresa liberado pelo TI
     até 30/10, 18:00." (horário de Brasília).
   - `seguir` dentro da rede → normal.
   - Falha, tempo ou `indisponivel` → segue (os guardas barram nos sistemas).
4. Clique num cartão → `/passe`:
   - `403 fora_da_rede` (o portal está em observar, mas o sistema já exige; ou a pessoa saiu da rede com
     o portal aberto) → nova aba vai para `/fora-da-rede.html?de=sistema`; no painel, cartão com o mesmo
     texto; no iframe do BI, `src = '/fora-da-rede.html?de=sistema'`.
5. `?abrir=<slug>` (veio de um sistema fechado) → mesmo tratamento do clique.
6. Sistema aberto direto (favorito, link) sem passar pelo portal: o guarda decide sozinho (§6).

### 7.2 Outras telas do portal
- `admin.html`: depois de conferir que é admin, `POST /rede`; `bloquear` → mesma saída do 7.1.
- `sentinela/`: igual, depois da sessão e depois do login próprio do painel.
- `office/`: fica para a parte D (§13). Até lá o Office só abre com uma sessão que passou pelo 7.1 — a
  exceção é o notebook que entrou na empresa e foi para casa com a sessão guardada no navegador e abre
  `/office/` direto (o portal, `admin.html` e `sentinela/` pegam esse caso; o Office não). A sessão do
  Supabase no navegador dura semanas (o refresh token não tem o limite de 8 h): com o portal em exigir, o
  Office continuaria abrindo de casa, lendo, editando e enviando documentos. **Por isso o portal só passa a
  exigir (passo 8c) depois da parte D**: no mínimo `LubeRede.verificar(token)` logo depois do `getSession`
  do `office/comum.js` (e `LubeRede.sair(sb, 'painel')` se vier `bloquear`), no mesmo envio; e, antes de
  dizer ao gestor que o painel está fechado, a Edge Function `office` conferindo a rede no servidor (com a
  exceção do motor da `SRV-IA`, pelo segredo dele).

### 7.3 Peça comum: `rede.js` (raiz do portal)
```js
window.LubeRede = {
  // POST central/rede; resolve com a resposta ou null (central fora/tempo). Nunca rejeita.
  verificar(token, ms = 3000) → Promise<{acao, modo, na_rede, liberado, ip, emergencia} | null>,
  // sai da sessão e vai para a página de bloqueio (de: 'painel' | 'sistema' | 'admin' | 'sentinela')
  sair(sb, de),
  // texto do aviso de liberado, em Brasília
  textoLiberado(ateIso) → 'Acesso de fora da empresa liberado pelo TI até 30/10, 18:00.',
  // botão de emergência (só admin): POST /rede {"emergencia": true}
  cadastrarEmergencia(token) → Promise<{ok, cadastrada?, erro?, detalhe?}>,
  // (v1.1) ação do painel da Sentinela pela central: POST /rede {"acao", "dados"}. Nunca rejeita.
  acao(token, nome, dados) → Promise<{ok:true, resultado} | {ok:false, erro, codigo, detalhe}>,
};
```
Em `localhost` (só lá), `localStorage['lube-rede-demo'] = 'bloquear' | 'liberado' | 'emergencia'`
simula a resposta, para conferir as telas sem a central.

---

## 8. Telas (painel da Sentinela › módulo novo "Rede da Lube")

Módulo `rede` no menu lateral (grupo "Proteger", depois de "Redes confiáveis"), com selo = pessoas
barradas nas últimas 24 h (v1.1: sem nenhum sistema exigindo, as que seriam barradas). Só administrador
(as RPCs exigem `is_admin()`). Lê `sentinela_rede_painel(p_dias)` ao entrar, depois de cada ação e a cada
60 s com a aba visível; as ações vão por `sentinela_rede_acao` (apertar) ou, v1.1, pela central com
`LubeRede.acao` (rede nova, liberar, observar, desligar: §4.4). Depois de cadastrar ou remover uma rede, a
linha "Você está em ..." pergunta de novo à central. Visual, números, horas e escape de todo dado de visitante como no resto do
painel (§5 da especificação). Componentes que já existem: cartão, KPI, tabela que vira cartões até 820 px,
pílula, modal, toast.

**Topo do módulo**: 3 KPIs — "Sistemas exigindo a rede" (`n de 12`; em vermelho com "N sem o guarda 1.3.0"
quando `exigir_sem_guarda` > 0), "Liberados agora", "Barrados em 24 h" (pessoas · tentativas; v1.1: sem
nenhum sistema exigindo, "Seriam barrados em 24 h"). Linha "Você está em `<ip>` — rede da Lube: Escritório" ou "fora da rede",
vinda de `LubeRede.verificar`. Três abas:

### 8.1 Aba "Redes e sistemas"
- **Redes da Lube**: Rede (mono) · Descrição · Origem (manual / sugestão / emergência) · Cadastrada (data
  · quem) · Uso em 14 dias (acessos · pessoas) · Remover. Botões "Adicionar rede" (modal: IP ou faixa +
  descrição; aviso âmbar quando for mais larga que /32: "inclui outros clientes da operadora") e
  "Adicionar a rede de onde estou" (só quando "você está fora" e o IP é público; pré-preenche; IPv6 com o /64).
  Remover a rede de onde o admin está mostra o aviso em vermelho "É a rede de onde você está agora".
- **Parece rede da Lube** (`sugestoes`, só se houver): "177.x.x.x — Cariacica-ES · 3 pessoas · 5 dias ·
  último há 2 h" com o botão **"Isto é uma rede da Lube?"** → modal com as provas (pessoas, dias,
  horários, cidade) e "Sim, é da Lube" (`rede_nova`, origem `sugestao`) ou "Não" (some só neste
  navegador).
- **Modo por sistema**: Sistema · Guarda (versão; "precisa do 1.3.0" em âmbar) · Modo (três botões:
  Desligado / Observar / Exigir) · Fora da rede em 14 dias (pessoas · barradas · seriam barradas) · Desde
  (data · quem). SAC e Supervisor aparecem cinza: "fora da regra (usado na rua)". Botões "Todos em
  observar" e "Todos em exigir (menos o portal)". (v1.1) Guarda 1.3.0 com o último sinal de uma prévia:
  "sinal de prévia" em âmbar (o exigir fica travado); sistema em exigir sem guarda que confere: "exigindo
  sem conferir" em vermelho.
- Passar para **Exigir** abre um modal vermelho: quem foi visto fora da rede naquele sistema em 14 dias,
  as liberações ativas e "Exigir a rede em <sistema>". A recusa do banco (sem rede, guarda velho) vira
  toast com o texto dele. No Painel Lube, o modal avisa que o LUBE OFFICE ainda não confere a rede.

### 8.2 Aba "Liberados fora da rede"
- Botão **"Liberar pessoa"**: modal com Pessoa (busca nos perfis ativos: nome — e-mail), Até (data e hora;
  atalhos Hoje 23:59, 3 dias, 7 dias, 30 dias), Começa (agora ou data), Motivo (obrigatório). Rodapé:
  "Máximo de 30 dias. Cada entrada de fora fica registrada."
- Ativas e agendadas: Pessoa · Desde · Até ("vence em 2 dias" em âmbar) · Motivo · Liberado por · Entradas
  de fora (n · última, cidade) · Encerrar (confirmação).
- O aviso de "liberada" diz: "Vale nos sistemas em até 1 minuto: peça para a pessoa esperar e recarregar."
- "Encerradas e vencidas (30 dias)", recolhida.

### 8.3 Aba "Tentativas de fora"
- Filtros: período (24 h / 7 d / 14 d / 30 d), situação (todas / barrado / seria barrado / liberado /
  regra desligada), sistema, busca.
- Por pessoa e IP: Pessoa (nome e e-mail, ou "sem login") · Local (bandeira, cidade/UF) · IP · Sistemas
  (chips; o portal é "Painel") · Vezes · Último (há X) · Situação (pílula: ⛔ Barrado / 👁 Seria barrado /
  ✓ Liberado até 30/10 / — Regra desligada) · Ações: **"Liberar esta pessoa"** (abre o modal do 8.2 já
  preenchido) e **"Isto é uma rede da Lube?"** (quando `pessoas_no_ip` ≥ 2; com 1 pessoa fica no menu
  "mais").
- Vazio: "Ninguém de fora da rede neste período." Com tudo desligado, o título vira "Prévia: quem seria
  pego se a regra estivesse ligada" (é a linha "regra_desligada").

### 8.4 Visão geral
Chip ao lado da pílula de modo: "REDE · EXIGINDO 11/12" (verde), "REDE · OBSERVANDO" (âmbar), "REDE ·
DESLIGADA" (cinza). Clique leva ao módulo. Lê `sentinela_rede_painel(1)` ao abrir e a cada 5 min.

### 8.5 Demonstração
`sentinela/demo.js` responde `sentinela_rede_painel` e `sentinela_rede_acao` com dados fictícios (IPs dos
blocos de documentação, pessoas inventadas) e com as mesmas chaves do SQL, e o `rede.js` simulado
(§7.3). Conferir em `http://localhost:4321/sentinela/?demo=1#rede`, nos dois temas, em 375 px e em 1440 px.

---

## 9. Página de bloqueio

### 9.1 No guarda (dentro de cada sistema, `paginaForaDaRede(portal)`)
Mesmo visual da página de bloqueio de hoje (fundo `#050b1c`, cartão `#0d1830`), com ícone âmbar (não é
ataque) e **sem código e sem IP**:

```
<title>Fora da rede da Lube · Sentinela Lube</title>
[ícone: prédio com sinal riscado, âmbar #ffb340]
Este sistema só abre na rede da Lube                    (h1)
Este aparelho não está na rede da Lube.
Se precisa acessar de fora, fale com o TI: <e-mail do TI, o mesmo da página de bloqueio de hoje>
(menor) Na Lube, use o Wi-Fi da empresa (no celular, desligue os dados móveis e a VPN) e recarregue a
página. Se o TI acabou de liberar você, espere 1 minuto e recarregue.
[ Voltar ao Painel Lube ]  → <portal>/
Lube Distribuidora · Sentinela
```
O `portal` vem da lista (já validado como `https://...`) e é escapado.

Texto decidido pelo Júlio em 2026-10-26: "Este aparelho não está na rede da Lube" (no lugar de "Você está
fora da empresa", que era falso para quem está na Lube no 4G, com VPN, com a Retransmissão Privada do iCloud
ou com a "rede segura" do Edge, §17.4, e para o escritório inteiro quando a operadora troca o IP, §12). O
mesmo texto vai no guarda, no `fora-da-rede.html` e no aviso do `rede.js`.

### 9.2 No portal (`fora-da-rede.html`, estático, na raiz)
O mesmo texto, no visual do portal. `?de=painel` troca o título para "O Painel Lube só abre na rede da
Lube"; os outros valores (`sistema`, `admin`, `sentinela`) ficam com "Este sistema só abre na rede da
Lube". Valor desconhecido = "sistema". O parâmetro nunca vai para o HTML: é só uma escolha entre textos
fixos. Botões "Voltar ao Painel Lube" (`/`) e "Falar com o TI" (o mesmo contato do rodapé do portal).
`noindex`. Abre sem sessão (o portal já saiu dela).

---

## 10. Eventos e o que o painel mostra

| regra | decisão | quando | motivo gravado |
|---|---|---|---|
| `fora_da_rede` | `bloqueado` | exigir, fora, sem liberação | `fora da rede da Lube` (+ `· passe trocado, sessão não entregue`) |
| `fora_da_rede` | `observado` | observar, fora, sem liberação | `seria bloqueado: fora da rede da Lube` |
| `rede_liberado` | `liberado` | fora, com liberação | `fora da rede da Lube · liberado pelo TI até <iso>` |
| `rede_maquina` | `liberado` | fora, máquina autenticada (sem exceção de UA) | `fora da rede da Lube: máquina autenticada pelo sistema` |
| `cron` | `liberado` | robô do Gestão TI (já é assim) | `agendamento da Vercel · fora da rede da Lube: máquina autenticada pelo sistema` |

- As três regras novas cabem no formato que o banco aceita (`^[a-z_]{1,40}$`) e caem no risco base 0
  (`else 0`); com identidade o risco fica 0. Não vão para a IA, não entram em rajada nem em bloqueio
  automático.
- Painel (`sentinela/util.js`, `REGRAS`): `fora_da_rede` "Fora da rede da Lube", `rede_liberado` "Fora da
  rede · liberado pelo TI", `rede_maquina` "Fora da rede · máquina autenticada".
- Feed: rótulos "FORA DA REDE" (vermelho se barrado, âmbar se observado), "FORA · LIBERADO" (azul),
  "FORA · MÁQUINA" (cinza-azul). "ROBÔ VERIFICADO" do agendador continua igual.
- Quem está acessando: o visitante barrado ou observado pela rede fica "Observado", com
  `status_motivo = fora_da_rede` ("seria bloqueado: Fora da rede da Lube"). É o comportamento atual de
  `sentinela_painel` para acesso barrado na janela; não muda nada no SQL dele.
- Entradas vistas só pela central (portal e passe) ficam em `rede_fora` e aparecem só no módulo "Rede da
  Lube".

---

## 11. Quem sempre passa (e por que nada mais)

| quem | como prova | o que muda |
|---|---|---|
| Guardião e qualquer um em `/.sentinela/*` | rota tratada antes de tudo; não mostra dado | nada (o Guardião troca a rota do Reposições para `/.sentinela/saude`, §14) |
| Robô do Gestão TI (agendador da Vercel, 08:29 e 09:27) | `Authorization: Bearer <CRON_SECRET>` conferido pelo `src/middleware.ts` do app, em tempo constante, só em `/api/cron/` | `ROBO_AGENDADOR` ganha `maquina: true` (mesmo commit do guarda 1.3.0) |
| Aquecedor do Reposições (`SRV-IA`, 5 em 5 min) | segredo novo `AQUECEDOR_SEGREDO` (48 hex, mínimo 32) no cabeçalho `x-lube-aquecedor`, conferido pelo `middleware.ts` do Reposições em tempo constante, só em `GET /api/dados` | identidade `robo do reposicoes (aquecedor da srv-ia)` com `maquina: true` (§14.2) |
| Qualquer pessoa num IP de `sentinela.redes` | IP visto pela Vercel (`x-real-ip`) | — |
| Pessoa liberada | sessão do passe ou login do app + hash do e-mail na lista | — |

**Não é exceção, de propósito:**
- user-agent `vercel-cron/...` sozinho (forjável): continua só vendo o login ou o 401;
- IP da Amazon, da Vercel ou de qualquer nuvem: o robô muda de IP todo dia, e liberar uma nuvem liberaria
  qualquer um que alugue uma máquina lá;
- cabeçalho que o cliente escolhe (`x-forwarded-for`, `x-real-ip` mandado pelo cliente, `cf-connecting-ip`
  para a Vercel, `referer`, `origin`): a Vercel sobrescreve `x-real-ip`; os outros não são lidos para isso;
- `sentinela.confiaveis`: aprendida por login, inclusive de casa.

A `SRV-IA` não ganha passe livre por IP: se a saída dela for o IP do escritório, ela já está "dentro";
se não for, o aquecedor entra pelo segredo, e nenhum outro programa dela usa os sistemas da Vercel.

---

## 12. Emergência: o IP do escritório mudou

Sintoma: de repente, todo mundo do escritório vê "só abre na rede da Lube" e o portal sai da sessão. Causa
provável: a operadora trocou o IP, ou a internet caiu para outro link.

### 12.1 Passo a passo pelo SQL (sempre funciona)
1. Num computador do escritório, abra `https://painel-lube-distribuidora.vercel.app/.sentinela/saude`. O
   campo `ip` é o IP novo (essa rota responde sempre, de qualquer lugar).
2. Supabase › projeto **PAINEL LUBE DISTRIBUIDORA** › **SQL Editor** (o login do Supabase não depende da
   rede da Lube) e rode, trocando o IP:
   ```sql
   select sentinela.emergencia_rede('<IP_NOVO>', 'escritório: IP novo da operadora');
   ```
   **IPv6** (o `ip` tem `:`): cole o endereço como veio; a função cadastra o **/64** inteiro (ex.:
   `2001:db8:1:2::15` vira `2001:db8:1:2::/64`), porque cada computador sai com um endereço próprio.
3. Espere até 30 s e recarregue. As sessões de 8 h continuam valendo; quem saiu do portal entra de novo.
4. Não deu para achar o IP (várias saídas, link instável)? Pause a regra em todos:
   ```sql
   select sentinela.emergencia_pausar_rede();     -- exigir → observar em todos; volta pelo painel
   ```
5. Se a função der erro (apagada ou com defeito), as linhas cruas (em IPv6, o prefixo com o fim zerado,
   como `2001:db8:1:2::/64`). Sem a migração aplicada não existe regra de rede, e não há nada a destravar:
   ```sql
   insert into sentinela.redes (rede, descricao, origem, criado_por)
   values ('<IP_NOVO>/32', 'escritório: IP novo', 'emergencia', 'sql-emergencia');
   update sentinela.rede_sistemas set modo = 'observar', modo_em = now(), modo_por = 'sql-emergencia'
    where modo = 'exigir';
   ```
6. Depois: em "Tentativas de fora", confira quem foi barrado; remova a rede velha se ela não existe mais;
   registre no cérebro; peça à operadora o IP fixo.
7. TI de fora e precisando das telas:
   `select sentinela.emergencia_liberar('<e-mail do TI>', 12);` (até 72 h).

### 12.2 O botão pronto (sem SQL)
Quando o IP muda em horário de expediente, várias pessoas são barradas do mesmo IP novo em minutos. O
desenho usa isso como prova:
- `srv_rede_decidir` devolve `emergencia.possivel = true` para um **administrador** fora da rede quando
  pelo menos **3 outras pessoas ativas** foram **barradas** desse mesmo IP nas **últimas 2 horas**.
- O portal mostra ao admin, em vez da página: "Você está fora da rede da Lube. 7 pessoas da Lube foram
  barradas deste mesmo endereço na última hora. Se o IP do escritório mudou: [Cadastrar este endereço como
  rede da Lube]". O clique chama `/rede {"emergencia": true}`; a central pega o IP do próprio pedido e o
  banco confere tudo de novo (`srv_rede_emergencia`). Registro em `acoes_admin`.
- Por que é seguro: com a senha de um admin, um invasor de fora ainda precisaria de 3 outras contas da
  Lube barradas do IP dele. O IP vem do pedido (não do corpo) e só entra como /32 (ou /64).
- (v1.1) Esse argumento só vale porque o botão é o **único** jeito de afrouxar de fora: na v1, a mesma senha
  de admin chamava `sentinela_rede_acao` direto pelo banco (console ou curl) e cadastrava a casa como rede,
  liberava a si mesma por 30 dias ou punha tudo em desligado, sem botão nenhum. Agora essas ações só passam
  pela central, que confere o IP (§4.4). O que continua valendo com a senha de um admin de fora está em §17.1.
- Sem provas (ex.: madrugada, ninguém tentou) → página normal; vale o 12.1.

### 12.3 Prevenção
- Confirmar com a operadora que o IP do escritório é **fixo** e se há link reserva; cadastrar os IPs de
  todos os links e locais **antes** do exigir (o modo observar mostra os que faltam).
- O card "Parece rede da Lube" mostra um IP novo com várias pessoas antes de virar problema.

---

## 13. Plano de publicação

Nada vai ao ar sem o Júlio autorizar. Cada passo só começa com o anterior conferido. **A numeração é a do
roteiro (§20)**: "passo N" é sempre o §20; esta tabela é o resumo dele.

| passo (§20) | o quê | muda algo para alguém? | quem |
|---|---|---|---|
| 0 | Pré-requisitos: (a) prova da invariante 2 na central e prova de que o `x-real-ip` não é forjável na Vercel (§20.2); (b) o TI levanta os IPs públicos de cada local e link (galpão, Wi-Fi, link reserva, empresas do grupo) abrindo `/.sentinela/saude` de lá; (c) Júlio decide a consultora, o prazo e o aquecedor (§18) | não | Claude principal + Júlio |
| 1 | Banco: teste em transação (`begin; 13; 13_teste; rollback;`) e depois `apply_migration sentinela_v2_rede`; conferir o md5 aplicado | não (tudo desligado) | Claude principal |
| 2 | Central 1.1.0 (`deploy_edge_function`, `verify_jwt=false`, `import_map_path: "deno.json"`); `/saude`, `/lista` com `rede.modo = desligado`, `/rede` respondendo | não | Claude principal |
| 3 | Portal: guarda 1.3.0 na raiz e as telas (portal, admin, Sentinela), preview → produção | não | Claude principal, com push autorizado |
| 4 | Guarda 1.3.0 nos 10 sistemas internos, um por um; Gestão TI com `maquina: true`. `/.sentinela/saude` de cada um: `guarda 1.3.0`, `rede: "desligado"`, `lista.ok` | não | Claude principal, com push autorizado |
| 5 | Reposições ganha o guarda (§14.2), com os usuários avisados antes | **sim: o Reposições passa a pedir o login do Painel** | Claude principal + Júlio |
| 6 | O TI cadastra a rede do escritório e as outras do passo 0 | não | TI |
| 7 | **Observar** em todos (Todos em observar), com o OK do Júlio. Pelo menos 5 dias úteis e um fim de semana (o que conferir: §20.9) | não barra nada | Júlio decide |
| 8 | **Exigir**, só com o OK do Júlio e com os funcionários avisados: 8a um sistema pequeno por 1 dia (Movimentação de Inventário), 8b os outros sistemas, **8c o portal só depois da parte D** | sim | Júlio decide |
| D | LUBE OFFICE: `office/comum.js` chama `LubeRede.verificar` logo depois do `getSession` (e sai da sessão se vier `bloquear`), e a Edge Function `office` confere a rede no servidor (exceto as chamadas do motor da `SRV-IA`, que têm o segredo próprio). **Condição do 8c** | sim, no Office | antes do 8c |

Volta atrás em qualquer passo: Todos em observar (ou desligado) pelo painel, ou
`select sentinela.emergencia_pausar_rede();`. O guarda 1.3.0 com modo desligado não precisa sair. **Essa
volta só chega aos guardas com a central 1.1.0 no ar e o `srv_rede_lista` respondendo** (§20.4): nunca volte a
central para antes da 1.1.0 com algum sistema fora de `desligado`, e, com o `srv_rede_lista` falhando, a volta
é o Instant Rollback de cada sistema para o deployment 1.2.0 anotado.

---

## 14. Repositórios e o que muda em cada um

### 14.1 Tabela
Caminhos a partir de `Desktop\BI\`. "Guarda" = copiar o `guarda/sentinela-guarda.ts` 1.3.0 por cima do
arquivo indicado, sem mudar mais nada. Commits só com os arquivos da mudança (há repositórios com arquivos
do Júlio sem commit). Se o deploy pelo Git der `BLOCKED`, publicar pela API com o mesmo commit (como em
2026-10-06).

| sistema (projeto Vercel) | pasta / repositório | arquivo do guarda | além do guarda |
|---|---|---|---|
| Portal (`painel-lube-distribuidora`) | `1. PAINEL LUBE DISTRIBUIDORA` / PAINEL-LUBE-DISTRIBUIDORA | `sentinela-guarda.ts` (raiz; hoje **1.1.0**) | partes A, B e C (§16). Há trabalho do Office sem commit (`office/`, `db/12_office_agenda.sql`, `supabase/functions/office/`): não entra nos commits da rede |
| BI Compras (`painel-compras`) | `6. COMPRAS` / COMPRAS | `web/sentinela-guarda.ts` | nada (7 arquivos do Júlio sem commit: ficam fora) |
| BI Comercial (`gestao-comercial-web`) | `8. COMERCIAL` / GESTAO-COMERCIAL | `web/sentinela-guarda.ts` | nada |
| Gestão Financeiro (`gestao-finaceiro`) | `7. GESTÃO FINANCEIRO` / GESTAO-FINACEIRO | `web/sentinela-guarda.ts` | nada |
| RH (`rh-absentismo`) | `4. RH\GESTAO-RH` / GESTAO-RH | `sentinela-guarda.ts` (raiz) | nada. A pasta `ABSENTEÍSMO RH - DASHBOARD` não é repositório (cópia velha 1.1.0): não mexer |
| Saída de Veículos (`gestao-de-saidas-de-veiculos`) | `3. ARAUJO\GESTAO SAIDA VEICULOS` | `sentinela-guarda.ts` (raiz) | nada |
| Gestão TI (`gestao-ti`, edge) | `5. GESTÃO TI` / Gestao-TI | `src/lib/sentinela-guarda.ts` | `src/middleware.ts`: `ROBO_AGENDADOR = { email: ..., origem: 'sessao_app', maquina: true }` |
| Painel ICMS (`painel-icms`, edge) | `2. SERGIO LUBE\PAINEL-ICMS` / PAINEL-ICMS | `src/lib/sentinela-guarda.ts` | nada (cartão inativo no portal) |
| Gestão Comercial Trade (`gestao-comercial-trade`) | `11. TRADE` / GEST-O-COMERCIAL | `web/sentinela-guarda.ts` | nada |
| Movimentação de Inventário (`movimentacao-inventario`) | `16. INVENTARIO` / MOVIMENTACAO-INVENTARIO | `web/sentinela-guarda.ts` | nada |
| Gestão Fiscal (`gestao-fiscal`) | `17. FISCAL` / GESTAO-FISCAL | `web/sentinela-guarda.ts` | nada |
| **Reposições (`reposicoes-web`)** | `9. REPOSICOES` / REPOSICOES | **novo**: `web/sentinela-guarda.ts` + `web/middleware.ts` | ver 14.2 |
| SAC (`sac-lube`) | `10. SAC` | — | nada (isento; segue 1.1.0) |
| Supervisor Lube (`supervisor-lube`) | `P:\INTEGRAÇÃO BI\SUPERVISOR\6 - PROJETO DO APP` | — | nada (isento) |
| Guardião (DATA WAREHOUSE) | `12. GUARDIAO` | — | o item `site:reposicoes-web` do catálogo (`saude`) passa de `rota "/"` e `sem_guarda: true` para `rota "/.sentinela/saude"` e `sem_guarda: false`, junto com o deploy do guarda no Reposições (senão o Guardião acusa queda: `/` passa a ser 302) |

### 14.2 Reposições ganha o guarda
1. Central: a linha do Reposições já entra na migração 13 (§4.7), `exige_login = true`, modo de rede
   desligado.
2. `web/sentinela-guarda.ts` (1.3.0) e `web/middleware.ts` próprio, no desenho do Gestão TI:
   ```ts
   const FECHADO = { projeto: 'reposicoes-web', slug: 'reposicoes' };
   // O aquecedor da SRV-IA (etl/aquecer_painel.py) entra como máquina: só GET /api/dados, só com o
   // segredo AQUECEDOR_SEGREDO (mínimo 32 caracteres) em x-lube-aquecedor, em tempo constante.
   const ROBO_AQUECEDOR = { email: 'robo do reposicoes (aquecedor da srv-ia)', origem: 'sessao_app' as const, maquina: true };
   ```
   Cabeçalho próprio, e não `Authorization`, para o CDN continuar guardando a mesma resposta de
   `/api/dados` para todo mundo (`s-maxage=300`): conferir `X-Vercel-Cache` no `aquecer_painel.log`
   depois da instalação.
3. Júlio cadastra `AQUECEDOR_SEGREDO` como **Sensitive** na Vercel (projeto `reposicoes-web`) e no `ENV`
   da `SRV-IA`. O `aquecer_painel.py` manda o cabeçalho. **O arquivo tem alteração local sem commit** (o
   conserto do certificado): combinar com o Júlio antes de mexer. Essa alteração cai, como último recurso,
   para `ssl=sem-verificar` (TLS sem conferir o certificado) quando o Windows da `SRV-IA` não confia na
   Google Trust Services. Sem segredo isso "não expõe nada"; **com o segredo, não**: ele abre o
   `GET /api/dados` sem login e de fora da rede (nome de cliente e de motorista). Então, com o segredo: tirar o
   contexto `sem-verificar` (ou não mandar o cabeçalho por ele) e resolver o certificado de vez (`certifi`
   instalado no Python da `SRV-IA`, ou a raiz da GTS no Windows). Se só o `sem-verificar` funcionar, o
   aquecedor não manda o segredo, e vale a saída (b) do §20.7.
4. Arquivos proibidos: `^/db/` (o `web/db/*.sql` é publicado hoje), `servidor_local.js`, `package*.json`.
5. README do Reposições ganha a seção "Acesso".
6. Consequência: quem abria o Reposições pelo link passa a entrar pelo portal (o cartão já existe, em
   CONSULTORIA). A consultora externa tem conta e permissão. **Antes do deploy** (hoje ele não tem guarda nem
   evento, então não se sabe quem usa pelo link): listar no admin quem tem o cartão REPOSIÇÕES liberado
   (permissão ou "Todos os sistemas"); olhar o Analytics ou os logs da Vercel do `reposicoes-web` dos últimos
   dias para ter ideia de quantos usam; combinar com o Júlio quem precisa do cartão; e mandar o aviso ("a
   partir de dd/mm o Reposições abre pelo Painel Lube, com o seu login"). Quem usa e não tem o cartão cai no
   portal sem conseguir abrir.
7. Com o guarda, o `/api/dados` passa a responder 401 quando acaba a sessão de 8 h: o `buscar()` do
   `web/app.js` diz "Sua sessão do Painel Lube expirou. Entre de novo pelo portal." (como o Inventário e o
   Fiscal), e o 403 de fora da rede chega com a mensagem pronta.

---

## 15. Testes

### 15.1 Parte A — banco (`db/13_sentinela_rede_teste.sql`)
Protocolo do `02`: começa com `begin;`, `set local lock_timeout`/`statement_timeout`, um bloco que aborta
(55000) se `sentinela.redes` não foi criada nesta mesma transação, placar no fim e `rollback;`. Usuários
de teste em `auth.users` e `public.profiles` somem no rollback. Casos mínimos:

- R01 privilégios: anon e authenticated não executam `srv_rede_*` nem `emergencia_*`; não admin recebe
  42501 em `sentinela_rede_painel`/`sentinela_rede_acao`; tabelas novas sem acesso pela API.
- R02 `rede_nova`: aceita IP solto (/32), /24, IPv6 /56 e /48; recusa /23, IPv6 /47, bits de host,
  192.168.x, 10.x, 100.64.x, 127.x, `::1`, `fe80::`, repetida, coberta por outra; `::ffff:a.b.c.d` vira IPv4.
- R03 `rede_remover`: recusa a última com sistema em exigir; aceita com tudo em observar; repetir → P0002.
- R04 `rede_modo`: recusa isento (SAC), exigir sem rede, exigir com guarda 1.2.0 ou sem versão (nada
  muda se um falhar); `'*'` muda só os não isentos e devolve a lista; grava modo_em/modo_por.
- R05 `liberar`: recusa perfil inativo/inexistente, fim no passado, prazo acima de 30 dias, motivo curto,
  início fora da faixa; aceita futura; a nova encerra a anterior ("substituída por #id").
- R06 `encerrar`: encerra; repetir → P0002; vencida → P0002.
- R07 `srv_rede_lista`: redes ativas; liberados só ativos, de perfil ativo, com `h` = SHA-256 do e-mail
  minúsculo; vencida, agendada e encerrada fora; modo desligado manda `liberados: []`; projeto
  desconhecido e isento = desligado; exigir sem rede sai `observar`.
- R08 `srv_rede_decidir`: os 5 desfechos (desligado, dentro, liberado, observar, exigir); IP nulo = fora;
  grava em `rede_fora` só fora e com modo ligado; repetição em 10 min soma `vezes`; `emergencia` só para
  admin e só com 3 outras pessoas barradas do IP em 2 h.
- R09 `srv_rede_emergencia`: so_admin, sem_provas, ja_cadastrada, ip_invalido, ok (/32 e /64), grava em
  `acoes_admin`.
- R10 `sentinela_rede_painel`: com eventos de teste via `sentinela_srv_registrar` (`fora_da_rede`,
  `rede_liberado`, evento com identidade fora das redes, robô): "fora" agrupa por pessoa e IP, prévia
  "regra_desligada", robô fora de tudo; "sugestoes" com 2 pessoas em 2 dias; contagens.
- R11 emergência por SQL: as três funções funcionam como `postgres` e dão 42501 como authenticated.
- R12 `acoes_admin`: cada ação aceita grava uma linha; recusada não grava.
- R13 nenhum objeto existente mudou (assinatura e corpo de `sentinela_srv_lista`, `sentinela_acao` e
  `sentinela_painel` iguais aos de antes da migração — compare o md5 de `pg_get_functiondef`).
- R14 cadeia íntegra no fim (`sentinela_verificar_cadeia`).
- R15 ponta a ponta (rede → Reposições em exigir → passe negado → liberação → encerramento → portal).
- (v1.1) R16 afrouxar só de dentro: direto pelo banco, com sistema exigindo, as 5 formas de afrouxar dão
  42501 e nada grava; pela central, de fora e sem liberação (e com IP nulo), recusadas; apertar vale de fora
  e pelos dois caminhos; admin liberado afrouxa de fora (com o IP no registro); sem sistema exigindo, direto
  pelo banco volta a valer; não admin, inativo e sem usuário → 42501; recusas do executor voltam em JSON
  com o SQLSTATE; sistema em exigir com guarda 1.2.0 aparece em `exigir_sem_guarda`. Os demais blocos
  passam pela central (`pg_temp.adm`, do IP do escritório de teste), como a tela faz. R04 confere também o
  guarda 1.3.0 só na prévia (recusado) e o `'*'` em exigir sem o portal; R11 a emergência por SQL com IPv6
  (/64); R10 as contagens novas.

### 15.2 Parte A — central (`node --test "teste/*.test.ts"`, na pasta da função)
Os 35 casos atuais passam (o de `/saude` só troca a versão). Novos: assinaturas das 3 RPCs novas no `ASSINATURAS`; `/lista` com e
sem `rede` (RPC falhando → sem `rede`, log uma vez); cache de 10 s; `/passe` com `bloquear` → 403
`fora_da_rede` e **nenhum** passe assinado; `observar`/liberado → passe; RPC falhando → passe (falha
aberta); `/rede`: CORS, Origin, JSON, Bearer, 405, 429 (30/min), perfil inativo 403, mapeamento da
resposta, `emergencia` só para admin, `{"emergencia":true}` com cada motivo de recusa, banco fora →
`indisponivel`; IP ausente → `srv_rede_decidir` recebe `p_ip` nulo. (v1.1) `/rede {"acao"}`: IP do pedido e
pessoa do token (o corpo não escolhe), resultado repassado, recusa com o código e o texto (42501 → 403,
22023/P0002 → 400), código fora do formato não passa, ação desconhecida e `dados` que não é objeto → 400 sem
chamar o banco, banco fora → 503, perfil inativo não chega ao banco, IP ausente → `p_ip` nulo.

### 15.3 Parte B — guarda (`node guarda/teste/guarda.teste.mjs`, `middleware.teste.mjs`, `edge.teste.mjs`)
A bateria atual inteira passa **sem mudar expectativa** (só a versão, nos 3 lugares que a conferem, e
as chaves de `lista` no teste da saúde). `apoio.mjs` ganha
`lista({ rede: { modo, redes, liberados } })` e um ajudante `hashEmail`. Casos novos:
1. sem `rede` e com `desligado`: identidade de fora → `null`, evento igual ao 1.2.0.
2. observar: identidade de fora → `null` + evento observado `fora_da_rede`.
3. exigir: página → 403 com o texto exato do §9.1, sem código de incidente, sem IP, sem `Set-Cookie`,
   `x-sentinela: rede`; API e arquivo → 403 JSON `fora_da_rede`; HEAD igual a GET.
4. exigir, dentro: IP exato, faixa /24, IPv6 /56, `::ffff:` → `null` e evento sem regra.
5. liberado: e-mail com maiúsculas casa; `ate` vencido → 403; hash de outra pessoa → 403.
6. liberação com lista de mais de 2 min: espera a renovação; central fora → não liberado (403). (v1.1) Central
   em 1,5 s → o liberado passa de primeira; central em mais de 2,5 s → espera ~2,5 s e decide com a velha.
7. máquina: robô com `maquina: true` fora → `null`, `rede_maquina`; agendador com UA `vercel-cron/1.0` →
   regra `cron` com o motivo de máquina; robô sem `maquina` → 403; `maquina: true` com e-mail de pessoa
   → 403.
8. sem login: sistema fechado → 302 `sem_login` (a rede não muda nada); rota pública de sistema fechado no
   exigir → 403; portal (sem "exige login") no exigir → `null`.
9. `/.sentinela/saude` de fora no exigir → 200 com `lista.rede = "exigir"`, sem redes nem liberados no texto.
10. passe fora no exigir → 403 página sem cookie de sessão; no observar → 302 com cookie + evento
    observado; liberado → 302 com cookie + `rede_liberado`.
11. exigir com redes vazias → comporta-se como observar.
12. rede inválida na lista é ignorada; modo desconhecido → observar.
13. IP vazio ou inválido com identidade no exigir → 403.
14. ataque certo de fora continua sendo `varredura` (403 de ataque, não de rede); bloqueio certo da lista
    idem.
15. sessão válida pega "dentro" e usada "fora" (mesmo cookie, outro IP) → 403.
16. lista nova sem `rede` depois de uma com `rede`: mantém a última por 24 h; depois, sem regra.
17. iframe (`sec-fetch-dest: iframe`) de fora no exigir → a mesma página.
18. a regra nunca chama `bloquearLocal` (o mesmo IP, sem login, continua vendo o portal).
19. desempenho: 500 liberados + 200 redes, 1000 pedidos de fora < 1 s no total.
20. `edge.teste.mjs`: o núcleo 1.3.0 no Edge Runtime do Next (sem `process`/`Buffer`) com a regra ligada.
21. (v1.1, caso 23) sistema com slug e "exige login" desligado: sem login de fora → 403 no exigir, observado
    no observar; dentro segue; portal (sem slug) e lista sem `sistema` seguem.
22. (v1.1) saúde: `lista.rede_idade_s` (0 com o bloco novo; cresce com a lista sem o bloco; `null` sem bloco).

### 15.4 Produção (Claude principal, depois de cada passo do §20)
- **Invariante 2 (passo 0):** um `POST /tentativa` (Origin do portal, JSON, usuário `t***@lube.com.br`)
  com `cf-connecting-ip: 203.0.113.7`, `x-real-ip: 203.0.113.8` e `x-forwarded-for: 203.0.113.9`; depois
  `select host(ip) from sentinela.tentativas_login order by id desc limit 1` tem de mostrar o IP real, e a
  linha de teste sai (`delete ... where id = ...`). Uma tentativa só (força bruta precisa de 5). Não é
  caminho de ataque e não bate na Vercel.
- **`x-real-ip` não forjável (passo 0, v1.1):** a regra inteira confia que a Vercel sobrescreve o
  `x-real-ip`. Prova (não é caminho de ataque; não bloqueia nada): de um celular no 4G,
  `curl -s -H 'x-real-ip: 203.0.113.8' -H 'x-forwarded-for: 203.0.113.9' -H 'x-vercel-forwarded-for: 203.0.113.10' https://<sistema>/.sentinela/saude`
  num site estático (movimentacao-inventario.vercel.app), num nodejs (rh-absentismo.vercel.app) e num Next
  (gestao-ti-ruddy.vercel.app). O campo `ip` tem de mostrar o IP real do 4G (o guarda lê o `x-real-ip`
  primeiro). Se algum mostrar 203.0.113.x, parar antes do observar.
- Passos 2 a 5: `/.sentinela/saude` de cada sistema (`guarda`, `rede`, `rede_idade_s`, `oidc`, `lista.ok`);
  nenhum evento `fora_da_rede` com tudo desligado; a prévia do módulo mostra os casos já conhecidos.
- Passo 7 (observar): do escritório, tudo igual; de um celular no 4G, login no portal → normal e aparece
  "Seria barrado" com cidade e IP; abrir um sistema → evento observado; na manhã seguinte, o robô do
  Gestão TI sai `cron` com motivo de máquina; o aquecedor sai `rede_maquina`.
- Passo 8a (exigir, 1 sistema): 4G → `/passe` 403 → página; liberar a pessoa de teste → abre; encerrar →
  barrado em até 1 min; abrir o sistema no Wi-Fi da Lube e trocar o celular para o 4G → 403.
- Regra da casa: **nunca** testar caminho de ataque (`/.env` etc.) do escritório.

### 15.5 Parte C — telas
Sem teste automático no portal hoje. Conferir no navegador (Browser pane, `python -m http.server 4321`):
`/sentinela/?demo=1#rede` nas três abas, nos dois temas, em 375 px (sem rolagem lateral) e em 1440 px;
modais de liberar, exigir, rede nova e "isto é uma rede da Lube?"; o portal com
`localStorage['lube-rede-demo']` em `bloquear`, `liberado` e `emergencia`; `fora-da-rede.html` com cada
`?de=` e com um valor inventado (nada dele aparece na página); todo dado de visitante escapado.

---

## 16. Construção em 3 partes, sem arquivo em comum

O contrato entre as partes são as formas JSON deste documento (§4.3, §4.4, §5.3 e §6.2). Cada parte
roda os próprios testes e não edita arquivo de outra. Commits só locais, na fase Corrigir. Ninguém faz
push nem publica.

### Parte A — central
- Arquivos: `db/13_sentinela_rede.sql` (novo), `db/13_sentinela_rede_teste.sql` (novo),
  `supabase/functions/sentinela/central.ts`, `supabase/functions/sentinela/http.ts`,
  `supabase/functions/sentinela/teste/central.test.ts`, `supabase/functions/sentinela/teste/http.test.ts`.
- Pronto quando: o teste do banco passa inteiro em transação revertida no banco do Painel (sem aplicar a
  migração); `node --test "teste/*.test.ts"` passa inteiro.
- Não pode: aplicar a migração, publicar a função, mexer em `db/02_*`, em `index.ts` ou nas funções de
  hoje.

### Parte B — guarda 1.3.0
- Arquivos: `guarda/sentinela-guarda.ts`, `guarda/teste/apoio.mjs`, `guarda/teste/guarda.teste.mjs`,
  `guarda/teste/edge.teste.mjs`, `guarda/teste/middleware.teste.mjs` (se precisar), `guarda/LEIA-ME.md`
  (seção "Regra de rede (1.3.0)", a opção `maquina` e a emergência).
- Pronto quando: as três baterias passam; a bateria do 1.2.0 passa sem mudar expectativa.
- Não pode: copiar o núcleo para a raiz do portal nem para os sistemas (isso é a integração; no ar, os
  passos 3 a 5 do §20).

### Parte C — telas e página de bloqueio
- Arquivos: `rede.js` (novo), `fora-da-rede.html` (novo), `portal.js`, `shell.js`, `index.html` (script
  e `?v=`), `admin.html`, `admin.js`, `sentinela/index.html`, `sentinela/sentinela.js`,
  `sentinela/util.js`, `sentinela/sentinela.css`, `sentinela/demo.js`.
- Pronto quando: as conferências do §15.5 passam; `portal.js` trata `fora_da_rede` no clique, no
  `?abrir=`, na nova aba e no iframe; `/identidade` só depois de um `/rede` que não mandou bloquear.
- Não pode: mexer em `office/`, `styles.css`, `shell.css` ou na raiz `sentinela-guarda.ts`. (Se precisar
  de estilo para o cartão de emergência, vai dentro do `rede.js`, como o aviso discreto de hoje.)

Depois das três (Claude principal): revisão adversária (trava a empresa? cabeçalho forjado? e-mail na
lista? XSS?), atualizar `docs/SENTINELA-ESPECIFICACAO.md` para v1.2, o README e as notas do cérebro.

---

## 17. O que a regra não cobre (dizer ao Júlio)

1. **Só o que passa pela Vercel.** Fica de fora:
   - bancos abertos à chave pública, acessados direto do navegador: **RH** (leitura e gravação anônimas),
     **Saída de Veículos** (leitura e inserção anônimas) e **ICMS** (políticas TEMP). Quem tem a chave lê
     de qualquer lugar;
   - chamadas diretas ao Supabase do Painel com um token válido: o login (Supabase Auth) funciona de
     qualquer lugar e, com o token, dá para chamar o banco do portal, as funções do **LUBE OFFICE** (até a
     parte D) e, para administrador, as funções do admin e da Sentinela.
   - **Senha de um administrador, de fora** (roubada, ou o próprio admin em casa). Desde a v1.1 ela **não
     afrouxa a regra de rede**: rede nova, liberar, observar e desligar, com sistema exigindo, só pela central
     e de dentro (§4.4). Continua valendo de fora o que já valia antes da regra: as funções gerais da
     Sentinela (`sentinela_acao`: desbloquear, confiar, modo da Sentinela, rotas públicas e "exige login" de um
     sistema; o guarda 1.3.0 aplica a regra de rede mesmo sem login em sistema com slug, então desligar o login
     não abre o sistema para fora da rede) e as do admin do portal (perfis, permissões). A defesa contra senha
     roubada é **MFA nos administradores** (Supabase Auth, e conferir `auth.jwt()->>'aal' = 'aal2'` nas
     funções de admin): decisão do Júlio (§18).
   - O **LUBE OFFICE**, com a sessão do Supabase guardada no navegador (dura semanas), abre de casa enquanto a
     parte D não estiver no ar: por isso o portal só passa a exigir depois dela (§7.2).
2. **Partida a frio com a central fora:** uma instância nova, sem lista, não conhece as redes. Ela só
   exige login (modo fechado). Uma instância que já tinha lista guarda as redes por até 24 h (e a saúde
   mostra a idade do bloco em `lista.rede_idade_s`).
3. **É por IP público.** Todo mundo no mesmo IP do escritório está "dentro", inclusive o **Wi-Fi de
   visitantes**, se sair pela mesma internet. O login continua obrigatório.
4. **Celular no 4G dentro da empresa está fora.** iPhone com **Retransmissão Privada do iCloud**, VPN e a
   "rede segura" do Edge também aparecem fora, mesmo no Wi-Fi da Lube (a retransmissão desliga por rede:
   Ajustes › Wi-Fi › rede da Lube › "Limitar rastreamento de IP").
5. **IPv6:** hoje nada chega em IPv6. Se um dia o escritório sair em IPv6, aparece em "Tentativas de fora"
   no modo observar e o TI cadastra o prefixo.
6. Dado já baixado (planilha exportada, cópia do Reposições no navegador) não volta.
7. SAC e Supervisor ficam de fora por decisão.

Indo além do IP no futuro (decisão do Júlio, com custo): acesso por aparelho (Cloudflare Zero Trust com o
WARP nos computadores da Lube). O firewall da Vercel por IP não serve aqui: barraria a tela de login (e o
atalho do SAC) e não tem liberação por pessoa.

---

## 18. Pendências e decisões para o Júlio

> **Decisões de 2026-10-26 (Júlio):** o IP do escritório fica como **fixo** ("qualquer coisa te aviso para
> mudanças"); **exigir já no mesmo dia**, sem os 5 dias de observar ("ai eu vou saber se todo mundo que está na
> empresa está usando a rede"; se algo der errado, ele pede para desfazer); o **Reposições fica para depois**;
> a frase passa a ser **"Este aparelho não está na rede da Lube"**.

- [x] O IP do escritório é **fixo**? Júlio, 2026-10-26: manter como fixo. Há link reserva, Wi-Fi do galpão,
      filial ou empresa do grupo (LUBE RJ, L LOG, IMPÉRIO LOG, SERMAR) que use os sistemas de outro endereço?
      Vai aparecer em "Tentativas de fora"; o TI abre `/.sentinela/saude` de cada lugar e anota o `ip`.
- [ ] **Consultora externa** (única conta de fora do domínio, só usa o Reposições): liberação renovada a
      cada 30 dias, prazo maior só para ela, ou o Reposições em observar enquanto houver consultoria?
- [ ] Prazo máximo de 30 dias está bom?
- [ ] Wi-Fi de visitantes sai pela mesma internet do escritório?
- [ ] `AQUECEDOR_SEGREDO`: cadastrar na Vercel (Reposições) e no `ENV` da `SRV-IA`; e o que fazer com a
      alteração sem commit do `aquecer_painel.py`.
- [ ] Quando passar para observar e quando para exigir (passos 7 e 8 do §20).
- [ ] Parte D (LUBE OFFICE): **condição para o portal exigir** (passo 8c). E, se quiser ir além, a conferência
      da rede também nas funções de admin e da Sentinela no Supabase.
- [ ] **MFA nos administradores** (v1.1): sem ele, a senha de um admin, de fora, ainda mexe nas funções gerais
      da Sentinela e do admin (§17.1). Com ele, as funções de admin passam a exigir `aal2`.
- [x] **Texto da página de bloqueio**: trocado em 2026-10-26 (Júlio) para "Este aparelho não está na rede da
      Lube", com a dica "Na Lube, use o Wi-Fi da empresa ..." (§9). O SHA-256 do guarda mudou: copiado de novo
      nos 12 lugares.
- [ ] **Reposições** (v1.1): quem precisa do cartão REPOSIÇÕES e o aviso aos usuários antes do passo 5 (§14.2).
- [ ] **Aquecedor do Reposições** (v1.1): com o segredo, sem o `ssl=sem-verificar` (§14.2, item 3).
- [ ] **Guardião** (v1.1, repositório `12. GUARDIAO`): para cada sistema com `rede_sistemas.modo = 'exigir'`,
      comparar com o `lista.rede` do `/.sentinela/saude` e abrir incidente se vier diferente de `exigir` (guarda
      velho, lista sem bloco, exigir sem rede) ou se `lista.rede_idade_s` passar de ~300 s; e o sistema em
      exigir com `guarda_rede = false` no `sentinela_rede_painel` (`contagens.exigir_sem_guarda`).
- [ ] **Aviso aos funcionários** antes do 8a: "fora da empresa os sistemas não abrem; na empresa, use o Wi-Fi
      da Lube (no celular, desligue os dados móveis e a VPN)".

---

## 19. Riscos e armadilhas

| risco | o que o desenho faz |
|---|---|
| Trancar a empresa inteira (IP trocado, rede removida por engano) | não remove a última rede com exigir; não liga exigir sem rede; guarda trata exigir sem rede como observar; emergência por SQL e botão com provas (§12) |
| Ligar exigir com guarda antigo (sessão levada para casa continuaria valendo) | `rede_modo` recusa exigir em sistema com guarda < 1.3.0 (ou sem versão registrada) |
| Teste em transação travar a Sentinela | nenhuma `alter table` em tabela existente; `lock_timeout`; transação curta (§4.8) |
| Central e guarda verem IPs diferentes (IPv6 de um lado, IPv4 do outro) | hoje são iguais nos 3 IPs com login; o guarda decide sozinho em todo pedido; observar mostra a diferença |
| `cf-connecting-ip` forjado na central | prova no passo 0; mesmo se falhar, o guarda usa o IP da Vercel e barra. Mas a trava de afrouxar (§4.4) usa o IP da central: sem a prova, ela não vale |
| `x-real-ip` forjado na Vercel | prova no passo 0, de um 4G, em 3 runtimes (§15.4); se falhar, parar antes do observar |
| Senha de administrador, de fora, desligando a regra | v1.1: afrouxar só pela central e de dentro (§4.4); o que sobra está em §17.1 (MFA dos admins é a defesa) |
| Preview com o 1.3.0 liberando o exigir com a produção no 1.2.0, ou Instant Rollback com o sistema em exigir | exigir só com o 1.3.0 visto na produção; o painel mostra "exigindo sem conferir" e `exigir_sem_guarda`; falta o Guardião alarmar (§18) |
| Central antiga ou `srv_rede_lista` falhando: mudanças não chegam e os liberados levam 403 | `lista.rede_idade_s` na saúde; nunca voltar a central com sistema fora de desligado; volta = Instant Rollback (§13, §20.4) |
| LUBE OFFICE aberto de casa com o portal em exigir | o 8c só com a parte D (§7.2, §13) |
| Liberação encerrada continuar valendo por cache | cache da central 10 s + lista do guarda 20 s; liberação só vale com lista de até 2 min |
| Robô ou aquecedor barrados | marca `maquina` só depois do segredo do app; observar mostra antes de exigir |
| Guardião acusar queda do Reposições | trocar a rota do catálogo junto com o deploy (§14) |
| E-mail das pessoas espalhado | a lista do guarda leva só o SHA-256; este documento não tem e-mail |
| Trabalho do Office sem commit no repositório do portal | as partes não tocam `office/` nem `supabase/functions/office/`; commits por arquivo |
| Reposições abrir sem login antes do guarda | a linha entra na central antes; o guarda nasce com `FECHADO` |

---

## 20. Roteiro de publicação

Nada daqui foi feito ainda. Cada passo só começa com o anterior conferido e **com o OK do Júlio** (push,
deploy, migração e mudança de modo). Quem publica é o Claude principal. Regras que valem em todos os passos:
- **Nunca** testar caminho de ataque (`/.env`, `/wp-login.php` etc.) do escritório contra os sites no ar.
- Teste no banco de produção só dentro de `begin ... rollback`, em horário calmo (almoço ou depois das 18h).
- Commits só com os arquivos da mudança (lista no 20.1). Se o deploy pelo Git der `BLOCKED`, publicar pela API
  da Vercel com o mesmo commit (`create_deployment` com `gitSource`), como em 2026-10-06.
- **Antes de cada deploy de produção, anotar o deployment atual** do projeto (`list_deployments`, o `READY` de
  produção): é para ele que o "voltar atrás" do passo aponta (Vercel › Deployments › Instant Rollback ou
  `request_promote` do deployment anotado).
- Com o modo `desligado`, o guarda 1.3.0 age igual ao 1.2.0 (provado no `rede.teste.mjs`, caso 22). Por isso
  os passos 1 a 4 e 6 não mudam nada para ninguém; o passo 5 faz o Reposições passar a pedir o login do Painel.

### 20.0 Estado em 2026-10-23 (fase Corrigir: commits só locais, nada publicado)

| peça | onde | prova |
|---|---|---|
| Migração `sentinela_v2_rede` (v1.1) | `db/13_sentinela_rede.sql` (md5 do trecho entre `SENTINELA-13-INICIO` e `SENTINELA-13-FIM`, em LF: **`b56199f9be66685a4e9eb412a9a7d6c1`**; o `e715f18c…` da integração não vale mais) | `begin; 13; 13_teste; rollback;` no banco do Painel, 2026-10-23 17:3x, com 0 eventos nos 5 min antes: **157 de 157**, md5 igual ao do arquivo; nada ficou gravado (conferido depois: sem `sentinela.redes`, sem `srv_rede_acao`, sem a linha do Reposições, sem usuário, sistema, ação ou evento de teste) |
| Teste ponta a ponta (R15) e trava de afrouxar (R16) | `db/13_sentinela_rede_teste.sql` | R15: rede → Reposições em exigir → passe negado de fora → tentativa no painel → liberação (hash igual ao do Node) → encerramento → dentro segue → portal em observar e exigir. R16: §15.1 |
| Central 1.1.0 (v1.1) | `supabase/functions/sentinela/` | `node --test "teste/*.test.ts"`: **91 de 91** (o novo: `/rede {"acao"}`) |
| Guarda 1.3.0 (v1.1) | `guarda/sentinela-guarda.ts` (SHA-256 em LF **`9b712b0443a0fa62…`**; no disco, CRLF: `1a98d6503097…`) | `guarda.teste.mjs` 75/75 (e 75/75 com `SENTINELA_TESTE_REDE=desligado`; com `=exigir` 61/75, falha como deve), `rede.teste.mjs` **23/23** (2.265 verificações; 168 respostas iguais às do 1.2.0), `middleware.teste.mjs` 7/7, `edge.teste.mjs` 6/6 |
| Portal | raiz: `sentinela-guarda.ts` (1.1.0 → 1.3.0), `rede.js`, `fora-da-rede.html`, `portal.js`, `index.html`, `admin.*`, `sentinela/*` | integração: prévia local com Supabase de mentira (login de fora barrado, emergência, liberado, iframe, admin barrado, central fora). v1.1, demo `?demo=1#rede`: "Todos em exigir (menos o portal)" deixa o Painel Lube de fora e avisa do Office; em observar, "Seriam barrados em 24 h"; remover a rede de onde o admin está avisa em vermelho e a linha "Você está em" vira "fora da rede"; `fora-da-rede.html` com a dica; console sem erro |
| 10 sistemas | guarda 1.3.0 v1.1 copiado byte a byte (SHA-256 igual nos 12 lugares) | Gestão TI e ICMS: `tsc --noEmit` sem erro; Gestão TI com `ROBO_AGENDADOR` `maquina: true` |
| Reposições | `web/sentinela-guarda.ts` + `web/middleware.ts` (novo) + `web/app.js` (401 da sessão) + README "Acesso" | teste do middleware com o guarda v1.1 (scratchpad, 4/4, 18 verificações): sem login 302/401, aquecedor só com o segredo certo e só em `GET /api/dados` (passa de fora como `rede_maquina`), pessoa de fora 403 de rede, liberada e de dentro seguem, arquivos proibidos 403; `tsc --strict` sem erro |
| Commits locais | branch `sentinela-rede-1.3.0` dos 12 repositórios (lista e hashes no §20.1); a `main` local ficou como estava | `git log -1 sentinela-rede-1.3.0` em cada um; **nenhum push** |

### 20.1 Arquivos de cada commit (fase Corrigir)

- **Portal** (`1. PAINEL LUBE DISTRIBUIDORA`): `sentinela-guarda.ts`, `rede.js`, `fora-da-rede.html`, `portal.js`,
  `index.html`, `admin.html`, `admin.js`, `sentinela/index.html`, `sentinela/sentinela.js`, `sentinela/util.js`,
  `sentinela/sentinela.css`, `sentinela/demo.js`, `guarda/sentinela-guarda.ts`, `guarda/LEIA-ME.md`,
  `guarda/teste/apoio.mjs`, `guarda/teste/guarda.teste.mjs`, `guarda/teste/edge.teste.mjs`,
  `guarda/teste/middleware.teste.mjs`, `guarda/teste/rede.teste.mjs`, `db/13_sentinela_rede.sql`,
  `db/13_sentinela_rede_teste.sql`, `supabase/functions/sentinela/central.ts`, `supabase/functions/sentinela/http.ts`,
  `supabase/functions/sentinela/teste/central.test.ts`, `supabase/functions/sentinela/teste/http.test.ts`,
  `docs/SENTINELA-REDE.md`. **Fora:** qualquer arquivo de `office/` e `supabase/functions/office/` (o trabalho do
  Office que estava sem commit entrou no `ee2cb56`, em 2026-10-23 16:23; confira `git status` antes de commitar).
- **COMPRAS** `web/sentinela-guarda.ts` (fora: `README.md` e `etl/*`, do Júlio) · **COMERCIAL**, **FINANCEIRO**,
  **TRADE**, **INVENTÁRIO**, **FISCAL** `web/sentinela-guarda.ts` · **RH** e **SAÍDA DE VEÍCULOS**
  `sentinela-guarda.ts` (raiz) · **ICMS** `src/lib/sentinela-guarda.ts` · **GESTÃO TI**
  `src/lib/sentinela-guarda.ts` + `src/middleware.ts`.
- **REPOSIÇÕES**: `web/sentinela-guarda.ts`, `web/middleware.ts`, `web/app.js`, `README.md` (fora:
  `etl/aquecer_painel.py`, alteração local do Júlio).
- Com `core.autocrlf=true` o checkout pode virar CRLF: confira o md5 da migração e o SHA-256 do guarda **em LF**
  (`tr -d '\r' < arquivo | sha256sum`).
- **Commits locais feitos em 2026-10-23** (nenhum push): ver a tabela "Commits da fase Corrigir" logo abaixo.

**Commits da fase Corrigir** (locais; o push é o passo de cada sistema, com o OK do Júlio). Ficam no **branch local
`sentinela-rede-1.3.0`** de cada repositório; a `main` local continua onde estava, para um `git push` da `main` por
outra conversa (o Office no portal, o aquecedor no Reposições) não publicar nada disto. Publicar = `git push origin
sentinela-rede-1.3.0` (preview) e, conferido, o merge na `main` (produção). No Reposições, publicar antes da migração
tranca o sistema: a central ainda não conhece o `reposicoes-web`.

| repositório (pasta) | commit | o que leva |
|---|---|---|
| Portal (`1. PAINEL LUBE DISTRIBUIDORA`) | `7f4b374` | tudo do 20.1 (o commit seguinte só anota esta tabela) |
| BI Compras (`6. COMPRAS`) | `151adee` | `web/sentinela-guarda.ts` (ficaram de fora `README.md` e `etl/*`, do Júlio) |
| BI Comercial (`8. COMERCIAL`) | `5c45a2b` | `web/sentinela-guarda.ts` |
| Gestão Financeiro (`7. GESTÃO FINANCEIRO`) | `0d1923a` | `web/sentinela-guarda.ts` |
| RH (`4. RH\GESTAO-RH`) | `871d173` | `sentinela-guarda.ts` |
| Saída de Veículos (`3. ARAUJO\GESTAO SAIDA VEICULOS`) | `68517a2` | `sentinela-guarda.ts` |
| Painel ICMS (`2. SERGIO LUBE\PAINEL-ICMS`) | `39f4603` | `src/lib/sentinela-guarda.ts` |
| Gestão Comercial Trade (`11. TRADE`) | `78b79fc` | `web/sentinela-guarda.ts` |
| Movimentação de Inventário (`16. INVENTARIO`) | `8f497ca` | `web/sentinela-guarda.ts` |
| Gestão Fiscal (`17. FISCAL`) | `f9e910e` | `web/sentinela-guarda.ts` |
| Gestão TI (`5. GESTÃO TI`) | `144f186` | `src/lib/sentinela-guarda.ts` + `src/middleware.ts` (`maquina: true`) |
| Reposições (`9. REPOSICOES`) | `7d1455b` | `web/sentinela-guarda.ts`, `web/middleware.ts`, `web/app.js`, `README.md` (ficou de fora `etl/aquecer_painel.py`) |

Em todos, o guarda commitado tem o SHA-256 `9b712b0443a0fa62…` (em LF), o mesmo do `guarda/sentinela-guarda.ts`.

### 20.2 Passo 0 — antes de tudo (não muda nada)

1. **Invariante 2** (§15.4): provar que o Supabase sobrescreve um `cf-connecting-ip` forjado no `POST /tentativa`.
   Se não sobrescrever, parar e trocar a leitura do IP na central antes do passo 2. **Sem essa prova a trava de
   afrouxar (§4.4) não vale**: ela confia no IP que a central vê.
2. **`x-real-ip` não forjável** (v1.1, §15.4): de um celular no 4G (não é caminho de ataque, não bloqueia nada),
   `curl -s -H 'x-real-ip: 203.0.113.8' -H 'x-forwarded-for: 203.0.113.9' -H 'x-vercel-forwarded-for: 203.0.113.10'`
   no `/.sentinela/saude` de um site estático (movimentacao-inventario), de um nodejs (rh-absentismo) e de um Next
   (gestao-ti-ruddy), **depois do passo 4** (precisa do guarda 1.3.0; o 1.2.0 mostra o `ip` do mesmo jeito, então
   também dá para fazer já). O `ip` tem de ser o IP real do 4G. Se algum mostrar 203.0.113.x, parar antes do passo 7.
3. **Redes da Lube**: o TI abre `https://painel-lube-distribuidora.vercel.app/.sentinela/saude` de cada lugar e
   link (escritório, galpão, Wi-Fi, link reserva, empresas do grupo) e anota o `ip` (IPv6: o prefixo /64).
   Perguntar à operadora se o IP do escritório é fixo.
4. **Júlio decide** (§18): a consultora externa (só usa o Reposições), o prazo máximo (30 dias), o aquecedor do
   Reposições (passo 5, item 1), o texto da página de bloqueio, o MFA dos administradores e quem precisa do cartão
   REPOSIÇÕES.
5. Rodar de novo, na máquina: `node guarda/teste/guarda.teste.mjs` (também com `SENTINELA_TESTE_REDE=desligado`),
   `rede.teste.mjs`, `middleware.teste.mjs`, `edge.teste.mjs` e, na pasta da central, `node --test "teste/*.test.ts"`.
   Tudo verde.

### 20.3 Passo 1 — migração `sentinela_v2_rede` (não muda nada)

| ação | conferir | voltar atrás |
|---|---|---|
| Em horário calmo, num envio só: `begin; set local lock_timeout = '3s'; set local statement_timeout = '30s';` + `db/13_sentinela_rede.sql` + `db/13_sentinela_rede_teste.sql` (ele termina em `rollback;`) | placar **157/157**, `falharam = 0`, `md5_migracao = b56199f9be66685a4e9eb412a9a7d6c1` (o mesmo do arquivo em LF) | nada a voltar: foi revertido |
| `apply_migration` com o nome **`sentinela_v2_rede`** e o conteúdo do arquivo | `list_migrations` mostra `sentinela_v2_rede`; o md5 do trecho entre os marcadores em `supabase_migrations.schema_migrations.statements` é o mesmo; `to_regclass('sentinela.redes')` existe; `select count(*) from sentinela.redes` = 0; `rede_sistemas` com só os 2 isentos (SAC e Supervisor); `sentinela.sistemas` tem `reposicoes-web` com `exige_login = true`, `guarda_versao` nulo e 5 arquivos proibidos | a migração só cria objetos novos e, sem a central 1.1.0, ninguém os chama: deixar como está. Se for preciso tirar a linha do Reposições (só enquanto ele não tiver guarda): `delete from sentinela.sistemas where projeto = 'reposicoes-web' and ultimo_sinal is null;` |

```sql
-- md5 do que foi aplicado (tem de dar b56199f9be66685a4e9eb412a9a7d6c1)
select m.name, md5(substring(s from strpos(s, '-- SENTINELA-13-INICIO')
                   for strpos(s, '-- SENTINELA-13-FIM') + 19 - strpos(s, '-- SENTINELA-13-INICIO'))) as md5_trecho
  from supabase_migrations.schema_migrations m, array_to_string(m.statements, '') as s
 where m.name = 'sentinela_v2_rede';
```

O que muda para alguém: nada. O `/passe` do Reposições deixa de responder `sistema_desconhecido` e passa a
devolver a URL sem passe (o portal já abria a URL do mesmo jeito).

### 20.4 Passo 2 — central 1.1.0 (não muda nada)

| ação | conferir | voltar atrás |
|---|---|---|
| Guardar a versão no ar (hoje a **7**): `get_edge_function sentinela` para um arquivo do scratchpad | — | é a cópia de volta |
| `deploy_edge_function`: nome `sentinela`, `verify_jwt = false`, `import_map_path = "deno.json"`, arquivos `index.ts`, `central.ts`, `http.ts`, `hmac.ts`, `ia.ts`, `jwt.ts`, `saneamento.ts`, `deno.json` | `GET .../functions/v1/sentinela/saude` → `versao: "1.1.0"`; `/lista` sem token → 401; nos logs da função, nenhum `rede: srv_rede_lista falhou` nem `fora do formato`; os guardas de hoje (1.1.0/1.2.0) seguem com `lista.ok` no `/.sentinela/saude` (eles ignoram a chave `rede`); logins e aberturas de sistema normais | `deploy_edge_function` de novo com a cópia guardada (ou com `git show <commit anterior>:supabase/functions/sentinela/...`). A migração pode ficar. **Só enquanto todos os sistemas estiverem em `desligado`** (v1.1): com algum em observar ou exigir, primeiro "Todos em desligado", conferir `lista.rede: "desligado"` no `/.sentinela/saude` de cada sistema e só então voltar a central. Senão a lista sai sem o bloco `rede`, cada guarda segue com o último por até 24 h (`lista.rede_idade_s` crescendo), "Desligar todos" e a pausa por SQL não chegam e os liberados levam 403. Com o `srv_rede_lista` falhando (log da central), a volta é o Instant Rollback de cada sistema para o 1.2.0 anotado |

### 20.5 Passo 3 — portal (guarda 1.3.0 na raiz + telas), preview e produção

| ação | conferir | voltar atrás |
|---|---|---|
| `git push origin sentinela-rede-1.3.0` (o commit local já está nesse branch, §20.1): o deploy de **preview** sai sozinho | no preview: `/.sentinela/saude` → `guarda: "sentinela-guarda/1.3.0"`, `oidc: true`, `lista.ok: true`, `lista.rede: "desligado"`, `lista.rede_idade_s` pequeno; login do escritório abre o painel; `/fora-da-rede.html?de=painel` abre sem sessão. **O `POST .../sentinela/rede` do preview é recusado pela central** (`403 origem_nao_permitida`: o endereço `...-git-<branch>-....vercel.app` não está em `ORIGENS_PERMITIDAS`) **e o painel abre mesmo assim**: é a prova da falha aberta. O `200` com `acao: "seguir"` fica para a produção (ou para `http://localhost:4321` com a central real). Pelo mesmo motivo, no preview as ações que afrouxam a regra no painel da Sentinela dão "A central só aceita esta ação vinda do endereço do portal" | apagar o branch |
| Merge na `main` → produção | os mesmos itens no endereço de produção, agora com `POST .../sentinela/rede` 200 (`acao: "seguir"`, `modo: "desligado"`); Sentinela › **Rede da Lube** abre (chip "REDE · DESLIGADA", 0 redes), o Painel Lube aparece com guarda 1.3.0 em "Modo por sistema"; "Tentativas de fora" mostra a **prévia** (`regra_desligada`) com os casos já conhecidos (§2); `sentinela.sistemas.guarda_versao` do portal = 1.3.0 e `ultimo_ambiente = production`; nenhum evento `fora_da_rede` | Instant Rollback para o deployment anotado (o guarda volta ao 1.1.0 e as telas antigas voltam). Com o banco e a central novos, as telas antigas funcionam igual |

### 20.6 Passo 4 — os 10 sistemas internos, um por um

Ordem sugerida (do menos usado ao mais usado; Gestão TI fora do horário do robô, que roda às 08:29 e 09:27):
Movimentação de Inventário → Gestão Fiscal → Gestão Comercial Trade → Gestão Financeiro → BI Comercial →
BI Compras → RH → Saída de Veículos → Painel ICMS → Gestão TI.

| ação | conferir | voltar atrás |
|---|---|---|
| `git push origin sentinela-rede-1.3.0` (o commit local tem só o arquivo do guarda; Gestão TI: guarda + `src/middleware.ts`), **preview** | `/.sentinela/saude` do preview: `guarda` 1.3.0, `oidc: true`, `lista.ok: true`, `lista.rede: "desligado"`. (Preview do Gestão TI pode dar "Configuração ausente": é a falta das variáveis de produção, já conhecida) | apagar o branch |
| Produção | `/.sentinela/saude` de produção com os mesmos valores e `lista.modo: "proteger"`; abrir o sistema **pelo cartão do portal**, do escritório: entra (302 do passe para a página); sem login, numa aba anônima, `/` → 302 para o portal; nenhum evento `fora_da_rede`; em Sentinela › Rede da Lube › Modo por sistema, o guarda 1.3.0 **sem** "sinal de prévia" (abrir o endereço de produção uma vez, depois do preview, para o último sinal vir da produção) | Instant Rollback para o deployment anotado (volta o 1.2.0) |
| **Gestão TI, no dia seguinte** | eventos de `/api/cron/ler-emails` (08:29) e `/api/cron/cobrar` (09:27): identidade `robo do gestao ti (agendador da vercel)`, regra `cron`, decisão `liberado`; o e-mail e a cobrança saíram (o resumo do Telegram chega) | Instant Rollback |

### 20.7 Passo 5 — Reposições ganha o guarda (muda: passa a pedir login do Painel)

0. **Antes, quem vai perder o acesso** (v1.1). Hoje o Reposições não tem guarda nem evento: não se sabe quem usa
   pelo link. Listar no admin quem tem o cartão REPOSIÇÕES (CONSULTORIA) liberado (permissão ou "Todos os
   sistemas"); olhar o Analytics ou os logs da Vercel do `reposicoes-web` dos últimos dias para ter ideia de
   quantos usam; combinar com o Júlio quem precisa do cartão; e **mandar o aviso** antes do deploy: "a partir de
   dd/mm o Reposições abre pelo Painel Lube, com o seu login". Quem usa e não tem o cartão cai no portal sem
   conseguir abrir.
1. **Antes, decidir o aquecedor com o Júlio.** Sem o segredo, o aquecedor da `SRV-IA` leva 401 a cada 5 min e cada
   chamada vira evento `robo` (user-agent do Python). Se o IP de saída da `SRV-IA` não estiver em
   `sentinela.confiaveis`, a central pode bloquear esse IP como robô por 1 h (e, se ele for o do escritório,
   quem ainda não fez login no escritório leva 403 nesse tempo). Duas saídas:
   - **(a) com o segredo** — o Júlio gera 48 caracteres hex, cadastra `AQUECEDOR_SEGREDO` como **Sensitive** na
     Vercel (projeto `reposicoes-web`, Production) e no `ENV` da `SRV-IA`, e o `aquecer_painel.py` passa a mandar
     o cabeçalho `x-lube-aquecedor` (o arquivo tem alteração local sem commit: juntar com ela). Redeploy depois de
     cadastrar a variável. **Com o segredo, sem o `ssl=sem-verificar`** (v1.1): a alteração local cai para TLS
     sem conferir o certificado quando o Windows da `SRV-IA` não confia na Google Trust Services, e o segredo abre
     o `/api/dados` sem login e de fora da rede. Tirar esse contexto (ou não mandar o cabeçalho por ele) e resolver
     o certificado de vez (`certifi` no Python da `SRV-IA`, ou a raiz da GTS no Windows). Se só o `sem-verificar`
     funcionar, o aquecedor não manda o segredo: vale a (b).
   - **(b) sem o segredo, por enquanto** — desligar a tarefa `Reposicoes - Aquecer painel` na `SRV-IA` antes do
     deploy (o painel abre mais devagar na primeira visita; o CDN e a cópia do navegador continuam). Avisar o
     Guardião (o vigia da VM vai sentir falta do `aquecer_painel.log`).
2. Conferir na Vercel › `reposicoes-web` › Settings › Security que **OIDC Federation** está no modo **Team**.
3. A migração do passo 1 tem de estar aplicada (a central precisa conhecer `reposicoes-web` antes do primeiro deploy
   do guarda: lição do Trade, 2026-10-14).

| ação | conferir | voltar atrás |
|---|---|---|
| `git push origin sentinela-rede-1.3.0` (o commit local do Reposições, §20.1), **preview**, só com a migração aplicada | `/.sentinela/saude` do preview: guarda 1.3.0, `oidc: true`, `lista.ok: true`, `lista.rede: "desligado"` | apagar o branch |
| Produção | sem login: `/` → 302 para o portal com `?abrir=reposicoes`, `/api/dados` → 401 `login_necessario`; pelo cartão REPOSIÇÕES do portal, do escritório: abre e carrega o dado; "Atualizar" depois de 8 h diz "Sua sessão do Painel Lube expirou. Entre de novo pelo portal."; `guarda_versao` = 1.3.0; com o segredo: no `aquecer_painel.log`, status 200 e `cdn=HIT` na maior parte das chamadas, sem `ssl=sem-verificar`, e o evento do aquecedor com identidade `robo do reposicoes (aquecedor da srv-ia)` | Instant Rollback para o deployment anotado (sem guarda). A linha da central pode ficar: com `ultimo_sinal` preenchido o portal manda o passe na URL, e o site sem guarda só ignora o parâmetro |
| **Guardião**, logo depois da produção (banco DATA WAREHOUSE): o SQL "trocar" abaixo, e o mesmo no `12. GUARDIAO/db/03_catalogo.sql` (e no teste `guardiao.test.ts`) | `select saude.painel()`: o item `site:reposicoes-web` volta `ok` ("a guarda respondeu ... com a lista da central") na próxima rodada | o SQL "voltar" abaixo |

```sql
-- trocar: o Guardião passa a conferir a saúde do guarda do Reposições
update saude.alvo set config = (config - 'sem_guarda') || '{"rota":"/.sentinela/saude"}'::jsonb
 where id = 'site:reposicoes-web';
-- voltar: sem guarda, confere a página
update saude.alvo set config = config || '{"rota":"/","sem_guarda":true}'::jsonb
 where id = 'site:reposicoes-web';
```

Quem abria o Reposições pelo link passa a entrar pelo portal; a consultora externa já tem conta e permissão.

### 20.8 Passo 6 — o TI cadastra as redes (não muda nada)

| ação | conferir | voltar atrás |
|---|---|---|
| De um computador do escritório: Sentinela › Rede da Lube › **Adicionar a rede de onde estou** (descrição "Escritório Cariacica"; em IPv6 o campo já vem com o /64). Depois as outras do passo 0, item 3 (o IP do escritório também está na nota SENTINELA LUBE do cérebro) | a linha "Você está em … — rede da Lube: Escritório Cariacica"; a prévia de "Tentativas de fora" encolhe (o escritório some); "Parece rede da Lube" mostra IPs com várias pessoas que ainda faltam | **Remover** a rede (o banco recusa remover a última enquanto algum sistema exigir) |

### 20.9 Passo 7 — observar (OK do Júlio; não barra ninguém)

Ação: Rede da Lube › Modo por sistema › **Todos em observar** (`rede_modo` com `"*"`; o portal e o Reposições
entram, SAC e Supervisor não). Prazo: pelo menos **5 dias úteis e um fim de semana**.

O que olhar (todo dia):
- `/.sentinela/saude` de cada sistema: `lista.rede: "observar"` e `lista.rede_idade_s` abaixo de ~60 (acima de
  ~120 com `idade_s` pequeno = a central parou de mandar o bloco: ver §20.4).
- O topo do módulo mostra **"Seriam barrados em 24 h"** (enquanto nenhum sistema exige): é o número a acompanhar.
- **Tentativas de fora** (filtro 24 h): ninguém do escritório. Se aparecer, é rede que falta (link reserva, Wi-Fi do
  galpão) ou aparelho que esconde o IP (Retransmissão Privada do iCloud, VPN, "rede segura" do Edge, 4G): cadastrar
  a rede ou orientar a pessoa.
- Motivo com **`· IP sem x-real-ip`**: algum runtime da Vercel não mandou o `x-real-ip`. Parar aqui e corrigir
  antes de exigir (no exigir essa pessoa seria barrada).
- **Robô do Gestão TI** (08:29 e 09:27): regra `cron`, motivo terminado em "fora da rede da Lube: máquina autenticada
  pelo sistema". Se vier `fora_da_rede`, a marca `maquina` não está no ar: não exigir no Gestão TI.
- **Aquecedor do Reposições** (se tiver o segredo): regra `rede_maquina`, ou nenhum evento de rede (se a `SRV-IA`
  sair pelo IP do escritório).
- **Gestão TI**: a identidade vem do login do próprio app. Se uma pessoa liberada aparecer `fora_da_rede` só no
  Gestão TI, o e-mail do app dela é outro: acertar o e-mail antes de exigir.
- Liberações que vão ser precisas: o gestor comercial em viagem, o TI à noite, a consultora (decisão do passo 0).
- Consulta de apoio (SQL Editor, só leitura):
  ```sql
  select projeto, regra, decisao, left(motivo, 80) as motivo, count(*), count(distinct identidade) as pessoas
    from sentinela.eventos
   where criado_em > now() - interval '24 hours' and regra in ('fora_da_rede', 'rede_liberado', 'rede_maquina', 'cron')
   group by 1, 2, 3, 4 order by 5 desc;
  select projeto, origem, decisao, count(*), sum(vezes) from sentinela.rede_fora
   where ultimo_em > now() - interval '24 hours' group by 1, 2, 3 order by 4 desc;
  ```
- Logs da central sem `srv_rede_decidir falhou` / `srv_rede_lista falhou`.

Voltar atrás: **Todos em desligado** no painel (ou `update sentinela.rede_sistemas set modo = 'desligado', modo_em =
now(), modo_por = 'sql-volta' where not isento;` no SQL Editor). Chega aos guardas em até ~30 s.

### 20.10 Passo 8 — exigir (OK do Júlio; aqui começa a barrar)

Antes do 8a (v1.1): **aviso aos funcionários** (o Júlio manda): "a partir de dd/mm os sistemas da Lube só abrem na
rede da empresa. Na Lube, use o Wi-Fi da empresa (no celular, desligue os dados móveis e a VPN). De fora, só com
liberação do TI." E as liberações do passo 7 já criadas (elas valem em até 1 minuto).

| ação | conferir | voltar atrás |
|---|---|---|
| **8a.** Exigir só na **Movimentação de Inventário** por 1 dia (modal vermelho: confere quem foi visto fora e os liberados) | do escritório, tudo igual; de um celular no **4G**: login no portal (portal ainda em observar) → abrir o Inventário → aviso "só abre na rede da Lube" (o `/passe` dá 403 `fora_da_rede`); liberar a pessoa de teste → abre em até ~30 s; encerrar → barrada em até ~1 min; abrir o Inventário no Wi-Fi da Lube e trocar o celular para o 4G → 403 do guarda (página âmbar, sem código); o robô e o aquecedor seguem como no observar | Inventário em **observar** no painel |
| **8b.** Exigir nos outros sistemas: sistema por sistema, ou **Todos em exigir (menos o portal)** (v1.1: o `'*'` em exigir só pega os sistemas com "exige login"; o Painel Lube fica como está). O banco recusa sistema sem o guarda 1.3.0 visto na produção e lista os que faltam | `/.sentinela/saude` de cada um: `lista.rede: "exigir"`; "Barrados em 24 h" só com quem é de fora mesmo; nenhum barrado do escritório; nenhum "exigindo sem conferir" em Modo por sistema (`exigir_sem_guarda = 0`) | **Todos em observar** no painel |
| **8c.** Por último, exigir no **portal**, **só depois da parte D** (§13): o `office/comum.js` conferindo a rede logo depois do `getSession` (no mesmo envio, no mínimo) e, antes de dizer ao gestor que o painel está fechado, a Edge Function `office` conferindo no servidor. Sem isso, um notebook com a sessão guardada abre o LUBE OFFICE de casa | de fora, sem liberação: o login abre, e logo depois do login o portal sai da sessão e mostra "O Painel Lube só abre na rede da Lube"; `/office/` de fora com a sessão antiga também sai; o atalho do SAC e a tela de login continuam abrindo de qualquer lugar; administrador de fora com 3+ pessoas barradas do mesmo IP em 2 h vê o cartão de emergência | portal em **observar** |

Emergência (o escritório inteiro vê "só abre na rede da Lube"): §12. Pelo SQL Editor do Supabase, que não depende
da rede: `select sentinela.emergencia_rede('<IP_NOVO>', 'escritório: IP novo da operadora');` ou, sem o IP,
`select sentinela.emergencia_pausar_rede();` (todo exigir vira observar). TI de fora precisando das telas:
`select sentinela.emergencia_liberar('<e-mail do TI>', 12);`.

### 20.11 Depois (fora deste roteiro)

- Parte D: LUBE OFFICE (`office/` e a Edge Function `office`) conferindo a rede (§13): condição do 8c.
- Guardião (`12. GUARDIAO`): alarmar sistema em exigir cujo `/.sentinela/saude` não diz `lista.rede: "exigir"` ou
  tem `lista.rede_idade_s` acima de ~300, e `contagens.exigir_sem_guarda` acima de 0 (§18).
- MFA dos administradores, se o Júlio decidir (§17.1).
- Atualizar `docs/SENTINELA-ESPECIFICACAO.md` para v1.2, o README do portal e as notas do cérebro (SENTINELA LUBE,
  REPOSIÇÕES E CHAMADOS, Registro de mudanças) a cada passo publicado.
- Limites a dizer ao Júlio (§17): bancos abertos à chave pública (RH, Saída de Veículos, ICMS) e chamadas diretas ao
  Supabase com token válido não passam pelo guarda.
