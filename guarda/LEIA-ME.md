# Guarda da Sentinela Lube — instalação

O guarda roda na porta de cada sistema da Vercel. Ele lê IP e geo, aplica as regras de ataque e a
lista da central, registra o acesso e barra o que precisa. Se der qualquer erro, ou se a central
estiver fora do ar, o sistema continua abrindo (falha aberta); as regras locais de ataque continuam
valendo. Contrato completo: `docs/SENTINELA-ESPECIFICACAO.md` §4.

| arquivo | o que é |
|---|---|
| `sentinela-guarda.ts` | o núcleo. Sem dependências, só Web APIs. Roda nos runtimes nodejs e edge e no middleware do Next 15/16. |
| `middleware.ts` | a casca para projetos estáticos (Routing Middleware da Vercel). |
| `teste/` | testes em Node 24 (`node guarda/teste/guarda.teste.mjs`, `rede.teste.mjs`, `middleware.teste.mjs`, `edge.teste.mjs`). |

Nada de segredo nestes arquivos: eles podem ficar públicos.

## Regras (guarda 1.1.0, 2026-10-07)

Ordem: ataque certo → lista → arquivo proibido → exceções → regras de user-agent → `sem_login` → rede da
Lube (1.3.0, abaixo) → liberado.
O nível **certo** barra (403) em qualquer modo e para todos. O nível **suspeito** barra só no modo
**proteger**; no **observar** só registra (`observado`); de IP **confiável** é ignorado (liberado, motivo
"rede confiável: ... (ignorado)").

| regra | nível | quando |
|---|---|---|
| `ferramenta`, `varredura`, `injecao` | certo | UA de ferramenta de ataque, caminho de varredura, injeção na URL. Vale também para quem tem sessão e para rede confiável |
| `lista` | o do bloqueio | IP, faixa ou JA4 bloqueado na central (e o mapa local de 24 h depois de um ataque). Bloqueio **suspeito** (robô, rajada, força bruta, Tor, IA) não barra quem tem identidade: a pessoa logada segue e o evento sai `observado`, motivo "... · com login: não barrado" (o bloqueio pega o IP inteiro, e no CGNAT do 4G ou no Wi-Fi de filial isso é muita gente). Bloqueio **certo** barra todo mundo |
| `arquivo_proibido` | suspeito | caminho em `arquivos_proibidos` do sistema |
| `cron`, `previa_link`, `office`, `navegador_simples` | exceção (liberado) | `vercel-cron/` **no começo** do UA (o agendador manda só `vercel-cron/1.0`); prévia de link (`whatsapp`, `telegrambot`, `slackbot`, `facebookexternalhit`, `twitterbot`, `linkedinbot`, `discordbot`, `skypeuripreview`, `microsoftpreview`); sondagem e link do Office (`Microsoft Office Existence/Protocol Discovery`, `Microsoft Office Word/Excel/... 2014`, `ms-office`, `Microsoft Office/16.0 (`); navegador simples ou leitor de pessoa (`w3m`, `Lynx`, `Links`, `ELinks`, `Dillo`, `NetSurf`, `UCWEB`/`UCBrowser`, `Google-Read-Aloud`, `AndroidDownloadManager`). UA que também traz cliente HTTP, varredor conhecido ou buscador **não** é exceção (`curl/8 WhatsApp/2`, `python-requests vercel-cron/1.0`, `Googlebot ... Slackbot` caem em `robo`/`buscador`); só o LinkedIn declara `Apache-HttpClient` no próprio UA. Só veem a tela de login ou o redirect: nunca dispensam o `sem_login` |
| `buscador` | suspeito (**novo na 1.1.0**; antes era exceção observada) | `googlebot`, `bingbot`, `duckduckbot`, `yandexbot`, `baiduspider`, `applebot` em página ou API. Arquivo (`robots.txt`, `manifest.json`) segue |
| `robo` | suspeito (**ampliado na 1.1.0**) | página ou API com UA: vazio; cliente HTTP ou automação (`curl`, `wget`, `python-requests`, `python/`, `httpx`, `aiohttp`, `go-http-client`, `okhttp`, `axios`, `node-fetch`, `undici`, `node`, `Deno/`, `Bun/`, `Dalvik/`, `libwww-perl`, `HeadlessChrome`, `Lighthouse`, `Puppeteer`, `Playwright`...); varredor conhecido (`censys`, `shodan`, `zoomeye`, `netcraft`, `leakix`, `expanse`, `recordedfuture`, `nomorevibe`, `internet-measurement`, `onyphe`, `binaryedge`, `ChatGPT-User`, `Claude-User`...); palavra de rastreador (`bot` no fim da palavra, `crawl`, `spider`, `scanner`, `inventory`, `monitor`, `probe`, `fetch`, `scraper`, `checker`...) e endereço no UA (`http://`, `www.`, `+contato`, `@dominio`), as duas testadas no UA **sem os dados do aparelho e do app** (ver abaixo); `Mozilla/...` sem motor de navegador (`Mozilla/5.0 (compatible)`); e, **só em página**, UA que não começa com `Mozilla/` nem `Opera/` |
| `nao_navegador` | suspeito (**novo na 1.1.0**) | GET ou HEAD de **página** sem `sec-fetch-mode` **e** sem `accept-language` (navegador de verdade sempre manda os dois numa navegação; o Safari antigo e o IE 11 mandam pelo menos o `accept-language`). Não vale para API, arquivo, POST nem IP confiável |
| `sem_login` | — | sistema com "exige login", sem sessão válida, fora de `rotas_publicas` |

