/* =========================================================
   EXCEL — gera um arquivo .xlsx de verdade no navegador, sem biblioteca
   (2026-11-13) Usado pelo painel administrativo para exportar as tabelas.

   Um .xlsx é um ZIP com alguns XML dentro. Aqui o ZIP vai sem compressão
   (as tabelas do admin são pequenas) e os textos vão dentro da célula
   (inlineStr), então não precisa de mais nada.

   window.LubeExcel.baixar('usuarios', [{
     nome: 'Usuários',
     colunas: [{ titulo: 'Nome', largura: 30 }, { titulo: 'Cadastro', largura: 18, tipo: 'data' }],
     linhas: [['Maria', new Date()], ...]
   }]);

   Tipos de coluna: texto (padrão), 'numero', 'data' (dia e hora) e 'longo'
   (texto que quebra linha). O cabeçalho sai azul, congelado e com o filtro
   do Excel ligado. Texto nunca vira fórmula.
   ========================================================= */
(function (raiz) {
  'use strict';

  /* ---------- CRC-32 (o ZIP confere cada arquivo com ele) ---------- */
  var TABELA = (function () {
    var t = [], n, c, k;
    for (n = 0; n < 256; n++) {
      c = n;
      for (k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) c = TABELA[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  /* ---------- ZIP sem compressão ---------- */
  function utf8(s) { return new TextEncoder().encode(s); }
  function zip(arquivos) {
    var agora = new Date();
    var hora = (agora.getHours() << 11) | (agora.getMinutes() << 5) | (agora.getSeconds() >> 1);
    var dia = ((agora.getFullYear() - 1980) << 9) | ((agora.getMonth() + 1) << 5) | agora.getDate();
    var partes = [], central = [], pos = 0;

    arquivos.forEach(function (a) {
      var nome = utf8(a.nome), dados = utf8(a.texto), crc = crc32(dados);
      var local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);      // assinatura do arquivo
      local.setUint16(4, 20, true);              // versão mínima
      local.setUint16(6, 0x0800, true);          // nomes em UTF-8
      local.setUint16(8, 0, true);               // 0 = sem compressão
      local.setUint16(10, hora, true);
      local.setUint16(12, dia, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, dados.length, true);
      local.setUint32(22, dados.length, true);
      local.setUint16(26, nome.length, true);
      local.setUint16(28, 0, true);

      var c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true);          // assinatura do índice
      c.setUint16(4, 20, true);
      c.setUint16(6, 20, true);
      c.setUint16(8, 0x0800, true);
      c.setUint16(10, 0, true);
      c.setUint16(12, hora, true);
      c.setUint16(14, dia, true);
      c.setUint32(16, crc, true);
      c.setUint32(20, dados.length, true);
      c.setUint32(24, dados.length, true);
      c.setUint16(28, nome.length, true);
      c.setUint32(42, pos, true);                // onde o arquivo começa
      central.push(new Uint8Array(c.buffer), nome);

      partes.push(new Uint8Array(local.buffer), nome, dados);
      pos += 30 + nome.length + dados.length;
    });

    var tamCentral = central.reduce(function (s, p) { return s + p.length; }, 0);
    var fim = new DataView(new ArrayBuffer(22));
    fim.setUint32(0, 0x06054b50, true);          // fim do índice
    fim.setUint16(8, arquivos.length, true);
    fim.setUint16(10, arquivos.length, true);
    fim.setUint32(12, tamCentral, true);
    fim.setUint32(16, pos, true);

    var tudo = partes.concat(central, [new Uint8Array(fim.buffer)]);
    var saida = new Uint8Array(tudo.reduce(function (s, p) { return s + p.length; }, 0));
    var o = 0;
    tudo.forEach(function (p) { saida.set(p, o); o += p.length; });
    return saida;
  }

  /* ---------- XML da planilha ---------- */
  function xml(s) {
    return String(s == null ? '' : s)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')   // o XML não aceita esses
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function letra(n) {                             // 0 -> A, 25 -> Z, 26 -> AA
    var s = '';
    for (n = n + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s;
    return s;
  }
  // dia e hora do jeito que o Excel guarda: dias desde 30/12/1899, na hora local
  function serial(d) { return (d.getTime() - d.getTimezoneOffset() * 60000) / 86400000 + 25569; }

  function celula(valor, col, lin, tipo) {
    var ref = letra(col) + lin;
    if (valor == null || valor === '') return '';
    if (tipo === 'data') {
      var d = valor instanceof Date ? valor : new Date(valor);
      if (!isNaN(d.getTime())) return '<c r="' + ref + '" s="2"><v>' + serial(d) + '</v></c>';
    }
    if (tipo === 'numero' && typeof valor === 'number' && isFinite(valor)) {
      return '<c r="' + ref + '"><v>' + valor + '</v></c>';
    }
    return '<c r="' + ref + '"' + (tipo === 'longo' ? ' s="3"' : '') + ' t="inlineStr"><is><t xml:space="preserve">' +
           xml(valor) + '</t></is></c>';
  }

  function folha(p) {
    var cols = p.colunas || [], linhas = p.linhas || [];
    var ultima = letra(Math.max(cols.length, 1) - 1) + (linhas.length + 1);
    var s = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<dimension ref="A1:' + ultima + '"/>' +
      '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
      '</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>' +
      '<cols>' + cols.map(function (c, i) {
        return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + (c.largura || 18) + '" customWidth="1"/>';
      }).join('') + '</cols><sheetData>' +
      '<row r="1" ht="22" customHeight="1">' + cols.map(function (c, i) {
        return '<c r="' + letra(i) + '1" s="1" t="inlineStr"><is><t>' + xml(c.titulo) + '</t></is></c>';
      }).join('') + '</row>';
    linhas.forEach(function (l, i) {
      s += '<row r="' + (i + 2) + '">' + cols.map(function (c, j) { return celula(l[j], j, i + 2, c.tipo); }).join('') + '</row>';
    });
    return s + '</sheetData><autoFilter ref="A1:' + ultima + '"/></worksheet>';
  }

  // o nome da aba tem regras do Excel: até 31 letras, sem \ / ? * [ ] :
  function nomeAba(n, i) {
    return (String(n || '').replace(/[\\\/\?\*\[\]:]/g, ' ').trim().slice(0, 31)) || ('Planilha' + (i + 1));
  }

  var ESTILOS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy\\ hh:mm"/></numFmts>' +
    '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>' +
      '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>' +
    '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FF1E2B8C"/><bgColor indexed="64"/></patternFill></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="4">' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf>' +
      '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="left"/></xf>' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>' +
    '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

  // devolve os bytes do .xlsx (Uint8Array)
  function montar(planilhas) {
    planilhas = (planilhas || []).filter(Boolean);
    if (!planilhas.length) planilhas = [{ nome: 'Planilha1', colunas: [], linhas: [] }];
    var cab = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
    var arquivos = [
      { nome: '[Content_Types].xml', texto: cab +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        planilhas.map(function (p, i) {
          return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
        }).join('') + '</Types>' },
      { nome: '_rels/.rels', texto: cab +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>' },
      { nome: 'xl/workbook.xml', texto: cab +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
        planilhas.map(function (p, i) {
          return '<sheet name="' + xml(nomeAba(p.nome, i)) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>';
        }).join('') + '</sheets></workbook>' },
      { nome: 'xl/_rels/workbook.xml.rels', texto: cab +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        planilhas.map(function (p, i) {
          return '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>';
        }).join('') +
        '<Relationship Id="rId' + (planilhas.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        '</Relationships>' },
      { nome: 'xl/styles.xml', texto: ESTILOS }
    ];
    planilhas.forEach(function (p, i) {
      arquivos.push({ nome: 'xl/worksheets/sheet' + (i + 1) + '.xml', texto: folha(p) });
    });
    return zip(arquivos);
  }

  // "usuarios" -> "lube-usuarios-2026-11-13_1430.xlsx"
  function nomeArquivo(base) {
    var d = new Date();
    var p2 = function (n) { return (n < 10 ? '0' : '') + n; };
    return 'lube-' + String(base || 'planilha').toLowerCase().replace(/[^a-z0-9-]+/g, '-') + '-' +
      d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + '_' + p2(d.getHours()) + p2(d.getMinutes()) + '.xlsx';
  }

  function baixar(base, planilhas) {
    var blob = new Blob([montar(planilhas)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = nomeArquivo(base);
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    return a.download;
  }

  raiz.LubeExcel = { montar: montar, baixar: baixar, nomeArquivo: nomeArquivo };
})(typeof window !== 'undefined' ? window : globalThis);
