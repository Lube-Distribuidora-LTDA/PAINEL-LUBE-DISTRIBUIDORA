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
  var form     = $('[data-gate-form]');
  var campoUsr = $('[data-gate-user]');
  var campoPwd = $('[data-gate-pass]');
  var erroEl   = $('[data-gate-erro]');
  var btnEntrar= $('[data-gate-submit]');
  var track    = $('[data-track]');
  var conta    = $('[data-conta]');

  var perfil = null;

  /* ---------- utilidades ---------- */
  function emailCompleto(v) {
    v = (v || '').trim().toLowerCase();
    if (!v) return '';
    return v.indexOf('@') > -1 ? v : v + CFG.dominio;
  }
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

  /* ---------- registro de acesso ---------- */
  function registrar(acao, sistemaId) {
    if (!perfil) return;
    sb.from('acessos').insert({
      user_id: perfil.id, email: perfil.email, acao: acao, sistema_id: sistemaId || null
    }).then(function () {}, function () {});
  }

  /* ---------- montagem dos cartões ---------- */
  function cartao(s, i) {
    return '' +
      '<a class="card" href="' + esc(s.url) + '" target="_blank" rel="noopener" ' +
         'data-card data-surface="dark" data-sistema="' + esc(s.id) + '" ' +
         'data-keys="' + esc([s.nome, s.categoria, s.descricao, s.slug].join(' ')) + '">' +
        '<div class="card__visual">' +
          '<span class="card__num mono">' + (i < 9 ? '0' : '') + (i + 1) + '</span>' +
          '<span class="card__badge" data-badge="' + esc(s.badge) + '"></span>' +
          '<span class="card__pattern" aria-hidden="true"></span>' +
        '</div>' +
        '<div class="card__info">' +
          '<p class="mono card__cat">' + esc(s.categoria) + '</p>' +
          '<h3 class="card__title">' + esc(s.nome) + '</h3>' +
          '<div class="card__bottom">' +
            '<p class="card__desc">' + esc(s.descricao) + '</p>' +
            '<span class="card__go" aria-hidden="true">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
              '<path d="M7 17 17 7M9 7h8v8"/></svg>' +
            '</span>' +
          '</div>' +
        '</div>' +
      '</a>';
  }

  function montarSistemas(lista) {
    if (!track) return;
    if (!lista.length) {
      track.innerHTML = '';
      var vazio = $('[data-empty]');
      if (vazio) {
        vazio.hidden = false;
        vazio.innerHTML = '<span class="mono">Nenhum sistema liberado</span>' +
          'Seu acesso ainda não foi configurado. Fale com o TI pelo botão no rodapé.';
      }
      return;
    }
    track.innerHTML = lista.map(cartao).join('');
    if (window.LubePainel) {
      window.LubePainel.badges(track);
      window.LubePainel.indexCards();
    }
    $$('.card', track).forEach(function (a) {
      a.addEventListener('click', function () {
        registrar('abriu_sistema', a.getAttribute('data-sistema'));
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

  function carregarSessao(sessao) {
    if (!sessao) { mostrarGate(); return Promise.resolve(); }

    return sb.from('profiles').select('*').eq('id', sessao.user.id).single()
      .then(function (r) {
        if (r.error || !r.data) throw new Error('Perfil não encontrado');
        perfil = r.data;
        if (!perfil.ativo) {
          return sb.auth.signOut().then(function () {
            mostrarGate();
            erro('Seu acesso está desativado. Procure o TI.');
          });
        }
        window.LUBE_PERFIL = perfil;
        mostrarPortal();
        barraConta();

        return sb.from('permissoes')
          .select('sistemas(id,slug,nome,categoria,descricao,url,badge,ordem,ativo)')
          .then(function (p) {
            var lista = (p.data || [])
              .map(function (x) { return x.sistemas; })
              .filter(function (s) { return s && s.ativo; })
              .sort(function (a, b) { return a.ordem - b.ordem; });
            montarSistemas(lista);
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
      if (email.slice(-CFG.dominio.length) !== CFG.dominio) {
        erro('Acesso restrito a e-mails ' + CFG.dominio);
        return;
      }
      if (!senha) { erro('Informe a senha.'); return; }

      carregando(true);
      sb.auth.signInWithPassword({ email: email, password: senha })
        .then(function (r) {
          carregando(false);
          if (r.error) {
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

  /* ---------- mostrar/ocultar senha ---------- */
  var olho = $('[data-eye]');
  if (olho && campoPwd) {
    olho.addEventListener('click', function () {
      var mostrar = campoPwd.type === 'password';
      campoPwd.type = mostrar ? 'text' : 'password';
      olho.classList.toggle('is-on', mostrar);
      olho.setAttribute('aria-label', mostrar ? 'Ocultar senha' : 'Mostrar senha');
    });
  }

  /* ---------- início ---------- */
  sb.auth.getSession().then(function (r) {
    carregarSessao(r.data.session);
  });

  sb.auth.onAuthStateChange(function (evt, sessao) {
    if (evt === 'SIGNED_OUT') mostrarGate();
  });
})();
