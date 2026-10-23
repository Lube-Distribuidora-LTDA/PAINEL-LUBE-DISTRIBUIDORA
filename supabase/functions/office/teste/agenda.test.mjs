// Testes do convite da Agenda (.ics do iTIP e o e-mail).
// Rodar: node --test supabase/functions/office/teste/agenda.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dataUtc, diaBrasilia, dobrar, escaparIcs, montarEmailConvite, montarIcs, quandoTexto } from '../agenda.ts';

const LINK = 'https://painel-lube-distribuidora.vercel.app/office/?v=agenda&evento=e1';
const AGORA = new Date('2026-10-23T12:00:00Z');
const pessoa = (nome, email, resposta = 'pendente') => ({ nome, email, resposta });

function carta(extra = {}, comp = {}) {
  return {
    metodo: 'REQUEST', uid: 'e1', sequencia: 0, evento: 'e1',
    organizador: { nome: 'Júlio Alves', email: 'julio@lube.com.br' },
    para: [{ nome: 'Ana', email: 'ana@lube.com.br' }],
    componentes: [{
      titulo: 'Reunião comercial', descricao: 'Pauta: metas; preços, prazos', local: 'Sala 1 (1º andar)',
      inicio: '2026-11-03T17:00:00Z', fim: '2026-11-03T18:00:00Z', dia_inteiro: false, status: 'CONFIRMED',
      participantes: [pessoa('Ana', 'ana@lube.com.br'), pessoa('', 'cliente@empresa.com.br', 'sim')], ...comp,
    }],
    ...extra,
  };
}
const linhas = (ics) => ics.replace(/\r\n /g, '').split('\r\n');

test('reunião simples: REQUEST com horário em UTC, organizador, convidados e lembrete', () => {
  const ics = montarIcs(carta(), LINK, AGORA);
  const l = linhas(ics);
  assert.ok(ics.endsWith('\r\n'));
  assert.ok(!/[^\r]\n/.test(ics), 'só CRLF');
  assert.equal(l[0], 'BEGIN:VCALENDAR');
  assert.ok(l.includes('METHOD:REQUEST'));
  assert.ok(l.includes('UID:e1@office.lube.com.br'));
  assert.ok(l.includes('SEQUENCE:0'));
  assert.ok(l.includes('DTSTART:20261103T170000Z'));
  assert.ok(l.includes('DTEND:20261103T180000Z'));
  assert.ok(l.includes('DTSTAMP:20261023T120000Z'));
  assert.ok(l.includes('SUMMARY:Reunião comercial'));
  assert.ok(l.some((x) => x.startsWith('DESCRIPTION:Pauta: metas\\; preços\\, prazos\\n\\nAbrir no painel: ')));
  assert.ok(l.includes('ORGANIZER;CN="Júlio Alves":mailto:julio@lube.com.br'));
  assert.ok(l.includes('ATTENDEE;CN="Ana";ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:ana@lube.com.br'));
  assert.ok(l.includes('ATTENDEE;CN="cliente@empresa.com.br";ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;RSVP=TRUE:mailto:cliente@empresa.com.br'));
  assert.ok(l.includes('STATUS:CONFIRMED'));
  assert.ok(l.includes('TRIGGER:-PT15M'));
  assert.ok(!l.some((x) => x.startsWith('RRULE')));
});

test('linhas de até 75 bytes, mesmo com acento', () => {
  const longa = carta({}, { descricao: 'Ação '.repeat(80) });
  const ics = montarIcs(longa, LINK, AGORA);
  for (const fis of ics.split('\r\n')) assert.ok(Buffer.byteLength(fis, 'utf8') <= 75, fis);
  // desdobrar devolve o texto inteiro
  assert.ok(linhas(ics).some((x) => x.includes('Ação Ação Ação')));
  assert.equal(dobrar('a'.repeat(75)), 'a'.repeat(75));
  assert.equal(dobrar('a'.repeat(76)), 'a'.repeat(75) + '\r\n a');
});

test('escapa o que quebraria o .ics e não deixa injetar linha', () => {
  assert.equal(escaparIcs('a,b;c\\d\ne'), 'a\\,b\\;c\\\\d\\ne');
  const ruim = carta({ organizador: { nome: 'X"\r\nATTENDEE:mailto:evil@x.com', email: 'x@lube.com.br\r\nBCC:y@z.com' } },
                     { titulo: 'Oi\r\nATTENDEE:mailto:evil@x.com' });
  const l = linhas(montarIcs(ruim, LINK, AGORA));
  assert.ok(!l.some((x) => x.startsWith('ATTENDEE:mailto:evil')));
  assert.ok(!l.some((x) => x.startsWith('BCC')));
  assert.ok(l.includes('SUMMARY:Oi\\nATTENDEE:mailto:evil@x.com'));
});

