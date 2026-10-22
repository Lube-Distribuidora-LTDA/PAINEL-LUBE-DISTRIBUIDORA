// =========================================================
// LUBE OFFICE — Drive e editor do portal (2026-10-21)
// Portas:
//   POST /office                  o navegador do portal, com o JWT da sessão; a ação vai no corpo
//   POST /office/motor            o motor de edição (ONLYOFFICE) devolvendo o arquivo salvo
//   POST /office/motor/registrar  a SRV-IA avisando o endereço do motor (o túnel muda ao reiniciar)
//   POST /office/motor/teste      teste de ponta a ponta, só com a senha temporária do banco
// As duas portas do motor usam token JWT assinado com OFFICE_JWT_SECRET.
// O schema office só é tocado pelas funções public.office_srv_*, com a chave de
// serviço, que nunca sai daqui. Quem pode o quê é conferido no banco.
// Nada de baixar (Júlio, 2026-10-21): o arquivo só sai do painel pelo "Enviar".
// Segredos (Supabase › Edge Functions › Secrets, cadastrados pelo TI):
//   OFFICE_JWT_SECRET  a mesma chave JWT configurada no ONLYOFFICE (o instalador da SRV-IA gera)
//   OFFICE_MOTOR_URL   opcional: endereço fixo do motor; sem ele vale o que a SRV-IA registrou
//   OFFICE_SMTP_*      a caixa de e-mail do "Enviar" para fora (ver correio.ts)
//   ANTHROPIC_API_KEY  a IA da Lube (a mesma chave da Sentinela, neste projeto)
// =========================================================
import { createClient } from 'jsr:@supabase/supabase-js@2';
import Anthropic from 'npm:@anthropic-ai/sdk@0.132.0';
import JSZip from 'npm:jszip@3.10.1';
import { assinarHS256, verificarHS256 } from './jwt.ts';
import { lerRetorno, montarEditor, motorVivo, origemDoPlugin, tipoDocumento, urlMotorValida, uuidValido, visualDoEditor } from './motor.ts';
import { LIMITE_EMAIL_BYTES, linhaUnica, montarEmail, tipoMime } from './email.ts';
import { enviarEmails, smtpPronto } from './correio.ts';
import {
  conferirPlano, custoUsd, esquema, hojeBrasilia, instrucoes, LIMITE_IMAGEM_BYTES, LIMITE_TEXTO_FONTE, modeloValido, montarPedido,
  ordemNatural, textoDocx, textoPptx, textoXlsx, TIPOS_IMAGEM, type ModoIa, type TipoIa,
} from './ia.ts';

const URL_SB  = Deno.env.get('SUPABASE_URL')!;
const ANON    = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const MOTOR_URL_FIXO = (Deno.env.get('OFFICE_MOTOR_URL') ?? '').trim().replace(/\/+$/, '');
const MOTOR_CHAVE = Deno.env.get('OFFICE_JWT_SECRET') ?? '';
const PORTAL = (Deno.env.get('OFFICE_PORTAL_URL') ?? 'https://painel-lube-distribuidora.vercel.app').replace(/\/+$/, '');
const BUCKET = 'office';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const admin = createClient(URL_SB, SERVICE, { auth: { persistSession: false } });

// erro do banco (office: ...) → resposta com o status certo e a frase sem o prefixo
class ErroOffice extends Error {
  constructor(msg: string, public status: number) { super(msg); }
}

async function rpc(nome: string, params: Record<string, unknown>) {
  const { data, error } = await admin.rpc(nome, params);
  if (error) {
    const st = error.code === '42501' ? 403 : error.code === 'P0002' ? 404 : error.code === '22023' ? 400 : 500;
    const msg = String(error.message || 'falha no banco').replace(/^office:\s*/, '');
    throw new ErroOffice(st === 500 ? 'Falha no banco: ' + msg : msg, st);
  }
  return data as any;
}

const tipoItem = (v: unknown) => (v === 'pasta' || v === 'arquivo' ? v : null);
const uuidOuNulo = (v: unknown) => (uuidValido(v) ? v : null);
function exigeUuid(v: unknown, nome: string): string {
  if (!uuidValido(v)) throw new ErroOffice(nome + ' inválido', 400);
  return v;
}

