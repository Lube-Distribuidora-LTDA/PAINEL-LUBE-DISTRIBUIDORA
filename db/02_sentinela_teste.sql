-- =========================================================
-- SENTINELA LUBE — testes do banco (db/02_sentinela.sql)
-- Rode numa transação só, logo depois da migração e NA MESMA transação:
--   begin;
--   <conteúdo de db/02_sentinela.sql>
--   <conteúdo deste arquivo>
-- Este arquivo já começa com begin; (dentro de uma transação aberta só gera aviso)
-- e TERMINA COM rollback;: nada fica gravado em nenhum cliente (usuários de teste em
-- auth.users, eventos, chave no Vault e o próprio schema somem). Se o schema sentinela
-- não foi criado nesta mesma transação (banco com a Sentinela já aplicada), o
-- primeiro bloco aborta tudo antes de qualquer teste.
-- O SELECT logo antes do rollback mostra o placar e as falhas (ok = true/false).
-- =========================================================

begin;

do $$
begin
  if not exists (
       select 1 from pg_namespace n
        where n.nspname = 'sentinela'
          and pg_xact_status((((pg_current_xact_id()::text::bigint >> 32) << 32) | n.xmin::text::bigint)::text::xid8)
              = 'in progress') then
    raise exception 'sentinela-teste: rode junto com a migração, na MESMA transação (begin; migração; testes) — nunca num banco com a Sentinela já aplicada'
      using errcode = '55000';
  end if;
end $$;

create temp table sentinela_teste (
  em      timestamptz not null default clock_timestamp(),
  teste   text not null,
  ok      boolean not null,
  detalhe text
);

create function pg_temp.ok(p_teste text, p_ok boolean, p_detalhe text default null)
returns void language sql as $$
  insert into pg_temp.sentinela_teste (teste, ok, detalhe) values (p_teste, coalesce(p_ok, false), p_detalhe)
$$;

-- age como um usuário logado (mesmo jeito que o PostgREST faz)
create function pg_temp.como(p_uid uuid, p_email text, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
                     json_build_object('sub', p_uid, 'email', p_email, 'role', p_role)::text, true);
  perform set_config('role', p_role, true);
end $$;

create function pg_temp.postgres()
returns void language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

-- evento padrão do guarda (navegador comum no escritório); p_extra sobrescreve campos
create function pg_temp.ev(p_ip text, p_extra jsonb default '{}')
returns jsonb language sql as $$
  select jsonb_build_object(
    'ts', now(), 'metodo', 'GET', 'host', 'painel-compras-rosy.vercel.app', 'caminho', '/', 'consulta', null,
    'tipo', 'pagina', 'ip', p_ip, 'pais', 'BR', 'regiao', 'ES', 'cidade', 'Cariacica', 'lat', -20.26, 'lon', -40.41,
    'fuso', 'America/Sao_Paulo', 'ua', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0', 'idioma', 'pt-BR,pt;q=0.9',
    'referer', null, 'ja4', null, 'vercel_id', 'gru1::teste', 'sec_fetch_site', 'none', 'sec_fetch_mode', 'navigate',
    'sec_fetch_dest', 'document', 'decisao', 'liberado', 'regra', null, 'motivo', null,
    'identidade', null, 'identidade_origem', null) || p_extra
$$;

create function pg_temp.reg(p_eventos jsonb, p_projeto text default 'painel-compras')
returns jsonb language sql as $$
  select public.sentinela_srv_registrar(p_projeto, 'production', 'sentinela-guarda/1.0.0', 'nodejs', p_eventos)
$$;

create function pg_temp.lote(p_ev jsonb, p_n int)
returns jsonb language sql as $$
  select jsonb_agg(p_ev) from generate_series(1, p_n)
$$;

-- diferença em segundos entre um instante e o esperado
create function pg_temp.perto(p timestamptz, p_esperado timestamptz)
returns boolean language sql as $$
  select p is not null and abs(extract(epoch from (p - p_esperado))) < 5
$$;

-- ---------------------------------------------------------
-- Usuários de teste (somem no rollback)
-- ---------------------------------------------------------
insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-0000000000a1', 'sentinela.teste.admin@lube.com.br'),
  ('a0000000-0000-4000-8000-0000000000a2', 'sentinela.teste.comum@lube.com.br'),
  ('a0000000-0000-4000-8000-0000000000a3', 'sentinela.teste.total@lube.com.br'),
  ('a0000000-0000-4000-8000-0000000000a4', 'sentinela.teste.inativo@lube.com.br');

update public.profiles set nome = 'Teste Admin', is_admin = true, ativo = true
 where id = 'a0000000-0000-4000-8000-0000000000a1';
update public.profiles set nome = 'Teste Comum', ativo = true
 where id = 'a0000000-0000-4000-8000-0000000000a2';
update public.profiles set nome = 'Teste Total', ativo = true, acesso_total = true
 where id = 'a0000000-0000-4000-8000-0000000000a3';
update public.profiles set nome = 'Teste Inativo', ativo = false
 where id = 'a0000000-0000-4000-8000-0000000000a4';

insert into public.permissoes (user_id, sistema_id)
select 'a0000000-0000-4000-8000-0000000000a2'::uuid, s.id from public.sistemas s where s.slug = 'gestao-ti'
union all
select 'a0000000-0000-4000-8000-0000000000a4'::uuid, s.id from public.sistemas s where s.slug = 'gestao-ti';

insert into public.permissoes_excecao (user_id, sistema_id)
select 'a0000000-0000-4000-8000-0000000000a3'::uuid, s.id from public.sistemas s where s.slug = 'gestao-financeiro';

-- ---------------------------------------------------------
-- T01 seeds
-- ---------------------------------------------------------
do $$
declare
  v text;
begin
  perform pg_temp.ok('T01 config e cadeia com 1 linha',
    (select count(*) from sentinela.config) = 1 and (select count(*) from sentinela.cadeia) = 1
    and (select modo from sentinela.config) = 'observar');
  perform pg_temp.ok('T01 8 sistemas', (select count(*) from sentinela.sistemas) = 8);
  select string_agg(s.sistema_slug, ',') into v
    from sentinela.sistemas s
   where s.sistema_slug is not null and not exists (select 1 from public.sistemas p where p.slug = s.sistema_slug);
  perform pg_temp.ok('T01 slugs existem em public.sistemas', v is null, coalesce('faltam: ' || v, '7 slugs ok'));
  select string_agg(s.projeto || '=' || cardinality(s.arquivos_proibidos), ',' order by s.projeto) into v
    from sentinela.sistemas s where cardinality(s.arquivos_proibidos) > 0;
  perform pg_temp.ok('T01 arquivos_proibidos (5/10/1/4)',
    v = 'gestao-comercial-web=1,gestao-de-saidas-de-veiculos=4,painel-lube-distribuidora=5,rh-absentismo=10', v);
  perform pg_temp.ok('T01 regex dos arquivos_proibidos compilam',
    (select bool_and(('/x' ~ a) is not null) from sentinela.sistemas s, unnest(s.arquivos_proibidos) a));
  perform pg_temp.ok('T01 regex dos arquivos_proibidos passam no validador (subconjunto comum com o JavaScript)',
    (select bool_and(sentinela.regex_problema(a) is null) from sentinela.sistemas s, unnest(s.arquivos_proibidos) a),
    (select string_agg(a || ' → ' || sentinela.regex_problema(a), '; ') from sentinela.sistemas s, unnest(s.arquivos_proibidos) a
      where sentinela.regex_problema(a) is not null));
  select string_agg(severidade || '=' || n, ',' order by severidade) into v
    from (select severidade, count(*) n from sentinela.exposicoes group by 1) x;
  perform pg_temp.ok('T01 13 exposições (2 críticas, 4 altas, 5 médias, 2 baixas)',
    (select count(*) from sentinela.exposicoes) = 13 and v = 'alta=4,baixa=2,critica=2,media=5', v);
exception when others then
  perform pg_temp.ok('T01 (erro inesperado)', false, sqlstate || ': ' || sqlerrm);
end $$;

-- ---------------------------------------------------------
-- T02 registrar evento liberado + entradas inválidas
-- ---------------------------------------------------------
do $$
declare
  r jsonb;
  e sentinela.eventos;
  i sentinela.ips;
  s sentinela.sistemas;
begin
  r := pg_temp.reg(jsonb_build_array(pg_temp.ev('200.10.10.1')));
  perform pg_temp.ok('T02 liberado: gravados=1, descartados=0, nada novo',
    (r->>'gravados')::int = 1 and (r->>'descartados')::int = 0
    and r->'bloqueios_novos' = '[]'::jsonb and r->'analisar' = '[]'::jsonb, r::text);
  select * into e from sentinela.eventos x where x.ip = '200.10.10.1';
  perform pg_temp.ok('T02 evento gravado com risco 0, selo sha256 e primeiro selo_anterior nulo',
    e.risco = 0 and e.selo ~ '^[0-9a-f]{64}$' and e.selo_anterior is null and e.decisao = 'liberado'
    and e.projeto = 'painel-compras' and e.guarda = 'sentinela-guarda/1.0.0',
    format('risco=%s selo=%s anterior=%s', e.risco, left(e.selo, 12), e.selo_anterior));
  select * into i from sentinela.ips x where x.ip = '200.10.10.1';
  perform pg_temp.ok('T02 perfil do IP criado', i.total = 1 and i.projetos = array['painel-compras']
    and i.pais = 'BR' and i.cidade = 'Cariacica', format('total=%s projetos=%s', i.total, i.projetos));
  select * into s from sentinela.sistemas x where x.projeto = 'painel-compras';
  perform pg_temp.ok('T02 sinal do sistema atualizado',
    s.ultimo_sinal is not null and s.guarda_versao = 'sentinela-guarda/1.0.0' and s.guarda_runtime = 'nodejs'
    and s.ultimo_ambiente = 'production');

  -- mesmo IP em outro projeto: projetos vira lista distinta
  perform pg_temp.reg(jsonb_build_array(pg_temp.ev('200.10.10.1'), pg_temp.ev('200.10.10.1')), 'gestao-ti');
  select * into i from sentinela.ips x where x.ip = '200.10.10.1';
  perform pg_temp.ok('T02 projetos distintos no perfil', i.total = 3
    and i.projetos = array['painel-compras','gestao-ti'], i.projetos::text);

  r := pg_temp.reg(jsonb_build_array(pg_temp.ev('lixo'), pg_temp.ev('1.2.3.4', '{"decisao":"xpto"}'),
                                     '"texto"'::jsonb, pg_temp.ev('1.2.3.0/24'), pg_temp.ev('300.1.1.1')));
  perform pg_temp.ok('T02 eventos inválidos são descartados', (r->>'gravados')::int = 0 and (r->>'descartados')::int = 5, r::text);

  r := pg_temp.reg(jsonb_build_array(pg_temp.ev('2001:db8::1'), pg_temp.ev('::ffff:200.20.20.2'),
                                     pg_temp.ev('200.20.20.3', '{"tipo":"xpto","metodo":"g e t","pais":"Brasil","lat":999,"ts":"lixo","regra":"DROP TABLE"}')));
  perform pg_temp.ok('T02 IPv6 aceito e ::ffff: vira IPv4',
    exists (select 1 from sentinela.eventos x where x.ip = '2001:db8::1')
    and exists (select 1 from sentinela.eventos x where x.ip = '200.20.20.2'), r::text);
  select * into e from sentinela.eventos x where x.ip = '200.20.20.3';
  perform pg_temp.ok('T02 campos fora do enum/faixa viram null/outro',
    e.tipo = 'outro' and e.metodo is null and e.pais is null and e.lat is null and e.lon is null
    and e.ts_guarda is null and e.regra is null,
    format('tipo=%s metodo=%s pais=%s lat=%s regra=%s', e.tipo, e.metodo, e.pais, e.lat, e.regra));

  begin
    perform pg_temp.reg(jsonb_build_array(pg_temp.ev('1.2.3.4')), 'projeto-que-nao-existe');
    perform pg_temp.ok('T02 projeto desconhecido é recusado', false, 'não deu erro');
  exception when others then
    perform pg_temp.ok('T02 projeto desconhecido é recusado', sqlstate = '22023', sqlerrm);
  end;
  begin
    perform public.sentinela_srv_registrar('painel-compras', 'production', 'g', 'nodejs', '{"a":1}'::jsonb);
    perform pg_temp.ok('T02 p_eventos que não é lista é recusado', false, 'não deu erro');
  exception when others then
    perform pg_temp.ok('T02 p_eventos que não é lista é recusado', sqlstate = '22023', sqlerrm);
  end;
exception when others then
  perform pg_temp.ok('T02 (erro inesperado)', false, sqlstate || ': ' || sqlerrm);
end $$;

-- ---------------------------------------------------------
-- T03 ataques certos → bloqueio certo (24 h; varredura reincidente 7 d)
-- ---------------------------------------------------------
do $$
declare
  r jsonb;
  b sentinela.bloqueios;
  v_risco int;
begin
  r := pg_temp.reg(jsonb_build_array(pg_temp.ev('45.10.0.1',
         '{"caminho":"/.env","tipo":"arquivo","pais":"RU","cidade":"Moscow","decisao":"bloqueado","regra":"varredura","motivo":"varredura: /.env"}')));
  perform pg_temp.ok('T03 varredura cria 1 bloqueio certo novo',
    jsonb_array_length(r->'bloqueios_novos') = 1
    and r->'bloqueios_novos'->0->>'n' = 'certo' and r->'bloqueios_novos'->0->>'regra' = 'varredura'
    and r->'bloqueios_novos'->0->>'v' = '45.10.0.1', r::text);
  select * into b from sentinela.bloqueios x where x.valor = '45.10.0.1';
  perform pg_temp.ok('T03 bloqueio: ip /32, origem regra, 24 h, evento ligado',
    b.tipo = 'ip' and b.rede = '45.10.0.1/32'::cidr and b.origem = 'regra' and b.nivel = 'certo'
    and pg_temp.perto(b.expira_em, now() + interval '24 hours') and b.evento_id is not null and b.hits = 0,
    format('rede=%s expira=%s hits=%s motivo=%s', b.rede, b.expira_em, b.hits, b.motivo));
  select x.risco into v_risco from sentinela.eventos x where x.ip = '45.10.0.1';
  perform pg_temp.ok('T03 risco da varredura >= 90', v_risco >= 90, v_risco::text);
  perform pg_temp.ok('T03 IP com bloqueio certo não vai para a IA', not (r->'analisar' ? '45.10.0.1'), r->>'analisar');

  r := pg_temp.reg(jsonb_build_array(pg_temp.ev('45.10.0.1',
         '{"caminho":"/wp-login.php","tipo":"arquivo","pais":"RU","decisao":"bloqueado","regra":"varredura"}')));
  select * into b from sentinela.bloqueios x where x.valor = '45.10.0.1';
  perform pg_temp.ok('T03 repetição não duplica: estende e soma hits',
    r->'bloqueios_novos' = '[]'::jsonb and (select count(*) from sentinela.bloqueios x where x.valor = '45.10.0.1') = 1
    and b.hits = 1, format('novos=%s hits=%s', r->'bloqueios_novos', b.hits));

  -- reincidente: 2 bloqueios certos (já revogados) nos últimos 7 dias + este = 3 → 7 dias
  insert into sentinela.bloqueios (tipo, valor, rede, nivel, origem, regra, motivo, criado_em, expira_em, revogado_em)
  values ('ip', '45.10.0.2', '45.10.0.2/32', 'certo', 'regra', 'varredura', 'antigo 1', now() - interval '3 days', now() - interval '2 days', now() - interval '2 days'),
         ('ip', '45.10.0.2', '45.10.0.2/32', 'certo', 'regra', 'varredura', 'antigo 2', now() - interval '2 days', now() - interval '1 day', now() - interval '1 day');
  r := pg_temp.reg(jsonb_build_array(pg_temp.ev('45.10.0.2',
         '{"caminho":"/.git/config","tipo":"arquivo","decisao":"bloqueado","regra":"varredura"}')));
  perform pg_temp.ok('T03 varredura reincidente (3 em 7 dias) bloqueia por 7 dias',
    pg_temp.perto((r->'bloqueios_novos'->0->>'ate')::timestamptz, now() + interval '7 days'), r::text);

  r := pg_temp.reg(jsonb_build_array(
         pg_temp.ev('45.10.0.3', '{"ua":"sqlmap/1.7","tipo":"api","caminho":"/api/dados","decisao":"bloqueado","regra":"ferramenta"}'),
         pg_temp.ev('45.10.0.4', '{"caminho":"/api/dados","consulta":"?id=1 union select 1","tipo":"api","decisao":"bloqueado","regra":"injecao"}')));
  perform pg_temp.ok('T03 ferramenta e injeção criam bloqueio certo 24 h',
    jsonb_array_length(r->'bloqueios_novos') = 2
    and (select bool_and(x->>'n' = 'certo' and pg_temp.perto((x->>'ate')::timestamptz, now() + interval '24 hours'))
           from jsonb_array_elements(r->'bloqueios_novos') x), r::text);
