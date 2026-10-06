// Testes do passe/sessão ES256 com chave real gerada aqui (§3.4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPublicKey, verify as verificarNode } from 'node:crypto';
import { assinarJwt, b64url, deB64url, gerarChave, importarPrivada, jwkPublicaValida, verificarJwt } from '../jwt.ts';
import type { JwkPublica } from '../jwt.ts';

const AGORA = 1_790_000_000;

async function cenario() {
  const k = await gerarChave();
  // simula a ida e volta pelo Vault: a privada vira texto e volta
  const privada = await importarPrivada(JSON.parse(JSON.stringify(k.privada)));
  const passe = {
    iss: 'sentinela-lube', aud: 'gestao-finaceiro', sub: '7b2f3c1e-1111-4222-8333-944455556666',
    email: 'julio@lube.com.br', nome: 'Júlio', sis: 'gestao-financeiro', typ: 'passe',
    jti: '0f8fad5b-d9cb-469f-a165-70867728950e', iat: AGORA, exp: AGORA + 90,
  };
  return { k, privada, passe };
}

const esperado = (extra: Record<string, unknown> = {}) =>
  ({ iss: 'sentinela-lube', aud: 'gestao-finaceiro', typ: 'passe', agora: AGORA + 10, ...extra }) as {
    iss: string; aud: string; typ: string; agora: number;
  };

test('gerarChave: kid de 16 hex, pública sem "d", privada com "d"', async () => {
  const { k } = await cenario();
  assert.match(k.kid, /^[0-9a-f]{16}$/);
  assert.equal(k.publica.kid, k.kid);
  assert.equal(k.publica.alg, 'ES256');
  assert.equal(k.publica.use, 'sig');
  assert.equal('d' in k.publica, false);
  assert.equal(typeof k.privada.d, 'string');
  assert.ok(jwkPublicaValida(k.publica));
  assert.equal(jwkPublicaValida({ ...k.publica, kid: undefined }), false);
  assert.equal(jwkPublicaValida({ ...k.publica, crv: 'P-384' }), false);
});

test('assinar + verificar passe: ok', async () => {
  const { k, privada, passe } = await cenario();
  const jwt = await assinarJwt(passe, privada, k.kid);
  const cab = JSON.parse(new TextDecoder().decode(deB64url(jwt.split('.')[0])));
  assert.deepEqual(cab, { alg: 'ES256', typ: 'JWT', kid: k.kid });
  const v = await verificarJwt(jwt, [k.publica], esperado());
  assert.equal(v.ok, true);
  assert.equal(v.ok && v.payload.email, 'julio@lube.com.br');
  assert.equal(v.ok && v.kid, k.kid);
});

test('assinatura é JWS padrão (r||s): o node:crypto confere com a JWK pública', async () => {
  const { k, privada, passe } = await cenario();
  const jwt = await assinarJwt(passe, privada, k.kid);
  const [h, p, s] = jwt.split('.');
  const chave = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: k.publica.x, y: k.publica.y }, format: 'jwk' });
  const ok = verificarNode('sha256', Buffer.from(`${h}.${p}`), { key: chave, dsaEncoding: 'ieee-p1363' }, Buffer.from(deB64url(s)));
  assert.equal(ok, true);
});

