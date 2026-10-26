/* Testes da regra de rede da Lube (guarda 1.3.0, docs/SENTINELA-REDE.md §6 e §15.3). Node 24.
   Rodar na raiz do repositório:  node guarda/teste/rede.teste.mjs
   A comparação com o 1.2.0 lê o núcleo do commit 9f1732a pelo git (sem git, aquele caso é pulado). */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  PORTAL, UA, SEM_NAVEGADOR, avancar, gerarChave, assinarJwt, sessaoPayload, lista, hashEmail,
  centralFalsa, req, novoCtx, rodar, dormir, caso, conta, executar,
} from './apoio.mjs';

const URL_GUARDA = new URL('../sentinela-guarda.ts', import.meta.url).href;
const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
let seq = 0;
// cada caso pega uma instância nova do módulo (cache, última rede, dedupe e mapa local zerados)
const novoGuarda = () => import(URL_GUARDA + '?rede=' + (++seq));

const ESCRITORIO = '203.0.113.169';
const FORA = '177.37.10.20';                 // celular no 4G
const AMAZON = '3.236.14.77';                // o agendador da Vercel sai de um IP diferente da Amazon a cada dia
const H = 'gestao-finaceiro.vercel.app';     // sistema fechado (exige login)
const HP = 'painel-lube-distribuidora.vercel.app';
const JULIO = 'julio@lube.com.br';
const ANA = 'ana@lube.com.br';
const ROBO = 'robo do gestao ti (agendador da vercel)';
const MSG = 'Este sistema só abre na rede da Lube. Este aparelho não está na rede da Lube. Se precisa acessar de fora, fale com o TI.';
const RE_REGRA = /^[a-z_]{1,40}$/;           // formato que a central aceita

const app = (email, extra = {}) => ({ identidade: { email, origem: 'sessao_app', ...extra } });
const daqui = (ms) => new Date(Date.now() + ms).toISOString();
const ultimo = (c) => c.eventos.at(-1);

// lista do sistema fechado com o bloco "rede" (padrão: rede do escritório, nenhum liberado)
function listaRede(rede = {}, extra = {}) {
  return lista({ projeto: 'gestao-finaceiro', slug: 'gestao-financeiro', exige: true, rotas: ['/publico/'],
    rede: { redes: [ESCRITORIO + '/32'], ...rede }, ...extra });
}
const listaPortal = (rede = {}, extra = {}) =>
  lista({ projeto: 'painel-lube-distribuidora', slug: null, rede: { redes: [ESCRITORIO + '/32'], ...rede }, ...extra });

/* ---------- verificações das respostas de rede ---------- */
function cabecalhosRede(r) {
  assert.ok(r, 'esperava Response, veio null');
  assert.equal(r.status, 403);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(r.headers.get('x-robots-tag'), 'noindex');
  assert.equal(r.headers.get('x-sentinela'), 'rede');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(r.headers.get('set-cookie'), null, 'nenhum Set-Cookie');
  conta(8);
}

async function paginaRede(r, portal = PORTAL, ips = [FORA]) {
  cabecalhosRede(r);
  assert.match(r.headers.get('content-type'), /^text\/html/);
  assert.equal(r.headers.get('content-security-policy'), "default-src 'none'; style-src 'unsafe-inline'; img-src data:");
  const txt = await r.text();
  for (const t of ['<title>Fora da rede da Lube · Sentinela Lube</title>', '<h1>Este sistema só abre na rede da Lube</h1>',
    '<p>Este aparelho não está na rede da Lube.</p>',
    '<p>Se precisa acessar de fora, fale com o TI: <a href="mailto:cpd@lube.com.br">cpd@lube.com.br</a></p>',
    'Na Lube, use o Wi-Fi da empresa (no celular, desligue os dados móveis e a VPN) e recarregue a página.',
    'Se o TI acabou de liberar você, espere 1 minuto e recarregue.',
    '>Voltar ao Painel Lube</a>', 'Lube Distribuidora · Sentinela', '#050b1c', '#0d1830', 'stroke="#ffb340"',
    'target="_top"', '<meta name="robots" content="noindex">']) {
    assert.ok(txt.includes(t), 'página traz: ' + t);
  }
  assert.ok(txt.includes('href="' + portal.replace(/&/g, '&amp;') + '/"'), 'botão volta ao portal');
  assert.ok(!/class="k"|incidente|bloqueado pela Sentinela/i.test(txt), 'sem código de incidente');
  assert.ok(!/\b\d{1,3}(?:\.\d{1,3}){3}\b/.test(txt), 'sem IP na página');
  for (const ip of ips) assert.ok(!txt.includes(ip));
  conta(19);
  return txt;
}

async function jsonRede(r, portal = PORTAL) {
  cabecalhosRede(r);
  assert.match(r.headers.get('content-type'), /^application\/json/);
  assert.deepEqual(await r.json(), { erro: 'fora_da_rede', mensagem: MSG, portal });
  conta(2);
}

function eventoRede(ev, decisao, regra, motivo, identidade) {
  assert.equal(ev.decisao, decisao);
  assert.equal(ev.regra, regra);
  if (motivo instanceof RegExp) assert.match(ev.motivo, motivo); else assert.equal(ev.motivo, motivo);
  if (identidade !== undefined) assert.equal(ev.identidade, identidade);
  if (regra) assert.match(regra, RE_REGRA);
  assert.ok(!/incidente/.test(ev.motivo || ''), 'sem incidente no motivo');
  conta(6);
}

/* =========================================================
   1. Desligado = 1.2.0
   ========================================================= */
caso('1. sem bloco "rede" e com modo desligado: identidade de fora → null, evento igual ao 1.2.0', async () => {
  for (const rede of [null, { modo: 'desligado', redes: [ESCRITORIO], liberados: [{ h: hashEmail(JULIO), ate: daqui(3600e3) }] }]) {
    const g = await novoGuarda();
    const c = centralFalsa(lista({ projeto: 'gestao-finaceiro', slug: 'gestao-financeiro', exige: true, rotas: ['/publico/'], rede }));
    assert.equal(await rodar(g, req(H, '/', { ip: FORA }), app(ANA)), null);
    eventoRede(ultimo(c), 'liberado', null, null, ANA);
    assert.equal(await rodar(g, req(H, '/api/dados', { ip: FORA }), app(JULIO)), null);
    eventoRede(ultimo(c), 'liberado', null, null, JULIO);
    assert.equal(await rodar(g, req(H, '/publico/aviso.html', { ip: FORA })), null, 'rota pública sem login segue');
    eventoRede(ultimo(c), 'liberado', null, null, null);
    const s = await rodar(g, req(H, '/', { ip: FORA }));
    assert.equal(s.status, 302, 'sem login continua indo para o portal');
    const j = await (await rodar(g, req(H, '/.sentinela/saude', { ip: FORA }))).json();
    assert.equal(j.lista.rede, rede ? 'desligado' : null);
    conta(4);
  }
});

/* =========================================================
   2. Observar
   ========================================================= */
