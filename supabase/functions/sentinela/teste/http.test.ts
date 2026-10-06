// Testes das utilidades HTTP: rotas, CORS, IP do cliente, corpo, URL do passe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bearer, cabecalhosCors, chaveLimite, criarLimitador, ehJson, ipCliente, lerCorpoLimitado, lerJson, montarUrlPasse,
  origemPermitida, rotaDe,
} from '../http.ts';

test('rotaDe: pelo final do pathname', () => {
  assert.equal(rotaDe('/functions/v1/sentinela/lista'), 'lista');
  assert.equal(rotaDe('/sentinela/evento'), 'evento');
  assert.equal(rotaDe('/sentinela/passe/'), 'passe');
  assert.equal(rotaDe('/sentinela/SAUDE'), 'saude');
  assert.equal(rotaDe('/sentinela'), '');
  assert.equal(rotaDe('/'), '');
});

test('CORS: só origem da lista recebe Allow-Origin', () => {
  const ok = cabecalhosCors('https://painel-lube-distribuidora.vercel.app');
  assert.equal(ok['access-control-allow-origin'], 'https://painel-lube-distribuidora.vercel.app');
  assert.equal(ok.vary, 'Origin');
  for (const o of ['https://painel-lube-distribuidora-lube-distribuidora-ltda.vercel.app', 'http://localhost:4321', 'http://127.0.0.1:4321']) {
    assert.equal(cabecalhosCors(o)['access-control-allow-origin'], o);
  }
  for (const ruim of ['https://evil.com', 'https://painel-lube-distribuidora.vercel.app.evil.com', 'http://painel-lube-distribuidora.vercel.app',
    'http://localhost:3000', 'null', '*', null]) {
    const h = cabecalhosCors(ruim);
    assert.equal('access-control-allow-origin' in h, false, String(ruim));
    assert.equal('access-control-allow-methods' in h, false);
    assert.equal(h.vary, 'Origin');
  }
});

test('ipCliente: cf-connecting-ip → x-real-ip → 1º do x-forwarded-for', () => {
  const h = (o: Record<string, string>) => new Headers(o);
  assert.equal(ipCliente(h({ 'cf-connecting-ip': '1.1.1.1', 'x-real-ip': '2.2.2.2', 'x-forwarded-for': '3.3.3.3' })), '1.1.1.1');
  assert.equal(ipCliente(h({ 'x-real-ip': '2.2.2.2', 'x-forwarded-for': '3.3.3.3' })), '2.2.2.2');
  assert.equal(ipCliente(h({ 'x-forwarded-for': '3.3.3.3, 10.0.0.1' })), '3.3.3.3');
  assert.equal(ipCliente(h({ 'x-forwarded-for': '2001:DB8::1, 10.0.0.1' })), '2001:db8::1');
  assert.equal(ipCliente(h({ 'cf-connecting-ip': 'lixo', 'x-real-ip': '2.2.2.2' })), null, 'cabeçalho presente e inválido não cai para o próximo');
  assert.equal(ipCliente(h({})), null);
});

test('bearer', () => {
  assert.equal(bearer(new Headers({ authorization: 'Bearer abc.def.ghi' })), 'abc.def.ghi');
  assert.equal(bearer(new Headers({ authorization: 'bearer   x ' })), 'x');
  assert.equal(bearer(new Headers({ authorization: 'Basic abc' })), null);
  assert.equal(bearer(new Headers({ authorization: 'Bearer a b' })), null);
  assert.equal(bearer(new Headers()), null);
});

test('lerCorpoLimitado: teto de 64 KB, mesmo com content-length mentiroso', async () => {
  const pedido = (corpo: string, extra: Record<string, string> = {}) =>
    new Request('https://x/sentinela/evento', { method: 'POST', body: corpo, headers: extra });
  assert.equal((await lerCorpoLimitado(pedido('{"a":1}')))!.length, 7);
  assert.equal(await lerCorpoLimitado(pedido('x'.repeat(65 * 1024))), null);
  assert.equal(await lerCorpoLimitado(pedido('x', { 'content-length': '999999' })), null);
  // corpo em pedaços (stream) sem content-length
  const stream = new ReadableStream({
    start(c) { for (let i = 0; i < 70; i++) c.enqueue(new Uint8Array(1024)); c.close(); },
  });
  const req = new Request('https://x/sentinela/evento', { method: 'POST', body: stream, duplex: 'half' } as RequestInit);
  assert.equal(await lerCorpoLimitado(req), null);
  assert.equal((await lerCorpoLimitado(pedido('x'.repeat(64 * 1024))))!.length, 64 * 1024);
});

