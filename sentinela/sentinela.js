/* =========================================================
   SENTINELA LUBE — painel de segurança
   Lê tudo pelas funções public.sentinela_* do banco do portal,
   com a sessão do usuário (só o TI passa: is_admin()).
   Painel completo a cada 60 s; eventos novos a cada 4 s com a
   aba visível. Falha de rede aparece numa faixa — nada some
   em silêncio.
   ========================================================= */
(function () {
  'use strict';

  var SNT = window.SNT, U = SNT.u, esc = U.esc;
  var CFG = window.LUBE_CFG || {};
  var CENTRAL = (CFG.url || '') + '/functions/v1/sentinela';
  var LOCAL = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  var DEMO = LOCAL && new URLSearchParams(location.search).get('demo') === '1';
  var GLOBO_JS = 'vendor/globe.gl@2.46.2/globe.gl.min.js';
  var T_PAINEL = 60000, T_NOVOS = 4000, MAX_FEED = 30;

  var $  = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };

  var sb = null;
  var est = {
    email: '', painel: null, ultimoId: 0, okEm: 0, semConexao: null, faixa: null,
    modulo: 'visao', globo: null, globoPedido: false, feed: {}, feedVisto: {}, feedPintado: false,
    visitantes: [], nomes: {}, filtros: { status: '', sistema: '', pais: '', busca: '' },
    blInativos: false, ultimoPainel: 0, proxPainel: 0, tPainel: null, tNovos: null,
    tentativaPainel: 0, falhasPainel: 0, painelEmCurso: null, novosEmCurso: false,
    rodando: false, parado: false, config: null
  };

  var TITULOS = {
    visao: 'Visão geral', bloqueios: 'Bloqueios', confiaveis: 'Redes confiáveis', ia: 'Análise por IA',
    exposicoes: 'Exposições', integridade: 'Integridade do registro', configuracao: 'Configuração'
  };
  // só os módulos do painel (nada herdado de Object.prototype, como "#constructor")
  function moduloValido(m) { return Object.prototype.hasOwnProperty.call(TITULOS, m); }
  function moduloDoHash() { var m = (location.hash || '').replace('#', ''); return moduloValido(m) ? m : 'visao'; }

  var IC = {
    acessos: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
    bloqueados: '<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>',
    observados: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    ips: '<rect x="3" y="4" width="18" height="6" rx="1.5"/><rect x="3" y="14" width="18" height="6" rx="1.5"/><path d="M7 7h.01M7 17h.01"/>',
    paises: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    analises: '<path d="M12 3v3M12 18v3M3 12h3M18 12h3"/><rect x="7" y="7" width="10" height="10" rx="2.5"/><path d="M10 10h4v4h-4z"/>',
    identificados: '<circle cx="9" cy="8" r="4"/><path d="M2 21c0-3.9 3.1-7 7-7s7 3.1 7 7"/><path d="m16 11 2 2 4-4"/>',
    alerta: '<path d="M12 3 2 20h20Z"/><path d="M12 10v4M12 17h.01"/>',
    relogio: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'
  };
  function svg(d) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + d + '</svg>'; }
  // subtítulo de painel: texto escapado, números em JetBrains Mono
  function subtitulo(sel, texto) { $(sel).innerHTML = U.numeros(texto); }
  // tabela renovada no ciclo: só troca o conteúdo se mudou (não perde seleção nem hover à toa)
  function pintarSeMudou(el, html) { if (el._html !== html) { el.innerHTML = html; el._html = html; } }

  /* =========================================================
     chamadas ao banco
     ========================================================= */
  function chamar(nome, args) {
    var p = DEMO ? SNT.demo.rpc(nome, args || {}) : sb.rpc(nome, args || {});
    return Promise.resolve(p).then(function (r) {
      if (r.error) throw erroRpc(r.error, r.status);
      return r.data;
    }, function (e) {
      throw erroRpc({ message: (e && e.message) || String(e), code: '' }, 0);
    });
  }
  function erroRpc(e, status) {
    var msg = e.message || 'erro desconhecido';
    var err = new Error(msg);
    err.codigo = e.code || '';
    err.rede = (!e.code && /fetch|network|load failed|timeout|abort/i.test(msg)) || status === 0;
    err.restrito = e.code === '42501';
    err.ausente = e.code === 'PGRST202' || e.code === '42883';
    err.sessao = e.code === 'PGRST301' || e.code === 'PGRST302' || status === 401 || /jwt expired/i.test(msg);
    return err;
  }
  // mensagem limpa para o usuário (sem detalhe técnico do PostgREST)
  function texto(err) {
    if (err.rede) return 'Sem conexão com a central.';
    if (err.restrito) return 'Acesso restrito ao TI.';
    return String(err.message || err).replace(/^sentinela:\s*/i, '');
  }

  // a central (Edge Function) é avisada de login e falha de login, sem esperar resposta
  function avisarCentral(rota, corpo, token) {
    if (DEMO) return;
    try {
      var h = { 'content-type': 'application/json' };
      if (token) h.authorization = 'Bearer ' + token;
      fetch(CENTRAL + '/' + rota, { method: 'POST', headers: h, body: JSON.stringify(corpo || {}), credentials: 'omit' })
        .catch(function () {});
    } catch (e) { /* nada */ }
  }
  // como o portal.js: na tentativa falha vai só a inicial e o domínio (j***@lube.com.br),
  // para não gravar uma senha digitada no campo errado
  function mascararUsuario(email) {
    var e = String(email || '').trim().toLowerCase(), i = e.lastIndexOf('@');
    return i < 1 ? '' : (e.charAt(0) + '***' + e.slice(i)).slice(0, 80);
  }

  function carregarScript(src) {
    return new Promise(function (ok, falha) {
      var s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = function () { ok(); };
      s.onerror = function () { falha(new Error('não carregou ' + src)); };
      document.head.appendChild(s);
    });
  }

  /* =========================================================
     telas
     ========================================================= */
  function tela(qual) {
    $('[data-carregando]').hidden = qual !== 'carregando';
    $('[data-entrada]').hidden = qual !== 'entrada';
    $('[data-restrito]').hidden = qual !== 'restrito';
    $('[data-app]').hidden = qual !== 'app';
  }

  var toastEl = $('[data-toast]'), toastT;
  function toast(msg, erro) {
    toastEl.textContent = msg;
    toastEl.classList.toggle('is-erro', !!erro);
    toastEl.classList.add('is-on');
    clearTimeout(toastT);
    toastT = setTimeout(function () { toastEl.classList.remove('is-on'); }, 3800);
  }

  function faixa(html, tipo) {
    var el = $('[data-faixa-erro]');
    est.faixa = html ? tipo || 'erro' : null;
    el.hidden = !html;
    el.className = 'faixa-erro' + (tipo === 'aviso' ? ' aviso' : '');
    // um único bloco de texto: a faixa é flex e cada pedaço solto viraria uma coluna
    el.innerHTML = html ? '<span class="faixa-txt">' + html + '</span>' : '';
  }

  function marcarOk() {
    est.okEm = Date.now();
    if (est.semConexao) {
      est.semConexao = null;
      if (est.faixa === 'rede') faixa(null);
    }
  }
  function marcarFalha(err) {
    if (!err || typeof err !== 'object') err = new Error(String(err));
    if (err.restrito) { pararTudo(); mostrarRestrito(); return; }
    if (err.sessao && !DEMO) {
      if (est.renovando) return;
      est.renovando = true;
      sb.auth.refreshSession().then(function (r) {
        est.renovando = false;
        if (!r.data || !r.data.session) { pararTudo(); tela('entrada'); }
      }, function () { est.renovando = false; pararTudo(); tela('entrada'); });
      return;
    }
    if (err.rede) {
      if (!est.semConexao) est.semConexao = new Date();
      faixa('<b>Sem conexão com a central</b> desde <span class="mono">' + U.hora(est.semConexao) +
            '</span> · tentando de novo a cada 4 s. Os números na tela são da última leitura.', 'erro');
      est.faixa = 'rede';
      pintarVivo();
      return;
    }
    if (err.ausente) {
      faixa('<b>A Sentinela ainda não está instalada no banco</b> · função <span class="mono">' +
            esc(err.message.match(/sentinela_\w+/) ? err.message.match(/sentinela_\w+/)[0] : 'sentinela_painel') +
            '</span> não encontrada.', 'erro');
      return;
    }
    // erro do próprio painel (não da central): aparece também, com o texto do erro
    if (!('codigo' in err)) {
      if (window.console) console.error(err);
      faixa('<b>Erro ao montar o painel:</b> ' + esc(err.message || String(err)) + ' · recarregue a página.', 'erro');
      return;
    }
    faixa('<b>Erro ao ler a central:</b> ' + esc(texto(err)), 'erro');
  }

  /* ---------- modal ---------- */
  var modal = $('[data-modal]'), mForm = $('[data-modal-form]'), mErro = $('[data-modal-erro]'), mOk = $('[data-modal-ok]');
  var aoSalvar = null, aoCancelar = null;
  function abrirModal(o) {
    $('[data-modal-titulo]').textContent = o.titulo;
    mForm.innerHTML = o.html;
    mErro.textContent = '';
    mOk.textContent = o.rotulo || 'Salvar';
    mOk.className = 'btn ' + (o.perigo ? 'red' : 'blue');
    aoSalvar = o.aoSalvar; aoCancelar = o.aoCancelar || null;
    modal.hidden = false;
    document.body.classList.add('trava');
    var primeiro = $('input:not([type=hidden]),select,textarea', mForm);
    if (primeiro && !o.semFoco) setTimeout(function () { primeiro.focus(); }, 60);
  }
  function fecharModal(cancelou) {
    modal.hidden = true;
    document.body.classList.toggle('trava', !$('[data-gaveta]').hidden);
    if (cancelou && aoCancelar) aoCancelar();
    aoSalvar = null; aoCancelar = null;
  }
  $$('[data-modal-fechar]').forEach(function (b) { b.addEventListener('click', function () { fecharModal(true); }); });
  modal.addEventListener('click', function (e) { if (e.target === modal) fecharModal(true); });
  mOk.addEventListener('click', function () {
    if (!aoSalvar) return;
    mErro.textContent = '';
    mOk.disabled = true;
    Promise.resolve().then(function () { return aoSalvar(mForm); }).then(function (r) {
      mOk.disabled = false;
      if (r !== false) { aoCancelar = null; fecharModal(false); }
    }).catch(function (e) {
      mOk.disabled = false;
      mErro.textContent = texto(e);
    });
  });
  mForm.addEventListener('submit', function (e) { e.preventDefault(); mOk.click(); });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (!modal.hidden) fecharModal(true);
    else if (!$('[data-gaveta]').hidden) fecharGaveta();
  });
  function campoValor(nome) { var el = mForm.elements[nome]; return el ? String(el.value || '').trim() : ''; }

  /* ---------- dica flutuante (gráfico) ---------- */
  var dica = $('[data-dica]');
  function mostrarDica(html, x, y) {
    dica.innerHTML = html;
    dica.hidden = false;
    var w = dica.offsetWidth, h = dica.offsetHeight;
    var left = Math.min(window.innerWidth - w - 10, Math.max(10, x + 14));
    var top = y - h - 12 < 10 ? y + 18 : y - h - 12;
    dica.style.left = left + 'px'; dica.style.top = top + 'px';
  }
  function esconderDica() { dica.hidden = true; }

  /* =========================================================
     menu e módulos
     ========================================================= */
  var side = $('[data-side]');
  $('[data-menu-btn]').addEventListener('click', function () { side.classList.toggle('aberto'); });
  $('[data-veu]').addEventListener('click', function () { side.classList.remove('aberto'); });
  $$('[data-ir]').forEach(function (b) {
    b.addEventListener('click', function () { irPara(b.getAttribute('data-ir')); });
  });

  function irPara(m, semHash) {
    if (!moduloValido(m)) m = 'visao';
    est.modulo = m;
    $$('[data-ir]').forEach(function (b) { b.classList.toggle('ativo', b.getAttribute('data-ir') === m); });
    $$('[data-modulo]').forEach(function (s) { s.hidden = s.getAttribute('data-modulo') !== m; });
    $('[data-titulo]').textContent = TITULOS[m];
    document.title = (m === 'visao' ? '' : TITULOS[m] + ' · ') + 'Sentinela Lube';
    side.classList.remove('aberto');
    if (!semHash && location.hash !== '#' + m) history.replaceState(null, '', location.pathname + location.search + '#' + m);
    if (est.globo) { if (m === 'visao' && !document.hidden) est.globo.retomar(); else est.globo.pausar(); }
    carregarModulo(m);
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', function () {
    var m = location.hash.replace('#', '');
    if (m && m !== est.modulo && moduloValido(m)) irPara(m, true);
  });

  // como: 'entrada' (abriu o módulo), 'ciclo' (leitura periódica) ou 'acao' (depois de salvar algo).
  // No ciclo só as tabelas vivas (bloqueios, confiáveis, IA) se renovam, sem animação; configuração e
  // exposições esperam entrada ou ação, e a integridade (5000 SHA-256 no banco) só entrada ou o botão.
  // Não depende do painel ter lido: com sentinela_painel falhando, os módulos continuam utilizáveis.
  function carregarModulo(m, como) {
    como = como || 'entrada';
    var sec = $('[data-modulo="' + m + '"]');
    if (sec) sec.classList.toggle('quieto', como !== 'entrada');
    if (m === 'bloqueios') carregarBloqueios();
    else if (m === 'confiaveis') carregarConfiaveis();
    else if (m === 'ia') carregarIa();
    else if (como === 'ciclo') return;
    else if (m === 'exposicoes') carregarExposicoes();
    else if (m === 'configuracao') carregarConfig();
    else if (m === 'integridade' && como === 'entrada') carregarIntegridade();
  }

  /* =========================================================
     topo: modo, ao vivo, IA, sinal dos guardas
     ========================================================= */
  function pintarTopo(p) {
    var modo = $('[data-modo]');
    var obs = p.modo !== 'proteger';
    modo.className = 'modo ' + (obs ? 'observar' : 'proteger');
    modo.innerHTML = obs ? '<span class="em">👁</span>OBSERVANDO' : '<span class="em">🛡</span>PROTEGENDO';
    modo.title = obs
      ? 'Modo observar: ataque certo é barrado; o suspeito só fica registrado como "seria bloqueado". Clique para trocar.'
      : 'Modo proteger: suspeitos também são barrados (403). Clique para trocar.';

    var ia = p.ia || {};
    var chip = $('[data-chip-ia]');
    var rot = { ligada: 'IA ligada', sem_chave: 'IA sem chave', erro: 'IA com erro' }[ia.status] || 'IA sem sinal';
    chip.className = 'chip-ia ' + (ia.status || 'desconhecido');
    chip.textContent = rot;
    chip.title = (ia.detalhe ? ia.detalhe + ' · ' : '') + (ia.status_em ? 'estado desde ' + U.dataHora(ia.status_em) : 'sem registro de estado') +
                 ' · ' + U.num(ia.analises_janela) + ' análises em 24 h';

    var agora = Date.now();
    var comercial = U.horarioComercial(new Date(agora));
    $('[data-sinais]').innerHTML = '<span class="rot">Guardas</span>' + (p.sistemas || []).map(function (s) {
      var cls, txt;
      if (!s.ultimo_sinal) { cls = 'nunca'; txt = 'nunca mandou sinal'; }
      else {
        var min = (agora - new Date(s.ultimo_sinal).getTime()) / 60000;
        txt = 'último sinal ' + U.ha(s.ultimo_sinal, agora) + ' (' + U.dataHora(s.ultimo_sinal) + ')';
        if (min <= 30) cls = 'ok';
        else if (comercial) { cls = 'atraso'; txt += ' · em horário comercial'; }
        else { cls = 'quieto'; txt += ' · fora do horário comercial'; }
      }
      var guarda = s.guarda_versao ? ' · ' + s.guarda_versao + (s.guarda_runtime ? ' (' + s.guarda_runtime + ')' : '') : '';
      return '<span class="sinal ' + cls + '" title="' + esc(s.nome + ' · ' + txt + guarda) + '"><i></i>' + esc(s.nome) + '</span>';
    }).join('');
  }

  function pintarVivo() {
    var el = $('[data-vivo]'), b = $('b', el);
    if (est.semConexao) {
      el.className = 'vivo erro';
      b.textContent = 'sem conexão';
      return;
    }
    if (!est.okEm) { el.className = 'vivo'; b.textContent = 'conectando…'; return; }
    var s = Math.max(0, Math.round((Date.now() - est.okEm) / 1000));
    el.className = 'vivo ' + (s > 20 ? 'atraso' : 'ok');
    b.textContent = 'ao vivo · há ' + (s < 60 ? s + ' s' : Math.floor(s / 60) + ' min');
    el.title = 'Última leitura da central às ' + U.horaSeg(new Date(est.okEm));
  }

  $('[data-modo]').addEventListener('click', function () {
    if (est.painel) trocarModo(est.painel.modo === 'proteger' ? 'observar' : 'proteger');
  });
  $('[data-chip-ia]').addEventListener('click', function () { irPara('ia'); });

  function trocarModo(alvo) {
    var proteger = alvo === 'proteger';
    abrirModal({
      titulo: proteger ? 'Ligar o modo proteger?' : 'Voltar para o modo observar?',
      html: proteger
        ? '<div class="forte">Robôs, rajadas, Tor, força bruta, arquivos proibidos e bloqueios da IA passam a receber <b>403</b> em todos os sistemas. Rede confiável continua entrando.</div>' +
          '<p class="texto">Ataques certos já são barrados hoje; o que muda é o nível <b>suspeito</b>.</p>'
        : '<div class="forte ambar">Os suspeitos voltam a só ser registrados como “seria bloqueado”. Ataques certos continuam barrados.</div>',
      rotulo: proteger ? 'Ligar proteção' : 'Voltar a observar',
      perigo: proteger, semFoco: true,
      aoSalvar: function () {
        return chamar('sentinela_acao', { p_acao: 'modo', p_dados: { modo: alvo } }).then(function () {
          toast(proteger ? 'Modo proteger ligado.' : 'Modo observar ligado.');
          depoisDeAcao();
        });
      }
    });
  }

  /* =========================================================
     KPIs
     ========================================================= */
  function pintarKpis(k) {
    if (!k) return;
    var p = est.painel || {};
    var fora = {};
    (p.pontos || []).forEach(function (x) { if (x.pais && x.pais !== 'BR') fora[x.pais] = true; });
    var lim = p.ia && p.ia.limite_hora;
    var defs = [
      ['acessos', 'Acessos', 'new', 'últimas 24 h', 'Requisições registradas pelos guardas nas últimas 24 h'],
      ['bloqueados', 'Bloqueados', 'alert', U.pct(k.bloqueados, k.acessos) + ' dos acessos', 'Barrados com 403: ataque certo, lista de bloqueio ou suspeito no modo proteger'],
      ['observados', 'Observados', 'warn', U.pct(k.observados, k.acessos) + ' dos acessos', 'Seriam bloqueados no modo proteger (ou buscadores); entraram e ficaram registrados'],
      ['ips', 'IPs', 'brand', 'origens distintas', 'Endereços diferentes que acessaram nas últimas 24 h'],
      ['paises', 'Países', 'brand', Object.keys(fora).length + ' fora do Brasil', 'País nunca bloqueia sozinho: é só contexto'],
      ['analises', 'Análises da IA', 'ia', lim != null ? 'limite ' + U.num(lim) + ' por hora' : 'últimas 24 h', 'IPs analisados pela IA nas últimas 24 h'],
      ['identificados', 'Identificados', 'ok', 'IPs com login', 'IPs em que se sabe quem é: login pelo portal ou sessão do sistema']
    ];
    var caixa = $('[data-kpis]');
    // monta uma vez; depois só troca número, texto e cor (sem repetir a animação de entrada)
    if (!caixa.children.length) {
      caixa.innerHTML = defs.map(function (d, i) {
        return '<div class="kpi vazio" data-k="' + d[0] + '" title="' + esc(d[4]) + '" style="animation-delay:' + (i * 35) + 'ms">' +
          '<div class="kpi-topo"><span class="kpi-ic">' + svg(IC[d[0]]) + '</span><span class="lbl">' + d[1] + '</span></div>' +
          '<div class="val">0</div><div class="sub"></div></div>';
      }).join('');
    }
    defs.forEach(function (d) {
      var el = $('[data-k="' + d[0] + '"]', caixa);
      var v = +k[d[0]] || 0;
      el.className = 'kpi ' + (v ? d[2] : 'vazio');
      var val = $('.val', el), novo = U.num(v);
      if (val.textContent !== novo) val.textContent = novo;
      $('.sub', el).innerHTML = U.numeros(d[3]);
    });
  }

  /* =========================================================
     globo
     ========================================================= */
  function iniciarGlobo() {
    if (est.globoPedido) return;
    est.globoPedido = true;
    var el = $('[data-globo]'), msg = $('[data-globo-msg]');
    if (!SNT.globo.suportado()) {
      msg.className = 'globo__msg erro';
      msg.textContent = 'Este navegador não tem WebGL: o globo não pode ser desenhado. O resto do painel funciona normalmente.';
      return;
    }
    if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) {
      $('[data-globo-dica]').textContent = 'arraste para girar · pinça para aproximar · toque no ponto para ver o IP';
    }
    carregarScript(GLOBO_JS + '?v=2.46.2').then(function () {
      if (!window.Globe) throw new Error('globe.gl ausente');
      est.globo = SNT.globo.criar(el, { aoClicar: abrirGaveta });
      if (DEMO) SNT.globoDemo = est.globo; // só para inspecionar no console da demonstração
      msg.remove();
      if (est.painel) pintarGlobo(est.painel);
      if (est.modulo !== 'visao' || document.hidden) est.globo.pausar();
    }).catch(function () {
      msg.className = 'globo__msg erro';
      msg.textContent = 'Não foi possível desenhar o globo neste navegador. O resto do painel funciona normalmente.';
    });
  }

  function pintarGlobo(p) {
    var pts = p.pontos || [];
    var c = { seguro: 0, observado: 0, bloqueado: 0, analise: 0 };
    pts.forEach(function (x) { c[x.status] = (c[x.status] || 0) + 1; });
    $('[data-legenda]').innerHTML =
      '<span title="IPs sem nada contra"><i class="dot g"></i>Seguro <b>' + U.num(c.seguro) + '</b></span>' +
      '<span title="Seriam bloqueados no modo proteger"><i class="dot a"></i>Observado <b>' + U.num(c.observado) + '</b></span>' +
      '<span title="Bloqueio ativo"><i class="dot r"></i>Bloqueado <b>' + U.num(c.bloqueado) + '</b></span>' +
      '<span title="Esperando a análise da IA"><i class="dot b"></i>Em análise <b>' + U.num(c.analise) + '</b></span>' +
      '<span title="' + esc(p.casa ? p.casa.nome : '') + '"><i class="dot casa"></i>Lube</span>';
    var semGeo = (p.visitantes || []).filter(function (v) { return v.lat == null || v.lon == null; }).length;
    var r = est.globo ? est.globo.atualizar(pts, p.casa) : { pontos: pts.length, arcos: pts.length };
    // bloqueios do último minuto já vêm no feed: acende o anel vermelho na origem
    if (est.globo) {
      var onde = {};
      pts.forEach(function (x) { onde[x.ip] = x; });
      (p.feed || []).forEach(function (e) {
        var x = onde[e.ip];
        if (e.decisao === 'bloqueado' && x) est.globo.alertar(x.lat, x.lon, e.criado_em);
      });
    }
    subtitulo('[data-globo-sub]', U.num(r.pontos) + ' origens no mapa' +
      (r.pontos > SNT.globo.MAX_ARCOS ? ' · arcos das ' + SNT.globo.MAX_ARCOS + ' mais graves e recentes' : ' · arcos até a Lube') +
      (semGeo ? ' · ' + U.num(semGeo) + ' IP' + (semGeo > 1 ? 's' : '') + ' sem localização' : ''));
  }

  /* =========================================================
     feed "Agora"
     ========================================================= */
  function guardarFeed(lista) {
    (lista || []).forEach(function (e) { if (e && e.id != null) est.feed[e.id] = e; });
    var ids = Object.keys(est.feed).map(Number).sort(function (a, b) { return b - a; });
    ids.slice(MAX_FEED).forEach(function (id) { delete est.feed[id]; });
  }

  function pintarFeed() {
    var ids = Object.keys(est.feed).map(Number).sort(function (a, b) { return b - a; });
    var ol = $('[data-feed]');
    if (!ids.length) { ol.innerHTML = '<li class="vazio" style="display:block">Nenhum acesso nas últimas 24 h.</li>'; return; }
    ol.innerHTML = ids.map(function (id) {
      var e = est.feed[id];
      var novo = est.feedPintado && !est.feedVisto[id];
      est.feedVisto[id] = true;
      var sis = e.sistema_nome || est.nomes[e.projeto] || e.projeto || '';
      var dica = [e.motivo, e.regra ? 'regra: ' + U.regra(e.regra) : '', 'risco ' + (e.risco || 0), e.identidade || ''].filter(Boolean).join(' · ');
      return '<li class="' + esc(e.decisao) + (novo ? ' novo' : '') + '" data-ip="' + esc(e.ip) + '" title="' + esc(dica) + '">' +
        '<span class="h">' + U.horaSeg(e.criado_em) + '</span>' +
        '<div class="o"><div class="o1"><span class="met">' + esc(e.metodo || 'GET') + '</span>' + esc(U.corta(e.caminho || '/', 80)) + '</div>' +
        '<div class="o2"><span class="flag">' + U.bandeira(e.pais) + '</span> ' + esc(e.cidade || U.nomePais(e.pais)) +
        ' · <span class="mono">' + esc(e.ip) + '</span> · ' + esc(sis) + '</div></div>' +
        '<span class="d ' + esc(e.decisao) + '">' + esc(e.decisao) + '</span></li>';
    }).join('');
    est.feedPintado = true;
    var vistos = {};
    ids.forEach(function (id) { vistos[id] = true; });
    est.feedVisto = vistos;
  }
  $('[data-feed]').addEventListener('click', function (e) {
    var li = e.target.closest('li[data-ip]');
    if (li) abrirGaveta(li.getAttribute('data-ip'));
  });

  /* =========================================================
     acessos por hora — barras empilhadas, sem rótulo (24 barras)
     ========================================================= */
  function pintarHoras(lista) {
    var el = $('[data-horas]');
    var max = 0, total = 0, pico = null;
    lista.forEach(function (h) {
      var t = (+h.liberado || 0) + (+h.observado || 0) + (+h.bloqueado || 0);
      total += t;
      if (t > max) { max = t; pico = h; }
    });
    subtitulo('[data-horas-sub]', total
      ? U.qtd(total, 'acesso', 'acessos') + ' · pico às ' + U.hora(pico.h) + ' com ' + U.num(max)
      : 'sem acessos na janela');
    if (!total) { el.innerHTML = '<div class="horas-vazio">Nenhum acesso nas últimas 24 h.</div>'; return; }
    el.innerHTML = lista.map(function (h, i) {
      var seg = [['l', +h.liberado || 0], ['o', +h.observado || 0], ['b', +h.bloqueado || 0]];
      var barras = seg.filter(function (s) { return s[1] > 0; }).map(function (s) {
        return '<i class="' + s[0] + '" style="height:' + (s[1] / max * 100).toFixed(2) + '%"></i>';
      }).join('');
      var eixo = i % 3 === 0 ? '<span class="eixo">' + U.hora(h.h).slice(0, 2) + 'h</span>' : '';
      return '<div class="hb" data-i="' + i + '">' + barras + eixo + '</div>';
    }).join('');
    el._lista = lista;
  }
  (function () {
    var el = $('[data-horas]');
    function mostrar(ev) {
      var hb = ev.target.closest('.hb');
      if (!hb || !el._lista) { esconderDica(); return; }
      var h = el._lista[+hb.getAttribute('data-i')];
      var ini = new Date(h.h), fim = new Date(ini.getTime() + 3600000);
      var t = (+h.liberado || 0) + (+h.observado || 0) + (+h.bloqueado || 0);
      mostrarDica('<b>' + U.hora(ini) + ' – ' + U.hora(fim) + ' · ' + U.num(t) + ' acessos</b>' +
        '<div class="ln"><span><i class="dot g"></i>Liberado</span><span class="mono">' + U.num(h.liberado) + '</span></div>' +
        '<div class="ln"><span><i class="dot a"></i>Observado</span><span class="mono">' + U.num(h.observado) + '</span></div>' +
        '<div class="ln"><span><i class="dot r"></i>Bloqueado</span><span class="mono">' + U.num(h.bloqueado) + '</span></div>',
        ev.clientX, ev.clientY);
    }
    el.addEventListener('mousemove', mostrar);
    el.addEventListener('click', mostrar);
    el.addEventListener('mouseleave', esconderDica);
    window.addEventListener('scroll', esconderDica, { passive: true });
  })();

  /* =========================================================
     quem está acessando
     ========================================================= */
  function codigoRegra(v) {
    var m = v.status_motivo;
    if (m && /^[a-z_]+$/.test(m)) return m;
    return (v.bloqueio && v.bloqueio.regra) || null;
  }

  function pilula(v) {
    var st = U.status(v.status), sub;
    var confirmado = v.identidade_origem === 'passe' || v.identidade_origem === 'sessao_app';
    var cod = codigoRegra(v);
    var livre = v.status_motivo && !/^[a-z_]+$/.test(v.status_motivo) ? v.status_motivo : null;
    if (v.status === 'bloqueado') {
      var ate = v.bloqueio ? (v.bloqueio.ate ? 'até ' + U.ate(v.bloqueio.ate) : 'permanente') : '';
      sub = (U.regra(cod) || livre || 'bloqueio') + (ate ? ' · ' + ate : '');
    } else if (v.status === 'observado') {
      sub = cod === 'buscador' ? 'buscador · sem bloqueio' : (cod ? 'seria bloqueado: ' + U.regra(cod) : (livre || 'seria bloqueado'));
    } else if (v.status === 'analise') {
      sub = 'IA analisando';
    } else {
      sub = 'HTTPS · TLS' + (confirmado ? ' · login ES256 ✓' : '');
    }
    var dica = v.bloqueio ? 'Bloqueio #' + v.bloqueio.id + ' (' + v.bloqueio.nivel + '): ' + (v.bloqueio.motivo || '') : '';
    if (v.veredito) dica += (dica ? ' · ' : '') + 'IA: ' + v.veredito.veredito + ' ' + U.pct01(v.veredito.confianca) + ' — ' + (v.veredito.motivo || '');
    return '<span class="pilula ' + esc(v.status || 'seguro') + '"' + (dica ? ' title="' + esc(dica) + '"' : '') + '>' +
      '<b><span class="em">' + st.icone + '</span>' + st.nome + '</b><small>' + esc(sub) + '</small></span>';
  }

  function quem(v) {
    var h = '';
    if (v.identidade && (v.identidade_origem === 'passe' || v.identidade_origem === 'sessao_app')) {
      h = '<span class="em" title="' + esc(v.identidade) + '">' + esc(v.identidade) + '</span>' +
          '<small class="ok" title="' + (v.identidade_origem === 'passe' ? 'Entrou pelo Painel Lube (passe ES256)' : 'Sessão do próprio sistema') + '">✓ confirmado pelo login</small>';
    } else if (v.identidade) {
      h = '<span class="em" title="' + esc(v.identidade) + '">' + esc(v.identidade) + '</span>' +
          '<small class="prov" title="Login visto deste IP; este acesso não trouxe identidade">provável</small>';
    } else {
      h = '<small>anônimo</small>';
    }
    if (v.confiavel) h += '<br><span class="etq" title="IP numa rede confiável: nunca recebe bloqueio automático">Rede confiável</span>';
    // em tela média as colunas Dispositivo e Sistemas somem e vêm aqui embaixo
    var d = U.dispositivo(v.ua);
    h += '<small class="disp-alt' + (d.robo ? ' robo' : '') + '" title="' + esc(v.ua || 'sem user-agent') + '">' + esc(d.texto) + '</small>';
    var nomes = (v.projetos || []).map(function (p) { return est.nomes[p] || p; });
    if (nomes.length) h += '<small class="sis-alt" title="' + esc(nomes.join(' · ')) + '">' + esc(nomes.join(' · ')) + '</small>';
    return '<div class="c-quem">' + h + '</div>';
  }

  function corRisco(r) { return r >= 70 ? 'var(--brand-red-lt)' : r >= 30 ? 'var(--amber)' : 'var(--green)'; }
  function risco(r) {
    r = Math.max(0, Math.min(100, +r || 0));
    return '<div class="risco" title="Risco ' + r + ' de 100"><span class="barra"><i style="width:' + Math.max(r, 2) + '%;background:' + corRisco(r) + '"></i></span><span class="mono">' + r + '</span></div>';
  }

  var IC_ACAO = {
    liberar: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.8-1.2"/>',
    bloquear: '<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>',
    confiar: '<path d="M12 3 4 6v6c0 4.4 3.2 8.4 8 9.5 4.8-1.1 8-5.1 8-9.5V6Z"/><path d="m8.5 12 2.5 2.5 4.5-5"/>'
  };
  function botao(qual, ip, cls, rotulo, dica) {
    return '<button class="acao ic ' + cls + '" type="button" data-acao="' + qual + '" data-ip="' + esc(ip) + '" title="' + esc(dica) + '" aria-label="' + esc(dica) + '">' +
      svg(IC_ACAO[qual]) + '<span class="rot">' + rotulo + '</span></button>';
  }
  function botoes(v) {
    var b = [];
    var bl = v.bloqueio;
    if (bl) b.push(botao('liberar', v.ip, 'bom', 'Liberar', 'Liberar: revogar o bloqueio #' + bl.id));
    if (!bl || bl.nivel !== 'certo') b.push(botao('bloquear', v.ip, 'perigo', 'Bloquear', 'Bloquear ' + v.ip));
    // IP bloqueado não ganha "Confiar" de um clique: confiar revoga os bloqueios automáticos da rede.
    // Continua possível pela gaveta, com a lista do que será revogado.
    if (!v.confiavel && !bl && v.status !== 'bloqueado') b.push(botao('confiar', v.ip, 'info', 'Confiar', 'Marcar ' + v.ip + ' como rede confiável'));
    return '<div class="acoes">' + b.join('') + '</div>';
  }

  function linhaVisitante(v) {
    var d = U.dispositivo(v.ua);
    var br = (v.pais || '').toUpperCase() === 'BR';
    var nomes = (v.projetos || []).map(function (p) { return est.nomes[p] || p; });
    var sis = nomes.slice(0, 2).map(function (n) { return '<span class="sch">' + esc(n) + '</span>'; }).join('') +
      (nomes.length > 2 ? '<span class="sch mais" title="' + esc(nomes.join(' · ')) + '">+' + (nomes.length - 2) + '</span>' : '');
    return '<tr class="' + esc(v.status || 'seguro') + '" data-ip="' + esc(v.ip) + '" tabindex="0" aria-label="' + esc('Detalhe de ' + v.ip) + '">' +
      '<td data-c="local"><div class="c-local"><span class="flag">' + U.bandeira(v.pais) + '</span><div><b>' + esc(U.local(v)) + '</b><small>' +
        esc(br ? 'Brasil' : U.nomePais(v.pais)) + '</small></div></div></td>' +
      '<td data-c="ip"><span class="c-ip">' + esc(v.ip) + '</span></td>' +
      '<td data-c="quem">' + quem(v) + '</td>' +
      '<td data-c="disp"><span class="c-disp' + (d.robo ? ' robo' : '') + '" title="' + esc(v.ua || 'sem user-agent') + '">' + esc(d.texto) + '</span></td>' +
      '<td data-c="sis"><div class="chips">' + (sis || '<span class="fraco">—</span>') + '</div></td>' +
      '<td data-c="n" class="r"><span class="c-num">' + U.num(v.total) + '</span></td>' +
      '<td data-c="ult"><span class="c-ha" data-ha="' + esc(v.ultimo) + '" title="' + esc(U.dataHora(v.ultimo)) + '">' + esc(U.ha(v.ultimo)) + '</span></td>' +
      '<td data-c="risco">' + risco(v.risco) + '</td>' +
      '<td data-c="status">' + pilula(v) + '</td>' +
      '<td data-c="acoes" class="r">' + botoes(v) + '</td></tr>';
  }

  // troca as opções só quando mudam; com os mesmos valores, só o texto (não fecha um seletor aberto)
  function opcoes(sel, html) {
    if (sel._html === html) return;
    var tmp = document.createElement('select');
    tmp.innerHTML = html;
    var mesmos = tmp.options.length === sel.options.length && Array.prototype.every.call(tmp.options, function (o, i) {
      return o.value === sel.options[i].value;
    });
    if (mesmos) {
      Array.prototype.forEach.call(tmp.options, function (o, i) {
        if (sel.options[i].textContent !== o.textContent) sel.options[i].textContent = o.textContent;
      });
    } else sel.innerHTML = html;
    sel._html = html;
  }

  function montarFiltros() {
    var vs = est.visitantes, f = est.filtros;
    var cont = { bloqueado: 0, observado: 0, analise: 0, seguro: 0 };
    var paises = {};
    vs.forEach(function (v) {
      cont[v.status] = (cont[v.status] || 0) + 1;
      var cc = (v.pais || '??').toUpperCase();
      paises[cc] = (paises[cc] || 0) + 1;
    });
    var selS = $('[data-f-status]');
    opcoes(selS, '<option value="">Todos os status (' + U.num(vs.length) + ')</option>' +
      ['bloqueado', 'observado', 'analise', 'seguro'].map(function (s) {
        var st = U.status(s);
        return '<option value="' + s + '">' + st.icone + ' ' + st.nome + ' (' + U.num(cont[s] || 0) + ')</option>';
      }).join(''));
    selS.value = f.status;

    var selSis = $('[data-f-sistema]');
    opcoes(selSis, '<option value="">Todos os sistemas</option>' + ((est.painel && est.painel.sistemas) || []).map(function (s) {
      return '<option value="' + esc(s.projeto) + '">' + esc(s.nome) + '</option>';
    }).join(''));
    selSis.value = f.sistema;
    if (selSis.value !== f.sistema) { f.sistema = ''; selSis.value = ''; }

    var selP = $('[data-f-pais]');
    var lista = Object.keys(paises).sort(function (a, b) { return paises[b] - paises[a] || a.localeCompare(b); });
    opcoes(selP, '<option value="">Todos os países</option>' + lista.map(function (cc) {
      return '<option value="' + esc(cc) + '">' + U.bandeira(cc) + ' ' + esc(U.nomePais(cc)) + ' (' + U.num(paises[cc]) + ')</option>';
    }).join(''));
    selP.value = f.pais;
    if (selP.value !== f.pais) { f.pais = ''; selP.value = ''; }
  }

  function filtrar(vs) {
    var f = est.filtros, q = f.busca.toLowerCase();
    return vs.filter(function (v) {
      if (f.status && v.status !== f.status) return false;
      if (f.sistema && (v.projetos || []).indexOf(f.sistema) < 0) return false;
      if (f.pais && (v.pais || '??').toUpperCase() !== f.pais) return false;
      if (q) {
        var alvo = [v.ip, v.cidade, v.regiao, v.pais, U.nomePais(v.pais), v.identidade, v.ua].join(' ').toLowerCase();
        if (alvo.indexOf(q) < 0) return false;
      }
      return true;
    });
  }

  function pintarVisitantes() {
    var vs = est.visitantes, lista = filtrar(vs);
    var sub = U.qtd(vs.length, 'IP', 'IPs') + ' nas últimas 24 h';
    if (lista.length !== vs.length) sub = U.num(lista.length) + ' de ' + sub;
    if (vs.length >= 300) sub += ' · mostrando os 300 mais recentes';
    subtitulo('[data-vis-sub]', sub);
    var corpo = $('[data-visitantes]');
    if (!lista.length) {
      corpo.innerHTML = '<tr><td colspan="10" class="vazio">' + (vs.length ? 'Nenhum IP com esses filtros.' : 'Nenhum acesso nas últimas 24 h.') + '</td></tr>';
      return;
    }
    // linha por linha (chave = IP): só a célula que mudou é trocada, e a linha só é movida se a ordem
    // mudou. Seleção de texto, foco de teclado e o hover não se perdem a cada leitura.
    var atuais = {}, foco = corpo.contains(document.activeElement) ? document.activeElement : null;
    $$('tr', corpo).forEach(function (tr) {
      var ip = tr.getAttribute('data-ip');
      if (ip == null) tr.remove(); else atuais[ip] = tr;
    });
    var tmp = document.createElement('tbody'), antes = null;
    lista.forEach(function (v) {
      var html = linhaVisitante(v), tr = atuais[v.ip];
      if (tr) {
        delete atuais[v.ip];
        if (tr._html !== html) {
          tmp.innerHTML = html;
          var novo = tmp.firstElementChild;
          if (tr.className !== novo.className) tr.className = novo.className;
          $$('td', novo).forEach(function (td) {
            var velho = $('td[data-c="' + td.getAttribute('data-c') + '"]', tr);
            if (velho && velho.innerHTML !== td.innerHTML) velho.innerHTML = td.innerHTML;
          });
          tr._html = html;
        }
      } else {
        tmp.innerHTML = html;
        tr = tmp.firstElementChild;
        tr._html = html;
      }
      var lugar = antes ? antes.nextElementSibling : corpo.firstElementChild;
      if (lugar !== tr) corpo.insertBefore(tr, lugar);
      antes = tr;
    });
    Object.keys(atuais).forEach(function (ip) { atuais[ip].remove(); });
    // mover a linha (nova ordem da leitura completa) tira o foco dela: devolve
    if (foco && foco.isConnected && document.activeElement !== foco) foco.focus({ preventScroll: true });
  }

  $('[data-f-status]').addEventListener('change', function (e) { est.filtros.status = e.target.value; pintarVisitantes(); });
  $('[data-f-sistema]').addEventListener('change', function (e) { est.filtros.sistema = e.target.value; pintarVisitantes(); });
  $('[data-f-pais]').addEventListener('change', function (e) { est.filtros.pais = e.target.value; pintarVisitantes(); });
  (function () {
    var t;
    $('[data-f-busca]').addEventListener('input', function (e) {
      clearTimeout(t);
      t = setTimeout(function () { est.filtros.busca = e.target.value.trim(); pintarVisitantes(); }, 160);
    });
  })();

  $('[data-visitantes]').addEventListener('click', function (e) {
    var b = e.target.closest('[data-acao]');
    if (b) { e.stopPropagation(); acaoNoIp(b.getAttribute('data-acao'), b.getAttribute('data-ip')); return; }
    var tr = e.target.closest('tr[data-ip]');
    if (tr) abrirGaveta(tr.getAttribute('data-ip'));
  });

  // Enter na linha abre a gaveta (teclado)
  $('[data-visitantes]').addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || e.target.tagName !== 'TR') return;
    abrirGaveta(e.target.getAttribute('data-ip'));
  });

  function visitante(ip) {
    for (var i = 0; i < est.visitantes.length; i++) if (est.visitantes[i].ip === ip) return est.visitantes[i];
    return null;
  }

  /* =========================================================
     ações sobre um IP: bloquear, liberar, confiar
     ========================================================= */
  function acaoNoIp(qual, ip, extra) {
    var v = extra || visitante(ip) || { ip: ip };
    if (qual === 'bloquear') acaoBloquear(ip, v);
    else if (qual === 'liberar') {
      var bl = v.bloqueio || (extra && extra.bloqueio);
      if (!bl || bl.valor) { acaoLiberar(bl, ip); return; }
      // o bloqueio do visitante não traz o alvo: procura pelo id para avisar quando for uma faixa inteira
      acharBloqueio(bl.id, ip).then(function (b) {
        acaoLiberar(b ? Object.assign({}, bl, { valor: b.valor, tipo: b.tipo, origem: b.origem })
                      : Object.assign({}, bl, { naoConfirmado: true }), ip);
      });
    }
    else if (qual === 'confiar') acaoConfiar(ip);
  }

  // sentinela_ip traz só os 10 bloqueios mais recentes que contêm o IP; a lista de ativos traz todos
  function acharBloqueio(id, ip) {
    function pelo(l) { return (l || []).filter(function (x) { return +x.id === +id; })[0] || null; }
    return chamar('sentinela_ip', { p_ip: ip }).then(function (d) { return pelo(d && d.bloqueios); }, function () { return null; })
      .then(function (b) {
        return b || chamar('sentinela_lista_bloqueios', { p_incluir_inativos: false }).then(pelo, function () { return null; });
      });
  }

  function formBloqueio(valor, v) {
    return '<label class="campo"><span>IP ou faixa (CIDR)</span><input type="text" name="valor" value="' + esc(valor || '') + '" placeholder="203.0.113.7 ou 203.0.113.0/24" spellcheck="false"></label>' +
      '<label class="campo"><span>Duração</span><select name="duracao">' +
        '<option value="1h">1 hora</option><option value="24h" selected>24 horas</option><option value="7d">7 dias</option><option value="permanente">Permanente</option>' +
      '</select></label>' +
      '<label class="campo"><span>Motivo</span><input type="text" name="motivo" maxlength="200" placeholder="por que este bloqueio existe"></label>' +
      (v && v.confiavel ? '<div class="forte ambar">Este IP está numa <b>rede confiável</b>. Bloqueio manual vale mesmo assim.</div>' : '') +
      '<p class="texto">Bloqueio manual é <b>certo</b>: vale nos dois modos.</p>';
  }

  function acaoBloquear(ip, v) {
    abrirModal({
      titulo: ip ? 'Bloquear ' + ip : 'Novo bloqueio',
      html: formBloqueio(ip, v),
      rotulo: 'Bloquear', perigo: true,
      aoSalvar: function () {
        var valor = campoValor('valor'), motivo = campoValor('motivo'), duracao = campoValor('duracao');
        if (!U.ipOuCidr(valor)) throw new Error('Informe um IP ou CIDR válido.');
        if (!motivo) throw new Error('Informe o motivo.');
        return chamar('sentinela_acao', { p_acao: 'bloquear', p_dados: { valor: valor, duracao: duracao, motivo: motivo } }).then(function (r) {
          toast('Bloqueio criado para ' + valor + '.' + (r && r.confiavel ? ' Atenção: cruza uma rede confiável.' : ''), r && r.confiavel);
          depoisDeAcao();
        });
      }
    });
    if (ip) setTimeout(function () { var m = mForm.elements.motivo; if (m) m.focus(); }, 70);
  }

  function acaoLiberar(bl, ip) {
    if (!bl) { toast('Este IP não tem bloqueio ativo.', true); return; }
    // mostra o alvo real do bloqueio (pode ser uma faixa), nunca só o IP da linha
    var alvo = bl.valor || (bl.naoConfirmado ? '' : ip) || '';
    var faixaInteira = !!bl.valor && (String(bl.valor).indexOf('/') > -1 || (!!ip && bl.valor !== ip));
    abrirModal({
      titulo: 'Revogar o bloqueio #' + bl.id + '?',
      html: '<p class="texto">' + (alvo ? '<b class="mono">' + esc(alvo) + '</b>' : 'alvo do bloqueio #' + esc(bl.id) + ' não confirmado') +
            ' · ' + esc(U.regra(bl.regra) || bl.origem || 'manual') +
            ' · ' + esc(bl.nivel || '') + (bl.motivo ? '<br>' + esc(bl.motivo) : '') + '</p>' +
            (faixaInteira ? '<div class="forte ambar">O bloqueio é da faixa <b class="mono">' + esc(bl.valor) + '</b>: ela inteira fica liberada' +
              (ip && bl.valor !== ip ? ', não só <span class="mono">' + esc(ip) + '</span>' : '') + '.</div>' : '') +
            (bl.naoConfirmado ? '<div class="forte ambar">Não foi possível confirmar o alvo: o bloqueio pode ser de uma faixa inteira, não só de <b class="mono">' +
              esc(ip || '') + '</b>. Confira em Bloqueios antes de revogar.</div>' : '') +
            '<p class="texto">As regras de ataque certo continuam valendo para cada requisição.</p>',
      rotulo: 'Revogar', semFoco: true,
      aoSalvar: function () {
        return chamar('sentinela_acao', { p_acao: 'desbloquear', p_dados: { id: +bl.id } }).then(function () {
          toast('Bloqueio #' + bl.id + ' revogado.');
          depoisDeAcao();
        });
      }
    });
  }

  // bloqueios automáticos (regra e IA) ativos dentro da rede: o banco revoga todos ao confiar nela
  function bloqueiosNaRede(valor) {
    return chamar('sentinela_lista_bloqueios', { p_incluir_inativos: false }).then(function (l) {
      return (l || []).filter(function (b) {
        return b.ativo !== false && (b.origem === 'regra' || b.origem === 'ia') && b.tipo !== 'ja4' && U.contem(valor, b.valor);
      });
    });
  }
  function avisoRevogar(valor, l) {
    if (!l) {
      return '<div class="forte">Não foi possível conferir os bloqueios desta rede. Ao confirmar, todo bloqueio automático ativo dentro de <b class="mono">' +
        esc(valor) + '</b> é revogado, inclusive de ataque certo.</div>';
    }
    var certos = l.filter(function (b) { return b.nivel === 'certo'; }).length;
    return '<div class="forte">' + (certos ? '<b>Atenção:</b> ' + U.qtd(certos, 'deles é', 'deles são') + ' de ataque <b>certo</b>. ' : '') +
      'Confiar em <b class="mono">' + esc(valor) + '</b> revoga ' + U.qtd(l.length, 'bloqueio automático ativo', 'bloqueios automáticos ativos') + ':</div>' +
      '<div class="lista-mini">' + l.slice(0, 12).map(function (b) {
        return '<div><span class="h">#' + esc(b.id) + '</span><span class="t"><span class="mono">' + esc(b.valor) + '</span> · ' +
          esc(U.regra(b.regra) || b.origem || '') + '</span>' + nivel(b.nivel) + '</div>';
      }).join('') + (l.length > 12 ? '<div><span class="t fraco">e mais ' + U.num(l.length - 12) + '</span></div>' : '') + '</div>';
  }

  function acaoConfiar(ip) {
    var conferido = null; // valor cuja lista de revogações já foi mostrada (o 2º clique confirma)
    abrirModal({
      titulo: ip ? 'Confiar em ' + ip : 'Nova rede confiável',
      html: '<label class="campo"><span>IP ou faixa (CIDR)</span><input type="text" name="valor" value="' + esc(ip || '') + '" placeholder="203.0.113.0/28" spellcheck="false"></label>' +
            '<label class="campo"><span>Descrição</span><input type="text" name="descricao" maxlength="120" placeholder="ex.: escritório Cariacica"></label>' +
            '<div class="forte ambar">Rede confiável <b>nunca</b> recebe bloqueio automático e ignora o nível suspeito. Ao confirmar, os bloqueios automáticos ' +
            '(regra e IA) ativos dentro dela são <b>revogados</b>. Use só para redes da Lube.</div>' +
            '<div data-cf-revogar></div>',
      rotulo: 'Confiar',
      aoSalvar: function () {
        var valor = campoValor('valor'), desc = campoValor('descricao');
        if (!U.ipOuCidr(valor)) throw new Error('Informe um IP ou CIDR válido.');
        if (!desc) throw new Error('Informe a descrição.');
        var salvar = function () {
          return chamar('sentinela_acao', { p_acao: 'confiar', p_dados: { valor: valor, descricao: desc } }).then(function (r) {
            var n = +(r && r.bloqueios_revogados) || 0;
            toast(valor + ' agora é confiável.' + (n ? ' ' + U.qtd(n, 'bloqueio automático revogado', 'bloqueios automáticos revogados') + '.' : ''));
            depoisDeAcao();
          });
        };
        if (conferido === valor) return salvar();
        return bloqueiosNaRede(valor).then(null, function () { return null; }).then(function (l) {
          if (l && !l.length) return salvar();
          conferido = valor;
          $('[data-cf-revogar]', mForm).innerHTML = avisoRevogar(valor, l);
          mOk.textContent = l ? 'Confiar e revogar ' + U.num(l.length) : 'Confiar mesmo assim';
          mOk.className = 'btn red';
          return false;
        });
      }
    });
    // mudou o valor depois do aviso: o aviso era de outra rede, confere de novo
    mForm.elements.valor.addEventListener('input', function () {
      if (!conferido) return;
      conferido = null;
      $('[data-cf-revogar]', mForm).innerHTML = '';
      mOk.textContent = 'Confiar'; mOk.className = 'btn blue';
    });
    if (ip) setTimeout(function () { var m = mForm.elements.descricao; if (m) m.focus(); }, 70);
  }

  // depois de mudar algo: painel em seguida e o módulo aberto de novo.
  // Uma leitura em curso pode ser de antes da ação: espera ela e lê outra vez.
  function depoisDeAcao() {
    clearTimeout(est.tPainel);
    (est.painelEmCurso || Promise.resolve()).catch(function () {}).then(function () { return atualizarPainel(); })
      .catch(function () {}).then(function () {
        agendarPainel(T_PAINEL);
        if (est.modulo !== 'visao') carregarModulo(est.modulo, 'acao');
        if (!$('[data-gaveta]').hidden && est.gavetaIp) abrirGaveta(est.gavetaIp, true);
      });
  }

  /* =========================================================
     gaveta do IP
     ========================================================= */
  var gaveta = $('[data-gaveta]'), gVeu = $('[data-gaveta-veu]');
  function fecharGaveta() {
    gaveta.hidden = true; gVeu.hidden = true; est.gavetaIp = null;
    document.body.classList.remove('trava');
  }
  $('[data-gaveta-fechar]').addEventListener('click', fecharGaveta);
  gVeu.addEventListener('click', fecharGaveta);

  function cabecalhoGaveta(ip, v, perfil) {
    var g = v || perfil || {};
    var fora = g.pais && String(g.pais).toUpperCase() !== 'BR';
    return '<div class="gaveta-local"><span class="flag">' + U.bandeira(g.pais) + '</span><span>' +
      esc(g.cidade || g.pais ? U.local(g) : 'Local desconhecido') + (fora && g.cidade ? ' · ' + esc(U.nomePais(g.pais)) : '') + '</span></div>' +
      '<div class="gaveta-ip">' + esc(ip) + '</div>' +
      '<div class="gaveta-cab-pils">' + (v ? pilula(v) : '') + (v && v.confiavel ? '<span class="etq">Rede confiável</span>' : '') + '</div>';
  }

  function ativoAgora(b) {
    if (b.ativo != null) return !!b.ativo;
    return !b.revogado_em && (!b.expira_em || new Date(b.expira_em).getTime() > Date.now());
  }

  function abrirGaveta(ip, silencioso) {
    if (!ip) return;
    est.gavetaIp = ip;
    var v = visitante(ip);
    $('[data-gaveta-cab]').innerHTML = cabecalhoGaveta(ip, v, null);
    if (!silencioso) $('[data-gaveta-corpo]').innerHTML = '<div class="vazio">Carregando o histórico…</div>';
    gaveta.hidden = false; gVeu.hidden = false;
    document.body.classList.add('trava');
    chamar('sentinela_ip', { p_ip: ip }).then(function (d) {
      if (est.gavetaIp !== ip) return;
      marcarOk();
      pintarGaveta(ip, v, d);
    }).catch(function (err) {
      if (est.gavetaIp !== ip) return;
      $('[data-gaveta-corpo]').innerHTML = '<div class="aviso erro"><span class="ic">⚠</span><div><b>Não foi possível ler este IP.</b><br>' + esc(texto(err)) + '</div></div>';
    });
  }

  function pintarGaveta(ip, v, d) {
    var corpo = $('[data-gaveta-corpo]');
    if (!d) { corpo.innerHTML = '<div class="vazio">Nenhum registro deste IP.</div>'; return; }
    var p = d.perfil || {};
    $('[data-gaveta-cab]').innerHTML = cabecalhoGaveta(ip, v, p);
    // botões pelo estado lido agora (o do visitante pode ter até 60 s). A lista traz só os 10 bloqueios
    // mais recentes: com 10, um ativo mais antigo (ex.: a faixa) pode ter ficado de fora e vale o do visitante.
    var bls = d.bloqueios || [], ativos = bls.filter(ativoAgora);
    var doVis = v && v.bloqueio ? ativos.filter(function (b) { return +b.id === +v.bloqueio.id; })[0] : null;
    var bloqAtivo = doVis || ativos.filter(function (b) { return b.nivel === 'certo'; })[0] || ativos[0] || null;
    var ref = Object.assign({}, v || { ip: ip }, {
      confiavel: !!d.confiavel, confiaveis: d.confiaveis || [],
      bloqueio: bloqAtivo ? { id: bloqAtivo.id, nivel: bloqAtivo.nivel, regra: bloqAtivo.regra || bloqAtivo.origem,
                              motivo: bloqAtivo.motivo, valor: bloqAtivo.valor, ate: bloqAtivo.expira_em, origem: bloqAtivo.origem }
                          : (v && v.bloqueio && bls.length >= 10 ? v.bloqueio : null)
    });
    est.gavetaRef = ref;

    var h = '';
    h += '<div class="acoes" data-g-acoes>' +
      (ref.bloqueio ? '<button class="acao bom" type="button" data-g="liberar">Liberar</button>' : '') +
      (!ref.bloqueio || ref.bloqueio.nivel !== 'certo' ? '<button class="acao perigo" type="button" data-g="bloquear">Bloquear</button>' : '') +
      (!d.confiavel ? '<button class="acao info" type="button" data-g="confiar">Confiar</button>' : '') +
      ((d.confiaveis || []).length ? '<button class="acao perigo" type="button" data-g="desconfiar" title="' +
        esc(d.confiaveis.map(function (c) { return c.valor + ' · ' + (c.descricao || ''); }).join(' | ')) +
        '">Remover confiança</button>' : '') + '</div>';

    var fichas = [
      ['Primeiro visto', U.dataHora(p.primeiro_visto)], ['Último', U.ha(p.ultimo_visto)], ['Acessos', U.num(p.total)],
      ['Risco máx.', U.num(p.risco_max)], ['Descartados', U.num(p.descartados)],
      ['Senhas erradas 10 min', U.num(d.tentativas_10min)],
      ['Tor', d.tor ? 'sim' : 'não'], ['Confiável', d.confiavel ? 'sim' : 'não'],
      ['Último veredito', p.ultimo_veredito || '—']
    ];
    h += '<div class="fichas">' + fichas.map(function (f) {
      return '<div class="ficha"><span>' + esc(f[0]) + '</span><b title="' + esc(f[1]) + '">' + esc(f[1]) + '</b></div>';
    }).join('') + '</div>';

    var disp = U.dispositivo(p.ua_ultimo);
    h += '<h4>Dispositivo</h4><div class="ua-bruto"><b>' + esc(disp.texto) + '</b><br>' + esc(p.ua_ultimo || 'sem user-agent') + '</div>';

    var sis = (p.projetos || []).map(function (x) { return '<span class="sch">' + esc(est.nomes[x] || x) + '</span>'; }).join('');
    if (sis) h += '<h4>Sistemas</h4><div class="chips">' + sis + '</div>';

    var ids = d.identidades || [];
    h += '<h4>Quem já entrou deste IP <span class="qtd">' + ids.length + '</span></h4>';
    h += ids.length ? '<div class="lista-mini">' + ids.map(function (x) {
      return '<div><span class="h">' + U.dataHora(x.criado_em) + '</span><span class="t">' + esc(x.email) + '</span><span class="chip azul">' + esc(x.origem || '') + '</span></div>';
    }).join('') + '</div>' : '<div class="vazio">Nenhum login visto deste IP.</div>';

    var an = d.analises || [];
    h += '<h4>Análises da IA <span class="qtd">' + an.length + '</span></h4>';
    h += an.length ? '<div class="lista-mini">' + an.map(function (a) {
      return '<div><span class="h">' + U.dataHora(a.criado_em) + '</span><span class="t">' + veredito(a.veredito) +
        ' <span class="mono">' + U.pct01(a.confianca) + '</span> · ' + esc(acaoIa(a.acao)) + '</span><span class="fraco"></span>' +
        '<span class="larga">' + esc(a.motivo || a.erro || '') + (a.aplicado && a.aplicado !== 'nenhum' ? ' · <b>' + esc(a.aplicado) + '</b>' : '') + '</span></div>';
    }).join('') + '</div>' : '<div class="vazio">Ainda não analisado.</div>';

    var bl = d.bloqueios || [];
    h += '<h4>Bloqueios <span class="qtd">' + bl.length + '</span></h4>';
    h += bl.length ? '<div class="lista-mini">' + bl.map(function (b) {
      var at = ativoAgora(b);
      return '<div><span class="h">#' + esc(b.id) + '</span><span class="t">' + nivel(b.nivel) + ' ' + esc(U.regra(b.regra) || b.origem || '') +
        ' <span class="fraco">· ' + esc(b.valor || '') + '</span></span><span class="chip ' + (at ? 'vermelho' : 'cinza') + '">' + (at ? 'ativo' : (b.revogado_em ? 'revogado' : 'vencido')) + '</span>' +
        '<span class="larga">' + esc(b.motivo || '') + ' · ' + U.dataHora(b.criado_em) + ' → ' + esc(U.ate(b.expira_em)) + '</span></div>';
    }).join('') + '</div>' : '<div class="vazio">Nunca foi bloqueado.</div>';

    var evs = d.eventos || [];
    h += '<h4>Últimos acessos <span class="qtd">' + evs.length + '</span></h4>';
    h += evs.length ? '<div class="lista-mini">' + evs.map(function (e) {
      return '<div title="' + esc([e.regra ? 'regra: ' + U.regra(e.regra) : '', 'risco ' + (e.risco || 0), e.idioma ? 'idioma ' + e.idioma : 'sem idioma', e.sec_fetch_mode ? 'sec-fetch ' + e.sec_fetch_mode : 'sem sec-fetch'].filter(Boolean).join(' · ')) + '">' +
        '<span class="h" title="' + esc(U.dataHora(e.criado_em)) + '">' + esc(U.curta(e.criado_em)) + '</span>' +
        '<span class="t"><span class="mono fraco">' + esc(e.metodo || '') + '</span> ' + esc(U.corta((e.caminho || '') + (e.consulta || ''), 90)) +
        ' <span class="fraco">· ' + esc(est.nomes[e.projeto] || e.projeto) + '</span></span>' +
        '<span class="chip ' + ({ bloqueado: 'vermelho', observado: 'ambar', liberado: 'verde' }[e.decisao] || 'cinza') + '">' + esc(e.decisao) + '</span></div>';
    }).join('') + '</div>' : '<div class="vazio">Sem acessos registrados.</div>';

    corpo.innerHTML = h;
  }
  $('[data-gaveta-corpo]').addEventListener('click', function (e) {
    var b = e.target.closest('[data-g]');
    if (!b || !est.gavetaIp) return;
    var ref = est.gavetaRef || { ip: est.gavetaIp };
    if (b.getAttribute('data-g') === 'desconfiar') { removerConfianca(null, est.gavetaIp, ref.confiaveis || []); return; }
    acaoNoIp(b.getAttribute('data-g'), est.gavetaIp, ref);
  });

  function veredito(v) {
    var m = { legitimo: ['verde', 'legítimo'], suspeito: ['ambar', 'suspeito'], malicioso: ['vermelho', 'malicioso'], erro: ['cinza', 'erro'] }[v] || ['cinza', v || '—'];
    return '<span class="chip ' + m[0] + '">' + esc(m[1]) + '</span>';
  }
  function nivel(n) {
    return n === 'certo' ? '<span class="chip vermelho">certo</span>' : '<span class="chip ambar">suspeito</span>';
  }
  function acaoIa(a) {
    return { nenhuma: 'nenhuma', observar: 'observar', bloquear_1h: 'bloquear 1 h', bloquear_24h: 'bloquear 24 h', bloquear_7d: 'bloquear 7 dias' }[a] || a || '—';
  }

  /* =========================================================
     2. bloqueios
     ========================================================= */
  function carregarBloqueios() {
    return chamar('sentinela_lista_bloqueios', { p_incluir_inativos: est.blInativos }).then(function (l) {
      marcarOk();
      pintarBloqueios(l || []);
    }).catch(function (err) {
      pintarSeMudou($('[data-bl-lista]'), '<tr><td colspan="9" class="vazio">' + esc(texto(err)) + '</td></tr>');
      marcarFalha(err);
    });
  }
  function pintarBloqueios(l) {
    var obs = !est.painel || est.painel.modo !== 'proteger';
    var ativos = l.filter(function (b) { return b.ativo; });
    var cert = ativos.filter(function (b) { return b.nivel === 'certo'; }).length;
    subtitulo('[data-bl-sub]', U.qtd(ativos.length, 'ativo', 'ativos') + ' · ' + U.qtd(cert, 'certo', 'certos') + ' · ' +
      U.qtd(ativos.length - cert, 'suspeito', 'suspeitos') +
      (obs && ativos.length - cert ? ' (só registram no modo observar)' : ''));
    pintarSeMudou($('[data-bl-lista]'), l.length ? l.map(function (b) {
      var sit;
      if (b.ativo) sit = b.nivel === 'suspeito' && obs ? '<span class="chip ambar" title="No modo observar, bloqueio suspeito só registra">ativo · só registra</span>' : '<span class="chip vermelho">ativo</span>';
      else sit = b.revogado_em ? '<span class="chip cinza tracejado" title="Revogado em ' + esc(U.dataHora(b.revogado_em)) + '">revogado</span>' : '<span class="chip cinza">vencido</span>';
      var origem = { regra: 'azul', ia: 'roxo', manual: 'cinza' }[b.origem] || 'cinza';
      return '<tr class="' + (b.ativo ? '' : 'inativo') + '">' +
        '<td data-rot="Alvo"><span class="alvo">' + esc(b.valor) + '</span><br><span class="fraco">' + esc(b.tipo || '') + ' · #' + esc(b.id) + '</span></td>' +
        '<td data-rot="Nível">' + nivel(b.nivel) + '</td>' +
        '<td data-rot="Origem"><span class="chip ' + origem + '">' + esc(b.origem || '') + '</span>' + (b.regra ? '<br><span class="fraco">' + esc(U.regra(b.regra)) + '</span>' : '') + '</td>' +
        '<td data-rot="Motivo" class="motivo larga-m">' + esc(b.motivo || '') + '</td>' +
        '<td data-rot="Desde" class="quando">' + U.dataHora(b.criado_em) + '</td>' +
        '<td data-rot="Até" class="quando">' + esc(b.expira_em ? U.dataHora(b.expira_em) : 'permanente') + '</td>' +
        '<td data-rot="Barrados" class="r"><span class="c-num">' + U.num(b.hits) + '</span>' + (b.ultimo_hit ? '<br><span class="fraco">' + esc(U.ha(b.ultimo_hit)) + '</span>' : '') + '</td>' +
        '<td data-rot="Situação">' + sit + '</td>' +
        '<td class="r col-acao larga-m">' + (b.ativo ? '<button class="acao bom" type="button" data-revogar="' + esc(b.id) + '">Revogar</button>' : '') + '</td></tr>';
    }).join('') : '<tr><td colspan="9" class="vazio">' + (est.blInativos ? 'Nenhum bloqueio registrado.' : 'Nenhum bloqueio ativo.') + '</td></tr>');
    est.bloqueios = l;
  }
  $('[data-bl-inativos]').addEventListener('change', function (e) { est.blInativos = e.target.checked; carregarBloqueios(); });
  $('[data-novo-bloqueio]').addEventListener('click', function () { acaoBloquear('', null); });
  $('[data-bl-lista]').addEventListener('click', function (e) {
    var b = e.target.closest('[data-revogar]');
    if (!b) return;
    var id = +b.getAttribute('data-revogar');
    var bl = (est.bloqueios || []).filter(function (x) { return +x.id === id; })[0];
    if (bl) acaoLiberar(bl, null);
  });

  /* =========================================================
     3. confiáveis
     ========================================================= */
  function carregarConfiaveis() {
    return chamar('sentinela_lista_confiaveis', {}).then(function (l) {
      marcarOk();
      l = l || [];
      est.confiaveis = l;
      var ativos = l.filter(function (c) { return c.ativo; });
      var login = ativos.filter(function (c) { return c.origem === 'login'; }).length;
      subtitulo('[data-cf-sub]', U.qtd(ativos.length, 'ativa', 'ativas') + ' · ' + U.qtd(ativos.length - login, 'manual', 'manuais') + ' · ' +
        U.qtd(login, 'aprendida', 'aprendidas') + ' por login');
      pintarSeMudou($('[data-cf-lista]'), l.length ? l.map(function (c) {
        var origem = c.origem === 'login'
          ? '<span class="chip azul" title="Aprendido quando alguém fez login deste IP; vence em 7 dias sem novo login">aprendido por login</span>' + (c.identidade ? '<br><span class="fraco">' + esc(c.identidade) + '</span>' : '')
          : '<span class="chip cinza">manual</span>';
        return '<tr class="' + (c.ativo ? '' : 'inativo') + '">' +
          '<td data-rot="Rede"><span class="alvo">' + esc(c.valor) + '</span><br><span class="fraco">' + esc(c.tipo || '') + ' · #' + esc(c.id) + '</span></td>' +
          '<td data-rot="Descrição" class="larga-m">' + esc(c.descricao || '') + '</td>' +
          '<td data-rot="Origem">' + origem + '</td>' +
          '<td data-rot="Desde" class="quando">' + U.dataHora(c.criado_em) + '</td>' +
          '<td data-rot="Expira" class="quando">' + esc(c.expira_em ? U.dataHora(c.expira_em) : 'sem prazo') + '</td>' +
          '<td data-rot="Situação">' + (c.ativo ? '<span class="chip verde">ativa</span>' : '<span class="chip cinza">inativa</span>') + '</td>' +
          '<td class="r col-acao larga-m">' + (c.ativo ? '<button class="acao perigo" type="button" data-desconfiar="' + esc(c.id) + '">Remover</button>' : '') + '</td></tr>';
      }).join('') : '<tr><td colspan="7" class="vazio">Nenhuma rede confiável.</td></tr>');
    }).catch(function (err) {
      pintarSeMudou($('[data-cf-lista]'), '<tr><td colspan="7" class="vazio">' + esc(texto(err)) + '</td></tr>');
      marcarFalha(err);
    });
  }
  $('[data-novo-confiavel]').addEventListener('click', function () { acaoConfiar(''); });
  $('[data-cf-lista]').addEventListener('click', function (e) {
    var b = e.target.closest('[data-desconfiar]');
    if (!b) return;
    var id = +b.getAttribute('data-desconfiar');
    removerConfianca((est.confiaveis || []).filter(function (x) { return +x.id === id; })[0]);
  });
  // c: a entrada escolhida na lista de Confiáveis. Pela gaveta: ip + todas as entradas ativas que o cobrem
  // (ex.: a /28 do escritório e a /32 aprendida no login) e o admin escolhe qual sai.
  function removerConfianca(c, ip, todas) {
    todas = todas && todas.length ? todas : (c ? [c] : []);
    if (!todas.length) return;
    var escolha = todas.length === 1 ? todas[0] : null;
    function ehFaixa(x) { return x.tipo === 'cidr' || String(x.valor || '').indexOf('/') > -1; }
    function lista(xs) { return xs.map(function (x) { return '<span class="mono">' + esc(x.valor) + '</span>'; }).join(', '); }
    function efeito() {
      var el = $('[data-cf-efeito]', mForm);
      if (!el) return;
      el.hidden = !escolha;
      if (!escolha) { el.innerHTML = ''; return; }
      var resto = todas.filter(function (x) { return x !== escolha; });
      var h = ehFaixa(escolha) ? '<div class="forte">A faixa <b class="mono">' + esc(escolha.valor) + '</b> inteira deixa de ser confiável' +
        (ip ? ', não só <span class="mono">' + esc(ip) + '</span>' : '') + '.</div>' : '';
      if (ip && resto.length) h += '<div class="forte ambar"><b class="mono">' + esc(ip) + '</b> continua confiável por ' + lista(resto) + '.</div>';
      else h += '<div class="forte ambar">A partir de agora ' + (ehFaixa(escolha) ? 'esta rede passa' : 'este endereço passa') +
        ' pelas regras normais e pode receber bloqueio automático.</div>';
      el.innerHTML = h;
    }
    var html = todas.length > 1
      ? '<p class="texto">' + U.qtd(todas.length, 'entrada', 'entradas') + ' de confiança cobrem <b class="mono">' + esc(ip) + '</b>. Escolha qual remover:</p>' +
        '<div class="escolhas">' + todas.map(function (x, i) {
          return '<label class="escolha"><input type="radio" name="cf" value="' + i + '"><span><b class="mono">' + esc(x.valor) + '</b>' +
            '<small>' + esc(x.descricao || '') + (x.origem === 'login' ? ' · aprendido por login' : ' · manual') + '</small></span></label>';
        }).join('') + '</div>'
      : '<p class="texto">' + esc(todas[0].descricao || '') + (todas[0].origem === 'login' ? ' · aprendido por login' : '') + '</p>';
    abrirModal({
      titulo: todas.length > 1 ? 'Remover confiança de ' + ip + '?' : 'Remover ' + todas[0].valor + ' dos confiáveis?',
      html: html + '<div class="modal-pilha" data-cf-efeito hidden></div>',
      rotulo: 'Remover', perigo: true, semFoco: true,
      aoSalvar: function () {
        if (!escolha) throw new Error('Escolha qual entrada remover.');
        var alvo = escolha, resto = todas.filter(function (x) { return x !== alvo; });
        return chamar('sentinela_acao', { p_acao: 'desconfiar', p_dados: { id: +alvo.id } }).then(function () {
          toast(alvo.valor + ' removido dos confiáveis.' + (ip && resto.length ? ' ' + ip + ' continua confiável por ' +
            resto.map(function (x) { return x.valor; }).join(', ') + '.' : ''));
          depoisDeAcao();
        });
      }
    });
    $$('input[name="cf"]', mForm).forEach(function (r) {
      r.addEventListener('change', function () { escolha = todas[+r.value] || null; efeito(); });
    });
    efeito();
  }

  /* =========================================================
     4. IA
     ========================================================= */
  function carregarIa() {
    if (!$('[data-ia-estado]').innerHTML) pintarEstadoIa(null);
    return chamar('sentinela_lista_analises', { p_limite: 100 }).then(function (l) {
      marcarOk();
      l = l || [];
      pintarEstadoIa(l);
      subtitulo('[data-ia-sub]', l.length ? (l.length === 1 ? 'a única análise' : 'últimas ' + U.num(l.length) + ' análises') : 'nenhuma análise ainda');
      pintarSeMudou($('[data-ia-lista]'), l.length ? l.map(function (a) {
        return '<tr><td data-rot="IP"><button class="link-ip" type="button" data-ip-abrir="' + esc(a.ip) + '">' + esc(a.ip) + '</button></td>' +
          '<td data-rot="Veredito">' + veredito(a.veredito) + '</td>' +
          '<td data-rot="Confiança" class="r"><span class="c-num">' + U.pct01(a.confianca) + '</span></td>' +
          '<td data-rot="Motivo" class="motivo larga-m">' + esc(a.motivo || a.erro || '') + '</td>' +
          '<td data-rot="Ação pedida">' + esc(acaoIa(a.acao)) + '</td>' +
          '<td data-rot="Aplicado" class="motivo">' + esc(a.aplicado || '—') + '</td>' +
          '<td data-rot="Quando" class="quando" title="' + esc(U.dataHora(a.criado_em)) + '">' + esc(U.ha(a.criado_em)) + '</td></tr>';
      }).join('') : '<tr><td colspan="7" class="vazio">A IA ainda não analisou nenhum IP.</td></tr>');
    }).catch(function (err) {
      pintarSeMudou($('[data-ia-lista]'), '<tr><td colspan="7" class="vazio">' + esc(texto(err)) + '</td></tr>');
      marcarFalha(err);
    });
  }
  function pintarEstadoIa(lista) {
    var ia = (est.painel && est.painel.ia) || {};
    var modelo = ia.modelo || (lista && lista.length && lista[0].modelo) || 'claude-haiku-4-5-20251001';
    var est2 = { ligada: ['ok', 'Ligada'], sem_chave: ['warn', 'Sem chave'], erro: ['alert', 'Com erro'] }[ia.status] || ['vazio', 'Sem sinal'];
    var html = '<div class="ia-grade">' +
      '<div class="kpi ' + est2[0] + '"><div class="kpi-topo"><span class="kpi-ic">' + svg(IC.analises) + '</span><span class="lbl">Estado</span></div>' +
        '<div class="val" style="font-size:24px">' + est2[1] + '</div><div class="sub" title="' + esc(ia.detalhe || '') + '">' + U.numeros(ia.status_em ? 'desde ' + U.dataHora(ia.status_em) : 'sem registro') + '</div></div>' +
      '<div class="kpi brand"><div class="kpi-topo"><span class="kpi-ic">' + svg(IC.ips) + '</span><span class="lbl">Modelo</span></div>' +
        '<div class="val mono" style="font-size:14.5px;letter-spacing:-.02em;line-height:1.3">' + esc(modelo) + '</div><div class="sub">veredito por ferramenta</div></div>' +
      '<div class="kpi ' + (+ia.analises_janela ? 'ia' : 'vazio') + '"><div class="kpi-topo"><span class="kpi-ic">' + svg(IC.acessos) + '</span><span class="lbl">Análises 24 h</span></div>' +
        '<div class="val">' + U.num(ia.analises_janela) + '</div><div class="sub">' + U.numeros(ia.ultima_em ? 'última ' + U.ha(ia.ultima_em) : 'nenhuma na janela') + '</div></div>' +
      // limite 0 = IA desligada por custo: card zerado, cinza
      '<div class="kpi ' + (+ia.limite_hora ? 'brand' : 'vazio') + '" title="' + (+ia.limite_hora ? '' : 'Com limite 0 a IA não analisa nada') + '"><div class="kpi-topo"><span class="kpi-ic">' + svg(IC.relogio) + '</span><span class="lbl">Limite</span></div>' +
        '<div class="val">' + U.num(ia.limite_hora) + '</div><div class="sub">análises por hora</div></div>' +
    '</div>';
    if (ia.status === 'sem_chave') {
      html += '<div class="aviso" style="margin-top:14px"><span class="ic">🔑</span><div><b>A IA está sem chave e não analisa nada.</b> Cadastre a chave da Anthropic em:' +
        '<div class="caminho"><span>Supabase</span><em>›</em><span>projeto PAINEL LUBE DISTRIBUIDORA</span><em>›</em><span>Edge Functions</span><em>›</em><span>Secrets</span><em>›</em><span>ANTHROPIC_API_KEY</span></div></div></div>';
    } else if (ia.status === 'erro') {
      html += '<div class="aviso erro" style="margin-top:14px"><span class="ic">⚠</span><div><b>A última chamada à IA falhou.</b> ' + esc(ia.detalhe || 'sem detalhe') +
        (ia.status_em ? ' · ' + esc(U.dataHora(ia.status_em)) : '') + '</div></div>';
    } else if (!est.painel) {
      html += '<div class="aviso" style="margin-top:14px"><span class="ic">❔</span><div><b>Sem leitura do painel.</b> O estado da IA aparece quando a central responder.</div></div>';
    } else if (!ia.status || ia.status === 'desconhecido') {
      html += '<div class="aviso" style="margin-top:14px"><span class="ic">❔</span><div><b>A central ainda não informou o estado da IA.</b> Ele aparece na primeira análise.</div></div>';
    }
    $('[data-ia-estado]').innerHTML = html;
  }
  $('[data-ia-lista]').addEventListener('click', function (e) {
    var b = e.target.closest('[data-ip-abrir]');
    if (b) abrirGaveta(b.getAttribute('data-ip-abrir'));
  });

  /* =========================================================
     5. exposições
     ========================================================= */
  var SEV = { critica: ['Crítica', 'vermelho', 'alert'], alta: ['Alta', 'laranja', 'laranja'], media: ['Média', 'ambar', 'warn'], baixa: ['Baixa', 'azul', 'new'] };
  var ORDEM_SEV = ['critica', 'alta', 'media', 'baixa'], ORDEM_ST = ['aberta', 'aceita', 'corrigida'];
  var ST_EXP = { aberta: ['ambar', 'Aberta'], aceita: ['azul', 'Risco aceito'], corrigida: ['verde', 'Corrigida'] };

  function carregarExposicoes() {
    return chamar('sentinela_lista_exposicoes', {}).then(function (l) {
      marcarOk();
      est.exposicoes = l || [];
      pintarExposicoes();
    }).catch(function (err) {
      $('[data-ex-lista]').innerHTML = '<div class="vazio">' + esc(texto(err)) + '</div>';
      marcarFalha(err);
    });
  }
  function pintarExposicoes() {
    var l = est.exposicoes || [];
    $('[data-ex-resumo]').innerHTML = ORDEM_SEV.map(function (s) {
      var pend = l.filter(function (e) { return e.severidade === s && e.status !== 'corrigida'; });
      var ab = pend.filter(function (e) { return e.status === 'aberta'; }).length;
      return '<div class="kpi ' + (pend.length ? SEV[s][2] : 'vazio') + '" title="Pendentes: abertas e com risco aceito">' +
        '<div class="kpi-topo"><span class="kpi-ic">' + svg(IC.alerta) + '</span><span class="lbl">' + SEV[s][0] + '</span></div>' +
        '<div class="val">' + U.num(pend.length) + '</div><div class="sub">' + U.numeros(U.qtd(ab, 'aberta', 'abertas') + ' · ' + U.qtd(pend.length - ab, 'aceita', 'aceitas')) + '</div></div>';
    }).join('');
    var f = $('[data-ex-status]').value;
    var lista = l.filter(function (e) {
      if (f === 'todas') return true;
      if (f === 'pendentes') return e.status !== 'corrigida';
      return e.status === f;
    }).sort(function (a, b) {
      return ORDEM_SEV.indexOf(a.severidade) - ORDEM_SEV.indexOf(b.severidade) ||
             ORDEM_ST.indexOf(a.status) - ORDEM_ST.indexOf(b.status) || a.id - b.id;
    });
    $('[data-ex-lista]').innerHTML = lista.length ? lista.map(function (e, i) {
      var sv = SEV[e.severidade] || ['—', 'cinza'], st = ST_EXP[e.status] || ['cinza', e.status];
      return '<article class="expo ' + esc(e.severidade) + ' ' + esc(e.status) + '" style="animation-delay:' + Math.min(i * 30, 300) + 'ms">' +
        '<div><div class="expo-topo"><span class="chip ' + sv[1] + '">' + sv[0] + '</span><span class="sch">' + esc(e.sistema) + '</span></div>' +
        '<h3>' + esc(e.titulo) + '</h3><dl>' +
        '<dt>Evidência</dt><dd>' + esc(e.evidencia || '—') + '</dd>' +
        '<dt>Recomendação</dt><dd>' + esc(e.recomendacao || '—') + '</dd>' +
        (e.decisao ? '<dt>Decisão</dt><dd class="decisao">' + esc(e.decisao) + '</dd>' : '') +
        '</dl></div>' +
        '<div class="expo-lado"><span class="chip ' + st[0] + '">' + esc(st[1]) + '</span>' +
        '<span class="fraco">verificado em <span class="mono">' + esc(U.dia(e.verificado_em)) + '</span></span>' +
        '<button class="acao" type="button" data-ex-editar="' + esc(e.id) + '">Alterar</button></div></article>';
    }).join('') : '<div class="vazio">Nada com este filtro.</div>';
  }
  $('[data-ex-status]').addEventListener('change', pintarExposicoes);
  $('[data-ex-lista]').addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-ex-editar]');
    if (!b) return;
    var id = +b.getAttribute('data-ex-editar');
    var e = (est.exposicoes || []).filter(function (x) { return +x.id === id; })[0];
    if (!e) return;
    abrirModal({
      titulo: 'Exposição #' + e.id,
      html: '<p class="texto"><b>' + esc(e.titulo) + '</b><br>' + esc(e.sistema) + '</p>' +
        '<label class="campo"><span>Status</span><select name="status">' + ORDEM_ST.map(function (s) {
          return '<option value="' + s + '"' + (s === e.status ? ' selected' : '') + '>' + ST_EXP[s][1] + '</option>';
        }).join('') + '</select></label>' +
        '<label class="campo"><span>Decisão</span><textarea name="decisao" maxlength="300" placeholder="quem decidiu, o quê e quando">' + esc(e.decisao || '') + '</textarea></label>',
      rotulo: 'Salvar',
      aoSalvar: function () {
        var st = campoValor('status'), dec = campoValor('decisao');
        if (st === 'aceita' && !dec) throw new Error('Risco aceito precisa de decisão escrita.');
        return chamar('sentinela_acao', { p_acao: 'exposicao', p_dados: { id: id, status: st, decisao: dec } }).then(function () {
          toast('Exposição #' + id + ' atualizada.');
          depoisDeAcao();
        });
      }
    });
  });

  /* =========================================================
     6. integridade
     ========================================================= */
  function carregarIntegridade() {
    var el = $('[data-cadeia]');
    if (!el.innerHTML) el.innerHTML = '<div class="cadeia nada"><span class="cadeia-ic">⛓</span><div><h2>Verificando a cadeia…</h2></div></div>';
    var btn = $('[data-verificar]', el);
    if (btn) btn.disabled = true;
    return chamar('sentinela_verificar_cadeia', { p_limite: 5000 }).then(function (r) {
      marcarOk();
      r = r || {};
      var agora = new Date();
      var selo = r.ultimo_selo ? String(r.ultimo_selo).slice(0, 12) + '…' : '—';
      var h;
      if (r.ok === false) {
        var faixaIds = r.verificados ? U.num(r.verificados) + ' registros verificados (<span class="mono">#' + esc(r.desde_id) + '</span> a <span class="mono">#' + esc(r.ate_id) + '</span>)'
                                     : 'nenhum registro verificado';
        h = '<div class="cadeia quebrada"><span class="cadeia-ic">🚨</span><div><h2>Cadeia quebrada' + (r.quebra_id != null ? ' no registro <span class="mono">#' + esc(r.quebra_id) + '</span>' : '') + '</h2>' +
          '<p>' + esc(r.detalhe || (r.quebra_id != null ? 'o selo recalculado não confere a partir do #' + r.quebra_id : 'o banco apontou uma quebra')) +
          ' · ' + faixaIds + ' · verificado às <span class="mono">' + U.horaSeg(agora) + '</span></p></div>';
      } else if (!r.verificados) {
        h = '<div class="cadeia nada"><span class="cadeia-ic">⛓</span><div><h2>Nenhum registro para verificar</h2><p>A cadeia começa no primeiro evento.</p></div>';
      } else {
        h = '<div class="cadeia ok"><span class="cadeia-ic">✅</span><div><h2>Cadeia íntegra · <span class="mono">' + U.num(r.verificados) + '</span> registros · último selo <span class="mono">' + esc(selo) + '</span></h2>' +
          '<p>registros <span class="mono">#' + esc(r.desde_id) + '</span> a <span class="mono">#' + esc(r.ate_id) + '</span> recalculados às <span class="mono">' + U.horaSeg(agora) + '</span></p></div>';
      }
      el.innerHTML = h + '<button class="btn blue small" type="button" data-verificar>Verificar agora</button></div>';
    }).catch(function (err) {
      el.innerHTML = '<div class="cadeia quebrada"><span class="cadeia-ic">⚠</span><div><h2>Não foi possível verificar</h2><p>' + esc(texto(err)) + '</p></div>' +
        '<button class="btn blue small" type="button" data-verificar>Verificar agora</button></div>';
      marcarFalha(err);
    });
  }
  $('[data-cadeia]').addEventListener('click', function (e) { if (e.target.closest('[data-verificar]')) carregarIntegridade(); });

  /* =========================================================
     7. configuração
     ========================================================= */
  function carregarConfig() {
    return chamar('sentinela_config_ler', {}).then(function (r) {
      marcarOk();
      est.config = r || { config: {}, sistemas: [] };
      pintarConfig();
    }).catch(function (err) {
      $('[data-cfg-sistemas]').innerHTML = '<div class="vazio">' + esc(texto(err)) + '</div>';
      marcarFalha(err);
    });
  }
  function pintarConfig() {
    var c = est.config.config || {}, sis = est.config.sistemas || [];
    var obs = c.modo !== 'proteger';
    subtitulo('[data-cfg-modo-sub]', 'atual: ' + (obs ? 'observar' : 'proteger') + (c.atualizado_em ? ' · alterado ' + U.ha(c.atualizado_em) + (c.atualizado_por ? ' por ' + c.atualizado_por : '') : ''));
    $('[data-cfg-modos]').innerHTML =
      '<button type="button" class="modo-op observar' + (obs ? ' on' : '') + '" data-cfg-modo="observar"><span class="em">👁</span><span><b>OBSERVAR</b><small>Barra só ataque certo; suspeito fica como “seria bloqueado”.</small></span></button>' +
      '<button type="button" class="modo-op proteger' + (!obs ? ' on' : '') + '" data-cfg-modo="proteger"><span class="em">🛡</span><span><b>PROTEGER</b><small>Barra também os suspeitos (robô, rajada, Tor, força bruta, IA).</small></span></button>';

    // formulário que o admin está editando (data-sujo) não é sobrescrito por uma leitura nova
    var fc = $('[data-cfg-casa]');
    if (!sujo(fc)) {
      fc.elements.nome.value = c.casa_nome || '';
      fc.elements.lat.value = c.casa_lat != null ? c.casa_lat : '';
      fc.elements.lon.value = c.casa_lon != null ? c.casa_lon : '';
    }
    var fl = $('[data-cfg-limites]');
    if (!sujo(fl)) {
      fl.elements.limite_rajada_min.value = c.limite_rajada_min != null ? c.limite_rajada_min : '';
      fl.elements.ia_limite_hora.value = c.ia_limite_hora != null ? c.ia_limite_hora : '';
      fl.elements.ia_confianca_min.value = c.ia_confianca_min != null ? c.ia_confianca_min : '';
    }

    // listas em edição sobrevivem à repintura dos cartões
    var caixa = $('[data-cfg-sistemas]'), guardado = {};
    $$('[data-sis]', caixa).forEach(function (card) {
      $$('textarea[data-sujo]', card).forEach(function (t) {
        var g = guardado[card.getAttribute('data-sis')] = guardado[card.getAttribute('data-sis')] || {};
        g[t.hasAttribute('data-rotas') ? 'rotas_publicas' : 'arquivos_proibidos'] = { valor: t.value, orig: t._orig };
      });
    });

    var agora = Date.now();
    caixa.innerHTML = sis.map(function (s) {
      var portal = !s.sistema_slug;
      var sinal = s.ultimo_sinal ? U.ha(s.ultimo_sinal, agora) + ' · ' + U.dataHora(s.ultimo_sinal) : 'nunca';
      return '<div class="cfg-sis" data-sis="' + esc(s.projeto) + '">' +
        '<div class="cfg-sis-topo"><div><h4>' + esc(s.nome) + '</h4><div class="fraco">' + esc(s.projeto) + '</div></div>' +
          '<label class="interruptor' + (s.exige_login ? ' ligado' : '') + '" title="' + (portal ? 'É o próprio portal: o login dele é o do Painel Lube' : 'Sem passar pelo Painel Lube, página vai para o portal e dado recebe 401') + '">' +
          '<input type="checkbox" data-exige ' + (s.exige_login ? 'checked' : '') + (portal ? ' disabled' : '') + '><i></i><span>Exige login</span></label></div>' +
        '<div class="cfg-sis-corpo">' +
          '<div class="cfg-sis-meta"><span>sinal: <span class="mono">' + esc(sinal) + '</span></span>' +
            '<span>guarda: <span class="mono">' + esc(s.guarda_versao || '—') + (s.guarda_runtime ? ' · ' + esc(s.guarda_runtime) : '') + '</span></span>' +
            (s.ultimo_ambiente ? '<span>ambiente: <span class="mono">' + esc(s.ultimo_ambiente) + '</span></span>' : '') +
            (/^https:\/\//.test(s.url || '') ? '<a class="fraco" href="' + esc(s.url) + '" target="_blank" rel="noopener noreferrer">' +
              esc(String(s.url).replace(/^https:\/\//, '')) + ' ↗</a>' : '') + '</div>' +
          '<label class="campo" title="Caminhos que abrem sem login quando “exige login” estiver ligado (um por linha, começando com /)"><span>Rotas públicas</span>' +
            '<textarea data-rotas rows="2" spellcheck="false" placeholder="/publico/">' + esc((s.rotas_publicas || []).join('\n')) + '</textarea></label>' +
          '<label class="campo" title="Expressões regulares sobre o caminho; nível suspeito (no modo observar só registram)"><span>Arquivos proibidos</span>' +
            '<textarea data-arquivos rows="3" spellcheck="false" placeholder="^/db/">' + esc((s.arquivos_proibidos || []).join('\n')) + '</textarea></label>' +
          '<p class="campo__dica" data-sis-erro></p>' +
          '<div class="form-acoes"><button class="btn blue small" type="button" data-sis-salvar>Salvar listas</button></div>' +
        '</div></div>';
    }).join('') || '<div class="vazio">Nenhum sistema cadastrado.</div>';

    $$('[data-sis]', caixa).forEach(function (card) {
      var g = guardado[card.getAttribute('data-sis')];
      if (!g) return;
      var s = sistemaCfg(card.getAttribute('data-sis')), mudou = false;
      [['rotas_publicas', '[data-rotas]'], ['arquivos_proibidos', '[data-arquivos]']].forEach(function (k) {
        if (!g[k[0]]) return;
        var t = $(k[1], card);
        if (g[k[0]].orig != null && g[k[0]].orig !== ((s && s[k[0]]) || []).join('\n')) mudou = true;
        t.value = g[k[0]].valor;
        t.setAttribute('data-sujo', '');
        t._orig = g[k[0]].orig;
      });
      var dica = $('[data-sis-erro]', card);
      dica.className = 'campo__dica' + (mudou ? ' erro' : '');
      dica.textContent = mudou ? 'A lista mudou no servidor enquanto você editava: confira antes de salvar.' : 'Alterações ainda não salvas.';
    });
  }

  function sujo(el) { return !!el && el.hasAttribute('data-sujo'); }
  function limparSujo(raiz) {
    if (raiz.hasAttribute('data-sujo')) raiz.removeAttribute('data-sujo');
    $$('[data-sujo]', raiz).forEach(function (x) { x.removeAttribute('data-sujo'); });
  }
  function sistemaCfg(projeto) {
    return ((est.config && est.config.sistemas) || []).filter(function (x) { return x.projeto === projeto; })[0] || null;
  }
  ['[data-cfg-casa]', '[data-cfg-limites]'].forEach(function (sel) {
    $(sel).addEventListener('input', function (e) { e.currentTarget.setAttribute('data-sujo', ''); });
  });
  $('[data-cfg-sistemas]').addEventListener('input', function (e) {
    var t = e.target.closest('textarea');
    if (!t || sujo(t)) return;
    t.setAttribute('data-sujo', '');
    t._orig = t.defaultValue; // o que veio do servidor quando a edição começou
  });

  function linhas(txt) { return String(txt || '').split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean); }

  $('[data-cfg-modos]').addEventListener('click', function (e) {
    var b = e.target.closest('[data-cfg-modo]');
    if (!b || b.classList.contains('on')) return;
    trocarModo(b.getAttribute('data-cfg-modo'));
  });
  $('[data-cfg-casa]').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target, nome = f.elements.nome.value.trim(), lat = parseFloat(f.elements.lat.value), lon = parseFloat(f.elements.lon.value);
    if (!nome || isNaN(lat) || isNaN(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) { toast('Confira nome, latitude e longitude.', true); return; }
    chamar('sentinela_acao', { p_acao: 'casa', p_dados: { nome: nome, lat: lat, lon: lon } }).then(function () {
      limparSujo(f);
      toast('Casa atualizada.'); depoisDeAcao();
    }).catch(function (err) { toast(texto(err), true); });
  });
  $('[data-cfg-limites]').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target;
    var d = { limite_rajada_min: parseInt(f.elements.limite_rajada_min.value, 10), ia_limite_hora: parseInt(f.elements.ia_limite_hora.value, 10),
              ia_confianca_min: parseFloat(f.elements.ia_confianca_min.value) };
    if (isNaN(d.limite_rajada_min) || isNaN(d.ia_limite_hora) || isNaN(d.ia_confianca_min)) { toast('Preencha os três limites.', true); return; }
    if (d.ia_confianca_min < 0.5 || d.ia_confianca_min > 1) { toast('Confiança mínima fica entre 0,5 e 1.', true); return; }
    chamar('sentinela_acao', { p_acao: 'limites', p_dados: d }).then(function () {
      limparSujo(f);
      toast('Limites salvos.'); depoisDeAcao();
    }).catch(function (err) { toast(texto(err), true); });
  });
  $('[data-cfg-sistemas]').addEventListener('change', function (e) {
    var chk = e.target.closest('[data-exige]');
    if (!chk) return;
    var card = chk.closest('[data-sis]'), projeto = card.getAttribute('data-sis');
    var s = (est.config.sistemas || []).filter(function (x) { return x.projeto === projeto; })[0];
    var ligar = chk.checked;
    abrirModal({
      titulo: (ligar ? 'Exigir login em ' : 'Liberar sem login: ') + (s ? s.nome : projeto) + '?',
      html: ligar
        ? '<div class="forte">Quem abrir <b>' + esc(s ? s.nome : projeto) + '</b> sem passar pelo Painel Lube vai para o portal (páginas) ou recebe <b>401</b> (dados). ' +
          'Integrações e robôs que leem este sistema param de funcionar.</div>' +
          '<p class="texto">Rotas públicas atuais: <span class="mono">' + esc((s && s.rotas_publicas && s.rotas_publicas.length) ? s.rotas_publicas.join(', ') : 'nenhuma') + '</span></p>'
        : '<div class="forte ambar">O sistema volta a abrir para qualquer pessoa que tiver o endereço.</div>',
      rotulo: ligar ? 'Exigir login' : 'Liberar', perigo: ligar, semFoco: true,
      aoCancelar: function () { chk.checked = !ligar; },
      aoSalvar: function () {
        return chamar('sentinela_acao', { p_acao: 'sistema', p_dados: { projeto: projeto, exige_login: ligar } }).then(function () {
          toast((s ? s.nome : projeto) + (ligar ? ': login exigido.' : ': aberto sem login.'));
          depoisDeAcao();
        });
      }
    });
  });
  $('[data-cfg-sistemas]').addEventListener('click', function (e) {
    var b = e.target.closest('[data-sis-salvar]');
    if (!b) return;
    var card = b.closest('[data-sis]'), projeto = card.getAttribute('data-sis');
    var s = sistemaCfg(projeto) || { projeto: projeto, nome: projeto, rotas_publicas: [], arquivos_proibidos: [] };
    var erro = $('[data-sis-erro]', card);
    var rotas = linhas($('[data-rotas]', card).value), arquivos = linhas($('[data-arquivos]', card).value);
    var ruins = rotas.filter(function (r) { return r.charAt(0) !== '/'; });
    // "/" e "/*" casam com qualquer caminho: desligariam o "exige login" do sistema inteiro sem aviso
    var tudo = rotas.filter(function (r) { return /^\/\*?$/.test(r); });
    var regexRuins = arquivos.filter(function (r) { try { new RegExp(r); return false; } catch (x) { return true; } });
    erro.className = 'campo__dica';
    if (ruins.length || tudo.length || regexRuins.length) {
      erro.className = 'campo__dica erro';
      erro.textContent = (ruins.length ? 'Rota precisa começar com /: ' + ruins.join(', ') + '. ' : '') +
                         (tudo.length ? 'Rota "' + tudo.join('", "') + '" libera o sistema inteiro; para isso desligue "Exige login". ' : '') +
                         (regexRuins.length ? 'Expressão inválida: ' + regexRuins.join(', ') : '');
      return;
    }
    var antesR = s.rotas_publicas || [], antesA = s.arquivos_proibidos || [];
    function dif(a, d) { return { entram: d.filter(function (x) { return a.indexOf(x) < 0; }), saem: a.filter(function (x) { return d.indexOf(x) < 0; }) }; }
    var dr = dif(antesR, rotas), da = dif(antesA, arquivos);
    if (!dr.entram.length && !dr.saem.length && !da.entram.length && !da.saem.length) {
      limparSujo(card);
      erro.textContent = 'Nada mudou em relação ao que está salvo.';
      return;
    }
    // expressão que casa com qualquer caminho barra o sistema inteiro no modo proteger
    var amplas = arquivos.filter(function (r) {
      try { var re = new RegExp(r); return re.test('/') && re.test('/index.html') && re.test('/api/dados'); } catch (x) { return false; }
    });
    function itens(d) {
      return d.entram.map(function (x) { return '<span class="dif mais"><b>+</b> ' + esc(x) + '</span>'; }).join('') +
             d.saem.map(function (x) { return '<span class="dif menos"><b>−</b> ' + esc(x) + '</span>'; }).join('');
    }
    var avisos = [], perigo = false;
    if (dr.entram.length && s.exige_login) {
      perigo = true;
      avisos.push('<div class="forte"><b>Exige login está ligado</b> em ' + esc(s.nome) + ': as rotas novas passam a abrir <b>sem login</b> para qualquer pessoa.</div>');
    }
    if (antesA.length && !arquivos.length) {
      perigo = true;
      avisos.push('<div class="forte">A lista de arquivos proibidos fica <b>vazia</b>: nenhum caminho de ' + esc(s.nome) + ' será mais barrado nem registrado como arquivo proibido.</div>');
    } else if (da.saem.length) {
      avisos.push('<div class="forte ambar">Os caminhos que saem deixam de ser barrados (modo proteger) e de ser registrados como arquivo proibido.</div>');
    }
    if (amplas.length) {
      perigo = true;
      avisos.push('<div class="forte"><b class="mono">' + esc(amplas.join(', ')) + '</b> casa com qualquer caminho: no modo proteger, ' + esc(s.nome) + ' inteiro recebe 403.</div>');
    }
    abrirModal({
      titulo: 'Salvar listas de ' + s.nome + '?',
      html: (dr.entram.length || dr.saem.length ? '<div class="difs-bloco"><span class="difs-rot">Rotas públicas</span><div class="difs">' + itens(dr) + '</div></div>' : '') +
            (da.entram.length || da.saem.length ? '<div class="difs-bloco"><span class="difs-rot">Arquivos proibidos</span><div class="difs">' + itens(da) + '</div></div>' : '') +
            avisos.join(''),
      rotulo: 'Salvar listas', perigo: perigo, semFoco: true,
      aoSalvar: function () {
        return chamar('sentinela_acao', { p_acao: 'sistema', p_dados: { projeto: projeto, rotas_publicas: rotas, arquivos_proibidos: arquivos } }).then(function () {
          limparSujo(card);
          toast('Listas de ' + s.nome + ' salvas.');
          depoisDeAcao();
        });
      }
    });
  });

  /* =========================================================
     dados: painel completo e eventos novos
     ========================================================= */
  function aplicarPainel(p) {
    est.painel = p;
    est.ultimoPainel = Date.now();
    if (+p.ultimo_id > est.ultimoId) est.ultimoId = +p.ultimo_id;
    est.nomes = {};
    (p.sistemas || []).forEach(function (s) { est.nomes[s.projeto] = s.nome; });
    est.visitantes = p.visitantes || [];
    pintarTopo(p);
    pintarKpis(p.kpis);
    pintarGlobo(p);
    guardarFeed(p.feed);
    pintarFeed();
    pintarHoras(p.por_hora || []);
    montarFiltros();
    pintarVisitantes();
    var c = p.contagens || {}, ex = c.exposicoes || {};
    $('[data-qtd="bloqueios"]').textContent = c.bloqueios_ativos ? U.num(c.bloqueios_ativos) : '';
    $('[data-qtd="confiaveis"]').textContent = c.confiaveis_ativos ? U.num(c.confiaveis_ativos) : '';
    var graves = (+ex.critica || 0) + (+ex.alta || 0);
    var q = $('[data-qtd="exposicoes"]');
    q.textContent = graves ? U.num(graves) : '';
    q.title = U.num(ex.critica) + ' críticas · ' + U.num(ex.alta) + ' altas · ' + U.num(ex.media) + ' médias · ' + U.num(ex.baixa) + ' baixas';
    $('[data-rodape-agora]').textContent = 'painel lido às ' + U.horaSeg(new Date());
    if (est.faixa && est.faixa !== 'rede') faixa(null);
    iniciarGlobo();
  }

  // uma leitura por vez: quem pedir enquanto há uma em curso recebe a mesma promessa
  function atualizarPainel() {
    if (est.painelEmCurso) return est.painelEmCurso;
    est.tentativaPainel = Date.now();
    var pr = chamar('sentinela_painel', { p_horas: 24 }).then(function (p) {
      est.painelEmCurso = null;
      est.falhasPainel = 0;
      marcarOk();
      try { aplicarPainel(p || {}); } catch (e) { marcarFalha(e); }
      return p;
    }, function (err) {
      est.painelEmCurso = null;
      est.falhasPainel++;
      marcarFalha(err);
      throw err;
    });
    est.painelEmCurso = pr;
    return pr;
  }
  // intervalo mínimo entre leituras completas: 15 s; com o painel falhando dobra (30 s, 60 s), até o ciclo normal
  function intervaloPainel() { return Math.min(T_PAINEL, 15000 * Math.pow(2, est.falhasPainel)); }

  function tempo(iso) { return new Date(iso).getTime() || 0; }

  function aplicarNovos(r) {
    r = r || {};
    if (r.kpis) pintarKpis(r.kpis);
    var evs = (r.eventos || []).slice().sort(function (a, b) { return a.id - b.id; });
    if (!evs.length) return false;
    // guarda o id do último evento recebido (não o "ultimo_id" geral) para não pular nada além dos 100
    est.ultimoId = Math.max(est.ultimoId, +evs[evs.length - 1].id || 0);
    guardarFeed(evs);
    pintarFeed();
    if (est.globo) est.globo.eventos(evs);
    var desconhecido = false, bloqueio = false;
    evs.forEach(function (e) {
      var v = visitante(e.ip);
      if (e.decisao === 'bloqueado') bloqueio = true;
      if (!v) { desconhecido = true; return; }
      v.total = (+v.total || 0) + 1;
      if (!v.ultimo || tempo(e.criado_em) > tempo(v.ultimo)) v.ultimo = e.criado_em;
      v.risco = Math.max(+v.risco || 0, +e.risco || 0);
      var st = e.decisao === 'bloqueado' ? 'bloqueado' : e.decisao === 'observado' ? 'observado' : null;
      if (st && U.status(st).peso > U.status(v.status).peso) { v.status = st; v.status_motivo = e.regra || v.status_motivo; }
    });
    // a ordem só muda na leitura completa: linha não foge do mouse a cada 4 s
    pintarVisitantes();
    if (desconhecido || bloqueio) painelLogo();
    return evs.length >= 100;
  }

  function buscarNovos() {
    if (est.novosEmCurso) return Promise.resolve(false);
    est.novosEmCurso = true;
    // antes da primeira leitura (ultimoId 0), null pede só os 100 mais recentes; 0 traria os 100 MAIS ANTIGOS
    // da retenção e o painel varreria o histórico inteiro de 400 em 400 ms
    return chamar('sentinela_novos', { p_desde_id: est.ultimoId > 0 ? est.ultimoId : null }).then(function (r) {
      est.novosEmCurso = false;
      marcarOk();
      try { return aplicarNovos(r); } catch (e) { marcarFalha(e); return false; }
    }, function (err) { est.novosEmCurso = false; marcarFalha(err); return false; });
  }

  /* ---------- ciclos ---------- */
  function agendarNovos(ms) {
    clearTimeout(est.tNovos);
    if (est.parado) return;
    est.tNovos = setTimeout(cicloNovos, ms);
  }
  function cicloNovos() {
    if (est.parado || document.hidden) return;
    buscarNovos().then(function (mais) { agendarNovos(mais ? 400 : T_NOVOS); });
  }
  function agendarPainel(ms) {
    clearTimeout(est.tPainel);
    if (est.parado) return;
    est.proxPainel = Date.now() + ms;
    est.tPainel = setTimeout(cicloPainel, ms);
  }
  function cicloPainel() {
    if (est.parado || document.hidden) return;
    atualizarPainel().then(function () {
      if (est.modulo !== 'visao') carregarModulo(est.modulo, 'ciclo');
    }, function () {}).then(function () { agendarPainel(T_PAINEL); });
  }
  // IP novo ou bloqueio: o painel completo vem logo, contado da última TENTATIVA (não do último sucesso),
  // com recuo enquanto ele estiver falhando. Sob ataque o banco está lento: não martelar a consulta mais pesada.
  function painelLogo() {
    if (est.painelEmCurso) return;
    var espera = Math.max(1500, intervaloPainel() - (Date.now() - est.tentativaPainel));
    if (Date.now() + espera < est.proxPainel) agendarPainel(espera);
  }
  function pararTudo() {
    est.parado = true;
    clearTimeout(est.tNovos); clearTimeout(est.tPainel);
  }

  document.addEventListener('visibilitychange', function () {
    if (!est.rodando || est.parado) return;
    if (document.hidden) {
      clearTimeout(est.tNovos); clearTimeout(est.tPainel);
      if (est.globo) est.globo.pausar();
      return;
    }
    if (est.globo && est.modulo === 'visao') est.globo.retomar();
    agendarNovos(50);
    var base = est.falhasPainel ? intervaloPainel() : T_PAINEL;
    var falta = base - (Date.now() - Math.max(est.ultimoPainel, est.tentativaPainel));
    agendarPainel(Math.max(200, falta));
  });

  function iniciarCiclos(primeiroPainel) {
    if (!est.rodando) {
      est.rodando = true;
      setInterval(function () {
        pintarVivo();
        if (document.hidden) return;
        // "há X min" da tabela anda sozinho
        if (Date.now() % 15000 < 1000) $$('[data-ha]').forEach(function (el) { el.textContent = U.ha(el.getAttribute('data-ha')); });
      }, 1000);
    }
    agendarNovos(T_NOVOS);
    agendarPainel(primeiroPainel || T_PAINEL);
  }

  /* =========================================================
     sessão e entrada
     ========================================================= */
  function mostrarRestrito() {
    $('[data-restrito-quem]').textContent = est.email || '';
    tela('restrito');
  }

  function abrirPainel(email) {
    est.email = email || '';
    est.parado = false;
    $('[data-quem]').textContent = est.email;
    tela('carregando');
    est.tentativaPainel = Date.now();
    chamar('sentinela_painel', { p_horas: 24 }).then(function (p) {
      est.falhasPainel = 0;
      tela('app');
      marcarOk();
      aplicarPainel(p || {});
      irPara(moduloDoHash(), true);
      iniciarCiclos();
    }).catch(function (err) {
      if (err.restrito) { mostrarRestrito(); return; }
      if (err.sessao && !DEMO) { tela('entrada'); return; }
      // sem conexão / banco sem a Sentinela: mostra o painel com a faixa e segue tentando
      // (os outros módulos funcionam sem a leitura do painel)
      est.falhasPainel++;
      tela('app');
      marcarFalha(err);
      irPara(moduloDoHash(), true);
      var msg = $('[data-globo-msg]');
      if (msg) msg.textContent = 'Aguardando a central…';
      iniciarCiclos(err.rede ? T_NOVOS : 15000);
    });
  }

  function iniciarReal() {
    if (!window.supabase || !CFG.url || !CFG.key) {
      tela('entrada');
      $('[data-entrar-erro]').textContent = 'Configuração do portal ausente (config.js).';
      return;
    }
    sb = window.supabase.createClient(CFG.url, CFG.key);
    sb.auth.getSession().then(function (r) {
      var s = r.data && r.data.session;
      if (s) abrirPainel(s.user.email);
      else tela('entrada');
    }, function () { tela('entrada'); });
    sb.auth.onAuthStateChange(function (evt) {
      if (evt === 'SIGNED_OUT') { pararTudo(); tela('entrada'); }
    });
  }

  // formulário de entrada (sem sessão)
  (function () {
    var form = $('[data-form-entrar]'), usr = $('[data-entrar-usuario]'), pwd = $('[data-entrar-senha]');
    var btn = $('[data-entrar-botao]'), erro = $('[data-entrar-erro]'), suf = $('[data-entrar-sufixo]');
    var dominio = CFG.dominio || '@lube.com.br';
    usr.addEventListener('input', function () { suf.classList.toggle('is-off', usr.value.indexOf('@') > -1); });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      erro.textContent = '';
      var v = usr.value.trim().toLowerCase();
      var email = v.indexOf('@') > -1 ? v : (v ? v + dominio : '');
      if (!email) { erro.textContent = 'Informe seu usuário.'; return; }
      if (email.slice(-dominio.length) !== dominio) { erro.textContent = 'Acesso restrito a e-mails ' + dominio; return; }
      if (!pwd.value) { erro.textContent = 'Informe a senha.'; return; }
      if (!sb) return;
      btn.disabled = true;
      sb.auth.signInWithPassword({ email: email, password: pwd.value }).then(function (r) {
        btn.disabled = false;
        if (r.error) {
          var invalido = r.error.message === 'Invalid login credentials' || r.error.code === 'invalid_credentials';
          erro.textContent = invalido ? 'Usuário ou senha incorretos.' : r.error.message;
          if (invalido && mascararUsuario(email)) avisarCentral('tentativa', { usuario: mascararUsuario(email) });
          return;
        }
        pwd.value = '';
        avisarCentral('identidade', {}, r.data.session.access_token);
        abrirPainel(r.data.session.user.email);
      }).catch(function () {
        btn.disabled = false;
        erro.textContent = 'Falha de conexão. Tente de novo.';
      });
    });
  })();

  $$('[data-sair]').forEach(function (b) {
    b.addEventListener('click', function () {
      pararTudo();
      if (DEMO || !sb) { location.reload(); return; }
      sb.auth.signOut().then(function () { location.reload(); }, function () { location.reload(); });
    });
  });

  /* ---------- início ---------- */
  if (DEMO) {
    document.body.classList.add('demo');
    $('[data-tarja-demo]').hidden = false;
    carregarScript('demo.js?v=20261005e').then(function () {
      abrirPainel(SNT.demo.usuario.email);
    }).catch(function () {
      tela('entrada');
      $('[data-entrar-erro]').textContent = 'Não foi possível carregar a demonstração.';
    });
  } else {
    iniciarReal();
  }
})();
