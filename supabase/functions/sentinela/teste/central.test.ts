// Teste de ponta a ponta da Central com banco, OIDC e fetch falsos.
// Confere rotas, autenticação, CORS, passe/sessão, IA, Tor e os nomes
// e parâmetros EXATOS das funções sentinela_srv_* (§2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarCentral, MAX_TENTATIVAS_MIN, precisaAtualizarTor, TEAM_ID, URL_TOR } from '../central.ts';
import type { Dependencias } from '../central.ts';
import { assinarHmac } from '../hmac.ts';
import { URL_ANTHROPIC } from '../ia.ts';
import { verificarJwt } from '../jwt.ts';
import type { JwkPublica } from '../jwt.ts';

const BASE = 'https://wkkdcsqwlxjxorutrbnx.supabase.co/functions/v1/sentinela';
const PORTAL = 'https://painel-lube-distribuidora.vercel.app';
const USUARIO = '7b2f3c1e-1111-4222-8333-944455556666';
const PENDENTE = '5a5a5a5a-2222-4333-8444-555566667777';  // cadastro pendente (perfil inativo)
const CHAVE_HMAC = 'teste-hmac-0123456789-0123456789-abc';
const CHAVE_IA = 'chave-falsa-de-teste';

// Assinaturas do §2 (nomes de parâmetro exatos)
const ASSINATURAS: Record<string, string[]> = {
  sentinela_srv_lista: ['p_projeto'],
  sentinela_srv_registrar: ['p_projeto', 'p_ambiente', 'p_guarda', 'p_runtime', 'p_eventos'],
  sentinela_srv_contexto_ip: ['p_ip'],
  sentinela_srv_registrar_analise: ['p_ip', 'p_dados'],
  sentinela_srv_ia_cota: [],
  sentinela_srv_ia_status: ['p_status', 'p_detalhe'],
  sentinela_srv_identidade: ['p_ip', 'p_user_id', 'p_email', 'p_origem', 'p_ua'],
  sentinela_srv_tentativa: ['p_ip', 'p_usuario', 'p_ua'],
  sentinela_srv_permissao: ['p_user_id', 'p_sistema_slug'],
  sentinela_srv_passe_usar: ['p_jti', 'p_projeto', 'p_email'],
  sentinela_srv_chave_ativa: [],
  sentinela_srv_chave_criar: ['p_kid', 'p_publica', 'p_privada'],
  sentinela_srv_chaves_publicas: [],
  sentinela_srv_tor_atualizar: ['p_ips'],
  sentinela_srv_manutencao: [],
};

type Chamada = { nome: string; params: Record<string, unknown> };
type P = Record<string, any>;

const SISTEMAS: Record<string, P> = {
  'painel-compras': { projeto: 'painel-compras', nome: 'BI Compras', sistema_slug: 'gestao-compras', exige_login: false, rotas_publicas: [], arquivos_proibidos: [] },
  'gestao-finaceiro': { projeto: 'gestao-finaceiro', nome: 'Gestão Financeiro', sistema_slug: 'gestao-financeiro', exige_login: true, rotas_publicas: [], arquivos_proibidos: [] },
  'projeto-sem-id': { projeto: 'projeto-sem-id', nome: 'X', sistema_slug: null, exige_login: false, rotas_publicas: [], arquivos_proibidos: [] },
  'painel-icms': { projeto: 'painel-icms', nome: 'Painel ICMS', sistema_slug: 'painel-icms', exige_login: false, rotas_publicas: [], arquivos_proibidos: [] },
};

const OIDC: Record<string, P> = {
  'oidc.compras.ok': { owner_id: TEAM_ID, project: 'painel-compras', project_id: 'prj_DcJI82KyPyvSc4eUMuL9iJV6I7cp', environment: 'production' },
  'oidc.fin.ok': { owner_id: TEAM_ID, project: 'gestao-finaceiro', project_id: 'prj_1TWb4V3Cl1m9CbOwhoXuw8fdzHwR', environment: 'preview' },
  'oidc.outro.time': { owner_id: 'team_outro', project: 'painel-compras', project_id: 'prj_DcJI82KyPyvSc4eUMuL9iJV6I7cp', environment: 'production' },
  'oidc.id.trocado': { owner_id: TEAM_ID, project: 'painel-compras', project_id: 'prj_1TWb4V3Cl1m9CbOwhoXuw8fdzHwR', environment: 'production' },
  'oidc.desconhecido': { owner_id: TEAM_ID, project: 'projeto-novo', project_id: 'prj_novo', environment: 'production' },
  'oidc.compras.dev': { owner_id: TEAM_ID, project: 'painel-compras', project_id: 'prj_DcJI82KyPyvSc4eUMuL9iJV6I7cp', environment: 'development' },
  'oidc.compras.semamb': { owner_id: TEAM_ID, project: 'painel-compras', project_id: 'prj_DcJI82KyPyvSc4eUMuL9iJV6I7cp' },
  'oidc.icms.velho': { owner_id: TEAM_ID, project: 'painel-icms', project_id: 'prj_5h9PoHWB6qCeoEhUNzQ4RVxnGrbn', environment: 'production' },
  'oidc.icms.novo': { owner_id: TEAM_ID, project: 'painel-icms', project_id: 'prj_icmsRecriado', environment: 'production' },
};

/** Cabeçalhos do portal no navegador (origem permitida + JSON, como o portal.js manda). */
const nav = (extra: Record<string, string> = {}) => ({ origin: PORTAL, 'content-type': 'application/json', ...extra });

