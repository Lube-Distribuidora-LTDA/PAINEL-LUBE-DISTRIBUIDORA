# SENTINELA LUBE — especificação v1.1 (2026-10-06)

Documento de contrato entre as cinco peças. Quem implementa uma peça segue ESTE texto à risca nos
nomes, assinaturas e formatos JSON. Se algo aqui estiver ambíguo ou errado, escolha o caminho mais
seguro, implemente, e DIGA no relatório final o que decidiu (campo `desvios_do_spec`).

**v1.1 (2026-10-06): este texto descreve o código como ele ficou** (construção, revisão, correção e
integração de 2026-10-05, mais as pendências A–G fechadas em 2026-10-06). As seções 0–7 foram
atualizadas onde o código foi além da v1 (as mudanças de contrato estão marcadas com **(v1.1)**), e o
**§8** lista todos os desvios e decisões, peça por peça, com o motivo. Nomes de função, parâmetros e
os campos JSON da v1 continuam valendo; o que entrou foram campos **extras** e regras mais restritas.
Nada disso foi aplicado nem publicado ainda: banco, Edge Function, guardas e painel estão só no
repositório (sem commit).

## 0. O que é

Sistema de segurança do ecossistema de sistemas da Lube na Vercel. Cinco peças:

| Peça | Onde mora | O que faz |
|---|---|---|
| **Banco** | Supabase projeto "PAINEL LUBE DISTRIBUIDORA", ref `wkkdcsqwlxjxorutrbnx`, schema `sentinela` + funções `public.sentinela_*` | guarda eventos, bloqueios, confiáveis, análises, chaves; aplica as regras centrais |
| **Central** | Supabase Edge Function `sentinela` (Deno), `https://wkkdcsqwlxjxorutrbnx.supabase.co/functions/v1/sentinela/<rota>`, `verify_jwt=false` (autentica sozinha) | recebe eventos dos guardas, entrega a lista de bloqueio, emite passe/sessão, chama a IA |
| **Guarda** | `middleware.ts` em cada projeto da Vercel (estáticos) ou dentro do `src/middleware.ts` (Next.js) | na porta de cada sistema: lê IP/geo, aplica regras instantâneas e a lista, registra, bloqueia |
| **Painel** | pasta `sentinela/` do repositório do portal → `https://painel-lube-distribuidora.vercel.app/sentinela/` | globo 3D, feed ao vivo, quem está acessando, bloqueios, IA, exposições, integridade, configuração |
| **Portal** | `portal.js` do Painel Lube | emite passe ao abrir sistema, informa identidade após login, informa falha de login |

Repositório do portal (onde ficam painel, central, SQL e o guarda canônico):
`C:/Users/gti.julio.alves/Desktop/BI/1. PAINEL LUBE DISTRIBUIDORA` (site estático, sem build, sem package.json).

### Fatos verificados que o desenho usa
- Plano Vercel **Hobby** (1M invocações/mês; firewall 3 IP blocks; sem Log Drains; logs 1 h). Plano Supabase **Pro** (Edge Functions 2M/mês; pg_cron/pg_net disponíveis, não instalados; Vault instalado; pgcrypto em `extensions`).
- Team Vercel: id `team_k8YNfCDhgFwOScWnM5iHGqLC`, slug `lube-distribuidora-ltda`. Emissor OIDC do team (verificado ao vivo): `iss=https://oidc.vercel.com/lube-distribuidora-ltda`, JWKS `https://oidc.vercel.com/lube-distribuidora-ltda/.well-known/jwks`, RS256, `aud=https://vercel.com/lube-distribuidora-ltda`, claims `project`, `project_id`, `owner`, `owner_id`, `environment`.
- Supabase Auth do portal assina tokens de usuário em **ES256** (JWKS público `https://wkkdcsqwlxjxorutrbnx.supabase.co/auth/v1/.well-known/jwks.json`; na Edge Function há `SUPABASE_JWKS` injetado). `iss = https://wkkdcsqwlxjxorutrbnx.supabase.co/auth/v1`, `aud = authenticated`.
- Funções existentes: `public.is_admin()` (security definer, devolve is_admin AND ativo do usuário logado), `public.is_ativo()`.
- Tabelas do portal: `public.profiles(id, email, nome, is_admin, ativo, acesso_total, ...)`, `public.sistemas(id, slug, nome, url, ativo, ...)`, `public.permissoes(user_id, sistema_id)`, `public.permissoes_excecao(user_id, sistema_id)`. Regra de acesso a um sistema: perfil ativo E ( (acesso_total E sem linha em permissoes_excecao) OU linha em permissoes ).
- Headers Vercel: `x-real-ip` (= XFF, sobrescrito pela Vercel, não falsificável), `x-vercel-forwarded-for`, `x-vercel-ip-country`, `x-vercel-ip-country-region`, `x-vercel-ip-city` (URL-encoded → `decodeURIComponent`), `x-vercel-ip-latitude`, `x-vercel-ip-longitude`, `x-vercel-ip-timezone`, `x-vercel-id`. `x-vercel-ja4-digest` NÃO documentado (ler se existir).
- Routing Middleware (sem framework): `middleware.ts` na raiz que a Vercel usa (Root Directory). Assinatura `export default async function middleware(request, context)`; `context.waitUntil(promise)` existe sem import. **Continuar a requisição = `new Response(null, { headers: { 'x-middleware-next': '1' } })`** (é o que `next()` de `@vercel/functions` faz). `export const config = { runtime?: 'nodejs'|'edge', matcher }`. Runtime padrão hoje: nodejs. Deployment Protection roda ANTES do middleware.
- OIDC dentro do middleware: **não documentado**. O guarda procura o token em: `request.headers.get('x-vercel-oidc-token')`, depois `globalThis[Symbol.for('@vercel/request-context')]?.get?.()?.headers?.['x-vercel-oidc-token']`, depois `process.env.VERCEL_OIDC_TOKEN` (guardado por `typeof process !== 'undefined'`). Plano B: HMAC com `SENTINELA_CHAVE` (ver §3.2).
- Lube fica em **Cariacica-ES** (tráfego do escritório sai pela Conectja Telecom). Casa padrão do globo: lat -20.2632, lon -40.4165.

### Os 8 projetos (fonte da verdade para `sentinela.sistemas`)
| projeto (claim `project`) | projeto_id | nome | url de produção | sistema_slug (public.sistemas.slug) |
|---|---|---|---|---|
| painel-lube-distribuidora | prj_WGmlGvONBuausosdw6AgnDhrCnge | Painel Lube | https://painel-lube-distribuidora.vercel.app | null (é o portal) |
| painel-compras | prj_DcJI82KyPyvSc4eUMuL9iJV6I7cp | BI Compras | https://painel-compras-rosy.vercel.app | gestao-compras |
| gestao-comercial-web | prj_YZjoZIiVcDyuWVzNVXMuApfiDGYt | BI Comercial | https://gestao-comercial-web-three.vercel.app | gestao-comercial |
| gestao-finaceiro | prj_1TWb4V3Cl1m9CbOwhoXuw8fdzHwR | Gestão Financeiro | https://gestao-finaceiro.vercel.app | gestao-financeiro |
| gestao-ti | prj_sxnusj4EGtvYF30N5VxoyBbleW83 | Gestão TI | https://gestao-ti-ruddy.vercel.app | gestao-ti |
| rh-absentismo | prj_DVpjRACXDvWA5e3x87ettwPn1sJL | RH Absenteísmo | https://rh-absentismo.vercel.app | rh-absenteismo |
| gestao-de-saidas-de-veiculos | prj_ObANJiC1HKBSzrUPQdU79V4VEnLR | Saída de Veículos | https://gestao-de-saidas-de-veiculos.vercel.app | saida-veiculos |
| painel-icms | prj_5h9PoHWB6qCeoEhUNzQ4RVxnGrbn | Painel ICMS | https://painel-icms.vercel.app | painel-icms |

`arquivos_proibidos` iniciais (regex JS aplicadas ao **pathname decodificado**; nível *suspeito*, então no modo observar só registram "seria bloqueado"):
- painel-lube-distribuidora: `^/db/`, `^/supabase/`, `^/\.claude/`, `^/README\.md$`, `^/guarda/`
- rh-absentismo: `\.(xlsx?|csv|sql|ps1)$`, `^/planilhas`, `^/migrations/`, `^/dashboard_dataset\.json$`, `^/powerbi_data\.json$`, `^/generate-config\.js$`, `^/README\.md$`, `^/verify_`, `^/deploy_schema`, `^/migrate_data`
- gestao-comercial-web: `^/db/`
- gestao-de-saidas-de-veiculos: `^/processar\.py$`, `^/PLANILHAS REFERENCIAS/`, `^/design do sistema`, `^/README\.md$`
- demais: vazio.

## 1. Regras de decisão (iguais no guarda e no banco)

**Decisões:** `liberado` · `observado` (seria bloqueado no modo proteger) · `bloqueado`.
**Modos:** `observar` (padrão) e `proteger`.
**Níveis de bloqueio:** `certo` (sempre aplicado, em qualquer modo) e `suspeito` (aplicado só no modo `proteger`; no `observar` vira `observado`).
**Confiável:** IP/CIDR na lista de confiáveis (manual ou aprendido por login). Confiável NUNCA recebe bloqueio automático de IP e ignora o nível suspeito. Ataque certo vindo de confiável é barrado só na requisição (403) e marcado com risco 100 e motivo "ataque partindo de rede confiável — verificar máquina".
**País nunca bloqueia sozinho.** Acesso legítimo de qualquer lugar entra. País entra só como contexto da IA e como sinal fraco de risco.

| regra | onde | nível | gatilho | ação automática de IP |
|---|---|---|---|---|
| `ferramenta` | guarda | certo | user-agent de ferramenta ofensiva: `sqlmap|nikto|nmap|masscan|zgrab|nuclei|wpscan|dirbuster|gobuster|ffuf|feroxbuster|hydra|acunetix|nessus|openvas|w3af|arachni|jaeles|zmeu|morfeus|l9explore|fuzz faster|commix|xsstrike|whatweb|wfuzz` (case-insensitive) | banco: bloqueio certo 24 h |
| `varredura` | guarda | certo | pathname casa com `^/\.(env|git|svn|hg|aws|ssh|DS_Store|htaccess|htpasswd)`, `^/wp-(admin|login|content|includes|json)`, `xmlrpc\.php`, `\.(php\d?|asp|aspx|jsp|cgi|pl)$`, `^/phpmyadmin`, `^/pma/`, `^/cgi-bin/`, `^/vendor/phpunit`, `^/server-status`, `^/actuator`, `^/boaform`, `^/HNAP1`, `^/owa/`, `^/autodiscover`, `^/solr/`, `^/_ignition`, `^/telescope`, `^/\.well-known/(?!acme-challenge|security\.txt)`, `^/(config|credentials|secrets?)\.(ya?ml|ini|bak|old)$`, `\.(bak|old|swp|save)$` (case-insensitive) | banco: bloqueio certo 24 h; 3 ou mais bloqueios certos do mesmo IP em 7 dias → 7 dias |
| `injecao` | guarda | certo | (pathname + search) decodificado casa com `\.\./`, `\.\.\\`, `<script`, `javascript:`, `union(\s|\+|/\*.*\*/)+select`, `information_schema`, `\bsleep\(\s*\d`, `benchmark\(`, `\$\{jndi:`, `/etc/passwd`, `cmd\.exe`, `'\s*or\s*'?1'?\s*=\s*'?1`, `\bor\s+1\s*=\s*1\b` (case-insensitive) | banco: bloqueio certo 24 h |
| `lista` | guarda | o do bloqueio | IP (exato/CIDR) ou JA4 com bloqueio ativo. **(guarda 1.1.0)** Bloqueio suspeito não barra quem tem identidade: segue, decisão `observado`, motivo `... · com login: não barrado` | — |
| `arquivo_proibido` | guarda | suspeito | pathname casa com `sistema.arquivos_proibidos` | banco: nenhum bloqueio de IP (só registra) |
| `buscador` **(guarda 1.1.0)** | guarda | suspeito | UA `googlebot|bingbot|duckduckbot|yandexbot|baiduspider|applebot` em `tipo` pagina ou api (arquivo, como `robots.txt`, segue). Antes da 1.1.0 era exceção observada | banco: nenhum bloqueio de IP |
| `robo` | guarda (marca) / banco (bloqueia) | suspeito | `tipo` pagina ou api e UA: vazio; cliente HTTP/automação `curl|wget|python-requests|python-urllib|python/|aiohttp|httpx|go-http-client|okhttp|java/|libwww-perl|lwp::|axios|node-fetch|undici|postmanruntime|insomnia|headlesschrome|headless|phantomjs|slimerjs|puppeteer|playwright|selenium|webdriver|lighthouse|scrapy|httpclient|powershell|guzzlehttp|httpie|fasthttp|go-resty|deno/|\bbun/|dalvik/|^node$`. **(guarda 1.1.0)** Também: varredor conhecido `censys|shodan|zoomeye|netcraft|leakix|l9scan|l9tcpid|expanse|paloaltonetworks|recordedfuture|recorded future|nomorevibe|internet-?measurement|researchscan|onyphe|binaryedge|criminalip|stretchoid|shadowserver|project sonar|modatscanner|chatgpt-user|claude-user|perplexity|mistralai-user|meta-externalagent|anthropic-ai|cohere-ai|googleother|google-inspectiontool|ia_archiver|slurp`; palavra de rastreador `bot(?![a-z])|crawl|spider|scanner|inventory|monitor|probe|fetch|scraper|harvest|indexer|archiver|checker|validator` e endereço no UA `https?://|www\.|@dominio.tld|(+` ou `;+`, as duas testadas no UA sem os dados do aparelho e do app (`semAparelho`: sai todo parêntese, com um nível aninhado, que contém `android|iphone|ipad|ipod` ou vem depois de `Android `; todo colchete `[...]`; e as marcas `cubot|fossibot`); `Mozilla/...` sem motor `applewebkit|gecko|trident|presto|khtml|goanna` (ex.: `Mozilla/5.0 (compatible)`); e, só em pagina, UA que não começa com `Mozilla/` nem `Opera/` (case-insensitive) | banco: ≥ 20 eventos `robo` do IP em 10 min → bloqueio suspeito 1 h |
| `nao_navegador` **(guarda 1.1.0)** | guarda | suspeito | `tipo` pagina, método GET ou HEAD, sem `sec-fetch-mode` **e** sem `accept-language` (vazio conta como ausente). Não vale para api, arquivo, outros métodos nem IP confiável | banco: nenhum bloqueio de IP |
| `rajada` | banco | suspeito | > `config.limite_rajada_min` (padrão 120) eventos do IP nos últimos 60 s | bloqueio suspeito 15 min |
| `tor` | banco | suspeito | IP em `sentinela.tor_saidas` | bloqueio suspeito 24 h |
| `forca_bruta` | banco | suspeito | ≥ 5 tentativas de login falhas do IP em 10 min | bloqueio suspeito 1 h |
| `ia` | central/banco | suspeito | IA: veredito `malicioso`, confiança ≥ `config.ia_confianca_min` (0,85), ação `bloquear_*` | bloqueio suspeito com a duração pedida (1h/24h/7d) |
| `sem_login` | guarda | — (sempre aplicado quando `sistema.exige_login`) | sistema com `exige_login=true`, sem sessão válida, caminho fora de `rotas_publicas` | — (página → 302 para o portal; resto → 401 JSON). Registrado com decisão `bloqueado`, regra `sem_login` |