- **Quem tem identidade** (cookie de sessão válido da Sentinela, ou `opcoes.identidade` do app Next) nunca
  cai em `buscador`, `robo` nem `nao_navegador`: pessoa logada não é robô. Ataque certo, `lista` e
  `arquivo_proibido` continuam valendo para ela. Sessão de outra chave ou vencida não é identidade.
- **Navegador de verdade não cai em nenhuma**: os testes passam 36 UAs reais (Chrome, Edge, Firefox,
  Safari, Samsung Internet, Opera, MIUI, app do Google, WebView do Android, navegador dentro do
  Instagram, Threads, Facebook, LinkedIn, TikTok, Telegram e Snapchat, celular Cubot e FOSSiBOT) com os
  cabeçalhos que eles mandam, mais Safari antigo e IE 11 (sem `sec-fetch-*`, com `accept-language`).
- **Marca e modelo do celular saem antes das palavras de rastreador.** Fabricante, modelo e codinome
  aparecem no parêntese do Android (`(Linux; Android 13; FOSSiBOT F102 ...)`), na cauda do Instagram e do
  Threads (`Android (33/13; ...; FOSSiBOT; F102; ...)`), no parêntese do Telegram e do Snapchat
  (`(Fossibot F102; Android 13; ...)`) e no colchete do Facebook/Messenger (`[FB_IAB/...;FBMF/FOSSiBOT;...]`).
  O guarda tira todo parêntese que fala de Android/iPhone/iPad ou vem depois de `Android `, todo colchete e
  as marcas `cubot`/`fossibot`; `(compatible; XBot/1.0; +http://...)` fica. Na primeira versão da 1.1.0 (não
  publicada) a pessoa com FOSSiBOT levava 403 no Instagram, Facebook e Telegram, até na volta do portal.
- **No modo proteger, fora da rede confiável, levam 403:** monitor de disponibilidade (UptimeRobot,
  check_http), buscadores, ferramentas de teste (inclusive o "Vercel MCP Fetch" que o Claude usa) e a
  prévia do Google Chat (não está entre as prévias liberadas). Office, navegadores simples e o leitor em
  voz alta do Google são exceção: no portal veem a tela de login; no sistema fechado vão para o portal.
  Para conferir um sistema publicado, use um navegador de verdade ou a rede confiável.
- **Ainda não coberto:** pessoa **sem login** que divide o IP (CGNAT) com um robô bloqueado como suspeito
  leva 403 até o bloqueio vencer (robô 1 h, rajada 15 min), inclusive na tela de login do portal. O guarda
  não sabe a origem do bloqueio; o ajuste fica na central (não criar bloqueio automático de `robo`/`rajada`
  em IPv4 que teve evento com identidade nas últimas horas).
- No banco, `nao_navegador` ainda não tem risco base (vale 0 + os modificadores de página sem
  `sec_fetch_mode` e sem idioma) e o bloqueio automático de IP conta só eventos `robo`.

## Regra de rede da Lube (guarda 1.3.0, 2026-10-23)

