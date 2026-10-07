// =========================================================
// SENTINELA — a Central (§3). Todas as rotas, sem depender do Deno:
// banco, verificação de OIDC/token e fetch entram por `Dependencias`
// (o index.ts liga as de verdade; os testes ligam falsas).
// O banco só é chamado pelas funções public.sentinela_srv_*.
// =========================================================
import { ambienteValido, emailValido, ipValido, lerListaTor, rotulo, sanearLote, texto, usuarioTentativa } from './saneamento.ts';
import { assinarJwt, gerarChave, importarPrivada, jwkPublicaValida, verificarJwt } from './jwt.ts';
import type { JwkPublica, Payload } from './jwt.ts';
import { TAMANHO_MIN_CHAVE, verificarHmac } from './hmac.ts';
import { descreverErroHttp, explicarConferencia, lerRespostaIA, montarCorpoIA, MODELO, TEMPO_IA_MS, URL_ANTHROPIC, URL_MODELO, VERSAO_ANTHROPIC } from './ia.ts';
import {
  bearer, cabecalhosCors, chaveLimite, criarLimitador, ehJson, erro, ipCliente, json, lerCorpoLimitado, lerJson,
  montarUrlPasse, origemPermitida, RE_SLUG, RE_UUID, rotaDe, ROTAS,
} from './http.ts';

export const VERSAO = '1.0.0';
export const EMISSOR = 'sentinela-lube';
export const TEAM_ID = 'team_k8YNfCDhgFwOScWnM5iHGqLC';
export const PASSE_S = 90;
export const SESSAO_S = 8 * 3600;
export const URL_TOR = 'https://check.torproject.org/torbulkexitlist';

const MIN = 60_000;
const HORA = 60 * MIN;
const MAX_IA_LOTE = 3;
/** de quanto em quanto tempo cada instância confere a chave da IA */
export const CONFERIR_IA_MS = 5 * MIN;
/** chamadas à Anthropic em voo ao mesmo tempo nesta instância */
export const MAX_IA_SIMULTANEAS = 3;
/** teto de POST /tentativa por instância, somando todos os IPs */
export const MAX_TENTATIVAS_MIN = 300;

/**
 * Ambientes da Vercel aceitos no OIDC. Os guardas rodam em production e
 * preview; token "development" sai de `vercel env pull`/`vercel project token`
 * sem deploy nenhum, então não vale como guarda.
 */
export const AMBIENTES_OIDC = new Set(['production', 'preview']);

/** Motivos do srv_permissao que dizem que a conta não tem perfil ativo. */
const PERFIL_SEM_ACESSO = new Set(['perfil_inexistente', 'perfil_inativo']);

/** Projetos do §0 (claim `project` → `project_id`): conferência extra do OIDC. */
export const PROJETOS = new Map<string, string>([
  ['painel-lube-distribuidora', 'prj_WGmlGvONBuausosdw6AgnDhrCnge'],
  ['painel-compras', 'prj_DcJI82KyPyvSc4eUMuL9iJV6I7cp'],
  ['gestao-comercial-web', 'prj_YZjoZIiVcDyuWVzNVXMuApfiDGYt'],
  ['gestao-finaceiro', 'prj_1TWb4V3Cl1m9CbOwhoXuw8fdzHwR'],
  ['gestao-ti', 'prj_sxnusj4EGtvYF30N5VxoyBbleW83'],
  ['rh-absentismo', 'prj_DVpjRACXDvWA5e3x87ettwPn1sJL'],
  ['gestao-de-saidas-de-veiculos', 'prj_ObANJiC1HKBSzrUPQdU79V4VEnLR'],
  ['painel-icms', 'prj_5h9PoHWB6qCeoEhUNzQ4RVxnGrbn'],
]);

export type Rpc = (nome: string, params?: Record<string, unknown>) => Promise<unknown>;

export interface Dependencias {
  /** chama public.<nome> com a service role; erro do banco → exceção */
  rpc: Rpc;
  /** OIDC da Vercel: assinatura (JWKS remoto), iss e aud. Inválido → exceção. */
  verificarOidcVercel(token: string): Promise<Payload>;
  /** access token do Supabase Auth (ES256, iss, aud). Inválido → exceção. */
  verificarTokenUsuario(token: string): Promise<Payload>;
  chaveHmac(): string | undefined;
  chaveAnthropic(): string | undefined;
  fetch: typeof fetch;
  /** trabalho depois da resposta (EdgeRuntime.waitUntil) */
  depois(p: Promise<unknown>): void;
  agora?(): number;
  log?(msg: string, e?: unknown): void;
  tempoIaMs?: number;
}