Exceções do guarda (antes das regras de user-agent): UA que **começa** com `vercel-cron/<dígito>` → liberado, regra `cron`; UA de prévia de link (`whatsapp|telegrambot|slackbot|facebookexternalhit|twitterbot|linkedinbot|discordbot|skypeuripreview|microsoftpreview`) → liberado, regra `previa_link`; **(guarda 1.1.0)** Office (`^Microsoft Office (Existence|Protocol) Discovery`, `^Microsoft Office (Word|Excel|PowerPoint|OneNote|Outlook|Access|Visio|Publisher|Project) \d{4}`, `\bms-office\b`, `^Microsoft Office/\d+\.\d+ (`) → liberado, regra `office`; navegador simples ou leitor de pessoa (`^w3m/`, `^Lynx/`, `^Links (`, `^ELinks/`, `^Dillo/`, `NetSurf/`, `^UCWEB/`, `UCBrowser/`, `Google-Read-Aloud`, `^AndroidDownloadManager/`) → liberado, regra `navegador_simples`. **(guarda 1.1.0)** UA que também casa com a lista de cliente HTTP da regra `robo` (fora o `Apache-HttpClient` do `LinkedInBot/`), com varredor conhecido ou com buscador não é exceção. **(guarda 1.1.0)** Buscadores deixaram de ser exceção: são a regra suspeita `buscador` (tabela acima), que barra no modo proteger. **(v1.1)** As exceções valem só a partir das regras de user-agent: um UA falsificado (WhatsApp, vercel-cron) não escapa de ferramenta/varredura/injecao/lista/arquivo_proibido e nunca dispensa `sem_login` (rota de cron num sistema com login vai em `rotas_publicas`).

**(guarda 1.1.0, 2026-10-07) Regras de user-agent do nível suspeito.** Decisão do Júlio: só entra quem acessa
pelo login do Painel Lube, e robô não chega nem à tela de login. Ordem no guarda, depois de `arquivo_proibido` e
das exceções: `buscador` → `robo` → `nao_navegador` (a primeira que casar). As três:
- valem só para quem **não tem identidade** (cookie de sessão válido da Sentinela ou `opcoes.identidade` do app):
  pessoa logada não é robô, seja qual for o UA ou os cabeçalhos. Ataque certo, `lista` e `arquivo_proibido`
  continuam valendo para quem tem identidade;
- seguem a regra do nível suspeito: proteger → 403; observar → `observado`; IP confiável → ignorado (liberado,
  motivo "rede confiável: ... (ignorado)"); `nao_navegador` nem é avaliado para IP confiável;
- não pegam navegador de verdade (Chrome, Edge, Firefox, Safari, Samsung Internet, Opera, WebView do Android,
  navegador dentro do Instagram/Threads/Facebook/LinkedIn/TikTok/Telegram/Snapchat, celular Cubot e FOSSiBOT): a suíte passa 36 UAs reais com os
  cabeçalhos de navegação que eles mandam, mais Safari antigo e IE 11 (sem `sec-fetch-*`, com
  `accept-language`), e todas as expressões são lineares no tamanho do UA (UA hostil de 16 KB < 5 ms).
Motivos gravados: `buscador: <nome>`, `user-agent vazio`, `user-agent de robô: <lib>`, `varredor conhecido: <nome>`,
`user-agent de rastreador: <palavra>`, `user-agent com endereço de contato (marca de robô)`, `user-agent genérico:
Mozilla sem motor de navegador`, `user-agent sem cara de navegador`, `não é navegador: página pedida sem
sec-fetch-mode e sem accept-language`. O banco ainda não tem risco base para `nao_navegador` (cai no `else 0`, mais
os modificadores de página sem `sec_fetch_mode` e sem idioma) e a regra automática de IP do banco conta só `robo`.

**(v1.1) Exceção cross-site — varredura e injeção pedidas por outro site (pendência B, 2026-10-06).**
Um site malicioso pode fazer o navegador de um funcionário pedir `/.env` ou `/?id=1 UNION SELECT` (por
`<img>`, `<script>` ou link). Se o funcionário fosse bloqueado por isso, qualquer site bloquearia quem o
visitasse. Por isso, quando a regra é `varredura` ou `injecao` **e** `sec_fetch_site = 'cross-site'`:
- a requisição continua levando 403 (o caminho de ataque nunca é servido);
- o evento é gravado normalmente (decisão `bloqueado`, risco ≥ 90), com o motivo marcado
  **"possível requisição forjada por outro site (cross-site): sem bloqueio de IP"** (o guarda já manda o
  motivo assim; o banco acrescenta a marca quando ela não veio, sem repetir);
- **não** gera bloqueio automático de IP: nem no mapa local de 24 h do guarda, nem no banco (o evento não
  entra nas regras certas do `srv_registrar`, inclusive a reincidência de 7 dias).
`ferramenta` (user-agent de ataque) continua bloqueando o IP mesmo cross-site, porque o navegador da
vítima não manda esse user-agent. O cabeçalho é falsificável: quem o forja perde só o bloqueio de IP;
cada requisição de ataque continua barrada.

**(v1.1) IPv6:** as regras automáticas do banco (teto de gravação, primeira vez, robô, rajada, força
bruta, ataques certos e IA) contam e bloqueiam o **/64** (bloqueio tipo `cidr`); cai para /128 se o /64
encosta num confiável. Tor continua por IP exato.

**(v1.1)** Os gatilhos de `varredura` e `injecao` ficaram mais precisos no guarda: `/.well-known/` por
lista de nomes liberados (o que navegador e cliente pedem sozinhos), dotfiles e `wp-*` em qualquer
profundidade, UNION testado depois de tirar os comentários `/* */` em tempo linear, URL inteira testada
(sem teto de 8 KB), e `cmd.exe` / `..\` / `javascript:` exigindo contexto de ataque quando estão na
consulta (não no caminho). Detalhes em §8.3.

**Risco (0–100) por evento**, calculado no banco: base por regra (ferramenta 95, injecao 95, varredura 90, lista 80, rajada 70, arquivo_proibido 60, tor 60, forca_bruta 70, robo 50, sem_login 30, buscador 10, sem regra 0) + modificadores: página sem `sec_fetch_mode` (+15), sem `idioma` (+10), país ≠ BR e IP visto pela primeira vez (+10), identidade confirmada (−50), confiável (−40). Limitar a [0,100].

**Quem vai para a IA:** IPs do lote com risco ≥ 30, OU vistos pela primeira vez fora do BR sem identidade; que não sejam confiáveis, não tenham bloqueio certo ativo, e não tenham análise nas últimas 6 h. Máximo 3 por lote; cota global `config.ia_limite_hora` (60) análises/hora.

## 2. Banco (schema `sentinela`)

Toda tabela com RLS ligado e SEM políticas; `revoke all on schema sentinela from public, anon, authenticated`; as funções `public.sentinela_*` são `security definer`, `set search_path = sentinela, public, extensions, pg_temp`.
Funções `public.sentinela_srv_*`: `revoke execute ... from public, anon, authenticated; grant execute ... to service_role`.
Funções de painel `public.sentinela_*` (sem `srv`): `revoke ... from public, anon; grant execute ... to authenticated`, e a PRIMEIRA linha do corpo é `if not public.is_admin() then raise exception 'sentinela: acesso restrito ao TI' using errcode = '42501'; end if;`.

### Tabelas
```
sentinela.config (1 linha; id boolean pk default true check (id))
  modo text not null default 'observar' check (modo in ('observar','proteger'))
  casa_nome text not null default 'Lube Distribuidora · Cariacica-ES'
  casa_lat double precision not null default -20.2632
  casa_lon double precision not null default -40.4165
  limite_rajada_min int not null default 120
  limite_eventos_ip_min int not null default 30      -- eventos gravados por IP por minuto; acima disso só conta em ips.descartados
  ia_limite_hora int not null default 60
  ia_confianca_min numeric not null default 0.85
  ia_status text not null default 'desconhecido' check (ia_status in ('desconhecido','ligada','sem_chave','erro'))
  ia_status_detalhe text, ia_status_em timestamptz
  tor_atualizado_em timestamptz
  manutencao_em timestamptz
  retencao_dias int not null default 90
  atualizado_em timestamptz not null default now(), atualizado_por text

sentinela.sistemas
  projeto_id text pk, projeto text not null unique, nome text not null, url text not null,
  sistema_slug text, exige_login boolean not null default false,
  rotas_publicas text[] not null default '{}', arquivos_proibidos text[] not null default '{}',
  ultimo_sinal timestamptz, guarda_versao text, guarda_runtime text, ultimo_ambiente text,
  ativo boolean not null default true

sentinela.eventos
  id bigint generated always as identity pk, criado_em timestamptz not null default now(), ts_guarda timestamptz,
  projeto text not null, ambiente text not null default 'production',
  host text, metodo text, caminho text, consulta text, tipo text check (tipo in ('pagina','api','arquivo','outro')),
  ip inet not null, pais text, regiao text, cidade text, lat double precision, lon double precision, fuso text,
  ua text, idioma text, referer text, ja4 text, vercel_id text,
  sec_fetch_site text, sec_fetch_mode text, sec_fetch_dest text,
  decisao text not null check (decisao in ('liberado','observado','bloqueado')),
  regra text, motivo text, risco smallint not null default 0,
  identidade text, identidade_origem text check (identidade_origem in ('passe','sessao_app','provavel') or identidade_origem is null),
  guarda text, selo_anterior text, selo text not null
  índices: (criado_em desc), (ip, criado_em desc), (projeto, criado_em desc), (decisao, criado_em desc)
  Só INSERT. Gatilho BEFORE UPDATE → erro. BEFORE DELETE → erro, exceto quando current_setting('sentinela.limpeza', true) = 'on' (só a manutenção liga).

sentinela.cadeia (1 linha; id boolean pk default true check(id)) ultimo_id bigint, ultimo_selo text, atualizado_em timestamptz
  Gatilho BEFORE INSERT em eventos: `select ... from sentinela.cadeia for update` (serializa), NEW.selo_anterior := ultimo_selo,
  NEW.selo := encode(extensions.digest(coalesce(NEW.selo_anterior,'') || '|' || <canon>, 'sha256'), 'hex'), atualiza cadeia.
  <canon> = concat_ws('|', NEW.id, to_char(NEW.criado_em at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), NEW.projeto,
            host(NEW.ip), coalesce(NEW.metodo,''), coalesce(NEW.caminho,''), NEW.decisao, coalesce(NEW.regra,''),
            coalesce(NEW.identidade,''), coalesce(NEW.ua,''))

sentinela.bloqueios
  id bigint identity pk, tipo text check (tipo in ('ip','cidr','ja4')), valor text not null, rede cidr (preenchido p/ ip e cidr),
  nivel text check (nivel in ('certo','suspeito')), origem text check (origem in ('regra','ia','manual')),
  regra text, motivo text not null, criado_em timestamptz default now(), expira_em timestamptz (null = permanente),
  revogado_em timestamptz, revogado_por text, criado_por text, evento_id bigint, analise_id bigint,
  hits int not null default 0, ultimo_hit timestamptz
  ATIVO = revogado_em is null and (expira_em is null or expira_em > now())
  índice gist (rede inet_ops) where revogado_em is null; índice (tipo, valor)
  Não criar bloqueio duplicado: se já existe ativo para o mesmo valor com nível ≥, estende expira_em (máximo dos dois) e soma hits.
  (v1.1) Junta só com o mesmo tipo, valor, NÍVEL e ORIGEM (suspeito não alonga certo; manual tem linha própria;
  entre dois manuais vale o motivo e o autor do último). Ao estender: hits + 1 e ultimo_hit. tipo, nivel e origem
  são NOT NULL; check: rede preenchida só para tipo ip/cidr.