caso('2. observar: identidade de fora → null + evento observado fora_da_rede; dentro sem regra; portal sem login sem registro de rede', async () => {
  const g = await novoGuarda();
  const chave = await gerarChave('a1b2c3d4e5f60718');
  const c = centralFalsa(listaRede({ modo: 'observar' }, { chaves: [chave.jwk] }));
  const cookie = '__Host-sentinela=' + (await assinarJwt(sessaoPayload(), chave));
  assert.equal(await rodar(g, req(H, '/', { ip: FORA }), app(ANA)), null);
  eventoRede(ultimo(c), 'observado', 'fora_da_rede', 'seria bloqueado: fora da rede da Lube', ANA);
  assert.equal(await rodar(g, req(H, '/folha.html', { ip: FORA, cookie })), null, 'sessão da Sentinela');
  eventoRede(ultimo(c), 'observado', 'fora_da_rede', 'seria bloqueado: fora da rede da Lube', JULIO);
  assert.equal(ultimo(c).identidade_origem, 'passe');
  assert.equal(await rodar(g, req(H, '/api/dados', { ip: FORA, cookie })), null, 'API também só observa');
  assert.equal(ultimo(c).regra, 'fora_da_rede');
  assert.equal(await rodar(g, req(H, '/publico/aviso.html', { ip: FORA })), null, 'rota pública de sistema fechado: observada');
  eventoRede(ultimo(c), 'observado', 'fora_da_rede', 'seria bloqueado: fora da rede da Lube', null);
  assert.equal(await rodar(g, req(H, '/', { ip: ESCRITORIO, cookie })), null, 'dentro');
  eventoRede(ultimo(c), 'liberado', null, null, JULIO);
  // portal (sem "exige login"): quem não tem login vê a tela de login, sem marca de rede
  const g2 = await novoGuarda();
  const c2 = centralFalsa(listaPortal({ modo: 'observar' }));
  assert.equal(await rodar(g2, req(HP, '/', { ip: FORA })), null);
  eventoRede(ultimo(c2), 'liberado', null, null, null);
  conta(4);
});

/* =========================================================
   3. Exigir: página e JSON
   ========================================================= */
caso('3. exigir: página → 403 com o texto do §9.1, sem código, sem IP, sem cookie; API, arquivo e outros métodos → JSON; HEAD = GET', async () => {
  const g = await novoGuarda();
  const c = centralFalsa(listaRede({ modo: 'exigir' }));
  await paginaRede(await rodar(g, req(H, '/', { ip: FORA }), app(ANA)));
  eventoRede(ultimo(c), 'bloqueado', 'fora_da_rede', 'fora da rede da Lube', ANA);
  assert.equal(ultimo(c).identidade_origem, 'sessao_app');
  const head = await rodar(g, req(H, '/folha.html', { ip: FORA, metodo: 'HEAD' }), app(ANA));
  await paginaRede(head);
  assert.equal(ultimo(c).metodo, 'HEAD');
  await jsonRede(await rodar(g, req(H, '/api/dados?token=abc&mes=09', { ip: FORA }), app(ANA)));
  eventoRede(ultimo(c), 'bloqueado', 'fora_da_rede', 'fora da rede da Lube', ANA);
  assert.equal(ultimo(c).consulta, '?token=***&mes=09', 'consulta sem valor sensível');
  await jsonRede(await rodar(g, req(H, '/app.js', { ip: FORA }), app(ANA)));
  assert.equal(ultimo(c).tipo, 'arquivo');
  await jsonRede(await rodar(g, req(H, '/', { ip: FORA, metodo: 'POST' }), app(ANA)));
  await jsonRede(await rodar(g, req(H, '/', { ip: FORA, metodo: 'OPTIONS' }), app(ANA)));
  // a regra nunca pede bloqueio: só /lista e /evento foram à central
  assert.deepEqual([...new Set(c.chamadas.map((x) => x.rota))].sort(), ['/evento', '/lista']);
  // portal com "&" no endereço: escapado no HTML, cru no JSON
  const g2 = await novoGuarda();
  const portal = 'https://painel.example.com/a&b';
  centralFalsa(listaRede({ modo: 'exigir' }, { portal }));
  await paginaRede(await rodar(g2, req(H, '/', { ip: FORA }), app(ANA)), portal);
  await jsonRede(await rodar(g2, req(H, '/api/x', { ip: FORA }), app(ANA)), portal);
  conta(6);
});

/* =========================================================
   4. Exigir, dentro da rede
   ========================================================= */
caso('4. exigir, dentro: IP exato, faixa /24, IPv6 /56, ::ffff: (na lista e no x-real-ip) → null e evento sem regra; vizinhos de fora → 403', async () => {
  const g = await novoGuarda();
  const c = centralFalsa(listaRede({ modo: 'exigir', redes: [ESCRITORIO, '200.150.7.0/24', '2804:14c:abcd:1200::/56', '::ffff:189.10.20.30', '2001:db8:aa::1/128'] }));
  let i = 0;
  for (const ip of [ESCRITORIO, '200.150.7.0', '200.150.7.99', '200.150.7.255', '2804:14c:abcd:1200::1', '2804:14c:abcd:12ff:ffff:ffff:ffff:ffff',
    '::ffff:203.0.113.169', '[::ffff:200.150.7.10]', '189.10.20.30', '2001:db8:aa::1', '2001:DB8:AA:0:0:0:0:1']) {
    assert.equal(await rodar(g, req(H, '/p' + (++i), { ip }), app(ANA)), null, ip + ' é rede da Lube');
    eventoRede(ultimo(c), 'liberado', null, null, ANA);
  }
  for (const ip of ['203.0.113.168', '203.0.113.170', '200.150.8.1', '200.150.6.255', '2804:14c:abcd:1300::1', '2804:14c:abcd:11ff::1',
    '189.10.20.31', '2001:db8:aa::2']) {
    await paginaRede(await rodar(g, req(H, '/q' + (++i), { ip }), app(ANA)), PORTAL, []);
    assert.equal(ultimo(c).regra, 'fora_da_rede', ip + ' está fora');
    conta();
  }
});

/* =========================================================
   5. Liberados
   ========================================================= */
caso('5. liberado: e-mail com maiúsculas casa; vencido → 403; hash de outra pessoa → 403; "h" inválido é ignorado', async () => {
  const g = await novoGuarda();
  const ate = daqui(3 * 86400e3);
  const c = centralFalsa(listaRede({ modo: 'exigir', liberados: [
    { h: hashEmail(JULIO).toUpperCase(), ate },                       // hex em maiúsculas também vale
    { h: hashEmail('vencido@lube.com.br'), ate: daqui(-60000) },
    { h: 'xyz', ate }, { h: hashEmail(ANA).slice(1), ate }, { h: hashEmail(ANA), ate: 'amanhã' }, null, { h: hashEmail(ANA) },
  ] }));
  for (const quem of [JULIO, 'Julio@Lube.com.br', ' JULIO@LUBE.COM.BR ']) {
    assert.equal(await rodar(g, req(H, '/r' + (++seq), { ip: FORA }), app(quem)), null, quem + ' liberado');
    eventoRede(ultimo(c), 'liberado', 'rede_liberado', 'fora da rede da Lube · liberado pelo TI até ' + new Date(Date.parse(ate)).toISOString());
  }
  await paginaRede(await rodar(g, req(H, '/', { ip: FORA }), app('vencido@lube.com.br')));
  eventoRede(ultimo(c), 'bloqueado', 'fora_da_rede', 'fora da rede da Lube', 'vencido@lube.com.br');
  await paginaRede(await rodar(g, req(H, '/a', { ip: FORA }), app(ANA)));
  eventoRede(ultimo(c), 'bloqueado', 'fora_da_rede', 'fora da rede da Lube', ANA);
  // a liberação vence durante a sessão: o próximo pedido já é barrado
  const g2 = await novoGuarda();
  centralFalsa(listaRede({ modo: 'exigir', liberados: [{ h: hashEmail(JULIO), ate: daqui(10000) }] }));
  assert.equal(await rodar(g2, req(H, '/', { ip: FORA }), app(JULIO)), null);
  avancar(10500);
  await paginaRede(await rodar(g2, req(H, '/b', { ip: FORA }), app(JULIO)));
  // observar + liberado: liberado (não "seria barrado")
  const g3 = await novoGuarda();
  const c3 = centralFalsa(listaRede({ modo: 'observar', liberados: [{ h: hashEmail(JULIO), ate }] }));
  assert.equal(await rodar(g3, req(H, '/', { ip: FORA }), app(JULIO)), null);
  assert.equal(ultimo(c3).regra, 'rede_liberado');
  assert.equal(ultimo(c3).decisao, 'liberado');
  conta(4);
});

