/* =========================================================
   PAINEL LUBE — sessão, permissões e montagem dos sistemas
   ========================================================= */
(function () {
  'use strict';

  var CFG = window.LUBE_CFG;
  var sb  = window.supabase.createClient(CFG.url, CFG.key);
  window.LUBE_SB = sb;

  var $  = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };

  var gate     = $('[data-gate]');
  var form     = $('[data-form="entrar"]');
  var campoUsr = $('[data-gate-user]');
  var campoPwd = $('[data-gate-pass]');
  var erroEl   = $('[data-gate-erro]');
  var btnEntrar= $('[data-gate-submit]');
  var okBox    = $('[data-gate-ok]');
  var okTexto  = $('[data-gate-ok-texto]');
  var modos    = $('.gate__modos');
  var track    = $('[data-track]');
  var conta    = $('[data-conta]');

  var perfil = null;
  var icones = {};
  var sistemasPorId = {};

  /* ---------- utilidades ---------- */
  function emailCompleto(v) {
    v = (v || '').trim().toLowerCase();
    if (!v) return '';
    return v.indexOf('@') > -1 ? v : v + CFG.dominio;
  }
  function emailValido(v) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v); }
  function erro(msg) {
    if (!erroEl) return;
    erroEl.textContent = msg || '';
    erroEl.classList.toggle('is-on', !!msg);
  }
  function carregando(on) {
    if (!btnEntrar) return;
    btnEntrar.disabled = on;
    btnEntrar.classList.toggle('is-loading', on);
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------- estatísticas do hero (sistemas ativos / áreas) ---------- */
  function pad2(n) { n = String(n); return n.length < 2 ? '0' + n : n; }
  function atualizarStats(lista) {
    var elSis = $('[data-stat-sistemas]');
    var elAreas = $('[data-stat-areas]');
    if (!elSis && !elAreas) return;
    var areas = {};
    lista.forEach(function (s) { if (s.categoria) areas[s.categoria] = true; });
    if (elSis) elSis.textContent = pad2(lista.length);
    if (elAreas) elAreas.textContent = pad2(Object.keys(areas).length);
  }

  /* ---------- registro de acesso ---------- */
  function registrar(acao, sistemaId) {
    if (!perfil) return;
    return sb.from('acessos').insert({
      user_id: perfil.id, email: perfil.email, acao: acao, sistema_id: sistemaId || null
    }).then(function () {}, function () {});
  }

  /* ---------- Sentinela: passe, identidade e tentativas ----------
     Tudo aqui tem limite de tempo e falha em silêncio: com a central
     fora do ar o portal entra e abre os sistemas como sempre. */
  var CENTRAL = 'https://wkkdcsqwlxjxorutrbnx.supabase.co/functions/v1/sentinela';

  // POST na central; resolve com o JSON da resposta ou rejeita (erro, não-2xx, tempo)
  function central(rota, corpo, token, ms) {
    return new Promise(function (ok, falha) {
      var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
      var timer = setTimeout(function () {
        if (ctrl) ctrl.abort();
        falha(new Error('tempo esgotado'));
      }, ms || 3000);
      var cab = { 'content-type': 'application/json' };
      if (token) cab.authorization = 'Bearer ' + token;
      fetch(CENTRAL + '/' + rota, {
        method: 'POST', headers: cab, body: JSON.stringify(corpo || {}),
        credentials: 'omit', cache: 'no-store', signal: ctrl ? ctrl.signal : undefined
      }).then(function (r) {
        if (!r.ok) throw new Error('central ' + r.status);
        return r.json();
      }).then(function (j) { clearTimeout(timer); ok(j); },
              function (e) { clearTimeout(timer); falha(e); });
    });
  }

  // espera a promessa ou o tempo, o que vier primeiro (nunca rejeita)
  function limite(p, ms) {
    return new Promise(function (ok) {
      setTimeout(ok, ms);
      Promise.resolve(p).then(ok, ok);
    });
  }

  // origem de um endereço absoluto https; null para qualquer outra coisa
  function origemHttps(u) {
    try {
      var x = new URL(String(u || ''));
      return x.protocol === 'https:' ? x.origin : null;
    } catch (e) { return null; }
  }

  // pede o passe do sistema; resolve com a URL de entrada ou null (nunca rejeita).
  // O endereço que vale é o do admin (public.sistemas.url): vai como destino, e a
  // resposta só é aceita se for https na mesma origem dele
  function pedirPasse(slug, urlSistema) {
    var origem = origemHttps(urlSistema);
    if (!slug || !origem || typeof fetch !== 'function') return Promise.resolve(null);
    var pedido = sb.auth.getSession().then(function (r) {
      var s = r && r.data && r.data.session;
      if (!s || !s.access_token) return null;
      return central('passe', { sistema_slug: slug, destino: String(urlSistema) }, s.access_token, 3000);
    }).then(function (j) {
      var url = j && typeof j.url === 'string' ? j.url : '';
      return origemHttps(url) === origem ? url : null;
    }, function () { return null; });
    return limite(pedido, 3000).then(function (url) { return url || null; });
  }

  function informarIdentidade(token) {
    if (!token || typeof fetch !== 'function') return;
    central('identidade', {}, token, 5000).catch(function () {});
  }
  // a força bruta conta pelo IP (a central lê do cabeçalho); do usuário vai só a
  // inicial e o domínio (j***@lube.com.br), para não gravar uma senha digitada
  // no campo errado
  function mascararUsuario(email) {
    var e = String(email || '').trim().toLowerCase();
    var i = e.lastIndexOf('@');
    if (i < 1) return '';
    return (e.charAt(0) + '***' + e.slice(i)).slice(0, 80);
  }
  function informarTentativa(usuario) {
    if (typeof fetch !== 'function') return;
    var u = mascararUsuario(usuario);
    if (!u) return;
    central('tentativa', { usuario: u }, null, 5000).catch(function () {});
  }

  // abre o sistema do cartão: a janela nasce em branco já no clique (senão o
  // bloqueador de pop-up barra) e recebe o endereço com passe; sem passe, a URL normal
  function abrirPeloCartao(ev, a) {
    var s = sistemasPorId[a.getAttribute('data-sistema')];
    // sem slug ou sem endereço https não há passe: o link segue como sempre
    if (!s || !s.slug || !origemHttps(s.url) || ev.defaultPrevented) return;
    // Ctrl/Shift/Cmd/Alt-clique: o navegador faz o que sempre fez
    if (ev.button || ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.altKey) return;

    var alvo   = a.getAttribute('target') || '_self';
    var normal = a.href;

    if (alvo === '_self') {
      ev.preventDefault();
      pedirPasse(s.slug, s.url).then(function (url) { location.assign(url || normal); });
      return;
    }

    var janela = null;
    try { janela = window.open('', alvo); } catch (e) { janela = null; }
    // não abriu, ou o bloqueador já fechou: segue o link como hoje
    if (!janela || janela.closed) return;
    ev.preventDefault();
    try {
      janela.opener = null;              // mesmo efeito do rel="noopener"
      var d = janela.document;
      d.title = 'Abrindo ' + s.nome + '…';
      if (d.body) {
        d.body.style.cssText = 'margin:0;min-height:100vh;display:flex;align-items:center;' +
          'justify-content:center;background:#030616;color:#E7EAF4;' +
          'font:500 15px/1.4 Archivo,system-ui,sans-serif';
        d.body.textContent = 'Abrindo ' + s.nome + '…';
      }
    } catch (e) {}

    pedirPasse(s.slug, s.url).then(function (url) {
      try {
        // fechada no meio do caminho (pela pessoa ou por um bloqueador): sem gesto
        // não dá para abrir outra, então só avisa
        if (janela.closed) {
          aviso('A janela de ' + s.nome + ' foi fechada antes de abrir. Clique de novo no cartão.');
          return;
        }
        janela.location.replace(url || normal);
      } catch (e) {}
    });
  }

  // aviso discreto no pé da tela; some sozinho
  var avisoEl = null, avisoT = null;
  function aviso(msg) {
    try {
      if (!avisoEl) {
        avisoEl = document.createElement('div');
        avisoEl.className = 'mono';
        avisoEl.setAttribute('role', 'status');
        avisoEl.style.cssText = 'position:fixed;left:50%;bottom:1.5rem;transform:translateX(-50%);' +
          'z-index:7500;max-width:calc(100% - 2rem);padding:.75rem 1.1rem;border-radius:12px;' +
          'background:rgba(3,6,22,.94);color:#E7EAF4;border:1px solid rgba(255,255,255,.14);' +
          'box-shadow:0 10px 30px rgba(0,0,0,.35);font-size:.66rem;letter-spacing:.08em;' +
          'text-align:center;pointer-events:none;opacity:0;transition:opacity .3s';
        document.body.appendChild(avisoEl);
      }
      avisoEl.textContent = msg;
      avisoEl.style.opacity = '1';
      clearTimeout(avisoT);
      avisoT = setTimeout(function () { avisoEl.style.opacity = '0'; }, 7000);
    } catch (e) {}
  }

  /* ---------- ?abrir=<slug>: a porta da Sentinela mandou entrar por aqui ---------- */
  var abrirSlug = (function () {
    try {
      var u = new URL(location.href);
      if (!u.searchParams.has('abrir')) return null;
      var v = (u.searchParams.get('abrir') || '').trim().toLowerCase();
      u.searchParams.delete('abrir');
      history.replaceState(history.state, '', u.pathname + u.search + u.hash);
      return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(v) ? v : null;
    } catch (e) { return null; }
  })();

  // evita vaivém portal ↔ sistema se a entrada falhar: uma ida automática
  // por sistema a cada 30 s nesta aba
  function idaRecente(slug) {
    try {
      var k = 'sentinela_abrir_' + slug, agora = Date.now();
      var antes = +sessionStorage.getItem(k) || 0;
      sessionStorage.setItem(k, String(agora));
      return agora - antes < 30000;
    } catch (e) { return false; }
  }

  function processarAbrir(lista) {
    var slug = abrirSlug;
    if (!slug) return;
    abrirSlug = null;

    var s = null;
    lista.forEach(function (x) {
      if (!s && String(x.slug || '').toLowerCase() === slug) s = x;
    });
    if (!s || !s._liberado) {
      aviso(s ? 'Você não tem autorização para abrir ' + s.nome + '. Peça a liberação ao TI.'
              : 'Esse sistema não está disponível para o seu usuário.');
      return;
    }
    if (idaRecente(slug)) {
      aviso('Não foi possível entrar em ' + s.nome + ' agora. Tente pelo cartão.');
      return;
    }
    aviso('Abrindo ' + s.nome + '…');
    var reg = registrar('abriu_sistema', s.id);
    Promise.all([pedirPasse(s.slug, s.url), limite(reg, 1500)]).then(function (rs) {
      location.assign(rs[0] || s.url);
    });
  }

  /* ---------- montagem dos cartões ---------- */
  function cartao(s, i) {
    var liberado = !!s._liberado;
    var tag  = liberado ? 'a' : 'div';
    var abre = liberado
      ? ' href="' + esc(s.url) + '" target="_blank" rel="noopener"'
      : ' role="group" aria-label="' + esc(s.nome) + ' — sem autorização"';

    var acao = liberado
      ? '<span class="card__go" aria-hidden="true">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
          '<path d="M7 17 17 7M9 7h8v8"/></svg></span>'
      : '<span class="card__lock" aria-hidden="true">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
          '<rect x="4" y="10" width="16" height="11" rx="2"/>' +
          '<path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg></span>';

    return '' +
      '<' + tag + ' class="card' + (liberado ? '' : ' card--bloqueado') + '"' + abre +
         ' data-card data-surface="dark" data-sistema="' + esc(s.id) + '"' +
         ' data-keys="' + esc([s.nome, s.categoria, s.descricao, s.slug].join(' ')) + '">' +
        '<div class="card__visual">' +
          '<span class="card__num mono">' + (i < 9 ? '0' : '') + (i + 1) + '</span>' +
          '<span class="card__badge">' + window.LUBE_ICONE.html(icones[s.badge]) + '</span>' +
          '<span class="card__pattern" aria-hidden="true"></span>' +
          (liberado ? '' :
            '<span class="card__selo mono"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
            'stroke-width="2"><rect x="4" y="10" width="16" height="11" rx="2"/>' +
            '<path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>Sem autorização</span>') +
        '</div>' +
        '<div class="card__info">' +
          '<p class="mono card__cat">' + esc(s.categoria) + '</p>' +
          '<h3 class="card__title">' + esc(s.nome) + '</h3>' +
          '<div class="card__bottom">' +
            '<p class="card__desc">' +
              (liberado ? esc(s.descricao)
                        : 'Você não tem autorização para entrar neste sistema. ' +
                          'Peça a liberação ao TI pelo botão no rodapé.') +
            '</p>' + acao +
          '</div>' +
        '</div>' +
      '</' + tag + '>';
  }

  function montarSistemas(lista) {
    if (!track) return;
    var vazio = $('[data-empty]');

    if (!lista.length) {
      track.innerHTML = '';
      if (vazio) {
        vazio.hidden = false;
        vazio.innerHTML = '<span class="mono">Nenhum sistema cadastrado</span>' +
          'Assim que o TI cadastrar as plataformas, elas aparecem aqui.';
      }
      return;
    }
    if (vazio) vazio.hidden = true;

    sistemasPorId = {};
    lista.forEach(function (s) { sistemasPorId[s.id] = s; });

    track.innerHTML = lista.map(cartao).join('');
    if (window.LubePainel) window.LubePainel.indexCards();

    $$('.card', track).forEach(function (a) {
      a.addEventListener('click', function (ev) {
        if (a.classList.contains('card--bloqueado')) return;
        registrar('abriu_sistema', a.getAttribute('data-sistema'));
        abrirPeloCartao(ev, a);
      });
    });
  }

  /* ---------- sessão ---------- */
  function mostrarPortal() {
    document.body.classList.add('autenticado');
    if (gate) gate.classList.remove('is-on');
  }
  function mostrarGate() {
    document.body.classList.remove('autenticado');
    if (gate) gate.classList.add('is-on');
    if (track) track.innerHTML = '';
  }

  function barraConta() {
    if (!conta || !perfil) return;
    var nome = perfil.nome || perfil.email.split('@')[0];
    conta.innerHTML =
      '<span class="conta__nome">' + esc(nome) + '</span>' +
      (perfil.is_admin ? '<a class="conta__admin" href="admin.html">Painel admin</a>' : '') +
      '<button type="button" class="conta__sair" data-sair>Sair</button>';
    var sair = $('[data-sair]', conta);
    if (sair) sair.addEventListener('click', function () {
      registrar('logout');
      sb.auth.signOut().then(function () { location.reload(); });
    });
  }

  // Conta sem perfil do painel: em geral é conta do SAC (RCA/supervisor), que
  // só abre chamado no SAC. Sai da sessão e diz para onde ir (2026-10-09).
  function contaSemPerfil() {
    return sb.rpc('sac_meu_acesso').then(function (s) {
      var doSac = !!(s && s.data && s.data.situacao && s.data.situacao !== 'sem_cadastro');
      return sb.auth.signOut().then(function () {
        mostrarGate();
        erro(doSac
          ? 'Esta conta é do SAC. Para abrir chamado, use o atalho “SAC · Abrir chamado” logo abaixo.'
          : 'Não foi possível carregar seu perfil.');
      });
    });
  }

  function carregarSessao(sessao) {
    if (!sessao) { mostrarGate(); return Promise.resolve(); }

    return sb.from('profiles').select('*').eq('id', sessao.user.id).maybeSingle()
      .then(function (r) {
        if (r.error) throw new Error('Perfil não encontrado');
        if (!r.data) return contaSemPerfil();
        perfil = r.data;
        if (!perfil.ativo) {
          var pendente = !perfil.aprovado_em;
          return sb.auth.signOut().then(function () {
            mostrarGate();
            erro(pendente
              ? 'Seu cadastro ainda não foi liberado pelo TI. Assim que for, é só entrar.'
              : 'Seu acesso está desativado. Procure o TI.');
          });
        }
        window.LUBE_PERFIL = perfil;
        mostrarPortal();
        barraConta();
        informarIdentidade(sessao.access_token);

        return Promise.all([
          sb.from('sistemas').select('*').eq('ativo', true).order('ordem', { ascending: true }),
          sb.from('permissoes').select('sistema_id').eq('user_id', perfil.id),
          sb.from('icones').select('*'),
          sb.from('permissoes_excecao').select('sistema_id').eq('user_id', perfil.id)
        ]).then(function (rs) {
            (rs[2].data || []).forEach(function (ic) { icones[ic.slug] = ic; });

            var meus = {};
            (rs[1].data || []).forEach(function (p) { meus[p.sistema_id] = true; });

            // só faz sentido quando acesso_total está ligado — fora disso é ignorada
            var fora = {};
            (rs[3].data || []).forEach(function (e) { fora[e.sistema_id] = true; });

            var lista = (rs[0].data || []).map(function (s) {
              s._liberado = perfil.acesso_total ? !fora[s.id] : !!meus[s.id];
              return s;
            });
            // "sistemas ativos" e "áreas atendidas" contam a empresa toda,
            // não só o que esta pessoa pode abrir
            atualizarStats(lista);
            // liberados primeiro, mantendo a ordem definida pelo TI
            lista.sort(function (a, b) {
              if (a._liberado !== b._liberado) return a._liberado ? -1 : 1;
              return a.ordem - b.ordem;
            });
            montarSistemas(lista);
            try { processarAbrir(lista); } catch (e) {}
          });
      })
      .catch(function () {
        mostrarGate();
        erro('Não foi possível carregar seu perfil.');
      });
  }

  /* ---------- login ---------- */
  if (form) {
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      erro('');
      var email = emailCompleto(campoUsr.value);
      var senha = campoPwd.value;

      if (!email) { erro('Informe seu usuário.'); return; }
      // quem decide se o e-mail pode entrar é o banco (@lube.com.br ou a lista de e-mails liberados)
      if (!emailValido(email)) { erro('Informe um e-mail válido.'); return; }
      if (!senha) { erro('Informe a senha.'); return; }

      carregando(true);
      sb.auth.signInWithPassword({ email: email, password: senha })
        .then(function (r) {
          carregando(false);
          if (r.error) {
            if (r.error.message === 'Invalid login credentials' ||
                r.error.code === 'invalid_credentials') informarTentativa(email);
            erro(r.error.message === 'Invalid login credentials'
              ? 'Usuário ou senha incorretos.'
              : r.error.message);
            return;
          }
          return carregarSessao(r.data.session).then(function () {
            registrar('login');
            campoPwd.value = '';
          });
        })
        .catch(function () { carregando(false); erro('Falha de conexão. Tente de novo.'); });
    });
  }

  /* ---------- alternar entrar / primeiro acesso ---------- */
  function irPara(modo) {
    erro('');
    $$('[data-modo]').forEach(function (b) {
      b.classList.toggle('is-on', b.getAttribute('data-modo') === modo);
    });
    $$('[data-form]').forEach(function (f) {
      f.classList.toggle('is-on', f.getAttribute('data-form') === modo);
    });
    if (modos) modos.classList.toggle('no-segundo', modo === 'primeiro');
    if (okBox) okBox.classList.remove('is-on');
  }
  $$('[data-modo]').forEach(function (b) {
    b.addEventListener('click', function () { irPara(b.getAttribute('data-modo')); });
  });
  var voltar = $('[data-voltar-login]');
  if (voltar) voltar.addEventListener('click', function () { irPara('entrar'); });

  /* ---------- primeiro acesso ---------- */
  var formNovo = $('[data-form="primeiro"]');
  if (formNovo) {
    formNovo.addEventListener('submit', function (ev) {
      ev.preventDefault();
      erro('');

      var nome  = $('[data-novo-nome]').value.trim();
      var email = emailCompleto($('[data-novo-user]').value);
      var s1    = $('[data-novo-pass]').value;
      var s2    = $('[data-novo-pass2]').value;
      var botao = $('[data-novo-submit]');

      if (!nome)  { erro('Informe seu nome completo.'); return; }
      if (!email) { erro('Informe seu e-mail corporativo.'); return; }
      if (!emailValido(email)) { erro('Informe um e-mail válido.'); return; }
      if (s1.length < 8) { erro('A senha precisa ter ao menos 8 caracteres.'); return; }
      if (s1 !== s2)     { erro('As duas senhas não são iguais.'); return; }

      botao.disabled = true;
      botao.classList.add('is-loading');

      sb.auth.signUp({ email: email, password: s1, options: { data: { nome: nome } } })
        .then(function (r) {
          botao.disabled = false;
          botao.classList.remove('is-loading');

          if (r.error) {
            var m = r.error.message || '';
            if (/already registered|already been registered/i.test(m)) {
              erro('Esse e-mail já tem cadastro. Use "Entrar" ou peça a senha ao TI.');
            } else if (/@lube\.com\.br/i.test(m)) {
              erro(m);
            } else {
              erro(m);
            }
            return;
          }

          var precisaConfirmar = !r.data.session;
          // a conta nasce pendente: ninguém entra antes da liberação
          return sb.auth.signOut().then(function () {
            $$('[data-form]').forEach(function (f) { f.classList.remove('is-on'); });
            if (okTexto) {
              okTexto.textContent = precisaConfirmar
                ? 'Confirme o endereço pelo link enviado para ' + email +
                  ' e aguarde a liberação do TI para ver seus sistemas.'
                : 'Sua conta foi criada para ' + email +
                  '. O TI precisa liberar seus sistemas antes do primeiro login — você será avisado.';
            }
            if (okBox) okBox.classList.add('is-on');
            formNovo.reset();
          });
        })
        .catch(function () {
          botao.disabled = false;
          botao.classList.remove('is-loading');
          erro('Falha de conexão. Tente de novo.');
        });
    });
  }

  /* ---------- sufixo @lube.com.br some quando a pessoa digita o e-mail todo ---------- */
  $$('[data-gate-user], [data-novo-user]').forEach(function (campo) {
    var sufixo = $('.gate__suffix', campo.parentElement);
    if (!sufixo) return;
    var atualiza = function () {
      sufixo.classList.toggle('is-off', campo.value.indexOf('@') > -1);
    };
    campo.addEventListener('input', atualiza);
    atualiza();
  });

  /* ---------- mostrar/ocultar senha ---------- */
  $$('[data-eye]').forEach(function (olho) {
    var campo = $('input[type="password"]', olho.parentElement);
    if (!campo) return;
    olho.addEventListener('click', function () {
      var mostrar = campo.type === 'password';
      campo.type = mostrar ? 'text' : 'password';
      olho.classList.toggle('is-on', mostrar);
      olho.setAttribute('aria-label', mostrar ? 'Ocultar senha' : 'Mostrar senha');
    });
  });

  /* ---------- início ---------- */
  sb.auth.getSession().then(function (r) {
    carregarSessao(r.data.session);
  });

  sb.auth.onAuthStateChange(function (evt, sessao) {
    if (evt === 'SIGNED_OUT') mostrarGate();
  });
})();