sentinela.confiaveis
  id identity pk, tipo text check (tipo in ('ip','cidr')), valor text, rede cidr not null, descricao text not null,
  origem text check (origem in ('manual','login')), identidade text, criado_em timestamptz default now(),
  expira_em timestamptz (login: now()+7 dias, renovado a cada login; manual: null), removido_em timestamptz, criado_por text
  ATIVO = removido_em is null and (expira_em is null or expira_em > now())

sentinela.ips  (perfil por IP)
  ip inet pk, primeiro_visto, ultimo_visto timestamptz not null, total bigint default 0, descartados bigint default 0,
  pais, regiao, cidade text, lat, lon double precision, ua_ultimo text, projetos text[] default '{}',
  risco_max smallint default 0, identidade text, identidade_em timestamptz, ultima_analise_em timestamptz, ultimo_veredito text
  (v1.1) colunas internas: janela_inicio, janela_total, janela_anterior (rajada em janela deslizante estimada com
  duas janelas de 60 s, contando também o que o teto descartou) e analise_pedida_em (o IP não volta para a IA por 10 min)

sentinela.identidades  id identity pk, ip inet not null, user_id uuid, email text not null,
  origem text check (origem in ('portal','passe','sessao_app')), ua text, criado_em timestamptz default now()
sentinela.tentativas_login  id identity pk, ip inet not null, usuario text, ua text, criado_em timestamptz default now()
sentinela.analises  id identity pk, ip inet not null, criado_em timestamptz default now(), modelo text,
  veredito text check (veredito in ('legitimo','suspeito','malicioso','erro')), confianca numeric, motivo text, acao text,
  aplicado text, tokens_entrada int, tokens_saida int, erro text
sentinela.tor_saidas  ip inet pk, atualizado_em timestamptz default now()
sentinela.passes_usados  jti text pk, usado_em timestamptz default now(), projeto text, email text
sentinela.chaves  kid text pk, alg text default 'ES256', publica jsonb not null, segredo_id uuid not null (vault.secrets.id), criada_em timestamptz default now(), ativa boolean default true
sentinela.exposicoes  id identity pk, sistema text, severidade text check (severidade in ('critica','alta','media','baixa')),
  titulo text, evidencia text, recomendacao text, status text default 'aberta' check (status in ('aberta','aceita','corrigida')),
  decisao text, verificado_em timestamptz default now(), atualizado_em timestamptz default now()
sentinela.acoes_admin  id identity pk, criado_em timestamptz default now(), email text, acao text, dados jsonb
(v1.1) sentinela.cache_kpis  cache de 10 s dos KPIs (painel e novos), com RLS
```
Seeds: 1 linha em config, 1 em cadeia, os 8 sistemas (tabela acima, com `arquivos_proibidos`), e as exposições do §6.

**(v1.1) Eventos e cadeia.** TRUNCATE em eventos também é barrado (gatilho de statement). O gatilho de selo força
`NEW.criado_em = now()` e renumera `NEW.id` (nextval) quando o id chegou ≤ `cadeia.ultimo_id`, para a ordem de id ser
a ordem da cadeia (ids podem ter buracos); `srv_registrar` trava a cadeia no início de cada lote. O canon da v1 ficou
igual; para ele ser injetivo, `|` no caminho vira `%7C`, identidade com `|` vira null e um CHECK proíbe `|` em
projeto, metodo, caminho, decisao, regra e identidade (só o ua pode ter `|`); `verificar_cadeia` acusa registro com `|`.

**(v1.1) Toda `srv_*` começa com `perform sentinela.so_central()`**, que dá 42501 ("função restrita à Central") para os
papéis anon e authenticated mesmo se um grant vazar. A seção de privilégios roda antes dos seeds. A migração não tem
`begin/commit` próprio: aplique numa transação só (`psql -1`, SQL Editor ou apply_migration). Objetos internos novos
(sem acesso pela API): `regex_problema`, `rede_auto`, `alvo_auto`, `so_central`, `janela_estimada`, `janela_ini`,
`kpis_cacheados`, `manutencao`, índice `ips_pedida_idx`, tabela `cache_kpis`.

### Funções do servidor (só service_role) — assinaturas EXATAS
```
public.sentinela_srv_lista(p_projeto text) returns jsonb
  → {"v":1,"gerado_em":iso,"ttl":20,"modo":"observar|proteger",
     "bloqueios":[{"id":123,"t":"ip|cidr|ja4","v":"1.2.3.4","n":"certo|suspeito","ate":iso|null}],   -- só ativos, máx 5000, mais novos primeiro
     "confiaveis":[{"t":"ip|cidr","v":"..."}],                                                        -- só ativos
     "sistema":{"projeto":..,"projeto_id":"prj_..","nome":..,"sistema_slug":..|null,"exige_login":bool,"rotas_publicas":[..],"arquivos_proibidos":[..]} | null,
     "portal":"https://painel-lube-distribuidora.vercel.app",
     "tor_atualizado_em":iso|null}
  (as chaves públicas do passe NÃO vêm do banco aqui; a Central acrescenta "chaves":[jwk...] na resposta)
  (v1.1) extras: sistema.projeto_id (pendência D: a Central confere o project_id do OIDC contra ele, §3.2) e
  tor_atualizado_em (a Central decide quando renovar a lista Tor). No corte dos 5000 entram primeiro os manuais,
  depois os certos, os permanentes e os mais novos; a saída continua do mais novo para o mais antigo.

public.sentinela_srv_registrar(p_projeto text, p_ambiente text, p_guarda text, p_runtime text, p_eventos jsonb) returns jsonb
  p_eventos = array de Evento (§3.3), já saneado pela Central.
  Faz, por evento: aplica teto limite_eventos_ip_min (acima → só soma ips.descartados), calcula risco, insere em eventos,
  upsert em ips (projetos = array distinto), soma hits no bloqueio casado quando decisao='bloqueado' e regra='lista'.
  Depois aplica as regras centrais do §1 (ferramenta/varredura/injecao → bloqueio certo; rajada; robo; tor) criando/estendendo bloqueios
  com origem 'regra' (nunca para confiável). Atualiza sistemas.ultimo_sinal/guarda_versao/guarda_runtime/ultimo_ambiente.
  → {"gravados":n,"descartados":n,"bloqueios_novos":[{"id":..,"v":..,"n":..,"regra":..,"ate":..}],"analisar":["ip",...]}
  (v1.1) Projeto fora de sentinela.sistemas ou p_eventos que não é lista → 22023. No máximo 100 eventos por chamada;
  IP ou decisão inválidos contam em "descartados" do retorno (não em ips.descartados). Regras certas valem também para
  eventos descartados pelo teto. Varredura/injeção com sec_fetch_site 'cross-site' NÃO entram nas regras certas e saem
  com o motivo "possível requisição forjada por outro site (cross-site): sem bloqueio de IP" (§1, pendência B).
  Reincidência de varredura: conta os bloqueios certos do alvo em 7 dias, incluindo o que está nascendo. Risco: Tor usa
  base max(regra, 60); "identidade confirmada" = identidade_origem passe ou sessao_app; "país ≠ BR" só com país conhecido.
  bloqueios_novos lista só os criados (não os estendidos). "analisar": no máximo min(3, cota restante), descontando os
  IPs já entregues e ainda sem resposta (analise_pedida_em < 10 min), no máximo 1 IP por /64.

public.sentinela_srv_contexto_ip(p_ip text) returns jsonb
  → {"ip","perfil":{...ips},"confiavel":bool,"tor":bool,"bloqueios":[últimos 10],"identidades":[últimas 10, e-mail],
     "tentativas_10min":n,"eventos":[últimos 40: criado_em,projeto,metodo,caminho,consulta,tipo,pais,cidade,ua,idioma,sec_fetch_mode,decisao,regra,risco,identidade]}

public.sentinela_srv_registrar_analise(p_ip text, p_dados jsonb) returns jsonb
  p_dados = {"modelo","veredito","confianca","motivo","acao","tokens_entrada","tokens_saida","erro"}
  Política: se veredito='malicioso' e confianca >= config.ia_confianca_min e acao in (bloquear_1h|bloquear_24h|bloquear_7d) e IP não confiável
  → cria bloqueio nivel 'suspeito', origem 'ia', regra 'ia', motivo = 'IA: ' || motivo; aplicado = 'bloqueio #id' (modo proteger) ou
  'seria bloqueado (modo observar) #id'. Confiável → aplicado 'confiável: ignorado'. Senão 'nenhum'. Atualiza ips.ultima_analise_em/ultimo_veredito.
  → {"analise_id":..,"aplicado":".."}
  (v1.1) O bloqueio da IA é linha própria (suspeito, origem ia, analise_id) e o "aplicado" aponta para ela; veredito
  desconhecido vira 'erro'; IP inválido → 22023. Em IPv6 o alvo é o /64.

public.sentinela_srv_ia_cota() returns int                      -- análises restantes nesta hora (config.ia_limite_hora - análises da última hora)
public.sentinela_srv_ia_status(p_status text, p_detalhe text) returns void
public.sentinela_srv_identidade(p_ip text, p_user_id uuid, p_email text, p_origem text, p_ua text) returns jsonb
  insere identidades; ips.identidade/identidade_em; confiável origem 'login' /32 (ou /128) com expira_em now()+7d (renova se existir) → {"ok":true}
  (v1.1, pendência A) Se p_user_id for nulo ou NÃO existir public.profiles com id = p_user_id e ativo = true →
  {"ok":false,"motivo":"perfil_inativo"}, SEM inserir em identidades e sem tocar em sentinela.ips nem em confiáveis
  (cadastro pendente ou conta desativada não tira o IP da IA nem vira "provável" no painel). IP, e-mail ou origem
  inválidos → 22023 (antes da checagem do perfil). Com perfil ativo, o confiável de login NÃO é aprendido para saída
  Tor, para IP com bloqueio certo ativo, nem para IP cuja confiança o TI removeu há menos de 30 dias; quando aprende,
  revoga os bloqueios automáticos (origem regra/ia) que encostam no IP (revogado_por 'login de <email>').
public.sentinela_srv_tentativa(p_ip text, p_usuario text, p_ua text) returns jsonb
  insere; se ≥5 em 10 min e não confiável → bloqueio suspeito 1 h regra 'forca_bruta' → {"ok":true,"bloqueado":bool}
  (v1.1) conta e bloqueia o /64 em IPv6. p_usuario chega mascarado (j***@dominio, §3).
public.sentinela_srv_permissao(p_user_id uuid, p_sistema_slug text) returns jsonb
  → {"permitido":bool,"motivo":"..","email":..,"nome":..,"projeto":..,"url":..,"guarda_ativo":bool}   (projeto/url de sentinela.sistemas pelo sistema_slug)
  (v1.1) Mesma regra do portal.js: perfil ativo, public.sistemas.ativo e sentinela.sistemas.ativo, e acesso_total sem
  exceção (uma linha em permissoes não reabre sistema excetuado) ou, sem acesso_total, linha em permissoes.
  motivo ∈ perfil_inexistente | perfil_inativo | sistema_desconhecido | sistema_inativo | excecao_acesso_total |
  acesso_total | permissao | sem_permissao (o perfil é conferido antes do sistema; a Central usa os dois primeiros).
  guarda_ativo (pendência E) = sentinela.sistemas.ultimo_sinal is not null (o guarda do sistema já falou com a Central);
  sempre booleano, false para sistema desconhecido.
public.sentinela_srv_passe_usar(p_jti text, p_projeto text, p_email text) returns boolean   -- true só no primeiro uso
public.sentinela_srv_chave_ativa() returns jsonb      -- {"kid","publica":jwk,"privada":jwk-texto} lida do Vault, ou null
public.sentinela_srv_chave_criar(p_kid text, p_publica jsonb, p_privada text) returns jsonb
  se já há chave ativa, devolve a existente (corrida); senão vault.create_secret(p_privada, 'sentinela_chave_'||p_kid, 'chave privada ES256 da Sentinela')
  e insere em chaves. Devolve {"kid","publica","privada"}.
  (v1.1) Valida o JWK: EC P-256, x e y com 43 caracteres base64url, pública sem "d", privada em JSON com "d" e os mesmos
  x/y. A pública é guardada só com kty/crv/x/y.
public.sentinela_srv_chaves_publicas() returns jsonb   -- [jwk públicos das chaves ativas, com kid, alg ES256, use sig]
public.sentinela_srv_tor_atualizar(p_ips text[]) returns int    -- substitui o conteúdo; grava config.tor_atualizado_em
  (v1.1) lista sem nenhum IP válido não apaga a atual (devolve 0 e não mexe em tor_atualizado_em); máximo 50000 itens.