/* ---------- onde está o motor ---------- */
type Motor = { url: string; vivo: boolean; visto_em: string | null; situacao: 'ligado' | 'fora' | 'nao_instalado' };
let motorCache: { quando: number; m: Motor } | null = null;
async function motorAtual(fresco = false): Promise<Motor> {
  if (!MOTOR_CHAVE) return { url: '', vivo: false, visto_em: null, situacao: 'nao_instalado' };
  if (MOTOR_URL_FIXO) return { url: MOTOR_URL_FIXO, vivo: true, visto_em: null, situacao: 'ligado' };
  if (!fresco && motorCache && Date.now() - motorCache.quando < 30000) return motorCache.m;
  const r = await rpc('office_srv_motor', {});
  const url = typeof r?.url === 'string' ? r.url : '';
  const vivo = !!url && motorVivo(r?.visto_em);
  const m: Motor = { url, vivo, visto_em: r?.visto_em ?? null, situacao: !url ? 'nao_instalado' : vivo ? 'ligado' : 'fora' };
  motorCache = { quando: Date.now(), m };
  return m;
}

// visual do editor (office.config 'editor'): troca sem publicar código, vale em até 1 minuto
let visualCache: { quando: number; v: ReturnType<typeof visualDoEditor> } | null = null;
async function visualAtual() {
  if (visualCache && Date.now() - visualCache.quando < 60_000) return visualCache.v;
  let v = visualDoEditor(null);
  try { v = visualDoEditor(await rpc('office_srv_editor', {})); } catch (e) { console.error('office visual:', e); }
  visualCache = { quando: Date.now(), v };
  return v;
}

function horaBrasilia(iso: string | null) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// objeto enviado para arquivos/<id>/: o caminho reservado é o único que aceita envio
async function objetoEnviado(id: string) {
  const { data, error } = await admin.storage.from(BUCKET).list('arquivos/' + id, { limit: 5 });
  if (error) throw new ErroOffice('Falha ao conferir o envio: ' + error.message, 500);
  const obj = (data ?? []).find((o: any) => o?.id && o.name);
  return obj ? { caminho: 'arquivos/' + id + '/' + obj.name, tamanho: Number(obj.metadata?.size ?? 0) } : null;
}

async function linkAssinado(caminho: string, segundos: number) {
  const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(caminho, segundos);
  if (error || !data?.signedUrl) throw new ErroOffice('Falha ao gerar o link do arquivo', 500);
  return data.signedUrl;
}

// ---------------------------------------------------------
// IA da Lube: o Claude devolve um plano em JSON; o plugin executa no editor
// ---------------------------------------------------------
const CHAVE_IA = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
const claude = CHAVE_IA ? new Anthropic({ apiKey: CHAVE_IA, maxRetries: 1, timeout: 140_000 }) : null;

// o plugin entra no editor só se o portal já publicou office/ia/ (senão o editor reclamaria
// de um plugin que não existe); máquina do TI e túnel de teste entram direto
const pluginVisto = new Map<string, { quando: number; ok: boolean }>();
async function pluginIaDe(req: Request) {
  if (!claude) return undefined;
  const origem = origemDoPlugin(req.headers.get('origin'), PORTAL);
  if (origem !== PORTAL) return origem;
  const c = pluginVisto.get(origem);
  if (c && Date.now() - c.quando < 10 * 60_000) return c.ok ? origem : undefined;
  let ok = false;
  try {
    const r = await fetch(origem + '/office/ia/config.json', { signal: AbortSignal.timeout(4000) });
    ok = r.ok;
    await r.body?.cancel();
  } catch { ok = false; }
  pluginVisto.set(origem, { quando: Date.now(), ok });
  return ok ? origem : undefined;
}

