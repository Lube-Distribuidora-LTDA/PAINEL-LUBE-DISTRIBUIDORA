// Testes do plano B HMAC do guarda (§3.2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { assinarHmac, iguais, lerAssinatura, verificarHmac } from '../hmac.ts';

const CHAVE = 'k'.repeat(16) + '-segredo-de-teste-0123456789';
const enc = new TextEncoder();
const AGORA = 1_790_000_000;
const CORPO = enc.encode('{"eventos":[{"ip":"1.2.3.4","decisao":"liberado"}]}');

test('assinarHmac bate com o HMAC-SHA256 do node:crypto sobre `${t}.${corpo}`', async () => {
  const hex = await assinarHmac(CHAVE, AGORA, CORPO);
  const esperado = createHmac('sha256', CHAVE).update(`${AGORA}.`).update(CORPO).digest('hex');
  assert.equal(hex, esperado);
});

test('verifica dentro da janela de 300 s (nos dois sentidos)', async () => {
  const t = AGORA;
  const cab = `t=${t},v1=${await assinarHmac(CHAVE, t, CORPO)}`;
  assert.deepEqual(await verificarHmac(CHAVE, cab, CORPO, AGORA), { ok: true, t });
  assert.equal((await verificarHmac(CHAVE, cab, CORPO, AGORA + 300)).ok, true);
  assert.equal((await verificarHmac(CHAVE, cab, CORPO, AGORA - 300)).ok, true);
  assert.deepEqual(await verificarHmac(CHAVE, cab, CORPO, AGORA + 301), { ok: false, motivo: 'fora_da_janela' });
  assert.deepEqual(await verificarHmac(CHAVE, cab, CORPO, AGORA - 301), { ok: false, motivo: 'fora_da_janela' });
});

test('GET: corpo vazio', async () => {
  const vazio = new Uint8Array(0);
  const cab = `t=${AGORA},v1=${await assinarHmac(CHAVE, AGORA, vazio)}`;
  assert.equal((await verificarHmac(CHAVE, cab, vazio, AGORA)).ok, true);
  assert.equal((await verificarHmac(CHAVE, cab, enc.encode('x'), AGORA)).ok, false);
});

test('rejeita adulteração: corpo, assinatura, t, chave', async () => {
  const sig = await assinarHmac(CHAVE, AGORA, CORPO);
  const cab = `t=${AGORA},v1=${sig}`;
  const corpo2 = enc.encode('{"eventos":[{"ip":"9.9.9.9","decisao":"liberado"}]}');
  assert.deepEqual(await verificarHmac(CHAVE, cab, corpo2, AGORA), { ok: false, motivo: 'assinatura' });
  const trocada = sig.slice(0, -1) + (sig.endsWith('0') ? '1' : '0');
  assert.deepEqual(await verificarHmac(CHAVE, `t=${AGORA},v1=${trocada}`, CORPO, AGORA), { ok: false, motivo: 'assinatura' });
  assert.deepEqual(await verificarHmac(CHAVE, `t=${AGORA + 1},v1=${sig}`, CORPO, AGORA), { ok: false, motivo: 'assinatura' });
  assert.deepEqual(await verificarHmac('outra-chave-com-mais-de-32-caracteres!!', cab, CORPO, AGORA), { ok: false, motivo: 'assinatura' });
  // hex em maiúsculas é a mesma assinatura
  assert.equal((await verificarHmac(CHAVE, `t=${AGORA},v1=${sig.toUpperCase()}`, CORPO, AGORA)).ok, true);
});

test('formato do cabeçalho e chave fraca', async () => {
  const sig = await assinarHmac(CHAVE, AGORA, CORPO);
  for (const ruim of [null, '', 'v1=' + sig, `t=${AGORA}`, `t=abc,v1=${sig}`, `t=${AGORA},v1=zz`, `t=${AGORA},v1=${sig},x=1`, `t=${AGORA};v1=${sig}`]) {
    assert.equal((await verificarHmac(CHAVE, ruim, CORPO, AGORA)).ok, false, String(ruim));
  }
  assert.deepEqual(lerAssinatura(` t=${AGORA} , v1=${sig} `), { t: AGORA, tTexto: String(AGORA), v1: sig });
  assert.deepEqual(await verificarHmac('curta', `t=${AGORA},v1=${sig}`, CORPO, AGORA), { ok: false, motivo: 'sem_chave' });
  assert.deepEqual(await verificarHmac('', `t=${AGORA},v1=${sig}`, CORPO, AGORA), { ok: false, motivo: 'sem_chave' });
});

test('iguais: compara tudo, inclusive tamanho', () => {
  assert.equal(iguais(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3])), true);
  assert.equal(iguais(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4])), false);
  assert.equal(iguais(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2])), false);
  assert.equal(iguais(new Uint8Array([1, 2]), new Uint8Array([1, 2, 0])), false);
});