function montar(opcoes: { chaveIa?: string; chaveHmac?: string; tempoIaMs?: number } = {}) {
  const chamadas: Chamada[] = [];
  const pendentes: Promise<unknown>[] = [];
  const fetches: { url: string; init?: RequestInit }[] = [];
  const logs: string[] = [];
  const estado = {
    agora: Date.parse('2026-10-05T15:00:00Z'),
    chave: null as null | { kid: string; publica: JwkPublica; privada: string },
    usados: new Set<string>(),
    analisar: [] as string[],
    cota: 60,
    manutencao: { apagados: { eventos: 0, tentativas: 0, passes: 0 } } as unknown,
    falharRegistrar: false,
    falharChaveAtiva: false,
    falharIaStatus: false,
    /** analisar diferente a cada srv_registrar (lotes simultâneos) */
    proximoAnalisar: null as null | (() => string[]),
    /** tor_atualizado_em que o srv_lista devolve; undefined = não manda o campo */
    torAtualizadoEm: undefined as undefined | string | null,
    /** projeto_id que o srv_lista devolve em sistema, como o banco (projeto-sem-id: banco antigo, sem o campo) */
    projetoIdBanco: {
      'painel-compras': 'prj_DcJI82KyPyvSc4eUMuL9iJV6I7cp',
      'gestao-finaceiro': 'prj_1TWb4V3Cl1m9CbOwhoXuw8fdzHwR',
      'painel-icms': 'prj_5h9PoHWB6qCeoEhUNzQ4RVxnGrbn',
    } as Record<string, string>,
    respostaIdentidade: { ok: true } as unknown,
    /** guarda_ativo que o srv_permissao devolve (sistemas.ultimo_sinal preenchido); undefined = banco antigo, sem o campo */
    guardaAtivo: true as unknown,
    tentativas: new Map<string, number>(),
    respostaIA: (_body: P, _init?: RequestInit): Response | Promise<Response> => new Response(JSON.stringify({
      content: [{ type: 'tool_use', id: 't1', name: 'veredito',
        input: { veredito: 'malicioso', confianca: 0.95, motivo: 'Varredura de arquivos sensíveis.', acao: 'bloquear_24h' } }],
      stop_reason: 'tool_use', usage: { input_tokens: 500, output_tokens: 40 },
    }), { status: 200 }),
    respostaTor: () => new Response(Array.from({ length: 150 }, (_, i) => `185.220.${Math.floor(i / 250)}.${i % 250}`).join('\n'), { status: 200 }),
  };

  const rpc = async (nome: string, params: Record<string, unknown> = {}) => {
    chamadas.push({ nome, params });
    const esperado = ASSINATURAS[nome];
    if (!esperado) throw new Error(`função fora do contrato: ${nome}`);
    assert.deepEqual(Object.keys(params).sort(), [...esperado].sort(), `parâmetros de ${nome}`);
    switch (nome) {
      case 'sentinela_srv_lista': {
        const proj = params.p_projeto as string;
        const sis = SISTEMAS[proj] ? { ...SISTEMAS[proj], ...(estado.projetoIdBanco[proj] ? { projeto_id: estado.projetoIdBanco[proj] } : {}) } : null;
        return {
          v: 1, gerado_em: new Date(estado.agora).toISOString(), ttl: 20, modo: 'observar',
          bloqueios: [{ id: 1, t: 'ip', v: '6.6.6.6', n: 'certo', ate: null }], confiaveis: [{ t: 'cidr', v: '177.0.0.0/24' }],
          sistema: sis, portal: PORTAL,
          ...(estado.torAtualizadoEm !== undefined ? { tor_atualizado_em: estado.torAtualizadoEm } : {}),
        };
      }
      case 'sentinela_srv_chave_ativa':
        if (estado.falharChaveAtiva) throw new Error('rpc sentinela_srv_chave_ativa: vault fora');
        return estado.chave ? { ...estado.chave } : null;
      case 'sentinela_srv_chave_criar':
        if (!estado.chave) estado.chave = { kid: params.p_kid as string, publica: params.p_publica as JwkPublica, privada: params.p_privada as string };
        return { ...estado.chave };
      case 'sentinela_srv_chaves_publicas':
        // o banco "vaza" um campo a mais: a central tem que limpar
        return estado.chave ? [{ ...estado.chave.publica, d: 'NAO-PODE-SAIR' }] : [];
      case 'sentinela_srv_registrar':
        if (estado.falharRegistrar) throw new Error('rpc sentinela_srv_registrar: 23502 null value in column "x" SELECT segredo');
        return { gravados: (params.p_eventos as unknown[]).length, descartados: 0, bloqueios_novos: [],
          analisar: estado.proximoAnalisar ? estado.proximoAnalisar() : estado.analisar };
      case 'sentinela_srv_passe_usar': {
        const jti = params.p_jti as string;
        if (estado.usados.has(jti)) return false;
        estado.usados.add(jti);
        return true;
      }
      case 'sentinela_srv_permissao': {
        // mesmos motivos do 02_sentinela.sql: o perfil é conferido antes do sistema
        const slug = params.p_sistema_slug;
        if (params.p_user_id === PENDENTE) return { permitido: false, motivo: 'perfil_inativo', email: 'novo@lube.com.br', nome: 'Novo', projeto: null, url: null };
        if (params.p_user_id !== USUARIO) return { permitido: false, motivo: 'perfil_inexistente', email: null, nome: null, projeto: null, url: null };
        if (slug === null) return { permitido: false, motivo: 'sistema_desconhecido', email: 'julio@lube.com.br', nome: 'Júlio', projeto: null, url: null };
        if (slug === 'gestao-financeiro') {
          return { permitido: true, motivo: 'permissão direta', email: 'julio@lube.com.br', nome: 'Júlio', projeto: 'gestao-finaceiro', url: 'https://gestao-finaceiro.vercel.app',
            ...(estado.guardaAtivo !== undefined ? { guarda_ativo: estado.guardaAtivo } : {}) };
        }
        if (slug === 'sem-sentinela') return { permitido: true, motivo: 'ok', email: 'julio@lube.com.br', nome: 'Júlio', projeto: null, url: null };
        return { permitido: false, motivo: 'sem permissão para este sistema' };
      }
      case 'sentinela_srv_identidade': return estado.respostaIdentidade;
      case 'sentinela_srv_tentativa': {
        // como o banco: 5 tentativas do mesmo IP → bloqueio forca_bruta
        const n = (estado.tentativas.get(params.p_ip as string) ?? 0) + 1;
        estado.tentativas.set(params.p_ip as string, n);
        return { ok: true, bloqueado: n >= 5 };
      }
      case 'sentinela_srv_ia_cota': return estado.cota;
      case 'sentinela_srv_contexto_ip':
        return { ip: params.p_ip, perfil: { ip: params.p_ip, identidade: 'julio@lube.com.br' }, confiavel: false, tor: false, bloqueios: [], identidades: [], tentativas_10min: 0, eventos: [] };
      case 'sentinela_srv_registrar_analise':
        estado.cota = Math.max(0, estado.cota - 1); // análise gravada gasta a cota da hora
        return { analise_id: 7, aplicado: 'nenhum' };
      case 'sentinela_srv_ia_status':
        if (estado.falharIaStatus) throw new Error('rpc sentinela_srv_ia_status: fora');
        return null;
      case 'sentinela_srv_manutencao': return estado.manutencao;
      case 'sentinela_srv_tor_atualizar':
        // como o banco: grava config.tor_atualizado_em
        if (estado.torAtualizadoEm !== undefined) estado.torAtualizadoEm = new Date(estado.agora).toISOString();
        return (params.p_ips as unknown[]).length;
    }
    throw new Error('sem resposta falsa para ' + nome);
  };

  const deps: Dependencias = {
    rpc,
    verificarOidcVercel: async (t) => {
      if (OIDC[t]) return { ...OIDC[t] };
      throw new Error('JWSSignatureVerificationFailed');
    },
    verificarTokenUsuario: async (t) => {
      if (t === 'usuario-ok') return { sub: USUARIO, email: 'Julio@Lube.com.br', aud: 'authenticated', role: 'authenticated' };
      if (t === 'usuario-anonimo') return { sub: USUARIO, is_anonymous: true, aud: 'authenticated' };
      if (t === 'usuario-outro') return { sub: '00000000-0000-4000-8000-000000000000', email: 'x@lube.com.br' };
      if (t === 'usuario-pendente') return { sub: PENDENTE, email: 'novo@lube.com.br', aud: 'authenticated' };
      throw new Error('token inválido');
    },
    chaveHmac: () => opcoes.chaveHmac,
    chaveAnthropic: () => opcoes.chaveIa,
    fetch: (async (entrada: RequestInfo | URL, init?: RequestInit) => {
      const url = String(entrada);
      fetches.push({ url, init });
      if (url === URL_ANTHROPIC) return estado.respostaIA(JSON.parse(String(init?.body)), init);
      if (url === URL_TOR) return estado.respostaTor();
      throw new Error('fetch inesperado ' + url);
    }) as typeof fetch,
    depois: (p) => { pendentes.push(p); },
    agora: () => estado.agora,
    log: (msg) => { logs.push(msg); },
    tempoIaMs: opcoes.tempoIaMs ?? 15_000,
  };
  const central = criarCentral(deps);
  const chamar = (rota: string, init: RequestInit & { headers?: Record<string, string> } = {}) =>
    central(new Request(`${BASE}/${rota}`, init));
  const esperarFundo = async () => { while (pendentes.length) await pendentes.shift(); };
  const de = (nome: string) => chamadas.filter((c) => c.nome === nome);
  // outra instância da Edge Function (mesmo banco, memória própria)
  const outraInstancia = () => {
    const c2 = criarCentral(deps);
    return (rota: string, init: RequestInit & { headers?: Record<string, string> } = {}) => c2(new Request(`${BASE}/${rota}`, init));
  };
  return { central, chamar, estado, chamadas, fetches, logs, esperarFundo, de, outraInstancia };
}

const guarda = (token: string, extra: Record<string, string> = {}) => ({ authorization: `Bearer ${token}`, ...extra });
const evento = (ip = '45.9.20.1') => ({
  ts: '2026-10-05T14:59:59Z', metodo: 'GET', caminho: '/.env', tipo: 'arquivo', ip, pais: 'NL', ua: 'sqlmap/1.7',
  decisao: 'bloqueado', regra: 'varredura', motivo: 'varredura de caminho', identidade: null, identidade_origem: null,
});