// texto do arquivo de origem (Transformar com IA). PDF vai inteiro para o Claude ler.
async function lerFonte(f: { nome: string; extensao: string; caminho: string; tamanho: number }) {
  const ext = String(f.extensao).toLowerCase();
  if (!['docx', 'xlsx', 'pptx', 'pdf', 'txt', 'csv'].includes(ext)) {
    throw new ErroOffice('A IA lê Word, Excel, PowerPoint, PDF, TXT e CSV. Abra este arquivo e salve como .docx, .xlsx ou .pptx.', 400);
  }
  if (Number(f.tamanho) > 25 * 1024 * 1024) throw new ErroOffice('O arquivo de origem passa de 25 MB.', 413);
  const { data: blob, error } = await admin.storage.from(BUCKET).download(f.caminho);
  if (error || !blob) throw new ErroOffice('Falha ao ler o arquivo de origem', 500);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (ext === 'pdf') {
    if (bytes.byteLength > 20 * 1024 * 1024) throw new ErroOffice('O PDF passa de 20 MB.', 413);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { texto: '', pdf: btoa(bin) };
  }
  if (ext === 'txt' || ext === 'csv') return { texto: new TextDecoder().decode(bytes).slice(0, LIMITE_TEXTO_FONTE), pdf: '' };
  const zip = await JSZip.loadAsync(bytes);
  const ler = (n: string) => zip.file(n)?.async('string') ?? Promise.resolve('');
  let texto = '';
  if (ext === 'docx') texto = textoDocx(await ler('word/document.xml'));
  else if (ext === 'pptx') {
    const nomes = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort(ordemNatural);
    texto = textoPptx(await Promise.all(nomes.map(ler)));
  } else {
    const livro = await ler('xl/workbook.xml');
    const nomesAbas = [...livro.matchAll(/<sheet [^>]*name="([^"]+)"/g)].map((m) => m[1]);
    const arquivos = Object.keys(zip.files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort(ordemNatural);
    const abas = await Promise.all(arquivos.map(async (n, i) => ({ nome: nomesAbas[i] ?? 'Aba ' + (i + 1), xml: await ler(n) })));
    texto = textoXlsx(await ler('xl/sharedStrings.xml'), abas);
  }
  if (!texto.trim()) throw new ErroOffice('O arquivo de origem está vazio.', 400);
  return { texto: texto.slice(0, LIMITE_TEXTO_FONTE), pdf: '' };
}

function erroDaIa(e: unknown) {
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    return { msg: 'A chave da IA foi recusada. O TI precisa conferir a ANTHROPIC_API_KEY no Supabase.', status: 503 };
  }
  if (e instanceof Anthropic.RateLimitError) return { msg: 'A IA está ocupada agora. Tente de novo em um minuto.', status: 429 };
  if (e instanceof Anthropic.APIConnectionTimeoutError) return { msg: 'A IA demorou demais para responder. Peça algo menor ou tente de novo.', status: 504 };
  if (e instanceof Anthropic.BadRequestError) return { msg: 'A IA não aceitou o pedido: ' + String(e.message).slice(0, 240), status: 400 };
  if (e instanceof Anthropic.APIError) return { msg: 'A IA está instável agora (' + (e.status ?? 'sem resposta') + '). Tente de novo em instantes.', status: 502 };
  return { msg: 'Não foi possível falar com a IA agora. Tente de novo.', status: 502 };
}

