/* Testes do middleware.ts de projeto estático (Node 24).
   Rodar na raiz do repositório:  node guarda/teste/middleware.teste.mjs */
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { lista, centralFalsa, req, novoCtx, caso, conta, executar, avancar, dormir, UAS_REAIS, SEM_NAVEGADOR, gerarChave, assinarJwt, sessaoPayload } from './apoio.mjs';

// Na Vercel o bundler resolve './sentinela-guarda' sem extensão; no Node puro, não.
registerHooks({
  resolve(especificador, contexto, proximo) {
    if (especificador === './sentinela-guarda' && String(contexto.parentURL || '').endsWith('/guarda/middleware.ts')) {
      return proximo('./sentinela-guarda.ts', contexto);
    }
    return proximo(especificador, contexto);
  },
});

const mw = await import('../middleware.ts');

caso('exporta default async middleware(request, context) e config.matcher', async () => {
  assert.equal(typeof mw.default, 'function');
  assert.ok(Array.isArray(mw.config.matcher));
  assert.equal(mw.config.matcher[0], '/((?!.*\\.(?:css|png|jpe?g|gif|svg|ico|webp|avif|woff2?|ttf|otf|eot|map)$).*)');
  conta(3);
});

caso('matcher deixa de fora só imagem, fonte e CSS', async () => {
  const re = new RegExp('^' + mw.config.matcher[0] + '$');
  for (const p of ['/', '/index.html', '/config.js', '/api/dados', '/dados.json', '/.env', '/wp-login.php', '/.git/config', '/.sentinela/saude', '/README.md']) {
    assert.ok(re.test(p), p + ' passa pelo guarda');
    conta();
  }
  for (const p of ['/styles.css', '/assets/logo-lube.png', '/a.jpeg', '/f.woff2', '/x.svg', '/favicon.ico', '/app.js.map']) {
    assert.ok(!re.test(p), p + ' fica de fora');
    conta();
  }
});

caso('legítimo → x-middleware-next: 1 (segue) e evento registrado via context.waitUntil', async () => {
  const c = centralFalsa(lista());
  const ctx = novoCtx();
  const r = await mw.default(req('painel-compras-rosy.vercel.app', '/api/dados'), ctx);
  await ctx.esperar();
  assert.ok(r instanceof Response);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('x-middleware-next'), '1');
  assert.equal(c.eventos.length, 1);
  assert.equal(c.eventos[0].decisao, 'liberado');
  conta(5);
});

caso('ataque → 403 do guarda', async () => {
  centralFalsa(lista());
  const r = await mw.default(req('painel-compras-rosy.vercel.app', '/.env', { ip: '45.1.1.1' }), novoCtx());
  assert.equal(r.status, 403);
  assert.equal(r.headers.get('x-middleware-next'), null);
  assert.equal(r.headers.get('x-sentinela'), 'bloqueado');
  conta(3);
});

caso('sem context e com central quebrada → segue', async () => {
  globalThis.fetch = () => { throw new Error('rede'); };
  const r = await mw.default(req('rh-absentismo.vercel.app', '/', { ip: '177.2.2.2' }));
  assert.equal(r.headers.get('x-middleware-next'), '1');
  conta();
});

caso('1.1.0 no proteger: robô genérico, buscador e página sem cabeçalhos de navegador → 403; navegador → segue', async () => {
  // o envio "dispara e esquece" do caso anterior (central quebrada) termina antes de mexer no relógio;
  // depois, a lista dos casos anteriores (observar) fica velha demais e o guarda busca a nova
  await dormir(30);
  avancar(2 * 3600000);
  const c = centralFalsa(lista({ modo: 'proteger', projeto: 'painel-lube-distribuidora', slug: null }));
  const H = 'painel-lube-distribuidora.vercel.app';
  let i = 0;
  for (const [o, regra] of [[{ ua: 'Mozilla/5.0 (compatible)' }, 'robo'], [{ ua: 'RecordedFuture Global Inventory Crawler' }, 'robo'],
    [{ ua: 'NoMoreVibe/1.0 (+https://nomorevibe.app)' }, 'robo'], [{ ua: 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)' }, 'buscador'],
    [{ headers: SEM_NAVEGADOR }, 'nao_navegador']]) {
    const ctx = novoCtx();
    const r = await mw.default(req(H, '/', { ...o, ip: '45.60.0.' + (++i) }), ctx);
    await ctx.esperar();
    assert.equal(r.status, 403);
    assert.equal(r.headers.get('x-middleware-next'), null);
    assert.equal(c.eventos.at(-1).regra, regra);
    conta(3);
  }
  for (const ua of UAS_REAIS) {
    const r = await mw.default(req(H, '/', { ua, ip: '189.62.0.' + (++i) }), novoCtx());
    assert.equal(r.headers.get('x-middleware-next'), '1', ua);
    conta();
  }
});

caso('1.3.0: sessão fora da rede da Lube no exigir → 403 do guarda (x-sentinela: rede), sem x-middleware-next; dentro segue', async () => {
  // a lista do caso anterior foi buscada 2 h à frente: só depois de 1 h dela o guarda busca a nova
  await dormir(30);
  avancar(4 * 3600000);
  const chave = await gerarChave('a1b2c3d4e5f60718');
  const c = centralFalsa(lista({ projeto: 'gestao-finaceiro', slug: 'gestao-financeiro', exige: true, chaves: [chave.jwk],
    rede: { modo: 'exigir', redes: ['203.0.113.169'] } }));
  const cookie = '__Host-sentinela=' + (await assinarJwt(sessaoPayload(), chave));
  const H = 'gestao-finaceiro.vercel.app';
  const ctx = novoCtx();
  const fora = await mw.default(req(H, '/', { ip: '177.37.10.20', cookie }), ctx);
  await ctx.esperar();
  assert.equal(fora.status, 403);
  assert.equal(fora.headers.get('x-sentinela'), 'rede');
  assert.equal(fora.headers.get('x-middleware-next'), null);
  assert.equal(c.eventos.at(-1).regra, 'fora_da_rede');
  const dentro = await mw.default(req(H, '/', { ip: '203.0.113.169', cookie }), novoCtx());
  assert.equal(dentro.headers.get('x-middleware-next'), '1');
  const semLogin = await mw.default(req(H, '/', { ip: '177.37.10.20' }), novoCtx());
  assert.equal(semLogin.status, 302, 'sem login: portal (a tela de login abre de qualquer lugar)');
  conta(6);
});

const falhas = await executar('Sentinela · guarda · middleware.ts (estático)');
process.exit(falhas ? 1 : 0);