/* =========================================================
   6. Liberação só com lista fresca
   ========================================================= */
caso('6. lista de mais de 2 min: espera a renovação (até 2,5 s) e decide com a nova; central fora ou lenta demais → liberação velha não vale (403)', async () => {
  const lib = (ate = daqui(7 * 86400e3)) => listaRede({ modo: 'exigir', liberados: [{ h: hashEmail(JULIO), ate }] });
  // liberação encerrada no painel: a lista nova chega sem ela
  let g = await novoGuarda();
  let c = centralFalsa(lib());
  assert.equal(await rodar(g, req(H, '/', { ip: FORA }), app(JULIO)), null);
  avancar(121000);
  c.lista = listaRede({ modo: 'exigir' });
  await paginaRede(await rodar(g, req(H, '/a', { ip: FORA }), app(JULIO)));
  assert.equal(c.rota('/lista').length, 2, 'buscou a lista nova');
  // mesma liberação na lista nova: segue
  g = await novoGuarda();
  c = centralFalsa(lib());
  assert.equal(await rodar(g, req(H, '/', { ip: FORA }), app(JULIO)), null);
  avancar(121000);
  assert.equal(await rodar(g, req(H, '/a', { ip: FORA }), app(JULIO)), null);
  assert.equal(ultimo(c).regra, 'rede_liberado');
  // central fora do ar: a liberação de mais de 2 min não vale
  g = await novoGuarda();
  c = centralFalsa(lib());
  assert.equal(await rodar(g, req(H, '/', { ip: FORA }), app(JULIO)), null);
  avancar(121000);
  c.fora = true;
  const r = await rodar(g, req(H, '/a', { ip: FORA }), app(JULIO));
  await paginaRede(r);
  // central fria (1,5 s, à noite): espera a lista nova e o liberado passa de primeira (com 700 ms
  // ele levava o 403 e só passava ao recarregar)
  g = await novoGuarda();
  c = centralFalsa(lib());
  assert.equal(await rodar(g, req(H, '/', { ip: FORA }), app(JULIO)), null);
  avancar(121000);
  c.atrasoLista = 1500;
  let t0 = performance.now();
  assert.equal(await g.sentinela(req(H, '/a', { ip: FORA }), novoCtx(), app(JULIO)), null, 'liberado passa com a central em 1,5 s');
  let ms = performance.now() - t0;
  assert.ok(ms >= 1400 && ms < 2300, 'esperou a lista nova (~1,5 s; foi ' + ms.toFixed(0) + ')');
  assert.equal(c.rota('/lista').length, 2);
  // central lenta demais (mais que os 2,5 s de prazo): decide com a velha (sem a liberação)
  g = await novoGuarda();
  c = centralFalsa(lib());
  assert.equal(await rodar(g, req(H, '/', { ip: FORA }), app(JULIO)), null);
  avancar(121000);
  c.atrasoLista = 4000;
  t0 = performance.now();
  const lenta = await g.sentinela(req(H, '/a', { ip: FORA }), novoCtx(), app(JULIO));
  ms = performance.now() - t0;
  await paginaRede(lenta);
  assert.ok(ms >= 2400 && ms < 3300, 'esperou ~2,5 s (foi ' + ms.toFixed(0) + ')');
  // a central passa a mandar a lista SEM o bloco (RPC fora): a rede antiga segue, mas a liberação
  // (que veio com ela) só vale até 2 min depois de chegar
  g = await novoGuarda();
  c = centralFalsa(lib());
  assert.equal(await rodar(g, req(H, '/', { ip: FORA }), app(JULIO)), null);
  c.lista = listaRede({}, { rede: null });
  avancar(21000);
  assert.equal(await rodar(g, req(H, '/b', { ip: FORA }), app(JULIO)), null, 'liberação de 21 s');
  assert.equal(c.rota('/lista').length, 2, 'a lista sem bloco já chegou');
  avancar(100000);
  await paginaRede(await rodar(g, req(H, '/c', { ip: FORA }), app(JULIO)));
  // dentro da rede ninguém espera a renovação
  g = await novoGuarda();
  c = centralFalsa(lib());
  await rodar(g, req(H, '/', { ip: ESCRITORIO }), app(ANA));
  avancar(121000);
  c.atrasoLista = 1500;
  const t1 = performance.now();
  assert.equal(await g.sentinela(req(H, '/d', { ip: ESCRITORIO }), novoCtx(), app(ANA)), null);
  assert.ok(performance.now() - t1 < 100, 'dentro não espera');
  conta(12);
});

/* =========================================================
   7. Máquinas
   ========================================================= */
caso('7. máquina: robô com maquina:true de fora segue (rede_maquina; o agendador fica "cron"); sem a marca, ou com e-mail de pessoa → 403', async () => {
  const g = await novoGuarda();
  const c = centralFalsa(lista({ projeto: 'gestao-ti', slug: 'gestao-ti', exige: true, modo: 'proteger', rede: { modo: 'exigir', redes: [ESCRITORIO] } }));
  const HT = 'gestao-ti-ruddy.vercel.app';
  // o robô do Gestão TI: UA vercel-cron/1.0, sem cabeçalhos de navegador, IP da Amazon
  const cron = { ua: 'vercel-cron/1.0', ip: AMAZON, headers: SEM_NAVEGADOR };
  assert.equal(await rodar(g, req(HT, '/api/cron/ler-emails', cron), app(ROBO, { maquina: true })), null);
  eventoRede(ultimo(c), 'liberado', 'cron', 'agendamento da Vercel · fora da rede da Lube: máquina autenticada pelo sistema', ROBO);
  // aquecedor (cliente HTTP, sem exceção de UA) e nomes no formato da central
  for (const nome of ['robo do reposicoes (aquecedor da srv-ia)', 'Robo do Reposicoes (Aquecedor da SRV-IA)', 'robô do inventario']) {
    assert.equal(await rodar(g, req(HT, '/api/dados', { ua: 'python-requests/2.32.3', ip: '200.1.2.' + (++seq % 250), headers: SEM_NAVEGADOR }),
      app(nome, { maquina: true })), null, nome);
    eventoRede(ultimo(c), 'liberado', 'rede_maquina', 'fora da rede da Lube: máquina autenticada pelo sistema', nome);
  }
  // sem a marca: o nome de robô é identidade, mas não é pessoa liberada nem máquina → 403
  await jsonRede(await rodar(g, req(HT, '/api/cron/cobrar', { ...cron, ip: '3.236.14.78' }), app(ROBO)));
  eventoRede(ultimo(c), 'bloqueado', 'fora_da_rede', 'fora da rede da Lube · também cron: agendamento da Vercel', ROBO);
  // marca que não vale: e-mail de pessoa, origem errada, valor que não é true, nome fora do formato
  for (const [email, extra] of [[ANA, { maquina: true }], [ROBO, { maquina: 'true' }], [ROBO, { maquina: 1 }],
    [ROBO, { maquina: true, origem: 'passe' }], ['robô do gestão ti', { maquina: true }], ['robo x', { maquina: true }],
    ['robo do gestao ti <script>', { maquina: true }], ['robo ' + 'a'.repeat(81), { maquina: true }], ['robozinho do ti', { maquina: true }]]) {
    await jsonRede(await rodar(g, req(HT, '/api/dados', { ip: '45.10.0.' + (++seq % 250) }), app(email, extra)));
    assert.equal(ultimo(c).regra, 'fora_da_rede', email + ' ' + JSON.stringify(extra));
    conta();
  }
  // no observar, o robô sem a marca aparece como "seria barrado"
  const g2 = await novoGuarda();
  const c2 = centralFalsa(lista({ projeto: 'gestao-ti', slug: 'gestao-ti', exige: true, rede: { modo: 'observar', redes: [ESCRITORIO] } }));
  assert.equal(await rodar(g2, req(HT, '/api/cron/cobrar', cron), app(ROBO)), null);
  eventoRede(ultimo(c2), 'observado', 'fora_da_rede', 'seria bloqueado: fora da rede da Lube · também cron: agendamento da Vercel', ROBO);
  // dentro da rede o agendador fica como hoje
  assert.equal(await rodar(g2, req(HT, '/api/cron/x', { ...cron, ip: ESCRITORIO }), app(ROBO, { maquina: true })), null);
  eventoRede(ultimo(c2), 'liberado', 'cron', 'agendamento da Vercel', ROBO);
  // a marca não fura o login: sem identidade, o UA do agendador só vê o 401
  const s = await rodar(g2, req(HT, '/api/cron/cobrar', { ...cron, ip: '3.236.14.79' }));
  assert.equal(s.status, 401);
  assert.equal(ultimo(c2).regra, 'sem_login');
  conta(3);
});

