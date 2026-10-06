// =========================================================
// SENTINELA LUBE — Central (Supabase Edge Function "sentinela").
// https://wkkdcsqwlxjxorutrbnx.supabase.co/functions/v1/sentinela/<rota>
// Publicar com verify_jwt = false: cada rota autentica sozinha
// (guarda por OIDC da Vercel ou HMAC; portal pelo token do usuário).
//
// Este arquivo só liga o mundo real (banco, JWKS, segredos) na
// lógica da central.ts. Segredos vêm do ambiente da função:
//   SUPABASE_SERVICE_ROLE_KEY  (injetado pelo Supabase)
//   ANTHROPIC_API_KEY          (opcional; sem ela a IA fica "sem_chave")
//   SENTINELA_CHAVE            (opcional; plano B HMAC do guarda)
// Testes: node --test "teste/*.test.ts" (nesta pasta).
// =========================================================
import { createClient } from 'npm:@supabase/supabase-js@2';
import { createLocalJWKSet, createRemoteJWKSet, jwtVerify } from 'npm:jose@5';
import type { JWTPayload } from 'npm:jose@5';
import { criarCentral } from './central.ts';

const URL_SB = Deno.env.get('SUPABASE_URL') ?? 'https://wkkdcsqwlxjxorutrbnx.supabase.co';
const ISS_SUPABASE = 'https://wkkdcsqwlxjxorutrbnx.supabase.co/auth/v1';
const OIDC_ISS = 'https://oidc.vercel.com/lube-distribuidora-ltda';
const OIDC_AUD = 'https://vercel.com/lube-distribuidora-ltda';

/** service role (legada) ou, na falta dela, a secret key nova. */
function chaveServico(): string {
  const legada = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (legada) return legada;
  try {
    const mapa = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}') as Record<string, string>;
    return mapa.default ?? Object.values(mapa)[0] ?? '';
  } catch {
    return '';
  }
}

// Cliente criado no primeiro uso: sem chave, /saude continua respondendo.
const novoCliente = () => createClient(URL_SB, chaveServico(), {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
let sb: ReturnType<typeof novoCliente> | null = null;
function banco() {
  if (!sb) sb = novoCliente();
  return sb;
}

async function rpc(nome: string, params: Record<string, unknown> = {}): Promise<unknown> {
  const { data, error } = await banco().rpc(nome, params);
  // Nunca repassa os parâmetros (a criação de chave leva a privada).
  if (error) throw new Error(`rpc ${nome}: ${error.code ?? ''} ${error.message ?? ''}`.trim());
  return data;
}

// ---------- JWKS ----------
const jwksVercel = createRemoteJWKSet(new URL(`${OIDC_ISS}/.well-known/jwks`));
const jwksSupabaseRemoto = createRemoteJWKSet(new URL(`${ISS_SUPABASE}/.well-known/jwks.json`));
const jwksSupabaseLocal = (() => {
  try {
    const j = JSON.parse(Deno.env.get('SUPABASE_JWKS') ?? '');
    const keys = Array.isArray(j) ? j : j?.keys;
    return Array.isArray(keys) && keys.length ? createLocalJWKSet({ keys }) : null;
  } catch {
    return null;
  }
})();

async function verificarOidcVercel(token: string): Promise<JWTPayload> {
  const { payload } = await jwtVerify(token, jwksVercel, {
    issuer: OIDC_ISS,
    audience: OIDC_AUD,
    algorithms: ['RS256'],
    clockTolerance: 5,
  });
  return payload;
}

async function verificarTokenUsuario(token: string): Promise<JWTPayload> {
  const opcoes = { issuer: ISS_SUPABASE, audience: 'authenticated', algorithms: ['ES256'], clockTolerance: 5 };
  if (jwksSupabaseLocal) {
    try {
      return (await jwtVerify(token, jwksSupabaseLocal, opcoes)).payload;
    } catch (e) {
      // chave girada depois do boot: tenta o JWKS publicado
      if ((e as { code?: string })?.code !== 'ERR_JWKS_NO_MATCHING_KEY') throw e;
    }
  }
  return (await jwtVerify(token, jwksSupabaseRemoto, opcoes)).payload;
}

// ---------- trabalho depois da resposta ----------
const runtime = (globalThis as { EdgeRuntime?: { waitUntil?(p: Promise<unknown>): void } }).EdgeRuntime;
function depois(p: Promise<unknown>): void {
  const seguro = p.catch((e) => console.error('[sentinela] tarefa em segundo plano falhou', e instanceof Error ? e.message : ''));
  if (runtime?.waitUntil) runtime.waitUntil(seguro);
}

Deno.serve(criarCentral({
  rpc,
  verificarOidcVercel,
  verificarTokenUsuario,
  chaveHmac: () => Deno.env.get('SENTINELA_CHAVE') || undefined,
  chaveAnthropic: () => Deno.env.get('ANTHROPIC_API_KEY') || undefined,
  fetch: (entrada, init) => fetch(entrada, init),
  depois,
}));
