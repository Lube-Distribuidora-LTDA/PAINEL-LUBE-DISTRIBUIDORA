/* =========================================================
   SENTINELA LUBE — utilidades do painel
   Escape de HTML, números e horas em pt-BR (America/Sao_Paulo),
   bandeira e nome do país, leitura do user-agent.
   ========================================================= */
(function () {
  'use strict';

  var SNT = window.SNT = window.SNT || {};
  var FUSO = 'America/Sao_Paulo';

  var fmtNum  = new Intl.NumberFormat('pt-BR');
  var fmtDec  = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  var fmtHora = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit' });
  var fmtSeg  = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  var fmtData = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, day: '2-digit', month: '2-digit',
                                                   hour: '2-digit', minute: '2-digit' });
  var fmtDia  = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, day: '2-digit', month: '2-digit' });
  var fmtPartes = new Intl.DateTimeFormat('en-US', { timeZone: FUSO, weekday: 'short', hour: '2-digit',
                                                     hour12: false });
  var nomes = null;
  try { nomes = new Intl.DisplayNames(['pt-BR'], { type: 'region' }); } catch (e) { nomes = null; }

  /* ---------- texto ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function corta(s, n) {
    s = String(s == null ? '' : s);
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }
  // texto já escapado, com cada número em JetBrains Mono ("pico às 10:00 com 61")
  function numeros(s) {
    return String(s == null ? '' : s).split(/(\d+(?:[.,:/]\d+)*%?)/).map(function (p, i) {
      return i % 2 ? '<span class="mono">' + esc(p) + '</span>' : esc(p);
    }).join('');
  }

  /* ---------- números ---------- */
  function num(n) { return fmtNum.format(Math.round(+n || 0)); }
  // "1 ativo", "3 ativos"
  function qtd(n, um, varios) { return num(n) + ' ' + (Math.round(+n || 0) === 1 ? um : varios); }
  function pct(v, total) {
    if (!total) return '0%';
    var p = (v / total) * 100;
    if (p > 0 && p < 0.1) return '< 0,1%';
    return fmtDec.format(p).replace(/,0$/, '') + '%';
  }
  function pct01(v) { // 0,85 → 85%
    if (v == null || isNaN(+v)) return '—';
    return fmtNum.format(Math.round(+v * 100)) + '%';
  }

  /* ---------- horas (sempre no horário de Brasília) ---------- */
  function d(iso) { var x = iso instanceof Date ? iso : new Date(iso); return isNaN(x) ? null : x; }
  function hora(iso)     { var x = d(iso); return x ? fmtHora.format(x) : '—'; }
  function horaSeg(iso)  { var x = d(iso); return x ? fmtSeg.format(x) : '—'; }
  function dataHora(iso) { var x = d(iso); return x ? fmtData.format(x).replace(',', '') : '—'; }
  function dia(iso)      { var x = d(iso); return x ? fmtDia.format(x) : '—'; }

  // "14:32" se for hoje; "06/10 14:32" se for outro dia
  function curta(iso) {
    var x = d(iso);
    if (!x) return '—';
    return (dia(x) === dia(new Date()) ? '' : dia(x) + ' ') + hora(x);
  }
  // prazo de bloqueio: como curta(); null = permanente
  function ate(iso) { return iso ? curta(iso) : 'permanente'; }

  function ha(iso, agora) {
    var x = d(iso);
    if (!x) return 'nunca';
    var s = Math.round(((agora || Date.now()) - x.getTime()) / 1000);
    if (s < 5) return 'agora';
    if (s < 60) return 'há ' + s + ' s';
    var m = Math.floor(s / 60);
    if (m < 60) return 'há ' + m + ' min';
    var h = Math.floor(m / 60);
    if (h < 48) return 'há ' + h + ' h';
    return 'há ' + Math.floor(h / 24) + ' d';
  }

  // seg a sáb, 7h às 19h em Cariacica
  function horarioComercial(agora) {
    var p = {};
    fmtPartes.formatToParts(agora || new Date()).forEach(function (x) { p[x.type] = x.value; });
    var h = +p.hour % 24;
    return p.weekday !== 'Sun' && h >= 7 && h < 19;
  }

  /* ---------- país ---------- */
  function bandeira(cc) {
    cc = String(cc || '').toUpperCase();
    if (!/^[A-Z]{2}$/.test(cc)) return '🌐';
    return String.fromCodePoint(0x1F1E6 + cc.charCodeAt(0) - 65, 0x1F1E6 + cc.charCodeAt(1) - 65);
  }
  function nomePais(cc) {
    cc = String(cc || '').toUpperCase();
    if (!/^[A-Z]{2}$/.test(cc)) return 'País desconhecido';
    try { return (nomes && nomes.of(cc)) || cc; } catch (e) { return cc; }
  }
  // "Cariacica/ES" no Brasil; "Lisboa · Portugal" fora
  function local(v) {
    var cidade = v.cidade || '';
    if ((v.pais || '').toUpperCase() === 'BR') {
      return (cidade || 'Brasil') + (v.regiao ? '/' + v.regiao : '');
    }
    return cidade || nomePais(v.pais);
  }

  /* ---------- user-agent ---------- */
  var ROBOS = [
    ['sqlmap', 'sqlmap'], ['nikto', 'nikto'], ['nmap', 'nmap'], ['masscan', 'masscan'], ['zgrab', 'zgrab'],
    ['nuclei', 'nuclei'], ['wpscan', 'wpscan'], ['gobuster', 'gobuster'], ['ffuf', 'ffuf'], ['hydra', 'hydra'],
    ['acunetix', 'acunetix'], ['nessus', 'nessus'], ['whatweb', 'whatweb'], ['wfuzz', 'wfuzz'],
    ['googlebot', 'Googlebot'], ['bingbot', 'Bingbot'], ['duckduckbot', 'DuckDuckBot'], ['yandexbot', 'YandexBot'],
    ['baiduspider', 'Baidu'], ['applebot', 'Applebot'], ['vercel-cron', 'Vercel Cron'],
    ['whatsapp', 'prévia WhatsApp'], ['telegrambot', 'prévia Telegram'], ['slackbot', 'prévia Slack'],
    ['facebookexternalhit', 'prévia Facebook'], ['discordbot', 'prévia Discord'],
    ['curl', 'curl'], ['wget', 'wget'], ['python-requests', 'python-requests'], ['python-urllib', 'python-urllib'],
    ['aiohttp', 'aiohttp'], ['httpx', 'httpx'], ['go-http-client', 'Go'], ['okhttp', 'okhttp'], ['java/', 'Java'],
    ['libwww', 'libwww'], ['axios', 'axios'], ['node-fetch', 'node-fetch'], ['undici', 'Node'],
    ['postmanruntime', 'Postman'], ['insomnia', 'Insomnia'], ['headlesschrome', 'Chrome sem tela'],
    ['phantomjs', 'PhantomJS'], ['scrapy', 'Scrapy'], ['httpclient', 'HttpClient'], ['powershell', 'PowerShell']
  ];

  function versao(ua, re) {
    var m = ua.match(re);
    return m ? ' ' + m[1] : '';
  }

  // devolve { texto, robo }
  function dispositivo(ua) {
    ua = String(ua || '');
    if (!ua.trim()) return { texto: 'robô: sem identificação', robo: true };
    var baixo = ua.toLowerCase();
    for (var i = 0; i < ROBOS.length; i++) {
      if (baixo.indexOf(ROBOS[i][0]) > -1) return { texto: 'robô: ' + ROBOS[i][1], robo: true };
    }
    var nav = 'Navegador';
    if (/Edg(e|A|iOS)?\//.test(ua)) nav = 'Edge' + versao(ua, /Edg(?:e|A|iOS)?\/(\d+)/);
    else if (/OPR\//.test(ua)) nav = 'Opera' + versao(ua, /OPR\/(\d+)/);
    else if (/SamsungBrowser\//.test(ua)) nav = 'Samsung Internet';
    else if (/Firefox\/|FxiOS\//.test(ua)) nav = 'Firefox' + versao(ua, /(?:Firefox|FxiOS)\/(\d+)/);
    else if (/Chrome\/|CriOS\//.test(ua)) nav = 'Chrome' + versao(ua, /(?:Chrome|CriOS)\/(\d+)/);
    else if (/Safari\//.test(ua) && /Version\//.test(ua)) nav = 'Safari' + versao(ua, /Version\/(\d+)/);

    var so = '';
    if (/Windows NT/.test(ua)) so = 'Windows';
    else if (/Android/.test(ua)) so = 'Android';
    else if (/iPhone/.test(ua)) so = 'iPhone';
    else if (/iPad/.test(ua)) so = 'iPad';
    else if (/CrOS/.test(ua)) so = 'ChromeOS';
    else if (/Mac OS X|Macintosh/.test(ua)) so = 'macOS';
    else if (/Linux/.test(ua)) so = 'Linux';
    return { texto: nav + (so ? ' · ' + so : ''), robo: false };
  }

  /* ---------- validação leve (o banco valida de verdade) ---------- */
  function ipOuCidr(v) {
    v = String(v || '').trim();
    var partes = v.split('/');
    if (partes.length > 2) return false;
    var ip = partes[0], bits = partes[1];
    var v4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(ip);
    var v6 = !v4 && /^[0-9a-f:.]+$/i.test(ip) && ip.indexOf(':') > -1;
    if (!v4 && !v6) return false;
    if (bits == null) return true;
    if (!/^\d{1,3}$/.test(bits)) return false;
    return +bits <= (v4 ? 32 : 128);
  }

  /* ---------- redes: "a rede A contém B?" (IPv4 e IPv6) ---------- */
  var B0 = BigInt(0), B16 = BigInt(16);
  function numIp(ip) {
    ip = String(ip || '').trim();
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
      var q = ip.split('.').map(Number);
      if (q.some(function (x) { return x > 255; })) return null;
      return { v: 4, n: BigInt(((q[0] << 24) >>> 0) + (q[1] << 16) + (q[2] << 8) + q[3]), w: 32 };
    }
    if (ip.indexOf(':') < 0) return null;
    var lados = ip.split('::');
    if (lados.length > 2) return null;
    function grupos(s) {
      if (!s) return [];
      var g = s.split(':'), r = [];
      for (var i = 0; i < g.length; i++) {
        if (i === g.length - 1 && g[i].indexOf('.') > -1) {
          var v4 = numIp(g[i]);
          if (!v4 || v4.v !== 4) return null;
          r.push(Number(v4.n >> B16), Number(v4.n & BigInt(0xffff)));
        } else if (/^[0-9a-f]{1,4}$/i.test(g[i])) r.push(parseInt(g[i], 16));
        else return null;
      }
      return r;
    }
    var a = grupos(lados[0]), b = lados.length > 1 ? grupos(lados[1]) : [];
    if (!a || !b) return null;
    var falta = 8 - a.length - b.length;
    if (lados.length === 1 ? falta !== 0 : falta < 1) return null;
    var todos = a.concat(new Array(lados.length > 1 ? falta : 0).fill(0), b);
    var n = B0;
    todos.forEach(function (x) { n = (n << B16) | BigInt(x); });
    return { v: 6, n: n, w: 128 };
  }
  function rede(valor) {
    var p = String(valor || '').trim().split('/');
    var x = numIp(p[0]);
    if (!x || p.length > 2) return null;
    var bits = p.length > 1 ? +p[1] : x.w;
    if (!(bits >= 0 && bits <= x.w)) return null;
    x.bits = bits;
    return x;
  }
  // true se a rede "fora" (IP ou CIDR) contém inteira a rede/IP "dentro"
  function contem(fora, dentro) {
    var a = rede(fora), b = rede(dentro);
    if (!a || !b || a.v !== b.v || b.bits < a.bits) return false;
    var corte = BigInt(a.w - a.bits);
    return (a.n >> corte) === (b.n >> corte);
  }

  /* ---------- estados ---------- */
  var STATUS = {
    bloqueado: { cor: '#ff6b74', icone: '⛔', nome: 'Bloqueado', peso: 4 },
    observado: { cor: '#ffb340', icone: '👁', nome: 'Observado', peso: 3 },
    analise:   { cor: '#5fb2ff', icone: '🧠', nome: 'Em análise', peso: 2 },
    seguro:    { cor: '#34e89e', icone: '🔒', nome: 'Seguro', peso: 1 }
  };
  function status(s) { return STATUS[s] || STATUS.seguro; }

  // nome legível da regra
  var REGRAS = {
    ferramenta: 'ferramenta de ataque', varredura: 'varredura', injecao: 'injeção', lista: 'lista',
    arquivo_proibido: 'arquivo proibido', robo: 'robô', rajada: 'rajada', tor: 'Tor', forca_bruta: 'força bruta',
    ia: 'IA', sem_login: 'sem login', cron: 'cron', previa_link: 'prévia de link', buscador: 'buscador',
    passe_invalido: 'passe inválido'
  };
  function regra(r) { return r ? (REGRAS[r] || r) : ''; }

  SNT.u = {
    FUSO: FUSO, esc: esc, corta: corta, numeros: numeros, num: num, qtd: qtd, pct: pct, pct01: pct01,
    hora: hora, horaSeg: horaSeg, dataHora: dataHora, dia: dia, curta: curta, ate: ate, ha: ha,
    horarioComercial: horarioComercial, bandeira: bandeira, nomePais: nomePais, local: local,
    dispositivo: dispositivo, ipOuCidr: ipOuCidr, contem: contem, status: status, STATUS: STATUS, regra: regra
  };
})();
