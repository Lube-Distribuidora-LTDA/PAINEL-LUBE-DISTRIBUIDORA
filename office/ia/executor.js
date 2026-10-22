/* =========================================================
   LUBE OFFICE — plugin "IA da Lube" (roda escondido dentro do editor)
   A página do editor (editor.html, mesma origem deste plugin) manda o plano
   da IA; aqui ele vira conteúdo de verdade no documento, com a cara da Lube:
     Word        → blocos colados como HTML (títulos, listas, tabelas, destaques)
     Excel       → aba com título, faixa vermelha, cabeçalho azul, fórmulas, total e gráfico
     PowerPoint  → slides desenhados um a um, com transição e animação em cada elemento
   O plano nunca traz código: só texto e escolhas de uma lista fechada.
   Mensagens: a página do editor (window.top, mesma origem do plugin) fala direto com
   esta janela por postMessage. O canal "onExternalPluginMessage" do ONLYOFFICE só funciona
   na edição paga (advancedApi), achado no teste de 2026-10-21; fica como reserva.
   As respostas voltam para window.top, só na origem do portal.
   ========================================================= */
(function (window) {
  'use strict';

  var plugin = window.Asc.plugin;
  var ORIGEM = window.location.origin;
  var iniciado = false;

  function avisar(msg) {
    msg.lubeIa = true;
    try { window.top.postMessage(msg, ORIGEM); } catch (e) {}
  }
  function editor() { return (plugin.info && plugin.info.editorType) || ''; }
  function pausa(ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); }

  // callCommand com promessa (o editor chama a função num escopo próprio: só Api e Asc.scope).
  // Escopo novo a cada comando: nada de um botão da Lube Fácil vaza para a IA (e vice-versa).
  function comando(fn, dados) {
    return new Promise(function (ok) {
      Asc.scope = Asc.scope || {};
      Object.keys(Asc.scope).forEach(function (k) { if (k !== 'prototype') delete Asc.scope[k]; });
      Object.keys(dados || {}).forEach(function (k) { Asc.scope[k] = dados[k]; });
      plugin.callCommand(fn, false, true, function (r) { ok(r); });
    });
  }
  function metodo(nome, args) {
    return new Promise(function (ok) {
      var feito = false;
      var t = setTimeout(function () { if (!feito) { feito = true; ok(null); } }, 4000);
      plugin.executeMethod(nome, args || [], function (r) { if (!feito) { feito = true; clearTimeout(t); ok(r); } });
    });
  }

  plugin.init = function () { iniciado = true; avisar({ tipo: 'pronto', editor: editor() }); };
  plugin.button = function () {};

  // canal direto: só a página do editor (window.top) na origem do portal
  window.addEventListener('message', function (ev) {
    if (ev.origin !== ORIGEM || ev.source !== window.top) return;
    var d = ev.data;
    if (!d || typeof d !== 'object' || d.lubeIa !== true || d.paraPlugin !== true) return;
    if (!iniciado) return;   // o editor ainda não entregou a API; a página tenta de novo
    tratar(d);
  });
  plugin.onExternalPluginMessage = function (d) { tratar(d); };

  function tratar(d) {
    if (!d || d.lubeIa !== true) return;
    if (d.tipo === 'ping') { avisar({ tipo: 'pronto', editor: editor(), id: d.id }); return; }
    var trabalho = d.tipo === 'executar' ? executar(d) : d.tipo === 'contexto' ? contexto(d) : null;
    if (!trabalho) return;
    trabalho.then(function (r) {
      avisar(Object.assign({ tipo: d.tipo === 'executar' ? 'feito' : 'contexto', id: d.id, ok: true }, r || {}));
    }, function (e) {
      avisar({ tipo: d.tipo === 'executar' ? 'feito' : 'contexto', id: d.id, ok: false, erro: String((e && e.message) || e) });
    });
  }

  function progresso(id, feito, total, texto) {
    avisar({ tipo: 'progresso', id: id, feito: feito, total: total, texto: texto || '' });
  }

  /* ======================= o que já está no documento ======================= */
  function contexto(d) {
    var ed = editor();
    if (ed === 'word') {
      return metodo('GetSelectedText', [{ Numbering: true, Math: false, TableCellSeparator: '\t', ParaSeparator: '\n', TabSymbol: '\t' }])
        .then(function (sel) {
          if (sel && String(sel).trim() && !d.tudo) return { origem: 'selecao', texto: String(sel).slice(0, 40000) };
          return comando(function () {
            var doc = Api.GetDocument(), n = doc.GetElementsCount(), out = [], tam = 0;
            for (var i = 0; i < n && tam < 40000; i++) {
              var el = doc.GetElement(i), linha = '';
              try {
                var tipo = el.GetClassType ? el.GetClassType() : '';
                if (tipo === 'paragraph') linha = el.GetText();
                else if (tipo === 'table') {
                  var rs = [];
                  for (var r = 0; r < el.GetRowsCount(); r++) {
                    var row = el.GetRow(r), cs = [];
                    for (var c = 0; c < row.GetCellsCount(); c++) {
                      try { cs.push(row.GetCell(c).GetContent().GetElement(0).GetText()); } catch (x) { cs.push(''); }
                    }
                    rs.push(cs.join(' | '));
                  }
                  linha = rs.join('\n');
                }
              } catch (e) {}
              if (linha) { out.push(linha); tam += linha.length; }
            }
            return out.join('\n');
          }).then(function (t) { return { origem: 'documento', texto: String(t || '').slice(0, 40000) }; });
        });
    }
    if (ed === 'cell') {
      return comando(function () {
        var ws = Api.GetActiveSheet(), r = null;
        try { var s = Api.GetSelection(); if (s && s.GetCount && s.GetCount() > 1) r = s; } catch (e) {}
        if (!r) r = ws.GetUsedRange();
        var grade = {}, maxL = 0, maxC = 0;
        r.ForEach(function (cel) {
          var l = cel.GetRow(), c = cel.GetCol();
          if (l > 400 || c > 30) return;
          var v = cel.GetValue();
          if (v === '' || v == null) return;
          (grade[l] = grade[l] || {})[c] = String(v);
          if (l > maxL) maxL = l;
          if (c > maxC) maxC = c;
        });
        var linhas = [];
        Object.keys(grade).map(Number).sort(function (a, b) { return a - b; }).forEach(function (l) {
          var cs = [];
          for (var c = 1; c <= maxC; c++) cs.push(grade[l][c] || '');
          linhas.push(l + ': ' + cs.join('\t'));
        });
        return { aba: ws.GetName(), endereco: r.GetAddress(false, false, 'xlA1', false), texto: linhas.join('\n') };
      }).then(function (r) {
        r = r || {};
        return { origem: 'planilha', texto: ('Aba "' + (r.aba || '') + '", intervalo ' + (r.endereco || '') +
          ' (cada linha começa pelo número da linha):\n' + (r.texto || '')).slice(0, 40000) };
      });
    }
    if (ed === 'slide') {
      return comando(function () {
        var p = Api.GetPresentation(), out = [];
        for (var i = 0; i < p.GetSlidesCount() && i < 60; i++) {
          var s = p.GetSlideByIndex(i), txt = [];
          try {
            s.GetAllShapes().forEach(function (sh) {
              try {
                var dc = sh.GetDocContent();
                for (var k = 0; k < dc.GetElementsCount(); k++) { var t = dc.GetElement(k).GetText(); if (t && t.trim()) txt.push(t.trim()); }
              } catch (e) {}
            });
          } catch (e) {}
          out.push('## Slide ' + (i + 1) + '\n' + txt.join('\n'));
        }
        return out.join('\n\n');
      }).then(function (t) { return { origem: 'apresentacao', texto: String(t || '').slice(0, 40000) }; });
    }
    return Promise.resolve({ origem: '', texto: '' });
  }

  /* ======================= executar o plano ======================= */
  function executar(d) {
    var ed = editor();
    if (ed === 'word' && d.plano && d.plano.blocos) return executarWord(d);
    if (ed === 'cell' && d.plano && d.plano.abas) return executarCell(d);
    if (ed === 'slide' && d.plano && d.plano.slides) return executarSlide(d);
    return Promise.reject(new Error('O plano não combina com este editor.'));
  }

  /* ----------------------- Word ----------------------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  // **negrito** vira <b>; o resto é texto puro (escapado)
  function rico(s) {
    return esc(s).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');
  }
  var F = "font-family:Arial,sans-serif;";
  var TXT = F + 'font-size:11pt;color:#1B2140;line-height:1.45;margin:0 0 8pt 0;';

  function htmlDoBloco(b) {
    switch (b.tipo) {
      case 'titulo':
        return '<h1 style="' + F + 'font-size:24pt;font-weight:bold;color:#0D176E;margin:0 0 2pt 0;">' + rico(b.texto) + '</h1>' +
          '<p style="' + F + 'font-size:4pt;margin:0 0 10pt 0;border-bottom:3pt solid #E5101F;width:30%;">&nbsp;</p>';
      case 'subtitulo':
        return '<p style="' + F + 'font-size:12pt;color:#5C6480;margin:0 0 14pt 0;">' + rico(b.texto) + '</p>';
      // borda só de um lado em parágrafo vira borda dos dois lados no editor (teste de 2026-10-21):
      // a marca vermelha da seção é um quadradinho antes do texto
      case 'secao':
        return '<h2 style="' + F + 'font-size:14pt;font-weight:bold;color:#0D176E;margin:16pt 0 6pt 0;">' +
          '<span style="color:#E5101F;">&#9632;</span>&nbsp;' + rico(b.texto) + '</h2>';
      case 'lista':
      case 'numerada': {
        var tag = b.tipo === 'lista' ? 'ul' : 'ol';
        return '<' + tag + ' style="' + TXT + '">' + (b.itens || []).map(function (i) {
          return '<li style="' + TXT + 'margin:0 0 3pt 0;">' + rico(i) + '</li>';
        }).join('') + '</' + tag + '>';
      }
      case 'tabela': {
        var linhas = b.linhas || [];
        if (!linhas.length) return '';
        var n = Math.max.apply(null, linhas.map(function (l) { return l.length; }));
        var borda = 'border:1px solid #D9DEEE;padding:5pt 7pt;';
        return '<table style="border-collapse:collapse;width:100%;margin:4pt 0 12pt 0;">' + linhas.map(function (l, i) {
          var cel = '';
          for (var c = 0; c < n; c++) {
            cel += i === 0
              ? '<td style="' + borda + F + 'font-size:10pt;font-weight:bold;color:#FFFFFF;background:#0D176E;">' + rico(l[c] || '') + '</td>'
              : '<td style="' + borda + F + 'font-size:10pt;color:#1B2140;' + (i % 2 === 0 ? 'background:#F4F6FB;' : '') + '">' + rico(l[c] || '') + '</td>';
          }
          return '<tr>' + cel + '</tr>';
        }).join('') + '</table>';
      }
      case 'citacao':
        return '<table style="border-collapse:collapse;width:100%;margin:6pt 0 12pt 0;"><tr><td style="background:#F4F6FB;border-left:4pt solid #2A3796;padding:8pt 12pt;' +
          F + 'font-size:12pt;font-style:italic;color:#2A3796;">' + rico(b.texto) + '</td></tr></table>';
      case 'destaque':
        return '<table style="border-collapse:collapse;width:100%;margin:6pt 0 12pt 0;"><tr><td style="background:#FDEDEE;border-left:5pt solid #E5101F;padding:8pt 10pt;' +
          F + 'font-size:11pt;color:#1B2140;">' + rico(b.texto) + '</td></tr></table>';
      case 'separador':
        return '<p style="' + F + 'font-size:4pt;margin:6pt 0 10pt 0;border-bottom:1pt solid #D9DEEE;">&nbsp;</p>';
      default:
        return '<p style="' + TXT + '">' + rico(b.texto) + '</p>';
    }
  }

  function executarWord(d) {
    var blocos = d.plano.blocos || [];
    var htmls = blocos.map(htmlDoBloco).filter(Boolean);
    // imagem que a pessoa mandou, se ela pediu para pôr no documento
    (d.imagens || []).forEach(function (src) {
      if (/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(src)) {
        htmls.push('<p style="' + TXT + '"><img src="' + src + '" style="max-width:100%;width:420pt;"></p>');
      }
    });
    if (!htmls.length) return Promise.reject(new Error('Nada para escrever.'));
    // no lugar da seleção: uma colagem só (vira um passo do Desfazer)
    if (d.modo === 'substituir') {
      return metodo('PasteHtml', [htmls.join('')]).then(function () { return { blocos: blocos.length }; });
    }
    // documento novo ou no cursor: bloco a bloco, para ver o texto nascendo
    var i = 0;
    return (function proximo() {
      if (i >= htmls.length) return Promise.resolve({ blocos: blocos.length });
      var lote = htmls.slice(i, i + 2).join('');
      i += 2;
      return metodo('PasteHtml', [lote]).then(function () {
        progresso(d.id, Math.min(i, htmls.length), htmls.length, 'Escrevendo no documento');
        return pausa(90);
      }).then(proximo);
    })();
  }

  /* ----------------------- Excel ----------------------- */
  // 1) estrutura: aba, título, faixa vermelha e cabeçalho
  function excelEstrutura() {
    var A = Asc.scope.aba, R = { avisos: [] };
    function tentar(f, rot) { try { return f(); } catch (e) { R.avisos.push(rot + ': ' + ((e && e.message) || e)); } }
    function rgb(h) { return Api.CreateColorFromRGB(parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)); }
    function letra(n) { var s = ''; n++; while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
    var ws = Api.GetActiveSheet();
    var vazia = false;
    tentar(function () {
      var u = ws.GetUsedRange();
      vazia = u.GetAddress(false, false, 'xlA1', false).replace(/\$/g, '') === 'A1' && String(ws.GetRange('A1').GetValue() || '') === '';
    }, 'aba vazia');
    var nomes = [];
    tentar(function () { Api.GetSheets().forEach(function (s) { nomes.push(s.GetName()); }); }, 'abas');
    var nome = A.nome || 'IA da Lube', base = nome, k = 2;
    if (!(vazia && Asc.scope.primeira)) {
      while (nomes.indexOf(nome) > -1) nome = base.slice(0, 25) + ' ' + (k++);
      Api.AddSheet(nome);
      ws = Api.GetActiveSheet();
    } else {
      while (nomes.indexOf(nome) > -1 && nome !== ws.GetName()) nome = base.slice(0, 25) + ' ' + (k++);
      tentar(function () { ws.SetName(nome); }, 'nome');
    }
    var nCols = Math.max(1, A.cabecalho.length, A.linhas.reduce(function (m, l) { return Math.max(m, l.length); }, 0));
    var ult = letra(nCols - 1);
    tentar(function () { ws.SetDisplayGridlines(false); }, 'grade');
    var t = ws.GetRange('A1');
    t.SetValue(A.titulo || A.nome || '');
    tentar(function () { t.SetFontName('Arial'); t.SetFontSize(18); t.SetBold(true); t.SetFontColor(rgb('0D176E')); }, 'título');
    tentar(function () { ws.GetRange('A1').SetRowHeight(30); }, 'altura título');
    if (A.subtitulo) {
      var s = ws.GetRange('A2');
      s.SetValue(A.subtitulo);
      tentar(function () { s.SetFontName('Arial'); s.SetFontSize(10); s.SetItalic(true); s.SetFontColor(rgb('5C6480')); }, 'subtítulo');
    }
    tentar(function () { var f = ws.GetRange('A3:' + ult + '3'); f.SetFillColor(rgb('E5101F')); f.SetRowHeight(4); }, 'faixa');
    for (var c = 0; c < A.cabecalho.length; c++) ws.GetRangeByNumber(3, c).SetValue(A.cabecalho[c]);
    tentar(function () {
      var h = ws.GetRange('A4:' + ult + '4');
      h.SetFillColor(rgb('0D176E')); h.SetFontColor(rgb('FFFFFF')); h.SetBold(true); h.SetFontName('Arial'); h.SetFontSize(10);
      h.SetAlignHorizontal('center'); h.SetAlignVertical('center'); h.SetWrap(true); h.SetRowHeight(24);
    }, 'cabeçalho');
    return { aba: ws.GetName(), nCols: nCols, avisos: R.avisos };
  }

  // 2) dados, em lotes ({L} = linha da célula, {P} = primeira linha de dados, {U} = última)
  function excelDados() {
    var A = Asc.scope.aba, de = Asc.scope.de, ate = Asc.scope.ate, R = { avisos: [] };
    var ws = Api.GetSheet(Asc.scope.nomeAba) || Api.GetActiveSheet();
    var P = 5, U = 5 + A.linhas.length - 1;
    function rgb(h) { return Api.CreateColorFromRGB(parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)); }
    function letra(n) { var s = ''; n++; while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
    for (var i = de; i < ate; i++) {
      var linha = A.linhas[i], L = P + i;
      for (var c = 0; c < linha.length; c++) {
        var v = linha[c];
        if (v === null || v === '') continue;
        if (typeof v === 'string' && v.charAt(0) === '=') v = v.replace(/\{L\}/g, L).replace(/\{P\}/g, P).replace(/\{U\}/g, U);
        try { ws.GetRangeByNumber(L - 1, c).SetValue(v); } catch (e) { R.avisos.push(letra(c) + L + ': ' + ((e && e.message) || e)); }
      }
      try {
        var r = ws.GetRange('A' + L + ':' + letra(Asc.scope.nCols - 1) + L);
        r.SetFontName('Arial'); r.SetFontSize(10); r.SetFontColor(rgb('1B2140'));
        if (i % 2 === 1) r.SetFillColor(rgb('F4F6FB'));
      } catch (e) {}
    }
    return R;
  }

  // 3) acabamento: formatos, total, bordas, larguras, congelar o cabeçalho e o gráfico
  function excelAcabamento() {
    var A = Asc.scope.aba, nCols = Asc.scope.nCols, R = { avisos: [] };
    var ws = Api.GetSheet(Asc.scope.nomeAba) || Api.GetActiveSheet();
    function tentar(f, rot) { try { return f(); } catch (e) { R.avisos.push(rot + ': ' + ((e && e.message) || e)); } }
    function rgb(h) { return Api.CreateColorFromRGB(parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)); }
    function letra(n) { var s = ''; n++; while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
    function numCol(l) { var n = 0; for (var i = 0; i < l.length; i++) n = n * 26 + (l.charCodeAt(i) - 64); return n - 1; }
    var ult = letra(nCols - 1), P = 5, U = Math.max(5, 5 + A.linhas.length - 1);
    var FMT = { moeda: '"R$" #,##0.00', numero: '#,##0.00', inteiro: '#,##0', porcentagem: '0.0%', data: 'dd/mm/yyyy', texto: '@' };
    var T = U;
    if (A.total && A.total.colunas && A.total.colunas.length && A.linhas.length) {
      T = U + 1;
      var rotCol = 0;
      while (A.total.colunas.indexOf(letra(rotCol)) > -1 && rotCol < nCols - 1) rotCol++;
      tentar(function () { ws.GetRangeByNumber(T - 1, rotCol).SetValue(A.total.rotulo || 'Total'); }, 'total');
      A.total.colunas.forEach(function (l) {
        if (numCol(l) < nCols) tentar(function () { ws.GetRange(l + T).SetValue('=SUM(' + l + P + ':' + l + U + ')'); }, 'total ' + l);
      });
      tentar(function () {
        var r = ws.GetRange('A' + T + ':' + ult + T);
        r.SetBold(true); r.SetFontName('Arial'); r.SetFontSize(10); r.SetFontColor(rgb('0D176E')); r.SetFillColor(rgb('E8EBF7'));
        r.SetBorders('Top', 'Medium', rgb('0D176E'));
      }, 'linha do total');
    }
    (A.formatos || []).forEach(function (f) {
      if (numCol(f.coluna) < nCols && FMT[f.tipo]) tentar(function () { ws.GetRange(f.coluna + P + ':' + f.coluna + T).SetNumberFormat(FMT[f.tipo]); }, 'formato ' + f.coluna);
    });
    tentar(function () {
      var r = ws.GetRange('A4:' + ult + T);
      r.SetBorders('InsideHorizontal', 'Thin', rgb('D9DEEE'));
      r.SetBorders('Bottom', 'Thin', rgb('D9DEEE'));
      r.SetAlignVertical('center');
    }, 'bordas');
    // largura de cada coluna pelo texto mais longo (entre 10 e 48 caracteres)
    for (var c = 0; c < nCols; c++) {
      var maior = String(A.cabecalho[c] || '').length + 2;
      A.linhas.forEach(function (l) {
        var v = l[c];
        var n = v == null ? 0 : typeof v === 'number' ? String(Math.round(v)).length + 6 : String(v).charAt(0) === '=' ? 12 : String(v).length;
        if (n > maior) maior = n;
      });
      (function (col, w) { tentar(function () { ws.SetColumnWidth(col, w); }, 'largura'); })(c, Math.max(10, Math.min(48, maior + 2)));
    }
    tentar(function () { ws.GetFreezePanes().FreezeRows(4); }, 'congelar');
    if (A.observacao) {
      tentar(function () {
        var o = ws.GetRange('A' + (T + 2));
        o.SetValue(A.observacao); o.SetItalic(true); o.SetFontSize(9); o.SetFontName('Arial'); o.SetFontColor(rgb('5C6480'));
      }, 'observação');
    }
    var g = A.grafico;
    if (g && A.linhas.length) {
      var TIPO = { colunas: 'bar', barras: 'horizontalBar', linhas: 'lineNormal', pizza: 'pie', rosca: 'doughnut', area: 'area' };
      var cols = [g.categorias].concat(g.series || []).filter(function (l) { return numCol(l) < nCols; });
      var idx = cols.map(numCol).sort(function (a, b) { return a - b; });
      var nomeAba = "'" + ws.GetName().replace(/'/g, "''") + "'!";
      var faixa = function (a, b) { return nomeAba + '$' + letra(a) + '$4:$' + letra(b) + '$' + U; };
      var contigua = idx.every(function (v, i) { return i === 0 || v === idx[i - 1] + 1; });
      var intervalo = contigua ? faixa(idx[0], idx[idx.length - 1])
        : cols.map(function (l) { return faixa(numCol(l), numCol(l)); }).join(',');
      var grafico = tentar(function () {
        return ws.AddChart(intervalo, false, TIPO[g.tipo] || 'bar', 2, 15 * 360000, 8.5 * 360000, nCols + 1, 0, 3, 0);
      }, 'gráfico');
      if (!grafico && !contigua) {
        grafico = tentar(function () {
          return ws.AddChart(faixa(idx[0], idx[idx.length - 1]), false, TIPO[g.tipo] || 'bar', 2, 15 * 360000, 8.5 * 360000, nCols + 1, 0, 3, 0);
        }, 'gráfico (faixa inteira)');
      }
      if (grafico) {
        tentar(function () { grafico.SetTitle(g.titulo || '', 13); }, 'título do gráfico');
        var cores = [[13, 23, 110], [229, 16, 31], [42, 55, 150], [31, 178, 107], [217, 119, 6]];
        for (var s = 0; s < 5; s++) {
          (function (i) {
            tentar(function () { grafico.SetSeriesFill(Api.CreateSolidFill(Api.CreateRGBColor(cores[i][0], cores[i][1], cores[i][2])), i, false); }, 'cor ' + i);
          })(s);
        }
        tentar(function () { grafico.SetLegendPos('bottom'); }, 'legenda');
      }
    }
    tentar(function () { ws.GetRange('A1').Select(); }, 'selecionar');
    return R;
  }

  function executarCell(d) {
    var abas = d.plano.abas || [];
    var avisos = [];
    var feito = 0;
    var total = abas.reduce(function (s, a) { return s + 2 + Math.ceil(a.linhas.length / 25); }, 0);
    function passo(txt) { feito++; progresso(d.id, feito, total, txt); }
    var cadeia = Promise.resolve();
    abas.forEach(function (aba, i) {
      var info = null;
      cadeia = cadeia.then(function () {
        // a primeira tabela usa a aba aberta se ela estiver vazia; as outras ganham aba nova
        return comando(excelEstrutura, { aba: aba, primeira: i === 0 });
      }).then(function (r) {
        info = r || {};
        avisos = avisos.concat(info.avisos || []);
        passo('Montando a aba “' + (info.aba || aba.nome) + '”');
        var lotes = Promise.resolve();
        for (var de = 0; de < aba.linhas.length; de += 25) {
          (function (de0) {
            lotes = lotes.then(function () {
              return comando(excelDados, { aba: aba, de: de0, ate: Math.min(aba.linhas.length, de0 + 25), nomeAba: info.aba, nCols: info.nCols });
            }).then(function (r2) {
              avisos = avisos.concat((r2 && r2.avisos) || []);
              passo('Preenchendo as linhas');
              return pausa(60);
            });
          })(de);
        }
        return lotes;
      }).then(function () {
        return comando(excelAcabamento, { aba: aba, nomeAba: info.aba, nCols: info.nCols });
      }).then(function (r3) {
        avisos = avisos.concat((r3 && r3.avisos) || []);
        passo('Fórmulas, total e gráfico');
      });
    });
    return cadeia.then(function () { return { abas: abas.length, avisos: avisos.slice(0, 20) }; });
  }

  /* ----------------------- PowerPoint ----------------------- */
  // transição de cada tipo de slide: variadas, mas sóbrias
  var TRANSICAO = {
    capa: 'effectFadeSmoothly', secao: 'effectGalleryLeft', topicos: 'effectPushLeft', duas_colunas: 'effectRevealSmoothLeft',
    numeros: 'effectZoomIn', etapas: 'effectWipeRight', citacao: 'effectFade', encerramento: 'effectFadeSmoothly'
  };

  function slideDesenhar() {
    var S = Asc.scope.slide, BASE = Asc.scope.base, R = { avisos: [] };
    var W = 12192000, H = 6858000, CM = 360000;
    var AZUL = '0D176E', VERM = 'E5101F', AZUL2 = '2A3796', CLARO = 'E8EBF7', TINTA = '1B2140', CINZA = '5C6480', BRANCO = 'FFFFFF';
    function tentar(f, rot) { try { return f(); } catch (e) { R.avisos.push(rot + ': ' + ((e && e.message) || e)); } }
    function cor(h) { return Api.CreateRGBColor(parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)); }
    function solido(h) { return Api.CreateSolidFill(cor(h)); }
    function sem() { return Api.CreateStroke(0, Api.CreateNoFill()); }
    var p = Api.GetPresentation();
    if (Asc.scope.primeiro && Asc.scope.criar) tentar(function () { p.SetSizes(W, H); }, 'tamanho');
    var sl = Api.CreateSlide();
    // a aba Lube Fácil põe o slide logo depois do que está aberto; a IA, no fim
    if (Asc.scope.posicao != null) p.AddSlide(sl, Asc.scope.posicao); else p.AddSlide(sl);
    var anim = [];
    function animar(sh, ef, gat, dur, atr) { if (sh) anim.push([sh, ef, gat || 'afterprevious', dur || 500, atr || 0]); }
    function forma(tipo, x, y, w, h, hex) {
      var s = Api.CreateShape(tipo, Math.round(w), Math.round(h), hex ? solido(hex) : Api.CreateNoFill(), sem());
      s.SetPosition(Math.round(x), Math.round(y));
      sl.AddObject(s);
      return s;
    }
    function partes(t) {
      var out = [], re = /\*\*([^*]+)\*\*/g, i = 0, m;
      t = String(t || '');
      while ((m = re.exec(t))) { if (m.index > i) out.push({ t: t.slice(i, m.index) }); out.push({ t: m[1], b: true }); i = re.lastIndex; }
      if (i < t.length) out.push({ t: t.slice(i) });
      if (!out.length) out.push({ t: '' });
      return out;
    }
    function texto(linhas, x, y, w, h, o) {
      var s = forma('rect', x, y, w, h, null);
      var dc = s.GetDocContent();
      dc.RemoveAllElements();
      (Array.isArray(linhas) ? linhas : [linhas]).forEach(function (t) {
        var par = Api.CreateParagraph();
        tentar(function () { par.SetJc(o.alinhar || 'left'); }, 'alinhar');
        if (o.depois) tentar(function () { par.SetSpacingAfter(o.depois); }, 'espaço');
        partes(t).forEach(function (pt) {
          var r = Api.CreateRun();
          r.AddText(pt.t);
          r.SetFontFamily(o.fonte || 'Arial');
          r.SetFontSize(Math.round((o.tam || 18) * 2));
          r.SetFill(solido(pt.b && o.corNegrito ? o.corNegrito : (o.cor || TINTA)));
          if (o.negrito || pt.b) r.SetBold(true);
          if (o.italico) r.SetItalic(true);
          par.AddElement(r);
        });
        dc.Push(par);
      });
      tentar(function () { s.SetVerticalTextAlign(o.valign || 'top'); }, 'vertical');
      tentar(function () { s.SetPaddings(0, 0, 0, 0); }, 'margens');
      return s;
    }
    function tam(t, base) { var n = String(t || '').length; return n > 70 ? base * 0.62 : n > 52 ? base * 0.74 : n > 36 ? base * 0.86 : base; }
    function logo(x, y, w) {
      var img = Api.CreateImage(BASE + '/office/ia/logo-lube.png', Math.round(w), Math.round(w / 3));
      img.SetPosition(Math.round(x), Math.round(y));
      sl.AddObject(img);
      return img;
    }
    function placa(x, y, w) {
      var h = w * 0.4, pl = forma('roundRect', x, y, w, h, BRANCO), m = w * 0.08;
      var lg = tentar(function () { return logo(x + m, y + (h - (w - 2 * m) / 3) / 2, w - 2 * m); }, 'logo');
      var g = lg ? tentar(function () { return sl.GroupDrawings([pl, lg]); }, 'agrupar') : null;
      return g || pl;
    }
    function fundo(h1, h2) {
      if (h2) {
        var ok = tentar(function () {
          sl.SetBackground(Api.CreateLinearGradientFill([Api.CreateGradientStop(cor(h1), 0), Api.CreateGradientStop(cor(h2), 100000)], 2700000));
          return true;
        }, 'degradê');
        if (ok) return;
      }
      tentar(function () { sl.SetBackground(solido(h1)); }, 'fundo');
    }
    // cabeçalho dos slides claros: marca vermelha inclinada, título azul, logo e rodapé
    function cabecalho(titulo) {
      fundo(BRANCO);
      forma('parallelogram', 1.6 * CM, 1.3 * CM, 1.0 * CM, 1.0 * CM, VERM);
      var t = texto(titulo, 3.0 * CM, 0.85 * CM, 22.5 * CM, 1.9 * CM, { tam: tam(titulo, 30), cor: AZUL, fonte: 'Arial Black', valign: 'center' });
      tentar(function () { logo(W - 6.0 * CM, 1.05 * CM, 4.4 * CM); }, 'logo');
      forma('rect', 0, H - 0.3 * CM, W, 0.3 * CM, AZUL);
      forma('parallelogram', W - 10 * CM, H - 0.3 * CM, 6.5 * CM, 0.3 * CM, VERM);
      animar(t, 'entranceFade', 'afterprevious', 400);
    }
    var L = S.layout;

    if (L === 'capa' || L === 'encerramento') {
      fundo(AZUL, '060B29');
      var central = L === 'encerramento';
      var faixa = forma('parallelogram', -1.5 * CM, (central ? 11.2 : 13.2) * CM, (central ? 37 : 19.5) * CM, 1.25 * CM, VERM);
      var fina = forma('parallelogram', -1.5 * CM, (central ? 12.75 : 14.75) * CM, (central ? 26 : 12.5) * CM, 0.32 * CM, AZUL2);
      var pl = central ? placa((W - 9.5 * CM) / 2, 2.2 * CM, 9.5 * CM) : placa(W - 10.6 * CM, 1.5 * CM, 8.6 * CM);
      var tt = texto(S.titulo, central ? 2 * CM : 2.2 * CM, central ? 6.6 * CM : 5.0 * CM, central ? W - 4 * CM : 22.5 * CM, central ? 3.4 * CM : 5.4 * CM,
        { tam: tam(S.titulo, central ? 44 : 46), cor: BRANCO, fonte: 'Arial Black', valign: central ? 'center' : 'bottom', alinhar: central ? 'center' : 'left' });
      var st = S.subtitulo ? texto(S.subtitulo, central ? 2 * CM : 2.2 * CM, central ? 9.6 * CM : 10.6 * CM, central ? W - 4 * CM : 21 * CM, 2.2 * CM,
        { tam: 20, cor: 'C9D0F0', alinhar: central ? 'center' : 'left' }) : null;
      texto('Lube Distribuidora · desde 1959 · Cariacica-ES', central ? 2 * CM : 2.2 * CM, 17.2 * CM, central ? W - 4 * CM : 20 * CM, 0.9 * CM,
        { tam: 11, cor: '8E99D6', alinhar: central ? 'center' : 'left' });
      animar(pl, 'entranceZoom', 'afterprevious', 500);
      animar(faixa, 'entranceWipe', 'withprevious', 700);
      animar(fina, 'entranceWipe', 'afterprevious', 400);
      animar(tt, 'entranceFlyIn', 'afterprevious', 650);
      animar(st, 'entranceFade', 'afterprevious', 600);
    } else if (L === 'secao') {
      fundo(AZUL, AZUL2);
      var num = texto(String(Asc.scope.secaoN || 1).replace(/^(\d)$/, '0$1'), 2 * CM, 3.2 * CM, 10 * CM, 6 * CM,
        { tam: 130, cor: '3A4AB8', fonte: 'Arial Black', valign: 'center' });
      var fx = forma('parallelogram', 2.2 * CM, 10.1 * CM, 7 * CM, 0.5 * CM, VERM);
      var ts = texto(S.titulo, 2.2 * CM, 10.9 * CM, 28 * CM, 2.8 * CM, { tam: tam(S.titulo, 40), cor: BRANCO, fonte: 'Arial Black', valign: 'top' });
      var ss = S.subtitulo ? texto(S.subtitulo, 2.2 * CM, 13.8 * CM, 26 * CM, 1.6 * CM, { tam: 18, cor: 'C9D0F0' }) : null;
      tentar(function () { var pl2 = placa(W - 7.6 * CM, 1.2 * CM, 5.8 * CM); animar(pl2, 'entranceFade', 'withprevious', 500); }, 'placa');
      animar(num, 'entranceZoom', 'afterprevious', 600);
      animar(fx, 'entranceWipe', 'afterprevious', 450);
      animar(ts, 'entranceFlyIn', 'afterprevious', 600);
      animar(ss, 'entranceFade', 'afterprevious', 500);
    } else if (L === 'topicos') {
      cabecalho(S.titulo);
      var itens = (S.topicos || []).slice(0, 8);
      if (S.subtitulo) { var sub = texto(S.subtitulo, 3.0 * CM, 3.0 * CM, 26 * CM, 1.1 * CM, { tam: 16, cor: CINZA }); animar(sub, 'entranceFade', 'afterprevious', 400); }
      var y0 = (S.subtitulo ? 4.6 : 4.0) * CM, alto = (H - 1.6 * CM - y0) / Math.max(itens.length, 1);
      alto = Math.min(alto, 2.7 * CM);
      var fonte = itens.length <= 4 ? 26 : itens.length <= 6 ? 22 : 18;
      itens.forEach(function (it, i) {
        var y = y0 + i * alto;
        var mk = forma('parallelogram', 3.0 * CM, y + alto / 2 - 0.28 * CM, 0.7 * CM, 0.56 * CM, i % 2 ? AZUL2 : VERM);
        var tx = texto(it, 4.3 * CM, y, 26.5 * CM, alto, { tam: fonte, cor: TINTA, corNegrito: AZUL, valign: 'center' });
        animar(mk, 'entranceZoom', 'afterprevious', 250);
        animar(tx, 'entranceFloatIn', 'withprevious', 450);
      });
    } else if (L === 'duas_colunas') {
      cabecalho(S.titulo);
      var cols = (S.colunas || []).slice(0, 2);
      var cw = (W - 3.0 * CM - 1.6 * CM - 1.0 * CM) / 2;
      cols.forEach(function (c, i) {
        var x = 3.0 * CM + i * (cw + 1.0 * CM), y = 4.0 * CM, h = H - y - 1.4 * CM;
        var card = forma('roundRect', x, y, cw, h, i ? 'FDEDEE' : CLARO);
        var topo = forma('roundRect', x, y, cw, 1.7 * CM, i ? VERM : AZUL);
        var tt2 = texto(c.titulo, x + 0.7 * CM, y + 0.1 * CM, cw - 1.4 * CM, 1.5 * CM, { tam: tam(c.titulo, 20), cor: BRANCO, fonte: 'Arial Black', valign: 'center' });
        var tp = texto((c.topicos || []).map(function (t) { return '•  ' + t; }), x + 0.8 * CM, y + 2.3 * CM, cw - 1.6 * CM, h - 2.8 * CM,
          { tam: (c.topicos || []).length > 4 ? 17 : 20, cor: TINTA, corNegrito: AZUL, depois: 200 });
        animar(card, 'entranceFlyIn', 'afterprevious', 550);
        animar(topo, 'entranceWipe', 'withprevious', 550);
        animar(tt2, 'entranceFade', 'afterprevious', 350);
        animar(tp, 'entranceFade', 'afterprevious', 500);
      });
    } else if (L === 'numeros') {
      cabecalho(S.titulo);
      var ns = (S.numeros || []).slice(0, 4);
      var n = Math.max(ns.length, 1), gap = 0.8 * CM, larg = (W - 3.0 * CM - 1.6 * CM - (n - 1) * gap) / n;
      if (S.subtitulo) { var sb = texto(S.subtitulo, 3.0 * CM, 3.0 * CM, 26 * CM, 1.1 * CM, { tam: 16, cor: CINZA }); animar(sb, 'entranceFade', 'afterprevious', 400); }
      ns.forEach(function (k, i) {
        var x = 3.0 * CM + i * (larg + gap), y = 5.2 * CM, h = 9.0 * CM;
        var card = forma('roundRect', x, y, larg, h, 'F4F6FB');
        var fx2 = forma('parallelogram', x + 0.8 * CM, y + 1.0 * CM, 2.6 * CM, 0.4 * CM, i % 2 ? AZUL2 : VERM);
        var vv = texto(k.valor, x + 0.6 * CM, y + 1.9 * CM, larg - 1.2 * CM, 3.4 * CM,
          { tam: String(k.valor).length > 8 ? 30 : n > 3 ? 36 : 44, cor: AZUL, fonte: 'Arial Black', valign: 'center' });
        var rr = texto(k.rotulo, x + 0.8 * CM, y + 5.5 * CM, larg - 1.6 * CM, 3.0 * CM, { tam: n > 3 ? 15 : 17, cor: CINZA });
        animar(card, 'entranceZoom', 'afterprevious', 400);
        animar(fx2, 'entranceWipe', 'withprevious', 400);
        animar(vv, 'entranceFloatIn', 'afterprevious', 450);
        animar(rr, 'entranceFade', 'withprevious', 450);
      });
    } else if (L === 'etapas') {
      cabecalho(S.titulo);
      var es = (S.etapas || []).slice(0, 5);
      var m = Math.max(es.length, 1), x0 = 3.0 * CM, larg2 = (W - x0 - 1.6 * CM) / m, yc = 6.4 * CM, d0 = 1.9 * CM;
      var linha = forma('rect', x0 + larg2 / 2, yc + d0 / 2 - 0.08 * CM, (m - 1) * larg2, 0.16 * CM, 'C9D0F0');
      animar(linha, 'entranceWipe', 'afterprevious', 700);
      es.forEach(function (e, i) {
        var cx = x0 + i * larg2 + larg2 / 2;
        var bola = forma('ellipse', cx - d0 / 2, yc, d0, d0, i % 2 ? AZUL : VERM);
        var nn = texto(String(i + 1), cx - d0 / 2, yc, d0, d0, { tam: 24, cor: BRANCO, fonte: 'Arial Black', valign: 'center', alinhar: 'center' });
        var et = texto(e.titulo, cx - larg2 / 2 + 0.3 * CM, yc + d0 + 0.6 * CM, larg2 - 0.6 * CM, 1.6 * CM,
          { tam: m > 4 ? 16 : 18, cor: AZUL, fonte: 'Arial Black', alinhar: 'center', valign: 'top' });
        var ex = texto(e.texto, cx - larg2 / 2 + 0.3 * CM, yc + d0 + 2.4 * CM, larg2 - 0.6 * CM, 5.5 * CM, { tam: m > 4 ? 14 : 16, cor: CINZA, alinhar: 'center' });
        animar(bola, 'entranceZoom', 'afterprevious', 350);
        animar(nn, 'entranceZoom', 'withprevious', 350);
        animar(et, 'entranceFloatIn', 'afterprevious', 350);
        animar(ex, 'entranceFade', 'withprevious', 400);
      });
    } else if (L === 'citacao') {
      fundo('060B29', AZUL);
      var aspas = texto('“', 2.2 * CM, 0.6 * CM, 6 * CM, 6 * CM, { tam: 180, cor: VERM, fonte: 'Arial Black' });
      var frase = texto(S.titulo, 3.4 * CM, 5.4 * CM, W - 6.8 * CM, 7 * CM, { tam: tam(S.titulo, 32), cor: BRANCO, italico: true, valign: 'center' });
      var fx3 = forma('parallelogram', 3.4 * CM, 13.3 * CM, 2.2 * CM, 0.35 * CM, VERM);
      var autor = texto(S.subtitulo || '', 6.2 * CM, 12.9 * CM, 20 * CM, 1.2 * CM, { tam: 17, cor: 'C9D0F0', valign: 'center' });
      animar(aspas, 'entranceZoom', 'afterprevious', 500);
      animar(frase, 'entranceFade', 'afterprevious', 900);
      animar(fx3, 'entranceWipe', 'afterprevious', 300);
      animar(autor, 'entranceFloatIn', 'withprevious', 400);
    } else {
      cabecalho(S.titulo || '');
      var corpo = texto(S.subtitulo || '', 3.0 * CM, 4.2 * CM, 26 * CM, 10 * CM, { tam: 20, cor: TINTA });
      animar(corpo, 'entranceFade', 'afterprevious', 500);
    }

    // anotações do apresentador
    if (S.notas) {
      tentar(function () {
        var np = sl.GetNotesPage();
        if (np && np.AddBodyShapeText) np.AddBodyShapeText(S.notas);
        else sl.AddNotesText(S.notas);
      }, 'anotações');
    }
    // transição do slide
    tentar(function () {
      var tr = Api.CreateSlideShowTransition();
      tr.SetEntryEffect(Asc.scope.transicao || 'effectFade');
      tr.SetSpeed('medium');
      sl.SetSlideShowTransition(tr);
    }, 'transição');
    // animação de cada elemento, um depois do outro, sem precisar clicar
    tentar(function () {
      var seq = sl.GetTimeLine().GetMainSequence();
      anim.forEach(function (a, i) {
        var ef = seq.AddEffect(a[0], a[1], i === 0 ? 'afterprevious' : a[2]);
        if (ef) {
          tentar(function () { ef.SetDuration(a[3]); }, 'duração');
          if (a[4]) tentar(function () { ef.SetDelay(a[4]); }, 'atraso');
        }
      });
    }, 'animações');
    tentar(function () { sl.Select(); }, 'mostrar');
    return { avisos: R.avisos, total: p.GetSlidesCount() };
  }

  // documento novo: tira os slides vazios do modelo e volta para o primeiro
  function slideLimpar() {
    var p = Api.GetPresentation(), n = Asc.scope.antes || 0;
    for (var i = n - 1; i >= 0; i--) {
      try { p.GetSlideByIndex(i).Delete(); } catch (e) {}
    }
    try { p.GetSlideByIndex(0).Select(); } catch (e) {}
    return p.GetSlidesCount();
  }

  function executarSlide(d) {
    var slides = d.plano.slides || [];
    var criar = d.modo === 'criar';
    var avisos = [];
    var antes = 0;
    var secao = 0;
    var cadeia = comando(function () { return Api.GetPresentation().GetSlidesCount(); }).then(function (n) { antes = n || 0; });
    slides.forEach(function (s, i) {
      if (s.layout === 'secao') secao++;
      var n = secao;
      cadeia = cadeia.then(function () {
        return comando(slideDesenhar, {
          slide: s, base: d.base || ORIGEM, primeiro: i === 0, criar: criar, secaoN: n,
          transicao: TRANSICAO[s.layout] || 'effectFade'
        });
      }).then(function (r) {
        avisos = avisos.concat((r && r.avisos) || []);
        progresso(d.id, i + 1, slides.length, 'Desenhando o slide ' + (i + 1) + ' de ' + slides.length);
        return pausa(120);
      });
    });
    if (criar) {
      cadeia = cadeia.then(function () { return antes ? comando(slideLimpar, { antes: antes }) : null; });
    }
    return cadeia.then(function () {
      // avisos repetidos (o mesmo método em todos os slides) contam uma vez só
      var unicos = avisos.filter(function (a, i) { return avisos.indexOf(a) === i; });
      return { slides: slides.length, avisos: unicos.slice(0, 20) };
    });
  }

  // a aba "Lube Fácil" (facil.js) usa as mesmas peças, com a mesma cara
  window.LUBE_IA = {
    comando: comando, metodo: metodo, avisar: avisar, editor: editor, ORIGEM: ORIGEM,
    htmlDoBloco: htmlDoBloco, slideDesenhar: slideDesenhar, TRANSICAO: TRANSICAO
  };
})(window);