// ---------------------------------------------------------
test('GET /saude e rotas desconhecidas', async () => {
  const c = montar();
  const r = await c.chamar('saude');
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, servico: 'sentinela', versao: '1.0.0' });
  assert.equal(r.headers.get('access-control-allow-origin'), null);
  assert.equal((await c.chamar('xpto')).status, 404);
  assert.deepEqual(await (await c.chamar('')).json(), { erro: 'rota_desconhecida' });
  assert.equal((await c.chamar('constructor')).status, 404);
  const m = await c.chamar('lista', { method: 'POST' });
  assert.equal(m.status, 405);
  assert.equal((await c.chamar('passe')).status, 405);
});

test('guarda: OIDC aceito só do team Lube, project_id certo e projeto conhecido', async () => {
  const c = montar();
  assert.deepEqual(await (await c.chamar('lista')).json(), { erro: 'guarda_nao_autenticado' });
  for (const t of ['oidc.outro.time', 'oidc.id.trocado', 'oidc.desconhecido', 'forjado.qualquer.coisa']) {
    const r = await c.chamar('lista', { headers: guarda(t) });
    assert.equal(r.status, 401, t);
  }
  const r = await c.chamar('lista', { headers: guarda('oidc.compras.ok') });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('access-control-allow-origin'), null, 'rota do guarda não tem CORS');
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const corpo = await r.json();
  assert.equal(corpo.modo, 'observar');
  assert.equal(corpo.sistema.projeto, 'painel-compras');
  assert.equal(corpo.portal, PORTAL);
  assert.equal(corpo.bloqueios.length, 1);
  assert.equal(corpo.chaves.length, 1);
  assert.deepEqual(Object.keys(corpo.chaves[0]).sort(), ['alg', 'crv', 'kid', 'kty', 'use', 'x', 'y']);
  assert.equal(JSON.stringify(corpo).includes('NAO-PODE-SAIR'), false, 'nunca publica campo privado');
  assert.equal(c.de('sentinela_srv_chave_criar').length, 1, 'chave criada na primeira lista');
  const priv = JSON.parse(c.estado.chave!.privada);
  assert.equal(typeof priv.d, 'string', 'privada vai como texto JSON para o Vault');
});

test('chave: criada uma vez só, mesmo com pedidos simultâneos', async () => {
  const c = montar();
  const rs = await Promise.all([1, 2, 3, 4].map(() => c.chamar('lista', { headers: guarda('oidc.compras.ok') })));
  assert.deepEqual(rs.map((r) => r.status), [200, 200, 200, 200]);
  assert.equal(c.de('sentinela_srv_chave_criar').length, 1);
  assert.equal(c.de('sentinela_srv_chave_ativa').length, 1);
});

test('guarda: plano B HMAC', async () => {
  const c = montar({ chaveHmac: CHAVE_HMAC });
  const t = Math.floor(c.estado.agora / 1000);
  const vazio = new Uint8Array(0);
  const sigGet = await assinarHmac(CHAVE_HMAC, t, vazio);
  const ok = await c.chamar('lista', { headers: { 'x-sentinela-assinatura': `t=${t},v1=${sigGet}`, 'x-sentinela-projeto': 'painel-compras' } });
  assert.equal(ok.status, 200);
  const desconhecido = await c.chamar('lista', { headers: { 'x-sentinela-assinatura': `t=${t},v1=${sigGet}`, 'x-sentinela-projeto': 'nao-existe' } });
  assert.equal(desconhecido.status, 401);
  const velho = await assinarHmac(CHAVE_HMAC, t - 301, vazio);
  assert.equal((await c.chamar('lista', { headers: { 'x-sentinela-assinatura': `t=${t - 301},v1=${velho}`, 'x-sentinela-projeto': 'painel-compras' } })).status, 401);

  const corpo = JSON.stringify({ eventos: [evento()] });
  const sig = await assinarHmac(CHAVE_HMAC, t, new TextEncoder().encode(corpo));
  const h = { 'x-sentinela-assinatura': `t=${t},v1=${sig}`, 'x-sentinela-projeto': 'painel-compras', 'x-sentinela-ambiente': 'preview', 'content-type': 'application/json' };
  const r = await c.chamar('evento', { method: 'POST', headers: h, body: corpo });
  assert.equal(r.status, 200);
  assert.equal(c.de('sentinela_srv_registrar')[0].params.p_ambiente, 'preview');
  // corpo trocado com a mesma assinatura
  const r2 = await c.chamar('evento', { method: 'POST', headers: h, body: corpo.replace('45.9.20.1', '45.9.20.2') });
  assert.equal(r2.status, 401);

  // sem SENTINELA_CHAVE no ambiente o HMAC não vale
  const semChave = montar();
  assert.equal((await semChave.chamar('lista', { headers: { 'x-sentinela-assinatura': `t=${t},v1=${sigGet}`, 'x-sentinela-projeto': 'painel-compras' } })).status, 401);
});

test('POST /evento: saneia, chama srv_registrar com os parâmetros certos', async () => {
  const c = montar();
  const body = JSON.stringify({ eventos: [evento(), { ...evento(), ip: '999.9.9.9' }, { ...evento('2001:DB8::7'), extra: 'x' }] });
  const r = await c.chamar('evento', {
    method: 'POST', body,
    headers: guarda('oidc.fin.ok', { 'x-sentinela-guarda': 'sentinela-guarda/1.0.0', 'x-sentinela-runtime': 'nodejs' }),
  });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, gravados: 2, descartados: 0, invalidos: 1 });
  const p = c.de('sentinela_srv_registrar')[0].params;
  assert.equal(p.p_projeto, 'gestao-finaceiro');
  assert.equal(p.p_ambiente, 'preview');
  assert.equal(p.p_guarda, 'sentinela-guarda/1.0.0');
  assert.equal(p.p_runtime, 'nodejs');
  const evs = p.p_eventos as P[];
  assert.equal(evs.length, 2);
  assert.equal(evs[1].ip, '2001:db8::7');
  assert.equal('extra' in evs[1], false);
  await c.esperarFundo();
  assert.equal(c.de('sentinela_srv_manutencao').length, 1);
});

test('POST /evento: limites de corpo, quantidade e JSON', async () => {
  const c = montar();
  const h = guarda('oidc.compras.ok');
  const grande = await c.chamar('evento', { method: 'POST', headers: h, body: 'x'.repeat(64 * 1024 + 1) });
  assert.equal(grande.status, 413);
  const muitos = await c.chamar('evento', { method: 'POST', headers: h, body: JSON.stringify({ eventos: Array.from({ length: 21 }, () => evento()) }) });
  assert.equal(muitos.status, 400);
  assert.equal((await muitos.json()).erro, 'eventos_demais');
  assert.equal((await c.chamar('evento', { method: 'POST', headers: h, body: '{eventos' })).status, 400);
  assert.equal((await c.chamar('evento', { method: 'POST', headers: h, body: '{"x":1}' })).status, 400);
  assert.equal(c.de('sentinela_srv_registrar').length, 0);
});

test('erro do banco vira 500 genérico, sem vazar SQL', async () => {
  const c = montar();
  c.estado.falharRegistrar = true;
  const r = await c.chamar('evento', { method: 'POST', headers: guarda('oidc.compras.ok'), body: JSON.stringify({ eventos: [evento()] }) });
  assert.equal(r.status, 500);
  const t = await r.text();
  assert.equal(t, '{"erro":"interno"}');
  assert.ok(c.logs.includes('erro interno'));
});

