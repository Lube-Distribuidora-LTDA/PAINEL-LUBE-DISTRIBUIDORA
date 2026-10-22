/* =========================================================
   LUBE DISTRIBUIDORA — PAINEL DE SISTEMAS
   Marca da Lube e cortina de entrada (vanilla JS, sem dependências).
   O menu lateral e os BIs ficam em shell.js; login e dados em portal.js.
   ========================================================= */
(function () {
  'use strict';

  var NAVY = '#1E2B8C';
  var RED  = '#EE1B24';
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var $  = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };
  var pad2 = function (n) { return (n < 10 ? '0' : '') + n; };

  /* ---------------------------------------------------------
     1. MARCA "L" DA LUBE EM SVG
     --------------------------------------------------------- */
  function markSVG(navy, red) {
    return '<svg viewBox="0 0 140 112" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="width:100%;height:auto;display:block">' +
      '<g transform="translate(20,0) skewX(-10)">' +
        '<path fill="' + navy + '" d="M24 6h34v56h42c6 0 10 4 10 10v12c0 10-8 18-18 18H24C12 102 4 94 4 82V26C4 14 12 6 24 6Z"/>' +
        '<path fill="' + red + '" d="M68 6h36c6 0 10 4 10 10v32c0 3-2 4-5 4H68Z"/>' +
      '</g>' +
    '</svg>';
  }
  window.LUBE_MARCA = markSVG;

  $$('[data-logo-mark]').forEach(function (el) {
    // sobre fundo escuro (cortina e menu azul) a marca vai em branco e vermelho
    var escuro = el.classList.contains('curtain__mark') || el.classList.contains('side__mark');
    el.innerHTML = escuro ? markSVG('#FFFFFF', RED) : markSVG(NAVY, RED);
  });

  /* ---------------------------------------------------------
     2. CORTINA DE ENTRADA
     --------------------------------------------------------- */
  var counter = $('[data-count]');
  var loadBar = $('[data-load-bar]');
  function boot() {
    if (loadBar) loadBar.style.width = '100%';
    document.body.classList.remove('is-loading');
    document.body.classList.add('loaded');
  }

  if (reduced || document.documentElement.classList.contains('em-moldura')) {
    boot();
  } else {
    var n = 0;
    var tick = setInterval(function () {
      n += Math.ceil(Math.random() * 9);
      if (n >= 100) { n = 100; clearInterval(tick); setTimeout(boot, 320); }
      if (counter) counter.textContent = pad2(n);
      if (loadBar) loadBar.style.width = n + '%';
    }, 55);
    setTimeout(function () { clearInterval(tick); boot(); }, 3200);
  }
})();
