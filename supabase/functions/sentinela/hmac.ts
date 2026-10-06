// =========================================================
// SENTINELA — plano B de autenticação do guarda (§3.2).
// x-sentinela-assinatura: t=<unix>,v1=<hex>
// v1 = HMAC-SHA256(SENTINELA_CHAVE, `${t}.${corpoBruto}`); GET = corpo vazio.
// =========================================================

const enc = new TextEncoder();

export const JANELA_HMAC_S = 300;
/** Chave curta demais é tratada como ausente (não vale como segredo). */
export const TAMANHO_MIN_CHAVE = 32;

export function lerAssinatura(cabecalho: string | null | undefined): { t: number; tTexto: string; v1: string } | null {
  if (typeof cabecalho !== 'string' || cabecalho.length > 200) return null;
  let t: number | null = null;
  let tTexto = '';
  let v1: string | null = null;
  for (const parte of cabecalho.split(',')) {
    const i = parte.indexOf('=');
    if (i < 0) return null;
    const k = parte.slice(0, i).trim();
    const v = parte.slice(i + 1).trim();
    if (k === 't' && /^\d{1,12}$/.test(v)) { t = Number(v); tTexto = v; }
    else if (k === 'v1' && /^[0-9a-fA-F]{64}$/.test(v)) v1 = v.toLowerCase();
    else return null;
  }
  return t !== null && v1 !== null ? { t, tTexto, v1 } : null;
}

function hexParaBytes(h: string): Uint8Array {
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}

function bytesParaHex(b: Uint8Array): string {
  return Array.from(b, (n) => n.toString(16).padStart(2, '0')).join('');
}

/** Comparação em tempo constante (não para no primeiro byte diferente). */
export function iguais(a: Uint8Array, b: Uint8Array): boolean {
  let dif = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) dif |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return dif === 0;
}

async function hmacBytes(chave: string, t: number | string, corpo: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', enc.encode(chave), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const prefixo = enc.encode(`${t}.`);
  const msg = new Uint8Array(prefixo.length + corpo.length);
  msg.set(prefixo, 0);
  msg.set(corpo, prefixo.length);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, msg));
}

/** Assinatura em hex (usada pelo guarda e pelos testes). */
export async function assinarHmac(chave: string, t: number | string, corpo: Uint8Array): Promise<string> {
  return bytesParaHex(await hmacBytes(chave, t, corpo));
}

export type ResultadoHmac = { ok: true; t: number } | { ok: false; motivo: string };

export async function verificarHmac(
  chave: string,
  cabecalho: string | null | undefined,
  corpo: Uint8Array,
  agoraS = Math.floor(Date.now() / 1000),
  janela = JANELA_HMAC_S,
): Promise<ResultadoHmac> {
  if (!chave || chave.length < TAMANHO_MIN_CHAVE) return { ok: false, motivo: 'sem_chave' };
  const a = lerAssinatura(cabecalho);
  if (!a) return { ok: false, motivo: 'formato' };
  if (Math.abs(agoraS - a.t) > janela) return { ok: false, motivo: 'fora_da_janela' };
  // assina o t exatamente como veio no cabeçalho
  const esperado = await hmacBytes(chave, a.tTexto, corpo);
  if (!iguais(esperado, hexParaBytes(a.v1))) return { ok: false, motivo: 'assinatura' };
  return { ok: true, t: a.t };
}
