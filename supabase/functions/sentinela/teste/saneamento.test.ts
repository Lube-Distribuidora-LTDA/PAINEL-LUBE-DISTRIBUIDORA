// Testes do saneamento (§3.3). Rodar: node --test "teste/*.test.ts"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ambienteValido, ipValido, lerListaTor, origemReferer, rotulo, sanearEvento, sanearLote, texto, usuarioTentativa,
} from '../saneamento.ts';

const AGORA = Date.parse('2026-10-05T15:00:00.000Z');

const base = () => ({
  ts: '2026-10-05T14:59:58.000Z', metodo: 'GET', host: 'painel-compras-rosy.vercel.app', caminho: '/api/dados',
  consulta: '?a=b', tipo: 'api', ip: '200.150.10.20', pais: 'BR', regiao: 'ES', cidade: 'Cariacica',
  lat: -20.26, lon: -40.41, fuso: 'America/Sao_Paulo', ua: 'Mozilla/5.0', idioma: 'pt-BR,pt;q=0.9',
  referer: 'https://painel-lube-distribuidora.vercel.app/x?y=1', ja4: 't13d1516h2_8daaf6152771_02713d6af862',
  vercel_id: 'gru1::abcde-123', sec_fetch_site: 'same-origin', sec_fetch_mode: 'navigate', sec_fetch_dest: 'document',
  decisao: 'liberado', regra: null, motivo: null, identidade: 'Julio@Lube.com.br', identidade_origem: 'passe',
});

test('ipValido: IPv4 estrito', () => {
  assert.equal(ipValido('1.2.3.4'), '1.2.3.4');
  assert.equal(ipValido(' 200.150.10.20 '), '200.150.10.20');
  assert.equal(ipValido('255.255.255.255'), '255.255.255.255');
  for (const ruim of ['256.1.1.1', '01.2.3.4', '1.2.3', '1.2.3.4.5', '1.2.3.-4', '0x7f.0.0.1', '', 'abc', '<script>', '1.2.3.4/24']) {
    assert.equal(ipValido(ruim), null, ruim);
  }
  assert.equal(ipValido(12345), null);
  assert.equal(ipValido(null), null);
});

test('ipValido: IPv6 normalizado e mapeado', () => {
  assert.equal(ipValido('::1'), '::1');
  assert.equal(ipValido('::'), '::');
  assert.equal(ipValido('2001:DB8::1'), '2001:db8::1');
  assert.equal(ipValido('2001:0db8:0000:0000:0000:0000:0002:0001'), '2001:db8::2:1');
  assert.equal(ipValido('2001:db8:0:1:0:0:0:1'), '2001:db8:0:1::1');
  assert.equal(ipValido('1:2:3:4:5:6:7::'), '1:2:3:4:5:6:7:0');
  assert.equal(ipValido('::ffff:1.2.3.4'), '1.2.3.4');
  assert.equal(ipValido('::FFFF:c000:0201'), '192.0.2.1');
  assert.equal(ipValido('64:ff9b::192.0.2.33'), '64:ff9b::c000:221');
  for (const ruim of ['1::2::3', 'fe80::1%eth0', 'gggg::1', '1:2:3:4:5:6:7:8:9', '1:2:3:4:5:6:7', ':1.2.3.4', '[::1]', '2001:db8::/32']) {
    assert.equal(ipValido(ruim), null, ruim);
  }
});

test('sanearEvento: evento completo passa e campos extras somem', () => {
  const ev = sanearEvento({ ...base(), malicioso: 'sim', __proto__x: 1 }, AGORA)!;
  assert.ok(ev);
  assert.equal(ev.ip, '200.150.10.20');
  assert.equal(ev.ts, '2026-10-05T14:59:58.000Z');
  assert.equal(ev.referer, 'https://painel-lube-distribuidora.vercel.app');
  assert.equal(ev.identidade, 'julio@lube.com.br');
  assert.equal(ev.identidade_origem, 'passe');
  assert.equal('malicioso' in ev, false);
  assert.equal('__proto__x' in ev, false);
  assert.deepEqual(Object.keys(ev), [
    'ts', 'metodo', 'host', 'caminho', 'consulta', 'tipo', 'ip', 'pais', 'regiao', 'cidade', 'lat', 'lon', 'fuso', 'ua',
    'idioma', 'referer', 'ja4', 'vercel_id', 'sec_fetch_site', 'sec_fetch_mode', 'sec_fetch_dest', 'decisao', 'regra',
    'motivo', 'identidade', 'identidade_origem',
  ]);
});

