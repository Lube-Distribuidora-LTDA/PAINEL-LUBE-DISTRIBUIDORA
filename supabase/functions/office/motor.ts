// =========================================================
// LUBE OFFICE — conversa com o motor de edição (ONLYOFFICE Docs)
// Funções puras: montar a configuração do editor e ler o retorno de
// salvamento. Testadas no Node (teste/motor.test.mjs).
// =========================================================

const TIPOS: Record<string, 'word' | 'cell' | 'slide' | 'pdf'> = {
  docx: 'word', doc: 'word', odt: 'word', rtf: 'word', txt: 'word',
  xlsx: 'cell', xls: 'cell', ods: 'cell', csv: 'cell',
  pptx: 'slide', ppt: 'slide', odp: 'slide',
  pdf: 'pdf',
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function tipoDocumento(extensao: string): 'word' | 'cell' | 'slide' | 'pdf' | null {
  return TIPOS[String(extensao || '').toLowerCase()] ?? null;
}

export function uuidValido(v: unknown): v is string {
  return typeof v === 'string' && UUID.test(v);
}

// o que cada papel pode fazer dentro do editor. Baixar, nunca (pedido do Júlio,
// 2026-10-21): o arquivo só sai do painel pelo "Enviar" do LUBE OFFICE.
export function permissoes(papel: string) {
  const edita = papel === 'dono' || papel === 'editar';
  const comenta = edita || papel === 'comentar';
  return {
    modo: comenta ? 'edit' : 'view',
    permissions: {
      edit: edita, review: edita, comment: comenta, fillForms: edita,
      download: false, print: true, copy: true, chat: true, modifyFilter: edita,
    },
  };
}

// endereço que a SRV-IA registra: só https, só o host (sem caminho)
export function urlMotorValida(v: unknown): v is string {
  return typeof v === 'string' && /^https:\/\/[a-z0-9.-]+(:[0-9]{2,5})?\/?$/i.test(v.trim());
}

// motor vivo = a SRV-IA deu sinal nos últimos 15 minutos (o túnel avisa de 5 em 5)
export function motorVivo(vistoEm: unknown, agora = Date.now()) {
  const t = typeof vistoEm === 'string' ? Date.parse(vistoEm) : NaN;
  return Number.isFinite(t) && agora - t < 15 * 60 * 1000;
}

type Arquivo = {
  id: string; nome: string; extensao: string; chave: string; papel: string;
  dono?: { nome?: string } | null; criado_em?: string; pasta_nome?: string | null;
};

// plugin "IA da Lube" (office/ia/ no portal): roda escondido dentro do editor e executa
// os planos da IA no documento. Mesmo GUID do office/ia/config.json.
export const GUID_PLUGIN_IA = 'asc.{7A3C9F1E-4B2D-4E8A-9C61-1B5E0D2F8A47}';

// de onde o plugin é servido: a origem da página que abriu o editor, se for o portal,
// a máquina do TI (localhost) ou um túnel de teste; senão, o portal publicado
export function origemDoPlugin(origem: string | null, portal: string) {
  const o = String(origem ?? '').trim();
  if (o === portal) return portal;
  if (/^http:\/\/(localhost|127\.0\.0\.1):\d{2,5}$/.test(o)) return o;
  if (/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(o)) return o;
  return portal;
}

// visual do editor (office.config 'editor'): "lube" = tema da Lube, cabeçalho compacto
// (o nome do arquivo já está no topo do portal), abas em linha e sem dicas de novidade
// do ONLYOFFICE; qualquer outro valor = o visual de antes. O primeiro tema é o padrão.
// Lube Noite é escuro mas declarado "light" (ver office/ferramentas/gerar_temas.py).
export const TEMAS_LUBE = ['theme-lube-claro', 'theme-lube-noite'];

// "Carregado" na tela Arquivo do editor: o ONLYOFFICE mostra o texto como vem
export function dataBrasilia(iso: unknown) {
  const t = typeof iso === 'string' ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return '';
  return new Date(t).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).replace(',', '');
}

export function visualDoEditor(v: unknown) {
  const c = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  if (c.visual !== 'lube') return { lube: false, tema: 'theme-dark' };
  return { lube: true, tema: TEMAS_LUBE.includes(String(c.tema)) ? String(c.tema) : TEMAS_LUBE[0] };
}

