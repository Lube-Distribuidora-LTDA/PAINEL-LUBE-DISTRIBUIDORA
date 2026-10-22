// =========================================================
// LUBE OFFICE — IA da Lube (2026-10-21)
// Partes puras: o que pedir ao Claude (instruções e formato da resposta),
// quanto custou, e a conferência do plano antes de ir para o editor.
// Quem executa o plano dentro do Word, do Excel e do PowerPoint é o plugin
// office/ia/executor.js; aqui só sai um "plano" em JSON, nunca HTML nem código.
// Testadas no Node (teste/ia.test.mjs).
// Decisões do Júlio: Claude Haiku 5.5, teto de US$ 10 por dia, todo usuário ativo.
// =========================================================

export type TipoIa = 'docx' | 'xlsx' | 'pptx';
export type ModoIa = 'criar' | 'editor' | 'transformar';

export const MODELO_PADRAO = 'claude-haiku-5-5';

// US$ por milhão de tokens (entrada, saída). O Haiku 5.5 muda de faixa acima de 100 mil
// tokens de entrada; os outros ficam aqui para o caso de o modelo mudar em office.config.
const PRECOS: Record<string, { ate: number; entrada: number; saida: number; entrada2: number; saida2: number }> = {
  'claude-haiku-5-5':  { ate: 100_000, entrada: 0.10, saida: 0.50, entrada2: 0.50, saida2: 2.50 },
  'claude-sonnet-5-5': { ate: Infinity, entrada: 2, saida: 10, entrada2: 2, saida2: 10 },
  'claude-opus-5-5':   { ate: Infinity, entrada: 4, saida: 20, entrada2: 4, saida2: 20 },
};

export function modeloValido(m: unknown): string {
  return typeof m === 'string' && PRECOS[m] ? m : MODELO_PADRAO;
}

export function custoUsd(modelo: string, uso: { input_tokens?: number; output_tokens?: number;
  cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null }) {
  const p = PRECOS[modeloValido(modelo)];
  const entrada = (uso.input_tokens ?? 0) + (uso.cache_creation_input_tokens ?? 0) + (uso.cache_read_input_tokens ?? 0);
  const saida = uso.output_tokens ?? 0;
  const longo = entrada > p.ate;
  const v = entrada * (longo ? p.entrada2 : p.entrada) / 1e6 + saida * (longo ? p.saida2 : p.saida) / 1e6;
  return Math.round(v * 1e6) / 1e6;
}

/* ---------------------------------------------------------
   Formato da resposta (structured outputs: todo objeto com additionalProperties
   false e todos os campos obrigatórios; o que é opcional aceita vazio)
   --------------------------------------------------------- */
const texto = { type: 'string' };
const textos = { type: 'array', items: texto };
const obj = (props: Record<string, unknown>) => ({
  type: 'object', additionalProperties: false, required: Object.keys(props), properties: props,
});

const ESQUEMA_DOCX = obj({
  titulo_arquivo: texto,
  resumo: texto,
  blocos: {
    type: 'array',
    items: obj({
      tipo: { type: 'string', enum: ['titulo', 'subtitulo', 'secao', 'paragrafo', 'lista', 'numerada', 'tabela', 'citacao', 'destaque', 'separador'] },
      texto,
      itens: textos,
      linhas: { type: 'array', items: textos },
    }),
  },
});

const celula = { anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'null' }] };
const ESQUEMA_XLSX = obj({
  titulo_arquivo: texto,
  resumo: texto,
  abas: {
    type: 'array',
    items: obj({
      nome: texto,
      titulo: texto,
      subtitulo: texto,
      cabecalho: textos,
      linhas: { type: 'array', items: { type: 'array', items: celula } },
      formatos: {
        type: 'array',
        items: obj({
          coluna: texto,
          tipo: { type: 'string', enum: ['moeda', 'numero', 'inteiro', 'porcentagem', 'data', 'texto'] },
        }),
      },
      total: { anyOf: [{ type: 'null' }, obj({ rotulo: texto, colunas: textos })] },
      grafico: {
        anyOf: [{ type: 'null' }, obj({
          tipo: { type: 'string', enum: ['colunas', 'barras', 'linhas', 'pizza', 'rosca', 'area'] },
          titulo: texto,
          categorias: texto,
          series: textos,
        })],
      },
      observacao: texto,
    }),
  },
});

