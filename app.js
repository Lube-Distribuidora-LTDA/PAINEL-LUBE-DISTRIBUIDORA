/* =========================================================
   LUBE DISTRIBUIDORA — PAINEL DE SISTEMAS
   Abertura (marca, cortina, "SISTEMAS CORPORATIVOS", caminhão) em
   vanilla JS. Rolando, a página cai no painel: menu "BI LUBE" e BIs
   ficam em shell.js; login e dados em portal.js.
   ========================================================= */
(function () {
  'use strict';

  var NAVY = '#1E2B8C';
  var RED  = '#EE1B24';
  var CYAN = '#00A0E9';
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  var lerp  = function (a, b, t) { return a + (b - a) * t; };
  var $     = function (s, c) { return (c || document).querySelector(s); };
  var $$    = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };
  var pad2  = function (n) { return (n < 10 ? '0' : '') + n; };

  try { if ('scrollRestoration' in history) history.scrollRestoration = 'manual'; } catch (e) {}
  if (!location.hash) window.scrollTo(0, 0);

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

  function bareMark(navy, red) {
    return markSVG(navy, red).replace(/<svg[^>]*>/, '').replace('</svg>', '');
  }

  window.LUBE_MARCA = markSVG;

  $$('[data-logo-mark]').forEach(function (el) {
    if (el.classList.contains('curtain__mark')) {
      el.innerHTML = markSVG('#FFFFFF', RED);          // sobre o fundo escuro
    } else if (el.classList.contains('nav__mark')) {
      el.innerHTML =
        '<span class="mark mark--light">' + markSVG('#FFFFFF', RED) + '</span>' +
        '<span class="mark mark--dark">'  + markSVG(NAVY, RED)      + '</span>';
    } else if (el.classList.contains('side__mark')) {
      el.innerHTML = markSVG('#FFFFFF', RED);          // sobre o menu azul
    } else {
      el.innerHTML = markSVG(NAVY, RED);
    }
  });

  /* ---------------------------------------------------------
     3. CAMINHÃO
     Usa a foto do caminhão (assets/caminhao-lube.webp, a mesma do vídeo do Lube Online); se não carregar, SVG.
     --------------------------------------------------------- */
  function truckSVG() {
    var stripes = '';
    for (var i = 0; i < 9; i++) {
      stripes += '<rect x="' + (34 + i * 44) + '" y="185" width="24" height="9" fill="' +
                 (i % 2 ? RED : '#FFFFFF') + '"/>';
    }
    var wheels = [112, 202, 506].map(function (cx) {
      return '<circle cx="' + cx + '" cy="203" r="37" fill="#12161F"/>' +
             '<circle cx="' + cx + '" cy="203" r="17" fill="#98A2B3"/>' +
             '<circle cx="' + cx + '" cy="203" r="6"  fill="#5B6577"/>';
    }).join('');

    return '<svg viewBox="0 0 650 250" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;display:block">' +
      '<defs>' +
        '<linearGradient id="tbox" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0%" stop-color="#3BC4F9"/><stop offset="55%" stop-color="' + CYAN + '"/>' +
          '<stop offset="100%" stop-color="#0084C6"/></linearGradient>' +
        '<linearGradient id="tcab" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0%" stop-color="#FFFFFF"/><stop offset="70%" stop-color="#F0F3F8"/>' +
          '<stop offset="100%" stop-color="#C9D2E0"/></linearGradient>' +
      '</defs>' +

      '<ellipse cx="325" cy="234" rx="300" ry="10" fill="rgba(0,0,0,.4)"/>' +

      /* ---- baú ---- */
      '<rect x="18" y="26" width="404" height="158" fill="url(#tbox)"/>' +
      '<rect x="18" y="26" width="404" height="9"  fill="#DCE3EC"/>' +
      '<rect x="18" y="184" width="404" height="22" fill="#14235F"/>' + stripes +
      '<rect x="18" y="26" width="7" height="158" fill="rgba(255,255,255,.25)"/>' +

      /* marca + assinatura no baú */
      '<g transform="translate(48,58) scale(0.58)">' + bareMark(NAVY, RED) + '</g>' +
      '<text x="146" y="122" font-family="Archivo,Segoe UI,sans-serif" font-size="62" font-weight="900" ' +
        'font-style="italic" letter-spacing="-2" fill="' + NAVY + '">Lube</text>' +
      '<rect x="148" y="132" width="186" height="9" fill="' + RED + '"/>' +
      '<text x="150" y="162" font-family="Archivo,Segoe UI,sans-serif" font-size="24" font-weight="800" ' +
        'letter-spacing="1" fill="' + NAVY + '">Distribuidora</text>' +

      /* ---- cabine ---- */
      '<path fill="url(#tcab)" d="M424 206V60c0-13 11-24 24-24h122c16 0 28 12 28 28v142Z"/>' +
      '<path fill="#0C1633" d="M492 116V72c0-5 4-9 9-9h62c5 0 9 4 9 9v44Z"/>' +
      '<rect x="434" y="66" width="44" height="50" rx="4" fill="#0C1633"/>' +
      '<rect x="424" y="150" width="16" height="30" fill="rgba(0,0,0,.12)"/>' +
      '<g transform="translate(436,146) scale(0.3)">' + bareMark(NAVY, RED) + '</g>' +
      '<text x="472" y="176" font-family="Archivo,Segoe UI,sans-serif" font-size="22" font-weight="900" ' +
        'font-style="italic" fill="' + NAVY + '">Lube</text>' +
      '<rect x="586" y="146" width="14" height="26" rx="3" fill="#FFC24D"/>' +
      '<rect x="424" y="196" width="180" height="18" fill="#232C42"/>' +

      /* ---- chassi ---- */
      '<rect x="18" y="206" width="406" height="12" fill="#1A2238"/>' +
      '<rect x="252" y="160" width="96" height="46" rx="10" fill="#AEB8C7"/>' +
      '<rect x="252" y="160" width="96" height="8"  rx="4" fill="#D6DEE9"/>' +

      wheels +
    '</svg>';
  }

  var vehicle = $('[data-vehicle]');
  if (vehicle) {
    vehicle.innerHTML = truckSVG();
    var probe = new Image();                       // troca pela foto oficial, se houver
    probe.onload = function () {
      vehicle.innerHTML = '<img src="assets/caminhao-lube.webp" alt="Caminhão Lube Distribuidora" ' +
        'style="width:100%;height:auto;display:block;filter:drop-shadow(0 30px 40px rgba(0,0,0,.45))" />';
    };
    probe.src = 'assets/caminhao-lube.webp';
  }

  /* ---------------------------------------------------------
     4. CORTINA DE ENTRADA
     --------------------------------------------------------- */
  var counter = $('[data-count]');
  var loadBar = $('[data-load-bar]');
  function boot() {
    if (loadBar) loadBar.style.width = '100%';
    document.body.classList.remove('is-loading');
    document.body.classList.add('loaded');
    $$('.hero .mask > span').forEach(function (s) { s.classList.add('in'); });
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

  /* ---------------------------------------------------------
     5. MOTOR DE SCROLL (lerp / rAF)
     --------------------------------------------------------- */
  var heroBg    = $('[data-hero-bg]');
  var heroTitle = $('[data-hero-title]');
  var haul      = $('[data-haul]');
  var haulLight = $('[data-haul-light]');
  var haulRoad  = $('[data-haul-road]');
  var truck     = $('[data-truck]');
  var typeDark  = $('[data-haul-type-dark]');
  var typeLight = $('[data-haul-type-light]');
  var painelEl  = $('[data-app]');

  var lastVh = 0;
  var state  = { bg: 1, title: 1, haul: 0, painel: 0 };
  var target = { bg: 1, title: 1, haul: 0, painel: 0 };
  var chegou = false;
  // até o painel chegar, o conteúdo do início espera para entrar em cascata
  if (painelEl && !reduced) painelEl.classList.add('pre-chegada');

  function measure() {
    var vh = window.innerHeight;
    var y  = window.scrollY || window.pageYOffset;

    if (vh !== lastVh) {                    // altura real da viewport (evita o bug do 100vh)
      lastVh = vh;
      document.documentElement.style.setProperty('--app-h', vh + 'px');
    }

    var hp = clamp(y / vh, 0, 1);
    target.bg    = 1 + hp * 0.27;
    target.title = 1 - clamp(y / (vh * 0.3), 0, 1) * 0.11;

    if (haul) {
      var r = haul.getBoundingClientRect();
      var travel = haul.offsetHeight - vh;
      target.haul = travel > 0 ? clamp(-r.top / travel, 0, 1) : 0;
    }
    // entrada do painel: 0 quando o topo dele está no pé da tela, 1 quando ocupa a tela
    if (painelEl && painelEl.offsetHeight) {
      target.painel = clamp(1 - painelEl.getBoundingClientRect().top / vh, 0, 1);
    }
  }

  function render() {
    var k = reduced ? 1 : 0.12;
    state.bg    = lerp(state.bg,    target.bg,    k);
    state.title = lerp(state.title, target.title, k);
    state.haul  = lerp(state.haul,  target.haul,  reduced ? 1 : 0.14);

    if (heroBg)    heroBg.style.transform    = 'scale(' + state.bg.toFixed(4) + ')';
    if (heroTitle) heroTitle.style.transform = 'scale(' + state.title.toFixed(4) + ')';

    /* O caminhão cruza a tela descendo junto com a cortina branca:
       ele "puxa" a parte de baixo do site sobre a parte de cima. */
    var p    = state.haul;
    var wipe = clamp((p - 0.12) / 0.66, 0, 1);   // 0 = topo, 1 = base
    var edge = clamp(wipe * 100, 19, 81);        // linha onde o caminhão corre

    if (haulLight) {
      haulLight.style.clipPath = 'inset(0 0 ' + ((1 - wipe) * 100).toFixed(2) + '% 0)';
    }
    if (truck) {
      truck.style.top = edge.toFixed(2) + '%';
      truck.style.transform = 'translate3d(' + (-50 + p * 196).toFixed(2) + 'vw,-50%,0)';
    }
    if (haulRoad) {
      haulRoad.style.top = edge.toFixed(2) + '%';
      haulRoad.style.opacity = (1 - clamp((p - 0.62) / 0.16, 0, 1)).toFixed(3);
      var bar = haulRoad.firstElementChild;
      if (bar) bar.style.transform = 'scaleX(' + clamp(p * 1.4, 0, 1).toFixed(3) + ')';
    }
    /* as duas frases respiram enquanto a troca acontece */
    if (typeDark)  typeDark.style.transform  = 'scale(' + (1.1 - p * 0.16).toFixed(4) + ')';
    /* saindo do "NOSSOS sistemas", o painel sobe e se monta: o menu entra pela
       esquerda, o palco cresce de baixo e a frase se apaga para dar lugar a ele */
    state.painel = lerp(state.painel, target.painel, reduced ? 1 : 0.14);
    var e = reduced ? 1 : 1 - Math.pow(1 - state.painel, 3);
    if (typeLight) {
      typeLight.style.transform = 'translateY(' + (-e * 90).toFixed(1) + 'px) scale(' + (1.14 - p * 0.16 - e * 0.12).toFixed(4) + ')';
      typeLight.style.opacity = (1 - clamp(e * 1.6, 0, 1)).toFixed(3);
      typeLight.style.filter = e > 0.01 ? 'blur(' + (e * 8).toFixed(1) + 'px)' : '';
    }
    if (painelEl) {
      painelEl.style.setProperty('--entra', e.toFixed(4));
      if (!chegou && state.painel > 0.965) {
        chegou = true;
        painelEl.classList.remove('pre-chegada');
        painelEl.classList.add('chegou');
      } else if (chegou && target.painel < 0.25 && !reduced) {
        chegou = false;                       // voltou para a abertura: a chegada repete
        painelEl.classList.remove('chegou');
        painelEl.classList.add('pre-chegada');
      }
    }

    syncNav();
    requestAnimationFrame(render);
  }

  measure();
  state.bg = target.bg; state.title = target.title; state.haul = target.haul; state.painel = target.painel;
  requestAnimationFrame(render);
  window.addEventListener('scroll', measure, { passive: true });
  window.addEventListener('resize', measure);

  /* ---------------------------------------------------------
     7. TEMA DA NAVBAR CONFORME A SUPERFÍCIE ATRÁS DELA
     --------------------------------------------------------- */
  var nav = $('.nav');
  var navTick = 0;

  function syncNav() {
    if (!nav || (navTick++ % 5)) return;
    var y = 40;
    var isLight = function (x) {
      var stack = document.elementsFromPoint(x, y) || [];
      for (var i = 0; i < stack.length; i++) {
        var s = stack[i].closest ? stack[i].closest('[data-surface]') : null;
        if (s) return s.getAttribute('data-surface') === 'light';
      }
      return false;
    };
    var w = window.innerWidth;
    nav.classList.toggle('is-light-l', isLight(Math.min(70, w * 0.08)));
    nav.classList.toggle('is-light-c', isLight(w / 2));
    nav.classList.toggle('is-light-r', isLight(Math.max(12, w - 70)));
  }

  /* ---------------------------------------------------------
     8. MENU MOBILE
     --------------------------------------------------------- */
  var burger = $('[data-burger]');
  var menu   = $('[data-menu]');
  if (burger && menu) {
    burger.addEventListener('click', function () {
      var open = menu.classList.toggle('open');
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
      document.body.classList.toggle('menu-open', open);
    });
    $$('a', menu).forEach(function (a) {
      a.addEventListener('click', function () {
        menu.classList.remove('open');
        burger.setAttribute('aria-expanded', 'false');
        document.body.classList.remove('menu-open');
      });
    });
  }

  /* ---------------------------------------------------------
     9. CHEGADA NO PAINEL
     A navbar da abertura some quando o painel ocupa a tela.
     --------------------------------------------------------- */
  var painel = $('[data-app]');
  if (painel && 'IntersectionObserver' in window) {
    new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        document.body.classList.toggle('no-painel', e.isIntersecting && e.intersectionRatio > 0.6);
      });
    }, { threshold: [0, 0.6, 0.9, 1] }).observe(painel);
  }
  $$('[data-ir-painel]').forEach(function (a) {
    a.addEventListener('click', function (ev) {
      if (!painel) return;
      ev.preventDefault();
      painel.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    });
  });
})();