test('IA: analisa com a Anthropic e registra o veredito', async () => {
  const c = montar({ chaveIa: CHAVE_IA });
  c.estado.analisar = ['45.9.20.1'];
  await c.chamar('evento', { method: 'POST', headers: guarda('oidc.compras.ok'), body: JSON.stringify({ eventos: [evento()] }) });
  await c.esperarFundo();
  const ia = c.fetches.filter((f) => f.url === URL_ANTHROPIC);
  assert.equal(ia.length, 1);
  const h = ia[0].init!.headers as Record<string, string>;
  assert.equal(h['x-api-key'], CHAVE_IA);
  assert.equal(h['anthropic-version'], '2023-06-01');
  assert.equal(h['content-type'], 'application/json');
  assert.equal(ia[0].init!.method, 'POST');
  assert.ok(ia[0].init!.signal instanceof AbortSignal);
  const body = JSON.parse(String(ia[0].init!.body));
  assert.equal(body.model, 'claude-haiku-4-5-20251001');
  assert.equal(body.max_tokens, 400);
  assert.deepEqual(body.tool_choice, { type: 'tool', name: 'veredito' });
  assert.ok(!body.messages[0].content.includes('julio@lube.com.br'), 'e-mail mascarado');
  const reg = c.de('sentinela_srv_registrar_analise');
  assert.equal(reg.length, 1);
  assert.equal(reg[0].params.p_ip, '45.9.20.1');
  assert.deepEqual(reg[0].params.p_dados, {
    modelo: 'claude-haiku-4-5-20251001', veredito: 'malicioso', confianca: 0.95, motivo: 'Varredura de arquivos sensíveis.',
    acao: 'bloquear_24h', tokens_entrada: 500, tokens_saida: 40, erro: null,
  });
  assert.deepEqual(c.de('sentinela_srv_ia_status').map((x) => x.params.p_status), ['ligada']);
  assert.ok(!JSON.stringify(c.chamadas).includes(CHAVE_IA), 'a chave da IA nunca vai para o banco');
});

test('IA: sem chave → status sem_chave e nenhuma chamada', async () => {
  const c = montar();
  c.estado.analisar = ['45.9.20.1'];
  await c.chamar('evento', { method: 'POST', headers: guarda('oidc.compras.ok'), body: JSON.stringify({ eventos: [evento()] }) });
  await c.esperarFundo();
  assert.equal(c.fetches.filter((f) => f.url === URL_ANTHROPIC).length, 0);
  assert.deepEqual(c.de('sentinela_srv_ia_status').map((x) => x.params.p_status), ['sem_chave']);
  assert.equal(c.de('sentinela_srv_registrar_analise').length, 0);
});

test('IA: erro HTTP e resposta sem tool_use viram análise "erro"', async () => {
  const c = montar({ chaveIa: CHAVE_IA });
  c.estado.analisar = ['45.9.20.1'];
  c.estado.respostaIA = () => new Response(JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }), { status: 529 });
  await c.chamar('evento', { method: 'POST', headers: guarda('oidc.compras.ok'), body: JSON.stringify({ eventos: [evento()] }) });
  await c.esperarFundo();
  let reg = c.de('sentinela_srv_registrar_analise');
  assert.equal(reg[0].params.p_dados && (reg[0].params.p_dados as P).veredito, 'erro');
  assert.equal((reg[0].params.p_dados as P).erro, 'HTTP 529 overloaded_error: Overloaded');
  assert.deepEqual(c.de('sentinela_srv_ia_status').at(-1)!.params, { p_status: 'erro', p_detalhe: 'HTTP 529 overloaded_error: Overloaded' });

  const s = montar({ chaveIa: CHAVE_IA });
  s.estado.analisar = ['45.9.20.1'];
  s.estado.respostaIA = () => new Response(JSON.stringify({ content: [{ type: 'text', text: 'oi' }], stop_reason: 'end_turn' }), { status: 200 });
  await s.chamar('evento', { method: 'POST', headers: guarda('oidc.compras.ok'), body: JSON.stringify({ eventos: [evento()] }) });
  await s.esperarFundo();
  reg = s.de('sentinela_srv_registrar_analise');
  assert.equal((reg[0].params.p_dados as P).veredito, 'erro');
  assert.match(String((reg[0].params.p_dados as P).erro), /sem tool_use/);
});

test('IA: timeout de verdade pelo AbortSignal', async () => {
  const c = montar({ chaveIa: CHAVE_IA, tempoIaMs: 40 });
  c.estado.analisar = ['45.9.20.1', '45.9.20.2'];
  // fetch falso que só termina quando o sinal aborta (como o de verdade)
  c.estado.respostaIA = (_b, init) => new Promise<Response>((_ok, falha) => {
    init?.signal?.addEventListener('abort', () => falha(init.signal!.reason));
  });
  const inicio = Date.now();
  await c.chamar('evento', { method: 'POST', headers: guarda('oidc.compras.ok'), body: JSON.stringify({ eventos: [evento()] }) });
  await c.esperarFundo();
  assert.ok(Date.now() - inicio < 3000);
  const reg = c.de('sentinela_srv_registrar_analise');
  assert.equal(reg.length, 1, 'para no primeiro timeout; o outro IP fica para depois');
  assert.equal((reg[0].params.p_dados as P).veredito, 'erro');
  assert.match(String((reg[0].params.p_dados as P).erro), /^tempo esgotado/);
  assert.equal(c.de('sentinela_srv_ia_status').at(-1)!.params.p_status, 'erro');
});

test('IA: cota e máximo de 3 por lote', async () => {
  const c = montar({ chaveIa: CHAVE_IA });
  c.estado.analisar = ['1.1.1.1', '2.2.2.2', '3.3.3.3', '4.4.4.4', '5.5.5.5', 'lixo'];
  await c.chamar('evento', { method: 'POST', headers: guarda('oidc.compras.ok'), body: JSON.stringify({ eventos: [evento()] }) });
  await c.esperarFundo();
  assert.equal(c.fetches.filter((f) => f.url === URL_ANTHROPIC).length, 3);

  const z = montar({ chaveIa: CHAVE_IA });
  z.estado.analisar = ['1.1.1.1'];
  z.estado.cota = 0;
  await z.chamar('evento', { method: 'POST', headers: guarda('oidc.compras.ok'), body: JSON.stringify({ eventos: [evento()] }) });
  await z.esperarFundo();
  assert.equal(z.fetches.filter((f) => f.url === URL_ANTHROPIC).length, 0);

  const um = montar({ chaveIa: CHAVE_IA });
  um.estado.analisar = ['1.1.1.1', '2.2.2.2', '3.3.3.3'];
  um.estado.cota = 1;
  await um.chamar('evento', { method: 'POST', headers: guarda('oidc.compras.ok'), body: JSON.stringify({ eventos: [evento()] }) });
  await um.esperarFundo();
  assert.equal(um.fetches.filter((f) => f.url === URL_ANTHROPIC).length, 1);
});

test('Tor: baixa quando a manutenção rodou; lista suspeita não apaga a boa; manutenção 1x a cada 30 min', async () => {
  const c = montar();
  const enviar = () => c.chamar('evento', { method: 'POST', headers: guarda('oidc.compras.ok'), body: JSON.stringify({ eventos: [evento()] }) });
  await enviar();
  await c.esperarFundo();
  assert.equal(c.fetches.filter((f) => f.url === URL_TOR).length, 1);
  const tor = c.de('sentinela_srv_tor_atualizar');
  assert.equal(tor.length, 1);
  assert.equal((tor[0].params.p_ips as string[]).length, 150);
  await enviar();
  await c.esperarFundo();
  assert.equal(c.de('sentinela_srv_manutencao').length, 1, 'não chama a manutenção a cada evento');

  const s = montar();
  s.estado.respostaTor = () => new Response('<html>erro</html>\n1.2.3.4', { status: 200 });
  await s.chamar('evento', { method: 'POST', headers: guarda('oidc.compras.ok'), body: JSON.stringify({ eventos: [evento()] }) });
  await s.esperarFundo();
  assert.equal(s.de('sentinela_srv_tor_atualizar').length, 0);
  assert.ok(s.logs.includes('tor falhou'));

  const p = montar();
  p.estado.manutencao = { pulado: true };
  await p.chamar('evento', { method: 'POST', headers: guarda('oidc.compras.ok'), body: JSON.stringify({ eventos: [evento()] }) });
  await p.esperarFundo();
  assert.equal(p.fetches.filter((f) => f.url === URL_TOR).length, 0);
});