test('sanearEvento: ip inválido ou decisão desconhecida → descartado', () => {
  assert.equal(sanearEvento({ ...base(), ip: '999.1.1.1' }, AGORA), null);
  assert.equal(sanearEvento({ ...base(), ip: undefined }, AGORA), null);
  assert.equal(sanearEvento({ ...base(), ip: "1.2.3.4'; drop table x;--" }, AGORA), null);
  assert.equal(sanearEvento({ ...base(), decisao: 'aprovado' }, AGORA), null);
  assert.equal(sanearEvento(null, AGORA), null);
  assert.equal(sanearEvento([base()], AGORA), null);
  assert.equal(sanearEvento('texto', AGORA), null);
});

test('sanearEvento: cortes de tamanho', () => {
  const longo = 'a'.repeat(5000);
  const ev = sanearEvento({
    ...base(), caminho: '/' + longo, consulta: '?' + longo, ua: longo, idioma: longo, motivo: longo,
    cidade: longo, regiao: longo, referer: 'https://' + 'b'.repeat(200) + '.com/caminho',
  }, AGORA)!;
  assert.equal(ev.caminho!.length, 300);
  assert.equal(ev.consulta!.length, 300);
  assert.equal(ev.ua!.length, 300);
  assert.equal(ev.idioma!.length, 60);
  assert.equal(ev.motivo!.length, 200);
  assert.equal(ev.cidade!.length, 80);
  assert.equal(ev.regiao!.length, 80);
  assert.ok(ev.referer!.length <= 120);
  assert.ok(!ev.referer!.includes('/caminho'));
});

test('sanearEvento: enums validados', () => {
  const ev = sanearEvento({ ...base(), tipo: 'xpto', identidade_origem: 'provavel' }, AGORA)!;
  assert.equal(ev.tipo, 'outro');
  assert.equal(ev.identidade_origem, null);
  assert.equal(ev.identidade, null, 'identidade sem origem válida não entra');
  for (const t of ['pagina', 'api', 'arquivo', 'outro']) assert.equal(sanearEvento({ ...base(), tipo: t }, AGORA)!.tipo, t);
  for (const dd of ['liberado', 'observado', 'bloqueado']) assert.equal(sanearEvento({ ...base(), decisao: dd }, AGORA)!.decisao, dd);
  assert.equal(sanearEvento({ ...base(), identidade_origem: 'sessao_app' }, AGORA)!.identidade_origem, 'sessao_app');
  assert.equal(sanearEvento({ ...base(), identidade: 'não é email' }, AGORA)!.identidade_origem, null);
  assert.equal(sanearEvento({ ...base(), regra: 'Lista; DROP' }, AGORA)!.regra, null);
  assert.equal(sanearEvento({ ...base(), regra: 'arquivo_proibido' }, AGORA)!.regra, 'arquivo_proibido');
  assert.equal(sanearEvento({ ...base(), metodo: 'get' }, AGORA)!.metodo, 'GET');
  assert.equal(sanearEvento({ ...base(), metodo: 'G E T' }, AGORA)!.metodo, null);
  assert.equal(sanearEvento({ ...base(), pais: 'br' }, AGORA)!.pais, 'BR');
  assert.equal(sanearEvento({ ...base(), pais: 'B1' }, AGORA)!.pais, null);
  assert.equal(sanearEvento({ ...base(), sec_fetch_mode: 'navigate<x>' }, AGORA)!.sec_fetch_mode, null);
});

test('sanearEvento: lat/lon numéricos em faixa (ou os dois null)', () => {
  let ev = sanearEvento({ ...base(), lat: '-20.2632', lon: '-40.4165' }, AGORA)!;
  assert.equal(ev.lat, -20.2632);
  assert.equal(ev.lon, -40.4165);
  ev = sanearEvento({ ...base(), lat: 91, lon: 10 }, AGORA)!;
  assert.equal(ev.lat, null);
  assert.equal(ev.lon, null);
  ev = sanearEvento({ ...base(), lat: 10, lon: 'abc' }, AGORA)!;
  assert.equal(ev.lat, null);
  ev = sanearEvento({ ...base(), lat: NaN, lon: 1 }, AGORA)!;
  assert.equal(ev.lat, null);
  ev = sanearEvento({ ...base(), lat: '1e5', lon: 1 }, AGORA)!;
  assert.equal(ev.lat, null);
});

