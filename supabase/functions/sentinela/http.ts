// =========================================================
// SENTINELA — utilidades HTTP puras: rotas, CORS, IP do cliente,
// leitura de corpo com teto, respostas JSON e limitador de taxa.
// =========================================================
import { gruposIpv6, ipValido } from './saneamento.ts';

export const LIMITE_CORPO = 64 * 1024;

export interface DefRota {
  metodo: 'GET' | 'POST';
  /** rota chamada pelo navegador (tem CORS) */
  navegador: boolean;
}

export const ROTAS: Record<string, DefRota> = {
  saude: { metodo: 'GET', navegador: false },
  lista: { metodo: 'GET', navegador: false },
  evento: { metodo: 'POST', navegador: false },
  sessao: { metodo: 'POST', navegador: false },
  passe: { metodo: 'POST', navegador: true },
  identidade: { metodo: 'POST', navegador: true },
  tentativa: { metodo: 'POST', navegador: true },
};

/** Rota pelo final do pathname: /functions/v1/sentinela/lista → "lista". */
export function rotaDe(pathname: string): string {
  const partes = pathname.split('/').filter(Boolean);
  const ultima = (partes[partes.length - 1] ?? '').toLowerCase();
  return ultima === 'sentinela' ? '' : ultima;
}

export const ORIGENS_PERMITIDAS = new Set([
  'https://painel-lube-distribuidora.vercel.app',
  'https://painel-lube-distribuidora-lube-distribuidora-ltda.vercel.app',
  'http://localhost:4321',
  'http://127.0.0.1:4321',
]);

export function origemPermitida(origem: string | null): origem is string {
  return !!origem && ORIGENS_PERMITIDAS.has(origem);
}

/**
 * Content-type application/json. Exigir isso no POST do navegador força o
 * preflight do CORS: outro site não consegue mais mandar um POST "simples"
 * (text/plain, no-cors) que chega ao banco mesmo sem ler a resposta.
 */
export function ehJson(contentType: string | null): boolean {
  return (contentType ?? '').split(';')[0].trim().toLowerCase() === 'application/json';
}

/** Cabeçalhos CORS das rotas do navegador. Origem fora da lista → só Vary. */
export function cabecalhosCors(origem: string | null): Record<string, string> {
  const h: Record<string, string> = { vary: 'Origin' };
  if (origemPermitida(origem)) {
    h['access-control-allow-origin'] = origem;
    h['access-control-allow-methods'] = 'POST, OPTIONS';
    h['access-control-allow-headers'] = 'authorization, content-type, apikey, x-client-info';
    h['access-control-max-age'] = '600';
  }
  return h;
}

/** IP de quem chamou: cf-connecting-ip → x-real-ip → 1º do x-forwarded-for. */
export function ipCliente(headers: Headers): string | null {
  for (const nome of ['cf-connecting-ip', 'x-real-ip']) {
    const v = headers.get(nome);
    if (v !== null && v.trim() !== '') return ipValido(v);
  }
  const xff = headers.get('x-forwarded-for');
  if (xff) return ipValido(xff.split(',')[0]);
  return null;
}

/** Token do cabeçalho Authorization: Bearer <x>. */
export function bearer(headers: Headers): string | null {
  const m = /^Bearer\s+(\S+)\s*$/i.exec(headers.get('authorization') ?? '');
  return m ? m[1] : null;
}

const BASE_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};

export function json(corpo: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(corpo), { status, headers: { ...BASE_HEADERS, ...extra } });
}

/** Erro padrão {"erro":"codigo","detalhe":"..."}. */
export function erro(status: number, codigo: string, detalhe?: string | null, extra: Record<string, string> = {}): Response {
  return json(detalhe ? { erro: codigo, detalhe } : { erro: codigo }, status, extra);
}

/** Lê o corpo inteiro sem passar do limite. Passou → null (vira 413). */
// (tipo de retorno inferido: compatível com TS antigo e novo do Uint8Array)
export async function lerCorpoLimitado(req: Request, limite = LIMITE_CORPO) {
  const cl = req.headers.get('content-length');
  if (cl !== null && Number(cl) > limite) return null;
  if (!req.body) return new Uint8Array(0);
  const leitor = req.body.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.byteLength;
    if (total > limite) {
      await leitor.cancel().catch(() => {});
      return null;
    }
    partes.push(value);
  }
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of partes) { out.set(p, pos); pos += p.byteLength; }
  return out;
}

/** JSON de bytes UTF-8 estritos. Inválido → undefined. */
export function lerJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return undefined;
  }
}

/**
 * URL de entrada no sistema com o passe: usa `destino` só se tiver a
 * mesma origem da url do sistema; senão a própria url do sistema.
 * `passe` null (sistema ainda sem guarda): a mesma URL, sem sentinela_passe.
 */
export function montarUrlPasse(urlSistema: unknown, destino: unknown, passe: string | null): string | null {
  if (typeof urlSistema !== 'string') return null;
  let alvo: URL;
  try {
    alvo = new URL(urlSistema);
  } catch {
    return null;
  }
  if (alvo.protocol !== 'https:') return null;
  if (typeof destino === 'string' && destino.length <= 2000) {
    try {
      const d = new URL(destino);
      if (d.origin === alvo.origin) alvo = d;
    } catch { /* destino inválido: fica a url do sistema */ }
  }
  alvo.username = '';
  alvo.password = '';
  alvo.searchParams.delete('sentinela_passe');
  if (passe) alvo.searchParams.set('sentinela_passe', passe);
  return alvo.href;
}

export const RE_SLUG = /^[a-z0-9][a-z0-9_-]{0,59}$/;
export const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Chave do limitador por cliente: IPv4 inteiro; IPv6 pelo prefixo /64
 * (quem tem um IPv6 costuma ter o /64 inteiro e giraria o endereço).
 */
export function chaveLimite(ip: string | null): string {
  const v = ipValido(ip);
  if (!v) return 'sem-ip';
  if (!v.includes(':')) return v;
  const g = gruposIpv6(v);
  return g ? `${g.slice(0, 4).map((n) => n.toString(16)).join(':')}::/64` : v;
}

/**
 * Limitador simples por chave (janela fixa). Em memória, por instância:
 * segura enxurrada de um mesmo IP sem custo de banco.
 */
export function criarLimitador(max: number, janelaMs: number, capacidade = 5000) {
  const mapa = new Map<string, { n: number; desde: number }>();
  return (chave: string, agoraMs = Date.now()): boolean => {
    let e = mapa.get(chave);
    if (!e || agoraMs - e.desde >= janelaMs) {
      mapa.delete(chave);
      if (mapa.size >= capacidade) {
        const velha = mapa.keys().next().value;
        if (velha !== undefined) mapa.delete(velha);
      }
      e = { n: 0, desde: agoraMs };
      mapa.set(chave, e);
    }
    e.n++;
    return e.n <= max;
  };
}
