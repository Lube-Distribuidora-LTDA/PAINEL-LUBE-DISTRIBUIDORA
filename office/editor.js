/* =========================================================
   LUBE OFFICE — página do editor
   Pede à função office a configuração assinada e abre o ONLYOFFICE.
   Sem o motor no ar, mostra o arquivo com os detalhes e o porquê (nada se baixa).
   @menções nos comentários viram aviso no sino do painel.
   ========================================================= */
(function () {
  'use strict';

  var O = window.OFC, $ = O.$, $$ = O.$$, esc = O.esc;
  var u = new URLSearchParams(location.search);
  var id = u.get('id') || '';
  var arquivo = null;
  var editor = null;
  // teste de ponta a ponta sem login: editor.html#teste=<senha temporária> (ver db/06_office_teste_motor.sql)
  var TESTE = (/(?:^#|&)teste=([A-Za-z0-9_-]{32,})/.exec(location.hash) || [])[1] || null;
  // pedido da IA que veio do Drive ("Criar com IA"): fica guardado no navegador até o editor abrir
  var pendenteIa = window.OFC_IA_EDITOR ? window.OFC_IA_EDITOR.lerPendente(u.get('ia')) : null;
  if (u.get('ia')) {
    u.delete('ia');
    history.replaceState(null, '', location.pathname + '?' + u.toString() + location.hash);
  }

  function sufixoDemo() { return O.DEMO ? 'demo=1' : ''; }
  function urlDrive(extra) {
    var q = [extra, sufixoDemo()].filter(Boolean).join('&');
    return './' + (q ? '?' + q : '');
  }
  function urlDoArquivo(acao) {
    return urlDrive(acao + '=' + encodeURIComponent(id) + '&nome=' + encodeURIComponent(arquivo ? arquivo.nome : '') +
      '&ext=' + encodeURIComponent(arquivo ? arquivo.extensao : ''));
  }
  function urlCompartilhar() { return urlDoArquivo('compartilhar'); }

  function bloquear(titulo, texto, botao) {
    $('[data-bloqueio-titulo]').textContent = titulo;
    $('[data-bloqueio-texto]').textContent = texto;
    var b = $('[data-bloqueio-botao]');
    b.textContent = botao ? botao.texto : 'Voltar ao LUBE OFFICE';
    b.setAttribute('href', botao ? botao.href : urlDrive());
    $('[data-bloqueio]').hidden = false;
    document.body.classList.remove('carregando');
  }

  function mostrarArquivo(a) {
    arquivo = a;
    var nome = a.nome + '.' + a.extensao;
    document.title = nome + ' — LUBE OFFICE';
    $('[data-ed-nome]').textContent = nome;
    $('[data-ed-sub]').textContent = O.nomeTipo(a.extensao) + ' · ' +
      (a.pasta_nome || (a.papel !== 'dono' && a.dono ? 'de ' + a.dono.nome : 'Meus arquivos')) +
      ' · versão ' + a.versao;
    $('[data-ed-ico]').innerHTML = O.icone(a.extensao);
    var papel = $('[data-ed-papel]');
    if (a.papel && a.papel !== 'dono') { papel.textContent = O.papelTxt(a.papel); papel.hidden = false; }
    $('[data-ed-compartilhar]').setAttribute('href', urlCompartilhar());
    $('[data-ed-compartilhar]').setAttribute('target', '_blank');
    // nada se baixa: o arquivo sai do painel só pelo Enviar (quem pode editar)
    var enviar = $('[data-ed-enviar]');
    enviar.hidden = !O.pode(a.papel, 'editar');
    enviar.setAttribute('href', urlDoArquivo('enviar'));
    enviar.setAttribute('target', '_blank');
    $$('[data-voltar]').forEach(function (el) { el.setAttribute('href', urlDrive(a.pasta ? 'pasta=' + encodeURIComponent(a.pasta) : '')); });
  }

  function espera(a, motivo, situacao) {
    $('[data-ed-cartao-ico]').innerHTML = O.icone(a.extensao);
    $('[data-ed-cartao-nome]').textContent = a.nome + '.' + a.extensao;
    $('[data-ed-estado]').textContent = situacao === 'fora' ? 'Editor fora do ar' : 'Editor sendo ligado';
    $('[data-ed-motivo]').textContent = (motivo || 'O editor não abriu.') +
      (situacao === 'fora' ? ' Assim que ele voltar, é só tentar de novo.' : ' Enquanto isso, o arquivo fica guardado e pode ser enviado ou compartilhado pelo LUBE OFFICE.');
    var alt = a.alterado_por ? ' por ' + a.alterado_por.nome : '';
    var linhas = [
      ['Tipo', O.nomeTipo(a.extensao) + ' (.' + a.extensao + ')'],
      ['Dono', a.dono ? a.dono.nome : '—'],
      ['Pasta', a.pasta_nome || 'Meus arquivos'],
      ['Versão', String(a.versao)],
      ['Tamanho', O.bytes(a.tamanho)],
      ['Última alteração', O.dataCompleta(a.alterado_em) + alt],
      ['Seu acesso', O.papelTxt(a.papel)]
    ];
    $('[data-ed-detalhes]').innerHTML = linhas.map(function (l) { return '<dt>' + esc(l[0]) + '</dt><dd>' + esc(l[1]) + '</dd>'; }).join('');
    $('[data-ed-espera]').hidden = false;
    document.body.classList.remove('carregando');
  }

  function carregarScript(src, ms) {
    return new Promise(function (ok, falha) {
      var s = document.createElement('script');
      var t = setTimeout(function () { falha(new Error('O motor de edição não respondeu.')); }, ms);
      s.src = src;
      s.onload = function () { clearTimeout(t); ok(); };
      s.onerror = function () { clearTimeout(t); falha(new Error('O motor de edição está fora do ar.')); };
      document.head.appendChild(s);
    });
  }

  // tema da Lube: o ONLYOFFICE só pinta tema próprio depois de a pessoa escolher no menu
  // (teste de 2026-10-22). A página tema-lube.html, no motor, grava as cores do tema na
  // memória do editor antes de ele abrir; se ela não responder em 2,5 s, o editor abre assim mesmo.
  function prepararTema(m) {
    var c = m.config && m.config.editorConfig && m.config.editorConfig.customization;
    var tema = c && c.uiTheme;
    if (!/^theme-lube-[a-z]+$/.test(String(tema || ''))) return Promise.resolve();
    var origem = new URL(m.api).origin;
    return new Promise(function (ok) {
      var f = document.createElement('iframe');
      var fim = function () { window.removeEventListener('message', ouvir); f.remove(); ok(); };
      var ouvir = function (ev) { if (ev.origin === origem && ev.source === f.contentWindow && ev.data && ev.data.lubeTema) fim(); };
      window.addEventListener('message', ouvir);
      setTimeout(fim, 2500);
      f.hidden = true;
      f.setAttribute('aria-hidden', 'true');
      f.src = origem + '/web-apps/apps/common/main/resources/lube/tema-lube.html?tema=' + encodeURIComponent(tema);
      document.body.appendChild(f);
    });
  }

  function abrirMotor(m) {
    $('[data-carga-txt]').textContent = 'Abrindo o editor';
    return Promise.all([carregarScript(m.api, 20000), prepararTema(m)]).then(function () {
      if (!window.DocsAPI) throw new Error('O motor de edição respondeu sem o editor.');
      var cfg = Object.assign({}, m.config, {
        events: {
          onAppReady: function () { document.body.classList.remove('carregando'); },
          onDocumentReady: function () { document.body.classList.remove('carregando'); },
          // lista de pessoas do painel para @mencionar
          onRequestUsers: function (ev) {
            var c = ev && ev.data && ev.data.c ? ev.data.c : 'mention';
            O.api('pessoas', {}).then(function (l) {
              editor.setUsers({ c: c, users: (l || []).map(function (p) { return { id: p.id, email: p.email, name: p.nome }; }) });
            }, function () {});
          },
          // comentário com @menção: aviso no sino do painel
          onRequestSendNotify: function (ev) {
            var d = (ev && ev.data) || {};
            O.api('mencionar', { id: id, emails: d.emails || [], mensagem: d.message || '' }).then(function (r) {
              if (r.avisados && r.avisados.length) {
                O.toast('Avisado no painel: ' + r.avisados.map(function (p) { return p.nome; }).join(', ') + '.');
              }
              if (r.sem_acesso && r.sem_acesso.length) {
                O.toast(r.sem_acesso.length + (r.sem_acesso.length > 1 ? ' pessoas mencionadas não têm' : ' pessoa mencionada não tem') +
                  ' acesso a este arquivo. Compartilhe para ver o comentário.', 'erro',
                  { texto: 'Compartilhar', fn: function () { window.open(urlCompartilhar(), '_blank'); } }, 12000);
              }
            }, function (e) { O.toast('A menção não virou aviso: ' + e.message, 'erro'); });
          },
          onRequestSharingSettings: function () { window.open(urlCompartilhar(), '_blank'); },
          onError: function (ev) {
            var d = (ev && ev.data) || {};
            O.toast('O editor avisou um problema: ' + (d.errorDescription || d.errorCode || 'erro desconhecido'), 'erro', null, 12000);
          }
        }
      });
      $('[data-ed-motor]').hidden = false;
      editor = new window.DocsAPI.DocEditor('editor-onlyoffice', cfg);
      // se o editor não avisar que abriu, a tela de carga sai sozinha
      setTimeout(function () { document.body.classList.remove('carregando'); }, 15000);
      // IA da Lube: o plugin só vem na configuração para quem pode editar e com a IA ligada
      var plugins = m.config && m.config.editorConfig && m.config.editorConfig.plugins;
      if (window.OFC_IA_EDITOR) {
        window.OFC_IA_EDITOR.iniciar({
          arquivo: arquivo, origemMotor: new URL(m.api).origin, teste: TESTE, pendente: pendenteIa,
          ligada: !!(plugins && plugins.pluginsData && plugins.pluginsData.length),
          aoTerminar: renomearPelaIa
        });
      }
    });
  }

  // arquivo criado pela IA: ganha o nome que ela sugeriu (só se ainda tem o nome provisório)
  function renomearPelaIa(r) {
    var novo = r && r.plano && r.plano.titulo_arquivo;
    if (!novo || TESTE || !pendenteIa || !pendenteIa.renomear || novo === arquivo.nome) return;
    O.api('renomear', { tipo: 'arquivo', id: id, nome: novo }).then(function (a) {
      arquivo.nome = a.nome;
      $('[data-ed-nome]').textContent = a.nome + '.' + a.extensao;
      var cartao = $('[data-ed-cartao-nome]');
      if (cartao && cartao.textContent) cartao.textContent = a.nome + '.' + a.extensao;
      document.title = a.nome + '.' + a.extensao + ' — LUBE OFFICE';
    }, function () {});
  }

  // abre pela porta de teste (sem login): cria um "Teste do motor" novo ou reabre o indicado;
  // #teste=...&tema=theme-lube-claro mostra um tema da Lube antes de ele valer para todos
  function iniciarTeste() {
    var tema = (/(?:^#|&)tema=(theme-[a-z-]+)/.exec(location.hash) || [])[1];
    return O.apiTeste({ token: TESTE, arquivo: /^[0-9a-f-]{36}$/i.test(id) ? id : null, extensao: u.get('ext') || 'docx', tema: tema }).then(function (r) {
      id = r.arquivo.id;
      u.set('id', id);
      u.delete('ext');
      history.replaceState(null, '', location.pathname + '?' + u.toString() + location.hash);
      mostrarArquivo(r.arquivo);
      return abrirMotor(r.motor);
    }, function (e) {
      bloquear('Teste não autorizado', e.message);
    });
  }

  function iniciar() {
    O.marcas();
    $('[data-ed-tentar]').addEventListener('click', function () { location.reload(); });
    if (TESTE) { iniciarTeste(); return; }
    O.pronto().then(function () { return O.token(); }).then(function (t) {
      if (!t) {
        bloquear('Entre pelo painel', 'O LUBE OFFICE abre com o mesmo login do Painel de Sistemas.',
          { texto: 'Ir para o login', href: '../?voltar=office' });
        return;
      }
      if (!/^[0-9a-f-]{36}$/i.test(id)) { bloquear('Arquivo não informado', 'O endereço não diz qual arquivo abrir.'); return; }
      return O.api('abrir', { id: id }).then(function (r) {
        mostrarArquivo(r.arquivo);
        if (r.motor) {
          return abrirMotor(r.motor).catch(function (e) { $('[data-ed-motor]').hidden = true; espera(r.arquivo, e.message, 'fora'); });
        }
        espera(r.arquivo, r.motivo, r.situacao);
        // demonstração (só na máquina): o painel da IA funciona com um plano de exemplo, sem editor
        if (O.DEMO && window.OFC_IA_EDITOR) {
          window.OFC_IA_EDITOR.iniciar({ arquivo: r.arquivo, origemMotor: null, teste: null, pendente: pendenteIa, ligada: true, aoTerminar: renomearPelaIa });
        }
      }, function (e) {
        if (e.status === 401) bloquear('Sua sessão acabou', 'Entre de novo pelo Painel de Sistemas.', { texto: 'Ir para o login', href: '../?voltar=office' });
        else if (e.status === 404 || e.status === 403) bloquear('Sem acesso a este arquivo', 'Ele foi para a lixeira, mudou de dono ou não foi compartilhado com você. Peça acesso a quem mandou o link.');
        else bloquear('Não abriu agora', e.message, { texto: 'Tentar de novo', href: location.href });
      });
    }).catch(function (e) {
      bloquear('Não abriu agora', e && e.message ? e.message : 'Falha ao iniciar.', { texto: 'Tentar de novo', href: location.href });
    });
  }

  iniciar();
})();