Pedido do gestor geral: o portal e os sistemas internos só abrem para quem está na rede da empresa.
Desenho completo: `docs/SENTINELA-REDE.md`. Quem manda é a central: a `/lista` traz, por sistema, o
**modo de rede**, as **redes da Lube** (IPs e faixas cadastrados pelo TI) e os **liberados fora da rede**
(SHA-256 do e-mail e o fim da liberação; a lista nunca traz e-mail).

| modo | o que o guarda faz com quem está fora da rede |
|---|---|
| `desligado` (ou lista sem o bloco `rede`) | **nada: igual ao 1.2.0**. Dá para instalar o 1.3.0 em todos sem mudar nada para ninguém |
| `observar` | deixa passar e registra `observado`, regra `fora_da_rede`, motivo "seria bloqueado: fora da rede da Lube" |
| `exigir` | 403 "Este sistema só abre na rede da Lube" (só com o OK do Júlio) |

Ordem: a regra entra **no fim**, depois do `sem_login`, e só decide quem ia passar. Ataque certo,
bloqueio da lista, modo proteger e `sem_login` continuam vindo antes, como no 1.2.0.

- **A rede é conferida a cada pedido.** Sessão de 8 h pega na empresa e levada para casa não vale fora.
- **Só o `x-real-ip`**, que a Vercel sobrescreve. `x-forwarded-for`, `x-vercel-forwarded-for`,
  `cf-connecting-ip`, `forwarded`, `referer` e `origin` nunca põem ninguém "dentro". IP vazio ou
  inválido = fora (o evento leva "· IP sem x-real-ip" quando o IP veio só por outro cabeçalho).
- **IPv4 e IPv6**, IP solto ou faixa; `::ffff:a.b.c.d` vale como IPv4. Faixa mais larga que **/24**
  (IPv4) ou **/48** (IPv6) é ignorada, como a central já recusa.
- **Sempre passam:** `/.sentinela/*` (o Guardião confere a saúde de fora); IP numa rede da Lube; quem
  **não tem login** no **portal** (sistema sem slug: a tela de login e o atalho do SAC abrem de qualquer
  lugar); máquina autenticada pelo app (abaixo); pessoa liberada. Num sistema com slug, quem não tem
  login também passa pela regra, mesmo com o "exige login" desligado (desligar o login de um sistema,
  por engano ou com a senha de um admin de fora, não o abre para fora da rede).
- **Liberado:** o guarda compara o SHA-256 do e-mail da sessão (ou do login do app), em minúsculas,
  com a lista. Só vale com a rede da lista de **até 2 min**: lista mais velha espera a renovação (até
  **2,5 s**, o prazo da central; só quem está fora paga essa espera) e, se a central não responder, a
  liberação não vale. Encerrar no painel chega em ~30 s.
- **`exigir` sem nenhuma rede válida vira `observar`**: lista vazia não tranca a empresa.
- **Lista sem o bloco** (central antiga, RPC fora): vale o último bloco recebido por até 24 h; depois,
  sem regra. A reserva do modo fechado (central fora) usa esse mesmo bloco; numa partida a frio não há
  bloco, e a regra não vale.
- **Rede confiável** (`sentinela.confiaveis`, aprendida pelo login, até de casa) **não** dispensa a rede.
- **Nunca bloqueia IP**, nunca pede bloqueio à central e nunca mexe em cookie. O mesmo IP, sem login,
  continua vendo o portal.
- **Passe trocado fora da rede** (pego dentro e usado fora em 90 s): no `exigir` e sem liberação, 403
  **sem nenhum `Set-Cookie`**, motivo "fora da rede da Lube · passe trocado, sessão não entregue". No
  `observar` ou liberado, 302 com o cookie, como sempre.

Respostas do 403 de rede (cabeçalho `x-sentinela: rede`, `cache-control: no-store`, sem código de
incidente e sem IP):
- **página** (GET/HEAD de página, inclusive no iframe do portal): HTML âmbar "Este sistema só abre na
  rede da Lube · Você está fora da empresa · Se precisa acessar, fale com o TI", a dica "Está na Lube?
  Use o Wi-Fi da empresa (no celular, desligue os dados móveis e a VPN) e recarregue a página. Se o TI
  acabou de liberar você, espere 1 minuto e recarregue." e o botão "Voltar ao Painel Lube" (abre fora do
  iframe);
- **API, arquivo e outros métodos:** `{"erro":"fora_da_rede","mensagem":"...","portal":"https://..."}`.

