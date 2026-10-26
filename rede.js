/* =========================================================
   PAINEL LUBE — regra de rede da Lube (Sentinela)
   Peça comum do portal, do admin e do painel da Sentinela
   (docs/SENTINELA-REDE.md, §7). Pergunta à central se quem está
   logado está na rede da Lube e mostra o que for preciso: a saída
   para a página de bloqueio, o aviso de liberado e, só para
   administrador, o cartão de emergência (IP do escritório mudou).
   Quem barra de verdade é o guarda de cada sistema; aqui é só a
   tela. Tudo tem limite de tempo e falha aberta: central fora,
   tempo esgotado ou resposta estranha = segue (os guardas barram).
   Em localhost (só lá), localStorage['lube-rede-demo'] simula a
   resposta: bloquear | liberado | emergencia | observar | dentro.
   ========================================================= */
(function () {
  'use strict';

  var FUSO = 'America/Sao_Paulo';
  var LOCAL = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  var ORIGENS = { painel: 1, sistema: 1, admin: 1, sentinela: 1 };
  var CONTATO = 'cpd@lube.com.br';

  function central() {
    var cfg = window.LUBE_CFG || {};
    return (cfg.url || 'https://wkkdcsqwlxjxorutrbnx.supabase.co') + '/functions/v1/sentinela';
  }

  /* ---------- simulação (só localhost) ---------- */
  function lerDemo(k) {
    if (!LOCAL) return null;
    try { return localStorage.getItem(k); } catch (e) { return null; }
  }
  function gravarDemo(k, v) {
    if (!LOCAL) return;
    try { localStorage.setItem(k, v); } catch (e) {}
  }
  // fim de uma liberação de exemplo: daqui a 3 dias, às 18:00 de Brasília (sem horário de verão desde 2019)
  function ateExemplo() {
    var p = partes(new Date(Date.now() + 3 * 86400000));
    return new Date(p.ano + '-' + p.mes + '-' + p.dia + 'T18:00:00-03:00').toISOString();
  }
  function respostaDemo(qual) {
    var ip = '198.51.100.7';   // bloco de documentação, fora da rede de exemplo da demonstração
    var base = { ok: true, modo: 'exigir', na_rede: false, acao: 'bloquear', liberado: null, ip: ip, emergencia: null };
    if (qual === 'bloquear') return base;
    if (qual === 'emergencia') return Object.assign(base, { emergencia: { possivel: true, pessoas: 7 } });
    if (qual === 'liberado') return Object.assign(base, { acao: 'seguir', liberado: { ate: ateExemplo() } });
    if (qual === 'observar') return Object.assign(base, { modo: 'observar', acao: 'observar' });
    if (qual === 'dentro') return Object.assign(base, { acao: 'seguir', na_rede: true, ip: '203.0.113.10' });
    return null;
  }

  /* ---------- horas em Brasília ---------- */
  var fmtPartes = new Intl.DateTimeFormat('en-GB', {
    timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  });
  function partes(d) {
    var p = {};
    fmtPartes.formatToParts(d).forEach(function (x) { p[x.type] = x.value; });
    return { ano: p.year, mes: p.month, dia: p.day, hora: p.hour, min: p.minute };
  }
  function dataValida(iso) { return typeof iso === 'string' && iso.length <= 40 && !isNaN(new Date(iso).getTime()); }

  // 'Acesso de fora da empresa liberado pelo TI até 30/10, 18:00.'
  function textoLiberado(ateIso) {
    if (!dataValida(ateIso)) return 'Acesso de fora da empresa liberado pelo TI.';
    var p = partes(new Date(ateIso));
    return 'Acesso de fora da empresa liberado pelo TI até ' + p.dia + '/' + p.mes + ', ' + p.hora + ':' + p.min + '.';
  }

  /* ---------- resposta da central, conferida campo a campo ---------- */
  function limpar(j) {
    if (!j || typeof j !== 'object') return null;
    if (j.indisponivel === true) return { acao: 'seguir', modo: null, na_rede: false, liberado: null, ip: null, emergencia: null, indisponivel: true };
    var acao = j.acao;
    if (acao !== 'seguir' && acao !== 'observar' && acao !== 'bloquear') return null;
    var em = j.emergencia && typeof j.emergencia === 'object'
      ? { possivel: j.emergencia.possivel === true, pessoas: Math.max(0, Math.min(9999, Math.floor(+j.emergencia.pessoas || 0))) }
      : null;
    return {
      acao: acao,
      modo: j.modo === 'desligado' || j.modo === 'observar' || j.modo === 'exigir' ? j.modo : null,
      na_rede: j.na_rede === true,
      liberado: j.liberado && typeof j.liberado === 'object' && dataValida(j.liberado.ate) ? { ate: j.liberado.ate } : null,
      ip: typeof j.ip === 'string' && /^[0-9a-fA-F:.]{2,45}$/.test(j.ip) ? j.ip : null,
      emergencia: em,
      indisponivel: false
    };
  }

  // POST na central; resolve com { status, json } ou rejeita (rede, tempo)
  function postar(corpo, token, ms) {
    return new Promise(function (ok, falha) {
      var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
      var timer = setTimeout(function () { if (ctrl) ctrl.abort(); falha(new Error('tempo esgotado')); }, ms);
      fetch(central() + '/rede', {
        method: 'POST', credentials: 'omit', cache: 'no-store', signal: ctrl ? ctrl.signal : undefined,
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
        body: JSON.stringify(corpo || {})
      }).then(function (r) {
        return r.json().catch(function () { return null; }).then(function (j) { return { status: r.status, json: j }; });
      }).then(function (x) { clearTimeout(timer); ok(x); }, function (e) { clearTimeout(timer); falha(e); });
    });
  }

  // { acao, modo, na_rede, liberado, ip, emergencia } ou null (central fora, tempo, sem token). Nunca rejeita.
  function verificar(token, ms) {
    var demo = respostaDemo(lerDemo('lube-rede-demo'));
    if (demo) return new Promise(function (ok) { setTimeout(function () { ok(limpar(demo)); }, 250); });
    if (!token || typeof fetch !== 'function') return Promise.resolve(null);
    return postar({}, token, ms || 3000).then(function (x) {
      return x.status === 200 ? limpar(x.json) : null;
    }, function () { return null; });
  }

  // botão de emergência (só admin): { ok, cadastrada } ou { ok: false, erro, detalhe }. Nunca rejeita.
  function cadastrarEmergencia(token) {
    if (lerDemo('lube-rede-demo')) {
      var falha = lerDemo('lube-rede-demo-emergencia');
      return new Promise(function (ok) {
        setTimeout(function () {
          if (falha) { ok({ ok: false, erro: falha, detalhe: '' }); return; }
          gravarDemo('lube-rede-demo', 'dentro');
          ok({ ok: true, cadastrada: { id: 3, rede: '198.51.100.7/32' } });
        }, 400);
      });
    }
    if (!token || typeof fetch !== 'function') return Promise.resolve({ ok: false, erro: 'rede', detalhe: '' });
    return postar({ emergencia: true }, token, 8000).then(function (x) {
      var j = x.json || {};
      if (x.status === 200 && j.ok === true && j.cadastrada && typeof j.cadastrada.rede === 'string') {
        return { ok: true, cadastrada: { id: +j.cadastrada.id || null, rede: String(j.cadastrada.rede).slice(0, 64) } };
      }
      return { ok: false, erro: typeof j.erro === 'string' ? j.erro.slice(0, 40) : 'http_' + x.status,
               detalhe: typeof j.detalhe === 'string' ? j.detalhe.slice(0, 300) : '' };
    }, function () { return { ok: false, erro: 'rede', detalhe: '' }; });
  }

  // Ação do painel da Sentinela pela central (POST /rede {"acao", "dados"}): a central manda ao banco
  // o IP do pedido, e o banco não deixa afrouxar a regra de fora da rede da Lube quando algum sistema
  // exige a rede. Resolve { ok: true, resultado } ou { ok: false, erro, codigo, detalhe }. Nunca rejeita.
  function acao(token, nome, dados) {
    if (!token || typeof fetch !== 'function') return Promise.resolve({ ok: false, erro: 'sessao', codigo: null, detalhe: '' });
    return postar({ acao: nome, dados: dados || {} }, token, 10000).then(function (x) {
      var j = x.json || {};
      if (x.status === 200 && j.ok === true && j.resultado && typeof j.resultado === 'object') return { ok: true, resultado: j.resultado };
      return { ok: false, erro: typeof j.erro === 'string' ? j.erro.slice(0, 40) : 'http_' + x.status,
               codigo: typeof j.codigo === 'string' ? j.codigo.slice(0, 5) : null,
               detalhe: typeof j.detalhe === 'string' ? j.detalhe.slice(0, 400) : '' };
    }, function () { return { ok: false, erro: 'rede', codigo: null, detalhe: '' }; });
  }

  /* ---------- página de bloqueio ---------- */
  // endereço absoluto de fora-da-rede.html; "de" é só uma escolha entre textos fixos
  function pagina(de) {
    de = ORIGENS[de] ? de : 'sistema';
    return new URL('/fora-da-rede.html?de=' + de, location.href).href;
  }
  function ehPagina(url) {
    try {
      var u = new URL(String(url || ''), location.href);
      return u.origin === location.origin && u.pathname === '/fora-da-rede.html';
    } catch (e) { return false; }
  }

  // sai da sessão SÓ neste navegador (scope local: a sessão do computador da empresa
  // continua) e vai para a página de bloqueio. Sem esperar mais que 1,5 s pelo signOut.
  function sair(sb, de) {
    var destino = pagina(de), foi = false;
    function ir() {
      if (foi) return;
      foi = true;
      try { location.replace(destino); } catch (e) { location.href = destino; }
    }
    setTimeout(ir, 1500);
    try {
      if (sb && sb.auth && typeof sb.auth.signOut === 'function') Promise.resolve(sb.auth.signOut({ scope: 'local' })).then(ir, ir);
      else ir();
    } catch (e) { ir(); }
  }

  /* ---------- estilo dos cartões (fica aqui: o portal não muda styles.css) ---------- */
  var CSS =
    '.lube-rede-veu{position:fixed;inset:0;z-index:9000;display:grid;place-items:center;padding:24px 16px;overflow-y:auto;' +
      'background:radial-gradient(ellipse at 50% 35%,rgba(44,63,196,.42) 0%,rgba(10,17,64,.92) 55%,rgba(3,6,22,.99) 100%),#030616;' +
      'font-family:Archivo,"IBM Plex Sans",system-ui,-apple-system,"Segoe UI",sans-serif;color:#E7EAF4}' +
    '.lube-rede-cartao{box-sizing:border-box;width:100%;max-width:460px;background:rgba(12,21,71,.62);border:1px solid rgba(255,255,255,.16);' +
      'border-radius:18px;padding:28px 24px 22px;box-shadow:0 40px 90px -40px #000;position:relative;overflow:hidden}' +
    '.lube-rede-cartao::before{content:"";position:absolute;left:0;right:0;top:0;height:3px;background:linear-gradient(90deg,#2C3FC4 0 60%,#EE1B24 60% 100%)}' +
    '.lube-rede-ic{width:52px;height:52px;border-radius:15px;display:grid;place-items:center;background:rgba(255,179,64,.14);' +
      'border:1px solid rgba(255,179,64,.45);color:#ffb340;margin-bottom:16px}' +
    '.lube-rede-ic.ok{background:rgba(37,208,122,.14);border-color:rgba(37,208,122,.45);color:#25D07A}' +
    '.lube-rede-ic svg{width:26px;height:26px}' +
    '.lube-rede-cartao h2{margin:0 0 10px;font-size:22px;line-height:1.2;font-weight:900;letter-spacing:-.02em;color:#fff}' +
    '.lube-rede-cartao p{margin:0 0 10px;font-size:15px;line-height:1.55;color:rgba(255,255,255,.72);font-weight:400}' +
    '.lube-rede-cartao p b{color:#fff;font-weight:700}' +
    '.lube-rede-ip{display:inline-block;margin:4px 0 14px;padding:7px 12px;border-radius:9px;background:rgba(3,6,22,.6);border:1px solid rgba(255,255,255,.16);' +
      'font:600 14px/1.2 "JetBrains Mono",Consolas,monospace;color:#fff;letter-spacing:-.01em;word-break:break-all}' +
    '.lube-rede-acoes{display:flex;flex-direction:column;gap:10px;margin-top:8px}' +
    '.lube-rede-btn{appearance:none;border:1px solid #EE1B24;background:#EE1B24;color:#fff;border-radius:11px;padding:14px 18px;' +
      'font-family:inherit;font-weight:700;font-size:15px;line-height:1.2;cursor:pointer;text-align:center;box-shadow:0 16px 36px -16px rgba(238,27,36,.8)}' +
    '.lube-rede-btn:hover{filter:brightness(1.1)}' +
    '.lube-rede-btn[disabled]{opacity:.6;cursor:progress}' +
    '.lube-rede-btn.leve{background:transparent;border-color:rgba(255,255,255,.22);color:rgba(255,255,255,.8);box-shadow:none}' +
    '.lube-rede-btn.leve:hover{border-color:rgba(255,255,255,.45);color:#fff}' +
    '.lube-rede-erro{margin-top:12px!important;color:#FF7B82!important;font-weight:600!important;font-size:14px!important}' +
    '.lube-rede-erro:empty{display:none}' +
    '.lube-rede-rodape{margin-top:16px!important;font:500 11px/1.6 "JetBrains Mono",Consolas,monospace!important;letter-spacing:.12em;' +
      'text-transform:uppercase;color:rgba(255,255,255,.38)!important}' +
    '.lube-rede-aviso{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:8000;box-sizing:border-box;width:min(560px,calc(100% - 32px));' +
      'display:flex;gap:12px;align-items:flex-start;padding:14px 14px 14px 16px;border-radius:14px;background:rgba(3,6,22,.96);' +
      'border:1px solid rgba(255,179,64,.5);box-shadow:0 18px 50px -18px rgba(0,0,0,.8);color:#E7EAF4;' +
      'font:500 14px/1.5 Archivo,"IBM Plex Sans",system-ui,sans-serif}' +
    '.lube-rede-aviso .lube-rede-ic{width:34px;height:34px;border-radius:10px;margin:0;flex:none}' +
    '.lube-rede-aviso .lube-rede-ic svg{width:18px;height:18px}' +
    '.lube-rede-aviso div{flex:1;min-width:0}' +
    '.lube-rede-aviso b{display:block;color:#fff;font-weight:800;margin-bottom:2px}' +
    '.lube-rede-aviso button{appearance:none;flex:none;width:30px;height:30px;border-radius:9px;border:1px solid rgba(255,255,255,.18);' +
      'background:transparent;color:rgba(255,255,255,.75);font-size:18px;line-height:1;cursor:pointer}' +
    '.lube-rede-aviso button:hover{color:#fff;border-color:rgba(255,255,255,.4)}' +
    '@media (max-width:420px){.lube-rede-cartao{padding:24px 18px 18px}.lube-rede-cartao h2{font-size:20px}}';
  function estilo() {
    if (document.getElementById('lube-rede-css')) return;
    var s = document.createElement('style');
    s.id = 'lube-rede-css';
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  // prédio com o sinal riscado (não é ataque: âmbar) e o sinal de ok
  var IC_FORA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M3 21V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v16"/><path d="M6.5 8h3M6.5 11.5h3M6.5 15h3"/><path d="M2 21h11"/>' +
    '<path d="M15.2 14.6a5 5 0 0 1 6.6 0M16.8 16.8a2.4 2.4 0 0 1 3.4 0"/><path d="M18.5 19.4h.01"/><path d="m15 12 7 8.5"/></svg>';
  var IC_OK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4 12 5 5L20 7"/></svg>';

  function el(tag, cls, texto) {
    var x = document.createElement(tag);
    if (cls) x.className = cls;
    if (texto != null) x.textContent = texto;
    return x;
  }

  /* ---------- cartão de emergência (só administrador, §12.2) ----------
     o: { pessoas, ip, token, aoEntrar(), aoSair() }. O banco confere as provas
     de novo e pega o IP do próprio pedido: o cartão só pergunta. */
  var MOTIVOS = {
    so_admin: 'Só administrador pode cadastrar a rede pela emergência.',
    sem_provas: 'O banco não achou provas suficientes (pessoas da Lube barradas deste endereço). Use o passo a passo da emergência no SQL Editor do Supabase.',
    ja_cadastrada: 'Este endereço já é uma rede da Lube. Espere 30 segundos e recarregue a página.',
    ip_invalido: 'A central não conseguiu ler o endereço público deste computador.',
    rede: 'Sem conexão com a central. Tente de novo.'
  };
  function cartaoEmergencia(o) {
    estilo();
    o = o || {};
    var veu = el('div', 'lube-rede-veu');
    veu.setAttribute('role', 'dialog');
    veu.setAttribute('aria-modal', 'true');
    veu.setAttribute('aria-labelledby', 'lube-rede-titulo');
    var c = el('div', 'lube-rede-cartao');
    var ic = el('span', 'lube-rede-ic');
    ic.innerHTML = IC_FORA;
    var h = el('h2', null, 'Você está fora da rede da Lube');
    h.id = 'lube-rede-titulo';
    var p1 = el('p');
    var n = Math.max(0, Math.floor(+o.pessoas || 0));
    p1.appendChild(el('b', null, n + (n === 1 ? ' pessoa da Lube foi barrada' : ' pessoas da Lube foram barradas')));
    p1.appendChild(document.createTextNode(' deste mesmo endereço nas últimas horas.'));
    var p2 = el('p', null, 'Se o IP do escritório mudou (troca da operadora, link reserva), cadastre este endereço como rede da Lube. O banco confere tudo de novo antes de gravar.');
    var ip = o.ip ? el('span', 'lube-rede-ip', 'Este endereço: ' + o.ip) : null;
    var acoes = el('div', 'lube-rede-acoes');
    var b1 = el('button', 'lube-rede-btn', 'Cadastrar este endereço como rede da Lube');
    b1.type = 'button';
    var b2 = el('button', 'lube-rede-btn leve', 'Sair');
    b2.type = 'button';
    var erro = el('p', 'lube-rede-erro');
    erro.setAttribute('role', 'alert');
    var rodape = el('p', 'lube-rede-rodape', 'Fica registrado na Sentinela · ' + CONTATO);
    acoes.appendChild(b1); acoes.appendChild(b2);
    [ic, h, p1, p2, ip, acoes, erro, rodape].forEach(function (x) { if (x) c.appendChild(x); });
    veu.appendChild(c);
    document.body.appendChild(veu);
    setTimeout(function () { try { b1.focus(); } catch (e) {} }, 50);

    function fechar() { if (veu.parentNode) veu.parentNode.removeChild(veu); }
    b2.addEventListener('click', function () {
      b1.disabled = true; b2.disabled = true;
      if (o.aoSair) o.aoSair();
    });
    b1.addEventListener('click', function () {
      erro.textContent = '';
      b1.disabled = true;
      b1.textContent = 'Cadastrando…';
      cadastrarEmergencia(o.token).then(function (r) {
        if (!r.ok) {
          b1.disabled = false;
          b1.textContent = 'Cadastrar este endereço como rede da Lube';
          erro.textContent = MOTIVOS[r.erro] || r.detalhe || 'A central recusou o cadastro.';
          return;
        }
        // deu certo: o mesmo cartão vira a confirmação
        ic.className = 'lube-rede-ic ok';
        ic.innerHTML = IC_OK;
        h.textContent = 'Rede da Lube cadastrada';
        p1.textContent = '';
        p1.appendChild(el('b', null, r.cadastrada.rede));
        p1.appendChild(document.createTextNode(' entrou na lista' + (r.cadastrada.id ? ' (#' + r.cadastrada.id + ')' : '') + '.'));
        p2.textContent = 'Os sistemas passam a abrir em até 30 segundos. Confira depois em Sentinela › Rede da Lube e remova a rede velha, se ela não existir mais.';
        if (ip) ip.remove();
        acoes.innerHTML = '';
        var entrar = el('button', 'lube-rede-btn', 'Entrar');
        entrar.type = 'button';
        entrar.addEventListener('click', function () { fechar(); if (o.aoEntrar) o.aoEntrar(); });
        acoes.appendChild(entrar);
        setTimeout(function () { try { entrar.focus(); } catch (e) {} }, 50);
      });
    });
    return { fechar: fechar };
  }

  /* ---------- aviso "só abre na rede da Lube" dentro do portal ----------
     para quando o portal está aberto e um sistema recusou o passe (?abrir=, janela fechada) */
  var avisoAtual = null;
  function avisoFora(nome) {
    estilo();
    if (avisoAtual && avisoAtual.parentNode) avisoAtual.parentNode.removeChild(avisoAtual);
    var a = el('div', 'lube-rede-aviso');
    a.setAttribute('role', 'alert');
    var ic = el('span', 'lube-rede-ic');
    ic.innerHTML = IC_FORA;
    var t = el('div');
    t.appendChild(el('b', null, (nome ? nome + ' só abre' : 'Este sistema só abre') + ' na rede da Lube'));
    t.appendChild(document.createTextNode('Este aparelho não está na rede da Lube. Se precisa acessar de fora, fale com o TI: ' + CONTATO +
      '. Na Lube, use o Wi-Fi da empresa (no celular, desligue os dados móveis e a VPN) e tente de novo.'));
    var x = el('button', null, '×');
    x.type = 'button';
    x.setAttribute('aria-label', 'Fechar aviso');
    x.addEventListener('click', function () { if (a.parentNode) a.parentNode.removeChild(a); });
    a.appendChild(ic); a.appendChild(t); a.appendChild(x);
    document.body.appendChild(a);
    avisoAtual = a;
    return a;
  }

  window.LubeRede = {
    verificar: verificar,
    sair: sair,
    textoLiberado: textoLiberado,
    cadastrarEmergencia: cadastrarEmergencia,
    acao: acao,
    pagina: pagina,
    ehPagina: ehPagina,
    cartaoEmergencia: cartaoEmergencia,
    avisoFora: avisoFora
  };
})();
