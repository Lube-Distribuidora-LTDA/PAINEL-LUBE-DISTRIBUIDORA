/* =========================================================
   LUBE DISTRIBUIDORA — PAINEL DE SISTEMAS
   Motor de animação (vanilla JS, sem dependências)
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

  $$('[data-logo-mark]').forEach(function (el) {
    if (el.classList.contains('curtain__mark')) {
      el.innerHTML = markSVG('#FFFFFF', RED);          // sobre o fundo escuro
    } else if (el.classList.contains('nav__mark')) {
      el.innerHTML =
        '<span class="mark mark--light">' + markSVG('#FFFFFF', RED) + '</span>' +
        '<span class="mark mark--dark">'  + markSVG(NAVY, RED)      + '</span>';
    } else {
      el.innerHTML = markSVG(NAVY, RED);
    }
  });

  /* ---------------------------------------------------------
     2. ÍCONES
     Ficam em icones.js (compartilhado com o painel admin) e são
     montados pelo portal.js a partir do banco.
     --------------------------------------------------------- */

  /* ---------------------------------------------------------
     3. CAMINHÃO
     Usa assets/caminhao-lube.png se existir; senão, SVG.
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
      vehicle.innerHTML = '<img src="assets/caminhao-lube.png" alt="Caminhão Lube Distribuidora" ' +
        'style="width:100%;height:auto;display:block;filter:drop-shadow(0 30px 40px rgba(0,0,0,.45))" />';
    };
    probe.src = 'assets/caminhao-lube.png';
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

  if (reduced) {
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

  var lastVh = 0;
  var state  = { bg: 1, title: 1, haul: 0 };
  var target = { bg: 1, title: 1, haul: 0 };

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
    if (typeLight) typeLight.style.transform = 'scale(' + (1.14 - p * 0.16).toFixed(4) + ')';

    syncNav();
    requestAnimationFrame(render);
  }

  measure();
  state.bg = target.bg; state.title = target.title; state.haul = target.haul;
  requestAnimationFrame(render);
  window.addEventListener('scroll', measure, { passive: true });
  window.addEventListener('resize', measure);

  /* ---------------------------------------------------------
     6. REVEALS
     --------------------------------------------------------- */
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      var el = e.target;
      var delay = parseFloat(el.getAttribute('data-delay') || 0);
      setTimeout(function () {
        el.classList.add('in');
        $$(':scope > span', el).forEach(function (s) { s.classList.add('in'); });
      }, delay);
      io.unobserve(el);
    });
  }, { threshold: 0.15, rootMargin: '0px 0px -6% 0px' });

  /* Elementos dentro de .mask são clipados — observamos a máscara, nunca o filho. */
  $$('[data-reveal]').forEach(function (el) {
    var t = el.parentElement && el.parentElement.classList.contains('mask') ? el.parentElement : el;
    if (t.getAttribute('data-observed')) return;
    var idx = t.parentElement ? Array.prototype.indexOf.call(t.parentElement.children, t) : 0;
    t.setAttribute('data-delay', String(Math.min(idx, 4) * 90));
    t.setAttribute('data-observed', '1');
    io.observe(t);
  });
  $$('[data-line]').forEach(function (el) { io.observe(el); });
  $$('[data-stagger]').forEach(function (el) { io.observe(el); });

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
     9. LISTA DE SISTEMAS (por área / grade / compacta)
     --------------------------------------------------------- */
  var track    = $('[data-track]');
  var chipsEl  = $('[data-chips]');
  var cards    = [];
  var VISTAS   = ['area', 'grade', 'compacta'];
  var vista    = 'area';
  var areaSel  = '';

  try {
    var salva = localStorage.getItem('lube_vista');
    if (VISTAS.indexOf(salva) > -1) vista = salva;
  } catch (e) {}

  function aplicarVista(v) {
    vista = v;
    try { localStorage.setItem('lube_vista', v); } catch (e) {}
    if (track) track.setAttribute('data-vista', v);
    $$('[data-vista-btn]').forEach(function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-vista-btn') === v ? 'true' : 'false');
    });
    layout();
  }

  /* Reordena (por área, se for o caso), renumera e põe os títulos de área. */
  function layout() {
    if (!track) return;
    $$('.grp', track).forEach(function (g) { g.remove(); });

    var rank = {}, n = 0;
    cards.forEach(function (c) { if (!(c._cat in rank)) rank[c._cat] = n++; });
    var ordem = cards.slice().sort(function (a, b) {
      if (vista === 'area' && rank[a._cat] !== rank[b._cat]) return rank[a._cat] - rank[b._cat];
      return a._i - b._i;
    });
    var mudou = ordem.some(function (c, i) { return track.children[i] !== c; });
    if (mudou) ordem.forEach(function (c) { track.appendChild(c); });

    var visiveis = ordem.filter(function (c) { return !c.classList.contains('is-hidden'); });
    var porArea = {};
    visiveis.forEach(function (c) { porArea[c._cat] = (porArea[c._cat] || 0) + 1; });

    var ultima = null;
    visiveis.forEach(function (c, i) {
      var num = $('.card__num', c);
      if (num) num.textContent = (i < 9 ? '0' : '') + (i + 1);
      if (vista === 'area' && c._cat !== ultima) {
        var g = document.createElement('div');
        g.className = 'grp';
        g.innerHTML = '<span class="grp__nome"></span><span class="grp__qtd mono"></span>';
        g.firstChild.textContent = c._cat || 'Outros';
        g.lastChild.textContent = porArea[c._cat] + (porArea[c._cat] === 1 ? ' sistema' : ' sistemas');
        track.insertBefore(g, c);
      }
      ultima = c._cat;
    });
  }

  function montarChips() {
    if (!chipsEl) return;
    var cats = [], cont = {};
    cards.forEach(function (c) {
      if (!(c._cat in cont)) { cont[c._cat] = 0; cats.push(c._cat); }
      cont[c._cat]++;
    });
    if (areaSel && !(areaSel in cont)) areaSel = '';
    chipsEl.innerHTML = '';
    chipsEl.hidden = cats.length < 2;
    [''].concat(cats).forEach(function (cat) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (cat === areaSel ? ' is-on' : '');
      b.setAttribute('data-area', cat);
      b.appendChild(document.createTextNode(cat || 'Todas'));
      var em = document.createElement('em');
      em.textContent = cat ? cont[cat] : cards.length;
      b.appendChild(em);
      chipsEl.appendChild(b);
    });
  }

  if (chipsEl) chipsEl.addEventListener('click', function (ev) {
    var b = ev.target.closest ? ev.target.closest('[data-area]') : null;
    if (!b) return;
    areaSel = b.getAttribute('data-area');
    $$('.chip', chipsEl).forEach(function (c) {
      c.classList.toggle('is-on', c.getAttribute('data-area') === areaSel);
    });
    filter(input ? input.value : '');
  });

  $$('[data-vista-btn]').forEach(function (b) {
    b.addEventListener('click', function () { aplicarVista(b.getAttribute('data-vista-btn')); });
  });

  /* ---------------------------------------------------------
     10. BUSCA / FILTRO
     --------------------------------------------------------- */
  var input    = $('[data-search]');
  var wrap     = input ? input.closest('.search') : null;
  var clearBtn = $('[data-search-clear]');
  var emptyEl  = $('[data-empty]');

  function norm(s) {
    var x = (s || '').normalize('NFD'), out = '', i, c;
    for (i = 0; i < x.length; i++) {           // remove acentos sem depender de escapes
      c = x.charCodeAt(i);
      if (c < 768 || c > 879) out += x.charAt(i);
    }
    return out.toLowerCase();
  }


  function filter(raw, quieto) {
    var term = norm(raw).trim();
    var hits = 0;

    cards.forEach(function (c) {
      var hit = (!term || term.split(/\s+/).every(function (w) { return c._hay.indexOf(w) > -1; })) &&
                (!areaSel || c._cat === areaSel);
      c.classList.toggle('is-hidden', !hit);
      if (hit) hits++;
    });

    if (wrap) wrap.classList.toggle('has-value', !!term);
    if (emptyEl) emptyEl.hidden = hits > 0;
    if (track) track.style.display = hits > 0 ? '' : 'none';

    if (hits > 0 && !reduced && !quieto) {        // re-anima os cartões que sobraram
      cards.filter(function (c) { return !c.classList.contains('is-hidden'); })
        .forEach(function (c, i) {
          c.classList.remove('is-new');
          void c.offsetWidth;
          c.style.animationDelay = (i * 60) + 'ms';
          c.classList.add('is-new');
        });
    }
    layout();
  }

  if (input) {
    input.addEventListener('input', function () { filter(input.value); });
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') { input.value = ''; filter(''); input.blur(); }
    });
  }
  if (clearBtn) clearBtn.addEventListener('click', function () {
    if (!input) return;
    input.value = ''; filter(''); input.focus();
  });
  $$('[data-suggest]').forEach(function (b) {
    b.addEventListener('click', function () {
      if (!input) return;
      input.value = b.getAttribute('data-suggest');
      filter(input.value);
      input.focus();
    });
  });

  /* ---------------------------------------------------------
     11. CARTÕES MAGNÉTICOS
     --------------------------------------------------------- */
  function magnetico() {
    if (reduced || !window.matchMedia('(pointer:fine)').matches) return;
    cards.forEach(function (card) {
      if (card._mag) return;
      card._mag = true;
      var go = $('.card__go', card);
      card.addEventListener('mousemove', function (ev) {
        var r = card.getBoundingClientRect();
        var mx = (ev.clientX - r.left) / r.width - 0.5;
        var my = (ev.clientY - r.top) / r.height - 0.5;
        card.style.transform = 'translateY(-6px) rotateX(' + (-my * 2.2).toFixed(2) + 'deg) rotateY(' + (mx * 2.6).toFixed(2) + 'deg)';
        if (go) go.style.transform = 'translate(' + (mx * 14).toFixed(1) + 'px,' + (my * 14).toFixed(1) + 'px)';
      });
      card.addEventListener('mouseleave', function () {
        card.style.transform = '';
        if (go) go.style.transform = '';
      });
    });
  }

  /* Relê os cartões depois que o portal.js os monta a partir do banco. */
  function indexCards() {
    cards = track ? $$('.card', track) : [];
    cards.forEach(function (c, i) {
      c._i = i;
      c._cat = c.getAttribute('data-cat') || '';
      c._hay = norm((c.getAttribute('data-keys') || '') + ' ' + c.textContent.replace(/\s+/g, ' '));
      c.style.transitionDelay = (Math.min(i, 12) * 55) + 'ms';
    });
    magnetico();
    montarChips();
    if (track) {
      track.setAttribute('data-vista', vista);
      requestAnimationFrame(function () { track.classList.add('in'); });
      setTimeout(function () {                    // o atraso só vale para a entrada, não para o hover
        cards.forEach(function (c) { c.style.transitionDelay = ''; });
      }, 1600);
    }
    $$('[data-vista-btn]').forEach(function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-vista-btn') === vista ? 'true' : 'false');
    });
    filter(input ? input.value : '', true);
  }

  window.LubePainel = { indexCards: indexCards };

  /* ---------------------------------------------------------
     12. CONTATOS DO TI (WhatsApp)
     --------------------------------------------------------- */
  var contact = $('[data-contact]');
  var contactBtn = $('[data-contact-toggle]');
  if (contact && contactBtn) {
    var setContact = function (open) {
      contact.classList.toggle('is-open', open);
      contactBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    };
    contactBtn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      setContact(!contact.classList.contains('is-open'));
    });
    document.addEventListener('click', function (ev) {
      if (!contact.contains(ev.target)) setContact(false);
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && contact.classList.contains('is-open')) {
        setContact(false);
        contactBtn.focus();
      }
    });
    $$('.contact__item', contact).forEach(function (a) {
      a.addEventListener('click', function () { setContact(false); });
    });
  }

  /* ---------------------------------------------------------
     13. DIVERSOS
     --------------------------------------------------------- */
  var yr = $('[data-year]');
  if (yr) yr.textContent = new Date().getFullYear();

  $$('[data-nav]').forEach(function (a) {
    a.addEventListener('click', function (ev) {
      var id = a.getAttribute('href');
      if (id && id.charAt(0) === '#') {
        var t = document.querySelector(id);
        if (t) { ev.preventDefault(); t.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' }); }
      }
    });
  });
})();
