/* =========================================================
   PAINEL ADMINISTRATIVO — Lube Distribuidora
   Só abre para perfis com is_admin. As operações que exigem
   privilégio (criar usuário, trocar senha, remover) passam
   pela Edge Function "admin-users", que confere o JWT.

   (2026-11-13) Cada aba tem busca, filtros, ordem pelas colunas e
   "Exportar Excel" (excel.js). Usuários, sistemas e contas do SAC
   filtram na tela (criarListaLocal); os acessos filtram no banco
   (criarListaAcessos). Os cartões do topo levam à aba já filtrada.
   ========================================================= */
(function () {
  'use strict';

  var CFG = window.LUBE_CFG;
  var sb  = window.supabase.createClient(CFG.url, CFG.key);

  var $  = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };

  var eu = null, usuarios = [], sistemas = [], permissoes = [], excecoes = [], icones = [];

  // a marca branca (barra de cima e tela de espera)
  $$('[data-marca-clara]').forEach(function (el) {
    if (window.LUBE_MARCA) el.innerHTML = window.LUBE_MARCA('#FFFFFF');
  });

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
  // texto para busca: minúsculas e sem acento
  function sem(t) {
    return String(t == null ? '' : t).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
  function dia(d) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
  }
  function iniciais(t) {
    return String(t || '?').trim().split(/\s+/).slice(0, 2)
      .map(function (x) { return x.charAt(0); }).join('').toUpperCase();
  }
  // troca as opções de um <select> sem perder o que estava escolhido
  function preencher(sel, primeira, opcoes) {
    if (!sel) return;
    var atual = sel.value;
    sel.innerHTML = '<option value="">' + esc(primeira) + '</option>' + opcoes.map(function (o) {
      return '<option value="' + esc(o[0]) + '">' + esc(o[1]) + '</option>';
    }).join('');
    sel.value = atual;
    if (sel.value !== atual) {                    // a opção escolhida deixou de existir
      sel.value = '';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
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
    $('[data-modal-ok-rotulo]', mOk).textContent = rotulo || 'Salvar';
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
    new Promise(function (segue) { segue(aoSalvar()); }).then(function (ok) {
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
      carregarHoje();
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

  /* ---------------- lista com busca, filtros e ordem (na tela) ----------------
     Usuários, sistemas e contas do SAC já vêm inteiros do banco: a busca, os
     filtros e a ordem rodam no navegador, na hora. A barra (.ferr) está no HTML.
     cfg: ferr, tbody, colspan, nome [plural, singular], vazio, itens(), texto(item),
          seg(item), filtros{nome: fn(item, valor)}, ordens{coluna: fn(item)},
          padrao(a, b), linha(item) */
  function criarListaLocal(cfg) {
    var barra = $(cfg.ferr), tb = $(cfg.tbody);
    var wrap = tb.closest('.adm__tablewrap');
    var info = $('[data-info]', barra.parentNode);
    var campo = $('[data-busca]', barra), limpar = $('[data-limpar]', barra);
    var segs = $$('.seg', barra), sels = $$('select[data-f]', barra), ths = $$('th[data-ordem]', wrap);
    var est = { busca: '', seg: '', f: {}, ordem: '', desc: false };
    var visiveis = [];

    function filtrando() {
      return !!(est.busca || est.seg || Object.keys(est.f).some(function (k) { return est.f[k]; }));
    }

    // busca e caixas de escolha (o "seg" fica de fora: é ele que ganha a contagem)
    function passa(item) {
      if (est.busca) {
        var alvo = sem(cfg.texto(item));
        if (!est.busca.split(/\s+/).every(function (pedaco) { return alvo.indexOf(pedaco) > -1; })) return false;
      }
      for (var k in est.f) {
        if (est.f[k] && cfg.filtros[k] && !cfg.filtros[k](item, est.f[k])) return false;
      }
      return true;
    }

    function pintar() {
      var todos = cfg.itens() || [];
      var base = todos.filter(passa);
      // o número de cada situação já conta a busca e os outros filtros
      segs.forEach(function (b) {
        var v = b.getAttribute('data-v');
        var n = v ? base.filter(function (i) { return cfg.seg(i) === v; }).length : base.length;
        var num = $('b', b);
        if (num) num.textContent = n;
        b.classList.toggle('is-on', v === est.seg);
        b.classList.toggle('tem', n > 0);
      });
      visiveis = est.seg ? base.filter(function (i) { return cfg.seg(i) === est.seg; }) : base.slice();

      if (est.ordem && cfg.ordens[est.ordem]) {
        var valor = cfg.ordens[est.ordem], sinal = est.desc ? -1 : 1;
        visiveis = visiveis.map(function (item, n) { return [valor(item), n, item]; }).sort(function (a, b) {
          var r = (typeof a[0] === 'number' && typeof b[0] === 'number')
            ? a[0] - b[0]
            : String(a[0]).localeCompare(String(b[0]), 'pt-BR', { numeric: true, sensitivity: 'base' });
          return (r * sinal) || (a[1] - b[1]);
        }).map(function (t) { return t[2]; });
      } else if (cfg.padrao) {
        visiveis = visiveis.map(function (item, n) { return [n, item]; }).sort(function (a, b) {
          return cfg.padrao(a[1], b[1]) || (a[0] - b[0]);
        }).map(function (t) { return t[1]; });
      }

      ths.forEach(function (th) {
        var on = th.getAttribute('data-ordem') === est.ordem;
        th.classList.toggle('is-ordem', on);
        th.classList.toggle('is-desc', on && est.desc);
        th.setAttribute('aria-sort', on ? (est.desc ? 'descending' : 'ascending') : 'none');
      });
      sels.forEach(function (sel) { sel.parentNode.classList.toggle('is-usado', !!sel.value); });

      tb.innerHTML = visiveis.length
        ? visiveis.map(cfg.linha).join('')
        : '<tr><td colspan="' + cfg.colspan + '" class="adm__vazio">' +
          (todos.length
            ? 'Nada encontrado com essa busca e esses filtros.' +
              '<button type="button" class="adm__link" data-limpar-aqui>Limpar filtros</button>'
            : cfg.vazio) + '</td></tr>';
      if (info) {
        info.textContent = !todos.length ? ''
          : visiveis.length === todos.length
            ? todos.length + ' ' + cfg.nome[todos.length === 1 ? 1 : 0]
            : 'Mostrando ' + visiveis.length + ' de ' + todos.length + ' ' + cfg.nome[0];
      }
      limpar.hidden = !filtrando();
    }

    // põe os filtros de uma vez (os cartões do topo usam); sem nada, limpa tudo
    function filtrar(o) {
      o = o || {};
      est.busca = sem(o.busca || '').trim();
      est.seg = o.seg || '';
      est.f = {};
      campo.value = o.busca || '';
      sels.forEach(function (sel) {
        var k = sel.getAttribute('data-f');
        sel.value = (o.f && o.f[k]) || '';
        est.f[k] = sel.value;
      });
      pintar();
    }

    campo.addEventListener('input', function () { est.busca = sem(campo.value).trim(); pintar(); });
    campo.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && campo.value) { ev.stopPropagation(); campo.value = ''; est.busca = ''; pintar(); }
    });
    segs.forEach(function (b) {
      b.addEventListener('click', function () { est.seg = b.getAttribute('data-v'); pintar(); });
    });
    sels.forEach(function (sel) {
      sel.addEventListener('change', function () { est.f[sel.getAttribute('data-f')] = sel.value; pintar(); });
    });
    // clicar na coluna: crescente, depois decrescente, depois volta à ordem normal
    ths.forEach(function (th) {
      th.addEventListener('click', function () {
        var k = th.getAttribute('data-ordem');
        if (est.ordem !== k) { est.ordem = k; est.desc = false; }
        else if (!est.desc) { est.desc = true; }
        else { est.ordem = ''; est.desc = false; }
        pintar();
      });
    });
    limpar.addEventListener('click', function () { filtrar(); });
    tb.addEventListener('click', function (ev) {
      if (ev.target.closest && ev.target.closest('[data-limpar-aqui]')) filtrar();
    });

    return {
      pintar: pintar,
      filtrar: filtrar,
      filtrando: filtrando,
      visiveis: function () { return visiveis.slice(); }
    };
  }

  /* ---------------- usuários ---------------- */
  function pendente(u) { return !u.ativo && !u.aprovado_em; }
  function situacaoDe(u) { return u.ativo ? 'ativo' : pendente(u) ? 'pendente' : 'off'; }
  var SIT_USUARIO = {
    ativo: ['Ativo', 'tag--ok'], pendente: ['Aguardando', 'tag--pendente'], off: ['Desativado', 'tag--off']
  };

  // os sistemas que a pessoa enxerga de fato: todos menos as exceções, ou só os marcados
  function sistemasVisiveis(u) {
    if (!u.acesso_total) return sistemasDe(u.id);
    var fora = excecoesDe(u.id);
    return sistemas.filter(function (s) { return fora.indexOf(s.id) < 0; });
  }
  function sistemasRetirados(u) {
    if (!u.acesso_total) return [];
    var fora = excecoesDe(u.id);
    return sistemas.filter(function (s) { return fora.indexOf(s.id) > -1; });
  }
  function nomeDe(s) { return s.nome; }

  var MAX_CHIPS = 6;
  function chipsUsuario(u) {
    if (u.acesso_total) {
      return '<span class="chip chip--todos">Todos os sistemas</span>' +
        sistemasRetirados(u).map(function (s) { return '<span class="chip chip--excluido">exceto ' + esc(s.nome) + '</span>'; }).join('');
    }
    var meus = sistemasDe(u.id);
    if (!meus.length) return '<span class="chip chip--vazio">sem acesso</span>';
    var mostra = meus.length > MAX_CHIPS ? meus.slice(0, MAX_CHIPS - 1) : meus;
    var resto = meus.slice(mostra.length);
    return mostra.map(function (s) { return '<span class="chip">' + esc(s.nome) + '</span>'; }).join('') +
      (resto.length ? '<span class="chip chip--mais" title="' + esc(resto.map(nomeDe).join(', ')) + '">+' + resto.length + '</span>' : '');
  }

  function linhaUsuario(u) {
    var sit = SIT_USUARIO[situacaoDe(u)];
    // foto de perfil (se a pessoa pôs uma): fotos.js lê o data-foto e pinta por cima das iniciais
    return '<tr' + (pendente(u) ? ' class="is-pendente"' : '') + '>' +
      '<td><div class="cel-pessoa"><span class="cel-av"' + (u.foto ? ' data-foto="' + esc(u.foto) + '"' : '') + '>' +
          esc(iniciais(u.nome || u.email)) + '</span>' +
          '<div><span class="cel-nome">' + esc(u.nome || '—') + '</span>' +
          '<span class="cel-email">' + esc(u.email) + '</span></div></div></td>' +
      '<td>' + esc(u.cargo || '—') + '</td>' +
      '<td>' + (u.is_admin ? '<span class="tag tag--admin">Admin</span>'
                           : '<span class="tag tag--user">Usuário</span>') + '</td>' +
      '<td><span class="tag ' + sit[1] + '">' + sit[0] + '</span></td>' +
      '<td><div class="chips">' + chipsUsuario(u) + '</div></td>' +
      '<td class="cel-data" title="' + esc(data(u.criado_em)) + '">' + dia(u.criado_em) + '</td>' +
      '<td><div class="cel-acoes">' +
        (pendente(u) ? '<button class="adm__link adm__link--destaque" data-aprovar="' + u.id + '">Liberar</button>' : '') +
        '<button class="adm__link" data-editar="' + u.id + '">Editar</button>' +
        '<button class="adm__link" data-senha="' + u.id + '">Senha</button>' +
        '<button class="adm__link adm__link--perigo" data-remover="' + u.id + '">Remover</button>' +
      '</div></td>' +
    '</tr>';
  }

  var listaUsuarios = criarListaLocal({
    ferr: '[data-ferr="usuarios"]', tbody: '[data-tbody-usuarios]', colspan: 7,
    nome: ['usuários', 'usuário'], vazio: 'Nenhum usuário ainda.',
    itens: function () { return usuarios; },
    texto: function (u) {
      return [u.nome, u.email, u.cargo, u.is_admin ? 'admin administrador' : '', u.acesso_total ? 'todos os sistemas' : '']
        .concat(sistemasVisiveis(u).map(nomeDe)).join(' ');
    },
    seg: situacaoDe,
    filtros: {
      perfil: function (u, v) { return v === 'admin' ? !!u.is_admin : !u.is_admin; },
      sistema: function (u, v) { return sistemasVisiveis(u).some(function (s) { return String(s.id) === v; }); }
    },
    ordens: {
      nome: function (u) { return sem(u.nome || u.email); },
      cargo: function (u) { return sem(u.cargo) || '￿'; },            // sem cargo vai para o fim
      perfil: function (u) { return u.is_admin ? 0 : 1; },
      situacao: function (u) { return { pendente: 0, ativo: 1, off: 2 }[situacaoDe(u)]; },
      cadastro: function (u) { return u.criado_em ? new Date(u.criado_em).getTime() : 0; }
    },
    // quem pediu primeiro acesso aparece no topo
    padrao: function (a, b) { return (pendente(b) ? 1 : 0) - (pendente(a) ? 1 : 0); },
    linha: linhaUsuario
  });

  function pintarUsuarios() {
    var ativos = usuarios.filter(function (u) { return u.ativo; }).length;
    var pend = usuarios.filter(pendente);
    $('[data-resumo-usuarios]').textContent = usuarios.length + ' cadastrados · ' + ativos + ' ativos' +
      (pend.length ? ' · ' + pend.length + ' aguardando liberação' : '');
    preencher($('[data-ferr="usuarios"] [data-f="sistema"]'), 'Todos',
      sistemas.map(function (s) { return [s.id, s.nome + (s.ativo ? '' : ' (inativo)')]; }));
    listaUsuarios.pintar();
    pintarResumo();
  }

  function planilhaUsuarios(lista) {
    return {
      nome: 'Usuários',
      colunas: [
        { titulo: 'Nome', largura: 30 }, { titulo: 'E-mail', largura: 34 }, { titulo: 'Cargo', largura: 26 },
        { titulo: 'Perfil', largura: 12 }, { titulo: 'Situação', largura: 14 }, { titulo: 'Acesso', largura: 22 },
        { titulo: 'Qtd. de sistemas', largura: 17, tipo: 'numero' },
        { titulo: 'Sistemas liberados', largura: 60, tipo: 'longo' }, { titulo: 'Exceto', largura: 30, tipo: 'longo' },
        { titulo: 'Cadastro', largura: 18, tipo: 'data' }, { titulo: 'Liberado em', largura: 18, tipo: 'data' }
      ],
      linhas: lista.map(function (u) {
        var vis = sistemasVisiveis(u);
        return [
          u.nome || '', u.email || '', u.cargo || '', u.is_admin ? 'Admin' : 'Usuário', SIT_USUARIO[situacaoDe(u)][0],
          u.acesso_total ? 'Todos os sistemas' : (vis.length ? 'Sistemas escolhidos' : 'Sem acesso'),
          vis.length, vis.map(nomeDe).join(', '), sistemasRetirados(u).map(nomeDe).join(', '),
          u.criado_em || null, u.aprovado_em || null
        ];
      })
    };
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
          // a foto de perfil sai junto (se falhar, sobra só um arquivo sem uso)
          if (u.foto) sb.storage.from('avatares').remove([u.foto]).then(function () {}, function () {});
          toast('Usuário removido.');
          return carregarTudo();
        });
      }, 'Remover');
  }

  /* ---------------- sistemas ---------------- */
  var acessoPorSistema = {};            // id do sistema -> quantos usuários ativos enxergam
  function contarAcessos() {
    acessoPorSistema = {};
    usuarios.forEach(function (u) {
      if (!u.ativo) return;
      sistemasVisiveis(u).forEach(function (s) { acessoPorSistema[s.id] = (acessoPorSistema[s.id] || 0) + 1; });
    });
  }

  function linhaSistema(s) {
    var ic = icone(s.badge);
    return '<tr>' +
      '<td><div class="cel-sis">' +
          (ic && window.LUBE_ICONE ? '<span class="cel-ico">' + window.LUBE_ICONE.html(ic) + '</span>' : '') +
          '<div><span class="cel-nome">' + esc(s.nome) + '</span>' +
          '<span class="cel-email" title="' + esc(s.descricao) + '">' + esc(s.descricao) + '</span></div></div></td>' +
      '<td>' + esc(s.categoria || '—') + '</td>' +
      '<td>' + (s.abre_no_painel ? '<span class="tag tag--painel" title="Abre dentro do painel">No painel</span>'
                                 : '<span class="tag tag--off" title="Abre em outra aba do navegador">Nova aba</span>') + '</td>' +
      '<td class="cel-num">' + (acessoPorSistema[s.id] || 0) + '</td>' +
      '<td class="cel-num">' + s.ordem + '</td>' +
      '<td>' + (s.ativo ? '<span class="tag tag--ok">Ativo</span>'
                        : '<span class="tag tag--off">Inativo</span>') + '</td>' +
      '<td><div class="cel-acoes">' +
        '<a class="adm__link" href="' + esc(s.url) + '" target="_blank" rel="noopener" title="' + esc(s.url) + '">Abrir</a>' +
        '<button class="adm__link" data-edit-sis="' + s.id + '">Editar</button>' +
        '<button class="adm__link adm__link--perigo" data-del-sis="' + s.id + '">Excluir</button>' +
      '</div></td>' +
    '</tr>';
  }

  var listaSistemas = criarListaLocal({
    ferr: '[data-ferr="sistemas"]', tbody: '[data-tbody-sistemas]', colspan: 7,
    nome: ['sistemas', 'sistema'], vazio: 'Nenhum sistema cadastrado.',
    itens: function () { return sistemas; },
    texto: function (s) { return [s.nome, s.categoria, s.descricao, s.url, s.slug].join(' '); },
    seg: function (s) { return s.ativo ? 'ativo' : 'off'; },
    filtros: {
      area: function (s, v) { return (s.categoria || '') === v; },
      onde: function (s, v) { return v === 'painel' ? !!s.abre_no_painel : !s.abre_no_painel; }
    },
    ordens: {
      nome: function (s) { return sem(s.nome); },
      area: function (s) { return sem(s.categoria) || '￿'; },
      onde: function (s) { return s.abre_no_painel ? 0 : 1; },
      usuarios: function (s) { return acessoPorSistema[s.id] || 0; },
      ordem: function (s) { return Number(s.ordem) || 0; },
      situacao: function (s) { return s.ativo ? 0 : 1; }
    },
    linha: linhaSistema
  });

  function pintarSistemas() {
    contarAcessos();
    var ativos = sistemas.filter(function (s) { return s.ativo; });
    var noPainel = ativos.filter(function (s) { return s.abre_no_painel; }).length;
    $('[data-resumo-sistemas]').textContent = sistemas.length
      ? sistemas.length + ' cadastrados · ' + ativos.length + ' ativos · ' + noPainel + (noPainel === 1 ? ' abre' : ' abrem') + ' dentro do painel'
      : 'Plataformas que podem ser liberadas aos usuários.';
    var areas = {};
    sistemas.forEach(function (s) { if (s.categoria) areas[s.categoria] = 1; });
    preencher($('[data-ferr="sistemas"] [data-f="area"]'), 'Todas',
      Object.keys(areas).sort(function (a, b) { return a.localeCompare(b, 'pt-BR'); }).map(function (a) { return [a, a]; }));
    listaSistemas.pintar();
    pintarResumo();
  }

  function planilhaSistemas(lista) {
    return {
      nome: 'Sistemas',
      colunas: [
        { titulo: 'Sistema', largura: 30 }, { titulo: 'Área', largura: 20 }, { titulo: 'Descrição', largura: 50, tipo: 'longo' },
        { titulo: 'Endereço', largura: 44 }, { titulo: 'Onde abre', largura: 18 }, { titulo: 'Situação', largura: 12 },
        { titulo: 'Ordem', largura: 9, tipo: 'numero' }, { titulo: 'Usuários com acesso', largura: 20, tipo: 'numero' }
      ],
      linhas: lista.map(function (s) {
        return [s.nome || '', s.categoria || '', s.descricao || '', s.url || '',
          s.abre_no_painel ? 'Dentro do painel' : 'Nova aba', s.ativo ? 'Ativo' : 'Inativo',
          Number(s.ordem) || 0, acessoPorSistema[s.id] || 0];
      })
    };
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
      ' /><span>Sistema ativo</span></label>' +
      '<label class="campo-inline"><input type="checkbox" name="abre_no_painel"' + (s.abre_no_painel ? ' checked' : '') +
      ' /><span>Abrir dentro do painel (o sistema precisa aceitar ser mostrado no portal; ' +
      'desmarcado, abre em nova aba)</span></label>';
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
      ativo: $('input[name="ativo"]', mForm).checked,
      abre_no_painel: $('input[name="abre_no_painel"]', mForm).checked
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

  /* ---------------- acessos (busca no banco) ----------------
     Barra de filtros + tabela paginada, usada nos acessos do painel e do SAC.
     O filtro roda no banco (não só nos 200 mais recentes): pessoas (várias, por
     parte do e-mail), período, ação e sistema. "Carregar mais" busca os próximos
     200; o Excel busca tudo o que bate com o filtro (até 20 mil linhas). */
  var POR_PAGINA = 200, PAGINA_EXCEL = 1000, LIMITE_EXCEL = 20000;

  function diaISO(d) {
    var p2 = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
  }
  // 'aaaa-mm-dd' -> a meia-noite daqui (somar: dias a mais)
  function meiaNoite(texto, somar) {
    var p = String(texto).split('-');
    return new Date(+p[0], +p[1] - 1, +p[2] + (somar || 0));
  }
  function haDias(n) { var d = new Date(); d.setDate(d.getDate() - n); return diaISO(d); }

  function criarListaAcessos(cfg) {
    var tb = $(cfg.tbody);
    var wrap = tb.closest('.adm__tablewrap');
    var est = { termos: [], acao: '', sistema: '', de: '', ate: '', linhas: [], total: 0, req: 0 };

    var opcoesAcao = '<option value="">Todas</option>' + cfg.acoes.map(function (a) {
      return '<option value="' + a[0] + '">' + a[1] + '</option>';
    }).join('');

    wrap.insertAdjacentHTML('beforebegin',
      '<div class="ferr">' +
        '<label class="busca">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>' +
          '<input type="search" list="dl-' + cfg.chave + '" autocomplete="off" spellcheck="false" data-f-usuario ' +
            'aria-label="Buscar ' + cfg.rotuloPessoa.toLowerCase() + ' pelo e-mail" ' +
            'placeholder="Buscar ' + cfg.rotuloPessoa.toLowerCase() + ': digite parte do e-mail e tecle Enter (pode somar vários)" />' +
          '<datalist id="dl-' + cfg.chave + '" data-f-lista></datalist><kbd>/</kbd></label>' +
        '<div class="segs" data-f-periodo role="group" aria-label="Período">' +
          '<button class="seg is-on" type="button" data-v="">Tudo</button>' +
          '<button class="seg" type="button" data-v="hoje">Hoje</button>' +
          '<button class="seg" type="button" data-v="7">7 dias</button>' +
          '<button class="seg" type="button" data-v="30">30 dias</button>' +
        '</div>' +
        '<label class="sel"><span>De</span><input type="date" data-f-de /></label>' +
        '<label class="sel"><span>Até</span><input type="date" data-f-ate /></label>' +
        '<label class="sel"><span>Ação</span><select data-f-acao>' + opcoesAcao + '</select></label>' +
        (cfg.sistemas ? '<label class="sel"><span>Sistema</span><select data-f-sistema></select></label>' : '') +
        '<button type="button" class="adm__link" data-f-limpar hidden>Limpar filtros</button>' +
        '<div class="filtro__chips" data-f-chips></div>' +
      '</div>');
    wrap.insertAdjacentHTML('afterend',
      '<div class="filtro__rodape"><span class="mono" data-f-info></span>' +
      '<button type="button" class="adm__link" data-f-mais hidden>Carregar mais</button></div>');

    var barra = wrap.previousElementSibling;
    var rodape = wrap.nextElementSibling;
    var campo = $('[data-f-usuario]', barra), selAcao = $('[data-f-acao]', barra),
        selSis = $('[data-f-sistema]', barra), chips = $('[data-f-chips]', barra),
        limpar = $('[data-f-limpar]', barra), info = $('[data-f-info]', rodape),
        mais = $('[data-f-mais]', rodape), campoDe = $('[data-f-de]', barra), campoAte = $('[data-f-ate]', barra),
        periodos = $$('[data-f-periodo] .seg', barra);

    function filtrando() { return !!(est.termos.length || est.acao || est.sistema || est.de || est.ate); }

    function normalizar(t) { return String(t || '').toLowerCase().replace(/[^a-z0-9._@+\-]/g, ''); }

    // qual botão de período bate com as datas escolhidas (nenhum, se foram digitadas à mão)
    function periodoAtual() {
      if (!est.de && !est.ate) return '';
      var hoje = diaISO(new Date());
      if (est.ate !== hoje) return null;
      if (est.de === hoje) return 'hoje';
      if (est.de === haDias(6)) return '7';
      if (est.de === haDias(29)) return '30';
      return null;
    }
    function porPeriodo(v) {
      var hoje = diaISO(new Date());
      est.de = v === 'hoje' ? hoje : v === '7' ? haDias(6) : v === '30' ? haDias(29) : '';
      est.ate = v ? hoje : '';
    }

    function pintarBarra() {
      chips.innerHTML = est.termos.map(function (t) {
        return '<button type="button" class="filtro__chip" data-f-rem="' + esc(t) + '" title="Tirar do filtro">' +
               esc(t) + ' <b>×</b></button>';
      }).join('');
      var atual = periodoAtual();
      periodos.forEach(function (b) { b.classList.toggle('is-on', b.getAttribute('data-v') === atual); });
      campoDe.value = est.de; campoAte.value = est.ate;
      selAcao.value = est.acao;
      if (selSis) selSis.value = est.sistema;
      [campoDe, campoAte, selAcao, selSis].forEach(function (c) {
        if (c) c.parentNode.classList.toggle('is-usado', !!c.value);
      });
      limpar.hidden = !filtrando();
    }

    // sugestões (e-mails conhecidos) e lista de sistemas — atualizadas a cada abertura da aba
    function atualizarOpcoes() {
      var vistos = {};
      $('[data-f-lista]', barra).innerHTML = cfg.sugestoes().filter(function (e) {
        if (!e || vistos[e]) return false; vistos[e] = true; return true;
      }).sort().map(function (e) { return '<option value="' + esc(e) + '"></option>'; }).join('');
      if (selSis) {
        selSis.innerHTML = '<option value="">Todos</option>' + sistemas.map(function (s) {
          return '<option value="' + s.id + '">' + esc(s.nome) + '</option>';
        }).join('');
        selSis.value = est.sistema;
      }
    }

    function pintarTabela() {
      if (!est.linhas.length) {
        tb.innerHTML = '<tr><td colspan="' + cfg.colspan + '" class="adm__vazio">' +
          (filtrando() ? 'Nenhum registro com esses filtros.' : cfg.vazio) + '</td></tr>';
      } else {
        tb.innerHTML = est.linhas.map(cfg.linha).join('');
      }
      info.textContent = est.linhas.length
        ? 'Mostrando ' + est.linhas.length + ' de ' + est.total + (est.total === 1 ? ' registro' : ' registros')
        : '';
      mais.hidden = est.linhas.length >= est.total;
    }

    // a consulta com os filtros da barra (a tela e o Excel usam a mesma)
    function consulta(contar) {
      var q = sb.from(cfg.tabela).select(cfg.colunas, contar ? { count: 'exact' } : undefined);
      if (est.termos.length) {
        q = q.or(est.termos.map(function (t) { return 'email.ilike.*' + t + '*'; }).join(','));
      }
      if (est.acao) q = q.eq('acao', est.acao);
      if (cfg.sistemas && est.sistema) q = q.eq('sistema_id', est.sistema);
      if (est.de) q = q.gte('criado_em', meiaNoite(est.de).toISOString());
      if (est.ate) q = q.lt('criado_em', meiaNoite(est.ate, 1).toISOString());
      return q.order('criado_em', { ascending: false }).order('id', { ascending: false });
    }

    function buscar(anexar) {
      var minha = ++est.req;
      if (!anexar) tb.innerHTML = '<tr><td colspan="' + cfg.colspan + '" class="adm__vazio">Carregando…</td></tr>';
      var ini = anexar ? est.linhas.length : 0;
      return consulta(true).range(ini, ini + POR_PAGINA - 1).then(function (r) {
        if (minha !== est.req) return;                       // chegou depois de outro filtro: ignora
        if (r.error) {
          tb.innerHTML = '<tr><td colspan="' + cfg.colspan + '" class="adm__vazio">Não foi possível carregar: ' +
            esc(r.error.message) + '</td></tr>';
          return;
        }
        est.linhas = anexar ? est.linhas.concat(r.data || []) : (r.data || []);
        est.total = r.count == null ? est.linhas.length : r.count;
        pintarTabela();
      });
    }

    // tudo o que bate com o filtro, página por página (para o Excel)
    function todas() {
      var saida = [];
      function passo() {
        return consulta(false).range(saida.length, saida.length + PAGINA_EXCEL - 1).then(function (r) {
          if (r.error) throw new Error(r.error.message);
          var veio = r.data || [];
          saida = saida.concat(veio);
          if (veio.length < PAGINA_EXCEL || saida.length >= LIMITE_EXCEL) return saida.slice(0, LIMITE_EXCEL);
          return passo();
        });
      }
      return passo();
    }

    function filtrar() { pintarBarra(); return buscar(false); }

    function adicionar(texto) {
      var novos = String(texto || '').split(/[\s,;]+/).map(normalizar).filter(Boolean);
      var mudou = false;
      novos.forEach(function (t) { if (est.termos.indexOf(t) < 0) { est.termos.push(t); mudou = true; } });
      campo.value = '';
      if (mudou) filtrar();
    }

    campo.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); adicionar(campo.value); }
    });
    // escolher uma sugestão da lista adiciona na hora (digitar só preenche o campo)
    campo.addEventListener('input', function (ev) {
      if (ev.inputType && ev.inputType !== 'insertReplacementText') return;
      if (campo.value.indexOf('@') > 0) adicionar(campo.value);
    });
    campo.addEventListener('change', function () { if (campo.value.trim()) adicionar(campo.value); });
    selAcao.addEventListener('change', function () { est.acao = selAcao.value; filtrar(); });
    if (selSis) selSis.addEventListener('change', function () { est.sistema = selSis.value; filtrar(); });
    periodos.forEach(function (b) {
      b.addEventListener('click', function () { porPeriodo(b.getAttribute('data-v')); filtrar(); });
    });
    [campoDe, campoAte].forEach(function (c) {
      c.addEventListener('change', function () {
        est.de = campoDe.value; est.ate = campoAte.value;
        if (est.de && est.ate && est.de > est.ate) {          // datas trocadas: inverte
          var t = est.de; est.de = est.ate; est.ate = t;
        }
        filtrar();
      });
    });
    chips.addEventListener('click', function (ev) {
      var b = ev.target.closest ? ev.target.closest('[data-f-rem]') : null;
      if (!b) return;
      est.termos = est.termos.filter(function (t) { return t !== b.getAttribute('data-f-rem'); });
      filtrar();
    });
    limpar.addEventListener('click', function () {
      est.termos = []; est.acao = ''; est.sistema = ''; est.de = ''; est.ate = '';
      campo.value = '';
      filtrar();
    });
    mais.addEventListener('click', function () { buscar(true); });

    return {
      carregar: function () { atualizarOpcoes(); pintarBarra(); return buscar(false); },
      opcoes: atualizarOpcoes,
      todas: todas,
      filtrando: filtrando,
      // põe os filtros de uma vez, sem buscar (quem chama abre a aba, e ela busca)
      definir: function (o) {
        o = o || {};
        est.termos = []; est.sistema = '';
        est.acao = o.acao || '';
        porPeriodo(o.periodo || '');
        campo.value = '';
        pintarBarra();
      }
    };
  }

  var ACOES_PAINEL = { login: ['Entrou', 'tag--ok'], logout: ['Saiu', 'tag--off'], abriu_sistema: ['Abriu sistema', 'tag--user'] };
  function nomeDoSistema(id) {
    var nome = '';
    sistemas.forEach(function (x) { if (x.id === id) nome = x.nome; });
    return nome;
  }
  function tagAcao(mapa, acao) {
    var a = mapa[acao];
    return a ? '<span class="tag ' + a[1] + '">' + a[0] + '</span>' : esc(acao);
  }

  var listaAcessos = criarListaAcessos({
    chave: 'painel', tbody: '[data-tbody-acessos]', tabela: 'acessos',
    colunas: 'id,email,acao,criado_em,sistema_id', colspan: 4, rotuloPessoa: 'Usuário', sistemas: true,
    acoes: Object.keys(ACOES_PAINEL).map(function (k) { return [k, ACOES_PAINEL[k][0]]; }),
    sugestoes: function () { return usuarios.map(function (u) { return u.email; }); },
    vazio: 'Nenhum acesso registrado ainda.',
    linha: function (a) {
      return '<tr><td class="cel-data">' + data(a.criado_em) + '</td>' +
             '<td>' + esc(a.email || '—') + '</td>' +
             '<td>' + tagAcao(ACOES_PAINEL, a.acao) + '</td>' +
             '<td>' + esc(nomeDoSistema(a.sistema_id) || '—') + '</td></tr>';
    }
  });
  function carregarAcessos() { return listaAcessos.carregar(); }

  function planilhaAcessos(linhas) {
    var nomes = {};
    usuarios.forEach(function (u) { nomes[u.email] = u.nome || ''; });
    return {
      nome: 'Acessos do painel',
      colunas: [
        { titulo: 'Quando', largura: 18, tipo: 'data' }, { titulo: 'E-mail', largura: 34 }, { titulo: 'Nome', largura: 30 },
        { titulo: 'Ação', largura: 16 }, { titulo: 'Sistema', largura: 30 }
      ],
      linhas: linhas.map(function (a) {
        return [a.criado_em || null, a.email || '', nomes[a.email] || '',
          (ACOES_PAINEL[a.acao] || [a.acao])[0], nomeDoSistema(a.sistema_id)];
      })
    };
  }

  // quantas entradas hoje (cartão do topo)
  var hoje = { n: null, pessoas: 0 };
  function carregarHoje() {
    return sb.from('acessos').select('email', { count: 'exact' }).eq('acao', 'login')
      .gte('criado_em', meiaNoite(diaISO(new Date())).toISOString()).range(0, 999)
      .then(function (r) {
        if (r.error) return;
        var vistos = {};
        (r.data || []).forEach(function (a) { if (a.email) vistos[a.email] = 1; });
        hoje.n = r.count == null ? (r.data || []).length : r.count;
        hoje.pessoas = Object.keys(vistos).length;
        pintarResumo();
      }, function () {});
  }

  /* ---------------- cartões de resumo e números das abas ---------------- */
  function pintarResumo() {
    var por = function (sel, v) { var e = $(sel); if (e) e.textContent = v; };
    var alerta = function (qual, liga) { var e = $('[data-kpi="' + qual + '"]'); if (e) e.classList.toggle('tem-alerta', !!liga); };
    var ativos = usuarios.filter(function (u) { return u.ativo; }).length;
    var pend = usuarios.filter(pendente).length;
    var sisAtivos = sistemas.filter(function (s) { return s.ativo; });
    var noPainel = sisAtivos.filter(function (s) { return s.abre_no_painel; }).length;
    var contasSac = sacUsuarios || [];
    var pendSac = contasSac.filter(function (u) { return u.situacao === 'pendente'; }).length;

    por('[data-kpi-ativos]', ativos);
    por('[data-kpi-ativos-sub]', 'de ' + usuarios.length + (usuarios.length === 1 ? ' cadastrado' : ' cadastrados'));
    por('[data-kpi-pendentes]', pend);
    alerta('pendentes', pend);
    por('[data-kpi-sistemas]', sisAtivos.length);
    por('[data-kpi-sistemas-sub]', noPainel + (noPainel === 1 ? ' abre' : ' abrem') + ' dentro do painel');
    por('[data-kpi-hoje]', hoje.n == null ? '—' : hoje.n);
    por('[data-kpi-hoje-sub]', hoje.n == null ? ' ' : hoje.pessoas + (hoje.pessoas === 1 ? ' pessoa diferente' : ' pessoas diferentes'));
    por('[data-kpi-sac]', pendSac);
    por('[data-kpi-sac-sub]', contasSac.length + (contasSac.length === 1 ? ' conta no SAC' : ' contas no SAC'));
    alerta('sac', pendSac);
    por('[data-n-usuarios]', usuarios.length || '');
    por('[data-n-sistemas]', sistemas.length || '');
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
      listaSacAcessos.opcoes();                 // sugestões do filtro de acessos do SAC
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

  function linhaSac(u) {
    var s = SAC_SITUACAO[u.situacao] || [u.situacao, 'tag--off'];
    var acoes = u.situacao === 'pendente'
      ? '<button class="adm__link adm__link--destaque" data-sac-liberar="' + u.id + '">Liberar</button>' +
        '<button class="adm__link adm__link--perigo" data-sac-recusar="' + u.id + '">Recusar</button>'
      : u.situacao === 'liberado'
        ? '<button class="adm__link adm__link--perigo" data-sac-bloquear="' + u.id + '">Bloquear</button>'
        : '<button class="adm__link" data-sac-liberar="' + u.id + '">Liberar</button>';
    acoes += '<button class="adm__link" data-senha="' + u.id + '">Senha</button>' +
             '<button class="adm__link adm__link--perigo" data-remover="' + u.id + '">Remover</button>';
    return '<tr' + (u.situacao === 'pendente' ? ' class="is-pendente"' : '') + '>' +
      '<td><div class="cel-pessoa"><span class="cel-av">' + esc(iniciais(u.nome || u.email)) + '</span>' +
          '<div><span class="cel-nome">' + esc(u.nome || '—') + '</span><span class="cel-email">' + esc(u.email) + '</span></div></div></td>' +
      '<td><span class="tag ' + (u.tipo === 'supervisor' ? 'tag--admin' : 'tag--user') + '">' + esc(tipoSac(u)) + '</span></td>' +
      '<td><span class="tag ' + s[1] + '">' + s[0] + '</span></td>' +
      '<td class="cel-data" title="' + esc(data(u.criado_em)) + '">' + dia(u.criado_em) + '</td>' +
      '<td class="cel-data" title="' + esc(data(u.decidido_em)) + '">' + dia(u.decidido_em) + '</td>' +
      '<td><div class="cel-acoes">' + acoes + '</div></td>' +
    '</tr>';
  }

  var listaSac = criarListaLocal({
    ferr: '[data-ferr="sac"]', tbody: '[data-tbody-sac]', colspan: 6,
    nome: ['contas', 'conta'],
    vazio: 'Nenhuma conta ainda. O primeiro acesso de um RCA ou supervisor aparece aqui.',
    itens: function () { return sacUsuarios; },
    texto: function (u) { return [u.nome, u.email, tipoSac(u), u.codusur].join(' '); },
    seg: function (u) { return u.situacao; },
    filtros: {
      tipo: function (u, v) { return (u.tipo === 'supervisor' ? 'supervisor' : 'rca') === v; }
    },
    ordens: {
      nome: function (u) { return sem(u.nome || u.email); },
      tipo: function (u) { return u.tipo === 'supervisor' ? 'supervisor' : 'rca ' + (u.codusur || ''); },
      situacao: function (u) { return { pendente: 0, liberado: 1, bloqueado: 2, recusado: 3 }[u.situacao]; },
      cadastro: function (u) { return u.criado_em ? new Date(u.criado_em).getTime() : 0; },
      decidido: function (u) { return u.decidido_em ? new Date(u.decidido_em).getTime() : 0; }
    },
    // cadastro novo (esperando liberação) aparece no topo
    padrao: function (a, b) { return (b.situacao === 'pendente' ? 1 : 0) - (a.situacao === 'pendente' ? 1 : 0); },
    linha: linhaSac
  });

  function pintarSac() {
    var lib = sacUsuarios.filter(function (u) { return u.situacao === 'liberado'; }).length;
    var pend = sacPendentes().length;
    $('[data-resumo-sac]').textContent = sacUsuarios.length + (sacUsuarios.length === 1 ? ' conta' : ' contas') +
      ' · ' + lib + ' liberada' + (lib === 1 ? '' : 's') + (pend ? ' · ' + pend + ' aguardando liberação' : '');
    listaSac.pintar();
    pintarResumo();
  }

  function planilhaSac(lista) {
    return {
      nome: 'SAC - contas',
      colunas: [
        { titulo: 'Nome', largura: 30 }, { titulo: 'E-mail', largura: 34 }, { titulo: 'Tipo', largura: 14 },
        { titulo: 'Código do RCA', largura: 15, tipo: 'numero' }, { titulo: 'Situação', largura: 14 },
        { titulo: 'Cadastro', largura: 18, tipo: 'data' }, { titulo: 'Decidido em', largura: 18, tipo: 'data' }
      ],
      linhas: lista.map(function (u) {
        return [u.nome || '', u.email || '', u.tipo === 'supervisor' ? 'Supervisor' : 'RCA',
          u.codusur == null ? null : Number(u.codusur), (SAC_SITUACAO[u.situacao] || [u.situacao])[0],
          u.criado_em || null, u.decidido_em || null];
      })
    };
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

  var SAC_ACOES = {
    cadastro: ['Primeiro acesso', 'tag--pendente'], pedido: ['Pediu acesso', 'tag--pendente'],
    login: ['Entrou', 'tag--ok'], logout: ['Saiu', 'tag--off'], chamado: ['Enviou chamado', 'tag--user']
  };
  function detalheSac(a) {
    return a.acao === 'cadastro' ? (a.detalhe === 'supervisor' ? 'supervisor' : 'RCA') : (a.detalhe || '');
  }
  var listaSacAcessos = criarListaAcessos({
    chave: 'sac', tbody: '[data-tbody-sac-acessos]', tabela: 'sac_acessos',
    colunas: 'id,email,acao,detalhe,criado_em', colspan: 4, rotuloPessoa: 'Pessoa', sistemas: false,
    acoes: Object.keys(SAC_ACOES).map(function (k) { return [k, SAC_ACOES[k][0]]; }),
    sugestoes: function () { return sacUsuarios.map(function (u) { return u.email; }); },
    vazio: 'Nenhum acesso ao SAC registrado ainda.',
    linha: function (a) {
      return '<tr><td class="cel-data">' + data(a.criado_em) + '</td>' +
             '<td>' + esc(a.email || '—') + '</td>' +
             '<td>' + tagAcao(SAC_ACOES, a.acao) + '</td>' +
             '<td>' + esc(detalheSac(a) || '—') + '</td></tr>';
    }
  });
  function carregarSacAcessos() { return listaSacAcessos.carregar(); }

  function planilhaSacAcessos(linhas) {
    var nomes = {};
    sacUsuarios.forEach(function (u) { nomes[u.email] = u.nome || ''; });
    return {
      nome: 'SAC - acessos',
      colunas: [
        { titulo: 'Quando', largura: 18, tipo: 'data' }, { titulo: 'E-mail', largura: 34 }, { titulo: 'Nome', largura: 30 },
        { titulo: 'Ação', largura: 18 }, { titulo: 'Detalhe', largura: 40 }
      ],
      linhas: linhas.map(function (a) {
        return [a.criado_em || null, a.email || '', nomes[a.email] || '',
          (SAC_ACOES[a.acao] || [a.acao])[0], detalheSac(a)];
      })
    };
  }

  /* ---------------- abas, sub-abas do SAC e cartões ---------------- */
  function abrirAba(alvo, semEndereco) {
    var botao = $('[data-aba="' + alvo + '"]');
    if (!botao) return;
    $$('[data-aba]').forEach(function (x) {
      x.classList.toggle('is-on', x === botao);
      x.setAttribute('aria-selected', x === botao ? 'true' : 'false');
    });
    $$('[data-painel]').forEach(function (painel) {
      painel.classList.toggle('is-on', painel.getAttribute('data-painel') === alvo);
    });
    if (alvo === 'acessos') carregarAcessos();
    if (alvo === 'sac') { carregarSac().catch(function () {}); carregarSacAcessos(); }
    // a aba fica no endereço: recarregar a página volta para ela
    if (!semEndereco && window.history && history.replaceState) history.replaceState(null, '', '#' + alvo);
  }

  function abrirSubaba(qual) {
    $$('[data-subaba]').forEach(function (b) {
      var on = b.getAttribute('data-subaba') === qual;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    $$('[data-subpainel]').forEach(function (x) {
      x.classList.toggle('is-on', x.getAttribute('data-subpainel') === qual);
    });
  }
  function subabaAtual() {
    var b = $('.subaba.is-on');
    return b ? b.getAttribute('data-subaba') : 'contas';
  }

  function irParaSac() {
    abrirAba('sac');
    abrirSubaba('contas');
    listaSac.filtrar({ seg: sacPendentes().length ? 'pendente' : '' });
  }

  // cada cartão do topo abre a aba já com o filtro certo
  var CARTOES = {
    ativos:    function () { abrirAba('usuarios'); listaUsuarios.filtrar({ seg: 'ativo' }); },
    pendentes: function () { abrirAba('usuarios'); listaUsuarios.filtrar({ seg: 'pendente' }); },
    sistemas:  function () { abrirAba('sistemas'); listaSistemas.filtrar({ seg: 'ativo' }); },
    hoje:      function () { listaAcessos.definir({ periodo: 'hoje', acao: 'login' }); abrirAba('acessos'); },
    sac:       function () { abrirAba('sac'); abrirSubaba('contas'); listaSac.filtrar({ seg: 'pendente' }); }
  };

  /* ---------------- Excel ---------------- */
  function avisarExcel(n, nome, comFiltro, extra) {
    toast('Excel baixado: ' + n + ' ' + nome[n === 1 ? 1 : 0] +
      (comFiltro ? ' (com os filtros da tela)' : '') + '.' + (extra || ''));
  }

  // listas que já estão na tela
  function exportarDaTela(base, lista, planilha, nome) {
    var itens = lista.visiveis();
    if (!itens.length) { toast('Nada para exportar com essa busca e esses filtros.', true); return; }
    window.LubeExcel.baixar(base, [planilha(itens)]);
    avisarExcel(itens.length, nome, lista.filtrando());
  }

  // acessos: busca no banco tudo o que bate com o filtro
  function exportarDoBanco(base, lista, planilha, botao) {
    botao.disabled = true;
    botao.classList.add('is-indo');
    return lista.todas().then(function (linhas) {
      if (!linhas.length) { toast('Nada para exportar com esses filtros.', true); return; }
      window.LubeExcel.baixar(base, [planilha(linhas)]);
      avisarExcel(linhas.length, ['registros', 'registro'], lista.filtrando(),
        linhas.length >= LIMITE_EXCEL ? ' São os ' + LIMITE_EXCEL + ' mais recentes: filtre por período para pegar o resto.' : '');
    }).catch(function (e) {
      toast('Não foi possível gerar o Excel: ' + ((e && e.message) || e), true);
    }).then(function () {
      botao.disabled = false;
      botao.classList.remove('is-indo');
    });
  }

  function exportar(qual, botao) {
    if (!window.LubeExcel) { toast('O Excel não carregou nesta página. Atualize (Ctrl+F5) e tente de novo.', true); return; }
    if (qual === 'usuarios') exportarDaTela('usuarios', listaUsuarios, planilhaUsuarios, ['usuários', 'usuário']);
    if (qual === 'sistemas') exportarDaTela('sistemas', listaSistemas, planilhaSistemas, ['sistemas', 'sistema']);
    if (qual === 'acessos')  exportarDoBanco('acessos-do-painel', listaAcessos, planilhaAcessos, botao);
    if (qual === 'sac') {
      if (subabaAtual() === 'acessos') exportarDoBanco('sac-acessos', listaSacAcessos, planilhaSacAcessos, botao);
      else exportarDaTela('sac-contas', listaSac, planilhaSac, ['contas', 'conta']);
    }
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
    if (g('data-exportar')) { exportar(g('data-exportar'), t); }
    if (g('data-kpi') && CARTOES[g('data-kpi')]) { CARTOES[g('data-kpi')](); }
    if (g('data-subaba')) { abrirSubaba(g('data-subaba')); }
  });

  // "/" leva o cursor para a busca da aba aberta
  document.addEventListener('keydown', function (ev) {
    if (ev.key !== '/' || ev.ctrlKey || ev.metaKey || ev.altKey || !modal.hidden) return;
    var onde = document.activeElement;
    if (onde && /^(INPUT|TEXTAREA|SELECT)$/.test(onde.tagName)) return;
    var busca = $$('.adm__painel.is-on .busca input').filter(function (i) { return i.offsetParent !== null; })[0];
    if (busca) { ev.preventDefault(); busca.focus(); busca.select(); }
  });

  $('[data-novo-usuario]').addEventListener('click', novoUsuario);
  $('[data-novo-sistema]').addEventListener('click', novoSistema);
  $('[data-recarregar-acessos]').addEventListener('click', function () { carregarAcessos(); carregarHoje(); });
  $('[data-recarregar-sac]').addEventListener('click', function () {
    carregarSac().catch(function (e) { toast((e && e.message) || 'Não foi possível carregar o SAC.', true); });
    carregarSacAcessos();
  });

  $$('[data-aba]').forEach(function (b) {
    b.addEventListener('click', function () { abrirAba(b.getAttribute('data-aba')); });
  });

  $('[data-sair]').addEventListener('click', function () {
    sb.auth.signOut().then(function () { location.href = 'index.html'; });
  });

  /* ---------------- regra de rede da Lube (docs/SENTINELA-REDE.md, §7.2) ----------------
     Depois de conferir que é admin. Fora da rede e sem liberação: sai da sessão e vai para a
     página de bloqueio; com provas de que o IP do escritório mudou, o cartão de emergência.
     Central fora ou tempo esgotado: segue (os guardas barram nos sistemas). */
  function conferirRede(token) {
    if (!window.LubeRede) return Promise.resolve(true);
    return window.LubeRede.verificar(token, 3000).then(function (r) {
      if (!r || r.acao !== 'bloquear') {
        if (r && r.acao === 'seguir' && r.liberado) setTimeout(function () { toast(window.LubeRede.textoLiberado(r.liberado.ate)); }, 400);
        return true;
      }
      if (r.emergencia && r.emergencia.possivel) {
        return new Promise(function (ok) {
          window.LubeRede.cartaoEmergencia({
            pessoas: r.emergencia.pessoas, ip: r.ip, token: token,
            aoEntrar: function () { ok(true); },
            aoSair: function () { window.LubeRede.sair(sb, 'admin'); ok(false); }
          });
        });
      }
      window.LubeRede.sair(sb, 'admin');
      return false;
    });
  }

  /* ---------------- porteiro ---------------- */
  sb.auth.getSession().then(function (r) {
    var s = r.data.session;
    if (!s) { location.href = 'index.html'; return; }
    return sb.from('profiles').select('*').eq('id', s.user.id).single().then(function (p) {
      if (p.error || !p.data || !p.data.is_admin || !p.data.ativo) {
        location.href = 'index.html';
        return;
      }
      return conferirRede(s.access_token).then(function (segue) {
        if (!segue) return;
        eu = p.data;
        var quem = $('[data-adm-quem]'), av = $('[data-adm-av]');
        quem.textContent = eu.nome || eu.email;
        quem.parentNode.title = eu.email + ' · administrador';
        av.textContent = iniciais(eu.nome || eu.email);
        if (eu.foto) av.setAttribute('data-foto', eu.foto);
        $('[data-carregando]').classList.add('is-off');
        $('[data-adm]').hidden = false;
        setInterval(function () {
          if (!document.hidden) carregarSac().catch(function () {});
        }, 60000);
        return carregarTudo().then(function () {
          // endereço com a aba (admin.html#sac): abre nela
          var pedida = (location.hash || '').replace('#', '');
          if (pedida && pedida !== 'usuarios' && $('[data-aba="' + pedida + '"]')) abrirAba(pedida, true);
        });
      });
    });
  }).catch(function () { location.href = 'index.html'; });
})();
