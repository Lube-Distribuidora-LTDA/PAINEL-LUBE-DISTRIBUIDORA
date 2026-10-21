// =========================================================
// LUBE OFFICE — o e-mail do "Enviar" (texto e HTML com a marca da Lube)
// Função pura, testada no Node (teste/motor.test.mjs). Tudo o que vem da
// pessoa (nome, mensagem, nome do arquivo) é escapado.
// =========================================================

export const LIMITE_EMAIL_BYTES = 20 * 1024 * 1024;   // anexo maior que isso não passa nos servidores de e-mail

const MIME: Record<string, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  pdf: 'application/pdf', csv: 'text/csv', txt: 'text/plain',
};

export function tipoMime(extensao: string) {
  return MIME[String(extensao || '').toLowerCase()] ?? 'application/octet-stream';
}

function esc(s: unknown) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

// nada de quebra de linha em cabeçalho (assunto, nome do remetente)
export function linhaUnica(s: unknown, max = 150) {
  return String(s ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, max);
}

export function montarEmail(o: { remetente: { nome: string; email: string }; arquivo: string; mensagem: string }) {
  const nome = linhaUnica(o.remetente.nome, 80) || 'Lube Distribuidora';
  const arquivo = linhaUnica(o.arquivo, 120);
  const assunto = linhaUnica(`${nome} enviou "${arquivo}"`, 180);
  const mensagem = String(o.mensagem ?? '').trim().slice(0, 1000);
  const texto = [
    `${nome} (${o.remetente.email}) enviou o arquivo "${arquivo}" pelo LUBE OFFICE, da Lube Distribuidora.`,
    mensagem ? `\nMensagem:\n${mensagem}\n` : '',
    `O arquivo está anexado a este e-mail. Para responder, é só responder: a resposta vai para ${o.remetente.email}.`,
    '',
    'Lube Distribuidora · desde 1959 · Cariacica-ES',
  ].join('\n');
  const html =
    '<!doctype html><html lang="pt-BR"><body style="margin:0;padding:0;background:#EEF0F7;font-family:Arial,Helvetica,sans-serif;color:#1B2140">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EEF0F7;padding:24px 0"><tr><td align="center">' +
    '<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#FFFFFF;border-radius:12px;overflow:hidden">' +
    '<tr><td style="background:#0D176E;padding:22px 28px;color:#FFFFFF">' +
    '<div style="font-size:20px;font-weight:800;letter-spacing:-0.3px">LUBE <span style="color:#FF5A63">OFFICE</span></div>' +
    '<div style="font-size:12px;color:#C9D0F0;margin-top:4px">Lube Distribuidora</div></td></tr>' +
    '<tr><td style="height:5px;background:#E5101F;font-size:0;line-height:0">&nbsp;</td></tr>' +
    '<tr><td style="padding:28px">' +
    `<p style="margin:0 0 14px;font-size:16px;line-height:1.5"><strong>${esc(nome)}</strong> enviou para você o arquivo</p>` +
    `<p style="margin:0 0 20px;font-size:18px;font-weight:700;color:#0D176E">${esc(arquivo)}</p>` +
    (mensagem
      ? `<div style="margin:0 0 20px;padding:14px 16px;background:#F4F6FB;border-left:4px solid #E5101F;border-radius:6px;font-size:14px;line-height:1.55;white-space:pre-wrap">${esc(mensagem)}</div>`
      : '') +
    '<p style="margin:0 0 6px;font-size:14px;line-height:1.5">O arquivo está <strong>anexado</strong> a este e-mail.</p>' +
    `<p style="margin:0;font-size:14px;line-height:1.5;color:#5C6480">Para responder, é só responder: a resposta vai para ${esc(o.remetente.email)}.</p>` +
    '</td></tr>' +
    '<tr><td style="padding:16px 28px;background:#F4F6FB;font-size:11px;color:#5C6480">Lube Distribuidora · desde 1959 · Cariacica-ES</td></tr>' +
    '</table></td></tr></table></body></html>';
  return { assunto, texto, html };
}
