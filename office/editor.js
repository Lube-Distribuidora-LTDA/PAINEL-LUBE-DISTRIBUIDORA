/* =========================================================
   LUBE OFFICE — página do editor
   Pede à função office a configuração assinada e abre o ONLYOFFICE.
   Sem o motor instalado, mostra o arquivo com os detalhes e o download.
   @menções nos comentários viram aviso no sino do painel.
   ========================================================= */
(function () {
  'use strict';

  var O = window.OFC, $ = O.$, $$ = O.$$, esc = O.esc;
  var u = new URLSearchParams(location.search);
  var id = u.get('id') || '';
  var arquivo = null;
  var editor = null;

  function sufixoDemo() { return O.DEMO ? 'demo=1' : ''; }
  function urlDrive(extra) {
    var q = [extra, sufixoDemo()].filter(Boolean).join('&');
    return './' + (q ? '?' + q : '');
  }
  function urlCompartilhar() {
    return urlDrive('compartilhar=' + encodeURIComponent(id) + '&nome=' + encodeURIComponent(arquivo ? arquivo.nome : '') +
      '&ext=' + encodeURIComponent(arquivo ? arquivo.extensao : ''));
  }

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
    $$('[data-voltar]').forEach(function (el) { el.setAttribute('href', urlDrive(a.pasta ? 'pasta=' + encodeURIComponent(a.pasta) : '')); });
  }

  function espera(a, motivo) {
    $('[data-ed-cartao-ico]').innerHTML = O.icone(a.extensao);
    $('[data-ed-cartao-nome]').textContent = a.nome + '.' + a.extensao;
    $('[data-ed-motivo]').textContent = (motivo || 'O editor não abriu.') +
      ' Enquanto isso, baixe o arquivo para abrir no computador.';
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

  function baixar() {
    var t = O.toast('Preparando o download…', 'info', null, 0);
    O.api('baixar', { id: id }).then(function (r) {
      t.fechar();
      var a = document.createElement('a');
      a.href = r.url; a.download = r.nome; a.rel = 'noopener';
      document.body.appendChild(a); a.click(); a.remove();
    }, function (e) { t.fechar(); O.toast(e.message, 'erro'); });
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

  function abrirMotor(m) {
    $('[data-carga-txt]').textContent = 'Abrindo o editor';
    return carregarScript(m.api, 20000).then(function () {
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
    });
  }

  function iniciar() {
    O.marcas();
    $('[data-ed-baixar]').addEventListener('click', baixar);
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
          return abrirMotor(r.motor).catch(function (e) { $('[data-ed-motor]').hidden = true; espera(r.arquivo, e.message); });
        }
        espera(r.arquivo, r.motivo);
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
