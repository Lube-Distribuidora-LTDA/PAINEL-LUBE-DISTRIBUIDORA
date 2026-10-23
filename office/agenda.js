/* =========================================================
   LUBE OFFICE — Agenda e salas de reunião (2026-10-23)
   A agenda de cada um e as salas de reunião da Lube, no estilo do Google Agenda
   (feita aqui, sem código do Google). Decisões do Júlio:
   - a agenda pessoal é fechada: os colegas só veem as reservas das salas;
   - o convite vai pelo sino do painel e por e-mail (com o convite .ics);
   - todo usuário ativo reserva sala, e a sala ocupada não aceita outra reserva
     no mesmo horário (a trava é do banco). O TI cadastra as salas.
   Quem pode o quê é conferido no servidor (função office); aqui a tela só
   esconde o que a pessoa não pode fazer. O Drive (office.js) chama
   window.OFC_AGENDA quando a visão é "agenda".
   ========================================================= */
(function () {
  'use strict';

  var O = window.OFC, $ = O.$, $$ = O.$$, esc = O.esc;

  var COR_MINHA = '#4D6BFF';
  var HORA_PX = 52;                       // igual ao --ag-hora do agenda.css
  var SEM = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  var SEM_LONGO = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
  var MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  var CORES_SALA = ['#2C3FC4', '#E5101F', '#1FB26B', '#7C4DDB', '#D97706', '#0284C7', '#DB2777', '#0F9488'];
  var RESP = { sim: 'Vai', nao: 'Não vai', talvez: 'Talvez', pendente: 'Sem resposta' };
  var EMAIL_OK = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

  var SVG = {
    esq: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="m15 6-6 6 6 6"/></svg>',
    dir: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="m9 6 6 6-6 6"/></svg>',
    mais: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 5v14M5 12h14"/></svg>',
    relogio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    repetir: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/></svg>',
    sala: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 21V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v16"/><path d="M2 21h20M14 12h.01"/></svg>',
    local: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11Z"/><circle cx="12" cy="10" r="2.5"/></svg>',
    pessoas: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 20a6.5 6.5 0 0 0-3-5.5"/></svg>',
    eu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
    texto: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
    fechar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    lapis: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20h4L19 9l-4-4L4 16Z"/></svg>',
    lixo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>',
    cadeado: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>',
    email: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
    busca: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    engrenagem: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/></svg>',
    agenda: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="4.5" width="18" height="16.5" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/><path d="M8 14h3M8 17.5h6"/></svg>'
  };

  /* ---------- estado ---------- */
  function lerLocal(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function gravarLocal(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function estreito() { return window.matchMedia && matchMedia('(max-width:860px)').matches; }
  function salasOffSalvas() { try { return JSON.parse(lerLocal('agenda_salas_off') || '{}') || {}; } catch (e) { return {}; } }

  var est = {
    raiz: null, eu: null, info: null,
    vista: ['dia', 'semana', 'mes', 'salas'].indexOf(lerLocal('agenda_vista')) > -1 ? lerLocal('agenda_vista') : (estreito() ? 'dia' : 'semana'),
    ref: hoje(), mini: null, dados: null, chave: '', pedido: 0, rolar: true,
    minha: lerLocal('agenda_minha') !== '0', salasOff: salasOffSalvas(),
    pessoas: null, pop: null, sel: null, relogio: null
  };

  /* ---------- datas ---------- */
  function pad(n) { return String(n).padStart(2, '0'); }
  function hoje() { var d = new Date(); d.setHours(0, 0, 0, 0); return d; }
  function dia0(d) { var x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function mais(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function inicioSemana(d) { var x = dia0(d); x.setDate(x.getDate() - x.getDay()); return x; }
  function mesmoDia(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
  function hhmm(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function chaveDia(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function deChave(s, hm) {
    var p = String(s).split('-'), h = String(hm || '00:00').split(':');
    return new Date(+p[0], +p[1] - 1, +p[2], +h[0] || 0, +h[1] || 0);
  }
  function minutosDoDia(d) { return d.getHours() * 60 + d.getMinutes(); }
  function diaTexto(d, comAno) {
    return SEM_LONGO[d.getDay()] + ', ' + d.getDate() + ' de ' + MESES[d.getMonth()] + (comAno ? ' de ' + d.getFullYear() : '');
  }
  function curto(d) { return SEM[d.getDay()] + ', ' + pad(d.getDate()) + '/' + pad(d.getMonth() + 1); }

  function periodo() {
    var r = dia0(est.ref);
    if (est.vista === 'semana') { var s = inicioSemana(r); return { de: s, ate: mais(s, 7) }; }
    if (est.vista === 'mes') {
      var p = new Date(r.getFullYear(), r.getMonth(), 1), g = inicioSemana(p);
      return { de: g, ate: mais(g, 42) };
    }
    return { de: r, ate: mais(r, 1) };
  }
  function tituloPeriodo() {
    var r = est.ref;
    if (est.vista === 'mes') return MESES[r.getMonth()] + ' de ' + r.getFullYear();
    if (est.vista === 'semana') {
      var a = inicioSemana(r), b = mais(a, 6);
      if (a.getMonth() === b.getMonth()) return a.getDate() + ' – ' + b.getDate() + ' de ' + MESES[b.getMonth()] + ' de ' + b.getFullYear();
      if (a.getFullYear() === b.getFullYear()) return a.getDate() + ' de ' + MESES[a.getMonth()] + ' – ' + b.getDate() + ' de ' + MESES[b.getMonth()] + ' de ' + b.getFullYear();
      return a.getDate() + ' de ' + MESES[a.getMonth()] + ' de ' + a.getFullYear() + ' – ' + b.getDate() + ' de ' + MESES[b.getMonth()] + ' de ' + b.getFullYear();
    }
    return diaTexto(r, true) + (est.vista === 'salas' ? ' · salas' : '');
  }

  // "sexta-feira, 23 de outubro · 14:00 – 15:00"
  function quandoTxt(e) {
    var a = new Date(e.inicio), b = new Date(e.fim);
    if (e.dia_inteiro) {
      var ult = new Date(b.getTime() - 1000);
      return mesmoDia(a, ult) ? diaTexto(a) + ' · dia todo' : diaTexto(a) + ' até ' + diaTexto(ult) + ' · dia todo';
    }
    return mesmoDia(a, b) ? diaTexto(a) + ' · ' + hhmm(a) + ' – ' + hhmm(b)
      : diaTexto(a) + ', ' + hhmm(a) + ' até ' + diaTexto(b) + ', ' + hhmm(b);
  }
  function repeteTxt(rep) {
    if (!rep || !rep.freq) return '';
    var n = { dia: 'Todo dia', dia_util: 'Todo dia útil', semana: 'Toda semana', mes: 'Todo mês' }[rep.freq] || 'Repete';
    var p = String(rep.ate || '').split('-');
    return n + (p.length === 3 ? ', até ' + p[2] + '/' + p[1] + '/' + p[0] : '');
  }
  function maiuscula(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }
  function erroTxt(e) { return maiuscula(e && e.message ? e.message : String(e)); }

  /* ---------- carregar ---------- */
  function carregar(forcar) {
    var p = periodo();
    var chave = est.vista + '|' + p.de.toISOString();
    if (!forcar && chave === est.chave && est.dados) { desenhar(); return Promise.resolve(); }
    var n = ++est.pedido;
    est.raiz.classList.add('is-carregando');
    if (chave !== est.chave) est.rolar = true;
    est.chave = chave;
    desenharBarra();
    return O.api('agenda', { de: p.de.toISOString(), ate: p.ate.toISOString() }).then(function (r) {
      if (n !== est.pedido) return;
      est.dados = r;
      est.raiz.classList.remove('is-carregando');
      desenhar();
    }, function (e) {
      if (n !== est.pedido) return;
      est.raiz.classList.remove('is-carregando');
      $('[data-ag-grade]', est.raiz).innerHTML = '<div class="ag-salas__vazio">' + SVG.agenda +
        '<h3>A agenda não abriu agora</h3><p>' + esc(erroTxt(e)) + '</p><button class="btn" type="button" data-ag-recarregar>Tentar de novo</button></div>';
    });
  }

  function salas() { return (est.dados && est.dados.salas) || []; }
  function salasAtivas() { return salas().filter(function (s) { return s.ativa; }); }
  function admin() { return !!(est.dados && est.dados.admin); }
  function eventos() { return (est.dados && est.dados.eventos) || []; }
  function euId() { return est.eu && est.eu.pessoa ? est.eu.pessoa.id : null; }

  // o que aparece na grade: a minha agenda e as salas marcadas na coluna da esquerda
  function visiveis() {
    return eventos().filter(function (e) {
      if (e.eu && est.minha) return true;
      return !!(e.sala && !est.salasOff[e.sala.id]);
    });
  }
  function eMinha(e) { return !!(e.eu && est.minha); }
  function corDe(e) { return eMinha(e) ? COR_MINHA : (e.sala ? e.sala.cor : COR_MINHA); }
  function classeEv(e) {
    var c = eMinha(e) ? '' : ' ag-ev--sala';
    if (eMinha(e) && e.eu === 'convidado') {
      if (e.minha_resposta === 'nao') c += ' ag-ev--recusou';
      else if (e.minha_resposta === 'pendente') c += ' ag-ev--pendente';
    }
    return c;
  }
  function rotuloEv(e) {
    if (est.vista === 'salas') return e.eu === 'dono' ? 'você' : (e.dono ? e.dono.nome : '');
    if (eMinha(e)) return e.sala ? e.sala.nome : (e.local || '');
    return (e.sala ? e.sala.nome + ' · ' : '') + (e.dono ? O.primeiroNome(e.dono.nome) : '');
  }

  /* ---------- montagem ---------- */
  function montar() {
    var r = $('[data-secao-agenda]');
    r.innerHTML =
      '<div class="ag">' +
        '<aside class="ag-lado">' +
          '<button class="ag-nova" type="button" data-ag-nova>' + SVG.mais + 'Nova reunião</button>' +
          '<div class="ag-mini" data-ag-mini></div>' +
          '<div class="ag-camadas" data-ag-camadas></div>' +
        '</aside>' +
        '<div class="ag-principal">' +
          '<div class="ag-barra">' +
            '<button class="btn" type="button" data-ag-hoje>Hoje</button>' +
            '<div class="ag-setas"><button type="button" data-ag-passo="-1" aria-label="Anterior">' + SVG.esq + '</button>' +
            '<button type="button" data-ag-passo="1" aria-label="Próximo">' + SVG.dir + '</button></div>' +
            '<h2 class="ag-titulo" data-ag-titulo></h2>' +
            '<div class="ag-vistas" role="group" aria-label="Como ver">' +
              '<button type="button" data-ag-vista="dia">Dia</button><button type="button" data-ag-vista="semana">Semana</button>' +
              '<button type="button" data-ag-vista="mes">Mês</button><button type="button" data-ag-vista="salas">Salas</button>' +
            '</div>' +
            '<button class="ag-nova ag-nova--barra" type="button" data-ag-nova>' + SVG.mais + 'Reunião</button>' +
          '</div>' +
          '<div class="ag-grade" data-ag-grade></div>' +
        '</div>' +
      '</div>';
    est.raiz = r;
    ligar();
  }

  function desenharBarra() {
    $('[data-ag-titulo]', est.raiz).textContent = maiuscula(tituloPeriodo());
    $$('[data-ag-vista]', est.raiz).forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-ag-vista') === est.vista)); });
    document.title = 'Agenda — LUBE OFFICE';
  }

  function desenhar() {
    desenharBarra();
    desenharMini();
    desenharCamadas();
    if (est.vista === 'mes') desenharMes();
    else if (est.vista === 'salas') desenharSalas();
    else desenharDias(est.vista === 'dia' ? [dia0(est.ref)] : diasDaSemana());
    marcarAgora();
  }
  function diasDaSemana() { var s = inicioSemana(est.ref), l = []; for (var i = 0; i < 7; i++) l.push(mais(s, i)); return l; }

  /* ---------- mês pequeno ---------- */
  function desenharMini() {
    var m = est.mini || new Date(est.ref.getFullYear(), est.ref.getMonth(), 1);
    est.mini = m;
    var g = inicioSemana(m), h = hoje(), comEvento = {};
    visiveis().forEach(function (e) { comEvento[chaveDia(new Date(e.inicio))] = true; });
    var html = '<div class="ag-mini__topo"><strong>' + MESES[m.getMonth()] + ' ' + m.getFullYear() + '</strong><span>' +
      '<button type="button" data-ag-mini="-1" aria-label="Mês anterior">' + SVG.esq + '</button>' +
      '<button type="button" data-ag-mini="1" aria-label="Próximo mês">' + SVG.dir + '</button></span></div><div class="ag-mini__grade">';
    SEM.forEach(function (s) { html += '<span>' + s.charAt(0).toUpperCase() + '</span>'; });
    for (var i = 0; i < 42; i++) {
      var d = mais(g, i), k = chaveDia(d);
      var cls = (d.getMonth() !== m.getMonth() ? ' is-fora' : '') + (mesmoDia(d, h) ? ' is-hoje' : mesmoDia(d, est.ref) ? ' is-sel' : '') + (comEvento[k] ? ' tem' : '');
      html += '<button type="button" class="' + cls.trim() + '" data-ag-ir="' + k + '" aria-label="' + esc(diaTexto(d, true)) + '">' + d.getDate() + '</button>';
    }
    $('[data-ag-mini]', est.raiz).innerHTML = html + '</div>';
  }

  /* ---------- camadas: minha agenda e as salas ---------- */
  function desenharCamadas() {
    var h = '<span class="mono">Agendas</span>' +
      '<label class="ag-camada" style="--c:' + COR_MINHA + '"><input type="checkbox" data-ag-camada="minha"' + (est.minha ? ' checked' : '') + '><i></i>' +
      '<span>Minha agenda</span></label>' +
      '<span class="mono">Salas de reunião</span>';
    var lista = salas();
    if (!lista.length) {
      h += '<p class="ag-camadas__vazio">' + (admin() ? 'Nenhuma sala cadastrada. Cadastre as salas para todo mundo reservar.' : 'O TI ainda não cadastrou as salas de reunião.') + '</p>';
    }
    lista.forEach(function (s) {
      h += '<label class="ag-camada" style="--c:' + esc(s.cor) + '"><input type="checkbox" data-ag-camada="' + esc(s.id) + '"' + (est.salasOff[s.id] ? '' : ' checked') + '><i></i>' +
        '<span>' + esc(s.nome) + '</span>' + (s.ativa ? (s.capacidade ? '<em>' + s.capacidade + ' lug.</em>' : '') : '<em>desativada</em>') + '</label>';
    });
    if (admin()) h += '<button class="ag-gerir" type="button" data-ag-gerir>' + SVG.engrenagem + 'Cadastrar e editar salas</button>';
    $('[data-ag-camadas]', est.raiz).innerHTML = h;
  }

  /* ---------- grade de horas ---------- */
  function linhasHoras() {
    var h = '<div class="ag-horas">';
    for (var i = 1; i < 24; i++) h += '<span style="top:' + (i * HORA_PX) + 'px">' + pad(i) + ':00</span>';
    return h + '</div>';
  }
  // reuniões que se cruzam dividem a largura (como no Google Agenda)
  function lado(evs) {
    evs.sort(function (a, b) { return a._a - b._a || b._b - a._b; });
    var grupo = [], fimGrupo = -1, cols = [];
    function fechar() { grupo.forEach(function (x) { x._n = cols.length; }); grupo = []; cols = []; }
    evs.forEach(function (e) {
      if (e._a >= fimGrupo) fechar();
      var c = 0;
      while (c < cols.length && cols[c] > e._a) c++;
      cols[c] = e._b;
      e._c = c;
      grupo.push(e);
      fimGrupo = Math.max(fimGrupo, e._b);
    });
    fechar();
    return evs;
  }
  function blocoEv(e, inicioDia, i) {
    var a = Math.max(0, (new Date(e.inicio) - inicioDia) / 60000), b = Math.min(1440, (new Date(e.fim) - inicioDia) / 60000);
    var top = a * HORA_PX / 60, alt = Math.max(18, (b - a) * HORA_PX / 60 - 2);
    var largura = 100 / e._n, esquerda = e._c * largura;
    var curto = alt < 34;
    var ini = new Date(e.inicio);
    return '<button type="button" class="ag-ev' + classeEv(e) + (curto ? ' ag-ev--curto' : '') + '" data-ag-ev="' + esc(e.id) + '" style="--c:' + esc(corDe(e)) +
      ';top:' + top + 'px;height:' + alt + 'px;left:calc(' + esquerda + '% + 3px);width:calc(' + largura + '% - 6px);animation-delay:' + (i * 25) + 'ms">' +
      '<strong>' + (e.particular && e.eu ? SVG.cadeado.replace('<svg ', '<svg width="11" style="vertical-align:-1px;margin-right:3px" ') : '') + esc(e.titulo) + '</strong>' +
      '<span>' + hhmm(ini) + (curto ? '' : ' – ' + hhmm(new Date(e.fim))) + (rotuloEv(e) ? ' · ' + esc(rotuloEv(e)) : '') + '</span></button>';
  }
  function chip(e) {
    var cls = eMinha(e) ? '' : ' ag-chip--sala';
    return '<button type="button" class="ag-chip' + cls + '" data-ag-ev="' + esc(e.id) + '" style="--c:' + esc(corDe(e)) + '">' +
      (e.dia_inteiro ? '' : '<small>' + hhmm(new Date(e.inicio)) + '</small>') + '<b>' + esc(e.titulo) + '</b></button>';
  }
  function longo(e) { return e.dia_inteiro || (new Date(e.fim) - new Date(e.inicio)) >= 86400000; }

  // colunas: dias (dia e semana) ou salas (visão das salas)
  function grade(colunas, cab, cheios) {
    var salasV = est.vista === 'salas';
    var tpl = 'grid-template-columns:56px repeat(' + colunas.length + ', minmax(' + (salasV ? '140px' : '0') + ',1fr))' +
      (salasV ? ';min-width:' + (56 + colunas.length * 140) + 'px' : '');
    var h = '<div class="ag-cab" style="' + tpl + '"><div></div>' + cab + '</div>';
    if (cheios) h += '<div class="ag-diatodo" style="' + tpl + '"><div class="ag-diatodo__rot">DIA TODO</div>' + cheios + '</div>';
    h += '<div class="ag-corpo" data-ag-corpo' + (salasV ? ' style="min-width:' + (56 + colunas.length * 140) + 'px"' : '') + '>' +
      '<div class="ag-linhas" style="' + tpl + ';height:' + (24 * HORA_PX) + 'px">' + linhasHoras();
    colunas.forEach(function (c) { h += c; });
    return h + '</div></div>';
  }

  function desenharDias(dias) {
    var hj = hoje(), vis = visiveis(), cab = '', cheios = '', cols = [], temCheio = false, i = 0;
    dias.forEach(function (d) {
      var fimDia = mais(d, 1);
      var doDia = vis.filter(function (e) { return new Date(e.inicio) < fimDia && new Date(e.fim) > d; });
      var cheiosDia = doDia.filter(longo), horas = doDia.filter(function (e) { return !longo(e); });
      if (cheiosDia.length) temCheio = true;
      var fds = d.getDay() === 0 || d.getDay() === 6;
      cab += '<div class="ag-cab__dia' + (mesmoDia(d, hj) ? ' is-hoje' : '') + '"><span class="mono">' + SEM[d.getDay()] + '</span>' +
        '<strong data-ag-ir-dia="' + chaveDia(d) + '" title="Ver o dia">' + d.getDate() + '</strong></div>';
      cheios += '<div class="ag-diatodo__col">' + cheiosDia.map(chip).join('') + '</div>';
      horas.forEach(function (e) { e._a = new Date(e.inicio) - d; e._b = new Date(e.fim) - d; });
      cols.push('<div class="ag-col' + (mesmoDia(d, hj) ? ' is-hoje' : '') + (fds ? ' is-fds' : '') + '" data-ag-col="' + chaveDia(d) + '">' +
        lado(horas).map(function (e) { return blocoEv(e, d, i++); }).join('') + '</div>');
    });
    var g = $('[data-ag-grade]', est.raiz);
    g.classList.remove('is-salas');
    g.innerHTML = grade(cols, cab, temCheio ? cheios : '');
    rolarInicio();
  }

  function desenharSalas() {
    var g = $('[data-ag-grade]', est.raiz);
    var lista = salasAtivas().filter(function (s) { return !est.salasOff[s.id]; });
    if (!salasAtivas().length) {
      g.innerHTML = '<div class="ag-salas__vazio">' + SVG.sala + '<h3>Nenhuma sala de reunião cadastrada</h3>' +
        '<p>' + (admin() ? 'Cadastre as salas da Lube e todo mundo passa a ver quando cada uma está ocupada.' : 'Peça ao TI para cadastrar as salas de reunião da Lube.') + '</p>' +
        (admin() ? '<button class="btn btn--azul" type="button" data-ag-gerir>' + SVG.mais + 'Cadastrar salas</button>' : '') + '</div>';
      return;
    }
    if (!lista.length) {
      g.innerHTML = '<div class="ag-salas__vazio">' + SVG.sala + '<h3>Todas as salas estão escondidas</h3><p>Marque as salas na coluna da esquerda para vê-las aqui.</p></div>';
      return;
    }
    var d = dia0(est.ref), fimDia = mais(d, 1), agora = new Date(), ehHoje = mesmoDia(d, hoje()), cab = '', cols = [], i = 0;
    lista.forEach(function (s) {
      var daSala = eventos().filter(function (e) { return e.sala && e.sala.id === s.id && new Date(e.inicio) < fimDia && new Date(e.fim) > d; });
      var estado;
      if (ehHoje) {
        var atual = daSala.filter(function (e) { return new Date(e.inicio) <= agora && new Date(e.fim) > agora; })[0];
        estado = atual ? '<span class="ag-estado ag-estado--ocupada">Ocupada até ' + hhmm(new Date(atual.fim)) + '</span>'
          : '<span class="ag-estado ag-estado--livre">Livre agora</span>';
      } else {
        estado = '<span class="ag-estado ' + (daSala.length ? 'ag-estado--ocupada' : 'ag-estado--livre') + '">' +
          (daSala.length ? daSala.length + (daSala.length === 1 ? ' reserva' : ' reservas') : 'Livre o dia todo') + '</span>';
      }
      cab += '<div class="ag-cab__sala" style="--c:' + esc(s.cor) + '"><b><i></i><span>' + esc(s.nome) + '</span></b>' +
        '<small>' + esc([s.local, s.capacidade ? s.capacidade + ' lugares' : '', s.recursos].filter(Boolean).join(' · ') || 'Sala de reunião') + '</small>' + estado + '</div>';
      daSala.forEach(function (e) { e._a = Math.max(0, new Date(e.inicio) - d); e._b = Math.min(86400000, new Date(e.fim) - d); });
      cols.push('<div class="ag-col' + (ehHoje ? ' is-hoje' : '') + '" data-ag-col="' + chaveDia(d) + '" data-ag-sala="' + esc(s.id) + '">' +
        lado(daSala).map(function (e) { return blocoEv(e, d, i++); }).join('') + '</div>');
    });
    g.classList.add('is-salas');
    g.innerHTML = grade(cols, cab, '');
    rolarInicio();
  }

  function rolarInicio() {
    var c = $('[data-ag-corpo]', est.raiz);
    if (!c) return;
    if (est.rolar) {
      // abre no começo do expediente (07:00); de noite, perto da hora de agora
      var alvo = 7 * HORA_PX - 12;
      var p = periodo(), agora = new Date();
      if (agora >= p.de && agora < p.ate && agora.getHours() >= 18) alvo = Math.max(alvo, (minutosDoDia(agora) - 8 * 60) * HORA_PX / 60);
      c.scrollTop = alvo;
      est.rolar = false;
    } else if (est.scroll != null) {
      c.scrollTop = est.scroll;
    }
  }
  function marcarAgora() {
    $$('.ag-agora', est.raiz).forEach(function (x) { x.remove(); });
    var agora = new Date(), k = chaveDia(agora);
    $$('.ag-col[data-ag-col="' + k + '"]', est.raiz).forEach(function (col) {
      var l = document.createElement('i');
      l.className = 'ag-agora';
      l.style.top = (minutosDoDia(agora) * HORA_PX / 60) + 'px';
      col.appendChild(l);
    });
  }

  /* ---------- mês ---------- */
  function desenharMes() {
    var p = periodo(), hj = hoje(), vis = visiveis(), m = est.ref.getMonth();
    var h = '<div class="ag-mes">';
    SEM.forEach(function (s) { h += '<div class="ag-mes__sem">' + s.toUpperCase() + '</div>'; });
    for (var i = 0; i < 42; i++) {
      var d = mais(p.de, i), fim = mais(d, 1);
      var doDia = vis.filter(function (e) { return new Date(e.inicio) < fim && new Date(e.fim) > d; })
        .sort(function (a, b) { return (longo(b) - longo(a)) || (new Date(a.inicio) - new Date(b.inicio)); });
      h += '<div class="ag-mes__dia' + (d.getMonth() !== m ? ' is-fora' : '') + (mesmoDia(d, hj) ? ' is-hoje' : '') + '" data-ag-mes-dia="' + chaveDia(d) + '">' +
        '<span class="ag-mes__n" data-ag-ir-dia="' + chaveDia(d) + '">' + d.getDate() + '</span>' +
        doDia.slice(0, 3).map(function (e) { return longo(e) ? chip(e) : chip(e).replace('class="ag-chip', 'class="ag-chip ag-chip--ponto'); }).join('') +
        (doDia.length > 3 ? '<button type="button" class="ag-mes__mais" data-ag-ir-dia="' + chaveDia(d) + '">+ ' + (doDia.length - 3) + ' mais</button>' : '') +
        '</div>';
    }
    var g = $('[data-ag-grade]', est.raiz);
    g.classList.remove('is-salas');
    g.innerHTML = h + '</div>';
  }

  /* ---------- navegar ---------- */
  function irPara(d, vista) {
    est.ref = dia0(d);
    est.mini = new Date(est.ref.getFullYear(), est.ref.getMonth(), 1);
    if (vista) { est.vista = vista; gravarLocal('agenda_vista', vista); }
    fecharPop();
    carregar();
  }
  function passo(n) {
    var d = new Date(est.ref);
    if (est.vista === 'semana') d = mais(d, 7 * n);
    else if (est.vista === 'mes') d = new Date(d.getFullYear(), d.getMonth() + n, 1);
    else d = mais(d, n);
    irPara(d);
  }

  /* ---------- arrastar na grade para marcar ---------- */
  function minutoNa(col, y) {
    var r = col.getBoundingClientRect();
    return Math.max(0, Math.min(1440, Math.round(((y - r.top) / HORA_PX * 60) / 15) * 15));
  }
  function ligarGrade() {
    var g = $('[data-ag-grade]', est.raiz);
    g.addEventListener('pointerdown', function (ev) {
      if (ev.button !== 0 || ev.pointerType === 'touch') return;
      var col = ev.target.closest('.ag-col');
      if (!col || ev.target.closest('.ag-ev')) return;
      ev.preventDefault();
      fecharPop();
      var m0 = Math.min(1425, Math.floor(minutoNa(col, ev.clientY) / 15) * 15);
      var el = document.createElement('div');
      el.className = 'ag-selecao';
      col.appendChild(el);
      est.sel = { col: col, m0: m0, m1: m0 + 60, el: el, mexeu: false };
      desenharSel();
      g.setPointerCapture(ev.pointerId);
    });
    g.addEventListener('pointermove', function (ev) {
      var s = est.sel;
      if (!s) return;
      var m = minutoNa(s.col, ev.clientY);
      if (Math.abs(m - s.m0) >= 15) s.mexeu = true;
      if (!s.mexeu) return;
      s.m1 = m;
      desenharSel();
    });
    function soltar() {
      var s = est.sel;
      if (!s) return;
      est.sel = null;
      var a = Math.min(s.m0, s.m1), b = Math.max(s.m0, s.m1);
      if (b - a < 15) b = a + (s.mexeu ? 15 : 60);
      var dia = deChave(s.col.getAttribute('data-ag-col'));
      var ini = new Date(dia.getTime() + a * 60000), fim = new Date(dia.getTime() + Math.min(b, 1440) * 60000);
      setTimeout(function () { if (s.el.parentNode) s.el.remove(); }, 250);
      formulario(null, { inicio: ini, fim: fim, sala: s.col.getAttribute('data-ag-sala') || null });
    }
    g.addEventListener('pointerup', soltar);
    g.addEventListener('pointercancel', function () { if (est.sel) { est.sel.el.remove(); est.sel = null; } });
    // celular: um toque marca uma hora a partir dali
    g.addEventListener('click', function (ev) {
      if (ev.pointerType !== 'touch' && !(ev.sourceCapabilities && ev.sourceCapabilities.firesTouchEvents)) return;
      var col = ev.target.closest('.ag-col');
      if (!col || ev.target.closest('.ag-ev')) return;
      var m = Math.floor(minutoNa(col, ev.clientY) / 30) * 30, dia = deChave(col.getAttribute('data-ag-col'));
      formulario(null, { inicio: new Date(dia.getTime() + m * 60000), fim: new Date(dia.getTime() + (m + 60) * 60000), sala: col.getAttribute('data-ag-sala') || null });
    });
  }
  function desenharSel() {
    var s = est.sel, a = Math.min(s.m0, s.m1), b = Math.max(s.m0, s.m1);
    if (b - a < 15) b = a + 15;
    s.el.style.top = (a * HORA_PX / 60) + 'px';
    s.el.style.height = ((b - a) * HORA_PX / 60 - 2) + 'px';
    var d = deChave(s.col.getAttribute('data-ag-col'));
    s.el.textContent = hhmm(new Date(d.getTime() + a * 60000)) + ' – ' + hhmm(new Date(d.getTime() + b * 60000));
  }

  /* ---------- detalhe da reunião ---------- */
  function eventoPorId(id) { return eventos().filter(function (e) { return e.id === id; })[0] || null; }
  function fecharPop() { if (est.pop) { est.pop.remove(); est.pop = null; } }

  function abrirPop(e, ancora) {
    fecharPop();
    var p = document.createElement('div');
    p.className = 'ag-pop';
    p.setAttribute('role', 'dialog');
    p.setAttribute('aria-label', e.titulo);
    p.style.setProperty('--c', corDe(e));
    document.body.appendChild(p);
    est.pop = p;
    preencherPop(p, e, null);
    posicionar(p, ancora);
    O.api('evento', { id: e.id }).then(function (d) {
      if (est.pop !== p) return;
      preencherPop(p, d, d);
      posicionar(p, ancora);
    }, function (err) {
      if (est.pop !== p) return;
      if (err.status === 404) { fecharPop(); O.toast('Essa reunião não existe mais ou foi cancelada.', 'erro'); carregar(true); }
    });
  }
  function posicionar(p, ancora) {
    if (estreito() || !ancora) return;
    var r = ancora.getBoundingClientRect(), w = p.offsetWidth, h = p.offsetHeight;
    var x = r.right + 10;
    if (x + w > window.innerWidth - 12) x = r.left - w - 10;
    if (x < 12) x = Math.max(12, Math.min(window.innerWidth - w - 12, r.left));
    var y = Math.max(12, Math.min(window.innerHeight - h - 12, r.top - 20));
    p.style.left = x + 'px';
    p.style.top = y + 'px';
  }
  function pessoaHtml(c) {
    var p = c.pessoa, ok = c.email_em ? ' is-ok' : c.email_erro ? ' is-erro' : '';
    var mail = (c.email_em || c.email_erro)
      ? '<span class="ag-email' + ok + '" title="' + esc(c.email_erro ? 'O e-mail não saiu: ' + c.email_erro : 'Convite enviado por e-mail') + '">' + SVG.email + '</span>' : '';
    var av = p ? O.avatar(p, 'p') : '<span class="av av--p ag-av-email" title="' + esc(c.email) + '">@</span>';
    return '<div class="ag-pessoa">' + av + '<span>' + esc(p ? (p.id === euId() ? p.nome + ' (você)' : p.nome) : c.email) + '</span>' + mail +
      '<em class="ag-r--' + esc(c.resposta) + '">' + esc(RESP[c.resposta] || c.resposta) + '</em></div>';
  }
  function histTxt(h) {
    var quem = h.pessoa ? (h.pessoa.id === euId() ? 'Você' : h.pessoa.nome) : 'Alguém';
    var d = h.detalhe || {};
    var o = {
      criou_evento: 'marcou a reunião' + (d.ocorrencias > 1 ? ' (' + d.ocorrencias + ' datas)' : ''),
      alterou_evento: 'mudou ' + (d.escopo === 'serie' ? 'esta e as próximas' : 'a reunião') + (d.horario ? ' (horário)' : ''),
      cancelou_evento: 'cancelou ' + (d.escopo === 'serie' ? 'esta e as próximas' : 'a reunião'),
      respondeu: 'respondeu “' + (RESP[d.resposta] || d.resposta) + '”',
      convite_email: 'convite por e-mail: ' + (d.enviados || 0) + ' enviado(s)' + (d.falhas ? ', ' + d.falhas + ' falha(s)' : '')
    }[h.acao] || h.acao;
    return '<li><b>' + esc(quem) + '</b> ' + esc(o) + ' · ' + esc(O.quando(h.em)) + '</li>';
  }

  function preencherPop(p, e, det) {
    var cancelada = !!e.cancelado_em;
    var dono = e.eu === 'dono' && !cancelada, convidado = e.eu === 'convidado' && !cancelada;
    var h = '<div class="ag-pop__faixa"></div><div class="ag-pop__topo"><h3>' + esc(e.titulo) + '</h3>' +
      '<button class="ag-pop__x" type="button" data-ag-pop-fechar aria-label="Fechar">' + SVG.fechar + '</button></div><div class="ag-pop__corpo">';
    if (cancelada) h += '<div class="ag-pop__linha" style="color:#FF8A91">' + SVG.lixo + '<div>Esta reunião foi cancelada.</div></div>';
    h += '<div class="ag-pop__linha">' + SVG.relogio + '<div>' + esc(maiuscula(quandoTxt(e))) +
      (e.repeticao ? '<small>' + esc(repeteTxt(e.repeticao)) + '</small>' : '') + '</div></div>';
    if (e.sala) {
      h += '<div class="ag-pop__linha">' + SVG.sala + '<div>' + esc(e.sala.nome) +
        '<small>' + esc([e.sala.local, e.sala.capacidade ? e.sala.capacidade + ' lugares' : '', e.sala.recursos].filter(Boolean).join(' · ')) + '</small></div></div>';
    }
    if (e.local) h += '<div class="ag-pop__linha">' + SVG.local + '<div>' + esc(e.local) + '</div></div>';
    if (e.dono) {
      h += '<div class="ag-pop__linha">' + SVG.eu + '<div>' + (e.eu === 'dono' ? 'Você marcou' : 'Marcada por ' + esc(e.dono.nome)) +
        (e.particular ? '<small>' + SVG.cadeado.replace('<svg ', '<svg width="11" style="vertical-align:-1px" ') + ' Particular: na agenda da sala, quem não foi convidado vê só “Reservada”.</small>' : '') + '</div></div>';
    }
    if (e.convidados && e.convidados.length) {
      var cont = { sim: 0, nao: 0, talvez: 0, pendente: 0 };
      e.convidados.forEach(function (c) { cont[c.resposta] = (cont[c.resposta] || 0) + 1; });
      h += '<div class="ag-pop__linha">' + SVG.pessoas + '<div style="flex:1;min-width:0"><div>' + e.convidados.length +
        (e.convidados.length === 1 ? ' convidado' : ' convidados') + '<small>' + cont.sim + ' vão · ' + cont.nao + ' não vão · ' + cont.talvez + ' talvez · ' +
        cont.pendente + ' sem resposta</small></div><div class="ag-pessoas" style="margin-top:.5rem">' + e.convidados.map(pessoaHtml).join('') + '</div></div></div>';
    } else if (!e.eu && e.n_convidados) {
      h += '<div class="ag-pop__linha">' + SVG.pessoas + '<div>' + e.n_convidados + (e.n_convidados === 1 ? ' pessoa' : ' pessoas') + '</div></div>';
    }
    if (e.descricao) h += '<div class="ag-pop__desc">' + esc(e.descricao) + '</div>';
    if (!e.eu) {
      h += '<div class="ag-pop__linha">' + SVG.cadeado + '<div><small>Você vê esta reunião porque ela usa uma sala. Os detalhes ficam só com quem participa.</small></div></div>';
    }
    if (convidado) {
      h += '<div class="ag-resp"><span class="mono" style="color:var(--muted)">Você vai?</span><div class="ag-resp__botoes">' +
        ['sim', 'nao', 'talvez'].map(function (r) {
          return '<button type="button" data-resp="' + r + '" aria-pressed="' + String(e.minha_resposta === r) + '">' + { sim: 'Sim', nao: 'Não', talvez: 'Talvez' }[r] + '</button>';
        }).join('') + '</div>' + (e.serie ? escopoHtml('resp') : '') + '</div>';
    }
    var podeCancelar = !cancelada && (det ? det.pode_cancelar : dono);
    if (dono || podeCancelar) {
      h += '<div class="ag-pop__acoes">' +
        (podeCancelar ? '<button class="btn btn--perigo" type="button" data-ag-cancelar>' + SVG.lixo + (dono ? 'Cancelar reunião' : 'Cancelar reserva') + '</button>' : '') +
        (dono ? '<button class="btn btn--azul" type="button" data-ag-editar>' + SVG.lapis + 'Editar</button>' : '') + '</div>';
    }
    if (det && det.historico && det.historico.length) {
      h += '<details class="ag-hist"><summary>' + SVG.dir + 'Histórico (quem marcou, mudou e respondeu)</summary><ol>' +
        det.historico.map(histTxt).join('') + '</ol></details>';
    }
    p.innerHTML = h + '</div>';
    p._e = e;
  }
  function escopoHtml(nome, marcado) {
    return '<div class="ag-escopo" role="radiogroup">' +
      '<label><input type="radio" name="ag-esc-' + nome + '" value="este"' + (marcado === 'serie' ? '' : ' checked') + '>Só esta</label>' +
      '<label><input type="radio" name="ag-esc-' + nome + '" value="serie"' + (marcado === 'serie' ? ' checked' : '') + '>Esta e as próximas</label></div>';
  }
  function escopoDe(raiz, nome) {
    var r = $('input[name="ag-esc-' + nome + '"]:checked', raiz);
    return r ? r.value : 'este';
  }

  function responder(e, resposta) {
    var escopo = escopoDe(est.pop, 'resp');
    $$('[data-resp]', est.pop).forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-resp') === resposta)); });
    O.api('evento_responder', { id: e.id, resposta: resposta, escopo: escopo }).then(function () {
      O.toast('Resposta “' + { sim: 'Sim', nao: 'Não', talvez: 'Talvez' }[resposta] + '” enviada para ' + (e.dono ? O.primeiroNome(e.dono.nome) : 'quem marcou') + '.');
      carregar(true);
    }, function (err) { O.toast(erroTxt(err), 'erro'); });
  }

  function confirmarCancelar(e) {
    var d = $('[data-dialogo]');
    d.className = 'dialogo';
    var dono = e.eu === 'dono';
    d.innerHTML = '<form method="dialog">' +
      '<div class="dialogo__topo">' + SVG.lixo.replace('<svg ', '<svg width="40" style="color:#FF8A91;flex:none" ') +
      '<div><h2>' + (dono ? 'Cancelar “' + esc(e.titulo) + '”?' : 'Cancelar a reserva da sala?') + '</h2></div></div>' +
      '<p>' + (dono ? 'Quem foi convidado recebe o aviso no sino e o e-mail de cancelamento, que tira a reunião da agenda.'
        : 'A reserva de ' + esc(e.dono ? e.dono.nome : 'outra pessoa') + ' em ' + esc(e.sala ? e.sala.nome : 'uma sala') + ' será cancelada, e ' +
          esc(e.dono ? O.primeiroNome(e.dono.nome) : 'quem marcou') + ' recebe o aviso.') + ' Nada se apaga: fica no histórico.</p>' +
      (e.serie ? escopoHtml('canc') : '') +
      '<p class="dialogo__erro" data-dlg-erro></p>' +
      '<div class="dialogo__acoes"><button class="btn" type="button" data-dlg-cancelar>Voltar</button>' +
      '<button class="btn btn--prim" type="submit">' + SVG.lixo + 'Cancelar ' + (dono ? 'reunião' : 'reserva') + '</button></div></form>';
    $('[data-dlg-cancelar]', d).addEventListener('click', function () { d.close(); });
    $('form', d).addEventListener('submit', function (ev) {
      ev.preventDefault();
      var b = $('[type="submit"]', d);
      b.disabled = true;
      O.api('evento_cancelar', { id: e.id, escopo: escopoDe(d, 'canc') }).then(function (r) {
        d.close();
        fecharPop();
        O.toast((r.cancelados > 1 ? r.cancelados + ' datas canceladas.' : 'Reunião cancelada.') + emailTxt(r.email));
        carregar(true);
      }, function (err) { b.disabled = false; $('[data-dlg-erro]', d).textContent = erroTxt(err); });
    });
    d.showModal();
  }
  function emailTxt(m) {
    if (!m) return '';
    if (!m.ligado) return ' O aviso foi pelo sino do painel (o e-mail do Office ainda não foi ligado).';
    if (m.falhas && m.falhas.length) return ' O e-mail não saiu para: ' + m.falhas.map(function (f) { return f.para; }).join(', ') + '.';
    if (m.enviados && m.enviados.length) return ' E-mail enviado para ' + m.enviados.length + (m.enviados.length === 1 ? ' pessoa.' : ' pessoas.');
    return '';
  }

  /* ---------- formulário: nova reunião ou editar ---------- */
  var HORAS = (function () { var l = []; for (var m = 0; m < 1440; m += 15) l.push(pad(Math.floor(m / 60)) + ':' + pad(m % 60)); return l; })();
  function opcoesHora(sel) {
    return HORAS.map(function (h) { return '<option' + (h === sel ? ' selected' : '') + '>' + h + '</option>'; }).join('') +
      (HORAS.indexOf(sel) < 0 && sel ? '<option selected>' + sel + '</option>' : '');
  }
  function arredondar15(d) { var x = new Date(d); x.setSeconds(0, 0); x.setMinutes(Math.ceil(x.getMinutes() / 15) * 15); return x; }
  function pessoas() {
    if (est.pessoas) return Promise.resolve(est.pessoas);
    return O.api('pessoas', {}).then(function (l) { est.pessoas = l || []; return est.pessoas; }, function () { return []; });
  }

  function formulario(e, pre) {
    fecharPop();
    pre = pre || {};
    var novo = !e;
    var ini, fim;
    if (e) { ini = new Date(e.inicio); fim = new Date(e.fim); }
    else if (pre.inicio) { ini = pre.inicio; fim = pre.fim || new Date(pre.inicio.getTime() + 3600000); }
    else {
      ini = arredondar15(new Date(Math.max(Date.now(), dia0(est.ref).getTime() + 9 * 3600000)));
      if (!mesmoDia(ini, est.ref) && est.ref > new Date()) ini = new Date(dia0(est.ref).getTime() + 9 * 3600000);
      fim = new Date(ini.getTime() + 3600000);
    }
    var diaTodo = e ? e.dia_inteiro : false;
    var fimDia = diaTodo ? new Date(fim.getTime() - 1000) : fim;
    var salaSel = e ? (e.sala ? e.sala.id : '') : (pre.sala || '');
    var convidados = [];   // { pessoa } | { email }
    (e && e.convidados || []).forEach(function (c) { convidados.push(c.pessoa ? { pessoa: c.pessoa } : { email: c.email }); });
    var comEmail = !!(est.eu && est.eu.email);

    var d = $('[data-dialogo]');
    d.className = 'dialogo dialogo--agenda';
    var semana = SEM_LONGO[ini.getDay()];
    d.innerHTML = '<form method="dialog" class="ag-form" novalidate>' +
      '<input class="ag-form__titulo" data-f-titulo maxlength="160" placeholder="Título da reunião" value="' + esc(e ? e.titulo : '') + '" aria-label="Título">' +
      '<div class="ag-quando">' + SVG.relogio +
        '<input type="date" class="ag-in" data-f-dia value="' + chaveDia(ini) + '" aria-label="Dia">' +
        '<select class="ag-in ag-in--hora" data-f-ini aria-label="Início"' + (diaTodo ? ' hidden' : '') + '>' + opcoesHora(hhmm(ini)) + '</select>' +
        '<span class="ag-ate" data-f-sep>' + (diaTodo ? 'até' : '–') + '</span>' +
        '<select class="ag-in ag-in--hora" data-f-fim aria-label="Fim"' + (diaTodo ? ' hidden' : '') + '>' + opcoesHora(hhmm(fim)) + '</select>' +
        '<input type="date" class="ag-in" data-f-dia-fim value="' + chaveDia(fimDia) + '" aria-label="Último dia"' + (diaTodo ? '' : ' hidden') + '>' +
        '<label class="ag-check"><input type="checkbox" data-f-diatodo' + (diaTodo ? ' checked' : '') + '>Dia inteiro</label>' +
      '</div>' +
      (novo ? '<div class="ag-rep">' + SVG.repetir +
        '<select class="ag-in" data-f-rep aria-label="Repetir"><option value="">Não se repete</option>' +
        '<option value="dia_util">Todo dia útil (seg a sex)</option><option value="semana" data-f-rep-semana>Toda semana (' + semana + ')</option>' +
        '<option value="mes" data-f-rep-mes>Todo mês (dia ' + ini.getDate() + ')</option><option value="dia">Todo dia</option></select>' +
        '<span class="ag-ate" data-f-ate-rot hidden>até</span><input type="date" class="ag-in" data-f-ate hidden aria-label="Repete até"></div>'
        : (e.repeticao ? '<div class="ag-rep">' + SVG.repetir + '<span class="ag-ate">' + esc(repeteTxt(e.repeticao)) + '. Para mudar a repetição, cancele e marque de novo.</span></div>' : '')) +
      '<section class="ag-bloco"><span class="mono rotulo">Sala de reunião</span><div class="ag-salas-esc" data-f-salas></div>' +
        '<p class="enviar__nota" data-f-salas-nota></p></section>' +
      '<section class="ag-bloco"><span class="mono rotulo">Convidados</span>' +
        '<div class="adicionar"><div class="adicionar__campo">' + SVG.busca +
        '<input type="text" data-f-busca placeholder="Nome de quem está no painel, ou um e-mail de fora" autocomplete="off" spellcheck="false" aria-label="Convidar"></div>' +
        '<div class="sugestoes suspenso" data-f-sug hidden></div></div>' +
        '<div class="fichas" data-f-fichas></div>' +
        '<p class="enviar__nota">' + (comEmail
          ? 'Quem você convidar recebe o aviso no sino e um e-mail com o convite, que entra na agenda do celular (Gmail ou Outlook).'
          : 'Quem você convidar recebe o aviso no sino do painel. O convite por e-mail liga quando a caixa do Office estiver cadastrada.') + '</p></section>' +
      '<section class="ag-bloco"><span class="mono rotulo">Local ou link (opcional)</span>' +
        '<label class="campo"><input type="text" data-f-local maxlength="200" placeholder="Ex.: na loja do cliente, ou o link da videochamada" value="' + esc(e ? e.local : '') + '"></label></section>' +
      '<section class="ag-bloco"><span class="mono rotulo">Pauta (opcional)</span>' +
        '<textarea data-f-desc rows="3" maxlength="4000" placeholder="O que vai ser tratado">' + esc(e ? e.descricao : '') + '</textarea></section>' +
      '<label class="ag-check"><input type="checkbox" data-f-part' + (e && e.particular ? ' checked' : '') + '>Particular' +
        '<small>· na agenda da sala, quem não foi convidado vê só “Reservada”</small></label>' +
      '<p class="dialogo__erro" data-dlg-erro></p>' +
      '<div class="ag-form__pe">' + (e && e.serie ? escopoHtml('form') : '') +
        '<button class="btn" type="button" data-dlg-cancelar>Cancelar</button>' +
        '<button class="btn btn--prim" type="submit" data-f-ok>' + (novo ? SVG.mais + 'Marcar reunião' : 'Salvar mudanças') + '</button></div>' +
      '</form>';

    var f = function (s) { return $(s, d); };
    var erroEl = f('[data-dlg-erro]');

    function lerHorario() {
      var dt = f('[data-f-diatodo]').checked, dia = f('[data-f-dia]').value;
      if (!dia) return null;
      if (dt) {
        var ult = f('[data-f-dia-fim]').value || dia;
        var a = deChave(dia), b = mais(deChave(ult), 1);
        return { inicio: a, fim: b > a ? b : mais(a, 1), dia_inteiro: true };
      }
      var i0 = deChave(dia, f('[data-f-ini]').value), f0 = deChave(dia, f('[data-f-fim]').value);
      if (f0 <= i0) f0 = mais(f0, 1);   // termina depois da meia-noite
      return { inicio: i0, fim: f0, dia_inteiro: false };
    }

    // salas: livre ou ocupada no horário escolhido
    var tSalas = null, pedSalas = 0;
    function desenharSalasForm(lista) {
      var h = '<button type="button" class="ag-sala-esc" data-f-sala="" aria-pressed="' + String(!salaSel) + '" style="--c:#8A93AB">' +
        '<b><i></i><span>Sem sala</span></b><small>Reunião fora das salas, ou por vídeo</small></button>';
      (lista || []).filter(function (s) { return s.ativa; }).forEach(function (s) {
        var oc = s.ocupada;
        h += '<button type="button" class="ag-sala-esc' + (oc ? ' is-ocupada' : '') + '" data-f-sala="' + esc(s.id) + '" aria-pressed="' + String(salaSel === s.id) +
          '" style="--c:' + esc(s.cor) + '"><b><i></i><span>' + esc(s.nome) + '</span></b><small>' +
          esc([s.local, s.capacidade ? s.capacidade + ' lugares' : ''].filter(Boolean).join(' · ') || 'Sala de reunião') + '</small>' +
          (oc ? '<span class="ag-estado ag-estado--ocupada">Ocupada ' + hhmm(new Date(oc.inicio)) + '–' + hhmm(new Date(oc.fim)) + '</span>'
            : '<span class="ag-estado ag-estado--livre">Livre</span>') + '</button>';
      });
      f('[data-f-salas]').innerHTML = h;
      var sel = (lista || []).filter(function (s) { return s.id === salaSel; })[0];
      var nota = f('[data-f-salas-nota]');
      if (!(lista || []).some(function (s) { return s.ativa; })) nota.textContent = 'O TI ainda não cadastrou as salas de reunião.';
      else if (sel && sel.ocupada) nota.innerHTML = '<span style="color:#FF8A91">' + esc(sel.nome) + ' está ocupada nesse horário' +
        (sel.ocupada.dono ? ', por ' + esc(sel.ocupada.dono.nome) + (sel.ocupada.titulo !== 'Reservada' ? ' (“' + esc(sel.ocupada.titulo) + '”)' : '') : '') + '. Troque o horário ou a sala.</span>';
      else nota.textContent = f('[data-f-rep]') && f('[data-f-rep]').value ? 'A sala é conferida em todas as datas da repetição na hora de salvar.' : '';
    }
    function conferirSalas() {
      clearTimeout(tSalas);
      tSalas = setTimeout(function () {
        var hr = lerHorario();
        var n = ++pedSalas;
        O.api('salas', hr ? { inicio: hr.inicio.toISOString(), fim: hr.fim.toISOString(), ignorar: e ? e.id : null } : {}).then(function (r) {
          if (n === pedSalas && d.open) desenharSalasForm(r.salas);
        }, function () { if (n === pedSalas && d.open) desenharSalasForm(salas()); });
      }, 220);
    }

    // convidados
    var busca = f('[data-f-busca]'), sug = f('[data-f-sug]'), lista = [], foco = 0;
    var fecharX = SVG.fechar.replace('<svg ', '<svg aria-hidden="true" ');
    function pessoaPorId(id) { return (est.pessoas || []).filter(function (p) { return p.id === id; })[0] || null; }
    function desenharFichas() {
      f('[data-f-fichas]').innerHTML = convidados.map(function (c, i) {
        if (c.pessoa) {
          var p = typeof c.pessoa === 'object' ? c.pessoa : (pessoaPorId(c.pessoa) || { id: c.pessoa, nome: '?' });
          return '<span class="ficha">' + O.avatar(p, 'p') + esc(p.nome) + '<button type="button" data-f-tira="' + i + '" aria-label="Tirar ' + esc(p.nome) + '">' + fecharX + '</button></span>';
        }
        return '<span class="ficha ficha--email">' + esc(c.email) + '<button type="button" data-f-tira="' + i + '" aria-label="Tirar ' + esc(c.email) + '">' + fecharX + '</button></span>';
      }).join('');
    }
    function idDe(c) { return c.pessoa ? (typeof c.pessoa === 'object' ? c.pessoa.id : c.pessoa) : null; }
    function mostrarSug() {
      var q = busca.value.trim().toLowerCase();
      var ja = {};
      ja[euId()] = true;
      convidados.forEach(function (c) { if (idDe(c)) ja[idDe(c)] = true; });
      lista = (est.pessoas || []).filter(function (p) {
        return !ja[p.id] && (!q || p.nome.toLowerCase().indexOf(q) > -1 || String(p.email || '').toLowerCase().indexOf(q) > -1);
      }).slice(0, 8);
      var extra = EMAIL_OK.test(q) && !lista.some(function (p) { return String(p.email).toLowerCase() === q; });
      if (!lista.length && !extra) { sug.hidden = true; return; }
      foco = Math.min(foco, lista.length - 1 + (extra ? 1 : 0));
      sug.innerHTML = lista.map(function (p, i) {
        return '<button type="button" class="sugestao' + (i === foco ? ' is-foco' : '') + '" data-f-sug-i="' + i + '">' + O.avatar(p) +
          '<span><strong>' + esc(p.nome) + '</strong><em>' + esc(p.email + (p.cargo ? ' · ' + p.cargo : '')) + '</em></span></button>';
      }).join('') + (extra ? '<button type="button" class="sugestao' + (foco === lista.length ? ' is-foco' : '') + '" data-f-sug-email>' +
        '<span class="av" style="--c:#1A2357">@</span><span><strong>Convidar ' + esc(q) + '</strong><em>E-mail de fora do painel</em></span></button>' : '');
      sug.hidden = false;
    }
    function addPessoa(p) {
      convidados.push({ pessoa: p });
      busca.value = '';
      foco = 0;
      desenharFichas();
      mostrarSug();
      busca.focus();
    }
    function addEmail(em) {
      em = String(em || '').trim().toLowerCase();
      if (!EMAIL_OK.test(em)) return false;
      var p = (est.pessoas || []).filter(function (x) { return String(x.email).toLowerCase() === em; })[0];
      if (p) { if (p.id !== euId() && !convidados.some(function (c) { return idDe(c) === p.id; })) convidados.push({ pessoa: p }); }
      else if (!convidados.some(function (c) { return c.email === em; })) convidados.push({ email: em });
      busca.value = '';
      desenharFichas();
      sug.hidden = true;
      return true;
    }
    pessoas().then(function () { desenharFichas(); if (document.activeElement === busca) mostrarSug(); });
    busca.addEventListener('focus', function () { pessoas().then(mostrarSug); });
    busca.addEventListener('input', function () { foco = 0; mostrarSug(); });
    busca.addEventListener('keydown', function (ev) {
      var n = lista.length + (sug.querySelector('[data-f-sug-email]') ? 1 : 0);
      if (ev.key === 'ArrowDown') { ev.preventDefault(); foco = Math.min(n - 1, foco + 1); mostrarSug(); }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); foco = Math.max(0, foco - 1); mostrarSug(); }
      else if (ev.key === 'Enter' || ev.key === ',' || ev.key === ';') {
        if (!busca.value.trim()) return;
        ev.preventDefault();
        if (!sug.hidden && lista[foco]) addPessoa(lista[foco]);
        else if (!addEmail(busca.value)) erroEl.textContent = 'Escolha alguém da lista ou escreva um e-mail completo.';
      } else if (ev.key === 'Escape') { sug.hidden = true; }
    });
    busca.addEventListener('blur', function () { setTimeout(function () { sug.hidden = true; }, 150); });
    sug.addEventListener('mousedown', function (ev) {
      var b = ev.target.closest('[data-f-sug-i]');
      if (b) { ev.preventDefault(); addPessoa(lista[+b.getAttribute('data-f-sug-i')]); return; }
      if (ev.target.closest('[data-f-sug-email]')) { ev.preventDefault(); addEmail(busca.value); }
    });

    // repetição: o padrão do "até" é 3 meses (ou 1 mês para todo dia)
    function rotulosRep() {
      var dia = f('[data-f-dia]').value;
      if (!dia || !f('[data-f-rep]')) return;
      var dd = deChave(dia);
      f('[data-f-rep-semana]').textContent = 'Toda semana (' + SEM_LONGO[dd.getDay()] + ')';
      f('[data-f-rep-mes]').textContent = 'Todo mês (dia ' + dd.getDate() + ')';
    }
    if (f('[data-f-rep]')) {
      f('[data-f-rep]').addEventListener('change', function () {
        var v = this.value, ate = f('[data-f-ate]');
        ate.hidden = f('[data-f-ate-rot]').hidden = !v;
        if (v && !ate.value) {
          var base = deChave(f('[data-f-dia]').value || chaveDia(new Date()));
          ate.value = chaveDia(v === 'dia' || v === 'dia_util' ? mais(base, 30) : new Date(base.getFullYear(), base.getMonth() + 3, base.getDate()));
        }
        ate.min = f('[data-f-dia]').value;
        conferirSalas();
      });
    }
    f('[data-f-diatodo]').addEventListener('change', function () {
      var on = this.checked;
      f('[data-f-ini]').hidden = f('[data-f-fim]').hidden = on;
      f('[data-f-dia-fim]').hidden = !on;
      f('[data-f-sep]').textContent = on ? 'até' : '–';
      if (on && (!f('[data-f-dia-fim]').value || f('[data-f-dia-fim]').value < f('[data-f-dia]').value)) f('[data-f-dia-fim]').value = f('[data-f-dia]').value;
      conferirSalas();
    });
    f('[data-f-dia]').addEventListener('change', function () {
      if (f('[data-f-dia-fim]').value < this.value) f('[data-f-dia-fim]').value = this.value;
      rotulosRep();
      conferirSalas();
    });
    f('[data-f-dia-fim]').addEventListener('change', conferirSalas);
    // mudou o início: o fim anda junto, mantendo a duração
    var durAnt = Math.max(15, (fim - ini) / 60000);
    f('[data-f-ini]').addEventListener('change', function () {
      var a = deChave('2000-01-01', this.value), b = new Date(a.getTime() + durAnt * 60000);
      var hb = hhmm(b);
      var sel = f('[data-f-fim]');
      if (HORAS.indexOf(hb) < 0) sel.insertAdjacentHTML('beforeend', '<option>' + hb + '</option>');
      sel.value = hb;
      conferirSalas();
    });
    f('[data-f-fim]').addEventListener('change', function () {
      var a = deChave('2000-01-01', f('[data-f-ini]').value), b = deChave('2000-01-01', this.value);
      var m = (b - a) / 60000;
      durAnt = m > 0 ? m : m + 1440;
      conferirSalas();
    });

    f('form').addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-f-sala]');
      if (b) {
        salaSel = b.getAttribute('data-f-sala');
        $$('[data-f-sala]', d).forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
        if (b.classList.contains('is-ocupada')) O.toast('Essa sala está ocupada nesse horário. Troque o horário ou escolha outra sala.', 'erro');
        conferirSalas();
        return;
      }
      var t = ev.target.closest('[data-f-tira]');
      if (t) { convidados.splice(+t.getAttribute('data-f-tira'), 1); desenharFichas(); }
    });
    f('[data-dlg-cancelar]').addEventListener('click', function () { d.close(); });

    f('form').addEventListener('submit', function (ev) {
      ev.preventDefault();
      erroEl.textContent = '';
      if (busca.value.trim() && !addEmail(busca.value)) { erroEl.textContent = 'O convidado “' + busca.value.trim() + '” não é da lista nem um e-mail completo.'; return; }
      var titulo = f('[data-f-titulo]').value.trim();
      if (!titulo) { erroEl.textContent = 'Dê um título para a reunião.'; f('[data-f-titulo]').focus(); return; }
      var hr = lerHorario();
      if (!hr) { erroEl.textContent = 'Escolha o dia.'; return; }
      var dados = {
        titulo: titulo, inicio: hr.inicio.toISOString(), fim: hr.fim.toISOString(), dia_inteiro: hr.dia_inteiro,
        sala: salaSel || null, local: f('[data-f-local]').value.trim(), descricao: f('[data-f-desc]').value.trim(),
        particular: f('[data-f-part]').checked,
        convidados: convidados.map(function (c) { return idDe(c) ? { pessoa: idDe(c) } : { email: c.email }; })
      };
      var rep = f('[data-f-rep]');
      if (rep && rep.value) {
        if (!f('[data-f-ate]').value) { erroEl.textContent = 'Diga até quando a reunião se repete.'; return; }
        dados.repeticao = { freq: rep.value, ate: f('[data-f-ate]').value };
      }
      var ok = f('[data-f-ok]');
      ok.disabled = true;
      ok.textContent = 'Salvando…';
      O.api('evento_salvar', { id: e ? e.id : null, dados: dados, escopo: escopoDe(d, 'form') }).then(function (r) {
        d.close();
        var n = dados.convidados.length;
        O.toast((novo ? (r.ocorrencias > 1 ? r.ocorrencias + ' reuniões marcadas.' : 'Reunião marcada.') : 'Reunião atualizada.') +
          (n ? (r.email && r.email.ligado ? emailTxt(r.email) : ' ' + n + (n === 1 ? ' convidado avisado' : ' convidados avisados') + ' no sino do painel.') : ''));
        est.ref = dia0(new Date(r.evento.inicio));
        est.mini = null;
        carregar(true);
      }, function (err) {
        ok.disabled = false;
        ok.innerHTML = novo ? SVG.mais + 'Marcar reunião' : 'Salvar mudanças';
        erroEl.textContent = erroTxt(err);
        if (err.status === 409) conferirSalas();
      });
    });

    d.showModal();
    desenharSalasForm(salas());
    conferirSalas();
    desenharFichas();
    if (!e) setTimeout(function () { f('[data-f-titulo]').focus(); }, 30);
  }

  /* ---------- salas: cadastro do TI ---------- */
  function gerirSalas(alvo) {
    var d = $('[data-dialogo]');
    d.className = 'dialogo dialogo--largo';
    var lista = salas();
    var s = alvo || null;
    var cor = s ? s.cor : CORES_SALA[lista.length % CORES_SALA.length];
    d.innerHTML = '<form method="dialog" novalidate>' +
      '<div class="dialogo__topo">' + SVG.sala.replace('<svg ', '<svg width="40" style="color:#8EA0FF;flex:none" ') +
      '<div><h2>Salas de reunião</h2><p class="enviar__sub">Só o TI cadastra. Todo mundo do painel vê e reserva.</p></div></div>' +
      (lista.length ? '<div class="ag-salas-lista">' + lista.map(function (x) {
        return '<button type="button" class="' + (x.ativa ? '' : 'is-off') + '" data-s-editar="' + esc(x.id) + '" style="--c:' + esc(x.cor) + '"><i></i><span>' + esc(x.nome) +
          '<br><small>' + esc([x.local, x.capacidade ? x.capacidade + ' lugares' : '', x.recursos, x.ativa ? '' : 'desativada'].filter(Boolean).join(' · ')) + '</small></span>' + SVG.lapis.replace('<svg ', '<svg width="16" ') + '</button>';
      }).join('') + '</div>' : '') +
      '<section class="enviar__bloco"><span class="mono rotulo">' + (s ? 'Editar “' + esc(s.nome) + '”' : 'Nova sala') + '</span>' +
        '<label class="campo"><input type="text" data-s-nome maxlength="60" placeholder="Nome (ex.: Sala de Reunião 1)" value="' + esc(s ? s.nome : '') + '"></label>' +
        '<div class="ag-duas"><label class="campo"><input type="text" data-s-local maxlength="120" placeholder="Onde fica (ex.: 1º andar)" value="' + esc(s ? s.local : '') + '"></label>' +
        '<label class="campo"><input type="number" data-s-cap min="1" max="500" placeholder="Lugares" value="' + esc(s && s.capacidade ? s.capacidade : '') + '"></label></div>' +
        '<label class="campo"><input type="text" data-s-rec maxlength="200" placeholder="O que tem (ex.: TV, videoconferência, quadro)" value="' + esc(s ? s.recursos : '') + '"></label>' +
        '<div class="ag-cores" role="radiogroup" aria-label="Cor">' + CORES_SALA.map(function (c) {
          return '<button type="button" data-s-cor="' + c + '" style="--c:' + c + '" aria-pressed="' + String(c.toLowerCase() === String(cor).toLowerCase()) + '" aria-label="Cor ' + c + '"></button>';
        }).join('') + '</div>' +
        (s ? '<label class="ag-check"><input type="checkbox" data-s-ativa' + (s.ativa ? ' checked' : '') + '>Sala ativa<small>· desativada, some da reserva (as reservas já feitas continuam)</small></label>' : '') +
      '</section>' +
      '<p class="dialogo__erro" data-dlg-erro></p>' +
      '<div class="dialogo__acoes">' + (s ? '<button class="btn" type="button" data-s-nova style="margin-right:auto">' + SVG.mais + 'Nova sala</button>' : '') +
        '<button class="btn" type="button" data-dlg-cancelar>Fechar</button>' +
        '<button class="btn btn--prim" type="submit">' + (s ? 'Salvar sala' : SVG.mais + 'Cadastrar sala') + '</button></div></form>';
    $('form', d).addEventListener('click', function (ev) {
      var b;
      if ((b = ev.target.closest('[data-s-cor]'))) {
        cor = b.getAttribute('data-s-cor');
        $$('[data-s-cor]', d).forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      } else if ((b = ev.target.closest('[data-s-editar]'))) {
        gerirSalas(lista.filter(function (x) { return x.id === b.getAttribute('data-s-editar'); })[0]);
      } else if (ev.target.closest('[data-s-nova]')) {
        gerirSalas(null);
      } else if (ev.target.closest('[data-dlg-cancelar]')) {
        d.close();
      }
    });
    $('form', d).addEventListener('submit', function (ev) {
      ev.preventDefault();
      var dados = {
        nome: $('[data-s-nome]', d).value.trim(), local: $('[data-s-local]', d).value.trim(),
        capacidade: $('[data-s-cap]', d).value.trim(), recursos: $('[data-s-rec]', d).value.trim(), cor: cor
      };
      if (s) dados.ativa = $('[data-s-ativa]', d).checked;
      if (!dados.nome) { $('[data-dlg-erro]', d).textContent = 'Dê um nome à sala.'; return; }
      var b = $('[type="submit"]', d);
      b.disabled = true;
      O.api('sala_salvar', { id: s ? s.id : null, dados: dados }).then(function (r) {
        O.toast(s ? 'Sala “' + r.nome + '” salva.' + (s.ativa && !r.ativa && r.reservas_futuras ? ' Ela tem ' + r.reservas_futuras + ' reserva(s) marcada(s), que continuam.' : '')
          : 'Sala “' + r.nome + '” cadastrada. Todo mundo já pode reservar.');
        carregar(true).then(function () { if (d.open) gerirSalas(null); });
      }, function (err) { b.disabled = false; $('[data-dlg-erro]', d).textContent = erroTxt(err); });
    });
    if (!d.open) d.showModal();
  }

  /* ---------- eventos da tela ---------- */
  function ligar() {
    var r = est.raiz;
    r.addEventListener('click', function (ev) {
      var t = ev.target, el;
      if (t.closest('[data-ag-nova]')) { formulario(null, {}); return; }
      if (t.closest('[data-ag-hoje]')) { irPara(hoje()); return; }
      if ((el = t.closest('[data-ag-passo]'))) { passo(+el.getAttribute('data-ag-passo')); return; }
      if ((el = t.closest('[data-ag-vista]'))) { est.rolar = true; irPara(est.ref, el.getAttribute('data-ag-vista')); return; }
      if ((el = t.closest('[data-ag-mini]')) && el.tagName === 'BUTTON') {
        est.mini = new Date(est.mini.getFullYear(), est.mini.getMonth() + (+el.getAttribute('data-ag-mini')), 1);
        desenharMini();
        return;
      }
      if ((el = t.closest('[data-ag-ir]'))) { irPara(deChave(el.getAttribute('data-ag-ir'))); return; }
      if ((el = t.closest('[data-ag-ir-dia]'))) { est.rolar = true; irPara(deChave(el.getAttribute('data-ag-ir-dia')), est.vista === 'salas' ? 'salas' : 'dia'); return; }
      if ((el = t.closest('[data-ag-ev]'))) {
        var e = eventoPorId(el.getAttribute('data-ag-ev'));
        if (e) abrirPop(e, el);
        return;
      }
      if (t.closest('[data-ag-gerir]')) { gerirSalas(null); return; }
      if (t.closest('[data-ag-recarregar]')) { carregar(true); return; }
      if ((el = t.closest('[data-ag-mes-dia]')) && !t.closest('button,[data-ag-ir-dia]')) {
        var dia = deChave(el.getAttribute('data-ag-mes-dia'));
        formulario(null, { inicio: new Date(dia.getTime() + 9 * 3600000), fim: new Date(dia.getTime() + 10 * 3600000) });
      }
    });
    r.addEventListener('change', function (ev) {
      var c = ev.target.closest('[data-ag-camada]');
      if (!c) return;
      var k = c.getAttribute('data-ag-camada');
      if (k === 'minha') { est.minha = c.checked; gravarLocal('agenda_minha', c.checked ? '1' : '0'); }
      else { if (c.checked) delete est.salasOff[k]; else est.salasOff[k] = 1; gravarLocal('agenda_salas_off', JSON.stringify(est.salasOff)); }
      guardarRolagem();
      desenhar();
    });
    r.addEventListener('scroll', function (ev) { if (ev.target.matches && ev.target.matches('[data-ag-corpo]')) est.scroll = ev.target.scrollTop; }, true);
    ligarGrade();

    // cartão da reunião: botões, fechar fora e Esc
    document.addEventListener('click', function (ev) {
      if (!est.pop) return;
      var p = est.pop, t = ev.target, el;
      if (p.contains(t)) {
        if (t.closest('[data-ag-pop-fechar]')) { fecharPop(); return; }
        if ((el = t.closest('[data-resp]'))) { responder(p._e, el.getAttribute('data-resp')); return; }
        if (t.closest('[data-ag-editar]')) { formulario(p._e); return; }
        if (t.closest('[data-ag-cancelar]')) { confirmarCancelar(p._e); return; }
        return;
      }
      if (!t.closest('[data-ag-ev]') && !t.closest('dialog')) fecharPop();
    });
    document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && est.pop && !$('[data-dialogo]').open) fecharPop(); });
    window.addEventListener('resize', function () { if (est.pop) fecharPop(); });
    // o relógio anda: a linha do agora e o "livre / ocupada" das salas
    est.relogio = setInterval(function () {
      if (est.raiz.hidden || document.hidden) return;
      if (est.vista === 'salas') { guardarRolagem(); desenharSalas(); }
      marcarAgora();
    }, 60000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden && est.raiz && !est.raiz.hidden && est.dados) { guardarRolagem(); carregar(true); } });
  }
  function guardarRolagem() { var c = $('[data-ag-corpo]', est.raiz); if (c) est.scroll = c.scrollTop; }

  /* ---------- o Drive chama ---------- */
  function abrirPorId(id) {
    O.api('evento', { id: id }).then(function (e) {
      est.ref = dia0(new Date(e.inicio));
      est.mini = null;
      carregar(true).then(function () {
        var el = $('[data-ag-ev="' + id + '"]', est.raiz);
        abrirPop(eventoPorId(id) || e, el);
      });
    }, function (err) { O.toast(err.status === 404 ? 'Essa reunião não existe mais ou foi cancelada.' : erroTxt(err), 'erro'); });
  }

  window.OFC_AGENDA = {
    mostrar: function (ctx) {
      ctx = ctx || {};
      est.eu = ctx.eu || est.eu;
      if (!est.raiz) montar();
      est.raiz.hidden = false;
      if (ctx.evento) abrirPorId(ctx.evento);
      else carregar();
      if (ctx.nova) setTimeout(function () { formulario(null, {}); }, 60);
    },
    esconder: function () {
      fecharPop();
      if (est.raiz) est.raiz.hidden = true;
    },
    nova: function () { formulario(null, {}); }
  };
})();