test('rejeita: aud errado, exp vencido, typ errado, iss errado', async () => {
  const { k, privada, passe } = await cenario();
  const jwt = await assinarJwt(passe, privada, k.kid);
  assert.deepEqual(await verificarJwt(jwt, [k.publica], esperado({ aud: 'painel-compras' })), { ok: false, motivo: 'aud' });
  assert.deepEqual(await verificarJwt(jwt, [k.publica], esperado({ agora: AGORA + 90 })), { ok: false, motivo: 'expirado' });
  assert.deepEqual(await verificarJwt(jwt, [k.publica], esperado({ agora: AGORA + 5000 })), { ok: false, motivo: 'expirado' });
  assert.deepEqual(await verificarJwt(jwt, [k.publica], esperado({ typ: 'sessao' })), { ok: false, motivo: 'typ' });
  assert.deepEqual(await verificarJwt(jwt, [k.publica], esperado({ iss: 'outro' })), { ok: false, motivo: 'iss' });

  // sessão não serve como passe (e vice-versa)
  const sessao = await assinarJwt({ ...passe, typ: 'sessao', exp: AGORA + 28800 }, privada, k.kid);
  assert.deepEqual(await verificarJwt(sessao, [k.publica], esperado()), { ok: false, motivo: 'typ' });
  assert.equal((await verificarJwt(sessao, [k.publica], esperado({ typ: 'sessao' }))).ok, true);

  // aud em lista não é aceito (só igualdade exata)
  const audLista = await assinarJwt({ ...passe, aud: ['gestao-finaceiro'] }, privada, k.kid);
  assert.deepEqual(await verificarJwt(audLista, [k.publica], esperado()), { ok: false, motivo: 'aud' });
  // sem exp, iat no futuro
  const { exp: _x, ...semExp } = passe;
  assert.deepEqual(await verificarJwt(await assinarJwt(semExp, privada, k.kid), [k.publica], esperado()), { ok: false, motivo: 'expirado' });
  const futuro = await assinarJwt({ ...passe, iat: AGORA + 3600, exp: AGORA + 3690 }, privada, k.kid);
  assert.deepEqual(await verificarJwt(futuro, [k.publica], esperado()), { ok: false, motivo: 'iat' });
});

test('rejeita: assinatura adulterada, payload trocado, alg none, kid desconhecido, chave de outro', async () => {
  const { k, privada, passe } = await cenario();
  const jwt = await assinarJwt(passe, privada, k.kid);
  const [h, p, s] = jwt.split('.');

  // um bit da assinatura
  const sig = deB64url(s);
  sig[10] ^= 1;
  assert.deepEqual(await verificarJwt(`${h}.${p}.${b64url(sig)}`, [k.publica], esperado()), { ok: false, motivo: 'assinatura' });

  // payload trocado com a assinatura antiga (e-mail de outra pessoa)
  const outro = b64url(new TextEncoder().encode(JSON.stringify({ ...passe, email: 'chefe@lube.com.br' })));
  assert.deepEqual(await verificarJwt(`${h}.${outro}.${s}`, [k.publica], esperado()), { ok: false, motivo: 'assinatura' });

  // alg none / HS256
  const none = b64url(new TextEncoder().encode(JSON.stringify({ alg: 'none', kid: k.kid })));
  assert.deepEqual(await verificarJwt(`${none}.${p}.`, [k.publica], esperado()), { ok: false, motivo: 'alg' });
  const hs = b64url(new TextEncoder().encode(JSON.stringify({ alg: 'HS256', kid: k.kid })));
  assert.deepEqual(await verificarJwt(`${hs}.${p}.${s}`, [k.publica], esperado()), { ok: false, motivo: 'alg' });

  // kid que não está entre as chaves ativas
  const k2 = await gerarChave();
  assert.deepEqual(await verificarJwt(jwt, [k2.publica], esperado()), { ok: false, motivo: 'kid_desconhecido' });

  // outra chave publicada com o mesmo kid não valida
  const impostora: JwkPublica = { ...k2.publica, kid: k.kid };
  assert.deepEqual(await verificarJwt(jwt, [impostora], esperado()), { ok: false, motivo: 'assinatura' });

  // assinatura truncada / formato quebrado
  assert.deepEqual(await verificarJwt(`${h}.${p}.${s.slice(0, 40)}`, [k.publica], esperado()), { ok: false, motivo: 'assinatura' });
  for (const lixo of ['', 'a.b', 'a.b.c', `${h}.${p}`, `${h}.${p}.${s}.x`, 'x'.repeat(5000), 42, null]) {
    const v = await verificarJwt(lixo, [k.publica], esperado());
    assert.equal(v.ok, false, String(lixo).slice(0, 20));
  }
});

test('chave errada: verificar com várias chaves escolhe pelo kid', async () => {
  const a = await cenario();
  const b = await gerarChave();
  const jwt = await assinarJwt(a.passe, a.privada, a.k.kid);
  const v = await verificarJwt(jwt, [b.publica, a.k.publica], esperado());
  assert.equal(v.ok, true);
});