test('manutenção "pendente" (atraso grande no banco) volta em 1 min, não em 30', async () => {
  const c = montar();
  const enviar = async () => {
    await c.chamar('evento', { method: 'POST', headers: guarda('oidc.compras.ok'), body: JSON.stringify({ eventos: [evento()] }) });
    await c.esperarFundo();
  };
  c.estado.manutencao = { apagados: { eventos: 100000 }, executada: true, pendente: true };
  await enviar();
  c.estado.agora += 30_000;
  await enviar();
  assert.equal(c.de('sentinela_srv_manutencao').length, 1, 'antes de 1 min não chama de novo');
  c.estado.agora += 31_000;
  c.estado.manutencao = { apagados: { eventos: 5 }, executada: true, pendente: false };
  await enviar();
  assert.equal(c.de('sentinela_srv_manutencao').length, 2, 'pendente: continua depois de 1 min');
  c.estado.agora += 2 * 60_000;
  await enviar();
  assert.equal(c.de('sentinela_srv_manutencao').length, 2, 'em dia: volta a 1x a cada 30 min');
});

test('precisaAtualizarTor', () => {
  const agora = Date.parse('2026-10-05T15:00:00Z');
  assert.equal(precisaAtualizarTor({ tor_atualizado_em: null }, agora), true);
  assert.equal(precisaAtualizarTor({ tor_atualizado_em: '2026-10-04T14:00:00Z' }, agora), true);
  assert.equal(precisaAtualizarTor({ tor_atualizado_em: '2026-10-05T10:00:00Z', apagados: {} }, agora), false);
  assert.equal(precisaAtualizarTor({ apagados: { eventos: 3 } }, agora), true);
  assert.equal(precisaAtualizarTor({ apagados: {}, executada: false }, agora), false);
  assert.equal(precisaAtualizarTor({ ok: true }, agora), false);
  assert.equal(precisaAtualizarTor(null, agora), false);
});

test('passe → sessão: emissão, uso único, audiência e validade', async () => {
  const c = montar();
  const cab = nav({ authorization: 'Bearer usuario-ok', 'cf-connecting-ip': '177.10.20.30', 'user-agent': 'Mozilla/5.0 Teste' });
  const r = await c.chamar('passe', { method: 'POST', headers: cab, body: JSON.stringify({ sistema_slug: 'gestao-financeiro', destino: 'https://gestao-finaceiro.vercel.app/folha?m=9' }) });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('access-control-allow-origin'), PORTAL);
  const j = await r.json();
  assert.equal(j.ok, true);
  const url = new URL(j.url);
  assert.equal(url.origin, 'https://gestao-finaceiro.vercel.app');
  assert.equal(url.pathname, '/folha');
  const passe = url.searchParams.get('sentinela_passe')!;
  const agoraS = Math.floor(c.estado.agora / 1000);
  assert.equal(j.exp, new Date((agoraS + 90) * 1000).toISOString());

  const chaves = [c.estado.chave!.publica];
  const v = await verificarJwt(passe, chaves, { iss: 'sentinela-lube', aud: 'gestao-finaceiro', typ: 'passe', agora: agoraS });
  assert.ok(v.ok);
  const p = v.ok ? v.payload : {};
  assert.equal(p.sub, USUARIO);
  assert.equal(p.email, 'julio@lube.com.br');
  assert.equal(p.nome, 'Júlio');
  assert.equal(p.sis, 'gestao-financeiro');
  assert.equal((p.exp as number) - (p.iat as number), 90);
  assert.match(String(p.jti), /^[0-9a-f-]{36}$/);

  await c.esperarFundo();
  const ident = c.de('sentinela_srv_identidade')[0].params;
  assert.deepEqual(ident, { p_ip: '177.10.20.30', p_user_id: USUARIO, p_email: 'julio@lube.com.br', p_origem: 'portal', p_ua: 'Mozilla/5.0 Teste' });

  // guarda do sistema troca o passe pela sessão
  const s = await c.chamar('sessao', { method: 'POST', headers: guarda('oidc.fin.ok'), body: JSON.stringify({ passe }) });
  assert.equal(s.status, 200);
  assert.equal(s.headers.get('access-control-allow-origin'), null);
  const sj = await s.json();
  assert.equal(sj.ok, true);
  assert.equal(sj.email, 'julio@lube.com.br');
  assert.equal(sj.exp, new Date((agoraS + 28800) * 1000).toISOString());
  const vs = await verificarJwt(sj.sessao, chaves, { iss: 'sentinela-lube', aud: 'gestao-finaceiro', typ: 'sessao', agora: agoraS });
  assert.ok(vs.ok);
  assert.equal(vs.ok && (vs.payload.exp as number) - (vs.payload.iat as number), 28800);
  assert.equal(vs.ok && vs.payload.sis, 'gestao-financeiro');
  assert.deepEqual(c.de('sentinela_srv_passe_usar')[0].params, { p_jti: p.jti, p_projeto: 'gestao-finaceiro', p_email: 'julio@lube.com.br' });

  // uso único
  const de2 = await c.chamar('sessao', { method: 'POST', headers: guarda('oidc.fin.ok'), body: JSON.stringify({ passe }) });
  assert.equal(de2.status, 401);
  assert.deepEqual(await de2.json(), { erro: 'passe_invalido', detalhe: 'ja_usado' });

  // outro sistema não aceita (aud)
  const outro = await c.chamar('sessao', { method: 'POST', headers: guarda('oidc.compras.ok'), body: JSON.stringify({ passe }) });
  assert.equal(outro.status, 401);
  assert.equal((await outro.json()).detalhe, 'aud');

  // a sessão não serve como passe
  const comoPasse = await c.chamar('sessao', { method: 'POST', headers: guarda('oidc.fin.ok'), body: JSON.stringify({ passe: sj.sessao }) });
  assert.equal((await comoPasse.json()).detalhe, 'typ');

  // passe vencido (91 s depois)
  const r2 = await c.chamar('passe', { method: 'POST', headers: cab, body: JSON.stringify({ sistema_slug: 'gestao-financeiro' }) });
  const passe2 = new URL((await r2.json()).url).searchParams.get('sentinela_passe');
  c.estado.agora += 91_000;
  const venc = await c.chamar('sessao', { method: 'POST', headers: guarda('oidc.fin.ok'), body: JSON.stringify({ passe: passe2 }) });
  assert.equal(venc.status, 401);
  assert.equal((await venc.json()).detalhe, 'expirado');

  // sessão sem guarda autenticado
  assert.equal((await c.chamar('sessao', { method: 'POST', body: JSON.stringify({ passe: passe2 }) })).status, 401);
});