public.sentinela_srv_manutencao() returns jsonb       -- no máximo 1x/dia (config.manutencao_em): apaga eventos > retencao_dias
  (set_config('sentinela.limpeza','on',true)), tentativas > 30 d, passes_usados > 2 d → {"apagados":{...}}
  (v1.1) Trabalha em lotes de 100 mil (sempre um começo contínuo da cadeia, por id), para em cerca de 3 s e só grava
  manutencao_em quando o atraso zera; enquanto houver atraso pode rodar mais de 1x/dia. Apaga também identidades com
  mais de retencao_dias (dado pessoal); retenção mínima 7 dias. pg_try_advisory_xact_lock em vez de travar config.
  → {"apagados":{"eventos","tentativas_login","passes_usados","identidades"},"executada":bool,"pendente":bool}
     | {"apagados":{},"executada":false,"ocupada":true} | {...,"executada":false,"proxima_em":iso}
```

### Funções do painel (authenticated + is_admin) — assinaturas EXATAS
```
public.sentinela_painel(p_horas int default 24) returns jsonb
  {"agora":iso,"modo":..,"casa":{"nome","lat","lon"},
   "ia":{"status","detalhe","status_em","analises_janela":n,"ultima_em":iso|null,"limite_hora":n},
   "kpis":{"acessos":n,"bloqueados":n,"observados":n,"ips":n,"paises":n,"analises":n,"identificados":n},
   "por_hora":[{"h":iso-hora,"liberado":n,"observado":n,"bloqueado":n}],          -- p_horas buckets, inclusive vazios
   "pontos":[{"ip","lat","lon","cidade","regiao","pais","total","bloqueados","observados","status","risco","ultimo"}],  -- por IP na janela, com lat/lon, máx 500
   "visitantes":[{"ip","pais","regiao","cidade","lat","lon","identidade","identidade_origem","confiavel":bool,"ua":..,
                  "projetos":[..],"total","ultimo","risco","status":"bloqueado|observado|analise|seguro","status_motivo":..,
                  "bloqueio":{"id","nivel","regra","ate","motivo"}|null,"veredito":{"veredito","confianca","motivo","em"}|null}],  -- máx 300, ultimo desc
   "feed":[últimos 40 eventos: {"id","criado_em","projeto","sistema_nome","metodo","caminho","ip","pais","cidade","decisao","regra","motivo","risco","identidade"}],
   "sistemas":[{"projeto","nome","url","ultimo_sinal","guarda_versao","guarda_runtime","exige_login","acessos":n,"bloqueados":n}],
   "contagens":{"bloqueios_ativos":n,"confiaveis_ativos":n,"exposicoes":{"critica":n,"alta":n,"media":n,"baixa":n}},
   "cadeia":{"ultimo_id","ultimo_selo"},"ultimo_id":maior id de evento}
  status do visitante: bloqueado (bloqueio ativo aplicável: certo, ou suspeito em modo proteger) > observado (bloqueio suspeito em
  modo observar, ou evento observado na janela) > analise (IA pendente: risco≥30 sem análise) > seguro.
  "identidade_origem":"provavel" quando a identidade vem de ips.identidade (login visto deste IP) e não do próprio evento.
  (v1.1) Extras: visitantes[].bloqueio ganhou "tipo","valor","origem" (o painel mostra o alvo ao Liberar sem outra RPC);
  sistemas[].sistema_slug e "rotas_publicas"/"arquivos_proibidos" na config; ia.modelo. A janela é alinhada à hora
  (sentinela.janela_ini: de date_trunc(hora) − (p_horas−1) h; cobre de 23 a 24 h), igual em por_hora, kpis e novos;
  por_hora em horas UTC. kpis vêm de um cache de 10 s comum a painel e novos (as duas funções são volatile; a gravação do
  cache é pulada em transação read-only). kpis.analises e ia.analises_janela não contam veredito 'erro';
  kpis.identificados inclui a identidade provável; contagens.exposicoes conta status <> 'corrigida'.
  Status: acesso barrado na janela também dá 'observado' (status_motivo = regra do último evento observado/bloqueado);
  bloqueio suspeito não vale para confiável; 'analise' = risco ≥ 30, não confiável e sem análise em 6 h.
  status_motivo é o código da regra (^[a-z_]+$). Datas de todo JSON em ISO UTC 'YYYY-MM-DDTHH:MM:SS.mmmZ'.

public.sentinela_novos(p_desde_id bigint) returns jsonb
  {"eventos":[até 100 eventos com id > p_desde_id, ordem crescente, mesmo formato do feed + lat,lon],"ultimo_id":..,
   "kpis":{mesmo formato, janela 24 h}}
  (v1.1) p_desde_id nulo ou negativo → os últimos 100; sem eventos novos, ultimo_id = max(id).
public.sentinela_ip(p_ip text) returns jsonb               -- detalhe para a gaveta: = contexto_ip + análises (10) + confiável
  (v1.1) extra "confiaveis": os registros ativos que cobrem o IP (a gaveta usa para "Remover confiança"). IP nunca visto
  devolve o objeto com perfil null; IP inválido → 22023.