async function pedirIa(eu: string, c: Record<string, any>) {
  if (!claude) return json({ erro: 'A IA da Lube ainda não foi ligada: falta a chave ANTHROPIC_API_KEY nos segredos do Supabase.' }, 503);
  const tipo = (['docx', 'xlsx', 'pptx'].includes(c.tipo) ? c.tipo : null) as TipoIa | null;
  if (!tipo) return json({ erro: 'Tipo de arquivo inválido para a IA' }, 400);
  const modo = (['criar', 'editor', 'transformar'].includes(c.modo) ? c.modo : 'editor') as ModoIa;
  const pedido = String(c.pedido ?? '').replace(/[\u0000-\u0008]/g, '').trim().slice(0, 4000);
  const arquivo = uuidOuNulo(c.arquivo);
  const fonteId = modo === 'transformar' ? uuidOuNulo(c.fonte) : null;
  if (modo === 'transformar' && !fonteId) return json({ erro: 'Diga qual arquivo transformar' }, 400);

  const imagens: Anthropic.ImageBlockParam[] = [];
  for (const im of (Array.isArray(c.imagens) ? c.imagens : []).slice(0, 5)) {
    const tipoImg = String(im?.tipo ?? '');
    const dados = String(im?.dados ?? '');
    if (!TIPOS_IMAGEM.includes(tipoImg) || !/^[A-Za-z0-9+/]+={0,2}$/.test(dados)) {
      return json({ erro: 'Imagem inválida: use JPG, PNG, WEBP ou GIF.' }, 400);
    }
    if (dados.length * 0.75 > LIMITE_IMAGEM_BYTES) return json({ erro: 'Imagem grande demais (até 5 MB cada).' }, 413);
    imagens.push({ type: 'image', source: { type: 'base64', media_type: tipoImg as 'image/jpeg', data: dados } });
  }
  if (!pedido && !imagens.length && !fonteId) return json({ erro: 'Escreva o que você quer ou mande uma imagem.' }, 400);
  const contexto = typeof c.contexto === 'string' ? c.contexto.slice(0, 40_000) : '';

  const lib = await rpc('office_srv_ia_liberar', { p_user: eu, p_arquivo: arquivo, p_fonte: fonteId });
  if (!lib.livre) {
    return json({
      erro: `A IA da Lube chegou ao teto de hoje (US$ ${Number(lib.teto_dia_usd).toFixed(2)} somando todo mundo). Ela volta à meia-noite.`,
      situacao: lib,
    }, 429);
  }
  const modelo = modeloValido(lib.modelo);
  let fonte: { nome: string; texto: string } | null = null;
  let pdf = '';
  if (lib.fonte) {
    const r = await lerFonte(lib.fonte);
    if (r.texto) fonte = { nome: lib.fonte.nome + '.' + lib.fonte.extensao, texto: r.texto };
    pdf = r.pdf;
  }
  const conteudo: Anthropic.ContentBlockParam[] = [
    ...imagens,
    ...(pdf ? [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf } } as Anthropic.DocumentBlockParam] : []),
    { type: 'text', text: montarPedido({
      tipo, modo, pedido, contexto, fonte: fonte ?? (pdf ? { nome: lib.fonte.nome + '.pdf', texto: '(o PDF vem acima)' } : null),
      nomeArquivo: typeof c.nome_arquivo === 'string' ? c.nome_arquivo.slice(0, 160) : '', imagens: imagens.length,
      hoje: hojeBrasilia(),
    }) },
  ];
  const registrar = (ok: boolean, uso: Anthropic.Usage | null, custo: number, erro: string | null) =>
    rpc('office_srv_ia_registrar', {
      p_user: eu, p_arquivo: arquivo, p_fonte: lib.fonte?.id ?? null, p_tipo: tipo, p_modo: modo, p_pedido: pedido,
      p_imagens: imagens.length, p_modelo: modelo, p_tokens_entrada: uso?.input_tokens ?? 0,
      p_tokens_saida: uso?.output_tokens ?? 0, p_custo: custo, p_ok: ok, p_erro: erro,
    });

  let resp: Anthropic.Message;
  const inicio = Date.now();
  try {
    resp = await claude.messages.create({
      model: modelo,
      max_tokens: 16000,
      system: instrucoes(tipo),
      // esforço baixo: a IA da Lube monta conteúdo, não resolve problema difícil (custo e tempo menores)
      output_config: { effort: 'low', format: { type: 'json_schema', schema: esquema(tipo) } },
      messages: [{ role: 'user', content: conteudo }],
    } as Anthropic.MessageCreateParamsNonStreaming);
  } catch (e) {
    const r = erroDaIa(e);
    console.error('office ia:', e);
    await registrar(false, null, 0, r.msg).catch(() => {});
    return json({ erro: r.msg }, r.status);
  }
  const custo = custoUsd(modelo, resp.usage);
  if (resp.stop_reason === 'refusal') {
    await registrar(false, resp.usage, custo, 'a IA recusou').catch(() => {});
    return json({ erro: 'A IA não aceitou esse pedido. Reformule e tente de novo.' }, 422);
  }
  if (resp.stop_reason === 'max_tokens') {
    await registrar(false, resp.usage, custo, 'resposta cortada (max_tokens)').catch(() => {});
    return json({ erro: 'O pedido ficou grande demais para uma vez só. Peça em partes (por exemplo, 10 slides ou 100 linhas por vez).' }, 422);
  }
  const textoResp = resp.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  let plano;
  try {
    plano = conferirPlano(tipo, JSON.parse(textoResp));
  } catch (e) {
    await registrar(false, resp.usage, custo, 'plano inválido: ' + String((e as Error)?.message ?? e)).catch(() => {});
    return json({ erro: 'A resposta da IA veio incompleta. Tente de novo.' }, 502);
  }
  const situacao = await registrar(true, resp.usage, custo, null);
  return json({ plano, modelo, custo_usd: custo, segundos: Math.round((Date.now() - inicio) / 100) / 10, situacao });
}