const ESQUEMA_PPTX = obj({
  titulo_arquivo: texto,
  resumo: texto,
  slides: {
    type: 'array',
    items: obj({
      layout: { type: 'string', enum: ['capa', 'secao', 'topicos', 'duas_colunas', 'numeros', 'etapas', 'citacao', 'encerramento'] },
      titulo: texto,
      subtitulo: texto,
      topicos: textos,
      colunas: { type: 'array', items: obj({ titulo: texto, topicos: textos }) },
      numeros: { type: 'array', items: obj({ valor: texto, rotulo: texto }) },
      etapas: { type: 'array', items: obj({ titulo: texto, texto }) },
      notas: texto,
    }),
  },
});

export function esquema(tipo: TipoIa) {
  return tipo === 'xlsx' ? ESQUEMA_XLSX : tipo === 'pptx' ? ESQUEMA_PPTX : ESQUEMA_DOCX;
}

/* ---------------------------------------------------------
   Instruções (system prompt). Fixas por tipo, para o cache de esquema e de prompt.
   --------------------------------------------------------- */
const BASE = `Você é a IA da Lube, dentro do LUBE OFFICE, o pacote de documentos do painel da Lube Distribuidora \
(distribuidora atacadista de Cariacica-ES, desde 1959). Quem pede é um funcionário da Lube.

Regras:
- Escreva em português do Brasil, claro e profissional, sem enrolação. Datas em DD/MM/AAAA, dinheiro em R$.
- Faça exatamente o que foi pedido. Se vierem imagens (foto de quadro, anotação à mão, rascunho, tabela impressa, print), \
leia com atenção: transcreva fielmente o que estiver escrito e organize; se o pedido for de ideias, desenvolva a partir delas.
- Não invente números como se fossem dados reais da Lube. Se o pedido precisa de números e eles não vieram, use valores \
de exemplo e avise uma vez só (no subtítulo ou numa observação, e no resumo), sem repetir "exemplo" em cada item.
- Use a data de hoje, que vem no pedido, para ano, mês e prazos.
- O resumo é uma frase curta para a pessoa (ex.: "Montei a ata com 4 decisões e 3 responsáveis."). Se ela fez uma \
pergunta sobre o conteúdo, a resposta vai no resumo.
- titulo_arquivo: nome curto para o arquivo, sem extensão (até 60 caracteres).
- Responda só no formato pedido.`;

const DOCX = `${BASE}

Você monta um documento do Word em blocos, de cima para baixo:
- titulo (um só, no começo, quando for um documento novo), subtitulo (linha de apoio sob o título), secao (título de seção), \
paragrafo, lista (marcadores), numerada (passos), tabela, citacao, destaque (recado importante em caixa), separador.
- Em cada bloco, preencha só o campo que ele usa e deixe os outros vazios: texto para titulo, subtitulo, secao, paragrafo, \
citacao e destaque; itens para lista e numerada; linhas para tabela (a primeira linha é o cabeçalho).
- Use **negrito** com moderação, só dentro de texto e itens. Nada de HTML ou Markdown fora disso.
- Parágrafos curtos. Tabela quando o conteúdo for tabular (itens, valores, prazos, responsáveis).
- Se veio "Texto selecionado" e o pedido é para mexer nele (melhorar, resumir, traduzir, corrigir), devolva só os blocos \
que vão no lugar dele, sem título novo.`;

const XLSX = `${BASE}

Você monta uma planilha do Excel. Cada aba vira uma tabela com a cara da Lube, sempre no mesmo lugar:
- linha 1: titulo; linha 2: subtitulo (período, fonte ou observação curta); linha 4: cabeçalho; dados a partir da linha 5, \
começando na coluna A.
- Números vão como número (1234.5), nunca como texto com "R$" ou "%". Porcentagem como fração (0.15 = 15%). Datas como texto \
DD/MM/AAAA.
- Fórmulas: texto começando com "=", em inglês e com vírgula separando argumentos (=SUM(C5:C9), =IF(D5>0,C5/D5,0)). \
Use {L} para a linha da própria célula, {P} para a primeira linha de dados e {U} para a última \
(ex.: =C{L}*D{L} e =E{L}/SUM(E{P}:E{U})).
- Coluna calculada a partir de outras (percentual, diferença, total da linha, média) leva a fórmula em todas as linhas: \
nunca deixe null nem o valor já calculado.
- formatos: diga o formato de cada coluna numérica pela letra (moeda, numero, inteiro, porcentagem, data, texto).
- total: quando fizer sentido somar, diga o rótulo e as letras das colunas a somar (o total é calculado com fórmula). Senão, null.
- grafico: quando um gráfico ajudar a ler, diga o tipo, o título, a letra da coluna das categorias e as letras das séries. Senão, null.
- Até 4 abas, até 300 linhas e 14 colunas por aba. nome da aba com até 28 caracteres.
- observacao: uma linha que vai embaixo da tabela (fonte, premissa) ou vazio.
- Se veio "Dados da planilha aberta", use esses dados (análise, resumo, tabela dinâmica feita à mão, projeção) numa aba nova.`;