exception when others then
  perform pg_temp.ok('T03 (erro inesperado)', false, sqlstate || ': ' || sqlerrm);
end $$;

-- ---------------------------------------------------------
-- T04 robô: 20 eventos em 10 min → suspeito 1 h
-- ---------------------------------------------------------
do $$
declare
  r jsonb;
  v_ev jsonb := pg_temp.ev('45.20.0.1', '{"ua":"curl/8.4.0","tipo":"api","caminho":"/api/dados","idioma":null,"sec_fetch_mode":null,"decisao":"observado","regra":"robo","motivo":"robô: curl"}');
begin
  r := pg_temp.reg(pg_temp.lote(v_ev, 19));
  perform pg_temp.ok('T04 19 eventos de robô ainda não bloqueiam',
    (r->>'gravados')::int = 19 and r->'bloqueios_novos' = '[]'::jsonb, r::text);
  r := pg_temp.reg(pg_temp.lote(v_ev, 1));
  perform pg_temp.ok('T04 o 20º evento de robô cria bloqueio suspeito 1 h',
    jsonb_array_length(r->'bloqueios_novos') = 1 and r->'bloqueios_novos'->0->>'n' = 'suspeito'
    and r->'bloqueios_novos'->0->>'regra' = 'robo'
    and pg_temp.perto((r->'bloqueios_novos'->0->>'ate')::timestamptz, now() + interval '1 hour'), r::text);
exception when others then
  perform pg_temp.ok('T04 (erro inesperado)', false, sqlstate || ': ' || sqlerrm);
end $$;

-- ---------------------------------------------------------
-- T05 rajada (limite rebaixado para 10/min só no teste)
-- ---------------------------------------------------------
do $$
declare
  r jsonb;
begin
  update sentinela.config set limite_rajada_min = 10;
  r := pg_temp.reg(pg_temp.lote(pg_temp.ev('45.30.0.1'), 10));
  perform pg_temp.ok('T05 10 eventos com limite 10 não é rajada', r->'bloqueios_novos' = '[]'::jsonb, r::text);
  r := pg_temp.reg(pg_temp.lote(pg_temp.ev('45.30.0.1'), 5));
  perform pg_temp.ok('T05 acima do limite em 60 s cria bloqueio suspeito 15 min',
    jsonb_array_length(r->'bloqueios_novos') = 1 and r->'bloqueios_novos'->0->>'regra' = 'rajada'
    and r->'bloqueios_novos'->0->>'n' = 'suspeito'
    and pg_temp.perto((r->'bloqueios_novos'->0->>'ate')::timestamptz, now() + interval '15 minutes'), r::text);
  update sentinela.config set limite_rajada_min = 120;
exception when others then
  perform pg_temp.ok('T05 (erro inesperado)', false, sqlstate || ': ' || sqlerrm);
end $$;

-- ---------------------------------------------------------
-- T06 teto de gravação (30 por IP por minuto)
-- ---------------------------------------------------------
do $$
declare
  r1 jsonb;
  r2 jsonb;
  i sentinela.ips;
begin
  r1 := pg_temp.reg(pg_temp.lote(pg_temp.ev('45.40.0.1'), 20));
  r2 := pg_temp.reg(pg_temp.lote(pg_temp.ev('45.40.0.1'), 15));
  select * into i from sentinela.ips x where x.ip = '45.40.0.1';
  perform pg_temp.ok('T06 acima de 30/min só conta em descartados',
    (r1->>'gravados')::int + (r2->>'gravados')::int = 30 and (r2->>'descartados')::int = 5
    and i.total = 30 and i.descartados = 5
    and (select count(*) from sentinela.eventos x where x.ip = '45.40.0.1') = 30,
    format('r1=%s r2=%s total=%s descartados=%s', r1, r2, i.total, i.descartados));
exception when others then
  perform pg_temp.ok('T06 (erro inesperado)', false, sqlstate || ': ' || sqlerrm);
end $$;

-- ---------------------------------------------------------
-- T07 confiável nunca recebe bloqueio automático
-- ---------------------------------------------------------
do $$
declare
  r jsonb;
  e sentinela.eventos;
  t jsonb;
  v_n int;
begin
  insert into sentinela.confiaveis (tipo, valor, rede, descricao, origem, criado_por)
  values ('cidr', '10.20.30.0/24', '10.20.30.0/24', 'escritório (teste)', 'manual', 'teste');

  r := pg_temp.reg(jsonb_build_array(pg_temp.ev('10.20.30.5',
         '{"caminho":"/.env","tipo":"arquivo","decisao":"bloqueado","regra":"varredura","motivo":"varredura: /.env"}')));
  select * into e from sentinela.eventos x where x.ip = '10.20.30.5';
  perform pg_temp.ok('T07 ataque de confiável: sem bloqueio, risco 100 e motivo de alerta',
    r->'bloqueios_novos' = '[]'::jsonb
    and not exists (select 1 from sentinela.bloqueios b where b.rede >>= '10.20.30.5'::inet)
    and e.risco = 100 and e.motivo = 'ataque partindo de rede confiável — verificar máquina',
    format('novos=%s risco=%s motivo=%s', r->'bloqueios_novos', e.risco, e.motivo));

  r := pg_temp.reg(pg_temp.lote(pg_temp.ev('10.20.30.6', '{"ua":"curl/8","tipo":"api","decisao":"observado","regra":"robo"}'), 25));
  perform pg_temp.ok('T07 robô em rede confiável não é bloqueado',
    r->'bloqueios_novos' = '[]'::jsonb and not exists (select 1 from sentinela.bloqueios b where b.rede >>= '10.20.30.6'::inet), r::text);

  for v_n in 1..6 loop
    t := public.sentinela_srv_tentativa('10.20.30.7', 'fulano', 'Mozilla');
  end loop;
  perform pg_temp.ok('T07 força bruta de confiável não bloqueia', (t->>'bloqueado')::boolean = false
    and not exists (select 1 from sentinela.bloqueios b where b.rede >>= '10.20.30.7'::inet), t::text);

  t := public.sentinela_srv_registrar_analise('10.20.30.8',
         '{"modelo":"teste","veredito":"malicioso","confianca":0.99,"motivo":"teste","acao":"bloquear_7d"}');
  perform pg_temp.ok('T07 veredito malicioso para confiável é ignorado', t->>'aplicado' = 'confiável: ignorado'
    and not exists (select 1 from sentinela.bloqueios b where b.rede >>= '10.20.30.8'::inet), t::text);
exception when others then
  perform pg_temp.ok('T07 (erro inesperado)', false, sqlstate || ': ' || sqlerrm);
end $$;

-- ---------------------------------------------------------
-- T08 Tor
-- ---------------------------------------------------------
do $$
declare
  r jsonb;
  n int;
begin
  n := public.sentinela_srv_tor_atualizar(array['45.50.0.1', 'lixo', '45.50.0.2', '45.50.0.1']);
  perform pg_temp.ok('T08 tor_atualizar guarda só IPs válidos e distintos', n = 2
    and (select count(*) from sentinela.tor_saidas) = 2
    and (select tor_atualizado_em from sentinela.config) is not null, n::text);
  n := public.sentinela_srv_tor_atualizar('{}');
  perform pg_temp.ok('T08 lista vazia não apaga a atual', n = 0 and (select count(*) from sentinela.tor_saidas) = 2, n::text);
  r := pg_temp.reg(jsonb_build_array(pg_temp.ev('45.50.0.1')));
  perform pg_temp.ok('T08 saída Tor vira bloqueio suspeito 24 h e risco >= 60',
    jsonb_array_length(r->'bloqueios_novos') = 1 and r->'bloqueios_novos'->0->>'regra' = 'tor'
    and r->'bloqueios_novos'->0->>'n' = 'suspeito'
    and (select risco from sentinela.eventos x where x.ip = '45.50.0.1') >= 60, r::text);
exception when others then
  perform pg_temp.ok('T08 (erro inesperado)', false, sqlstate || ': ' || sqlerrm);
end $$;

-- ---------------------------------------------------------
-- T09 lista para o guarda
-- ---------------------------------------------------------
do $$
declare
  l jsonb;
begin
  l := public.sentinela_srv_lista('painel-compras');
  perform pg_temp.ok('T09 cabeçalho da lista',
    (l->>'v')::int = 1 and (l->>'ttl')::int = 20 and l->>'modo' = 'observar'
    and l->>'portal' = 'https://painel-lube-distribuidora.vercel.app' and l->>'gerado_em' like '____-__-__T__:__:__.___Z',
    left(l::text, 200));
  perform pg_temp.ok('T09 sistema do projeto',
    l->'sistema'->>'projeto' = 'painel-compras' and l->'sistema'->>'sistema_slug' = 'gestao-compras'
    and (l->'sistema'->>'exige_login')::boolean = false and l->'sistema'->'rotas_publicas' = '[]'::jsonb
    and l->'sistema'->>'nome' = 'BI Compras'
    and l->'sistema'->>'projeto_id' = 'prj_DcJI82KyPyvSc4eUMuL9iJV6I7cp', (l->'sistema')::text);
  perform pg_temp.ok('T09 bloqueios ativos no formato {id,t,v,n,ate}',
    exists (select 1 from jsonb_array_elements(l->'bloqueios') x
             where x->>'v' = '45.10.0.1' and x->>'t' = 'ip' and x->>'n' = 'certo' and x ? 'id' and x ? 'ate')
    and not exists (select 1 from jsonb_array_elements(l->'bloqueios') x where x->>'v' = '45.10.0.2'
                     and (x->>'ate')::timestamptz < now() + interval '1 day'),
    jsonb_array_length(l->'bloqueios')::text || ' bloqueios');
  perform pg_temp.ok('T09 só bloqueios ativos (revogados ficam fora)',
    jsonb_array_length(l->'bloqueios') = (select count(*) from sentinela.bloqueios b
                                           where b.revogado_em is null and (b.expira_em is null or b.expira_em > now())));
  perform pg_temp.ok('T09 confiáveis ativos',
    exists (select 1 from jsonb_array_elements(l->'confiaveis') x where x->>'t' = 'cidr' and x->>'v' = '10.20.30.0/24'),
    (l->'confiaveis')::text);
  perform pg_temp.ok('T09 projeto sem cadastro devolve sistema null',
    public.sentinela_srv_lista('nao-existe')->'sistema' = 'null'::jsonb);
  perform pg_temp.ok('T09 arquivos proibidos do RH na lista',
    jsonb_array_length(public.sentinela_srv_lista('rh-absentismo')->'sistema'->'arquivos_proibidos') = 10);
exception when others then
  perform pg_temp.ok('T09 (erro inesperado)', false, sqlstate || ': ' || sqlerrm);
end $$;

-- ---------------------------------------------------------
-- T10 hits do bloqueio casado (regra lista)
-- ---------------------------------------------------------
do $$
declare
  v_antes int;
  v_depois int;
begin
  select hits into v_antes from sentinela.bloqueios where valor = '45.10.0.1';
  perform pg_temp.reg(jsonb_build_array(pg_temp.ev('45.10.0.1', '{"decisao":"bloqueado","regra":"lista","motivo":"lista"}')));
  select hits into v_depois from sentinela.bloqueios where valor = '45.10.0.1';
  perform pg_temp.ok('T10 bloqueado pela lista soma hits', v_depois = v_antes + 1
    and (select ultimo_hit from sentinela.bloqueios where valor = '45.10.0.1') is not null,
    format('%s → %s', v_antes, v_depois));
exception when others then
  perform pg_temp.ok('T10 (erro inesperado)', false, sqlstate || ': ' || sqlerrm);
end $$;

-- ---------------------------------------------------------
-- T11 quem vai para a IA
-- ---------------------------------------------------------
do $$
declare
  r jsonb;
begin
  r := pg_temp.reg(jsonb_build_array(pg_temp.ev('77.70.0.1', '{"pais":"US","cidade":"Ashburn"}')));
  perform pg_temp.ok('T11 primeira visita de fora do BR sem identidade vai para a IA',
    r->'analisar' = '["77.70.0.1"]'::jsonb, r::text);
  r := pg_temp.reg(jsonb_build_array(pg_temp.ev('77.70.0.1', '{"pais":"US"}')));
  perform pg_temp.ok('T11 não pede de novo enquanto a análise está pendente', r->'analisar' = '[]'::jsonb, r::text);
  r := pg_temp.reg(jsonb_build_array(
         pg_temp.ev('77.70.0.11', '{"pais":"US"}'), pg_temp.ev('77.70.0.12', '{"pais":"DE"}'),
         pg_temp.ev('77.70.0.13', '{"pais":"CN"}'), pg_temp.ev('77.70.0.14', '{"pais":"FR"}'),
         pg_temp.ev('77.70.0.15', '{"pais":"NL"}')));
  perform pg_temp.ok('T11 no máximo 3 por lote', jsonb_array_length(r->'analisar') = 3, r::text);
  r := pg_temp.reg(jsonb_build_array(pg_temp.ev('200.10.10.9')));
  perform pg_temp.ok('T11 visita brasileira comum não vai para a IA', r->'analisar' = '[]'::jsonb, r::text);
  r := pg_temp.reg(jsonb_build_array(pg_temp.ev('77.70.0.20', '{"pais":"US","identidade":"fulano@lube.com.br","identidade_origem":"passe"}')));
  perform pg_temp.ok('T11 identidade confirmada (passe) não vai para a IA e baixa o risco',
    r->'analisar' = '[]'::jsonb and (select risco from sentinela.eventos where ip = '77.70.0.20') = 0, r::text);
  update sentinela.config set ia_limite_hora = 0;
  r := pg_temp.reg(jsonb_build_array(pg_temp.ev('77.70.0.30', '{"pais":"US"}')));
  perform pg_temp.ok('T11 sem cota na hora ninguém vai para a IA', r->'analisar' = '[]'::jsonb, r::text);
  update sentinela.config set ia_limite_hora = 60;
exception when others then
  perform pg_temp.ok('T11 (erro inesperado)', false, sqlstate || ': ' || sqlerrm);
end $$;

-- ---------------------------------------------------------
-- T12 análise da IA, cota, status e contexto
-- ---------------------------------------------------------
do $$
declare
  r jsonb;
  b sentinela.bloqueios;
  v_cota int;
  c jsonb;
begin
  perform pg_temp.reg(jsonb_build_array(pg_temp.ev('88.80.0.1', '{"pais":"US","caminho":"/api/dados","tipo":"api"}')));
  v_cota := public.sentinela_srv_ia_cota();
  r := public.sentinela_srv_registrar_analise('88.80.0.1',
         '{"modelo":"claude-haiku-4-5-20251001","veredito":"malicioso","confianca":0.92,"motivo":"raspagem de /api","acao":"bloquear_24h","tokens_entrada":512,"tokens_saida":64}');
  select * into b from sentinela.bloqueios x where x.valor = '88.80.0.1';
  perform pg_temp.ok('T12 malicioso com confiança alta: bloqueio suspeito da IA (modo observar)',
    r->>'aplicado' = 'seria bloqueado (modo observar) #' || b.id and b.nivel = 'suspeito' and b.origem = 'ia'
    and b.regra = 'ia' and b.motivo = 'IA: raspagem de /api' and b.analise_id = (r->>'analise_id')::bigint
    and pg_temp.perto(b.expira_em, now() + interval '24 hours'), r::text);
  perform pg_temp.ok('T12 perfil guarda a última análise',
    (select ultimo_veredito = 'malicioso' and ultima_analise_em is not null from sentinela.ips where ip = '88.80.0.1'));
  perform pg_temp.ok('T12 cota da hora diminui', public.sentinela_srv_ia_cota() = v_cota - 1,
    format('%s → %s', v_cota, public.sentinela_srv_ia_cota()));

  r := public.sentinela_srv_registrar_analise('88.80.0.2', '{"veredito":"malicioso","confianca":0.5,"acao":"bloquear_7d","motivo":"x"}');
  perform pg_temp.ok('T12 confiança abaixo do mínimo não bloqueia', r->>'aplicado' = 'nenhum'
    and not exists (select 1 from sentinela.bloqueios where valor = '88.80.0.2'), r::text);
  r := public.sentinela_srv_registrar_analise('88.80.0.3', '{"veredito":"legitimo","confianca":0.99,"acao":"bloquear_1h"}');
  perform pg_temp.ok('T12 legítimo não bloqueia', r->>'aplicado' = 'nenhum', r::text);
  r := public.sentinela_srv_registrar_analise('88.80.0.4', '{"veredito":"xpto","erro":"timeout 15 s"}');
  perform pg_temp.ok('T12 veredito desconhecido vira erro', (select veredito from sentinela.analises where id = (r->>'analise_id')::bigint) = 'erro', r::text);
  begin
    perform public.sentinela_srv_registrar_analise('lixo', '{}');
    perform pg_temp.ok('T12 IP inválido na análise é recusado', false, 'não deu erro');
  exception when others then
    perform pg_temp.ok('T12 IP inválido na análise é recusado', sqlstate = '22023', sqlerrm);
  end;

  perform public.sentinela_srv_ia_status('ligada', 'ok');
  perform pg_temp.ok('T12 status da IA gravado',
    (select ia_status = 'ligada' and ia_status_detalhe = 'ok' and ia_status_em is not null from sentinela.config));
  begin
    perform public.sentinela_srv_ia_status('xpto', null);
    perform pg_temp.ok('T12 status inválido é recusado', false, 'não deu erro');
  exception when others then
    perform pg_temp.ok('T12 status inválido é recusado', sqlstate = '22023', sqlerrm);
  end;

  c := public.sentinela_srv_contexto_ip('88.80.0.1');
  perform pg_temp.ok('T12 contexto do IP tem todas as partes',
    c->>'ip' = '88.80.0.1' and c->'perfil'->>'pais' = 'US' and (c->>'confiavel')::boolean = false
    and (c->>'tor')::boolean = false and jsonb_array_length(c->'bloqueios') = 1
    and c->'identidades' = '[]'::jsonb and (c->>'tentativas_10min')::int = 0
    and jsonb_array_length(c->'eventos') = 1 and c->'eventos'->0 ? 'sec_fetch_mode', left(c::text, 300));
