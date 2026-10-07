/* Roda o núcleo dentro do Edge Runtime (o mesmo VM que o Next usa no middleware):
   sem process, sem Buffer, sem require. Usa o edge-runtime que vem com o Next
   de outro projeto da Lube (só leitura). Rodar na raiz do repositório:
     node guarda/teste/edge.teste.mjs
   Outro caminho: SENTINELA_EDGE_RUNTIME=<pasta do edge-runtime> node ... */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';
import { lista, gerarChave, assinarJwt, sessaoPayload, oidcFalso, UA, UAS_REAIS, caso, conta, executar } from './apoio.mjs';

const CENTRAL = 'https://wkkdcsqwlxjxorutrbnx.supabase.co/functions/v1/sentinela';
const pastaEdge = process.env.SENTINELA_EDGE_RUNTIME ||
  fileURLToPath(new URL('../../../5. GESTÃO TI/node_modules/next/dist/compiled/edge-runtime/', import.meta.url));
if (!existsSync(pastaEdge + '/index.js')) {
  console.log('edge-runtime não encontrado em ' + pastaEdge + ' — teste pulado');
  process.exit(0);
}
const { EdgeRuntime } = createRequire(import.meta.url)(pastaEdge + '/index.js');

const fonte = readFileSync(new URL('../sentinela-guarda.ts', import.meta.url), 'utf8');
const js = stripTypeScriptTypes(fonte, { mode: 'strip' })
  .replace(/^export (const|async function) /gm, '$1 ') + '\n;globalThis.__sentinela = { sentinela, VERSAO };';

function novoEdge(listaObj) {
  const rt = new EdgeRuntime();
  const estado = { eventos: [], chamadas: 0 };
  rt.context.fetch = async (url, init) => {
    estado.chamadas++;
    const rota = String(url).slice(CENTRAL.length);
    const corpo = rota === '/lista' ? JSON.stringify(listaObj)
      : rota === '/evento' ? (estado.eventos.push(...JSON.parse(init.body).eventos), '{"gravados":1}') : '{}';
    return { ok: true, status: 200, text: async () => corpo };
  };
  rt.evaluate(js);
  const g = rt.context.__sentinela;
  // cabeçalhos de navegação de navegador (sec-fetch-mode, accept-language); semNavegador tira os dois
  const pedir = (caminho, o = {}) => new rt.context.Request('https://painel-compras-rosy.vercel.app' + caminho, {
    method: o.metodo || 'GET',
    headers: {
      'x-real-ip': o.ip || '177.100.20.30', 'user-agent': o.ua || UA, 'x-vercel-oidc-token': oidcFalso(),
      ...(o.semNavegador ? {} : { 'accept-language': 'pt-BR,pt;q=0.9', 'sec-fetch-mode': 'navigate', 'sec-fetch-site': 'none', 'sec-fetch-dest': 'document' }),
      ...(o.cookie ? { cookie: o.cookie } : {}),
    },
  });
  const ctx = () => { const p = []; return { waitUntil: (x) => p.push(x), esperar: () => Promise.all(p) }; };
  return { rt, g, pedir, ctx, estado };
}

caso('no Edge Runtime: sem process/Buffer, runtime "edge" na saúde', async () => {
  const { rt, g, pedir } = novoEdge(lista());
  assert.equal(rt.evaluate('typeof process + "/" + typeof Buffer + "/" + typeof require'), 'undefined/undefined/undefined');
  assert.equal(g.VERSAO, 'sentinela-guarda/1.1.0');
  const r = await g.sentinela(pedir('/.sentinela/saude'));
  const j = JSON.parse(await r.text());
  assert.equal(j.runtime, 'edge');
  assert.equal(j.lista.ok, true);
  assert.equal(j.oidc, true);
  conta(5);
});

caso('no Edge Runtime: legítimo segue e registra; ataque → 403', async () => {
  const { g, pedir, ctx, estado } = novoEdge(lista());
  const c1 = ctx();
  assert.equal(await g.sentinela(pedir('/api/dados'), c1), null);
  await c1.esperar();
  assert.equal(estado.eventos.length, 1);
  assert.equal(estado.eventos[0].decisao, 'liberado');
  const r = await g.sentinela(pedir('/?id=1%20UNION%20SELECT%201', { ip: '45.9.9.9' }), ctx());
  assert.equal(r.status, 403);
  assert.ok((await r.text()).includes('Acesso bloqueado pela Sentinela Lube'));
  conta(5);
});

