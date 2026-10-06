/* =========================================================
   SENTINELA LUBE — globo 3D (globe.gl 2.46.2, three embutido)
   Um ponto por IP, arco animado de cada ponto até a Lube,
   anel azul na casa e anel vermelho em bloqueio novo.
   O globe.gl liga os dados por referência: os objetos são
   reaproveitados entre atualizações (a fase do tracejado
   fica guardada no próprio arco e não "pula").
   ========================================================= */
(function () {
  'use strict';

  var SNT = window.SNT = window.SNT || {};
  var U = SNT.u;

  var COR_GLOBO = '#0d1830';
  var COR_PAIS = '#22305e';
  var COR_PAIS_ATIVO = '#1e3a7a';
  var COR_ATMOSFERA = '#2a41c8';
  var MAX_ARCOS = 300;

  // tracejado anda do visitante até a Lube: começo apagado, chegada acesa
  var ARCO = {
    bloqueado: ['rgba(255,107,116,0.08)', 'rgba(255,107,116,1)'],
    observado: ['rgba(255,179,64,0.08)', 'rgba(255,179,64,1)'],
    analise:   ['rgba(95,178,255,0.08)', 'rgba(95,178,255,1)'],
    seguro:    ['rgba(95,178,255,0.55)', 'rgba(52,232,158,1)']
  };
  var RGB_CASA = '95,150,255';
  var RGB_BLOQUEIO = '255,107,116';

  // Natural Earth marca França e Noruega com -99
  var CORRIGE_ISO = { FRA: 'FR', NOR: 'NO' };
  function isoPais(f) {
    var p = f.properties || {};
    var a = p.ISO_A2;
    if (!a || a === '-99') a = CORRIGE_ISO[p.ADM0_A3] || (p.WB_A2 && p.WB_A2 !== '-99' ? p.WB_A2 : '');
    return a;
  }

  function suportado() {
    try {
      var c = document.createElement('canvas');
      return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
    } catch (e) { return false; }
  }

  function distanciaKm(lat1, lon1, lat2, lon2) {
    var r = Math.PI / 180;
    var a = Math.sin((lat2 - lat1) * r / 2), b = Math.sin((lon2 - lon1) * r / 2);
    var h = a * a + Math.cos(lat1 * r) * Math.cos(lat2 * r) * b * b;
    return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function rotulo(p) {
    var st = U.status(p.status);
    var fora = (p.pais || '').toUpperCase() !== 'BR';
    return '<div class="gl-rot">' +
      '<div class="gl-rot__local"><span class="flag">' + U.bandeira(p.pais) + '</span> ' +
        U.esc(U.local(p)) + (fora && p.cidade ? ' · ' + U.esc(U.nomePais(p.pais)) : '') + '</div>' +
      '<div class="gl-rot__ip mono">' + U.esc(p.ip) + '</div>' +
      '<div class="gl-rot__st" style="color:' + st.cor + '">' + st.icone + ' ' + st.nome + '</div>' +
      '<div class="gl-rot__n mono">' + U.num(p.total) + ' acessos · ' + U.esc(U.ha(p.ultimo)) + '</div>' +
    '</div>';
  }

  function criar(el, op) {
    op = op || {};
    var casa = { lat: -20.2632, lon: -40.4165, nome: 'Lube Distribuidora · Cariacica-ES' };
    var pontos = {};          // ip → ponto (mesmo objeto a vida toda)
    var aneis = [];
    var paisesAtivos = {};
    var chavePaises = '';
    var pausado = false;
    var reduzir = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    var g = new window.Globe(el, { rendererConfig: { antialias: true, alpha: true }, animateIn: !reduzir });

    g.backgroundColor('rgba(0,0,0,0)')
      .showAtmosphere(true)
      .atmosphereColor(COR_ATMOSFERA)
      .atmosphereAltitude(0.2)
      .showGraticules(false);

    var mat = g.globeMaterial();
    mat.color.set(COR_GLOBO);
    if (mat.emissive) mat.emissive.set('#060d22');
    if ('shininess' in mat) mat.shininess = 6;

    /* ---- países em hexágonos ---- */
    function corPais(f) { return paisesAtivos[isoPais(f)] ? COR_PAIS_ATIVO : COR_PAIS; }
    g.hexPolygonResolution(3)
      .hexPolygonMargin(0.32)
      .hexPolygonAltitude(0.004)
      .hexPolygonColor(corPais);
    fetch('dados/paises.geojson').then(function (r) { return r.json(); }).then(function (geo) {
      g.hexPolygonsData((geo.features || []).filter(function (f) { return isoPais(f) !== 'AQ'; }));
    }).catch(function () { /* sem países o globo continua útil */ });

    /* ---- pontos ---- */
    g.pointLat('lat').pointLng('lon')
      .pointColor(function (p) { return U.status(p.status).cor; })
      .pointAltitude(function (p) { return p._alt; })
      .pointRadius(function (p) { return p._raio; })
      .pointResolution(12)
      .pointsMerge(false)
      .pointsTransitionDuration(500)
      .pointLabel(rotulo)
      .onPointClick(function (p) { if (op.aoClicar) op.aoClicar(p.ip); })
      .onPointHover(function (p) { el.style.cursor = p ? 'pointer' : ''; });

    /* ---- arcos até a casa ---- */
    g.arcStartLat('lat1').arcStartLng('lon1').arcEndLat('lat2').arcEndLng('lon2')
      .arcColor(function (a) { return ARCO[a.status] || ARCO.seguro; })
      .arcStroke(function (a) { return a.status === 'bloqueado' ? 0.55 : 0.3; })
      .arcAltitudeAutoScale(0.36)
      .arcCurveResolution(48)
      .arcDashLength(0.38)
      .arcDashGap(1.3)
      .arcDashInitialGap(function (a) { return a.fase; })
      .arcDashAnimateTime(function (a) { return reduzir ? 0 : a.tempo; })
      .arcsTransitionDuration(0)
      .arcLabel(function () { return ''; });

    /* ---- anéis ---- */
    g.ringLat('lat').ringLng('lon')
      .ringColor(function (r) { return function (t) { return 'rgba(' + r.rgb + ',' + Math.max(0, 1 - t).toFixed(3) + ')'; }; })
      .ringMaxRadius('max')
      .ringPropagationSpeed('vel')
      .ringRepeatPeriod('periodo')
      .ringAltitude(0.006);

    /* ---- marcador da casa (HTML) ---- */
    var elCasa = document.createElement('div');
    elCasa.className = 'gl-casa';
    elCasa.innerHTML = '<span class="gl-casa__ponto"></span><span class="gl-casa__nome">LUBE · Cariacica</span>';
    var $nome = elCasa.querySelector('.gl-casa__nome');
    var objCasa = { lat: casa.lat, lon: casa.lon };
    var anelCasa = { lat: casa.lat, lon: casa.lon, rgb: RGB_CASA, max: 4.2, vel: 1.5, periodo: 1500, casa: true };
    aneis.push(anelCasa);
    g.htmlLat('lat').htmlLng('lon').htmlAltitude(0.012)
      .htmlElement(function () { return elCasa; })
      .htmlTransitionDuration(0)
      .htmlElementVisibilityModifier(function (e, visivel) { e.style.opacity = visivel ? '1' : '0'; })
      .htmlElementsData([objCasa]);
    g.ringsData(aneis.slice());

    // enquadramento inicial pela largura real: criado num módulo oculto (largura 0), espera aparecer
    var povFeito = false;
    function povInicial() {
      if (povFeito || el.clientWidth <= 0) return;
      povFeito = true;
      g.pointOfView({ lat: -6, lng: -32, altitude: el.clientWidth < 600 ? 2.5 : 1.95 }, 0);
    }

    /* ---- rotação lenta que para enquanto o usuário mexe ---- */
    var ctl = g.controls();
    var retorno = null;
    ctl.autoRotate = !reduzir;
    ctl.autoRotateSpeed = 0.32;
    // a roda do mouse rola a página; aproximar só com Ctrl (ou ⌘) + roda. No toque, pinça normal.
    var toque = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    ctl.enableZoom = !!toque;
    el.addEventListener('wheel', function (e) {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      var pov = g.pointOfView();
      var alt = Math.max(0.7, Math.min(4, pov.altitude * (e.deltaY > 0 ? 1.12 : 0.89)));
      g.pointOfView({ lat: pov.lat, lng: pov.lng, altitude: alt }, 0);
    }, { passive: false });
    ctl.addEventListener('start', function () { ctl.autoRotate = false; clearTimeout(retorno); });
    ctl.addEventListener('end', function () {
      clearTimeout(retorno);
      if (!reduzir) retorno = setTimeout(function () { ctl.autoRotate = true; }, 6000);
    });

    /* ---- tamanho: o globe.gl não escuta resize ---- */
    function medir() {
      var w = el.clientWidth, h = el.clientHeight;
      if (w > 0 && h > 0) { g.width(w).height(h); povInicial(); }
    }
    medir();
    if (window.ResizeObserver) new ResizeObserver(medir).observe(el);
    else window.addEventListener('resize', medir);

    /* ---- montagem ---- */
    function calcular(p) {
      var n = Math.log10(1 + (+p.total || 0));
      p._raio = 0.2 + Math.min(0.6, n * 0.2);
      p._alt = 0.012 + Math.min(0.1, n * 0.028);
    }

    function prioridade(p) { return U.status(p.status).peso * 1e13 + (new Date(p.ultimo).getTime() || 0); }

    function redesenhar() {
      var lista = Object.keys(pontos).map(function (k) { return pontos[k]; });
      lista.forEach(calcular);

      var arcos = [];
      lista.slice().sort(function (a, b) { return prioridade(b) - prioridade(a); }).forEach(function (p) {
        if (arcos.length >= MAX_ARCOS) return;
        if (distanciaKm(p.lat, p.lon, casa.lat, casa.lon) < 60) return; // quem está na casa não tem arco
        if (!p._arco) p._arco = { fase: Math.random() * 1.6, tempo: 2400 + Math.random() * 2600 };
        var a = p._arco;
        a.lat1 = p.lat; a.lon1 = p.lon; a.lat2 = casa.lat; a.lon2 = casa.lon; a.status = p.status;
        arcos.push(a);
      });

      var ativos = {};
      lista.forEach(function (p) { if (p.pais) ativos[String(p.pais).toUpperCase()] = true; });
      var chave = Object.keys(ativos).sort().join(',');
      if (chave !== chavePaises) {
        chavePaises = chave;
        paisesAtivos = ativos;
        g.hexPolygonColor(function (f) { return corPais(f); });
      }

      g.pointsData(lista);
      g.arcsData(arcos);
      return { pontos: lista.length, arcos: arcos.length };
    }

    // "Lube Distribuidora · Cariacica-ES" → "LUBE · Cariacica"
    function rotuloCasa(nome) {
      var partes = String(nome || '').split('·');
      var lugar = (partes.length > 1 ? partes[partes.length - 1] : '').trim().replace(/-[A-Z]{2}$/, '');
      return 'LUBE' + (lugar ? ' · ' + lugar : '');
    }

    function definirCasa(c) {
      if (!c || c.lat == null || c.lon == null) return;
      if (c.nome) $nome.textContent = rotuloCasa(c.nome);
      if (+c.lat === casa.lat && +c.lon === casa.lon) return;
      casa = { lat: +c.lat, lon: +c.lon, nome: c.nome };
      objCasa.lat = casa.lat; objCasa.lon = casa.lon;
      anelCasa.lat = casa.lat; anelCasa.lon = casa.lon;
      g.htmlElementsData([objCasa]);
      g.ringsData(aneis.slice());
    }

    // lista completa vinda de sentinela_painel (pontos por IP)
    function atualizar(lista, c) {
      definirCasa(c);
      var vistos = {};
      (lista || []).forEach(function (x) {
        if (x.lat == null || x.lon == null || !x.ip) return;
        var p = pontos[x.ip] || (pontos[x.ip] = { ip: x.ip });
        p.lat = +x.lat; p.lon = +x.lon;
        p.cidade = x.cidade; p.regiao = x.regiao; p.pais = x.pais;
        p.total = +x.total || 0; p.bloqueados = +x.bloqueados || 0; p.observados = +x.observados || 0;
        p.status = x.status || 'seguro'; p.risco = +x.risco || 0; p.ultimo = x.ultimo;
        vistos[x.ip] = true;
      });
      Object.keys(pontos).forEach(function (ip) { if (!vistos[ip]) delete pontos[ip]; });
      return redesenhar();
    }

    // eventos novos (sentinela_novos): soma no ponto e acende anel no bloqueio
    function eventos(lista) {
      var mexeu = false;
      (lista || []).forEach(function (ev) {
        if (ev.lat == null || ev.lon == null || !ev.ip) return;
        var p = pontos[ev.ip];
        if (!p) {
          p = pontos[ev.ip] = { ip: ev.ip, lat: +ev.lat, lon: +ev.lon, cidade: ev.cidade, regiao: ev.regiao,
                                pais: ev.pais, total: 0, bloqueados: 0, observados: 0, status: 'seguro', risco: 0 };
        }
        p.total++;
        p.ultimo = ev.criado_em;
        p.risco = Math.max(p.risco || 0, +ev.risco || 0);
        var st = ev.decisao === 'bloqueado' ? 'bloqueado' : ev.decisao === 'observado' ? 'observado' : null;
        if (st === 'bloqueado') p.bloqueados++;
        if (st === 'observado') p.observados++;
        if (st && U.status(st).peso > U.status(p.status).peso) p.status = st;
        if (ev.decisao === 'bloqueado') alertar(ev.lat, ev.lon, ev.criado_em);
        mexeu = true;
      });
      if (mexeu) redesenhar();
    }

    // anel vermelho na origem de um bloqueio, por 60 s a partir do evento
    function alertar(lat, lon, quando) {
      var t = new Date(quando).getTime() || Date.now();
      if (Date.now() - t > 60000) return;
      var perto = aneis.filter(function (r) {
        return !r.casa && Math.abs(r.lat - lat) < 0.3 && Math.abs(r.lon - lon) < 0.3;
      })[0];
      if (perto) { perto.expira = Math.max(perto.expira, t + 60000); return; }
      aneis.push({ lat: +lat, lon: +lon, rgb: RGB_BLOQUEIO, max: 5.5, vel: 3.2, periodo: 850, expira: t + 60000 });
      g.ringsData(aneis.slice());
    }
    setInterval(function () {
      var antes = aneis.length;
      aneis = aneis.filter(function (r) { return r.casa || r.expira > Date.now(); });
      if (aneis.length !== antes) g.ringsData(aneis.slice());
    }, 4000);

    function pausar() { if (!pausado) { pausado = true; g.pauseAnimation(); } }
    function retomar() { if (pausado) { pausado = false; medir(); g.resumeAnimation(); } }

    return {
      atualizar: atualizar, eventos: eventos, alertar: alertar,
      pausar: pausar, retomar: retomar, medir: medir, instancia: g,
      contagem: function () { return Object.keys(pontos).length; }
    };
  }

  SNT.globo = { suportado: suportado, criar: criar, MAX_ARCOS: MAX_ARCOS };
})();
