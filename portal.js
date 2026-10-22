/* =========================================================
   PAINEL LUBE — sessão, permissões e montagem dos sistemas
   ========================================================= */
(function () {
  'use strict';

  /* ---------- portal carregado DENTRO de um BI do painel ----------
     Acontece quando o guarda do sistema não aceitou a entrada e mandou
     de volta ao portal (?abrir=<slug>, ou só "/" se o passe falhou). Quem
     resolve é o painel de cima (mesma origem): pede um passe novo ou
     mostra o erro naquela aba. Aqui não monta nada. */
  if (document.documentElement.classList.contains('em-moldura')) {
    try {
      var pai = window.parent && window.parent !== window ? window.parent.LubeShell : null;
      var slugM = new URL(location.href).searchParams.get('abrir');
      if (pai) pai.reentrar(slugM, window);
    } catch (e) {}
    return;
  }

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

  // abre o sistema em nova aba: a janela nasce em branco já no clique (senão o
  // bloqueador de pop-up barra) e recebe o endereço com passe; sem passe, a URL normal
  function abrirJanela(s) {
    if (!s) return;
    if (!s.slug || !origemHttps(s.url)) { window.open(s.url, '_blank', 'noopener'); return; }

    var janela = null;
    try { janela = window.open('', '_blank'); } catch (e) { janela = null; }
    // o bloqueador barrou: tenta o link direto (sem passe o guarda manda ao portal)
    if (!janela || janela.closed) { window.open(s.url, '_blank', 'noopener'); return; }
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
          aviso('A janela de ' + s.nome + ' foi fechada antes de abrir. Clique de novo.');
          return;
        }
        janela.location.replace(url || s.url);
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

  /* ---------- ?voltar=office: o LUBE OFFICE mandou entrar por aqui ---------- */
  var voltarPara = (function () {
    try {
      var u = new URL(location.href);
      if (!u.searchParams.has('voltar')) return null;
      var v = u.searchParams.get('voltar');
      u.searchParams.delete('voltar');
      history.replaceState(history.state, '', u.pathname + u.search + u.hash);
      return v === 'office' ? 'office/' : null;
    } catch (e) { return null; }
  })();

  /* ---------- LUBE OFFICE: avisos não lidos ao lado do link do menu ----------
     Falha em silêncio: sem a função no ar, o link só fica sem número. */
  function avisosOffice(token) {
    var el = $('[data-office-n]');
    if (!el || !token || typeof fetch !== 'function') return;
    var pedido = fetch(CFG.url + '/functions/v1/office', {
      method: 'POST', credentials: 'omit', cache: 'no-store',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
      body: JSON.stringify({ acao: 'eu' })
    }).then(function (r) { return r.ok ? r.json() : null; });
    limite(pedido, 5000).then(function (j) {
      var n = j && typeof j.avisos_nao_lidos === 'number' ? j.avisos_nao_lidos : 0;
      el.textContent = n > 99 ? '99+' : String(n);
      el.hidden = !n;
      el.parentNode.setAttribute('title', n ? n + (n > 1 ? ' avisos novos' : ' aviso novo') + ' no LUBE OFFICE' : 'LUBE OFFICE');
    }, function () {});
  }

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
    if (s.abre_no_painel && window.LubeShell) {
      window.LubeShell.abrir(s.id);
      return;
    }
    aviso('Abrindo ' + s.nome + '…');
    var reg = registrar('abriu_sistema', s.id);
    Promise.all([pedirPasse(s.slug, s.url), limite(reg, 1500)]).then(function (rs) {
      location.assign(rs[0] || s.url);
    });
  }

  /* ---------- menu "BI LUBE" e palco (shell.js) ---------- */
  function montarSistemas(lista, favoritos) {
    sistemasPorId = {};
    lista.forEach(function (s) { sistemasPorId[s.id] = s; });
    if (!window.LubeShell) return;
    window.LubeShell.montar({
      sb: sb, perfil: perfil, icones: icones, lista: lista, favoritos: favoritos,
      registrar: registrar, pedirPasse: pedirPasse, abrirJanela: abrirJanela
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
    if (window.LubeShell) window.LubeShell.limpar();
  }

  // o botão Sair fica no rodapé do menu (montado pelo shell.js)
  document.addEventListener('click', function (ev) {
    var sair = ev.target.closest ? ev.target.closest('[data-sair]') : null;
    if (!sair) return;
    sair.disabled = true;
    Promise.resolve(registrar('logout')).then(function () {
      return sb.auth.signOut();
    }).then(function () { location.reload(); }, function () { location.reload(); });
  });

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
        if (voltarPara) {
          var destino = voltarPara;
          voltarPara = null;
          location.assign(destino);
          return;
        }
        mostrarPortal();
        informarIdentidade(sessao.access_token);
        avisosOffice(sessao.access_token);

        return Promise.all([
          sb.from('sistemas').select('*').eq('ativo', true).order('ordem', { ascending: true }),
          sb.from('permissoes').select('sistema_id').eq('user_id', perfil.id),
          sb.from('icones').select('*'),
          sb.from('permissoes_excecao').select('sistema_id').eq('user_id', perfil.id),
          sb.from('favoritos').select('sistema_id, criado_em').eq('user_id', perfil.id)
            .order('criado_em', { ascending: true })
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
            // sem a tabela (ou com erro) os fixados ficam só no navegador
            var favoritos = rs[4] && !rs[4].error
              ? (rs[4].data || []).map(function (f) { return f.sistema_id; }) : null;
            montarSistemas(lista, favoritos);
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
