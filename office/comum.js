/* =========================================================
   LUBE OFFICE — peças comuns ao Drive e ao editor
   Sessão do portal, chamada à função office, ícones, avatares,
   datas, tamanhos e avisos rápidos.
   ========================================================= */
(function () {
  'use strict';

  var CFG = window.LUBE_CFG;
  var LOCAL = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  // demonstração com dados sintéticos: só na máquina (o demo.js nem vai para o site publicado)
  var DEMO = LOCAL && new URLSearchParams(location.search).get('demo') === '1';
  var FUNCAO = CFG.url + '/functions/v1/office';
  var sb = DEMO ? null : window.supabase.createClient(CFG.url, CFG.key);

  var $  = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------- tipos de arquivo ---------- */
  var TIPO = {
    docx: 'doc', doc: 'doc', odt: 'doc', rtf: 'doc', txt: 'doc',
    xlsx: 'plan', xls: 'plan', ods: 'plan', csv: 'plan',
    pptx: 'apre', ppt: 'apre', odp: 'apre',
    pdf: 'pdf'
  };
  var NOME_TIPO = { doc: 'Lube Texto', plan: 'Lube Planilha', apre: 'Lube Slides', pdf: 'PDF', outro: 'Arquivo', pasta: 'Pasta' };
  var ACEITOS = ['docx', 'xlsx', 'pptx', 'pdf', 'doc', 'xls', 'ppt', 'odt', 'ods', 'odp', 'csv', 'txt', 'rtf'];
  var MIME = {
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    pdf: 'application/pdf', csv: 'text/csv', txt: 'text/plain'
  };

  function classeTipo(ext) { return TIPO[String(ext || '').toLowerCase()] || 'outro'; }
  function nomeTipo(ext) { return NOME_TIPO[ext === 'pasta' ? 'pasta' : classeTipo(ext)]; }

  // ícone de um tipo: folha com a dobra (pasta, envio e modelo)
  var FOLHA = '<path style="fill:var(--c)" d="M10 3h14.5L33 11.5V35a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/>' +
              '<path fill="rgba(255,255,255,.38)" d="M24.5 3v6.5a2 2 0 0 0 2 2H33Z"/>';

  // editores do Lube Work (2026-11-06, decisão do Júlio: "ícone de aplicativo"): quadrado arredondado
  // em degradê na cor do editor, símbolo branco no meio e o L da Lube num selo no canto
  var APP = {
    doc:   ['#5D7BFF', '#1E2B8C'],   // Lube Texto
    plan:  ['#2FD486', '#0B7A44'],   // Lube Planilha
    apre:  ['#FF7048', '#C20D1A'],   // Lube Slides
    pdf:   ['#F2647D', '#9C1932'],
    outro: ['#8D96B0', '#454C66']
  };
  var SIMBOLO = {
    doc: '<rect x="10" y="10.5" width="12" height="3.4" rx="1.7" fill="#fff"/>' +
         '<rect x="10" y="16.6" width="18" height="2.5" rx="1.25" fill="#fff" fill-opacity=".92"/>' +
         '<rect x="10" y="21.3" width="18" height="2.5" rx="1.25" fill="#fff" fill-opacity=".92"/>' +
         '<rect x="10" y="26" width="11" height="2.5" rx="1.25" fill="#fff" fill-opacity=".92"/>',
    plan: '<rect x="9.5" y="10" width="19" height="16.5" rx="2.6" fill="none" stroke="#fff" stroke-width="2"/>' +
          '<path d="M9.5 12.6a2.6 2.6 0 0 1 2.6-2.6h13.8a2.6 2.6 0 0 1 2.6 2.6V15h-19Z" fill="#fff"/>' +
          '<path d="M9.5 20.7h19M15.8 15v11.5M22.2 15v11.5" stroke="#fff" stroke-width="1.8"/>',
    apre: '<rect x="8.5" y="10" width="21" height="14.5" rx="2.4" fill="none" stroke="#fff" stroke-width="2"/>' +
          '<path d="M13 21v-2.6M17 21v-5.2M21 21v-3.6M25 21v-7" stroke="#fff" stroke-width="2.1" stroke-linecap="round"/>' +
          '<path d="M19 24.5v3.6M15 28.6h8" stroke="#fff" stroke-width="2" stroke-linecap="round"/>',
    pdf: '<text x="20" y="24.4" text-anchor="middle" font-size="9.6" font-weight="800" fill="#fff" ' +
         'font-family="Archivo,sans-serif" letter-spacing=".3">PDF</text>',
    outro: '<path d="M12 15h16M12 20h16M12 25h10" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-opacity=".85"/>'
  };
  var seqIco = 0;
  function iconeApp(t) {
    var c = APP[t], id = 'lw-ico-' + (++seqIco);   // id único: degradê de um ícone escondido não some dos outros
    var selo = t === 'doc' || t === 'plan' || t === 'apre'
      ? '<g transform="translate(26 26)"><rect width="11.5" height="11.5" rx="3.4" fill="#fff"/>' +
        '<g transform="translate(2.9 2.5) scale(.064) skewX(-10)"><path fill="#1E2B8C" d="M24 6h34v56h42c6 0 10 4 10 10v12c0 10-8 18-18 18H24C12 102 4 94 4 82V26C4 14 12 6 24 6Z"/>' +
        '<path fill="#EE1B24" d="M68 6h36c6 0 10 4 10 10v32c0 3-2 4-5 4H68Z"/></g></g>'
      : '';
    return '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0" stop-color="' + c[0] + '"/><stop offset="1" stop-color="' + c[1] + '"/></linearGradient></defs>' +
      '<rect x="3" y="3" width="34" height="34" rx="9.5" fill="url(#' + id + ')"/>' +
      '<path d="M3 12.5A9.5 9.5 0 0 1 12.5 3h15A9.5 9.5 0 0 1 37 12.5v2.7C27.5 12.4 12.5 12.6 3 18.2Z" fill="#fff" fill-opacity=".14"/>' +
      SIMBOLO[t] + selo;
  }
  function icone(ext, extra) {
    var t = ext === 'pasta' ? 'pasta' : ext === 'envio' ? 'env' : ext === 'modelo' ? 'modelo' : classeTipo(ext);
    var miolo;
    if (t === 'pasta') {
      miolo = '<path style="fill:var(--c)" d="M3 10a3 3 0 0 1 3-3h8.5l3 3.2H34a3 3 0 0 1 3 3V31a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3Z"/>' +
              '<path fill="rgba(255,255,255,.18)" d="M3 15.5h34V31a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3Z"/>' +
              (extra === 'compartilhada'
                ? '<circle cx="17" cy="22.5" r="2.6" fill="#fff"/><circle cx="24" cy="22.5" r="2.6" fill="#fff" opacity=".8"/>' +
                  '<path d="M12.5 30a4.5 4.5 0 0 1 9 0M19.5 30a4.5 4.5 0 0 1 9 0" fill="#fff" opacity=".9"/>'
                : '');
    } else if (t === 'env') {
      miolo = FOLHA + '<path d="M20.5 30V19M16 23.5l4.5-4.5 4.5 4.5" fill="none" stroke="#fff" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/>';
    } else if (t === 'modelo') {
      miolo = '<g style="--c:#1E2B8C">' + FOLHA + '</g>' +
              '<g transform="translate(12.5 17) scale(.11) skewX(-10)"><path fill="#fff" d="M24 6h34v56h42c6 0 10 4 10 10v12c0 10-8 18-18 18H24C12 102 4 94 4 82V26C4 14 12 6 24 6Z"/>' +
              '<path fill="#EE1B24" d="M68 6h36c6 0 10 4 10 10v32c0 3-2 4-5 4H68Z"/></g>';
    } else {
      miolo = iconeApp(t);
    }
    var cls = t === 'doc' ? '' : ' ico--' + t;
    return '<svg class="ico' + cls + '" viewBox="0 0 40 40" aria-hidden="true">' + miolo + '</svg>';
  }

  /* ---------- pessoas ---------- */
  var CORES = ['#2C3FC4', '#E5101F', '#15965A', '#7C4DDB', '#D97706', '#0284C7', '#DB2777', '#0F9488'];
  function corPessoa(id) {
    var s = String(id || ''), h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return CORES[h % CORES.length];
  }
  function iniciais(nome) {
    var p = String(nome || '?').trim().split(/\s+/);
    return ((p[0] || '?').charAt(0) + (p.length > 1 ? p[p.length - 1].charAt(0) : '')).toUpperCase();
  }
  function avatar(p, tam) {
    if (!p) return '';
    return '<span class="av' + (tam ? ' av--' + tam : '') + '" style="--c:' + corPessoa(p.id) + '" title="' +
      esc(p.nome + (p.email ? ' · ' + p.email : '')) + '">' + esc(iniciais(p.nome)) + '</span>';
  }
  function avatarTodos(tam) {
    return '<span class="av av--todos' + (tam ? ' av--' + tam : '') + '" title="Todos da Lube">' +
      '<svg viewBox="0 0 24 24" width="55%" fill="none" stroke="#fff" stroke-width="2"><circle cx="12" cy="12" r="9"/>' +
      '<path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg></span>';
  }
  function primeiroNome(nome) { return String(nome || '').trim().split(/\s+/)[0] || ''; }

  var PAPEL = { dono: 'Dono', editar: 'Pode editar', comentar: 'Pode comentar', ver: 'Pode ver' };
  function papelTxt(p) { return PAPEL[p] || ''; }
  function pode(papel, acao) {
    var n = { dono: 4, editar: 3, comentar: 2, ver: 1 }[papel] || 0;
    return n >= ({ lixeira: 4, editar: 3, compartilhar: 3, renomear: 3, mover: 3, comentar: 2, ver: 1 }[acao] || 9);
  }

  /* ---------- números e datas ---------- */
  function bytes(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + ' B';
    var u = ['KB', 'MB', 'GB'], i = -1;
    do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
    return n.toLocaleString('pt-BR', { maximumFractionDigits: n < 10 ? 1 : 0 }) + ' ' + u[i];
  }
  var MESES = ['jan.', 'fev.', 'mar.', 'abr.', 'mai.', 'jun.', 'jul.', 'ago.', 'set.', 'out.', 'nov.', 'dez.'];
  function hora(d) { return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
  function quando(iso) {
    if (!iso) return '';
    var d = new Date(iso), agora = new Date();
    var s = Math.round((agora - d) / 1000);
    if (s < 50) return 'agora';
    if (s < 3600) return 'há ' + Math.max(1, Math.round(s / 60)) + ' min';
    var hoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
    var dia = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    var dias = Math.round((hoje - dia) / 86400000);
    if (dias === 0) return 'hoje às ' + hora(d);
    if (dias === 1) return 'ontem às ' + hora(d);
    return d.getDate() + ' de ' + MESES[d.getMonth()] + (d.getFullYear() !== agora.getFullYear() ? ' ' + d.getFullYear() : '');
  }
  function dataCompleta(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return d.toLocaleDateString('pt-BR') + ' às ' + hora(d);
  }

  /* ---------- avisos rápidos ---------- */
  function toast(msg, tipo, acao, ms) {
    var box = $('[data-toasts]');
    if (!box) return { fechar: function () {}, texto: function () {} };
    var el = document.createElement('div');
    el.className = 'toast' + (tipo ? ' is-' + tipo : '');
    el.setAttribute('role', tipo === 'erro' ? 'alert' : 'status');
    el.innerHTML = '<i></i><span></span>' + (acao ? '<button type="button"></button>' : '');
    $('span', el).textContent = msg;
    if (acao) {
      $('button', el).textContent = acao.texto;
      $('button', el).addEventListener('click', function () { acao.fn(); fechar(); });
    }
    box.appendChild(el);
    var t = null;
    function fechar() { clearTimeout(t); if (el.parentNode) el.parentNode.removeChild(el); }
    if (ms !== 0) t = setTimeout(fechar, ms || (tipo === 'erro' ? 8000 : 5000));
    return { fechar: fechar, texto: function (m) { $('span', el).textContent = m; } };
  }

  /* ---------- sessão e chamada à função ---------- */
  function token() {
    if (DEMO) return Promise.resolve('demo');
    return sb.auth.getSession().then(function (r) {
      var s = r && r.data && r.data.session;
      return s && s.access_token ? s.access_token : null;
    });
  }

  function api(acao, dados) {
    if (DEMO) return window.OFC_DEMO.api(acao, dados || {});
    return token().then(function (t) {
      if (!t) { var e0 = new Error('Sua sessão acabou. Entre de novo pelo painel.'); e0.status = 401; throw e0; }
      var corpo = Object.assign({ acao: acao }, dados || {});
      return fetch(FUNCAO, {
        method: 'POST', cache: 'no-store', credentials: 'omit',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + t },
        body: JSON.stringify(corpo)
      }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (!r.ok) {
            var e = new Error(j && j.erro ? j.erro : 'Falha ao falar com o Lube Work (' + r.status + ')');
            e.status = r.status;
            e.dados = j;   // o que deu certo antes do erro (ex.: o envio no painel saiu, o e-mail não)
            throw e;
          }
          return j;
        });
      }, function () {
        var e = new Error('Sem conexão com o servidor. Confira a internet e tente de novo.');
        e.status = 0;
        throw e;
      });
    });
  }

  // teste de ponta a ponta sem login (editor.html#teste=<senha temporária do banco>):
  // a porta /office/motor/teste só aceita a senha gravada pelo TI em office.config, que vence sozinha
  function apiTeste(corpo) {
    return fetch(FUNCAO + '/motor/teste', {
      method: 'POST', cache: 'no-store', credentials: 'omit',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo)
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { var e = new Error(j && j.erro ? j.erro : 'Falha no teste (' + r.status + ')'); e.status = r.status; throw e; }
        return j;
      });
    });
  }

  // foto para a IA: reduz para no máximo 1568 px no lado maior (o que a IA lê de fato) e JPEG,
  // para o pedido sair leve. Devolve { tipo, dados (base64 sem o prefixo), url (para mostrar) }
  function imagemParaIa(arquivo) {
    return new Promise(function (ok, falha) {
      if (!/^image\/(png|jpe?g|webp|gif|bmp|heic|heif)$/i.test(arquivo.type || '')) { falha(new Error('“' + arquivo.name + '” não é uma imagem.')); return; }
      var url = URL.createObjectURL(arquivo);
      var img = new Image();
      img.onload = function () {
        var max = 1568, w = img.naturalWidth, h = img.naturalHeight, k = Math.min(1, max / Math.max(w, h));
        var c = document.createElement('canvas');
        c.width = Math.round(w * k); c.height = Math.round(h * k);
        var g = c.getContext('2d');
        g.fillStyle = '#fff';
        g.fillRect(0, 0, c.width, c.height);
        g.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        var dataUrl = c.toDataURL('image/jpeg', 0.86);
        ok({ tipo: 'image/jpeg', dados: dataUrl.split(',')[1], url: dataUrl, nome: arquivo.name });
      };
      img.onerror = function () { URL.revokeObjectURL(url); falha(new Error('Não deu para abrir “' + arquivo.name + '”.')); };
      img.src = url;
    });
  }

  // envia um arquivo novo: reserva → manda direto ao Storage → confirma
  function enviarArquivo(blob, o) {
    return api('arquivo_novo', { pasta: o.pasta || null, nome: o.nome, extensao: o.extensao }).then(function (r) {
      if (DEMO) return window.OFC_DEMO.confirmar(r, blob, o);
      return sb.storage.from('office').uploadToSignedUrl(r.caminho, r.token, blob, {
        contentType: MIME[o.extensao] || blob.type || 'application/octet-stream', upsert: false
      }).then(function (up) {
        if (up.error) throw new Error('O envio falhou: ' + up.error.message);
        return api('arquivo_confirmar', { id: r.id, origem: o.origem || 'envio' });
      });
    });
  }

  function sair() {
    if (DEMO) { location.href = '../'; return; }
    sb.auth.signOut().then(function () { location.href = '../'; }, function () { location.href = '../'; });
  }

  // carrega o demo.js antes de tudo (só na máquina)
  function pronto() {
    if (!DEMO) return Promise.resolve();
    document.body.classList.add('demo');
    var tarja = $('[data-tarja-demo]');
    if (tarja) tarja.hidden = false;
    return new Promise(function (ok, falha) {
      var s = document.createElement('script');
      s.src = 'demo.js?v=20261021c';
      s.onload = ok;
      s.onerror = falha;
      document.head.appendChild(s);
    });
  }

  /* ---------- modelos da Lube (arquivos estáticos em office/modelos) ---------- */
  var MODELOS = [
    { id: 'proposta', nome: 'Proposta comercial', ext: 'docx', arquivo: 'modelos/proposta-comercial.docx',
      desc: 'Capa, escopo, condições e assinatura', capa: 'doc' },
    { id: 'ata', nome: 'Ata de reunião', ext: 'docx', arquivo: 'modelos/ata-de-reuniao.docx',
      desc: 'Participantes, pauta, decisões e responsáveis', capa: 'doc' },
    { id: 'relatorio', nome: 'Relatório mensal', ext: 'xlsx', arquivo: 'modelos/relatorio-mensal.xlsx',
      desc: 'Indicadores do mês, meta e realizado', capa: 'plan' },
    { id: 'apresentacao', nome: 'Apresentação Lube', ext: 'pptx', arquivo: 'modelos/apresentacao-lube.pptx',
      desc: '19 tipos de slide: capa, seções, números, etapas e fechamento', capa: 'apre' }
  ];
  var BRANCOS = {
    docx: { nome: 'Documento sem título', arquivo: 'modelos/branco.docx' },
    xlsx: { nome: 'Planilha sem título', arquivo: 'modelos/branco.xlsx' },
    pptx: { nome: 'Apresentação sem título', arquivo: 'modelos/branco.pptx' }
  };
  // base dos arquivos que a IA cria pelo Drive (o plugin escreve o conteúdo dentro do editor)
  var BASES_IA = {
    docx: 'modelos/ia-documento.docx',   // já com o cabeçalho e o rodapé da Lube
    xlsx: 'modelos/branco.xlsx',
    pptx: 'modelos/ia-apresentacao.pptx' // 16:9, o plugin troca o slide vazio pelos da IA
  };
  // dólar com vírgula e o número de casas que faz sentido (custo da IA é fração de centavo)
  function usd(v) {
    v = Number(v) || 0;
    var casas = v === 0 ? 2 : v < 0.01 ? 4 : v < 1 ? 3 : 2;
    return 'US$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: casas === 2 ? 2 : 0, maximumFractionDigits: casas });
  }
  function baixarModelo(caminho) {
    return fetch(caminho, { cache: 'force-cache' }).then(function (r) {
      if (!r.ok) throw new Error('Modelo não encontrado (' + caminho + ')');
      return r.blob();
    });
  }

  // marca da Lube em branco + vermelho (fundo escuro)
  function marcas() {
    $$('[data-marca-branca]').forEach(function (el) {
      if (window.LUBE_MARCA) el.innerHTML = window.LUBE_MARCA('#FFFFFF');
    });
  }

  window.OFC = {
    DEMO: DEMO, sb: sb, $: $, $$: $$, esc: esc,
    classeTipo: classeTipo, nomeTipo: nomeTipo, icone: icone, ACEITOS: ACEITOS,
    avatar: avatar, avatarTodos: avatarTodos, iniciais: iniciais, primeiroNome: primeiroNome, corPessoa: corPessoa,
    papelTxt: papelTxt, pode: pode, bytes: bytes, quando: quando, dataCompleta: dataCompleta,
    toast: toast, api: api, token: token, enviarArquivo: enviarArquivo, sair: sair, pronto: pronto,
    MODELOS: MODELOS, BRANCOS: BRANCOS, BASES_IA: BASES_IA, baixarModelo: baixarModelo, marcas: marcas,
    apiTeste: apiTeste, imagemParaIa: imagemParaIa, usd: usd
  };
})();
