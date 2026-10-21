// =========================================================
// LUBE OFFICE — Drive e editor do portal (2026-10-21)
// Duas portas:
//   POST /office        o navegador do portal, com o JWT da sessão; a ação vai no corpo
//   POST /office/motor  o motor de edição (ONLYOFFICE) devolvendo o arquivo salvo,
//                       com o token assinado pela chave OFFICE_JWT_SECRET
// O schema office só é tocado pelas funções public.office_srv_*, com a chave de
// serviço, que nunca sai daqui. Quem pode o quê é conferido no banco.
// Variáveis (segredos do Supabase, cadastradas pelo TI):
//   OFFICE_MOTOR_URL   endereço do ONLYOFFICE (ex.: https://office.lube.com.br)
//   OFFICE_JWT_SECRET  a mesma chave JWT configurada no ONLYOFFICE
// Sem elas o Drive funciona e o editor responde "motor ainda não instalado".
// =========================================================
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { assinarHS256, verificarHS256 } from './jwt.ts';
import { lerRetorno, montarEditor, tipoDocumento, uuidValido } from './motor.ts';

const URL_SB  = Deno.env.get('SUPABASE_URL')!;
const ANON    = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const MOTOR_URL   = (Deno.env.get('OFFICE_MOTOR_URL') ?? '').trim().replace(/\/+$/, '');
const MOTOR_CHAVE = Deno.env.get('OFFICE_JWT_SECRET') ?? '';
const PORTAL = (Deno.env.get('OFFICE_PORTAL_URL') ?? 'https://painel-lube-distribuidora.vercel.app').replace(/\/+$/, '');
const BUCKET = 'office';

const motorLigado = () => !!(MOTOR_URL && MOTOR_CHAVE);

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

// objeto enviado para arquivos/<id>/: o caminho reservado é o único que aceita envio
async function objetoEnviado(id: string) {
  const { data, error } = await admin.storage.from(BUCKET).list('arquivos/' + id, { limit: 5 });
  if (error) throw new ErroOffice('Falha ao conferir o envio: ' + error.message, 500);
  const obj = (data ?? []).find((o: any) => o?.id && o.name);
  return obj ? { caminho: 'arquivos/' + id + '/' + obj.name, tamanho: Number(obj.metadata?.size ?? 0) } : null;
}

async function linkAssinado(caminho: string, segundos: number, baixarComo?: string) {
  const { data, error } = await admin.storage.from(BUCKET)
    .createSignedUrl(caminho, segundos, baixarComo ? { download: baixarComo } : undefined);
  if (error || !data?.signedUrl) throw new ErroOffice('Falha ao gerar o link do arquivo', 500);
  return data.signedUrl;
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
        return json({ ...r, motor: motorLigado() });
      }
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

      // abrir no editor: confere o papel, gera o link do arquivo e assina a configuração
      case 'abrir': {
        const a = await rpc('office_srv_abrir', { p_user: eu, p_arquivo: exigeUuid(c.id, 'Arquivo') });
        const arquivo = { ...a };
        delete arquivo.caminho;
        if (!motorLigado()) return json({ arquivo, motor: null, motivo: 'O motor de edição ainda não foi instalado.' });
        if (!tipoDocumento(a.extensao)) return json({ arquivo, motor: null, motivo: 'Este tipo de arquivo não abre no editor.' });
        const pessoa = (await rpc('office_srv_eu', { p_user: eu })).pessoa;
        const config = montarEditor({
          arquivo: a,
          urlArquivo: await linkAssinado(a.caminho, 3600),
          callbackUrl: `${URL_SB}/functions/v1/office/motor?arquivo=${a.id}`,
          voltarUrl: `${PORTAL}/office/`,
          pessoa: { id: pessoa.id, nome: pessoa.nome },
        });
        const token = await assinarHS256(config, MOTOR_CHAVE);
        return json({ arquivo, motor: { api: `${MOTOR_URL}/web-apps/apps/api/documents/api.js`, config: { ...config, token } } });
      }
      case 'baixar': {
        const r = await rpc('office_srv_baixar', {
          p_user: eu, p_arquivo: exigeUuid(c.id, 'Arquivo'),
          p_numero: Number.isInteger(c.versao) ? c.versao : null,
        });
        return json({ url: await linkAssinado(r.caminho, 120, r.nome), nome: r.nome });
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
  if (!motorLigado()) return motor(503, 1);

  const arquivoId = new URL(req.url).searchParams.get('arquivo') ?? '';
  if (!uuidValido(arquivoId)) return motor(400, 1);

  let corpo: Record<string, unknown>;
  try { corpo = await req.json(); } catch { return motor(400, 1); }
  const token = corpo.token ?? (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const conferido = await verificarHS256(token, MOTOR_CHAVE);
  if (!conferido) return motor(403, 1);
  const dados = (conferido.payload && typeof conferido.payload === 'object' ? conferido.payload : conferido) as Record<string, unknown>;

  const r = lerRetorno(dados, arquivoId, new URL(MOTOR_URL).origin);
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ erro: 'Método não permitido' }, 405);
  const caminho = new URL(req.url).pathname.replace(/\/+$/, '');
  if (caminho.endsWith('/office/motor')) return retornoDoMotor(req);
  return acaoDoPortal(req);
});