// ---------------------------------------------------------
// porta do navegador
// ---------------------------------------------------------
async function acaoDoPortal(req: Request) {
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return json({ erro: 'Sem credencial' }, 401);
  const leitor = createClient(URL_SB, ANON, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false },
  });
  const { data: u, error: ue } = await leitor.auth.getUser();
  if (ue || !u?.user) return json({ erro: 'Sessão inválida' }, 401);
  const eu = u.user.id;

  let c: Record<string, any>;
  try { c = await req.json(); } catch { return json({ erro: 'JSON inválido' }, 400); }

  try {
    switch (String(c.acao || '')) {
      case 'eu': {
        const r = await rpc('office_srv_eu', { p_user: eu });
        const m = await motorAtual();
        const ia = await rpc('office_srv_ia_situacao', { p_user: eu });
        return json({
          ...r, motor: m.situacao === 'ligado', motor_situacao: m.situacao, motor_visto_em: m.visto_em, email: smtpPronto(),
          ia: { ...ia, ligada: !!claude },
        });
      }
      case 'ia':
        return pedirIa(eu, c);
      case 'listar':
        return json(await rpc('office_srv_listar', {
          p_user: eu, p_visao: typeof c.visao === 'string' ? c.visao : 'meus',
          p_pasta: uuidOuNulo(c.pasta), p_busca: typeof c.busca === 'string' ? c.busca.slice(0, 120) : null,
        }));
      case 'pasta_criar':
        return json(await rpc('office_srv_pasta_criar', { p_user: eu, p_pai: uuidOuNulo(c.pai), p_nome: String(c.nome ?? '') }));

      // novo arquivo: reserva o caminho e devolve o envio assinado (o navegador manda direto ao Storage)
      case 'arquivo_novo': {
        const r = await rpc('office_srv_arquivo_criar', {
          p_user: eu, p_pasta: uuidOuNulo(c.pasta), p_nome: String(c.nome ?? ''), p_extensao: String(c.extensao ?? ''),
        });
        const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(r.caminho);
        if (error || !data?.token) throw new ErroOffice('Falha ao preparar o envio', 500);
        return json({ id: r.id, caminho: r.caminho, token: data.token });
      }
      case 'arquivo_confirmar': {
        const id = exigeUuid(c.id, 'Arquivo');
        const origem = ['novo', 'modelo', 'envio'].includes(c.origem) ? c.origem : 'envio';
        const obj = await objetoEnviado(id);
        if (!obj) return json({ erro: 'O arquivo não chegou ao servidor. Tente enviar de novo.' }, 409);
        return json(await rpc('office_srv_arquivo_confirmar', { p_user: eu, p_arquivo: id, p_tamanho: obj.tamanho, p_origem: origem }));
      }

      case 'renomear':
        return json(await rpc('office_srv_renomear', { p_user: eu, p_tipo: tipoItem(c.tipo), p_id: exigeUuid(c.id, 'Item'), p_nome: String(c.nome ?? '') }));
      case 'mover':
        return json(await rpc('office_srv_mover', { p_user: eu, p_tipo: tipoItem(c.tipo), p_id: exigeUuid(c.id, 'Item'), p_destino: uuidOuNulo(c.destino) }));
      case 'lixeira':
        return json(await rpc('office_srv_lixeira', { p_user: eu, p_tipo: tipoItem(c.tipo), p_id: exigeUuid(c.id, 'Item'), p_restaurar: !!c.restaurar }));
      case 'acessos':
        return json(await rpc('office_srv_acessos', { p_user: eu, p_tipo: tipoItem(c.tipo), p_id: exigeUuid(c.id, 'Item') }));
      case 'compartilhar':
        return json(await rpc('office_srv_compartilhar', {
          p_user: eu, p_tipo: tipoItem(c.tipo), p_id: exigeUuid(c.id, 'Item'),
          p_pessoa: uuidOuNulo(c.pessoa), p_papel: c.papel ? String(c.papel) : null,
        }));
      case 'pessoas':
        return json(await rpc('office_srv_pessoas', { p_user: eu, p_busca: typeof c.busca === 'string' ? c.busca.slice(0, 80) : null }));

      // abrir no editor: confere o papel, gera o link do arquivo (só para o motor) e assina a configuração
      case 'abrir': {
        const a = await rpc('office_srv_abrir', { p_user: eu, p_arquivo: exigeUuid(c.id, 'Arquivo') });
        const arquivo = { ...a };
        delete arquivo.caminho;
        if (!tipoDocumento(a.extensao)) return json({ arquivo, motor: null, motivo: 'Este tipo de arquivo não abre no editor.' });
        const m = await motorAtual();
        if (m.situacao === 'nao_instalado') {
          return json({ arquivo, motor: null, situacao: m.situacao, motivo: 'O editor está sendo ligado no servidor da Lube (SRV-IA).' });
        }
        if (m.situacao === 'fora') {
          return json({ arquivo, motor: null, situacao: m.situacao,
            motivo: 'O editor está fora do ar: o servidor da Lube (SRV-IA) não responde desde ' + horaBrasilia(m.visto_em) + '.' });
        }
        const pessoa = (await rpc('office_srv_eu', { p_user: eu })).pessoa;
        const config = montarEditor({
          arquivo: a,
          // o link vale 5 minutos: só o motor usa, na hora de abrir
          urlArquivo: await linkAssinado(a.caminho, 300),
          callbackUrl: `${URL_SB}/functions/v1/office/motor?arquivo=${a.id}`,
          voltarUrl: `${PORTAL}/office/`,
          pessoa: { id: pessoa.id, nome: pessoa.nome },
          pluginIa: await pluginIaDe(req),
          visual: await visualAtual(),
        });
        const token = await assinarHS256(config, MOTOR_CHAVE);
        return json({ arquivo, situacao: m.situacao, motor: { api: `${m.url}/web-apps/apps/api/documents/api.js`, config: { ...config, token } } });
      }

      // enviar: para pessoas do painel (acesso + aviso) e/ou por e-mail (anexo); nunca download
      case 'enviar': {
        const id = exigeUuid(c.id, 'Arquivo');
        const internos = Array.isArray(c.internos)
          ? c.internos.filter((x: any) => x && uuidValido(x.pessoa)).slice(0, 50)
              .map((x: any) => ({ pessoa: x.pessoa, papel: ['ver', 'comentar', 'editar'].includes(x.papel) ? x.papel : 'ver' }))
          : [];
        const externos = Array.isArray(c.externos) ? c.externos.filter((e: unknown) => typeof e === 'string').slice(0, 25) : [];
        if (externos.length && !smtpPronto()) {
          return json({ erro: 'O envio por e-mail ainda não foi ligado: falta cadastrar a caixa de e-mail do LUBE OFFICE. O envio para pessoas do painel já funciona.' }, 503);
        }
        const r = await rpc('office_srv_enviar', {
          p_user: eu, p_arquivo: id, p_internos: internos, p_externos: externos, p_mensagem: String(c.mensagem ?? '').slice(0, 1000),
        });
        const resposta: Record<string, unknown> = { internos: r.internos, externos: [], falhas: [] };
        if (r.externos.length) {
          if (Number(r.tamanho) > LIMITE_EMAIL_BYTES) {
            await rpc('office_srv_enviar_registrar', { p_user: eu, p_arquivo: id, p_externos: r.externos, p_ok: false, p_erro: 'arquivo maior que 20 MB' });
            return json({ ...resposta, erro: 'O arquivo passa de 20 MB e não cabe num e-mail. Para quem é do painel, use “Pessoas do painel”.' }, 413);
          }
          const { data: blob, error } = await admin.storage.from(BUCKET).download(r.caminho);
          if (error || !blob) throw new ErroOffice('Falha ao ler o arquivo para enviar', 500);
          const e = montarEmail({ remetente: r.remetente, arquivo: r.nome_arquivo, mensagem: r.mensagem });
          const envio = await enviarEmails({
            para: r.externos,
            nomeRemetente: linhaUnica(r.remetente.nome + ' via LUBE OFFICE', 100),
            responderPara: r.remetente.email,
            assunto: e.assunto, texto: e.texto, html: e.html,
            anexo: { nome: r.nome_arquivo, bytes: new Uint8Array(await blob.arrayBuffer()), tipo: tipoMime(r.extensao) },
          });
          if (envio.enviados.length) {
            await rpc('office_srv_enviar_registrar', { p_user: eu, p_arquivo: id, p_externos: envio.enviados, p_ok: true, p_erro: null });
          }
          if (envio.falhas.length) {
            await rpc('office_srv_enviar_registrar', {
              p_user: eu, p_arquivo: id, p_externos: envio.falhas.map((f) => f.para), p_ok: false,
              p_erro: envio.falhas.map((f) => f.para + ': ' + f.erro).join(' | '),
            });
          }
          resposta.externos = envio.enviados;
          resposta.falhas = envio.falhas;
          if (!envio.enviados.length) {
            return json({ ...resposta, erro: 'O e-mail não saiu: ' + envio.falhas[0].erro }, 502);
          }
        }
        return json(resposta);
      }

      case 'versoes':
        return json(await rpc('office_srv_versoes', { p_user: eu, p_arquivo: exigeUuid(c.id, 'Arquivo') }));
      case 'versao_restaurar':
        return json(await rpc('office_srv_versao_restaurar', { p_user: eu, p_arquivo: exigeUuid(c.id, 'Arquivo'), p_numero: Number(c.numero) }));
      case 'mencionar': {
        const emails = Array.isArray(c.emails) ? c.emails.filter((e: unknown) => typeof e === 'string').slice(0, 30) : [];
        return json(await rpc('office_srv_mencionar', {
          p_user: eu, p_arquivo: exigeUuid(c.id, 'Arquivo'), p_emails: emails, p_mensagem: String(c.mensagem ?? ''),
        }));
      }
      case 'avisos':
        return json(await rpc('office_srv_avisos', { p_user: eu, p_limite: Number(c.limite) || 30 }));
      case 'avisos_lidos': {
        const ids = Array.isArray(c.ids) ? c.ids.filter(uuidValido) : null;
        return json(await rpc('office_srv_avisos_lidos', { p_user: eu, p_ids: ids }));
      }
      default:
        return json({ erro: 'Ação desconhecida' }, 400);
    }
  } catch (e) {
    if (e instanceof ErroOffice) return json({ erro: e.message }, e.status);
    console.error('office:', e);
    return json({ erro: 'Falha inesperada no LUBE OFFICE' }, 500);
  }
}