exception when others then
  perform pg_temp.ok('T12 (erro inesperado)', false, sqlstate || ': ' || sqlerrm);
end $$;

-- ---------------------------------------------------------
-- T13 tentativas de login (força bruta)
-- ---------------------------------------------------------
do $$
declare
  t jsonb;
  v_n int;
  b sentinela.bloqueios;
begin
  for v_n in 1..4 loop
    t := public.sentinela_srv_tentativa('66.60.0.1', 'Fulano', 'Mozilla');
  end loop;
  perform pg_temp.ok('T13 4 tentativas ainda não bloqueiam', (t->>'bloqueado')::boolean = false, t::text);
  t := public.sentinela_srv_tentativa('66.60.0.1', 'fulano', 'Mozilla');
  select * into b from sentinela.bloqueios x where x.valor = '66.60.0.1';
  perform pg_temp.ok('T13 a 5ª tentativa em 10 min bloqueia (suspeito, forca_bruta, 1 h)',
    (t->>'bloqueado')::boolean and b.nivel = 'suspeito' and b.regra = 'forca_bruta'
    and pg_temp.perto(b.expira_em, now() + interval '1 hour'), t::text);
  t := public.sentinela_srv_tentativa('66.60.0.1', 'fulano', 'Mozilla');
  perform pg_temp.ok('T13 tentativas seguintes não duplicam o bloqueio',
    (select count(*) from sentinela.bloqueios where valor = '66.60.0.1') = 1
    and (select usuario from sentinela.tentativas_login order by id limit 1) = 'fulano');
  begin
    perform public.sentinela_srv_tentativa('nao-e-ip', 'x', 'y');
    perform pg_temp.ok('T13 IP inválido é recusado', false, 'não deu erro');
  exception when others then
    perform pg_temp.ok('T13 IP inválido é recusado', sqlstate = '22023', sqlerrm);
  end;
exception when others then
  perform pg_temp.ok('T13 (erro inesperado)', false, sqlstate || ': ' || sqlerrm);
end $$;

-- ---------------------------------------------------------
-- T14 identidade (login visto) e confiável aprendido
-- ---------------------------------------------------------
do $$
declare
  t jsonb;
  c sentinela.confiaveis;
begin
  t := public.sentinela_srv_identidade('99.90.0.1', 'a0000000-0000-4000-8000-0000000000a2',
                                       'Sentinela.Teste.Comum@lube.com.br', 'portal', 'Mozilla');
  select * into c from sentinela.confiaveis x where x.rede = '99.90.0.1/32';
  perform pg_temp.ok('T14 identidade gravada e IP vira confiável de login por 7 dias',
    t = '{"ok":true}'::jsonb
    and (select email from sentinela.identidades where ip = '99.90.0.1') = 'sentinela.teste.comum@lube.com.br'
    and (select identidade from sentinela.ips where ip = '99.90.0.1') = 'sentinela.teste.comum@lube.com.br'
    and c.origem = 'login' and c.tipo = 'ip' and c.valor = '99.90.0.1'
    and pg_temp.perto(c.expira_em, now() + interval '7 days'), format('%s origem=%s expira=%s', t, c.origem, c.expira_em));
  perform public.sentinela_srv_identidade('99.90.0.1', 'a0000000-0000-4000-8000-0000000000a2',
                                          'sentinela.teste.comum@lube.com.br', 'portal', 'Mozilla');
  perform pg_temp.ok('T14 novo login renova o mesmo confiável (sem duplicar)',
    (select count(*) from sentinela.confiaveis where rede = '99.90.0.1/32') = 1
    and (select count(*) from sentinela.identidades where ip = '99.90.0.1') = 2);
  t := public.sentinela_srv_identidade('99.90.0.2', 'a0000000-0000-4000-8000-0000000000a4',
                                       'sentinela.teste.inativo@lube.com.br', 'portal', 'Mozilla');
  perform pg_temp.ok('T14 perfil inativo é recusado: sem identidade, sem perfil do IP, sem confiável',
    t = '{"ok":false,"motivo":"perfil_inativo"}'::jsonb
    and not exists (select 1 from sentinela.identidades where ip = '99.90.0.2')
    and not exists (select 1 from sentinela.ips where ip = '99.90.0.2' and identidade is not null)
    and not exists (select 1 from sentinela.confiaveis where rede = '99.90.0.2/32'), t::text);
  t := public.sentinela_srv_identidade('99.90.0.2', 'a0000000-0000-4000-8000-0000000000ff',
                                       'ninguem@lube.com.br', 'portal', 'Mozilla');
  perform pg_temp.ok('T14 conta sem perfil é recusada',
    t = '{"ok":false,"motivo":"perfil_inativo"}'::jsonb
    and not exists (select 1 from sentinela.identidades where ip = '99.90.0.2'), t::text);
  begin
    perform public.sentinela_srv_identidade('99.90.0.3', null, 'x@lube.com.br', 'outra', null);
    perform pg_temp.ok('T14 origem inválida é recusada', false, 'não deu erro');
  exception when others then
    perform pg_temp.ok('T14 origem inválida é recusada', sqlstate = '22023', sqlerrm);
  end;
  begin
    perform public.sentinela_srv_identidade('99.90.0.3', null, 'sem-arroba', 'portal', null);
    perform pg_temp.ok('T14 e-mail inválido é recusado', false, 'não deu erro');
  exception when others then
    perform pg_temp.ok('T14 e-mail inválido é recusado', sqlstate = '22023', sqlerrm);
  end;
exception when others then
  perform pg_temp.ok('T14 (erro inesperado)', false, sqlstate || ': ' || sqlerrm);
end $$;

-- ---------------------------------------------------------
-- T15 permissão (acesso_total, exceção, permissões, inativo)
-- ---------------------------------------------------------
do $$
declare
  p jsonb;
begin
  p := public.sentinela_srv_permissao('a0000000-0000-4000-8000-0000000000a2', 'gestao-ti');
  perform pg_temp.ok('T15 com linha em permissoes: permitido',
    (p->>'permitido')::boolean and p->>'motivo' = 'permissao' and p->>'projeto' = 'gestao-ti'
    and p->>'url' = 'https://gestao-ti-ruddy.vercel.app' and p->>'email' = 'sentinela.teste.comum@lube.com.br'
    and p->>'nome' = 'Teste Comum', p::text);
  p := public.sentinela_srv_permissao('a0000000-0000-4000-8000-0000000000a2', 'gestao-compras');
  perform pg_temp.ok('T15 sem permissão: negado', not (p->>'permitido')::boolean and p->>'motivo' = 'sem_permissao', p::text);
  p := public.sentinela_srv_permissao('a0000000-0000-4000-8000-0000000000a3', 'gestao-compras');
  perform pg_temp.ok('T15 acesso_total: permitido', (p->>'permitido')::boolean and p->>'motivo' = 'acesso_total'
    and p->>'projeto' = 'painel-compras', p::text);
  p := public.sentinela_srv_permissao('a0000000-0000-4000-8000-0000000000a3', 'gestao-financeiro');
  perform pg_temp.ok('T15 acesso_total com exceção: negado',
    not (p->>'permitido')::boolean and p->>'motivo' = 'excecao_acesso_total', p::text);
  p := public.sentinela_srv_permissao('a0000000-0000-4000-8000-0000000000a4', 'gestao-ti');
  perform pg_temp.ok('T15 perfil inativo: negado mesmo com permissão',
    not (p->>'permitido')::boolean and p->>'motivo' = 'perfil_inativo', p::text);
  p := public.sentinela_srv_permissao('a0000000-0000-4000-8000-0000000000a2', 'nao-existe');
  perform pg_temp.ok('T15 sistema desconhecido: negado', not (p->>'permitido')::boolean and p->>'motivo' = 'sistema_desconhecido', p::text);
  p := public.sentinela_srv_permissao('a0000000-0000-4000-8000-0000000000ff', 'gestao-ti');
  perform pg_temp.ok('T15 usuário inexistente: negado', not (p->>'permitido')::boolean and p->>'motivo' = 'perfil_inexistente', p::text);
exception when others then
  perform pg_temp.ok('T15 (erro inesperado)', false, sqlstate || ': ' || sqlerrm);
end $$;

-- ---------------------------------------------------------
-- T16 passe de uso único
-- ---------------------------------------------------------
do $$
begin
  perform pg_temp.ok('T16 primeiro uso do passe: true',
    public.sentinela_srv_passe_usar('jti-teste-0001', 'gestao-ti', 'Fulano@lube.com.br') = true);
  perform pg_temp.ok('T16 segundo uso do mesmo passe: false',
    public.sentinela_srv_passe_usar('jti-teste-0001', 'gestao-ti', 'fulano@lube.com.br') = false);
  perform pg_temp.ok('T16 jti vazio/curto: false',
    public.sentinela_srv_passe_usar('x', 'gestao-ti', null) = false and public.sentinela_srv_passe_usar(null, null, null) = false);
exception when others then
  perform pg_temp.ok('T16 (erro inesperado)', false, sqlstate || ': ' || sqlerrm);
end $$;

-- ---------------------------------------------------------
-- T17 chave ES256 no Vault (idempotente)
-- ---------------------------------------------------------
do $$
declare
  v_pub jsonb := jsonb_build_object('kty', 'EC', 'crv', 'P-256', 'x', repeat('A', 43), 'y', repeat('B', 43),
                                    'ext', true, 'key_ops', jsonb_build_array('verify'));
  v_priv text := jsonb_build_object('kty', 'EC', 'crv', 'P-256', 'x', repeat('A', 43), 'y', repeat('B', 43),
                                    'd', repeat('C', 43), 'ext', true, 'key_ops', jsonb_build_array('sign'))::text;
  r1 jsonb;
  r2 jsonb;
  pubs jsonb;
begin
  perform pg_temp.ok('T17 sem chave: chave_ativa = null', public.sentinela_srv_chave_ativa() is null);
  begin
    perform public.sentinela_srv_chave_criar('a1b2c3d4e5f60718', v_pub || '{"d":"vazou"}', v_priv);
    perform pg_temp.ok('T17 pública com parte privada é recusada', false, 'não deu erro');
  exception when others then
    perform pg_temp.ok('T17 pública com parte privada é recusada', sqlstate = '22023', sqlerrm);
  end;
  begin
    perform public.sentinela_srv_chave_criar('a1b2c3d4e5f60718', v_pub || jsonb_build_object('x', repeat('Z', 43)), v_priv);
    perform pg_temp.ok('T17 par que não confere é recusado', false, 'não deu erro');
  exception when others then
    perform pg_temp.ok('T17 par que não confere é recusado', sqlstate = '22023', sqlerrm);
  end;

  r1 := public.sentinela_srv_chave_criar('a1b2c3d4e5f60718', v_pub, v_priv);
  perform pg_temp.ok('T17 chave criada com kid, pública só com kty/crv/x/y e privada',
    r1->>'kid' = 'a1b2c3d4e5f60718' and r1->>'privada' = v_priv and not (r1->'publica' ? 'd')
    and r1->'publica' = jsonb_build_object('kty', 'EC', 'crv', 'P-256', 'x', repeat('A', 43), 'y', repeat('B', 43)));
  perform pg_temp.ok('T17 parte privada mora no Vault',
    (select count(*) from vault.decrypted_secrets s join sentinela.chaves k on k.segredo_id = s.id
      where s.name = 'sentinela_chave_a1b2c3d4e5f60718' and s.decrypted_secret = v_priv) = 1);
  r2 := public.sentinela_srv_chave_criar('ffffffffffffffff', v_pub, v_priv);
  perform pg_temp.ok('T17 segunda criação devolve a existente (corrida)',
    r2->>'kid' = 'a1b2c3d4e5f60718' and (select count(*) from sentinela.chaves) = 1
    and not exists (select 1 from vault.secrets where name = 'sentinela_chave_ffffffffffffffff'), r2->>'kid');
  perform pg_temp.ok('T17 chave_ativa devolve kid/publica/privada',
    public.sentinela_srv_chave_ativa()->>'kid' = 'a1b2c3d4e5f60718' and public.sentinela_srv_chave_ativa()->>'privada' = v_priv);
  pubs := public.sentinela_srv_chaves_publicas();
  perform pg_temp.ok('T17 chaves_publicas: JWK com kid, alg ES256, use sig e sem d',
    jsonb_array_length(pubs) = 1 and pubs->0->>'kid' = 'a1b2c3d4e5f60718' and pubs->0->>'alg' = 'ES256'
    and pubs->0->>'use' = 'sig' and pubs->0->>'kty' = 'EC' and not (pubs->0 ? 'd'), pubs::text);
exception when others then
  perform pg_temp.ok('T17 (erro inesperado)', false, sqlstate || ': ' || sqlerrm);
end $$;

-- ---------------------------------------------------------
-- T18 cadeia de selos e só-inserção
-- ---------------------------------------------------------
do $$
declare
  v jsonb;
  v_meio bigint;
  v_prox bigint;
  v_max bigint;
  v_n int;
  v_id bigint;