public.sentinela_lista_bloqueios(p_incluir_inativos boolean default false) returns jsonb   -- [{"id","tipo","valor","nivel","origem","regra","motivo","criado_em","expira_em","revogado_em","hits","ultimo_hit","ativo"}]
public.sentinela_lista_confiaveis() returns jsonb          -- [{"id","tipo","valor","descricao","origem","identidade","criado_em","expira_em","ativo"}]
public.sentinela_lista_analises(p_limite int default 100) returns jsonb
public.sentinela_lista_exposicoes() returns jsonb
public.sentinela_config_ler() returns jsonb                -- {"config":{...},"sistemas":[...]}
public.sentinela_acao(p_acao text, p_dados jsonb) returns jsonb
  p_acao:
   'bloquear'    {"valor":"ip ou cidr","duracao":"1h|24h|7d|permanente","motivo":".."} → nivel certo, origem manual
   'desbloquear' {"id":n}
   'confiar'     {"valor":"ip ou cidr","descricao":".."}
   'desconfiar'  {"id":n}
   'modo'        {"modo":"observar|proteger"}
   'casa'        {"nome","lat","lon"}
   'sistema'     {"projeto":"..","exige_login"?:bool,"rotas_publicas"?:[..],"arquivos_proibidos"?:[..]}
   'exposicao'   {"id":n,"status":"aberta|aceita|corrigida","decisao":".."}
   'limites'     {"limite_rajada_min"?,"ia_limite_hora"?,"ia_confianca_min"?}
  Valida tudo (inet/cidr válidos, enums). Registra em acoes_admin com auth.jwt()->>'email'. → {"ok":true, ...}
  (v1.1) Regras de valor e retorno:
   - erros vêm prontos para a tela (prefixo 'sentinela: '): 22023 = validação, P0002 = não encontrado;
   - 'bloquear' e 'confiar': rede mínima /16 em IPv4 e /32 em IPv6; CIDR com bits de host é recusado; ::ffff:x.x.x.x
     vira IPv4. 'bloquear' devolve também "confiavel":bool (aviso); 'confiar' revoga os bloqueios ativos de origem
     regra/ia que encostam na rede e devolve "bloqueios_revogados":n; 'desbloquear'/'desconfiar' repetido → P0002;
   - 'sistema' (pendência C): projeto inexistente → P0002; exige_login precisa ser booleano; rotas_publicas até 50
     itens de até 200 caracteres, espaços aparados, repetidos removidos. É recusada com 22023 a rota VAZIA ("" ou só
     espaços), "/", "/*", "*" e qualquer rota que não seja "/" seguida de pelo menos um caractere (ex.: "abc",
     "x/"), porque casariam qualquer caminho e desligariam o exige_login inteiro (para abrir tudo, desligue
     exige_login). A LISTA vazia [] continua valendo (= nenhuma rota pública). arquivos_proibidos: até 50 regex,
     validadas pelo Postgres e por sentinela.regex_problema (recusa o que não existe igual no JS — escapes, ***,
     classes POSIX, [] e [^], {,n}, (?...) fora de (?: (?= (?! (?<= (?<! (?<nome>) — e quantificador aninhado,
     heurística contra ReDoS); grupo nomeado é aceito;
   - 'limites': só as 3 chaves acima (qualquer outra → 22023). Faixas: limite_rajada_min 10–100000,
     ia_limite_hora 0–1000, ia_confianca_min 0,5–1. retencao_dias e limite_eventos_ip_min mudam só por SQL;
   - 'casa': lat −90..90 e lon −180..180; 'exposicao': status aberta|aceita|corrigida.
  Ação recusada não grava em acoes_admin.
public.sentinela_verificar_cadeia(p_limite int default 5000) returns jsonb
  recalcula os últimos p_limite selos em ordem de id → {"ok":bool,"verificados":n,"desde_id","ate_id","quebra_id":n|null,"ultimo_selo"}
  (v1.1) extra "detalhe" (motivo da quebra, inclusive registro com '|' fora do ua).
public.sentinela_lista_bloqueios / lista_confiaveis / lista_analises (v1.1): lista_bloqueios até 2000 linhas (com
  revogado_por, criado_por, evento_id, analise_id); lista_confiaveis exclui os removidos e mostra os vencidos com
  ativo=false; lista_analises aceita p_limite de 1 a 1000.
```

## 3. Central (Edge Function `sentinela`)

Arquivos: `supabase/functions/sentinela/index.ts` (+ módulos relativos, ex. `regras.ts`, `jwt.ts`, `ia.ts`) e `deno.json`.
Imports: `npm:jose@5` e `npm:@supabase/supabase-js@2` (cliente com `SUPABASE_SERVICE_ROLE_KEY` para `rpc('sentinela_srv_*')`).
Rotas pelo final do pathname (`/functions/v1/sentinela/<rota>`):

| rota | quem chama | autenticação | faz |
|---|---|---|---|
| `GET /saude` | qualquer um | nenhuma | `{"ok":true,"servico":"sentinela","versao":"1.0.0"}` |
| `GET /lista` | guarda | guarda (§3.2) | `srv_lista(projeto)` + `"chaves": srv_chaves_publicas()` (garante chave criada) |
| `POST /evento` | guarda | guarda | saneia (§3.3) → `srv_registrar` → em `EdgeRuntime.waitUntil`: IA para `analisar` (§3.5), atualizar Tor se `tor_atualizado_em` > 24 h, `srv_manutencao()` |
| `POST /sessao` | guarda | guarda | troca passe por sessão (§3.4) |
| `POST /passe` | navegador (portal) | Bearer = access token do Supabase (ES256, verificar com `SUPABASE_JWKS`, iss/aud) | §3.4 |
| `POST /identidade` | navegador (portal) | Bearer = access token | `srv_identidade(ip_cliente, sub, email, 'portal', ua)` |
| `POST /tentativa` | navegador (portal) | nenhuma (atribui ao IP real de quem chamou) | body `{"usuario":"..."}` (≤ 80 chars, minúsculo) → `srv_tentativa` |

- CORS só para `/passe`, `/identidade`, `/tentativa`: `Access-Control-Allow-Origin` = origem da requisição SE estiver em `https://painel-lube-distribuidora.vercel.app`, `https://painel-lube-distribuidora-lube-distribuidora-ltda.vercel.app`, `http://localhost:4321`, `http://127.0.0.1:4321`; responder `OPTIONS`. Rotas do guarda não têm CORS.
- IP do cliente (rotas do navegador): `cf-connecting-ip` → `x-real-ip` → primeiro de `x-forwarded-for`.
- Erros: JSON `{"erro":"codigo","detalhe":"..."}` com 400/401/403/404/429/500. Nunca vazar stack, segredo ou SQL.
- Tamanho máximo do corpo: 64 KB (413). Máximo 20 eventos por POST.
- **(v1.1) Contra CSRF**, todo POST do navegador (`/passe`, `/identidade`, `/tentativa`) exige `Origin` da lista acima
  (ausente, `null` ou outra → 403 `origem_nao_permitida`, sem chegar ao banco) e `content-type: application/json`
  (aceita `; charset=...`; outro → 400 `content_type_invalido`). Sem isso outro site faria o navegador da vítima mandar
  um POST "simples" e o `/tentativa` gravaria no IP dela.
- **(v1.1)** Método errado → 405 com `Allow`; OPTIONS só nas rotas do navegador (nas do guarda, 405 sem CORS).
  Limitadores em memória por instância (chave = IPv4 inteiro ou o /64 do IPv6): `/tentativa` 20/min e teto de 300/min
  na instância; `/passe` 60/min; `/identidade` 30/min (→ 429). Erro de banco → 500 `{"erro":"interno"}`; o log leva só o
  nome da RPC e a mensagem.
- **(v1.1) `/identidade`** antes de gravar chama `srv_permissao(sub, null)`: motivo `perfil_inexistente`/`perfil_inativo`
  ou resposta ilegível → 403 `perfil_inativo` sem gravar nada; usa o e-mail do perfil; se `srv_identidade` devolver
  `ok:false` também responde 403 `perfil_inativo` (pendência A). Sem IP do cliente → 400 `ip_desconhecido`.
- **(v1.1) `/tentativa`** responde `{"ok":true,"bloqueado":bool}`; o IP é sempre o do cabeçalho, nunca o do corpo.
  Portal e painel mandam o usuário mascarado (inicial + `***` + `@domínio`, ex. `j***@lube.com.br`), para não gravar
  uma senha digitada no campo de usuário; a força bruta conta por IP.
- **(v1.1) `/evento`** responde `{"ok":true,"gravados":n,"descartados":n,"invalidos":n}`; > 20 eventos → 400.

### 3.2 Autenticação do guarda
1. `Authorization: Bearer <jwt>` → `jose.jwtVerify(jwt, createRemoteJWKSet(new URL('https://oidc.vercel.com/lube-distribuidora-ltda/.well-known/jwks')), { issuer: 'https://oidc.vercel.com/lube-distribuidora-ltda', audience: 'https://vercel.com/lube-distribuidora-ltda' })`; exigir `owner_id === 'team_k8YNfCDhgFwOScWnM5iHGqLC'` e `project_id` presente em `sentinela.sistemas` (cache em memória 5 min). `projeto = payload.project`, `ambiente = payload.environment`.
2. Senão, se existir `Deno.env.get('SENTINELA_CHAVE')` e header `x-sentinela-assinatura: t=<unix>,v1=<hex>` + `x-sentinela-projeto: <projeto>`: HMAC-SHA256(chave, `${t}.${corpoBruto}`) (GET: corpo vazio), comparação em tempo constante, |agora − t| ≤ 300 s, projeto conhecido. `ambiente` = header `x-sentinela-ambiente` ou 'production'.
3. Senão 401 `{"erro":"guarda_nao_autenticado"}`.

**(v1.1)** OIDC só vale com `environment` `production` ou `preview` (`development` ou ausente → 401, avisado no log uma
vez). `algorithms: ['RS256']`, tolerância de relógio 5 s. O `project_id` esperado é o `sistema.projeto_id` que o
`srv_lista` devolve (pendência D); o mapa fixo dos 8 projetos do §0 fica só como reserva para banco sem o campo. O
projeto tem de existir em `sentinela.sistemas` (cache 5 min por instância; uma `/lista` fria faz um `srv_lista` só,
reaproveitado da autenticação). HMAC: `SENTINELA_CHAVE` com menos de **32 caracteres** é tratada como ausente (plano B
desligado, aviso no log sem a chave); o mesmo valor vai nos segredos da Edge Function e nas variáveis da Vercel de cada
projeto, que também precisa de `SENTINELA_PROJETO` (sugestão: 48 hex aleatórios; ver `guarda/LEIA-ME.md`).

### 3.3 Evento (o que o guarda manda; a Central saneia)
```
{"ts":iso,"metodo":"GET","host":"..","caminho":"/api/dados","consulta":"?a=b","tipo":"pagina|api|arquivo|outro",
 "ip":"..","pais":"BR","regiao":"ES","cidade":"Cariacica","lat":-20.26,"lon":-40.41,"fuso":"America/Sao_Paulo",
 "ua":"..","idioma":"pt-BR,pt;q=0.9","referer":"https://origem","ja4":"..","vercel_id":"gru1::..",
 "sec_fetch_site":"..","sec_fetch_mode":"..","sec_fetch_dest":"..",
 "decisao":"liberado|observado|bloqueado","regra":"..|null","motivo":"..|null",
 "identidade":"email|null","identidade_origem":"passe|sessao_app|null"}
```
Saneamento na Central: ip válido (IPv4/IPv6) ou descarta; strings cortadas (caminho 300, consulta 300, ua 300, idioma 60, referer 120 — só a origem, motivo 200, cidade/regiao 80); lat/lon numéricos em faixa; enums validados (valor desconhecido → null/'outro'); `ts` inválido → agora. Campos extras ignorados.
**(v1.1)** IPv6 normalizado (RFC 5952; `::ffff:x.x.x.x` vira IPv4). `decisao` desconhecida descarta o evento (conta em
`invalidos`). `regra` validada por formato (`^[a-z][a-z0-9_]*$`, até 40), não por lista fechada. `identidade` só com
e-mail válido e `identidade_origem` passe|sessao_app (senão os dois viram null; `provavel` nunca vem do guarda).
**(Central, 2026-10-07)** Exceção: com `identidade_origem` `sessao_app`, também vale nome de robô no formato
`^rob[oô] [a-z0-9 ()._-]{3,80}$` (sem `|`, `@` nem controle), gravado em minúsculas, para o app marcar o próprio
agendador já conferido (ex.: `robo do gestao ti (agendador da vercel)`). Cortes
a mais: host 120, fuso 60, ja4 100, vercel_id 120, sec_fetch_* 30 (`[a-z-]`), metodo 10 (`[A-Z]`), pais 2 letras,
identidade 120. NUL, controles e surrogates soltos são removidos. `ts` mais de 5 min no futuro ou mais de 24 h no
passado vira agora; lat/lon fora de faixa viram os dois null.

### 3.4 Passe e sessão (porta do Painel Lube)
- Chave ES256 da Sentinela: `srv_chave_ativa()`; se null, gerar com WebCrypto (`ECDSA P-256`, exportar JWK), `kid` = 16 hex aleatórios, `srv_chave_criar(kid, publica, JSON.stringify(privada))`. Cache em memória.
- `POST /passe` body `{"sistema_slug":"gestao-financeiro","destino"?:"https://.../caminho"}`: verifica o token do usuário; `srv_permissao(sub, slug)`; se não permitido → 403 `{"erro":"sem_permissao"}`. Se permitido: passe JWT `{iss:"sentinela-lube", aud:<projeto>, sub:<user_id>, email, nome, sis:<slug>, typ:"passe", jti:<uuid>, iat, exp: iat+90}` assinado ES256 com `kid`. `url` = `destino` se tiver a mesma origem da `url` do sistema, senão a `url` do sistema; acrescenta `sentinela_passe=<jwt>` na query. Também `srv_identidade(ip, sub, email, 'portal', ua)`. → `{"ok":true,"url":"...","exp":iso}`.
- `POST /sessao` (guarda) body `{"passe":"<jwt>"}`: verifica assinatura com as chaves ativas, `iss`, `typ==='passe'`, `aud === projeto do guarda`, `exp`; `srv_passe_usar(jti, projeto, email)` precisa devolver true (uso único). Emite sessão JWT `{iss:"sentinela-lube", aud:<projeto>, sub, email, nome, sis, typ:"sessao", iat, exp: iat+8h}`. → `{"ok":true,"sessao":"<jwt>","exp":iso,"email":..}`; falha → 401 `{"erro":"passe_invalido"}`.
- **(v1.1) Passe só para sistema com guarda ativo (pendência E).** Se `srv_permissao` não devolver `guarda_ativo: true`
  (o guarda do sistema nunca falou com a Central: `sentinela.sistemas.ultimo_sinal` nulo; campo ausente conta como
  false), o `/passe` não assina nada e responde `{"ok":true,"url":"<url do sistema, mesma regra do destino, sem
  sentinela_passe>","guarda_ativo":false}` (sem `exp`). Sem guarda ninguém trocaria o passe por sessão e ele ficaria
  exposto no endereço, no histórico e nos logs do sistema. O portal aceita essa resposta (https na mesma origem) e abre
  o sistema normalmente; a identidade do login no portal continua registrada.
- **(v1.1) Detalhes do `/passe`:** 403 `sem_permissao` leva `detalhe` = motivo do `srv_permissao` (conta inativa →
  `perfil_inativo`, sem gravar identidade); permitido mas sem projeto/url em `sentinela.sistemas` → 404
  `sistema_sem_sentinela`; só URL https do sistema; `usuario:senha` sai do destino e um `sentinela_passe` velho é
  trocado. `srv_identidade` roda em `waitUntil` (não atrasa a resposta).
- **(v1.1) Detalhes do `/sessao`:** erros levam `detalhe` (aud, expirado, typ, ja_usado, kid_desconhecido, corpo,
  payload...); corpo malformado também é 401 `passe_invalido`; recusa `exp − iat > 120 s`; a chave privada é obtida
  ANTES de queimar o jti (Vault fora não gasta o passe). A sessão não tem jti. Chave ativa em cache 10 min, públicas
  5 min (renovadas uma vez diante de kid desconhecido); a `/lista` sai mesmo se a privada não carregar (as públicas vêm
  de `srv_chaves_publicas`), e uma recarga que falha mantém a chave em memória e tenta de novo em 1 min. Criação de
  chave com dedupe de pedidos simultâneos. A `/lista` republica só os campos públicos do JWK (kty, crv, x, y, kid,
  alg ES256, use sig).
- **(v1.1) Token do usuário Supabase:** só ES256, `iss` fixo, `aud` authenticated, tolerância 5 s; token anônimo
  (`is_anonymous`) é recusado. `SUPABASE_JWKS` primeiro, JWKS remoto se não achar a chave.

### 3.5 IA (Claude)
- Chave `ANTHROPIC_API_KEY` (segredo da Edge Function, cadastrado pelo Júlio). Sem chave → `srv_ia_status('sem_chave', ...)` e não analisa.
- Para cada IP de `analisar` (respeitando `srv_ia_cota()`): `srv_contexto_ip(ip)` → `POST https://api.anthropic.com/v1/messages` com headers `x-api-key`, `anthropic-version: 2023-06-01`, `content-type: application/json`; body: `model: "claude-haiku-4-5-20251001"`, `max_tokens: 400`, `tools: [{name:"veredito", description, input_schema:{type:"object", properties:{veredito:{enum:["legitimo","suspeito","malicioso"]}, confianca:{type:"number",minimum:0,maximum:1}, motivo:{type:"string",maxLength:200}, acao:{enum:["nenhuma","observar","bloquear_1h","bloquear_24h","bloquear_7d"]}}, required:[...todos]}}]`, `tool_choice: {type:"tool", name:"veredito"}`, timeout 15 s.
- Prompt de sistema (pt-BR): a Lube é uma distribuidora em Cariacica-ES; os sistemas são BIs e ferramentas internas usadas por funcionários, sempre por navegador; acesso legítimo pode vir de qualquer lugar do mundo (viagem, 4G, VPN) — **país sozinho não é motivo**; malicioso = varredura de caminhos, tentativa de exploração, ferramenta de ataque, raspagem automatizada de /api, força bruta, padrão de robô; na dúvida, "suspeito" + "observar", nunca bloquear; motivo em uma frase curta em português, sem jargão. O contexto do IP vai como mensagem do usuário em JSON (sem e-mails completos: mascarar como `j***@lube.com.br`).
- Resultado → `srv_registrar_analise(ip, {...})`; status 'ligada'. Erro HTTP/timeout → `srv_registrar_analise(ip, {veredito:'erro', erro:'...'})` e `srv_ia_status('erro', '...')`. Nunca logar a chave.
- **(v1.1)** No máximo 3 chamadas à IA em voo por instância; `srv_ia_cota` é relida antes de CADA chamada,
  descontando as que estão em voo (o excedente fica para outro lote; o banco só reoferece o IP 10 min depois). O lote
  para no primeiro erro HTTP ou timeout. `input_schema` com `type:'string'` nos enums e `additionalProperties:false`,
  sem temperature; o prompt diz também qual duração de bloqueio usar. Contexto limitado a 24 mil caracteres (saem os
  eventos mais antigos); `<` escapado para dado do visitante não fechar `<contexto_ip>`; e-mails mascarados pela
  Central (o banco devolve o e-mail completo). Fora do contrato vira contido: ação inválida → 'nenhuma', confiança
  inválida → 0 (acima de 1 → 1), veredito inválido ou resposta sem tool_use → análise 'erro'. `srv_ia_status`: 'ligada'
  (detalhe = nome do modelo) e 'erro' gravam sempre; só 'sem_chave' é deduplicado (1x a cada 5 min por instância).
- **(v1.1) Tor e manutenção** (em `waitUntil` depois do `/evento`): a Tor é baixada quando o `tor_atualizado_em` do
  `srv_lista` é nulo ou tem mais de 24 h (sem o campo, cai no critério antigo pela manutenção); trava por instância de
  6 h depois de tentar e 1 h depois de falhar; lista com menos de 100 IPs não substitui a boa. `srv_manutencao` no
  máximo a cada 30 min por instância; com `"pendente":true` chama de novo em 1 min.
- **(v1.1)** Chave de serviço: `SUPABASE_SERVICE_ROLE_KEY` ou, na falta, a entrada padrão de `SUPABASE_SECRET_KEYS`;
  cliente criado no primeiro uso. Imports `npm:jose@5` e `npm:@supabase/supabase-js@2` direto no `index.ts`
  (`deno.json` só com `{"lock": false}`). Deploy com `verify_jwt=false`; `teste/` não precisa subir.

## 4. Guarda

Arquivos canônicos no repo do portal:
- `guarda/sentinela-guarda.ts` — o núcleo, sem dependências, só Web APIs (fetch, URL, crypto.subtle, TextEncoder, atob/btoa). Exporta `VERSAO`, `async function sentinela(request: Request, ctx?: {waitUntil?(p: Promise<unknown>): void}, opcoes?: {identidade?: {email: string, origem: 'sessao_app'}}): Promise<Response | null>` — devolve `Response` para encerrar (403/302/401/saúde) ou `null` para seguir.
- `guarda/middleware.ts` — para projetos estáticos: importa o núcleo por caminho relativo `./sentinela-guarda` (na instalação os dois arquivos ficam lado a lado na raiz do projeto), `export const config = { matcher: [...] }`, `export default async function middleware(request, context) { const r = await sentinela(request, context); return r ?? new Response(null, { headers: { 'x-middleware-next': '1' } }); }`.
- Instalação em Next.js: copiar `sentinela-guarda.ts` para `src/lib/sentinela-guarda.ts` e chamar no INÍCIO do middleware existente; se devolver Response, retorná-la; senão seguir com a lógica atual intacta.

Comportamento do núcleo:
0. Tudo dentro de try/catch: qualquer erro → `null` (falha aberta). Nunca ler o corpo. Nunca alterar a requisição.
1. `GET /.sentinela/saude` → JSON no-store `{"guarda":VERSAO,"runtime":..,"oidc":bool,"lista":{"ok":bool,"idade_s":n|null,"modo":..|null},"ip":..,"pais":..,"cidade":..}` (não expõe listas).
2. Coleta os campos do Evento. `tipo`: `/api/` → api; caminho com extensão diferente de `.html` → arquivo; senão pagina. IP vazio → não registra (segue).
3. Lista: cache em memória do módulo, TTL 20 s. Fresca → usa. Velha → usa e renova em `waitUntil`. Inexistente → espera até 700 ms; falhou → `lista = null` (regras locais continuam valendo; listas/sem_login não).
4. Sessão: cookie `__Host-sentinela` → verificar JWT ES256 com `lista.chaves` (WebCrypto `ECDSA P-256 SHA-256`, assinatura JWS em formato r||s), `iss==='sentinela-lube'`, `typ==='sessao'`, `aud===lista.sistema.projeto`, `exp` > agora → `identidade = email, origem 'passe'`. `opcoes.identidade` (Next) tem prioridade.
5. Passe: se a query tiver `sentinela_passe` → `POST /sessao` (timeout 2500 ms). Sucesso → 302 para a mesma URL sem o parâmetro, com `Set-Cookie: __Host-sentinela=<sessao>; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=28800`, evento liberado com motivo "entrada pelo Painel Lube". Falha → 302 para a URL sem o parâmetro, sem cookie, evento observado regra `passe_invalido`.
6. Exceções (cron/prévia/buscador) e regras locais na ordem: ferramenta → varredura → injecao → lista → arquivo_proibido → robo → sem_login → liberado. `lista` também consulta um mapa local `ip → até` preenchido na hora em que o próprio guarda bloqueia um ataque certo (24 h), para não esperar a Central.
7. Aplicação: certo → 403; suspeito → 403 só se `lista.modo==='proteger'`, senão `observado` e segue; `sem_login` → página (`tipo==='pagina'` e método GET): 302 para `${lista.portal}/?abrir=${sistema_slug}`; demais: 401 JSON `{"erro":"login_necessario","portal":..}`. `sem_login` só vale se `lista.sistema.exige_login && lista.sistema.sistema_slug` e o caminho não começa com nenhum de `rotas_publicas`.
8. Resposta de bloqueio: `tipo api` → JSON `{"erro":"bloqueado","incidente":<código>}`; senão HTML curto no visual da Lube (fundo #050b1c, "Acesso bloqueado pela Sentinela Lube", código do incidente = 8 primeiros hex de SHA-256 de `vercel_id||ts`, "Se você é da Lube, envie este código ao TI: cpd@lube.com.br"). Headers: `Cache-Control: no-store`, `X-Robots-Tag: noindex`, `x-sentinela: bloqueado`. Status 403.
9. Registro: `ctx.waitUntil(fetch(CENTRAL + '/evento', {method:'POST', headers:{authorization:'Bearer '+oidc, 'content-type':'application/json', 'x-sentinela-guarda': VERSAO, 'x-sentinela-runtime': runtime}, body: JSON.stringify({eventos:[ev]})}))` com timeout 2500 ms; sem `waitUntil` → não espera (dispara e esquece). Deduplicar: mesma (ip, caminho, decisao) em 5 s não é reenviada (mapa limitado a 500 chaves). Sem token OIDC e sem `SENTINELA_CHAVE` → não registra, mas continua aplicando regras locais.
10. Constantes: `CENTRAL = 'https://wkkdcsqwlxjxorutrbnx.supabase.co/functions/v1/sentinela'`, `VERSAO = 'sentinela-guarda/1.0.0'` (**1.1.0 desde 2026-10-07**: regras `buscador`, `robo` ampliada e `nao_navegador`, §1). Nada de segredo no código (repos podem ser públicos).

**(v1.1) Como o núcleo ficou, passo a passo** (o que mudou em relação aos itens 0–10):
- **Credenciais (item 9 e §0):** ordem = token que a Central já aceitou → `VERCEL_OIDC_TOKEN` → HMAC do plano B →
  request-context → header `x-vercel-oidc-token` (este por último porque pode ser forjado; header com vírgula é
  dividido). Cada token candidato é conferido em iss/owner_id/exp sem assinatura (a Central verifica). 401/403 da
  Central que não seja `passe_invalido` põe só aquela credencial de quarentena (token 10 min, HMAC 60 s) e tenta a
  próxima, dentro do prazo único de 2,5 s; recusa não pausa a lista. Plano B: `SENTINELA_CHAVE` (≥ 32 caracteres) +
  `SENTINELA_PROJETO`; `x-sentinela-ambiente` = `VERCEL_ENV` ou production.
- **Lista (item 3):** TTL da lista aceito entre 5 e 300 s (padrão 20); single-flight; depois de falha da Central
  (rede, tempo, 5xx, 429) lista e `/evento` pausam 15 s; lista com mais de 1 h não é usada.
- **Sessão (item 4):** cache de verificação por lista (máx. 500). Cookie presente mas não verificável (sem chave na
  lista, kid desconhecido, assinatura ou claims ruins) = sessão inválida: a página vai para a home do portal, sem
  `?abrir`, com motivo "sessão da Sentinela não reconhecida"; sessão só vencida e ausência de cookie vão para `?abrir`.
- **Passe (item 5):** a troca acontece DEPOIS das regras certas e do suspeito-em-proteger (requisição barrada não
  ganha sessão). Passe que falha também grava `__Host-sentinela-falha=1` (Max-Age 60, HttpOnly, Secure, Lax): o
  próximo `sem_login` de página vai para `${portal}/` sem `?abrir`, quebrando o laço portal↔sistema; o sucesso apaga a
  marca. `consulta` do evento nunca leva `sentinela_passe`.
- **Ordem (item 6):** ataque certo (ferramenta → varredura → injecao) → lista (+ mapa local) → arquivo_proibido →
  exceções (cron, previa_link, office, navegador_simples) → sem identidade: buscador → robo → nao_navegador (guarda 1.1.0, §1) → sem_login → liberado. Lista suspeita com identidade: segue `observado`. Confiável: ignora o nível suspeito (decisão liberado, motivo "rede confiável:
  ... (ignorado)"); bloqueio certo da lista vale mesmo para confiável (só manual, porque o banco não deixa bloqueio
  automático em confiável); ataque certo de confiável → 403 com o motivo de alerta e sem bloqueio local. O mapa local
  `ip → até` (24 h) só é preenchido com lista presente e IP não confiável, e **nunca** para varredura/injeção
  cross-site (§1). IP vazio ou inválido: não registra e não aplica a lista, mas as regras locais de ataque rodam.
- **sem_login (item 7):** registrado como decisão `bloqueado`, regra `sem_login`, com `x-sentinela: login` na
  resposta. HEAD conta como GET; `.htm` também é página. Suspeito observado no modo observar NÃO dispensa o
  `sem_login` (a regra observada vai no motivo). **`rotas_publicas` (pendência C):** `/acompanhar` casa `/acompanhar`
  e `/acompanhar/...` (não `/acompanharx`); terminada em `/` ou `*` = prefixo simples; rota vazia, `/`, `/*`, `*` ou que
  não seja `/` seguida de caractere é ignorada (o banco já recusa; aqui é defesa em profundidade).
- **Bloqueio (item 8):** código do incidente = 8 primeiros hex de SHA-256(vercel_id + ts); além dos cabeçalhos da v1,
  `x-content-type-options`, `referrer-policy` e CSP na página HTML.
- **Registro (item 9):** dedupe (ip, caminho, decisão) por 5 s, mapa de 500. Por IP e minuto, 30 eventos saem direto e
  o resto vai em lotes de até 20 eventos / 56 KB; o 1º bloqueado do IP no minuto sempre sai na hora. Durante a pausa,
  ou quando a requisição só tem credencial em quarentena, os eventos esperam numa fila de até 200 (perdida se a
  instância morrer); lote recusado por credencial volta à fila. Na consulta dos eventos não-ataque, valores de
  token|code|senha|password|key|secret|jwt|signature... viram `***`; em bloqueio a consulta vai crua (evidência).
  Referer só a origem.
- **Compatibilidade:** só Web APIs; `BigInt()` em vez de literais `0n` (tsconfig padrão do Next é ES2017);
  `declare const process: any` e `/* eslint-disable */` para compilar com ou sem @types/node.

Matcher padrão para estáticos (deixa de fora só imagem, fonte e CSS; JS/JSON passam porque em alguns sistemas são os dados):
`['/((?!.*\\.(?:css|png|jpe?g|gif|svg|ico|webp|avif|woff2?|ttf|otf|eot|map)$).*)']`

## 5. Painel (`sentinela/` no repo do portal)

Arquivos: `sentinela/index.html`, `sentinela/sentinela.css`, `sentinela/sentinela.js` (pode dividir em módulos), `sentinela/vendor/globe.gl@2.46.2/globe.gl.min.js` + `LICENSE` + `THIRD-PARTY.txt`, `sentinela/vendor/supabase-js@2.45.4/supabase.js`, `sentinela/dados/paises.geojson` (ne_110m_admin_0_countries do pacote globe.gl). Reaproveitar `../config.js` (window.LUBE_CFG: url, key anon, dominio) e `../assets/logo-lube.png`.

Visual (obrigatório, padrão Lube — ver Preferências/Como eu gosto dos BIs.md):
- Fundo `#050b1c`, superfícies `#0d1830` / `#132242`, azul da marca `#2a41c8`, vermelho da marca `#e5202c`. Estados: seguro `#34e89e`, observado `#ffb340`, bloqueado/alerta `#ff6b74`, novo `#5fb2ff`.
- Fontes (Google Fonts): Archivo 700/800 nos títulos, IBM Plex Sans 500/600/700 no texto (500 é o peso base), JetBrains Mono 600/800 em todo número, IP, código e hora.
- Logo da Lube no cabeçalho numa placa branca arredondada. Menu lateral fixo à esquerda com os módulos (só os que existem); abaixo de 1080 px vira menu que desliza com botão.
- Cards de KPI com ícone, número grande, brilho suave na cor do estado; card zerado fica cinza sóbrio.
- Números em pt-BR (`1.234`, `12,5%`). Horas em America/Sao_Paulo. Nada de parágrafo explicando regra no meio da tela — explicação vai em dica (title/tooltip).
- Escapar TODO dado vindo de visitante (IP, UA, caminho, cidade) antes de pôr em HTML — inclusive nos labels HTML do globo.

Módulos:
1. **Visão geral**: cabeçalho com pílula de modo (👁 OBSERVANDO âmbar / 🛡 PROTEGENDO verde; trocar pede confirmação), indicador "ao vivo · há N s", chip da IA (ligada / sem chave / erro), sinal dos 8 sistemas (pontinhos com tooltip "último sinal há X"; sem sinal há > 30 min em horário comercial = âmbar; nunca = cinza). 7 KPIs. **Globo grande** (globe.gl): fundo transparente, globo `#0d1830`, países em hexágonos (`hexPolygonsData`, resolução 3, cor `#1e3a7a`/`#22305e`), atmosfera `#2a41c8`; marcador da casa (LUBE · Cariacica) com anel pulsando azul; um ponto por IP (cor pelo status, tamanho pela quantidade, label HTML escapado com cidade/país/IP/status); arco animado de cada ponto até a casa (dash andando em direção à Lube; vermelho p/ bloqueado, âmbar p/ observado, azul→verde p/ seguro); anel vermelho pulsando na origem de bloqueio novo (últimos 60 s); rotação automática lenta que pausa enquanto o usuário mexe; clique no ponto abre a gaveta do IP. Legenda com contagem. Ao lado/abaixo: **feed "Agora"** (últimos 30 eventos entrando com animação). Embaixo: **Quem está acessando** — tabela por IP: Local (bandeira emoji + cidade/UF + país), IP, Quem (✓ confirmado pelo login / provável / anônimo / "Rede confiável"), Dispositivo (navegador e sistema extraídos do UA; "robô: curl" quando for o caso), Sistemas (chips), Acessos, Último (há X min), Risco (barra 0–100 colorida), **Status** (pílula: 🔒 Seguro — sub-rótulo "HTTPS · TLS" e, se identidade confirmada, "login ES256 ✓"; 👁 Observado — "seria bloqueado: <regra>"; ⛔ Bloqueado — "<regra> · até HH:MM"; 🧠 Em análise — "IA analisando"), Ações (bloquear, liberar, confiar). Filtros: status, sistema, país, busca.
   Gráfico pequeno "Acessos por hora (24 h)" em barras empilhadas por decisão, SEM rótulos (são 24 barras; regra da casa: gráfico com dezenas de barras desliga rótulo) e com tooltip.
2. **Bloqueios**: lista ativos (e inativos com filtro), novo bloqueio (IP/CIDR, duração 1h/24h/7d/permanente, motivo), revogar.
3. **Confiáveis**: lista + adicionar (IP/CIDR + descrição) + remover; aprendidos por login com etiqueta.
4. **IA**: estado (ligada/sem chave/erro com o detalhe, modelo, análises na janela, limite/hora) + lista de análises (IP, veredito em pílula, confiança %, motivo, ação, aplicado, quando). Sem chave → card âmbar dizendo exatamente onde cadastrar: Supabase › projeto PAINEL LUBE DISTRIBUIDORA › Edge Functions › Secrets › `ANTHROPIC_API_KEY`.
5. **Exposições**: inventário com severidade (Crítica vermelho, Alta laranja, Média âmbar, Baixa azul), sistema, título, evidência, recomendação, status e decisão; admin muda status/decisão.
6. **Integridade**: estado da cadeia de selos (`sentinela_verificar_cadeia`): "Cadeia íntegra · N registros · último selo abc123…" ou alerta vermelho com o id da quebra; botão "Verificar agora"; fatos de criptografia em cards: tráfego sempre HTTPS/TLS; guarda→central assinado pela Vercel (OIDC RS256); login do portal ES256; passe/sessão ES256 com chave privada no Vault do Supabase; registro selado SHA-256 encadeado.
7. **Configuração**: modo, casa (nome/lat/lon), limites (rajada/min, IA por hora, confiança mínima), por sistema: exige login (toggle com aviso forte), rotas públicas, arquivos proibidos (editar lista), último sinal e versão do guarda.

Dados: login Supabase (mesmo projeto do portal; mesma sessão do portal no localStorage). Sem sessão → tela de login própria (usuário sem @ completa `@lube.com.br`). Não admin → "Acesso restrito ao TI". `rpc('sentinela_painel')` a cada 60 s; `rpc('sentinela_novos', {p_desde_id})` a cada 4 s com a aba visível (pausar quando oculta). Erro de rede → faixa "sem conexão com a central desde HH:MM" (nada some em silêncio).
**Modo demonstração** só em `localhost`/`127.0.0.1` com `?demo=1`: dados sintéticos coerentes com o contrato (inclui ataques do exterior, robôs, um bloqueio certo, IA), com tarja "DEMONSTRAÇÃO" visível. Em qualquer outro host o parâmetro é ignorado.
Sem WebGL → mensagem no lugar do globo e o resto do painel funciona.

**(v1.1)** A tela de login própria do painel também avisa a Central: `POST /identidade` com o Bearer depois do login e
`POST /tentativa` quando a senha está errada (`Invalid login credentials` ou `code invalid_credentials`), com o usuário
**mascarado como o portal faz** (inicial + `***` + `@domínio`; pendência F), sem keepalive, dispara e esquece.
O demo (`sentinela/demo.js`) só tem dados fictícios (projetos, URLs, ids e exposições inventados; IPs dos blocos de
documentação), devolve as mesmas chaves JSON que o SQL e segue as mesmas regras (conferido por comparador automático),
e fica fora do deploy pelo `.vercelignore`. Demais decisões do painel em §8.4.

## 6. Exposições iniciais (seed, verificadas em 2026-10-05)
| sistema | sev | título | evidência | recomendação | status | decisão |
|---|---|---|---|---|---|---|
| Gestão Financeiro | critica | Folha de pagamento aberta no endereço principal | GET https://gestao-finaceiro.vercel.app/api/dados respondeu 200 sem login (66 KB: 21 colaboradores com salário contratual, líquido e rubricas; 203 nomes). A proteção "Standard" da Vercel cobre só as URLs de deploy, não o domínio de produção. | Ligar "exige login" deste sistema na Sentinela (porta do Painel Lube). | aceita | Júlio decidiu manter aberto por enquanto (2026-10-05). |
| BI Comercial | alta | Comissão por RCA aberta no endereço principal | GET https://gestao-comercial-web-three.vercel.app/api/dados respondeu 200 sem login (223 KB). /db/*.sql também publicados. | Ligar "exige login"; tirar web/db do que é publicado. | aceita | Júlio decidiu manter como está (2026-10-05). |
| RH Absenteísmo | critica | Banco aceita leitura, alteração e exclusão anônimas | pg_policies: as 11 tabelas públicas têm política para o papel public com USING(true)/WITH CHECK(true); a chave anon é servida em /supabase-config.js (200). | Login no app + RLS por usuário; depois trocar a chave. O guarda não protege acesso direto ao banco. | aceita | Júlio decidiu manter como está (2026-10-05). |
| RH Absenteísmo | alta | Site publica o repositório inteiro | outputDirectory "." — /dashboard_dataset.json (200), planilhas, SQL e scripts acessíveis sem login. | Ativar os arquivos proibidos no modo proteger; mover dados para fora do que é publicado. | aceita | Júlio decidiu manter como está (2026-10-05). |
| Painel ICMS | alta | Login desligado "temporariamente" e banco com políticas TEMP para anônimo | AUTH_DESLIGADA_TEMPORARIAMENTE = true; anon lê periodos, lê/grava pedidos_atualizacao (que aciona consulta ao WinThor) e gera URL das planilhas. /api/assistente aberto (gasta crédito da Anthropic). | Religar o login; remover políticas TEMP; exigir sessão no /api/assistente. | aberta | |
| Saída de Veículos | alta | Sistema público e banco aceita inserção anônima | Produção 200 sem login; dados.json e planilhas públicos; políticas permitem SELECT e INSERT para anon. | Login + RLS; ligar "exige login" na Sentinela. | aberta | |
| BI Compras | media | Assistente de IA aberto para qualquer pessoa | POST /api/agente sem autenticação nem limite repassa até 60 mensagens à Anthropic com a chave do projeto. | Limitar por origem/sessão e taxa; ou ligar "exige login". | aberta | |
| BI Compras | baixa | Painel aberto por decisão | Sem proteção desde 2026-09-22 (faturamento, margem e custo por fornecedor). | — | aceita | Decisão do Júlio em 2026-09-22. |
| RH Absenteísmo | media | Rotas de IA abertas (custo Gemini) | /api/diagnostico e /api/assistente aceitam POST anônimo. | Exigir sessão/limite. | aberta | |
| Gestão TI | media | Três rotas dependem só do middleware | /api/chamados (GET), /api/notas-avulsas/[id]/documentos e /api/pendencias não checam sessão por conta própria. | Checagem de sessão em cada rota. | aberta | |
| Painel Lube | media | Proteção contra senha vazada desligada | Advisor do Supabase: leaked password protection off no projeto do portal. | Ligar em Authentication › Passwords. | aberta | |
| Painel Lube | baixa | Arquivos internos publicados | /db/01_schema.sql, /supabase/functions/admin-users/index.ts e /.claude/launch.json respondem 200. | Arquivos proibidos no modo proteger, ou mover para fora do output. | aberta | |
| Conta Vercel | media | Plano Hobby em uso empresarial | Termos da Vercel: Hobby só para uso pessoal e não comercial. Limita firewall (3 IP blocks/projeto), sem Log Drains, logs de 1 h. | Avaliar plano Pro. | aberta | |

## 7. Invariantes de segurança (revisores conferem)
1. Nenhum segredo em arquivo de repositório. Chave da IA só no segredo da Edge Function. Chave privada do passe só no Vault.
2. Evento só entra no banco autenticado como guarda (OIDC do team Lube ou HMAC). Nenhum endpoint permite a um visitante criar bloqueio contra terceiro (o `/tentativa` só atribui ao IP real de quem chama).
3. Confiável nunca recebe bloqueio automático de IP. País nunca bloqueia sozinho. Modo observar só aplica nível certo e `sem_login`.
4. Guarda falha aberta: erro, central fora ou lista ausente → o sistema continua abrindo (regras locais de ataque certo continuam).
5. Funções de painel exigem `is_admin()`; `anon` não executa nada da Sentinela; `authenticated` só as de painel.
6. Eventos são só-inserção (UPDATE/DELETE barrados por gatilho, exceto a manutenção) e encadeados por SHA-256.
7. Todo dado de visitante é escapado no HTML do painel e na página de bloqueio.
8. Passe: uso único, 90 s, audiência = projeto; sessão: 8 h, audiência = projeto, cookie `__Host-`, HttpOnly, Secure, SameSite=Lax.
9. O guarda não lê o corpo, não muda a requisição e não quebra a lógica de sessão existente nos projetos Next.js.
10. **(v1.1)** Um site de terceiro não consegue bloquear o IP de quem o visita: varredura/injeção cross-site não gera
    bloqueio de IP (guarda e banco), e os POST do navegador para a Central exigem a origem do portal e JSON.
11. **(v1.1)** Conta sem perfil ativo não ganha identidade, confiável nem passe. O passe só vai na URL de um sistema
    cujo guarda já falou com a Central. Rota pública nunca libera o sistema inteiro.

## 8. Desvios e decisões registrados na construção (2026-10-05 e 2026-10-06)

Cada item diz o que o código faz e por quê. "Construtor", "corretor" e "integrador" são as etapas da construção de
2026-10-05; "A–G" são as pendências fechadas em 2026-10-06. Tudo foi testado só localmente (ver §8.7).

### 8.1 Banco (`db/02_sentinela.sql`)
- **Slugs:** os 7 `sistema_slug` da tabela do §0 existem em `public.sistemas` (conferido por leitura). Sem desvio.
- **srv_permissao** segue a regra do `portal.js`, mais restrita que o texto da v1 (ver §2), com os 8 códigos de motivo
  e, desde E, `guarda_ativo`.
- **srv_identidade:** recusa conta sem perfil ativo sem gravar nada (A); não aprende confiável para Tor, IP com
  bloqueio certo ativo ou IP desconfiado há < 30 dias; ao aprender, revoga bloqueios automáticos do IP.
- **srv_lista:** extras `sistema.projeto_id` (D) e `tor_atualizado_em`; corte dos 5000 por prioridade (manual, certo,
  permanente, mais novo).
- **srv_registrar:** teto por IP (/64 em IPv6) por minuto; rajada por janela deslizante estimada com duas janelas de
  60 s (colunas `janela_*`), contando o que o teto descartou (sem isso a rajada > 120/min nunca dispararia, porque o
  teto grava só 30/min); regras certas valem também para eventos descartados pelo teto; varredura/injeção cross-site
  gravam com motivo de requisição forjada e não bloqueiam (B); entrega à IA desconta pedidos pendentes (< 10 min) e
  manda no máximo 1 IP por /64; `|` no caminho vira `%7C`; até 100 eventos por chamada; projeto desconhecido → 22023.
- **Bloqueios:** dedupe só com mesmo tipo, valor, nível e origem; IPv6 automático por /64 (cai para /128 perto de
  confiável); bloqueio suspeito não vale para confiável; o banco garante que confiável nunca fica com bloqueio
  automático (inclusive o aprendido no login).
- **Cadeia:** FOR UPDATE + renumeração de id + `criado_em = now()`; TRUNCATE barrado; CHECK contra `|`; o canon da v1
  não mudou (um canon sem ambiguidade de verdade exigiria mudar o contrato — em aberto, §8.7).
- **Painel:** janela alinhada à hora, KPIs em cache de 10 s, status 'observado' para acesso barrado na janela,
  extras em visitantes[].bloqueio (tipo, valor, origem), sistemas[].sistema_slug, ia.modelo, sentinela_ip.confiaveis.
- **sentinela_acao:** redes mínimas /16 e /32; 'confiar' revoga automáticos; 'limites' só com as 3 chaves do contrato
  (o construtor tinha aceitado retencao_dias e limite_eventos_ip_min; o corretor tirou); regex de arquivos_proibidos
  validadas para valer igual no JS (`regex_problema`); 'sistema' recusa rota pública vazia, `/`, `/*`, `*` e sem
  `/x` (C; o integrador já recusava `/` e `/*`).
- **Manutenção** em lotes (§2), com `pendente`/`ocupada`/`proxima_em`; apaga identidades velhas; retenção mínima 7 d.
- **Segurança:** `so_central()` em toda `srv_*`; privilégios antes dos seeds; migração sem begin/commit próprio (de
  propósito: o protocolo de teste é `begin; migração; testes; rollback;` e um commit interno gravaria de verdade).
- **Constraints** mais estritas que a v1: tipo/nivel/origem de bloqueios e tipo/origem de confiáveis NOT NULL; rede só
  para ip/cidr. Seed de exposições com `verificado_em = now()` da migração; recomendação '—' gravada literal.
- **Testes** (`db/02_sentinela_teste.sql`): começa com `begin;` e um bloco que aborta (55000) se o schema não foi
  criado na mesma transação; termina com `rollback;`. Insere 4 usuários de teste em auth.users (somem no rollback).

### 8.2 Central (`supabase/functions/sentinela/`)
- Módulos puros (saneamento, jwt, hmac, ia, http, central) com dependências injetadas; `index.ts` só liga jose,
  supabase-js e `EdgeRuntime.waitUntil`. O banco só é chamado por `public.sentinela_srv_*` com os parâmetros do §2 (o
  teste confere nome e chaves de cada RPC).
- **project_id (D):** vem de `srv_lista.sistema.projeto_id`; o mapa fixo dos 8 projetos é reserva. Projeto novo que
  não está no mapa e sem o campo no banco é aceito por nome + owner_id.
- **OIDC** só production/preview; **HMAC** mínimo 32 caracteres, sobre `t` exatamente como veio no cabeçalho.
- **CSRF:** Origin + JSON obrigatórios nos POST do navegador.
- **/identidade (A):** checa perfil por `srv_permissao(sub, null)` e trata `ok:false` do banco → 403 `perfil_inativo`.
- **/passe (E):** passe só com `guarda_ativo === true`; senão URL do sistema sem passe, `ok:true`, `guarda_ativo:false`.
- **IP do cliente:** vale o primeiro cabeçalho PRESENTE na ordem; se o valor dele for inválido o resultado é null (não
  cai para o próximo, que poderia ser forjado).
- **Limitadores** por /64 em IPv6; teto global de `/tentativa` por instância; 405 com Allow.
- **IA, Tor, manutenção, chaves e erros:** ver §3.4/§3.5.

### 8.3 Guarda (`guarda/`)
- **Regras:** exceções só antes do robo; `varredura` estendida onde é seguro — dotfiles (`.env`, `.git`...), `wp-*`,
  phpmyadmin e vendor/phpunit em qualquer profundidade; `.php/.asp/.jsp/.cgi/.pl` também seguidos de `/`
  (PATH_INFO); `/.well-known/` por lista de liberados (acme-challenge, pki-validation, security.txt, appspecific/
  (DevTools do Chrome), change-password e change-password/, traffic-advice, assetlinks.json,
  apple-app-site-association, gpc.json, passkey-endpoints, web-identity, webauthn, openid-configuration, oauth-*,
  jwks.json, host-meta, webfinger, mta-sts.txt, caldav/carddav, mcp, e a sonda
  resource-that-should-not-exist-whose-status-code-should-not-be-200 do "alterar senha"); desconhecido continua
  varredura certo (rebaixar exigiria regra nova — em aberto). `injecao`: texto decodificado até 3 vezes (pega
  `%252e`), `+` da consulta lido como espaço, UNION depois de tirar `/* */` em laço linear (mantendo o conteúdo de
  `/*!50000 ... */` do MySQL), URL inteira (sem o teto de 8 KB do construtor); na consulta, `(..\){2}` ou `..\` seguido
  de windows/win.ini/boot.ini/web.config/inetpub/system32, `javascript:` seguido de `(`, `` ` `` ou `=` em até 60
  caracteres, e `cmd.exe` seguido de `/c`, `/k` ou `/r` ou precedido de `|`, `&`, `;`, `` ` `` ou quebra de linha (as
  buscas livres do Gestão TI davam falso positivo). `arquivos_proibidos` compilados com flag `i`; regex inválida é
  ignorada.
- **Cross-site (B):** 403 sem bloqueio local, motivo "possível requisição forjada por outro site (cross-site): sem
  bloqueio de IP" (antes "requisição cruzada (cross-site)"); `ferramenta` e same-origin/sem sec-fetch continuam
  bloqueando o IP.
- **rotas_publicas (C):** ignora vazia, `/`, `/*`, `*` e o que não for `/` + caractere.
- **Credenciais, lista, sessão, passe, sem_login, registro, bloqueio:** ver o bloco (v1.1) do §4.
- **Instalação:** a pasta `guarda/` não vai para o deploy do portal (`.vercelignore`); para guardar o próprio Painel
  Lube, copie `middleware.ts` + `sentinela-guarda.ts` para a raiz. O exemplo do ICMS no LEIA-ME segue o padrão
  `@supabase/ssr` porque o `src/middleware.ts` real não pôde ser lido — conferir antes de colar. O LEIA-ME tem a seção
  "Emergência: o TI ficou bloqueado" (SQL de recuperação não executado) e, desde G, o mínimo de 32 caracteres da
  `SENTINELA_CHAVE` (sugestão: 48 hex aleatórios), com o mesmo valor na Vercel e nos segredos da Edge Function.

### 8.4 Painel (`sentinela/`)
- Lê só as RPCs do §2 pelo supabase-js com a sessão do portal; painel completo a cada 60 s e `sentinela_novos` a cada
  4 s com a aba visível; os dois pausam com a aba oculta; o globo pausa fora da Visão geral. Recuo de 15/30/60 s
  quando o painel falha; trava de chamada em curso no painel e no novos; `p_desde_id` null enquanto não há id; próximo
  `p_desde_id` = id do último evento recebido (com 100 eventos, busca de novo em 400 ms).
- No ciclo periódico só Bloqueios, Confiáveis e IA se renovam (sem animação de entrada, innerHTML só se mudou);
  Configuração, Exposições e Integridade (5000 SHA-256) só na entrada, depois de uma ação ou no botão. Formulário
  da Configuração em edição não é sobrescrito ("Alterações ainda não salvas" / "A lista mudou no servidor").
- 'Salvar listas' abre modal com o que entra e sai, com aviso vermelho para rota nova em sistema com exige_login, lista
  de arquivos proibidos esvaziada ou regex que casa com qualquer caminho; o front já recusa rota sem `/`, `/` e `/*`.
- 'Confiar' em IP bloqueado mostra os bloqueios automáticos que serão revogados ('Confiar e revogar N'); a linha
  bloqueada não mostra 'Confiar'. 'Remover confiança' pela gaveta (escolha obrigatória com várias entradas). Liberar
  mostra o alvo do bloqueio (campos tipo/valor do painel) sem RPC extra.
- `status_motivo` mostrado com nome legível; buscador = 'buscador · sem bloqueio'. Sinal dos sistemas: horário
  comercial = seg–sáb 7h–19h de Brasília; sem sinal há > 30 min fora dele = verde-claro; nunca = cinza tracejado.
- Globo: até 300 arcos (os mais graves e recentes, com aviso); IP a menos de 60 km da casa sem arco; países com acesso
  `#1e3a7a`, demais `#22305e`; Antártida fora; roda do mouse rola a página (zoom com Ctrl/⌘ + roda).
- Tabela de 10 colunas: entre 821 e 1500 px Sistemas e Dispositivo vão para baixo de 'Quem'; até 820 px vira cartões;
  ações em botões de ícone, coluna Ações fixa à direita; reconciliação por linha (chave = IP). Limitação conhecida:
  entre 1081 e ~1220 px com a sidebar a tabela ainda rola por dentro (~124 px em 1100).
- Exposições: resumo por severidade conta as pendentes (aberta + aceita); badge = críticas + altas; marcar 'aceita'
  exige decisão escrita. Bandeiras com Noto Color Emoji (o Windows não desenha bandeira). Integridade testa `ok`
  antes de `verificados` e mostra detalhe e quebra_id. Hash do módulo validado (`#constructor` é ignorado).
- Demo com dados fictícios e parâmetros de teste (`&ia=sem_chave|erro`, `&cadeia=quebrada|vazia`,
  `&falhar=rpc:codigo`, `&rede=0`, `SNT.demo.*`), carregado só em localhost/127.0.0.1 com `?demo=1`; excluído do deploy.
- /tentativa mascarado (F) e sem keepalive; /identidade depois do login próprio.

### 8.5 Portal (`portal.js`, `index.html`, `admin.html`)
- `POST /identidade` com body `{}` (a identidade sai do Bearer), só para perfil ativo; perfil inativo leva signOut e
  não manda nada. Dispara e esquece (timeout 5 s).
- `POST /tentativa` quando o Supabase devolve `Invalid login credentials` ou `invalid_credentials` (senha errada e
  usuário inexistente), com o usuário mascarado (`j***@lube.com.br`), até 80 caracteres; e-mail de fora do domínio
  não é enviado.
- Clique no cartão: registra `abriu_sistema`, abre a janela em branco no próprio clique ('Abrindo <nome>…', opener
  null) e troca por `location.replace` para a URL do passe ou a normal. Ctrl/Shift/Alt/Cmd-clique, pop-up bloqueado
  ou janela que nasce fechada mantêm o link nativo; janela fechada no meio → aviso discreto. Cartão com URL que não é
  https fica com o link nativo.
- `pedirPasse(slug, s.url)` manda `destino = s.url` (endereço do admin) e só aceita resposta https na MESMA origem de
  `s.url`; limite total de 3 s; qualquer falha → URL normal. Aceita também a resposta sem passe do E.
- `?abrir=<slug>`: lido e apagado da barra ao carregar (preserva os outros parâmetros e o hash), slug em minúsculo
  validado por `^[a-z0-9][a-z0-9_-]{0,63}$` (inválido é ignorado); com permissão, registra `abriu_sistema` (espera até
  1,5 s) e vai para o passe; sem permissão ou desconhecido, aviso discreto; sem sessão, roda depois do login. Proteção
  contra vaivém: no máximo 1 ida automática por slug a cada 30 s por aba (sessionStorage); recarregar antes de entrar
  perde o redirecionamento.
- `admin.html` ganhou o link "Sentinela" no topo (só para admin ativo); `admin.js` não mudou. `index.html` só trocou o
  `?v=` do `portal.js`. O aviso discreto é criado por JS com estilo inline.
- `.vercelignore` exclui `db/`, `supabase/`, `guarda/`, `docs/`, `.claude/`, `README.md` e `sentinela/demo.js`.

### 8.6 Pendências A–G fechadas em 2026-10-06
| | o que | onde | teste |
|---|---|---|---|
| A | `srv_identidade` de conta sem perfil ativo → `{"ok":false,"motivo":"perfil_inativo"}` sem gravar em identidades nem em ips; Central `/identidade` → 403 `perfil_inativo`; `/passe` de conta inativa → 403 sem gravar identidade | banco, central (já tratava) | T14, T37A; central "/identidade: conta sem perfil ativo" e "/passe de conta inativa" |
| B | varredura/injeção cross-site: evento gravado com motivo "possível requisição forjada por outro site", sem bloqueio de IP; `ferramenta` continua bloqueando; guarda não põe no mapa local | banco, guarda (texto do motivo) | T35, T37B; guarda "img/link de outro site" |
| C | `sentinela_acao('sistema')` recusa (22023) rota vazia, `/`, `/*`, `*` e sem `/` + caractere; lista `[]` vale; guarda ignora as mesmas | banco, guarda | T22, T37C; guarda "rota pública ..." (2 casos) |
| D | `srv_lista.sistema.projeto_id`; Central usa no lugar do mapa fixo | banco (central já usava) | T09, T37D; central "project_id de sentinela.sistemas" |
| E | `srv_permissao.guarda_ativo` (= ultimo_sinal não nulo); Central só põe `sentinela_passe` com `guarda_ativo === true`, senão URL sem passe e `ok:true` | banco, central | T37E; central "/passe: sem guarda ativo" e http "montarUrlPasse" |
| F | aviso de login falho do painel com usuário mascarado como o portal | painel (o integrador já tinha feito; conferido) | comparação das duas funções em 10 entradas |
| G | LEIA-ME: `SENTINELA_CHAVE` ≥ 32 caracteres, sugestão 48 hex aleatórios, mesmo valor na Vercel e nos segredos da Edge Function | guarda/LEIA-ME.md | — |

### 8.7 Em aberto (decisão de contrato ou de produção)
- **Nada aplicado:** a migração não foi aplicada no Supabase, a Edge Function não foi publicada, nenhum guarda foi
  instalado e não houve commit. Ordem sugerida: migração → Edge Function (`verify_jwt=false`, segredo
  `ANTHROPIC_API_KEY`; `SENTINELA_CHAVE` só se o OIDC não chegar ao guarda) → guardas em observar → portal/painel.
  Depois de aplicar: `get_advisors` (as 25 funções security definer em public são esperadas) e conferir o painel logado.
- **Testes só locais:** banco no PGlite 0.5.8 (Postgres em WASM) com stubs de auth, vault, storage e papéis — risco
  residual de diferença de versão; Central e guarda em Node 24 com banco/OIDC/Anthropic falsos; ponta a ponta com o
  código real das três peças sobre o PGlite. Não testados: Supabase real, PostgREST real, OIDC real da Vercel dentro
  do middleware (nodejs e edge), Anthropic real, concorrência de duas sessões (ramo `ocupada` da manutenção, corrida
  da cota), volume de milhões de eventos, pop-up real no Chrome, animação do globo em movimento.
- **Invariante 2 em produção:** confirmar que a Edge do Supabase sobrescreve `cf-connecting-ip`/`x-real-ip` (mandar um
  `cf-connecting-ip` forjado ao `/tentativa` e ver o IP gravado).
- **Canon do selo:** a fórmula do §2 continua ambígua em teoria; as travas (CHECK, `%7C`, verificar_cadeia) impedem
  explorar sem deixar marca. Corrigir de vez muda o contrato.
- **Dedupe x rajada:** o dedupe de 5 s limita a ~12 eventos/min por caminho por instância; opção: campo `repeticoes`
  no Evento, somado em `janela_total`.
- **`/.sentinela/saude`** público expõe modo e idade da lista (JSON fixado no §4.1).
- **`/.well-known/` desconhecido** continua varredura certo.
- **Lista de até 5000** (~450 KB por instância a cada 20 s) e sem limite de taxa por guarda no `/evento`; função leve
  `sentinela_srv_sistema(p_projeto)` para autenticar sem o `srv_lista` pesado (hoje o cache de 5 min resolve).
- **Token OIDC verdadeiro vazado de outro projeto** da Lube recebe a lista daquele projeto (fechar exigiria conferir o
  host do evento contra os domínios do sistema). Instância fria cuja 1ª requisição só traz token forjado segue sem lista.
- **Mapa local do guarda** continua por IP em IPv6 (o banco já usa /64); não confirmado se a Vercel entrega IPv6.
- **Revisão do banco:** os achados 21 a 23 chegaram truncados e não foram vistos por ninguém.
