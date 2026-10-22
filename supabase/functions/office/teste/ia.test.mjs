// Testes da IA da Lube (partes puras de ia.ts e o plugin na configuração do editor).
// Rodar: node --test supabase/functions/office/teste/ia.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  conferirPlano, custoUsd, esquema, hojeBrasilia, instrucoes, modeloValido, montarPedido, ordemNatural, textoDocx, textoPptx, textoXlsx,
} from '../ia.ts';
import { GUID_PLUGIN_IA, montarEditor, origemDoPlugin } from '../motor.ts';

const PORTAL = 'https://painel-lube-distribuidora.vercel.app';

test('custo: Haiku 5.5 a US$ 0,10 / 0,50 por milhão, e a faixa acima de 100 mil tokens', () => {
  assert.equal(custoUsd('claude-haiku-5-5', { input_tokens: 10_000, output_tokens: 5_000 }), 0.0035);
  assert.equal(custoUsd('claude-haiku-5-5', { input_tokens: 200_000, output_tokens: 1_000 }), 0.1025);
  assert.equal(custoUsd('modelo-que-nao-existe', { input_tokens: 50_000, output_tokens: 0 }), 0.005);
  assert.equal(custoUsd('claude-sonnet-5-5', { input_tokens: 1_000, output_tokens: 1_000 }), 0.012);
  assert.equal(modeloValido('claude-opus-5-5'), 'claude-opus-5-5');
  assert.equal(modeloValido(undefined), 'claude-haiku-5-5');
});

test('esquemas: todo objeto fecha additionalProperties e exige todos os campos', () => {
  const ver = (s, caminho) => {
    if (!s || typeof s !== 'object') return;
    if (s.type === 'object') {
      assert.equal(s.additionalProperties, false, caminho);
      assert.deepEqual([...s.required].sort(), Object.keys(s.properties).sort(), caminho);
    }
    for (const [k, v] of Object.entries(s)) {
      if (Array.isArray(v)) v.forEach((x, i) => ver(x, caminho + '.' + k + '[' + i + ']'));
      else if (typeof v === 'object') ver(v, caminho + '.' + k);
    }
  };
  for (const t of ['docx', 'xlsx', 'pptx']) {
    ver(esquema(t), t);
    assert.match(instrucoes(t), /IA da Lube/);
  }
});

test('plano do Word: corta, limpa e não deixa vazio', () => {
  const p = conferirPlano('docx', {
    titulo_arquivo: 'Ata: reunião/comercial', resumo: 'ok',
    blocos: [{ tipo: 'titulo', texto: 'Ata\u0007', itens: [], linhas: [] }, { tipo: 'inventado', texto: 'x', itens: [], linhas: [] }],
  });
  assert.equal(p.titulo_arquivo, 'Ata  reunião comercial');
  assert.equal(p.blocos[0].texto, 'Ata');
  assert.equal(p.blocos[1].tipo, 'paragrafo');
  assert.throws(() => conferirPlano('docx', { blocos: [] }), /não devolveu/);
});

test('plano do Excel: colunas válidas, números como número, aba sem nome ganha um', () => {
  const p = conferirPlano('xlsx', {
    titulo_arquivo: 'Metas', resumo: '',
    abas: [{
      nome: 'Metas/2026?', titulo: 'Metas', subtitulo: '', cabecalho: ['Filial', 'Meta', 'Real', '%'],
      linhas: [['Cariacica', 1000, 900, '=C{L}/B{L}'], ['Serra', null, 'abc', 2]],
      formatos: [{ coluna: 'b', tipo: 'moeda' }, { coluna: '1', tipo: 'moeda' }, { coluna: 'D', tipo: 'xyz' }],
      total: { rotulo: '', colunas: ['B', 'c', 'ZZZ'] },
      grafico: { tipo: 'colunas', titulo: 'Meta x real', categorias: 'a', series: ['B', 'C'] },
      observacao: '',
    }, { nome: '', cabecalho: [], linhas: [] }],
  });
  assert.equal(p.abas.length, 1);
  const a = p.abas[0];
  assert.equal(a.nome, 'Metas 2026');
  assert.deepEqual(a.linhas[0], ['Cariacica', 1000, 900, '=C{L}/B{L}']);
  assert.deepEqual(a.linhas[1], ['Serra', null, 'abc', 2]);
  assert.deepEqual(a.formatos, [{ coluna: 'B', tipo: 'moeda' }, { coluna: 'D', tipo: 'texto' }]);
  assert.deepEqual(a.total, { rotulo: 'Total', colunas: ['B', 'C'] });
  assert.equal(a.grafico.categorias, 'A');
  assert.throws(() => conferirPlano('xlsx', { abas: [] }), /nenhuma tabela/);
});