begin
  -- id reservado antes da trava por outra transação (simulado com um id já usado): o gatilho renumera
  insert into sentinela.eventos (id, projeto, ip, decisao, selo) overriding system value
  values (1, 'painel-compras', '200.30.30.1', 'liberado', 'qualquer')
  returning id into v_id;
  perform pg_temp.ok('T18 id atrasado é renumerado para manter a ordem da cadeia',
    v_id > 1 and v_id = (select ultimo_id from sentinela.cadeia)
    and (select selo from sentinela.eventos where id = v_id) <> 'qualquer', v_id::text);

  -- selo recalculado aqui com a fórmula literal da especificação (sem usar sentinela.selo)
  perform pg_temp.ok('T18 selo = sha256(selo_anterior | canon) exatamente como na especificação',
    (select count(*) from sentinela.eventos e
      where e.selo <> encode(extensions.digest(coalesce(e.selo_anterior, '') || '|' ||
              concat_ws('|', e.id, to_char(e.criado_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), e.projeto,
                        host(e.ip), coalesce(e.metodo, ''), coalesce(e.caminho, ''), e.decisao, coalesce(e.regra, ''),
                        coalesce(e.identidade, ''), coalesce(e.ua, '')), 'sha256'), 'hex')) = 0);

  perform pg_temp.ok('T18 todos os selos conferem e cada elo aponta para o anterior',
    (select count(*) from sentinela.eventos e where sentinela.selo(e) <> e.selo) = 0
    and (select count(*) from (select x.selo_anterior, lag(x.selo) over (order by x.id) as ant from sentinela.eventos x) y
          where y.ant is not null and y.selo_anterior is distinct from y.ant) = 0
    and (select ultimo_id from sentinela.cadeia) = (select max(id) from sentinela.eventos)
    and (select ultimo_selo from sentinela.cadeia) = (select selo from sentinela.eventos order by id desc limit 1));

  select count(*), max(id) into v_n, v_max from sentinela.eventos;
  perform pg_temp.como('a0000000-0000-4000-8000-0000000000a1', 'sentinela.teste.admin@lube.com.br');
  v := public.sentinela_verificar_cadeia(5000);
  perform pg_temp.postgres();
  perform pg_temp.ok('T18 verificar_cadeia: íntegra',
    (v->>'ok')::boolean and (v->>'verificados')::int = v_n and (v->>'ate_id')::bigint = v_max
    and v->'quebra_id' = 'null'::jsonb and v->>'ultimo_selo' = (select ultimo_selo from sentinela.cadeia), v::text);

  perform pg_temp.como('a0000000-0000-4000-8000-0000000000a1', 'sentinela.teste.admin@lube.com.br');
  v := public.sentinela_verificar_cadeia(10);
  perform pg_temp.postgres();
  perform pg_temp.ok('T18 verificar_cadeia com limite usa âncora e confere os 10 últimos',
    (v->>'ok')::boolean and (v->>'verificados')::int = 10 and (v->>'ate_id')::bigint = v_max, v::text);

  select id into v_meio from sentinela.eventos order by id offset (v_n / 2) limit 1;
  select id into v_prox from sentinela.eventos where id > v_meio order by id limit 1;

  -- adulteração do conteúdo (gatilho de update desligado só aqui; tudo desfeito em seguida)
  begin
    alter table sentinela.eventos disable trigger eventos_sem_update;
    update sentinela.eventos set caminho = '/adulterado' where id = v_meio;
    alter table sentinela.eventos enable trigger eventos_sem_update;
    perform pg_temp.como('a0000000-0000-4000-8000-0000000000a1', 'sentinela.teste.admin@lube.com.br');
    v := public.sentinela_verificar_cadeia(5000);
    raise exception 'desfazer' using errcode = 'P0001';
  exception when raise_exception then
    null;
  end;
  perform pg_temp.ok('T18 conteúdo adulterado é detectado no registro certo',
    not (v->>'ok')::boolean and (v->>'quebra_id')::bigint = v_meio, v::text);

  -- registro do meio apagado (simula a chave da limpeza ligada indevidamente)
  begin
    perform set_config('sentinela.limpeza', 'on', true);
    delete from sentinela.eventos where id = v_meio;
    perform pg_temp.como('a0000000-0000-4000-8000-0000000000a1', 'sentinela.teste.admin@lube.com.br');
    v := public.sentinela_verificar_cadeia(5000);
    raise exception 'desfazer' using errcode = 'P0001';
  exception when raise_exception then
    null;
  end;
  perform pg_temp.ok('T18 registro removido do meio quebra o elo seguinte',
    not (v->>'ok')::boolean and (v->>'quebra_id')::bigint = v_prox, v::text);

  -- último registro apagado
  begin
    perform set_config('sentinela.limpeza', 'on', true);
    delete from sentinela.eventos where id = v_max;
    perform pg_temp.como('a0000000-0000-4000-8000-0000000000a1', 'sentinela.teste.admin@lube.com.br');
    v := public.sentinela_verificar_cadeia(5000);
    raise exception 'desfazer' using errcode = 'P0001';
  exception when raise_exception then
    null;
  end;
  perform pg_temp.ok('T18 registro final removido é detectado (fim da cadeia não confere)',
    not (v->>'ok')::boolean and (v->>'quebra_id')::bigint < v_max, v::text);

  -- só-inserção
  begin
    update sentinela.eventos set caminho = '/x' where id = v_meio;
    perform pg_temp.ok('T18 UPDATE em eventos é barrado', false, 'não deu erro');
  exception when others then
    perform pg_temp.ok('T18 UPDATE em eventos é barrado', sqlstate = '42501', sqlerrm);
  end;
  begin
    delete from sentinela.eventos where id = v_meio;
    perform pg_temp.ok('T18 DELETE em eventos é barrado', false, 'não deu erro');
  exception when others then
    perform pg_temp.ok('T18 DELETE em eventos é barrado', sqlstate = '42501', sqlerrm);
  end;
  begin
    truncate sentinela.eventos;
    perform pg_temp.ok('T18 TRUNCATE em eventos é barrado', false, 'não deu erro');
  exception when others then
    perform pg_temp.ok('T18 TRUNCATE em eventos é barrado', sqlstate = '42501', sqlerrm);
  end;
  perform pg_temp.ok('T18 nada foi alterado pelos testes de adulteração',
    (select count(*) from sentinela.eventos) = v_n
    and (select caminho from sentinela.eventos where id = v_meio) is distinct from '/adulterado');
exception when others then
  perform pg_temp.postgres();
  perform pg_temp.ok('T18 (erro inesperado)', false, sqlstate || ': ' || sqlerrm);
end $$;

-- ---------------------------------------------------------
-- T19 painel exige is_admin
-- ---------------------------------------------------------
do $$
declare
  v_sql text;
  v_ok int := 0;
  v_falhas text[] := '{}';
  v_chamadas text[] := array[
    'select public.sentinela_painel(24)',
    'select public.sentinela_novos(0)',
    'select public.sentinela_ip(''45.10.0.1'')',
    'select public.sentinela_lista_bloqueios(true)',
    'select public.sentinela_lista_confiaveis()',
    'select public.sentinela_lista_analises(10)',
    'select public.sentinela_lista_exposicoes()',
    'select public.sentinela_config_ler()',
    'select public.sentinela_acao(''modo'', ''{"modo":"proteger"}'')',
    'select public.sentinela_verificar_cadeia(10)'];
begin
  -- usuário comum (ativo, não admin) e usuário sem login
  foreach v_sql in array v_chamadas || v_chamadas loop
    begin
      if v_ok + cardinality(v_falhas) < cardinality(v_chamadas) then
        perform pg_temp.como('a0000000-0000-4000-8000-0000000000a2', 'sentinela.teste.comum@lube.com.br');
      else
        perform set_config('request.jwt.claims', '', true);
        perform set_config('role', 'authenticated', true);
      end if;
      execute v_sql;
      perform pg_temp.postgres();
      v_falhas := v_falhas || ('sem erro: ' || v_sql);
    exception when others then
      if sqlstate = '42501' and sqlerrm = 'sentinela: acesso restrito ao TI' then
        v_ok := v_ok + 1;
      else
        v_falhas := v_falhas || (v_sql || ' → ' || sqlstate || ' ' || sqlerrm);
      end if;
    end;
  end loop;
  perform pg_temp.ok('T19 as 10 funções de painel recusam não-admin e sem login com 42501',
    v_ok = 20 and cardinality(v_falhas) = 0, format('ok=%s falhas=%s', v_ok, v_falhas));
  perform pg_temp.ok('T19 nada mudou (modo continua observar)', (select modo from sentinela.config) = 'observar');
exception when others then
  perform pg_temp.postgres();
  perform pg_temp.ok('T19 (erro inesperado)', false, sqlstate || ': ' || sqlerrm);
end $$;

-- ---------------------------------------------------------
-- T20 privilégios: srv_* só service_role; anon nada; tabelas fechadas
-- ---------------------------------------------------------
do $$
declare
  v_sql text;
  v_ok int := 0;
  v_falhas text[] := '{}';
  v_srv text[] := array[
    'select public.sentinela_srv_lista(''painel-compras'')',
    'select public.sentinela_srv_registrar(''painel-compras'', ''production'', ''g'', ''nodejs'', ''[]'')',
    'select public.sentinela_srv_contexto_ip(''1.2.3.4'')',
    'select public.sentinela_srv_registrar_analise(''1.2.3.4'', ''{}'')',
    'select public.sentinela_srv_ia_cota()',
    'select public.sentinela_srv_ia_status(''ligada'', null)',
    'select public.sentinela_srv_identidade(''1.2.3.4'', null, ''a@lube.com.br'', ''portal'', null)',
    'select public.sentinela_srv_tentativa(''1.2.3.4'', ''a'', null)',
    'select public.sentinela_srv_permissao(null, ''gestao-ti'')',
    'select public.sentinela_srv_passe_usar(''jti-123456789'', null, null)',
    'select public.sentinela_srv_chave_ativa()',
    'select public.sentinela_srv_chave_criar(''x'', ''{}'', ''x'')',
    'select public.sentinela_srv_chaves_publicas()',
    'select public.sentinela_srv_tor_atualizar(''{}'')',
    'select public.sentinela_srv_manutencao()'];
  v_tabelas text[] := array['select count(*) from sentinela.eventos', 'select count(*) from sentinela.config',
                            'select count(*) from sentinela.chaves'];
  v_n int;
begin
  -- srv_* para authenticated (até admin) e anon: permission denied
  foreach v_sql in array v_srv loop
    begin
      perform pg_temp.como('a0000000-0000-4000-8000-0000000000a1', 'sentinela.teste.admin@lube.com.br');
      execute v_sql;
      perform pg_temp.postgres();
      v_falhas := v_falhas || ('authenticated executou: ' || v_sql);
    exception when insufficient_privilege then
      v_ok := v_ok + 1;
    when others then
      v_falhas := v_falhas || (v_sql || ' → ' || sqlstate || ' ' || sqlerrm);
    end;
    begin
      perform pg_temp.como(null, null, 'anon');
      execute v_sql;
      perform pg_temp.postgres();
      v_falhas := v_falhas || ('anon executou: ' || v_sql);
    exception when insufficient_privilege then
      v_ok := v_ok + 1;
    when others then
      v_falhas := v_falhas || (v_sql || ' → ' || sqlstate || ' ' || sqlerrm);
    end;
  end loop;
  perform pg_temp.ok('T20 as 15 srv_* são negadas para authenticated e anon',
    v_ok = 30 and cardinality(v_falhas) = 0, format('ok=%s falhas=%s', v_ok, v_falhas));

  -- painel para anon: permission denied (antes mesmo do is_admin)
  v_ok := 0;
  v_falhas := '{}';
  foreach v_sql in array array['select public.sentinela_painel(24)', 'select public.sentinela_acao(''modo'', ''{}'')',
                               'select public.sentinela_verificar_cadeia(10)'] loop
    begin
      perform pg_temp.como(null, null, 'anon');
      execute v_sql;
      perform pg_temp.postgres();
      v_falhas := v_falhas || ('anon executou: ' || v_sql);
    exception when others then
      if sqlstate = '42501' and sqlerrm like 'permission denied for function%' then
        v_ok := v_ok + 1;
      else
        v_falhas := v_falhas || (v_sql || ' → ' || sqlstate || ' ' || sqlerrm);
      end if;
    end;
  end loop;
  perform pg_temp.ok('T20 anon não executa funções de painel', v_ok = 3 and cardinality(v_falhas) = 0,
    format('ok=%s falhas=%s', v_ok, v_falhas));

  -- tabelas do schema sentinela fechadas para authenticated e anon
  v_ok := 0;
  v_falhas := '{}';
  foreach v_sql in array v_tabelas loop
    begin
      perform pg_temp.como('a0000000-0000-4000-8000-0000000000a1', 'sentinela.teste.admin@lube.com.br');
      execute v_sql;
      perform pg_temp.postgres();
      v_falhas := v_falhas || ('authenticated leu: ' || v_sql);
    exception when insufficient_privilege then
      v_ok := v_ok + 1;
    end;
    begin
      perform pg_temp.como(null, null, 'anon');
      execute v_sql;
      perform pg_temp.postgres();
      v_falhas := v_falhas || ('anon leu: ' || v_sql);
    exception when insufficient_privilege then
      v_ok := v_ok + 1;
    end;
  end loop;
  perform pg_temp.ok('T20 tabelas do schema sentinela inacessíveis pela API', v_ok = 6 and cardinality(v_falhas) = 0,
    format('ok=%s falhas=%s', v_ok, v_falhas));

  -- service_role executa as srv_* e não passa no is_admin do painel
  perform pg_temp.como(null, null, 'service_role');
  v_n := public.sentinela_srv_ia_cota();
  perform public.sentinela_srv_lista('painel-compras');
  perform pg_temp.postgres();
  perform pg_temp.ok('T20 service_role executa srv_*', v_n is not null);
  begin
    perform pg_temp.como(null, null, 'service_role');
    perform public.sentinela_painel(24);
    perform pg_temp.postgres();
    perform pg_temp.ok('T20 service_role não abre o painel (sem is_admin)', false, 'não deu erro');
  exception when others then
    perform pg_temp.ok('T20 service_role não abre o painel (sem is_admin)', sqlstate = '42501', sqlerrm);
  end;

  -- catálogo: quem pode executar o quê
  perform pg_temp.ok('T20 catálogo: anon não executa nenhuma sentinela_*',
    not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname like 'sentinela\_%' and has_function_privilege('anon', p.oid, 'execute')));
  perform pg_temp.ok('T20 catálogo: authenticated só as 10 de painel',
    (select array_agg(p.proname order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname like 'sentinela\_%' and has_function_privilege('authenticated', p.oid, 'execute'))
    = array['sentinela_acao','sentinela_config_ler','sentinela_ip','sentinela_lista_analises','sentinela_lista_bloqueios',
            'sentinela_lista_confiaveis','sentinela_lista_exposicoes','sentinela_novos','sentinela_painel','sentinela_verificar_cadeia']::name[]);
  perform pg_temp.ok('T20 catálogo: service_role executa as 15 srv_*',
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname like 'sentinela\_srv\_%' and has_function_privilege('service_role', p.oid, 'execute')) = 15);
  perform pg_temp.ok('T20 catálogo: todas security definer com search_path fixo',
    (select bool_and(p.prosecdef and 'search_path=sentinela, public, extensions, pg_temp' = any(p.proconfig))
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname like 'sentinela\_%')
    and (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname like 'sentinela\_%') = 25,
    (select string_agg(p.proname || ':' || coalesce(array_to_string(p.proconfig, ';'), '-'), ' | ')
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname like 'sentinela\_%' and not (p.prosecdef and 'search_path=sentinela, public, extensions, pg_temp' = any(p.proconfig))));
  perform pg_temp.ok('T20 catálogo: schema sentinela sem USAGE para anon/authenticated e RLS em todas as tabelas',
    not has_schema_privilege('anon', 'sentinela', 'usage') and not has_schema_privilege('authenticated', 'sentinela', 'usage')
    and (select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'sentinela' and c.relkind = 'r')
    and not exists (select 1 from pg_policies where schemaname = 'sentinela'));
exception when others then
  perform pg_temp.postgres();
  perform pg_temp.ok('T20 (erro inesperado)', false, sqlstate || ': ' || sqlerrm);
end $$;

-- ---------------------------------------------------------
-- T21 painel como admin
-- ---------------------------------------------------------
do $$
declare
  v jsonb;
  n jsonb;
  n2 jsonb;
  ipj jsonb;
  ipc jsonb;
  cfg jsonb;
  lb jsonb;
  lbi jsonb;
  lc jsonb;
  la jsonb;
  lx jsonb;
  v_max bigint;
  vis jsonb;