// ---------------------------------------------------------
// porta do motor: o ONLYOFFICE devolve o arquivo salvo
// Resposta {"error":0} = recebido; {"error":1} = o motor tenta de novo
// ---------------------------------------------------------
async function retornoDoMotor(req: Request) {
  const motor = (s: number, erro: 0 | 1) => new Response(JSON.stringify({ error: erro }), {
    status: s, headers: { 'Content-Type': 'application/json' },
  });
  if (!MOTOR_CHAVE) return motor(503, 1);

  const arquivoId = new URL(req.url).searchParams.get('arquivo') ?? '';
  if (!uuidValido(arquivoId)) return motor(400, 1);

  let corpo: Record<string, unknown>;
  try { corpo = await req.json(); } catch { return motor(400, 1); }
  const token = corpo.token ?? (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const conferido = await verificarHS256(token, MOTOR_CHAVE);
  if (!conferido) return motor(403, 1);
  const dados = (conferido.payload && typeof conferido.payload === 'object' ? conferido.payload : conferido) as Record<string, unknown>;

  const m = await motorAtual(true);
  if (!m.url) return motor(503, 1);
  const r = lerRetorno(dados, arquivoId, new URL(m.url).origin);
  if (r.acao === 'ignorar') return motor(200, 0);
  if (r.acao === 'erro') {
    console.error('office motor:', arquivoId, r.motivo);
    return motor(200, r.motivo.startsWith('o motor') ? 0 : 1);
  }

  try {
    const baixado = await fetch(r.url);
    if (!baixado.ok) throw new Error('motor respondeu ' + baixado.status);
    const bytes = new Uint8Array(await baixado.arrayBuffer());
    const carimbo = new Date().toISOString().replace(/\D/g, '').slice(0, 17);
    const caminho = `arquivos/${arquivoId}/${carimbo}-${crypto.randomUUID().slice(0, 6)}.${r.extensao}`;
    const { error } = await admin.storage.from(BUCKET).upload(caminho, bytes, {
      contentType: baixado.headers.get('content-type') ?? 'application/octet-stream', upsert: false,
    });
    if (error) throw new Error('storage: ' + error.message);
    await rpc('office_srv_salvar', {
      p_arquivo: arquivoId, p_chave: r.chave, p_autores: r.autores,
      p_tamanho: bytes.byteLength, p_caminho: caminho, p_origem: r.origem,
    });
    return motor(200, 0);
  } catch (e) {
    console.error('office motor: falha ao salvar', arquivoId, e);
    return motor(200, 1);
  }
}

// ---------------------------------------------------------
// porta da SRV-IA: o túnel avisa o endereço do motor (no início e de 5 em 5 min)
// ---------------------------------------------------------
async function registrarMotor(req: Request) {
  if (!MOTOR_CHAVE) {
    return json({ erro: 'Falta cadastrar o segredo OFFICE_JWT_SECRET no Supabase (Edge Functions › Secrets).' }, 503);
  }
  let corpo: Record<string, unknown>;
  try { corpo = await req.json(); } catch { return json({ erro: 'JSON inválido' }, 400); }
  const dados = await verificarHS256(corpo.token, MOTOR_CHAVE);
  if (!dados || typeof dados.exp !== 'number') {
    return json({ erro: 'Assinatura não confere: a chave do motor na SRV-IA é diferente do OFFICE_JWT_SECRET do Supabase.' }, 403);
  }
  if (!urlMotorValida(dados.url)) return json({ erro: 'Endereço do motor inválido (precisa ser https).' }, 400);
  const info = {
    maquina: linhaUnica(dados.maquina, 40), versao: linhaUnica(dados.versao, 40),
    memoria_gb: Number(dados.memoria_gb) || null, motor_ok: dados.motor_ok === true,
  };
  try {
    const r = await rpc('office_srv_motor_registrar', { p_url: String(dados.url).trim(), p_info: info });
    motorCache = null;
    return json({ ok: true, url: r.url, desde: r.desde });
  } catch (e) {
    if (e instanceof ErroOffice) return json({ erro: e.message }, e.status);
    return json({ erro: 'Falha ao registrar o motor' }, 500);
  }
}

// ---------------------------------------------------------
// porta de teste do motor: abre um arquivo de teste no editor sem login no painel,
// para conferir de ponta a ponta depois de instalar ou reinstalar. Só funciona com a
// senha temporária que alguém com acesso ao banco grava em office.config
// ('teste_motor', ver db/06_office_teste_motor.sql); o arquivo é do dono que ela indica.
// ---------------------------------------------------------
async function testeMotor(req: Request) {
  let c: Record<string, any>;
  try { c = await req.json(); } catch { return json({ erro: 'JSON inválido' }, 400); }
  try {
    const t = await rpc('office_srv_teste_motor', { p_token: String(c.token ?? '') });
    const dono = String(t.dono);
    // a IA também pode ser testada por aqui, só com arquivos "Teste do motor" (alvo e origem)
    if (c.acao === 'ia') {
      for (const id of [c.arquivo, c.modo === 'transformar' ? c.fonte : null]) {
        if (!uuidValido(id)) continue;
        const alvo = await rpc('office_srv_abrir', { p_user: dono, p_arquivo: id });
        if (!String(alvo.nome).startsWith('Teste do motor')) return json({ erro: 'Só arquivos "Teste do motor" por aqui' }, 403);
      }
      return pedirIa(dono, c);
    }
    const m = await motorAtual(true);
    if (m.situacao !== 'ligado') return json({ erro: 'Motor ' + m.situacao, situacao: m.situacao, visto_em: m.visto_em }, 503);
    let id = uuidOuNulo(c.arquivo);
    if (!id) {
      // arquivo de teste novo, a partir do modelo em branco do portal (documento, planilha ou apresentação)
      const ext = ['docx', 'xlsx', 'pptx'].includes(c.extensao) ? c.extensao : 'docx';
      const nome = 'Teste do motor ' + horaBrasilia(new Date().toISOString()).replace(/[/:]/g, '-');
      const r = await rpc('office_srv_arquivo_criar', { p_user: dono, p_pasta: null, p_nome: nome, p_extensao: ext });
      const modelo = await fetch(`${PORTAL}/office/modelos/branco.${ext}`);
      if (!modelo.ok) throw new ErroOffice('Modelo em branco não encontrado no portal', 500);
      const bytes = new Uint8Array(await modelo.arrayBuffer());
      const { error } = await admin.storage.from(BUCKET).upload(r.caminho, bytes, { contentType: tipoMime(ext), upsert: false });
      if (error) throw new ErroOffice('Falha ao gravar o arquivo de teste: ' + error.message, 500);
      await rpc('office_srv_arquivo_confirmar', { p_user: dono, p_arquivo: r.id, p_tamanho: bytes.byteLength, p_origem: 'novo' });
      id = r.id;
    }
    const a = await rpc('office_srv_abrir', { p_user: dono, p_arquivo: id });
    if (!String(a.nome).startsWith('Teste do motor')) return json({ erro: 'Só arquivos "Teste do motor" abrem por aqui' }, 403);
    const pessoa = (await rpc('office_srv_eu', { p_user: dono })).pessoa;
    const config = montarEditor({
      arquivo: a, urlArquivo: await linkAssinado(a.caminho, 300),
      callbackUrl: `${URL_SB}/functions/v1/office/motor?arquivo=${a.id}`,
      voltarUrl: `${PORTAL}/office/`, pessoa: { id: pessoa.id, nome: pessoa.nome },
      pluginIa: await pluginIaDe(req),
      // o teste pode pedir um tema da Lube antes de ele valer para todos
      visual: typeof c.tema === 'string' ? visualDoEditor({ visual: 'lube', tema: c.tema }) : await visualAtual(),
    });
    const arquivo = { ...a };
    delete arquivo.caminho;
    return json({ arquivo, motor: { api: `${m.url}/web-apps/apps/api/documents/api.js`, config: { ...config, token: await assinarHS256(config, MOTOR_CHAVE) } } });
  } catch (e) {
    if (e instanceof ErroOffice) return json({ erro: e.message }, e.status);
    console.error('office teste:', e);
    return json({ erro: 'Falha no teste do motor' }, 500);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ erro: 'Método não permitido' }, 405);
  const caminho = new URL(req.url).pathname.replace(/\/+$/, '');
  if (caminho.endsWith('/office/motor/teste')) return testeMotor(req);
  if (caminho.endsWith('/office/motor/registrar')) return registrarMotor(req);
  if (caminho.endsWith('/office/motor')) return retornoDoMotor(req);
  return acaoDoPortal(req);
});
