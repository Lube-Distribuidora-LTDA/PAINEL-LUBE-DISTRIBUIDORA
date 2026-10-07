// =========================================================
// SENTINELA — saneamento do que chega dos guardas e do navegador.
// Lógica pura (sem Deno, sem rede): roda igual no Node para teste.
// Tudo que vem de fora é tratado como texto hostil: corta, limpa
// e valida antes de chegar no banco.
// =========================================================

export const MAX_EVENTOS = 20;

export const TIPOS = ['pagina', 'api', 'arquivo', 'outro'] as const;
export const DECISOES = ['liberado', 'observado', 'bloqueado'] as const;
export const ORIGENS_IDENTIDADE = ['passe', 'sessao_app'] as const;

// Caracteres de controle viram espaço; surrogate solto some (o jsonb do Postgres recusa).
const CONTROLE = /[\u0000-\u001f\u007f-\u009f]/g;
const SURROGATE_SOLTO = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;

/** Texto limpo e cortado em `max` caracteres; vazio ou não-texto → null. */
export function texto(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  let s = v.replace(CONTROLE, ' ').trim();
  if (s.length > max) s = s.slice(0, max);
  s = s.replace(SURROGATE_SOLTO, '').trim();
  return s || null;
}

/** Texto que só pode ter os caracteres do padrão (rótulos, códigos). */
function rotuloCom(v: unknown, max: number, padrao: RegExp): string | null {
  const s = texto(v, max);
  return s && padrao.test(s) ? s : null;
}

/** Rótulo curto de cabeçalho (versão do guarda, runtime, projeto). */
export function rotulo(v: unknown, max = 60): string | null {
  return rotuloCom(v, max, /^[A-Za-z0-9._\/@:+-]+$/);
}

/** Ambiente da Vercel (production, preview, development...). Desconhecido → production. */
export function ambienteValido(v: unknown): string {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return /^[a-z0-9_-]{1,30}$/.test(s) ? s : 'production';
}

// ---------------------------------------------------------
// IP
// ---------------------------------------------------------
const OCTETO = '(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
const RE_IPV4 = new RegExp(`^${OCTETO}(\\.${OCTETO}){3}$`);

function ipv6Grupos(s: string): number[] | null {
  if (!/^[0-9a-f:.]+$/.test(s)) return null;
  let grupos = s;
  let extra: number[] = [];
  // IPv4 embutido no fim (ex.: ::ffff:1.2.3.4)
  if (s.includes('.')) {
    const ult = s.lastIndexOf(':');
    const v4 = s.slice(ult + 1);
    if (!RE_IPV4.test(v4)) return null;
    const o = v4.split('.').map(Number);
    extra = [(o[0] << 8) | o[1], (o[2] << 8) | o[3]];
    grupos = s.slice(0, ult + 1);
    // "a:b:" perde o ":" final; "a::" fica como está (a compressão cobre o resto)
    if (!grupos.endsWith('::')) grupos = grupos.slice(0, -1);
  }
  const duplos = grupos.split('::');
  if (duplos.length > 2) return null;
  const ler = (parte: string): number[] | null => {
    if (parte === '') return [];
    const out: number[] = [];
    for (const g of parte.split(':')) {
      if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
      out.push(parseInt(g, 16));
    }
    return out;
  };
  const esq = ler(duplos[0]);
  if (!esq) return null;
  if (duplos.length === 1) {
    const todos = esq.concat(extra);
    return todos.length === 8 ? todos : null;
  }
  const dir = ler(duplos[1]);
  if (!dir) return null;
  const faltam = 8 - (esq.length + dir.length + extra.length);
  if (faltam < 1) return null;
  return esq.concat(new Array(faltam).fill(0), dir, extra);
}

function ipv6Texto(g: number[]): string {
  // Forma canônica (RFC 5952): maior sequência de 2+ zeros vira "::".
  let ini = -1, tam = 0;
  for (let i = 0; i < 8;) {
    if (g[i] !== 0) { i++; continue; }
    let j = i;
    while (j < 8 && g[j] === 0) j++;
    if (j - i > tam && j - i >= 2) { ini = i; tam = j - i; }
    i = j;
  }
  const hex = g.map((n) => n.toString(16));
  if (ini < 0) return hex.join(':');
  return hex.slice(0, ini).join(':') + '::' + hex.slice(ini + tam).join(':');
}