begin
  -- visitantes com identidade provável e confirmada
  perform pg_temp.reg(jsonb_build_array(pg_temp.ev('99.90.0.1'),
                                        pg_temp.ev('77.70.0.40', '{"pais":"PT","identidade":"Ciclano@lube.com.br","identidade_origem":"passe"}')));
  select max(id) into v_max from sentinela.eventos;

  perform pg_temp.como('a0000000-0000-4000-8000-0000000000a1', 'sentinela.teste.admin@lube.com.br');
  v   := public.sentinela_painel(24);
  n   := public.sentinela_novos(0);
  n2  := public.sentinela_novos(v_max);
  ipj := public.sentinela_ip('45.10.0.1');
  ipc := public.sentinela_ip('10.20.30.5');
  cfg := public.sentinela_config_ler();
  lb  := public.sentinela_lista_bloqueios(false);
  lbi := public.sentinela_lista_bloqueios(true);
  lc  := public.sentinela_lista_confiaveis();
  la  := public.sentinela_lista_analises(100);
  lx  := public.sentinela_lista_exposicoes();
  perform pg_temp.postgres();

  perform pg_temp.ok('T21 painel tem todas as chaves do contrato',
    v ?& array['agora','modo','casa','ia','kpis','por_hora','pontos','visitantes','feed','sistemas','contagens','cadeia','ultimo_id']
    and v->'ia' ?& array['status','detalhe','status_em','analises_janela','ultima_em','limite_hora']
    and v->'kpis' ?& array['acessos','bloqueados','observados','ips','paises','analises','identificados']
    and v->'casa' ?& array['nome','lat','lon'], left(v::text, 300));
  perform pg_temp.ok('T21 por_hora com 24 baldes (inclusive vazios)',
    jsonb_array_length(v->'por_hora') = 24
    and (select sum((x->>'liberado')::int + (x->>'observado')::int + (x->>'bloqueado')::int) from jsonb_array_elements(v->'por_hora') x)
        = (select count(*) from sentinela.eventos where criado_em >= date_trunc('hour', now(), 'UTC') - interval '23 hours'));
  perform pg_temp.ok('T21 kpis batem com as tabelas',
    (v->'kpis'->>'acessos')::int = (select count(*) from sentinela.eventos)
    and (v->'kpis'->>'bloqueados')::int = (select count(*) from sentinela.eventos where decisao = 'bloqueado')
    and (v->'kpis'->>'ips')::int = (select count(distinct ip) from sentinela.eventos)
    and (v->'kpis'->>'analises')::int = (select count(*) from sentinela.analises where veredito <> 'erro'), (v->'kpis')::text);
  select x into vis from jsonb_array_elements(v->'visitantes') x where x->>'ip' = '45.10.0.1';
  perform pg_temp.ok('T21 visitante com bloqueio certo: status bloqueado',
    vis->>'status' = 'bloqueado' and vis->'bloqueio'->>'nivel' = 'certo' and vis->>'status_motivo' = 'varredura'
    and vis->'bloqueio'->>'tipo' = 'ip' and vis->'bloqueio'->>'valor' = '45.10.0.1' and vis->'bloqueio'->>'origem' = 'regra', vis::text);
  select x into vis from jsonb_array_elements(v->'visitantes') x where x->>'ip' = '45.20.0.1';
  perform pg_temp.ok('T21 visitante com bloqueio suspeito no modo observar: status observado',
    vis->>'status' = 'observado' and vis->>'status_motivo' = 'robo', vis::text);
  select x into vis from jsonb_array_elements(v->'visitantes') x where x->>'ip' = '10.20.30.5';
  perform pg_temp.ok('T21 visitante de rede confiável marcado', (vis->>'confiavel')::boolean, vis::text);
  select x into vis from jsonb_array_elements(v->'visitantes') x where x->>'ip' = '99.90.0.1';
  perform pg_temp.ok('T21 identidade vinda do login do IP aparece como provável',
    vis->>'identidade' = 'sentinela.teste.comum@lube.com.br' and vis->>'identidade_origem' = 'provavel', vis::text);
  select x into vis from jsonb_array_elements(v->'visitantes') x where x->>'ip' = '77.70.0.40';
  perform pg_temp.ok('T21 identidade do próprio evento aparece com a origem dele',
    vis->>'identidade' = 'ciclano@lube.com.br' and vis->>'identidade_origem' = 'passe', vis::text);
  select x into vis from jsonb_array_elements(v->'visitantes') x where x->>'ip' = '88.80.0.1';
  perform pg_temp.ok('T21 veredito da IA no visitante',
    vis->'veredito'->>'veredito' = 'malicioso' and vis->'veredito' ?& array['confianca','motivo','em'], vis::text);
  perform pg_temp.ok('T21 pontos do globo com lat/lon e status',
    jsonb_array_length(v->'pontos') > 0
    and (select bool_and(x ?& array['ip','lat','lon','cidade','regiao','pais','total','bloqueados','observados','status','risco','ultimo'])
           from jsonb_array_elements(v->'pontos') x));
  perform pg_temp.ok('T21 feed com 40 eventos mais novos e nome do sistema',
    jsonb_array_length(v->'feed') = 40 and (v->'feed'->0->>'id')::bigint = v_max
    and v->'feed'->0 ?& array['id','criado_em','projeto','sistema_nome','metodo','caminho','ip','pais','cidade','decisao','regra','motivo','risco','identidade']
    and exists (select 1 from jsonb_array_elements(v->'feed') x where x->>'sistema_nome' = 'BI Compras'));
  perform pg_temp.ok('T21 8 sistemas com acessos/bloqueados',
    jsonb_array_length(v->'sistemas') = 8
    and (select (x->>'acessos')::int from jsonb_array_elements(v->'sistemas') x where x->>'projeto' = 'gestao-ti') = 2);
  perform pg_temp.ok('T21 contagens e cadeia',
    (v->'contagens'->>'bloqueios_ativos')::int = (select count(*) from sentinela.bloqueios where revogado_em is null and (expira_em is null or expira_em > now()))
    and v->'contagens'->'exposicoes' = '{"critica":2,"alta":4,"media":5,"baixa":2}'::jsonb
    and (v->'cadeia'->>'ultimo_id')::bigint = v_max and (v->>'ultimo_id')::bigint = v_max, (v->'contagens')::text);

  perform pg_temp.ok('T21 novos(0): até 100 eventos em ordem crescente, com lat/lon',
    jsonb_array_length(n->'eventos') = least(100, (select count(*) from sentinela.eventos))::int
    and (n->'eventos'->0->>'id')::bigint < (n->'eventos'->1->>'id')::bigint
    and n->'eventos'->0 ? 'lat' and n->'eventos'->0 ? 'lon'
    and (n->>'ultimo_id')::bigint = (n->'eventos'-> -1->>'id')::bigint and n->'kpis' ? 'acessos', n->>'ultimo_id');
  perform pg_temp.ok('T21 novos(último id): vazio e mantém o último id',
    n2->'eventos' = '[]'::jsonb and (n2->>'ultimo_id')::bigint = v_max, n2::text);
  perform pg_temp.ok('T21 detalhe do IP: contexto + análises + confiáveis',
    ipj ?& array['ip','perfil','confiavel','tor','bloqueios','identidades','tentativas_10min','eventos','analises','confiaveis']
    and jsonb_array_length(ipj->'bloqueios') >= 1 and jsonb_array_length(ipc->'confiaveis') = 1, left(ipj::text, 200));
  perform pg_temp.ok('T21 config_ler', cfg->'config'->>'modo' = 'observar' and jsonb_array_length(cfg->'sistemas') = 8
    and cfg->'sistemas'->0->>'projeto' = 'painel-lube-distribuidora');
  perform pg_temp.ok('T21 lista de bloqueios: ativos e, com filtro, também inativos',
    (select bool_and((x->>'ativo')::boolean) from jsonb_array_elements(lb) x)
    and jsonb_array_length(lbi) = jsonb_array_length(lb) + 2
    and lb->0 ?& array['id','tipo','valor','nivel','origem','regra','motivo','criado_em','expira_em','revogado_em','hits','ultimo_hit','ativo'],
    format('%s ativos, %s com inativos', jsonb_array_length(lb), jsonb_array_length(lbi)));
  perform pg_temp.ok('T21 lista de confiáveis (manual e login)',
    exists (select 1 from jsonb_array_elements(lc) x where x->>'origem' = 'manual' and x->>'valor' = '10.20.30.0/24')
    and exists (select 1 from jsonb_array_elements(lc) x where x->>'origem' = 'login' and x->>'valor' = '99.90.0.1')
    and lc->0 ?& array['id','tipo','valor','descricao','origem','identidade','criado_em','expira_em','ativo']);
  perform pg_temp.ok('T21 lista de análises', jsonb_array_length(la) = (select count(*) from sentinela.analises));
  perform pg_temp.ok('T21 lista de exposições (13, críticas primeiro)', jsonb_array_length(lx) = 13 and lx->0->>'severidade' = 'critica');
exception when others then
  perform pg_temp.postgres();
  perform pg_temp.ok('T21 (erro inesperado)', false, sqlstate || ': ' || sqlerrm);
end $$;

-- ---------------------------------------------------------
-- T22 ações do admin (com validação)
-- ---------------------------------------------------------
do $$
declare
  r jsonb;
  v_id bigint;
  v_erros text[] := '{}';
  v_ok int := 0;
  v_par text[];
  v_acoes int;
  b sentinela.bloqueios;
  s sentinela.sistemas;
begin
  select count(*) into v_acoes from sentinela.acoes_admin;
  perform pg_temp.como('a0000000-0000-4000-8000-0000000000a1', 'sentinela.teste.admin@lube.com.br');

  r := public.sentinela_acao('bloquear', '{"valor":"203.0.113.9","duracao":"1h","motivo":"teste manual"}');
  v_id := (r->>'id')::bigint;
  perform pg_temp.postgres();
  select * into b from sentinela.bloqueios where id = v_id;
  perform pg_temp.ok('T22 bloquear IP: certo, manual, 1 h, autor = e-mail do admin',
    (r->>'ok')::boolean and (r->>'novo')::boolean and b.nivel = 'certo' and b.origem = 'manual' and b.tipo = 'ip'
    and b.criado_por = 'sentinela.teste.admin@lube.com.br' and pg_temp.perto(b.expira_em, now() + interval '1 hour'), r::text);

  perform pg_temp.como('a0000000-0000-4000-8000-0000000000a1', 'sentinela.teste.admin@lube.com.br');
  r := public.sentinela_acao('bloquear', '{"valor":" 198.51.100.0/24 ","duracao":"permanente","motivo":"rede de teste"}');
  perform pg_temp.postgres();
  select * into b from sentinela.bloqueios where id = (r->>'id')::bigint;
  perform pg_temp.ok('T22 bloquear CIDR permanente', b.tipo = 'cidr' and b.valor = '198.51.100.0/24' and b.expira_em is null, r::text);

  perform pg_temp.como('a0000000-0000-4000-8000-0000000000a1', 'sentinela.teste.admin@lube.com.br');
  r := public.sentinela_acao('desbloquear', jsonb_build_object('id', v_id));
  perform pg_temp.postgres();
  perform pg_temp.ok('T22 desbloquear revoga com autor',
    (select revogado_em is not null and revogado_por = 'sentinela.teste.admin@lube.com.br' from sentinela.bloqueios where id = v_id), r::text);

  -- entradas inválidas: todas recusadas, nada gravado
  foreach v_par slice 1 in array array[
      ['bloquear',    '{"valor":"abc","duracao":"1h","motivo":"x"}',             '22023'],
      ['bloquear',    '{"valor":"0.0.0.0/0","duracao":"1h","motivo":"x"}',       '22023'],
      ['bloquear',    '{"valor":"10.0.0.1/24","duracao":"1h","motivo":"x"}',     '22023'],
      ['bloquear',    '{"valor":"1.2.3.4; drop table x","duracao":"1h","motivo":"x"}', '22023'],
      ['bloquear',    '{"valor":"1.2.3.4","duracao":"2h","motivo":"x"}',         '22023'],
      ['bloquear',    '{"valor":"1.2.3.4","duracao":"1h"}',                      '22023'],
      ['desbloquear', '{"id":"abc"}',                                            '22023'],
      ['modo',        '{"modo":"xpto"}',                                         '22023'],
      ['casa',        '{"nome":"x","lat":200,"lon":0}',                          '22023'],
      ['sistema',     '{"projeto":"nao-existe"}',                                'P0002'],
      ['sistema',     '{"projeto":"gestao-ti","exige_login":"sim"}',             '22023'],
      ['sistema',     '{"projeto":"gestao-ti","rotas_publicas":["semBarra"]}',   '22023'],
      ['sistema',     '{"projeto":"gestao-ti","rotas_publicas":["/"]}',          '22023'],
      ['sistema',     '{"projeto":"gestao-ti","rotas_publicas":["/publico","/*"]}', '22023'],
      ['sistema',     '{"projeto":"gestao-ti","arquivos_proibidos":["("]}',      '22023'],
      ['exposicao',   '{"id":1,"status":"xpto"}',                                '22023'],
      ['limites',     '{"ia_confianca_min":0.1}',                                '22023'],
      ['limites',     '{}',                                                      '22023'],
      ['limites',     '{"retencao_dias":7}',                                     '22023'],
      ['limites',     '{"limite_eventos_ip_min":5}',                             '22023'],
      ['limites',     '{"limite_rajada_min":300,"retencao_dias":3650}',          '22023'],
      ['sistema',     '{"projeto":"gestao-ti","arquivos_proibidos":["(?i)\\.sql$"]}',          '22023'],
      ['sistema',     '{"projeto":"gestao-ti","arquivos_proibidos":["[[:digit:]]+\\.sql$"]}',  '22023'],
      ['sistema',     '{"projeto":"gestao-ti","arquivos_proibidos":["(a+)+$"]}',               '22023'],
      ['sistema',     '{"projeto":"gestao-ti","arquivos_proibidos":["\\mfoo"]}',               '22023'],
      ['sistema',     '{"projeto":"gestao-ti","arquivos_proibidos":["[]a]"]}',                 '22023'],
      ['sistema',     '{"projeto":"gestao-ti","arquivos_proibidos":["((ab)*c)+"]}',            '22023'],
      ['confiar',     '{"valor":"1.2.3.4"}',                                     '22023'],
      ['apagar_tudo', '{}',                                                      '22023']] loop
    begin
      perform pg_temp.como('a0000000-0000-4000-8000-0000000000a1', 'sentinela.teste.admin@lube.com.br');
      perform public.sentinela_acao(v_par[1], v_par[2]::jsonb);
      perform pg_temp.postgres();
      v_erros := v_erros || ('aceitou: ' || v_par[1] || ' ' || v_par[2]);
    exception when others then
      if sqlstate = v_par[3] then
        v_ok := v_ok + 1;
      else
        v_erros := v_erros || (v_par[1] || ' ' || v_par[2] || ' → ' || sqlstate || ' ' || sqlerrm);
      end if;
    end;
  end loop;
  perform pg_temp.ok('T22 29 entradas inválidas recusadas com o código certo', v_ok = 29 and cardinality(v_erros) = 0,
    format('ok=%s erros=%s', v_ok, v_erros));
  perform pg_temp.ok('T22 retenção e teto de gravação não mudam pelo painel (só por migração)',
    (select retencao_dias = 90 and limite_eventos_ip_min = 30 and limite_rajada_min = 120 from sentinela.config));

  perform pg_temp.como('a0000000-0000-4000-8000-0000000000a1', 'sentinela.teste.admin@lube.com.br');
  r := public.sentinela_acao('confiar', '{"valor":"45.20.0.1","descricao":"robô liberado no teste"}');
  perform pg_temp.postgres();
  perform pg_temp.ok('T22 confiar IP revoga os bloqueios automáticos dele',
    (r->>'ok')::boolean and (r->>'bloqueios_revogados')::int = 1
    and not exists (select 1 from sentinela.bloqueios where valor = '45.20.0.1' and revogado_em is null), r::text);
  perform pg_temp.como('a0000000-0000-4000-8000-0000000000a1', 'sentinela.teste.admin@lube.com.br');
  r := public.sentinela_acao('desconfiar', jsonb_build_object('id', (r->>'id')::bigint));
  perform pg_temp.postgres();
  perform pg_temp.ok('T22 desconfiar remove', (select removido_em is not null from sentinela.confiaveis where id = (r->>'id')::bigint), r::text);

  -- modo proteger: muda a aplicação, não o que se grava
  perform pg_temp.como('a0000000-0000-4000-8000-0000000000a1', 'sentinela.teste.admin@lube.com.br');
  perform public.sentinela_acao('modo', '{"modo":"proteger"}');
  perform pg_temp.postgres();
  perform pg_temp.ok('T22 modo proteger gravado com autor',
    (select modo = 'proteger' and atualizado_por = 'sentinela.teste.admin@lube.com.br' from sentinela.config));
  r := public.sentinela_srv_registrar_analise('88.80.0.9', '{"veredito":"malicioso","confianca":0.95,"motivo":"exploração","acao":"bloquear_1h"}');
  perform pg_temp.ok('T22 IA no modo proteger: aplicado "bloqueio #id"', r->>'aplicado' like 'bloqueio #%', r::text);
  r := pg_temp.reg(pg_temp.lote(pg_temp.ev('45.21.0.1', '{"ua":"python-requests/2.31","tipo":"api","decisao":"bloqueado","regra":"robo"}'), 20));
  perform pg_temp.ok('T22 regra de robô no modo proteger cria o mesmo bloqueio suspeito',
    r->'bloqueios_novos'->0->>'n' = 'suspeito' and r->'bloqueios_novos'->0->>'regra' = 'robo', r::text);
  perform pg_temp.como('a0000000-0000-4000-8000-0000000000a1', 'sentinela.teste.admin@lube.com.br');
  perform public.sentinela_acao('modo', '{"modo":"observar"}');
  r := public.sentinela_acao('casa', '{"nome":"Lube teste","lat":-20.3,"lon":-40.3}');
  r := public.sentinela_acao('sistema', '{"projeto":"gestao-ti","exige_login":true,"rotas_publicas":["/publico","/api/saude","/publico"],"arquivos_proibidos":["^/x/","\\.bak$"]}');
  perform pg_temp.postgres();
  select * into s from sentinela.sistemas where projeto = 'gestao-ti';
  perform pg_temp.ok('T22 sistema: exige_login, rotas (sem repetir) e arquivos proibidos',
    s.exige_login and s.rotas_publicas = array['/publico','/api/saude'] and s.arquivos_proibidos = array['^/x/','\.bak$'],
    format('%s %s %s', s.exige_login, s.rotas_publicas, s.arquivos_proibidos));
  perform pg_temp.ok('T22 casa gravada', (select casa_nome = 'Lube teste' and casa_lat = -20.3 from sentinela.config));

  select min(id) into v_id from sentinela.exposicoes;
  perform pg_temp.como('a0000000-0000-4000-8000-0000000000a1', 'sentinela.teste.admin@lube.com.br');
  r := public.sentinela_acao('exposicao', jsonb_build_object('id', v_id, 'status', 'corrigida', 'decisao', 'resolvido no teste'));
  r := public.sentinela_acao('limites', '{"limite_rajada_min":200,"ia_limite_hora":30,"ia_confianca_min":0.9}');
  perform pg_temp.postgres();
  perform pg_temp.ok('T22 exposição e limites gravados',
    (select status = 'corrigida' and decisao = 'resolvido no teste' from sentinela.exposicoes order by id limit 1)
    and (select limite_rajada_min = 200 and ia_limite_hora = 30 and ia_confianca_min = 0.9 from sentinela.config));
  perform pg_temp.ok('T22 cada ação aceita ficou em acoes_admin com o e-mail do admin',
    (select count(*) from sentinela.acoes_admin) = v_acoes + 11
    and (select bool_and(email = 'sentinela.teste.admin@lube.com.br') from sentinela.acoes_admin),
    ((select count(*) from sentinela.acoes_admin) - v_acoes)::text);