test('sanearEvento: ts inválido ou absurdo → agora', () => {
  const agoraIso = new Date(AGORA).toISOString();
  assert.equal(sanearEvento({ ...base(), ts: 'ontem' }, AGORA)!.ts, agoraIso);
  assert.equal(sanearEvento({ ...base(), ts: 123 }, AGORA)!.ts, agoraIso);
  assert.equal(sanearEvento({ ...base(), ts: '2030-01-01T00:00:00Z' }, AGORA)!.ts, agoraIso);
  assert.equal(sanearEvento({ ...base(), ts: '2020-01-01T00:00:00Z' }, AGORA)!.ts, agoraIso);
});

test('sanearEvento: controle, NUL e surrogate solto não chegam ao banco', () => {
  const ev = sanearEvento({ ...base(), ua: 'curl/8.0\u0000\r\nX-Injetado: 1', caminho: '/a\ud800b', cidade: 'Vitória\u0007' }, AGORA)!;
  assert.equal(ev.ua, 'curl/8.0   X-Injetado: 1');
  assert.equal(ev.caminho, '/ab');
  assert.equal(ev.cidade, 'Vitória');
  // emoji (par de surrogates) cortado no meio não deixa metade
  const meio = sanearEvento({ ...base(), motivo: 'x'.repeat(199) + '😀' }, AGORA)!;
  assert.equal(meio.motivo, 'x'.repeat(199));
  assert.doesNotThrow(() => JSON.stringify(meio));
});

test('origemReferer: só http(s), só a origem', () => {
  assert.equal(origemReferer('https://a.com/b?c=d#e'), 'https://a.com');
  assert.equal(origemReferer('javascript:alert(1)'), null);
  assert.equal(origemReferer('lixo'), null);
  assert.equal(origemReferer(42), null);
});

test('sanearLote: formato, máximo de 20 e contagem de inválidos', () => {
  assert.deepEqual(sanearLote(null, AGORA), { ok: false, erro: 'corpo_invalido', detalhe: 'esperado {"eventos":[...]}' });
  assert.equal(sanearLote({ eventos: 'x' }, AGORA).ok, false);
  const demais = sanearLote({ eventos: Array.from({ length: 21 }, base) }, AGORA);
  assert.equal(demais.ok, false);
  assert.equal(!demais.ok && demais.erro, 'eventos_demais');
  const r = sanearLote({ eventos: [base(), { ...base(), ip: 'x' }, base()] }, AGORA);
  assert.ok(r.ok);
  assert.equal(r.ok && r.eventos.length, 2);
  assert.equal(r.ok && r.invalidos, 1);
  assert.equal(sanearLote({ eventos: Array.from({ length: 20 }, base) }, AGORA).ok, true);
});

test('textos de cabeçalho e navegador', () => {
  assert.equal(texto('  oi  ', 10), 'oi');
  assert.equal(texto('', 10), null);
  assert.equal(texto(5, 10), null);
  assert.equal(rotulo('sentinela-guarda/1.0.0'), 'sentinela-guarda/1.0.0');
  assert.equal(rotulo('a b'), null);
  assert.equal(ambienteValido('Preview'), 'preview');
  assert.equal(ambienteValido('x y'), 'production');
  assert.equal(ambienteValido(undefined), 'production');
  assert.equal(usuarioTentativa('  JULIO.Alves '), 'julio.alves');
  assert.equal(usuarioTentativa('A'.repeat(200))!.length, 80);
  assert.equal(usuarioTentativa(''), null);
  assert.equal(usuarioTentativa({ a: 1 }), null);
});

test('lerListaTor: ignora comentário, lixo e repetido', () => {
  const ips = lerListaTor('# comentário\n1.2.3.4\r\n1.2.3.4\nlixo\n\n2001:db8::1\n999.0.0.1\n5.6.7.8');
  assert.deepEqual(ips, ['1.2.3.4', '2001:db8::1', '5.6.7.8']);
});
