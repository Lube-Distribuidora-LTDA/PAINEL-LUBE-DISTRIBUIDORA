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

  // imagens do modelo de apresentação (capa e logo) em data URL, buscadas uma vez no portal (mesma origem)
  var imagensModelo = null;
  function carregarImagens() {
    if (imagensModelo) return imagensModelo;
    function uma(nome) {
      return fetch(ORIGEM + '/office/ia/modelo/' + nome).then(function (r) {
        if (!r.ok) throw new Error(nome + ' ' + r.status);
        return r.blob();
      }).then(function (b) {
        return new Promise(function (ok, erro) { var f = new FileReader(); f.onload = function () { ok(f.result); }; f.onerror = erro; f.readAsDataURL(b); });
      });
    }
    imagensModelo = Promise.all([uma('capa.jpg'), uma('logo-escura.png')]).then(function (v) {
      return { 'capa.jpg': v[0], 'logo-escura.png': v[1] };
    }, function () { imagensModelo = null; return null; });
    return imagensModelo;
  }

  // callCommand com promessa (o editor chama a função num escopo próprio: só Api e Asc.scope).
  // Escopo novo a cada comando: nada de um botão da Lube Fácil vaza para a IA (e vice-versa).
  function comando(fn, dados) {
    // slide da Lube (IA ou aba Lube Fácil): leva as imagens do modelo junto
    if (fn === slideDesenhar && dados && !dados.imagens) {
      return carregarImagens().then(function (img) { return comando(fn, Object.assign({}, dados, { imagens: img || {} })); });
    }
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
    capa: 'effectFadeSmoothly', secao: 'effectPushLeft', topicos: 'effectFade', duas_colunas: 'effectRevealSmoothLeft',
    numeros: 'effectZoomIn', etapas: 'effectWipeRight', citacao: 'effectFade', encerramento: 'effectFadeSmoothly'
  };

  // Desenho do modelo "Apresentação Lube" (a "Inovação nos BIs", padrão da Lube desde 2026-10-22, pedido do
  // Júlio): capa e encerramento com o feixe azul e o bloco vermelho, chamada vermelha em maiúsculas sobre o
  // título, slides claros (#F1F2F7, cartões brancos) e escuros (fundo marinho, cartões azuis), divisor de
  // seção vermelho e azul. As imagens vêm de office/ia/modelo/ (gerar_modelo_apresentacao.py).
  function slideDesenhar() {
    var S = Asc.scope.slide, BASE = Asc.scope.base, R = { avisos: [] };
    var W = 12192000, H = 6858000, CM = 360000;
    var C = {
      azul: '0D176E', verm: 'E5101F', vermEsc: 'C20D1A', vermClaro: 'FF5A64', tinta: '3A4466', escrita: '1B2140',
      fundoClaro: 'F1F2F7', cartao: 'FBFBFD', borda: 'DCDFEA', rodapeClaro: '5A6488',
      gelo: 'F5F7FD', branco: 'FFFBFB', lilas: 'C3CDF0', rodapeEsc: '8A9BD6',
      cartaoEsc: '0B2180', bordaEsc: '2549C9', destaque: '1741D8'
    };
    function tentar(f, rot) { try { return f(); } catch (e) { R.avisos.push(rot + ': ' + ((e && e.message) || e)); } }
    function cor(h) { return Api.CreateRGBColor(parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)); }
    function solido(h) { return Api.CreateSolidFill(cor(h)); }
    function sem() { return Api.CreateStroke(0, Api.CreateNoFill()); }
    function traco(h) { return Api.CreateStroke(9525, solido(h)); }
    function degrade(paradas, angulo) {
      return Api.CreateLinearGradientFill(paradas.map(function (p) { return Api.CreateGradientStop(cor(p[0]), p[1]); }), angulo);
    }
    var p = Api.GetPresentation();
    if (Asc.scope.primeiro && Asc.scope.criar) tentar(function () { p.SetSizes(W, H); }, 'tamanho');
    var sl = Api.CreateSlide();
    // a aba Lube Fácil põe o slide logo depois do que está aberto; a IA, no fim
    if (Asc.scope.posicao != null) p.AddSlide(sl, Asc.scope.posicao); else p.AddSlide(sl);
    var anim = [];
    function animar(sh, ef, gat, dur, atr) { if (sh) anim.push([sh, ef, gat || 'afterprevious', dur || 500, atr || 0]); }
    // forma com cantos de 0,3 cm (o "roundRect" padrão arredonda demais os cartões grandes)
    function forma(tipo, x, y, w, h, fundo, o) {
      o = o || {};
      var s = Api.CreateShape(tipo, Math.round(w), Math.round(h),
        fundo ? (typeof fundo === 'string' ? solido(fundo) : fundo) : Api.CreateNoFill(), o.borda ? traco(o.borda) : sem());
      s.SetPosition(Math.round(x), Math.round(y));
      if (tipo === 'roundRect') {
        tentar(function () {
          var g = Api.CreatePresetGeometry('roundRect');
          g.SetAdjValue('adj', Math.round(Math.min(50000, (o.raio || 0.3) * CM / Math.min(w, h) * 100000)));
          s.SetGeometry(g);
        }, 'cantos');
      }
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
          r.SetFontFamily('Arial');
          r.SetFontSize(Math.round((o.tam || 16) * 2));
          r.SetFill(solido(pt.b && o.corNegrito ? o.corNegrito : (o.cor || C.escrita)));
          if (o.negrito || pt.b) r.SetBold(true);
          if (o.italico) r.SetItalic(true);
          if (o.espaco) tentar(function () { r.SetSpacing(o.espaco); }, 'letras');
          par.AddElement(r);
        });
        dc.Push(par);
      });
      tentar(function () { s.SetVerticalTextAlign(o.valign || 'top'); }, 'vertical');
      tentar(function () { s.SetPaddings(0, 0, 0, 0); }, 'margens');
      return s;
    }
    // título que encolhe com o tamanho do texto
    function tam(t, base) { var n = String(t || '').length; return n > 70 ? base * 0.62 : n > 52 ? base * 0.72 : n > 36 ? base * 0.84 : base; }
    // a imagem vem embutida (o motor na SRV-IA nem sempre alcança o endereço de quem pediu); senão, pelo endereço
    function fonteImagem(nome) { return (Asc.scope.imagens && Asc.scope.imagens[nome]) || BASE + '/office/ia/modelo/' + nome; }
    function imagem(nome, x, y, w, h) {
      var img = Api.CreateImage(fonteImagem(nome), Math.round(w), Math.round(h));
      img.SetPosition(Math.round(x), Math.round(y));
      sl.AddObject(img);
      return img;
    }
    function fundoImagem(nome, reserva) {
      var ok = tentar(function () { sl.SetBackground(Api.CreateBlipFill(fonteImagem(nome), 'stretch')); return true; }, 'fundo');
      if (!ok) tentar(function () { sl.SetBackground(solido(reserva)); }, 'fundo liso');
    }
    // fundo dos slides escuros: o mesmo degradê do modelo, do azul no alto à direita ao quase preto embaixo
    function fundoEscuro() {
      var ok = tentar(function () { sl.SetBackground(degrade([['0C2FAD', 0], ['06186A', 50000], ['030B30', 100000]], 8100000)); return true; }, 'degradê do fundo');
      if (!ok) tentar(function () { sl.SetBackground(solido('06186A')); }, 'fundo liso');
    }
    var escuro = ['duas_colunas', 'etapas', 'citacao'].indexOf(S.layout) > -1;
    function chamada(txt, y, corTexto, corBarra) {
      var b = forma('rect', 2.23 * CM, (y + 0.19) * CM, 1.04 * CM, 0.21 * CM, corBarra || C.verm);
      var t = texto(String(txt || '').toUpperCase().slice(0, 60), 3.53 * CM, y * CM, 26 * CM, 0.66 * CM,
        { tam: 12, negrito: true, cor: corTexto, espaco: 40, valign: 'center' });
      animar(b, 'entranceWipe', 'afterprevious', 300);
      animar(t, 'entranceFade', 'withprevious', 400);
    }
    function rodape(corTexto) {
      texto('Lube Distribuidora', 2.26 * CM, 17.33 * CM, 14 * CM, 0.66 * CM, { tam: 12, cor: corTexto });
    }
    // fundo, chamada, título e subtítulo dos slides de conteúdo; devolve onde o conteúdo começa (cm)
    function cabecalho(titulo, sub) {
      if (escuro) fundoEscuro(); else tentar(function () { sl.SetBackground(solido(C.fundoClaro)); }, 'fundo');
      chamada(Asc.scope.chamada || 'Lube Distribuidora', 2.26, escuro ? C.vermClaro : C.vermEsc);
      var t = texto(titulo, 2.26 * CM, 3.27 * CM, 30.23 * CM, 1.47 * CM,
        { tam: tam(titulo, 36), negrito: true, cor: escuro ? C.gelo : C.azul, valign: 'center' });
      animar(t, 'entranceFade', 'afterprevious', 450);
      if (sub) {
        var st = texto(sub, 2.26 * CM, 5.09 * CM, 29 * CM, 1.6 * CM, { tam: 16, cor: escuro ? C.lilas : C.tinta });
        animar(st, 'entranceFade', 'withprevious', 450);
      }
      rodape(escuro ? C.rodapeEsc : C.rodapeClaro);
      return sub ? 7.2 : 5.7;
    }
    function cartao(x, y, w, h, i, destacar) {
      if (!escuro) return forma('roundRect', x, y, w, h, C.cartao, { borda: C.borda });
      return destacar ? forma('roundRect', x, y, w, h, C.destaque, { borda: C.verm }) : forma('roundRect', x, y, w, h, C.cartaoEsc, { borda: C.bordaEsc });
    }
    var L = S.layout;

    if (L === 'capa' || L === 'encerramento') {
      fundoImagem('capa.jpg', '060B29');
      if (L === 'capa') {
        var lg = tentar(function () { return imagem('logo-escura.png', 2.26 * CM, 3.08 * CM, 11.29 * CM, 3.76 * CM); }, 'logo');
        var MESES = ['JANEIRO', 'FEVEREIRO', 'MARÇO', 'ABRIL', 'MAIO', 'JUNHO', 'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO'];
        var hoje = new Date();
        animar(lg, 'entranceFade', 'afterprevious', 600);
        chamada(Asc.scope.chamada || ('Lube Distribuidora · ' + MESES[hoje.getMonth()] + ' de ' + hoje.getFullYear()), 7.55, C.vermClaro);
        var n = String(S.titulo || '').length;
        var tt = texto(S.titulo, 2.26 * CM, 8.84 * CM, 17.8 * CM, 4.4 * CM,
          { tam: n > 60 ? 30 : n > 40 ? 36 : n > 24 ? 44 : 52, negrito: true, cor: 'F7F9FF', valign: 'top' });
        animar(tt, 'entranceFlyIn', 'afterprevious', 650);
        if (S.subtitulo) {
          var st = texto(S.subtitulo, 2.26 * CM, 13.51 * CM, 15.62 * CM, 2.53 * CM, { tam: 16, cor: C.lilas });
          animar(st, 'entranceFade', 'afterprevious', 600);
        }
      } else {
        var lg2 = tentar(function () { return imagem('logo-escura.png', 2.26 * CM, 3.7 * CM, 8.0 * CM, 2.67 * CM); }, 'logo');
        animar(lg2, 'entranceFade', 'afterprevious', 600);
        var m = String(S.titulo || '').length;
        var fim = texto(S.titulo, 2.26 * CM, 7.0 * CM, 16.5 * CM, 4.2 * CM,
          { tam: m > 70 ? 26 : m > 45 ? 30 : 36, negrito: true, cor: 'F7F9FF', valign: 'top' });
        animar(fim, 'entranceFlyIn', 'afterprevious', 650);
        var yb = 11.75;
        if (S.subtitulo) {
          var sf = texto(S.subtitulo, 2.26 * CM, 11.4 * CM, 16.5 * CM, 1.3 * CM, { tam: 16, cor: C.lilas });
          animar(sf, 'entranceFade', 'afterprevious', 500);
          yb = 13.1;
        }
        var bf = forma('rect', 2.23 * CM, (yb + 0.22) * CM, 1.04 * CM, 0.21 * CM, C.verm);
        var lf = texto('Lube Distribuidora · desde 1959 · Cariacica-ES', 3.53 * CM, yb * CM, 18 * CM, 0.66 * CM, { tam: 13, cor: C.lilas, valign: 'center' });
        animar(bf, 'entranceWipe', 'afterprevious', 300);
        animar(lf, 'entranceFade', 'withprevious', 400);
      }
    } else if (L === 'secao') {
      tentar(function () { sl.SetBackground(solido('FF2B2F')); }, 'fundo');
      forma('rect', 0, 0, W, H, tentar(function () { return degrade([['FF2B2F', 0], ['EF1F2A', 50000], ['C90C23', 100000]], 17400000); }, 'degradê') || 'EF1F2A');
      var faixa = forma('rect', 22.29 * CM, 0, 10.99 * CM, H, '040F45');
      var azul = forma('rect', 26.34 * CM, 0, 12.23 * CM, H, tentar(function () { return degrade([['0A5CFF', 0], ['0C45D8', 40000], ['0E31A6', 100000]], 0); }, 'degradê') || '0C45D8');
      animar(faixa, 'entranceWipe', 'afterprevious', 500);
      animar(azul, 'entranceWipe', 'withprevious', 650);
      chamada('Seção ' + String(Asc.scope.secaoN || 1).replace(/^(\d)$/, '0$1'), 5.23, C.branco, C.branco);
      var ts = texto(S.titulo, 2.26 * CM, 6.53 * CM, 19.6 * CM, 4.45 * CM, { tam: tam(S.titulo, 36), negrito: true, cor: C.branco, valign: 'bottom' });
      animar(ts, 'entranceFlyIn', 'afterprevious', 600);
      if (S.subtitulo) {
        var ss = texto(S.subtitulo, 2.26 * CM, 11.62 * CM, 19.6 * CM, 1.71 * CM, { tam: 16, cor: C.branco });
        animar(ss, 'entranceFade', 'afterprevious', 500);
      }
      rodape(C.branco);
    } else if (L === 'topicos') {
      var y0 = cabecalho(S.titulo, S.subtitulo);
      var itens = (S.topicos || []).slice(0, 8);
      var n2 = Math.max(itens.length, 1), gap = 0.3;
      var alto = Math.min(2.41, (16.6 - y0 - (n2 - 1) * gap) / n2);
      var fonte = n2 <= 4 ? 20 : n2 <= 6 ? 18 : 16;
      itens.forEach(function (it, i) {
        var y = y0 + i * (alto + gap);
        var c = cartao(2.27 * CM, y * CM, 29.33 * CM, alto * CM, i);
        var mk = forma('rect', 2.98 * CM, (y + alto / 2 - 0.11) * CM, 0.62 * CM, 0.22 * CM, i % 2 ? C.azul : C.verm);
        var tx = texto(it, 4.0 * CM, y * CM, 26.9 * CM, alto * CM, { tam: fonte, cor: C.escrita, corNegrito: C.azul, valign: 'center' });
        animar(c, 'entranceFloatIn', 'afterprevious', 350);
        animar(mk, 'entranceWipe', 'withprevious', 350);
        animar(tx, 'entranceFade', 'withprevious', 450);
      });
    } else if (L === 'duas_colunas') {
      var y1 = cabecalho(S.titulo, S.subtitulo) + 0.4;
      var cols = (S.colunas || []).slice(0, 2);
      var cw = (29.35 - 0.6) / 2, ch = 16.5 - y1;
      cols.forEach(function (c, i) {
        var x = 2.26 + i * (cw + 0.6);
        var card = cartao(x * CM, y1 * CM, cw * CM, ch * CM, i, i === 0);
        var tt2 = texto(c.titulo, (x + 0.75) * CM, (y1 + 0.6) * CM, (cw - 1.5) * CM, 1.1 * CM, { tam: tam(c.titulo, 22), negrito: true, cor: C.gelo, valign: 'center' });
        var tp = texto((c.topicos || []).map(function (t) { return '•  ' + t; }), (x + 0.75) * CM, (y1 + 2.0) * CM, (cw - 1.5) * CM, (ch - 2.5) * CM,
          { tam: (c.topicos || []).length > 4 ? 15 : 17, cor: i === 0 ? 'EEF1FA' : C.lilas, corNegrito: C.gelo, depois: 160 });
        animar(card, 'entranceFloatIn', 'afterprevious', 500);
        animar(tt2, 'entranceFade', 'afterprevious', 350);
        animar(tp, 'entranceFade', 'afterprevious', 450);
      });
    } else if (L === 'numeros') {
      var y2 = cabecalho(S.titulo, S.subtitulo);
      var ns = (S.numeros || []).slice(0, 4);
      var k = Math.max(ns.length, 1);
      var alt = Math.min(2.41, (16.6 - y2 - (k - 1) * 0.3) / k);
      ns.forEach(function (nn, i) {
        var y = y2 + i * (alt + 0.3);
        var c = cartao(2.27 * CM, y * CM, 29.33 * CM, alt * CM, i);
        var v = texto(nn.valor, 2.98 * CM, y * CM, 12.35 * CM, alt * CM,
          { tam: String(nn.valor).length > 12 ? 28 : alt > 2.2 ? 36 : 32, negrito: true, cor: C.azul, valign: 'center' });
        var r = texto(nn.rotulo, 15.68 * CM, y * CM, 15.4 * CM, alt * CM, { tam: 16, cor: C.tinta, valign: 'center' });
        animar(c, 'entranceFloatIn', 'afterprevious', 350);
        animar(v, 'entranceZoom', 'withprevious', 450);
        animar(r, 'entranceFade', 'afterprevious', 350);
      });
    } else if (L === 'etapas') {
      var y3 = Math.max(cabecalho(S.titulo, S.subtitulo) + 1.0, 8.4);
      var es = (S.etapas || []).slice(0, 5);
      var q = Math.max(es.length, 1), gap2 = 0.58, w3 = (29.33 - (q - 1) * gap2) / q, h3 = 16.2 - y3;
      es.forEach(function (e, i) {
        var x = 2.27 + i * (w3 + gap2);
        var c = cartao(x * CM, y3 * CM, w3 * CM, h3 * CM, i);
        var num = texto(('0' + (i + 1)).slice(-2), (x + 0.64) * CM, (y3 + 0.72) * CM, (w3 - 1.28) * CM, 1.16 * CM, { tam: 22, negrito: true, cor: C.vermClaro });
        var et = texto(e.titulo, (x + 0.64) * CM, (y3 + 2.09) * CM, (w3 - 1.28) * CM, 1.5 * CM, { tam: q > 4 ? 15 : 18, negrito: true, cor: C.gelo });
        var ex = texto(e.texto, (x + 0.64) * CM, (y3 + 3.75) * CM, (w3 - 1.28) * CM, (h3 - 4.2) * CM, { tam: q > 4 ? 12 : 14, cor: C.lilas });
        animar(c, 'entranceFloatIn', 'afterprevious', 400);
        animar(num, 'entranceZoom', 'withprevious', 400);
        animar(et, 'entranceFade', 'afterprevious', 300);
        animar(ex, 'entranceFade', 'withprevious', 400);
      });
    } else if (L === 'citacao') {
      fundoEscuro();
      chamada(Asc.scope.chamada || 'Lube Distribuidora', 2.26, C.vermClaro);
      var aspas = texto('“', 2.0 * CM, 3.1 * CM, 6 * CM, 5 * CM, { tam: 150, negrito: true, cor: C.verm });
      var frase = texto(S.titulo, 2.26 * CM, 6.6 * CM, 28.8 * CM, 6.2 * CM, { tam: tam(S.titulo, 34), negrito: true, cor: C.gelo, valign: 'center' });
      animar(aspas, 'entranceZoom', 'afterprevious', 500);
      animar(frase, 'entranceFade', 'afterprevious', 900);
      if (S.subtitulo) {
        var bq = forma('rect', 2.23 * CM, 13.9 * CM, 1.04 * CM, 0.21 * CM, C.verm);
        var autor = texto(S.subtitulo, 3.53 * CM, 13.66 * CM, 22 * CM, 0.7 * CM, { tam: 16, cor: C.lilas, valign: 'center' });
        animar(bq, 'entranceWipe', 'afterprevious', 300);
        animar(autor, 'entranceFade', 'withprevious', 400);
      }
      rodape(C.rodapeEsc);
    } else {
      var y4 = cabecalho(S.titulo || '', '');
      var corpo = texto(S.subtitulo || '', 2.26 * CM, y4 * CM, 29.3 * CM, (16.4 - y4) * CM, { tam: 20, cor: C.escrita });
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
    var secao = 0, nomeSecao = '';
    var cadeia = comando(function () { return Api.GetPresentation().GetSlidesCount(); }).then(function (n) { antes = n || 0; });
    slides.forEach(function (s, i) {
      if (s.layout === 'secao') { secao++; nomeSecao = s.titulo; }
      var n = secao;
      // a chamada vermelha sobre o título é o nome da seção em que o slide está (ou a Lube)
      var chamada = s.layout === 'capa' ? '' : (nomeSecao || 'Lube Distribuidora');
      cadeia = cadeia.then(function () {
        return comando(slideDesenhar, {
          slide: s, base: d.base || ORIGEM, primeiro: i === 0, criar: criar, secaoN: n, chamada: chamada,
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