const PPTX = `${BASE}

Você monta uma apresentação com a identidade da Lube (azul #0D176E, vermelho #E5101F, faixas inclinadas). Quem desenha \
os slides, com as animações e transições, é o editor: você decide o conteúdo e o layout de cada slide.
- Layouts: capa (abre a apresentação: titulo e subtitulo), secao (divisória de capítulo), topicos (até 6 tópicos curtos), \
duas_colunas (comparação ou antes/depois: 2 colunas com titulo e tópicos), numeros (2 a 4 indicadores: valor curto como \
"R$ 1,2 mi", "+18%", "96%" e rótulo), etapas (3 a 5 passos de um processo ou cronograma: titulo e texto curto), \
citacao (frase de destaque no titulo e o autor no subtitulo), encerramento (fecha: titulo como "Obrigado" ou a mensagem final).
- Comece com capa e termine com encerramento quando for uma apresentação nova. Varie os layouts.
- Títulos com até 60 caracteres; tópicos com até 90 caracteres; nada de parágrafo longo em slide.
- notas: o que a pessoa fala naquele slide (2 a 4 frases), para as anotações do apresentador.
- Preencha só os campos que o layout usa e deixe os outros vazios.
- Apresentação nova: de 6 a 12 slides, salvo se pedirem outro número.`;

export function instrucoes(tipo: TipoIa) {
  return tipo === 'xlsx' ? XLSX : tipo === 'pptx' ? PPTX : DOCX;
}

const UM: Record<TipoIa, string> = { docx: 'um documento do Word', xlsx: 'uma planilha do Excel', pptx: 'uma apresentação' };
const NOVO: Record<TipoIa, string> = { docx: 'um documento do Word novo', xlsx: 'uma planilha do Excel nova', pptx: 'uma apresentação nova' };

// texto do pedido (as imagens vão antes dele, como blocos de imagem)
export function montarPedido(o: {
  tipo: TipoIa; modo: ModoIa; pedido: string; contexto?: string; fonte?: { nome: string; texto: string } | null;
  nomeArquivo?: string; imagens: number; hoje?: string;
}) {
  const partes: string[] = [];
  if (o.hoje) partes.push(`Hoje é ${o.hoje}.`);
  if (o.modo === 'criar') partes.push(`Crie ${NOVO[o.tipo]}.`);
  else if (o.modo === 'transformar') partes.push(`Transforme o arquivo de origem abaixo em ${NOVO[o.tipo]}.`);
  else partes.push(`A pessoa está com ${o.nomeArquivo ? `o arquivo "${o.nomeArquivo}"` : UM[o.tipo]} aberto no editor e pediu algo para ele.`);
  if (o.imagens) partes.push(`Ela mandou ${o.imagens} ${o.imagens === 1 ? 'imagem' : 'imagens'} (acima).`);
  if (o.fonte) partes.push(`<arquivo_de_origem nome="${o.fonte.nome}">\n${o.fonte.texto}\n</arquivo_de_origem>`);
  if (o.contexto) {
    const rotulo = o.tipo === 'xlsx' ? 'Dados da planilha aberta' : o.tipo === 'pptx' ? 'Slides atuais' : 'Texto selecionado';
    partes.push(`<${rotulo.replace(/ /g, '_').toLowerCase()}>\n${o.contexto}\n</${rotulo.replace(/ /g, '_').toLowerCase()}>`);
    partes.push(`(${rotulo} vem acima.)`);
  }
  partes.push(`Pedido: ${o.pedido || (o.modo === 'transformar' ? 'Use o melhor formato para este conteúdo.' : 'Organize o conteúdo das imagens.')}`);
  return partes.join('\n\n');
}

/* ---------------------------------------------------------
   Conferência do plano: corta tamanhos, tira caractere de controle e garante os campos
   (o plugin confere de novo; isto aqui protege a conta e o editor)
   --------------------------------------------------------- */