caso('no Edge Runtime: sessão ES256 (r||s) verificada com crypto.subtle e CIDR/IPv6 com BigInt', async () => {
  const chave = await gerarChave('k-edge');
  const l = lista({ projeto: 'gestao-finaceiro', slug: 'gestao-financeiro', exige: true, chaves: [chave.jwk],
    bloqueios: [{ id: 1, t: 'cidr', v: '2001:db8::/32', n: 'certo', ate: null }] });
  const { g, pedir, ctx, estado } = novoEdge(l);
  const cookie = '__Host-sentinela=' + (await assinarJwt(sessaoPayload(), chave));
  const c1 = ctx();
  assert.equal(await g.sentinela(pedir('/', { cookie }), c1), null);
  await c1.esperar();
  assert.equal(estado.eventos[0].identidade, 'julio@lube.com.br');
  const semSessao = await g.sentinela(pedir('/', { ip: '177.9.9.9' }), ctx());
  assert.equal(semSessao.status, 302);
  const v6 = await g.sentinela(pedir('/', { ip: '2001:db8::1', cookie }), ctx());
  assert.equal(v6.status, 403);
  conta(4);
});

caso('no Edge Runtime: teto por IP com lote, sonda do Chrome e UNION com comentário versionado', async () => {
  const { g, pedir, ctx, estado } = novoEdge(lista());
  for (let i = 0; i < 55; i++) {
    const c = ctx();
    await g.sentinela(pedir('/p' + i, { ip: '45.30.0.1' }), c);
    await c.esperar();
  }
  assert.equal(estado.eventos.length, 30 + 20, '30 diretos + 1 lote de 20 (5 na fila)');
  assert.equal(await g.sentinela(pedir('/.well-known/resource-that-should-not-exist-whose-status-code-should-not-be-200', { ip: '177.30.0.1' }), ctx()), null);
  const r = await g.sentinela(pedir('/?id=1/*!50000UNION*/%20/*!50000SELECT*/1', { ip: '45.30.0.2' }), ctx());
  assert.equal(r.status, 403);
  conta(3);
});

caso('no Edge Runtime (1.1.0, proteger): robô genérico, buscador e não-navegador → 403; navegador real e sessão seguem', async () => {
  const chave = await gerarChave('k-edge-2');
  const { g, pedir, ctx, estado } = novoEdge(lista({ modo: 'proteger', projeto: 'gestao-finaceiro', slug: 'gestao-financeiro', exige: true, chaves: [chave.jwk] }));
  const cookie = '__Host-sentinela=' + (await assinarJwt(sessaoPayload(), chave));
  let i = 0;
  const ip = () => '45.31.0.' + (++i);
  const barrados = [
    [{ ua: 'Mozilla/5.0 (compatible)' }, 'robo'], [{ ua: 'NoMoreVibe/1.0 (+https://nomorevibe.app)' }, 'robo'],
    [{ ua: 'RecordedFuture Global Inventory Crawler' }, 'robo'], [{ ua: 'Vercel MCP Fetch' }, 'robo'],
    [{ ua: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' }, 'buscador'],
    [{ semNavegador: true }, 'nao_navegador'], [{ semNavegador: true, metodo: 'HEAD' }, 'nao_navegador'],
  ];
  for (const [o, regra] of barrados) {
    const c = ctx();
    const r = await g.sentinela(pedir('/', { ...o, ip: ip() }), c);
    await c.esperar();
    assert.equal(r && r.status, 403, (o.ua || 'sem cabeçalhos') + ' → 403');
    assert.equal(estado.eventos.at(-1).regra, regra);
    conta(2);
  }
  for (const ua of UAS_REAIS) {
    const r = await g.sentinela(pedir('/', { ua, ip: ip() }), ctx());
    assert.equal(r && r.status, 302, ua + ': navegador sem sessão vai para o portal');
    conta();
  }
  for (const [o] of barrados) {
    const c = ctx();
    assert.equal(await g.sentinela(pedir('/', { ...o, cookie, ip: ip() }), c), null, 'com sessão: ' + (o.ua || 'sem cabeçalhos'));
    await c.esperar();
    assert.equal(estado.eventos.at(-1).identidade, 'julio@lube.com.br');
    conta(2);
  }
  const at = await g.sentinela(pedir('/.env', { cookie, ip: '45.31.9.9' }), ctx());
  assert.equal(at.status, 403, 'ataque com sessão continua barrado');
  conta();
});

const falhas = await executar('Sentinela · guarda · Edge Runtime');
process.exit(falhas ? 1 : 0);