type Obj = Record<string, unknown>;
interface Guarda {
  projeto: string;
  ambiente: string;
  via: 'oidc' | 'hmac';
  /** srv_lista que a autenticação acabou de buscar (a /lista reaproveita) */
  lista?: unknown;
}
interface InfoSistema { conhecido: boolean; projetoId: string | null; ate: number }

const ehObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const iso = (seg: number) => new Date(seg * 1000).toISOString();

/** Só os campos públicos da JWK (nunca deixa passar um "d" por engano). */
export function publicaLimpa(j: JwkPublica): JwkPublica {
  return { kty: 'EC', crv: 'P-256', x: j.x, y: j.y, kid: j.kid, alg: 'ES256', use: 'sig' };
}

/**
 * Plano B para decidir a Tor quando o banco não informa tor_atualizado_em
 * no srv_lista: campo tor_atualizado_em (se vier) com mais de 24 h, ou a
 * manutenção diária acabou de rodar de verdade (veio "apagados").
 */
export function precisaAtualizarTor(r: unknown, agoraMs: number): boolean {
  if (!ehObj(r)) return false;
  if ('tor_atualizado_em' in r) {
    if (r.tor_atualizado_em == null) return true;
    const t = Date.parse(String(r.tor_atualizado_em));
    return !Number.isFinite(t) || agoraMs - t > 24 * HORA;
  }
  if (r.executada === false || r.pulado === true || r.ignorado === true) return false;
  return ehObj(r.apagados);
}