test('POST /passe: permissão, destino de outra origem, token e CORS', async () => {
  const c = montar();
  const cab = (token: string, origem = PORTAL) => nav({ authorization: `Bearer ${token}`, origin: origem, 'x-real-ip': '177.10.20.30' });

  const negado = await c.chamar('passe', { method: 'POST', headers: cab('usuario-ok'), body: JSON.stringify({ sistema_slug: 'gestao-ti' }) });
  assert.equal(negado.status, 403);
  assert.deepEqual(await negado.json(), { erro: 'sem_permissao', detalhe: 'sem permissão para este sistema' });
  assert.equal(negado.headers.get('access-control-allow-origin'), PORTAL, 'erro também leva CORS para o portal ler');

  const fora = await c.chamar('passe', { method: 'POST', headers: cab('usuario-ok'), body: JSON.stringify({ sistema_slug: 'gestao-financeiro', destino: 'https://evil.com/roubar' }) });
  const u = new URL((await fora.json()).url);
  assert.equal(u.origin, 'https://gestao-finaceiro.vercel.app');
  assert.equal(u.pathname, '/');

  assert.equal((await c.chamar('passe', { method: 'POST', headers: cab('lixo'), body: '{"sistema_slug":"gestao-financeiro"}' })).status, 401);
  assert.equal((await c.chamar('passe', { method: 'POST', headers: cab('usuario-anonimo'), body: '{"sistema_slug":"gestao-financeiro"}' })).status, 401);
  assert.equal((await c.chamar('passe', { method: 'POST', headers: nav(), body: '{"sistema_slug":"gestao-financeiro"}' })).status, 401);
  assert.equal((await c.chamar('passe', { method: 'POST', headers: cab('usuario-ok'), body: '{"sistema_slug":"../etc"}' })).status, 400);
  assert.equal((await c.chamar('passe', { method: 'POST', headers: cab('usuario-ok'), body: '{"sistema_slug":"sem-sentinela"}' })).status, 404);
  const outro = await c.chamar('passe', { method: 'POST', headers: cab('usuario-outro'), body: '{"sistema_slug":"gestao-financeiro"}' });
  assert.equal(outro.status, 403);

  const nPerm = c.de('sentinela_srv_permissao').length;
  const evil = await c.chamar('passe', { method: 'POST', headers: cab('usuario-ok', 'https://evil.com'), body: JSON.stringify({ sistema_slug: 'gestao-financeiro' }) });
  assert.equal(evil.status, 403);
  assert.deepEqual(await evil.json(), { erro: 'origem_nao_permitida' });
  assert.equal(evil.headers.get('access-control-allow-origin'), null, 'origem fora da lista não recebe CORS');
  assert.equal(c.de('sentinela_srv_permissao').length, nPerm, 'origem recusada não chega ao banco');

  // preflight
  const pre = await c.chamar('passe', { method: 'OPTIONS', headers: { origin: PORTAL, 'access-control-request-method': 'POST' } });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), PORTAL);
  assert.match(pre.headers.get('access-control-allow-headers') ?? '', /authorization/);
  const preEvil = await c.chamar('passe', { method: 'OPTIONS', headers: { origin: 'https://evil.com' } });
  assert.equal(preEvil.headers.get('access-control-allow-origin'), null);
  const preGuarda = await c.chamar('lista', { method: 'OPTIONS', headers: { origin: PORTAL } });
  assert.equal(preGuarda.status, 405);
  assert.equal(preGuarda.headers.get('access-control-allow-origin'), null);
});

test('POST /identidade e /tentativa', async () => {
  const c = montar();
  const sem = await c.chamar('identidade', { method: 'POST', headers: nav({ 'cf-connecting-ip': '177.1.1.1' }), body: '{}' });
  assert.equal(sem.status, 401);
  assert.equal(sem.headers.get('access-control-allow-origin'), PORTAL);
  const ok = await c.chamar('identidade', { method: 'POST', headers: nav({ authorization: 'Bearer usuario-ok', 'cf-connecting-ip': '177.1.1.1', 'user-agent': 'UA' }), body: '{}' });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { ok: true });
  assert.deepEqual(c.de('sentinela_srv_identidade')[0].params, { p_ip: '177.1.1.1', p_user_id: USUARIO, p_email: 'julio@lube.com.br', p_origem: 'portal', p_ua: 'UA' });

  const t = await c.chamar('tentativa', { method: 'POST', headers: nav({ 'cf-connecting-ip': '8.8.4.4', 'user-agent': 'UA' }), body: JSON.stringify({ usuario: '  JULIO.Alves  ' }) });
  assert.equal(t.status, 200);
  assert.deepEqual(await t.json(), { ok: true, bloqueado: false });
  assert.deepEqual(c.de('sentinela_srv_tentativa')[0].params, { p_ip: '8.8.4.4', p_usuario: 'julio.alves', p_ua: 'UA' });
  // atribui ao IP real: o corpo não escolhe IP
  await c.chamar('tentativa', { method: 'POST', headers: nav({ 'cf-connecting-ip': '8.8.4.4' }), body: JSON.stringify({ usuario: 'x', ip: '1.2.3.4', p_ip: '1.2.3.4' }) });
  assert.equal(c.de('sentinela_srv_tentativa')[1].params.p_ip, '8.8.4.4');
  assert.equal((await c.chamar('tentativa', { method: 'POST', headers: nav(), body: '{"usuario":"x"}' })).status, 400, 'sem IP do cliente');
  // limitador: 20 por minuto por IP
  let ultimo = 0;
  for (let i = 0; i < 25; i++) {
    ultimo = (await c.chamar('tentativa', { method: 'POST', headers: nav({ 'cf-connecting-ip': '9.9.9.9' }), body: '{"usuario":"a"}' })).status;
  }
  assert.equal(ultimo, 429);
});

// ---------------------------------------------------------
// Achados da revisão (um teste por achado)
// ---------------------------------------------------------
const enviarEvento = (c: ReturnType<typeof montar>, token = 'oidc.compras.ok') =>
  c.chamar('evento', { method: 'POST', headers: guarda(token), body: JSON.stringify({ eventos: [evento()] }) });

test('CSRF: POST do navegador só da origem do portal e só JSON (outro site não cria bloqueio contra a vítima)', async () => {
  const c = montar();
  const vitima = { 'cf-connecting-ip': '177.50.60.70' };
  // o que outro site manda pelo navegador da vítima sem preflight (mode no-cors, text/plain)
  for (let i = 0; i < 5; i++) {
    const r = await c.chamar('tentativa', { method: 'POST', headers: { ...vitima, origin: 'https://evil.example', 'content-type': 'text/plain;charset=UTF-8' }, body: '{"usuario":"x"}' });
    assert.equal(r.status, 403);
    assert.deepEqual(await r.json(), { erro: 'origem_nao_permitida' });
    assert.equal(r.headers.get('access-control-allow-origin'), null);
  }
  // sem Origin, Origin "null" (iframe sandbox, data:) ou parecida
  for (const o of [null, 'null', 'https://painel-lube-distribuidora.vercel.app.evil.com', 'http://painel-lube-distribuidora.vercel.app']) {
    const h: Record<string, string> = { ...vitima, 'content-type': 'application/json' };
    if (o) h.origin = o;
    assert.equal((await c.chamar('tentativa', { method: 'POST', headers: h, body: '{"usuario":"x"}' })).status, 403, String(o));
  }
  // origem certa mas corpo de formulário / texto (também não teria preflight)
  for (const ct of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', '']) {
    const h: Record<string, string> = { ...vitima, origin: PORTAL };
    if (ct) h['content-type'] = ct;
    const r = await c.chamar('tentativa', { method: 'POST', headers: h, body: '{"usuario":"x"}' });
    assert.equal(r.status, 400, ct);
    assert.equal((await r.json()).erro, 'content_type_invalido');
  }
  assert.equal(c.de('sentinela_srv_tentativa').length, 0, 'nada chegou ao banco');
  // /identidade também
  const id = await c.chamar('identidade', { method: 'POST', headers: { ...vitima, origin: 'https://evil.example', 'content-type': 'application/json', authorization: 'Bearer usuario-ok' }, body: '{}' });
  assert.equal(id.status, 403);
  assert.equal(c.de('sentinela_srv_identidade').length + c.de('sentinela_srv_permissao').length, 0);
  // o portal de verdade continua funcionando (charset no content-type vale) e o preflight responde
  const ok = await c.chamar('tentativa', { method: 'POST', headers: { ...vitima, origin: PORTAL, 'content-type': 'application/json; charset=utf-8' }, body: '{"usuario":"x"}' });
  assert.equal(ok.status, 200);
  assert.equal(c.de('sentinela_srv_tentativa').length, 1);
  assert.equal((await c.chamar('tentativa', { method: 'OPTIONS', headers: { origin: PORTAL } })).status, 204);
});