exception when others then
  perform pg_temp.postgres();
  perform pg_temp.ok('T22 (erro inesperado)', false, sqlstate || ': ' || sqlerrm);
end $$;

-- ---------------------------------------------------------
-- T23 manutenção (retenção, 1x por dia)
-- ---------------------------------------------------------
do $$
declare
  m0 jsonb;
  m1 jsonb;
  m2 jsonb;
  v jsonb;
  v_n int;
  v_min bigint;
begin
  -- dados velhos; os dois eventos velhos entram NO COMEÇO da cadeia (como na vida real),
  -- com o gatilho de selo desligado só aqui
  insert into sentinela.passes_usados (jti, usado_em) values ('jti-velho-000001', now() - interval '3 days');
  insert into sentinela.tentativas_login (ip, usuario, criado_em) values ('66.60.0.9', 'velho', now() - interval '31 days');
  insert into sentinela.identidades (ip, email, origem, criado_em) values ('66.60.0.9', 'velho@lube.com.br', 'portal', now() - interval '100 days');
  select min(id) into v_min from sentinela.eventos;
  alter table sentinela.eventos disable trigger eventos_selar;
  insert into sentinela.eventos (id, criado_em, projeto, ip, decisao, selo) overriding system value
  values (v_min - 2, now() - interval '101 days', 'painel-compras', '66.60.0.9', 'liberado', 'velho1'),
         (v_min - 1, now() - interval '100 days', 'painel-compras', '66.60.0.9', 'liberado', 'velho2');
  alter table sentinela.eventos enable trigger eventos_selar;
  select count(*) into v_n from sentinela.eventos;

  -- lote de 1 e no máximo 1 lote: simula um atraso maior que o que cabe numa chamada
  m0 := sentinela.manutencao(1, 1);
  perform pg_temp.ok('T23 com atraso: apaga um lote do começo da cadeia, fica pendente e não marca o dia',
    (m0->>'executada')::boolean and (m0->>'pendente')::boolean
    and m0->'apagados' = '{"eventos":1,"tentativas_login":1,"passes_usados":1,"identidades":1}'::jsonb
    and (select count(*) from sentinela.eventos) = v_n - 1
    and not exists (select 1 from sentinela.eventos where id = v_min - 2)
    and (select manutencao_em from sentinela.config) is null, m0::text);
  m1 := public.sentinela_srv_manutencao();
  perform pg_temp.ok('T23 a chamada seguinte termina o atraso e marca o dia',
    (m1->>'executada')::boolean and not (m1->>'pendente')::boolean
    and m1->'apagados' = '{"eventos":1,"tentativas_login":0,"passes_usados":0,"identidades":0}'::jsonb
    and (select count(*) from sentinela.eventos) = v_n - 2
    and (select manutencao_em from sentinela.config) is not null, m1::text);
  perform pg_temp.ok('T23 chave de limpeza volta a desligar', current_setting('sentinela.limpeza', true) = 'off');
  m2 := public.sentinela_srv_manutencao();
  perform pg_temp.ok('T23 no máximo 1x por dia', not (m2->>'executada')::boolean and m2->'apagados' = '{}'::jsonb, m2::text);
  begin
    delete from sentinela.eventos where id = (select max(id) from sentinela.eventos);
    perform pg_temp.ok('T23 depois da manutenção o DELETE volta a ser barrado', false, 'não deu erro');
  exception when others then
    perform pg_temp.ok('T23 depois da manutenção o DELETE volta a ser barrado', sqlstate = '42501', sqlerrm);
  end;

  perform pg_temp.como('a0000000-0000-4000-8000-0000000000a1', 'sentinela.teste.admin@lube.com.br');
  v := public.sentinela_verificar_cadeia(5000);
  perform pg_temp.postgres();
  perform pg_temp.ok('T23 cadeia íntegra depois da manutenção', (v->>'ok')::boolean, v::text);
exception when others then
  perform pg_temp.postgres();
  perform pg_temp.ok('T23 (erro inesperado)', false, sqlstate || ': ' || sqlerrm);
end $$;

-- ---------------------------------------------------------
-- T24 lista: o corte dos 5000 não tira os manuais/permanentes
-- ---------------------------------------------------------
do $$
declare
  l jsonb;
  v_man bigint;
  v_n int;
  v_tem boolean;
begin
  insert into sentinela.bloqueios (tipo, valor, rede, nivel, origem, regra, motivo, criado_em, expira_em, criado_por)
  values ('ip', '203.0.113.50', '203.0.113.50/32', 'certo', 'manual', 'manual', 'atacante conhecido',
          now() - interval '30 days', null, 'teste')
  returning id into v_man;
  begin
    -- enxurrada de 5100 bloqueios certos novos (IPs descartáveis); desfeita logo depois
    insert into sentinela.bloqueios (tipo, valor, rede, nivel, origem, regra, motivo, expira_em, criado_por)
    select 'ip', host(x.ip), x.ip::cidr, 'certo', 'regra', 'varredura', 'enxurrada', now() + interval '24 hours', 'sentinela'
      from (select ('100.64.0.0'::inet + g) as ip from generate_series(1, 5100) g) x;
    l := public.sentinela_srv_lista('painel-compras');
    v_n := jsonb_array_length(l->'bloqueios');
    v_tem := exists (select 1 from jsonb_array_elements(l->'bloqueios') x where (x->>'id')::bigint = v_man);
    raise exception 'desfazer' using errcode = 'P0001';
  exception when raise_exception then
    null;
  end;
  delete from sentinela.bloqueios where id = v_man;
  perform pg_temp.ok('T24 lista: bloqueio manual permanente antigo continua no corte de 5000',
    v_n = 5000 and v_tem, format('n=%s manual_na_lista=%s', v_n, v_tem));
exception when others then
  perform pg_temp.ok('T24 (erro inesperado)', false, sqlstate || ': ' || sqlerrm);
end $$;

-- ---------------------------------------------------------
-- T25 srv_* recusam anon/authenticated no próprio corpo (mesmo se o grant vazar)
-- ---------------------------------------------------------
do $$
declare
  v_ok int := 0;
  v_falhas text[] := '{}';
begin
  begin
    grant execute on function public.sentinela_srv_chave_ativa() to anon, authenticated;
    grant execute on function public.sentinela_srv_registrar(text, text, text, text, jsonb) to anon;
    begin
      perform pg_temp.como(null, null, 'anon');
      perform public.sentinela_srv_chave_ativa();
      v_falhas := v_falhas || 'anon leu a chave'::text;
    exception when insufficient_privilege then
      if sqlerrm = 'sentinela: função restrita à Central' then v_ok := v_ok + 1; else v_falhas := v_falhas || sqlerrm; end if;
    end;
    begin
      perform pg_temp.como('a0000000-0000-4000-8000-0000000000a1', 'sentinela.teste.admin@lube.com.br');
      perform public.sentinela_srv_chave_ativa();
      v_falhas := v_falhas || 'authenticated leu a chave'::text;
    exception when insufficient_privilege then
      if sqlerrm = 'sentinela: função restrita à Central' then v_ok := v_ok + 1; else v_falhas := v_falhas || sqlerrm; end if;
    end;
    begin
      perform pg_temp.como(null, null, 'anon');
      perform public.sentinela_srv_registrar('painel-compras', 'production', 'g', 'nodejs',
        jsonb_build_array(pg_temp.ev('198.18.0.1', '{"caminho":"/.env","decisao":"bloqueado","regra":"varredura"}')));
      v_falhas := v_falhas || 'anon bloqueou um IP'::text;
    exception when insufficient_privilege then
      if sqlerrm = 'sentinela: função restrita à Central' then v_ok := v_ok + 1; else v_falhas := v_falhas || sqlerrm; end if;
    end;
    perform pg_temp.postgres();
    raise exception 'desfazer' using errcode = 'P0001';
  exception when raise_exception then
    null;
  end;
  perform pg_temp.postgres();
  perform pg_temp.ok('T25 srv_* recusam anon e authenticated no corpo, mesmo com EXECUTE concedido',
    v_ok = 3 and cardinality(v_falhas) = 0 and not has_function_privilege('anon', 'public.sentinela_srv_chave_ativa()', 'execute')
    and not exists (select 1 from sentinela.bloqueios where valor = '198.18.0.1'),
    format('ok=%s falhas=%s', v_ok, v_falhas));
exception when others then
  perform pg_temp.postgres();
  perform pg_temp.ok('T25 (erro inesperado)', false, sqlstate || ': ' || sqlerrm);
end $$;

-- ---------------------------------------------------------
-- T26 bloqueio: suspeito não alonga certo; manual é linha própria
-- ---------------------------------------------------------
do $$
declare
  r jsonb;
  m jsonb;
  c jsonb;
  v_certo sentinela.bloqueios;
  v_certo2 sentinela.bloqueios;
  v_ia sentinela.bloqueios;
  v_man sentinela.bloqueios;
begin
  perform pg_temp.reg(jsonb_build_array(pg_temp.ev('91.0.0.1',
    '{"caminho":"/.env","tipo":"arquivo","decisao":"bloqueado","regra":"varredura"}')));
  select * into v_certo from sentinela.bloqueios where valor = '91.0.0.1' and nivel = 'certo';
  r := public.sentinela_srv_registrar_analise('91.0.0.1',
         '{"veredito":"malicioso","confianca":0.95,"motivo":"exploração","acao":"bloquear_7d"}');
  select * into v_certo2 from sentinela.bloqueios where id = v_certo.id;
  select * into v_ia from sentinela.bloqueios where valor = '91.0.0.1' and origem = 'ia';
  perform pg_temp.ok('T26 veredito da IA (suspeito) não alonga o bloqueio certo: vira linha própria',
    v_certo2.expira_em = v_certo.expira_em and v_certo2.analise_id is null
    and v_ia.id is not null and v_ia.id <> v_certo.id and v_ia.nivel = 'suspeito'
    and pg_temp.perto(v_ia.expira_em, now() + interval '7 days') and v_ia.analise_id = (r->>'analise_id')::bigint
    and r->>'aplicado' = 'seria bloqueado (modo observar) #' || v_ia.id,
    format('certo %s→%s ia=%s aplicado=%s', v_certo.expira_em, v_certo2.expira_em, v_ia.id, r->>'aplicado'));

  perform pg_temp.como('a0000000-0000-4000-8000-0000000000a1', 'sentinela.teste.admin@lube.com.br');
  m := public.sentinela_acao('bloquear', '{"valor":"91.0.0.1","duracao":"permanente","motivo":"atacante conhecido"}');
  perform pg_temp.postgres();
  select * into v_man from sentinela.bloqueios where id = (m->>'id')::bigint;
  perform pg_temp.ok('T26 bloqueio manual não se funde no automático (origem, motivo e autor do admin)',
    (m->>'novo')::boolean and v_man.id not in (v_certo.id, v_ia.id) and v_man.origem = 'manual'
    and v_man.motivo = 'atacante conhecido' and v_man.criado_por = 'sentinela.teste.admin@lube.com.br'
    and v_man.expira_em is null
    and (select expira_em from sentinela.bloqueios where id = v_certo.id) = v_certo.expira_em, m::text);

  perform pg_temp.como('a0000000-0000-4000-8000-0000000000a1', 'sentinela.teste.admin@lube.com.br');
  c := public.sentinela_acao('confiar', '{"valor":"91.0.0.0/24","descricao":"rede de teste"}');
  perform pg_temp.postgres();
  perform pg_temp.ok('T26 confiar revoga os automáticos e mantém o manual permanente',
    (c->>'bloqueios_revogados')::int = 2
    and (select revogado_em is null from sentinela.bloqueios where id = v_man.id)
    and (select revogado_em is not null from sentinela.bloqueios where id = v_certo.id)
    and (select revogado_em is not null from sentinela.bloqueios where id = v_ia.id), c::text);
exception when others then
  perform pg_temp.postgres();
  perform pg_temp.ok('T26 (erro inesperado)', false, sqlstate || ': ' || sqlerrm);
end $$;

-- ---------------------------------------------------------
-- T27 IPv6: regras automáticas contam e bloqueiam o /64
-- ---------------------------------------------------------
do $$
declare
  r jsonb;
  t jsonb;
  n int;
begin
  r := pg_temp.reg(jsonb_build_array(
         pg_temp.ev('2001:db8:aa:1::10', '{"caminho":"/.env","tipo":"arquivo","decisao":"bloqueado","regra":"varredura"}'),
         pg_temp.ev('2001:db8:aa:1::20', '{"caminho":"/.git/config","tipo":"arquivo","decisao":"bloqueado","regra":"varredura"}')));
  perform pg_temp.ok('T27 IPv6: ataques de endereços do mesmo /64 viram um bloqueio só, do /64',
    jsonb_array_length(r->'bloqueios_novos') = 1 and r->'bloqueios_novos'->0->>'v' = '2001:db8:aa:1::/64'
    and (select count(*) from sentinela.bloqueios where rede <<= '2001:db8:aa:1::/64'::cidr) = 1
    and (select tipo from sentinela.bloqueios where valor = '2001:db8:aa:1::/64') = 'cidr', r::text);
  perform pg_temp.ok('T27 IPv6: o /64 vai para a lista como cidr e cobre outro endereço dele',
    exists (select 1 from jsonb_array_elements(public.sentinela_srv_lista('painel-compras')->'bloqueios') x
             where x->>'t' = 'cidr' and x->>'v' = '2001:db8:aa:1::/64')
    and (sentinela.bloqueio_do_ip('2001:db8:aa:1::99')).valor = '2001:db8:aa:1::/64');

  for n in 1..5 loop
    t := public.sentinela_srv_tentativa('2001:db8:aa:2::' || n, 'fulano', 'Mozilla');
  end loop;
  perform pg_temp.ok('T27 IPv6: força bruta trocando de endereço no /64 bloqueia o /64',
    (t->>'bloqueado')::boolean
    and exists (select 1 from sentinela.bloqueios where valor = '2001:db8:aa:2::/64' and regra = 'forca_bruta'), t::text);

  r := pg_temp.reg((select jsonb_agg(pg_temp.ev('2001:db8:aa:4::' || to_hex(g))) from generate_series(1, 35) g));
  perform pg_temp.ok('T27 IPv6: teto de gravação conta o /64', (r->>'gravados')::int = 30 and (r->>'descartados')::int = 5, r::text);

  insert into sentinela.confiaveis (tipo, valor, rede, descricao, origem, criado_por)
  values ('ip', '2001:db8:aa:3::5', '2001:db8:aa:3::5/128', 'máquina confiável (teste v6)', 'manual', 'teste');
  r := pg_temp.reg(jsonb_build_array(pg_temp.ev('2001:db8:aa:3::6',
         '{"caminho":"/.env","tipo":"arquivo","decisao":"bloqueado","regra":"varredura"}')));
  perform pg_temp.ok('T27 IPv6: /64 com IP confiável dentro bloqueia só o endereço atacante',
    r->'bloqueios_novos'->0->>'v' = '2001:db8:aa:3::6' and r->'bloqueios_novos'->0->>'n' = 'certo'
    and not exists (select 1 from sentinela.bloqueios b where b.rede >>= '2001:db8:aa:3::5'::inet), r::text);

  r := pg_temp.reg(jsonb_build_array(
         pg_temp.ev('2001:db8:aa:5::1', '{"pais":"US","ua":"curl/8","tipo":"api","decisao":"observado","regra":"robo"}'),
         pg_temp.ev('2001:db8:aa:5::2', '{"pais":"US","ua":"curl/8","tipo":"api","decisao":"observado","regra":"robo"}')));
  perform pg_temp.ok('T27 IPv6: no máximo um pedido de IA por /64', jsonb_array_length(r->'analisar') = 1, r::text);
