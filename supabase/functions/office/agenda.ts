// =========================================================
// LUBE OFFICE — Agenda: o convite por e-mail (.ics) e o texto do e-mail
// Funções puras, testadas no Node (teste/agenda.test.mjs). O banco monta a "carta"
// (office.carta) e aqui ela vira o .ics do iTIP (RFC 5546), que o Gmail, o Outlook e a
// agenda do celular entendem: REQUEST convida ou atualiza, CANCEL cancela. A série vai com
// RRULE e EXDATE; uma ocorrência solta, com RECURRENCE-ID. Horário em UTC (Z); reunião de
// dia inteiro vai em data (VALUE=DATE), no dia de Brasília.
// Tudo o que vem da pessoa (título, descrição, nomes) é escapado no .ics e no HTML.
// =========================================================

export type Participante = { nome: string; email: string; resposta: string };
export type Componente = {
  titulo: string; descricao: string; local: string; inicio: string; fim: string; dia_inteiro: boolean;
  status: 'CONFIRMED' | 'CANCELLED'; participantes: Participante[];
  rrule?: { freq: string; ate: string } | null; exdates?: string[] | null; recorrencia?: string | null;
};
export type Carta = {
  metodo: 'REQUEST' | 'CANCEL'; uid: string; sequencia: number; evento: string;
  organizador: { nome: string; email: string }; para: { nome: string; email: string }[]; componentes: Componente[];
};

const DOMINIO = 'office.lube.com.br';
const FUSO = 'America/Sao_Paulo';
const PARTSTAT: Record<string, string> = { pendente: 'NEEDS-ACTION', sim: 'ACCEPTED', nao: 'DECLINED', talvez: 'TENTATIVE' };
const RRULE: Record<string, string> = {
  dia: 'FREQ=DAILY', dia_util: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', semana: 'FREQ=WEEKLY', mes: 'FREQ=MONTHLY',
};
const REPETE: Record<string, string> = { dia: 'todo dia', dia_util: 'todo dia útil', semana: 'toda semana', mes: 'todo mês' };

