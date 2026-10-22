// Testes das partes puras da função office (JWT e motor de edição).
// Rodar: node --test supabase/functions/office/teste/motor.test.mjs
// (o Node 22.18+ lê .ts sozinho; a Edge Function roda as mesmas fontes no Deno)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assinarHS256, verificarHS256 } from '../jwt.ts';
import { lerRetorno, montarEditor, motorVivo, permissoes, tipoDocumento, urlMotorValida, visualDoEditor } from '../motor.ts';
import { linhaUnica, montarEmail, tipoMime } from '../email.ts';

const CHAVE = 'chave-de-teste-com-tamanho-suficiente';
const ID = '11111111-2222-3333-4444-555555555555';
const MOTOR = 'https://office.lube.com.br';

test('JWT: assina e confere', async () => {
  const t = await assinarHS256({ a: 1, b: 'x' }, CHAVE);
  const p = await verificarHS256(t, CHAVE);
  assert.equal(p.a, 1);
  assert.equal(p.b, 'x');
  assert.ok(p.exp > p.iat);
});

test('JWT: recusa chave errada, token mexido, alg none e vencido', async () => {
  const t = await assinarHS256({ a: 1 }, CHAVE);
  assert.equal(await verificarHS256(t, 'outra-chave'), null);
  const [c, , s] = t.split('.');
  const mexido = c + '.' + Buffer.from(JSON.stringify({ a: 2 })).toString('base64url') + '.' + s;
  assert.equal(await verificarHS256(mexido, CHAVE), null);
  const semAlg = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url') + '.' + t.split('.')[1] + '.';
  assert.equal(await verificarHS256(semAlg, CHAVE), null);
  const velho = await assinarHS256({ a: 1 }, CHAVE, 10);
  assert.equal(await verificarHS256(velho, CHAVE, Math.floor(Date.now() / 1000) + 3600), null);
  assert.equal(await verificarHS256(null, CHAVE), null);
  assert.equal(await verificarHS256(t, ''), null);
});

test('tipos de documento', () => {
  assert.equal(tipoDocumento('DOCX'), 'word');
  assert.equal(tipoDocumento('xlsx'), 'cell');
  assert.equal(tipoDocumento('pptx'), 'slide');
  assert.equal(tipoDocumento('pdf'), 'pdf');
  assert.equal(tipoDocumento('exe'), null);
});

test('papéis viram permissões do editor', () => {
  assert.equal(permissoes('dono').permissions.edit, true);
  assert.equal(permissoes('editar').modo, 'edit');
  const c = permissoes('comentar');
  assert.equal(c.modo, 'edit');
  assert.equal(c.permissions.edit, false);
  assert.equal(c.permissions.comment, true);
  const v = permissoes('ver');
  assert.equal(v.modo, 'view');
  assert.equal(v.permissions.comment, false);
});

test('configuração do editor', () => {
  const cfg = montarEditor({
    arquivo: { id: ID, nome: 'Metas', extensao: 'xlsx', chave: ID + '-3', papel: 'comentar', dono: { nome: 'TI' }, pasta_nome: null },
    urlArquivo: 'https://x/arquivo', callbackUrl: 'https://x/motor?arquivo=' + ID, voltarUrl: 'https://portal/office/',
    pessoa: { id: 'p1', nome: 'Júlio' },
  });
  assert.equal(cfg.documentType, 'cell');
  assert.equal(cfg.document.title, 'Metas.xlsx');
  assert.equal(cfg.document.key, ID + '-3');
  assert.equal(cfg.document.info.folder, 'Meus arquivos');
  assert.equal(cfg.editorConfig.user.name, 'Júlio');
  assert.equal(cfg.editorConfig.lang, 'pt-BR');
  assert.equal(cfg.document.permissions.edit, false);
  assert.throws(() => montarEditor({ ...cfgBase(), arquivo: { ...cfgBase().arquivo, extensao: 'exe' } }));
  assert.throws(() => montarEditor({ ...cfgBase(), arquivo: { ...cfgBase().arquivo, chave: 'a/b' } }));
});

