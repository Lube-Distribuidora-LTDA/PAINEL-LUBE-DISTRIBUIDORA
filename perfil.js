/* =========================================================
   PAINEL LUBE — meu perfil (foto e nome) e o aviso de novidade
   A pessoa escolhe a foto, enquadra o rosto num recorte redondo e salva:
   a foto vai recortada (320 px) para o bucket privado "avatares" e o
   caminho fica em profiles.foto (função meu_perfil_salvar). As iniciais
   viram foto em todo lugar com data-avatar / data-foto (fotos.js).
   O aviso de novidade aparece uma vez por pessoa (avisos_vistos).
   ========================================================= */
(function () {
  'use strict';

  var $  = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };

  var BUCKET = 'avatares';
  var LADO   = 320;                       // a foto salva: 320 x 320
  var AVISO  = 'cara-nova-2026-11';       // chave do aviso de novidade
  var NO_AR  = Date.parse('2026-11-10T00:00:00-03:00');   // quem se cadastrou depois vê "bem-vindo"

  var sb = null, perfil = null;

  function iniciais(nome) {
    var p = String(nome || '').trim().split(/\s+/).filter(Boolean);
    if (!p.length) return '?';
    return (p[0].charAt(0) + (p.length > 1 ? p[p.length - 1].charAt(0) : '')).toUpperCase();
  }
  function nomeDe(p) { return (p && (p.nome || (p.email || '').split('@')[0])) || ''; }

  /* ---------- pinta a foto / as iniciais de quem está logado ---------- */
  function pintar() {
    if (!perfil) return;
    var nome = nomeDe(perfil);
    $$('[data-avatar]').forEach(function (a) {
      a.textContent = iniciais(nome);
      if (perfil.foto) a.setAttribute('data-foto', perfil.foto); else a.removeAttribute('data-foto');
    });
    $$('[data-eu-nome]').forEach(function (e) { e.textContent = nome; });
    if (window.LubeFotos) window.LubeFotos.varrer(document);
  }

  /* ---------- foto quadrada a partir de um arquivo ----------
     Usada no cadastro (sem editor): corta o meio da imagem. */
  function lerArquivo(arquivo) {
    return new Promise(function (ok, falha) {
      if (!arquivo || String(arquivo.type).indexOf('image/') !== 0) { falha(new Error('Escolha um arquivo de imagem.')); return; }
      if (arquivo.size > 20 * 1024 * 1024) { falha(new Error('A imagem é grande demais (máximo 20 MB).')); return; }
      var fr = new FileReader();
      fr.onload = function () {
        var img = new Image();
        img.onload = function () { ok(img); };
        img.onerror = function () { falha(new Error('Não consegui abrir essa imagem. Tente outra (JPG ou PNG).')); };
        img.src = fr.result;
      };
      fr.onerror = function () { falha(new Error('Não consegui ler o arquivo.')); };
      fr.readAsDataURL(arquivo);
    });
  }
  function paraBlob(canvas) {
    return new Promise(function (ok) {
      if (canvas.toBlob) canvas.toBlob(function (b) { ok(b); }, 'image/jpeg', 0.86);
      else ok(null);
    });
  }
  function quadrada(arquivo) {
    return lerArquivo(arquivo).then(function (img) {
      var w = img.naturalWidth, h = img.naturalHeight, lado = Math.min(w, h);
      var cv = document.createElement('canvas'); cv.width = cv.height = LADO;
      var g = cv.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, LADO, LADO);
      // um pouco acima do meio: em foto de pé o rosto fica na parte de cima
      g.drawImage(img, (w - lado) / 2, Math.max(0, (h - lado) * 0.3), lado, lado, 0, 0, LADO, LADO);
      return paraBlob(cv).then(function (blob) { return { blob: blob, url: cv.toDataURL('image/jpeg', 0.86) }; });
    });
  }

  /* ---------- manda a foto e grava o perfil ---------- */
  function enviarFoto(cliente, userId, blob) {
    if (!blob) return Promise.reject(new Error('Este navegador não conseguiu preparar a foto.'));
    var nome = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    var caminho = userId + '/' + nome + '.jpg';
    return cliente.storage.from(BUCKET).upload(caminho, blob, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false })
      .then(function (r) {
        if (r.error) throw new Error('Não foi possível enviar a foto. Tente de novo.');
        return caminho;
      });
  }
  function gravar(cliente, dados) {
    return cliente.rpc('meu_perfil_salvar', {
      p_nome: dados.nome == null ? null : dados.nome,
      p_foto: dados.foto || null,
      p_tira_foto: !!dados.tirar
    }).then(function (r) {
      if (r.error) throw new Error(r.error.message || 'Não foi possível salvar o perfil.');
      return r.data || {};
    });
  }

  /* =========================================================
     MEU PERFIL: recorte redondo (arrastar e zoom)
     ========================================================= */
  var folha = $('[data-perfil]');
  var recorte = $('[data-recorte]'), img = $('[data-recorte-img]'), zoom = $('[data-zoom]');
  var campoNome = $('[data-perfil-nome]'), previaAv = $('[data-previa-avatar]');
  var erroEl = $('[data-perfil-erro]'), botaoSalvar = $('[data-salvar-perfil]');
  var r = { tem: false, nova: false, tirou: false, s: 1, ox: 0, oy: 0, w: 0, h: 0 };
  var aoVivo = false;                     // o crachá está mostrando a foto nova, ainda não salva

  function medidas() {
    var C = recorte.clientWidth || 176, base = Math.max(C / r.w, C / r.h);
    var dw = r.w * base * r.s, dh = r.h * base * r.s;
    var mx = Math.max(0, (dw - C) / 2), my = Math.max(0, (dh - C) / 2);
    r.ox = Math.max(-mx, Math.min(mx, r.ox)); r.oy = Math.max(-my, Math.min(my, r.oy));
    return { C: C, dw: dw, dh: dh };
  }
  function recortar(lado) {
    var m = medidas(), k = lado / m.C, cv = document.createElement('canvas');
    cv.width = cv.height = lado;
    var g = cv.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, lado, lado);
    g.drawImage(img, (m.C / 2 - m.dw / 2 + r.ox) * k, (m.C / 2 - m.dh / 2 + r.oy) * k, m.dw * k, m.dh * k);
    return cv;
  }
  function erro(msg) { if (erroEl) erroEl.textContent = msg || ''; }

  function desenhar() {
    if (!folha) return;
    var nome = campoNome.value.trim() || nomeDe(perfil);
    var ini = $('[data-recorte-ini]');
    recorte.classList.toggle('tem', r.tem && r.nova);
    zoom.disabled = !(r.tem && r.nova);
    $('[data-remover-foto]').hidden = !r.tem;
    $('[data-dica-foto]').textContent = r.tem && r.nova ? 'Arraste a foto para centralizar o rosto.'
      : r.tem ? 'Esta é a sua foto de hoje. Escolha outra para trocar.' : 'Escolha uma foto do seu rosto.';
    ini.textContent = iniciais(nome);
    $('[data-previa-nome]').textContent = nome;
    $('[data-previa-cargo]').textContent = (perfil && perfil.cargo) || (perfil && perfil.email) || '';
    previaAv.textContent = iniciais(nome);

    if (r.tem && r.nova) {                         // foto nova: mostra enquadrada, ao vivo
      var m = medidas();
      img.style.width = m.dw + 'px'; img.style.height = m.dh + 'px';
      img.style.transform = 'translate(calc(-50% + ' + r.ox + 'px), calc(-50% + ' + r.oy + 'px))';
      [ini, previaAv].forEach(function (el) {
        if (window.LubeFotos) window.LubeFotos.limpar(el);
        el.removeAttribute('data-foto');
      });
      previaAv.style.backgroundImage = 'url(' + recortar(96).toDataURL('image/jpeg', 0.8) + ')';
      previaAv.style.backgroundSize = 'cover';
      previaAv.style.color = 'transparent';
      aoVivo = true;
    } else {                                       // sem foto nova: a que já está salva (ou as iniciais)
      if (aoVivo) { previaAv.style.backgroundImage = ''; previaAv.style.color = ''; aoVivo = false; }
      [ini, previaAv].forEach(function (el) {
        if (r.tem && perfil && perfil.foto) el.setAttribute('data-foto', perfil.foto); else el.removeAttribute('data-foto');
      });
    }
  }

  function carregar(imagem) {
    img.src = imagem.src;
    r.tem = true; r.nova = true; r.tirou = false;
    r.w = imagem.naturalWidth; r.h = imagem.naturalHeight; r.s = 1; r.ox = 0; r.oy = 0;
    zoom.value = 1;
    erro('');
    (img.decode ? img.decode() : Promise.resolve()).then(desenhar, desenhar);
  }

  function abrir() {
    if (!folha || !perfil) return;
    fecharNovidade();
    r.tem = !!perfil.foto; r.nova = false; r.tirou = false; r.s = 1; r.ox = 0; r.oy = 0;
    img.removeAttribute('src'); zoom.value = 1;
    campoNome.value = nomeDe(perfil);
    erro('');
    folha.classList.add('is-on'); folha.setAttribute('aria-hidden', 'false');
    desenhar();
  }
  function fechar() { if (folha) { folha.classList.remove('is-on'); folha.setAttribute('aria-hidden', 'true'); } }

  function salvar() {
    var nome = campoNome.value.replace(/\s+/g, ' ').trim();
    if (nome.length < 2) { erro('Escreva como você quer ser chamado.'); return; }
    var antiga = perfil.foto || null;
    var mudouNome = nome !== (perfil.nome || '');
    if (!mudouNome && !r.nova && !r.tirou) { fechar(); return; }

    erro('');
    botaoSalvar.disabled = true; botaoSalvar.classList.add('is-loading');
    var previa = r.nova ? recortar(LADO) : null;
    var passo = r.nova
      ? paraBlob(previa).then(function (blob) { return enviarFoto(sb, perfil.id, blob); })
      : Promise.resolve(null);

    passo.then(function (caminho) {
      return gravar(sb, { nome: mudouNome ? nome : null, foto: caminho, tirar: r.tirou && !caminho }).then(function (d) {
        perfil.nome = d.nome || nome;
        perfil.foto = d.foto || null;
        // a nova aparece na hora; a antiga sai do bucket (se falhar, só sobra um arquivo sem uso)
        if (caminho && previa && window.LubeFotos) window.LubeFotos.lembrar(caminho, previa.toDataURL('image/jpeg', 0.86));
        if (antiga && antiga !== perfil.foto) {
          if (window.LubeFotos) window.LubeFotos.esquecer(antiga);
          sb.storage.from(BUCKET).remove([antiga]).then(function () {}, function () {});
        }
        pintar();
        if (window.LubeShell && window.LubeShell.conta) window.LubeShell.conta();
        fechar();
      });
    }).catch(function (e) {
      erro((e && e.message) || 'Não foi possível salvar. Tente de novo.');
    }).then(function () {
      botaoSalvar.disabled = false; botaoSalvar.classList.remove('is-loading');
    });
  }

  if (folha) {
    $('[data-arquivo]').addEventListener('change', function () {
      var campo = this;
      lerArquivo(campo.files[0]).then(carregar, function (e) { erro(e.message); });
      campo.value = '';
    });
    $('[data-remover-foto]').addEventListener('click', function () {
      r.tem = false; r.nova = false; r.tirou = true; img.removeAttribute('src'); desenhar();
    });
    zoom.addEventListener('input', function () { r.s = +zoom.value; desenhar(); });
    recorte.addEventListener('wheel', function (e) {
      if (!(r.tem && r.nova)) return;
      e.preventDefault();
      r.s = Math.max(1, Math.min(3, r.s - e.deltaY * 0.0015)); zoom.value = r.s; desenhar();
    }, { passive: false });
    var arr = null;
    recorte.addEventListener('pointerdown', function (e) {
      if (!(r.tem && r.nova)) return;
      arr = { x: e.clientX, y: e.clientY, ox: r.ox, oy: r.oy };
      try { recorte.setPointerCapture(e.pointerId); } catch (x) {}
    });
    recorte.addEventListener('pointermove', function (e) {
      if (!arr) return;
      r.ox = arr.ox + e.clientX - arr.x; r.oy = arr.oy + e.clientY - arr.y; desenhar();
    });
    ['pointerup', 'pointercancel'].forEach(function (ev) { recorte.addEventListener(ev, function () { arr = null; }); });
    campoNome.addEventListener('input', desenhar);
    campoNome.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); salvar(); } });
    botaoSalvar.addEventListener('click', salvar);
    $$('[data-fechar-perfil]').forEach(function (b) { b.addEventListener('click', fechar); });
  }
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest ? ev.target.closest('[data-abrir-perfil]') : null;
    if (b) abrir();
  });

  /* =========================================================
     NOVIDADE: uma vez por pessoa
     ========================================================= */
  var folhaNov = $('[data-novidade]');
  function abrirNovidade() {
    if (!folhaNov || !perfil) return;
    // quem chegou depois da mudança não conhece a cara antiga: recebe as boas-vindas
    var novo = perfil.criado_em && Date.parse(perfil.criado_em) > NO_AR;
    $('[data-novidade-titulo]').textContent = novo ? 'Bem-vindo ao Painel de Sistemas' : 'O Painel está de cara nova';
    $('[data-novidade-txt]').textContent = novo
      ? 'Aqui ficam todos os sistemas e BIs da Lube, com um único login.'
      : 'Abertura nova, barra de vidro no topo e os seus sistemas mais fáceis de achar.';
    folhaNov.classList.add('is-on'); folhaNov.setAttribute('aria-hidden', 'false');
  }
  function fecharNovidade() { if (folhaNov) { folhaNov.classList.remove('is-on'); folhaNov.setAttribute('aria-hidden', 'true'); } }
  if (folhaNov) {
    $$('[data-fechar-novidade]').forEach(function (b) { b.addEventListener('click', fecharNovidade); });
    $('[data-novidade-perfil]').addEventListener('click', abrir);
  }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { fechar(); fecharNovidade(); } });

  // mostra se a pessoa ainda não viu; marca como visto assim que aparece
  function conferirNovidade(espera) {
    if (!folhaNov || !sb || !perfil) return;
    sb.from('avisos_vistos').select('aviso').eq('user_id', perfil.id).eq('aviso', AVISO).maybeSingle()
      .then(function (q) {
        if (q.error || q.data) return;               // erro ou já viu: não incomoda
        setTimeout(function () {
          // se a pessoa já está dentro de um BI (ou saiu), fica para a próxima entrada
          if (!perfil || document.documentElement.classList.contains('painel-fixo')) return;
          abrirNovidade();
          sb.from('avisos_vistos').insert({ user_id: perfil.id, aviso: AVISO }).then(function () {}, function () {});
        }, espera || 0);
      }, function () {});
  }

  window.LubePerfil = {
    // chamado pelo portal.js quando o painel abre
    iniciar: function (o) {
      sb = o.sb; perfil = o.perfil;
      pintar();
      if (o.novidade !== false) conferirNovidade(o.espera);
    },
    pintar: pintar,
    abrir: abrir,
    novidade: abrirNovidade,
    iniciais: iniciais,
    // cadastro: prepara a foto escolhida e, com a sessão recém-criada, envia e grava
    quadrada: quadrada,
    enviarNoCadastro: function (cliente, userId, blob) {
      return enviarFoto(cliente, userId, blob).then(function (caminho) { return gravar(cliente, { foto: caminho }); });
    }
  };
})();