export function criarCentral(d: Dependencias): (req: Request) => Promise<Response> {
  const agora = () => (d.agora ? d.agora() : Date.now());
  const agoraS = () => Math.floor(agora() / 1000);
  const log = (msg: string, e?: unknown) => {
    if (d.log) return d.log(msg, e);
    console.error(`[sentinela] ${msg}`, e instanceof Error ? e.message : (e ?? ''));
  };
  const tempoIa = d.tempoIaMs ?? TEMPO_IA_MS;
  // aviso de configuração: uma vez por instância (sem repetir a cada requisição)
  const avisados = new Set<string>();
  const avisarUmaVez = (k: string, msg: string) => {
    if (avisados.has(k) || avisados.size > 50) return;
    avisados.add(k);
    log(msg);
  };

  // chave do limitador: IPv4 inteiro, IPv6 pelo /64
  const limPasse = criarLimitador(60, MIN);
  const limIdentidade = criarLimitador(30, MIN);
  const limTentativa = criarLimitador(20, MIN);
  const limTentativaTodas = criarLimitador(MAX_TENTATIVAS_MIN, MIN, 1);

  // ---------- sistemas conhecidos (cache 5 min) ----------
  const sistemas = new Map<string, InfoSistema>();
  function guardarSistema(projeto: string, lista: unknown): InfoSistema {
    anotarTor(lista);
    const s = ehObj(lista) && ehObj(lista.sistema) ? lista.sistema : null;
    const info = {
      conhecido: !!s,
      projetoId: s && typeof s.projeto_id === 'string' && s.projeto_id ? s.projeto_id : null,
      ate: agora() + 5 * MIN,
    };
    if (sistemas.size > 200) sistemas.clear();
    sistemas.set(projeto, info);
    return info;
  }
  /** Do cache; ou busca srv_lista e devolve também a lista recém-lida. */
  async function sistemaDoProjeto(projeto: string): Promise<{ info: InfoSistema; lista?: unknown }> {
    const c = sistemas.get(projeto);
    if (c && c.ate > agora()) return { info: c };
    const lista = await d.rpc('sentinela_srv_lista', { p_projeto: projeto });
    return { info: guardarSistema(projeto, lista), lista };
  }

  // ---------- autenticação do guarda (§3.2) ----------
  async function autenticarGuarda(req: Request, corpo: Uint8Array): Promise<Guarda | null> {
    const token = bearer(req.headers);
    if (token && token.split('.').length === 3) {
      let p: Payload | null = null;
      try {
        p = await d.verificarOidcVercel(token);
      } catch {
        p = null; // token inválido: ainda pode valer o HMAC
      }
      const ambiente = p && typeof p.environment === 'string' ? p.environment : '';
      if (p && p.owner_id === TEAM_ID && !AMBIENTES_OIDC.has(ambiente)) {
        avisarUmaVez(`amb|${ambiente.slice(0, 30)}`, `oidc: ambiente "${rotulo(ambiente, 30) ?? '?'}" recusado (só production e preview)`);
      } else if (p && p.owner_id === TEAM_ID) {
        const projeto = rotulo(p.project, 100);
        const projetoId = typeof p.project_id === 'string' ? p.project_id : null;
        if (projeto && projetoId) {
          const { info: s, lista } = await sistemaDoProjeto(projeto);
          // project_id de sentinela.sistemas quando o banco informa; o mapa fixo só na falta dele
          const esperado = s.projetoId ?? PROJETOS.get(projeto) ?? null;
          if (s.conhecido && (!esperado || esperado === projetoId)) {
            return { projeto, ambiente: ambienteValido(ambiente), via: 'oidc', lista };
          }
        }
      }
    }

    const chave = d.chaveHmac();
    const assinatura = req.headers.get('x-sentinela-assinatura');
    if (chave && chave.length < TAMANHO_MIN_CHAVE) {
      avisarUmaVez('hmac-curta', `SENTINELA_CHAVE curta demais (mínimo ${TAMANHO_MIN_CHAVE} caracteres): plano B HMAC desligado`);
    }
    if (chave && assinatura) {
      const r = await verificarHmac(chave, assinatura, corpo, agoraS());
      const projeto = rotulo(req.headers.get('x-sentinela-projeto'), 100);
      if (r.ok && projeto) {
        const { info, lista } = await sistemaDoProjeto(projeto);
        if (info.conhecido) {
          return { projeto, ambiente: ambienteValido(req.headers.get('x-sentinela-ambiente')), via: 'hmac', lista };
        }
      }
    }
    return null;
  }

  // ---------- usuário do portal (token do Supabase Auth) ----------
  async function usuarioDoToken(req: Request): Promise<{ sub: string; email: string | null } | null> {
    const token = bearer(req.headers);
    if (!token) return null;
    let p: Payload;
    try {
      p = await d.verificarTokenUsuario(token);
    } catch {
      return null;
    }
    if (typeof p.sub !== 'string' || !RE_UUID.test(p.sub)) return null;
    if (p.is_anonymous === true) return null;
    return { sub: p.sub.toLowerCase(), email: emailValido(p.email) };
  }

  // ---------- chave ES256 do passe/sessão ----------
  let chaveAtiva: { kid: string; privada: CryptoKey; ate: number } | null = null;
  let chaveCarregando: Promise<{ kid: string; privada: CryptoKey; ate: number }> | null = null;
  let chavesPub: { lista: JwkPublica[]; ate: number } | null = null;

  async function carregarChave() {
    let r = await d.rpc('sentinela_srv_chave_ativa');
    if (!ehObj(r) || !r.kid) {
      const nova = await gerarChave();
      // Se outra instância criou ao mesmo tempo, o banco devolve a dela.
      r = await d.rpc('sentinela_srv_chave_criar', {
        p_kid: nova.kid,
        p_publica: nova.publica,
        p_privada: JSON.stringify(nova.privada),
      });
      chavesPub = null;
    }
    if (!ehObj(r) || typeof r.kid !== 'string' || !r.privada) throw new Error('chave ativa inválida');
    const jwk = typeof r.privada === 'string' ? JSON.parse(r.privada) : r.privada;
    chaveAtiva = { kid: r.kid, privada: await importarPrivada(jwk), ate: agora() + 10 * MIN };
    return chaveAtiva;
  }
  function obterChave() {
    if (chaveAtiva && chaveAtiva.ate > agora()) return Promise.resolve(chaveAtiva);
    if (!chaveCarregando) {
      chaveCarregando = carregarChave()
        .catch((e) => {
          // Vault/banco fora por um instante: a chave em memória continua boa
          // (tenta recarregar de novo em 1 min). Sem chave em memória → erro.
          if (!chaveAtiva) throw e;
          log('chave: recarga falhou, seguindo com a chave em memória', e);
          chaveAtiva = { ...chaveAtiva, ate: agora() + MIN };
          return chaveAtiva;
        })
        .finally(() => { chaveCarregando = null; });
    }
    return chaveCarregando;
  }
  async function chavesPublicas(forcar = false): Promise<JwkPublica[]> {
    if (!forcar && chavesPub && chavesPub.ate > agora()) return chavesPub.lista;
    const r = await d.rpc('sentinela_srv_chaves_publicas');
    const lista = Array.isArray(r) ? r.filter(jwkPublicaValida).map(publicaLimpa) : [];
    chavesPub = { lista, ate: agora() + 5 * MIN };
    return lista;
  }
  /**
   * Chaves públicas para a /lista. As públicas não dependem do Vault: se a
   * chave privada não carregar, a lista sai mesmo assim (sem ela o guarda
   * frio ficaria sem lista e sem bloqueio nenhum). Só espera a chave quando
   * ainda não há pública nenhuma (primeira chave sendo criada).
   */
  async function chavesParaLista(): Promise<JwkPublica[]> {
    const temChave = obterChave().then(() => true, (e) => {
      log('chave: falha ao obter a chave ativa', e);
      return false;
    });
    const chaves = await chavesPublicas();
    if (chaves.length) return chaves;
    return (await temChave) ? chavesPublicas(true) : chaves;
  }

  // ---------- IA (§3.5) ----------
  const emAnalise = new Set<string>();
  let iaEmVoo = 0;
  let semChaveEm = 0;

  // 'ligada' e 'erro' gravam sempre (já limitados pela cota): um filtro por
  // instância esconderia a troca de status feita por outra instância.
  // 'sem_chave' se repete a cada lote: no máximo 1x a cada 5 min, contando
  // só depois de gravar de verdade.
  async function marcarStatus(status: string, detalhe: string | null) {
    if (status === 'sem_chave' && agora() - semChaveEm < 5 * MIN) return;
    await d.rpc('sentinela_srv_ia_status', { p_status: status, p_detalhe: detalhe });
    semChaveEm = status === 'sem_chave' ? agora() : 0;
  }

  // Conferência da chave. Antes o status só mudava quando aparecia um IP para
  // analisar: com a chave já cadastrada, o painel seguia mostrando "sem chave"
  // de horas atrás. A cada 5 min por instância (puxada pela /lista dos guardas)
  // confere de verdade com um GET do modelo, que não gasta token.
  let conferidaEm = 0;
  let ultimoConferido = '';
  let ultimoConferidoEm = 0;
  async function conferirChaveIA() {
    if (agora() - conferidaEm < CONFERIR_IA_MS) return;
    conferidaEm = agora();
    const chave = d.chaveAnthropic();
    if (!chave) {
      await marcarStatus('sem_chave', 'Cadastre ANTHROPIC_API_KEY em Supabase › Edge Functions › Secrets');
      return;
    }
    let r: { status: 'ligada' | 'erro'; detalhe: string } | null;
    try {
      const resp = await d.fetch(URL_MODELO, {
        method: 'GET',
        headers: { 'x-api-key': chave, 'anthropic-version': VERSAO_ANTHROPIC },
        signal: AbortSignal.timeout(10_000),
      });
      let corpo: unknown = null;
      try { corpo = JSON.parse(await resp.text()); } catch { corpo = null; }
      r = explicarConferencia(resp.status, corpo);
    } catch {
      return; // rede: fica para a próxima janela, sem mexer no status
    }
    if (!r) return;
    // o mesmo resultado não precisa ir ao banco a cada 5 min: grava se mudou ou 1x por hora
    const k = r.status + '|' + r.detalhe;
    if (k === ultimoConferido && agora() - ultimoConferidoEm < HORA) return;
    await marcarStatus(r.status, r.detalhe);
    ultimoConferido = k;
    ultimoConferidoEm = agora();
  }

  async function registrarErroIA(ip: string, msg: string) {
    await d.rpc('sentinela_srv_registrar_analise', {
      p_ip: ip,
      p_dados: { modelo: MODELO, veredito: 'erro', confianca: null, motivo: null, acao: null,
        tokens_entrada: null, tokens_saida: null, erro: msg },
    });
    await marcarStatus('erro', msg);
  }

  async function analisarIps(lista: unknown[]) {
    const chave = d.chaveAnthropic();
    if (!chave) {
      await marcarStatus('sem_chave', 'Cadastre ANTHROPIC_API_KEY em Supabase › Edge Functions › Secrets');
      return;
    }
    const ips = [...new Set(lista.map(ipValido).filter((x): x is string => !!x))].filter((ip) => !emAnalise.has(ip));
    if (!ips.length) return;

    let algumOk = false;
    for (const ip of ips.slice(0, MAX_IA_LOTE)) {
      if (iaEmVoo >= MAX_IA_SIMULTANEAS) break; // o excedente fica para um próximo lote
      // A cota do banco só conta análises já gravadas: relê antes de cada
      // chamada e desconta as que estão em voo aqui (lotes simultâneos).
      const cota = Number(await d.rpc('sentinela_srv_ia_cota'));
      if (!Number.isFinite(cota) || cota - iaEmVoo <= 0 || iaEmVoo >= MAX_IA_SIMULTANEAS) break;
      if (emAnalise.has(ip)) continue;
      iaEmVoo++;
      emAnalise.add(ip);
      try {
        const contexto = await d.rpc('sentinela_srv_contexto_ip', { p_ip: ip });
        let status = 0;
        let bruto = '';
        try {
          const resp = await d.fetch(URL_ANTHROPIC, {
            method: 'POST',
            headers: { 'x-api-key': chave, 'anthropic-version': VERSAO_ANTHROPIC, 'content-type': 'application/json' },
            body: JSON.stringify(montarCorpoIA(contexto)),
            signal: AbortSignal.timeout(tempoIa),
          });
          status = resp.status;
          bruto = await resp.text();
        } catch (e) {
          const nome = e instanceof Error ? e.name : '';
          const msg = nome === 'TimeoutError' || nome === 'AbortError'
            ? `tempo esgotado (${Math.round(tempoIa / 1000)} s)`
            : 'falha de rede ao chamar a IA';
          await registrarErroIA(ip, msg);
          break; // a IA está fora: os outros IPs ficam para o próximo lote
        }
        let dados: unknown = null;
        try { dados = JSON.parse(bruto); } catch { dados = null; }
        if (status < 200 || status >= 300) {
          await registrarErroIA(ip, descreverErroHttp(status, dados));
          break;
        }
        let v;
        try {
          v = lerRespostaIA(dados);
        } catch (e) {
          await registrarErroIA(ip, e instanceof Error ? e.message : 'resposta da IA ilegível');
          continue;
        }
        await d.rpc('sentinela_srv_registrar_analise', { p_ip: ip, p_dados: { modelo: MODELO, ...v, erro: null } });
        algumOk = true;
      } catch (e) {
        log(`ia: falha ao analisar ${ip}`, e);
      } finally {
        iaEmVoo--;
        emAnalise.delete(ip);
      }
    }
    if (algumOk) await marcarStatus('ligada', MODELO);
  }

  // ---------- Tor e manutenção ----------
  let manutencaoEm = 0;
  let torProximaEm = 0; // trava por instância: 6 h depois de tentar, 1 h depois de falhar
  // tor_atualizado_em que o srv_lista manda (extra do banco):
  // undefined = o banco não informa; null = nunca atualizada
  let torAtualizadaEm: number | null | undefined;

  function anotarTor(lista: unknown) {
    if (!ehObj(lista) || !('tor_atualizado_em' in lista)) return;
    const t = lista.tor_atualizado_em == null ? NaN : Date.parse(String(lista.tor_atualizado_em));
    torAtualizadaEm = Number.isFinite(t) ? t : null;
  }

  async function atualizarTor() {
    const resp = await d.fetch(URL_TOR, { headers: { accept: 'text/plain' }, signal: AbortSignal.timeout(10_000) });
    if (!resp.ok) throw new Error(`tor: HTTP ${resp.status}`);
    if (Number(resp.headers.get('content-length') ?? 0) > 4_000_000) throw new Error('tor: lista grande demais');
    const conteudo = await resp.text();
    if (conteudo.length > 4_000_000) throw new Error('tor: lista grande demais');
    const ips = lerListaTor(conteudo);
    // Página de erro ou lista truncada não pode apagar a lista boa.
    if (ips.length < 100) throw new Error(`tor: lista suspeita (${ips.length} IPs)`);
    await d.rpc('sentinela_srv_tor_atualizar', { p_ips: ips });
  }

  /**
   * srv_manutencao no máximo 1x a cada 30 min por instância (o banco limita a 1x/dia).
   * Com atraso grande o banco para no meio e devolve "pendente": aí continua em 1 min.
   */
  async function manutencao(): Promise<unknown> {
    if (agora() - manutencaoEm < 30 * MIN) return null;
    manutencaoEm = agora();
    const r = await d.rpc('sentinela_srv_manutencao');
    if (ehObj(r) && r.pendente === true) manutencaoEm = agora() - 29 * MIN;
    return r;
  }

  /** §3: atualizar a Tor quando tor_atualizado_em tiver mais de 24 h (ou nunca). */
  async function talvezAtualizarTor(rManutencao: unknown) {
    const vencida = torAtualizadaEm === undefined
      ? precisaAtualizarTor(rManutencao, agora())
      : torAtualizadaEm === null || agora() - torAtualizadaEm > 24 * HORA;
    if (!vencida || agora() < torProximaEm) return;
    torProximaEm = agora() + 6 * HORA;
    try {
      await atualizarTor();
      torAtualizadaEm = agora();
    } catch (e) {
      torProximaEm = agora() + HORA;
      throw e;
    }
  }

  async function posEvento(analisar: unknown) {
    const ips = Array.isArray(analisar) ? analisar : [];
    const pManutencao = manutencao();
    const tarefas: [string, Promise<unknown>][] = [
      ['manutencao', pManutencao],
      ['tor', pManutencao.catch(() => null).then(talvezAtualizarTor)],
    ];
    if (ips.length) tarefas.push(['ia', analisarIps(ips)]);
    const r = await Promise.allSettled(tarefas.map((t) => t[1]));
    r.forEach((x, i) => { if (x.status === 'rejected') log(`${tarefas[i][0]} falhou`, x.reason); });
  }

  // ---------- rotas ----------
  const uaDe = (req: Request) => texto(req.headers.get('user-agent'), 300);

  async function rotaLista(req: Request, corpo: Uint8Array): Promise<Response> {
    const g = await autenticarGuarda(req, corpo);
    if (!g) return erro(401, 'guarda_nao_autenticado');
    // a lista que a autenticação acabou de ler serve (o guarda espera só 700 ms)
    const [lista, chaves] = await Promise.all([
      g.lista !== undefined ? g.lista : d.rpc('sentinela_srv_lista', { p_projeto: g.projeto }),
      chavesParaLista(),
    ]);
    if (!ehObj(lista)) throw new Error('srv_lista sem resposta');
    if (g.lista === undefined) guardarSistema(g.projeto, lista);
    d.depois(conferirChaveIA());
    return json({ ...lista, chaves });
  }

  async function rotaEvento(req: Request, corpo: Uint8Array): Promise<Response> {
    const g = await autenticarGuarda(req, corpo);
    if (!g) return erro(401, 'guarda_nao_autenticado');
    const dados = lerJson(corpo);
    if (dados === undefined) return erro(400, 'json_invalido');
    const lote = sanearLote(dados, agora());
    if (!lote.ok) return erro(400, lote.erro, lote.detalhe);
    const r = await d.rpc('sentinela_srv_registrar', {
      p_projeto: g.projeto,
      p_ambiente: g.ambiente,
      p_guarda: rotulo(req.headers.get('x-sentinela-guarda'), 60),
      p_runtime: rotulo(req.headers.get('x-sentinela-runtime'), 30),
      p_eventos: lote.eventos,
    });
    const res = ehObj(r) ? r : {};
    d.depois(posEvento(res.analisar));
    return json({ ok: true, gravados: num(res.gravados), descartados: num(res.descartados), invalidos: lote.invalidos });
  }

  async function rotaSessao(req: Request, corpo: Uint8Array): Promise<Response> {
    const g = await autenticarGuarda(req, corpo);
    if (!g) return erro(401, 'guarda_nao_autenticado');
    // Qualquer falha aqui é 401 passe_invalido (o guarda só distingue ok/falha).
    const dados = lerJson(corpo);
    if (!ehObj(dados)) return erro(401, 'passe_invalido', 'corpo');

    const esperado = { iss: EMISSOR, aud: g.projeto, typ: 'passe', agora: agoraS() };
    let v = await verificarJwt(dados.passe, await chavesPublicas(), esperado);
    if (!v.ok && v.motivo === 'kid_desconhecido') v = await verificarJwt(dados.passe, await chavesPublicas(true), esperado);
    if (!v.ok) return erro(401, 'passe_invalido', v.motivo);

    const p = v.payload;
    const jti = texto(p.jti, 100);
    const sub = texto(p.sub, 64);
    const email = emailValido(p.email);
    if (!jti || !sub || !email || num(p.exp) - num(p.iat) > PASSE_S + 30) return erro(401, 'passe_invalido', 'payload');
    // chave antes de queimar o jti: se o Vault falhar, o passe continua valendo
    const chave = await obterChave();
    const usado = await d.rpc('sentinela_srv_passe_usar', { p_jti: jti, p_projeto: g.projeto, p_email: email });
    if (usado !== true) return erro(401, 'passe_invalido', 'ja_usado');

    const iat = agoraS();
    const exp = iat + SESSAO_S;
    const sessao = await assinarJwt(
      { iss: EMISSOR, aud: g.projeto, sub, email, nome: texto(p.nome, 120), sis: texto(p.sis, 60), typ: 'sessao', iat, exp },
      chave.privada,
      chave.kid,
    );
    return json({ ok: true, sessao, exp: iso(exp), email });
  }

  async function rotaPasse(req: Request, corpo: Uint8Array, cors: Record<string, string>): Promise<Response> {
    const ip = ipCliente(req.headers);
    if (!limPasse(chaveLimite(ip), agora())) return erro(429, 'muitas_requisicoes', null, cors);
    const u = await usuarioDoToken(req);
    if (!u) return erro(401, 'token_invalido', null, cors);
    const dados = lerJson(corpo);
    if (!ehObj(dados)) return erro(400, 'json_invalido', null, cors);
    const slug = typeof dados.sistema_slug === 'string' ? dados.sistema_slug.trim().toLowerCase() : '';
    if (!RE_SLUG.test(slug)) return erro(400, 'sistema_invalido', null, cors);

    const perm = await d.rpc('sentinela_srv_permissao', { p_user_id: u.sub, p_sistema_slug: slug });
    if (!ehObj(perm) || perm.permitido !== true) {
      return erro(403, 'sem_permissao', ehObj(perm) ? texto(perm.motivo, 200) : null, cors);
    }
    const projeto = rotulo(perm.projeto, 100);
    if (!projeto || typeof perm.url !== 'string') return erro(404, 'sistema_sem_sentinela', null, cors);
    const email = emailValido(perm.email) ?? u.email;
    if (!email) return erro(400, 'sem_email', null, cors);
    const registrarIdentidade = () => {
      if (!ip) return;
      d.depois(d.rpc('sentinela_srv_identidade', { p_ip: ip, p_user_id: u.sub, p_email: email, p_origem: 'portal', p_ua: uaDe(req) })
        .catch((e) => log('identidade (passe) falhou', e)));
    };

    // Só com o guarda do sistema já ativo (srv_permissao.guarda_ativo = sentinela.sistemas.ultimo_sinal
    // preenchido) o passe vai na URL. Sem guarda ninguém o troca por sessão e ele ficaria exposto no
    // endereço, no histórico e nos logs do sistema: vai a URL do sistema sem passe.
    if (perm.guarda_ativo !== true) {
      const semPasse = montarUrlPasse(perm.url, dados.destino, null);
      if (!semPasse) return erro(500, 'url_do_sistema_invalida', null, cors);
      registrarIdentidade();
      return json({ ok: true, url: semPasse, guarda_ativo: false }, 200, cors);
    }

    const chave = await obterChave();
    const iat = agoraS();
    const exp = iat + PASSE_S;
    const passe = await assinarJwt(
      { iss: EMISSOR, aud: projeto, sub: u.sub, email, nome: texto(perm.nome, 120), sis: slug, typ: 'passe',
        jti: crypto.randomUUID(), iat, exp },
      chave.privada,
      chave.kid,
    );
    const url = montarUrlPasse(perm.url, dados.destino, passe);
    if (!url) return erro(500, 'url_do_sistema_invalida', null, cors);
    registrarIdentidade();
    return json({ ok: true, url, exp: iso(exp) }, 200, cors);
  }

  async function rotaIdentidade(req: Request, cors: Record<string, string>): Promise<Response> {
    const ip = ipCliente(req.headers);
    if (!limIdentidade(chaveLimite(ip), agora())) return erro(429, 'muitas_requisicoes', null, cors);
    const u = await usuarioDoToken(req);
    if (!u) return erro(401, 'token_invalido', null, cors);
    if (!ip) return erro(400, 'ip_desconhecido', null, cors);
    // Token válido não basta: o signUp do portal é aberto e o perfil nasce
    // inativo. Identidade (que tira o IP da IA e vira "provável" no painel)
    // só para perfil ativo. srv_permissao confere o perfil antes do sistema.
    const perfil = await d.rpc('sentinela_srv_permissao', { p_user_id: u.sub, p_sistema_slug: null });
    if (!ehObj(perfil) || typeof perfil.motivo !== 'string' || PERFIL_SEM_ACESSO.has(perfil.motivo)) {
      return erro(403, 'perfil_inativo', null, cors);
    }
    const email = emailValido(perfil.email) ?? u.email;
    if (!email) return erro(400, 'sem_email', null, cors);
    const r = await d.rpc('sentinela_srv_identidade', { p_ip: ip, p_user_id: u.sub, p_email: email, p_origem: 'portal', p_ua: uaDe(req) });
    if (ehObj(r) && r.ok === false) return erro(403, 'perfil_inativo', texto(r.motivo, 60), cors);
    return json({ ok: true }, 200, cors);
  }

  async function rotaTentativa(req: Request, corpo: Uint8Array, cors: Record<string, string>): Promise<Response> {
    const ip = ipCliente(req.headers);
    if (!ip) return erro(400, 'ip_desconhecido', null, cors);
    if (!limTentativa(chaveLimite(ip), agora())) return erro(429, 'muitas_requisicoes', null, cors);
    if (!limTentativaTodas('todas', agora())) return erro(429, 'muitas_requisicoes', null, cors);
    const dados = lerJson(corpo);
    if (!ehObj(dados)) return erro(400, 'json_invalido', null, cors);
    const r = await d.rpc('sentinela_srv_tentativa', { p_ip: ip, p_usuario: usuarioTentativa(dados.usuario), p_ua: uaDe(req) });
    return json({ ok: true, bloqueado: ehObj(r) && r.bloqueado === true }, 200, cors);
  }

  return async function tratar(req: Request): Promise<Response> {
    let cors: Record<string, string> = {};
    try {
      const rota = rotaDe(new URL(req.url).pathname);
      const def = Object.hasOwn(ROTAS, rota) ? ROTAS[rota] : undefined;
      if (!def) return erro(404, 'rota_desconhecida');
      if (def.navegador) cors = cabecalhosCors(req.headers.get('origin'));
      if (req.method === 'OPTIONS' && def.navegador) return new Response(null, { status: 204, headers: cors });
      if (req.method !== def.metodo) {
        return erro(405, 'metodo_nao_permitido', null, { ...cors, allow: def.navegador ? `${def.metodo}, OPTIONS` : def.metodo });
      }

      // POST do navegador: só da origem do portal e só JSON. Sem isso outro
      // site manda um POST "simples" (text/plain, sem preflight) pelo
      // navegador da vítima, e o /tentativa grava no IP DELA (§7.2).
      if (def.navegador && def.metodo === 'POST') {
        if (!origemPermitida(req.headers.get('origin'))) return erro(403, 'origem_nao_permitida', null, cors);
        if (!ehJson(req.headers.get('content-type'))) {
          return erro(400, 'content_type_invalido', 'esperado application/json', cors);
        }
      }

      let corpo: Uint8Array = new Uint8Array(0);
      if (def.metodo === 'POST') {
        const lido = await lerCorpoLimitado(req);
        if (!lido) return erro(413, 'corpo_grande', 'máximo 64 KB', cors);
        corpo = lido;
      }

      switch (rota) {
        case 'saude': return json({ ok: true, servico: 'sentinela', versao: VERSAO });
        case 'lista': return await rotaLista(req, corpo);
        case 'evento': return await rotaEvento(req, corpo);
        case 'sessao': return await rotaSessao(req, corpo);
        case 'passe': return await rotaPasse(req, corpo, cors);
        case 'identidade': return await rotaIdentidade(req, cors);
        case 'tentativa': return await rotaTentativa(req, corpo, cors);
      }
      return erro(404, 'rota_desconhecida');
    } catch (e) {
      log('erro interno', e);
      return erro(500, 'interno', null, cors);
    }
  };
}
