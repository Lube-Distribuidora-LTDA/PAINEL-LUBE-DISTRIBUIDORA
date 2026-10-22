/* =========================================================
   LUBE OFFICE — modo demonstração (só em localhost, ?demo=1)
   Dados sintéticos em memória, com as mesmas regras de papel do
   banco (dono, editar, comentar, ver, herança pelas pastas).
   Fica fora do site publicado (.vercelignore).
   ========================================================= */
(function () {
  'use strict';

  var agora = Date.now();
  function ha(min) { return new Date(agora - min * 60000).toISOString(); }
  var seq = 0;
  function novoId() {
    seq++;
    return 'd0000000-0000-4000-8000-' + String(100000000000 + seq).slice(-12);
  }

  var P = {
    eu:   { id: 'a0000000-0000-4000-8000-000000000001', nome: 'Júlio', email: 'julio@lube.com.br', cargo: 'TI' },
    ana:  { id: 'a0000000-0000-4000-8000-000000000002', nome: 'Ana Ribeiro', email: 'ana.ribeiro@lube.com.br', cargo: 'Comercial' },
    car:  { id: 'a0000000-0000-4000-8000-000000000003', nome: 'Carlos Menezes', email: 'carlos.menezes@lube.com.br', cargo: 'Compras' },
    fer:  { id: 'a0000000-0000-4000-8000-000000000004', nome: 'Fernanda Lima', email: 'fernanda.lima@lube.com.br', cargo: 'Financeiro' },
    raf:  { id: 'a0000000-0000-4000-8000-000000000005', nome: 'Rafael Souza', email: 'rafael.souza@lube.com.br', cargo: 'Logística' },
    pat:  { id: 'a0000000-0000-4000-8000-000000000006', nome: 'Patrícia Gomes', email: 'patricia.gomes@lube.com.br', cargo: 'RH' },
    die:  { id: 'a0000000-0000-4000-8000-000000000007', nome: 'Diego Martins', email: 'diego.martins@lube.com.br', cargo: 'Fiscal' }
  };
  var EU = P.eu.id;
  var pessoas = Object.keys(P).map(function (k) { return P[k]; });
  function pes(id) { for (var i = 0; i < pessoas.length; i++) if (pessoas[i].id === id) return pessoas[i]; return null; }

  var pastas = [], arquivos = [], comps = [], ativ = [], avisos = [], versoes = {};

  function pasta(nome, dono, pai, min) {
    var p = { id: novoId(), nome: nome, dono: dono.id, pai: pai || null, criado_em: ha(min + 600), alterado_em: ha(min), lixeira_em: null, lixeira_por: null };
    pastas.push(p);
    return p;
  }
  function arquivo(nome, ext, dono, pastaObj, min, kb, quem, n) {
    var a = {
      id: novoId(), nome: nome, extensao: ext, dono: dono.id, pasta: pastaObj ? pastaObj.id : null,
      tamanho: Math.round(kb * 1024), versao: n || 1, criado_em: ha(min + 2880), alterado_em: ha(min),
      alterado_por: (quem || dono).id, lixeira_em: null, lixeira_por: null
    };
    arquivos.push(a);
    versoes[a.id] = [];
    for (var v = 1; v <= a.versao; v++) {
      versoes[a.id].push({ numero: v, criado_em: v === a.versao ? a.alterado_em : ha(min + (a.versao - v) * 300),
        tamanho: Math.round(a.tamanho * (0.7 + v * 0.3 / a.versao)), origem: v === 1 ? 'novo' : 'editor',
        autores: [v === a.versao ? a.alterado_por : dono.id] });
    }
    ativ.push({ arquivo: a.id, pessoa: dono.id, acao: 'criou', detalhe: { origem: 'novo' }, em: a.criado_em });
    if (a.versao > 1) ativ.push({ arquivo: a.id, pessoa: a.alterado_por, acao: 'editou', detalhe: { versao: a.versao }, em: a.alterado_em });
    return a;
  }
  function comp(item, pessoa, papel, min) {
    comps.push({ arquivo: item.extensao ? item.id : null, pasta: item.extensao ? null : item.id,
      pessoa: pessoa ? pessoa.id : null, papel: papel, criado_em: ha(min || 100) });
  }

  // ---- dados de exemplo ----
  var comercial = pasta('Comercial', P.eu, null, 95);
  var propostas = pasta('Propostas 2026', P.eu, comercial, 180);
  pasta('Reuniões', P.eu, null, 3000);
  var financeiro = pasta('Financeiro', P.fer, null, 130);

  var metas = arquivo('Metas comerciais 2026', 'xlsx', P.eu, null, 14, 86, P.ana, 7);
  var apres = arquivo('Resultado de setembro', 'pptx', P.eu, null, 190, 2340, P.eu, 4);
  arquivo('Ata da diretoria 14-10', 'docx', P.eu, null, 1500, 31, P.eu, 2);
  arquivo('Tabela de preços região 18', 'pdf', P.eu, null, 4400, 412, P.eu, 1);
  arquivo('Proposta Supermercado Vitória', 'docx', P.eu, comercial, 75, 48, P.ana, 3);
  arquivo('Carteira de clientes por RCA', 'xlsx', P.ana, comercial, 300, 154, P.ana, 5);
  arquivo('Proposta Atacadão Serra', 'docx', P.ana, propostas, 260, 52, P.ana, 2);
  var fluxo = arquivo('Fluxo de caixa de outubro', 'xlsx', P.fer, financeiro, 125, 210, P.fer, 9);
  arquivo('Contas a pagar, semana 43', 'xlsx', P.fer, financeiro, 1440, 64, P.fer, 3);
  var escala = arquivo('Escala de entregas de novembro', 'xlsx', P.raf, null, 1300, 73, P.raf, 2);
  arquivo('Política de devoluções', 'docx', P.pat, null, 5000, 39, P.pat, 1);
  var rascunho = arquivo('Rascunho do comunicado', 'docx', P.eu, null, 9000, 12, P.eu, 1);
  rascunho.lixeira_em = ha(2000); rascunho.lixeira_por = EU;

  comp(comercial, P.ana, 'editar', 400);
  comp(comercial, P.car, 'ver', 380);
  comp(metas, null, 'ver', 600);
  comp(apres, P.ana, 'editar', 200);
  comp(apres, P.raf, 'comentar', 200);
  comp(financeiro, P.eu, 'comentar', 120);
  comp(escala, P.eu, 'editar', 1300);
  comp(arquivos[arquivos.length - 2], null, 'ver', 4900);

  ativ.push({ arquivo: metas.id, pessoa: EU, acao: 'abriu', detalhe: {}, em: ha(20) });
  ativ.push({ arquivo: fluxo.id, pessoa: EU, acao: 'abriu', detalhe: {}, em: ha(110) });
  ativ.push({ arquivo: apres.id, pessoa: EU, acao: 'abriu', detalhe: {}, em: ha(190) });
  ativ.push({ arquivo: escala.id, pessoa: EU, acao: 'abriu', detalhe: {}, em: ha(1290) });
  ativ.push({ arquivo: metas.id, pessoa: P.ana.id, acao: 'mencionou', detalhe: { avisados: 1 }, em: ha(12) });

  avisos.push({ id: novoId(), para: EU, de: P.ana.id, arquivo: metas.id, tipo: 'mencao', em: ha(12), lido_em: null,
    mensagem: '@Júlio confere a meta de Cariacica antes da reunião de amanhã?' });
  avisos.push({ id: novoId(), para: EU, de: P.fer.id, pasta: financeiro.id, tipo: 'compartilhou', mensagem: 'comentar', em: ha(120), lido_em: null });
  avisos.push({ id: novoId(), para: EU, de: P.raf.id, arquivo: escala.id, tipo: 'compartilhou', mensagem: 'editar', em: ha(1300), lido_em: ha(1200) });

  // ---- IA da Lube (demonstração) ----
  var iaGasto = 0.0123, iaPedidos = 2;
  var PLANOS = {
    docx: { titulo_arquivo: 'Ata da reunião de compras', resumo: 'Montei a ata com 4 decisões, os responsáveis e a próxima reunião.',
      blocos: [
        { tipo: 'titulo', texto: 'Ata da reunião de compras', itens: [], linhas: [] },
        { tipo: 'subtitulo', texto: 'Lube Distribuidora · 21/10/2026', itens: [], linhas: [] },
        { tipo: 'secao', texto: 'Decisões', itens: [], linhas: [] },
        { tipo: 'tabela', texto: '', itens: [], linhas: [['Ação', 'Responsável', 'Prazo'], ['Negociar prazo de 45 dias', 'Carlos', '28/10'], ['Revisar estoque mínimo da filial 11', 'Carlos', '28/10']] },
        { tipo: 'destaque', texto: '**Próxima reunião:** 04/11 às 9h.', itens: [], linhas: [] }
      ] },
    xlsx: { titulo_arquivo: 'Metas por RCA - novembro 2026', resumo: 'Montei a planilha de metas de novembro com 8 RCAs, % atingido, diferença, total e gráfico (valores de exemplo).',
      abas: [{ nome: 'Metas novembro', titulo: 'Metas de vendas por RCA', subtitulo: 'Novembro/2026 · valores de exemplo', cabecalho: ['RCA', 'Meta', 'Realizado', '% atingido', 'Diferença'],
        linhas: [['RCA 01', 250000, 212000, '=C{L}/B{L}', '=C{L}-B{L}'], ['RCA 02', 220000, 236500, '=C{L}/B{L}', '=C{L}-B{L}']],
        formatos: [{ coluna: 'B', tipo: 'moeda' }, { coluna: 'C', tipo: 'moeda' }, { coluna: 'D', tipo: 'porcentagem' }, { coluna: 'E', tipo: 'moeda' }],
        total: { rotulo: 'Total', colunas: ['B', 'C', 'E'] }, grafico: { tipo: 'colunas', titulo: 'Meta x realizado', categorias: 'A', series: ['B', 'C'] }, observacao: '' }] },
    pptx: { titulo_arquivo: 'Resultado de outubro', resumo: 'Montei 7 slides com capa, números em destaque, cronograma e encerramento.',
      slides: [
        { layout: 'capa', titulo: 'Resultado de outubro', subtitulo: 'Diretoria · Lube Distribuidora', topicos: [], colunas: [], numeros: [], etapas: [], notas: '' },
        { layout: 'numeros', titulo: 'Destaques do mês', subtitulo: 'Valores de exemplo', topicos: [], colunas: [], numeros: [{ valor: 'R$ 4,8 mi', rotulo: 'Venda' }, { valor: '+12%', rotulo: 'Sobre setembro' }, { valor: '86', rotulo: 'Clientes novos' }], etapas: [], notas: '' },
        { layout: 'encerramento', titulo: 'Obrigado', subtitulo: 'Dúvidas e sugestões', topicos: [], colunas: [], numeros: [], etapas: [], notas: '' }
      ] }
  };

  // ---- regras de papel (iguais às do banco) ----
  var NIVEL = { dono: 4, editar: 3, comentar: 2, ver: 1 };
  var TXT = { 4: 'dono', 3: 'editar', 2: 'comentar', 1: 'ver' };
  function pastaPor(id) { for (var i = 0; i < pastas.length; i++) if (pastas[i].id === id) return pastas[i]; return null; }
  function arqPor(id) { for (var i = 0; i < arquivos.length; i++) if (arquivos[i].id === id) return arquivos[i]; return null; }
  function cadeia(id) { var c = [], p = pastaPor(id), n = 0; while (p && n++ < 64) { c.push(p); p = pastaPor(p.pai); } return c; }
  function nivelPasta(u, id) {
    var m = 0;
    cadeia(id).forEach(function (p) {
      if (p.dono === u) m = 4;
      comps.forEach(function (s) { if (s.pasta === p.id && (s.pessoa === u || s.pessoa === null)) m = Math.max(m, NIVEL[s.papel]); });
    });
    return m;
  }
  function nivelArq(u, a) {
    var m = a.dono === u ? 4 : 0;
    comps.forEach(function (s) { if (s.arquivo === a.id && (s.pessoa === u || s.pessoa === null)) m = Math.max(m, NIVEL[s.papel]); });
    if (a.pasta) m = Math.max(m, nivelPasta(u, a.pasta));
    return m;
  }
  function vivaPasta(id) { return cadeia(id).every(function (p) { return !p.lixeira_em; }) && !!pastaPor(id); }
  function vivoArq(a) { return !a.lixeira_em && (!a.pasta || vivaPasta(a.pasta)); }

  function compJson(item, ePasta) {
    var l = comps.filter(function (s) { return ePasta ? s.pasta === item.id : s.arquivo === item.id; });
    return { total: l.length, todos: l.some(function (s) { return !s.pessoa; }),
      pessoas: l.filter(function (s) { return s.pessoa; }).map(function (s) { return pes(s.pessoa); }) };
  }
  function jPasta(p) {
    return { tipo: 'pasta', id: p.id, nome: p.nome, pai: p.pai, dono: pes(p.dono), criado_em: p.criado_em,
      alterado_em: p.alterado_em, papel: TXT[nivelPasta(EU, p.id)] || null, lixeira_em: p.lixeira_em, compartilhado: compJson(p, true) };
  }
  function jArq(a) {
    return { tipo: 'arquivo', id: a.id, nome: a.nome, extensao: a.extensao, pasta: a.pasta, tamanho: a.tamanho, versao: a.versao,
      dono: pes(a.dono), criado_em: a.criado_em, alterado_em: a.alterado_em, alterado_por: pes(a.alterado_por),
      papel: TXT[nivelArq(EU, a)] || null, lixeira_em: a.lixeira_em, compartilhado: compJson(a, false) };
  }
  function ordenar(l) {
    return l.sort(function (x, y) {
      if (x.tipo !== y.tipo) return x.tipo === 'pasta' ? -1 : 1;
      return x.nome.localeCompare(y.nome, 'pt-BR', { sensitivity: 'base' });
    });
  }
  function falha(msg, status) { var e = new Error(msg); e.status = status || 400; throw e; }
  function registrar(acao, arq, pas, det) { ativ.push({ arquivo: arq, pasta: pas, pessoa: EU, acao: acao, detalhe: det || {}, em: new Date().toISOString() }); }
  function item(tipo, id) { return tipo === 'pasta' ? pastaPor(id) : arqPor(id); }
  function nivelItem(tipo, id) { var it = item(tipo, id); return !it ? 0 : tipo === 'pasta' ? nivelPasta(EU, id) : nivelArq(EU, it); }

  function acessos(tipo, id) {
    var it = item(tipo, id);
    var paiId = tipo === 'pasta' ? it.pai : it.pasta;
    var her = [];
    if (paiId) cadeia(paiId).forEach(function (p) {
      comps.forEach(function (s) {
        if (s.pasta === p.id) her.push({ pessoa: pes(s.pessoa), todos: !s.pessoa, papel: s.papel, pasta: { id: p.id, nome: p.nome } });
      });
    });
    return {
      meu_papel: TXT[nivelItem(tipo, id)], dono: pes(it.dono),
      diretos: comps.filter(function (s) { return tipo === 'pasta' ? s.pasta === id : s.arquivo === id; })
        .map(function (s) { return { pessoa: pes(s.pessoa), todos: !s.pessoa, papel: s.papel }; }),
      herdados: her
    };
  }

  var ACOES = {
    eu: function () {
      var meus = arquivos.filter(function (a) { return a.dono === EU && !a.lixeira_em; });
      return { pessoa: P.eu, motor: false, motor_situacao: 'nao_instalado', motor_visto_em: null, email: true,
        avisos_nao_lidos: avisos.filter(function (v) { return !v.lido_em; }).length,
        uso: { arquivos: meus.length, bytes: meus.reduce(function (s, a) { return s + a.tamanho; }, 0) },
        ia: { ligada: true, teto_dia_usd: 10, gasto_hoje_usd: iaGasto, meus_hoje: iaPedidos, livre: true } };
    },
    // IA da Lube na demonstração: devolve um plano pronto (nada sai da máquina, nada é cobrado)
    ia: function (d) {
      var custo = d.tipo === 'pptx' ? 0.0013 : d.tipo === 'xlsx' ? 0.0006 : 0.0004;
      iaGasto = Math.round((iaGasto + custo) * 1e4) / 1e4;
      iaPedidos++;
      if (d.arquivo) registrar('ia', d.arquivo, null, { modo: d.modo, pedido: String(d.pedido || '').slice(0, 200), imagens: (d.imagens || []).length, custo_usd: custo });
      return { plano: PLANOS[d.tipo] || PLANOS.docx, modelo: 'claude-haiku-5-5', custo_usd: custo, segundos: 6.4,
        situacao: { ligada: true, teto_dia_usd: 10, gasto_hoje_usd: iaGasto, meus_hoje: iaPedidos, livre: true } };
    },
    listar: function (d) {
      if (d.pasta) {
        var nv = nivelPasta(EU, d.pasta);
        if (!nv || !vivaPasta(d.pasta)) falha('pasta não encontrada ou sem acesso', 404);
        var cam = cadeia(d.pasta).filter(function (p) { return nivelPasta(EU, p.id) > 0; }).reverse()
          .map(function (p) { return { id: p.id, nome: p.nome }; });
        var itens = pastas.filter(function (p) { return p.pai === d.pasta && !p.lixeira_em; }).map(jPasta)
          .concat(arquivos.filter(function (a) { return a.pasta === d.pasta && !a.lixeira_em; }).map(jArq));
        return { visao: 'pasta', caminho: cam, itens: ordenar(itens),
          pasta: { id: d.pasta, papel: TXT[nv], dono: pes(pastaPor(d.pasta).dono) } };
      }
      var v = d.visao || 'meus', l = [];
      if (v === 'meus') {
        l = pastas.filter(function (p) { return p.dono === EU && !p.pai && !p.lixeira_em; }).map(jPasta)
          .concat(arquivos.filter(function (a) { return a.dono === EU && !a.pasta && !a.lixeira_em; }).map(jArq));
        l = ordenar(l);
      } else if (v === 'compartilhados') {
        var vistos = {};
        comps.filter(function (s) { return s.pessoa === EU || !s.pessoa; }).forEach(function (s) {
          var it = s.pasta ? pastaPor(s.pasta) : arqPor(s.arquivo);
          if (!it || it.dono === EU || vistos[it.id]) return;
          if (s.pasta ? !vivaPasta(it.id) : !vivoArq(it)) return;
          vistos[it.id] = true;
          l.push(s.pasta ? jPasta(it) : jArq(it));
        });
      } else if (v === 'recentes') {
        var ult = {};
        ativ.filter(function (t) { return t.pessoa === EU && t.arquivo; }).forEach(function (t) {
          if (!ult[t.arquivo] || ult[t.arquivo] < t.em) ult[t.arquivo] = t.em;
        });
        l = Object.keys(ult).sort(function (x, y) { return ult[y] < ult[x] ? -1 : 1; })
          .map(arqPor).filter(function (a) { return a && vivoArq(a) && nivelArq(EU, a) > 0; }).map(jArq);
      } else if (v === 'lixeira') {
        l = pastas.filter(function (p) { return p.lixeira_em && (p.dono === EU || p.lixeira_por === EU); }).map(jPasta)
          .concat(arquivos.filter(function (a) { return a.lixeira_em && (a.dono === EU || a.lixeira_por === EU); }).map(jArq));
      } else if (v === 'busca') {
        var q = String(d.busca || '').toLowerCase().trim();
        if (q) {
          l = pastas.filter(function (p) { return p.nome.toLowerCase().indexOf(q) > -1 && !p.lixeira_em && nivelPasta(EU, p.id) && vivaPasta(p.id); }).map(jPasta)
            .concat(arquivos.filter(function (a) { return a.nome.toLowerCase().indexOf(q) > -1 && vivoArq(a) && nivelArq(EU, a); }).map(jArq));
          l = ordenar(l);
        }
      }
      return { visao: v, caminho: [], itens: l };
    },
    pasta_criar: function (d) {
      if (d.pai && nivelPasta(EU, d.pai) < 3) falha('sem permissão para criar nesta pasta', 403);
      var p = pasta(String(d.nome).slice(0, 120), P.eu, d.pai ? pastaPor(d.pai) : null, 0);
      p.alterado_em = new Date().toISOString();
      registrar('criou', null, p.id);
      return jPasta(p);
    },
    arquivo_novo: function (d) {
      if (d.pasta && nivelPasta(EU, d.pasta) < 3) falha('sem permissão para criar nesta pasta', 403);
      return { id: novoId(), caminho: 'demo', token: 'demo', _d: d };
    },
    renomear: function (d) {
      if (nivelItem(d.tipo, d.id) < 3) falha('sem permissão para renomear', 403);
      var it = item(d.tipo, d.id), de = it.nome;
      it.nome = d.nome;
      registrar('renomeou', d.tipo === 'arquivo' ? it.id : null, d.tipo === 'pasta' ? it.id : null, { de: de, para: d.nome });
      return d.tipo === 'pasta' ? jPasta(it) : jArq(it);
    },
    mover: function (d) {
      if (nivelItem(d.tipo, d.id) < 3) falha('sem permissão para mover', 403);
      var it = item(d.tipo, d.id);
      if (!d.destino && it.dono !== EU) falha('só o dono pode levar para Meus arquivos', 403);
      if (d.destino && nivelPasta(EU, d.destino) < 3) falha('sem permissão na pasta de destino', 403);
      if (d.tipo === 'pasta') {
        if (d.destino && cadeia(d.destino).some(function (p) { return p.id === it.id; })) falha('uma pasta não pode entrar nela mesma');
        it.pai = d.destino || null;
        return jPasta(it);
      }
      it.pasta = d.destino || null;
      registrar('moveu', it.id, null, {});
      return jArq(it);
    },
    lixeira: function (d) {
      var it = item(d.tipo, d.id);
      if (d.restaurar) {
        it.lixeira_em = null; it.lixeira_por = null;
        var pai = d.tipo === 'pasta' ? 'pai' : 'pasta';
        if (it[pai] && !vivaPasta(it[pai])) it[pai] = null;
        registrar('restaurou', d.tipo === 'arquivo' ? it.id : null, d.tipo === 'pasta' ? it.id : null);
      } else {
        if (nivelItem(d.tipo, d.id) < 4) falha('só o dono manda para a lixeira', 403);
        it.lixeira_em = new Date().toISOString(); it.lixeira_por = EU;
        registrar('lixeira', d.tipo === 'arquivo' ? it.id : null, d.tipo === 'pasta' ? it.id : null);
      }
      return d.tipo === 'pasta' ? jPasta(it) : jArq(it);
    },
    acessos: function (d) {
      if (!nivelItem(d.tipo, d.id)) falha('sem acesso', 403);
      return acessos(d.tipo, d.id);
    },
    compartilhar: function (d) {
      if (nivelItem(d.tipo, d.id) < 3) falha('sem permissão para compartilhar', 403);
      var ch = d.tipo === 'pasta' ? 'pasta' : 'arquivo';
      comps = comps.filter(function (s) { return !(s[ch] === d.id && (s.pessoa || null) === (d.pessoa || null)); });
      if (d.papel) {
        var s = { arquivo: null, pasta: null, pessoa: d.pessoa || null, papel: d.papel, criado_em: new Date().toISOString() };
        s[ch] = d.id;
        comps.push(s);
      }
      registrar(d.papel ? 'compartilhou' : 'tirou_acesso', ch === 'arquivo' ? d.id : null, ch === 'pasta' ? d.id : null,
        { pessoa: d.pessoa || null, papel: d.papel || null });
      return acessos(d.tipo, d.id);
    },
    pessoas: function () { return pessoas.slice(); },
    abrir: function (d) {
      var a = arqPor(d.id);
      if (!a) {
        // a aba do editor tem a própria demonstração: devolve um arquivo de exemplo com o nome pedido
        var u = new URLSearchParams(location.search);
        a = { id: d.id, nome: u.get('nome') || 'Arquivo de exemplo', extensao: u.get('ext') || 'docx', dono: EU, pasta: null,
          tamanho: 18400, versao: 1, criado_em: ha(1), alterado_em: ha(1), alterado_por: EU, lixeira_em: null };
        arquivos.push(a);
        versoes[a.id] = [{ numero: 1, criado_em: a.criado_em, tamanho: a.tamanho, origem: 'novo', autores: [EU] }];
      }
      if (!nivelArq(EU, a)) falha('arquivo não encontrado ou sem acesso', 404);
      registrar('abriu', a.id, null);
      var j = jArq(a);
      j.chave = a.id + '-' + a.versao;
      j.pasta_nome = a.pasta ? pastaPor(a.pasta).nome : null;
      return { arquivo: j, motor: null, situacao: 'nao_instalado', motivo: 'O editor está sendo ligado no servidor da Lube (SRV-IA).' };
    },
    enviar: function (d) {
      var a = arqPor(d.id);
      if (!a || nivelArq(EU, a) < 3) falha('só quem pode editar envia o arquivo', 403);
      var ruins = (d.externos || []).filter(function (e) { return !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(e); });
      if (ruins.length) falha('e-mail inválido: ' + ruins.join(', '));
      var internos = [];
      (d.internos || []).forEach(function (x) {
        var p = pes(x.pessoa);
        if (!p || p.id === EU) return;
        if (nivelArq(x.pessoa, a) < NIVEL[x.papel || 'ver']) {
          comps = comps.filter(function (s) { return !(s.arquivo === a.id && s.pessoa === x.pessoa); });
          comps.push({ arquivo: a.id, pasta: null, pessoa: x.pessoa, papel: x.papel || 'ver', criado_em: new Date().toISOString() });
        }
        internos.push(p);
      });
      if (!internos.length && !(d.externos || []).length) falha('escolha pelo menos uma pessoa do painel ou um e-mail');
      if (internos.length) registrar('enviou', a.id, null, { internos: internos, mensagem: d.mensagem || '' });
      if ((d.externos || []).length) registrar('enviou_email', a.id, null, { externos: d.externos });
      return { internos: internos, externos: d.externos || [], falhas: [] };
    },
    versoes: function (d) {
      var a = arqPor(d.id);
      return {
        versoes: (versoes[d.id] || []).slice().reverse().map(function (v) {
          return { numero: v.numero, criado_em: v.criado_em, tamanho: v.tamanho, origem: v.origem, autores: v.autores.map(pes) };
        }),
        atividades: ativ.filter(function (t) { return t.arquivo === d.id; }).sort(function (x, y) { return x.em < y.em ? 1 : -1; })
          .map(function (t) { return { pessoa: pes(t.pessoa), acao: t.acao, detalhe: t.detalhe, em: t.em }; }),
        _a: a
      };
    },
    versao_restaurar: function (d) {
      var a = arqPor(d.id), v = (versoes[d.id] || []).filter(function (x) { return x.numero === d.numero; })[0];
      if (nivelArq(EU, a) < 3) falha('sem permissão para restaurar versão', 403);
      a.versao++; a.tamanho = v.tamanho; a.alterado_em = new Date().toISOString(); a.alterado_por = EU;
      versoes[d.id].push({ numero: a.versao, criado_em: a.alterado_em, tamanho: v.tamanho, origem: 'restaurada', autores: [EU] });
      registrar('versao_restaurada', a.id, null, { de: d.numero, nova: a.versao });
      return jArq(a);
    },
    mencionar: function (d) { return { avisados: [], sem_acesso: [] }; },
    avisos: function () {
      return {
        nao_lidos: avisos.filter(function (v) { return !v.lido_em; }).length,
        avisos: avisos.slice().sort(function (x, y) { return x.em < y.em ? 1 : -1; }).map(function (v) {
          var a = v.arquivo ? arqPor(v.arquivo) : null, p = v.pasta ? pastaPor(v.pasta) : null;
          return { id: v.id, tipo: v.tipo, mensagem: v.mensagem, criado_em: v.em, lido_em: v.lido_em, de: pes(v.de),
            arquivo: a ? { id: a.id, nome: a.nome, extensao: a.extensao } : null, pasta: p ? { id: p.id, nome: p.nome } : null };
        })
      };
    },
    avisos_lidos: function (d) {
      var n = 0;
      avisos.forEach(function (v) { if (!v.lido_em && (!d.ids || d.ids.indexOf(v.id) > -1)) { v.lido_em = new Date().toISOString(); n++; } });
      return { marcados: n };
    }
  };

  function confirmar(r, blob, o) {
    return new Promise(function (ok) {
      setTimeout(function () {
        var a = { id: r.id, nome: o.nome, extensao: o.extensao, dono: EU, pasta: o.pasta || null, tamanho: blob.size || 0,
          versao: 1, criado_em: new Date().toISOString(), alterado_em: new Date().toISOString(), alterado_por: EU,
          lixeira_em: null, lixeira_por: null };
        arquivos.push(a);
        versoes[a.id] = [{ numero: 1, criado_em: a.criado_em, tamanho: a.tamanho, origem: o.origem || 'envio', autores: [EU] }];
        registrar('criou', a.id, null, { origem: o.origem || 'envio' });
        ok(jArq(a));
      }, 350);
    });
  }

  window.OFC_DEMO = {
    api: function (acao, d) {
      return new Promise(function (ok, erro) {
        setTimeout(function () {
          try {
            if (!ACOES[acao]) throw new Error('ação desconhecida: ' + acao);
            ok(JSON.parse(JSON.stringify(ACOES[acao](d || {}))));
          } catch (e) { erro(e); }
        }, 180 + Math.random() * 220);
      });
    },
    confirmar: confirmar
  };
})();