exception when others then
  perform pg_temp.ok('T27 (erro inesperado)', false, sqlstate || ': ' || sqlerrm);
end $$;

-- ---------------------------------------------------------
-- T28 selo: "|" só no user-agent; deslocar texto entre campos é detectado
-- ---------------------------------------------------------
do $$
declare
  e sentinela.eventos;
  v0 jsonb;
  v jsonb;
  v_selo2 text;
begin
  perform pg_temp.reg(jsonb_build_array(pg_temp.ev('92.0.0.1',
    '{"caminho":"/a|b","identidade":"x|y@lube.com.br","identidade_origem":"passe","ua":"joao@lube.com.br|Mozilla/5.0"}')));
  select * into e from sentinela.eventos where ip = '92.0.0.1';
  perform pg_temp.ok('T28 "|" fora do user-agent não entra no registro (caminho vira %7C, identidade com | cai)',
    e.caminho = '/a%7Cb' and e.identidade is null and e.ua = 'joao@lube.com.br|Mozilla/5.0',
    format('caminho=%s identidade=%s', e.caminho, e.identidade));
  begin
    insert into sentinela.eventos (projeto, ip, decisao, caminho, selo) values ('painel-compras', '92.0.0.2', 'liberado', '/x|y', 'x');
    perform pg_temp.ok('T28 tabela recusa "|" nos campos do selo antes do ua', false, 'gravou');
  exception when check_violation then
    perform pg_temp.ok('T28 tabela recusa "|" nos campos do selo antes do ua', true);
  end;

  perform pg_temp.como('a0000000-0000-4000-8000-0000000000a1', 'sentinela.teste.admin@lube.com.br');
  v0 := public.sentinela_verificar_cadeia(5000);
  perform pg_temp.postgres();
  begin
    -- dono do banco tira a trava e "atribui" o acesso anônimo ao joao, sem mudar o canon
    alter table sentinela.eventos drop constraint eventos_canon_sem_separador;
    alter table sentinela.eventos disable trigger eventos_sem_update;
    update sentinela.eventos set regra = '|', identidade = 'joao@lube.com.br', ua = 'Mozilla/5.0' where id = e.id;
    alter table sentinela.eventos enable trigger eventos_sem_update;
    v_selo2 := (select sentinela.selo(x) from sentinela.eventos x where x.id = e.id);
    perform pg_temp.como('a0000000-0000-4000-8000-0000000000a1', 'sentinela.teste.admin@lube.com.br');
    v := public.sentinela_verificar_cadeia(5000);
    perform pg_temp.postgres();
    raise exception 'desfazer' using errcode = 'P0001';
  exception when raise_exception then
    null;
  end;
  perform pg_temp.postgres();
  perform pg_temp.ok('T28 deslocar texto entre campos mantém o selo, mas a verificação acusa o registro',
    (v0->>'ok')::boolean and v_selo2 = e.selo and not (v->>'ok')::boolean and (v->>'quebra_id')::bigint = e.id
    and v->>'detalhe' like 'campo com "|"%', format('antes=%s depois=%s', v0->>'ok', v));
  perform pg_temp.ok('T28 trava e conteúdo voltaram (desfeito)',
    exists (select 1 from pg_constraint where conname = 'eventos_canon_sem_separador')
    and (select identidade is null from sentinela.eventos where id = e.id));
exception when others then
  perform pg_temp.postgres();
  perform pg_temp.ok('T28 (erro inesperado)', false, sqlstate || ': ' || sqlerrm);
end $$;

-- ---------------------------------------------------------
-- T29 validador de regex (subconjunto comum PostgreSQL/JavaScript, sem aninhar quantificador)
-- ---------------------------------------------------------
do $$
declare
  v_aceitas text[] := array['^/db/', '\.(xlsx?|csv|sql|ps1)$', '^/(?<ano>\d{4})\.csv$', '(?:a|b)+x', '^/x(?=y)', '^/a(?!b)',
                            '\\d', '(\.\w)?$', '^/PLANILHAS REFERENCIAS/', '[a-z]+\.bak$', '(?<=/)x'];
  v_recusadas text[] := array['(?i)\.sql$', '***:x', '[[:alpha:]]', '[^]x', '\Aabc', '\yfoo', '(a+)+', '(a*)*b',
                              '((a+)b)+', '(a?){5}', 'x{,3}', '\k<n>', '(?#c)x', '(?:a+)+'];
  v_erro text := '';
  t text;
  r jsonb;
begin
  foreach t in array v_aceitas loop
    if sentinela.regex_problema(t) is not null then v_erro := v_erro || ' aceita? ' || t || ' → ' || sentinela.regex_problema(t); end if;
  end loop;
  foreach t in array v_recusadas loop
    if sentinela.regex_problema(t) is null then v_erro := v_erro || ' recusada? ' || t; end if;
  end loop;
  perform pg_temp.ok('T29 validador aceita o que é igual nos dois motores e recusa o resto',
    v_erro = '', v_erro);
  perform pg_temp.como('a0000000-0000-4000-8000-0000000000a1', 'sentinela.teste.admin@lube.com.br');
  r := public.sentinela_acao('sistema', '{"projeto":"painel-icms","arquivos_proibidos":["^/(?<ano>\\d{4})\\.csv$"]}');
  perform pg_temp.postgres();
  perform pg_temp.ok('T29 grupo nomeado do JavaScript é aceito pelo painel',
    (select arquivos_proibidos = array['^/(?<ano>\d{4})\.csv$'] from sentinela.sistemas where projeto = 'painel-icms'), r::text);
exception when others then
  perform pg_temp.postgres();
  perform pg_temp.ok('T29 (erro inesperado)', false, sqlstate || ': ' || sqlerrm);
end $$;

-- ---------------------------------------------------------
-- T30 "desconfiar" não é desfeito pelo próximo login
-- ---------------------------------------------------------
do $$
declare
  v_id bigint;
begin
  perform public.sentinela_srv_identidade('99.91.0.1', 'a0000000-0000-4000-8000-0000000000a2',
                                          'sentinela.teste.comum@lube.com.br', 'portal', 'Mozilla');
  select id into v_id from sentinela.confiaveis where rede = '99.91.0.1/32' and removido_em is null;
  perform pg_temp.como('a0000000-0000-4000-8000-0000000000a1', 'sentinela.teste.admin@lube.com.br');
  perform public.sentinela_acao('desconfiar', jsonb_build_object('id', v_id));
  perform pg_temp.postgres();
  perform public.sentinela_srv_identidade('99.91.0.1', 'a0000000-0000-4000-8000-0000000000a2',
                                          'sentinela.teste.comum@lube.com.br', 'portal', 'Mozilla');
  perform pg_temp.ok('T30 IP tirado dos confiáveis pelo TI não volta no login seguinte',
    v_id is not null
    and not exists (select 1 from sentinela.confiaveis where rede = '99.91.0.1/32' and removido_em is null)
    and (select count(*) from sentinela.identidades where ip = '99.91.0.1') = 2,
    format('id=%s', v_id));
exception when others then
  perform pg_temp.postgres();
  perform pg_temp.ok('T30 (erro inesperado)', false, sqlstate || ': ' || sqlerrm);
end $$;

-- ---------------------------------------------------------
-- T31 login: confiável sem bloqueio automático; não aprende de IP atacante nem de Tor
-- ---------------------------------------------------------
do $$
declare
  v jsonb;
  vis jsonb;
begin
  perform public.sentinela_srv_registrar_analise('93.0.0.4',
    '{"veredito":"malicioso","confianca":0.95,"motivo":"robô","acao":"bloquear_7d"}');
  perform public.sentinela_srv_identidade('93.0.0.4', 'a0000000-0000-4000-8000-0000000000a2',
                                          'sentinela.teste.comum@lube.com.br', 'portal', 'Mozilla');
  perform pg_temp.ok('T31 login vira confiável e revoga o bloqueio automático (suspeito) do IP',
    exists (select 1 from sentinela.confiaveis where rede = '93.0.0.4/32' and removido_em is null)
    and not exists (select 1 from sentinela.bloqueios where valor = '93.0.0.4' and revogado_em is null)
    and (select revogado_por from sentinela.bloqueios where valor = '93.0.0.4') = 'login de sentinela.teste.comum@lube.com.br');

  perform pg_temp.reg(jsonb_build_array(pg_temp.ev('93.0.0.5',
    '{"caminho":"/.env","tipo":"arquivo","decisao":"bloqueado","regra":"varredura"}')));
  perform public.sentinela_srv_identidade('93.0.0.5', 'a0000000-0000-4000-8000-0000000000a2',
                                          'sentinela.teste.comum@lube.com.br', 'portal', 'Mozilla');
  perform pg_temp.ok('T31 IP com bloqueio certo ativo não vira confiável pelo login (bloqueio fica)',
    not exists (select 1 from sentinela.confiaveis where rede = '93.0.0.5/32')
    and exists (select 1 from sentinela.bloqueios where valor = '93.0.0.5' and nivel = 'certo' and revogado_em is null));

  perform public.sentinela_srv_identidade('45.50.0.2', 'a0000000-0000-4000-8000-0000000000a2',
                                          'sentinela.teste.comum@lube.com.br', 'portal', 'Mozilla');
  perform pg_temp.ok('T31 saída Tor não vira confiável pelo login',
    not exists (select 1 from sentinela.confiaveis where rede = '45.50.0.2/32')
    and exists (select 1 from sentinela.identidades where ip = '45.50.0.2'));

  -- painel: confiável com bloqueio suspeito (estado que as regras evitam) não aparece bloqueado
  insert into sentinela.confiaveis (tipo, valor, rede, descricao, origem, criado_por)
  values ('ip', '93.0.0.6', '93.0.0.6/32', 'teste', 'manual', 'teste');
  insert into sentinela.bloqueios (tipo, valor, rede, nivel, origem, regra, motivo, expira_em)
  values ('ip', '93.0.0.6', '93.0.0.6/32', 'suspeito', 'regra', 'robo', 'teste', now() + interval '1 hour');
  perform pg_temp.reg(jsonb_build_array(pg_temp.ev('93.0.0.6')));
  update sentinela.config set modo = 'proteger';
  delete from sentinela.cache_kpis;
  perform pg_temp.como('a0000000-0000-4000-8000-0000000000a1', 'sentinela.teste.admin@lube.com.br');
  v := public.sentinela_painel(24);
  perform pg_temp.postgres();
  update sentinela.config set modo = 'observar';
  select x into vis from jsonb_array_elements(v->'visitantes') x where x->>'ip' = '93.0.0.6';
  perform pg_temp.ok('T31 painel: confiável não aparece bloqueado por bloqueio suspeito (o guarda ignora)',
    (vis->>'confiavel')::boolean and vis->>'status' = 'seguro', vis::text);
exception when others then
  perform pg_temp.postgres();
  perform pg_temp.ok('T31 (erro inesperado)', false, sqlstate || ': ' || sqlerrm);
end $$;

-- ---------------------------------------------------------
-- T32 cota da IA desconta os pedidos ainda sem resposta
-- ---------------------------------------------------------
do $$
declare
  r1 jsonb;
  r2 jsonb;
  v_usadas int;
  v_pend int;
  v_cota int;
begin
  select count(*) into v_usadas from sentinela.analises where criado_em > now() - interval '1 hour';
  select count(*) into v_pend from sentinela.ips
   where analise_pedida_em > now() - interval '10 minutes'
     and (ultima_analise_em is null or ultima_analise_em < analise_pedida_em);
  update sentinela.config set ia_limite_hora = v_usadas + v_pend + 2;
  r1 := pg_temp.reg(jsonb_build_array(pg_temp.ev('94.0.0.1', '{"pais":"US"}'), pg_temp.ev('94.0.0.2', '{"pais":"US"}'),
                                      pg_temp.ev('94.0.0.3', '{"pais":"US"}')));
  r2 := pg_temp.reg(jsonb_build_array(pg_temp.ev('94.0.0.11', '{"pais":"US"}'), pg_temp.ev('94.0.0.12', '{"pais":"US"}'),
                                      pg_temp.ev('94.0.0.13', '{"pais":"US"}')));
  v_cota := public.sentinela_srv_ia_cota();
  update sentinela.config set ia_limite_hora = 30;
  perform pg_temp.ok('T32 cota da hora conta os pedidos pendentes: lotes seguidos não passam dela',
    jsonb_array_length(r1->'analisar') = 2 and r2->'analisar' = '[]'::jsonb,
    format('r1=%s r2=%s', r1->'analisar', r2->'analisar'));
  perform pg_temp.ok('T32 srv_ia_cota (trava da Central) ainda deixa analisar os IPs entregues',
    v_cota = v_pend + 2, format('cota=%s pendentes antes=%s', v_cota, v_pend));
exception when others then
  perform pg_temp.ok('T32 (erro inesperado)', false, sqlstate || ': ' || sqlerrm);
end $$;

-- ---------------------------------------------------------
-- T33 rajada: janela deslizante (a virada da janela não zera a conta)
-- ---------------------------------------------------------
do $$
declare
  r jsonb;
  r2 jsonb;
begin
  update sentinela.config set limite_rajada_min = 10;
  perform pg_temp.reg(pg_temp.lote(pg_temp.ev('95.0.0.1'), 10));
  update sentinela.ips set janela_inicio = now() - interval '61 seconds' where ip = '95.0.0.1';   -- 61 s depois
  r := pg_temp.reg(pg_temp.lote(pg_temp.ev('95.0.0.1'), 10));
  perform pg_temp.reg(pg_temp.lote(pg_temp.ev('95.0.0.2'), 10));
  update sentinela.ips set janela_inicio = now() - interval '130 seconds' where ip = '95.0.0.2';  -- 130 s depois
  r2 := pg_temp.reg(pg_temp.lote(pg_temp.ev('95.0.0.2'), 10));
  update sentinela.config set limite_rajada_min = 200;
  perform pg_temp.ok('T33 rajada que atravessa a virada da janela é pega (≈20 em 60 s, limite 10)',
    jsonb_array_length(r->'bloqueios_novos') = 1 and r->'bloqueios_novos'->0->>'regra' = 'rajada', r::text);
  perform pg_temp.ok('T33 janela anterior vencida há mais de 60 s não conta', r2->'bloqueios_novos' = '[]'::jsonb, r2::text);
exception when others then
  perform pg_temp.ok('T33 (erro inesperado)', false, sqlstate || ': ' || sqlerrm);
end $$;

-- ---------------------------------------------------------
-- T34 painel: ataque de confiável aparece observado; KPIs = soma do gráfico; cache dos KPIs
-- ---------------------------------------------------------
do $$
declare
  v jsonb;
  n jsonb;
  n1 jsonb;
  n2 jsonb;
  n3 jsonb;
  vis jsonb;
  v_soma int;
begin
  delete from sentinela.cache_kpis;
  begin
    -- evento na fração de hora mais antiga (entre now()-24 h e o primeiro balde); desfeito logo depois
    alter table sentinela.eventos disable trigger eventos_selar;
    insert into sentinela.eventos (criado_em, projeto, ip, decisao, selo)
    values (date_trunc('hour', now(), 'UTC') - interval '23 hours' - interval '1 second', 'painel-compras', '96.0.0.1', 'liberado', 'x');
    alter table sentinela.eventos enable trigger eventos_selar;
    perform pg_temp.como('a0000000-0000-4000-8000-0000000000a1', 'sentinela.teste.admin@lube.com.br');
    v := public.sentinela_painel(24);
    n := public.sentinela_novos(null);
    perform pg_temp.postgres();
    raise exception 'desfazer' using errcode = 'P0001';
  exception when raise_exception then
    null;
  end;
  perform pg_temp.postgres();
  select sum((x->>'liberado')::int + (x->>'observado')::int + (x->>'bloqueado')::int) into v_soma
    from jsonb_array_elements(v->'por_hora') x;
  perform pg_temp.ok('T34 KPIs da janela = soma do gráfico por hora',
    (v->'kpis'->>'acessos')::int = v_soma
    and v_soma = (select count(*) from sentinela.eventos where criado_em >= sentinela.janela_ini(24)),
    format('kpis=%s soma=%s', v->'kpis'->>'acessos', v_soma));
  perform pg_temp.ok('T34 "novos" usa a mesma janela e os mesmos KPIs do painel', n->'kpis' = v->'kpis', (n->'kpis')::text);
  select x into vis from jsonb_array_elements(v->'visitantes') x where x->>'ip' = '10.20.30.5';
  perform pg_temp.ok('T34 ataque vindo de rede confiável aparece observado, não seguro',
    (vis->>'confiavel')::boolean and vis->>'status' = 'observado' and vis->>'status_motivo' = 'varredura'
    and (vis->>'risco')::int = 100, vis::text);

  delete from sentinela.cache_kpis;
  perform pg_temp.como('a0000000-0000-4000-8000-0000000000a1', 'sentinela.teste.admin@lube.com.br');
  n1 := public.sentinela_novos(null);
  perform pg_temp.postgres();
  perform pg_temp.reg(jsonb_build_array(pg_temp.ev('96.0.0.2')));
  perform pg_temp.como('a0000000-0000-4000-8000-0000000000a1', 'sentinela.teste.admin@lube.com.br');
  n2 := public.sentinela_novos(null);
  perform pg_temp.postgres();
  delete from sentinela.cache_kpis;
  perform pg_temp.como('a0000000-0000-4000-8000-0000000000a1', 'sentinela.teste.admin@lube.com.br');
  n3 := public.sentinela_novos(null);
  perform pg_temp.postgres();
  perform pg_temp.ok('T34 KPIs do "novos" vêm do cache de 10 s e são recalculados quando ele vence',
    n2->'kpis' = n1->'kpis' and (n3->'kpis'->>'acessos')::int = (n1->'kpis'->>'acessos')::int + 1
    and exists (select 1 from sentinela.cache_kpis where ini = sentinela.janela_ini(24)),
    format('%s / %s / %s', n1->'kpis'->>'acessos', n2->'kpis'->>'acessos', n3->'kpis'->>'acessos'));