/* =========================================================
   8. Sem login
   ========================================================= */
caso('8. sem login: sistema fechado → 302/401 sem_login (antes da rede); rota pública de sistema fechado no exigir → 403; portal → null', async () => {
  const g = await novoGuarda();
  const c = centralFalsa(listaRede({ modo: 'exigir' }));
  const r = await rodar(g, req(H, '/', { ip: FORA }));
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), PORTAL + '/?abrir=gestao-financeiro');
  assert.equal(ultimo(c).regra, 'sem_login');
  const a = await rodar(g, req(H, '/api/dados', { ip: FORA }));
  assert.equal(a.status, 401);
  assert.deepEqual(await a.json(), { erro: 'login_necessario', portal: PORTAL });
  await paginaRede(await rodar(g, req(H, '/publico/aviso.html', { ip: FORA })));
  eventoRede(ultimo(c), 'bloqueado', 'fora_da_rede', 'fora da rede da Lube', null);
  await jsonRede(await rodar(g, req(H, '/publico/dados.json', { ip: FORA })));
  assert.equal(await rodar(g, req(H, '/publico/aviso.html', { ip: ESCRITORIO })), null, 'rota pública dentro da rede');
  // portal (e SAC): sem "exige login", a tela de login abre de qualquer lugar
  const g2 = await novoGuarda();
  const c2 = centralFalsa(listaPortal({ modo: 'exigir' }));
  for (const p of ['/', '/index.html', '/portal.js', '/admin.html', '/fora-da-rede.html?de=painel']) {
    assert.equal(await rodar(g2, req(HP, p, { ip: FORA })), null, p);
    eventoRede(ultimo(c2), 'liberado', null, null, null);
  }
  conta(5);
});

/* =========================================================
   9. Saúde e /.sentinela/*
   ========================================================= */
caso('9. /.sentinela/saude de fora no exigir → 200 com lista.rede, sem redes nem liberados no texto; /.sentinela/* passa', async () => {
  const g = await novoGuarda();
  const c = centralFalsa(listaRede({ modo: 'exigir', redes: [ESCRITORIO, '200.150.7.0/24'], liberados: [{ h: hashEmail(JULIO), ate: daqui(3600e3) }] }));
  const r = await rodar(g, req(H, '/.sentinela/saude', { ip: FORA }), app(ANA));
  assert.equal(r.status, 200);
  const txt = await r.text();
  const j = JSON.parse(txt);
  assert.deepEqual(Object.keys(j.lista), ['ok', 'idade_s', 'modo', 'rede', 'rede_idade_s']);
  assert.equal(j.lista.rede, 'exigir');
  assert.equal(j.lista.rede_idade_s, 0, 'bloco que acabou de chegar');
  assert.equal(j.guarda, 'sentinela-guarda/1.3.0');
  assert.equal(j.ip, FORA, 'é por ela que o TI descobre o IP de onde está');
  for (const x of [ESCRITORIO, '200.150.7', hashEmail(JULIO), JULIO, 'liberad']) assert.ok(!txt.includes(x), 'saúde não mostra ' + x);
  assert.equal(c.eventos.length, 0);
  // outras rotas /.sentinela/ não passam pela regra; disfarçadas (%2e) passam
  assert.equal(await rodar(g, req(H, '/.sentinela/outra', { ip: FORA }), app(ANA)), null);
  await paginaRede(await rodar(g, req(H, '/%2esentinela/outra', { ip: FORA }), app(ANA)));
  // modo em cada situação
  for (const [rede, esperado] of [[{ modo: 'observar' }, 'observar'], [{ modo: 'desligado' }, 'desligado'], [{ modo: 'exigir', redes: [] }, 'observar'], [null, null]]) {
    const g2 = await novoGuarda();
    centralFalsa(rede === null ? lista({ rede: null }) : listaRede(rede));
    const l2 = (await (await rodar(g2, req(H, '/.sentinela/saude', { ip: FORA }))).json()).lista;
    assert.equal(l2.rede, esperado, JSON.stringify(rede));
    assert.equal(l2.rede_idade_s, rede === null ? null : 0);
    conta(2);
  }
  conta(10);
});

/* =========================================================
   10. Passe trocado fora da rede
   ========================================================= */
caso('10. passe fora: exigir → 403 página sem nenhum cookie; observar → 302 com cookie e evento observado; liberado → 302 + rede_liberado', async () => {
  const chave = await gerarChave('a1b2c3d4e5f60718');
  const sessao = await assinarJwt(sessaoPayload(), chave);
  const ok = async () => ({ ok: true, sessao, exp: daqui(8 * 3600e3), email: JULIO });
  const PASSE = '/folha.html?aba=resumo&sentinela_passe=eyJh.eyJw.c2ln&mes=09';
  const cookieSessao = (r) => (r.headers.get('set-cookie') || '').startsWith('__Host-sentinela=' + sessao + ';');
  // exigir, fora, sem liberação
  let g = await novoGuarda();
  let c = centralFalsa(listaRede({ modo: 'exigir' }, { chaves: [chave.jwk] }));
  c.sessaoOk = ok;
  await paginaRede(await rodar(g, req(H, PASSE, { ip: FORA })));
  eventoRede(ultimo(c), 'bloqueado', 'fora_da_rede', 'fora da rede da Lube · passe trocado, sessão não entregue', JULIO);
  assert.equal(ultimo(c).consulta, '?aba=resumo&mes=09', 'o passe não vai para o registro');
  assert.equal(c.sessoes.length, 1, 'a troca foi feita (o passe já está gasto)');
  // com a marca de falha no navegador: continua sem nenhum Set-Cookie (nem para limpar)
  await paginaRede(await rodar(g, req(H, '/?sentinela_passe=eyJh.eyJw.c2ln', { ip: FORA, cookie: '__Host-sentinela-falha=1' })));
  // dentro do iframe do portal: a mesma página
  await paginaRede(await rodar(g, req(H, '/?sentinela_passe=eyJh.eyJw.c2ln', { ip: FORA, headers: { 'sec-fetch-dest': 'iframe', 'sec-fetch-site': 'cross-site' } })));
  // dentro da rede: 302 com cookie, como sempre
  let r = await rodar(g, req(H, PASSE, { ip: ESCRITORIO }));
  assert.equal(r.status, 302);
  assert.ok(cookieSessao(r));
  eventoRede(ultimo(c), 'liberado', null, 'entrada pelo Painel Lube', JULIO);
  // passe inválido de fora: fluxo de falha de sempre (sem sessão, nada a conferir)
  c.sessaoOk = async () => null;
  r = await rodar(g, req(H, '/?sentinela_passe=eyJh.eyJw.velho', { ip: FORA }));
  assert.equal(r.status, 302);
  assert.ok((r.headers.get('set-cookie') || '').startsWith('__Host-sentinela-falha=1;'));
  assert.equal(ultimo(c).regra, 'passe_invalido');
  // observar
  g = await novoGuarda();
  c = centralFalsa(listaRede({ modo: 'observar' }, { chaves: [chave.jwk] }));
  c.sessaoOk = ok;
  r = await rodar(g, req(H, PASSE, { ip: FORA }));
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), 'https://' + H + '/folha.html?aba=resumo&mes=09');
  assert.ok(cookieSessao(r));
  eventoRede(ultimo(c), 'observado', 'fora_da_rede', 'seria bloqueado: fora da rede da Lube · entrada pelo Painel Lube', JULIO);
  // exigir + liberado
  g = await novoGuarda();
  const ate = daqui(86400e3);
  c = centralFalsa(listaRede({ modo: 'exigir', liberados: [{ h: hashEmail(JULIO), ate }] }, { chaves: [chave.jwk] }));
  c.sessaoOk = ok;
  r = await rodar(g, req(H, PASSE, { ip: FORA }));
  assert.equal(r.status, 302);
  assert.ok(cookieSessao(r));
  eventoRede(ultimo(c), 'liberado', 'rede_liberado', 'fora da rede da Lube · liberado pelo TI até ' + new Date(Date.parse(ate)).toISOString() + ' · entrada pelo Painel Lube', JULIO);
  // e com o cookie, de fora, segue liberado
  assert.equal(await rodar(g, req(H, '/folha2.html', { ip: FORA, cookie: '__Host-sentinela=' + sessao })), null);
  assert.equal(ultimo(c).caminho, '/folha2.html');
  assert.equal(ultimo(c).regra, 'rede_liberado');
  conta(15);
});

