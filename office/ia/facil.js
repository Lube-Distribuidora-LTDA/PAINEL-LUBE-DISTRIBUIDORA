/* =========================================================
   LUBE OFFICE — aba "Lube Fácil" no topo do editor
   Botões grandes, com nome em português, para o que mais se faz no dia a dia,
   já com a cara da Lube: um conjunto no Documento, outro na Planilha e outro
   na Apresentação. Usa as mesmas peças da IA da Lube (executor.js), então o
   título, a tabela e os slides saem iguais aos que a IA escreve. Cada botão
   vira um passo do Desfazer (Ctrl+Z).
   A aba entra pelo AddToolbarMenuItem do ONLYOFFICE (8.1 em diante); os
   ícones ficam em facil/light e facil/dark (um de cada para os temas claro e
   escuro), gerados por office/ferramentas/gerar_icones_facil.py.
   ========================================================= */
(function (window) {
  'use strict';

  var plugin = window.Asc.plugin;
  var L = window.LUBE_IA;
  if (!L) return;

  var ABA = 'lube-facil';
  // relativo ao plugin: o editor completa com o endereço de office/ia/
  function icone(nome) { return 'facil/%theme-type%(light|dark)/' + nome + '.%extension%(svg)'; }
  function avisar(texto, erro) { L.avisar({ tipo: 'aviso', texto: texto, erro: !!erro }); }
  function hoje() { return new Date().toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' }); }

  /* ======================= Documento ======================= */
  function selecionado() {
    return L.metodo('GetSelectedText', [{ Numbering: false, Math: false, TableCellSeparator: '\t', ParaSeparator: '\n', TabSymbol: '\t' }])
      .then(function (t) { return String(t || '').replace(/\r/g, '').replace(/\n+$/, ''); });
  }
  function linhas(t) { return t.split('\n').map(function (l) { return l.trim(); }).filter(Boolean); }
  function umaLinha(t) { return linhas(t).join(' ').slice(0, 300); }
  function colar(html) { return L.metodo('PasteHtml', [html]); }
  // texto selecionado vira o bloco; sem seleção, entra um exemplo para trocar
  function bloco(tipo, exemplo) {
    return function () {
      return selecionado().then(function (t) { return colar(L.htmlDoBloco({ tipo: tipo, texto: umaLinha(t) || exemplo })); });
    };
  }

  function lista(numerada) {
    return function () {
      return selecionado().then(function (t) {
        var itens = linhas(t);
        if (!itens.length) itens = ['Primeiro item', 'Segundo item', 'Terceiro item'];
        return colar(L.htmlDoBloco({ tipo: numerada ? 'numerada' : 'lista', itens: itens.slice(0, 200) }));
      });
    };
  }

  // linhas separadas por tabulação ou ponto e vírgula viram tabela; sem isso, uma tabela vazia para preencher
  function tabela() {
    return selecionado().then(function (t) {
      var ls = linhas(t), sep = /\t/.test(t) ? '\t' : /;/.test(t) ? ';' : null, rows;
      if (ls.length > 1 && sep) rows = ls.slice(0, 300).map(function (l) { return l.split(sep).map(function (c) { return c.trim(); }).slice(0, 12); });
      else rows = [['Item', 'Descrição', 'Valor'], [' ', ' ', ' '], [' ', ' ', ' '], [' ', ' ', ' ']];
      return colar(L.htmlDoBloco({ tipo: 'tabela', linhas: rows }));
    });
  }

  function assinatura() {
    var nome = (plugin.info && plugin.info.userName) || 'Seu nome';
    var F = 'font-family:Arial,sans-serif;';
    // o 1º parágrafo colado se junta à linha do cursor: um vazio na frente põe a assinatura em linha própria
    return colar(
      '<p style="' + F + 'font-size:11pt;margin:0;">&nbsp;</p>' +
      '<p style="' + F + 'font-size:11pt;margin:30pt 0 2pt 0;color:#1B2140;">______________________________________</p>' +
      '<p style="' + F + 'font-size:11pt;font-weight:bold;margin:0;color:#0D176E;">' + esc(nome) + '</p>' +
      '<p style="' + F + 'font-size:10pt;margin:0 0 10pt 0;color:#5C6480;">Lube Distribuidora</p>');
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }

  // logo da Lube no cabeçalho e a assinatura da empresa no rodapé, em todas as seções
  function timbrado() {
    var R = { avisos: [] };
    function tentar(f, rot) { try { return f(); } catch (e) { R.avisos.push(rot + ': ' + ((e && e.message) || e)); } }
    var CM = 360000, doc = Api.GetDocument();
    var secoes = tentar(function () { return doc.GetSections(); }, 'seções') || [doc.GetFinalSection()];
    secoes.forEach(function (s) {
      var cab = s.GetHeader('default', true);
      cab.RemoveAllElements();
      var p = Api.CreateParagraph();
      tentar(function () { p.AddDrawing(Api.CreateImage(Asc.scope.base + '/office/ia/logo-lube.png', Math.round(3.6 * CM), Math.round(1.2 * CM))); }, 'logo');
      tentar(function () { p.SetBottomBorder('single', 12, 4, 229, 16, 31); }, 'faixa');
      tentar(function () { p.SetSpacingAfter(0); }, 'espaço');
      cab.Push(p);
      var rod = s.GetFooter('default', true);
      rod.RemoveAllElements();
      var pr = Api.CreateParagraph();
      tentar(function () { pr.SetJc('center'); }, 'centro');
      var r = pr.AddText('Lube Distribuidora  ·  Cariacica-ES');
      tentar(function () { r.SetFontFamily('Arial'); r.SetFontSize(16); r.SetColor(92, 100, 128); }, 'letra');
      rod.Push(pr);
    });
    return R;
  }

  var DOCUMENTO = [
    { id: 'titulo', texto: 'Título', icone: 'titulo', dica: 'Título da Lube: azul, grande, com o traço vermelho. Vale para o texto selecionado.', fazer: bloco('titulo', 'Título do documento') },
    { id: 'secao', texto: 'Seção', icone: 'secao', dica: 'Abre uma seção com o quadradinho vermelho. Vale para o texto selecionado.', fazer: bloco('secao', 'Nome da seção') },
    { id: 'lista', texto: 'Lista', icone: 'lista', dica: 'Lista com marcadores. Selecione várias linhas para virar lista.', fazer: lista(false) },
    { id: 'numerada', texto: 'Passo a passo', icone: 'numerada', dica: 'Lista numerada (1, 2, 3). Selecione várias linhas para virar passos.', fazer: lista(true) },
    { id: 'tabela', texto: 'Tabela', icone: 'tabela', separador: true, dica: 'Tabela da Lube, com o cabeçalho azul. Linhas selecionadas com tabulação ou ponto e vírgula viram tabela.', fazer: tabela },
    { id: 'destaque', texto: 'Destaque', icone: 'destaque', dica: 'Caixa de aviso com a faixa vermelha, para o que não pode passar batido.', fazer: bloco('destaque', 'Escreva aqui o recado importante.') },
    { id: 'citacao', texto: 'Citação', icone: 'citacao', dica: 'Frase em destaque, em itálico, com a faixa azul.', fazer: bloco('citacao', 'Escreva aqui a frase que merece destaque.') },
    { id: 'data', texto: 'Data de hoje', icone: 'data', separador: true, dica: 'Escreve a data de hoje por extenso onde está o cursor.', fazer: function () { return L.metodo('PasteText', [hoje()]); } },
    { id: 'assinatura', texto: 'Assinatura', icone: 'assinatura', dica: 'Linha para assinar, com o seu nome e a Lube.', fazer: assinatura },
    { id: 'timbrado', texto: 'Papel timbrado', icone: 'timbrado', dica: 'Põe a logo da Lube no cabeçalho e a empresa no rodapé de todas as páginas (troca o cabeçalho e o rodapé que houver).',
      fazer: function () { return L.comando(timbrado, { base: L.ORIGEM }).then(function () { avisar('Papel timbrado da Lube no cabeçalho e no rodapé.'); }); } }
  ];

  /* ======================= Planilha ======================= */
  // uma função só (o editor roda cada comando isolado: as peças ficam dentro dela)
  function acaoPlanilha() {
    var A = Asc.scope.acao, R = { avisos: [] };
    function tentar(f, rot) { try { return f(); } catch (e) { R.avisos.push(rot + ': ' + ((e && e.message) || e)); } }
    function rgb(h) { return Api.CreateColorFromRGB(parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)); }
    function letra(n) { var s = ''; n++; while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
    function numCol(l) { var n = 0; for (var i = 0; i < l.length; i++) n = n * 26 + (l.charCodeAt(i) - 64); return n - 1; }
    // A1:C5, A1, coluna inteira (A:C) ou linha inteira (2:4)
    function limites(r) {
      var e = String(r.GetAddress(false, false, 'xlA1', false)).split(',')[0].replace(/\$/g, '');
      var m = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(e);
      if (m) return { c1: numCol(m[1]), l1: +m[2], c2: m[3] ? numCol(m[3]) : numCol(m[1]), l2: m[4] ? +m[4] : +m[2] };
      if ((m = /^([A-Z]+):([A-Z]+)$/.exec(e))) return { c1: numCol(m[1]), l1: 1, c2: numCol(m[2]), l2: 1048576 };
      if ((m = /^(\d+):(\d+)$/.exec(e))) return { c1: 0, l1: +m[1], c2: 16383, l2: +m[2] };
      return null;
    }
    var ws = Api.GetActiveSheet();
    var s = limites(Api.GetSelection());
    var u = tentar(function () { return limites(ws.GetUsedRange()); }, 'usado');
    if (!s) return { erro: 'Selecione as células primeiro.' };
    // uma célula só = a tabela inteira da aba; coluna ou linha inteira = só até onde tem dado
    if (u && s.c1 === s.c2 && s.l1 === s.l2 && A !== 'fixar' && A !== 'moeda' && A !== 'porcentagem') s = u;
    if (u) { s.l2 = Math.min(s.l2, Math.max(u.l2, s.l1)); s.c2 = Math.min(s.c2, Math.max(u.c2, s.c1)); }
    var faixa = function (l1, l2) { return ws.GetRange(letra(s.c1) + l1 + ':' + letra(s.c2) + l2); };
    var tudo = faixa(s.l1, s.l2);

    // largura de cada coluna pelo texto, com folga para a setinha do filtro e para o R$.
    // O ajuste automático do editor às vezes mede antes de o formato novo aparecer (teste de
    // 2026-10-22: "R$ 1.100.000,00" virou ####), então a conta do maior texto entra junto.
    function tamanho(v, fmt) {
      if (typeof v === 'string' && v.trim() !== '' && isFinite(+v)) v = +v;   // o editor devolve número como texto
      if (typeof v === 'number' && isFinite(v)) {
        var d = String(Math.floor(Math.abs(v))).length, n = d + Math.floor((d - 1) / 3) + (v < 0 ? 1 : 0);
        if (/R\$/.test(fmt)) return n + 6;
        if (/%/.test(fmt)) return String(Math.round(Math.abs(v) * 1000)).length + 3;
        return n + 3;
      }
      return String(v == null ? '' : v).length;
    }
    function alargar() {
      for (var c = s.c1; c <= s.c2 && c < s.c1 + 60; c++) {
        (function (col) {
          tentar(function () {
            var fim = Math.min(s.l2 + 1, s.l1 + 5000), maior = 0;
            for (var l = s.l1; l <= fim; l++) {
              var cel = ws.GetRange(letra(col) + l);
              maior = Math.max(maior, tamanho(cel.GetValue(), String(cel.GetNumberFormat() || '')));
            }
            var r = ws.GetRange(letra(col) + s.l1 + ':' + letra(col) + fim);
            r.AutoFit(false, true);
            r.SetColumnWidth(Math.min(60, Math.max(r.GetColumnWidth() + 3, maior + 4)));
          }, 'largura');
        })(c);
      }
    }

    function cabecalho(r) {
      r.SetFillColor(rgb('0D176E')); r.SetFontColor(rgb('FFFFFF')); r.SetBold(true); r.SetFontName('Arial'); r.SetFontSize(10);
      r.SetAlignHorizontal('center'); r.SetAlignVertical('center'); r.SetWrap(true);
      tentar(function () { r.SetRowHeight(24); }, 'altura');
    }

    if (A === 'cabecalho') {
      cabecalho(faixa(s.l1, s.l1));
      return { msg: 'Linha ' + s.l1 + ' virou cabeçalho da Lube.' };
    }
    if (A === 'tabela') {
      cabecalho(faixa(s.l1, s.l1));
      for (var l = s.l1 + 1; l <= Math.min(s.l2, s.l1 + 3000); l++) {
        (function (lin) {
          tentar(function () {
            var r = faixa(lin, lin);
            r.SetFontName('Arial'); r.SetFontSize(10); r.SetFontColor(rgb('1B2140'));
            if ((lin - s.l1) % 2 === 0) r.SetFillColor(rgb('F4F6FB')); else r.SetFillColor(rgb('FFFFFF'));
          }, 'linha ' + lin);
        })(l);
      }
      tentar(function () { tudo.SetBorders('InsideHorizontal', 'Thin', rgb('D9DEEE')); tudo.SetBorders('Bottom', 'Thin', rgb('D9DEEE')); tudo.SetAlignVertical('center'); }, 'bordas');
      tentar(function () { tudo.SetAutoFilter(); }, 'filtro');
      alargar();
      return { msg: 'Tabela da Lube em ' + letra(s.c1) + s.l1 + ':' + letra(s.c2) + s.l2 + ', com filtro no cabeçalho.' };
    }
    if (A === 'moeda') { tudo.SetNumberFormat('"R$" #,##0.00'); alargar(); return { msg: 'Em reais (R$).' }; }
    if (A === 'porcentagem') { tudo.SetNumberFormat('0.0%'); alargar(); return { msg: 'Em porcentagem.' }; }
    if (A === 'somar') {
      if (s.l2 <= s.l1) return { erro: 'Selecione a coluna com os números (duas linhas ou mais).' };
      var T = s.l2 + 1;
      // nunca escrever por cima de dado: o total vai na linha logo abaixo, que precisa estar vazia
      for (var cc = s.c1; cc <= s.c2; cc++) {
        var ja = String(ws.GetRange(letra(cc) + T).GetValue() || '');
        if (ja !== '') return { erro: 'A linha ' + T + ' já tem dados. Selecione até a última linha com números.' };
      }
      for (var c = s.c1; c <= s.c2; c++) {
        (function (col) {
          tentar(function () {
            var alvo = ws.GetRange(letra(col) + T);
            alvo.SetValue('=SUM(' + letra(col) + s.l1 + ':' + letra(col) + s.l2 + ')');
            // o total no mesmo formato da coluna (R$, %, número)
            var fmt = ws.GetRange(letra(col) + s.l2).GetNumberFormat();
            if (fmt && fmt !== 'General') alvo.SetNumberFormat(fmt);
          }, 'soma ' + letra(col));
        })(c);
      }
      tentar(function () {
        var t = faixa(T, T);
        t.SetBold(true); t.SetFontName('Arial'); t.SetFontColor(rgb('0D176E')); t.SetFillColor(rgb('E8EBF7'));
        t.SetBorders('Top', 'Medium', rgb('0D176E'));
      }, 'linha do total');
      alargar();
      return { msg: 'Total na linha ' + T + '.' };
    }
    if (A === 'fixar') {
      var fp = ws.GetFreezePanes();
      var ja = tentar(function () { return fp.GetLocation(); }, 'fixado');
      if (ja) { fp.Unfreeze(); return { msg: 'Linhas soltas de novo.' }; }
      var lin = s.l1 > 1 ? s.l1 - 1 : 1;
      fp.FreezeRows(lin);
      return { msg: lin === 1 ? 'A primeira linha fica fixa ao rolar.' : 'As ' + lin + ' primeiras linhas ficam fixas ao rolar.' };
    }
    if (A === 'ajustar') { tudo.AutoFit(false, true); return { msg: 'Colunas na largura do texto.' }; }
    if (A === 'grafico') {
      if (s.l2 <= s.l1 || s.c2 <= s.c1) return { erro: 'Selecione a tabela com o cabeçalho: uma coluna de nomes e uma ou mais de números.' };
      var aba = "'" + ws.GetName().replace(/'/g, "''") + "'!";
      var g = ws.AddChart(aba + '$' + letra(s.c1) + '$' + s.l1 + ':$' + letra(s.c2) + '$' + s.l2, false, 'bar', 2,
        15 * 360000, 8.5 * 360000, s.c2 + 2, 0, Math.max(0, s.l1 - 1), 0);
      if (g) {
        var cores = [[13, 23, 110], [229, 16, 31], [42, 55, 150], [31, 178, 107], [217, 119, 6]];
        for (var k = 0; k < 5; k++) {
          (function (i) { tentar(function () { g.SetSeriesFill(Api.CreateSolidFill(Api.CreateRGBColor(cores[i][0], cores[i][1], cores[i][2])), i, false); }, 'cor'); })(k);
        }
        tentar(function () { g.SetLegendPos('bottom'); }, 'legenda');
      }
      return { msg: 'Gráfico ao lado da tabela.' };
    }
    return { erro: 'Ação desconhecida.' };
  }

  function planilha(acao) {
    return function () {
      return L.comando(acaoPlanilha, { acao: acao }).then(function (r) {
        r = r || {};
        if (r.erro) avisar(r.erro, true); else if (r.msg) avisar(r.msg);
      });
    };
  }

  var PLANILHA = [
    { id: 'cabecalho', texto: 'Cabeçalho', icone: 'cabecalho', dica: 'A primeira linha selecionada fica azul, em negrito e centralizada.', fazer: planilha('cabecalho') },
    { id: 'tabela', texto: 'Tabela Lube', icone: 'tabela', dica: 'Cabeçalho azul, linhas alternadas, bordas e filtro. Com uma célula só selecionada, vale a tabela inteira da aba.', fazer: planilha('tabela') },
    { id: 'moeda', texto: 'Reais', icone: 'moeda', separador: true, dica: 'Mostra como dinheiro: R$ 1.234,56.', fazer: planilha('moeda') },
    { id: 'porcentagem', texto: 'Porcentagem', icone: 'porcentagem', dica: 'Mostra como porcentagem: 12,5%.', fazer: planilha('porcentagem') },
    { id: 'somar', texto: 'Somar', icone: 'somar', dica: 'Põe o total embaixo de cada coluna selecionada.', fazer: planilha('somar') },
    { id: 'fixar', texto: 'Fixar linhas', icone: 'fixar', separador: true, dica: 'Fixa as linhas acima da célula selecionada para o cabeçalho não sumir ao rolar. Clique de novo para soltar.', fazer: planilha('fixar') },
    { id: 'ajustar', texto: 'Ajustar colunas', icone: 'ajustar', dica: 'Deixa cada coluna na largura do texto.', fazer: planilha('ajustar') },
    { id: 'grafico', texto: 'Gráfico', icone: 'grafico', dica: 'Gráfico de colunas com as cores da Lube a partir da tabela selecionada.', fazer: planilha('grafico') }
  ];

  /* ======================= Apresentação ======================= */
  var MODELOS = {
    capa: { layout: 'capa', titulo: 'Título da apresentação', subtitulo: 'Subtítulo · ' + hoje() },
    secao: { layout: 'secao', titulo: 'Nome da seção', subtitulo: 'O que vem a seguir' },
    topicos: { layout: 'topicos', titulo: 'Título do slide', topicos: ['Primeiro ponto', 'Segundo ponto', 'Terceiro ponto'] },
    duas_colunas: { layout: 'duas_colunas', titulo: 'Comparativo', colunas: [{ titulo: 'Hoje', topicos: ['Ponto 1', 'Ponto 2', 'Ponto 3'] }, { titulo: 'Proposta', topicos: ['Ponto 1', 'Ponto 2', 'Ponto 3'] }] },
    numeros: { layout: 'numeros', titulo: 'Resultados', numeros: [{ valor: '0', rotulo: 'Indicador 1' }, { valor: '0%', rotulo: 'Indicador 2' }, { valor: 'R$ 0', rotulo: 'Indicador 3' }] },
    etapas: { layout: 'etapas', titulo: 'Como funciona', etapas: [{ titulo: 'Etapa 1', texto: 'O que acontece' }, { titulo: 'Etapa 2', texto: 'O que acontece' }, { titulo: 'Etapa 3', texto: 'O que acontece' }, { titulo: 'Etapa 4', texto: 'O que acontece' }] },
    citacao: { layout: 'citacao', titulo: 'Escreva aqui a frase que merece destaque.', subtitulo: 'Nome de quem disse' },
    encerramento: { layout: 'encerramento', titulo: 'Obrigado!', subtitulo: 'Dúvidas? Fale com a gente.' }
  };
  var NOMES = [['capa', 'Capa'], ['secao', 'Abertura de seção'], ['topicos', 'Tópicos'], ['duas_colunas', 'Duas colunas'],
    ['numeros', 'Números em destaque'], ['etapas', 'Etapas'], ['citacao', 'Frase em destaque'], ['encerramento', 'Encerramento']];

  function novoSlide(layout) {
    return function () {
      return L.comando(function () {
        var p = Api.GetPresentation(), s = p.GetCurrentSlide();
        return s ? s.GetSlideIndex() : p.GetSlidesCount() - 1;
      }).then(function (i) {
        var n = typeof i === 'number' && i >= 0 ? i + 1 : null;
        return L.comando(L.slideDesenhar, {
          slide: MODELOS[layout], base: L.ORIGEM, primeiro: false, criar: false, secaoN: 1,
          transicao: L.TRANSICAO[layout] || 'effectFade', posicao: n
        });
      }).then(function () { avisar('Slide da Lube pronto: troque os textos de exemplo.'); });
    };
  }

  function acaoSlide() {
    var A = Asc.scope.acao, CM = 360000;
    var p = Api.GetPresentation(), s = p.GetCurrentSlide();
    if (A === 'transicao-todos') {
      var n = p.GetSlidesCount();
      for (var i = 0; i < n; i++) {
        var tr = Api.CreateSlideShowTransition();
        tr.SetEntryEffect('effectPushLeft');
        tr.SetSpeed('medium');
        p.GetSlideByIndex(i).SetSlideShowTransition(tr);
      }
      return { msg: 'Transição da Lube em ' + n + (n > 1 ? ' slides.' : ' slide.') };
    }
    if (!s) return { erro: 'Abra um slide primeiro.' };
    if (A === 'logo') {
      var W = 12192000;
      try { W = p.GetWidth() || W; } catch (e) {}
      var img = Api.CreateImage(Asc.scope.base + '/office/ia/logo-lube.png', Math.round(4.4 * CM), Math.round(4.4 * CM / 3));
      img.SetPosition(Math.round(W - 6.0 * CM), Math.round(0.9 * CM));
      s.AddObject(img);
      return { msg: 'Logo da Lube no canto do slide.' };
    }
    if (A === 'animar') {
      var ds = s.GetAllDrawings();
      if (!ds.length) return { erro: 'Este slide ainda não tem nada para animar.' };
      var seq = s.GetTimeLine().GetMainSequence();
      try { seq.RemoveAllEffects(); } catch (e) {}
      ds.forEach(function (d, k) {
        var ef = seq.AddEffect(d, k === 0 ? 'entranceFade' : 'entranceFloatIn', 'afterprevious');
        if (ef) try { ef.SetDuration(k === 0 ? 500 : 450); } catch (e) {}
      });
      var t = Api.CreateSlideShowTransition();
      t.SetEntryEffect('effectPushLeft');
      t.SetSpeed('medium');
      s.SetSlideShowTransition(t);
      return { msg: ds.length + (ds.length > 1 ? ' elementos entram' : ' elemento entra') + ' um depois do outro, sem clicar.' };
    }
    return { erro: 'Ação desconhecida.' };
  }
  function slide(acao) {
    return function () {
      return L.comando(acaoSlide, { acao: acao, base: L.ORIGEM }).then(function (r) {
        r = r || {};
        if (r.erro) avisar(r.erro, true); else if (r.msg) avisar(r.msg);
      });
    };
  }

  var APRESENTACAO = [
    { id: 'novo', texto: 'Novo slide', icone: 'novo-slide', dica: 'Slide pronto com a cara da Lube, logo depois do slide aberto. Escolha o modelo.',
      menu: NOMES.map(function (n) { return { id: 'novo-' + n[0], texto: n[1], fazer: novoSlide(n[0]) }; }) },
    { id: 'logo', texto: 'Logo Lube', icone: 'logo', dica: 'Põe a logo da Lube no canto do slide aberto.', fazer: slide('logo') },
    { id: 'animar', texto: 'Animar slide', icone: 'animar', separador: true, dica: 'Cada elemento do slide entra um depois do outro, com a transição da Lube.', fazer: slide('animar') },
    { id: 'transicao', texto: 'Transição em todos', icone: 'transicao', dica: 'A mesma transição da Lube em todos os slides.', fazer: slide('transicao-todos') }
  ];

  /* ======================= a aba ======================= */
  var IA = { id: 'ia', texto: 'IA da Lube', icone: 'ia', separador: true, dica: 'Abre a IA da Lube ao lado do documento (Ctrl+Shift+I).',
    fazer: function () { L.avisar({ tipo: 'abrir-painel' }); return Promise.resolve(); } };

  var acoes = {};
  function item(b) {
    acoes[b.id] = b.fazer;
    var it = { id: b.id, type: 'big-button', text: b.texto, hint: b.dica, icons: icone(b.icone), lockInViewMode: true, separator: !!b.separador };
    if (b.menu) {
      it.items = b.menu.map(function (m) { acoes[m.id] = m.fazer; return { id: m.id, text: m.texto }; });
    }
    return it;
  }

  function registrar() {
    var ed = L.editor();
    var botoes = ed === 'word' ? DOCUMENTO : ed === 'cell' ? PLANILHA : ed === 'slide' ? APRESENTACAO : null;
    if (!botoes) return;
    var itens = botoes.concat([IA]).map(item);
    plugin.executeMethod('AddToolbarMenuItem', [{ guid: plugin.guid, tabs: [{ id: ABA, text: 'Lube Fácil', items: itens }] }]);
    Object.keys(acoes).forEach(function (id) {
      plugin.attachToolbarMenuClickEvent(id, function () {
        var f = acoes[id];
        if (!f) return;
        Promise.resolve().then(f).catch(function (e) { avisar('Não deu: ' + ((e && e.message) || e), true); });
      });
    });
  }

  var antes = plugin.init;
  plugin.init = function () {
    if (antes) antes.apply(this, arguments);
    try { registrar(); } catch (e) { avisar('A aba Lube Fácil não abriu: ' + ((e && e.message) || e), true); }
  };
})(window);