test('visual do editor: o de antes até ligar, e o da Lube só com tema conhecido', () => {
  assert.deepEqual(visualDoEditor(null), { lube: false, tema: 'theme-dark' });
  assert.deepEqual(visualDoEditor({ visual: 'classico' }), { lube: false, tema: 'theme-dark' });
  assert.deepEqual(visualDoEditor({ visual: 'lube' }), { lube: true, tema: 'theme-lube-claro' });
  assert.deepEqual(visualDoEditor({ visual: 'lube', tema: 'theme-lube-escuro' }), { lube: true, tema: 'theme-lube-claro' });
  assert.deepEqual(visualDoEditor({ visual: 'lube', tema: '"><script>' }), { lube: true, tema: 'theme-lube-claro' });

  const antes = montarEditor(cfgBase()).editorConfig.customization;
  assert.equal(antes.uiTheme, 'theme-dark');
  assert.equal(antes.compactHeader, false);
  assert.equal(antes.goback.text, 'Voltar ao LUBE OFFICE');

  const lube = montarEditor({ ...cfgBase(), visual: visualDoEditor({ visual: 'lube' }) }).editorConfig.customization;
  assert.equal(lube.uiTheme, 'theme-lube-claro');
  assert.equal(lube.compactHeader, true);
  assert.equal(lube.toolbarHideFileName, true);
  assert.equal(lube.features.tabStyle, 'line');
  assert.equal(lube.features.spellcheck.mode, true);
  assert.equal(lube.autosave, true);
});

function cfgBase() {
  return {
    arquivo: { id: ID, nome: 'x', extensao: 'docx', chave: ID + '-1', papel: 'dono' },
    urlArquivo: 'u', callbackUrl: 'c', voltarUrl: 'v', pessoa: { id: 'p', nome: 'n' },
  };
}

test('retorno do motor: salvar, ignorar e recusar', () => {
  const ok = lerRetorno({ status: 2, key: ID + '-1', url: MOTOR + '/cache/files/x/output.docx', filetype: 'docx',
    users: [ID, 'nao-e-uuid'] }, ID, MOTOR);
  assert.equal(ok.acao, 'salvar');
  assert.equal(ok.origem, 'editor');
  assert.deepEqual(ok.autores, [ID]);
  assert.equal(lerRetorno({ status: 6, key: ID + '-1', url: MOTOR + '/a', filetype: 'docx' }, ID, MOTOR).origem, 'forcada');
  assert.equal(lerRetorno({ status: 1, key: ID + '-1' }, ID, MOTOR).acao, 'ignorar');
  assert.equal(lerRetorno({ status: 4, key: ID + '-1' }, ID, MOTOR).acao, 'ignorar');
  assert.equal(lerRetorno({ status: 3, key: ID + '-1' }, ID, MOTOR).acao, 'erro');
  // chave de outro arquivo, arquivo vindo de outro servidor, tipo estranho
  assert.equal(lerRetorno({ status: 2, key: 'outro-1', url: MOTOR + '/a', filetype: 'docx' }, ID, MOTOR).acao, 'erro');
  assert.equal(lerRetorno({ status: 2, key: ID + '-1', url: 'https://malicioso.com/a', filetype: 'docx' }, ID, MOTOR).acao, 'erro');
  assert.equal(lerRetorno({ status: 2, key: ID + '-1', url: MOTOR + '/a', filetype: 'exe' }, ID, MOTOR).acao, 'erro');
});

test('nunca baixar: o editor não oferece download para nenhum papel', () => {
  for (const p of ['dono', 'editar', 'comentar', 'ver']) assert.equal(permissoes(p).permissions.download, false);
  assert.equal(permissoes('ver').permissions.print, true);
});

test('endereço e sinal do motor registrado pela SRV-IA', () => {
  assert.equal(urlMotorValida('https://abc-def.trycloudflare.com'), true);
  assert.equal(urlMotorValida('https://office.lube.com.br/'), true);
  assert.equal(urlMotorValida('http://abc.trycloudflare.com'), false);
  assert.equal(urlMotorValida('https://abc.com/caminho'), false);
  assert.equal(urlMotorValida('https://abc.com@malicioso.com'), false);
  const agora = Date.parse('2026-10-21T15:00:00Z');
  assert.equal(motorVivo('2026-10-21T14:50:00Z', agora), true);
  assert.equal(motorVivo('2026-10-21T14:40:00Z', agora), false);
  assert.equal(motorVivo(null, agora), false);
});

test('e-mail do Enviar: escapa o que vem da pessoa e não deixa quebrar o cabeçalho', () => {
  const e = montarEmail({ remetente: { nome: 'Ana\r\nBcc: x@y.com', email: 'ana@lube.com.br' },
    arquivo: 'Proposta <b>.docx', mensagem: '<script>alert(1)</script> segue' });
  assert.ok(!/[\r\n]/.test(e.assunto));
  assert.ok(e.assunto.startsWith('Ana Bcc: x@y.com enviou'));
  assert.ok(e.html.includes('&lt;script&gt;'));
  assert.ok(!e.html.includes('<script>'));
  assert.ok(e.html.includes('Proposta &lt;b&gt;.docx'));
  assert.ok(e.texto.includes('ana@lube.com.br'));
  assert.equal(linhaUnica('a\n\nb'), 'a b');
  assert.equal(tipoMime('xlsx'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
});
