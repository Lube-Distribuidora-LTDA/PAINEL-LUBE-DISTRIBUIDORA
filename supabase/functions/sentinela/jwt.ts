// =========================================================
// SENTINELA — passe e sessão em JWT ES256 (ECDSA P-256 / SHA-256).
// Só WebCrypto: funciona no Deno, no Node e no guarda. A assinatura
// JWS é r||s (64 bytes), que é o formato que o WebCrypto já produz.
// =========================================================

const enc = new TextEncoder();
const dec = new TextDecoder();

const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const ASSINATURA = { name: 'ECDSA', hash: 'SHA-256' } as const;
const TAMANHO_MAX_TOKEN = 4096;

export interface JwkPublica {
  kty: 'EC';
  crv: 'P-256';
  x: string;
  y: string;
  kid?: string;
  alg?: string;
  use?: string;
}

export interface JwkPrivada {
  kty: 'EC';
  crv: 'P-256';
  x: string;
  y: string;
  d: string;
}

export type Payload = Record<string, unknown>;

// ---------- base64url ----------
export function b64url(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function deB64url(s: string) {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error('base64url inválido');
  let b = s.replace(/-/g, '+').replace(/_/g, '/');
  while (b.length % 4) b += '=';
  const bin = atob(b);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function jsonB64(obj: unknown): string {
  return b64url(enc.encode(JSON.stringify(obj)));
}

function lerJsonB64(s: string): unknown {
  return JSON.parse(dec.decode(deB64url(s)));
}

// ---------- chaves ----------
/** kid = 16 hex aleatórios. */
export function novoKid(): string {
  const b = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(b, (n) => n.toString(16).padStart(2, '0')).join('');
}

/** Gera um par ES256 novo. A pública já vem com kid/alg/use. */
export async function gerarChave(): Promise<{ kid: string; publica: JwkPublica; privada: JwkPrivada }> {
  const par = await crypto.subtle.generateKey(ECDSA, true, ['sign', 'verify']) as CryptoKeyPair;
  const pub = await crypto.subtle.exportKey('jwk', par.publicKey) as JsonWebKey;
  const pri = await crypto.subtle.exportKey('jwk', par.privateKey) as JsonWebKey;
  const kid = novoKid();
  return {
    kid,
    publica: { kty: 'EC', crv: 'P-256', x: String(pub.x), y: String(pub.y), kid, alg: 'ES256', use: 'sig' },
    privada: { kty: 'EC', crv: 'P-256', x: String(pri.x), y: String(pri.y), d: String(pri.d) },
  };
}

export function importarPrivada(jwk: JwkPrivada): Promise<CryptoKey> {
  const limpa = { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, d: jwk.d };
  return crypto.subtle.importKey('jwk', limpa, ECDSA, false, ['sign']);
}

export function importarPublica(jwk: JwkPublica): Promise<CryptoKey> {
  const limpa = { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y };
  return crypto.subtle.importKey('jwk', limpa, ECDSA, false, ['verify']);
}

/** Aceita só JWK EC P-256 com x, y e kid. */
export function jwkPublicaValida(v: unknown): v is JwkPublica {
  if (!v || typeof v !== 'object') return false;
  const j = v as Record<string, unknown>;
  return j.kty === 'EC' && j.crv === 'P-256' && typeof j.x === 'string' && typeof j.y === 'string' &&
    typeof j.kid === 'string' && j.kid.length > 0;
}

// ---------- assinar ----------
export async function assinarJwt(payload: Payload, privada: CryptoKey, kid: string): Promise<string> {
  const cabeca = jsonB64({ alg: 'ES256', typ: 'JWT', kid });
  const corpo = jsonB64(payload);
  const sig = new Uint8Array(await crypto.subtle.sign(ASSINATURA, privada, enc.encode(`${cabeca}.${corpo}`)));
  return `${cabeca}.${corpo}.${b64url(sig)}`;
}

// ---------- verificar ----------
export interface Esperado {
  iss: string;
  aud: string;
  typ: string;
  /** agora em segundos (unix); padrão = relógio. */
  agora?: number;
  /** tolerância de relógio em segundos para exp/iat/nbf. */
  folga?: number;
}

export type Verificacao = { ok: true; payload: Payload; kid: string } | { ok: false; motivo: string };

/**
 * Verifica um JWT ES256 emitido pela Sentinela: assinatura com a chave
 * do `kid`, iss, typ, aud (igualdade exata), exp, iat e nbf.
 */
export async function verificarJwt(token: unknown, chaves: JwkPublica[], esperado: Esperado): Promise<Verificacao> {
  const falha = (motivo: string): Verificacao => ({ ok: false, motivo });
  if (typeof token !== 'string' || !token || token.length > TAMANHO_MAX_TOKEN) return falha('formato');
  const partes = token.split('.');
  if (partes.length !== 3) return falha('formato');

  let cabeca: Record<string, unknown>;
  let payload: Payload;
  let sig: ReturnType<typeof deB64url>;
  try {
    cabeca = lerJsonB64(partes[0]) as Record<string, unknown>;
    payload = lerJsonB64(partes[1]) as Payload;
    sig = deB64url(partes[2]);
  } catch {
    return falha('formato');
  }
  if (!cabeca || typeof cabeca !== 'object' || cabeca.alg !== 'ES256') return falha('alg');
  if (typeof cabeca.kid !== 'string') return falha('kid');
  const jwk = chaves.find((c) => c.kid === cabeca.kid);
  if (!jwk) return falha('kid_desconhecido');
  if (sig.length !== 64) return falha('assinatura');

  let valida = false;
  try {
    const chave = await importarPublica(jwk);
    valida = await crypto.subtle.verify(ASSINATURA, chave, sig, enc.encode(`${partes[0]}.${partes[1]}`));
  } catch {
    valida = false;
  }
  if (!valida) return falha('assinatura');

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return falha('payload');
  const agora = esperado.agora ?? Math.floor(Date.now() / 1000);
  const folga = esperado.folga ?? 0;
  if (payload.iss !== esperado.iss) return falha('iss');
  if (payload.typ !== esperado.typ) return falha('typ');
  if (typeof payload.aud !== 'string' || payload.aud !== esperado.aud) return falha('aud');
  if (typeof payload.exp !== 'number' || !(payload.exp + folga > agora)) return falha('expirado');
  if (typeof payload.iat !== 'number' || payload.iat > agora + folga + 60) return falha('iat');
  if (payload.nbf !== undefined && (typeof payload.nbf !== 'number' || payload.nbf > agora + folga)) return falha('nbf');
  return { ok: true, payload, kid: cabeca.kid };
}
