/* =========================================================
   FOTOS DE PERFIL — painel, admin e Lube Work
   Qualquer elemento com data-foto="<caminho no bucket avatares>" ganha a
   foto da pessoa por cima das iniciais. O bucket é privado: este arquivo
   pede endereços assinados (com o login de quem está na tela), guarda por
   alguns dias e pinta o elemento. Sem foto, sem login ou com erro, ficam
   as iniciais.
   ========================================================= */
(function () {
  'use strict';

  var CFG = window.LUBE_CFG;
  if (!CFG || !CFG.url || typeof fetch !== 'function') return;

  var BUCKET  = 'avatares';
  var ASSINA  = 7 * 24 * 3600;             // validade pedida (s)
  var GUARDA  = 6 * 24 * 3600 * 1000;      // por quanto tempo reaproveita o endereço (ms)
  var CHAVE   = 'lube_fotos_v1';
  var ref     = (CFG.url.match(/^https?:\/\/([^.]+)\./) || [])[1] || '';

  var cache = {};                          // caminho -> { u: endereço, ate: ms }
  try {
    var salvo = JSON.parse(localStorage.getItem(CHAVE) || '{}'), agora = Date.now();
    Object.keys(salvo).forEach(function (k) { if (salvo[k] && salvo[k].ate > agora) cache[k] = salvo[k]; });
  } catch (e) {}
  function guardar() {
    try {
      var limpo = {};                        // a foto recém-trocada (data:) fica só na memória
      Object.keys(cache).forEach(function (k) { if (cache[k].u.indexOf('data:') !== 0) limpo[k] = cache[k]; });
      localStorage.setItem(CHAVE, JSON.stringify(limpo));
    } catch (e) {}
  }

  // o login é o mesmo do painel (supabase-js guarda a sessão no navegador)
  function token() {
    if (typeof api.token === 'function') return Promise.resolve(api.token());
    try {
      var s = JSON.parse(localStorage.getItem('sb-' + ref + '-auth-token') || 'null');
      if (s && s.access_token && (!s.expires_at || s.expires_at * 1000 > Date.now() + 5000)) return Promise.resolve(s.access_token);
    } catch (e) {}
    if (window.LUBE_SB && window.LUBE_SB.auth) {
      return window.LUBE_SB.auth.getSession().then(function (r) {
        return r && r.data && r.data.session ? r.data.session.access_token : null;
      }, function () { return null; });
    }
    return Promise.resolve(null);
  }

  function pintar(el, caminho, url) {
    el.style.backgroundImage = 'url("' + url + '")';
    el.style.backgroundSize = 'cover';
    el.style.backgroundPosition = 'center';
    el.style.color = 'transparent';
    el.classList.add('tem-foto');
    el.setAttribute('data-foto-ok', caminho);
  }
  function limpar(el) {
    if (!el.hasAttribute('data-foto-ok')) return;
    el.style.backgroundImage = el.style.backgroundSize = el.style.backgroundPosition = el.style.color = '';
    el.classList.remove('tem-foto');
    el.removeAttribute('data-foto-ok');
  }

  var fila = {}, timer = null;             // caminho -> [elementos esperando]
  function pedir() {
    timer = null;
    var caminhos = Object.keys(fila);
    if (!caminhos.length) return;
    var espera = fila; fila = {};
    token().then(function (t) {
      if (!t) return null;
      return fetch(CFG.url + '/storage/v1/object/sign/' + BUCKET, {
        method: 'POST', cache: 'no-store',
        headers: { 'content-type': 'application/json', apikey: CFG.key, authorization: 'Bearer ' + t },
        body: JSON.stringify({ expiresIn: ASSINA, paths: caminhos })
      }).then(function (r) { return r.ok ? r.json() : null; });
    }).then(function (lista) {
      if (!Array.isArray(lista)) return;
      lista.forEach(function (it) {
        if (!it || it.error || !it.signedURL || !it.path) return;
        var url = CFG.url + '/storage/v1' + it.signedURL;
        cache[it.path] = { u: url, ate: Date.now() + GUARDA };
        (espera[it.path] || []).forEach(function (el) {
          if (el.getAttribute('data-foto') === it.path) pintar(el, it.path, url);
        });
      });
      guardar();
    }, function () {});
  }

  function ver(el) {
    var caminho = el.getAttribute('data-foto');
    if (!caminho) { limpar(el); return; }
    if (el.getAttribute('data-foto-ok') === caminho) return;
    var c = cache[caminho];
    if (c && c.ate > Date.now()) { pintar(el, caminho, c.u); return; }
    limpar(el);
    (fila[caminho] = fila[caminho] || []).push(el);
    if (!timer) timer = setTimeout(pedir, 40);
  }
  function varrer(raiz) {
    raiz = raiz && raiz.querySelectorAll ? raiz : document;
    if (raiz.nodeType === 1 && raiz.hasAttribute('data-foto')) ver(raiz);
    var els = raiz.querySelectorAll('[data-foto]');
    for (var i = 0; i < els.length; i++) ver(els[i]);
  }

  var api = window.LubeFotos = {
    varrer: varrer,
    limpar: limpar,                       // tira a foto pintada (volta às iniciais)
    // a pessoa acabou de trocar a própria foto: mostra a nova na hora, sem esperar o endereço assinado
    lembrar: function (caminho, url) { if (caminho && url) cache[caminho] = { u: url, ate: Date.now() + 10 * 60 * 1000 }; },
    esquecer: function (caminho) { delete cache[caminho]; guardar(); },
    token: null
  };

  function iniciar() {
    varrer(document);
    if (typeof MutationObserver !== 'function') return;
    new MutationObserver(function (ms) {
      for (var i = 0; i < ms.length; i++) {
        var m = ms[i];
        if (m.type === 'attributes') { ver(m.target); continue; }
        for (var j = 0; j < m.addedNodes.length; j++) {
          if (m.addedNodes[j].nodeType === 1) varrer(m.addedNodes[j]);
        }
      }
    }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-foto'] });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
