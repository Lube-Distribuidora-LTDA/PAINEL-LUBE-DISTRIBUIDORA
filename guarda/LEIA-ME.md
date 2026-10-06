# Guarda da Sentinela Lube — instalação

O guarda roda na porta de cada sistema da Vercel. Ele lê IP e geo, aplica as regras de ataque e a
lista da central, registra o acesso e barra o que precisa. Se der qualquer erro, ou se a central
estiver fora do ar, o sistema continua abrindo (falha aberta); as regras locais de ataque continuam
valendo. Contrato completo: `docs/SENTINELA-ESPECIFICACAO.md` §4.

| arquivo | o que é |
|---|---|
| `sentinela-guarda.ts` | o núcleo. Sem dependências, só Web APIs. Roda nos runtimes nodejs e edge e no middleware do Next 15/16. |
| `middleware.ts` | a casca para projetos estáticos (Routing Middleware da Vercel). |
| `teste/` | testes em Node 24 (`node guarda/teste/guarda.teste.mjs`, `middleware.teste.mjs`, `edge.teste.mjs`). |

Nada de segredo nestes arquivos: eles podem ficar públicos.

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
  `observado`. Chamadas de servidor para servidor (user-agent `undici`, `node-fetch`, `axios`,
  `python-requests`) aparecem como `robo` e seriam barradas. Coloque a origem em **Confiáveis** ou
  resolva antes.
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
node guarda/teste/middleware.teste.mjs   # casca estática
node guarda/teste/edge.teste.mjs         # núcleo dentro do Edge Runtime do Next (sem process/Buffer)
```

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