test('/identidade: conta sem perfil ativo (cadastro pendente, inexistente) não grava identidade', async () => {
  const c = montar();
  const h = (token: string) => nav({ authorization: `Bearer ${token}`, 'cf-connecting-ip': '45.1.2.3' });
  const p = await c.chamar('identidade', { method: 'POST', headers: h('usuario-pendente'), body: '{}' });
  assert.equal(p.status, 403);
  assert.deepEqual(await p.json(), { erro: 'perfil_inativo' });
  assert.equal(p.headers.get('access-control-allow-origin'), PORTAL);
  assert.equal((await c.chamar('identidade', { method: 'POST', headers: h('usuario-outro'), body: '{}' })).status, 403);
  assert.equal(c.de('sentinela_srv_identidade').length, 0, 'nada gravado');
  assert.deepEqual(c.de('sentinela_srv_permissao').map((x) => x.params), [
    { p_user_id: PENDENTE, p_sistema_slug: null },
    { p_user_id: '00000000-0000-4000-8000-000000000000', p_sistema_slug: null },
  ]);
  // perfil ativo grava (e-mail do perfil)
  assert.equal((await c.chamar('identidade', { method: 'POST', headers: h('usuario-ok'), body: '{}' })).status, 200);
  assert.equal(c.de('sentinela_srv_identidade')[0].params.p_email, 'julio@lube.com.br');
  // se o banco também recusar (ok:false), a central responde 403
  c.estado.respostaIdentidade = { ok: false, motivo: 'perfil_inativo' };
  const b = await c.chamar('identidade', { method: 'POST', headers: h('usuario-ok'), body: '{}' });
  assert.equal(b.status, 403);
  assert.equal((await b.json()).erro, 'perfil_inativo');
});

test('/passe de conta inativa: 403 e nenhuma identidade gravada', async () => {
  const c = montar();
  const r = await c.chamar('passe', { method: 'POST', headers: nav({ authorization: 'Bearer usuario-pendente', 'cf-connecting-ip': '45.1.2.4' }),
    body: JSON.stringify({ sistema_slug: 'gestao-financeiro' }) });
  assert.equal(r.status, 403);
  assert.deepEqual(await r.json(), { erro: 'sem_permissao', detalhe: 'perfil_inativo' });
  await c.esperarFundo();
  assert.equal(c.de('sentinela_srv_identidade').length, 0);
  assert.equal(c.de('sentinela_srv_chave_ativa').length + c.de('sentinela_srv_chave_criar').length, 0, 'nem assina passe');
});

test('/passe: sem guarda ativo no sistema (ultimo_sinal nulo) devolve a URL sem passe', async () => {
  const c = montar();
  const cab = nav({ authorization: 'Bearer usuario-ok', 'cf-connecting-ip': '177.10.20.31', 'user-agent': 'UA' });
  const pedir = (corpo: unknown) => c.chamar('passe', { method: 'POST', headers: cab, body: JSON.stringify(corpo) });

  for (const valor of [false, undefined, null, 'true', 1]) {   // só true (booleano) liga o passe
    c.estado.guardaAtivo = valor;
    const r = await pedir({ sistema_slug: 'gestao-financeiro', destino: 'https://gestao-finaceiro.vercel.app/folha?m=9&sentinela_passe=velho' });
    assert.equal(r.status, 200, String(valor));
    assert.equal(r.headers.get('access-control-allow-origin'), PORTAL);
    const j = await r.json();
    assert.deepEqual(j, { ok: true, url: 'https://gestao-finaceiro.vercel.app/folha?m=9', guarda_ativo: false }, String(valor));
  }
  // destino de outra origem continua caindo na URL do sistema
  const fora = await (await pedir({ sistema_slug: 'gestao-financeiro', destino: 'https://evil.com/x' })).json();
  assert.equal(fora.url, 'https://gestao-finaceiro.vercel.app/');
  assert.equal(c.de('sentinela_srv_chave_ativa').length + c.de('sentinela_srv_chave_criar').length, 0, 'sem guarda não assina passe');
  await c.esperarFundo();
  assert.equal(c.de('sentinela_srv_identidade').length, 6, 'o login no portal continua registrado');

  // guarda ativo: volta o passe
  c.estado.guardaAtivo = true;
  const j = await (await pedir({ sistema_slug: 'gestao-financeiro' })).json();
  assert.ok(new URL(j.url).searchParams.get('sentinela_passe'));
  assert.ok(j.exp);
  assert.equal(j.guarda_ativo, undefined);
});

test('IA: lotes simultâneos não estouram a cota nem passam de 3 chamadas em voo', async () => {
  const c = montar({ chaveIa: CHAVE_IA });
  c.estado.cota = 5;
  let n = 0;
  c.estado.proximoAnalisar = () => [`45.9.30.${n++}`]; // cada lote traz um IP novo
  let emVoo = 0, pico = 0;
  const base = c.estado.respostaIA;
  c.estado.respostaIA = async (b, init) => {
    emVoo++;
    pico = Math.max(pico, emVoo);
    await new Promise((r) => setTimeout(r, 15));
    emVoo--;
    return base(b, init);
  };
  const ia = () => c.fetches.filter((f) => f.url === URL_ANTHROPIC).length;
  await Promise.all(Array.from({ length: 40 }, () => enviarEvento(c)));
  await c.esperarFundo();
  assert.ok(pico <= 3, `pico em voo ${pico}`);
  assert.ok(ia() <= 3, `chamadas ${ia()}`);
  // depois, um lote por vez: a cota da hora segura o total
  for (let i = 0; i < 10; i++) { await enviarEvento(c); await c.esperarFundo(); }
  assert.equal(ia(), 5);
});

test('limitador: IPv6 conta pelo /64 e o /tentativa tem teto por instância', async () => {
  const c = montar();
  const tentar = (ip: string) => c.chamar('tentativa', { method: 'POST', headers: nav({ 'cf-connecting-ip': ip }), body: '{"usuario":"a"}' });
  let ok = 0;
  for (let i = 0; i < 200; i++) if ((await tentar(`2804:14c:1:2::${i.toString(16)}`)).status === 200) ok++;
  assert.equal(ok, 20, 'o /64 inteiro divide os 20 por minuto');
  assert.equal((await tentar('2804:14c:1:3::1')).status, 200, 'outro /64 tem a sua cota');

  const g = montar();
  const st: number[] = [];
  for (let i = 0; i <= MAX_TENTATIVAS_MIN; i++) {
    st.push((await g.chamar('tentativa', { method: 'POST', headers: nav({ 'cf-connecting-ip': `10.${i >> 8}.${i & 255}.1` }), body: '{"usuario":"a"}' })).status);
  }
  assert.equal(st.filter((s) => s === 200).length, MAX_TENTATIVAS_MIN);
  assert.equal(st.at(-1), 429);
  assert.equal(g.de('sentinela_srv_tentativa').length, MAX_TENTATIVAS_MIN);
});

test('chave: Vault fora não derruba a /lista nem queima o passe', async () => {
  const c = montar();
  const h = guarda('oidc.fin.ok');
  const passeDe = async (central = c.chamar) => {
    const r = await central('passe', { method: 'POST', headers: nav({ authorization: 'Bearer usuario-ok', 'cf-connecting-ip': '177.10.20.30' }), body: JSON.stringify({ sistema_slug: 'gestao-financeiro' }) });
    assert.equal(r.status, 200);
    return new URL((await r.json()).url).searchParams.get('sentinela_passe');
  };
  assert.equal((await c.chamar('lista', { headers: h })).status, 200); // carrega a chave

  // 11 min depois a recarga falha: segue com a chave em memória
  c.estado.agora += 11 * 60_000;
  c.estado.falharChaveAtiva = true;
  const l = await c.chamar('lista', { headers: h });
  assert.equal(l.status, 200);
  assert.equal((await l.json()).chaves.length, 1);
  assert.ok(c.logs.includes('chave: recarga falhou, seguindo com a chave em memória'));
  const s = await c.chamar('sessao', { method: 'POST', headers: h, body: JSON.stringify({ passe: await passeDe() }) });
  assert.equal(s.status, 200);

  // instância fria com o Vault fora: a lista sai com as públicas (o guarda não fica sem lista)
  const fria = c.outraInstancia();
  const lf = await fria('lista', { headers: h });
  assert.equal(lf.status, 200);
  assert.equal((await lf.json()).chaves.length, 1);
  assert.equal(c.de('sentinela_srv_chave_criar').length, 1, 'falha de leitura não cria outra chave');
  // e a sessão dá 500 SEM queimar o passe; com o Vault de volta o mesmo passe vale
  const passe = await passeDe();
  const usados = c.de('sentinela_srv_passe_usar').length;
  assert.equal((await fria('sessao', { method: 'POST', headers: h, body: JSON.stringify({ passe }) })).status, 500);
  assert.equal(c.de('sentinela_srv_passe_usar').length, usados, 'jti não foi gravado');
  c.estado.falharChaveAtiva = false;
  assert.equal((await fria('sessao', { method: 'POST', headers: h, body: JSON.stringify({ passe }) })).status, 200);
});