test('plano da apresentação: layout desconhecido vira tópicos e corta o excesso', () => {
  const p = conferirPlano('pptx', {
    titulo_arquivo: 'Resultado', resumo: '',
    slides: [
      { layout: 'capa', titulo: 'Resultado', subtitulo: 'Outubro', topicos: [], colunas: [], numeros: [], etapas: [], notas: '' },
      { layout: 'mosaico', titulo: 'x', subtitulo: '', topicos: Array(20).fill('t'), colunas: [], numeros: Array(9).fill({ valor: '1', rotulo: 'a' }), etapas: [], notas: '' },
    ],
  });
  assert.equal(p.slides[1].layout, 'topicos');
  assert.equal(p.slides[1].topicos.length, 8);
  assert.equal(p.slides[1].numeros.length, 4);
});

test('pedido: imagens, contexto e arquivo de origem entram no texto', () => {
  const t = montarPedido({ tipo: 'xlsx', modo: 'editor', pedido: 'some a coluna', contexto: 'A\tB', imagens: 2, nomeArquivo: 'Metas.xlsx' });
  assert.match(t, /o arquivo "Metas.xlsx" aberto/);
  assert.match(t, /2 imagens/);
  assert.match(t, /<dados_da_planilha_aberta>\nA\tB/);
  assert.match(montarPedido({ tipo: 'docx', modo: 'criar', pedido: 'x', imagens: 0, hoje: 'terça-feira, 21/10/2026' }), /^Hoje é terça-feira, 21\/10\/2026\./);
  // 02:30 UTC de 22/10 ainda é 21/10 em Brasília
  assert.equal(hojeBrasilia(new Date('2026-10-22T02:30:00Z')), 'quarta-feira, 21/10/2026');
  const t2 = montarPedido({ tipo: 'pptx', modo: 'transformar', pedido: '', fonte: { nome: 'Ata.docx', texto: 'Decisões' }, imagens: 0 });
  assert.match(t2, /Transforme o arquivo de origem/);
  assert.match(t2, /<arquivo_de_origem nome="Ata.docx">\nDecisões/);
});

test('texto do Word, do Excel e do PowerPoint para transformar', () => {
  const doc = '<w:body><w:p><w:r><w:t>Ata de </w:t></w:r><w:r><w:t xml:space="preserve">reunião &amp; pauta</w:t></w:r></w:p>' +
    '<w:p></w:p><w:p><w:r><w:t>Decidido</w:t></w:r></w:p></w:body>';
  assert.equal(textoDocx(doc), 'Ata de reunião & pauta\nDecidido');

  const ss = '<sst><si><t>Filial</t></si><si><r><t>Ca</t></r><r><t>riacica</t></r></si></sst>';
  const aba = '<sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>Meta</t></is></c></row>' +
    '<row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>1500.5</v></c></row><row r="3"><c r="A3"/></row></sheetData>';
  assert.equal(textoXlsx(ss, [{ nome: 'Metas', xml: aba }]), '## Aba: Metas\nFilial\tMeta\nCariacica\t1500.5');

  const s1 = '<p:sld><a:p><a:r><a:t>Resultado</a:t></a:r></a:p><a:p><a:r><a:t>de outubro</a:t></a:r></a:p></p:sld>';
  assert.equal(textoPptx([s1]), '## Slide 1\nResultado\nde outubro');
  assert.deepEqual(['ppt/slides/slide10.xml', 'ppt/slides/slide2.xml', 'ppt/slides/slide1.xml'].sort(ordemNatural),
    ['ppt/slides/slide1.xml', 'ppt/slides/slide2.xml', 'ppt/slides/slide10.xml']);
});

test('plugin: de onde vem e só para quem pode editar', () => {
  assert.equal(origemDoPlugin(PORTAL, PORTAL), PORTAL);
  assert.equal(origemDoPlugin('http://localhost:4321', PORTAL), 'http://localhost:4321');
  assert.equal(origemDoPlugin('https://abc-def.trycloudflare.com', PORTAL), 'https://abc-def.trycloudflare.com');
  assert.equal(origemDoPlugin('https://site-malicioso.com', PORTAL), PORTAL);
  assert.equal(origemDoPlugin('https://x.trycloudflare.com.evil.com', PORTAL), PORTAL);
  assert.equal(origemDoPlugin(null, PORTAL), PORTAL);

  const base = {
    urlArquivo: 'https://x/arq', callbackUrl: 'https://x/cb', voltarUrl: 'https://x/', pessoa: { id: 'p', nome: 'P' }, pluginIa: PORTAL,
  };
  const arq = (papel) => ({ id: 'a', nome: 'N', extensao: 'docx', chave: 'a-1', papel });
  const ed = montarEditor({ ...base, arquivo: arq('editar') });
  assert.deepEqual(ed.editorConfig.plugins, { autostart: [GUID_PLUGIN_IA], pluginsData: [PORTAL + '/office/ia/config.json'] });
  assert.equal(montarEditor({ ...base, arquivo: arq('ver') }).editorConfig.plugins, undefined);
  assert.equal(montarEditor({ ...base, pluginIa: undefined, arquivo: arq('dono') }).editorConfig.plugins, undefined);
});
