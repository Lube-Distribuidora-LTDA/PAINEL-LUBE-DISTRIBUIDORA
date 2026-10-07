/* =========================================================
   SENTINELA LUBE — modo demonstração
   Só é carregado em localhost/127.0.0.1 com ?demo=1.
   Imita as RPC do banco (mesmos nomes, argumentos e formato
   JSON do contrato) com dados sintéticos coerentes: os eventos
   passam por uma cópia das regras do guarda, e painel, globo,
   tabela e KPIs são calculados a partir desses eventos.
   IPs são dos blocos reservados para documentação
   (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24, 2001:db8::/32)
   — nenhum endereço real aparece aqui.
   Este arquivo é público (fica no site): projetos, endereços, listas
   de arquivos e exposições daqui são FICTÍCIOS. O inventário real só
   existe no banco, atrás de is_admin().
   Parâmetros extras de teste: &ia=sem_chave|erro, &cadeia=quebrada|vazia,
   &falhar=rpc:codigo (ex.: sentinela_painel:57014), &rede=0.
   ========================================================= */
(function () {
  'use strict';

  var SNT = window.SNT = window.SNT || {};
  var Q = new URLSearchParams(location.search);
  var MIN = 60000, HORA = 3600000, DIA = 86400000;

  /* ---------------- tabelas fixas (no formato dos seeds; valores fictícios) ---------------- */
  var SISTEMAS = [
    ['prj_demo_portal', 'demo-portal', 'Painel Lube', 'https://portal.exemplo.example', null,
      ['^/db/', '^/backup/', '\\.sql$', '^/README\\.md$']],
    ['prj_demo_compras', 'demo-compras', 'BI Compras', 'https://compras.exemplo.example', 'demo-compras', []],
    ['prj_demo_comercial', 'demo-comercial', 'BI Comercial', 'https://comercial.exemplo.example', 'demo-comercial', ['^/db/']],
    ['prj_demo_financeiro', 'demo-financeiro', 'Gestão Financeiro', 'https://financeiro.exemplo.example', 'demo-financeiro', []],
    ['prj_demo_ti', 'demo-ti', 'Gestão TI', 'https://ti.exemplo.example', 'demo-ti', []],
    ['prj_demo_rh', 'demo-rh', 'RH Absenteísmo', 'https://rh.exemplo.example', 'demo-rh',
      ['\\.(xlsx?|csv|sql)$', '^/backup/', '^/README\\.md$']],
    ['prj_demo_saidas', 'demo-saidas', 'Saída de Veículos', 'https://saidas.exemplo.example', 'demo-saidas',
      ['\\.py$', '^/README\\.md$']],
    ['prj_demo_icms', 'demo-icms', 'Painel ICMS', 'https://icms.exemplo.example', 'demo-icms', []]
  ].map(function (s) {
    return { projeto_id: s[0], projeto: s[1], nome: s[2], url: s[3], sistema_slug: s[4], exige_login: false,
             rotas_publicas: [], arquivos_proibidos: s[5], ultimo_sinal: null, guarda_versao: null,
             guarda_runtime: null, ultimo_ambiente: null, ativo: true };
  });
  var NOME = {};
  SISTEMAS.forEach(function (s) { NOME[s.projeto] = s.nome; });

  // inventário de exemplo: só mostra o formato do módulo (sem sistema, endereço ou evidência reais)
  var EXPOSICOES = [
    ['Sistema exemplo A', 'critica', 'Exemplo: rota de dados respondendo sem login', 'Exemplo fictício: GET /api/exemplo respondeu 200 sem sessão.', 'Ligar "exige login" deste sistema na Sentinela.', 'aceita', 'Exemplo de risco aceito, com a decisão registrada.'],
    ['Sistema exemplo B', 'critica', 'Exemplo: tabela aceitando escrita anônima', 'Exemplo fictício: política de banco permissiva para o papel anônimo.', 'Exigir login e restringir a política por usuário.', 'aberta', null],
    ['Sistema exemplo B', 'alta', 'Exemplo: arquivos internos publicados', 'Exemplo fictício: /backup/exemplo.csv respondeu 200.', 'Ativar arquivos proibidos no modo proteger; tirar do que é publicado.', 'aceita', 'Exemplo de risco aceito, com a decisão registrada.'],
    ['Sistema exemplo C', 'alta', 'Exemplo: login desligado temporariamente', 'Exemplo fictício: chave de configuração desligando a autenticação.', 'Religar o login.', 'aberta', null],
    ['Sistema exemplo D', 'alta', 'Exemplo: sistema público sem autenticação', 'Exemplo fictício: página principal abre sem login.', 'Ligar "exige login" na Sentinela.', 'aberta', null],
    ['Sistema exemplo E', 'alta', 'Exemplo: dados de relatório no endereço principal', 'Exemplo fictício: /dados-exemplo.json respondeu 200.', 'Exigir login ou mover os dados.', 'aceita', 'Exemplo de risco aceito, com a decisão registrada.'],
    ['Sistema exemplo A', 'media', 'Exemplo: rota de IA sem limite', 'Exemplo fictício: POST /api/exemplo-ia aceita chamadas anônimas.', 'Limitar por sessão e taxa.', 'aberta', null],
    ['Sistema exemplo C', 'media', 'Exemplo: rota que depende só do middleware', 'Exemplo fictício: /api/exemplo não confere a sessão por conta própria.', 'Checagem de sessão em cada rota.', 'aberta', null],
    ['Sistema exemplo F', 'media', 'Exemplo: proteção de senha vazada desligada', 'Exemplo fictício: opção de autenticação desligada.', 'Ligar a proteção.', 'aberta', null],
    ['Sistema exemplo F', 'media', 'Exemplo: plano de hospedagem limitado', 'Exemplo fictício: limites de firewall e de logs do plano.', 'Avaliar outro plano.', 'aberta', null],
    ['Sistema exemplo E', 'media', 'Exemplo: assistente aberto a anônimos', 'Exemplo fictício: rota de assistente sem sessão.', 'Exigir sessão.', 'aberta', null],
    ['Sistema exemplo D', 'baixa', 'Exemplo: painel aberto por decisão', 'Exemplo fictício: sistema sem proteção por escolha.', '—', 'aceita', 'Exemplo de decisão registrada.'],
    ['Sistema exemplo A', 'baixa', 'Exemplo: arquivo de documentação publicado', 'Exemplo fictício: /README.md respondeu 200.', 'Arquivos proibidos no modo proteger.', 'aceita', 'Exemplo de risco aceito, com a decisão registrada.']
  ].map(function (e, i) {
    var t = new Date('2026-10-05T12:00:00Z').toISOString();
    return { id: i + 1, sistema: e[0], severidade: e[1], titulo: e[2], evidencia: e[3], recomendacao: e[4],
             status: e[5], decisao: e[6], verificado_em: t, atualizado_em: t };
  });

  /* ---------------- quem visita (sintético) ---------------- */
  var CHROME_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';
  var EDGE_WIN = CHROME_WIN + ' Edg/129.0.0.0';
  var ANDROID = 'Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';
  var IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1';
  var MAC_SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15';
  var MAC_CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';
  var FIREFOX_LINUX = 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0';
  var PAGINAS = ['/', '/', '/index.html', '/api/dados', '/api/dados', '/app.js', '/dados.json'];
  // sem login, o guarda só deixa passar o que é público: a tela de login e arquivos públicos
  var PUBLICAS = ['/login', '/login', '/favicon.ico', '/app.js', '/logo.svg'];
  var CRON = 'vercel-cron/1.0';
  var VARREDURA = ['/.env', '/wp-login.php', '/.git/config', '/phpmyadmin/', '/xmlrpc.php', '/config.yml', '/actuator/health', '/vendor/phpunit/phpunit/src/Util/PHP/eval-stdin.php'];

  // [ip, cidade, regiao, pais, lat, lon, ua, idioma, sistemas, eventos/24h, extras]
  var ATORES = [
    ['203.0.113.10', 'Cariacica', 'ES', 'BR', -20.2632, -40.4165, CHROME_WIN, 'pt-BR,pt;q=0.9', ['demo-portal', 'demo-compras', 'demo-comercial'], 160, { identidade: 'compras.demo@lube.com.br', origem: 'passe' }],
    ['203.0.113.11', 'Cariacica', 'ES', 'BR', -20.2650, -40.4180, EDGE_WIN, 'pt-BR,pt;q=0.9', ['demo-financeiro', 'demo-ti', 'demo-portal'], 120, { identidade: 'financeiro.demo@lube.com.br', origem: 'sessao_app' }],
    ['203.0.113.12', 'Cariacica', 'ES', 'BR', -20.2620, -40.4150, CHROME_WIN, 'pt-BR,pt;q=0.9', ['demo-rh', 'demo-saidas', 'demo-portal'], 70, { provavel: 'rh.demo@lube.com.br', caminhos: PUBLICAS }],
    ['203.0.113.25', 'Vitória', 'ES', 'BR', -20.3155, -40.3128, ANDROID, 'pt-BR', ['demo-comercial', 'demo-portal'], 55, { identidade: 'vendas.demo@lube.com.br', origem: 'passe' }],
    ['203.0.113.31', 'Vila Velha', 'ES', 'BR', -20.3297, -40.2925, IPHONE, 'pt-BR', ['demo-compras'], 22, { caminhos: PUBLICAS }],
    ['203.0.113.40', 'Serra', 'ES', 'BR', -20.1286, -40.3078, CHROME_WIN, 'pt-BR,pt;q=0.9', ['demo-saidas', 'demo-portal'], 40, { identidade: 'logistica.demo@lube.com.br', origem: 'sessao_app' }],
    ['203.0.113.52', 'Linhares', 'ES', 'BR', -19.3911, -40.0722, ANDROID, 'pt-BR', ['demo-comercial'], 26, { identidade: 'rca.norte.demo@lube.com.br', origem: 'passe' }],
    ['2001:db8:4f2a::17', 'São Paulo', 'SP', 'BR', -23.5505, -46.6333, MAC_CHROME, 'pt-BR,pt;q=0.9,en;q=0.8', ['demo-compras', 'demo-comercial', 'demo-portal'], 34, { identidade: 'diretoria.demo@lube.com.br', origem: 'passe' }],
    ['203.0.113.77', 'Belo Horizonte', 'MG', 'BR', -19.9167, -43.9345, FIREFOX_LINUX, 'pt-BR', ['demo-portal'], 9, { caminhos: ['/', '/', '/index.html', '/app.js'] }],
    ['203.0.113.88', 'Rio de Janeiro', 'RJ', 'BR', -22.9068, -43.1729, IPHONE, 'pt-BR', ['demo-comercial'], 12, { caminhos: PUBLICAS }],
    ['203.0.113.95', 'Colatina', 'ES', 'BR', -19.5389, -40.6306, ANDROID, 'pt-BR', ['demo-comercial', 'demo-portal'], 18, { identidade: 'rca.colatina.demo@lube.com.br', origem: 'passe' }],
    ['203.0.113.120', 'Lisboa', 'LIS', 'PT', 38.7223, -9.1393, MAC_SAFARI, 'pt-PT,pt;q=0.9', ['demo-compras', 'demo-portal'], 14, { identidade: 'diretoria.demo@lube.com.br', origem: 'passe' }],
    ['203.0.113.140', 'Miami', 'FL', 'US', 25.7617, -80.1918, CHROME_WIN, '', ['demo-portal'], 5, { semFetch: true, caminhos: ['/', '/index.html'] }],
    // robôs aceitos: o agendador do Gestão TI chega com o segredo conferido pelo próprio sistema
    // (identidade de robô); o do Financeiro e a prévia de link só alcançam rota/página pública
    ['198.51.100.30', 'Ashburn', 'VA', 'US', 39.0438, -77.4874, CRON, '', ['demo-ti'], 24,
      { identidade: 'robo do gestao ti (agendador da vercel)', origem: 'sessao_app', caminhos: ['/api/cron/ler-emails', '/api/cron/cobrar', '/api/cron/resumo'] }],
    ['198.51.100.33', 'Ashburn', 'VA', 'US', 39.0438, -77.4874, CRON, '', ['demo-financeiro'], 6, { caminhos: ['/api/cron/fechamento'] }],
    ['203.0.113.97', 'Vitória', 'ES', 'BR', -20.3155, -40.3128, 'WhatsApp/2.24.19.86 A', '', ['demo-portal'], 7, { caminhos: ['/'] }],
    // robôs e ataques
    ['198.51.100.23', 'Amsterdã', 'NH', 'NL', 52.3676, 4.9041, CHROME_WIN, '', ['demo-portal', 'demo-compras'], 16, { caminhos: VARREDURA, desde: 3.2 * HORA }],
    ['198.51.100.47', 'Frankfurt', 'HE', 'DE', 50.1109, 8.6821, 'sqlmap/1.8.3#stable (https://sqlmap.org)', '', ['demo-comercial'], 30, { caminhos: ['/api/dados'], consulta: '?id=1', desde: 55 * MIN, rajada: true }],
    ['198.51.100.61', 'Singapura', '01', 'SG', 1.3521, 103.8198, 'python-requests/2.31.0', '', ['demo-financeiro'], 64, { caminhos: ['/api/dados'], desde: 25 * MIN, rajada: true }],
    ['198.51.100.80', 'Ashburn', 'VA', 'US', 39.0438, -77.4874, 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', '', ['demo-portal', 'demo-compras'], 20, {}],
    ['198.51.100.95', 'São Petersburgo', 'SPE', 'RU', 59.9311, 30.3609, CHROME_WIN, 'ru-RU', ['demo-comercial'], 8, { caminhos: ['/api/dados'], consulta: "?id=1'%20or%20'1'='1", desde: 6 * HORA }],
    ['198.51.100.110', 'Hanói', 'HN', 'VN', 21.0278, 105.8342, CHROME_WIN, 'vi-VN', ['demo-portal'], 14, { caminhos: ['/'], desde: 30 * MIN, rajada: true }],
    ['192.0.2.44', 'Bucareste', 'B', 'RO', 44.4268, 26.1025, 'Mozilla/5.0 (Windows NT 10.0; rv:128.0) Gecko/20100101 Firefox/128.0', 'en-US,en;q=0.5', ['demo-compras', 'demo-ti'], 11, {}],
    ['192.0.2.58', 'Seul', '11', 'KR', 37.5665, 126.978, 'curl/8.4.0', '', ['demo-comercial'], 26, { caminhos: ['/api/dados'], desde: 2 * HORA }],
    ['192.0.2.71', 'Mumbai', 'MH', 'IN', 19.076, 72.8777, 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', 'en-US', ['demo-portal'], 6, { caminhos: ['/db/schema.sql', '/backup/dados.csv', '/README.md'], desde: 4 * HORA, semFetch: true }],
    ['192.0.2.90', 'Toronto', 'ON', 'CA', 43.6532, -79.3832, 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/124.0.0.0 Safari/537.36', 'en-US', ['demo-compras'], 22, { caminhos: ['/', '/api/dados', '/dados.json'], desde: 9 * HORA }],
    ['192.0.2.150', 'Joanesburgo', 'GP', 'ZA', -26.2041, 28.0473, CHROME_WIN, '', ['demo-portal'], 5, { caminhos: ['/', '/login'], desde: 8 * HORA }]
  ].map(function (a) {
    var x = a[10];
    return { ip: a[0], cidade: a[1], regiao: a[2], pais: a[3], lat: a[4], lon: a[5], ua: a[6], idioma: a[7],
             sistemas: a[8], n: a[9], identidade: x.identidade || null, origem: x.origem || null,
             provavel: x.provavel || null, caminhos: x.caminhos || PAGINAS, consulta: x.consulta || '',
             desde: x.desde || 0, rajada: !!x.rajada, semFetch: !!x.semFetch };
  });

  // atacantes que aparecem durante a demonstração (varredura → bloqueio certo → anel vermelho)
  var NOVOS = [
    ['Chicago', 'IL', 'US', 41.8781, -87.6298], ['Londres', 'ENG', 'GB', 51.5072, -0.1276],
    ['Tóquio', '13', 'JP', 35.6762, 139.6503], ['Paris', 'IDF', 'FR', 48.8566, 2.3522],
    ['Sydney', 'NSW', 'AU', -33.8688, 151.2093], ['Cidade do México', 'CMX', 'MX', 19.4326, -99.1332],
    ['Istambul', '34', 'TR', 41.0082, 28.9784], ['Madri', 'MD', 'ES', 40.4168, -3.7038],
    ['Varsóvia', '14', 'PL', 52.2297, 21.0122], ['Santiago', 'RM', 'CL', -33.4489, -70.6693]
  ];

  /* ---------------- regras (cópia do §1) ---------------- */
  var RE_FERRAMENTA = /sqlmap|nikto|nmap|masscan|zgrab|nuclei|wpscan|dirbuster|gobuster|ffuf|feroxbuster|hydra|acunetix|nessus|openvas|w3af|arachni|jaeles|zmeu|morfeus|l9explore|fuzz faster|commix|xsstrike|whatweb|wfuzz/i;
  var RE_VARREDURA = /^\/\.(env|git|svn|hg|aws|ssh|DS_Store|htaccess|htpasswd)|^\/wp-(admin|login|content|includes|json)|xmlrpc\.php|\.(php\d?|asp|aspx|jsp|cgi|pl)$|^\/phpmyadmin|^\/pma\/|^\/cgi-bin\/|^\/vendor\/phpunit|^\/server-status|^\/actuator|^\/(config|credentials|secrets?)\.(ya?ml|ini|bak|old)$|\.(bak|old|swp|save)$/i;
  var RE_INJECAO = /\.\.\/|<script|javascript:|union(\s|\+|\/\*.*\*\/)+select|information_schema|\bsleep\(\s*\d|benchmark\(|\$\{jndi:|\/etc\/passwd|cmd\.exe|'\s*or\s*'?1'?\s*=\s*'?1|\bor\s+1\s*=\s*1\b/i;
  var RE_ROBO = /curl|wget|python-requests|python-urllib|aiohttp|httpx|go-http-client|okhttp|java\/|libwww|axios|node-fetch|undici|postmanruntime|insomnia|headlesschrome|phantomjs|scrapy|httpclient|powershell/i;
  var RE_BUSCADOR = /googlebot|bingbot|duckduckbot|yandexbot|baiduspider|applebot/i;
  var RE_CRON = /vercel-cron\//i;
  var RE_PREVIA = /whatsapp|telegrambot|slackbot|facebookexternalhit|twitterbot|linkedinbot|discordbot|skypeuripreview|microsoftpreview/i;
  var BASE = { ferramenta: 95, injecao: 95, varredura: 90, lista: 80, rajada: 70, arquivo_proibido: 60, tor: 60,
               forca_bruta: 70, robo: 50, sem_login: 30, buscador: 10 };

  /* ---------------- estado ---------------- */
  var cfg = {
    modo: 'observar', casa_nome: 'Lube Distribuidora · Cariacica-ES', casa_lat: -20.2632, casa_lon: -40.4165,
    limite_rajada_min: 120, limite_eventos_ip_min: 30, ia_limite_hora: 60, ia_confianca_min: 0.85,
    ia_status: Q.get('ia') === 'sem_chave' ? 'sem_chave' : Q.get('ia') === 'erro' ? 'erro' : 'ligada',
    ia_status_detalhe: Q.get('ia') === 'sem_chave' ? 'ANTHROPIC_API_KEY não cadastrada'
                     : Q.get('ia') === 'erro' ? 'HTTP 529 da Anthropic (sobrecarga) às 13:58' : null,
    ia_status_em: null, tor_atualizado_em: null, manutencao_em: null, retencao_dias: 90,
    atualizado_em: null, atualizado_por: 'demo@lube.com.br'
  };
  var eventos = [], bloqueios = [], confiaveis = [], analises = [], identidades = [], acoes = [];
  var ips = {};
  var seq = { ev: 184200, bl: 40, cf: 10, an: 300 };
  var inicio = Date.now();
  var ultimaGeracao = Date.now();
  var proximoAtaque = Date.now() + 9000;
  var iaMiamiEm = Date.now() + 40000;
  var novosUsados = 0;
  // robôs aceitos chegam em horário marcado (como um agendamento), não sorteados com o tráfego
  var ROBOS_AGENDA = ['198.51.100.30', '203.0.113.97', '198.51.100.33', '198.51.100.30'];
  var proximoRobo = Date.now() + 5000;
  var robosUsados = 0;
  var redeLigada = true;
  var seloAtual = hex(64);

  function hex(n) { var s = ''; while (s.length < n) s += Math.floor(Math.random() * 16).toString(16); return s; }
  function iso(t) { return new Date(t).toISOString(); }
  function sorteia(lista) { return lista[Math.floor(Math.random() * lista.length)]; }

  /* ---------------- redes ---------------- */
  function ip4(v) {
    var p = String(v).split('.');
    if (p.length !== 4) return null;
    return ((+p[0] << 24) >>> 0) + (+p[1] << 16) + (+p[2] << 8) + (+p[3]);
  }
  function casa(ip, valor) {
    if (valor.indexOf('/') < 0) return ip === valor;
    var x = valor.split('/'), a = ip4(ip), b = ip4(x[0]);
    if (a == null || b == null) return false;
    var bits = +x[1];
    var mascara = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return ((a & mascara) >>> 0) === ((b & mascara) >>> 0);
  }
  function ativoB(b, t) {
    return !b.revogado_em && new Date(b.criado_em).getTime() <= t && (!b.expira_em || new Date(b.expira_em).getTime() > t);
  }
  function ativoC(c, t) { return !c.removido_em && (!c.expira_em || new Date(c.expira_em).getTime() > t); }
  function confiavel(ip, t) {
    return confiaveis.some(function (c) { return ativoC(c, t || Date.now()) && casa(ip, c.valor); });
  }
  function bloqueioDe(ip, t) {
    var lista = bloqueios.filter(function (b) { return ativoB(b, t) && b.tipo !== 'ja4' && casa(ip, b.valor); });
    lista.sort(function (a, b) { return (b.nivel === 'certo') - (a.nivel === 'certo') || b.id - a.id; });
    return lista[0] || null;
  }

  // como sentinela.bloquear: ativo com mesmo valor, nível e origem → estende (null = permanente) e soma 1 em hits
  function criarBloqueio(d, t) {
    var existente = bloqueios.filter(function (b) {
      return ativoB(b, t) && b.valor === d.valor && b.nivel === d.nivel && b.origem === (d.origem || 'regra');
    })[0];
    if (existente) {
      if (existente.expira_em && (!d.expira_em || d.expira_em > existente.expira_em)) existente.expira_em = d.expira_em;
      existente.hits++; existente.ultimo_hit = iso(t);
      return existente;
    }
    // como sentinela.bloquear: bloqueio manual do admin tem regra 'manual'
    var b = { id: ++seq.bl, tipo: d.valor.indexOf('/') > -1 ? 'cidr' : 'ip', valor: d.valor, nivel: d.nivel,
              origem: d.origem || 'regra', regra: d.regra || (d.origem === 'manual' ? 'manual' : null), motivo: d.motivo, criado_em: iso(t),
              expira_em: d.expira_em || null, revogado_em: null, revogado_por: null, criado_por: d.criado_por || null,
              evento_id: d.evento_id || null, analise_id: d.analise_id || null, hits: 0, ultimo_hit: null };
    bloqueios.push(b);
    return b;
  }

  /* ---------------- guarda + central (imitação) ---------------- */
  function decidir(ev, t) {
    var conf = confiavel(ev.ip, t);
    var ua = ev.ua || '';
    var alvo = ev.caminho + decodeURIComponent(ev.consulta || '');
    function certo(regra, motivo) {
      return { decisao: 'bloqueado', regra: regra, motivo: conf ? 'ataque partindo de rede confiável — verificar máquina' : motivo, conf: conf };
    }
    function suspeito(regra, motivo) {
      if (conf) return { decisao: 'liberado', regra: null, motivo: null };
      return { decisao: cfg.modo === 'proteger' ? 'bloqueado' : 'observado', regra: regra,
               motivo: (cfg.modo === 'proteger' ? '' : 'seria bloqueado: ') + motivo };
    }
    if (RE_BUSCADOR.test(ua)) return { decisao: 'observado', regra: 'buscador', motivo: 'buscador conhecido' };
    var f = ua.match(RE_FERRAMENTA);
    if (f) return certo('ferramenta', 'ferramenta de ataque: ' + f[0].toLowerCase());
    if (RE_VARREDURA.test(ev.caminho)) return certo('varredura', 'varredura: ' + ev.caminho);
    if (RE_INJECAO.test(alvo)) return certo('injecao', 'injeção na consulta');
    var b = bloqueioDe(ev.ip, t);
    if (b) {
      b.hits++; b.ultimo_hit = iso(t);
      if (b.nivel === 'certo') return { decisao: 'bloqueado', regra: 'lista', motivo: 'lista: ' + (b.regra || b.origem) + ' #' + b.id };
      var s = suspeito('lista', (b.regra || b.origem) + ' #' + b.id);
      if (s.decisao !== 'liberado') return s;
    }
    var sis = SISTEMAS.filter(function (x) { return x.projeto === ev.projeto; })[0];
    if (sis && sis.arquivos_proibidos.some(function (r) { try { return new RegExp(r).test(ev.caminho); } catch (e) { return false; } })) {
      return suspeito('arquivo_proibido', 'arquivo proibido: ' + ev.caminho);
    }
    // exceções do guarda: só depois das regras de ataque, antes da de robô
    if (RE_CRON.test(ua)) return { decisao: 'liberado', regra: 'cron', motivo: 'agendamento da Vercel' };
    if (RE_PREVIA.test(ua)) return { decisao: 'liberado', regra: 'previa_link', motivo: 'prévia de link' };
    if ((!ua || RE_ROBO.test(ua)) && (ev.tipo === 'pagina' || ev.tipo === 'api')) {
      var m = ua.match(RE_ROBO);
      return suspeito('robo', 'robô: ' + (m ? m[0].toLowerCase() : 'sem user-agent'));
    }
    return { decisao: 'liberado', regra: null, motivo: null };
  }

  function risco(ev, conf, novoIp) {
    var r = BASE[ev.regra] || 0;
    if (ev.tipo === 'pagina' && !ev.sec_fetch_mode) r += 15;
    if (!ev.idioma) r += 10;
    if (ev.pais !== 'BR' && novoIp) r += 10;
    if (ev.identidade) r -= 50;
    if (conf) r -= 40;
    if (conf && ev.decisao === 'bloqueado' && ev.regra !== 'lista') r = 100;
    return Math.max(0, Math.min(100, r));
  }

  function tipoDe(caminho) {
    if (caminho.indexOf('/api/') === 0) return 'api';
    var ext = (caminho.split('/').pop() || '').match(/\.([a-z0-9]+)$/i);
    return ext && ext[1].toLowerCase() !== 'html' ? 'arquivo' : 'pagina';
  }

  // monta e grava um evento (o que o guarda mandaria + o que o banco calcula)
  function registrar(a, t, caminho, projeto) {
    projeto = projeto || sorteia(a.sistemas);
    caminho = caminho || sorteia(a.caminhos);
    var sis = SISTEMAS.filter(function (s) { return s.projeto === projeto; })[0];
    var ev = {
      id: ++seq.ev, criado_em: iso(t), projeto: projeto, ambiente: 'production',
      host: sis.url.replace('https://', ''), metodo: 'GET', caminho: caminho,
      consulta: caminho.indexOf('/api/') === 0 ? a.consulta : '', tipo: tipoDe(caminho),
      ip: a.ip, pais: a.pais, regiao: a.regiao, cidade: a.cidade, lat: a.lat, lon: a.lon,
      ua: a.ua, idioma: a.idioma || null, sec_fetch_mode: a.semFetch || !/Mozilla/.test(a.ua) ? null : 'navigate',
      identidade: a.identidade, identidade_origem: a.origem
    };
    var dec = decidir(ev, t);
    ev.decisao = dec.decisao; ev.regra = dec.regra; ev.motivo = dec.motivo;
    var perfil = ips[a.ip];
    var conf = confiavel(a.ip, t);
    ev.risco = risco(ev, conf, !perfil);
    ev.selo = hex(64);
    seloAtual = ev.selo;
    eventos.push(ev);

    // perfil por IP
    if (!perfil) {
      perfil = ips[a.ip] = { ip: a.ip, primeiro_visto: ev.criado_em, ultimo_visto: ev.criado_em, total: 0, descartados: 0,
        pais: a.pais, regiao: a.regiao, cidade: a.cidade, lat: a.lat, lon: a.lon, ua_ultimo: a.ua, projetos: [],
        risco_max: 0, identidade: a.identidade || a.provavel || null, identidade_em: (a.identidade || a.provavel) ? ev.criado_em : null,
        ultima_analise_em: null, ultimo_veredito: null };
    }
    perfil.total++; perfil.ultimo_visto = ev.criado_em; perfil.ua_ultimo = a.ua;
    if (perfil.projetos.indexOf(projeto) < 0) perfil.projetos.push(projeto);
    perfil.risco_max = Math.max(perfil.risco_max, ev.risco);
    sis.ultimo_sinal = ev.criado_em;
    sis.guarda_versao = 'sentinela-guarda/1.0.0';
    sis.guarda_runtime = projeto === 'demo-ti' ? 'edge' : 'nodejs';
    sis.ultimo_ambiente = 'production';

    // regras centrais
    if (!conf && (ev.regra === 'ferramenta' || ev.regra === 'varredura' || ev.regra === 'injecao')) {
      criarBloqueio({ valor: a.ip, nivel: 'certo', regra: ev.regra, motivo: ev.motivo, expira_em: iso(t + DIA), evento_id: ev.id }, t);
    }
    if (!conf && ev.regra === 'robo') {
      var robo10 = eventos.filter(function (e) {
        return e.ip === a.ip && e.regra === 'robo' && t - new Date(e.criado_em).getTime() <= 10 * MIN;
      }).length;
      if (robo10 >= 20) criarBloqueio({ valor: a.ip, nivel: 'suspeito', regra: 'robo', motivo: '20 ou mais acessos de robô em 10 min', expira_em: iso(t + HORA), evento_id: ev.id }, t);
    }
    return ev;
  }

  function quandoComercial(agora) {
    // mais acesso entre 7h e 19h de Brasília (UTC−3)
    for (var i = 0; i < 6; i++) {
      var t = agora - Math.random() * DIA;
      var h = (new Date(t).getUTCHours() + 21) % 24;
      if (h >= 7 && h < 19) return t;
    }
    return agora - Math.random() * DIA;
  }

  /* ---------------- história das últimas 24 h ---------------- */
  function semear() {
    var agora = Date.now();
    // confiáveis
    confiaveis.push({ id: ++seq.cf, tipo: 'cidr', valor: '203.0.113.0/28', rede: '203.0.113.0/28',
      descricao: 'Escritório Lube (exemplo)', origem: 'manual', identidade: null,
      criado_em: iso(agora - 20 * DIA), expira_em: null, removido_em: null, criado_por: 'cpd@lube.com.br' });
    [['203.0.113.25', 'vendas.demo@lube.com.br'], ['203.0.113.52', 'rca.norte.demo@lube.com.br'],
     ['2001:db8:4f2a::17', 'diretoria.demo@lube.com.br']].forEach(function (c, i) {
      confiaveis.push({ id: ++seq.cf, tipo: 'ip', valor: c[0], rede: c[0] + (c[0].indexOf(':') > -1 ? '/128' : '/32'),
        descricao: 'aprendido por login', origem: 'login', identidade: c[1], criado_em: iso(agora - (i + 1) * 9 * HORA),
        expira_em: iso(agora + 7 * DIA - (i + 1) * 9 * HORA), removido_em: null, criado_por: null });
    });
    // bloqueios que já existiam antes da janela
    criarBloqueio({ valor: '192.0.2.128/25', nivel: 'certo', origem: 'manual', regra: null,
      motivo: 'faixa de hospedagem usada em varreduras repetidas', expira_em: null, criado_por: 'cpd@lube.com.br' }, agora - 3 * DIA);
    criarBloqueio({ valor: '192.0.2.44', nivel: 'suspeito', regra: 'tor', motivo: 'saída da rede Tor',
      expira_em: iso(agora + 19 * HORA) }, agora - 5 * HORA);
    criarBloqueio({ valor: '198.51.100.110', nivel: 'suspeito', regra: 'forca_bruta', motivo: '7 senhas erradas em 10 min',
      expira_em: iso(agora + 48 * MIN) }, agora - 12 * MIN);
    // um bloqueio antigo, já vencido (aparece no filtro de inativos)
    var velho = criarBloqueio({ valor: '198.51.100.200', nivel: 'certo', regra: 'varredura', motivo: 'varredura: /.git/config',
      expira_em: iso(agora - 2 * DIA) }, agora - 3 * DIA);
    velho.hits = 41;

    var brutos = [];
    ATORES.forEach(function (a) {
      for (var i = 0; i < a.n; i++) {
        var t;
        if (a.desde && a.rajada) t = agora - a.desde + (i / a.n) * a.desde * 0.85;
        else if (a.desde) t = agora - a.desde + Math.random() * a.desde * 0.9;
        else t = quandoComercial(agora);
        brutos.push({ a: a, t: t, i: i });
      }
    });
    brutos.sort(function (x, y) { return x.t - y.t; });
    brutos.forEach(function (b) {
      // RH Absenteísmo parou de mandar sinal há 47 min (mostra o âmbar dos sistemas)
      var projeto = sorteia(b.a.sistemas);
      if (projeto === 'demo-rh' && agora - b.t < 47 * MIN) projeto = b.a.sistemas[b.a.sistemas.length - 1];
      if (projeto === 'demo-rh' && agora - b.t < 47 * MIN) return;
      var caminho = b.a.caminhos === VARREDURA ? VARREDURA[b.i % VARREDURA.length] : null;
      registrar(b.a, b.t, caminho, projeto);
    });

    // identidades vistas pelo portal
    ATORES.forEach(function (a) {
      var email = a.identidade || a.provavel;
      if (!email) return;
      identidades.push({ id: identidades.length + 1, ip: a.ip, user_id: null, email: email,
        origem: a.identidade ? (a.origem === 'sessao_app' ? 'sessao_app' : 'passe') : 'portal', ua: a.ua,
        criado_em: iso(agora - Math.random() * 6 * HORA) });
    });

    // análises da IA já feitas
    analise('192.0.2.58', 'malicioso', 0.93, 'Raspagem automatizada do /api/dados com curl, sem navegador.', 'bloquear_24h', agora - 35 * MIN);
    analise('192.0.2.90', 'suspeito', 0.64, 'Navegador sem tela lendo páginas e dados em sequência; pode ser teste.', 'observar', agora - 3 * HORA);
    analise('198.51.100.80', 'legitimo', 0.97, 'Robô do Google indexando páginas públicas.', 'nenhuma', agora - 7 * HORA);
    analise('198.51.100.110', 'malicioso', 0.88, 'Tentativas de senha em sequência no portal.', 'bloquear_1h', agora - 11 * MIN);
    analise('192.0.2.71', 'suspeito', 0.71, 'Pedidos diretos de arquivos internos do repositório.', 'observar', agora - 4 * HORA + 20 * MIN);
    cfg.ia_status_em = iso(agora - 11 * MIN);
    cfg.tor_atualizado_em = iso(agora - 5 * HORA);
    cfg.manutencao_em = iso(agora - 9 * HORA);
  }

  function analise(ip, veredito, confianca, motivo, acao, t) {
    var a = { id: ++seq.an, ip: ip, criado_em: iso(t), modelo: 'claude-haiku-4-5-20251001', veredito: veredito,
              confianca: confianca, motivo: motivo, acao: acao, aplicado: 'nenhum',
              tokens_entrada: 1800 + Math.floor(Math.random() * 900), tokens_saida: 60 + Math.floor(Math.random() * 40), erro: null };
    if (veredito === 'malicioso' && confianca >= cfg.ia_confianca_min && /^bloquear_/.test(acao)) {
      if (confiavel(ip, t)) a.aplicado = 'confiável: ignorado';
      else {
        var dur = { bloquear_1h: HORA, bloquear_24h: DIA, bloquear_7d: 7 * DIA }[acao];
        var b = criarBloqueio({ valor: ip, nivel: 'suspeito', origem: 'ia', regra: 'ia', motivo: 'IA: ' + motivo,
                                expira_em: iso(t + dur), analise_id: a.id }, t);
        a.aplicado = (cfg.modo === 'proteger' ? 'bloqueio #' : 'seria bloqueado (modo observar) #') + b.id;
      }
    }
    analises.push(a);
    if (ips[ip]) { ips[ip].ultima_analise_em = a.criado_em; ips[ip].ultimo_veredito = veredito; }
    return a;
  }

  /* ---------------- tráfego ao vivo ---------------- */
  function gerarAoVivo() {
    var agora = Date.now();
    var dt = Math.min(20000, agora - ultimaGeracao);
    ultimaGeracao = agora;
    var n = Math.round((dt / 4000) * (0.6 + Math.random() * 1.6));
    var vivos = ATORES.filter(function (a) {
      return a.ip !== '198.51.100.23' && a.ip !== '198.51.100.95' && ROBOS_AGENDA.indexOf(a.ip) < 0;
    });
    var pesos = vivos.map(function (a) { return a.pais === 'BR' ? a.n : a.n * 0.3; });
    var soma = pesos.reduce(function (s, x) { return s + x; }, 0);
    for (var i = 0; i < n; i++) {
      var r = Math.random() * soma, k = 0;
      while (r > pesos[k]) { r -= pesos[k]; k++; }
      var a = vivos[Math.min(k, vivos.length - 1)];
      var projetos = a.sistemas.filter(function (p) { return p !== 'demo-rh'; });
      if (!projetos.length) continue;
      registrar(a, agora - Math.random() * dt * 0.5, null, sorteia(projetos));
    }
    if (agora >= proximoRobo) {
      proximoRobo = agora + 14000 + Math.random() * 8000;
      var ipRobo = ROBOS_AGENDA[robosUsados++ % ROBOS_AGENDA.length];
      var robo = ATORES.filter(function (a) { return a.ip === ipRobo; })[0];
      if (robo) registrar(robo, agora - 600);
    }
    if (agora >= proximoAtaque) {
      proximoAtaque = agora + 22000 + Math.random() * 18000;
      var c = NOVOS[novosUsados % NOVOS.length];
      var ator = { ip: '198.51.100.' + (150 + novosUsados), cidade: c[0], regiao: c[1], pais: c[2], lat: c[3], lon: c[4],
                   ua: CHROME_WIN, idioma: '', sistemas: [sorteia(['demo-portal', 'demo-compras', 'demo-financeiro'])],
                   n: 1, identidade: null, origem: null, provavel: null, caminhos: VARREDURA, consulta: '', semFetch: true };
      novosUsados++;
      registrar(ator, agora - 900, VARREDURA[novosUsados % VARREDURA.length]);
      registrar(ator, agora - 300, sorteia(VARREDURA));
    }
    if (iaMiamiEm && agora >= iaMiamiEm) {
      iaMiamiEm = 0;
      analise('203.0.113.140', 'legitimo', 0.74, 'Navegação comum de página, poucos acessos e sem padrão de ataque.', 'nenhuma', agora);
      cfg.ia_status_em = iso(agora);
    }
  }

  /* ---------------- montagem das respostas ---------------- */
  // como sentinela.janela_ini: começa no 1º balde do gráfico por hora (KPIs = soma do gráfico)
  function inicioJanela(horas) { return Math.floor(Date.now() / HORA) * HORA - (horas - 1) * HORA; }
  function janela(horas) {
    var desde = inicioJanela(horas);
    return eventos.filter(function (e) { return new Date(e.criado_em).getTime() >= desde; });
  }

  function feedDe(e, comGeo) {
    var x = { id: e.id, criado_em: e.criado_em, projeto: e.projeto, sistema_nome: NOME[e.projeto] || e.projeto,
              metodo: e.metodo, caminho: e.caminho, ip: e.ip, pais: e.pais, cidade: e.cidade, decisao: e.decisao,
              regra: e.regra, motivo: e.motivo, risco: e.risco, identidade: e.identidade };
    if (comGeo) { x.lat = e.lat; x.lon = e.lon; }
    return x;
  }

  function kpisDe(lista, horas) {
    var desde = inicioJanela(horas);
    var ipSet = {}, paisSet = {}, idSet = {}, b = 0, o = 0;
    lista.forEach(function (e) {
      ipSet[e.ip] = true;
      if (e.pais) paisSet[e.pais] = true;
      if (e.identidade || (ips[e.ip] && ips[e.ip].identidade)) idSet[e.ip] = true;
      if (e.decisao === 'bloqueado') b++;
      if (e.decisao === 'observado') o++;
    });
    return { acessos: lista.length, bloqueados: b, observados: o, ips: Object.keys(ipSet).length,
             paises: Object.keys(paisSet).length,
             analises: analises.filter(function (a) { return a.veredito !== 'erro' && new Date(a.criado_em).getTime() >= desde; }).length,
             identificados: Object.keys(idSet).length };
  }

  function ultimaAnalise(ip) {
    var l = analises.filter(function (a) { return a.ip === ip; });
    return l.length ? l[l.length - 1] : null;
  }

  // mesmas regras do sentinela_painel (vis1 a vis3): o bloqueio "vale" se for certo, ou
  // suspeito fora de rede confiável; observado também quando houve barrado/observado na janela;
  // análise = risco ≥ 30 sem análise nas últimas 6 h
  function statusDe(ip, evs, agora) {
    var conf = confiavel(ip, agora);
    var b = bloqueioDe(ip, agora);
    var vale = !!b && (b.nivel === 'certo' || !conf);
    if (vale && (b.nivel === 'certo' || cfg.modo === 'proteger')) return { status: 'bloqueado', motivo: U(b.regra || b.origem), b: b };
    var barrados = evs.filter(function (e) { return e.decisao === 'observado' || e.decisao === 'bloqueado'; });
    if (vale) return { status: 'observado', motivo: U(b.regra || b.origem), b: b };
    if (barrados.length) return { status: 'observado', motivo: barrados[barrados.length - 1].regra, b: b };
    var r = Math.max.apply(null, evs.map(function (e) { return e.risco; }));
    var an = ultimaAnalise(ip);
    if (!conf && r >= 30 && (!an || agora - new Date(an.criado_em).getTime() > 6 * HORA)) return { status: 'analise', motivo: 'IA analisando', b: b };
    return { status: 'seguro', motivo: null, b: b };
  }
  function U(r) { return r || 'manual'; }

  function painel(horas) {
    gerarAoVivo();
    horas = Math.max(1, Math.min(168, +horas || 24));
    var agora = Date.now();
    var lista = janela(horas);
    var porIp = {};
    lista.forEach(function (e) { (porIp[e.ip] = porIp[e.ip] || []).push(e); });

    var visitantes = [], pontos = [];
    Object.keys(porIp).forEach(function (ip) {
      var evs = porIp[ip], ult = evs[evs.length - 1], p = ips[ip] || {};
      var st = statusDe(ip, evs, agora);
      var r = Math.max.apply(null, evs.map(function (e) { return e.risco; }));
      var comId = evs.filter(function (e) { return e.identidade; });
      var an = ultimaAnalise(ip);
      var projetos = [];
      evs.forEach(function (e) { if (projetos.indexOf(e.projeto) < 0) projetos.push(e.projeto); });
      var bl = evs.filter(function (e) { return e.decisao === 'bloqueado'; }).length;
      var ob = evs.filter(function (e) { return e.decisao === 'observado'; }).length;
      visitantes.push({
        ip: ip, pais: ult.pais, regiao: ult.regiao, cidade: ult.cidade, lat: ult.lat, lon: ult.lon,
        identidade: comId.length ? comId[comId.length - 1].identidade : (p.identidade || null),
        identidade_origem: comId.length ? comId[comId.length - 1].identidade_origem : (p.identidade ? 'provavel' : null),
        confiavel: confiavel(ip, agora), ua: ult.ua, projetos: projetos, total: evs.length, ultimo: ult.criado_em,
        risco: r, status: st.status, status_motivo: st.motivo,
        bloqueio: st.b ? { id: st.b.id, nivel: st.b.nivel, regra: st.b.regra, ate: st.b.expira_em, motivo: st.b.motivo,
                           tipo: st.b.tipo, valor: st.b.valor, origem: st.b.origem } : null,
        veredito: an ? { veredito: an.veredito, confianca: an.confianca, motivo: an.motivo, em: an.criado_em } : null
      });
      pontos.push({ ip: ip, lat: ult.lat, lon: ult.lon, cidade: ult.cidade, regiao: ult.regiao, pais: ult.pais,
                    total: evs.length, bloqueados: bl, observados: ob, status: st.status, risco: r, ultimo: ult.criado_em });
    });
    visitantes.sort(function (a, b) { return a.ultimo < b.ultimo ? 1 : -1; });

    var porHora = [];
    var h0 = Math.floor(agora / HORA) * HORA;
    for (var i = horas - 1; i >= 0; i--) {
      var ini = h0 - i * HORA, fim = ini + HORA, c = { h: iso(ini), liberado: 0, observado: 0, bloqueado: 0 };
      lista.forEach(function (e) {
        var t = new Date(e.criado_em).getTime();
        if (t >= ini && t < fim) c[e.decisao]++;
      });
      porHora.push(c);
    }

    var exp = { critica: 0, alta: 0, media: 0, baixa: 0 };
    EXPOSICOES.forEach(function (e) { if (e.status !== 'corrigida') exp[e.severidade]++; });
    var ult = analises.slice().sort(function (a, b) { return a.criado_em < b.criado_em ? 1 : -1; })[0];

    return {
      agora: iso(agora), modo: cfg.modo,
      casa: { nome: cfg.casa_nome, lat: cfg.casa_lat, lon: cfg.casa_lon },
      ia: { status: cfg.ia_status, detalhe: cfg.ia_status_detalhe, status_em: cfg.ia_status_em,
            analises_janela: analises.filter(function (a) { return a.veredito !== 'erro' && new Date(a.criado_em).getTime() >= inicioJanela(horas); }).length,
            ultima_em: ult ? ult.criado_em : null, limite_hora: cfg.ia_limite_hora,
            modelo: ult ? ult.modelo : null },
      kpis: kpisDe(lista, horas),
      por_hora: porHora,
      pontos: pontos.slice(0, 500),
      visitantes: visitantes.slice(0, 300),
      feed: lista.slice(-40).reverse().map(function (e) { return feedDe(e); }),
      sistemas: SISTEMAS.map(function (s) {
        var doSis = lista.filter(function (e) { return e.projeto === s.projeto; });
        return { projeto: s.projeto, nome: s.nome, url: s.url, sistema_slug: s.sistema_slug, ultimo_sinal: s.ultimo_sinal, guarda_versao: s.guarda_versao,
                 guarda_runtime: s.guarda_runtime, exige_login: s.exige_login, acessos: doSis.length,
                 bloqueados: doSis.filter(function (e) { return e.decisao === 'bloqueado'; }).length };
      }),
      contagens: {
        bloqueios_ativos: bloqueios.filter(function (b) { return ativoB(b, agora); }).length,
        confiaveis_ativos: confiaveis.filter(function (c) { return ativoC(c, agora); }).length,
        exposicoes: exp
      },
      cadeia: { ultimo_id: seq.ev, ultimo_selo: seloAtual },
      ultimo_id: seq.ev
    };
  }

  function novos(desde) {
    gerarAoVivo();
    // como o banco: null ou negativo = só os 100 mais recentes
    desde = desde == null || +desde < 0 ? Math.max(seq.ev - 100, 0) : +desde || 0;
    var l = eventos.filter(function (e) { return e.id > desde; }).slice(0, 100);
    return { eventos: l.map(function (e) { return feedDe(e, true); }), ultimo_id: l.length ? l[l.length - 1].id : seq.ev,
             kpis: kpisDe(janela(24), 24) };
  }

  // como sentinela_ip (= sentinela.contexto + análises + confiáveis): IP inválido → erro 22023;
  // IP nunca visto → o mesmo objeto, com perfil null e listas vazias
  function detalheIp(ip) {
    ip = String(ip || '').trim();
    if (!SNT.u.ipOuCidr(ip) || ip.indexOf('/') > -1) falha('sentinela: ip inválido');
    var p = ips[ip] || null;
    var agora = Date.now();
    var evs = eventos.filter(function (e) { return e.ip === ip; });
    return {
      ip: ip, perfil: p, confiavel: confiavel(ip, agora),
      tor: bloqueios.some(function (b) { return b.valor === ip && b.regra === 'tor'; }),
      bloqueios: bloqueios.filter(function (b) { return casa(ip, b.valor); }).slice(-10).reverse().map(linhaBloqueio),
      identidades: identidades.filter(function (x) { return x.ip === ip; }).slice(-10).reverse().map(function (x) {
        return { email: x.email, origem: x.origem, criado_em: x.criado_em };
      }),
      tentativas_10min: ip === '198.51.100.110' ? 7 : 0,
      eventos: evs.slice(-40).reverse().map(function (e) {
        return { id: e.id, criado_em: e.criado_em, projeto: e.projeto, metodo: e.metodo, caminho: e.caminho, consulta: e.consulta,
                 tipo: e.tipo, pais: e.pais, cidade: e.cidade, ua: e.ua, idioma: e.idioma, sec_fetch_mode: e.sec_fetch_mode,
                 decisao: e.decisao, regra: e.regra, risco: e.risco, identidade: e.identidade };
      }),
      analises: analises.filter(function (a) { return a.ip === ip; }).slice(-10).reverse(),
      confiaveis: confiaveis.filter(function (c) { return ativoC(c, agora) && casa(ip, c.valor); }).map(linhaConfiavel)
    };
  }

  // mesmos campos de sentinela.bloqueio_json e sentinela.confiavel_json
  function linhaBloqueio(b) {
    return { id: b.id, tipo: b.tipo, valor: b.valor, nivel: b.nivel, origem: b.origem, regra: b.regra, motivo: b.motivo,
             criado_em: b.criado_em, expira_em: b.expira_em, revogado_em: b.revogado_em, revogado_por: b.revogado_por,
             criado_por: b.criado_por, hits: b.hits, ultimo_hit: b.ultimo_hit, evento_id: b.evento_id, analise_id: b.analise_id,
             ativo: ativoB(b, Date.now()) };
  }
  function linhaConfiavel(c) {
    return { id: c.id, tipo: c.tipo, valor: c.valor, descricao: c.descricao, origem: c.origem, identidade: c.identidade,
             criado_em: c.criado_em, expira_em: c.expira_em, criado_por: c.criado_por, ativo: ativoC(c, Date.now()) };
  }

  /* ---------------- ações do admin ---------------- */
  function falha(msg, codigo) { var e = new Error(msg); e.code = codigo || '22023'; throw e; }

  // como o banco: a ação só entra em acoes_admin quando dá certo
  function acao(nome, d) {
    var r = executarAcao(nome, d || {});
    acoes.push({ id: acoes.length + 1, criado_em: iso(Date.now()), email: 'demo@lube.com.br', acao: nome, dados: d || {} });
    return r;
  }
  function executarAcao(nome, d) {
    var agora = Date.now();
    switch (nome) {
      case 'bloquear': {
        var v = String(d.valor || '').trim();
        if (!SNT.u.ipOuCidr(v)) falha('sentinela: valor não é IP nem CIDR válido');
        var dur = { '1h': HORA, '24h': DIA, '7d': 7 * DIA, permanente: null };
        if (!(d.duracao in dur)) falha('sentinela: duração inválida');
        if (!String(d.motivo || '').trim()) falha('sentinela: informe o motivo');
        var antes = seq.bl;
        var b = criarBloqueio({ valor: v, nivel: 'certo', origem: 'manual', regra: 'manual', motivo: String(d.motivo).trim(),
          expira_em: dur[d.duracao] ? iso(agora + dur[d.duracao]) : null, criado_por: 'demo@lube.com.br' }, agora);
        return { ok: true, id: b.id, novo: b.id > antes, ate: b.expira_em,
                 confiavel: confiaveis.some(function (c) { return ativoC(c, agora) && (SNT.u.contem(c.valor, v) || SNT.u.contem(v, c.valor)); }) };
      }
      case 'desbloquear': {
        var alvo = bloqueios.filter(function (x) { return x.id === +d.id && !x.revogado_em; })[0];
        if (!alvo) falha('sentinela: bloqueio não encontrado ou já revogado', 'P0002');
        alvo.revogado_em = iso(agora); alvo.revogado_por = 'demo@lube.com.br';
        return { ok: true, id: alvo.id };
      }
      case 'confiar': {
        var c = String(d.valor || '').trim();
        if (!SNT.u.ipOuCidr(c)) falha('sentinela: valor não é IP nem CIDR válido');
        if (!String(d.descricao || '').trim()) falha('sentinela: informe a descrição');
        // como o banco: a mesma rede manual ativa só troca a descrição
        var mesma = confiaveis.filter(function (x) { return x.origem === 'manual' && x.valor === c && ativoC(x, agora); })[0];
        if (mesma) mesma.descricao = String(d.descricao).trim();
        else confiaveis.push({ id: ++seq.cf, tipo: c.indexOf('/') > -1 ? 'cidr' : 'ip', valor: c, rede: c, descricao: String(d.descricao).trim(),
          origem: 'manual', identidade: null, criado_em: iso(agora), expira_em: null, removido_em: null, criado_por: 'demo@lube.com.br' });
        // como o banco: confiável não fica com bloqueio automático (regra/IA) dentro da rede
        var revogados = 0;
        bloqueios.forEach(function (b) {
          if (ativoB(b, agora) && (b.origem === 'regra' || b.origem === 'ia') && SNT.u.contem(c, b.valor)) {
            b.revogado_em = iso(agora); b.revogado_por = 'demo@lube.com.br (confiar)'; revogados++;
          }
        });
        return { ok: true, id: mesma ? mesma.id : seq.cf, bloqueios_revogados: revogados };
      }
      case 'desconfiar': {
        var cf = confiaveis.filter(function (x) { return x.id === +d.id && !x.removido_em; })[0];
        if (!cf) falha('sentinela: confiável não encontrado ou já removido', 'P0002');
        cf.removido_em = iso(agora);
        return { ok: true, id: cf.id };
      }
      case 'modo':
        if (d.modo !== 'observar' && d.modo !== 'proteger') falha('sentinela: modo inválido');
        cfg.modo = d.modo; cfg.atualizado_em = iso(agora);
        return { ok: true, modo: cfg.modo };
      case 'casa':
        if (!String(d.nome || '').trim() || isNaN(+d.lat) || isNaN(+d.lon) || Math.abs(+d.lat) > 90 || Math.abs(+d.lon) > 180) falha('sentinela: casa inválida');
        cfg.casa_nome = String(d.nome).trim(); cfg.casa_lat = +d.lat; cfg.casa_lon = +d.lon;
        return { ok: true };
      case 'sistema': {
        var s = SISTEMAS.filter(function (x) { return x.projeto === d.projeto; })[0];
        if (!s) falha('sentinela: sistema não encontrado', 'P0002');
        if ('exige_login' in d && typeof d.exige_login !== 'boolean') falha('sentinela: exige_login deve ser verdadeiro ou falso');
        if ('rotas_publicas' in d) {
          var rotas = (d.rotas_publicas || []).map(function (r) { return String(r).trim(); }).filter(Boolean);
          if (rotas.some(function (r) { return r.charAt(0) !== '/'; })) falha('sentinela: cada rota pública deve começar com /');
          if (rotas.some(function (r) { return r === '/' || r === '/*'; })) falha('sentinela: rota pública "/" ou "/*" libera o sistema inteiro; para isso desligue exige_login');
        }
        if ('arquivos_proibidos' in d) {
          (d.arquivos_proibidos || []).forEach(function (r) { try { new RegExp(r); } catch (e) { falha('sentinela: expressão inválida em arquivos_proibidos: ' + r); } });
        }
        if ('exige_login' in d) s.exige_login = d.exige_login;
        if ('rotas_publicas' in d) s.rotas_publicas = rotas;
        if ('arquivos_proibidos' in d) s.arquivos_proibidos = d.arquivos_proibidos.map(String);
        return { ok: true, projeto: s.projeto };
      }
      case 'exposicao': {
        var x = EXPOSICOES.filter(function (e) { return e.id === +d.id; })[0];
        if (['aberta', 'aceita', 'corrigida'].indexOf(d.status) < 0) falha('sentinela: status inválido (aberta, aceita ou corrigida)');
        if (!x) falha('sentinela: exposição não encontrada', 'P0002');
        x.status = d.status;
        if ('decisao' in d) x.decisao = String(d.decisao || '').trim() || null;
        x.atualizado_em = iso(agora);
        return { ok: true, id: x.id };
      }
      case 'limites': {
        // como o banco: só os três do contrato, inteiros/números dentro da faixa
        var chaves = Object.keys(d);
        if (chaves.some(function (k) { return ['limite_rajada_min', 'ia_limite_hora', 'ia_confianca_min'].indexOf(k) < 0; })) {
          falha('sentinela: limites aceita só limite_rajada_min, ia_limite_hora e ia_confianca_min');
        }
        if (!chaves.length) falha('sentinela: nenhum limite informado');
        var inteiro = function (v, min, max) { return Number.isInteger(+v) && +v >= min && +v <= max; };
        if ('limite_rajada_min' in d && !inteiro(d.limite_rajada_min, 10, 100000)) falha('sentinela: limite_rajada_min deve ser inteiro entre 10 e 100000');
        if ('ia_limite_hora' in d && !inteiro(d.ia_limite_hora, 0, 1000)) falha('sentinela: ia_limite_hora deve ser inteiro entre 0 e 1000');
        if ('ia_confianca_min' in d && !(+d.ia_confianca_min >= 0.5 && +d.ia_confianca_min <= 1)) falha('sentinela: ia_confianca_min deve ficar entre 0,5 e 1');
        if ('limite_rajada_min' in d) cfg.limite_rajada_min = +d.limite_rajada_min;
        if ('ia_limite_hora' in d) cfg.ia_limite_hora = +d.ia_limite_hora;
        if ('ia_confianca_min' in d) cfg.ia_confianca_min = +d.ia_confianca_min;
        cfg.atualizado_em = iso(agora);
        return { ok: true };
      }
      default:
        falha('sentinela: ação desconhecida');
    }
  }

  /* ---------------- RPC falsa (mesmo formato do supabase-js) ---------------- */
  var ROTAS = {
    sentinela_painel: function (a) { return painel(a.p_horas == null ? 24 : a.p_horas); },
    sentinela_novos: function (a) { return novos(a.p_desde_id); },
    sentinela_ip: function (a) { return detalheIp(a.p_ip); },
    sentinela_lista_bloqueios: function (a) {
      var agora = Date.now();
      return bloqueios.filter(function (b) { return a.p_incluir_inativos || ativoB(b, agora); })
        .sort(function (x, y) { return y.id - x.id; }).map(linhaBloqueio);
    },
    // como o banco: removidos ficam de fora; vencidos aparecem com "ativo": false
    sentinela_lista_confiaveis: function () {
      return confiaveis.filter(function (c) { return !c.removido_em; })
        .sort(function (x, y) { return y.id - x.id; }).map(linhaConfiavel);
    },
    sentinela_lista_analises: function (a) {
      return analises.slice().sort(function (x, y) { return y.id - x.id; }).slice(0, +a.p_limite || 100);
    },
    sentinela_lista_exposicoes: function () { return EXPOSICOES.map(function (e) { return Object.assign({}, e); }); },
    sentinela_config_ler: function () {
      return { config: Object.assign({}, cfg), sistemas: SISTEMAS.map(function (s) { return Object.assign({}, s); }) };
    },
    sentinela_acao: function (a) { return acao(a.p_acao, a.p_dados); },
    sentinela_verificar_cadeia: function (a) {
      var n = Math.min(+a.p_limite || 5000, eventos.length);
      // &cadeia=vazia imita a tabela esvaziada com a cadeia apontando para um registro recente
      if (Q.get('cadeia') === 'vazia') {
        return { ok: false, verificados: 0, desde_id: null, ate_id: null, quebra_id: seq.ev, ultimo_selo: seloAtual,
                 detalhe: 'nenhum registro encontrado, mas a cadeia aponta para um registro recente' };
      }
      var quebrada = Q.get('cadeia') === 'quebrada';
      return { ok: !quebrada, verificados: n, desde_id: seq.ev - n + 1, ate_id: seq.ev,
               quebra_id: quebrada ? seq.ev - Math.floor(n / 3) : null, ultimo_selo: seloAtual,
               detalhe: quebrada ? 'o selo não confere com o conteúdo do registro' : null };
    }
  };

  var falhas = {};     // RPC → código de erro forçado (teste: SNT.demo.falhar('sentinela_painel', '57014'))
  var chamadas = [];   // registro das chamadas (teste do ritmo do polling)
  // desde o primeiro carregamento: &falhar=sentinela_painel:57014 e &rede=0
  (Q.get('falhar') || '').split(',').forEach(function (x) { var p = x.split(':'); if (p[0]) falhas[p[0]] = p[1] || '57014'; });
  if (Q.get('rede') === '0') redeLigada = false;
  function rpc(nome, args) {
    chamadas.push({ nome: nome, args: JSON.parse(JSON.stringify(args || {})), t: Date.now() });
    if (chamadas.length > 2000) chamadas.shift();
    return new Promise(function (ok) {
      setTimeout(function () {
        if (falhas[nome]) {
          ok({ data: null, error: { message: 'canceling statement due to statement timeout', code: falhas[nome] }, status: 500 });
          return;
        }
        if (!redeLigada) {
          ok({ data: null, error: { message: 'TypeError: Failed to fetch', details: '', hint: '', code: '' }, status: 0 });
          return;
        }
        var f = ROTAS[nome];
        if (!f) {
          ok({ data: null, error: { message: 'Could not find the function public.' + nome, code: 'PGRST202' }, status: 404 });
          return;
        }
        try {
          ok({ data: JSON.parse(JSON.stringify(f(args || {}))), error: null, status: 200 });
        } catch (e) {
          ok({ data: null, error: { message: e.message, code: e.code || 'P0001' }, status: 400 });
        }
      }, 90 + Math.random() * 180);
    });
  }

  semear();

  SNT.demo = {
    rpc: rpc,
    usuario: { email: 'demo@lube.com.br' },
    // para testar a faixa de "sem conexão": SNT.demo.rede(false)
    rede: function (ligada) { redeLigada = !!ligada; return redeLigada; },
    falhar: function (nome, codigo) { if (codigo) falhas[nome] = String(codigo); else delete falhas[nome]; },
    chamadas: chamadas,
    inicio: inicio
  };
})();
