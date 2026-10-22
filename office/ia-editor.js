/* =========================================================
   LUBE OFFICE — IA da Lube no editor
   Painel ao lado do documento: a pessoa pede (texto e fotos), a função office
   pede ao Claude (Haiku 5.5) um plano, e o plugin office/ia/ executa o plano
   dentro do Word, do Excel ou do PowerPoint, com a cara da Lube.
   Ponte com o plugin: o plugin é servido pelo próprio portal (mesma origem desta
   página) e roda dentro da moldura do editor. Ele avisa "pronto" em window.top; a
   página guarda essa janela (só se ela está dentro da moldura do editor) e fala direto
   com ela. O canal oficial do ONLYOFFICE para isso (onExternalPluginMessage) só existe
   na edição paga, achado no teste de 2026-10-21.
   Quem pode usar: quem pode editar o arquivo (o servidor confere).
   ========================================================= */
(function () {
  'use strict';

  var O = window.OFC, $ = O.$, $$ = O.$$, esc = O.esc;
  var GUID = 'asc.{7A3C9F1E-4B2D-4E8A-9C61-1B5E0D2F8A47}';

  var cfg = null;          // { arquivo, origemMotor, teste, pendente }
  var tipo = 'docx';
  var pluginPronto = false, janelaPlugin = null, esperando = [], pedidos = {}, seq = 0;
  var ocupado = false, anexos = [], situacao = null;

  /* ---------- textos de cada editor ---------- */
  var TXT = {
    docx: {
      sub: 'Escreve no seu documento', onde: 'documento', no: 'no documento', o: 'o documento', noSeu: 'no seu documento',
      contexto: 'Usar o texto selecionado (ou o documento todo)',
      dica: 'Ex.: transforme a foto da reunião em ata · escreva uma proposta para o cliente X',
      sugestoes: [
        ['Ata a partir de foto', 'Transforme a foto em uma ata de reunião organizada, com participantes, decisões e responsáveis.'],
        ['Proposta comercial', 'Escreva uma proposta comercial da Lube para o cliente '],
        ['Comunicado interno', 'Escreva um comunicado interno curto e claro sobre '],
        ['Melhorar o texto', 'Corrija e melhore o texto selecionado, mantendo o sentido.', true],
        ['Resumir', 'Resuma o documento em tópicos curtos, com as decisões e os próximos passos.', true]
      ]
    },
    xlsx: {
      sub: 'Monta a sua planilha', onde: 'planilha', no: 'na planilha', o: 'a planilha', noSeu: 'na sua planilha',
      contexto: 'Usar os dados desta aba (ou da seleção)',
      dica: 'Ex.: controle de metas por RCA com % atingido · planilha a partir da foto da tabela',
      sugestoes: [
        ['Metas por RCA', 'Monte uma planilha de metas de vendas por RCA do mês, com meta, realizado, % atingido, diferença e gráfico.'],
        ['Contas a pagar', 'Crie um controle de contas a pagar do mês com vencimento, fornecedor, valor, situação e total.'],
        ['Tabela da foto', 'Transforme a foto da tabela em planilha, com as fórmulas que fizerem sentido.'],
        ['Resumo destes dados', 'Analise os dados desta aba e monte um resumo com totais por categoria e um gráfico.', true]
      ]
    },
    pptx: {
      sub: 'Cria os seus slides', onde: 'apresentação', no: 'na apresentação', o: 'a apresentação', noSeu: 'na sua apresentação',
      contexto: 'Usar os slides atuais como base',
      dica: 'Ex.: 8 slides do resultado do mês · slides a partir da foto do quadro',
      sugestoes: [
        ['Resultado do mês', 'Crie uma apresentação do resultado do mês para a diretoria: vendas, clientes, ruptura e próximos passos.'],
        ['Slides da foto', 'Transforme a foto do quadro em slides organizados.'],
        ['Treinamento', 'Crie uma apresentação de treinamento para os RCAs sobre '],
        ['Melhorar estes slides', 'Refaça estes slides com uma história mais clara e números em destaque.', true]
      ]
    }
  };

  var SVG = {
    brilho: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9Z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8Z"/></svg>',
    clipe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m21 11-8.5 8.5a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 7"/></svg>',
    enviar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    fechar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><path d="m5 12 5 5 9-10"/></svg>',
    erro: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 7v6M12 17h.01"/></svg>'
  };

  /* ---------- ponte com o plugin ---------- */
  // a janela que mandou a mensagem está dentro da moldura do editor?
  function dentroDoEditor(w) {
    var f = moldura();
    var alvo = f && f.contentWindow;
    for (var i = 0; i < 5 && w && alvo; i++) {
      if (w === alvo) return true;
      if (w === window || w === w.parent) return false;
      w = w.parent;
    }
    return false;
  }
  window.addEventListener('message', function (ev) {
    if (ev.origin !== location.origin || !ev.source || ev.source === window) return;
    var d = ev.data;
    if (!d || typeof d !== 'object' || d.lubeIa !== true || d.paraPlugin) return;
    if (d.tipo === 'pronto') {
      if (!dentroDoEditor(ev.source)) return;
      janelaPlugin = ev.source;
      if (!pluginPronto) { pluginPronto = true; esperando.splice(0).forEach(function (f) { f(); }); }
      return;
    }
    if (ev.source !== janelaPlugin) return;
    var p = pedidos[d.id];
    if (!p) return;
    if (d.tipo === 'progresso') { if (p.progresso) p.progresso(d); return; }
    delete pedidos[d.id];
    clearTimeout(p.tempo);
    if (d.ok) p.ok(d); else p.falha(new Error(d.erro || 'O editor não conseguiu executar.'));
  });

  function moldura() { return $('.ed-palco iframe'); }
  function mandar(dados) {
    dados.paraPlugin = true;
    if (janelaPlugin) { janelaPlugin.postMessage(dados, location.origin); return; }
    // reserva: canal oficial (só funciona na edição paga do ONLYOFFICE)
    var f = moldura();
    if (!f || !f.contentWindow) throw new Error('O editor ainda não abriu.');
    f.contentWindow.postMessage(JSON.stringify({
      frameEditorId: 'editor-onlyoffice', guid: GUID, type: 'onExternalPluginMessage', data: dados
    }), cfg.origemMotor);
  }
  // procura o plugin entre as molduras de dentro do editor: só a da origem do portal recebe
  function procurarPlugin() {
    var f = moldura();
    if (!f || !f.contentWindow) return;
    var ping = { lubeIa: true, paraPlugin: true, tipo: 'ping', id: 'ping' };
    (function varrer(w, nivel) {
      var n = 0;
      try { n = w.frames.length; } catch (e) { return; }
      for (var i = 0; i < n; i++) {
        try { w.frames[i].postMessage(ping, location.origin); } catch (e) {}
        if (nivel < 2) varrer(w.frames[i], nivel + 1);
      }
    })(f.contentWindow, 0);
  }
  function esperarPlugin() {
    if (pluginPronto) return Promise.resolve();
    return new Promise(function (ok, falha) {
      esperando.push(ok);
      var n = 0;
      var t = setInterval(function () {
        if (pluginPronto) { clearInterval(t); return; }
        procurarPlugin();
        if (++n > 60) {
          clearInterval(t);
          falha(new Error('A IA não carregou dentro do editor. Recarregue a página; se continuar, avise o TI.'));
        }
      }, 500);
    });
  }
  function pedirAoPlugin(dados, progresso, ms) {
    return esperarPlugin().then(function () {
      return new Promise(function (ok, falha) {
        var id = 'p' + (++seq) + '-' + Date.now();
        dados.id = id;
        dados.lubeIa = true;
        pedidos[id] = {
          ok: ok, falha: falha, progresso: progresso,
          tempo: setTimeout(function () {
            if (pedidos[id]) { delete pedidos[id]; falha(new Error('O editor não respondeu a tempo.')); }
          }, ms || 180000)
        };
        mandar(dados);
      });
    });
  }

  /* ---------- chamada à IA ---------- */
  function chamarIa(corpo) {
    if (cfg.teste) return O.apiTeste(Object.assign({ token: cfg.teste, acao: 'ia' }, corpo));
    return O.api('ia', corpo);
  }

  /* ---------- painel ---------- */
  function montar() {
    var T = TXT[tipo];
    var p = $('[data-ia]');
    p.innerHTML =
      '<div class="ia__dentro">' +
        '<div class="ia__topo">' +
          '<span class="ia-orbe" aria-hidden="true"><i></i><b></b></span>' +
          '<div class="ia__titulo"><span class="mono">IA da Lube</span><strong>' + esc(T.sub) + '</strong></div>' +
          '<button class="fechar" type="button" data-ia-fechar aria-label="Fechar a IA">' + SVG.fechar + '</button>' +
        '</div>' +
        '<div class="ia__corpo" data-ia-corpo>' +
          '<section class="ia__boas" data-ia-boas>' +
            '<p class="ia__ola">Diga o que você quer e a IA monta aqui, ' + esc(T.noSeu) + ', com a identidade da Lube.</p>' +
            '<p class="ia__dica">Mande foto de quadro, anotação à mão ou tabela impressa: ela lê e organiza.</p>' +
            '<div class="ia__sugs">' + T.sugestoes.map(function (s, i) {
              return '<button type="button" class="ia-sug" data-ia-sug="' + i + '" style="--i:' + i + '">' + SVG.brilho + esc(s[0]) + '</button>';
            }).join('') + '</div>' +
          '</section>' +
          '<div class="ia__hist" data-ia-hist></div>' +
        '</div>' +
        '<form class="ia__compor" data-ia-form novalidate>' +
          '<div class="ia__anexos" data-ia-anexos></div>' +
          '<div class="ia__caixa">' +
            '<textarea data-ia-pedido rows="2" maxlength="4000" placeholder="Peça para a IA da Lube…" aria-label="Pedido para a IA"></textarea>' +
            '<div class="ia__acoes">' +
              '<button type="button" class="ia__bot" data-ia-anexar title="Mandar foto ou imagem">' + SVG.clipe + '</button>' +
              '<label class="ia__opcao"><input type="checkbox" data-ia-contexto><i></i><span>' + esc(T.contexto) + '</span></label>' +
              '<button type="submit" class="ia__ir" data-ia-ir aria-label="Pedir à IA">' + SVG.enviar + '</button>' +
            '</div>' +
          '</div>' +
          (tipo === 'docx' ? '<label class="ia__opcao ia__opcao--img" data-ia-opcao-img hidden><input type="checkbox" data-ia-colocar-img><i></i><span>Colocar a imagem no documento também</span></label>' : '') +
          '<div class="ia__rodape"><span data-ia-gasto>IA da Lube · Claude Haiku 5.5</span><i class="ia__medidor"><b data-ia-medidor></b></i></div>' +
          '<input type="file" accept="image/*" multiple hidden data-ia-arquivo>' +
        '</form>' +
      '</div>';
    ligarPainel();
    desenharGasto();
  }

  function ligarPainel() {
    var p = $('[data-ia]');
    var area = $('[data-ia-pedido]', p);
    var auto = function () { area.style.height = 'auto'; area.style.height = Math.min(area.scrollHeight, 220) + 'px'; };
    area.addEventListener('input', auto);
    area.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey || !ev.shiftKey)) { ev.preventDefault(); enviar(); }
    });
    area.addEventListener('paste', function (ev) {
      var fs = Array.prototype.filter.call((ev.clipboardData && ev.clipboardData.files) || [], function (f) { return /^image\//.test(f.type); });
      if (fs.length) { ev.preventDefault(); anexar(fs); }
    });
    $('[data-ia-form]', p).addEventListener('submit', function (ev) { ev.preventDefault(); enviar(); });
    $('[data-ia-fechar]', p).addEventListener('click', fechar);
    $('[data-ia-anexar]', p).addEventListener('click', function () { $('[data-ia-arquivo]', p).click(); });
    $('[data-ia-arquivo]', p).addEventListener('change', function (ev) { anexar(ev.target.files); ev.target.value = ''; });
    p.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-ia-sug]');
      if (b) {
        var s = TXT[tipo].sugestoes[+b.getAttribute('data-ia-sug')];
        area.value = s[1];
        $('[data-ia-contexto]', p).checked = !!s[2];
        auto();
        area.focus();
        area.setSelectionRange(area.value.length, area.value.length);
        return;
      }
      var t = ev.target.closest('[data-ia-tira]');
      if (t) { anexos.splice(+t.getAttribute('data-ia-tira'), 1); desenharAnexos(); }
    });
    // arrastar foto para o painel
    p.addEventListener('dragover', function (ev) { if (temArquivo(ev)) { ev.preventDefault(); p.classList.add('is-soltar'); } });
    p.addEventListener('dragleave', function (ev) { if (!p.contains(ev.relatedTarget)) p.classList.remove('is-soltar'); });
    p.addEventListener('drop', function (ev) {
      if (!temArquivo(ev)) return;
      ev.preventDefault();
      p.classList.remove('is-soltar');
      anexar(ev.dataTransfer.files);
    });
  }
  function temArquivo(ev) { return ev.dataTransfer && Array.prototype.indexOf.call(ev.dataTransfer.types || [], 'Files') > -1; }

  function anexar(lista) {
    var arr = Array.prototype.slice.call(lista || []);
    if (anexos.length + arr.length > 4) { O.toast('Até 4 imagens por pedido.', 'erro'); arr = arr.slice(0, Math.max(0, 4 - anexos.length)); }
    Promise.all(arr.map(function (f) { return O.imagemParaIa(f).catch(function (e) { O.toast(e.message, 'erro'); return null; }); }))
      .then(function (l) { l.forEach(function (a) { if (a) anexos.push(a); }); desenharAnexos(); });
  }
  function desenharAnexos() {
    var box = $('[data-ia-anexos]');
    box.innerHTML = anexos.map(function (a, i) {
      return '<span class="ia-anexo" style="--i:' + i + '"><img src="' + a.url + '" alt=""><button type="button" data-ia-tira="' + i +
        '" aria-label="Tirar imagem">' + SVG.fechar + '</button></span>';
    }).join('');
    var op = $('[data-ia-opcao-img]');
    if (op) op.hidden = !anexos.length;
  }

  function desenharGasto() {
    var el = $('[data-ia-gasto]'), m = $('[data-ia-medidor]');
    if (!el || !situacao) return;
    var teto = Number(situacao.teto_dia_usd) || 10, g = Number(situacao.gasto_hoje_usd) || 0;
    el.textContent = 'Hoje na Lube: ' + O.usd(g) + ' de ' + O.usd(teto) + ' · Haiku 5.5';
    m.style.width = Math.min(100, Math.max(2, g / teto * 100)) + '%';
  }

  function abrir() {
    var area = $('.ed-area');
    area.classList.add('ia-aberta');
    $('[data-ia-abrir]').setAttribute('aria-expanded', 'true');
    setTimeout(function () {
      var t = $('[data-ia-pedido]');
      $('[data-ia]').scrollLeft = 0;
      if (t && !ocupado) t.focus({ preventScroll: true });
    }, 480);
    if (!situacao && !cfg.teste && !O.DEMO) {
      O.api('eu', {}).then(function (r) { if (r && r.ia) { situacao = r.ia; desenharGasto(); } }, function () {});
    }
  }
  function fechar() {
    $('.ed-area').classList.remove('ia-aberta');
    $('[data-ia-abrir]').setAttribute('aria-expanded', 'false');
  }

  /* ---------- um pedido ---------- */
  function cartao(pedido, imgs) {
    var hist = $('[data-ia-hist]');
    $('[data-ia-boas]').hidden = true;
    var el = document.createElement('article');
    el.className = 'ia-par';
    el.innerHTML =
      '<div class="ia-eu">' + (imgs.length ? '<div class="ia-eu__imgs">' + imgs.map(function (a) { return '<img src="' + a.url + '" alt="">'; }).join('') + '</div>' : '') +
        (pedido ? '<p>' + esc(pedido) + '</p>' : '') + '</div>' +
      '<div class="ia-ela is-pensando">' +
        '<div class="ia-ela__cab"><span class="ia-orbe ia-orbe--p" aria-hidden="true"><i></i><b></b></span><strong>IA da Lube</strong></div>' +
        '<ol class="ia-passos" data-passos></ol>' +
        '<div class="ia-barra" data-barra hidden><b></b></div>' +
        '<div class="ia-ela__fim" data-fim></div>' +
      '</div>';
    hist.appendChild(el);
    rolar();
    var passos = $('[data-passos]', el);
    return {
      el: el,
      passo: function (txt) {
        var li = document.createElement('li');
        li.className = 'is-indo';
        li.innerHTML = '<i></i><span>' + esc(txt) + '</span>';
        passos.appendChild(li);
        rolar();
        return {
          ok: function (t2) { li.className = 'is-ok'; li.querySelector('i').innerHTML = SVG.ok; if (t2) li.querySelector('span').textContent = t2; },
          texto: function (t2) { li.querySelector('span').textContent = t2; }
        };
      },
      progresso: function (f, t) {
        var b = $('[data-barra]', el);
        b.hidden = false;
        b.querySelector('b').style.width = Math.round(f / Math.max(t, 1) * 100) + '%';
      },
      fim: function (html, erro) {
        var ela = $('.ia-ela', el);
        ela.classList.remove('is-pensando');
        if (erro) ela.classList.add('is-erro');
        $('[data-barra]', el).hidden = true;
        $('[data-fim]', el).innerHTML = html;
        rolar();
      }
    };
  }
  function rolar() { var c = $('[data-ia-corpo]'); if (c) c.scrollTo({ top: c.scrollHeight, behavior: 'smooth' }); }

  function resumoDoPlano(pl) {
    if (pl.slides) return pl.slides.length + (pl.slides.length === 1 ? ' slide' : ' slides') + ': ' +
      pl.slides.slice(0, 6).map(function (s) { return s.titulo; }).filter(Boolean).join(' · ') + (pl.slides.length > 6 ? ' …' : '');
    if (pl.abas) return pl.abas.map(function (a) { return '“' + a.nome + '” com ' + a.linhas.length + (a.linhas.length === 1 ? ' linha' : ' linhas') + (a.grafico ? ' e gráfico' : ''); }).join(' · ');
    if (pl.blocos) return pl.blocos.length + ' blocos de texto' + (pl.blocos.some(function (b) { return b.tipo === 'tabela'; }) ? ', com tabela' : '');
    return '';
  }

  // o que a IA vai fazer, de ponta a ponta
  function executarPedido(o) {
    if (ocupado) return Promise.resolve();
    ocupado = true;
    var T = TXT[tipo];
    var c = cartao(o.pedido, o.imagens || []);
    var palco = $('.ed-palco');
    palco.classList.add('is-ia');
    status(true, 'A IA da Lube está pensando…');
    $('[data-ia-ir]').disabled = true;
    var pLer = null, ctx = null, inicio = Date.now(), resposta = null;
    var comContexto = o.contexto && !O.DEMO;
    var cadeia = Promise.resolve();
    if (comContexto) {
      pLer = c.passo('Lendo o que já está ' + T.no);
      cadeia = pedirAoPlugin({ tipo: 'contexto' }, null, 30000).then(function (r) {
        ctx = r;
        pLer.ok(r.origem === 'selecao' ? 'Li o texto selecionado' : 'Li ' + T.o);
      });
    }
    var pPensar;
    return cadeia.then(function () {
      pPensar = c.passo(o.fonte ? 'Lendo “' + o.fonte.nome + '” e pensando' : (o.imagens || []).length ? 'Lendo as imagens e pensando' : 'Pensando no seu pedido');
      return chamarIa({
        tipo: tipo, modo: o.modo, pedido: o.pedido, arquivo: cfg.arquivo.id, nome_arquivo: cfg.arquivo.nome + '.' + cfg.arquivo.extensao,
        imagens: (o.imagens || []).map(function (a) { return { tipo: a.tipo, dados: a.dados }; }),
        contexto: ctx ? ctx.texto : '', fonte: o.fonte ? o.fonte.id : null
      });
    }).then(function (r) {
      resposta = r;
      if (r.situacao) { situacao = r.situacao; desenharGasto(); }
      pPensar.ok('Plano pronto em ' + String(r.segundos || ((Date.now() - inicio) / 1000).toFixed(1)).replace('.', ',') + ' s');
      if (O.DEMO || !cfg.origemMotor) return { demo: true };
      var pMontar = c.passo('Montando ' + T.no);
      status(true, 'Montando ' + T.no + '…');
      var modoExec = o.modo === 'editor' ? (tipo === 'docx' && ctx && ctx.origem === 'selecao' ? 'substituir' : 'cursor') : 'criar';
      return pedirAoPlugin({
        tipo: 'executar', plano: r.plano, modo: modoExec, base: location.origin,
        imagens: o.colocarImagens ? (o.imagens || []).map(function (a) { return a.url; }) : []
      }, function (pg) {
        c.progresso(pg.feito, pg.total);
        if (pg.texto) { pMontar.texto(pg.texto); status(true, pg.texto + '…', pg.feito / Math.max(pg.total, 1)); }
      }).then(function (f) { pMontar.ok('Pronto ' + T.no); return f; });
    }).then(function (f) {
      var r = resposta;
      var avisos = (f && f.avisos) || [];
      c.fim(
        '<p class="ia-resumo">' + esc(r.plano.resumo || 'Feito.') + '</p>' +
        '<p class="ia-oque">' + esc(resumoDoPlano(r.plano)) + '</p>' +
        '<div class="ia-meta"><span>' + esc(O.usd(r.custo_usd)) + '</span><span>' + esc(String(r.segundos || '').replace('.', ',')) + ' s</span>' +
        (f && f.demo ? '<span class="ia-meta__aviso">Demonstração: o editor não está ligado aqui</span>' : '<span>Desfazer: Ctrl+Z</span>') + '</div>' +
        (avisos.length ? '<details class="ia-avisos"><summary>' + avisos.length + ' detalhe(s) que o editor não aplicou</summary><ul>' +
          avisos.map(function (a) { return '<li>' + esc(a) + '</li>'; }).join('') + '</ul></details>' : '')
      );
      if (o.aoTerminar) o.aoTerminar(r);
      return r;
    }).catch(function (e) {
      c.fim('<p class="ia-resumo">' + esc(e.message) + '</p>' +
        (e.status === 429 ? '' : '<button type="button" class="mini" data-ia-repetir>Tentar de novo</button>'), true);
      var b = $('[data-ia-repetir]', c.el);
      if (b) b.addEventListener('click', function () { executarPedido(o); });
      if (e.dados && e.dados.situacao) { situacao = e.dados.situacao; desenharGasto(); }
    }).then(function () {
      ocupado = false;
      palco.classList.remove('is-ia');
      status(false);
      var bt = $('[data-ia-ir]');
      if (bt) bt.disabled = false;
    });
  }

  function enviar() {
    if (ocupado) return;
    var area = $('[data-ia-pedido]');
    var pedido = area.value.trim();
    if (!pedido && !anexos.length) { area.focus(); O.toast('Escreva o que você quer ou mande uma imagem.', 'info'); return; }
    var imgs = anexos.slice();
    var colocar = !!($('[data-ia-colocar-img]') && $('[data-ia-colocar-img]').checked);
    area.value = '';
    area.style.height = '';
    anexos = [];
    desenharAnexos();
    executarPedido({ modo: 'editor', pedido: pedido, imagens: imgs, contexto: $('[data-ia-contexto]').checked, colocarImagens: colocar });
  }

  // pílula que flutua sobre o documento enquanto a IA trabalha
  function status(on, txt, fracao) {
    var s = $('[data-ia-status]');
    if (!s) return;
    if (!on) { s.classList.remove('is-on'); return; }
    s.classList.add('is-on');
    $('[data-ia-status-txt]').textContent = txt || '';
    $('[data-ia-status-barra]').style.width = fracao ? Math.round(fracao * 100) + '%' : '';
    s.classList.toggle('is-medindo', !!fracao);
  }

  /* ---------- pedido que veio do Drive ("Criar com IA" / "Transformar com IA") ---------- */
  function lerPendente(chave) {
    if (!chave || !/^[a-z0-9]{8,40}$/i.test(chave)) return null;
    var v = null;
    try { v = JSON.parse(localStorage.getItem('office_ia_' + chave) || 'null'); localStorage.removeItem('office_ia_' + chave); } catch (e) { v = null; }
    return v && typeof v === 'object' ? v : null;
  }

  /* ---------- início (chamado pelo editor.js quando o editor abre) ---------- */
  function iniciar(o) {
    cfg = o;
    tipo = { docx: 'docx', xlsx: 'xlsx', pptx: 'pptx' }[String(o.arquivo.extensao || '').toLowerCase()] || null;
    var botao = $('[data-ia-abrir]');
    if (!tipo || !o.ligada) { botao.hidden = true; return; }
    montar();
    botao.hidden = false;
    botao.addEventListener('click', function () {
      if ($('.ed-area').classList.contains('ia-aberta')) fechar(); else abrir();
    });
    document.addEventListener('keydown', function (ev) {
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'i' && ev.shiftKey) { ev.preventDefault(); abrir(); }
    });
    var pend = o.pendente;
    if (pend) {
      abrir();
      (cfg.origemMotor ? esperarPlugin() : Promise.resolve()).then(function () {
        // dá um respiro para o documento terminar de desenhar antes de a IA escrever
        return new Promise(function (ok) { setTimeout(ok, 900); });
      }, function () {}).then(function () {
        return executarPedido({
          modo: pend.fonte ? 'transformar' : 'criar', pedido: pend.pedido || '', imagens: pend.imagens || [],
          fonte: pend.fonte || null, contexto: false, colocarImagens: !!pend.colocarImagens,
          aoTerminar: o.aoTerminar
        });
      });
    }
  }

  window.OFC_IA_EDITOR = { iniciar: iniciar, lerPendente: lerPendente };
})();
