/* Apoio dos testes do guarda: central falsa, chaves ES256, requisições. */
import { createHmac } from 'node:crypto';

export const CENTRAL = 'https://wkkdcsqwlxjxorutrbnx.supabase.co/functions/v1/sentinela';
export const PORTAL = 'https://painel-lube-distribuidora.vercel.app';
export const OIDC_ISS = 'https://oidc.vercel.com/lube-distribuidora-ltda';
export const TEAM_ID = 'team_k8YNfCDhgFwOScWnM5iHGqLC';

export const UAS_NAVEGADOR = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:143.0) Gecko/20100101 Firefox/143.0',
];
export const UA = UAS_NAVEGADOR[0];

/* ---------- relógio controlável (o guarda usa Date.now) ---------- */
const agoraReal = Date.now.bind(Date);
let desloc = 0;
Date.now = () => agoraReal() + desloc;
export function avancar(ms) { desloc += ms; }
export function zerarRelogio() { desloc = 0; }

/* ---------- base64url / JWT ---------- */
const enc = new TextEncoder();
export const b64u = (x) => Buffer.from(typeof x === 'string' ? enc.encode(x) : new Uint8Array(x)).toString('base64url');

export async function gerarChave(kid) {
  const par = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pub = await crypto.subtle.exportKey('jwk', par.publicKey);
  return { kid, privada: par.privateKey, jwk: { kty: 'EC', crv: 'P-256', x: pub.x, y: pub.y, kid, alg: 'ES256', use: 'sig' } };
}

export async function assinarJwt(payload, chave, cab = {}) {
  const h = b64u(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid: chave.kid, ...cab }));
  const c = b64u(JSON.stringify(payload));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, chave.privada, enc.encode(h + '.' + c));
  return h + '.' + c + '.' + b64u(sig);
}

export function sessaoPayload(extra = {}) {
  const iat = Math.floor(Date.now() / 1000);
  return { iss: 'sentinela-lube', aud: 'gestao-finaceiro', sub: '6f1c2d3e-0000-4000-8000-000000000001', email: 'julio@lube.com.br',
    nome: 'Júlio', sis: 'gestao-financeiro', typ: 'sessao', iat, exp: iat + 8 * 3600, ...extra };
}

export function oidcFalso(extra = {}) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return b64u(JSON.stringify({ alg: 'RS256', kid: 'k1' })) + '.' +
    b64u(JSON.stringify({ iss: OIDC_ISS, aud: 'https://vercel.com/lube-distribuidora-ltda', owner: 'lube-distribuidora-ltda',
      owner_id: TEAM_ID, project: 'painel-compras', project_id: 'prj_DcJI82KyPyvSc4eUMuL9iJV6I7cp', environment: 'production', exp, ...extra })) +
    '.assinatura-de-teste';
}

/* ---------- lista no formato do contrato ---------- */
export function lista(o = {}) {
  return {
    v: 1, gerado_em: new Date().toISOString(), ttl: 20, modo: o.modo || 'observar',
    bloqueios: o.bloqueios || [], confiaveis: o.confiaveis || [],
    sistema: o.sistema === null ? null : {
      projeto: o.projeto || 'painel-compras', nome: o.nome || 'BI Compras', sistema_slug: o.slug === undefined ? 'gestao-compras' : o.slug,
      exige_login: !!o.exige, rotas_publicas: o.rotas || [], arquivos_proibidos: o.proibidos || [],
    },
    portal: PORTAL,
    chaves: o.chaves || [],
  };
}

/* ---------- central falsa (substitui globalThis.fetch) ---------- */
export function dormir(ms, signal) {
  return new Promise((res, rej) => {
    const t = setTimeout(res, ms);
    if (signal) signal.addEventListener('abort', () => { clearTimeout(t); rej(new Error('abortado')); });
  });
}

function resposta(status, corpo) {
  return new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } });
}

