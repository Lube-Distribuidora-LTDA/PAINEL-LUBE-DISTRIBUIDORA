/* =========================================================
   PAINEL LUBE — menu lateral "BI LUBE" e palco dos BIs
   Recebe do portal.js a lista de sistemas já com a permissão de cada
   um (_liberado) e cuida de: menu (fixados, todos por área, cadeado),
   início, abas e o BI aberto dentro do painel (um iframe por BI, que
   fica vivo ao trocar de aba). Sistema que ainda não aceita ser
   mostrado no portal (sistemas.abre_no_painel = false) abre em nova aba.
   ========================================================= */
(function () {
  'use strict';

  var $  = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };

  var app      = $('[data-app]');
  if (!app) return;
  var side     = $('[data-side]');
  var listaEl  = $('[data-bi-lista]');
  var qtdEl    = $('[data-bi-qtd]');
  var busca    = $('[data-side-busca]');
  var abasEl   = $('[data-abas]');
  var acoesEl  = $('[data-acoes]');
  var inicioEl = $('[data-inicio]');
  var quadrosEl= $('[data-quadros]');
  var grupoBi  = $('[data-grupo-bi]');
  var stage    = $('[data-stage]');

  var ctx = null;            // o que o portal.js entrega (sb, perfil, registrar, pedirPasse...)
  var sistemas = [];
  var porId = {};
  var fixos = [];            // ids, na ordem em que foram fixados
  var abertos = [];          // ids das abas, na ordem
  var quadros = {};          // id -> { el, iframe, carga, timer, tentativas }
  var ativo = null;          // id do BI na frente; null = Início
  var areasFechadas = {};

  var ICO = {
    pino: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 4h6l-1 6 3 3v2H7v-2l3-3Z"/><path d="M12 15v5"/></svg>',
    pinoCheio: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M9 4h6l-1 6 3 3v2H7v-2l3-3Z"/><path d="M12 15v5" fill="none"/></svg>',
    cadeado: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>',
    seta: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="m9 6 6 6-6 6"/></svg>',
    ir: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    fora: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
    casa: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5h-5v5H5a1 1 0 0 1-1-1Z"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    estrela: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 4h6l-1 6 3 3v2H7v-2l3-3Z"/><path d="M12 15v5"/></svg>',
    relogio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></svg>',
    grade: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8.5 16v-4M12 16V8M15.5 16v-6"/></svg>',
    alerta: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 2.6 17a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>',
    sair: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H4"/></svg>'
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function norm(s) {
    var x = String(s || '').normalize('NFD'), out = '', i, c;
    for (i = 0; i < x.length; i++) {
      c = x.charCodeAt(i);
      if (c < 768 || c > 879) out += x.charAt(i);
    }
    return out.toLowerCase();
  }
  function guardar(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function ler(k, padrao) {
    try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? padrao : v; } catch (e) { return padrao; }
  }
  function chave(nome) { return 'lube_' + nome + '_' + (ctx && ctx.perfil ? ctx.perfil.id : 'x'); }
  function icone(s) {
    var ic = ctx && ctx.icones ? ctx.icones[s.badge] : null;
    try { return window.LUBE_ICONE.html(ic); } catch (e) { return ''; }
  }
  function nomeBonito(s) {
    // os nomes vêm em caixa alta do admin; no menu ficam mais leves
    var n = String(s.nome || '');
    if (n !== n.toUpperCase()) return n;
    var curtas = { de: 1, da: 1, do: 1, das: 1, dos: 1, e: 1 };
    return n.toLowerCase().split(' ').map(function (p, i) {
      if (/^(ti|rh|icms|bi|sac)$/.test(p)) return p.toUpperCase();
      if (i && curtas[p]) return p;
      return p.charAt(0).toUpperCase() + p.slice(1);
    }).join(' ');
  }

  /* ---------- aviso ---------- */
  var toastEl = null, toastT = null;
  function aviso(msg) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'toast-bi';
      toastEl.setAttribute('role', 'status');
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add('is-on');
    clearTimeout(toastT);
    toastT = setTimeout(function () { toastEl.classList.remove('is-on'); }, 5000);
  }

  /* =========================================================
     MENU
     ========================================================= */
  function itemBi(s) {
    var on = ativo === s.id ? ' is-on' : '';
    var aberto = quadros[s.id] ? ' is-aberto' : '';
    var nome = nomeBonito(s);
    if (!s._liberado) {
      return '<div class="bi bi--bloqueado" role="button" tabindex="0" data-bi="' + esc(s.id) + '" ' +
          'data-dica="' + esc(nome) + ' · sem autorização" aria-disabled="true">' +
        '<span class="bi__ico">' + icone(s) + '</span>' +
        '<span class="bi__nome">' + esc(nome) + '</span>' +
        '<span class="bi__cadeado" aria-hidden="true">' + ICO.cadeado + '</span>' +
      '</div>';
    }
    var fixo = fixos.indexOf(s.id) > -1;
    return '<div class="bi' + on + aberto + '" role="button" tabindex="0" data-bi="' + esc(s.id) + '" data-dica="' + esc(nome) + '">' +
      '<span class="bi__ico">' + icone(s) + '</span>' +
      '<span class="bi__nome">' + esc(nome) + '</span>' +
      '<span class="bi__ponto" title="Aberto"></span>' +
      '<button type="button" class="bi__pino' + (fixo ? ' is-fixo' : '') + '" data-fixar="' + esc(s.id) + '" ' +
        'title="' + (fixo ? 'Desafixar' : 'Fixar no topo') + '" aria-label="' + (fixo ? 'Desafixar ' : 'Fixar ') + esc(nome) + '">' +
        (fixo ? ICO.pinoCheio : ICO.pino) + '</button>' +
    '</div>';
  }

  function montarMenu() {
    if (!listaEl) return;
    var termo = norm(busca ? busca.value : '').trim();
    var bate = function (s) {
      return !termo || termo.split(/\s+/).every(function (w) { return s._hay.indexOf(w) > -1; });
    };

    var liberados = sistemas.filter(function (s) { return s._liberado; });
    if (qtdEl) qtdEl.textContent = liberados.length;

    var html = '';
    var fixados = fixos.map(function (id) { return porId[id]; })
      .filter(function (s) { return s && s._liberado && bate(s); });
    if (!termo || fixados.length) {
      html += '<p class="bis__titulo">' + ICO.estrela + 'Fixados <em>' + fixados.length + '</em></p>';
      html += fixados.length ? fixados.map(itemBi).join('')
        : '<p class="bis__vazio">Passe o mouse num BI e clique no alfinete para deixá-lo aqui no topo.</p>';
    }

    // no menu recolhido, além dos fixados, aparecem os BIs abertos
    var abertosFora = abertos.filter(function (id) { return fixos.indexOf(id) < 0 && porId[id]; });
    if (abertosFora.length) {
      html += '<div class="bis__rail-abertos">' +
        abertosFora.map(function (id) { return porId[id]; }).filter(bate).map(itemBi).join('') + '</div>';
    }

    // todos, por área (liberados primeiro dentro de cada área)
    var areas = [], porArea = {};
    sistemas.forEach(function (s) {
      if (!bate(s)) return;
      var a = s.categoria || 'Outros';
      if (!porArea[a]) { porArea[a] = []; areas.push(a); }
      porArea[a].push(s);
    });
    html += '<div data-todos>';
    if (!areas.length) {
      html += '<p class="bis__vazio">Nenhum BI encontrado para “' + esc(busca.value) + '”.</p>';
    }
    areas.forEach(function (a) {
      var fechada = !termo && areasFechadas[a];
      html += '<button type="button" class="bis__area" data-area="' + esc(a) + '" aria-expanded="' + (!fechada) + '">' +
          ICO.seta + esc(a) + '<em>' + porArea[a].length + '</em></button>' +
        '<div class="bis__grupo' + (fechada ? ' is-fechado' : '') + '"><div>' +
          porArea[a].map(itemBi).join('') +
        '</div></div>';
    });
    html += '</div>';

    // os abertos (fora dos fixados) só aparecem no menu recolhido
    listaEl.innerHTML = '<div class="bis">' + html + '</div>';
    $$('.bis__rail-abertos', listaEl).forEach(function (el) { el.hidden = !app.classList.contains('is-rail'); });
  }

  if (listaEl) {
    listaEl.addEventListener('click', function (ev) {
      var pin = ev.target.closest('[data-fixar]');
      if (pin) { ev.stopPropagation(); alternarFixo(pin.getAttribute('data-fixar')); return; }
      var area = ev.target.closest('[data-area]');
      if (area) {
        var a = area.getAttribute('data-area');
        areasFechadas[a] = !areasFechadas[a];
        guardar(chave('areas_fechadas'), areasFechadas);
        area.setAttribute('aria-expanded', String(!areasFechadas[a]));
        area.nextElementSibling.classList.toggle('is-fechado', !!areasFechadas[a]);
        return;
      }
      var bi = ev.target.closest('[data-bi]');
      if (bi) abrir(bi.getAttribute('data-bi'));
    });
    listaEl.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      var bi = ev.target.closest('[data-bi]');
      if (bi && ev.target === bi) { ev.preventDefault(); abrir(bi.getAttribute('data-bi')); }
    });
  }

  var grupoToggle = $('[data-toggle-bi]');
  if (grupoToggle) grupoToggle.addEventListener('click', function () {
    if (app.classList.contains('is-rail')) { recolher(false); grupoBi.classList.add('is-aberto'); grupoToggle.setAttribute('aria-expanded', 'true'); return; }
    var abre = !grupoBi.classList.contains('is-aberto');
    grupoBi.classList.toggle('is-aberto', abre);
    grupoToggle.setAttribute('aria-expanded', String(abre));
  });

  if (busca) {
    busca.addEventListener('input', function () {
      if (!grupoBi.classList.contains('is-aberto')) grupoBi.classList.add('is-aberto');
      montarMenu();
    });
    busca.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') { busca.value = ''; montarMenu(); busca.blur(); }
      if (ev.key === 'Enter') {                       // Enter abre o primeiro liberado da busca
        var primeiro = $('.bi:not(.bi--bloqueado)', listaEl);
        if (primeiro) abrir(primeiro.getAttribute('data-bi'));
      }
    });
  }
  var buscaLabel = $('.side__busca');
  if (buscaLabel) buscaLabel.addEventListener('click', function () {
    if (app.classList.contains('is-rail')) { recolher(false); setTimeout(function () { busca.focus(); }, 300); }
  });

  document.addEventListener('keydown', function (ev) {
    if ((ev.ctrlKey || ev.metaKey) && (ev.key === 'k' || ev.key === 'K') && document.body.classList.contains('autenticado')) {
      ev.preventDefault();
      if (app.classList.contains('is-rail')) recolher(false);
      if (window.matchMedia('(max-width:860px)').matches) app.classList.add('is-menu');
      setTimeout(function () { if (busca) { busca.focus(); busca.select(); } }, 60);
    }
  });

  /* ---------- fixar ---------- */
  function alternarFixo(id) {
    var s = porId[id];
    if (!s || !s._liberado) return;
    var i = fixos.indexOf(id);
    var fixar = i < 0;
    if (fixar) fixos.push(id); else fixos.splice(i, 1);
    guardar(chave('fixos'), fixos);
    montarMenu();
    if (!ativo) montarInicio();
    aviso(fixar ? nomeBonito(s) + ' fixado no topo do menu.' : nomeBonito(s) + ' saiu dos fixados.');

    if (!ctx || !ctx.sb || !ctx.perfil) return;
    var q = fixar
      ? ctx.sb.from('favoritos').insert({ user_id: ctx.perfil.id, sistema_id: id })
      : ctx.sb.from('favoritos').delete().eq('user_id', ctx.perfil.id).eq('sistema_id', id);
    q.then(function (r) {
      // fica salvo no navegador mesmo se o banco falhar; o banco é o que vale entre computadores
      if (r && r.error && !/duplicate/i.test(r.error.message || '')) {
        console.warn('favoritos:', r.error.message);
      }
    }, function () {});
  }

  /* ---------- menu recolhido ---------- */
  var estreito = window.matchMedia('(max-width:860px)');
  function recolher(sim) {
    if (estreito.matches) sim = false;
    app.classList.toggle('is-rail', !!sim);
    var b = $('[data-recolher]');
    if (b) {
      b.setAttribute('aria-label', sim ? 'Expandir menu' : 'Recolher menu');
      b.title = sim ? 'Expandir menu' : 'Recolher menu';
    }
    guardar('lube_menu_recolhido', !!sim);
    $$('.bis__rail-abertos', listaEl).forEach(function (el) { el.hidden = !sim; });
    esconderDica();
  }
  var btnRecolher = $('[data-recolher]');
  if (btnRecolher) btnRecolher.addEventListener('click', function () { recolher(!app.classList.contains('is-rail')); });
  if (estreito.addEventListener) estreito.addEventListener('change', function () { recolher(ler('lube_menu_recolhido', false)); });

  // dica com o nome ao passar o mouse no menu recolhido
  var dicaEl = null;
  function esconderDica() { if (dicaEl) dicaEl.classList.remove('is-on'); }
  if (side) {
    side.addEventListener('mouseover', function (ev) {
      if (!app.classList.contains('is-rail')) return;
      var alvo = ev.target.closest('[data-dica]');
      if (!alvo) { esconderDica(); return; }
      if (!dicaEl) { dicaEl = document.createElement('div'); dicaEl.className = 'dica'; document.body.appendChild(dicaEl); }
      var r = alvo.getBoundingClientRect(), rs = side.getBoundingClientRect();
      dicaEl.textContent = alvo.getAttribute('data-dica');
      dicaEl.style.left = (rs.right + 12) + 'px';
      dicaEl.style.top = (r.top + r.height / 2 - 16) + 'px';
      dicaEl.classList.add('is-on');
    });
    side.addEventListener('mouseleave', esconderDica);
  }

  /* ---------- gaveta no celular ---------- */
  var abrirMenu = $('[data-abrir-menu]');
  if (abrirMenu) abrirMenu.addEventListener('click', function () { app.classList.add('is-menu'); });
  var fundo = $('[data-fechar-menu]');
  if (fundo) fundo.addEventListener('click', function () { app.classList.remove('is-menu'); });

  /* ---------- suporte ---------- */
  var suporte = $('[data-suporte]');
  var suporteBtn = $('[data-suporte-btn]');
  if (suporte && suporteBtn) {
    suporteBtn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      var on = !suporte.classList.contains('is-on');
      suporte.classList.toggle('is-on', on);
      suporteBtn.setAttribute('aria-expanded', String(on));
    });
    document.addEventListener('click', function (ev) {
      if (!suporte.contains(ev.target)) { suporte.classList.remove('is-on'); suporteBtn.setAttribute('aria-expanded', 'false'); }
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') { suporte.classList.remove('is-on'); suporteBtn.setAttribute('aria-expanded', 'false'); }
    });
  }

  $$('[data-ir-inicio]').forEach(function (b) { b.addEventListener('click', function () { mostrar(null); }); });

  /* =========================================================
     INÍCIO
     ========================================================= */
  function tile(s, grande) {
    var nome = nomeBonito(s);
    if (!s._liberado) {
      return '<div class="tile tile--bloqueado" title="Sem autorização. Peça a liberação ao TI.">' +
        '<span class="tile__ico">' + icone(s) + '</span>' +
        '<span class="tile__txt"><span class="tile__area">' + esc(s.categoria) + '</span>' +
          '<span class="tile__nome">' + esc(nome) + '</span>' +
          '<span class="tile__desc">Sem autorização. Peça a liberação ao TI.</span></span>' +
        '<span class="tile__ir" aria-hidden="true">' + ICO.cadeado + '</span>' +
      '</div>';
    }
    var fixo = fixos.indexOf(s.id) > -1;
    return '<button type="button" class="tile' + (grande ? ' tile--grande' : '') + '" data-abrir="' + esc(s.id) + '">' +
      '<span class="tile__ico">' + icone(s) + '</span>' +
      '<span class="tile__txt"><span class="tile__area">' + esc(s.categoria) + '</span>' +
        '<span class="tile__nome">' + esc(nome) + '</span>' +
        (s.descricao ? '<span class="tile__desc">' + esc(s.descricao) + '</span>' : '') + '</span>' +
      (grande && fixo ? '<span class="tile__pino" role="button" tabindex="0" data-fixar="' + esc(s.id) + '" title="Desafixar">' + ICO.pinoCheio + '</span>'
        : '<span class="tile__ir" aria-hidden="true">' + (s.abre_no_painel ? ICO.ir : ICO.fora) + '</span>') +
    '</button>';
  }

  function saudacao() {
    var h = new Date().getHours();
    return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
  }

  function montarInicio() {
    if (!inicioEl || !ctx) return;
    var p = ctx.perfil || {};
    var primeiro = String(p.nome || (p.email || '').split('@')[0] || '').split(/\s+/)[0];
    primeiro = primeiro ? primeiro.charAt(0).toUpperCase() + primeiro.slice(1).toLowerCase() : '';
    var liberados = sistemas.filter(function (s) { return s._liberado; });
    var areas = {};
    sistemas.forEach(function (s) { if (s.categoria) areas[s.categoria] = 1; });
    var data = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });

    var fixados = fixos.map(function (id) { return porId[id]; }).filter(function (s) { return s && s._liberado; });
    var recentes = ler(chave('recentes'), []).map(function (id) { return porId[id]; })
      .filter(function (s) { return s && s._liberado; }).slice(0, 6);

    var html =
      '<div class="boas">' +
        '<div>' +
          '<p class="boas__data mono">' + esc(data) + '</p>' +
          '<h1 class="boas__ola">' + saudacao() + (primeiro ? ', ' + esc(primeiro) : '') + '</h1>' +
          '<p class="boas__txt">Seus BIs em um só lugar. Abra pelo menu ao lado, fixe os favoritos no alfinete ' +
            'e alterne entre eles pelas abas, sem perder o que já carregou.</p>' +
        '</div>' +
        '<div class="boas__nums">' +
          '<div class="boas__num"><strong>' + liberados.length + '</strong><span>BIs liberados</span></div>' +
          '<div class="boas__num"><strong>' + fixados.length + '</strong><span>Fixados</span></div>' +
          '<div class="boas__num"><strong>' + Object.keys(areas).length + '</strong><span>Áreas</span></div>' +
        '</div>' +
      '</div>';

    html += '<section class="secao"><div class="secao__topo"><h2 class="secao__h">' + ICO.estrela + 'Fixados</h2></div>' +
      (fixados.length ? '<div class="tiles tiles--grandes">' + fixados.map(function (s) { return tile(s, true); }).join('') + '</div>'
        : '<p class="secao__vazio">Nenhum BI fixado ainda. No menu, passe o mouse num BI e clique no alfinete ' + ICO.pino + ' para ele ficar sempre no topo.</p>') +
      '</section>';

    if (recentes.length) {
      html += '<section class="secao"><div class="secao__topo"><h2 class="secao__h">' + ICO.relogio + 'Abertos recentemente</h2></div>' +
        '<div class="tiles">' + recentes.map(function (s) { return tile(s); }).join('') + '</div></section>';
    }

    var ordemAreas = [], grupos = {};
    sistemas.forEach(function (s) {
      var a = s.categoria || 'Outros';
      if (!grupos[a]) { grupos[a] = []; ordemAreas.push(a); }
      grupos[a].push(s);
    });
    html += '<section class="secao"><div class="secao__topo"><h2 class="secao__h">' + ICO.grade +
      'Todos os BIs <em class="mono">' + liberados.length + ' de ' + sistemas.length + ' liberados</em></h2></div>' +
      ordemAreas.map(function (a) {
        return '<p class="area__nome">' + esc(a) + '</p><div class="tiles">' + grupos[a].map(function (s) { return tile(s); }).join('') + '</div>';
      }).join('') + '</section>';

    inicioEl.innerHTML = html;
  }

  if (inicioEl) inicioEl.addEventListener('click', function (ev) {
    var pin = ev.target.closest('[data-fixar]');
    if (pin) { ev.stopPropagation(); alternarFixo(pin.getAttribute('data-fixar')); return; }
    var t = ev.target.closest('[data-abrir]');
    if (t) abrir(t.getAttribute('data-abrir'));
  });

  /* =========================================================
     ABAS E QUADROS
     ========================================================= */
  function montarAbas() {
    if (!abasEl) return;
    var html = '<button type="button" class="aba' + (ativo ? '' : ' is-on') + '" role="tab" aria-selected="' + !ativo + '" data-aba="">' +
      '<span class="aba__ico aba__ico--casa">' + ICO.casa + '</span><span class="aba__nome">Início</span></button>';
    abertos.forEach(function (id) {
      var s = porId[id]; if (!s) return;
      var q = quadros[id];
      var carregando = q && !q.carga.classList.contains('is-off');
      html += '<div class="aba' + (ativo === id ? ' is-on' : '') + '" role="tab" tabindex="0" aria-selected="' + (ativo === id) + '" data-aba="' + esc(id) + '" title="' + esc(nomeBonito(s)) + '">' +
        (carregando ? '<span class="aba__carrega" aria-hidden="true"></span>' : '<span class="aba__ico">' + icone(s) + '</span>') +
        '<span class="aba__nome">' + esc(nomeBonito(s)) + '</span>' +
        '<button type="button" class="aba__x" data-fechar="' + esc(id) + '" aria-label="Fechar ' + esc(nomeBonito(s)) + '">' + ICO.x + '</button>' +
      '</div>';
    });
    abasEl.innerHTML = html;
    if (acoesEl) acoesEl.hidden = !ativo;
    var on = $('.aba.is-on', abasEl);
    if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  if (abasEl) {
    abasEl.addEventListener('click', function (ev) {
      var x = ev.target.closest('[data-fechar]');
      if (x) { ev.stopPropagation(); fechar(x.getAttribute('data-fechar')); return; }
      var a = ev.target.closest('[data-aba]');
      if (a) mostrar(a.getAttribute('data-aba') || null);
    });
    abasEl.addEventListener('keydown', function (ev) {
      var a = ev.target.closest('[data-aba]');
      if (a && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); mostrar(a.getAttribute('data-aba') || null); }
    });
    // botão do meio fecha a aba, como no navegador
    abasEl.addEventListener('auxclick', function (ev) {
      var a = ev.target.closest('[data-aba]');
      if (ev.button === 1 && a && a.getAttribute('data-aba')) { ev.preventDefault(); fechar(a.getAttribute('data-aba')); }
    });
  }

  function mostrar(id) {
    if (id && !quadros[id]) id = null;
    ativo = id;
    if (inicioEl) inicioEl.classList.toggle('is-on', !id);
    Object.keys(quadros).forEach(function (k) { quadros[k].el.classList.toggle('is-on', k === id); });
    $$('.side__item[data-ir-inicio]').forEach(function (b) { b.classList.toggle('is-on', !id); });
    $$('.bi[data-bi]', listaEl).forEach(function (b) { b.classList.toggle('is-on', b.getAttribute('data-bi') === id); });
    montarAbas();
    document.title = (id && porId[id] ? nomeBonito(porId[id]) + ' · ' : '') + 'Lube Distribuidora — Painel de Sistemas';
    app.classList.remove('is-menu');
    if (!id) montarInicio();
  }

  function criarQuadro(s) {
    var el = document.createElement('div');
    el.className = 'quadro';
    el.setAttribute('data-quadro', s.id);
    el.innerHTML =
      '<div class="quadro__carga">' +
        '<span class="quadro__marca">' + (window.LUBE_MARCA ? window.LUBE_MARCA('#1E2B8C', '#EE1B24') : '') + '</span>' +
        '<span class="quadro__barra"><i></i></span>' +
        '<p class="quadro__txt">Abrindo ' + esc(nomeBonito(s)) + '…</p>' +
        '<p class="quadro__sub" data-q-sub></p>' +
        '<div class="quadro__botoes" data-q-botoes hidden>' +
          '<button type="button" class="botao botao--leve" data-q="recarregar">Tentar de novo</button>' +
          '<button type="button" class="botao" data-q="fora">' + ICO.fora + 'Abrir em nova aba</button>' +
        '</div>' +
      '</div>' +
      '<div class="quadro__erro">' +
        '<span class="quadro__erro-ico">' + ICO.alerta + '</span>' +
        '<p class="quadro__txt">Não foi possível entrar em ' + esc(nomeBonito(s)) + ' por aqui.</p>' +
        '<p class="quadro__sub">A entrada pelo painel não foi aceita. Tente de novo ou abra em nova aba. ' +
          'Se continuar, avise o TI.</p>' +
        '<div class="quadro__botoes">' +
          '<button type="button" class="botao botao--leve" data-q="recarregar">Tentar de novo</button>' +
          '<button type="button" class="botao" data-q="fora">' + ICO.fora + 'Abrir em nova aba</button>' +
        '</div>' +
      '</div>';

    var iframe = document.createElement('iframe');
    iframe.title = s.nome;
    iframe.setAttribute('allow', 'clipboard-read; clipboard-write; fullscreen');
    iframe.setAttribute('allowfullscreen', '');
    iframe.setAttribute('referrerpolicy', 'no-referrer');
    el.insertBefore(iframe, el.firstChild);

    var q = { el: el, iframe: iframe, carga: $('.quadro__carga', el), timer: null, tentativas: [] };
    iframe.addEventListener('load', function () {
      if (!iframe.getAttribute('src')) return;
      clearTimeout(q.timer);
      q.carga.classList.add('is-off');
      montarAbas();
    });
    el.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-q]');
      if (!b) return;
      if (b.getAttribute('data-q') === 'fora') abrirFora(s);
      else carregar(s.id);
    });
    quadrosEl.appendChild(el);
    quadros[s.id] = q;
    return q;
  }

  function carregar(id) {
    var s = porId[id], q = quadros[id];
    if (!s || !q || !ctx) return;
    q.el.classList.remove('tem-erro');
    q.carga.classList.remove('is-off');
    $('[data-q-botoes]', q.carga).hidden = true;
    $('[data-q-sub]', q.carga).textContent = '';
    montarAbas();
    clearTimeout(q.timer);
    q.timer = setTimeout(function () {
      $('[data-q-sub]', q.carga).textContent = 'Está demorando mais que o normal. Você pode esperar, tentar de novo ou abrir em nova aba.';
      $('[data-q-botoes]', q.carga).hidden = false;
    }, 20000);
    q.iframe.removeAttribute('src');
    ctx.pedirPasse(s.slug, s.url).then(function (url) {
      if (!quadros[id]) return;                 // fechou enquanto pedia o passe
      q.iframe.src = url || s.url;
    });
  }

  function abrirFora(s) {
    if (ctx && ctx.abrirJanela) ctx.abrirJanela(s);
    else window.open(s.url, '_blank', 'noopener');
  }

  function lembrarRecente(id) {
    var r = ler(chave('recentes'), []).filter(function (x) { return x !== id; });
    r.unshift(id);
    guardar(chave('recentes'), r.slice(0, 12));
  }

  function abrir(id) {
    var s = porId[id];
    if (!s) return;
    if (!s._liberado) { aviso('Você não tem autorização para abrir ' + nomeBonito(s) + '. Peça a liberação ao TI.'); return; }
    lembrarRecente(id);
    if (ctx && ctx.registrar) ctx.registrar('abriu_sistema', id);

    if (!s.abre_no_painel) {
      // sistema ainda não aceita ser mostrado dentro do portal: nova aba, como antes
      abrirFora(s);
      aviso(nomeBonito(s) + ' abriu em uma nova aba.');
      return;
    }
    if (quadros[id]) { mostrar(id); return; }
    abertos.push(id);
    criarQuadro(s);
    mostrar(id);
    carregar(id);
    montarMenu();
  }

  function fechar(id) {
    var q = quadros[id];
    if (!q) return;
    clearTimeout(q.timer);
    q.iframe.src = 'about:blank';
    q.el.remove();
    delete quadros[id];
    var i = abertos.indexOf(id);
    abertos.splice(i, 1);
    if (ativo === id) mostrar(abertos[Math.min(i, abertos.length - 1)] || null);
    else montarAbas();
    montarMenu();
  }

  /* ações do topo */
  if (acoesEl) acoesEl.addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-acao]');
    if (!b || !ativo) return;
    var a = b.getAttribute('data-acao');
    if (a === 'recarregar') carregar(ativo);
    if (a === 'fora') abrirFora(porId[ativo]);
    if (a === 'tela') telaCheia();
  });

  function telaCheia() {
    var el = stage;
    if (document.fullscreenElement) { document.exitFullscreen(); return; }
    if (el && el.requestFullscreen) el.requestFullscreen().catch(function () { app.classList.toggle('is-foco'); });
    else app.classList.toggle('is-foco');
  }
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && app.classList.contains('is-foco')) app.classList.remove('is-foco');
  });

  /* =========================================================
     API para o portal.js
     ========================================================= */
  window.LubeShell = {
    // c: { sb, perfil, icones, lista, favoritos, registrar, pedirPasse, abrirJanela }
    montar: function (c) {
      ctx = c;
      sistemas = (c.lista || []).slice();
      porId = {};
      sistemas.forEach(function (s) {
        porId[s.id] = s;
        s._hay = norm([s.nome, s.categoria, s.descricao, s.slug].join(' '));
      });

      // fixados: o banco manda; o navegador cobre a falta do banco (e a ordem)
      var local = ler(chave('fixos'), []);
      var doBanco = c.favoritos;
      if (doBanco) {
        var ordem = local.filter(function (id) { return doBanco.indexOf(id) > -1; });
        doBanco.forEach(function (id) { if (ordem.indexOf(id) < 0) ordem.push(id); });
        fixos = ordem;
      } else {
        fixos = local;
      }
      fixos = fixos.filter(function (id) { return porId[id] && porId[id]._liberado; });
      guardar(chave('fixos'), fixos);
      areasFechadas = ler(chave('areas_fechadas'), {});

      var adm = $('[data-admin-link]');
      if (adm) adm.hidden = !(c.perfil && c.perfil.is_admin);
      montarConta();
      recolher(ler('lube_menu_recolhido', false));
      montarMenu();
      mostrar(ativo && porId[ativo] ? ativo : null);
    },
    abrir: function (id) { abrir(id); },
    porSlug: function (slug) {
      slug = String(slug || '').toLowerCase();
      return sistemas.filter(function (s) { return String(s.slug || '').toLowerCase() === slug; })[0] || null;
    },
    // um BI aberto aqui voltou para o portal (o guarda não aceitou a entrada):
    // pede um passe novo uma vez; se voltar de novo logo em seguida, mostra o erro
    reentrar: function (slug, janela) {
      var id = null;
      Object.keys(quadros).forEach(function (k) {
        try { if (quadros[k].iframe.contentWindow === janela) id = k; } catch (e) {}
      });
      if (!id && slug) {
        var s = window.LubeShell.porSlug(slug);
        if (s && quadros[s.id]) id = s.id;
      }
      if (!id) return;
      var q = quadros[id];
      var agora = Date.now();
      q.tentativas = q.tentativas.filter(function (t) { return agora - t < 30000; });
      q.tentativas.push(agora);
      if (q.tentativas.length > 1) {
        clearTimeout(q.timer);
        q.iframe.src = 'about:blank';
        q.carga.classList.add('is-off');
        q.el.classList.add('tem-erro');
        montarAbas();
        return;
      }
      carregar(id);
    },
    limpar: function () {
      Object.keys(quadros).forEach(function (k) { fechar(k); });
      ativo = null;
    }
  };

  function montarConta() {
    var conta = $('[data-conta]');
    if (!conta || !ctx || !ctx.perfil) return;
    var p = ctx.perfil;
    var nome = p.nome || p.email.split('@')[0];
    var ini = nome.split(/\s+/).filter(Boolean).slice(0, 2).map(function (x) { return x.charAt(0); }).join('').toUpperCase();
    conta.innerHTML =
      '<span class="conta__avatar" data-dica="' + esc(nome) + '">' + esc(ini || '?') + '</span>' +
      '<span class="conta__info"><span class="conta__nome">' + esc(nome) + '</span>' +
        '<span class="conta__email">' + esc(p.email) + '</span></span>' +
      '<button type="button" class="conta__sair" data-sair title="Sair" aria-label="Sair">' + ICO.sair + '</button>';
  }
})();