function personalizar(visual: { lube: boolean; tema: string }) {
  if (!visual.lube) return { compactHeader: false, uiTheme: visual.tema, features: { spellcheck: { mode: true } } };
  return {
    compactHeader: true,
    toolbarHideFileName: true,
    uiTheme: visual.tema,
    feedback: false,
    suggestFeature: false,
    features: { spellcheck: { mode: true }, tabStyle: 'line', tabBackground: 'toolbar', featuresTips: false },
  };
}

export function montarEditor(o: {
  arquivo: Arquivo; urlArquivo: string; callbackUrl: string; voltarUrl: string;
  pessoa: { id: string; nome: string }; pluginIa?: string; visual?: { lube: boolean; tema: string };
}) {
  const a = o.arquivo;
  const tipo = tipoDocumento(a.extensao);
  if (!tipo) throw new Error('tipo de arquivo sem editor: ' + a.extensao);
  if (!/^[0-9A-Za-z._=-]{1,128}$/.test(a.chave)) throw new Error('chave do documento inválida');
  const p = permissoes(a.papel);
  return {
    documentType: tipo,
    type: 'desktop',
    width: '100%',
    height: '100%',
    document: {
      fileType: a.extensao.toLowerCase(),
      key: a.chave,
      title: a.nome + '.' + a.extensao.toLowerCase(),
      url: o.urlArquivo,
      info: {
        owner: a.dono?.nome ?? '',
        uploaded: dataBrasilia(a.criado_em),
        folder: a.pasta_nome || 'Meus arquivos',
      },
      permissions: p.permissions,
    },
    editorConfig: {
      mode: p.modo,
      lang: 'pt-BR',
      region: 'pt-BR',
      callbackUrl: o.callbackUrl,
      user: { id: o.pessoa.id, name: o.pessoa.nome },
      coEditing: { mode: 'fast', change: true },
      customization: {
        autosave: true,
        comments: true,
        goback: { url: o.voltarUrl, text: 'Voltar ao LUBE OFFICE', blank: false },
        ...personalizar(o.visual ?? visualDoEditor(null)),
      },
      // a IA só escreve para quem pode editar (o servidor confere de novo)
      ...(o.pluginIa && p.permissions.edit
        ? { plugins: { autostart: [GUID_PLUGIN_IA], pluginsData: [o.pluginIa.replace(/\/+$/, '') + '/office/ia/config.json'] } }
        : {}),
    },
  };
}

// lê o que o motor mandou para a callbackUrl (já com o token conferido)
//   status 2 = todos fecharam, salvar · 6 = salvamento forçado · 1 e 4 = nada a fazer
export function lerRetorno(dados: Record<string, unknown>, arquivoId: string, origemMotor: string):
  | { acao: 'ignorar'; status: number }
  | { acao: 'erro'; motivo: string; status: number }
  | { acao: 'salvar'; status: number; url: string; extensao: string; autores: string[]; chave: string; origem: 'editor' | 'forcada' } {
  const status = Number(dados.status);
  const chave = String(dados.key ?? '');
  if (!chave.startsWith(arquivoId + '-')) return { acao: 'erro', motivo: 'chave de outro arquivo', status };
  if (status !== 2 && status !== 6) {
    return status === 3 || status === 7
      ? { acao: 'erro', motivo: 'o motor não conseguiu salvar (status ' + status + ')', status }
      : { acao: 'ignorar', status };
  }
  let url: URL;
  try { url = new URL(String(dados.url ?? '')); } catch { return { acao: 'erro', motivo: 'endereço do arquivo inválido', status }; }
  if (!origemMotor || url.origin !== origemMotor) return { acao: 'erro', motivo: 'arquivo fora do motor', status };
  const extensao = String(dados.filetype ?? '').toLowerCase();
  if (!tipoDocumento(extensao)) return { acao: 'erro', motivo: 'tipo devolvido inválido', status };
  const autores = Array.isArray(dados.users) ? dados.users.filter(uuidValido) : [];
  return { acao: 'salvar', status, url: url.toString(), extensao, autores, chave, origem: status === 6 ? 'forcada' : 'editor' };
}
