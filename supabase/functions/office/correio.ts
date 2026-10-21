// =========================================================
// LUBE OFFICE — envio do e-mail pelo SMTP da Locaweb (porta 465)
// O Supabase bloqueia as portas 25 e 587; a 465 (TLS direto) passa.
// Segredos (Supabase › Edge Functions › Secrets, cadastrados pelo TI):
//   OFFICE_SMTP_USER  a caixa por onde o Office envia (ex.: office@lube.com.br)
//   OFFICE_SMTP_PASS  a senha dessa caixa
//   OFFICE_SMTP_HOST  opcional, padrão email-ssl.com.br (o certificado é *.email-ssl.com.br)
//   OFFICE_SMTP_PORT  opcional, padrão 465
// O remetente sai com o NOME de quem enviou e o endereço da caixa do Office; a
// resposta volta para o e-mail da pessoa (mesmo esquema do SAC).
// =========================================================
import nodemailer from 'npm:nodemailer@6.9.16';
import { Buffer } from 'node:buffer';

export function smtpPronto() {
  return !!(Deno.env.get('OFFICE_SMTP_USER') && Deno.env.get('OFFICE_SMTP_PASS'));
}

// um e-mail por destinatário: quem recebe não vê o endereço dos outros
export async function enviarEmails(o: {
  para: string[]; nomeRemetente: string; responderPara: string;
  assunto: string; texto: string; html: string;
  anexo: { nome: string; bytes: Uint8Array; tipo: string };
}) {
  const host = Deno.env.get('OFFICE_SMTP_HOST') || 'email-ssl.com.br';
  const port = Number(Deno.env.get('OFFICE_SMTP_PORT') || 465);
  if (port === 25 || port === 587) throw new Error(`a porta ${port} é bloqueada no Supabase; use a 465`);
  const user = Deno.env.get('OFFICE_SMTP_USER')!;
  const transporte = nodemailer.createTransport({
    host, port, secure: port === 465,
    auth: { user, pass: Deno.env.get('OFFICE_SMTP_PASS')! },
    connectionTimeout: 15000, greetingTimeout: 10000, socketTimeout: 45000,
  });
  const conteudo = Buffer.from(o.anexo.bytes);
  const enviados: string[] = [];
  const falhas: { para: string; erro: string }[] = [];
  for (const para of o.para) {
    try {
      await transporte.sendMail({
        from: { name: o.nomeRemetente, address: user },
        to: para,
        replyTo: o.responderPara,
        subject: o.assunto,
        text: o.texto,
        html: o.html,
        attachments: [{ filename: o.anexo.nome, content: conteudo, contentType: o.anexo.tipo }],
      });
      enviados.push(para);
    } catch (e) {
      falhas.push({ para, erro: String((e as Error)?.message ?? e).slice(0, 200) });
    }
  }
  transporte.close();
  return { enviados, falhas };
}