exception when others then
  perform pg_temp.postgres();
  perform pg_temp.ok('T34 (erro inesperado)', false, sqlstate || ': ' || sqlerrm);
end $$;

-- ---------------------------------------------------------
-- T35 caminho de ataque pedido por outro site (cross-site) não bloqueia o IP
-- ---------------------------------------------------------
do $$
declare
  r jsonb;
  r2 jsonb;
begin
  r := pg_temp.reg(jsonb_build_array(pg_temp.ev('97.0.0.1',
         '{"caminho":"/.env","tipo":"arquivo","decisao":"bloqueado","regra":"varredura","sec_fetch_site":"cross-site"}')));
  r2 := pg_temp.reg(jsonb_build_array(pg_temp.ev('97.0.0.2',
         '{"ua":"sqlmap/1.7","tipo":"api","decisao":"bloqueado","regra":"ferramenta","sec_fetch_site":"cross-site"}')));
  perform pg_temp.ok('T35 varredura cross-site: registra, mas não bloqueia o IP (terceiro não bloqueia a vítima)',
    (r->>'gravados')::int = 1 and r->'bloqueios_novos' = '[]'::jsonb
    and not exists (select 1 from sentinela.bloqueios where valor = '97.0.0.1')
    and (select risco from sentinela.eventos where ip = '97.0.0.1') >= 90, r::text);
  perform pg_temp.ok('T35 ferramenta de ataque bloqueia mesmo cross-site',
    jsonb_array_length(r2->'bloqueios_novos') = 1 and r2->'bloqueios_novos'->0->>'n' = 'certo', r2::text);
exception when others then
  perform pg_temp.ok('T35 (erro inesperado)', false, sqlstate || ': ' || sqlerrm);
end $$;

-- ---------------------------------------------------------
-- T37 pendências A–E (2026-10-06)
--  A srv_identidade de perfil inativo não grava nada (nem identidades, nem ips)
--  B varredura/injeção cross-site: grava com motivo de requisição forjada, sem bloqueio de IP
--  C sentinela_acao('sistema') recusa rota pública vazia, "/", "/*", "*" e sem "/x"
--  D srv_lista devolve sistema.projeto_id
--  E srv_permissao devolve guarda_ativo (sistemas.ultimo_sinal preenchido)
-- ---------------------------------------------------------
do $$
declare
  t jsonb;
  r jsonb;
  l jsonb;
  p jsonb;
  antes jsonb;
  depois jsonb;
  n_ident bigint;
  v_rotas text[];
  v_casos text[] := array['[""]', '["   "]', '["/"]', '["/*"]', '["*"]', '["abc"]', '["/ok","*"]', '["/ok",""]', '["/ok","x/"]'];
  v_caso text;
  m text;
  s record;
begin
  -- A: IP já visto (perfil em sentinela.ips) + conta inativa → nada muda
  perform pg_temp.reg(jsonb_build_array(pg_temp.ev('100.71.0.1')));
  select to_jsonb(i) into antes from sentinela.ips i where i.ip = '100.71.0.1';
  select count(*) into n_ident from sentinela.identidades;
  t := public.sentinela_srv_identidade('100.71.0.1', 'a0000000-0000-4000-8000-0000000000a4',
                                       'sentinela.teste.inativo@lube.com.br', 'passe', 'Mozilla');
  select to_jsonb(i) into depois from sentinela.ips i where i.ip = '100.71.0.1';
  perform pg_temp.ok('T37A inativo: ok:false perfil_inativo e sentinela.ips intacto (nem identidade, nem ultimo_visto)',
    t = '{"ok":false,"motivo":"perfil_inativo"}'::jsonb and antes = depois
    and (select count(*) from sentinela.identidades) = n_ident
    and not exists (select 1 from sentinela.confiaveis where rede >>= '100.71.0.1'::inet), format('%s %s %s', t, antes, depois));
  -- IP nunca visto + user_id nulo → não cria linha em ips
  t := public.sentinela_srv_identidade('100.71.0.2', null, 'alguem@lube.com.br', 'portal', null);
  perform pg_temp.ok('T37A user_id nulo: ok:false e nenhuma linha nova em sentinela.ips',
    t = '{"ok":false,"motivo":"perfil_inativo"}'::jsonb
    and not exists (select 1 from sentinela.ips where ip = '100.71.0.2')
    and (select count(*) from sentinela.identidades) = n_ident, t::text);
  -- conta desativada depois de ativa: passa a ser recusada; reativada volta a gravar
  update public.profiles set ativo = false where id = 'a0000000-0000-4000-8000-0000000000a2';
  t := public.sentinela_srv_identidade('100.71.0.3', 'a0000000-0000-4000-8000-0000000000a2',
                                       'sentinela.teste.comum@lube.com.br', 'portal', 'Mozilla');
  update public.profiles set ativo = true where id = 'a0000000-0000-4000-8000-0000000000a2';
  r := public.sentinela_srv_identidade('100.71.0.3', 'a0000000-0000-4000-8000-0000000000a2',
                                       'sentinela.teste.comum@lube.com.br', 'portal', 'Mozilla');
  perform pg_temp.ok('T37A conta desativada é recusada; reativada grava de novo',
    t = '{"ok":false,"motivo":"perfil_inativo"}'::jsonb and r = '{"ok":true}'::jsonb
    and (select count(*) from sentinela.identidades where ip = '100.71.0.3') = 1, format('%s %s', t, r));

  -- B: varredura/injeção cross-site
  r := pg_temp.reg(jsonb_build_array(
         pg_temp.ev('100.71.1.1', '{"caminho":"/.env","tipo":"arquivo","decisao":"bloqueado","regra":"varredura","motivo":"varredura de caminhos: /.env","sec_fetch_site":"cross-site","sec_fetch_mode":"no-cors","sec_fetch_dest":"image"}'),
         pg_temp.ev('100.71.1.1', '{"caminho":"/.git/config","tipo":"arquivo","decisao":"bloqueado","regra":"varredura","sec_fetch_site":"cross-site"}'),
         pg_temp.ev('100.71.1.1', '{"caminho":"/wp-login.php","decisao":"bloqueado","regra":"varredura","sec_fetch_site":"cross-site"}'),
         pg_temp.ev('100.71.1.2', '{"caminho":"/","consulta":"?id=1%20UNION%20SELECT","decisao":"bloqueado","regra":"injecao","motivo":"tentativa de injeção: union select","sec_fetch_site":"cross-site"}'),
         pg_temp.ev('100.71.1.3', '{"caminho":"/.env","tipo":"arquivo","decisao":"bloqueado","regra":"varredura","motivo":"varredura · possível requisição forjada por outro site (cross-site): sem bloqueio de IP","sec_fetch_site":"cross-site"}'),
         pg_temp.ev('2001:db8:3737::1', '{"caminho":"/.env","tipo":"arquivo","decisao":"bloqueado","regra":"varredura","sec_fetch_site":"cross-site"}')));
  perform pg_temp.ok('T37B cross-site: 6 eventos gravados e nenhum bloqueio de IP (nem /64)',
    (r->>'gravados')::int = 6 and r->'bloqueios_novos' = '[]'::jsonb
    and not exists (select 1 from sentinela.bloqueios b
                     where b.rede && '100.71.1.0/24'::cidr or b.rede && '2001:db8:3737::/48'::cidr), r::text);
  perform pg_temp.ok('T37B cross-site: motivo diz "possível requisição forjada por outro site" (e mantém o do guarda)',
    (select bool_and(e.motivo like '%possível requisição forjada por outro site%') from sentinela.eventos e
      where e.ip in ('100.71.1.1','100.71.1.2','100.71.1.3','2001:db8:3737::1'))
    and exists (select 1 from sentinela.eventos e where e.ip = '100.71.1.1' and e.motivo like 'varredura de caminhos: /.env · possível%')
    and exists (select 1 from sentinela.eventos e where e.ip = '100.71.1.2' and e.motivo like 'tentativa de injeção: union select · possível%'),
    (select string_agg(host(e.ip) || '=' || coalesce(e.motivo, '∅'), ' | ') from sentinela.eventos e where e.ip <<= '100.71.1.0/24'));
  perform pg_temp.ok('T37B cross-site: marcação não se repete quando o guarda já mandou',
    (select (length(e.motivo) - length(replace(e.motivo, 'forjada por outro site', ''))) / length('forjada por outro site')
       from sentinela.eventos e where e.ip = '100.71.1.3') = 1,
    (select motivo from sentinela.eventos where ip = '100.71.1.3'));
  -- controle: a mesma varredura sem cross-site bloqueia; ferramenta cross-site bloqueia
  r := pg_temp.reg(jsonb_build_array(
         pg_temp.ev('100.71.1.4', '{"caminho":"/.env","tipo":"arquivo","decisao":"bloqueado","regra":"varredura","sec_fetch_site":"same-origin"}'),
         pg_temp.ev('100.71.1.5', '{"caminho":"/.env","tipo":"arquivo","decisao":"bloqueado","regra":"varredura","sec_fetch_site":null}'),
         pg_temp.ev('100.71.1.6', '{"ua":"Nikto/2.5","tipo":"api","decisao":"bloqueado","regra":"ferramenta","sec_fetch_site":"cross-site"}')));
  perform pg_temp.ok('T37B controle: same-origin, sem sec-fetch e ferramenta cross-site continuam bloqueando',
    jsonb_array_length(r->'bloqueios_novos') = 3
    and (select count(*) from sentinela.bloqueios b where b.valor in ('100.71.1.4','100.71.1.5','100.71.1.6') and b.nivel = 'certo') = 3
    and not exists (select 1 from sentinela.eventos e where e.ip in ('100.71.1.4','100.71.1.5','100.71.1.6')
                     and e.motivo like '%forjada%'), r::text);

  -- D: projeto_id no sistema da lista, para os 8 projetos
  for s in select * from sentinela.sistemas loop
    l := public.sentinela_srv_lista(s.projeto);
    if l->'sistema'->>'projeto_id' is distinct from s.projeto_id then
      m := coalesce(m, '') || s.projeto || ' ';
    end if;
  end loop;
  perform pg_temp.ok('T37D srv_lista: sistema.projeto_id = sentinela.sistemas.projeto_id nos 8 projetos',
    m is null and (select count(*) from sentinela.sistemas) = 8
    and public.sentinela_srv_lista('nao-existe')->'sistema' = 'null'::jsonb, m);

  -- E: guarda_ativo
  update sentinela.sistemas set ultimo_sinal = null where projeto = 'gestao-ti';
  p := public.sentinela_srv_permissao('a0000000-0000-4000-8000-0000000000a2', 'gestao-ti');
  perform pg_temp.ok('T37E sem sinal do guarda: permitido, guarda_ativo false (booleano)',
    (p->>'permitido')::boolean and p->'guarda_ativo' = 'false'::jsonb and p->>'url' = 'https://gestao-ti-ruddy.vercel.app', p::text);
  perform pg_temp.reg(jsonb_build_array(pg_temp.ev('100.71.2.1')), 'gestao-ti');
  p := public.sentinela_srv_permissao('a0000000-0000-4000-8000-0000000000a2', 'gestao-ti');
  perform pg_temp.ok('T37E depois do 1º evento do guarda: guarda_ativo true',
    (p->>'permitido')::boolean and p->'guarda_ativo' = 'true'::jsonb, p::text);
  p := public.sentinela_srv_permissao('a0000000-0000-4000-8000-0000000000a2', 'nao-existe');
  perform pg_temp.ok('T37E sistema desconhecido: guarda_ativo false (nunca nulo)',
    not (p->>'permitido')::boolean and p->'guarda_ativo' = 'false'::jsonb, p::text);

  -- C: rotas públicas (como admin)
  perform pg_temp.como('a0000000-0000-4000-8000-0000000000a1', 'sentinela.teste.admin@lube.com.br');
  perform public.sentinela_acao('sistema', '{"projeto":"rh-absentismo","rotas_publicas":["/publico"]}');
  m := null;
  foreach v_caso in array v_casos loop
    begin
      perform public.sentinela_acao('sistema', jsonb_build_object('projeto', 'rh-absentismo', 'rotas_publicas', v_caso::jsonb));
      m := coalesce(m, '') || v_caso || ' aceito; ';
    exception when others then
      if sqlstate <> '22023' then
        m := coalesce(m, '') || v_caso || ' ' || sqlstate || '; ';
      end if;
    end;
  end loop;
  perform pg_temp.postgres();
  select s2.rotas_publicas into v_rotas from sentinela.sistemas s2 where s2.projeto = 'rh-absentismo';
  perform pg_temp.ok('T37C rota vazia, "/", "/*", "*", sem barra ou "/" sozinha: 22023 e nada muda (9 casos)',
    m is null and v_rotas = array['/publico'], coalesce(m, '') || ' rotas=' || v_rotas::text);
  perform pg_temp.como('a0000000-0000-4000-8000-0000000000a1', 'sentinela.teste.admin@lube.com.br');
  r := public.sentinela_acao('sistema', '{"projeto":"rh-absentismo","rotas_publicas":["/acompanhar"," /_next/* ","/a"]}');
  perform pg_temp.postgres();
  select s2.rotas_publicas into v_rotas from sentinela.sistemas s2 where s2.projeto = 'rh-absentismo';
  perform pg_temp.ok('T37C rotas válidas gravam (com espaços aparados)',
    (r->>'ok')::boolean and v_rotas = array['/acompanhar','/_next/*','/a'], v_rotas::text);
  perform pg_temp.como('a0000000-0000-4000-8000-0000000000a1', 'sentinela.teste.admin@lube.com.br');
  r := public.sentinela_acao('sistema', '{"projeto":"rh-absentismo","rotas_publicas":[]}');
  perform pg_temp.postgres();
  select s2.rotas_publicas into v_rotas from sentinela.sistemas s2 where s2.projeto = 'rh-absentismo';
  perform pg_temp.ok('T37C lista vazia [] continua valendo (nenhuma rota pública)',
    (r->>'ok')::boolean and v_rotas = '{}'::text[], v_rotas::text);
  perform pg_temp.postgres();
exception when others then
  perform pg_temp.postgres();
  perform pg_temp.ok('T37 (erro inesperado)', false, sqlstate || ': ' || sqlerrm);
end $$;

-- ---------------------------------------------------------
-- T36 cadeia íntegra no fim de tudo
-- ---------------------------------------------------------
do $$
declare
  v jsonb;
begin
  perform pg_temp.como('a0000000-0000-4000-8000-0000000000a1', 'sentinela.teste.admin@lube.com.br');
  v := public.sentinela_verificar_cadeia(5000);
  perform pg_temp.postgres();
  perform pg_temp.ok('T36 cadeia íntegra depois de todos os testes', (v->>'ok')::boolean, v::text);
exception when others then
  perform pg_temp.postgres();
  perform pg_temp.ok('T36 (erro inesperado)', false, sqlstate || ': ' || sqlerrm);
end $$;

-- ---------------------------------------------------------
-- Placar
-- ---------------------------------------------------------
select count(*) filter (where ok)     as passaram,
       count(*) filter (where not ok) as falharam,
       jsonb_agg(jsonb_build_object('teste', teste, 'ok', ok, 'detalhe', left(detalhe, 400)) order by em)
         filter (where not ok)        as falhas,
       jsonb_agg(teste order by em)  filter (where ok) as aprovados
  from pg_temp.sentinela_teste;

rollback;
