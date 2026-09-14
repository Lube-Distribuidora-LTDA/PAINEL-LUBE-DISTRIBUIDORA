/* Marca "L" da Lube em SVG — usada nas páginas que não carregam o app.js */
(function () {
  'use strict';
  var NAVY = '#1E2B8C', RED = '#EE1B24';

  window.LUBE_MARCA = function (navy, red) {
    return '<svg viewBox="0 0 140 112" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" ' +
      'style="width:100%;height:auto;display:block">' +
      '<g transform="translate(20,0) skewX(-10)">' +
        '<path fill="' + (navy || NAVY) + '" d="M24 6h34v56h42c6 0 10 4 10 10v12c0 10-8 18-18 18H24C12 102 4 94 4 82V26C4 14 12 6 24 6Z"/>' +
        '<path fill="' + (red || RED) + '" d="M68 6h36c6 0 10 4 10 10v32c0 3-2 4-5 4H68Z"/>' +
      '</g></svg>';
  };

  Array.prototype.forEach.call(document.querySelectorAll('[data-logo-mark]'), function (el) {
    el.innerHTML = window.LUBE_MARCA();
  });
})();