test('série: RRULE com fim no último segundo do dia, EXDATE e ocorrência que foge do padrão', () => {
  const c = carta({ uid: 's1', sequencia: 3 }, {
    inicio: '2026-11-04T14:00:00Z', fim: '2026-11-04T15:00:00Z',
    rrule: { freq: 'semana', ate: '2026-12-02' }, exdates: ['2026-11-25T14:00:00Z'],
  });
  c.componentes.push({ ...c.componentes[0], rrule: null, exdates: null, inicio: '2026-11-11T13:00:00Z', fim: '2026-11-11T14:00:00Z',
                       recorrencia: '2026-11-11T14:00:00Z' });
  const l = linhas(montarIcs(c, LINK, AGORA));
  assert.ok(l.includes('RRULE:FREQ=WEEKLY;UNTIL=20261203T025959Z'));
  assert.ok(l.includes('EXDATE:20261125T140000Z'));
  assert.ok(l.includes('RECURRENCE-ID:20261111T140000Z'));
  assert.equal(l.filter((x) => x === 'BEGIN:VEVENT').length, 2);
  assert.equal(l.filter((x) => x === 'UID:s1@office.lube.com.br').length, 2);
  assert.ok(l.includes('SEQUENCE:3'));
  const util = linhas(montarIcs(carta({}, { rrule: { freq: 'dia_util', ate: '2026-11-30' } }), LINK, AGORA));
  assert.ok(util.some((x) => x.startsWith('RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;UNTIL=')));
});

test('dia inteiro: datas de Brasília (VALUE=DATE), sem lembrete', () => {
  const c = carta({}, { dia_inteiro: true, inicio: '2026-11-06T03:00:00Z', fim: '2026-11-07T03:00:00Z',
                        rrule: { freq: 'mes', ate: '2027-03-06' } });
  const l = linhas(montarIcs(c, LINK, AGORA));
  assert.ok(l.includes('DTSTART;VALUE=DATE:20261106'));
  assert.ok(l.includes('DTEND;VALUE=DATE:20261107'));
  assert.ok(l.includes('RRULE:FREQ=MONTHLY;UNTIL=20270306'));
  assert.ok(!l.some((x) => x.startsWith('TRIGGER')));
  assert.equal(diaBrasilia('2026-11-07T02:59:00Z'), '20261106');
  assert.equal(dataUtc('2026-11-03T17:00:00.000Z'), '20261103T170000Z');
});

test('cancelamento: METHOD e STATUS CANCEL, sem lembrete, com RECURRENCE-ID da ocorrência', () => {
  const c = carta({ metodo: 'CANCEL', uid: 's1', sequencia: 2 }, { recorrencia: '2026-11-25T14:00:00Z', status: 'CANCELLED' });
  const l = linhas(montarIcs(c, LINK, AGORA));
  assert.ok(l.includes('METHOD:CANCEL'));
  assert.ok(l.includes('STATUS:CANCELLED'));
  assert.ok(l.includes('RECURRENCE-ID:20261125T140000Z'));
  assert.ok(!l.some((x) => x.startsWith('TRIGGER')));
});

test('e-mail: assunto com o quando em Brasília, nome escapado no HTML', () => {
  assert.equal(quandoTexto(carta().componentes[0]), 'ter, 03/11, das 14:00 às 15:00');
  const e = montarEmailConvite(carta(), LINK);
  assert.equal(e.assunto, 'Convite: Reunião comercial · ter, 03/11, das 14:00 às 15:00');
  assert.ok(e.texto.includes('Júlio Alves convidou você para uma reunião'));
  assert.ok(e.html.includes('Abrir no painel'));
  const mudou = montarEmailConvite(carta({ sequencia: 1 }), LINK);
  assert.ok(mudou.assunto.startsWith('Atualizado: '));
  const canc = montarEmailConvite(carta({ metodo: 'CANCEL', sequencia: 2 }), LINK);
  assert.ok(canc.assunto.startsWith('Cancelado: '));
  assert.ok(canc.texto.includes('cancelou a reunião'));
  const xss = montarEmailConvite(carta({ organizador: { nome: '<script>x</script>', email: 'a@b.com' } }, { titulo: '<b>oi</b>' }), LINK);
  assert.ok(!xss.html.includes('<script>'));
  assert.ok(xss.html.includes('&lt;b&gt;oi&lt;/b&gt;'));
  const serie = quandoTexto({ ...carta().componentes[0], rrule: { freq: 'semana', ate: '2026-12-02' } });
  assert.equal(serie, 'toda semana até 02/12/2026, a partir de ter, 03/11, das 14:00 às 15:00');
  const dia = quandoTexto({ ...carta().componentes[0], dia_inteiro: true, inicio: '2026-11-06T03:00:00Z', fim: '2026-11-07T03:00:00Z' });
  assert.equal(dia, 'sex, 06/11 (dia todo)');
});