/* =========================================================
   11 e 12. Lista sem rede válida, modo desconhecido, bloco inválido
   ========================================================= */
caso('11. exigir sem nenhuma rede válida → comporta-se como observar (não tranca a empresa)', async () => {
  for (const redes of [[], ['lixo', '10.0.0.0/8', '203.0.0.0/16', '2804:14c::/32', '', 300, null], undefined]) {
    const g = await novoGuarda();
    const rede = { modo: 'exigir' };
    if (redes !== undefined) rede.redes = redes; else rede.redes = 'não é lista';
    const c = centralFalsa(listaRede(rede));
    assert.equal(await rodar(g, req(H, '/', { ip: FORA }), app(ANA)), null, JSON.stringify(redes));
    eventoRede(ultimo(c), 'observado', 'fora_da_rede', 'seria bloqueado: fora da rede da Lube', ANA);
    assert.equal(await rodar(g, req(H, '/', { ip: ESCRITORIO }), app(ANA)), null, 'o escritório também segue');
    assert.equal(ultimo(c).regra, 'fora_da_rede', 'sem rede válida, ninguém está "dentro"');
    conta(2);
  }
});

caso('12. rede inválida ou ampla demais é ignorada; modo desconhecido → observar; bloco que não é objeto = sem bloco', async () => {
  // faixas mais largas que /24 e /48 não entram (abririam a regra para outros clientes da operadora)
  let g = await novoGuarda();
  let c = centralFalsa(listaRede({ modo: 'exigir', redes: ['lixo', 123, null, '203.0.0.0/16', '203.0.113.0/24', '2804:14c::/47', '2804:14c:1::/48', '300.1.1.1', '1.2.3.4/33'] }));
  assert.equal(await rodar(g, req(H, '/', { ip: '203.0.113.7' }), app(ANA)), null, '/24 vale');
  assert.equal(ultimo(c).regra, null);
  assert.equal(await rodar(g, req(H, '/', { ip: '2804:14c:1:ffff::1' }), app(ANA)), null, '/48 vale');
  await paginaRede(await rodar(g, req(H, '/', { ip: '203.0.1.1' }), app(ANA)), PORTAL, []);
  await paginaRede(await rodar(g, req(H, '/a', { ip: '2804:14c:0:1::1' }), app(ANA)), PORTAL, []);
  for (const modo of ['proteger', 'EXIGIR', undefined, 7]) {
    g = await novoGuarda();
    c = centralFalsa(listaRede({ modo }));
    assert.equal(await rodar(g, req(H, '/', { ip: FORA }), app(ANA)), null, 'modo ' + modo);
    eventoRede(ultimo(c), 'observado', 'fora_da_rede', 'seria bloqueado: fora da rede da Lube', ANA);
  }
  for (const rede of ['exigir', [], 0, true]) {
    g = await novoGuarda();
    const l = listaRede({ modo: 'exigir' });
    l.rede = rede;
    c = centralFalsa(l);
    assert.equal(await rodar(g, req(H, '/', { ip: FORA }), app(ANA)), null, 'bloco ' + JSON.stringify(rede));
    eventoRede(ultimo(c), 'liberado', null, null, ANA);
  }
  conta(3);
});

/* =========================================================
   13 e 14. IP: vazio, inválido, cabeçalho forjado
   ========================================================= */
caso('13. IP vazio ou inválido com identidade no exigir → 403; IP só por x-forwarded-for não põe ninguém dentro', async () => {
  const g = await novoGuarda();
  const c = centralFalsa(listaRede({ modo: 'exigir' }));
  await paginaRede(await rodar(g, req(H, '/', { ip: '' }), app(ANA)));
  await paginaRede(await rodar(g, req(H, '/', { ip: 'lixo' }), app(ANA)));
  await paginaRede(await rodar(g, req(H, '/', { ip: '203.0.113.169.1' }), app(ANA)), PORTAL, []);
  await jsonRede(await rodar(g, req(H, '/api/x', { ip: '999.1.1.1' }), app(ANA)));
  // sem x-real-ip: os outros cabeçalhos não contam para a rede (o evento avisa)
  await paginaRede(await rodar(g, req(H, '/b', { ip: '', headers: { 'x-forwarded-for': ESCRITORIO } }), app(ANA)), PORTAL, []);
  eventoRede(ultimo(c), 'bloqueado', 'fora_da_rede', 'fora da rede da Lube · IP sem x-real-ip', ANA);
  assert.equal(ultimo(c).ip, ESCRITORIO, 'o evento registra o IP que veio');
  await paginaRede(await rodar(g, req(H, '/c', { ip: '', headers: { 'x-vercel-forwarded-for': ESCRITORIO } }), app(ANA)), PORTAL, []);
  conta();
});

caso('14. cabeçalho forjado: x-forwarded-for, x-vercel-forwarded-for, cf-connecting-ip e forwarded com o IP do escritório não põem ninguém dentro', async () => {
  const g = await novoGuarda();
  const c = centralFalsa(listaRede({ modo: 'exigir' }));
  const forjados = { 'x-forwarded-for': ESCRITORIO + ', ' + FORA, 'x-vercel-forwarded-for': ESCRITORIO, 'cf-connecting-ip': ESCRITORIO,
    forwarded: 'for=' + ESCRITORIO, 'x-client-ip': ESCRITORIO, 'true-client-ip': ESCRITORIO, referer: 'https://' + ESCRITORIO + '/', origin: PORTAL };
  await paginaRede(await rodar(g, req(H, '/', { ip: FORA, headers: forjados }), app(ANA)), PORTAL, [FORA]);
  eventoRede(ultimo(c), 'bloqueado', 'fora_da_rede', 'fora da rede da Lube', ANA);
  // e o contrário: x-real-ip do escritório (o que a Vercel garante) com o resto forjado de fora
  assert.equal(await rodar(g, req(H, '/a', { ip: ESCRITORIO, headers: { 'x-forwarded-for': FORA } }), app(ANA)), null);
  conta();
});

/* =========================================================
   15. Ordem das regras: ataque, lista, confiável, suspeito
   ========================================================= */
