/* =========================================================
   LUBE OFFICE — Drive
   Lista, criar, enviar, compartilhar, versões, lixeira e avisos.
   Quem pode o quê é conferido no servidor (função office); aqui a
   tela só esconde o que a pessoa não pode fazer.
   ========================================================= */
(function () {
  'use strict';

  var O = window.OFC, $ = O.$, $$ = O.$$, esc = O.esc;

  var VISOES = ['meus', 'compartilhados', 'recentes', 'modelos', 'lixeira', 'busca'];
  var TITULO = {
    meus: 'Meus arquivos', compartilhados: 'Compartilhados comigo', recentes: 'Recentes',
    modelos: 'Modelos da Lube', lixeira: 'Lixeira'
  };

  var est = {
    eu: null,
    visao: 'meus',
    pasta: null,
    pastaInfo: null,
    caminho: [],
    busca: '',
    itens: [],
    formato: lerLocal('office_formato') === 'grade' ? 'grade' : 'lista',
    pedido: 0,
    pessoas: null,
    avisos: null,
    gav: null,
    animar: false
  };

  /* ---------- ícones de interface ---------- */
  var SVG = {
    mais: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>',
    abrir: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
    pasta: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>',
    compart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M19 8v6M16 11h6"/></svg>',
    enviar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4Z"/></svg>',
    lapis: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20h4L19 9l-4-4L4 16Z"/></svg>',
    mover: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M10 13h6M13 10l3 3-3 3"/></svg>',
    relogio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/></svg>',
    lixo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>',
    restaurar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
    seta: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 6 6 6-6 6"/></svg>',
    fechar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    busca: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>',
    globo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
    cadeado: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>',
    vazio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M12 10v6M9 13h6"/></svg>',
    mais2: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 5v14M5 12h14"/></svg>',
    brilho: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9Z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8Z"/></svg>'
  };

  /* ---------- utilidades ---------- */
  function lerLocal(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function gravarLocal(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function extDe(nome) { var m = /\.([a-z0-9]{1,8})$/i.exec(nome || ''); return m ? m[1].toLowerCase() : ''; }
  function semExt(nome) { return String(nome || '').replace(/\.[a-z0-9]{1,8}$/i, '') || 'Arquivo'; }
  function euId() { return est.eu && est.eu.pessoa ? est.eu.pessoa.id : null; }
  function nomeDe(p) { return !p ? '—' : p.id === euId() ? 'Você' : p.nome; }
  function itemPorId(id) { for (var i = 0; i < est.itens.length; i++) if (est.itens[i].id === id) return est.itens[i]; return null; }
  function nomeCompleto(it) { return it.tipo === 'pasta' ? it.nome : it.nome + '.' + it.extensao; }
  function erroToast(e) { O.toast(e && e.message ? e.message : String(e), 'erro'); }

  /* ---------- endereço (visão, pasta, busca) ---------- */
  function lerUrl() {
    var u = new URLSearchParams(location.search);
    est.pasta = u.get('pasta') || null;
    est.busca = u.get('q') || '';
    var v = u.get('v') || (est.busca ? 'busca' : 'meus');
    est.visao = est.pasta ? 'pasta' : (VISOES.indexOf(v) > -1 ? v : 'meus');
  }
  function irPara(o, substituir) {
    var u = new URLSearchParams();
    if (O.DEMO) u.set('demo', '1');
    if (o.pasta) u.set('pasta', o.pasta);
    else if (o.visao && o.visao !== 'meus') u.set('v', o.visao);
    if (o.q) u.set('q', o.q);
    if (o.visao && o.visao !== 'pasta' && o.visao !== 'busca') gravarSessao('office_origem', o.visao);
    var url = location.pathname + (u.toString() ? '?' + u.toString() : '');
    history[substituir ? 'replaceState' : 'pushState'](null, '', url);
    var mudar = function () {
      lerUrl();
      fecharLateral();
      render();
      carregar();
      window.scrollTo(0, 0);
    };
    if (document.startViewTransition && !semMovimento()) document.startViewTransition(mudar);
    else mudar();
  }
  function semMovimento() { return window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches; }
  function gravarSessao(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} }
  function origem() {
    var v = null;
    try { v = sessionStorage.getItem('office_origem'); } catch (e) {}
    return v === 'compartilhados' || v === 'recentes' ? v : 'meus';
  }

  /* ---------- montagem da página ---------- */
  function render() {
    var raiz = est.visao === 'meus';
    $('[data-ola]').hidden = !raiz;
    $('[data-secao-modelos]').hidden = !(raiz || est.visao === 'modelos');
    $('[data-secao-lista]').hidden = est.visao === 'modelos';
    var marcada = est.visao === 'pasta' ? origem() : est.visao === 'busca' ? '' : est.visao;
    $$('[data-visao]').forEach(function (a) {
      a.classList.toggle('is-on', a.getAttribute('data-visao') === marcada);
      a.setAttribute('aria-current', a.getAttribute('data-visao') === marcada ? 'page' : 'false');
    });
    var on = $('.visao.is-on'), marca = $('[data-visoes-marca]');
    if (marca) {
      marca.style.opacity = on ? '1' : '0';
      if (on) { marca.style.transform = 'translateY(' + on.offsetTop + 'px)'; marca.style.height = on.offsetHeight + 'px'; }
    }
    var podeCriarAqui = est.visao === 'meus' || (est.visao === 'pasta' && est.pastaInfo && O.pode(est.pastaInfo.papel, 'editar'));
    $('[data-nova-pasta]').hidden = !podeCriarAqui;
    if (est.visao !== 'lixeira') $('[data-lixeira-aviso]').hidden = true;
    var busca = $('[data-busca]');
    if (document.activeElement !== busca) busca.value = est.busca;
    $('[data-busca-limpar]').hidden = !busca.value;
    renderTrilha();
    renderModelos();
    $$('[data-formato]').forEach(function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-formato') === est.formato ? 'true' : 'false');
    });
    $('[data-tabela]').classList.toggle('is-grade', est.formato === 'grade');
    document.title = (est.visao === 'pasta' && est.caminho.length
      ? est.caminho[est.caminho.length - 1].nome
      : est.visao === 'busca' ? 'Busca' : TITULO[est.visao] || 'LUBE OFFICE') + ' — LUBE OFFICE';
  }

  function renderTrilha() {
    var t = $('[data-trilha]');
    if (est.visao === 'busca') {
      t.innerHTML = '<span>Resultados para “' + esc(est.busca) + '”</span>';
      return;
    }
    if (est.visao !== 'pasta') { t.innerHTML = '<span>' + esc(TITULO[est.visao]) + '</span>'; return; }
    var o = origem();
    var h = '<a href="?v=' + o + '" data-ir-visao="' + o + '">' + esc(TITULO[o]) + '</a>';
    est.caminho.forEach(function (c, i) {
      h += SVG.seta;
      h += i === est.caminho.length - 1
        ? '<span>' + esc(c.nome) + '</span>'
        : '<a href="?pasta=' + esc(c.id) + '" data-ir-pasta="' + esc(c.id) + '">' + esc(c.nome) + '</a>';
    });
    if (est.pastaInfo && est.pastaInfo.papel && est.pastaInfo.papel !== 'dono') {
      h += '<span class="trilha__papel">' + esc(O.papelTxt(est.pastaInfo.papel)) + '</span>';
    }
    t.innerHTML = h;
  }

  /* ---------- modelos ---------- */
  function capa(tipo) {
    var marca = window.LUBE_MARCA ? window.LUBE_MARCA('#0D176E', '#E5101F') : '';
    if (tipo === 'apre') {
      var clara = window.LUBE_MARCA ? window.LUBE_MARCA('#FFFFFF', '#E5101F') : '';
      return '<div class="capa capa--slide"><span class="capa__placa">' + clara + '</span>' +
        '<span class="capa__ttl"></span><span class="capa__sub"></span></div>';
    }
    if (tipo === 'plan') {
      var g = '';
      for (var i = 0; i < 24; i++) g += '<i class="' + (i < 4 ? 't' : i % 4 === 3 ? 'v' : '') + '"></i>';
      return '<div class="capa"><div class="capa__faixa"><span class="capa__l">' + marca + '</span>' +
        '<span class="capa__titulo"></span></div><div class="capa__grade">' + g + '</div></div>';
    }
    return '<div class="capa"><div class="capa__faixa"><span class="capa__l">' + marca + '</span>' +
      '<span class="capa__titulo"></span></div><span class="capa__vermelho"></span>' +
      '<span class="capa__linha m"></span><span class="capa__linha"></span><span class="capa__linha c"></span>' +
      '<span class="capa__linha m"></span><span class="capa__linha"></span></div>';
  }
  function renderModelos() {
    var box = $('[data-modelos]');
    var todos = est.visao === 'modelos';
    var secao = $('[data-secao-modelos]');
    $('.secao__titulo h2', secao).textContent = todos ? 'Modelos da Lube' : 'Comece de um modelo';
    $('.secao__titulo .mono', secao).textContent = todos ? 'Em branco ou com a marca da Lube' : 'Com a marca da Lube';
    $('.link-mais', secao).hidden = todos;
    var h = '';
    if (todos) {
      [['docx', 'Documento em branco'], ['xlsx', 'Planilha em branco'], ['pptx', 'Apresentação em branco']].forEach(function (b) {
        var cls = O.classeTipo(b[0]);
        h += '<button class="modelo vivo" type="button" data-criar="' + b[0] + '" style="--i:' + (h.split('class="modelo').length - 1) + '">' +
          '<div class="modelo__capa modelo__capa--branco modelo__capa--' + cls + '"><span class="capa capa--branco">' + SVG.mais2 + '</span></div>' +
          '<div class="modelo__info"><strong>' + b[1] + '</strong><span>' + O.icone(b[0]) + O.nomeTipo(b[0]) + ' · .' + b[0] + '</span></div></button>';
      });
    }
    O.MODELOS.forEach(function (m) {
      h += '<button class="modelo vivo" type="button" data-modelo="' + m.id + '" style="--i:' + (h.split('class="modelo').length - 1) + '">' +
        '<div class="modelo__capa">' + capa(m.capa) + '</div>' +
        '<div class="modelo__info"><strong>' + esc(m.nome) + '</strong><span>' + O.icone(m.ext) + esc(m.desc) + '</span></div></button>';
    });
    box.innerHTML = h;
  }

  /* ---------- lista ---------- */
  function esqueleto() {
    var h = '';
    for (var i = 0; i < 5; i++) {
      h += '<div class="esq"><i></i><i style="width:' + (28 + (i * 13) % 30) + '%"></i><i style="width:12%;margin-left:auto"></i></div>';
    }
    $('[data-tabela]').innerHTML = h;
    $('[data-tabela]').hidden = false;
    $('[data-vazio]').hidden = true;
  }

  function carregar() {
    if (!est.eu || est.visao === 'modelos') return;
    var n = ++est.pedido;
    esqueleto();
    var dados = est.visao === 'pasta' ? { pasta: est.pasta } : { visao: est.visao, busca: est.busca };
    O.api('listar', dados).then(function (r) {
      if (n !== est.pedido) return;
      est.itens = r.itens || [];
      est.caminho = r.caminho || [];
      est.pastaInfo = r.pasta || null;
      est.animar = true;
      render();
      renderLista();
    }, function (e) {
      if (n !== est.pedido) return;
      if (est.visao === 'pasta' && (e.status === 404 || e.status === 403)) {
        O.toast('Essa pasta não está mais disponível para você.', 'erro');
        irPara({ visao: origem() }, true);
        return;
      }
      $('[data-tabela]').hidden = true;
      vazio('Não foi possível carregar', e.message, '<button class="btn" type="button" data-recarregar>Tentar de novo</button>');
    });
  }

  function vazio(titulo, texto, botoes) {
    var v = $('[data-vazio]');
    v.innerHTML = '<span class="vazio__ico">' + SVG.vazio + '</span><h3>' + esc(titulo) + '</h3><p>' + texto + '</p>' +
      (botoes ? '<div class="ferr">' + botoes + '</div>' : '');
    v.hidden = false;
  }

  // lixeira: o item fica office.config 'lixeira' dias (3, pedido do Júlio) e depois é apagado para sempre
  function lixeiraDias() { return (est.eu && est.eu.lixeira_dias) || 3; }
  function diasTxt(n) { return n + (n === 1 ? ' dia' : ' dias'); }
  function apagaEm(iso) {
    var h = (new Date(iso).getTime() + lixeiraDias() * 86400000 - Date.now()) / 3600000;
    if (!isFinite(h)) return '';
    var txt = h <= 0 ? 'apagando' : h < 1 ? 'apaga em menos de 1 h' : h < 24 ? 'apaga em ' + Math.ceil(h) + ' h' : 'apaga em ' + diasTxt(Math.ceil(h / 24));
    return '<span class="apaga' + (h < 24 ? ' is-perto' : '') + '">' + txt + '</span>';
  }

  function renderLista() {
    var tab = $('[data-tabela]');
    $('[data-vazio]').hidden = true;
    var aviso = $('[data-lixeira-aviso]');
    aviso.hidden = !(est.visao === 'lixeira' && est.itens.length);
    $('[data-lixeira-aviso-txt]').innerHTML = 'Os itens ficam <b>' + diasTxt(lixeiraDias()) + '</b> na lixeira. ' +
      'Depois disso são apagados para sempre, com todas as versões, e não dá mais para restaurar.';
    if (!est.itens.length) {
      tab.hidden = true;
      var criar = '<button class="btn btn--prim" type="button" data-criar="docx">' + SVG.mais2 + 'Documento</button>' +
                  '<button class="btn" type="button" data-criar="xlsx">Planilha</button>' +
                  '<button class="btn" type="button" data-enviar>Enviar arquivo</button>';
      var V = {
        meus: ['Seu espaço está pronto', 'Crie um documento, uma planilha ou uma apresentação, ou arraste arquivos do computador para cá.', criar],
        pasta: ['Pasta vazia', est.pastaInfo && O.pode(est.pastaInfo.papel, 'editar')
          ? 'Arraste arquivos do computador para cá ou use o botão Novo.' : 'Ainda não há nada nesta pasta.',
          est.pastaInfo && O.pode(est.pastaInfo.papel, 'editar') ? criar : ''],
        compartilhados: ['Nada compartilhado com você ainda', 'Quando alguém do painel compartilhar um arquivo ou uma pasta com você, aparece aqui, e o sino avisa.'],
        recentes: ['Nada recente', 'Os arquivos que você abrir ou editar nos últimos 60 dias aparecem aqui.'],
        lixeira: ['Lixeira vazia', 'O que você mandar para a lixeira fica aqui por ' + diasTxt(lixeiraDias()) +
          ' e pode ser restaurado. Depois disso, é apagado para sempre.'],
        busca: ['Nada encontrado', 'Nenhum arquivo ou pasta que você pode abrir tem “' + esc(est.busca) + '” no nome.']
      }[est.visao] || ['Vazio', ''];
      vazio(V[0], V[1], V[2]);
      return;
    }
    tab.hidden = false;
    // as colunas do cabeçalho usam as mesmas classes das linhas: somem juntas na tela estreita
    var cab = '<div class="linha linha--cab" role="row">' +
      '<span class="mono">Nome</span><span class="mono linha__dono">Dono</span>' +
      '<span class="mono linha__alt">' + (est.visao === 'lixeira' ? 'Na lixeira' : 'Última alteração') + '</span>' +
      '<span class="mono linha__tam">Tamanho</span><span class="mono linha__comp">Acesso</span><span></span></div>';
    tab.innerHTML = cab + est.itens.map(linha).join('');
    if (est.animar && !semMovimento()) {
      est.animar = false;
      tab.classList.add('is-entrando');
      clearTimeout(tab._anim);
      tab._anim = setTimeout(function () { tab.classList.remove('is-entrando'); }, 400 + est.itens.length * 35);
    }
  }

  function acessoHtml(it) {
    var c = it.compartilhado || { total: 0, pessoas: [] };
    if (c.todos) return O.avatarTodos('p') + '<span>Todos</span>';
    if (c.total) {
      var p = c.pessoas || [];
      var h = '<span class="avs">' + p.slice(0, 3).map(function (x) { return O.avatar(x, 'p'); }).join('') +
        (p.length > 3 ? '<span class="av av--p avs__mais">+' + (p.length - 3) + '</span>' : '') + '</span>';
      return h;
    }
    return SVG.cadeado + '<span>Privado</span>';
  }

  function linha(it, i) {
    var pasta = it.tipo === 'pasta';
    var arrastavel = est.visao !== 'lixeira' && O.pode(it.papel, 'mover');
    var compartilhada = it.compartilhado && it.compartilhado.total > 0;
    var quando = est.visao === 'lixeira' ? O.quando(it.lixeira_em) : O.quando(it.alterado_em);
    var por = !pasta && it.alterado_por ? (it.alterado_por.id === euId() ? 'você' : O.primeiroNome(it.alterado_por.nome)) : '';
    var apaga = est.visao === 'lixeira' ? apagaEm(it.lixeira_em) : '';
    var alt = est.visao === 'lixeira'
      ? '<span><b>' + esc(quando) + '</b> · ' + apaga + '</span>'
      : (it.alterado_por && !pasta ? O.avatar(it.alterado_por, 'p') : '') +
        '<span><b>' + esc(quando) + '</b>' + (por ? ' por ' + esc(por) : '') + '</span>';
    var sub = esc(quando) + (apaga ? ' · ' + apaga : '') +
      (it.dono && it.dono.id !== euId() ? ' · de ' + esc(O.primeiroNome(it.dono.nome)) : '') +
      (pasta ? '' : ' · ' + O.bytes(it.tamanho));
    return '<div class="linha" role="row" data-item="' + esc(it.id) + '" title="' + esc(nomeCompleto(it)) + '" style="--i:' + Math.min(i || 0, 18) + '"' +
      (arrastavel ? ' draggable="true"' : '') + '>' +
      '<button class="linha__nome" type="button" data-abrir>' + O.icone(pasta ? 'pasta' : it.extensao, compartilhada ? 'compartilhada' : '') +
        '<span class="linha__txt"><span class="linha__l1"><strong>' + esc(it.nome) + '</strong>' +
        (pasta ? '' : '<span class="ext">' + esc(it.extensao) + '</span>') +
        (it.papel && it.papel !== 'dono' && est.visao !== 'lixeira' ? '<span class="selo-papel">' + esc(O.papelTxt(it.papel)) + '</span>' : '') +
        '</span><span class="linha__sub">' + sub + '</span></span></button>' +
      '<div class="linha__dono">' + (it.dono ? O.avatar(it.dono, 'p') : '') + '<span>' + esc(nomeDe(it.dono)) + '</span></div>' +
      '<div class="linha__alt">' + alt + '</div>' +
      '<div class="linha__tam">' + (pasta ? '—' : O.bytes(it.tamanho)) + '</div>' +
      '<div class="linha__comp">' + acessoHtml(it) + '</div>' +
      '<button class="linha__mais" type="button" data-mais aria-label="Ações de ' + esc(nomeCompleto(it)) + '" aria-haspopup="menu" aria-expanded="false">' + SVG.mais + '</button>' +
      '</div>';
  }

  // item novo ou alterado: atualiza a lista se ele pertence ao que está na tela
  function aquiMesmo(it) {
    var lugar = it.tipo === 'pasta' ? it.pai : it.pasta;
    return (est.visao === 'meus' && !lugar && it.dono && it.dono.id === euId()) ||
           (est.visao === 'pasta' && lugar === est.pasta);
  }
  function inserirItem(it) {
    if (!aquiMesmo(it)) return false;
    est.itens = est.itens.filter(function (x) { return x.id !== it.id; });
    est.itens.push(it);
    est.itens.sort(function (a, b) {
      if (a.tipo !== b.tipo) return a.tipo === 'pasta' ? -1 : 1;
      return a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' });
    });
    renderLista();
    var el = $('[data-item="' + it.id + '"]');
    if (el) el.classList.add('is-novo');
    return true;
  }
  function trocarItem(it) {
    for (var i = 0; i < est.itens.length; i++) if (est.itens[i].id === it.id) est.itens[i] = it;
    renderLista();
  }
  function tirarItem(id) {
    est.itens = est.itens.filter(function (x) { return x.id !== id; });
    renderLista();
  }

  /* ---------- abrir ---------- */
  function urlEditor(it) {
    var u = 'editor.html?id=' + encodeURIComponent(it.id);
    if (O.DEMO) u += '&demo=1&nome=' + encodeURIComponent(it.nome) + '&ext=' + encodeURIComponent(it.extensao || 'docx');
    return u;
  }
  // a janela nasce no clique (senão o bloqueador de pop-up barra) e recebe o endereço depois
  function janelaEmBranco() {
    var w = null;
    try { w = window.open('', '_blank'); } catch (e) { w = null; }
    if (!w) return null;
    try {
      w.opener = null;
      w.document.title = 'Abrindo…';
      w.document.body.style.cssText = 'margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;' +
        'background:#030616;color:#E7EAF4;font:500 15px/1.4 Archivo,system-ui,sans-serif';
      w.document.body.textContent = 'Abrindo no LUBE OFFICE…';
    } catch (e) {}
    return w;
  }
  function abrirItem(it) {
    if (est.visao === 'lixeira') {
      O.toast('Está na lixeira. Restaure para abrir.', 'info', { texto: 'Restaurar', fn: function () { restaurar(it); } });
      return;
    }
    if (it.tipo === 'pasta') { irPara({ pasta: it.id }); return; }
    window.open(urlEditor(it), '_blank', 'noopener');
    decolar(it);
  }
  function decolar(it) {
    if (semMovimento()) return;
    var ico = $('[data-item="' + it.id + '"] .ico');
    if (!ico) return;
    var r = ico.getBoundingClientRect();
    var el = document.createElement('div');
    el.className = 'decolar';
    el.innerHTML = O.icone(it.extensao);
    el.style.left = r.left + 'px'; el.style.top = r.top + 'px'; el.style.width = r.width + 'px'; el.style.height = r.height + 'px';
    document.body.appendChild(el);
    requestAnimationFrame(function () {
      el.style.transform = 'translate(' + (innerWidth / 2 - r.left - r.width / 2) + 'px,' + (innerHeight / 2 - r.top - r.height / 2) + 'px) scale(3.2)';
      el.classList.add('is-indo');
    });
    setTimeout(function () { el.remove(); }, 900);
  }

  /* ---------- menu de cada item ---------- */
  var menuAberto = null;
  function fecharMenus() {
    ['[data-menu-item]', '[data-menu-novo]', '[data-menu-eu]', '[data-avisos]'].forEach(function (s) { $(s).hidden = true; });
    $$('[aria-expanded="true"]').forEach(function (b) { b.setAttribute('aria-expanded', 'false'); });
    menuAberto = null;
  }
  function acoesDe(it) {
    if (est.visao === 'lixeira') return [['restaurar', 'Restaurar', SVG.restaurar]];
    var a = [['abrir', it.tipo === 'pasta' ? 'Abrir pasta' : 'Abrir no editor', it.tipo === 'pasta' ? SVG.pasta : SVG.abrir]];
    a.push(['acesso', O.pode(it.papel, 'compartilhar') ? 'Compartilhar' : 'Quem tem acesso', SVG.compart]);
    if (it.tipo === 'arquivo' && O.pode(it.papel, 'editar')) a.push(['enviar', 'Enviar', SVG.enviar]);
    if (it.tipo === 'arquivo' && iaLigada() && /^(docx|xlsx|pptx|pdf|txt|csv)$/.test(it.extensao || '')) a.push(['transformar', 'Transformar com IA', SVG.brilho, 'menu__ia']);
    if (O.pode(it.papel, 'renomear')) a.push(['renomear', 'Renomear', SVG.lapis]);
    if (O.pode(it.papel, 'mover')) a.push(['mover', 'Mover para…', SVG.mover]);
    if (it.tipo === 'arquivo') a.push(['versoes', 'Versões e atividade', SVG.relogio]);
    if (O.pode(it.papel, 'lixeira')) { a.push(['-']); a.push(['lixeira', 'Mover para a lixeira', SVG.lixo, 'perigo']); }
    return a;
  }
  function abrirMenuItem(it, x, y, botao) {
    fecharMenus();
    var m = $('[data-menu-item]');
    m.innerHTML = acoesDe(it).map(function (a) {
      return a[0] === '-' ? '<hr>' : '<button type="button" role="menuitem" data-acao="' + a[0] + '"' +
        (a[3] ? ' class="' + a[3] + '"' : '') + '>' + a[2] + a[1] + '</button>';
    }).join('');
    m.style.position = 'fixed';
    m.hidden = false;
    var w = m.offsetWidth, h = m.offsetHeight;
    m.style.left = Math.max(8, Math.min(x - w, window.innerWidth - w - 8)) + 'px';
    m.style.top = (y + h + 8 > window.innerHeight ? Math.max(8, y - h - 4) : y + 4) + 'px';
    menuAberto = it;
    if (botao) botao.setAttribute('aria-expanded', 'true');
    var primeiro = $('button', m);
    if (primeiro) primeiro.focus({ preventScroll: true });
  }
  function executar(acao, it) {
    fecharMenus();
    if (acao === 'abrir') abrirItem(it);
    else if (acao === 'acesso') gaveta(it, 'acesso');
    else if (acao === 'versoes') gaveta(it, 'versoes');
    else if (acao === 'enviar') dialogoEnviar(it);
    else if (acao === 'transformar') dialogoIa({ fonte: it });
    else if (acao === 'renomear') renomear(it);
    else if (acao === 'mover') mover(it);
    else if (acao === 'lixeira') lixeira(it);
    else if (acao === 'restaurar') restaurar(it);
  }

  /* ---------- enviar (no lugar do download, pedido do Júlio em 2026-10-21) ----------
     O arquivo não sai pelo navegador: vai para pessoas do painel (acesso + aviso no
     sino) e/ou por e-mail para fora (anexo enviado pelo servidor). */
  var EMAIL_OK = /^[^@\s,;]+@[^@\s,;]+\.[a-z]{2,}$/i;
  function dialogoEnviar(it) {
    var d = $('[data-dialogo]');
    d.className = 'dialogo dialogo--largo';
    var internos = [];   // { pessoa, papel }
    var externos = [];
    var comEmail = !!(est.eu && est.eu.email);
    d.innerHTML = '<form method="dialog" class="enviar" novalidate>' +
      '<div class="dialogo__topo">' + O.icone(it.extensao || 'docx') + '<div><h2>Enviar “' + esc(nomeCompleto(it)) + '”</h2>' +
      '<p class="enviar__sub">O arquivo não é baixado: vai direto para quem você escolher.</p></div></div>' +
      '<section class="enviar__bloco"><span class="mono rotulo">Pessoas do painel</span>' +
        '<div class="adicionar"><div class="adicionar__campo">' + SVG.busca +
        '<input type="text" data-env-busca placeholder="Nome ou e-mail de quem está no painel" autocomplete="off" spellcheck="false" aria-label="Buscar pessoa do painel">' +
        seletorPapel('ver', 'data-env-papel aria-label="Acesso de quem recebe"') + '</div>' +
        '<div class="sugestoes suspenso" data-env-sug hidden></div></div>' +
        '<div class="fichas" data-env-internos></div>' +
        '<p class="enviar__nota">Recebe acesso ao arquivo (se ainda não tem) e um aviso no sino do painel.</p></section>' +
      '<section class="enviar__bloco"><span class="mono rotulo">E-mail de fora</span>' +
        '<label class="campo campo--fichas"><span class="fichas" data-env-externos></span>' +
        '<input type="email" data-env-email placeholder="cliente@empresa.com.br" autocomplete="off" spellcheck="false" aria-label="E-mail de fora"' +
        (comEmail ? '' : ' disabled') + '></label>' +
        '<p class="enviar__nota">' + (comEmail
          ? 'Vai como anexo, pela caixa de e-mail do LUBE OFFICE, com o seu nome. A resposta volta para ' + esc(est.eu.pessoa.email) + '.'
          : 'O envio por e-mail ainda não foi ligado: falta cadastrar a caixa de e-mail do LUBE OFFICE.') + '</p></section>' +
      '<label class="enviar__msg"><span class="mono rotulo">Mensagem (opcional)</span>' +
        '<textarea data-env-msg rows="3" maxlength="1000" placeholder="Um recado para quem recebe"></textarea></label>' +
      '<p class="dialogo__erro" data-dlg-erro></p>' +
      '<div class="dialogo__acoes"><button class="btn" type="button" data-dlg-cancelar>Cancelar</button>' +
      '<button class="btn btn--prim" type="submit" data-env-ok disabled>' + SVG.enviar + 'Enviar</button></div></form>';

    var busca = $('[data-env-busca]', d), sug = $('[data-env-sug]', d), email = $('[data-env-email]', d);
    var erroEl = $('[data-dlg-erro]', d), ok = $('[data-env-ok]', d);
    var lista = [], foco = 0;
    var fechar = SVG.fechar.replace('<svg ', '<svg aria-hidden="true" ');

    function atualizar() {
      $('[data-env-internos]', d).innerHTML = internos.map(function (x, i) {
        var p = pessoaPorId(x.pessoa) || { id: x.pessoa, nome: '?' };
        return '<span class="ficha">' + O.avatar(p, 'p') + esc(p.nome) + ' · ' + esc(O.papelTxt(x.papel).replace('Pode ', '')) +
          '<button type="button" data-tira-int="' + i + '" aria-label="Tirar ' + esc(p.nome) + '">' + fechar + '</button></span>';
      }).join('');
      $('[data-env-externos]', d).innerHTML = externos.map(function (e, i) {
        return '<span class="ficha ficha--email">' + esc(e) +
          '<button type="button" data-tira-ext="' + i + '" aria-label="Tirar ' + esc(e) + '">' + fechar + '</button></span>';
      }).join('');
      ok.disabled = !internos.length && !externos.length && !EMAIL_OK.test(email.value.trim());
    }
    function mostrarSug() {
      var q = busca.value.trim().toLowerCase();
      var ja = {};
      ja[euId()] = true;
      internos.forEach(function (x) { ja[x.pessoa] = true; });
      lista = (est.pessoas || []).filter(function (p) {
        return !ja[p.id] && (!q || (p.nome + ' ' + p.email).toLowerCase().indexOf(q) > -1);
      }).slice(0, 7);
      if (!lista.length) { sug.innerHTML = '<p class="avisos__vazio" style="padding:1rem">Ninguém encontrado no painel.</p>'; sug.hidden = false; return; }
      foco = Math.min(foco, lista.length - 1);
      sug.innerHTML = lista.map(function (p, i) {
        return '<button type="button" class="sugestao' + (i === foco ? ' is-foco' : '') + '" data-sug="' + i + '">' + O.avatar(p) +
          '<span><strong>' + esc(p.nome) + '</strong><em>' + esc(p.email) + (p.cargo ? ' · ' + esc(p.cargo) : '') + '</em></span></button>';
      }).join('');
      sug.hidden = false;
    }
    function escolher(p) {
      internos.push({ pessoa: p.id, papel: $('[data-env-papel]', d).value });
      busca.value = '';
      sug.hidden = true;
      atualizar();
      busca.focus();
    }
    function addEmails() {
      var partes = email.value.split(/[\s,;]+/).filter(Boolean);
      var ruins = [];
      partes.forEach(function (e) {
        e = e.toLowerCase();
        if (!EMAIL_OK.test(e)) ruins.push(e);
        else if (externos.indexOf(e) < 0) externos.push(e);
      });
      email.value = ruins.join(' ');
      erroEl.textContent = ruins.length ? 'E-mail inválido: ' + ruins.join(', ') : '';
      atualizar();
      return !ruins.length;
    }

    pessoas().then(function () { if (document.activeElement === busca) mostrarSug(); });
    busca.addEventListener('focus', function () { pessoas().then(mostrarSug); });
    busca.addEventListener('input', function () { foco = 0; mostrarSug(); });
    busca.addEventListener('keydown', function (ev) {
      if (ev.key === 'ArrowDown') { ev.preventDefault(); foco = Math.min(foco + 1, lista.length - 1); mostrarSug(); }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); foco = Math.max(foco - 1, 0); mostrarSug(); }
      else if (ev.key === 'Enter') { ev.preventDefault(); if (lista[foco]) escolher(lista[foco]); }
      else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); sug.hidden = true; }
    });
    busca.addEventListener('blur', function () { setTimeout(function () { sug.hidden = true; }, 150); });
    sug.addEventListener('mousedown', function (ev) {
      var b = ev.target.closest('[data-sug]');
      if (b) { ev.preventDefault(); escolher(lista[+b.getAttribute('data-sug')]); }
    });
    email.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' || ev.key === ',' || ev.key === ';' || ev.key === ' ') {
        if (email.value.trim()) { ev.preventDefault(); addEmails(); }
        else if (ev.key === 'Enter') ev.preventDefault();
      } else if (ev.key === 'Backspace' && !email.value && externos.length) {
        externos.pop(); atualizar();
      }
    });
    email.addEventListener('input', atualizar);
    email.addEventListener('blur', function () { if (email.value.trim()) addEmails(); });
    d.addEventListener('click', function (ev) {
      var b;
      if ((b = ev.target.closest('[data-tira-int]'))) { internos.splice(+b.getAttribute('data-tira-int'), 1); atualizar(); }
      else if ((b = ev.target.closest('[data-tira-ext]'))) { externos.splice(+b.getAttribute('data-tira-ext'), 1); atualizar(); }
    });
    $('[data-dlg-cancelar]', d).addEventListener('click', function () { d.close(); });

    $('form', d).addEventListener('submit', function (ev) {
      ev.preventDefault();
      if (email.value.trim() && !addEmails()) return;
      if (!internos.length && !externos.length) { erroEl.textContent = 'Escolha pelo menos uma pessoa do painel ou um e-mail.'; return; }
      ok.disabled = true;
      ok.lastChild.textContent = 'Enviando…';
      erroEl.textContent = '';
      O.api('enviar', { id: it.id, internos: internos, externos: externos, mensagem: $('[data-env-msg]', d).value }).then(function (r) {
        d.close();
        O.toast(resumoEnvio(r));
        if (r.falhas && r.falhas.length) {
          O.toast('Não saiu para: ' + r.falhas.map(function (f) { return f.para; }).join(', ') + '. ' + r.falhas[0].erro, 'erro', null, 12000);
        }
        if (r.internos && r.internos.length) carregar();
      }, function (e) {
        ok.disabled = false;
        ok.lastChild.textContent = 'Enviar';
        var r = e.dados || {};
        if (r.internos && r.internos.length) {
          // as pessoas do painel já receberam; o que falhou foi o e-mail
          internos = [];
          atualizar();
          erroEl.textContent = 'No painel já receberam: ' + r.internos.map(function (p) { return p.nome; }).join(', ') + '. ' + e.message;
        } else {
          erroEl.textContent = e.message;
        }
      });
    });

    d.showModal();
    atualizar();
    busca.focus();
  }
  function resumoEnvio(r) {
    var partes = [];
    if (r.internos && r.internos.length) {
      partes.push(r.internos.map(function (p) { return O.primeiroNome(p.nome); }).join(', ') +
        (r.internos.length > 1 ? ' receberam' : ' recebeu') + ' no painel');
    }
    if (r.externos && r.externos.length) partes.push(r.externos.join(', ') + ' por e-mail');
    return 'Enviado: ' + partes.join('; ') + '.';
  }

  function renomear(it) {
    dialogoNome({
      titulo: 'Renomear', ico: it.tipo === 'pasta' ? 'pasta' : it.extensao, valor: it.nome,
      ext: it.tipo === 'pasta' ? '' : it.extensao, botao: 'Renomear'
    }).then(function (nome) {
      if (!nome || nome === it.nome) return;
      return O.api('renomear', { tipo: it.tipo, id: it.id, nome: nome }).then(function (novo) {
        trocarItem(novo);
        O.toast('Renomeado para “' + nome + '”.');
      });
    }).catch(erroToast);
  }

  function lixeira(it) {
    O.api('lixeira', { tipo: it.tipo, id: it.id }).then(function () {
      tirarItem(it.id);
      atualizarEu();
      O.toast((it.tipo === 'pasta' ? 'A pasta “' + it.nome + '” e tudo o que está dentro foram' : '“' + nomeCompleto(it) + '” foi') +
        ' para a lixeira. Fica lá ' + diasTxt(lixeiraDias()) + '.', null, { texto: 'Desfazer', fn: function () { restaurar(it, true); } }, 8000);
    }, erroToast);
  }

  function restaurar(it, desfazer) {
    O.api('lixeira', { tipo: it.tipo, id: it.id, restaurar: true }).then(function (novo) {
      if (est.visao === 'lixeira') tirarItem(it.id); else inserirItem(novo);
      atualizarEu();
      var onde = (novo.tipo === 'pasta' ? novo.pai : novo.pasta) ? 'para a pasta de origem' : 'para Meus arquivos';
      O.toast(desfazer ? 'Desfeito.' : '“' + nomeCompleto(novo) + '” voltou ' + onde + '.');
    }, erroToast);
  }

  function pastaParaCriar() {
    return est.visao === 'pasta' && est.pastaInfo && O.pode(est.pastaInfo.papel, 'editar') ? est.pasta : null;
  }
  function avisarOndeFoi(it) {
    if (!inserirItem(it)) {
      O.toast('“' + nomeCompleto(it) + '” foi criado em Meus arquivos.', null,
        { texto: 'Ver', fn: function () { irPara({ visao: 'meus' }); } });
    }
  }

  function novaPasta() {
    dialogoNome({ titulo: 'Nova pasta', ico: 'pasta', valor: 'Nova pasta', botao: 'Criar' }).then(function (nome) {
      if (!nome) return;
      return O.api('pasta_criar', { pai: pastaParaCriar(), nome: nome }).then(avisarOndeFoi);
    }).catch(erroToast);
  }

  // documento, planilha ou apresentação: em branco ou de um modelo da Lube
  function criarDe(caminho, nome, ext, origemArq, janela, extraUrl) {
    var t = O.toast('Criando “' + nome + '.' + ext + '”…', 'info', null, 0);
    return O.baixarModelo(caminho).then(function (blob) {
      return O.enviarArquivo(blob, { pasta: pastaParaCriar(), nome: nome, extensao: ext, origem: origemArq });
    }).then(function (it) {
      t.fechar();
      avisarOndeFoi(it);
      atualizarEu();
      if (janela && !janela.closed) janela.location.replace(urlEditor(it) + (extraUrl || ''));
      // a janela foi barrada (bloqueador de pop-up): o botão abre o editor levando o pedido da IA junto
      else O.toast('“' + nomeCompleto(it) + '” criado.', null, {
        texto: 'Abrir', fn: function () { window.open(urlEditor(it) + (extraUrl || ''), '_blank', 'noopener'); decolar(it); }
      }, extraUrl ? 0 : 5000);
    }, function (e) {
      t.fechar();
      try { if (janela) janela.close(); } catch (x) {}
      erroToast(e);
    });
  }

  /* ---------- enviar do computador ---------- */
  function enviarLista(lista) {
    var arr = Array.prototype.slice.call(lista || []);
    if (!arr.length) return;
    var pasta = pastaParaCriar();
    var recusados = [];
    var fila = arr.filter(function (f) {
      var ext = extDe(f.name);
      if (O.ACEITOS.indexOf(ext) < 0) { recusados.push(f.name); return false; }
      if (f.size > 100 * 1024 * 1024) { recusados.push(f.name + ' (passa de 100 MB)'); return false; }
      return true;
    });
    if (recusados.length) {
      O.toast('Não enviado' + (recusados.length > 1 ? 's' : '') + ': ' + recusados.join(', ') +
        '. Aceitos: Word, Excel, PowerPoint, PDF, OpenDocument, CSV e TXT.', 'erro', null, 12000);
    }
    if (!fila.length) return;
    var t = O.toast('Enviando…', 'info', null, 0);
    var ok = 0, i = 0;
    (function proximo() {
      if (i >= fila.length) {
        t.fechar();
        atualizarEu();
        if (ok) O.toast(ok + (ok > 1 ? ' arquivos enviados' : ' arquivo enviado') + (pasta ? ' para esta pasta.' : ' para Meus arquivos.'));
        return;
      }
      var f = fila[i++];
      t.texto('Enviando ' + i + ' de ' + fila.length + ': ' + f.name);
      O.enviarArquivo(f, { pasta: pasta, nome: semExt(f.name), extensao: extDe(f.name), origem: 'envio' })
        .then(function (it) { ok++; inserirItem(it); },
              function (e) { O.toast('“' + f.name + '”: ' + e.message, 'erro', null, 10000); })
        .then(proximo);
    })();
  }

  /* ---------- diálogos ---------- */
  function dialogoNome(o) {
    var d = $('[data-dialogo]');
    d.className = 'dialogo';
    d.innerHTML = '<form method="dialog" novalidate>' +
      '<div class="dialogo__topo">' + O.icone(o.ico || 'docx') + '<h2>' + esc(o.titulo) + '</h2></div>' +
      (o.texto ? '<p>' + esc(o.texto) + '</p>' : '') +
      '<label class="campo"><input type="text" name="nome" maxlength="160" autocomplete="off" spellcheck="false" aria-label="Nome">' +
      (o.ext ? '<span class="ext">.' + esc(o.ext) + '</span>' : '') + '</label>' +
      '<p class="dialogo__erro" data-dlg-erro></p>' +
      '<div class="dialogo__acoes"><button class="btn" type="button" data-dlg-cancelar>Cancelar</button>' +
      '<button class="btn btn--prim" type="submit">' + esc(o.botao || 'OK') + '</button></div></form>';
    var campo = $('input', d);
    campo.value = o.valor || '';
    return new Promise(function (ok) {
      var form = $('form', d);
      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var v = campo.value.replace(/[\u0000-\u001f]/g, '').trim();
        if (!v) { $('[data-dlg-erro]', d).textContent = 'Dê um nome.'; campo.focus(); return; }
        if (/[\\/:*?"<>|]/.test(v)) { $('[data-dlg-erro]', d).textContent = 'O nome não pode ter \\ / : * ? " < > |'; campo.focus(); return; }
        var extra = o.aoConfirmar ? o.aoConfirmar(v) : null;   // ainda dentro do clique (janela nova)
        d.close();
        ok(v);
        if (o.depois) o.depois(v, extra);
      });
      $('[data-dlg-cancelar]', d).addEventListener('click', function () { d.close(); ok(null); });
      d.addEventListener('cancel', function () { ok(null); }, { once: true });
      d.showModal();
      campo.focus();
      campo.select();
    });
  }

  // escolher a pasta de destino
  function mover(it) {
    var d = $('[data-dialogo]');
    d.className = 'dialogo';
    var atual = null, trilha = [];
    function desenhar(itens) {
      var pastas = itens.filter(function (x) { return x.tipo === 'pasta' && x.id !== it.id && O.pode(x.papel, 'editar'); });
      var lugarAtual = it.tipo === 'pasta' ? it.pai : it.pasta;
      d.innerHTML = '<form method="dialog">' +
        '<div class="dialogo__topo">' + O.icone(it.tipo === 'pasta' ? 'pasta' : it.extensao) +
        '<h2>Mover “' + esc(nomeCompleto(it)) + '”</h2></div>' +
        '<nav class="trilha" style="font-size:.8rem">' +
          '<a href="#" data-mv-raiz style="font-size:.95rem">Meus arquivos</a>' +
          trilha.map(function (t) { return SVG.seta + '<a href="#" data-mv-ir="' + esc(t.id) + '" style="font-size:.95rem">' + esc(t.nome) + '</a>'; }).join('') +
        '</nav>' +
        '<div class="pastas-escolha">' + (pastas.length ? pastas.map(function (p) {
          return '<button type="button" data-mv-pasta="' + esc(p.id) + '" data-mv-nome="' + esc(p.nome) + '">' + O.icone('pasta') + esc(p.nome) + '</button>';
        }).join('') : '<p class="pastas-escolha__vazio">Nenhuma pasta aqui.</p>') + '</div>' +
        '<p class="dialogo__erro" data-dlg-erro></p>' +
        '<div class="dialogo__acoes"><button class="btn" type="button" data-dlg-cancelar>Cancelar</button>' +
        '<button class="btn btn--prim" type="submit"' + (atual === (lugarAtual || null) ? ' disabled' : '') + '>Mover para cá</button></div></form>';
      $('[data-dlg-cancelar]', d).addEventListener('click', function () { d.close(); });
      $('[data-mv-raiz]', d).addEventListener('click', function (ev) { ev.preventDefault(); trilha = []; ir(null); });
      $$('[data-mv-ir]', d).forEach(function (a) {
        a.addEventListener('click', function (ev) {
          ev.preventDefault();
          var id = a.getAttribute('data-mv-ir');
          trilha = trilha.slice(0, trilha.findIndex(function (t) { return t.id === id; }) + 1);
          ir(id);
        });
      });
      $$('[data-mv-pasta]', d).forEach(function (b) {
        b.addEventListener('click', function () {
          trilha.push({ id: b.getAttribute('data-mv-pasta'), nome: b.getAttribute('data-mv-nome') });
          ir(b.getAttribute('data-mv-pasta'));
        });
      });
      $('form', d).addEventListener('submit', function (ev) {
        ev.preventDefault();
        O.api('mover', { tipo: it.tipo, id: it.id, destino: atual }).then(function (novo) {
          d.close();
          if (!aquiMesmo(novo)) tirarItem(it.id); else trocarItem(novo);
          O.toast('Movido para ' + (trilha.length ? '“' + trilha[trilha.length - 1].nome + '”' : 'Meus arquivos') + '.');
        }, function (e) { $('[data-dlg-erro]', d).textContent = e.message; });
      });
    }
    function ir(id) {
      atual = id;
      O.api('listar', id ? { pasta: id } : { visao: 'meus' }).then(function (r) { desenhar(r.itens || []); },
        function (e) { $('[data-dlg-erro]', d) && ($('[data-dlg-erro]', d).textContent = e.message); });
    }
    d.innerHTML = '<form method="dialog"><p>Carregando pastas…</p></form>';
    d.showModal();
    ir(null);
  }

  /* ---------- gaveta: acesso, versões e atividade ---------- */
  function abrirGaveta() {
    $('[data-veu]').hidden = false;
    $('[data-gaveta]').hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function fecharGaveta() {
    $('[data-veu]').hidden = true;
    $('[data-gaveta]').hidden = true;
    document.body.style.overflow = '';
    est.gav = null;
    fecharLateral();
  }
  function gaveta(it, aba) {
    est.gav = { it: it, aba: aba, acessos: null, versoes: null };
    var g = $('[data-gaveta]');
    var abas = [['acesso', 'Acesso']];
    if (it.tipo === 'arquivo') abas.push(['versoes', 'Versões'], ['atividade', 'Atividade']);
    g.innerHTML = '<div class="gaveta__topo">' + O.icone(it.tipo === 'pasta' ? 'pasta' : it.extensao) +
      '<div class="gaveta__titulo"><span class="mono">' + esc(O.nomeTipo(it.tipo === 'pasta' ? 'pasta' : it.extensao)) + '</span>' +
      '<h2>' + esc(it.extensao ? nomeCompleto(it) : it.nome) + '</h2></div>' +
      '<button class="fechar" type="button" data-gav-fechar aria-label="Fechar">' + SVG.fechar + '</button></div>' +
      '<div class="gaveta__abas" role="tablist">' + abas.map(function (a) {
        return '<button type="button" role="tab" data-gav-aba="' + a[0] + '" aria-selected="' + (a[0] === aba) + '">' + a[1] + '</button>';
      }).join('') + '</div>' +
      '<div class="gaveta__corpo" data-gav-corpo></div>' +
      '<div class="gaveta__pe">' + (it.tipo === 'arquivo'
        ? '<button class="btn" type="button" data-gav-link>' + SVG.link + 'Copiar link</button>' +
          (it.papel == null || O.pode(it.papel, 'editar') ? '<button class="btn" type="button" data-gav-enviar>' + SVG.enviar + 'Enviar</button>' : '') +
          '<button class="btn btn--azul" type="button" data-gav-abrir>' + SVG.abrir + 'Abrir</button>'
        : '<button class="btn btn--azul" type="button" data-gav-abrir>' + SVG.pasta + 'Abrir pasta</button>') + '</div>';
    abrirGaveta();
    $('[data-gav-fechar]', g).focus();
    renderAba();
  }
  function renderAba() {
    var g = est.gav;
    if (!g) return;
    $$('[data-gav-aba]').forEach(function (b) { b.setAttribute('aria-selected', String(b.getAttribute('data-gav-aba') === g.aba)); });
    var corpo = $('[data-gav-corpo]');
    corpo.innerHTML = '<div class="esq"><i></i><i style="width:50%"></i></div><div class="esq"><i></i><i style="width:35%"></i></div>';
    if (g.aba === 'acesso') {
      Promise.all([O.api('acessos', { tipo: g.it.tipo, id: g.it.id }), pessoas()]).then(function (rs) {
        if (est.gav !== g) return;
        g.acessos = rs[0];
        desenharAcesso();
      }, function (e) { corpo.innerHTML = '<p class="herdado">' + esc(e.message) + '</p>'; });
    } else {
      (g.versoes ? Promise.resolve(g.versoes) : O.api('versoes', { id: g.it.id })).then(function (r) {
        if (est.gav !== g) return;
        g.versoes = r;
        if (g.aba === 'versoes') desenharVersoes(); else desenharAtividade();
      }, function (e) { corpo.innerHTML = '<p class="herdado">' + esc(e.message) + '</p>'; });
    }
  }

  function pessoas() {
    if (est.pessoas) return Promise.resolve(est.pessoas);
    return O.api('pessoas', {}).then(function (l) { est.pessoas = l || []; return est.pessoas; });
  }
  function pessoaPorId(id) {
    var l = est.pessoas || [];
    for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i];
    return null;
  }

  function seletorPapel(atual, attrs, comDono) {
    var ops = [['editar', 'Pode editar'], ['comentar', 'Pode comentar'], ['ver', 'Pode ver']];
    return '<select class="papel-sel" ' + attrs + '>' + ops.map(function (o) {
      return '<option value="' + o[0] + '"' + (o[0] === atual ? ' selected' : '') + '>' + o[1] + '</option>';
    }).join('') + (comDono ? '<option value="">Tirar acesso</option>' : '') + '</select>';
  }

  function desenharAcesso() {
    var g = est.gav, a = g.acessos;
    var podeComp = O.pode(a.meu_papel, 'compartilhar');
    var todos = null;
    var diretos = (a.diretos || []).filter(function (d) { if (d.todos) { todos = d; return false; } return true; });
    var h = '';
    if (podeComp) {
      h += '<div class="adicionar"><span class="mono rotulo">Adicionar pessoas do painel</span>' +
        '<div class="adicionar__campo">' + SVG.busca +
        '<input type="text" data-add-busca placeholder="Nome ou e-mail" autocomplete="off" spellcheck="false" aria-label="Buscar pessoa">' +
        seletorPapel('editar', 'data-add-papel aria-label="Papel de quem entra"') + '</div>' +
        '<div class="sugestoes suspenso" data-sugestoes hidden></div></div>';
    }
    h += '<div class="todos">' + O.avatarTodos('g') +
      '<div class="todos__txt"><strong>Todos da Lube</strong><span>' +
      (todos ? 'Qualquer pessoa com login no painel ' + esc(O.papelTxt(todos.papel).toLowerCase()) + '.' : 'Só quem está na lista abaixo abre.') +
      '</span></div>' +
      (podeComp ? (todos ? seletorPapel(todos.papel, 'data-todos-papel aria-label="Papel de todos"') : '') +
        '<label class="chave" title="Compartilhar com todos da Lube"><input type="checkbox" data-todos' + (todos ? ' checked' : '') +
        '><i></i></label>' : '') + '</div>';

    h += '<div><span class="mono rotulo">Pessoas com acesso</span><div class="pessoas">';
    if (a.dono) {
      h += '<div class="pessoa">' + O.avatar(a.dono) + '<div class="pessoa__txt"><strong>' + esc(nomeDe(a.dono)) + '</strong><em>' +
        esc(a.dono.email) + '</em></div><span class="pessoa__papel">Dono</span></div>';
    }
    diretos.forEach(function (d) {
      var p = d.pessoa;
      h += '<div class="pessoa">' + O.avatar(p) + '<div class="pessoa__txt"><strong>' + esc(nomeDe(p)) + '</strong><em>' + esc(p.email) + '</em></div>' +
        (podeComp ? seletorPapel(d.papel, 'data-papel-de="' + esc(p.id) + '" aria-label="Papel de ' + esc(p.nome) + '"', true)
                  : '<span class="pessoa__papel">' + esc(O.papelTxt(d.papel)) + '</span>') + '</div>';
    });
    (a.herdados || []).forEach(function (d) {
      h += '<div class="pessoa">' + (d.todos ? O.avatarTodos() : O.avatar(d.pessoa)) + '<div class="pessoa__txt"><strong>' +
        esc(d.todos ? 'Todos da Lube' : nomeDe(d.pessoa)) + '</strong><em class="herdado">pela pasta “' + esc(d.pasta.nome) + '”</em></div>' +
        '<span class="pessoa__papel">' + esc(O.papelTxt(d.papel)) + '</span></div>';
    });
    if (!diretos.length && !(a.herdados || []).length) {
      h += '<p class="herdado" style="padding:.4rem .25rem">Ninguém mais tem acesso' + (todos ? ' pela lista' : '') + '.</p>';
    }
    h += '</div></div>';
    if (!podeComp) {
      h += '<p class="herdado">Você ' + esc(O.papelTxt(a.meu_papel).toLowerCase()) +
        '. Só quem pode editar compartilha; peça ao dono' + (a.dono ? ', ' + esc(a.dono.nome) : '') + '.</p>';
    }
    $('[data-gav-corpo]').innerHTML = h;
    ligarAcesso(diretos, a);
  }

  function compartilhar(pessoa, papel, nomeTxt) {
    var g = est.gav;
    return O.api('compartilhar', { tipo: g.it.tipo, id: g.it.id, pessoa: pessoa, papel: papel }).then(function (r) {
      if (est.gav !== g) return;
      g.acessos = r;
      g.versoes = null;   // a atividade ganhou uma linha nova
      desenharAcesso();
      atualizarCompartilhadoNaLista(g.it.id, r);
      if (nomeTxt) O.toast(nomeTxt);
    }, erroToast);
  }
  function atualizarCompartilhadoNaLista(id, acessos) {
    var it = itemPorId(id);
    if (!it) return;
    var pessoasL = [], todos = false;
    (acessos.diretos || []).forEach(function (d) { if (d.todos) todos = true; else pessoasL.push(d.pessoa); });
    it.compartilhado = { total: pessoasL.length + (todos ? 1 : 0), todos: todos, pessoas: pessoasL };
    renderLista();
  }

  function ligarAcesso(diretos, a) {
    var corpo = $('[data-gav-corpo]');
    var busca = $('[data-add-busca]', corpo);
    var sug = $('[data-sugestoes]', corpo);
    if (busca) {
      var ja = {};
      if (a.dono) ja[a.dono.id] = true;
      diretos.forEach(function (d) { ja[d.pessoa.id] = true; });
      var foco = 0, lista = [];
      var mostrar = function () {
        var q = busca.value.trim().toLowerCase();
        lista = (est.pessoas || []).filter(function (p) {
          return !ja[p.id] && (!q || (p.nome + ' ' + p.email).toLowerCase().indexOf(q) > -1);
        }).slice(0, 8);
        if (!lista.length) { sug.innerHTML = '<p class="avisos__vazio" style="padding:1rem">Ninguém encontrado no painel.</p>'; sug.hidden = false; return; }
        foco = Math.min(foco, lista.length - 1);
        sug.innerHTML = lista.map(function (p, i) {
          return '<button type="button" class="sugestao' + (i === foco ? ' is-foco' : '') + '" data-sug="' + i + '">' + O.avatar(p) +
            '<span><strong>' + esc(p.nome) + '</strong><em>' + esc(p.email) + (p.cargo ? ' · ' + esc(p.cargo) : '') + '</em></span></button>';
        }).join('');
        sug.hidden = false;
      };
      var escolher = function (p) {
        var papel = $('[data-add-papel]', corpo).value;
        sug.hidden = true;
        busca.value = '';
        compartilhar(p.id, papel, 'Compartilhado com ' + p.nome + ' (' + O.papelTxt(papel).toLowerCase() + '). O aviso aparece no sino do painel.');
      };
      busca.addEventListener('focus', mostrar);
      busca.addEventListener('input', function () { foco = 0; mostrar(); });
      busca.addEventListener('keydown', function (ev) {
        if (ev.key === 'ArrowDown') { ev.preventDefault(); foco = Math.min(foco + 1, lista.length - 1); mostrar(); }
        else if (ev.key === 'ArrowUp') { ev.preventDefault(); foco = Math.max(foco - 1, 0); mostrar(); }
        else if (ev.key === 'Enter' && lista[foco]) { ev.preventDefault(); escolher(lista[foco]); }
        else if (ev.key === 'Escape') { ev.stopPropagation(); sug.hidden = true; }
      });
      sug.addEventListener('mousedown', function (ev) {
        var b = ev.target.closest('[data-sug]');
        if (b) { ev.preventDefault(); escolher(lista[+b.getAttribute('data-sug')]); }
      });
      busca.addEventListener('blur', function () { setTimeout(function () { sug.hidden = true; }, 150); });
    }
    var chave = $('[data-todos]', corpo);
    if (chave) chave.addEventListener('change', function () {
      compartilhar(null, chave.checked ? 'ver' : null,
        chave.checked ? 'Todos da Lube podem ver.' : 'Tirado o acesso de todos da Lube.');
    });
    var tp = $('[data-todos-papel]', corpo);
    if (tp) tp.addEventListener('change', function () { compartilhar(null, tp.value, 'Todos da Lube: ' + O.papelTxt(tp.value).toLowerCase() + '.'); });
    $$('[data-papel-de]', corpo).forEach(function (s) {
      s.addEventListener('change', function () {
        var p = pessoaPorId(s.getAttribute('data-papel-de'));
        var nome = p ? p.nome : 'a pessoa';
        compartilhar(s.getAttribute('data-papel-de'), s.value || null,
          s.value ? nome + ': ' + O.papelTxt(s.value).toLowerCase() + '.' : 'Tirado o acesso de ' + nome + '.');
      });
    });
  }

  var ORIGEM_TXT = { novo: 'criado em branco', modelo: 'criado de um modelo', envio: 'enviado do computador',
    editor: 'salvo pelo editor', forcada: 'salvo pelo editor', restaurada: 'versão antiga restaurada' };
  function desenharVersoes() {
    var g = est.gav, vs = g.versoes.versoes || [];
    var podeRest = O.pode(g.it.papel, 'editar');
    var h = '<div class="versoes">' + vs.map(function (v, i) {
      var autores = (v.autores || []).map(function (p) { return esc(nomeDe(p)); }).join(', ') || '—';
      return '<div class="versao' + (i === 0 ? ' is-atual' : '') + '"><span class="versao__n">v' + v.numero + '</span>' +
        '<div class="versao__txt"><strong>' + (i === 0 ? 'Versão atual · ' : '') + esc(O.dataCompleta(v.criado_em)) + '</strong>' +
        '<em>' + autores + ' · ' + esc(ORIGEM_TXT[v.origem] || v.origem) + ' · ' + O.bytes(v.tamanho) + '</em></div>' +
        '<div class="versao__acoes">' +
        (i > 0 && podeRest ? '<button class="mini" type="button" data-v-rest="' + v.numero + '" title="Voltar para esta versão">Restaurar</button>' : '') +
        '</div></div>';
    }).join('') + '</div>';
    h += '<p class="herdado">Cada vez que todos fecham o arquivo depois de mexer, o editor guarda uma versão nova. Nenhuma versão é apagada.</p>';
    var corpo = $('[data-gav-corpo]');
    corpo.innerHTML = h;
    $$('[data-v-rest]', corpo).forEach(function (b) {
      b.addEventListener('click', function () {
        var n = +b.getAttribute('data-v-rest');
        O.api('versao_restaurar', { id: g.it.id, numero: n }).then(function (novo) {
          trocarItem(novo);
          g.it = novo;
          g.versoes = null;
          O.toast('A versão ' + n + ' voltou como versão ' + novo.versao + '. A anterior continua no histórico.');
          renderAba();
        }, erroToast);
      });
    });
  }

  function textoAtividade(t) {
    var d = t.detalhe || {};
    var quem = function (id) { if (!id) return 'todos da Lube'; var p = pessoaPorId(id); return p ? (p.id === euId() ? 'você' : p.nome) : 'uma pessoa'; };
    switch (t.acao) {
      case 'criou': return d.origem === 'envio' ? 'enviou do computador' : d.origem === 'modelo' ? 'criou a partir de um modelo da Lube' : 'criou o arquivo';
      case 'abriu': return 'abriu';
      case 'editou': return 'editou e salvou a versão ' + (d.versao || '');
      case 'renomeou': return 'renomeou de “' + (d.de || '') + '” para “' + (d.para || '') + '”';
      case 'moveu': return 'mudou de pasta';
      case 'lixeira': return 'mandou para a lixeira';
      case 'restaurou': return 'tirou da lixeira';
      case 'compartilhou': return 'deu acesso a ' + quem(d.pessoa) + ' (' + O.papelTxt(d.papel).toLowerCase() + ')';
      case 'tirou_acesso': return 'tirou o acesso de ' + quem(d.pessoa);
      case 'baixou': return 'baixou a versão ' + (d.versao || '');
      case 'versao_restaurada': return 'voltou para a versão ' + d.de + ' (virou a ' + d.nova + ')';
      case 'mencionou': return 'mencionou ' + (d.avisados || 0) + (d.avisados === 1 ? ' pessoa' : ' pessoas') + ' num comentário';
      case 'enviou': {
        var n = (d.internos || []).length;
        return 'enviou para ' + ((d.internos || []).map(function (p) { return p.nome; }).join(', ') || n + ' pessoa(s)') + ' no painel';
      }
      case 'enviou_email': return 'enviou por e-mail para ' + (d.externos || []).join(', ');
      case 'email_falhou': return 'tentou enviar por e-mail para ' + (d.externos || []).join(', ') + ', e não saiu' + (d.erro ? ' (' + d.erro + ')' : '');
      case 'ia': return 'usou a IA da Lube' + (d.fonte ? ' a partir de “' + d.fonte.nome + '.' + d.fonte.extensao + '”' : '') +
        (d.pedido ? ': “' + d.pedido + (d.pedido.length >= 200 ? '…' : '') + '”' : '') +
        (d.imagens ? ' (' + d.imagens + (d.imagens > 1 ? ' imagens' : ' imagem') + ')' : '');
      default: return t.acao;
    }
  }
  function desenharAtividade() {
    var at = (est.gav.versoes.atividades || []);
    var h = at.length ? at.map(function (t) {
      return '<div class="passo">' + (t.pessoa ? O.avatar(t.pessoa, 'p') : '<span class="av av--p">?</span>') +
        '<div><strong>' + esc(nomeDe(t.pessoa)) + '</strong> ' + esc(textoAtividade(t)) +
        '<em>' + esc(O.dataCompleta(t.em)) + '</em></div></div>';
    }).join('') : '<p class="herdado">Nada registrado ainda.</p>';
    $('[data-gav-corpo]').innerHTML = '<div class="ativ">' + h + '</div>';
  }

  /* ---------- avisos (sino) ---------- */
  function carregarAvisos() {
    return O.api('avisos', { limite: 30 }).then(function (r) { est.avisos = r; desenharSino(); }, function () {});
  }
  function desenharSino() {
    var r = est.avisos || { nao_lidos: 0, avisos: [] };
    var n = $('[data-sino-n]');
    n.hidden = !r.nao_lidos;
    n.textContent = r.nao_lidos > 99 ? '99+' : r.nao_lidos;
    $('[data-sino]').setAttribute('aria-label', r.nao_lidos ? r.nao_lidos + ' avisos novos' : 'Avisos');
    var lista = $('[data-avisos-lista]');
    if (!r.avisos.length) {
      lista.innerHTML = '<p class="avisos__vazio">Nenhum aviso.<br>Quando alguém mencionar você num comentário ou compartilhar algo, aparece aqui.</p>';
      return;
    }
    lista.innerHTML = r.avisos.map(function (v) {
      var alvo = v.arquivo ? v.arquivo.nome + '.' + v.arquivo.extensao : v.pasta ? v.pasta.nome : 'um item';
      var de = v.de ? v.de.nome : 'Alguém';
      var recado = v.mensagem ? '<span class="aviso__msg">“' + esc(v.mensagem) + '”</span>' : '';
      var txt = v.tipo === 'mencao'
        ? '<span><strong>' + esc(de) + '</strong> mencionou você em <strong>' + esc(alvo) + '</strong></span>' + recado
        : v.tipo === 'enviou'
        ? '<span><strong>' + esc(de) + '</strong> enviou <strong>' + esc(alvo) + '</strong> para você</span>' + recado
        : '<span><strong>' + esc(de) + '</strong> compartilhou <strong>' + esc(alvo) + '</strong> com você · ' +
          esc(O.papelTxt(v.mensagem).toLowerCase()) + '</span>';
      return '<button type="button" class="aviso' + (v.lido_em ? '' : ' aviso--novo') + '" data-aviso="' + esc(v.id) + '">' +
        O.avatar(v.de) + '<span class="aviso__txt">' + txt + '<span class="aviso__quando">' + esc(O.quando(v.criado_em)) + '</span></span></button>';
    }).join('');
  }
  function abrirAviso(id) {
    var v = (est.avisos.avisos || []).filter(function (x) { return x.id === id; })[0];
    if (!v) return;
    if (!v.lido_em) {
      v.lido_em = new Date().toISOString();
      est.avisos.nao_lidos = Math.max(0, est.avisos.nao_lidos - 1);
      desenharSino();
      O.api('avisos_lidos', { ids: [id] }).catch(function () {});
    }
    fecharMenus();
    if (v.arquivo) window.open(urlEditor({ id: v.arquivo.id, nome: v.arquivo.nome, extensao: v.arquivo.extensao }), '_blank', 'noopener');
    else if (v.pasta) { gravarSessao('office_origem', 'compartilhados'); irPara({ pasta: v.pasta.id }); }
  }

  /* ---------- conta e espaço ---------- */
  function atualizarEu() {
    return O.api('eu', {}).then(function (r) { est.eu = r; desenharEu(); });
  }
  function desenharEu() {
    var p = est.eu.pessoa;
    $('[data-eu-nome]').textContent = p.nome;
    var av = $('[data-eu-av]');
    av.textContent = O.iniciais(p.nome);
    av.style.setProperty('--c', O.corPessoa(p.id));
    $('[data-primeiro-nome]').textContent = O.primeiroNome(p.nome);
    var hr = new Date().getHours();
    $('[data-saudacao]').textContent = hr < 12 ? 'Bom dia' : hr < 18 ? 'Boa tarde' : 'Boa noite';
    var u = est.eu.uso || { arquivos: 0, bytes: 0 };
    var usoEl = $('[data-uso-arquivos]');
    if (!usoEl.getAttribute('data-contou')) { usoEl.setAttribute('data-contou', '1'); contar(usoEl, u.arquivos, u.arquivos === 1 ? ' arquivo' : ' arquivos'); }
    else usoEl.textContent = u.arquivos + (u.arquivos === 1 ? ' arquivo' : ' arquivos');
    desenharIa();
    $('[data-uso-bytes]').textContent = O.bytes(u.bytes) + ' usados';
    var m = $('[data-motor]');
    var sit = est.eu.motor_situacao || (est.eu.motor ? 'ligado' : 'nao_instalado');
    m.classList.toggle('is-ok', sit === 'ligado');
    m.classList.toggle('is-fora', sit === 'fora');
    $('[data-motor-txt]').textContent = sit === 'ligado'
      ? 'Editor no ar: Word, Excel e PowerPoint abrem aqui dentro, juntos.'
      : sit === 'fora'
      ? 'Editor fora do ar: o servidor da Lube não responde desde ' + O.quando(est.eu.motor_visto_em) + '.'
      : 'Editor sendo ligado no servidor da Lube. O Drive já funciona.';
  }

  function bloquear(titulo, texto, botao) {
    $('[data-bloqueio-titulo]').textContent = titulo;
    $('[data-bloqueio-texto]').textContent = texto;
    var b = $('[data-bloqueio-botao]');
    if (botao) { b.textContent = botao.texto; b.setAttribute('href', botao.href); }
    $('[data-bloqueio]').hidden = false;
    document.body.classList.remove('carregando');
  }

  /* ---------- lateral no celular ---------- */
  function fecharLateral() {
    var l = $('[data-lateral]');
    if (l.classList.contains('is-on')) {
      l.classList.remove('is-on');
      if (!est.gav) $('[data-veu]').hidden = true;
    }
  }

  /* ---------- eventos ---------- */
  function ligar() {
    document.addEventListener('click', function (ev) {
      var t = ev.target;
      var el;
      if ((el = t.closest('[data-criar]'))) {
        ev.preventDefault(); fecharMenus();
        var ext = el.getAttribute('data-criar');
        if (ext === 'pasta') novaPasta(); else pedirCriar(ext);
        return;
      }
      if (t.closest('[data-ia-criar]')) { ev.preventDefault(); fecharMenus(); dialogoIa({}); return; }
      if ((el = t.closest('[data-modelo]'))) {
        var m = O.MODELOS.filter(function (x) { return x.id === el.getAttribute('data-modelo'); })[0];
        if (m) pedirCriar(m.ext, m);
        return;
      }
      if (t.closest('[data-enviar]')) { fecharMenus(); $('[data-arquivo-input]').click(); return; }
      if (t.closest('[data-nova-pasta]')) { novaPasta(); return; }
      if ((el = t.closest('[data-ir-visao]'))) { ev.preventDefault(); fecharMenus(); irPara({ visao: el.getAttribute('data-ir-visao') }); return; }
      if ((el = t.closest('[data-ir-pasta]'))) { ev.preventDefault(); irPara({ pasta: el.getAttribute('data-ir-pasta') }); return; }
      if ((el = t.closest('[data-visao]'))) {
        if (ev.ctrlKey || ev.metaKey || ev.shiftKey) return;
        ev.preventDefault(); irPara({ visao: el.getAttribute('data-visao') }); return;
      }
      if ((el = t.closest('[data-formato]'))) {
        est.formato = el.getAttribute('data-formato'); gravarLocal('office_formato', est.formato); render(); return;
      }
      if (t.closest('[data-recarregar]')) { carregar(); return; }

      // lista
      var lin = t.closest('.linha[data-item]');
      if (lin) {
        var it = itemPorId(lin.getAttribute('data-item'));
        if (!it) return;
        if ((el = t.closest('[data-mais]'))) {
          var r = el.getBoundingClientRect();
          if (menuAberto === it) { fecharMenus(); return; }
          abrirMenuItem(it, r.right, r.bottom, el);
          return;
        }
        if (t.closest('[data-abrir]')) { abrirItem(it); return; }
      }
      if ((el = t.closest('[data-menu-item] [data-acao]'))) { if (menuAberto) executar(el.getAttribute('data-acao'), menuAberto); return; }

      // novo, conta e avisos
      if ((el = t.closest('[data-novo]'))) { alternar('[data-menu-novo]', el); return; }
      if ((el = t.closest('[data-eu]'))) { alternar('[data-menu-eu]', el); return; }
      if ((el = t.closest('[data-sino]'))) { alternar('[data-avisos]', el); if (!$('[data-avisos]').hidden) carregarAvisos(); return; }
      if ((el = t.closest('[data-aviso]'))) { abrirAviso(el.getAttribute('data-aviso')); return; }
      if (t.closest('[data-avisos-lidos]')) {
        O.api('avisos_lidos', { ids: null }).then(carregarAvisos, erroToast); return;
      }
      if (t.closest('[data-sair]')) { O.sair(); return; }

      // gaveta
      if (t.closest('[data-gav-fechar]') || t.closest('[data-veu]')) { fecharGaveta(); return; }
      if ((el = t.closest('[data-gav-aba]')) && est.gav) { est.gav.aba = el.getAttribute('data-gav-aba'); renderAba(); return; }
      if (t.closest('[data-gav-abrir]') && est.gav) { var g = est.gav.it; fecharGaveta(); abrirItem(g); return; }
      if (t.closest('[data-gav-enviar]') && est.gav) { dialogoEnviar(est.gav.it); return; }
      if (t.closest('[data-gav-link]') && est.gav) {
        var link = location.origin + location.pathname.replace(/[^/]*$/, '') + 'editor.html?id=' + est.gav.it.id;
        (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).then(function () {
          O.toast('Link copiado. Só abre para quem tem acesso.');
        }, function () { O.toast(link, 'info', null, 12000); });
        return;
      }
      if (t.closest('[data-abrir-lateral]')) {
        $('[data-lateral]').classList.add('is-on'); $('[data-veu]').hidden = false; return;
      }

      // clique fora fecha os menus
      if (!t.closest('.suspenso')) fecharMenus();
    });

    // botão direito numa linha abre o menu dela
    $('[data-tabela]').addEventListener('contextmenu', function (ev) {
      var lin = ev.target.closest('.linha[data-item]');
      if (!lin) return;
      var it = itemPorId(lin.getAttribute('data-item'));
      if (!it) return;
      ev.preventDefault();
      abrirMenuItem(it, ev.clientX + 220, ev.clientY);
    });

    // busca (espera parar de digitar)
    var busca = $('[data-busca]'), tBusca = null;
    busca.addEventListener('input', function () {
      $('[data-busca-limpar]').hidden = !busca.value;
      clearTimeout(tBusca);
      tBusca = setTimeout(function () {
        var q = busca.value.trim();
        if (q) irPara({ visao: 'busca', q: q }, est.visao === 'busca');
        else if (est.visao === 'busca') irPara({ visao: 'meus' });
      }, 320);
    });
    busca.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') { busca.value = ''; busca.blur(); if (est.visao === 'busca') irPara({ visao: 'meus' }); }
    });
    $('[data-busca-limpar]').addEventListener('click', function () {
      busca.value = ''; $('[data-busca-limpar]').hidden = true;
      if (est.visao === 'busca') irPara({ visao: 'meus' });
      busca.focus();
    });

    // atalhos de teclado
    document.addEventListener('keydown', function (ev) {
      var digitando = /^(INPUT|TEXTAREA|SELECT)$/.test((ev.target.tagName || '')) || ev.target.isContentEditable;
      if (ev.key === 'Escape') {
        if (!$('[data-gaveta]').hidden) fecharGaveta();
        fecharMenus(); fecharLateral();
        return;
      }
      if (digitando || ev.ctrlKey || ev.metaKey || ev.altKey || $('[data-dialogo]').open) return;
      if (ev.key === '/') { ev.preventDefault(); busca.focus(); }
      else if (ev.key === 'n' || ev.key === 'N') { ev.preventDefault(); alternar('[data-menu-novo]', $('[data-novo]')); }
      else if ((ev.key === 'i' || ev.key === 'I') && iaLigada()) { ev.preventDefault(); dialogoIa({}); }
    });

    window.addEventListener('scroll', function () { if (menuAberto) fecharMenus(); }, { passive: true });

    // enviar
    var inp = $('[data-arquivo-input]');
    inp.addEventListener('change', function () { enviarLista(inp.files); inp.value = ''; });

    // arrastar arquivos do computador
    var arrasto = 0;
    var temArquivos = function (ev) { return ev.dataTransfer && Array.prototype.indexOf.call(ev.dataTransfer.types || [], 'Files') > -1; };
    document.addEventListener('dragenter', function (ev) {
      if (!temArquivos(ev)) return;
      ev.preventDefault();
      arrasto++;
      $('[data-soltar-onde]').textContent = pastaParaCriar()
        ? 'Vai para a pasta “' + (est.caminho.length ? est.caminho[est.caminho.length - 1].nome : '') + '”'
        : 'Vai para Meus arquivos';
      $('[data-soltar]').hidden = false;
    });
    document.addEventListener('dragover', function (ev) { if (temArquivos(ev)) ev.preventDefault(); });
    document.addEventListener('dragleave', function (ev) {
      if (!temArquivos(ev)) return;
      arrasto = Math.max(0, arrasto - 1);
      if (!arrasto) $('[data-soltar]').hidden = true;
    });
    document.addEventListener('drop', function (ev) {
      if (!temArquivos(ev)) return;
      ev.preventDefault();
      arrasto = 0;
      $('[data-soltar]').hidden = true;
      enviarLista(ev.dataTransfer.files);
    });

    window.addEventListener('popstate', function () { lerUrl(); render(); carregar(); });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) carregarAvisos(); });
    setInterval(function () { if (!document.hidden) carregarAvisos(); }, 60000);
  }

  // criar com nome: a janela do editor nasce no clique de "Criar e abrir"
  function pedirCriar(ext, modelo) {
    var base = modelo || O.BRANCOS[ext];
    var titulo = modelo ? 'Novo a partir de “' + modelo.nome + '”' :
      ({ docx: 'Novo documento', xlsx: 'Nova planilha', pptx: 'Nova apresentação' })[ext];
    dialogoNome({
      titulo: titulo, ico: ext, valor: base.nome, ext: ext, botao: 'Criar e abrir',
      texto: 'Abre numa aba nova, pronto para editar. Fica guardado ' + (pastaParaCriar() ? 'nesta pasta.' : 'em Meus arquivos.'),
      aoConfirmar: function () { return janelaEmBranco(); },
      depois: function (nome, janela) { criarDe(base.arquivo, nome, ext, modelo ? 'modelo' : 'novo', janela); }
    });
  }

  function alternar(sel, botao) {
    var el = $(sel);
    var abrir = el.hidden;
    fecharMenus();
    if (abrir) { el.hidden = false; botao.setAttribute('aria-expanded', 'true'); }
  }

  /* =========================================================
     IA da Lube no Drive: "Criar com IA" e "Transformar com IA"
     O Drive cria o arquivo a partir da base da Lube, guarda o pedido no navegador
     (localStorage, só até o editor abrir) e abre o editor, onde a IA monta tudo.
     ========================================================= */
  function iaLigada() { return !!(est.eu && est.eu.ia && est.eu.ia.ligada); }
  var TIPOS_IA = {
    docx: { nome: 'Documento', desc: 'Ata, proposta, comunicado, relatório', cls: '',
      ex: ['Ata da reunião a partir da foto do quadro', 'Proposta comercial para um supermercado, com condições e prazos',
           'Comunicado interno sobre o novo horário de entregas', 'Procedimento de recebimento de mercadoria, passo a passo'] },
    xlsx: { nome: 'Planilha', desc: 'Controle, metas, cálculos com gráfico', cls: 'plan',
      ex: ['Metas de vendas por RCA com % atingido e gráfico', 'Controle de contas a pagar do mês com total',
           'Planilha a partir da foto da tabela impressa', 'Escala de entregas da semana por rota'] },
    pptx: { nome: 'Apresentação', desc: 'Slides com a marca, animados', cls: 'apre',
      ex: ['Resultado do mês para a diretoria, com números em destaque', 'Treinamento dos RCAs sobre o SAC',
           'Slides a partir da foto do quadro', 'Lançamento do e-commerce B2B para os clientes'] }
  };

  function desenharIa() {
    var on = iaLigada();
    $$('[data-ia-criar]').forEach(function (b) { b.hidden = !on; });
    if (!on) return;
    var ia = est.eu.ia, teto = Number(ia.teto_dia_usd) || 10, g = Number(ia.gasto_hoje_usd) || 0;
    var t = $('[data-ia-lado-gasto]'), m = $('[data-ia-lado-medidor]');
    if (t) t.textContent = 'Hoje: ' + O.usd(g) + ' de ' + O.usd(teto);
    if (m) m.style.width = Math.min(100, Math.max(2, g / teto * 100)) + '%';
    digitar();
  }

  // frase que se escreve sozinha no cartão "Criar com IA"
  var digitando = null;
  function digitar() {
    var el = $('[data-ia-digita]');
    if (!el || digitando || semMovimento()) return;
    var frases = ['uma ata a partir da foto do quadro', 'a planilha de metas por RCA com gráfico', 'os slides do resultado do mês',
      'uma proposta comercial para o cliente', 'um resumo desta planilha em slides', 'o comunicado do novo horário'];
    var i = 0, pos = el.textContent.length, apagando = true, pausa = 40;
    digitando = setInterval(function () {
      if (document.hidden || $('[data-ola]').hidden) return;
      if (pausa > 0) { pausa--; return; }
      var alvo = frases[i];
      if (apagando) {
        pos--;
        el.textContent = el.textContent.slice(0, Math.max(0, pos));
        if (pos <= 0) { apagando = false; i = (i + 1) % frases.length; pausa = 6; }
      } else {
        pos++;
        el.textContent = frases[i].slice(0, pos);
        if (pos >= alvo.length) { apagando = true; pausa = 70; }
      }
    }, 38);
  }

  function nomeProvisorio(pedido, tipo) {
    var p = String(pedido || '').replace(/[\\/:*?"<>|\n\r\t]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!p) return TIPOS_IA[tipo].nome + ' da IA';
    var palavras = p.split(' ').slice(0, 7).join(' ');
    palavras = palavras.charAt(0).toUpperCase() + palavras.slice(1);
    return palavras.length > 60 ? palavras.slice(0, 57).trim() + '…' : palavras;
  }

  function guardarPedidoIa(dados) {
    var chave = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    dados.em = Date.now();
    try { localStorage.setItem('office_ia_' + chave, JSON.stringify(dados)); }
    catch (e) { throw new Error('As imagens são grandes demais para levar ao editor. Mande menos fotos ou fotos menores.'); }
    return chave;
  }
  // pedido que nunca chegou ao editor (aba fechada antes de abrir) sai depois de 2 horas
  function limparPedidosVelhos() {
    try {
      Object.keys(localStorage).forEach(function (k) {
        if (k.indexOf('office_ia_') !== 0) return;
        var v = null;
        try { v = JSON.parse(localStorage.getItem(k)); } catch (e) {}
        if (!v || !v.em || Date.now() - v.em > 2 * 3600e3) localStorage.removeItem(k);
      });
    } catch (e) {}
  }

  function dialogoIa(o) {
    o = o || {};
    if (!iaLigada()) { O.toast('A IA da Lube ainda não está ligada.', 'erro'); return; }
    fecharMenus();
    var fonte = o.fonte || null;
    var tipo = o.tipo || (fonte ? ({ docx: 'pptx', xlsx: 'pptx', pptx: 'docx', pdf: 'docx', txt: 'docx', csv: 'xlsx' })[fonte.extensao] || 'docx' : 'docx');
    var anexos = [];
    var d = $('[data-dialogo]');
    d.className = 'dialogo dialogo--ia';
    var fechar = SVG.fechar.replace('<svg ', '<svg aria-hidden="true" ');
    d.innerHTML = '<form method="dialog" class="ia-criar" novalidate>' +
      '<div class="ia-criar__topo"><span class="ia-orbe" aria-hidden="true"><i></i><b></b></span>' +
        '<div><span class="mono">IA da Lube · Claude Haiku 5.5</span><h2>' +
        (fonte ? 'Transformar com IA' : 'Criar com IA') + '</h2><p>' +
        (fonte ? 'A IA lê o arquivo e monta um novo, com a identidade da Lube. O original não muda.'
               : 'Diga o que você quer. A IA monta dentro do editor, com a identidade da Lube.') + '</p></div>' +
        '<button class="fechar" type="button" data-dlg-cancelar aria-label="Fechar">' + SVG.fechar + '</button></div>' +
      (fonte ? '<div class="ia-fonte">' + O.icone(fonte.extensao) + '<span><strong>' + esc(nomeCompleto(fonte)) +
        '</strong><em>A IA lê a última versão salva</em></span></div>' : '') +
      '<div class="ia-tipos" role="radiogroup" aria-label="O que criar">' + ['docx', 'xlsx', 'pptx'].map(function (t, i) {
        var T = TIPOS_IA[t];
        return '<button type="button" class="ia-tipo' + (T.cls ? ' ia-tipo--' + T.cls : '') + '" role="radio" data-ia-tipo="' + t + '" style="--i:' + i + '">' +
          O.icone(t) + '<strong>' + T.nome + '</strong><span>' + T.desc + '</span></button>';
      }).join('') + '</div>' +
      '<label class="ia-criar__caixa"><textarea data-ia-txt rows="3" maxlength="4000" aria-label="Pedido para a IA"></textarea></label>' +
      '<div class="ia-criar__ex" data-ia-ex></div>' +
      '<div class="ia-criar__fotos" data-ia-fotos>' +
        '<button type="button" class="ia-criar__soltar" data-ia-escolher>' + SVG.brilho +
          '<span><strong>Fotos para a IA ler</strong> quadro, anotação à mão, tabela impressa · arraste, cole ou clique</span></button>' +
        '<div class="ia__anexos" data-ia-anexos></div>' +
        '<input type="file" accept="image/*" multiple hidden data-ia-arquivo></div>' +
      '<p class="dialogo__erro" data-dlg-erro></p>' +
      '<div class="ia-criar__pe"><span class="ia-criar__gasto">Hoje na Lube: ' + esc(O.usd(est.eu.ia.gasto_hoje_usd)) + ' de ' + esc(O.usd(est.eu.ia.teto_dia_usd)) +
        ' · cada pedido custa menos de 1 centavo</span>' +
        '<button class="btn" type="button" data-dlg-cancelar>Cancelar</button>' +
        '<button class="btn btn--ia-criar" type="submit" data-ia-ok>' + SVG.brilho + '<span>' + (fonte ? 'Transformar' : 'Criar com IA') + '</span></button></div>' +
      '</form>';

    var txt = $('[data-ia-txt]', d), erroEl = $('[data-dlg-erro]', d);
    function marcarTipo(t) {
      tipo = t;
      $$('[data-ia-tipo]', d).forEach(function (b) { b.setAttribute('aria-checked', String(b.getAttribute('data-ia-tipo') === t)); });
      txt.placeholder = fonte ? 'O que destacar? (opcional) Ex.: só as decisões e os números' : 'Descreva o que você quer. Ex.: ' + TIPOS_IA[t].ex[0].toLowerCase();
      $('[data-ia-ex]', d).innerHTML = fonte ? '' : TIPOS_IA[t].ex.map(function (e, i) {
        return '<button type="button" class="ia-sug" data-ia-ex-i="' + i + '" style="--i:' + i + '">' + SVG.brilho + esc(e) + '</button>';
      }).join('');
    }
    function desenharAnexos() {
      $('[data-ia-anexos]', d).innerHTML = anexos.map(function (a, i) {
        return '<span class="ia-anexo" style="--i:' + i + '"><img src="' + a.url + '" alt=""><button type="button" data-ia-tira="' + i +
          '" aria-label="Tirar imagem">' + fechar + '</button></span>';
      }).join('');
    }
    function anexar(lista) {
      var arr = Array.prototype.slice.call(lista || []).filter(function (f) { return /^image\//.test(f.type); });
      if (anexos.length + arr.length > 4) { erroEl.textContent = 'Até 4 imagens por pedido.'; arr = arr.slice(0, Math.max(0, 4 - anexos.length)); }
      Promise.all(arr.map(function (f) { return O.imagemParaIa(f).catch(function (e) { erroEl.textContent = e.message; return null; }); }))
        .then(function (l) { l.forEach(function (a) { if (a) anexos.push(a); }); desenharAnexos(); });
    }
    marcarTipo(tipo);
    d.addEventListener('click', function (ev) {
      var b;
      if ((b = ev.target.closest('[data-ia-tipo]'))) { marcarTipo(b.getAttribute('data-ia-tipo')); return; }
      if ((b = ev.target.closest('[data-ia-ex-i]'))) { txt.value = TIPOS_IA[tipo].ex[+b.getAttribute('data-ia-ex-i')]; txt.focus(); return; }
      if ((b = ev.target.closest('[data-ia-tira]'))) { anexos.splice(+b.getAttribute('data-ia-tira'), 1); desenharAnexos(); return; }
      if (ev.target.closest('[data-ia-escolher]')) { $('[data-ia-arquivo]', d).click(); return; }
      if (ev.target.closest('[data-dlg-cancelar]')) d.close();
    });
    $('[data-ia-arquivo]', d).addEventListener('change', function (ev) { anexar(ev.target.files); ev.target.value = ''; });
    txt.addEventListener('paste', function (ev) {
      var fs = (ev.clipboardData && ev.clipboardData.files) || [];
      if (fs.length) { ev.preventDefault(); anexar(fs); }
    });
    var zona = $('[data-ia-fotos]', d);
    zona.addEventListener('dragover', function (ev) { ev.preventDefault(); ev.stopPropagation(); zona.classList.add('is-soltar'); });
    zona.addEventListener('dragleave', function () { zona.classList.remove('is-soltar'); });
    zona.addEventListener('drop', function (ev) { ev.preventDefault(); ev.stopPropagation(); zona.classList.remove('is-soltar'); anexar(ev.dataTransfer.files); });
    txt.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); $('form', d).requestSubmit(); } });

    $('form', d).addEventListener('submit', function (ev) {
      ev.preventDefault();
      var pedido = txt.value.trim();
      if (!pedido && !anexos.length && !fonte) { erroEl.textContent = 'Escreva o que você quer ou mande uma foto.'; txt.focus(); return; }
      var chave;
      try {
        chave = guardarPedidoIa({
          pedido: pedido, renomear: true,
          imagens: anexos.map(function (a) { return { tipo: a.tipo, dados: a.dados, url: a.url }; }),
          fonte: fonte ? { id: fonte.id, nome: nomeCompleto(fonte) } : null
        });
      } catch (e) { erroEl.textContent = e.message; return; }
      var janela = janelaEmBranco();   // ainda dentro do clique: o bloqueador de pop-up não barra
      d.close();
      var nome = fonte ? nomeProvisorio((fonte.nome || '') + ' em ' + TIPOS_IA[tipo].nome.toLowerCase(), tipo) : nomeProvisorio(pedido, tipo);
      criarDe(O.BASES_IA[tipo], nome, tipo, 'novo', janela, '&ia=' + chave);
    });

    d.showModal();
    txt.focus();
  }

  /* ---------- vida na tela: luz que segue o mouse, leve inclinação e arrastar para pasta ---------- */
  function ligarVida() {
    if (semMovimento()) return;
    document.addEventListener('pointermove', function (ev) {
      var el = ev.target.closest && ev.target.closest('.vivo');
      if (!el) return;
      var r = el.getBoundingClientRect();
      var x = ev.clientX - r.left, y = ev.clientY - r.top;
      el.style.setProperty('--mx', x + 'px');
      el.style.setProperty('--my', y + 'px');
      el.style.setProperty('--ry', ((x / r.width - 0.5) * 7).toFixed(2) + 'deg');
      el.style.setProperty('--rx', ((0.5 - y / r.height) * 7).toFixed(2) + 'deg');
    }, { passive: true });
    document.addEventListener('pointerout', function (ev) {
      var el = ev.target.closest && ev.target.closest('.vivo');
      if (el && !el.contains(ev.relatedTarget)) { el.style.setProperty('--rx', '0deg'); el.style.setProperty('--ry', '0deg'); }
    }, { passive: true });
  }

  // arrastar um arquivo ou pasta da lista para uma pasta (ou para a trilha) move o item
  function ligarArrastar() {
    var tab = $('[data-tabela]'), arrastando = null, alvoAtual = null;
    function alvo(t) {
      if (!arrastando || !t || !t.closest) return null;
      var lin = t.closest('.linha[data-item]');
      if (lin) {
        var it = itemPorId(lin.getAttribute('data-item'));
        if (it && it.tipo === 'pasta' && it.id !== arrastando.id && O.pode(it.papel, 'editar')) return { el: lin, destino: it.id, nome: it.nome };
        return null;
      }
      var a = t.closest('[data-ir-pasta]');
      if (a) return { el: a, destino: a.getAttribute('data-ir-pasta'), nome: a.textContent };
      a = t.closest('[data-ir-visao="meus"], .visao[data-visao="meus"]');
      if (a && arrastando.dono && arrastando.dono.id === euId()) return { el: a, destino: null, nome: 'Meus arquivos' };
      return null;
    }
    function marcar(el) {
      if (alvoAtual === el) return;
      if (alvoAtual) alvoAtual.classList.remove('is-alvo');
      alvoAtual = el;
      if (el) el.classList.add('is-alvo');
    }
    tab.addEventListener('dragstart', function (ev) {
      var lin = ev.target.closest && ev.target.closest('.linha[data-item]');
      var it = lin && itemPorId(lin.getAttribute('data-item'));
      if (!it) return;
      arrastando = it;
      ev.dataTransfer.effectAllowed = 'move';
      ev.dataTransfer.setData('application/x-lube-office', it.id);
      lin.classList.add('is-arrastando');
      document.body.classList.add('arrastando-item');
    });
    tab.addEventListener('dragend', function () {
      $$('.is-arrastando').forEach(function (e) { e.classList.remove('is-arrastando'); });
      document.body.classList.remove('arrastando-item');
      marcar(null);
      arrastando = null;
    });
    document.addEventListener('dragover', function (ev) {
      if (!arrastando) return;
      var a = alvo(ev.target);
      if (a) { ev.preventDefault(); ev.dataTransfer.dropEffect = 'move'; marcar(a.el); } else marcar(null);
    });
    document.addEventListener('drop', function (ev) {
      if (!arrastando) return;
      var a = alvo(ev.target), it = arrastando;
      marcar(null);
      if (!a) return;
      ev.preventDefault();
      var antes = it.tipo === 'pasta' ? it.pai : it.pasta;
      if ((antes || null) === a.destino) return;
      O.api('mover', { tipo: it.tipo, id: it.id, destino: a.destino }).then(function (novo) {
        if (!aquiMesmo(novo)) tirarItem(it.id); else trocarItem(novo);
        O.toast('“' + nomeCompleto(it) + '” foi para “' + a.nome + '”.', null, {
          texto: 'Desfazer', fn: function () {
            O.api('mover', { tipo: it.tipo, id: it.id, destino: antes || null }).then(function (v) { inserirItem(v) || carregar(); O.toast('Desfeito.'); }, erroToast);
          }
        }, 8000);
      }, erroToast);
    });
  }

  // número que conta até o valor (o espaço usado na lateral)
  function contar(el, ate, sufixo) {
    if (!el) return;
    if (semMovimento() || ate < 2) { el.textContent = ate + sufixo; return; }
    var t0 = performance.now(), dur = 900;
    (function passo(t) {
      var k = Math.min(1, (t - t0) / dur), v = Math.round(ate * (1 - Math.pow(1 - k, 3)));
      el.textContent = v + sufixo;
      if (k < 1) requestAnimationFrame(passo);
    })(t0);
  }

  /* ---------- início ---------- */
  function iniciar() {
    O.marcas();
    $$('[data-ico]').forEach(function (el) { el.innerHTML = O.icone(el.getAttribute('data-ico')); });
    lerUrl();
    ligar();
    ligarVida();
    ligarArrastar();
    limparPedidosVelhos();
    O.pronto().then(function () { return O.token(); }).then(function (t) {
      if (!t) {
        bloquear('Entre pelo painel', 'O LUBE OFFICE abre com o mesmo login do Painel de Sistemas.',
          { texto: 'Ir para o login', href: '../?voltar=office' });
        return;
      }
      return atualizarEu().then(function () {
        document.body.classList.remove('carregando');
        render();
        carregar();
        carregarAvisos();
        var u = new URLSearchParams(location.search);
        // vindo do editor: abre o compartilhar ou o enviar daquele arquivo
        var comp = u.get('compartilhar'), env = u.get('enviar');
        var doEditor = function (id) {
          return { tipo: 'arquivo', id: id, nome: u.get('nome') || 'Arquivo', extensao: u.get('ext') || '', papel: null };
        };
        if (comp && /^[0-9a-f-]{36}$/i.test(comp)) gaveta(doEditor(comp), 'acesso');
        else if (env && /^[0-9a-f-]{36}$/i.test(env)) dialogoEnviar(doEditor(env));
      }, function (e) {
        if (e.status === 401) {
          bloquear('Sua sessão acabou', 'Entre de novo pelo Painel de Sistemas.', { texto: 'Ir para o login', href: '../?voltar=office' });
        } else if (e.status === 403) {
          bloquear('Sem acesso', 'Seu usuário não está ativo no painel. Procure o TI.', { texto: 'Voltar ao painel', href: '../' });
        } else {
          bloquear('Não abriu agora', e.message, { texto: 'Tentar de novo', href: location.href });
        }
      });
    }).catch(function (e) {
      bloquear('Não abriu agora', e && e.message ? e.message : 'Falha ao iniciar.', { texto: 'Tentar de novo', href: location.href });
    });
  }

  iniciar();
})();
