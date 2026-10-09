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

  var eu = null, usuarios = [], sistemas = [], permissoes = [], excecoes = [], icones = [];

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
      sb.from('permissoes').select('user_id,sistema_id'),
      sb.from('icones').select('*').order('ordem', { ascending: true }),
      sb.from('permissoes_excecao').select('user_id,sistema_id')
    ]).then(function (r) {
      usuarios   = r[0].data || [];
      sistemas   = r[1].data || [];
      permissoes = r[2].data || [];
      icones     = r[3].data || [];
      excecoes   = r[4].data || [];
      pintarUsuarios();
      pintarSistemas();
      return carregarSac().catch(function () { /* aba do SAC fica vazia; o resto segue */ });
    });
  }

  function sistemasDe(userId) {
    var ids = permissoes.filter(function (p) { return p.user_id === userId; })
                        .map(function (p) { return p.sistema_id; });
    return sistemas.filter(function (s) { return ids.indexOf(s.id) > -1; });
  }

  // sistemas retirados de quem tem "acesso_total" — só faz sentido nesse caso
  function excecoesDe(userId) {
    return excecoes.filter(function (e) { return e.user_id === userId; })
                   .map(function (e) { return e.sistema_id; });
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
      var fora = u.acesso_total ? sistemas.filter(function (s) {
        return excecoesDe(u.id).indexOf(s.id) > -1;
      }) : [];
      var chips = u.acesso_total
        ? '<span class="chip chip--todos">Todos os sistemas</span>' +
          fora.map(function (s) { return '<span class="chip chip--excluido">exceto ' + esc(s.nome) + '</span>'; }).join('')
        : meus.length
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

  function listaSistemasHTML(marcados, todos, excecoesMarcadas) {
    excecoesMarcadas = excecoesMarcadas || [];
    return '<div class="campo"><span>Sistemas liberados</span>' +
      '<label class="campo-inline campo-inline--todos">' +
        '<input type="checkbox" name="todos" data-todos' + (todos ? ' checked' : '') + ' />' +
        '<span><strong>Todos os sistemas</strong>' +
          '<em>Inclusive os que forem cadastrados depois.</em></span>' +
      '</label>' +

      '<div class="listasistemas' + (todos ? ' is-off' : '') + '" data-lista-sis>' +
        sistemas.map(function (s) {
          var on = marcados.indexOf(s.id) > -1 ? ' checked' : '';
          return '<label class="campo-inline"><input type="checkbox" name="sis" value="' + s.id + '"' +
                 on + (todos ? ' disabled' : '') + ' />' +
                 '<span>' + esc(s.nome) + (s.ativo ? '' : ' (inativo)') + '</span></label>';
        }).join('') +
      '</div>' +

      '<div class="listasistemas listasistemas--excecao' + (todos ? '' : ' is-off') + '" data-lista-excecao>' +
        '<p class="campo__dica campo__dica--excecao">Liberar tudo, exceto:</p>' +
        sistemas.map(function (s) {
          var on = excecoesMarcadas.indexOf(s.id) > -1 ? ' checked' : '';
          return '<label class="campo-inline"><input type="checkbox" name="exc" value="' + s.id + '"' +
                 on + (todos ? '' : ' disabled') + ' />' +
                 '<span>' + esc(s.nome) + (s.ativo ? '' : ' (inativo)') + '</span></label>';
        }).join('') +
      '</div></div>';
  }

  function acessoTotalMarcado() {
    var c = $('[data-todos]', mForm);
    return !!(c && c.checked);
  }

  function excecoesMarcadas() {
    return $$('input[name="exc"]:checked', mForm).map(function (i) { return i.value; });
  }

  function formUsuario(u) {
    var novo = !u;
    var marcados = novo ? [] : sistemasDe(u.id).map(function (s) { return s.id; });
    return (novo
        ? '<label class="campo"><span>Usuário</span><div class="sufixo">' +
          '<input type="text" name="local" placeholder="nome.sobrenome" autocomplete="off" required />' +
          '<b>' + esc(CFG.dominio) + '</b></div>' +
          '<span class="campo__dica">Digite só o nome para ' + esc(CFG.dominio) + '. E-mail de fora (consultor) só funciona se estiver na lista de liberados — aí digite o e-mail completo.</span></label>'
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
      listaSistemasHTML(marcados, !novo && u.acesso_total, novo ? [] : excecoesDe(u.id));
  }

  function marcados() {
    return $$('input[name="sis"]:checked', mForm).map(function (i) { return i.value; });
  }

  // some o "@lube.com.br" fixo quando o e-mail completo é digitado
  mForm.addEventListener('input', function (ev) {
    var n = ev.target;
    if (n.name !== 'local') return;
    var suf = $('.sufixo b', mForm);
    var completo = n.value.indexOf('@') > -1;
    if (suf) suf.style.display = completo ? 'none' : '';
    n.style.setProperty('border-right', completo ? '1px solid var(--adm-borda)' : '', 'important');
  });

  function novoUsuario() {
    abrirModal('Novo usuário', formUsuario(null), function () {
      var local = $('input[name="local"]', mForm).value.trim().toLowerCase();
      var senha = $('input[name="senha"]', mForm).value;
      if (!local) throw new Error('Informe o usuário.');
      if (senha.length < 8) throw new Error('A senha precisa ter ao menos 8 caracteres.');
      return fn({
        acao: 'criar',
        // e-mail completo (consultor liberado) vai como está; só o nome ganha @lube.com.br
        email: local.indexOf('@') > -1 ? local : local + CFG.dominio,
        nome: $('input[name="nome"]', mForm).value.trim(),
        cargo: $('input[name="cargo"]', mForm).value.trim(),
        senha: senha,
        is_admin: $('input[name="admin"]', mForm).checked,
        acesso_total: acessoTotalMarcado(),
        sistemas: acessoTotalMarcado() ? [] : marcados(),
        excecoes: acessoTotalMarcado() ? excecoesMarcadas() : []
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

      var todos = acessoTotalMarcado();
      var escolhidos = todos ? [] : marcados();
      var atuais = sistemasDe(u.id).map(function (s) { return s.id; });
      var incluir = todos ? [] : escolhidos.filter(function (s) { return atuais.indexOf(s) < 0; });
      var excluir = todos ? atuais : atuais.filter(function (s) { return escolhidos.indexOf(s) < 0; });

      // exceções só fazem sentido com "todos" ligado — desligando, todas somem
      var excEscolhidas = todos ? excecoesMarcadas() : [];
      var excAtuais = excecoesDe(u.id);
      var excIncluir = excEscolhidas.filter(function (s) { return excAtuais.indexOf(s) < 0; });
      var excExcluir = excAtuais.filter(function (s) { return excEscolhidas.indexOf(s) < 0; });

      var passos = [
        sb.from('profiles').update({
          nome: $('input[name="nome"]', mForm).value.trim(),
          cargo: $('input[name="cargo"]', mForm).value.trim(),
          is_admin: novoAdmin,
          ativo: novoAtivo,
          acesso_total: todos
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
      if (excIncluir.length) {
        passos.push(sb.from('permissoes_excecao').insert(excIncluir.map(function (s) {
          return { user_id: u.id, sistema_id: s, criado_por: eu.id };
        })));
      }
      if (excExcluir.length) {
        passos.push(sb.from('permissoes_excecao').delete().eq('user_id', u.id).in('sistema_id', excExcluir));
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
      listaSistemasHTML([], false, []),
      function () {
        var todos = acessoTotalMarcado();
        var escolhidos = todos ? [] : marcados();
        var excEscolhidas = todos ? excecoesMarcadas() : [];
        var passos = [
          sb.from('profiles').update({
            ativo: true, acesso_total: todos,
            aprovado_em: new Date().toISOString(), aprovado_por: eu.id
          }).eq('id', u.id)
        ];
        if (escolhidos.length) {
          passos.push(sb.from('permissoes').insert(escolhidos.map(function (sid) {
            return { user_id: u.id, sistema_id: sid, concedido_por: eu.id };
          })));
        }
        if (excEscolhidas.length) {
          passos.push(sb.from('permissoes_excecao').insert(excEscolhidas.map(function (sid) {
            return { user_id: u.id, sistema_id: sid, criado_por: eu.id };
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
    var u = usuarios.concat(sacUsuarios).filter(function (x) { return x.id === id; })[0];
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
    var u = usuarios.concat(sacUsuarios).filter(function (x) { return x.id === id; })[0];
    if (!u) return;
    var doSac = !usuarios.some(function (x) { return x.id === id; });
    abrirModal(doSac ? 'Remover conta do SAC' : 'Remover usuário',
      doSac
        ? '<p>Isto apaga a conta do SAC de <strong>' + esc(u.email) + '</strong> em definitivo. ' +
          'Se a ideia é só suspender, use <em>Bloquear</em>.</p>'
        : '<p>Isto apaga <strong>' + esc(u.email) + '</strong> em definitivo, junto com as permissões dele. ' +
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

  function icone(slug) {
    return icones.filter(function (i) { return i.slug === slug; })[0];
  }

  function galeriaHTML(selecionado) {
    return '<div class="campo"><span>Ícone do sistema</span>' +
      '<div class="galeria">' +
        icones.map(function (ic) {
          return '<label class="galeria__item' + (ic.slug === selecionado ? ' is-on' : '') + '">' +
            '<input type="radio" name="badge" value="' + esc(ic.slug) + '"' +
              (ic.slug === selecionado ? ' checked' : '') + ' />' +
            '<span class="galeria__arte">' + window.LUBE_ICONE.html(ic) + '</span>' +
            '<span class="galeria__nome">' + esc(ic.rotulo) + '</span>' +
          '</label>';
        }).join('') +
        '<button type="button" class="galeria__novo" data-novo-icone>' +
          '<span class="galeria__mais">+</span><span class="galeria__nome">Novo ícone</span>' +
        '</button>' +
      '</div></div>';
  }

  function formSistema(s) {
    s = s || { nome: '', categoria: '', descricao: '', url: '',
               badge: (icones[0] || {}).slug || 'saida',
               ordem: sistemas.length + 1, ativo: true, slug: '' };
    return '<label class="campo"><span>Nome</span><input type="text" name="nome" value="' + esc(s.nome) + '" required /></label>' +
      '<label class="campo"><span>Área</span><input type="text" name="categoria" value="' + esc(s.categoria) + '" /></label>' +
      '<label class="campo"><span>Descrição</span><textarea name="descricao">' + esc(s.descricao) + '</textarea></label>' +
      '<label class="campo"><span>Endereço (URL)</span><input type="url" name="url" value="' + esc(s.url) + '" required /></label>' +
      galeriaHTML(s.badge) +
      '<label class="campo"><span>Ordem na vitrine</span>' +
      '<input type="number" name="ordem" value="' + s.ordem + '" min="0" /></label>' +
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
      badge: (($('input[name="badge"]:checked', mForm) || {}).value) || 'saida',
      ordem: parseInt($('input[name="ordem"]', mForm).value, 10) || 0,
      ativo: $('input[name="ativo"]', mForm).checked
    };
  }

  /* ---------------- criador de ícones ---------------- */
  var criadorHTML =
    '<div class="criador" data-criador>' +
      '<p class="criador__titulo mono">Novo ícone</p>' +
      '<div class="criador__abas">' +
        '<button type="button" class="criador__aba is-on" data-tipo="gerado">Desenhar no padrão Lube</button>' +
        '<button type="button" class="criador__aba" data-tipo="imagem">Enviar imagem</button>' +
      '</div>' +
      '<label class="campo"><span>Nome do ícone</span>' +
        '<input type="text" data-ic-rotulo placeholder="Ex.: Compras" /></label>' +
      '<div class="criador__corpo" data-corpo="gerado">' +
        '<div class="criador__grade">' +
          '<div class="criador__campos">' +
            '<label class="campo"><span>Linha de cima (opcional)</span>' +
              '<input type="text" data-ic-kicker placeholder="GESTÃO DE" maxlength="16" /></label>' +
            '<label class="campo"><span>Linha principal</span>' +
              '<input type="text" data-ic-l1 placeholder="COMPRAS" maxlength="14" /></label>' +
            '<label class="campo"><span>Segunda linha (opcional)</span>' +
              '<input type="text" data-ic-l2 maxlength="14" /></label>' +
            '<label class="campo"><span>Rodapé (opcional)</span>' +
              '<input type="text" data-ic-sub placeholder="Suprimentos" maxlength="18" /></label>' +
          '</div>' +
          '<div class="criador__previa"><div data-ic-previa></div>' +
            '<span class="campo__dica">Prévia</span></div>' +
        '</div>' +
      '</div>' +
      '<div class="criador__corpo" data-corpo="imagem" hidden>' +
        '<div class="criador__grade">' +
          '<div class="criador__campos">' +
            '<label class="campo"><span>Arquivo</span>' +
              '<input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" data-ic-arquivo /></label>' +
            '<span class="campo__dica">PNG, JPG, SVG ou WEBP at\u00e9 2 MB. O ideal \u00e9 uma imagem quadrada.</span>' +
          '</div>' +
          '<div class="criador__previa"><div data-ic-previa-img></div>' +
            '<span class="campo__dica">Prévia</span></div>' +
        '</div>' +
      '</div>' +
      '<div class="criador__acoes">' +
        '<button type="button" class="adm__link" data-ic-cancelar>Cancelar</button>' +
        '<button type="button" class="adm__link adm__link--destaque" data-ic-salvar>Salvar ícone</button>' +
      '</div>' +
      '<p class="criador__erro" data-ic-erro></p>' +
    '</div>';

  function lerCriador() {
    var v = function (sel) { var e = $(sel, mForm); return e ? e.value : ''; };
    return {
      kicker: v('[data-ic-kicker]'),
      linha1: v('[data-ic-l1]'),
      linha2: v('[data-ic-l2]'),
      sub:    v('[data-ic-sub]')
    };
  }

  function atualizarPrevia() {
    var alvo = $('[data-ic-previa]', mForm);
    if (!alvo) return;
    var cfg = lerCriador();
    if (!cfg.linha1.trim()) cfg.linha1 = 'NOME';
    alvo.innerHTML = window.LUBE_ICONE.svg(cfg);
  }

  function slugificar(t) {
    return String(t).toLowerCase().normalize('NFD')
      .replace(/[^a-z0-9 -]/g, '').trim().replace(/ +/g, '-').slice(0, 30);
  }

  function salvarIcone() {
    var erroEl  = $('[data-ic-erro]', mForm);
    var rotulo  = ($('[data-ic-rotulo]', mForm).value || '').trim();
    var tipo    = $('.criador__aba.is-on', mForm).getAttribute('data-tipo');
    var campoAr = $('[data-ic-arquivo]', mForm);
    var arquivo = tipo === 'imagem' && campoAr ? (campoAr.files || [])[0] : null;
    var dados   = lerCriador();

    erroEl.textContent = '';
    if (!rotulo) { erroEl.textContent = 'Dê um nome ao ícone.'; return; }
    if (tipo === 'gerado' && !dados.linha1.trim()) { erroEl.textContent = 'Preencha a linha principal.'; return; }
    if (tipo === 'imagem' && !arquivo) { erroEl.textContent = 'Escolha um arquivo de imagem.'; return; }
    if (arquivo && arquivo.size > 2 * 1024 * 1024) { erroEl.textContent = 'A imagem passa de 2 MB.'; return; }

    var slug = slugificar(rotulo) || ('icone-' + Date.now());
    if (icone(slug)) slug = slug + '-' + String(Date.now()).slice(-4);

    var envio = Promise.resolve(null);
    if (arquivo) {
      var ext = (arquivo.name.split('.').pop() || 'png').toLowerCase();
      var caminho = slug + '-' + Date.now() + '.' + ext;
      envio = sb.storage.from('icones').upload(caminho, arquivo, { upsert: true })
        .then(function (r) {
          if (r.error) throw new Error(r.error.message);
          return sb.storage.from('icones').getPublicUrl(caminho).data.publicUrl;
        });
    }

    erroEl.textContent = 'Salvando...';
    envio.then(function (url) {
      return sb.from('icones').insert({
        slug: slug, rotulo: rotulo, tipo: tipo,
        kicker: dados.kicker, linha1: dados.linha1, linha2: dados.linha2, sub: dados.sub,
        imagem_url: url, ordem: icones.length + 1
      }).select().single();
    }).then(function (r) {
      if (r.error) throw new Error(r.error.message);
      icones.push(r.data);
      var caixa = $('[data-criador]', mForm);
      var campo = caixa.previousElementSibling;      // o bloco da galeria
      if (campo) campo.outerHTML = galeriaHTML(r.data.slug);
      caixa.remove();
      toast('Ícone salvo. Já fica disponível para os próximos sistemas.');
    }).catch(function (e) {
      erroEl.textContent = (e && e.message) || String(e);
    });
  }

  /* eventos dentro do formulário do modal */
  mForm.addEventListener('click', function (ev) {
    var t = ev.target.closest ? ev.target.closest('button') : null;
    if (!t) return;

    if (t.hasAttribute('data-novo-icone')) {
      ev.preventDefault();
      if ($('[data-criador]', mForm)) return;
      var campoGaleria = t.closest('.campo');   // fora da grade, ocupando a largura toda
      (campoGaleria || t).insertAdjacentHTML('afterend', criadorHTML);
      atualizarPrevia();
      $('[data-ic-rotulo]', mForm).focus();
    }
    if (t.hasAttribute('data-ic-cancelar')) {
      ev.preventDefault();
      var c = $('[data-criador]', mForm);
      if (c) c.remove();
    }
    if (t.hasAttribute('data-ic-salvar')) { ev.preventDefault(); salvarIcone(); }
    if (t.classList.contains('criador__aba')) {
      ev.preventDefault();
      var tipo = t.getAttribute('data-tipo');
      $$('.criador__aba', mForm).forEach(function (b) { b.classList.toggle('is-on', b === t); });
      $$('[data-corpo]', mForm).forEach(function (c) {
        c.hidden = c.getAttribute('data-corpo') !== tipo;
      });
    }
  });

  mForm.addEventListener('input', function (ev) {
    var n = ev.target;
    if (!n.hasAttribute) return;
    if (n.hasAttribute('data-ic-kicker') || n.hasAttribute('data-ic-l1') ||
        n.hasAttribute('data-ic-l2') || n.hasAttribute('data-ic-sub')) {
      atualizarPrevia();
    }
  });

  mForm.addEventListener('change', function (ev) {
    var n = ev.target;
    if (n.hasAttribute && n.hasAttribute('data-todos')) {
      var lista = $('[data-lista-sis]', mForm);
      if (lista) {
        lista.classList.toggle('is-off', n.checked);
        $$('input[name="sis"]', lista).forEach(function (c) { c.disabled = n.checked; });
      }
      var listaExc = $('[data-lista-excecao]', mForm);
      if (listaExc) {
        listaExc.classList.toggle('is-off', !n.checked);
        $$('input[name="exc"]', listaExc).forEach(function (c) { c.disabled = !n.checked; });
      }
    }
    if (n.name === 'badge') {
      $$('.galeria__item', mForm).forEach(function (l) {
        l.classList.toggle('is-on', !!$('input:checked', l));
      });
    }
    if (n.hasAttribute && n.hasAttribute('data-ic-arquivo')) {
      var f = (n.files || [])[0];
      var alvo = $('[data-ic-previa-img]', mForm);
      if (f && alvo) {
        var leitor = new FileReader();
        leitor.onload = function () {
          alvo.innerHTML = '<img src="' + leitor.result + '" alt="" style="width:100%;border-radius:18px" />';
        };
        leitor.readAsDataURL(f);
      }
    }
  });

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


  /* ---------------- SAC · contas externas (2026-10-09) ----------------
     RCAs e supervisores que abrem chamado no SAC (sac-lube.vercel.app).
     Ficam em sac_usuarios, separados de profiles: nunca entram no painel.
     O "Primeiro acesso" do SAC cria a conta como "pendente" e avisa aqui
     (selo na aba, faixa no topo e o número no título da aba do navegador). */
  var sacUsuarios = [], sacPendentesAntes = null;
  var SAC_SITUACAO = {
    pendente:  ['Aguardando', 'tag--pendente'],
    liberado:  ['Liberado', 'tag--ok'],
    recusado:  ['Recusado', 'tag--off'],
    bloqueado: ['Bloqueado', 'tag--admin']
  };

  function sacPendentes() { return sacUsuarios.filter(function (u) { return u.situacao === 'pendente'; }); }
  function tipoSac(u) { return u.tipo === 'supervisor' ? 'Supervisor' : 'RCA' + (u.codusur ? ' ' + u.codusur : ''); }

  function carregarSac() {
    return sb.from('sac_usuarios').select('*').order('criado_em', { ascending: false }).then(function (r) {
      if (r.error) throw r.error;
      sacUsuarios = r.data || [];
      pintarSac();
      avisarSac();
    });
  }

  function avisarSac() {
    var pend = sacPendentes(), n = pend.length;
    var badge = $('[data-sac-badge]');
    badge.textContent = n;
    badge.hidden = !n;
    $('[data-sac-aviso]').hidden = !n;
    if (n) {
      $('[data-sac-aviso-texto]').innerHTML = '<strong>' + n + (n === 1 ? ' cadastro novo' : ' cadastros novos') +
        ' no SAC</strong> esperando liberação' + (n === 1 ? ': ' + esc(pend[0].nome || pend[0].email) + ' (' + esc(tipoSac(pend[0])) + ').' : '.');
    }
    document.title = (n ? '(' + n + ') ' : '') + 'Painel Administrativo — Lube Distribuidora';
    if (sacPendentesAntes !== null && n > sacPendentesAntes) toast('Novo cadastro no SAC esperando liberação.');
    sacPendentesAntes = n;
  }

  function pintarSac() {
    var tb = $('[data-tbody-sac]');
    var lib = sacUsuarios.filter(function (u) { return u.situacao === 'liberado'; }).length;
    var pend = sacPendentes().length;
    $('[data-resumo-sac]').textContent = sacUsuarios.length + (sacUsuarios.length === 1 ? ' conta' : ' contas') +
      ' · ' + lib + ' liberada' + (lib === 1 ? '' : 's') + (pend ? ' · ' + pend + ' aguardando liberação' : '');
    var lista = sacUsuarios.slice().sort(function (a, b) {
      return (b.situacao === 'pendente' ? 1 : 0) - (a.situacao === 'pendente' ? 1 : 0);
    });
    if (!lista.length) {
      tb.innerHTML = '<tr><td colspan="5" class="adm__vazio">Nenhuma conta ainda. O primeiro acesso de um RCA ou supervisor aparece aqui.</td></tr>';
      return;
    }
    tb.innerHTML = lista.map(function (u) {
      var s = SAC_SITUACAO[u.situacao] || [u.situacao, 'tag--off'];
      var acoes = u.situacao === 'pendente'
        ? '<button class="adm__link adm__link--destaque" data-sac-liberar="' + u.id + '">Liberar</button>' +
          '<button class="adm__link adm__link--perigo" data-sac-recusar="' + u.id + '">Recusar</button>'
        : u.situacao === 'liberado'
          ? '<button class="adm__link adm__link--perigo" data-sac-bloquear="' + u.id + '">Bloquear</button>'
          : '<button class="adm__link" data-sac-liberar="' + u.id + '">Liberar</button>';
      acoes += '<button class="adm__link" data-senha="' + u.id + '">Senha</button>' +
               '<button class="adm__link adm__link--perigo" data-remover="' + u.id + '">Remover</button>';
      return '<tr>' +
        '<td><span class="cel-nome">' + esc(u.nome || '—') + '</span><span class="cel-email">' + esc(u.email) + '</span></td>' +
        '<td><span class="tag ' + (u.tipo === 'supervisor' ? 'tag--admin' : 'tag--user') + '">' + esc(tipoSac(u)) + '</span></td>' +
        '<td><span class="tag ' + s[1] + '">' + s[0] + '</span></td>' +
        '<td class="mono">' + data(u.criado_em) + '</td>' +
        '<td><div class="cel-acoes">' + acoes + '</div></td>' +
      '</tr>';
    }).join('');
  }

  function decidirSac(id, situacao) {
    var u = sacUsuarios.filter(function (x) { return x.id === id; })[0];
    if (!u) return;
    var quem = '<strong>' + esc(u.nome || u.email) + '</strong> (' + esc(u.email) + ', ' + esc(tipoSac(u)) + ')';
    var conferido = u.tipo === 'supervisor'
      ? '<p class="campo__dica">Supervisor: o e-mail <strong>não</strong> é conferido no WinThor (o cadastro de supervisor, rotina 516, não tem e-mail). Confirme quem é antes de liberar.</p>'
      : (u.codusur ? '<p class="campo__dica">E-mail conferido no cadastro do RCA ' + u.codusur + ' no WinThor, na hora do cadastro.</p>' : '');
    var textos = {
      liberado:  ['Liberar no SAC', '<p>' + quem + ' passa a entrar no SAC com o e-mail e a senha que criou. Não ganha acesso ao painel.</p>' + conferido, 'Liberar', 'Acesso ao SAC liberado.'],
      recusado:  ['Recusar cadastro', '<p>' + quem + ' não vai conseguir entrar no SAC. A conta fica registrada como recusada; para apagar de vez, use “Remover”.</p>', 'Recusar', 'Cadastro recusado.'],
      bloqueado: ['Bloquear no SAC', '<p>' + quem + ' deixa de entrar no SAC na próxima tentativa. Dá para liberar de novo depois.</p>', 'Bloquear', 'Acesso ao SAC bloqueado.']
    }[situacao];
    abrirModal(textos[0], textos[1], function () {
      return sb.from('sac_usuarios')
        .update({ situacao: situacao, decidido_em: new Date().toISOString(), decidido_por: eu.id })
        .eq('id', id).select('id')
        .then(function (r) {
          if (r.error) throw r.error;
          if (!r.data || !r.data.length) throw new Error('Não foi possível alterar esta conta.');
          toast(textos[3]);
          return Promise.all([carregarSac(), carregarSacAcessos()]);
        });
    }, textos[2]);
  }

  function carregarSacAcessos() {
    var tb = $('[data-tbody-sac-acessos]');
    tb.innerHTML = '<tr><td colspan="4" class="adm__vazio">Carregando…</td></tr>';
    return sb.from('sac_acessos')
      .select('id,email,acao,detalhe,criado_em')
      .order('criado_em', { ascending: false })
      .limit(200)
      .then(function (r) {
        var linhas = r.data || [];
        if (!linhas.length) {
          tb.innerHTML = '<tr><td colspan="4" class="adm__vazio">Nenhum acesso ao SAC registrado ainda.</td></tr>';
          return;
        }
        var rotulo = { cadastro: 'Primeiro acesso', pedido: 'Pediu acesso', login: 'Entrou', logout: 'Saiu', chamado: 'Enviou chamado' };
        tb.innerHTML = linhas.map(function (a) {
          var det = a.acao === 'cadastro' ? (a.detalhe === 'supervisor' ? 'supervisor' : 'RCA') : (a.detalhe || '—');
          return '<tr><td class="mono">' + data(a.criado_em) + '</td>' +
                 '<td>' + esc(a.email || '—') + '</td>' +
                 '<td>' + (rotulo[a.acao] || esc(a.acao)) + '</td>' +
                 '<td class="mono">' + esc(det) + '</td></tr>';
        }).join('');
      });
  }

  function irParaSac() {
    var aba = $('[data-aba="sac"]');
    if (aba) aba.click();
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
    if (g('data-sac-liberar'))  { decidirSac(g('data-sac-liberar'), 'liberado'); }
    if (g('data-sac-recusar'))  { decidirSac(g('data-sac-recusar'), 'recusado'); }
    if (g('data-sac-bloquear')) { decidirSac(g('data-sac-bloquear'), 'bloqueado'); }
    if (t.hasAttribute('data-ir-sac')) { irParaSac(); }
  });

  $('[data-novo-usuario]').addEventListener('click', novoUsuario);
  $('[data-novo-sistema]').addEventListener('click', novoSistema);
  $('[data-recarregar-acessos]').addEventListener('click', carregarAcessos);
  $('[data-recarregar-sac]').addEventListener('click', function () {
    carregarSac().catch(function (e) { toast((e && e.message) || 'Não foi possível carregar o SAC.', true); });
    carregarSacAcessos();
  });

  $$('[data-aba]').forEach(function (b) {
    b.addEventListener('click', function () {
      var alvo = b.getAttribute('data-aba');
      $$('[data-aba]').forEach(function (x) { x.classList.toggle('is-on', x === b); });
      $$('[data-painel]').forEach(function (p) {
        p.classList.toggle('is-on', p.getAttribute('data-painel') === alvo);
      });
      if (alvo === 'acessos') carregarAcessos();
      if (alvo === 'sac') { carregarSac().catch(function () {}); carregarSacAcessos(); }
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
      setInterval(function () {
        if (!document.hidden) carregarSac().catch(function () {});
      }, 60000);
      return carregarTudo();
    });
  }).catch(function () { location.href = 'index.html'; });
})();
