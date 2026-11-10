/* =========================================================
   LUBE WORK — entrada (2026-11-10, aprovada pelo Júlio pela prévia)
   O nome grande aparece ("LUBE WORK", ou "LUBE TEXTO / PLANILHA / SLIDES"
   com o ícone do editor), a bolinha da IA passa por cima apagando as letras
   e abre o sistema num círculo que nasce dela.
   A animação corre junto com o carregamento: se os dados chegam antes, o
   sistema abre no fim da passagem; se demoram, a bolinha espera pulsando
   no fim do nome com o aviso embaixo.

   Liga sozinha pelo atributo do script:
     <script src="entrada.js" data-entrada="drive"></script>   (index.html)
     <script src="entrada.js" data-entrada="editor"></script>  (editor.html)
   e deixa o controle em window.LW_ENTRADA:
     .liberar(fn)  os dados chegaram: abre (fn roda quando o círculo começa a abrir)
     .encerrar()   tira na hora (bloqueio, erro)
     .sub(texto)   troca a linha de baixo (o nome do arquivo, no editor)
   ========================================================= */
(function () {
  'use strict';

  var NOMES = { work: ['LUBE', 'WORK'], doc: ['LUBE', 'TEXTO'], plan: ['LUBE', 'PLANILHA'], apre: ['LUBE', 'SLIDES'] };
  var CORES_FX = ['#FFFFFF', '#AFC0FF', '#6F86FF', '#FF5A62'];

  function c01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function faixa(t, a, b) { return c01((t - a) / (b - a)); }
  function saida3(x) { return 1 - Math.pow(1 - x, 3); }
  function vaivem3(x) { return x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }
  function volta(x) { var a = 1.70158, b = a + 1; return 1 + b * Math.pow(x - 1, 3) + a * Math.pow(x - 1, 2); }

  // tempos (em segundos) da versão completa e da curta (quem volta ao Lube Work logo depois)
  var COMPLETA = { letra: .42, passo: .035, ico: .5, sub: [.25, .65], orbe: [.52, .78], varre: [.8, 1.6], abre: .62 };
  var CURTA = { letra: .2, passo: .012, ico: .22, sub: [.05, .25], orbe: [.1, .28], varre: [.28, .8], abre: .5 };

  function letras(txt, cls) {
    return '<span class="lw-ent__palavra ' + cls + '">' +
      txt.split('').map(function (c) { return '<span>' + c + '</span>'; }).join('') + '</span>';
  }

  function fonteCarregada() {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    return Promise.race([
      document.fonts.load('italic 900 100px Archivo'),
      new Promise(function (ok) { setTimeout(ok, 700); })
    ]).catch(function () {});
  }

  function LubeEntrada(o) {
    o = o || {};
    var tipo = NOMES[o.tipo] ? o.tipo : 'work';
    var nome = NOMES[tipo];
    var vel = o.velocidade || 1;
    var T = o.rapido ? CURTA : COMPLETA;
    var calmo = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    var caixa = o.dentro || document.body;

    var raiz = document.createElement('div');
    raiz.className = 'lw-ent lw-ent--' + tipo + (o.dentro ? ' is-dentro' : '');
    raiz.setAttribute('aria-hidden', 'true');
    raiz.innerHTML =
      '<div class="lw-ent__tampa"><canvas class="lw-ent__fx"></canvas>' +
      '<div class="lw-ent__palco"><div class="lw-ent__bloco">' +
        '<div class="lw-ent__linha">' +
          (o.icone ? '<span class="lw-ent__ico">' + o.icone + '</span>' : '') +
          letras(nome[0], 'lw-ent__a') + letras(nome[1], 'lw-ent__b') +
        '</div>' +
        '<div class="lw-ent__sub' + (o.subArquivo ? ' lw-ent__sub--arquivo' : '') + '"></div>' +
      '</div></div></div>' +
      '<div class="lw-ent__anel"></div>' +
      '<div class="lw-ent__orbe"><i><u></u></i><b></b></div>' +
      '<div class="lw-ent__status"></div>';
    raiz.querySelector('.lw-ent__sub').textContent = o.sub || '';
    raiz.querySelector('.lw-ent__status').textContent = o.espera || 'Carregando';
    caixa.appendChild(raiz);

    var linha = raiz.querySelector('.lw-ent__linha');
    var spans = Array.prototype.slice.call(raiz.querySelectorAll('.lw-ent__palavra span'));
    var ico = raiz.querySelector('.lw-ent__ico');
    var sub = raiz.querySelector('.lw-ent__sub');
    var orbe = raiz.querySelector('.lw-ent__orbe');
    var cor = orbe.querySelector('u');   // as cores que giram dentro da bolinha
    var anel = raiz.querySelector('.lw-ent__anel');
    var status = raiz.querySelector('.lw-ent__status');
    var tela = raiz.querySelector('.lw-ent__fx');
    var tampa = raiz.querySelector('.lw-ent__tampa');
    var ctx = tela.getContext('2d');

    var liberado = false, encerrado = false, aoAbrir = o.aoAbrir || null;
    if (o.pronto) Promise.resolve(o.pronto).then(function () { liberado = true; }, function () { liberado = true; });

    // estado inicial das letras (antes do primeiro quadro)
    spans.forEach(function (s) { s.style.opacity = '0'; });
    if (ico) ico.style.opacity = '0';
    sub.style.opacity = '0';

    var G = {};   // medidas
    function medir() {
      var cx = caixa.getBoundingClientRect();
      var W = o.dentro ? cx.width : innerWidth, H = o.dentro ? cx.height : innerHeight;
      // o tamanho do nome deixa espaço dos dois lados para a bolinha nascer antes da
      // primeira letra e parar depois da última sem sair da tela (LUBE PLANILHA é o mais comprido)
      var base = Math.min(170, W * .14, H * .3);
      linha.style.setProperty('--fs', base + 'px');
      var prop = linha.scrollWidth / base;
      var fs = Math.min(base, (W - 40) / (prop + 1.95));
      linha.style.setProperty('--fs', fs + 'px');
      var r = linha.getBoundingClientRect();
      var ox = o.dentro ? cx.left : 0, oy = o.dentro ? cx.top : 0;
      G.W = W; G.H = H;
      G.esq = r.left - ox; G.dir = r.right - ox;
      G.y = r.top - oy + r.height * .5;
      G.d = Math.round(fs * .86);
      G.x0 = G.esq - G.d * .58;   // nasce antes da primeira letra
      G.x1 = G.dir + G.d * .26;   // para logo depois da última (a faixa que apaga já passou dela)
      orbe.style.setProperty('--d', G.d + 'px');
      linha.style.setProperty('--suave', Math.round(G.d * .5) + 'px');
      var dpr = Math.min(devicePixelRatio || 1, 2);
      tela.width = W * dpr; tela.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      raiz.classList.add('is-medido');
    }

    var faiscas = [];
    function soltarFaiscas(x, y, dt) {
      var n = Math.round(90 * dt * (o.rapido ? .7 : 1)) + (Math.random() < .5 ? 1 : 0);
      for (var i = 0; i < n; i++) {
        faiscas.push({
          x: x - G.d * (.25 + Math.random() * .2), y: y + (Math.random() - .5) * G.d * .8,
          vx: -(40 + Math.random() * 140), vy: (Math.random() - .5) * 90,
          vida: 0, dura: .45 + Math.random() * .5, r: .8 + Math.random() * 2.2,
          cor: CORES_FX[(Math.random() * CORES_FX.length) | 0]
        });
      }
    }
    function desenharFx(dt, xOrbe, rastro) {
      ctx.clearRect(0, 0, G.W, G.H);
      // um risco fino de cometa atrás da bolinha (afina até sumir)
      if (rastro > 0) {
        var ini = Math.max(G.x0 - G.d * .2, xOrbe - G.d * 2.6);
        var g = ctx.createLinearGradient(ini, 0, xOrbe, 0);
        g.addColorStop(0, 'rgba(111,134,255,0)');
        g.addColorStop(.7, 'rgba(111,134,255,' + (.22 * rastro) + ')');
        g.addColorStop(1, 'rgba(255,120,128,' + (.42 * rastro) + ')');
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = g;
        ctx.shadowColor = 'rgba(111,134,255,.7)'; ctx.shadowBlur = G.d * .25;
        var h = G.d * .11;
        ctx.beginPath();
        ctx.moveTo(ini, G.y);
        ctx.quadraticCurveTo(xOrbe - G.d * .6, G.y - h, xOrbe, G.y - h);
        ctx.lineTo(xOrbe, G.y + h);
        ctx.quadraticCurveTo(xOrbe - G.d * .6, G.y + h, ini, G.y);
        ctx.fill();
        ctx.restore();
      }
      for (var i = faiscas.length - 1; i >= 0; i--) {
        var f = faiscas[i];
        f.vida += dt;
        if (f.vida >= f.dura) { faiscas.splice(i, 1); continue; }
        f.x += f.vx * dt; f.y += f.vy * dt; f.vx *= .97; f.vy *= .97;
        ctx.globalAlpha = (1 - f.vida / f.dura) * .9;
        ctx.fillStyle = f.cor;
        ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    function porOrbe(x, y, esc, alfa) {
      orbe.style.transform = 'translate(' + (x - G.d / 2) + 'px,' + (y - G.d / 2) + 'px) scale(' + esc + ')';
      orbe.style.opacity = alfa;
    }

    function encerrar() {
      if (encerrado) return;
      encerrado = true;
      if (raiz.parentNode) raiz.parentNode.removeChild(raiz);
      if (o.aoFim) o.aoFim();
    }
    function abrirAgora() {
      var fn = aoAbrir; aoAbrir = null;
      if (fn) { try { fn(); } catch (e) { setTimeout(function () { throw e; }); } }
    }

    var ctl = {
      liberar: function (fn) { if (fn) aoAbrir = fn; liberado = true; if (encerrado) abrirAgora(); },
      encerrar: function () { abrirAgora(); encerrar(); },
      sub: function (texto) { sub.textContent = texto || ''; }
    };

    // sem movimento: só um fade quando estiver pronto
    if (calmo) {
      raiz.classList.add('is-medido');
      spans.forEach(function (s) { s.style.opacity = '1'; });
      if (ico) ico.style.opacity = '1';
      sub.style.opacity = '1';
      (function esperar() {
        if (encerrado) return;
        if (!liberado) { setTimeout(esperar, 60); return; }
        abrirAgora();
        raiz.style.transition = 'opacity .25s';
        raiz.style.opacity = '0';
        setTimeout(encerrar, 260);
      })();
      return ctl;
    }

    var t0 = 0, antes = 0, tEspera = 0, tAbre = -1, abriu = false, giro = 0;
    function quadro(agora) {
      if (encerrado) return;
      var dt = Math.min(.05, Math.max(0, agora - antes) / 1000) * vel;
      antes = agora;
      var t = Math.max(0, agora - t0) / 1000 * vel;
      giro = (giro + dt * (raiz.classList.contains('is-esperando') ? 420 : 160)) % 360;
      cor.style.transform = 'rotate(' + giro.toFixed(1) + 'deg)';

      // 1) o nome entra letra por letra
      spans.forEach(function (s, i) {
        var k = saida3(faixa(t, i * T.passo, i * T.passo + T.letra));
        s.style.opacity = k;
        s.style.transform = 'translateY(' + ((1 - k) * 42) + '%) skewX(' + ((1 - k) * -8) + 'deg)';
        s.style.filter = k < 1 ? 'blur(' + ((1 - k) * 10).toFixed(2) + 'px)' : 'none';
      });
      if (ico) {
        var ki = c01(t / T.ico);
        ico.style.opacity = c01(ki * 2);
        ico.style.transform = 'perspective(600px) rotateY(' + ((1 - volta(ki)) * -95) + 'deg) scale(' + (.55 + .45 * volta(ki)) + ')';
      }
      var ks = saida3(faixa(t, T.sub[0], T.sub[1]));

      // 2) a bolinha aparece antes do nome e passa por cima, apagando
      var kOrbe = faixa(t, T.orbe[0], T.orbe[1]);
      var kVarre = vaivem3(faixa(t, T.varre[0], T.varre[1]));
      var x = G.x0 + (G.x1 - G.x0) * kVarre;
      var y = G.y;
      linha.style.setProperty('--apaga', (x - G.esq - G.d * .22) + 'px');
      // a linha de baixo vai junto: some enquanto a bolinha passa
      var kSomeSub = faixa(kVarre, .35, .85);
      sub.style.opacity = ks * (1 - kSomeSub);
      sub.style.transform = 'translateY(' + ((1 - ks) * 10 + kSomeSub * 6) + 'px)';

      var noFim = t >= T.varre[1];
      if (noFim && !liberado) {
        // 3a) ainda carregando: a bolinha espera pulsando no fim do nome
        if (!tEspera) tEspera = t;
        raiz.classList.toggle('is-esperando', t - tEspera > .3);
        var meia = status.offsetWidth / 2 + 16;
        status.style.left = Math.max(meia, Math.min(G.W - meia, x)) + 'px';
        status.style.top = (y + G.d * .5 + 22) + 'px';
      }
      if (noFim && liberado && tAbre < 0) { tAbre = t; raiz.classList.remove('is-esperando'); }

      var esc = .2 + .8 * volta(kOrbe), alfa = c01(kOrbe * 1.6);
      if (!noFim || tAbre < 0) {
        var pulso = noFim ? 1 + Math.sin((t - tEspera) * 5.2) * .05 : 1;
        porOrbe(x, y, esc * pulso, alfa);
        if (kVarre > 0 && kVarre < 1) soltarFaiscas(x, y, dt);
        desenharFx(dt, x, kVarre > 0 ? (1 - faixa(t, T.varre[1] - .05, T.varre[1] + .35)) : 0);
        requestAnimationFrame(quadro);
        return;
      }

      // 3b) abre o sistema num círculo que nasce da bolinha (ela cresce por cima e some)
      if (!abriu) { abriu = true; abrirAgora(); }
      var k = c01((t - tAbre) / T.abre);
      var raioMax = Math.sqrt(Math.pow(Math.max(x, G.W - x), 2) + Math.pow(Math.max(y, G.H - y), 2)) + 40;
      var R = vaivem3(k) * raioMax;
      var masc = 'radial-gradient(circle at ' + x + 'px ' + y + 'px, transparent ' + R + 'px, #000 ' + (R + 1.5) + 'px)';
      tampa.style.webkitMaskImage = masc;
      tampa.style.maskImage = masc;
      anel.style.width = anel.style.height = (R * 2) + 'px';
      anel.style.transform = 'translate(' + (x - R) + 'px,' + (y - R) + 'px)';
      anel.style.opacity = (1 - k) * .9;
      porOrbe(x, y, 1 + 1.1 * saida3(k), 1 - faixa(k, .1, .5));
      desenharFx(dt, x, 0);
      if (k >= 1) { encerrar(); return; }
      requestAnimationFrame(quadro);
    }

    fonteCarregada().then(function () {
      if (encerrado) return;
      medir();
      t0 = antes = performance.now();
      requestAnimationFrame(quadro);
    });
    addEventListener('resize', function () { if (!encerrado) medir(); });

    return ctl;
  }
  window.LubeEntrada = LubeEntrada;

  /* ---------- liga sozinha no Drive e no editor ---------- */
  var eu = document.currentScript;
  var onde = eu && eu.getAttribute('data-entrada');
  if (!onde || !document.body) return;
  var q = new URLSearchParams(location.search);

  if (onde === 'drive') {
    // quem voltou ao Lube Work há menos de 20 minutos (neste aparelho) vê a versão curta
    var rapido = false;
    try {
      var ult = +localStorage.getItem('lw_entrada_em') || 0;
      rapido = Date.now() - ult < 20 * 60 * 1000;
      localStorage.setItem('lw_entrada_em', String(Date.now()));
    } catch (e) {}
    window.LW_ENTRADA = LubeEntrada({
      tipo: 'work', rapido: rapido, sub: 'Texto · Planilha · Slides · Agendas', espera: 'Carregando seus arquivos'
    });
    return;
  }

  if (onde === 'editor') {
    // o tipo vem do endereço (?ext=docx), que o Drive põe ao abrir; sem ele, LUBE WORK
    var ext = String(q.get('ext') || '').toLowerCase();
    var t = /^(docx?|odt|rtf|txt)$/.test(ext) ? 'doc' : /^(xlsx?|ods|csv)$/.test(ext) ? 'plan' : /^(pptx?|odp)$/.test(ext) ? 'apre' : 'work';
    var ICO = { doc: ['#5D7BFF', '#1E2B8C'], plan: ['#2FD486', '#0B7A44'], apre: ['#FF7048', '#C20D1A'] };
    var SIMB = {
      doc: '<rect x="10" y="10.5" width="12" height="3.4" rx="1.7" fill="#fff"/><rect x="10" y="16.6" width="18" height="2.5" rx="1.25" fill="#fff" fill-opacity=".92"/><rect x="10" y="21.3" width="18" height="2.5" rx="1.25" fill="#fff" fill-opacity=".92"/><rect x="10" y="26" width="11" height="2.5" rx="1.25" fill="#fff" fill-opacity=".92"/>',
      plan: '<rect x="9.5" y="10" width="19" height="16.5" rx="2.6" fill="none" stroke="#fff" stroke-width="2"/><path d="M9.5 12.6a2.6 2.6 0 0 1 2.6-2.6h13.8a2.6 2.6 0 0 1 2.6 2.6V15h-19Z" fill="#fff"/><path d="M9.5 20.7h19M15.8 15v11.5M22.2 15v11.5" stroke="#fff" stroke-width="1.8"/>',
      apre: '<rect x="8.5" y="10" width="21" height="14.5" rx="2.4" fill="none" stroke="#fff" stroke-width="2"/><path d="M13 21v-2.6M17 21v-5.2M21 21v-3.6M25 21v-7" stroke="#fff" stroke-width="2.1" stroke-linecap="round"/><path d="M19 24.5v3.6M15 28.6h8" stroke="#fff" stroke-width="2" stroke-linecap="round"/>'
    };
    // o mesmo ícone de aplicativo do Drive (comum.js, iconeApp), em tamanho grande
    var icone = ICO[t] ? '<svg viewBox="0 0 40 40" aria-hidden="true"><defs><linearGradient id="lw-ent-ico" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0" stop-color="' + ICO[t][0] + '"/><stop offset="1" stop-color="' + ICO[t][1] + '"/></linearGradient></defs>' +
      '<rect x="3" y="3" width="34" height="34" rx="9.5" fill="url(#lw-ent-ico)"/>' +
      '<path d="M3 12.5A9.5 9.5 0 0 1 12.5 3h15A9.5 9.5 0 0 1 37 12.5v2.7C27.5 12.4 12.5 12.6 3 18.2Z" fill="#fff" fill-opacity=".14"/>' + SIMB[t] +
      '<g transform="translate(26 26)"><rect width="11.5" height="11.5" rx="3.4" fill="#fff"/>' +
      '<g transform="translate(2.9 2.5) scale(.064) skewX(-10)"><path fill="#1E2B8C" d="M24 6h34v56h42c6 0 10 4 10 10v12c0 10-8 18-18 18H24C12 102 4 94 4 82V26C4 14 12 6 24 6Z"/>' +
      '<path fill="#EE1B24" d="M68 6h36c6 0 10 4 10 10v32c0 3-2 4-5 4H68Z"/></g></g></svg>' : '';
    var nomeArq = q.get('nome') ? q.get('nome') + (ext ? '.' + ext : '') : '';
    window.LW_ENTRADA = LubeEntrada({
      tipo: t, icone: icone, sub: nomeArq, subArquivo: true, espera: 'Abrindo o editor'
    });
  }
})();
