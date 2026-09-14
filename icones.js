/* =========================================================
   ÍCONES DOS SISTEMAS
   Um ícone pode ser "gerado" (desenhado no padrão Lube a partir
   dos textos) ou "imagem" (arquivo enviado pelo administrador).
   Usado pelo portal e pelo painel administrativo.
   ========================================================= */
(function () {
  'use strict';

  var NAVY = '#1E2B8C', RED = '#EE1B24';

  function marca(navy, red) {
    return '<g transform="translate(20,0) skewX(-10)">' +
      '<path fill="' + (navy || NAVY) + '" d="M24 6h34v56h42c6 0 10 4 10 10v12c0 10-8 18-18 18H24C12 102 4 94 4 82V26C4 14 12 6 24 6Z"/>' +
      '<path fill="' + (red || RED) + '" d="M68 6h36c6 0 10 4 10 10v32c0 3-2 4-5 4H68Z"/>' +
    '</g>';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function txt(y, size, peso, texto, extra) {
    return '<text x="150" y="' + y + '" text-anchor="middle" ' +
      'font-family="Archivo,Segoe UI,sans-serif" font-size="' + size + '" ' +
      'font-weight="' + peso + '" fill="' + NAVY + '" ' + (extra || '') + '>' + esc(texto) + '</text>';
  }
  function filete(x1, x2, y) {
    return '<rect x="' + x1 + '" y="' + (y - 2) + '" width="' + (x2 - x1) + '" height="4" fill="' + RED + '"/>';
  }

  /* Corpo do tipo pilha: a área útil vai de y=132 a y=282.
     Os blocos são empilhados e centralizados nesse espaço. */
  function corpo(cfg) {
    var linhas = [cfg.linha1, cfg.linha2].filter(function (l) { return l && l.trim(); });
    if (!linhas.length) linhas = ['?'];

    // corpo da fonte: cabe na largura útil (230px) sem estourar a moldura
    var maior = linhas.reduce(function (m, l) { return Math.max(m, l.length); }, 1);
    var limite = linhas.length > 1 ? 52 : 96;
    var tam = Math.max(20, Math.min(limite, 230 / (0.66 * maior)));

    var temKicker = !!(cfg.kicker && cfg.kicker.trim());
    var temSub    = !!(cfg.sub && cfg.sub.trim());

    var alturaKicker = 30;
    var alturaSub    = 44;
    var alturaLinha  = tam * 1.02;
    var total = (temKicker ? alturaKicker : 0) + linhas.length * alturaLinha + (temSub ? alturaSub : 0);

    var y = 132 + Math.max(0, (150 - total) / 2);
    var out = '';

    if (temKicker) {
      var base = y + 20;
      var meia = base - 7;
      var largura = cfg.kicker.length * 11 + (cfg.kicker.length - 1) * 3.5;
      var borda = Math.max(30, 150 - largura / 2 - 14);
      out += filete(30, Math.min(borda, 110), meia) +
             filete(Math.max(300 - borda, 190), 270, meia) +
             txt(base, 19, 700, cfg.kicker, 'letter-spacing="3.5"');
      y += alturaKicker;
    }

    linhas.forEach(function (l, i) {
      out += txt(y + tam * 0.82 + i * alturaLinha, tam, 900, l, 'letter-spacing="-1"');
    });
    y += linhas.length * alturaLinha;

    if (temSub) {
      out += filete(96, 204, y + 8) + txt(y + 40, 33, 600, cfg.sub);
    }
    return out;
  }

  function moldura(id, dentro) {
    return '<svg viewBox="0 0 300 300" xmlns="http://www.w3.org/2000/svg" ' +
      'style="width:100%;height:auto;display:block">' +
      '<defs><linearGradient id="' + id + '" x1="0" y1="1" x2="1" y2="0">' +
        '<stop offset="49.9%" stop-color="' + NAVY + '"/><stop offset="50%" stop-color="' + RED + '"/>' +
      '</linearGradient></defs>' +
      '<rect x="13" y="13" width="274" height="274" rx="56" fill="#FFFFFF"/>' +
      '<rect x="13" y="13" width="274" height="274" rx="56" fill="none" ' +
        'stroke="url(#' + id + ')" stroke-width="13"/>' +
      '<g transform="translate(99,36) scale(0.72)">' + marca() + '</g>' +
      dentro +
    '</svg>';
  }

  var contador = 0;

  window.LUBE_ICONE = {
    marca: marca,

    /* SVG do ícone gerado */
    svg: function (cfg) {
      contador++;
      return moldura('ic' + contador, corpo(cfg || {}));
    },

    /* HTML pronto para colocar dentro do cartão */
    html: function (icone) {
      if (!icone) return '';
      if (icone.tipo === 'imagem' && icone.imagem_url) {
        return '<img src="' + esc(icone.imagem_url) + '" alt="" ' +
               'style="width:100%;height:auto;display:block;border-radius:18px" />';
      }
      return window.LUBE_ICONE.svg(icone);
    }
  };
})();