test('lerJson: UTF-8 estrito', () => {
  assert.deepEqual(lerJson(new TextEncoder().encode('{"a":"ç"}')), { a: 'ç' });
  assert.equal(lerJson(new Uint8Array([0x7b, 0xff, 0x7d])), undefined);
  assert.equal(lerJson(new TextEncoder().encode('{a')), undefined);
});

test('montarUrlPasse: destino só com a mesma origem do sistema', () => {
  const sis = 'https://gestao-finaceiro.vercel.app';
  const u1 = new URL(montarUrlPasse(sis, 'https://gestao-finaceiro.vercel.app/relatorio?mes=9#topo', 'JWT')!);
  assert.equal(u1.pathname, '/relatorio');
  assert.equal(u1.searchParams.get('mes'), '9');
  assert.equal(u1.searchParams.get('sentinela_passe'), 'JWT');
  assert.equal(u1.hash, '#topo');
  for (const ruim of ['https://evil.com/x', 'http://gestao-finaceiro.vercel.app/x', 'https://gestao-finaceiro.vercel.app.evil.com/',
    'javascript:alert(1)', '//evil.com', 42, null]) {
    const u = new URL(montarUrlPasse(sis, ruim, 'JWT')!);
    assert.equal(u.origin, sis, String(ruim));
    assert.equal(u.pathname, '/');
  }
  // passe velho na URL é substituído; usuário:senha some
  const u2 = new URL(montarUrlPasse(sis, 'https://a:b@gestao-finaceiro.vercel.app/?sentinela_passe=velho&sentinela_passe=x', 'NOVO')!);
  assert.deepEqual(u2.searchParams.getAll('sentinela_passe'), ['NOVO']);
  assert.equal(u2.username, '');
  assert.equal(u2.password, '');
  // url do sistema inválida ou sem https
  assert.equal(montarUrlPasse('http://gestao-finaceiro.vercel.app', null, 'J'), null);
  assert.equal(montarUrlPasse('lixo', null, 'J'), null);
  assert.equal(montarUrlPasse(null, null, 'J'), null);
  // sem passe (sistema ainda sem guarda): mesma regra de destino, e nenhum sentinela_passe sobra
  assert.equal(montarUrlPasse(sis, 'https://a:b@gestao-finaceiro.vercel.app/r?x=1&sentinela_passe=velho', null),
    'https://gestao-finaceiro.vercel.app/r?x=1');
  assert.equal(montarUrlPasse(sis, 'https://evil.com/x', null), 'https://gestao-finaceiro.vercel.app/');
  assert.equal(montarUrlPasse('http://gestao-finaceiro.vercel.app', null, null), null);
});

test('criarLimitador: janela fixa por chave', () => {
  const lim = criarLimitador(3, 60_000, 2);
  assert.equal(lim('a', 0), true);
  assert.equal(lim('a', 1), true);
  assert.equal(lim('a', 2), true);
  assert.equal(lim('a', 3), false);
  assert.equal(lim('b', 3), true);
  assert.equal(lim('a', 60_001), true, 'janela nova');
  lim('c', 60_002); // capacidade 2: descarta a mais antiga
  assert.equal(lim('c', 60_003), true);
});

test('chaveLimite: IPv4 inteiro, IPv6 pelo /64', () => {
  assert.equal(chaveLimite('177.10.20.30'), '177.10.20.30');
  assert.equal(chaveLimite('2804:14c:1:2::c7'), '2804:14c:1:2::/64');
  assert.equal(chaveLimite('2804:014C:0001:0002:ffff:1:2:3'), '2804:14c:1:2::/64', 'mesmo /64 escrito de outro jeito');
  assert.notEqual(chaveLimite('2804:14c:1:3::1'), chaveLimite('2804:14c:1:2::1'));
  assert.equal(chaveLimite('::ffff:1.2.3.4'), '1.2.3.4', 'IPv4 mapeado conta como IPv4');
  assert.equal(chaveLimite(null), 'sem-ip');
  assert.equal(chaveLimite('lixo'), 'sem-ip');
});

test('origemPermitida e ehJson (POST do navegador)', () => {
  assert.equal(origemPermitida('https://painel-lube-distribuidora.vercel.app'), true);
  for (const o of [null, '', 'null', 'https://evil.example', 'https://painel-lube-distribuidora.vercel.app/']) {
    assert.equal(origemPermitida(o), false, String(o));
  }
  assert.equal(ehJson('application/json'), true);
  assert.equal(ehJson('Application/JSON; charset=utf-8'), true);
  for (const ct of [null, '', 'text/plain', 'text/plain;charset=UTF-8', 'application/x-www-form-urlencoded', 'multipart/form-data', 'application/jsonx']) {
    assert.equal(ehJson(ct), false, String(ct));
  }
});