/** Os 8 grupos de 16 bits de um IPv6 (já em minúsculas), ou null. */
export function gruposIpv6(v: string): number[] | null {
  return ipv6Grupos(v.trim().toLowerCase());
}

/** IPv4 ou IPv6 válido, normalizado (IPv4 mapeado em IPv6 vira IPv4). Senão null. */
export function ipValido(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  if (!s || s.length > 45) return null;
  if (RE_IPV4.test(s)) return s;
  if (!s.includes(':')) return null;
  const g = ipv6Grupos(s);
  if (!g) return null;
  if (g.slice(0, 5).every((n) => n === 0) && g[5] === 0xffff) {
    return [g[6] >> 8, g[6] & 255, g[7] >> 8, g[7] & 255].join('.');
  }
  return ipv6Texto(g);
}

// ---------------------------------------------------------
// Evento (§3.3)
// ---------------------------------------------------------
export interface Evento {
  ts: string;
  metodo: string | null;
  host: string | null;
  caminho: string | null;
  consulta: string | null;
  tipo: string;
  ip: string;
  pais: string | null;
  regiao: string | null;
  cidade: string | null;
  lat: number | null;
  lon: number | null;
  fuso: string | null;
  ua: string | null;
  idioma: string | null;
  referer: string | null;
  ja4: string | null;
  vercel_id: string | null;
  sec_fetch_site: string | null;
  sec_fetch_mode: string | null;
  sec_fetch_dest: string | null;
  decisao: string;
  regra: string | null;
  motivo: string | null;
  identidade: string | null;
  identidade_origem: string | null;
}

function numero(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(v)) return Number(v);
  return null;
}

function umDe<T extends string>(v: unknown, lista: readonly T[]): T | null {
  return typeof v === 'string' && (lista as readonly string[]).includes(v) ? (v as T) : null;
}

/** Só a origem do referer (sem caminho nem consulta). */
export function origemReferer(v: unknown): string | null {
  const s = texto(v, 2000);
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return texto(u.origin, 120);
  } catch {
    return null;
  }
}

const RE_EMAIL = /^[^\s@]{1,64}@[^\s@]{1,100}\.[^\s@]{1,30}$/;

/** E-mail minúsculo e plausível, ou null. */
export function emailValido(v: unknown): string | null {
  const s = texto(v, 120);
  if (!s) return null;
  const e = s.toLowerCase();
  return RE_EMAIL.test(e) ? e : null;
}

// Nome de robô que o app manda quando o pedido vem de um agendador verificado pelo segredo
// (ex.: "robô do gestao ti (agendador da vercel)"). Só letras sem acento, dígitos, espaço e
// ( ) . _ - depois de "robô "/"robo ": nunca "|" (separador do selo) nem "@" (e-mail de pessoa).
const RE_ROBO = /^rob[oô] [a-z0-9 ()._-]{3,80}$/i;
const RE_ROBO_MINUSCULO = /^rob[oô] [a-z0-9 ()._-]{3,80}$/;

/**
 * Nome de robô minúsculo, ou null. Confere o texto como veio (sem trocar controle por espaço):
 * qualquer caractere fora da lista recusa o nome inteiro.
 */
export function nomeRoboValido(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!RE_ROBO.test(s)) return null;
  const n = s.toLowerCase();
  // segunda conferência já minúscula (sem /i): nenhuma letra "parecida" passa pela troca de caixa
  return RE_ROBO_MINUSCULO.test(n) ? n : null;
}

/** ts do guarda: inválido, mais de 5 min no futuro ou mais de 1 dia atrás → agora. */
function tsValido(v: unknown, agoraMs: number): string {
  if (typeof v === 'string' && v.length <= 40) {
    const t = Date.parse(v);
    if (Number.isFinite(t) && t <= agoraMs + 5 * 60_000 && t >= agoraMs - 86_400_000) {
      return new Date(t).toISOString();
    }
  }
  return new Date(agoraMs).toISOString();
}

/**
 * Saneia um evento do guarda. Devolve null quando o evento não pode
 * entrar (ip inválido ou decisão desconhecida). Campos extras somem.
 */