Eventos novos (todos com risco base 0 na central):

| regra | decisão | quando |
|---|---|---|
| `fora_da_rede` | `bloqueado` / `observado` | fora, sem liberação (`exigir` / `observar`) |
| `rede_liberado` | `liberado` | fora, pessoa liberada pelo TI ("liberado pelo TI até ...") |
| `rede_maquina` | `liberado` | fora, máquina autenticada pelo app |
| `cron` | `liberado` | o agendador do Gestão TI com a marca: motivo "agendamento da Vercel · fora da rede da Lube: máquina autenticada pelo sistema" |

O que já estava marcado no evento (por exemplo, bloqueio suspeito da lista com login) vai no motivo,
depois de "· também ...".

`/.sentinela/saude` ganha `lista.rede`: `"desligado"`, `"observar"`, `"exigir"` ou `null` (sem bloco). É o
modo que o guarda aplica (exigir sem rede aparece `"observar"`); nunca mostra as redes nem os liberados.
E `lista.rede_idade_s`, a idade do bloco em segundos (`null` sem bloco): com a central mandando a lista
sem o bloco (central antiga, `srv_rede_lista` falhando), a lista fica nova (`idade_s` pequeno) e o bloco
envelhece. **`rede_idade_s` acima de ~120 com `idade_s` pequeno = as mudanças de modo, redes e
liberações não estão chegando a este sistema** (e os liberados já não passam).

### Máquina autenticada (`maquina: true`)

Chamada de servidor para servidor de fora da rede (o agendador da Vercel sai de um IP da Amazon
diferente a cada dia) passa **só** se o próprio app conferiu o segredo dela e marcou a identidade:

```ts
// Gestão TI (src/middleware.ts): depois de conferir Authorization: Bearer <CRON_SECRET> em /api/cron/
const ROBO_AGENDADOR = { email: "robo do gestao ti (agendador da vercel)", origem: "sessao_app" as const, maquina: true };
```

- Vale só com `origem: 'sessao_app'` e nome de robô no formato `robo <nome>` (minúsculas, letras,
  números, espaço e `()._-`, de 3 a 80 caracteres). E-mail de pessoa com `maquina: true` não é máquina.
- A marca só dispensa a regra de rede. Não dispensa ataque, lista nem login.
- **Nunca** marque por IP, por user-agent (`vercel-cron/1.0` qualquer um manda) ou por cabeçalho que o
  cliente escolhe. Sem a marca, o robô de fora cai em `fora_da_rede` (403 no `exigir`).
- Reposições: o aquecedor da `SRV-IA` entra pelo segredo próprio `AQUECEDOR_SEGREDO` (mínimo 32 caracteres)
  no cabeçalho `x-lube-aquecedor`, só em `GET /api/dados`, conferido em tempo constante pelo `web/middleware.ts`
  do Reposições, que marca `{ email: 'robo do reposicoes (aquecedor da srv-ia)', origem: 'sessao_app', maquina: true }`
  (`docs/SENTINELA-REDE.md` §14.2). Cabeçalho próprio, e não `Authorization`, para o CDN continuar guardando
  `/api/dados`.

## Projeto estático (portal, Compras, RH, Financeiro, Comercial, Saída de Veículos)

1. Copie `sentinela-guarda.ts` e `middleware.ts` para a **raiz do projeto na Vercel** (a pasta do
   Root Directory), lado a lado. Não precisa de `package.json` nem de build.
2. Confira na Vercel › projeto › Settings › Security que **OIDC Federation** está ligado no modo
   **Team** (emissor `https://oidc.vercel.com/lube-distribuidora-ltda`). É com esse token que o guarda
   se apresenta para a central.
3. Faça o deploy e abra `https://<sistema>/.sentinela/saude`. O esperado:
   `"oidc": true` e `"lista": {"ok": true, ...}`.