export function centralFalsa(listaInicial) {
  // aceitos: null = aceita qualquer credencial; [tokens] = só esses Bearer (e HMAC, se aceitaHmac);
  // o resto leva 401 guarda_nao_autenticado, como a central de verdade
  const c = {
    lista: listaInicial, chamadas: [], eventos: [], sessoes: [],
    atraso: 0, atrasoLista: 0, atrasoSessao: 0, atrasoEvento: 0, statusEvento: 200, fora: false, sessaoOk: null,
    aceitos: null, aceitaHmac: true,
    rota(r) { return this.chamadas.filter((x) => x.rota === r); },
    com(token) { return this.chamadas.filter((x) => x.headers.get('authorization') === 'Bearer ' + token); },
  };
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (!u.startsWith(CENTRAL + '/')) throw new Error('guarda chamou URL inesperada: ' + u);
    const rota = u.slice(CENTRAL.length);
    const headers = new Headers(init.headers || {});
    c.chamadas.push({ rota, init, headers });
    if (c.fora) throw new TypeError('fetch failed');
    const atraso = c.atraso || (rota === '/lista' ? c.atrasoLista : rota === '/sessao' ? c.atrasoSessao : rota === '/evento' ? c.atrasoEvento : 0);
    if (atraso) await dormir(atraso, init.signal);
    if (c.aceitos) {
      const auth = headers.get('authorization') || '';
      const ok = (auth.startsWith('Bearer ') && c.aceitos.includes(auth.slice(7))) || (c.aceitaHmac && !!headers.get('x-sentinela-assinatura'));
      if (!ok) return resposta(401, { erro: 'guarda_nao_autenticado' });
    }
    if (rota === '/lista') return c.lista ? resposta(200, c.lista) : resposta(500, { erro: 'interno' });
    if (rota === '/evento') {
      if (c.statusEvento !== 200) return resposta(c.statusEvento, { erro: 'interno' });
      const b = JSON.parse(init.body);
      c.eventos.push(...b.eventos);
      return resposta(200, { gravados: b.eventos.length, descartados: 0, bloqueios_novos: [], analisar: [] });
    }
    if (rota === '/sessao') {
      const b = JSON.parse(init.body);
      c.sessoes.push(b);
      const r = c.sessaoOk ? await c.sessaoOk(b) : null;
      return r ? resposta(200, r) : resposta(401, { erro: 'passe_invalido' });
    }
    return resposta(404, { erro: 'rota_desconhecida' });
  };
  return c;
}

/* ---------- requisições e contexto ---------- */
let seqId = 0;
export function req(host, caminho, o = {}) {
  const h = {
    'x-real-ip': o.ip === undefined ? '177.100.20.30' : o.ip,
    'accept-language': 'pt-BR,pt;q=0.9,en;q=0.8',
    'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document',
    'x-vercel-ip-country': 'BR', 'x-vercel-ip-country-region': 'ES', 'x-vercel-ip-city': 'Cariacica',
    'x-vercel-ip-latitude': '-20.2632', 'x-vercel-ip-longitude': '-40.4165', 'x-vercel-ip-timezone': 'America/Sao_Paulo',
    'x-vercel-id': 'gru1::iad1::teste-' + (++seqId),
    ...(o.headers || {}),
  };
  if (o.ua !== null) h['user-agent'] = o.ua || UA;
  if (o.oidc !== false) h['x-vercel-oidc-token'] = o.oidc || oidcFalso();
  if (o.cookie) h.cookie = o.cookie;
  if (!h['x-real-ip']) delete h['x-real-ip'];
  return new Request('https://' + host + caminho, { method: o.metodo || 'GET', headers: h });
}

export function novoCtx() {
  const pend = [];
  return {
    waitUntil(p) { pend.push(p); },
    async esperar() { while (pend.length) await Promise.all(pend.splice(0)); },
    get pendentes() { return pend.length; },
  };
}

// roda o guarda e espera o que foi para waitUntil (registro, renovação)
export async function rodar(g, request, opcoes, ctx = novoCtx()) {
  const r = await g.sentinela(request, ctx, opcoes);
  await ctx.esperar();
  return r;
}

export function hmacHex(chave, txt) {
  return createHmac('sha256', chave).update(txt).digest('hex');
}

/* ---------- mini executor ---------- */
const casos = [];
export const placar = { verificacoes: 0 };
export function caso(nome, fn) { casos.push({ nome, fn }); }
export function conta(n = 1) { placar.verificacoes += n; }

export async function executar(titulo) {
  const rejeicoes = [];
  process.on('unhandledRejection', (e) => rejeicoes.push(e));
  let ok = 0;
  const falhas = [];
  console.log('\n' + titulo + '\n' + '='.repeat(titulo.length));
  for (const c of casos) {
    zerarRelogio();
    const t0 = performance.now();
    try {
      await c.fn();
      ok++;
      console.log('  ok    ' + c.nome + '  (' + (performance.now() - t0).toFixed(0) + ' ms)');
    } catch (e) {
      falhas.push(c.nome);
      console.log('  FALHA ' + c.nome + '\n        ' + String((e && e.stack) || e).split('\n').slice(0, 6).join('\n        '));
    }
  }
  await dormir(50);
  if (rejeicoes.length) {
    falhas.push('promessas rejeitadas sem tratamento: ' + rejeicoes.length);
    console.log('  FALHA rejeições sem tratamento: ' + rejeicoes.map(String).join(' | '));
  }
  console.log('\n' + ok + '/' + casos.length + ' casos ok · ' + placar.verificacoes + ' verificações' + (falhas.length ? ' · FALHAS: ' + falhas.join('; ') : ''));
  return falhas.length;
}