// texto de propriedade: \ ; , e quebra de linha escapados
export function escaparIcs(s: unknown) {
  return String(s ?? '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/[,;]/g, (m) => '\\' + m);
}
// parâmetro entre aspas (CN): sem aspas nem quebra de linha
function parametro(s: unknown) {
  return '"' + String(s ?? '').replace(/["\r\n\t]/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, 80) + '"';
}
// e-mail sem nada que quebre a linha do .ics
function emailLimpo(s: unknown) {
  return String(s ?? '').trim().toLowerCase().replace(/[^a-z0-9.!#$%&'*+/=?^_`{|}~@-]/g, '');
}

// linhas de até 75 bytes (UTF-8); a continuação começa com espaço (conta no limite)
export function dobrar(linha: string) {
  const enc = new TextEncoder();
  const partes: string[] = [];
  let atual = '';
  let tam = 0;
  for (const ch of linha) {
    const b = enc.encode(ch).length;
    const lim = partes.length ? 74 : 75;
    if (tam + b > lim) { partes.push(atual); atual = ch; tam = b; } else { atual += ch; tam += b; }
  }
  partes.push(atual);
  return partes.join('\r\n ');
}

export function dataUtc(iso: string | Date) {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}
// o dia em Brasília (AAAAMMDD)
export function diaBrasilia(iso: string | Date) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
  return p.replace(/-/g, '');
}
function quando(c: Componente, iso: string | null | undefined, nome: string) {
  if (!iso) return [];
  return c.dia_inteiro ? [`${nome};VALUE=DATE:${diaBrasilia(iso)}`] : [`${nome}:${dataUtc(iso)}`];
}
// fim da série: último segundo do dia "ate" em Brasília (em UTC), ou a data, se for dia inteiro
function ateRrule(c: Componente, ate: string) {
  if (c.dia_inteiro) return ate.replace(/-/g, '');
  const fimDoDia = new Date(new Date(`${ate}T00:00:00-03:00`).getTime() + 86_400_000 - 1000);
  return dataUtc(fimDoDia);
}

function vevento(carta: Carta, c: Componente, link: string, agora: Date) {
  const l: string[] = ['BEGIN:VEVENT', `UID:${carta.uid}@${DOMINIO}`, `DTSTAMP:${dataUtc(agora)}`, `SEQUENCE:${Math.max(0, Math.floor(carta.sequencia || 0))}`];
  l.push(...quando(c, c.recorrencia, 'RECURRENCE-ID'));
  l.push(...quando(c, c.inicio, 'DTSTART'));
  l.push(...quando(c, c.fim, 'DTEND'));
  if (c.rrule && RRULE[c.rrule.freq] && /^\d{4}-\d{2}-\d{2}$/.test(c.rrule.ate)) {
    l.push(`RRULE:${RRULE[c.rrule.freq]};UNTIL=${ateRrule(c, c.rrule.ate)}`);
    for (const ex of (c.exdates ?? []).slice(0, 400)) l.push(...quando(c, ex, 'EXDATE'));
  }
  l.push(`SUMMARY:${escaparIcs(c.titulo)}`);
  const desc = [c.descricao?.trim(), `Abrir no painel: ${link}`].filter(Boolean).join('\n\n');
  l.push(`DESCRIPTION:${escaparIcs(desc)}`);
  if (c.local) l.push(`LOCATION:${escaparIcs(c.local)}`);
  l.push(`URL:${link}`);
  l.push(`ORGANIZER;CN=${parametro(carta.organizador.nome)}:mailto:${emailLimpo(carta.organizador.email)}`);
  for (const p of (c.participantes ?? []).slice(0, 100)) {
    const em = emailLimpo(p.email);
    if (!em) continue;
    l.push(`ATTENDEE;CN=${parametro(p.nome || em)};ROLE=REQ-PARTICIPANT;PARTSTAT=${PARTSTAT[p.resposta] ?? 'NEEDS-ACTION'};RSVP=TRUE:mailto:${em}`);
  }
  l.push(`STATUS:${carta.metodo === 'CANCEL' || c.status === 'CANCELLED' ? 'CANCELLED' : 'CONFIRMED'}`);
  l.push('TRANSP:OPAQUE');
  if (carta.metodo === 'REQUEST' && !c.dia_inteiro && !c.recorrencia) {
    l.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escaparIcs(c.titulo)}`, 'TRIGGER:-PT15M', 'END:VALARM');
  }
  l.push('END:VEVENT');
  return l;
}

export function montarIcs(carta: Carta, link: string, agora = new Date()) {
  const l = ['BEGIN:VCALENDAR', 'PRODID:-//Lube Distribuidora//LUBE OFFICE Agenda//PT-BR', 'VERSION:2.0', 'CALSCALE:GREGORIAN',
    `METHOD:${carta.metodo === 'CANCEL' ? 'CANCEL' : 'REQUEST'}`];
  for (const c of carta.componentes) l.push(...vevento(carta, c, link, agora));
  l.push('END:VCALENDAR');
  return l.map(dobrar).join('\r\n') + '\r\n';
}

/* ---------- o e-mail ---------- */
function esc(s: unknown) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
function linhaUnica(s: unknown, max = 150) {
  return String(s ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, max);
}
const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
function partes(iso: string) {
  const d = new Date(iso);
  const [y, m, dd] = new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d).split('-');
  const hora = new Intl.DateTimeFormat('en-GB', { timeZone: FUSO, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
  return { semana: DIAS[new Date(Date.UTC(+y, +m - 1, +dd)).getUTCDay()], dia: `${dd}/${m}`, hora };
}
// "qua, 04/11, das 10:00 às 11:00" · "qua, 04/11 (dia todo)" · "toda semana, a partir de qua, 04/11, das 10:00 às 11:00"
export function quandoTexto(c: Componente) {
  const a = partes(c.inicio);
  let t: string;
  if (c.dia_inteiro) {
    const ultimo = partes(new Date(new Date(c.fim).getTime() - 1000).toISOString());
    t = ultimo.dia === a.dia ? `${a.semana}, ${a.dia} (dia todo)` : `${a.semana}, ${a.dia} a ${ultimo.semana}, ${ultimo.dia} (dia todo)`;
  } else {
    const b = partes(c.fim);
    t = b.dia === a.dia ? `${a.semana}, ${a.dia}, das ${a.hora} às ${b.hora}` : `${a.semana}, ${a.dia} às ${a.hora} até ${b.semana}, ${b.dia} às ${b.hora}`;
  }
  if (c.rrule && REPETE[c.rrule.freq]) {
    const [y, m, d] = c.rrule.ate.split('-');
    t = `${REPETE[c.rrule.freq]} até ${d}/${m}/${y}, a partir de ${t}`;
  }
  return t;
}

export function montarEmailConvite(carta: Carta, link: string) {
  const c = carta.componentes[0];
  const titulo = linhaUnica(c.titulo, 120);
  const organizador = linhaUnica(carta.organizador.nome, 80) || 'Lube Distribuidora';
  const qd = quandoTexto(c);
  const cancelado = carta.metodo === 'CANCEL';
  const tipo = cancelado ? 'Cancelado' : carta.sequencia > 0 ? 'Atualizado' : 'Convite';
  const assunto = linhaUnica(`${tipo}: ${titulo} · ${qd}`, 180);
  const chamada = cancelado
    ? `${organizador} cancelou a reunião`
    : carta.sequencia > 0 ? `${organizador} mudou a reunião` : `${organizador} convidou você para uma reunião`;
  const pessoas = (c.participantes ?? []).map((p) => p.nome || p.email).filter(Boolean);
  const texto = [
    `${chamada} pelo LUBE OFFICE, da Lube Distribuidora.`,
    '',
    titulo,
    `Quando: ${qd}`,
    c.local ? `Onde: ${c.local}` : '',
    `Quem marcou: ${organizador} (${carta.organizador.email})`,
    pessoas.length ? `Convidados: ${pessoas.join(', ')}` : '',
    c.descricao?.trim() ? `\n${c.descricao.trim()}\n` : '',
    cancelado ? 'O convite em anexo tira a reunião da sua agenda.' : 'O convite em anexo põe a reunião na sua agenda (Gmail, Outlook ou celular).',
    `Abrir no painel: ${link}`,
    '',
    'Lube Distribuidora · desde 1959 · Cariacica-ES',
  ].filter((x) => x !== '').join('\n');
  const linha = (rotulo: string, valor: string) =>
    `<tr><td style="padding:6px 0;width:110px;color:#5C6480;font-size:13px;vertical-align:top">${rotulo}</td>` +
    `<td style="padding:6px 0;font-size:14px;color:#1B2140">${valor}</td></tr>`;
  const html =
    '<!doctype html><html lang="pt-BR"><body style="margin:0;padding:0;background:#EEF0F7;font-family:Arial,Helvetica,sans-serif;color:#1B2140">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EEF0F7;padding:24px 0"><tr><td align="center">' +
    '<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#FFFFFF;border-radius:12px;overflow:hidden">' +
    '<tr><td style="background:#0D176E;padding:22px 28px;color:#FFFFFF">' +
    '<div style="font-size:20px;font-weight:800;letter-spacing:-0.3px">LUBE <span style="color:#FF5A63">OFFICE</span> · Agenda</div>' +
    '<div style="font-size:12px;color:#C9D0F0;margin-top:4px">Lube Distribuidora</div></td></tr>' +
    `<tr><td style="height:5px;background:${cancelado ? '#5C6480' : '#E5101F'};font-size:0;line-height:0">&nbsp;</td></tr>` +
    '<tr><td style="padding:28px">' +
    `<p style="margin:0 0 10px;font-size:15px;line-height:1.5">${esc(chamada)}</p>` +
    `<p style="margin:0 0 18px;font-size:20px;font-weight:700;color:#0D176E${cancelado ? ';text-decoration:line-through' : ''}">${esc(titulo)}</p>` +
    '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 18px">' +
    linha('Quando', esc(qd)) +
    (c.local ? linha('Onde', esc(c.local)) : '') +
    linha('Quem marcou', `${esc(organizador)} &lt;${esc(carta.organizador.email)}&gt;`) +
    (pessoas.length ? linha('Convidados', esc(pessoas.slice(0, 20).join(', ') + (pessoas.length > 20 ? ` e mais ${pessoas.length - 20}` : ''))) : '') +
    '</table>' +
    (c.descricao?.trim()
      ? `<div style="margin:0 0 20px;padding:14px 16px;background:#F4F6FB;border-left:4px solid #E5101F;border-radius:6px;font-size:14px;line-height:1.55;white-space:pre-wrap">${esc(c.descricao.trim())}</div>`
      : '') +
    `<p style="margin:0 0 18px;font-size:14px;line-height:1.5">${cancelado
      ? 'O convite em anexo tira a reunião da sua agenda.'
      : 'O convite em anexo põe a reunião na sua agenda: Gmail, Outlook ou o calendário do celular.'}</p>` +
    `<a href="${esc(link)}" style="display:inline-block;background:#E5101F;color:#FFFFFF;text-decoration:none;font-weight:700;font-size:14px;padding:12px 20px;border-radius:8px">Abrir no painel</a>` +
    '</td></tr>' +
    '<tr><td style="padding:16px 28px;background:#F4F6FB;font-size:11px;color:#5C6480">Lube Distribuidora · desde 1959 · Cariacica-ES</td></tr>' +
    '</table></td></tr></table></body></html>';
  return { assunto, texto, html };
}
