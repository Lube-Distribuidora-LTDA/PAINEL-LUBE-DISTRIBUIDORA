/* =========================================================
   PAINEL ADMINISTRATIVO — Lube Distribuidora
   Só abre para perfis com is_admin. As operações que exigem
   privilégio (criar usuário, trocar senha, remover) passam
   pela Edge Function "admin-users", que confere o JWT.
   ========================================================= */
(function () {
  'use strict';

  var CFG = window.LUBE_CFG;
  var sb  = window.supabase.createClient(CFG.url, CFG.key);

  var $  = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };

  var eu = null, usuarios = [], sistemas = [], permissoes = [];

  /* ---------------- utilidades ---------------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function data(d) {
    if (!d) return '—';
    var x = new Date(d);
    return x.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit',
                                       hour: '2-digit', minute: '2-digit' });
  }
  var toastEl = $('[data-toast]'), toastT;
  function toast(msg, erro) {
    toastEl.textContent = msg;
    toastEl.classList.toggle('is-erro', !!erro);
    toastEl.classList.add('is-on');
    clearTimeout(toastT);
    toastT = setTimeout(function () { toastEl.classList.remove('is-on'); }, 3800);
  }

  /* ---------------- modal ---------------- */
  var modal   = $('[data-modal]');
  var mTitulo = $('[data-modal-titulo]');
  var mForm   = $('[data-modal-form]');
  var mErro   = $('[data-modal-erro]');
  var mOk     = $('[data-modal-ok]');
  var aoSalvar = null;

  function abrirModal(titulo, html, salvar, rotulo) {
    mTitulo.textContent = titulo;
    mForm.innerHTML = html;
    mErro.textContent = '';
    aoSalvar = salvar;
    $('.btn__label', mOk).textContent = rotulo || 'Salvar';
    modal.hidden = false;
    var primeiro = $('input,select,textarea', mForm);
    if (primeiro) setTimeout(function () { primeiro.focus(); }, 80);
  }
  function fecharModal() { modal.hidden = true; aoSalvar = null; }
  $$('[data-modal-fechar]').forEach(function (b) { b.addEventListener('click', fecharModal); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !modal.hidden) fecharModal(); });

  mOk.addEventListener('click', function () {
    if (!aoSalvar) return;
    mErro.textContent = '';
    mOk.disabled = true;
    Promise.resolve(aoSalvar()).then(function (ok) {
      mOk.disabled = false;
      if (ok !== false) fecharModal();
    }).catch(function (e) {
      mOk.disabled = false;
      mErro.textContent = (e && e.message) || String(e);
    });
  });
  mForm.addEventListener('submit', function (e) { e.preventDefault(); mOk.click(); });

  /* ---------------- chamadas ao servidor ---------------- */
  function fn(corpo) {
    return sb.functions.invoke('admin-users', { body: corpo }).then(function (r) {
      if (r.error) {
        var d = r.error.context;
        return (d && typeof d.json === 'function' ? d.json() : Promise.resolve(null))
          .then(function (j) { throw new Error((j && j.erro) || r.error.message); });
      }
      if (r.data && r.data.erro) throw new Error(r.data.erro);
      return r.data;
    });
  }

  /* ---------------- carregamento ---------------- */
  function carregarTudo() {
    return Promise.all([
      sb.from('profiles').select('*').order('criado_em', { ascending: true }),
      sb.from('sistemas').select('*').order('ordem', { ascending: true }),
      sb.from('permissoes').select('user_id,sistema_id')
    ]).then(function (r) {
      usuarios   = r[0].data || [];
      sistemas   = r[1].data || [];
      permissoes = r[2].data || [];
      pintarUsuarios();
      pintarSistemas();
    });
  }

  function sistemasDe(userId) {
    var ids = permissoes.filter(function (p) { return p.user_id === userId; })
                        .map(function (p) { return p.sistema_id; });
    return sistemas.filter(function (s) { return ids.indexOf(s.id) > -1; });
  }

  /* ---------------- usuários ---------------- */
  function pendente(u) { return !u.ativo && !u.aprovado_em; }

  function pintarUsuarios() {
    var tb = $('[data-tbody-usuarios]');
    var resumo = $('[data-resumo-usuarios]');
    var ativos = usuarios.filter(function (u) { return u.ativo; }).length;
    var pend = usuarios.filter(pendente);
    resumo.textContent = usuarios.length + ' cadastrados · ' + ativos + ' ativos' +
      (pend.length ? ' · ' + pend.length + ' aguardando liberação' : '');

    // quem pediu primeiro acesso aparece no topo
    usuarios.sort(function (a, b) {
      return (pendente(b) ? 1 : 0) - (pendente(a) ? 1 : 0);
    });

    if (!usuarios.length) {
      tb.innerHTML = '<tr><td colspan="6" class="adm__vazio">Nenhum usuário ainda.</td></tr>';
      return;
    }

    tb.innerHTML = usuarios.map(function (u) {
      var meus = sistemasDe(u.id);
      var chips = meus.length
        ? meus.map(function (s) { return '<span class="chip">' + esc(s.nome) + '</span>'; }).join('')
        : '<span class="chip chip--vazio">sem acesso</span>';
      return '<tr>' +
        '<td><span class="cel-nome">' + esc(u.nome || '—') + '</span>' +
            '<span class="cel-email">' + esc(u.email) + '</span></td>' +
        '<td>' + esc(u.cargo || '—') + '</td>' +
        '<td>' + (u.is_admin ? '<span class="tag tag--admin">Admin</span>'
                             : '<span class="tag tag--user">Usuário</span>') + '</td>' +
        '<td>' + (u.ativo ? '<span class="tag tag--ok">Ativo</span>'
                 : pendente(u) ? '<span class="tag tag--pendente">Aguardando</span>'
                               : '<span class="tag tag--off">Desativado</span>') + '</td>' +
        '<td><div class="chips">' + chips + '</div></td>' +
        '<td><div class="cel-acoes">' +
          (pendente(u) ? '<button class="adm__link adm__link--destaque" data-aprovar="' + u.id + '">Liberar</button>' : '') +
          '<button class="adm__link" data-editar="' + u.id + '">Editar</button>' +
          '<button class="adm__link" data-senha="' + u.id + '">Senha</button>' +
          '<button class="adm__link adm__link--perigo" data-remover="' + u.id + '">Remover</button>' +
        '</div></td>' +
      '</tr>';
    }).join('');
  }

  function listaSistemasHTML(marcados) {
    return '<div class="campo"><span>Sistemas liberados</span><div class="listasistemas">' +
      sistemas.map(function (s) {
        var on = marcados.indexOf(s.id) > -1 ? ' checked' : '';
        return '<label class="campo-inline"><input type="checkbox" name="sis" value="' + s.id + '"' + on + ' />' +
               '<span>' + esc(s.nome) + (s.ativo ? '' : ' (inativo)') + '</span></label>';
      }).join('') + '</div></div>';
  }

  function formUsuario(u) {
    var novo = !u;
    var marcados = novo ? [] : sistemasDe(u.id).map(function (s) { return s.id; });
    return (novo
        ? '<label class="campo"><span>Usuário</span><div class="sufixo">' +
          '<input type="text" name="local" placeholder="nome.sobrenome" autocomplete="off" required />' +
          '<b>' + esc(CFG.dominio) + '</b></div>' +
          '<span class="campo__dica">Só e-mails ' + esc(CFG.dominio) + ' são aceitos.</span></label>'
        : '<label class="campo"><span>E-mail</span><input type="text" value="' + esc(u.email) + '" disabled /></label>') +
      '<div class="campo--linha">' +
        '<label class="campo"><span>Nome</span><input type="text" name="nome" value="' + esc(novo ? '' : u.nome) + '" /></label>' +
        '<label class="campo"><span>Cargo</span><input type="text" name="cargo" value="' + esc(novo ? '' : u.cargo) + '" /></label>' +
      '</div>' +
      (novo
        ? '<label class="campo"><span>Senha provisória</span>' +
          '<input type="text" name="senha" minlength="8" required />' +
          '<span class="campo__dica">Mínimo 8 caracteres. Anote e entregue ao colaborador.</span></label>'
        : '') +
      '<label class="campo-inline"><input type="checkbox" name="admin"' +
        (!novo && u.is_admin ? ' checked' : '') + ' /><span>Administrador do painel</span></label>' +
      (novo ? '' :
        '<label class="campo-inline"><input type="checkbox" name="ativo"' +
        (u.ativo ? ' checked' : '') + ' /><span>Acesso ativo</span></label>') +
      listaSistemasHTML(marcados);
  }

  function marcados() {
    return $$('input[name="sis"]:checked', mForm).map(function (i) { return i.value; });
  }

  function novoUsuario() {
    abrirModal('Novo usuário', formUsuario(null), function () {
      var local = $('input[name="local"]', mForm).value.trim().toLowerCase();
      var senha = $('input[name="senha"]', mForm).value;
      if (!local) throw new Error('Informe o usuário.');
      if (senha.length < 8) throw new Error('A senha precisa ter ao menos 8 caracteres.');
      return fn({
        acao: 'criar',
        email: local + CFG.dominio,
        nome: $('input[name="nome"]', mForm).value.trim(),
        cargo: $('input[name="cargo"]', mForm).value.trim(),
        senha: senha,
        is_admin: $('input[name="admin"]', mForm).checked,
        sistemas: marcados()
      }).then(function () {
        toast('Usuário criado.');
        return carregarTudo();
      });
    }, 'Criar usuário');
  }

  function editarUsuario(id) {
    var u = usuarios.filter(function (x) { return x.id === id; })[0];
    if (!u) return;
    abrirModal('Editar ' + (u.nome || u.email), formUsuario(u), function () {
      var novoAdmin = $('input[name="admin"]', mForm).checked;
      var novoAtivo = $('input[name="ativo"]', mForm).checked;
      if (u.id === eu.id && !novoAdmin) throw new Error('Você não pode remover o próprio acesso de administrador.');

      var escolhidos = marcados();
      var atuais = sistemasDe(u.id).map(function (s) { return s.id; });
      var incluir = escolhidos.filter(function (s) { return atuais.indexOf(s) < 0; });
      var excluir = atuais.filter(function (s) { return escolhidos.indexOf(s) < 0; });

      var passos = [
        sb.from('profiles').update({
          nome: $('input[name="nome"]', mForm).value.trim(),
          cargo: $('input[name="cargo"]', mForm).value.trim(),
          is_admin: novoAdmin,
          ativo: novoAtivo
        }).eq('id', u.id)
      ];
      if (incluir.length) {
        passos.push(sb.from('permissoes').insert(incluir.map(function (s) {
          return { user_id: u.id, sistema_id: s, concedido_por: eu.id };
        })));
      }
      if (excluir.length) {
        passos.push(sb.from('permissoes').delete().eq('user_id', u.id).in('sistema_id', excluir));
      }
      return Promise.all(passos).then(function (rs) {
        var falha = rs.filter(function (r) { return r && r.error; })[0];
        if (falha) throw new Error(falha.error.message);
        toast('Usuário atualizado.');
        return carregarTudo();
      });
    });
  }

  function aprovarUsuario(id) {
    var u = usuarios.filter(function (x) { return x.id === id; })[0];
    if (!u) return;
    abrirModal('Liberar ' + (u.nome || u.email),
      '<p><strong>' + esc(u.email) + '</strong> criou o acesso pelo botão “Primeiro acesso” e está ' +
      'aguardando liberação. Marque abaixo o que essa pessoa pode ver.</p>' +
      listaSistemasHTML([]),
      function () {
        var escolhidos = marcados();
        var passos = [
          sb.from('profiles').update({
            ativo: true, aprovado_em: new Date().toISOString(), aprovado_por: eu.id
          }).eq('id', u.id)
        ];
        if (escolhidos.length) {
          passos.push(sb.from('permissoes').insert(escolhidos.map(function (sid) {
            return { user_id: u.id, sistema_id: sid, concedido_por: eu.id };
          })));
        }
        return Promise.all(passos).then(function (rs) {
          var falha = rs.filter(function (r) { return r && r.error; })[0];
          if (falha) throw new Error(falha.error.message);
          toast('Acesso liberado.');
          return carregarTudo();
        });
      }, 'Liberar acesso');
  }

  function trocarSenha(id) {
    var u = usuarios.filter(function (x) { return x.id === id; })[0];
    if (!u) return;
    abrirModal('Nova senha — ' + u.email,
      '<label class="campo"><span>Nova senha</span><input type="text" name="senha" minlength="8" required />' +
      '<span class="campo__dica">Mínimo 8 caracteres. O usuário entra com ela na próxima vez.</span></label>',
      function () {
        var senha = $('input[name="senha"]', mForm).value;
        if (senha.length < 8) throw new Error('A senha precisa ter ao menos 8 caracteres.');
        return fn({ acao: 'senha', user_id: id, senha: senha }).then(function () {
          toast('Senha redefinida.');
        });
      }, 'Redefinir');
  }

  function removerUsuario(id) {
    var u = usuarios.filter(function (x) { return x.id === id; })[0];
    if (!u) return;
    abrirModal('Remover usuário',
      '<p>Isto apaga <strong>' + esc(u.email) + '</strong> em definitivo, junto com as permissões dele. ' +
      'Se a ideia é só suspender o acesso, use <em>Editar</em> e desmarque “Acesso ativo”.</p>',
      function () {
        return fn({ acao: 'remover', user_id: id }).then(function () {
          toast('Usuário removido.');
          return carregarTudo();
        });
      }, 'Remover');
  }

  /* ---------------- sistemas ---------------- */
  function pintarSistemas() {
    var tb = $('[data-tbody-sistemas]');
    if (!sistemas.length) {
      tb.innerHTML = '<tr><td colspan="6" class="adm__vazio">Nenhum sistema cadastrado.</td></tr>';
      return;
    }
    tb.innerHTML = sistemas.map(function (s) {
      return '<tr>' +
        '<td><span class="cel-nome">' + esc(s.nome) + '</span>' +
            '<span class="cel-email">' + esc(s.descricao) + '</span></td>' +
        '<td>' + esc(s.categoria) + '</td>' +
        '<td><a class="adm__link" href="' + esc(s.url) + '" target="_blank" rel="noopener">abrir</a></td>' +
        '<td>' + s.ordem + '</td>' +
        '<td>' + (s.ativo ? '<span class="tag tag--ok">Ativo</span>'
                          : '<span class="tag tag--off">Inativo</span>') + '</td>' +
        '<td><div class="cel-acoes">' +
          '<button class="adm__link" data-edit-sis="' + s.id + '">Editar</button>' +
          '<button class="adm__link adm__link--perigo" data-del-sis="' + s.id + '">Excluir</button>' +
        '</div></td>' +
      '</tr>';
    }).join('');
  }

  function formSistema(s) {
    s = s || { nome: '', categoria: '', descricao: '', url: '', badge: 'saida', ordem: sistemas.length + 1, ativo: true, slug: '' };
    var op = function (v, r) {
      return '<option value="' + v + '"' + (s.badge === v ? ' selected' : '') + '>' + r + '</option>';
    };
    return '<label class="campo"><span>Nome</span><input type="text" name="nome" value="' + esc(s.nome) + '" required /></label>' +
      '<label class="campo"><span>Área</span><input type="text" name="categoria" value="' + esc(s.categoria) + '" /></label>' +
      '<label class="campo"><span>Descrição</span><textarea name="descricao">' + esc(s.descricao) + '</textarea></label>' +
      '<label class="campo"><span>Endereço (URL)</span><input type="url" name="url" value="' + esc(s.url) + '" required /></label>' +
      '<div class="campo--linha">' +
        '<label class="campo"><span>Ícone</span><select name="badge">' +
          op('saida', 'Saída de Veículos') + op('rh', 'RH') + op('icms', 'ICMS') +
        '</select></label>' +
        '<label class="campo"><span>Ordem</span><input type="number" name="ordem" value="' + s.ordem + '" min="0" /></label>' +
      '</div>' +
      '<label class="campo-inline"><input type="checkbox" name="ativo"' + (s.ativo ? ' checked' : '') +
      ' /><span>Sistema ativo</span></label>';
  }

  function dadosSistema() {
    var nome = $('input[name="nome"]', mForm).value.trim();
    if (!nome) throw new Error('Informe o nome.');
    var url = $('input[name="url"]', mForm).value.trim();
    if (!/^https?:\/\//i.test(url)) throw new Error('O endereço precisa começar com http:// ou https://');
    return {
      nome: nome,
      categoria: $('input[name="categoria"]', mForm).value.trim(),
      descricao: $('textarea[name="descricao"]', mForm).value.trim(),
      url: url,
      badge: $('select[name="badge"]', mForm).value,
      ordem: parseInt($('input[name="ordem"]', mForm).value, 10) || 0,
      ativo: $('input[name="ativo"]', mForm).checked
    };
  }

  function novoSistema() {
    abrirModal('Novo sistema', formSistema(null), function () {
      var d = dadosSistema();
      d.slug = d.nome.toLowerCase()
        .normalize('NFD').replace(/[^a-z0-9\s-]/g, '')
        .trim().replace(/\s+/g, '-').slice(0, 40) || ('sistema-' + Date.now());
      return sb.from('sistemas').insert(d).then(function (r) {
        if (r.error) throw new Error(r.error.message);
        toast('Sistema cadastrado.');
        return carregarTudo();
      });
    }, 'Cadastrar');
  }

  function editarSistema(id) {
    var s = sistemas.filter(function (x) { return x.id === id; })[0];
    if (!s) return;
    abrirModal('Editar ' + s.nome, formSistema(s), function () {
      return sb.from('sistemas').update(dadosSistema()).eq('id', id).then(function (r) {
        if (r.error) throw new Error(r.error.message);
        toast('Sistema atualizado.');
        return carregarTudo();
      });
    });
  }

  function excluirSistema(id) {
    var s = sistemas.filter(function (x) { return x.id === id; })[0];
    if (!s) return;
    abrirModal('Excluir sistema',
      '<p>Remove <strong>' + esc(s.nome) + '</strong> do painel e apaga as permissões ligadas a ele. ' +
      'Para apenas tirar da vista, use <em>Editar</em> e desmarque “Sistema ativo”.</p>',
      function () {
        return sb.from('sistemas').delete().eq('id', id).then(function (r) {
          if (r.error) throw new Error(r.error.message);
          toast('Sistema excluído.');
          return carregarTudo();
        });
      }, 'Excluir');
  }

  /* ---------------- acessos ---------------- */
  function carregarAcessos() {
    var tb = $('[data-tbody-acessos]');
    tb.innerHTML = '<tr><td colspan="4" class="adm__vazio">Carregando…</td></tr>';
    return sb.from('acessos')
      .select('id,email,acao,criado_em,sistema_id')
      .order('criado_em', { ascending: false })
      .limit(200)
      .then(function (r) {
        var linhas = r.data || [];
        if (!linhas.length) {
          tb.innerHTML = '<tr><td colspan="4" class="adm__vazio">Nenhum acesso registrado ainda.</td></tr>';
          return;
        }
        var nomeSis = {};
        sistemas.forEach(function (s) { nomeSis[s.id] = s.nome; });
        var rotulo = { login: 'Entrou', logout: 'Saiu', abriu_sistema: 'Abriu sistema' };
        tb.innerHTML = linhas.map(function (a) {
          return '<tr><td class="mono">' + data(a.criado_em) + '</td>' +
                 '<td>' + esc(a.email || '—') + '</td>' +
                 '<td>' + (rotulo[a.acao] || esc(a.acao)) + '</td>' +
                 '<td>' + esc(nomeSis[a.sistema_id] || '—') + '</td></tr>';
        }).join('');
      });
  }

  /* ---------------- eventos ---------------- */
  document.addEventListener('click', function (ev) {
    var t = ev.target.closest ? ev.target.closest('button,a') : null;
    if (!t) return;
    var g = function (n) { return t.getAttribute(n); };
    if (g('data-aprovar'))  { aprovarUsuario(g('data-aprovar')); }
    if (g('data-editar'))   { editarUsuario(g('data-editar')); }
    if (g('data-senha'))    { trocarSenha(g('data-senha')); }
    if (g('data-remover'))  { removerUsuario(g('data-remover')); }
    if (g('data-edit-sis')) { editarSistema(g('data-edit-sis')); }
    if (g('data-del-sis'))  { excluirSistema(g('data-del-sis')); }
  });

  $('[data-novo-usuario]').addEventListener('click', novoUsuario);
  $('[data-novo-sistema]').addEventListener('click', novoSistema);
  $('[data-recarregar-acessos]').addEventListener('click', carregarAcessos);

  $$('[data-aba]').forEach(function (b) {
    b.addEventListener('click', function () {
      var alvo = b.getAttribute('data-aba');
      $$('[data-aba]').forEach(function (x) { x.classList.toggle('is-on', x === b); });
      $$('[data-painel]').forEach(function (p) {
        p.classList.toggle('is-on', p.getAttribute('data-painel') === alvo);
      });
      if (alvo === 'acessos') carregarAcessos();
    });
  });

  $('[data-sair]').addEventListener('click', function () {
    sb.auth.signOut().then(function () { location.href = 'index.html'; });
  });

  /* ---------------- porteiro ---------------- */
  sb.auth.getSession().then(function (r) {
    var s = r.data.session;
    if (!s) { location.href = 'index.html'; return; }
    return sb.from('profiles').select('*').eq('id', s.user.id).single().then(function (p) {
      if (p.error || !p.data || !p.data.is_admin || !p.data.ativo) {
        location.href = 'index.html';
        return;
      }
      eu = p.data;
      $('[data-adm-quem]').textContent = eu.email;
      $('[data-carregando]').classList.add('is-off');
      $('[data-adm]').hidden = false;
      return carregarTudo();
    });
  }).catch(function () { location.href = 'index.html'; });
})();