4. Se `oidc` vier `false`, use o plano B: em Settings › Environment Variables, crie como
   **Sensitive** `SENTINELA_CHAVE` e `SENTINELA_PROJETO` (o nome do projeto na tabela da
   especificação, ex. `painel-compras`). Redeploy.
   - `SENTINELA_CHAVE` precisa ter **no mínimo 32 caracteres**; o sugerido é **48 caracteres hex
     aleatórios** (24 bytes). Gere no seu computador, por exemplo com
     `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`.
   - O **mesmo valor** vai em dois lugares: na Vercel (Environment Variables do projeto, como acima) e
     nos segredos da Edge Function (Supabase › projeto PAINEL LUBE DISTRIBUIDORA › Edge Functions ›
     Secrets › `SENTINELA_CHAVE`). Valor diferente nos dois, ou com menos de 32 caracteres, e a
     central desliga o plano B e responde 401 (o log da Edge Function avisa a chave curta, sem mostrá-la).
   - Nunca grave essa chave em arquivo, no repositório nem no Cérebro.

Ordem das credenciais: primeiro o token que a central já aceitou, depois `VERCEL_OIDC_TOKEN`, depois o
HMAC do plano B e, por último, o token que vem na própria requisição (header e request-context), porque
esse pode ser forjado. Se a central recusar um token, ele fica 10 min de quarentena e o guarda tenta o
próximo. Com o plano B configurado, um header forjado não passa por cima da chave.

O `matcher` do `middleware.ts` deixa de fora só imagem, fonte e CSS. JS e JSON passam porque em alguns
sistemas são os dados. Para rodar no edge, acrescente `runtime: 'edge'` ao `config`; o padrão
(nodejs) também funciona.

