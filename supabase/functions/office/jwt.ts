// =========================================================
// LUBE OFFICE — JWT HS256 (a assinatura que o ONLYOFFICE usa)
// Só Web Crypto: roda igual no Deno (Edge Function) e no Node (testes).
// =========================================================

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function deB64url(s: string): Uint8Array {
  let t = s.replace(/-/g, '+').replace(/_/g, '/');
  while (t.length % 4) t += '=';
  const bin = atob(t);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function chave(segredo: string, uso: 'sign' | 'verify') {
  return crypto.subtle.importKey('raw', enc.encode(segredo), { name: 'HMAC', hash: 'SHA-256' }, false, [uso]);
}

// assina o objeto inteiro (é assim que o ONLYOFFICE confere a configuração do editor)
export async function assinarHS256(payload: Record<string, unknown>, segredo: string, validadeSeg = 3600): Promise<string> {
  if (!segredo) throw new Error('sem chave do motor');
  const agora = Math.floor(Date.now() / 1000);
  const corpo = { ...payload, iat: agora, exp: agora + validadeSeg };
  const dados = b64url(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))) + '.' +
                b64url(enc.encode(JSON.stringify(corpo)));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await chave(segredo, 'sign'), enc.encode(dados)));
  return dados + '.' + b64url(sig);
}

// devolve o conteúdo do token, ou null se a assinatura, o algoritmo ou a validade não baterem
export async function verificarHS256(token: unknown, segredo: string, agoraSeg = Math.floor(Date.now() / 1000)): Promise<Record<string, unknown> | null> {
  if (!segredo || typeof token !== 'string') return null;
  const partes = token.split('.');
  if (partes.length !== 3) return null;
  try {
    const cab = JSON.parse(dec.decode(deB64url(partes[0])));
    if (!cab || cab.alg !== 'HS256') return null;
    const ok = await crypto.subtle.verify('HMAC', await chave(segredo, 'verify'), deB64url(partes[2]),
      enc.encode(partes[0] + '.' + partes[1]));
    if (!ok) return null;
    const corpo = JSON.parse(dec.decode(deB64url(partes[1])));
    if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) return null;
    if (typeof corpo.exp === 'number' && corpo.exp < agoraSeg - 60) return null;   // 1 min de folga no relógio
    return corpo;
  } catch {
    return null;
  }
}