caso('15. ataque certo e bloqueio certo de fora continuam 403 de ataque; rede confiável não dispensa a rede; suspeito vai no motivo', async () => {
  const g = await novoGuarda();
  const ateBloq = daqui(3600e3);
  const c = centralFalsa(listaRede({ modo: 'exigir' }, { bloqueios: [
    { id: 90, t: 'ip', v: '177.37.200.11', n: 'certo', ate: ateBloq },
    { id: 91, t: 'ip', v: '177.37.200.10', n: 'suspeito', ate: ateBloq },
  ], confiaveis: [{ t: 'ip', v: '189.44.1.1' }] }));
  const ataque = await rodar(g, req(H, '/.env', { ip: FORA, headers: { 'sec-fetch-site': 'cross-site' } }), app(ANA));
  assert.equal(ataque.status, 403);
  assert.equal(ataque.headers.get('x-sentinela'), 'bloqueado');
  assert.equal(ultimo(c).regra, 'varredura');
  const certo = await rodar(g, req(H, '/', { ip: '177.37.200.11' }), app(ANA));
  assert.equal(certo.headers.get('x-sentinela'), 'bloqueado');
  assert.equal(ultimo(c).regra, 'lista');
  // "confiável" é aprendida pelo login (até de casa): não vale como rede da Lube
  await paginaRede(await rodar(g, req(H, '/', { ip: '189.44.1.1' }), app(ANA)), PORTAL, ['189.44.1.1']);
  assert.equal(ultimo(c).regra, 'fora_da_rede');
  // bloqueio suspeito com login (CGNAT): a regra do evento é a da rede, a lista vai no motivo
  await paginaRede(await rodar(g, req(H, '/', { ip: '177.37.200.10' }), app(ANA)), PORTAL, ['177.37.200.10']);
  eventoRede(ultimo(c), 'bloqueado', 'fora_da_rede', /^fora da rede da Lube · também lista: IP na lista de bloqueio #91 \(suspeito\) · com login: não barrado$/, ANA);
  const g2 = await novoGuarda();
  const c2 = centralFalsa(listaRede({ modo: 'observar' }, { bloqueios: [{ id: 91, t: 'ip', v: '177.37.200.10', n: 'suspeito', ate: ateBloq }] }));
  assert.equal(await rodar(g2, req(H, '/', { ip: '177.37.200.10' }), app(ANA)), null);
  eventoRede(ultimo(c2), 'observado', 'fora_da_rede', /^seria bloqueado: fora da rede da Lube · também lista: /, ANA);
  // modo proteger da Sentinela e arquivo proibido com login: barra antes, como no 1.2.0
  const g3 = await novoGuarda();
  const c3 = centralFalsa(listaRede({ modo: 'exigir' }, { modo: 'proteger', proibidos: ['^/db/'] }));
  const prob = await rodar(g3, req(H, '/db/x.sql', { ip: FORA }), app(ANA));
  assert.equal(prob.headers.get('x-sentinela'), 'bloqueado');
  assert.equal(ultimo(c3).regra, 'arquivo_proibido');
  conta(9);
});

/* =========================================================
   16. Sessão levada para fora
   ========================================================= */
caso('16. sessão válida pega dentro e usada fora (mesmo cookie, outro IP) → 403; de volta à empresa, segue', async () => {
  const g = await novoGuarda();
  const chave = await gerarChave('a1b2c3d4e5f60718');
  const c = centralFalsa(listaRede({ modo: 'exigir' }, { chaves: [chave.jwk] }));
  const cookie = '__Host-sentinela=' + (await assinarJwt(sessaoPayload(), chave));
  assert.equal(await rodar(g, req(H, '/', { ip: ESCRITORIO, cookie })), null);
  await paginaRede(await rodar(g, req(H, '/', { ip: FORA, cookie })));
  eventoRede(ultimo(c), 'bloqueado', 'fora_da_rede', 'fora da rede da Lube', JULIO);
  assert.equal(ultimo(c).identidade_origem, 'passe');
  await jsonRede(await rodar(g, req(H, '/api/dados', { ip: '2804:14c:9:9::1', cookie })));
  assert.equal(await rodar(g, req(H, '/a', { ip: ESCRITORIO, cookie })), null, 'de volta à empresa');
  conta(2);
});

/* =========================================================
   17. Lista sem o bloco depois de uma com o bloco
   ========================================================= */
caso('17. lista nova sem "rede" depois de uma com "rede": mantém a última por 24 h; depois, sem regra', async () => {
  const g = await novoGuarda();
  const c = centralFalsa(listaRede({ modo: 'exigir' }));
  const saudeLista = async () => (await (await rodar(g, req(H, '/.sentinela/saude', { ip: FORA }))).json()).lista;
  const saude = async () => (await saudeLista()).rede;
  await paginaRede(await rodar(g, req(H, '/', { ip: FORA }), app(ANA)));
  c.lista = listaRede({}, { rede: null });
  avancar(21000);
  await paginaRede(await rodar(g, req(H, '/a', { ip: FORA }), app(ANA)));   // usa a velha e renova em fundo
  assert.equal(c.rota('/lista').length, 2);
  await paginaRede(await rodar(g, req(H, '/b', { ip: FORA }), app(ANA)));   // a nova, sem bloco: vale a última
  assert.equal(await saude(), 'exigir');
  // na saúde dá para ver o bloco herdado: a lista é nova, o bloco tem a idade da lista anterior
  const sl = await saudeLista();
  assert.ok(sl.idade_s <= 1 && sl.rede_idade_s >= 21, JSON.stringify(sl));
  avancar(23 * 3600000);
  await paginaRede(await rodar(g, req(H, '/c', { ip: FORA }), app(ANA)));
  assert.equal(await rodar(g, req(H, '/d', { ip: ESCRITORIO }), app(ANA)), null, 'o escritório segue');
  avancar(3600000);
  assert.equal(await rodar(g, req(H, '/e', { ip: FORA }), app(ANA)), null, 'passou de 24 h: sem regra de rede');
  eventoRede(ultimo(c), 'liberado', null, null, ANA);
  assert.equal(await saude(), null);
  // um bloco novo volta a valer na hora
  c.lista = listaRede({ modo: 'exigir' });
  avancar(3600001);
  await paginaRede(await rodar(g, req(H, '/f', { ip: FORA }), app(ANA)));
  // as 24 h contam no uso: lista sem bloco buscada aos 23h50 fica no cache, e aos 24h01 (central fora,
  // sem lista nova) o bloco que ela carrega já não vale
  const g2 = await novoGuarda();
  const c2 = centralFalsa(listaRede({ modo: 'exigir' }));
  await paginaRede(await rodar(g2, req(H, '/', { ip: FORA }), app(ANA)));
  c2.lista = listaRede({}, { rede: null });
  avancar(23 * 3600000 + 50 * 60000);
  await paginaRede(await rodar(g2, req(H, '/a', { ip: FORA }), app(ANA)));
  assert.equal(c2.rota('/lista').length, 2);
  avancar(11 * 60000);
  c2.fora = true;
  assert.equal(await rodar(g2, req(H, '/b', { ip: FORA }), app(ANA)), null, 'passou de 24 h com a lista no cache');
  conta(3);
});

/* =========================================================
   18. A regra nunca bloqueia IP
   ========================================================= */
caso('18. a regra nunca chama bloquearLocal: o mesmo IP, sem login, continua vendo o portal', async () => {
  const g = await novoGuarda();
  const c = centralFalsa(listaRede({ modo: 'exigir' }));
  for (let i = 0; i < 40; i++) await rodar(g, req(H, '/x' + i, { ip: FORA }), app(ANA));
  assert.equal(ultimo(c).regra, 'fora_da_rede');
  const r = await rodar(g, req(H, '/', { ip: FORA }));
  assert.equal(r.status, 302, 'sem login: vai para o portal (não 403 de lista)');
  assert.equal(r.headers.get('location'), PORTAL + '/?abrir=gestao-financeiro');
  await dormir(10);
  const evs = c.eventos.filter((e) => e.regra === 'lista');
  assert.equal(evs.length, 0, 'nenhum evento de lista');
  // no portal, sem login, a tela abre; com identidade (não acontece hoje no portal) a regra vale
  const g2 = await novoGuarda();
  centralFalsa(listaPortal({ modo: 'exigir' }));
  for (let i = 0; i < 5; i++) await paginaRede(await rodar(g2, req(HP, '/x' + i, { ip: FORA }), app(ANA)));
  assert.equal(await rodar(g2, req(HP, '/', { ip: FORA })), null, 'sem login: a tela de login do portal abre');
  conta(4);
});

/* =========================================================
   19. Desempenho
   ========================================================= */
caso('19. desempenho: 500 liberados + 200 redes, 1000 pedidos de fora e 1000 de dentro < 1 s cada', async () => {
  const liberados = [];
  for (let i = 0; i < 500; i++) liberados.push({ h: hashEmail('pessoa' + i + '@lube.com.br'), ate: daqui(86400e3) });
  const redes = [];
  for (let i = 0; i < 100; i++) redes.push('200.10.' + (i % 250) + '.' + (i + 1));
  for (let i = 0; i < 50; i++) redes.push('201.' + i + '.1.0/24');
  for (let i = 0; i < 50; i++) redes.push('2804:' + (i + 1).toString(16) + ':1200::/56');
  const g = await novoGuarda();
  centralFalsa(listaRede({ modo: 'exigir', redes, liberados }));
  await rodar(g, req(H, '/publico/', { ip: ESCRITORIO }));   // aquece a lista
  globalThis.fetch = async () => new Response('{}', { status: 200 });
  const ctx = { waitUntil(p) { p.catch(() => {}); } };
  for (let i = 0; i < 100; i++) await g.sentinela(req(H, '/api/dados', { ip: '177.50.1.' + (i % 250) }), ctx, app('pessoa' + i + '@lube.com.br'));
  let barrados = 0;
  let t0 = performance.now();
  for (let i = 0; i < 1000; i++) {
    const r = await g.sentinela(req(H, '/api/dados?p=' + i, { ip: '177.50.' + Math.floor(i / 250) + '.' + (i % 250) }), ctx, app('pessoa' + i + '@lube.com.br'));
    if (r) barrados++;
  }
  const fora = performance.now() - t0;
  assert.equal(barrados, 500, 'metade liberada, metade barrada');
  t0 = performance.now();
  for (let i = 0; i < 1000; i++) {
    // as últimas faixas da lista (2804:32:1200::/56 = 2804:32:1200:00xx::)
    const ip = i % 2 ? '201.49.1.' + (i % 250) : '2804:32:1200:' + (i % 256).toString(16) + '::' + (i % 9999).toString(16);
    assert.equal(await g.sentinela(req(H, '/api/dados?q=' + i, { ip }), ctx, app('x' + i + '@lube.com.br')), null);
  }
  const dentro = performance.now() - t0;
  console.log('        1000 de fora: ' + fora.toFixed(0) + ' ms · 1000 de dentro (última faixa): ' + dentro.toFixed(0) + ' ms');
  assert.ok(fora < 1000 && dentro < 1000);
  conta(3);
});

/* =========================================================
   20. Modo fechado com a central fora
   ========================================================= */
caso('20. fechado + partida a frio com a central fora: sem regra de rede; instância que já tinha o bloco segue com ele (liberação velha não vale)', async () => {
  const FECHADO = { projeto: 'gestao-finaceiro', slug: 'gestao-financeiro' };
  // partida a frio: a instância nunca viu o bloco
  let g = await novoGuarda();
  let c = centralFalsa(null);
  c.fora = true;
  assert.equal(await rodar(g, req(H, '/', { ip: FORA }), { ...app(ANA), fechado: FECHADO }), null);
  // instância quente: lista de mais de 1 h e central fora → reserva, com o último bloco
  g = await novoGuarda();
  c = centralFalsa(listaRede({ modo: 'exigir', liberados: [{ h: hashEmail(JULIO), ate: daqui(7 * 86400e3) }] }));
  assert.equal(await rodar(g, req(H, '/', { ip: FORA }), { ...app(JULIO), fechado: FECHADO }), null, 'liberado com lista fresca');
  avancar(3600001);
  c.fora = true;
  await paginaRede(await rodar(g, req(H, '/a', { ip: FORA }), { ...app(ANA), fechado: FECHADO }));
  await paginaRede(await rodar(g, req(H, '/b', { ip: FORA }), { ...app(JULIO), fechado: FECHADO }));
  assert.equal(await rodar(g, req(H, '/c', { ip: ESCRITORIO }), { ...app(ANA), fechado: FECHADO }), null, 'o escritório entra');
  const s = await rodar(g, req(H, '/d', { ip: FORA }), { fechado: FECHADO });
  assert.equal(s.status, 302, 'sem login: portal');
  conta(3);
});

/* =========================================================
   21. Iframe do portal e nenhum dado no evento
   ========================================================= */
caso('21. iframe de fora no exigir → a mesma página; evento sem e-mail de outra pessoa nem hash', async () => {
  const g = await novoGuarda();
  const c = centralFalsa(listaRede({ modo: 'exigir', liberados: [{ h: hashEmail(JULIO), ate: daqui(3600e3) }] }));
  const quadro = { 'sec-fetch-dest': 'iframe', 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate' };
  await paginaRede(await rodar(g, req(H, '/', { ip: FORA, headers: quadro }), app(ANA)));
  const ev = ultimo(c);
  assert.equal(ev.sec_fetch_dest, 'iframe');
  const txt = JSON.stringify(c.eventos);
  assert.ok(!txt.includes(hashEmail(JULIO)) && !txt.includes(JULIO), 'a lista de liberados não vaza para o registro');
  conta(2);
});

/* =========================================================
   23. "Exige login" desligado não abre o sistema para fora da rede
   ========================================================= */
caso('23. sistema com slug e "exige login" desligado (senha de admin, de fora, desligou o login): sem login de fora → 403 no exigir, observado no observar; portal segue', async () => {
  const aberto = (rede) => lista({ projeto: 'gestao-finaceiro', slug: 'gestao-financeiro', exige: false, rede: { redes: [ESCRITORIO], ...rede } });
  let g = await novoGuarda();
  let c = centralFalsa(aberto({ modo: 'exigir' }));
  await paginaRede(await rodar(g, req(H, '/', { ip: FORA })));
  eventoRede(ultimo(c), 'bloqueado', 'fora_da_rede', 'fora da rede da Lube', null);
  await jsonRede(await rodar(g, req(H, '/api/dados', { ip: FORA })));
  assert.equal(await rodar(g, req(H, '/', { ip: ESCRITORIO })), null, 'dentro da rede abre (sem login, como o banco mandou)');
  eventoRede(ultimo(c), 'liberado', null, null, null);
  assert.equal(await rodar(g, req(H, '/.sentinela/saude', { ip: FORA })).then((r) => r.status), 200, 'saúde continua de fora');
  g = await novoGuarda();
  c = centralFalsa(aberto({ modo: 'observar' }));
  assert.equal(await rodar(g, req(H, '/', { ip: FORA })), null);
  eventoRede(ultimo(c), 'observado', 'fora_da_rede', 'seria bloqueado: fora da rede da Lube', null);
  // sistema sem slug (o portal) e lista sem "sistema": a tela abre de qualquer lugar
  for (const l of [listaPortal({ modo: 'exigir' }), lista({ sistema: null, rede: { modo: 'exigir', redes: [ESCRITORIO] } })]) {
    g = await novoGuarda();
    c = centralFalsa(l);
    assert.equal(await rodar(g, req(HP, '/', { ip: FORA })), null);
    eventoRede(ultimo(c), 'liberado', null, null, null);
  }
  conta(2);
});

/* =========================================================
   22. Comparação pedido a pedido com o 1.2.0
   ========================================================= */
caso('22. modo desligado e lista sem "rede" = guarda 1.2.0 (commit 9f1732a): mesmas respostas, mesmos eventos, mesmas chamadas', async () => {
  let fonte;
  try {
    fonte = execFileSync('git', ['show', '9f1732a:guarda/sentinela-guarda.ts'], { cwd: RAIZ, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    console.log('        git ou commit 9f1732a indisponível: comparação pulada');
    return;
  }
  assert.match(fonte, /export const VERSAO = 'sentinela-guarda\/1\.2\.0';/);
  const pasta = mkdtempSync(join(tmpdir(), 'sentinela-guarda-120-'));
  const arq = join(pasta, 'sentinela-guarda-1.2.0.ts');
  writeFileSync(arq, fonte);
  let n120 = 0;
  const guarda120 = () => import(pathToFileURL(arq).href + '?c=' + (++n120));
  try {
    const chave = await gerarChave('a1b2c3d4e5f60718');
    const sessao = await assinarJwt(sessaoPayload(), chave);
    const cookie = '__Host-sentinela=' + sessao;
    const listas = (rede) => [
      lista({ modo: 'proteger', projeto: 'gestao-finaceiro', slug: 'gestao-financeiro', exige: true, rotas: ['/publico/'], chaves: [chave.jwk],
        proibidos: ['^/db/'], bloqueios: [{ id: 1, t: 'ip', v: '177.37.200.10', n: 'suspeito', ate: null }, { id: 2, t: 'ip', v: '177.37.200.11', n: 'certo', ate: null }],
        confiaveis: [{ t: 'ip', v: ESCRITORIO }], rede }),
      lista({ modo: 'observar', projeto: 'gestao-finaceiro', slug: 'gestao-financeiro', exige: true, chaves: [chave.jwk], rede }),
      lista({ modo: 'proteger', projeto: 'painel-lube-distribuidora', slug: null, confiaveis: [{ t: 'ip', v: ESCRITORIO }], rede }),
    ];
    const pedidos = () => [
      [req(H, '/', { ip: FORA })], [req(H, '/api/dados', { ip: FORA })], [req(H, '/folha.html', { ip: FORA, metodo: 'HEAD' })],
      [req(H, '/', { ip: FORA, cookie })], [req(H, '/', { ip: ESCRITORIO, cookie })], [req(H, '/api/dados', { ip: '2804:14c:1:2::99', cookie })],
      [req(H, '/publico/aviso.html', { ip: FORA })], [req(H, '/', { ip: FORA }), app(ANA)], [req(H, '/api/dados', { ip: AMAZON }), app(ANA)],
      [req(H, '/api/cron/ler-emails', { ua: 'vercel-cron/1.0', ip: AMAZON, headers: SEM_NAVEGADOR }), app(ROBO, { maquina: true })],
      [req(H, '/api/cron/cobrar', { ua: 'vercel-cron/1.0', ip: '3.236.14.78', headers: SEM_NAVEGADOR }), app(ROBO)],
      [req(H, '/api/dados', { ua: 'python-requests/2.32.3', ip: '200.1.2.3' }), app('robo do reposicoes (aquecedor da srv-ia)', { maquina: true })],
      [req(H, '/folha.html?aba=1&sentinela_passe=eyJh.eyJw.c2ln', { ip: FORA })],
      [req(H, '/?sentinela_passe=eyJh.eyJw.c2ln', { ip: FORA, headers: { 'sec-fetch-dest': 'iframe', 'sec-fetch-site': 'cross-site' } })],
      [req(H, '/?sentinela_passe=eyJh.eyJw.velho', { ip: '177.9.9.9' })],
      [req(H, '/.env', { ip: '45.1.2.3' })], [req(H, '/', { ua: 'curl/8.7.1', ip: '45.9.9.9' })], [req(H, '/', { ip: '177.37.200.10', cookie })],
      [req(H, '/', { ip: '177.37.200.11', cookie })], [req(H, '/db/x.sql', { ip: FORA, cookie })], [req(H, '/', { ip: ESCRITORIO, ua: 'Mozilla/5.0 (compatible)', headers: SEM_NAVEGADOR })],
      [req(H, '/', { ip: '', cookie })], [req(H, '/x', { ip: '', headers: { 'x-forwarded-for': ESCRITORIO }, cookie })],
      [req(H, '/.sentinela/outra', { ip: FORA, cookie })], [req(H, '/?token=abc&x=1', { ip: FORA, cookie })],
      [req(H, '/', { ip: '189.44.1.1', ua: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' })],
      [req(H, '/', { ip: FORA, ua: 'WhatsApp/2.23.20.0', headers: SEM_NAVEGADOR })],
      [req(H, '/.sentinela/saude', { ip: FORA })],
    ];
    const normal = (txt) => txt.replace(/\b[0-9a-f]{8}\b/g, 'XXXXXXXX').replace(/sentinela-guarda\/1\.[23]\.0/g, 'sentinela-guarda/X')
      .replace(/,"rede":(?:null|"[a-z]+"),"rede_idade_s":(?:null|\d+)/, '').replace(/"idade_s":\d+/, '"idade_s":N');
    const rodarTudo = async (fazerGuarda, rede, k) => {
      const g = await fazerGuarda();
      const c = centralFalsa(listas(rede)[k]);
      c.sessaoOk = async (b) => (b.passe === 'eyJh.eyJw.c2ln' ? { ok: true, sessao, exp: daqui(8 * 3600e3), email: JULIO } : null);
      const saida = [];
      for (const [r, o] of pedidos()) {
        const resp = await rodar(g, r, o);
        saida.push(resp === null ? null : {
          status: resp.status,
          headers: [...resp.headers.entries()].map(([a, b]) => a + ': ' + normal(b)).sort(),
          corpo: normal(await resp.text()),
        });
      }
      await dormir(5);
      const evs = c.eventos.map((e) => { const x = { ...e }; delete x.ts; delete x.vercel_id; x.motivo = x.motivo && normal(x.motivo); return x; });
      return { saida, evs, rotas: c.chamadas.map((x) => x.rota) };
    };
    const modoDesligado = { modo: 'desligado', redes: [ESCRITORIO, '177.0.0.0/24'], liberados: [{ h: hashEmail(JULIO), ate: daqui(86400e3) }, { h: hashEmail(ANA), ate: daqui(86400e3) }] };
    let comparados = 0;
    for (const [nome, rede] of [['sem bloco', null], ['desligado', modoDesligado]]) {
      for (let k = 0; k < listas(null).length; k++) {
        const antes = await rodarTudo(guarda120, rede, k);
        const depois = await rodarTudo(novoGuarda, rede, k);
        assert.equal(depois.saida.length, antes.saida.length);
        for (let i = 0; i < antes.saida.length; i++) {
          assert.deepEqual(depois.saida[i], antes.saida[i], nome + ', lista ' + k + ', pedido ' + i);
          comparados++;
        }
        assert.deepEqual(depois.evs, antes.evs, nome + ', lista ' + k + ': eventos');
        assert.deepEqual(depois.rotas, antes.rotas, nome + ', lista ' + k + ': chamadas à central');
        assert.ok(antes.evs.length > 10);
        conta(3);
      }
    }
    console.log('        ' + comparados + ' respostas comparadas com o 1.2.0, todas iguais');
    conta(comparados);
  } finally {
    try { rmSync(pasta, { recursive: true, force: true }); } catch { /* segue */ }
  }
});

const falhas = await executar('Sentinela · guarda · rede da Lube (1.3.0)');
process.exit(falhas ? 1 : 0);