Para desligar numa emergência, veja [Emergência](#emergência-o-ti-ficou-bloqueado) no fim deste arquivo.

## Projeto Next.js (Gestão TI, Painel ICMS)

1. Copie `sentinela-guarda.ts` para `src/lib/sentinela-guarda.ts`.
2. No `src/middleware.ts` existente, chame o guarda **na primeira linha**. Se ele devolver uma
   resposta, devolva-a como veio. Se devolver `null`, siga com a lógica atual sem mudar nada.
3. Receba o segundo parâmetro (`event: NextFetchEvent`) e passe para o guarda: é o `waitUntil` que
   envia o registro depois da resposta.

### Gestão TI (sessão própria por cookie HMAC)

Só as linhas marcadas com `+` são novas; o resto é o arquivo de hoje, intacto.

```ts
  import { NextResponse, type NextRequest } from "next/server";
+ import type { NextFetchEvent } from "next/server";
  import { verificarSessao, COOKIE_SESSAO } from "@/lib/auth";
+ import { sentinela } from "@/lib/sentinela-guarda";

  const PUBLICAS = [ /* ...igual a hoje... */ ];

- export async function middleware(req: NextRequest) {
+ export async function middleware(req: NextRequest, event: NextFetchEvent) {
+   // Sentinela primeiro. A sessão do próprio app vira a identidade do evento.
+   const sessaoApp = await verificarSessao(req.cookies.get(COOKIE_SESSAO)?.value);
+   const barrado = await sentinela(req, event,
+     sessaoApp ? { identidade: { email: sessaoApp.email, origem: "sessao_app" } } : undefined);
+   if (barrado) return barrado;
+
    const { pathname } = req.nextUrl;
    // ...todo o resto igual a hoje (PUBLICAS, verificarSessao, 401/redirect para /login)...
  }

  export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
```

### Painel ICMS (login com `@supabase/ssr`)

O `@supabase/ssr` cria a resposta (`NextResponse.next({ request })`) e grava nela os cookies `sb-*`
renovados. O guarda não cria nem toca nessa resposta. Ele só decide antes se a requisição segue.

Se o middleware chama um `updateSession`:

```ts
import type { NextFetchEvent, NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";   // o que já existe hoje
import { sentinela } from "@/lib/sentinela-guarda";

export async function middleware(request: NextRequest, event: NextFetchEvent) {
  const barrado = await sentinela(request, event);
  if (barrado) return barrado;           // 403 / 302 / 401 da Sentinela, sem cookie do Supabase
  return await updateSession(request);   // lógica atual intacta, cookies sb-* como antes
}

export const config = { matcher: [ /* ...igual a hoje... */ ] };
```

Se o `createServerClient` está escrito dentro do próprio middleware, a regra é a mesma: as duas linhas
do guarda entram **antes** de `let supabaseResponse = NextResponse.next({ request })`, e o resto fica
como está. Não copie headers da resposta do guarda para a do Supabase, nem o contrário. O
`AUTH_DESLIGADA_TEMPORARIAMENTE` do ICMS não interfere no guarda.

> Os exemplos acima foram escritos a partir do `src/middleware.ts` do Gestão TI (lido no disco) e do
> padrão oficial do `@supabase/ssr`. O arquivo real do ICMS não estava acessível daqui: confira o
> nome da função (`updateSession` ou inline) antes de colar.

**Next 16:** o `middleware.ts` passou a se chamar `proxy.ts` (`export async function proxy(...)`). A
integração é a mesma. Se o seu `proxy` não receber `event`, chame `sentinela(request)`: o registro
passa a ser "dispara e esquece".

As variáveis do plano B (`SENTINELA_CHAVE`, `SENTINELA_PROJETO`) funcionam também no Next. O núcleo
lê `process.env.X` escrito por extenso, que é como o Next entrega variáveis ao middleware.

## Antes de ligar o modo proteger

- Deixe todos os sistemas pelo menos alguns dias em **observar** e olhe no painel os eventos
  `observado`. Chamadas de servidor para servidor (user-agent `undici`, `node`, `node-fetch`, `axios`,
  `python-requests`, `Deno/`) aparecem como `robo` e seriam barradas; página pedida por script sem
  cabeçalhos de navegador aparece como `nao_navegador`. Coloque a origem em **Confiáveis** ou resolva
  antes.
- **Sistema com "exige login":** cron da Vercel e prévias de link (WhatsApp, Teams) **não** passam sem
  login, porque o user-agent é falsificável. Ponha a rota do cron em `rotas_publicas` (ex.
  `/api/cron/`); o próprio app continua protegendo a rota com `CRON_SECRET`.
- `rotas_publicas`: `/acompanhar` libera `/acompanhar` e `/acompanhar/123`, mas não `/acompanharx`.
  `/_next/` e `/_next/*` liberam tudo que começa com `/_next/`. Rota vazia, `/`, `/*`, `*` ou que
  não seja `/` seguida do caminho é recusada pelo banco e ignorada pelo guarda (liberaria o sistema
  inteiro): para abrir tudo, desligue "exige login".
- Caminho de ataque (varredura/injeção) pedido com `sec-fetch-site: cross-site` (um `<img>` ou link de
  outro site) leva 403, mas **não** bloqueia o IP, nem no guarda nem no banco: o evento sai com o
  motivo "possível requisição forjada por outro site". User-agent de ferramenta continua bloqueando.
- `arquivos_proibidos` são regex sobre o caminho decodificado e não diferenciam maiúsculas.

## Como testar

```
node guarda/teste/guarda.teste.mjs       # núcleo: regras, lista, sessão, passe, central fora, desempenho
node guarda/teste/rede.teste.mjs         # regra de rede da Lube (1.3.0) e comparação com o 1.2.0
node guarda/teste/middleware.teste.mjs   # casca estática
node guarda/teste/edge.teste.mjs         # núcleo dentro do Edge Runtime do Next (sem process/Buffer)
```

Prova de que o modo desligado é o 1.2.0:
- `SENTINELA_TESTE_REDE=desligado node guarda/teste/guarda.teste.mjs` roda a bateria do 1.2.0 inteira
  com o bloco `rede` em toda lista (modo desligado, com a rede do escritório, faixas e um liberado). Tem
  de passar igual. Com `SENTINELA_TESTE_REDE=exigir` ela **tem** de falhar (contraprova).
- O caso 22 do `rede.teste.mjs` roda os mesmos pedidos no núcleo do commit `9f1732a` (1.2.0, lido pelo
  git) e no 1.3.0 e compara resposta, eventos e chamadas à central.

## Emergência: o TI ficou bloqueado

O painel `/sentinela/` fica atrás do guarda do portal: se o seu IP cair num bloqueio `certo`, portal e
painel respondem 403 (bloqueio da lista vale até para IP confiável). E `sentinela_acao` começa com
`is_admin()`, que lê o login do JWT; por isso ela não roda no SQL Editor. O caminho é este:

1. Descubra o seu IP: `https://painel-lube-distribuidora.vercel.app/.sentinela/saude` responde mesmo
   com o IP bloqueado (campo `ip`).
2. Supabase › projeto **PAINEL LUBE DISTRIBUIDORA** › **SQL Editor**, trocando `<SEU_IP>`:

   ```sql
   -- revoga os bloqueios ativos que cobrem o IP (exato ou faixa)
   update sentinela.bloqueios
      set revogado_em = now(), revogado_por = 'sql-emergencia'
    where revogado_em is null
      and (expira_em is null or expira_em > now())
      and tipo in ('ip', 'cidr')
      and rede >>= '<SEU_IP>'::inet;

   -- marca o IP como confiável: o guarda passa a ignorar o bloqueio de 24 h que cada instância
   -- guarda na memória depois de ver um ataque (esse mapa a central não alcança)
   insert into sentinela.confiaveis (tipo, valor, rede, descricao, origem, criado_por)
   values ('ip', '<SEU_IP>', '<SEU_IP>'::cidr, 'emergência: TI bloqueado', 'manual', 'sql-emergencia');

   -- confira o que sobrou
   select id, tipo, valor, nivel, regra, motivo, expira_em
     from sentinela.bloqueios
    where revogado_em is null and (expira_em is null or expira_em > now())
    order by criado_em desc
    limit 20;
   ```

3. Espere uns 20 s (o guarda renova a lista) e recarregue. Depois, pelo painel, revise o bloqueio e,
   se quiser, remova o confiável de emergência.
4. Último recurso: apague o `middleware.ts` da raiz **do portal** (`painel-lube-distribuidora`) e faça o
   redeploy. Um deploy novo também zera o mapa local de todas as instâncias daquele projeto.

## Emergência: todo mundo do escritório vê "só abre na rede da Lube"

Causa provável: a operadora trocou o IP do escritório, ou a internet caiu para outro link. Passo a passo
completo em `docs/SENTINELA-REDE.md` §12.

1. Num computador do escritório, abra `https://painel-lube-distribuidora.vercel.app/.sentinela/saude`
   (responde de qualquer lugar): o campo `ip` é o IP novo.
2. Supabase › projeto **PAINEL LUBE DISTRIBUIDORA** › **SQL Editor**, trocando `<IP_NOVO>`:

   ```sql
   select sentinela.emergencia_rede('<IP_NOVO>', 'escritório: IP novo da operadora');
   -- sem achar o IP? pausa a regra em todos (exigir → observar; volta pelo painel):
   select sentinela.emergencia_pausar_rede();
   ```

   **IPv6** (o `ip` tem `:`): cada computador sai com um endereço próprio dentro do mesmo prefixo. Cole o
   endereço como veio: a função cadastra o **/64** inteiro (ex.: `2001:db8:1:2::15` vira `2001:db8:1:2::/64`).

   Se a função der erro (apagada ou com defeito), as linhas cruas (em IPv6, o prefixo com o fim zerado,
   como `2001:db8:1:2::/64`). Sem a migração aplicada não existe regra de rede, e não há nada a destravar
   por aqui:

   ```sql
   insert into sentinela.redes (rede, descricao, origem, criado_por)
   values ('<IP_NOVO>/32', 'escritório: IP novo', 'emergencia', 'sql-emergencia');
   update sentinela.rede_sistemas set modo = 'observar', modo_em = now(), modo_por = 'sql-emergencia'
    where modo = 'exigir';
   ```

3. Espere até ~30 s (10 s de cache na central + 20 s da lista do guarda) e recarregue. As sessões
   continuam valendo.
4. Para voltar atrás de vez: modo `desligado` (pelo painel da Sentinela ou
   `update sentinela.rede_sistemas set modo = 'desligado' ...`). Com ele o 1.3.0 age igual ao 1.2.0: não é
   preciso tirar o guarda.

**Quando a volta pelo banco não chega aos guardas.** Tudo acima depende da central 1.1.0 no ar mandando o
bloco `rede` na `/lista`. Se a central voltar para a versão antiga (7) ou o log dela mostrar
`rede: srv_rede_lista falhou`, a lista sai sem o bloco e cada guarda segue com o **último bloco por até
24 h** (`lista.rede_idade_s` crescendo no `/.sentinela/saude`): "Desligar todos", a pausa por SQL e as
redes novas não chegam, e os liberados passam a levar 403 no `exigir`. Então:
- **nunca** volte a central para antes da 1.1.0 com algum sistema fora de `desligado`: primeiro
  "Todos em desligado", confira `lista.rede: "desligado"` no `/.sentinela/saude` de cada sistema, e só
  então volte a central;
- com o `srv_rede_lista` falhando, a volta atrás é o **Instant Rollback** de cada sistema para o deployment
  do 1.2.0 anotado antes do deploy (`docs/SENTINELA-REDE.md` §20).