test('guarda: OIDC de development (vercel env pull / project token) não vale', async () => {
  const c = montar();
  for (const t of ['oidc.compras.dev', 'oidc.compras.semamb']) {
    assert.equal((await c.chamar('lista', { headers: guarda(t) })).status, 401, t);
    assert.equal((await enviarEvento(c, t)).status, 401, t);
    assert.equal((await c.chamar('sessao', { method: 'POST', headers: guarda(t), body: '{"passe":"x"}' })).status, 401, t);
  }
  assert.equal(c.de('sentinela_srv_registrar').length, 0);
  assert.equal(c.logs.filter((x) => x.includes('ambiente "development" recusado')).length, 1, 'avisa uma vez');
  assert.equal((await c.chamar('lista', { headers: guarda('oidc.fin.ok') })).status, 200, 'preview vale');
});

test('Tor: decide pelo tor_atualizado_em do banco (§3), não só pela manutenção', async () => {
  const baixadas = (c: ReturnType<typeof montar>) => c.fetches.filter((f) => f.url === URL_TOR).length;
  const torBoa = montar().estado.respostaTor;

  // nunca atualizada e a manutenção já rodou hoje (executada:false) → baixa assim mesmo
  const a = montar();
  a.estado.torAtualizadoEm = null;
  a.estado.manutencao = { apagados: {}, executada: false };
  await enviarEvento(a); await a.esperarFundo();
  assert.equal(baixadas(a), 1);
  assert.equal(a.de('sentinela_srv_tor_atualizar').length, 1);

  // atualizada há 2 h → não baixa, mesmo com a manutenção rodando de verdade
  const b = montar();
  b.estado.torAtualizadoEm = '2026-10-05T13:00:00Z';
  await enviarEvento(b); await b.esperarFundo();
  assert.equal(baixadas(b), 0);

  // velha (25 h) → baixa; falhou (503) → nova tentativa só 1 h depois
  const f = montar();
  f.estado.torAtualizadoEm = '2026-10-04T14:00:00Z';
  f.estado.manutencao = { apagados: {}, executada: false };
  f.estado.respostaTor = () => new Response('fora', { status: 503 });
  await enviarEvento(f); await f.esperarFundo();
  assert.equal(baixadas(f), 1);
  assert.ok(f.logs.includes('tor falhou'));
  f.estado.agora += 30 * 60_000;
  await enviarEvento(f); await f.esperarFundo();
  assert.equal(baixadas(f), 1, 'trava de 1 h depois da falha');
  f.estado.agora += 31 * 60_000;
  f.estado.respostaTor = torBoa;
  await enviarEvento(f); await f.esperarFundo();
  assert.equal(baixadas(f), 2);
  assert.equal(f.de('sentinela_srv_tor_atualizar').length, 1);
  // atualizou: o banco passa a dizer "agora" e não baixa de novo
  f.estado.agora += 7 * 3600_000;
  await enviarEvento(f); await f.esperarFundo();
  assert.equal(baixadas(f), 2);
});

test('/lista fria: um srv_lista só (reaproveita o da autenticação)', async () => {
  const c = montar();
  assert.equal((await c.chamar('lista', { headers: guarda('oidc.compras.ok') })).status, 200);
  assert.equal(c.de('sentinela_srv_lista').length, 1);
  // cache de sistema quente: a lista é relida (dados frescos para o guarda), sem dobrar
  assert.equal((await c.chamar('lista', { headers: guarda('oidc.compras.ok') })).status, 200);
  assert.equal(c.de('sentinela_srv_lista').length, 2);
});

test('HMAC: SENTINELA_CHAVE curta é recusada e avisada no log, uma vez, sem a chave', async () => {
  const curta = 'lube-sentinela-2026-segredo'; // 27 caracteres
  const c = montar({ chaveHmac: curta });
  const t = Math.floor(c.estado.agora / 1000);
  const sig = await assinarHmac(curta, t, new Uint8Array(0));
  for (let i = 0; i < 3; i++) {
    const r = await c.chamar('lista', { headers: { 'x-sentinela-assinatura': `t=${t},v1=${sig}`, 'x-sentinela-projeto': 'painel-compras' } });
    assert.equal(r.status, 401);
  }
  assert.equal(c.logs.filter((x) => x.startsWith('SENTINELA_CHAVE curta demais')).length, 1);
  assert.ok(!c.logs.some((x) => x.includes(curta)), 'nunca loga a chave');
});

test('guarda: project_id de sentinela.sistemas vale mais que o mapa fixo', async () => {
  // banco de hoje (srv_lista sem projeto_id): vale o mapa fixo do §0
  const c = montar();
  assert.equal((await c.chamar('lista', { headers: guarda('oidc.icms.velho') })).status, 200);
  assert.equal((await c.chamar('lista', { headers: guarda('oidc.icms.novo') })).status, 401);
  // projeto recriado na Vercel e atualizado no banco: vale o do banco, o velho não
  const n = montar();
  n.estado.projetoIdBanco['painel-icms'] = 'prj_icmsRecriado';
  assert.equal((await n.chamar('lista', { headers: guarda('oidc.icms.novo') })).status, 200);
  assert.equal((await n.chamar('lista', { headers: guarda('oidc.icms.velho') })).status, 401);
});

test('IA: status reflete a última troca entre instâncias e é regravado quando falha', async () => {
  const c = montar({ chaveIa: CHAVE_IA });
  const a = c.outraInstancia(); // instância A, mesmo banco; c.chamar é a B
  let n = 0;
  c.estado.proximoAnalisar = () => [`45.9.40.${n++}`];
  const lote = (f: typeof c.chamar) => f('evento', { method: 'POST', headers: guarda('oidc.compras.ok'), body: JSON.stringify({ eventos: [evento()] }) });
  const ok = c.estado.respostaIA;
  await lote(c.chamar); await c.esperarFundo(); // B: ligada
  c.estado.respostaIA = () => new Response(JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }), { status: 529 });
  c.estado.agora += 60_000;
  await lote(a); await c.esperarFundo(); // A: erro
  c.estado.respostaIA = ok;
  c.estado.agora += 60_000;
  await lote(c.chamar); await c.esperarFundo(); // B de novo: ligada (antes ficava filtrado 5 min)
  assert.deepEqual(c.de('sentinela_srv_ia_status').map((x) => x.params.p_status), ['ligada', 'erro', 'ligada']);

  // gravação do status falhou: tenta de novo no lote seguinte; depois disso, sem_chave 1x a cada 5 min
  const s = montar();
  s.estado.analisar = ['45.9.20.1'];
  s.estado.falharIaStatus = true;
  await enviarEvento(s); await s.esperarFundo();
  assert.ok(s.logs.includes('ia falhou'));
  s.estado.falharIaStatus = false;
  await enviarEvento(s); await s.esperarFundo();
  await enviarEvento(s); await s.esperarFundo();
  assert.equal(s.de('sentinela_srv_ia_status').length, 2);
  s.estado.agora += 5 * 60_000;
  await enviarEvento(s); await s.esperarFundo();
  assert.equal(s.de('sentinela_srv_ia_status').length, 3);
});