const limpo = (v: unknown, max = 2000) =>
  String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, max);
const lista = (v: unknown, n: number, max = 400) => (Array.isArray(v) ? v : []).slice(0, n).map((x) => limpo(x, max));
const COLUNA = /^[A-Z]{1,2}$/;

export function conferirPlano(tipo: TipoIa, p: any) {
  if (!p || typeof p !== 'object') throw new Error('plano vazio');
  const base = { titulo_arquivo: limpo(p.titulo_arquivo, 60).replace(/[\\/:*?"<>|]/g, ' ').trim(), resumo: limpo(p.resumo, 600) };
  if (tipo === 'docx') {
    const blocos = (Array.isArray(p.blocos) ? p.blocos : []).slice(0, 400).map((b: any) => ({
      tipo: ['titulo', 'subtitulo', 'secao', 'paragrafo', 'lista', 'numerada', 'tabela', 'citacao', 'destaque', 'separador']
        .includes(b?.tipo) ? b.tipo : 'paragrafo',
      texto: limpo(b?.texto, 4000),
      itens: lista(b?.itens, 60, 1000),
      linhas: (Array.isArray(b?.linhas) ? b.linhas : []).slice(0, 200).map((l: unknown) => lista(l, 12, 500)),
    }));
    if (!blocos.length) throw new Error('a IA não devolveu conteúdo');
    return { ...base, blocos };
  }
  if (tipo === 'xlsx') {
    const abas = (Array.isArray(p.abas) ? p.abas : []).slice(0, 4).map((a: any, i: number) => {
      const cab = lista(a?.cabecalho, 14, 120);
      const linhas = (Array.isArray(a?.linhas) ? a.linhas : []).slice(0, 300).map((l: unknown) =>
        (Array.isArray(l) ? l : []).slice(0, 14).map((c) => (typeof c === 'number' && Number.isFinite(c) ? c : c == null ? null : limpo(c, 500))));
      const colunas = (v: unknown) => lista(v, 14, 3).map((c) => c.toUpperCase()).filter((c) => COLUNA.test(c));
      return {
        nome: limpo(a?.nome, 28).replace(/[\\/?*[\]:']/g, ' ').trim() || 'Aba ' + (i + 1),
        titulo: limpo(a?.titulo, 160), subtitulo: limpo(a?.subtitulo, 200),
        cabecalho: cab, linhas,
        formatos: (Array.isArray(a?.formatos) ? a.formatos : []).slice(0, 14)
          .map((f: any) => ({ coluna: limpo(f?.coluna, 3).toUpperCase(), tipo: ['moeda', 'numero', 'inteiro', 'porcentagem', 'data', 'texto'].includes(f?.tipo) ? f.tipo : 'texto' }))
          .filter((f: any) => COLUNA.test(f.coluna)),
        total: a?.total && typeof a.total === 'object' ? { rotulo: limpo(a.total.rotulo, 60) || 'Total', colunas: colunas(a.total.colunas) } : null,
        grafico: a?.grafico && typeof a.grafico === 'object' && COLUNA.test(String(a.grafico.categorias ?? '').toUpperCase())
          ? {
              tipo: ['colunas', 'barras', 'linhas', 'pizza', 'rosca', 'area'].includes(a.grafico.tipo) ? a.grafico.tipo : 'colunas',
              titulo: limpo(a.grafico.titulo, 120), categorias: String(a.grafico.categorias).toUpperCase(), series: colunas(a.grafico.series),
            }
          : null,
        observacao: limpo(a?.observacao, 300),
      };
    }).filter((a: any) => a.cabecalho.length || a.linhas.length);
    if (!abas.length) throw new Error('a IA não devolveu nenhuma tabela');
    return { ...base, abas };
  }
  const slides = (Array.isArray(p.slides) ? p.slides : []).slice(0, 25).map((s: any) => ({
    layout: ['capa', 'secao', 'topicos', 'duas_colunas', 'numeros', 'etapas', 'citacao', 'encerramento'].includes(s?.layout) ? s.layout : 'topicos',
    titulo: limpo(s?.titulo, 140), subtitulo: limpo(s?.subtitulo, 240),
    topicos: lista(s?.topicos, 8, 200),
    colunas: (Array.isArray(s?.colunas) ? s.colunas : []).slice(0, 2).map((c: any) => ({ titulo: limpo(c?.titulo, 80), topicos: lista(c?.topicos, 6, 160) })),
    numeros: (Array.isArray(s?.numeros) ? s.numeros : []).slice(0, 4).map((n: any) => ({ valor: limpo(n?.valor, 16), rotulo: limpo(n?.rotulo, 80) })),
    etapas: (Array.isArray(s?.etapas) ? s.etapas : []).slice(0, 5).map((e: any) => ({ titulo: limpo(e?.titulo, 60), texto: limpo(e?.texto, 160) })),
    notas: limpo(s?.notas, 1500),
  }));
  if (!slides.length) throw new Error('a IA não devolveu nenhum slide');
  return { ...base, slides };
}

/* ---------------------------------------------------------
   Texto de um arquivo do Office (para "Transformar com IA"): recebe os XML de dentro
   do arquivo (o index.ts abre o zip) e devolve texto corrido
   --------------------------------------------------------- */
const ENT: Record<string, string> = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&apos;': "'" };
const desescapar = (s: string) => s.replace(/&(lt|gt|amp|quot|apos);|&#(\d+);|&#x([0-9a-f]+);/gi, (m, _n, d, h) =>
  d ? String.fromCodePoint(+d) : h ? String.fromCodePoint(parseInt(h, 16)) : ENT[m] ?? m);

// Word: um parágrafo por <w:p>, células de tabela separadas por " | "
export function textoDocx(documentXml: string) {
  const corpo = documentXml.replace(/<w:tc[ >]/g, ' | $&');
  return corpo.split(/<\/w:p>/).map((p) =>
    desescapar((p.match(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, '')).join('')).trim())
    .map((l) => l.replace(/^\|\s*/, ''))
    .filter(Boolean).join('\n');
}

// Excel: cada aba vira linhas com células separadas por tabulação
export function textoXlsx(sharedStringsXml: string, abas: { nome: string; xml: string }[], maxLinhas = 400) {
  const comp = (sharedStringsXml.match(/<si>[\s\S]*?<\/si>/g) ?? [])
    .map((si) => desescapar((si.match(/<t(?: [^>]*)?>([^<]*)<\/t>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, '')).join('')));
  const saida: string[] = [];
  for (const a of abas) {
    saida.push(`## Aba: ${a.nome}`);
    const linhas = a.xml.match(/<row[\s\S]*?<\/row>/g) ?? [];
    for (const r of linhas.slice(0, maxLinhas)) {
      const cels = (r.match(/<c [^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) ?? []).map((c) => {
        const t = /\bt="([^"]+)"/.exec(c)?.[1];
        const v = /<v>([^<]*)<\/v>/.exec(c)?.[1];
        const inl = /<is>[\s\S]*?<t(?: [^>]*)?>([^<]*)<\/t>/.exec(c)?.[1];
        if (t === 's' && v != null) return comp[+v] ?? '';
        if (inl != null) return desescapar(inl);
        return v != null ? desescapar(v) : '';
      });
      if (cels.some((x) => x !== '')) saida.push(cels.join('\t'));
    }
    if (linhas.length > maxLinhas) saida.push(`(… mais ${linhas.length - maxLinhas} linhas)`);
  }
  return saida.join('\n');
}

// PowerPoint: o texto de cada slide, na ordem
export function textoPptx(slides: string[]) {
  return slides.map((xml, i) => {
    const paras = xml.split(/<\/a:p>/).map((p) =>
      desescapar((p.match(/<a:t>([^<]*)<\/a:t>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, '')).join('')).trim()).filter(Boolean);
    return `## Slide ${i + 1}\n${paras.join('\n')}`;
  }).join('\n\n');
}

// "quarta-feira, 21/10/2026" no horário de Brasília (vai no pedido, não nas instruções, para não quebrar o cache)
export function hojeBrasilia(agora = new Date()) {
  const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', ...o }).format(agora);
  return f({ weekday: 'long' }) + ', ' + f({ day: '2-digit', month: '2-digit', year: 'numeric' });
}

// ordem natural dos arquivos de slide/aba dentro do zip (slide10 depois de slide9)
export function ordemNatural(a: string, b: string) {
  const n = (s: string) => Number(/(\d+)\.xml$/.exec(s)?.[1] ?? 0);
  return n(a) - n(b);
}

export const LIMITE_TEXTO_FONTE = 120_000;
export const TIPOS_IMAGEM = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
export const LIMITE_IMAGEM_BYTES = 5 * 1024 * 1024;   // limite da API do Claude por imagem