export function sanearEvento(bruto: unknown, agoraMs = Date.now()): Evento | null {
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return null;
  const e = bruto as Record<string, unknown>;

  const ip = ipValido(e.ip);
  if (!ip) return null;
  const decisao = umDe(e.decisao, DECISOES);
  if (!decisao) return null;

  let lat = numero(e.lat), lon = numero(e.lon);
  if (lat === null || lon === null || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    lat = null;
    lon = null;
  }

  const metodo = texto(e.metodo, 10)?.toUpperCase() ?? null;
  const pais = texto(e.pais, 2)?.toUpperCase() ?? null;
  const host = texto(e.host, 120)?.toLowerCase() ?? null;
  const fetchCampo = (v: unknown) => {
    const s = texto(v, 30)?.toLowerCase() ?? null;
    return s && /^[a-z-]+$/.test(s) ? s : null;
  };

  // identidade: e-mail para qualquer origem; nome de robô SÓ com sessao_app (o app confirmou o
  // agendador pelo segredo). Pelo passe a identidade é sempre o e-mail de quem fez login.
  let identidadeOrigem: string | null = umDe(e.identidade_origem, ORIGENS_IDENTIDADE);
  let identidade = emailValido(e.identidade)
    ?? (identidadeOrigem === 'sessao_app' ? nomeRoboValido(e.identidade) : null);
  if (!identidade || !identidadeOrigem) { identidade = null; identidadeOrigem = null; }

  return {
    ts: tsValido(e.ts, agoraMs),
    metodo: metodo && /^[A-Z]+$/.test(metodo) ? metodo : null,
    host: host && /^[a-z0-9.\-:\[\]]+$/.test(host) ? host : null,
    caminho: texto(e.caminho, 300),
    consulta: texto(e.consulta, 300),
    tipo: umDe(e.tipo, TIPOS) ?? 'outro',
    ip,
    pais: pais && /^[A-Z]{2}$/.test(pais) ? pais : null,
    regiao: texto(e.regiao, 80),
    cidade: texto(e.cidade, 80),
    lat,
    lon,
    fuso: rotuloCom(e.fuso, 60, /^[A-Za-z0-9_+\-\/]+$/),
    ua: texto(e.ua, 300),
    idioma: texto(e.idioma, 60),
    referer: origemReferer(e.referer),
    ja4: rotuloCom(e.ja4, 100, /^[A-Za-z0-9_\-]+$/),
    vercel_id: rotuloCom(e.vercel_id, 120, /^[A-Za-z0-9:_\-.]+$/),
    sec_fetch_site: fetchCampo(e.sec_fetch_site),
    sec_fetch_mode: fetchCampo(e.sec_fetch_mode),
    sec_fetch_dest: fetchCampo(e.sec_fetch_dest),
    decisao,
    regra: rotuloCom(e.regra, 40, /^[a-z][a-z0-9_]*$/),
    motivo: texto(e.motivo, 200),
    identidade,
    identidade_origem: identidadeOrigem,
  };
}

export type ResultadoLote =
  | { ok: true; eventos: Evento[]; invalidos: number }
  | { ok: false; erro: string; detalhe: string };

/** Corpo do POST /evento: {"eventos":[...]} com no máximo 20. */
export function sanearLote(corpo: unknown, agoraMs = Date.now()): ResultadoLote {
  if (!corpo || typeof corpo !== 'object' || !Array.isArray((corpo as { eventos?: unknown }).eventos)) {
    return { ok: false, erro: 'corpo_invalido', detalhe: 'esperado {"eventos":[...]}' };
  }
  const lista = (corpo as { eventos: unknown[] }).eventos;
  if (lista.length > MAX_EVENTOS) {
    return { ok: false, erro: 'eventos_demais', detalhe: `máximo ${MAX_EVENTOS} eventos por envio` };
  }
  const eventos: Evento[] = [];
  for (const bruto of lista) {
    const ev = sanearEvento(bruto, agoraMs);
    if (ev) eventos.push(ev);
  }
  return { ok: true, eventos, invalidos: lista.length - eventos.length };
}

// ---------------------------------------------------------
// Navegador e listas externas
// ---------------------------------------------------------

/** Usuário digitado no login que falhou: até 80 caracteres, minúsculo. */
export function usuarioTentativa(v: unknown): string | null {
  const s = texto(v, 80);
  return s ? s.toLowerCase().slice(0, 80) : null;
}

/** Lista de saídas Tor (um IP por linha). Linhas inválidas são ignoradas. */
export function lerListaTor(conteudo: string, max = 50_000): string[] {
  const vistos = new Set<string>();
  for (const linha of conteudo.split(/\r?\n/)) {
    const s = linha.trim();
    if (!s || s.startsWith('#')) continue;
    const ip = ipValido(s);
    if (ip) vistos.add(ip);
    if (vistos.size >= max) break;
  }
  return [...vistos];
}
