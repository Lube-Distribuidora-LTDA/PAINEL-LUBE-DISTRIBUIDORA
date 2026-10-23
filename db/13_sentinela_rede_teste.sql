-- =========================================================
-- SENTINELA LUBE — testes da regra de rede (db/13_sentinela_rede.sql)
-- Rode numa transação só, logo depois da migração e NA MESMA transação:
--   begin;
--   set local lock_timeout = '3s'; set local statement_timeout = '30s';
--   <conteúdo de db/13_sentinela_rede.sql>
--   <conteúdo deste arquivo>
-- Este arquivo já começa com begin; (dentro de uma transação aberta só gera aviso)
-- e TERMINA COM rollback;: nada fica gravado (usuários de teste, sistemas de teste,
-- redes, liberações, eventos e as próprias tabelas novas somem). Se sentinela.redes não
-- foi criada nesta mesma transação, o primeiro bloco aborta tudo antes de qualquer teste.
-- Os guardas estão no ar: rode em horário calmo e de uma vez (migração + teste no mesmo
-- envio). Os eventos de teste (que travam a cadeia de selos) ficam no fim, para a trava
-- durar o mínimo. O SELECT antes do rollback mostra o placar, as falhas e o md5 da
-- migração que rodou (entre os marcadores SENTINELA-13-INICIO e SENTINELA-13-FIM).
-- =========================================================

begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $$
begin
  if not exists (
       select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'sentinela' and c.relname = 'redes'
          and pg_xact_status((((pg_current_xact_id()::text::bigint >> 32) << 32) | c.xmin::text::bigint)::text::xid8)
              = 'in progress') then
    raise exception 'sentinela-rede-teste: rode junto com a migração 13, na MESMA transação (begin; 13; teste; rollback;) — nunca num banco com a regra de rede já aplicada'
      using errcode = '55000';
  end if;
end $$;

create temp table rede_teste (
  em      timestamptz not null default clock_timestamp(),
  teste   text not null,
  ok      boolean not null,
  detalhe text
);
create temp table rede_teste_aceitas (acao text not null);
create temp table rede_teste_ids (nome text primary key, id bigint);
create temp table rede_teste_inicio as select coalesce((select max(a.id) from sentinela.acoes_admin a), 0) as acao_id;

create function pg_temp.ok(p_teste text, p_ok boolean, p_detalhe text default null)
returns void language sql as $$
  insert into pg_temp.rede_teste (teste, ok, detalhe) values (p_teste, coalesce(p_ok, false), p_detalhe)
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

-- linha de catálogo criada ou mudada nesta transação
create function pg_temp.desta_tx(p xid)
returns boolean language sql as $$
  select coalesce(pg_xact_status((((pg_current_xact_id()::text::bigint >> 32) << 32) | p::text::bigint)::text::xid8)
                  = 'in progress', false)
$$;

create function pg_temp.uid(n int)
returns uuid language sql immutable as $$
  select ('b0000000-0000-4000-8000-0000000000b' || n)::uuid
$$;

create function pg_temp.mail(n int)
returns text language sql stable as $$
  select p.email from public.profiles p where p.id = pg_temp.uid(n)
$$;

-- ação do painel como o administrador de teste, do jeito que a tela manda: pela central
-- (sentinela_srv_rede_acao, como service_role), do IP do escritório de teste (203.0.113.7).
-- Recusa ({"ok":false}) vira exceção com o mesmo SQLSTATE; aceita → conta para o R12.
-- O caminho direto pelo banco (sentinela_rede_acao) e a trava de rede ficam no R16.
create function pg_temp.adm(p_acao text, p_dados jsonb, p_ip text default '203.0.113.7', p_uid uuid default null)
returns jsonb language plpgsql as $$
declare
  r jsonb;
begin
  perform pg_temp.como(null, null, 'service_role');
  r := public.sentinela_srv_rede_acao(coalesce(p_uid, pg_temp.uid(1)), p_ip, p_acao, p_dados);
  perform pg_temp.postgres();
  if r->>'ok' = 'false' then
    raise exception using errcode = coalesce(r->>'codigo', 'P0001'), message = coalesce(r->>'erro', r::text);
  end if;
  insert into pg_temp.rede_teste_aceitas (acao) values (p_acao);
  return r;
end $$;

-- a mesma ação direto pelo banco, como o PostgREST faz (authenticated, com o JWT do admin)
create function pg_temp.adm_direto(p_acao text, p_dados jsonb)
returns jsonb language plpgsql as $$
declare
  r jsonb;
begin
  perform pg_temp.como(pg_temp.uid(1), 'rede.teste.admin@lube.com.br');
  r := public.sentinela_rede_acao(p_acao, p_dados);
  perform pg_temp.postgres();
  return r;
end $$;

-- a mesma ação, esperando recusa: devolve "SQLSTATE mensagem" (ou "sem erro")
create function pg_temp.erro_adm(p_acao text, p_dados jsonb)
returns text language plpgsql as $$
begin
  perform pg_temp.adm(p_acao, p_dados);
  return 'sem erro';
exception when others then
  perform pg_temp.postgres();
  return sqlstate || ' ' || sqlerrm;
end $$;

-- SQL qualquer esperando recusa
create function pg_temp.erro(p_sql text)
returns text language plpgsql as $$
begin
  execute p_sql;
  return 'sem erro';
exception when others then
  perform pg_temp.postgres();
  return sqlstate || ' ' || sqlerrm;
end $$;

-- decisão da central para a pessoa n (e-mail do perfil, como a central manda)
create function pg_temp.dec(p_ip text, p_n int, p_projeto text, p_origem text default 'passe')
returns jsonb language sql as $$
  select public.sentinela_srv_rede_decidir(p_ip, pg_temp.uid(p_n), pg_temp.mail(p_n), p_projeto, p_origem, 'Mozilla/5.0 teste')
$$;

-- evento padrão do guarda; p_extra sobrescreve campos
create function pg_temp.ev(p_ip text, p_extra jsonb default '{}')
returns jsonb language sql as $$
  select jsonb_build_object(
    'ts', now(), 'metodo', 'GET', 'host', 'teste-rede-novo.vercel.app', 'caminho', '/', 'consulta', null,
    'tipo', 'pagina', 'ip', p_ip, 'pais', 'BR', 'regiao', 'ES', 'cidade', 'Cariacica', 'lat', -20.26, 'lon', -40.41,
    'fuso', 'America/Sao_Paulo', 'ua', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0', 'idioma', 'pt-BR,pt;q=0.9',
    'referer', null, 'ja4', null, 'vercel_id', 'gru1::teste', 'sec_fetch_site', 'none', 'sec_fetch_mode', 'navigate',
    'sec_fetch_dest', 'document', 'decisao', 'liberado', 'regra', null, 'motivo', null,
    'identidade', null, 'identidade_origem', null) || p_extra
$$;

-- ---------------------------------------------------------
-- Usuários e sistemas de teste (somem no rollback)
-- ---------------------------------------------------------
insert into auth.users (id, email) values
  ('b0000000-0000-4000-8000-0000000000b1', 'rede.teste.admin@lube.com.br'),
  ('b0000000-0000-4000-8000-0000000000b2', 'rede.teste.um@lube.com.br'),
  ('b0000000-0000-4000-8000-0000000000b3', 'rede.teste.dois@lube.com.br'),
  ('b0000000-0000-4000-8000-0000000000b4', 'rede.teste.tres@lube.com.br'),
  ('b0000000-0000-4000-8000-0000000000b5', 'rede.teste.quatro@lube.com.br'),
  ('b0000000-0000-4000-8000-0000000000b6', 'rede.teste.inativo@lube.com.br'),
  ('b0000000-0000-4000-8000-0000000000b7', 'rede.teste.joão@lube.com.br');

update public.profiles set nome = 'Rede Admin', is_admin = true, ativo = true, acesso_total = true
 where id = 'b0000000-0000-4000-8000-0000000000b1';
update public.profiles set nome = 'Rede Um', ativo = true     where id = 'b0000000-0000-4000-8000-0000000000b2';
update public.profiles set nome = 'Rede Dois', ativo = true   where id = 'b0000000-0000-4000-8000-0000000000b3';
update public.profiles set nome = 'Rede Três', ativo = true   where id = 'b0000000-0000-4000-8000-0000000000b4';
update public.profiles set nome = 'Rede Quatro', ativo = true where id = 'b0000000-0000-4000-8000-0000000000b5';
update public.profiles set nome = 'Rede Inativo', ativo = false where id = 'b0000000-0000-4000-8000-0000000000b6';
update public.profiles set nome = 'Rede João', ativo = true   where id = 'b0000000-0000-4000-8000-0000000000b7';

insert into sentinela.sistemas (projeto_id, projeto, nome, url, sistema_slug, exige_login, guarda_versao, ultimo_ambiente, ativo) values
  ('prj_teste_rede_novo',      'teste-rede-novo',      'Teste rede (guarda 1.3.0)', 'https://teste-rede-novo.vercel.app',      null, true,  'sentinela-guarda/1.3.0', 'production', true),
  ('prj_teste_rede_velho',     'teste-rede-velho',     'Teste rede (guarda 1.2.0)', 'https://teste-rede-velho.vercel.app',     null, true,  'sentinela-guarda/1.2.0', 'production', true),
  ('prj_teste_rede_semversao', 'teste-rede-semversao', 'Teste rede (sem versão)',   'https://teste-rede-semversao.vercel.app', null, true,  null,                     null,         true),
  ('prj_teste_rede_previa',    'teste-rede-previa',    'Teste rede (1.3.0 só na prévia)', 'https://teste-rede-previa.vercel.app', null, true, 'sentinela-guarda/1.3.0', 'preview', true),
  ('prj_teste_rede_inativo',   'teste-rede-inativo',   'Teste rede (inativo)',      'https://teste-rede-inativo.vercel.app',   null, true,  'sentinela-guarda/1.3.0', 'production', false),
  ('prj_teste_rede_isento',    'teste-rede-isento',    'Teste rede (isento)',       'https://teste-rede-isento.vercel.app',    null, false, 'sentinela-guarda/1.3.0', 'production', true);
insert into sentinela.rede_sistemas (projeto_id, isento) values ('prj_teste_rede_isento', true);

-- ---------------------------------------------------------
-- R00 seeds e Reposições
-- ---------------------------------------------------------
do $$
declare
  s sentinela.sistemas;
  p jsonb;
begin
  perform pg_temp.ok('R00 rede_config com 1 linha e os padrões (30 dias, 3 pessoas, 2 h)',
    (select count(*) from sentinela.rede_config) = 1
    and (select c.liberacao_max_dias = 30 and c.emergencia_pessoas = 3 and c.emergencia_horas = 2 from sentinela.rede_config c));
  perform pg_temp.ok('R00 SAC e Supervisor isentos e desligados',
    (select count(*) from sentinela.rede_sistemas rs join sentinela.sistemas x on x.projeto_id = rs.projeto_id
      where x.projeto in ('sac-lube','supervisor-lube') and rs.isento and rs.modo = 'desligado') = 2);
  perform pg_temp.ok('R00 a migração não cadastra rede nenhuma', (select count(*) from sentinela.redes) = 0);
  select * into s from sentinela.sistemas x where x.projeto = 'reposicoes-web';
  perform pg_temp.ok('R00 Reposições na central: exige login, sem guarda, ativo, 5 arquivos proibidos, modo de rede desligado',
    s.projeto_id = 'prj_IjVNqbwMq19wyDsAE0mfJZ7r3OIJ' and s.exige_login and s.ultimo_sinal is null
    and s.guarda_versao is null and s.sistema_slug = 'reposicoes' and s.url = 'https://reposicoes-web.vercel.app'
    and cardinality(s.arquivos_proibidos) = 5 and s.ativo
    and sentinela.rede_modo('reposicoes-web') = 'desligado'
    and not exists (select 1 from sentinela.rede_sistemas rs where rs.projeto_id = s.projeto_id),
    format('%s %s', s.projeto_id, s.arquivos_proibidos));
  perform pg_temp.ok('R00 arquivos proibidos do Reposições passam no validador e pegam o que devem',
    (select bool_and(sentinela.regex_problema(a) is null and ('/x' ~ a) is not null) from unnest(s.arquivos_proibidos) a)
    and '/db/01_schema.sql' ~ s.arquivos_proibidos[1] and '/servidor_local.js' ~ s.arquivos_proibidos[2]
    and '/package.json' ~ s.arquivos_proibidos[3] and '/package-lock.json' ~ s.arquivos_proibidos[3]
    and '/vercel.json' ~ s.arquivos_proibidos[4]
    and '/middleware.ts' ~ s.arquivos_proibidos[5] and '/sentinela-guarda.ts' ~ s.arquivos_proibidos[5]
    and not exists (select 1 from unnest(s.arquivos_proibidos) a
                     where '/index.html' ~ a or '/api/dados' ~ a or '/app.js' ~ a or '/planilha.js' ~ a or '/' ~ a));
  p := public.sentinela_srv_permissao(pg_temp.uid(1), 'reposicoes');
  perform pg_temp.ok('R00 Reposições sem guarda: /passe permitido, URL do sistema, guarda_ativo false (sem passe na URL)',
    (p->>'permitido')::boolean and p->>'projeto' = 'reposicoes-web' and p->>'url' = 'https://reposicoes-web.vercel.app'
    and p->'guarda_ativo' = 'false'::jsonb, p::text);
  perform pg_temp.ok('R00 srv_lista do Reposições traz exige_login',
    public.sentinela_srv_lista('reposicoes-web')->'sistema'->'exige_login' = 'true'::jsonb);
exception when others then
  perform pg_temp.postgres();
  perform pg_temp.ok('R00 (erro inesperado)', false, sqlstate || ': ' || sqlerrm);
end $$;

-- ---------------------------------------------------------
-- R01 privilégios
-- ---------------------------------------------------------
do $$
declare
  v_sql text;
  v_papel text;
  v_ok int := 0;
  v_falhas text[] := '{}';
  v_r jsonb;
  v_srv text[] := array[
    'select public.sentinela_srv_rede_lista(''teste-rede-novo'')',
    'select public.sentinela_srv_rede_decidir(''192.0.2.1'', null, null, ''teste-rede-novo'', ''passe'', null)',
    'select public.sentinela_srv_rede_emergencia(''192.0.2.1'', null)',
    'select public.sentinela_srv_rede_acao(null, ''192.0.2.1'', ''rede_nova'', ''{}'')'];
  v_emerg text[] := array[
    'select sentinela.emergencia_rede(''192.0.2.250'')',
    'select sentinela.emergencia_pausar_rede()',
    'select sentinela.emergencia_liberar(''rede.teste.um@lube.com.br'', 1)'];
  v_tab text[] := array[
    'select count(*) from sentinela.redes', 'select count(*) from sentinela.rede_liberacoes',
    'select count(*) from sentinela.rede_fora', 'select count(*) from sentinela.rede_sistemas',
    'select count(*) from sentinela.rede_config'];
  v_painel text[] := array[
    'select public.sentinela_rede_painel(14)',
    'select public.sentinela_rede_acao(''rede_nova'', ''{"rede":"192.0.2.251","descricao":"teste"}'')'];
begin
  -- srv_rede_*, emergência e tabelas novas: authenticated (até admin) e anon → permission denied
  foreach v_sql in array v_srv || v_emerg || v_tab loop
    foreach v_papel in array array['authenticated','anon'] loop
      begin
        if v_papel = 'authenticated' then
          perform pg_temp.como(pg_temp.uid(1), 'rede.teste.admin@lube.com.br');
        else
          perform pg_temp.como(null, null, 'anon');
        end if;
        execute v_sql;
        perform pg_temp.postgres();
        v_falhas := v_falhas || (v_papel || ' executou: ' || v_sql);
      exception when insufficient_privilege then
        v_ok := v_ok + 1;
      when others then
        v_falhas := v_falhas || (v_papel || ': ' || v_sql || ' → ' || sqlstate || ' ' || sqlerrm);
      end;
    end loop;
  end loop;
  perform pg_temp.postgres();
  perform pg_temp.ok('R01 srv_rede_*, emergência e tabelas novas negadas para authenticated e anon (24 casos)',
    v_ok = 24 and cardinality(v_falhas) = 0, format('ok=%s falhas=%s', v_ok, v_falhas));

  -- painel: comum (ativo, não admin) e authenticated sem login → 42501 do is_admin; anon → sem permissão
  v_ok := 0;
  v_falhas := '{}';
  foreach v_sql in array v_painel loop
    foreach v_papel in array array['comum','sem_login','anon'] loop
      begin
        if v_papel = 'comum' then
          perform pg_temp.como(pg_temp.uid(2), 'rede.teste.um@lube.com.br');
        elsif v_papel = 'sem_login' then
          perform set_config('request.jwt.claims', '', true);
          perform set_config('role', 'authenticated', true);
        else
          perform pg_temp.como(null, null, 'anon');
        end if;
        execute v_sql;
        perform pg_temp.postgres();
        v_falhas := v_falhas || (v_papel || ' executou: ' || v_sql);
      exception when others then
        if sqlstate = '42501' and ((v_papel <> 'anon' and sqlerrm = 'sentinela: acesso restrito ao TI')
                                   or (v_papel = 'anon' and sqlerrm like 'permission denied for function%')) then
          v_ok := v_ok + 1;
        else
          v_falhas := v_falhas || (v_papel || ': ' || v_sql || ' → ' || sqlstate || ' ' || sqlerrm);
        end if;
      end;
    end loop;
  end loop;
  perform pg_temp.postgres();
  perform pg_temp.ok('R01 painel e ação recusam não admin, sem login (42501) e anon (6 casos)',
    v_ok = 6 and cardinality(v_falhas) = 0, format('ok=%s falhas=%s', v_ok, v_falhas));
  perform pg_temp.ok('R01 recusas não gravaram nada', (select count(*) from sentinela.redes) = 0);

  -- service_role: executa srv_rede_*, não passa no is_admin do painel, não executa emergência
  perform pg_temp.como(null, null, 'service_role');
  v_r := public.sentinela_srv_rede_lista('teste-rede-novo');
  perform pg_temp.postgres();
  perform pg_temp.ok('R01 service_role executa srv_rede_lista', v_r->>'modo' = 'desligado', v_r::text);
  perform pg_temp.como(null, null, 'service_role');
  perform pg_temp.ok('R01 service_role não abre o painel (sem is_admin)',
    pg_temp.erro('select public.sentinela_rede_painel(14)') = '42501 sentinela: acesso restrito ao TI');
  v_ok := 0;
  foreach v_sql in array v_emerg loop
    perform pg_temp.como(null, null, 'service_role');
    if pg_temp.erro(v_sql) like '42501 %' then
      v_ok := v_ok + 1;
    end if;
  end loop;
  perform pg_temp.postgres();
  perform pg_temp.ok('R01 service_role não executa as funções de emergência', v_ok = 3, format('ok=%s', v_ok));

  -- catálogo
  perform pg_temp.ok('R01 catálogo: anon não executa nenhuma função nova',
    not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where ((n.nspname = 'public' and p.proname like 'sentinela\_%rede%')
                        or (n.nspname = 'sentinela' and pg_temp.desta_tx(p.xmin)))
                   and has_function_privilege('anon', p.oid, 'execute')));
  perform pg_temp.ok('R01 catálogo: authenticated só executa as 2 novas de painel',
    (select array_agg(p.proname::text order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where ((n.nspname = 'public' and p.proname like 'sentinela\_%rede%')
             or (n.nspname = 'sentinela' and pg_temp.desta_tx(p.xmin)))
        and has_function_privilege('authenticated', p.oid, 'execute'))
    = array['sentinela_rede_acao','sentinela_rede_painel']);
  perform pg_temp.ok('R01 catálogo: service_role executa as 4 srv_rede_* e nenhuma emergencia_* nem o executor das ações',
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname like 'sentinela\_srv\_rede\_%'
        and has_function_privilege('service_role', p.oid, 'execute')) = 4
    and not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname = 'sentinela' and (p.proname like 'emergencia\_%' or p.proname = 'rede_acao_exec')
                       and has_function_privilege('service_role', p.oid, 'execute')));
  perform pg_temp.ok('R01 catálogo: as 6 novas de public são security definer com search_path fixo',
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname like 'sentinela\_%rede%'
        and p.prosecdef and 'search_path=sentinela, public, extensions, pg_temp' = any(p.proconfig)) = 6);
  perform pg_temp.ok('R01 catálogo: tabelas novas com RLS ligado e sem política',
    (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'sentinela' and c.relkind = 'r' and c.relrowsecurity
        and c.relname in ('rede_config','rede_sistemas','redes','rede_liberacoes','rede_fora')) = 5
    and not exists (select 1 from pg_policy pl join pg_class c on c.oid = pl.polrelid
                      join pg_namespace n on n.oid = c.relnamespace
                     where n.nspname = 'sentinela' and c.relname like 'rede%'));
  perform pg_temp.ok('R01 catálogo: anon e authenticated sem privilégio nas tabelas e sequências novas',
    not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace,
                       unnest(array['anon','authenticated']) as r(papel)
                 where n.nspname = 'sentinela' and c.relname like 'rede%' and c.relkind in ('r','S')
                   and case when c.relkind = 'r' then has_table_privilege(r.papel, c.oid, 'select,insert,update,delete')
                            else has_sequence_privilege(r.papel, c.oid, 'usage,select,update') end)
    and (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'sentinela' and c.relkind = 'S' and c.relname like 'rede%') = 3);
exception when others then
  perform pg_temp.postgres();
  perform pg_temp.ok('R01 (erro inesperado)', false, sqlstate || ': ' || sqlerrm);
end $$;

-- ---------------------------------------------------------
-- R04a exigir sem rede (antes de cadastrar qualquer rede)
-- ---------------------------------------------------------
do $$
declare
  v text;
  l jsonb;
  r jsonb;
begin
  v := pg_temp.erro_adm('rede_modo', '{"projeto":"teste-rede-novo","modo":"exigir"}');
  perform pg_temp.ok('R04 exigir sem nenhuma rede cadastrada é recusado',
    v like '22023 sentinela: cadastre pelo menos uma rede da Lube antes de exigir%', v);
  -- rede de segurança: uma linha "exigir" posta por SQL, sem rede ativa, sai como observar
  insert into sentinela.rede_sistemas (projeto_id, modo) values ('prj_teste_rede_novo', 'exigir');
  l := public.sentinela_srv_rede_lista('teste-rede-novo');
  r := pg_temp.dec('192.0.2.30', 5, 'teste-rede-novo');
  perform pg_temp.ok('R07 exigir sem rede ativa: lista e decisão saem observar (não tranca a empresa)',
    l->>'modo' = 'observar' and l->'redes' = '[]'::jsonb and r->>'acao' = 'observar' and r->>'modo' = 'observar',
    l::text || ' ' || r::text);
  update sentinela.rede_sistemas set modo = 'desligado' where projeto_id = 'prj_teste_rede_novo';
exception when others then
  perform pg_temp.postgres();
  perform pg_temp.ok('R04a (erro inesperado)', false, sqlstate || ': ' || sqlerrm);
end $$;

-- ---------------------------------------------------------
-- R02 rede_nova
-- ---------------------------------------------------------
do $$
declare
  r jsonb;
  v text;
  e text;
  m text;
  n0 int;
  x sentinela.redes;
begin
  r := pg_temp.adm('rede_nova', '{"rede":"203.0.113.7","descricao":"Escritório teste"}');
  insert into pg_temp.rede_teste_ids values ('escritorio', (r->>'id')::bigint);
  select * into x from sentinela.redes where id = (r->>'id')::bigint;
  perform pg_temp.ok('R02 IP solto vira /32, origem manual, criado_por = e-mail do admin',
    (r->>'ok')::boolean and r->>'rede' = '203.0.113.7/32' and x.origem = 'manual'
    and x.criado_por = 'rede.teste.admin@lube.com.br' and x.removido_em is null, r::text);
  r := pg_temp.adm('rede_nova', '{"rede":"198.51.100.0/24","descricao":"Galpão teste","origem":"sugestao"}');
  perform pg_temp.ok('R02 faixa /24 aceita, com origem sugestão',
    r->>'rede' = '198.51.100.0/24' and (select origem from sentinela.redes where id = (r->>'id')::bigint) = 'sugestao', r::text);
  r := pg_temp.adm('rede_nova', '{"rede":"2001:db8:10::/48","descricao":"IPv6 teste /48"}');
  perform pg_temp.ok('R02 IPv6 /48 aceito', r->>'rede' = '2001:db8:10::/48', r::text);
  r := pg_temp.adm('rede_nova', '{"rede":"2001:db8:20:100::/56","descricao":"IPv6 teste /56"}');
  perform pg_temp.ok('R02 IPv6 /56 aceito', r->>'rede' = '2001:db8:20:100::/56', r::text);
  r := pg_temp.adm('rede_nova', '{"rede":"::ffff:192.0.2.9","descricao":"IPv4 escrito em IPv6"}');
  perform pg_temp.ok('R02 ::ffff:a.b.c.d vira IPv4', r->>'rede' = '192.0.2.9/32', r::text);

  select count(*) into n0 from sentinela.redes;
  m := null;
  foreach v in array array['198.51.0.0/23', '2001:db8:30::/47', '203.0.113.9/24', '192.168.1.10', '10.1.2.3',
                           '100.64.1.1', '127.0.0.1', '::1', 'fe80::1', '169.254.1.1', '172.16.5.4', '224.0.0.1',
                           'fd00::1', '203.0.113.7', '198.51.100.77', '2001:db8:10:5::/64', '203.0.113.0/24',
                           'abc', '', '1.2.3.4/33', '::ffff:0:0/96'] loop
    e := pg_temp.erro_adm('rede_nova', jsonb_build_object('rede', v, 'descricao', 'recusa teste'));
    if e not like '22023 sentinela:%' then
      m := coalesce(m, '') || v || ' → ' || e || '; ';
    end if;
  end loop;
  perform pg_temp.ok('R02 21 recusas com 22023 (ampla, bits de host, interno, repetida, coberta, inclui, lixo) e nada gravado',
    m is null and (select count(*) from sentinela.redes) = n0, m);
  perform pg_temp.ok('R02 mensagens prontas para a tela',
    pg_temp.erro_adm('rede_nova', '{"rede":"198.51.0.0/23","descricao":"x x"}')
      like '%rede ampla demais: incluiria outros clientes da operadora (mínimo /24 em IPv4 e /48 em IPv6)%'
    and pg_temp.erro_adm('rede_nova', '{"rede":"203.0.113.9/24","descricao":"x x"}') like '%bits de host ligados; use 203.0.113.0/24%'
    and pg_temp.erro_adm('rede_nova', '{"rede":"192.168.1.10","descricao":"x x"}')
      like '%é um IP interno da rede; cadastre o IP público, que aparece em https://painel-lube-distribuidora.vercel.app/.sentinela/saude%'
    and pg_temp.erro_adm('rede_nova', '{"rede":"203.0.113.7","descricao":"x x"}') like '%já coberta pela rede #% (203.0.113.7/32)%'
    and pg_temp.erro_adm('rede_nova', '{"rede":"198.51.100.77","descricao":"x x"}') like '%já coberta pela rede #% (198.51.100.0/24)%'
    and pg_temp.erro_adm('rede_nova', '{"rede":"203.0.113.0/24","descricao":"x x"}') like '%a faixa inclui a rede #% (203.0.113.7/32)%');
  perform pg_temp.ok('R02 descrição curta, sem descrição e origem emergência são recusadas',
    pg_temp.erro_adm('rede_nova', '{"rede":"192.0.2.40","descricao":"ab"}') like '22023 sentinela: informe a descrição%'
    and pg_temp.erro_adm('rede_nova', '{"rede":"192.0.2.40"}') like '22023 sentinela: informe a descrição%'
    and pg_temp.erro_adm('rede_nova', '{"rede":"192.0.2.40","descricao":"Teste","origem":"emergencia"}')
      like '22023 sentinela: origem inválida%'
    and pg_temp.erro_adm('rede_nova', '"texto"') like '22023 sentinela: dados devem ser um objeto JSON%'
    and pg_temp.erro_adm('xpto', '{}') like '22023 sentinela: ação desconhecida%');
  perform pg_temp.ok('R02 rede_lube_valida: ::ffff:192.0.2.0/120 vira 192.0.2.0/24, espaços aparados, IPv6 /128',
    sentinela.rede_lube_valida('::ffff:192.0.2.0/120') = '192.0.2.0/24'::cidr
    and sentinela.rede_lube_valida(' 203.0.113.7 ') = '203.0.113.7/32'::cidr
    and sentinela.rede_lube_valida('2001:DB8::1') = '2001:db8::1/128'::cidr);
  perform pg_temp.ok('R02 5 redes ativas', (select count(*) from sentinela.redes where removido_em is null) = 5);
exception when others then
  perform pg_temp.postgres();
  perform pg_temp.ok('R02 (erro inesperado)', false, sqlstate || ': ' || sqlerrm);
end $$;

-- ---------------------------------------------------------
-- R03 rede_remover
-- ---------------------------------------------------------
do $$
declare
  r jsonb;
  v text;
  v_esc bigint;
  v_id bigint;
begin
  v_esc := (select id from pg_temp.rede_teste_ids where nome = 'escritorio');
  perform pg_temp.ok('R03 id inexistente → P0002; id inválido → 22023',
    pg_temp.erro_adm('rede_remover', '{"id":999999999}') like 'P0002 sentinela: rede não encontrada ou já removida%'
    and pg_temp.erro_adm('rede_remover', '{"id":"x"}') like '22023 sentinela: id inválido%');
  r := pg_temp.adm('rede_modo', '{"projeto":"teste-rede-novo","modo":"exigir"}');
  perform pg_temp.ok('R03 (preparo) teste-rede-novo em exigir', r->'alterados' = '["teste-rede-novo"]'::jsonb, r::text);
  for v_id in select x.id from sentinela.redes x where x.removido_em is null and x.id <> v_esc order by x.id loop
    perform pg_temp.adm('rede_remover', jsonb_build_object('id', v_id));
  end loop;
  perform pg_temp.ok('R03 remover grava removido_em/removido_por e não apaga a linha',
    (select count(*) from sentinela.redes where removido_em is null) = 1
    and (select count(*) from sentinela.redes) = 5
    and (select bool_and(removido_por = 'rede.teste.admin@lube.com.br' and removido_em is not null)
           from sentinela.redes where id <> v_esc));
  v := pg_temp.erro_adm('rede_remover', jsonb_build_object('id', v_esc));
  perform pg_temp.ok('R03 a última rede não sai com sistema exigindo',
    v like '22023 sentinela: é a última rede da Lube e há sistema exigindo a rede; passe os sistemas para observar antes%'
    and (select removido_em is null from sentinela.redes where id = v_esc), v);
  perform pg_temp.adm('rede_modo', '{"projeto":"teste-rede-novo","modo":"observar"}');
  r := pg_temp.adm('rede_remover', jsonb_build_object('id', v_esc));
  perform pg_temp.ok('R03 com tudo em observar a última sai; repetir → P0002',
    (r->>'ok')::boolean and (select count(*) from sentinela.redes where removido_em is null) = 0
    and pg_temp.erro_adm('rede_remover', jsonb_build_object('id', v_esc)) like 'P0002 %', r::text);
  -- de volta: a mesma rede pode ser cadastrada de novo depois de removida
  r := pg_temp.adm('rede_nova', '{"rede":"203.0.113.7","descricao":"Escritório teste"}');
  update pg_temp.rede_teste_ids set id = (r->>'id')::bigint where nome = 'escritorio';
  perform pg_temp.adm('rede_nova', '{"rede":"198.51.100.0/24","descricao":"Galpão teste"}');
  perform pg_temp.adm('rede_nova', '{"rede":"2001:db8:10::/48","descricao":"IPv6 teste /48"}');
  perform pg_temp.ok('R03 a mesma rede volta depois de removida (3 ativas, 8 linhas)',
    (select count(*) from sentinela.redes where removido_em is null) = 3 and (select count(*) from sentinela.redes) = 8);
exception when others then
  perform pg_temp.postgres();
  perform pg_temp.ok('R03 (erro inesperado)', false, sqlstate || ': ' || sqlerrm);
end $$;

-- ---------------------------------------------------------
-- R04 rede_modo
-- ---------------------------------------------------------
do $$
declare
  r jsonb;
  v text;
  n int;
  n_mudar int;
begin
  perform pg_temp.ok('R04 isento recusado (SAC e sistema isento de teste)',
    pg_temp.erro_adm('rede_modo', '{"projeto":"sac-lube","modo":"observar"}')
      like '22023 sentinela: sac-lube fica fora da regra de rede (usado na rua)%'
    and pg_temp.erro_adm('rede_modo', '{"projeto":"teste-rede-isento","modo":"exigir"}') like '22023 %fica fora da regra de rede%');
  perform pg_temp.ok('R04 sistema inexistente → P0002; modo e projeto inválidos → 22023',
    pg_temp.erro_adm('rede_modo', '{"projeto":"nao-existe","modo":"observar"}') like 'P0002 sentinela: sistema não encontrado%'
    and pg_temp.erro_adm('rede_modo', '{"projeto":"teste-rede-novo","modo":"xpto"}') like '22023 sentinela: modo inválido%'
    and pg_temp.erro_adm('rede_modo', '{"modo":"observar"}') like '22023 sentinela: informe o sistema%');
  perform pg_temp.ok('R04 exigir com guarda 1.2.0, sem versão ou com o 1.3.0 só visto numa prévia é recusado',
    pg_temp.erro_adm('rede_modo', '{"projeto":"teste-rede-velho","modo":"exigir"}')
      = '22023 sentinela: precisa do guarda 1.3.0 em produção antes de exigir a rede em: teste-rede-velho (o último sinal tem de vir do endereço de produção)'
    and pg_temp.erro_adm('rede_modo', '{"projeto":"teste-rede-semversao","modo":"exigir"}')
      = '22023 sentinela: precisa do guarda 1.3.0 em produção antes de exigir a rede em: teste-rede-semversao (o último sinal tem de vir do endereço de produção)'
    and pg_temp.erro_adm('rede_modo', '{"projeto":"teste-rede-previa","modo":"exigir"}')
      like '22023 sentinela: precisa do guarda 1.3.0 em produção antes de exigir a rede em: teste-rede-previa %');
  select count(*) into n from sentinela.rede_sistemas where modo <> 'desligado';
  v := pg_temp.erro_adm('rede_modo', '{"projeto":"*","modo":"exigir"}');
  perform pg_temp.ok('R04 "*" exigir com guarda antigo em algum: recusa listando os que faltam, sem o portal, e nada muda',
    v like '22023 sentinela: precisa do guarda 1.3.0 em produção antes de exigir a rede em: %painel-compras%'
    and v like '%teste-rede-velho%' and v like '%teste-rede-previa%' and v not like '%teste-rede-novo%'
    and v not like '%sac-lube%' and v not like '%teste-rede-inativo%' and v not like '%teste-rede-isento%'
    and v not like '%painel-lube-distribuidora%'
    and (select count(*) from sentinela.rede_sistemas where modo <> 'desligado') = n, v);
  select count(*) into n_mudar
    from sentinela.sistemas s left join sentinela.rede_sistemas rs on rs.projeto_id = s.projeto_id
   where s.ativo and not coalesce(rs.isento, false) and coalesce(rs.modo, 'desligado') <> 'observar';
  r := pg_temp.adm('rede_modo', '{"projeto":"*","modo":"observar"}');
  perform pg_temp.ok('R04 "*" observar: muda todos os ativos não isentos e devolve só os que mudaram',
    (r->>'ok')::boolean and jsonb_array_length(r->'alterados') = n_mudar
    and r->'alterados' ? 'painel-compras' and r->'alterados' ? 'reposicoes-web' and r->'alterados' ? 'painel-lube-distribuidora'
    and r->'alterados' ? 'teste-rede-velho' and not (r->'alterados' ? 'teste-rede-novo')
    and not (r->'alterados' ? 'sac-lube') and not (r->'alterados' ? 'supervisor-lube')
    and not (r->'alterados' ? 'teste-rede-isento') and not (r->'alterados' ? 'teste-rede-inativo')
    and not exists (select 1 from sentinela.sistemas s left join sentinela.rede_sistemas rs on rs.projeto_id = s.projeto_id
                     where s.ativo and not coalesce(rs.isento, false) and coalesce(rs.modo, 'desligado') <> 'observar'),
    format('n=%s %s', n_mudar, r));
  perform pg_temp.ok('R04 "*" observar de novo: nada a alterar',
    pg_temp.adm('rede_modo', '{"projeto":"*","modo":"observar"}')->'alterados' = '[]'::jsonb);
  perform pg_temp.ok('R04 modo_em e modo_por gravados; isentos continuam desligados',
    (select bool_and(rs.modo_por = 'rede.teste.admin@lube.com.br' and rs.modo_em is not null)
       from sentinela.rede_sistemas rs where rs.modo = 'observar')
    and (select bool_and(rs.modo = 'desligado') from sentinela.rede_sistemas rs where rs.isento)
    and (select count(*) from sentinela.rede_sistemas rs where rs.isento) = 3);
  r := pg_temp.adm('rede_modo', '{"projeto":"teste-rede-novo","modo":"exigir"}');
  perform pg_temp.ok('R04 exigir num sistema com guarda 1.3.0 e rede ativa', r->'alterados' = '["teste-rede-novo"]'::jsonb, r::text);
  perform pg_temp.ok('R04 guarda_tem_rede compara a versão como número',
    sentinela.guarda_tem_rede('sentinela-guarda/1.3.0') and sentinela.guarda_tem_rede('sentinela-guarda/1.10.0')
    and sentinela.guarda_tem_rede('sentinela-guarda/2.0.0') and not sentinela.guarda_tem_rede('sentinela-guarda/1.2.0')
    and not sentinela.guarda_tem_rede('sentinela-guarda/1.2.99') and not sentinela.guarda_tem_rede(null)
    and not sentinela.guarda_tem_rede('sentinela-guarda/1.3') and not sentinela.guarda_tem_rede('x/1.3.0')
    and not sentinela.guarda_tem_rede('sentinela-guarda/1.3.0-beta'));
  insert into sentinela.rede_sistemas (projeto_id, modo) values ('prj_teste_rede_inativo', 'exigir');
  perform pg_temp.ok('R04 rede_modo: sistema inativo e desconhecido = desligado',
    sentinela.rede_modo('teste-rede-inativo') = 'desligado' and sentinela.rede_modo('nao-existe') = 'desligado'
    and sentinela.rede_modo('teste-rede-isento') = 'desligado' and sentinela.rede_modo('teste-rede-novo') = 'exigir'
    and sentinela.rede_modo('teste-rede-velho') = 'observar');
exception when others then
  perform pg_temp.postgres();
  perform pg_temp.ok('R04 (erro inesperado)', false, sqlstate || ': ' || sqlerrm);
end $$;

-- ---------------------------------------------------------
-- R05 liberar
-- ---------------------------------------------------------
do $$
declare
  r jsonb;
  m text := null;
  e text;
  c jsonb;
  l1 bigint;
  l3 bigint;
  x sentinela.rede_liberacoes;
begin
  -- recusas: nada grava
  foreach c in array array[
    jsonb_build_object('user_id', 'xpto', 'fim', now() + interval '2 days', 'motivo', 'viagem a trabalho'),
    jsonb_build_object('user_id', pg_temp.uid(6), 'fim', now() + interval '2 days', 'motivo', 'viagem a trabalho'),
    jsonb_build_object('user_id', pg_temp.uid(7), 'fim', now() + interval '2 days', 'motivo', 'viagem a trabalho'),
    jsonb_build_object('user_id', pg_temp.uid(2), 'fim', now() - interval '1 day', 'motivo', 'viagem a trabalho'),
    jsonb_build_object('user_id', pg_temp.uid(2), 'fim', now() + interval '2 minutes', 'motivo', 'viagem a trabalho'),
    jsonb_build_object('user_id', pg_temp.uid(2), 'fim', now() + interval '31 days', 'motivo', 'viagem a trabalho'),
    jsonb_build_object('user_id', pg_temp.uid(2), 'fim', now() + interval '2 days', 'motivo', 'abc'),
    jsonb_build_object('user_id', pg_temp.uid(2), 'fim', now() + interval '2 days'),
    jsonb_build_object('user_id', pg_temp.uid(2), 'fim', 'lixo', 'motivo', 'viagem a trabalho'),
    jsonb_build_object('user_id', pg_temp.uid(2), 'motivo', 'viagem a trabalho'),
    jsonb_build_object('user_id', pg_temp.uid(2), 'inicio', now() + interval '31 days', 'fim', now() + interval '32 days', 'motivo', 'viagem a trabalho'),
    jsonb_build_object('user_id', pg_temp.uid(2), 'inicio', now() - interval '1 hour', 'fim', now() + interval '2 days', 'motivo', 'viagem a trabalho'),
    jsonb_build_object('user_id', pg_temp.uid(2), 'inicio', 'lixo', 'fim', now() + interval '2 days', 'motivo', 'viagem a trabalho'),
    jsonb_build_object('user_id', pg_temp.uid(2), 'inicio', now() + interval '2 days', 'fim', now() + interval '1 day', 'motivo', 'viagem a trabalho'),
    jsonb_build_object('user_id', pg_temp.uid(2), 'inicio', now() + interval '1 day', 'fim', now() + interval '32 days', 'motivo', 'viagem a trabalho')] loop
    e := pg_temp.erro_adm('liberar', c);
    if e not like '22023 sentinela:%' then
      m := coalesce(m, '') || c::text || ' → ' || e || '; ';
    end if;
  end loop;
  perform pg_temp.ok('R05 15 recusas com 22023 (pessoa, inativo, e-mail fora do padrão, prazo, motivo, início) e nada gravado',
    m is null and (select count(*) from sentinela.rede_liberacoes) = 0, m);
  perform pg_temp.ok('R05 mensagens: pessoa inexistente P0002, inativo, e-mail, prazo máximo',
    pg_temp.erro_adm('liberar', jsonb_build_object('user_id', 'b0000000-0000-4000-8000-0000000000ff',
                                                   'fim', now() + interval '2 days', 'motivo', 'viagem a trabalho'))
      like 'P0002 sentinela: pessoa não encontrada%'
    and pg_temp.erro_adm('liberar', jsonb_build_object('user_id', pg_temp.uid(6), 'fim', now() + interval '2 days', 'motivo', 'viagem a trabalho'))
      like '22023 sentinela: a conta desta pessoa não está ativa no Painel Lube%'
    and pg_temp.erro_adm('liberar', jsonb_build_object('user_id', pg_temp.uid(7), 'fim', now() + interval '2 days', 'motivo', 'viagem a trabalho'))
      like '22023 sentinela: o e-mail desta conta tem caractere fora do padrão%'
    and pg_temp.erro_adm('liberar', jsonb_build_object('user_id', pg_temp.uid(2), 'fim', now() + interval '31 days', 'motivo', 'viagem a trabalho'))
      = '22023 sentinela: prazo máximo de 30 dias');

  r := pg_temp.adm('liberar', jsonb_build_object('user_id', pg_temp.uid(2), 'fim', now() + interval '2 days', 'motivo', '  viagem a trabalho  '));
  l1 := (r->>'id')::bigint;
  select * into x from sentinela.rede_liberacoes where id = l1;
  perform pg_temp.ok('R05 liberação aceita: início agora, e-mail do perfil, motivo aparado, quem liberou',
    (r->>'ok')::boolean and r->'substituida' = 'null'::jsonb and r->>'fim' = sentinela.iso(now() + interval '2 days')
    and x.inicio = now() and x.email = 'rede.teste.um@lube.com.br' and x.motivo = 'viagem a trabalho'
    and x.criado_por = 'rede.teste.admin@lube.com.br' and x.encerrado_em is null, r::text);
  insert into pg_temp.rede_teste_ids values ('l1', l1);

  r := pg_temp.adm('liberar', jsonb_build_object('user_id', pg_temp.uid(3), 'inicio', now() + interval '1 day',
                                                 'fim', now() + interval '3 days', 'motivo', 'plantão no fim de semana'));
  insert into pg_temp.rede_teste_ids values ('l2', (r->>'id')::bigint);
  perform pg_temp.ok('R05 liberação agendada (começa amanhã) aceita', (r->>'ok')::boolean, r::text);

  r := pg_temp.adm('liberar', jsonb_build_object('user_id', pg_temp.uid(2), 'fim', now() + interval '5 days', 'motivo', 'viagem prorrogada'));
  l3 := (r->>'id')::bigint;
  insert into pg_temp.rede_teste_ids values ('l3', l3);
  select * into x from sentinela.rede_liberacoes where id = l1;
  perform pg_temp.ok('R05 liberar de novo encerra a anterior ("substituída por #id")',
    (r->>'substituida')::bigint = l1 and x.encerrado_em is not null and x.encerrado_por = 'substituída por #' || l3
    and (select count(*) from sentinela.rede_liberacoes where user_id = pg_temp.uid(2) and encerrado_em is null) = 1, r::text);

  r := pg_temp.adm('liberar', jsonb_build_object('user_id', pg_temp.uid(4), 'fim', now() + interval '30 days', 'motivo', 'trinta dias exatos'));
  insert into pg_temp.rede_teste_ids values ('l4', (r->>'id')::bigint);
  perform pg_temp.ok('R05 prazo de exatamente 30 dias é aceito', (r->>'ok')::boolean, r::text);
exception when others then
  perform pg_temp.postgres();
  perform pg_temp.ok('R05 (erro inesperado)', false, sqlstate || ': ' || sqlerrm);
end $$;

-- ---------------------------------------------------------
-- R06 encerrar
-- ---------------------------------------------------------
do $$
declare
  r jsonb;
  l4 bigint := (select id from pg_temp.rede_teste_ids where nome = 'l4');
  l5 bigint;
  x sentinela.rede_liberacoes;
begin
  r := pg_temp.adm('encerrar', jsonb_build_object('id', l4));
  select * into x from sentinela.rede_liberacoes where id = l4;
  perform pg_temp.ok('R06 encerrar grava encerrado_em/encerrado_por',
    (r->>'ok')::boolean and x.encerrado_em = now() and x.encerrado_por = 'rede.teste.admin@lube.com.br', r::text);
  perform pg_temp.ok('R06 encerrar de novo → P0002; id inválido → 22023',
    pg_temp.erro_adm('encerrar', jsonb_build_object('id', l4)) like 'P0002 sentinela: liberação não encontrada, já encerrada ou vencida%'
    and pg_temp.erro_adm('encerrar', '{"id":"x"}') like '22023 sentinela: id inválido%');
  -- vencida (posta por SQL) e ativa de perfil inativo
  insert into sentinela.rede_liberacoes (user_id, email, inicio, fim, motivo, criado_por)
  values (pg_temp.uid(5), pg_temp.mail(5), now() - interval '3 days', now() - interval '1 day', 'liberação vencida', 'teste')
  returning id into l5;
  insert into pg_temp.rede_teste_ids values ('l5', l5);
  perform pg_temp.ok('R06 encerrar vencida → P0002',
    pg_temp.erro_adm('encerrar', jsonb_build_object('id', l5)) like 'P0002 %');
  insert into sentinela.rede_liberacoes (user_id, email, inicio, fim, motivo, criado_por)
  values (pg_temp.uid(6), pg_temp.mail(6), now() - interval '1 hour', now() + interval '1 day', 'perfil inativo', 'teste');
  perform pg_temp.ok('R06 tabela recusa prazo acima de 90 dias e e-mail fora do padrão',
    pg_temp.erro(format('insert into sentinela.rede_liberacoes (user_id, email, fim, motivo, criado_por) values (%L, %L, now() + interval ''91 days'', ''motivo x'', ''t'')',
                        pg_temp.uid(2), pg_temp.mail(2))) like '23514 %'
    and pg_temp.erro(format('insert into sentinela.rede_liberacoes (user_id, email, fim, motivo, criado_por) values (%L, %L, now() + interval ''1 day'', ''motivo x'', ''t'')',
                            pg_temp.uid(7), pg_temp.mail(7))) like '23514 %');
exception when others then
  perform pg_temp.postgres();
  perform pg_temp.ok('R06 (erro inesperado)', false, sqlstate || ': ' || sqlerrm);
end $$;

-- ---------------------------------------------------------
-- R07 srv_rede_lista
-- ---------------------------------------------------------
do $$
declare
  l jsonb;
  v_h text := encode(sha256(convert_to('rede.teste.um@lube.com.br', 'UTF8')), 'hex');
  v_fim timestamptz := (select fim from sentinela.rede_liberacoes where id = (select id from pg_temp.rede_teste_ids where nome = 'l3'));
begin
  l := public.sentinela_srv_rede_lista('teste-rede-novo');
  perform pg_temp.ok('R07 formato: v, gerado_em, modo, redes, liberados',
    (select array_agg(k order by k) from jsonb_object_keys(l) k) = array['gerado_em','liberados','modo','redes','v']
    and l->'v' = '1'::jsonb, l::text);
  perform pg_temp.ok('R07 exigir: todas as redes ativas, com máscara, em ordem de cadastro',
    l->>'modo' = 'exigir'
    and l->'redes' = (select jsonb_agg(r.rede::text order by r.id) from sentinela.redes r where r.removido_em is null)
    and l->'redes' ? '203.0.113.7/32' and l->'redes' ? '198.51.100.0/24' and l->'redes' ? '2001:db8:10::/48'
    and jsonb_array_length(l->'redes') = 3, l->>'redes');
  perform pg_temp.ok('R07 liberados: só a ativa de perfil ativo, pelo SHA-256 do e-mail (nunca o e-mail)',
    l->'liberados' = jsonb_build_array(jsonb_build_object('h', v_h, 'ate', sentinela.iso(v_fim)))
    and l::text not like '%@%', l->>'liberados');
  perform pg_temp.ok('R07 email_hash: minúsculas e espaços não mudam o hash',
    sentinela.email_hash('  Rede.Teste.UM@Lube.com.br ') = v_h);
  l := public.sentinela_srv_rede_lista('teste-rede-velho');
  perform pg_temp.ok('R07 observar também leva os liberados',
    l->>'modo' = 'observar' and jsonb_array_length(l->'liberados') = 1, l::text);
  perform pg_temp.ok('R07 desconhecido, isento, inativo e SAC: desligado e sem liberados (redes vão)',
    (select bool_and(x->>'modo' = 'desligado' and x->'liberados' = '[]'::jsonb and jsonb_array_length(x->'redes') = 3)
       from (select public.sentinela_srv_rede_lista(p) as x
               from unnest(array['nao-existe','teste-rede-isento','teste-rede-inativo','sac-lube','supervisor-lube']) p) y));
exception when others then
  perform pg_temp.postgres();
  perform pg_temp.ok('R07 (erro inesperado)', false, sqlstate || ': ' || sqlerrm);
end $$;

-- ---------------------------------------------------------
-- R08 srv_rede_decidir
-- ---------------------------------------------------------
do $$
declare
  r jsonb;
  n0 int;
  f sentinela.rede_fora;
  l3 bigint := (select id from pg_temp.rede_teste_ids where nome = 'l3');
begin
  select count(*) into n0 from sentinela.rede_fora;
  r := pg_temp.dec('192.0.2.50', 3, 'supervisor-lube');
  perform pg_temp.ok('R08 desligado (isento): seguir e não grava',
    r->>'acao' = 'seguir' and r->>'modo' = 'desligado' and r->'na_rede' = 'false'::jsonb and r->'liberado' = 'null'::jsonb
    and r->>'ip' = '192.0.2.50' and (select count(*) from sentinela.rede_fora) = n0, r::text);
  r := pg_temp.dec('203.0.113.7', 3, 'teste-rede-novo');
  perform pg_temp.ok('R08 dentro da rede (IP exato): seguir, com a rede, e não grava',
    r->>'acao' = 'seguir' and r->>'modo' = 'exigir' and (r->>'na_rede')::boolean
    and r->'rede'->>'descricao' = 'Escritório teste' and (select count(*) from sentinela.rede_fora) = n0, r::text);
  perform pg_temp.ok('R08 dentro da rede por faixa /24 e IPv6 /48; ::ffff: conta como IPv4',
    (pg_temp.dec('198.51.100.200', 3, 'teste-rede-novo')->>'na_rede')::boolean
    and (pg_temp.dec('2001:db8:10:abcd::1', 3, 'teste-rede-novo')->>'na_rede')::boolean
    and (pg_temp.dec('::ffff:203.0.113.7', 3, 'teste-rede-novo')->>'na_rede')::boolean
    and (select count(*) from sentinela.rede_fora) = n0);

  r := pg_temp.dec('192.0.2.50', 2, 'teste-rede-novo');
  select * into f from sentinela.rede_fora order by id desc limit 1;
  perform pg_temp.ok('R08 liberado: seguir com a liberação; grava "liberado" com liberacao_id',
    r->>'acao' = 'seguir' and (r->'liberado'->>'id')::bigint = l3
    and r->'liberado'->>'ate' = (select sentinela.iso(fim) from sentinela.rede_liberacoes where id = l3)
    and f.decisao = 'liberado' and f.liberacao_id = l3 and f.user_id = pg_temp.uid(2) and f.ip = '192.0.2.50'
    and f.origem = 'passe' and f.projeto = 'teste-rede-novo' and f.email = 'rede.teste.um@lube.com.br'
    and f.ua = 'Mozilla/5.0 teste', r::text);
  r := pg_temp.dec('192.0.2.50', 3, 'teste-rede-velho');
  select * into f from sentinela.rede_fora order by id desc limit 1;
  perform pg_temp.ok('R08 observar: acao observar, grava "observado"',
    r->>'acao' = 'observar' and r->>'modo' = 'observar' and f.decisao = 'observado' and f.projeto = 'teste-rede-velho', r::text);
  r := pg_temp.dec('192.0.2.50', 3, 'teste-rede-novo');
  select * into f from sentinela.rede_fora order by id desc limit 1;
  perform pg_temp.ok('R08 exigir: bloquear, grava "bloqueado"',
    r->>'acao' = 'bloquear' and r->'liberado' = 'null'::jsonb and f.decisao = 'bloqueado' and f.vezes = 1, r::text);
  select count(*) into n0 from sentinela.rede_fora;
  perform pg_temp.dec('192.0.2.50', 3, 'teste-rede-novo');
  perform pg_temp.ok('R08 repetição em 10 min soma "vezes" sem linha nova',
    (select count(*) from sentinela.rede_fora) = n0
    and (select vezes from sentinela.rede_fora where user_id = pg_temp.uid(3) and ip = '192.0.2.50'
            and projeto = 'teste-rede-novo' and decisao = 'bloqueado' and origem = 'passe') = 2);
  perform pg_temp.dec('192.0.2.50', 3, 'teste-rede-novo', 'portal');
  perform pg_temp.ok('R08 outra origem abre outra linha', (select count(*) from sentinela.rede_fora) = n0 + 1);
  r := pg_temp.dec(null, 3, 'teste-rede-novo');
  perform pg_temp.dec('lixo', 3, 'teste-rede-novo');
  perform pg_temp.ok('R08 IP nulo ou inválido = fora (bloquear), gravado com ip nulo',
    r->>'acao' = 'bloquear' and r->'ip' = 'null'::jsonb and r->'emergencia' = 'null'::jsonb
    and (select vezes from sentinela.rede_fora where ip is null and user_id = pg_temp.uid(3)) = 2, r::text);
  r := pg_temp.dec('192.0.2.50', 6, 'teste-rede-novo');
  perform pg_temp.ok('R08 liberação de perfil inativo não vale', r->>'acao' = 'bloquear', r::text);
  perform pg_temp.ok('R08 origem inválida e projeto desconhecido → 22023',
    pg_temp.erro('select public.sentinela_srv_rede_decidir(''192.0.2.50'', null, null, ''teste-rede-novo'', ''x'', null)')
      like '22023 sentinela: origem inválida%'
    and pg_temp.erro('select public.sentinela_srv_rede_decidir(''192.0.2.50'', null, null, ''nao-existe'', ''passe'', null)')
      like '22023 sentinela: projeto desconhecido%');
  r := pg_temp.dec('192.0.2.50', 2, 'painel-lube-distribuidora', 'portal');
  perform pg_temp.ok('R08 login no portal (observar) de quem está liberado: seguir com o aviso de liberado',
    r->>'acao' = 'seguir' and r->>'modo' = 'observar' and (r->'liberado'->>'id')::bigint = l3, r::text);

  -- emergência: só para admin fora, com 3 OUTRAS pessoas ativas barradas do mesmo IP em 2 h
  r := pg_temp.dec('192.0.2.77', 1, 'painel-lube-distribuidora', 'portal');
  perform pg_temp.ok('R08 admin fora sem provas: emergencia {possivel:false, pessoas:0}',
    r->'emergencia' = '{"possivel":false,"pessoas":0}'::jsonb and r->>'acao' = 'observar', r::text);
  perform pg_temp.ok('R08 não admin e admin dentro da rede: emergencia nula',
    pg_temp.dec('192.0.2.77', 2, 'painel-lube-distribuidora', 'portal')->'emergencia' = 'null'::jsonb
    and pg_temp.dec('203.0.113.7', 1, 'painel-lube-distribuidora', 'portal')->'emergencia' = 'null'::jsonb);
  perform pg_temp.dec('192.0.2.77', 3, 'teste-rede-novo');
  perform pg_temp.dec('192.0.2.77', 4, 'teste-rede-novo');
  r := pg_temp.dec('192.0.2.77', 1, 'painel-lube-distribuidora', 'portal');
  perform pg_temp.ok('R08 2 pessoas barradas: ainda não dá', r->'emergencia' = '{"possivel":false,"pessoas":2}'::jsonb, r::text);
  perform pg_temp.dec('192.0.2.77', 5, 'teste-rede-novo');
  perform pg_temp.dec('192.0.2.77', 6, 'teste-rede-novo');     -- perfil inativo não conta
  perform pg_temp.dec('192.0.2.77', 1, 'teste-rede-novo');     -- o próprio admin não conta
  r := pg_temp.dec('192.0.2.77', 1, 'painel-lube-distribuidora', 'portal');
  perform pg_temp.ok('R08 3 outras pessoas ativas barradas: possivel (inativo e o próprio admin não contam)',
    r->'emergencia' = '{"possivel":true,"pessoas":3}'::jsonb, r::text);
  update sentinela.rede_fora set ultimo_em = now() - interval '3 hours'
   where user_id = pg_temp.uid(5) and ip = '192.0.2.77';
  r := pg_temp.dec('192.0.2.77', 1, 'painel-lube-distribuidora', 'portal');
  perform pg_temp.ok('R08 barrado há mais de 2 h não conta', r->'emergencia' = '{"possivel":false,"pessoas":2}'::jsonb, r::text);
  update sentinela.rede_fora set ultimo_em = now() where user_id = pg_temp.uid(5) and ip = '192.0.2.77';
  -- IPv6: as pessoas do mesmo escritório têm endereços diferentes no mesmo /64
  perform pg_temp.dec('2001:db8:aaaa:1::5', 3, 'teste-rede-novo');
  perform pg_temp.dec('2001:db8:aaaa:1::6', 4, 'teste-rede-novo');
  perform pg_temp.dec('2001:db8:aaaa:1::7', 5, 'teste-rede-novo');
  r := pg_temp.dec('2001:db8:aaaa:1::9', 1, 'painel-lube-distribuidora', 'portal');
  perform pg_temp.ok('R08 IPv6: provas contam o /64 inteiro', r->'emergencia' = '{"possivel":true,"pessoas":3}'::jsonb, r::text);

  -- limpeza diária de rede_fora (retenção dos eventos)
  insert into sentinela.rede_fora (criado_em, ultimo_em, ip, user_id, email, origem, projeto, decisao)
  values (now() - interval '100 days', now() - interval '100 days', '192.0.2.31', pg_temp.uid(5), pg_temp.mail(5),
          'passe', 'teste-rede-novo', 'bloqueado');
  select count(*) into n0 from sentinela.rede_fora;
  update sentinela.rede_config set limpeza_em = now() - interval '2 days';
  perform pg_temp.dec('192.0.2.50', 3, 'supervisor-lube');
  perform pg_temp.ok('R08 limpeza: sai o que passou da retenção, fica o resto, marca limpeza_em',
    not exists (select 1 from sentinela.rede_fora where ip = '192.0.2.31')
    and (select count(*) from sentinela.rede_fora) = n0 - 1
    and (select limpeza_em = now() from sentinela.rede_config));
exception when others then
  perform pg_temp.postgres();
  perform pg_temp.ok('R08 (erro inesperado)', false, sqlstate || ': ' || sqlerrm);
end $$;

-- ---------------------------------------------------------
-- R09 srv_rede_emergencia
-- ---------------------------------------------------------
do $$
declare
  r jsonb;
  n0 int;
  x sentinela.redes;
  a sentinela.acoes_admin;
begin
  select count(*) into n0 from sentinela.redes;
  perform pg_temp.ok('R09 só administrador ativo',
    public.sentinela_srv_rede_emergencia('192.0.2.77', pg_temp.uid(2)) = '{"ok":false,"motivo":"so_admin"}'::jsonb
    and public.sentinela_srv_rede_emergencia('192.0.2.77', pg_temp.uid(6)) = '{"ok":false,"motivo":"so_admin"}'::jsonb
    and public.sentinela_srv_rede_emergencia('192.0.2.77', 'b0000000-0000-4000-8000-0000000000ff') = '{"ok":false,"motivo":"so_admin"}'::jsonb
    and public.sentinela_srv_rede_emergencia('192.0.2.77', null) = '{"ok":false,"motivo":"so_admin"}'::jsonb);
  perform pg_temp.ok('R09 IP inválido ou interno',
    public.sentinela_srv_rede_emergencia('lixo', pg_temp.uid(1)) = '{"ok":false,"motivo":"ip_invalido"}'::jsonb
    and public.sentinela_srv_rede_emergencia(null, pg_temp.uid(1)) = '{"ok":false,"motivo":"ip_invalido"}'::jsonb
    and public.sentinela_srv_rede_emergencia('10.0.0.5', pg_temp.uid(1)) = '{"ok":false,"motivo":"ip_invalido"}'::jsonb);
  perform pg_temp.ok('R09 IP já dentro de uma rede',
    public.sentinela_srv_rede_emergencia('203.0.113.7', pg_temp.uid(1)) = '{"ok":false,"motivo":"ja_cadastrada"}'::jsonb);
  perform pg_temp.ok('R09 sem provas (ninguém barrado deste IP)',
    public.sentinela_srv_rede_emergencia('192.0.2.99', pg_temp.uid(1)) = '{"ok":false,"motivo":"sem_provas","pessoas":0}'::jsonb
    and (select count(*) from sentinela.redes) = n0);
  r := public.sentinela_srv_rede_emergencia('192.0.2.77', pg_temp.uid(1));
  select * into x from sentinela.redes where id = (r->>'id')::bigint;
  select * into a from sentinela.acoes_admin order by id desc limit 1;
  perform pg_temp.ok('R09 com provas: cadastra o /32, origem emergência, e registra em acoes_admin',
    (r->>'ok')::boolean and r->>'rede' = '192.0.2.77/32' and x.origem = 'emergencia'
    and x.criado_por = 'rede.teste.admin@lube.com.br'
    and x.descricao = 'emergência: IP novo do escritório (3 pessoas barradas)'
    and a.acao = 'rede_emergencia' and a.email = 'rede.teste.admin@lube.com.br' and a.dados->>'pessoas' = '3'
    and a.dados->>'rede' = '192.0.2.77/32' and jsonb_array_length(a.dados->'emails') = 3, r::text);
  perform pg_temp.ok('R09 depois disso o IP está na rede; repetir → ja_cadastrada',
    (pg_temp.dec('192.0.2.77', 3, 'teste-rede-novo')->>'na_rede')::boolean
    and pg_temp.dec('192.0.2.77', 3, 'teste-rede-novo')->>'acao' = 'seguir'
    and public.sentinela_srv_rede_emergencia('192.0.2.77', pg_temp.uid(1)) = '{"ok":false,"motivo":"ja_cadastrada"}'::jsonb);
  r := public.sentinela_srv_rede_emergencia('2001:db8:aaaa:1::9', pg_temp.uid(1));
  perform pg_temp.ok('R09 IPv6 entra como /64', (r->>'ok')::boolean and r->>'rede' = '2001:db8:aaaa:1::/64', r::text);
exception when others then
  perform pg_temp.postgres();
  perform pg_temp.ok('R09 (erro inesperado)', false, sqlstate || ': ' || sqlerrm);
end $$;

-- ---------------------------------------------------------
-- R11 emergência por SQL
-- ---------------------------------------------------------
do $$
declare
  t text;
  v_sql text;
  v_ok int := 0;
begin
  t := sentinela.emergencia_rede('192.0.2.200');
  perform pg_temp.ok('R11 emergencia_rede cadastra e diz em quanto tempo vale',
    t like 'rede #% cadastrada: 192.0.2.200/32 (vale em até 30 s)'
    and (select origem = 'emergencia' and criado_por = 'sql-emergencia' and descricao = 'emergência: IP novo do escritório'
           from sentinela.redes where rede = '192.0.2.200/32' and removido_em is null)
    and (select acao from sentinela.acoes_admin order by id desc limit 1) = 'rede_emergencia_sql', t);
  t := sentinela.emergencia_rede('192.0.2.200', 'de novo');
  perform pg_temp.ok('R11 emergencia_rede repetida não duplica', t like 'já coberta pela rede #% (192.0.2.200/32): nada mudou'
    and (select count(*) from sentinela.redes where rede = '192.0.2.200/32') = 1, t);
  perform pg_temp.ok('R11 emergencia_rede com IP interno → 22023',
    pg_temp.erro('select sentinela.emergencia_rede(''10.0.0.1'')') like '22023 sentinela: "10.0.0.1" é um IP interno%');
  -- IPv6 sem máscara (o ip do /.sentinela/saude): cadastra o /64, como o botão do portal
  t := sentinela.emergencia_rede('2001:db8:bbbb:2::15', 'escritório em IPv6');
  perform pg_temp.ok('R11 emergencia_rede com IPv6 solto cadastra o /64 inteiro (os outros computadores do escritório entram)',
    t like 'rede #% cadastrada: 2001:db8:bbbb:2::/64 (vale em até 30 s)'
    and sentinela.rede_que_contem('2001:db8:bbbb:2:abcd::1') is not null
    and sentinela.emergencia_rede('::ffff:192.0.2.200') like 'já coberta pela rede #% (192.0.2.200/32): nada mudou', t);
  t := sentinela.emergencia_pausar_rede();
  perform pg_temp.ok('R11 emergencia_pausar_rede: todo exigir vira observar e diz quais',
    t = '2 sistemas passaram de exigir para observar: teste-rede-inativo, teste-rede-novo'
    and not exists (select 1 from sentinela.rede_sistemas where modo = 'exigir')
    and (select modo_por from sentinela.rede_sistemas where projeto_id = 'prj_teste_rede_novo') = 'sql-emergencia', t);
  perform pg_temp.ok('R11 pausar sem nada exigindo', sentinela.emergencia_pausar_rede() = 'nenhum sistema estava exigindo a rede');
  t := sentinela.emergencia_liberar('Rede.Teste.Tres@lube.com.br', 12);
  perform pg_temp.ok('R11 emergencia_liberar: até 12 h para perfil ativo',
    t like 'liberação #%: rede.teste.tres@lube.com.br até % (horário de Brasília)'
    and (sentinela.liberacao_ativa(pg_temp.uid(4))).fim = now() + interval '12 hours'
    and (sentinela.liberacao_ativa(pg_temp.uid(4))).criado_por = 'sql-emergencia', t);
  perform pg_temp.ok('R11 emergencia_liberar recusa horas fora de 1–72, e-mail desconhecido e perfil inativo',
    pg_temp.erro('select sentinela.emergencia_liberar(''rede.teste.tres@lube.com.br'', 100)') like '22023 %'
    and pg_temp.erro('select sentinela.emergencia_liberar(''ninguem.rede.teste@lube.com.br'')') like '22023 %'
    and pg_temp.erro('select sentinela.emergencia_liberar(''rede.teste.inativo@lube.com.br'')') like '22023 %');
  foreach v_sql in array array['select sentinela.emergencia_rede(''192.0.2.201'')', 'select sentinela.emergencia_pausar_rede()',
                               'select sentinela.emergencia_liberar(''rede.teste.um@lube.com.br'')'] loop
    perform pg_temp.como(pg_temp.uid(1), 'rede.teste.admin@lube.com.br');
    if pg_temp.erro(v_sql) like '42501 %' then v_ok := v_ok + 1; end if;
    perform pg_temp.como(null, null, 'service_role');
    if pg_temp.erro(v_sql) like '42501 %' then v_ok := v_ok + 1; end if;
  end loop;
  perform pg_temp.postgres();
  perform pg_temp.ok('R11 as três dão 42501 como authenticated (admin) e service_role', v_ok = 6, format('ok=%s', v_ok));
exception when others then
  perform pg_temp.postgres();
  perform pg_temp.ok('R11 (erro inesperado)', false, sqlstate || ': ' || sqlerrm);
end $$;

-- ---------------------------------------------------------
-- R12 acoes_admin: cada ação aceita grava uma linha; recusada não grava
-- ---------------------------------------------------------
do $$
declare
  v_ini bigint := (select acao_id from pg_temp.rede_teste_inicio);
  v_esperado jsonb;
  v_gravado jsonb;
  a sentinela.acoes_admin;
begin
  select jsonb_object_agg(x.acao, x.n) into v_esperado
    from (select case acao when 'liberar' then 'rede_liberar' when 'encerrar' then 'rede_encerrar' else acao end as acao,
                 count(*) as n
            from pg_temp.rede_teste_aceitas group by 1) x;
  select jsonb_object_agg(x.acao, x.n) into v_gravado
    from (select a2.acao, count(*) as n from sentinela.acoes_admin a2
           where a2.id > v_ini and a2.acao in ('rede_nova','rede_remover','rede_modo','rede_liberar','rede_encerrar')
           group by 1) x;
  perform pg_temp.ok('R12 uma linha em acoes_admin por ação aceita do painel (recusadas não gravam)',
    v_esperado = v_gravado, format('esperado=%s gravado=%s', v_esperado, v_gravado));
  perform pg_temp.ok('R12 emergências registradas (2 pelo portal, 2 redes, 2 pausas e 1 liberação por SQL)',
    (select count(*) from sentinela.acoes_admin where id > v_ini and acao = 'rede_emergencia') = 2
    and (select count(*) from sentinela.acoes_admin where id > v_ini and acao = 'rede_emergencia_sql') = 2
    and (select count(*) from sentinela.acoes_admin where id > v_ini and acao = 'rede_pausar_sql') = 2
    and (select count(*) from sentinela.acoes_admin where id > v_ini and acao = 'rede_liberar_sql') = 1);
  perform pg_temp.adm('rede_nova', '{"rede":"192.0.2.240","descricao":"Registro teste"}');
  select * into a from sentinela.acoes_admin order by id desc limit 1;
  perform pg_temp.ok('R12 a linha leva quem fez, a ação, os dados enviados e o IP de onde o admin fez (pela central)',
    a.acao = 'rede_nova' and a.email = 'rede.teste.admin@lube.com.br'
    and a.dados = '{"rede":"192.0.2.240","descricao":"Registro teste","ip_admin":"203.0.113.7"}'::jsonb, a.dados::text);
exception when others then
  perform pg_temp.postgres();
  perform pg_temp.ok('R12 (erro inesperado)', false, sqlstate || ': ' || sqlerrm);
end $$;

-- ---------------------------------------------------------
-- R16 senha de administrador, de fora, não afrouxa a regra: com sistema exigindo, cadastrar
--     rede, liberar pessoa, observar e desligar só pela central e de dentro de uma rede da Lube
--     (ou com liberação). Direto pelo banco (PostgREST) o banco não sabe o IP: recusa. Apertar
--     (remover rede, encerrar, exigir) vale de qualquer lugar. Deixa tudo como encontrou.
-- ---------------------------------------------------------
do $$
declare
  r jsonb;
  v text;
  m text := null;
  c jsonb;
  n_acoes bigint;
  n_redes int;
  n_libs int;
  v_lib bigint;
  v_rede bigint;
  v_fora constant text := '192.0.2.250';
  p jsonb;
  s jsonb;
begin
  -- o R11 pausou tudo (exigir → observar): volta a exigir no teste-rede-novo (apertar vale de qualquer lugar)
  perform pg_temp.adm('rede_modo', '{"projeto":"teste-rede-novo","modo":"exigir"}', '192.0.2.250');
  perform pg_temp.ok('R16 (preparo) teste-rede-novo exigindo e o escritório de teste é rede da Lube',
    sentinela.rede_trava() and sentinela.rede_que_contem('203.0.113.7') is not null
    and sentinela.rede_que_contem(v_fora::inet) is null and (sentinela.liberacao_ativa(pg_temp.uid(1))).id is null);
  perform pg_temp.ok('R16 rede_afrouxa: rede nova, liberar, observar e desligar afrouxam; remover, encerrar e exigir não',
    sentinela.rede_afrouxa('rede_nova', '{}') and sentinela.rede_afrouxa('liberar', '{}')
    and sentinela.rede_afrouxa('rede_modo', '{"modo":"observar"}') and sentinela.rede_afrouxa('rede_modo', '{"modo":"desligado"}')
    and sentinela.rede_afrouxa('rede_modo', '{}') and not sentinela.rede_afrouxa('rede_modo', '{"modo":"exigir"}')
    and not sentinela.rede_afrouxa('rede_remover', '{}') and not sentinela.rede_afrouxa('encerrar', '{}')
    and not sentinela.rede_afrouxa(null, null));

  n_acoes := (select max(id) from sentinela.acoes_admin);
  n_redes := (select count(*) from sentinela.redes);
  n_libs := (select count(*) from sentinela.rede_liberacoes);
  -- 1. direto pelo banco, como admin: afrouxar → 42501, nada gravado
  foreach c in array array[
    jsonb_build_object('a', 'rede_nova', 'd', jsonb_build_object('rede', '192.0.2.251', 'descricao', 'casa do admin')),
    jsonb_build_object('a', 'liberar', 'd', jsonb_build_object('user_id', pg_temp.uid(1), 'fim', now() + interval '30 days', 'motivo', 'trabalho de casa')),
    jsonb_build_object('a', 'rede_modo', 'd', jsonb_build_object('projeto', 'teste-rede-novo', 'modo', 'observar')),
    jsonb_build_object('a', 'rede_modo', 'd', jsonb_build_object('projeto', 'teste-rede-novo', 'modo', 'desligado')),
    jsonb_build_object('a', 'rede_modo', 'd', jsonb_build_object('projeto', '*', 'modo', 'desligado'))] loop
    v := pg_temp.erro(format('select pg_temp.adm_direto(%L, %L::jsonb)', c->>'a', c->'d'));
    if v not like '42501 sentinela: com sistema exigindo a rede, cadastrar rede, liberar pessoa, observar e desligar passam pela central%' then
      m := coalesce(m, '') || c::text || ' → ' || v || '; ';
    end if;
  end loop;
  perform pg_temp.ok('R16 direto pelo banco, com sistema exigindo: as 5 formas de afrouxar dão 42501 e nada muda',
    m is null and (select max(id) from sentinela.acoes_admin) = n_acoes and (select count(*) from sentinela.redes) = n_redes
    and (select count(*) from sentinela.rede_liberacoes) = n_libs and sentinela.rede_modo('teste-rede-novo') = 'exigir', m);

  -- 2. pela central, de fora (sem rede e sem liberação): afrouxar recusado com o motivo, nada gravado
  m := null;
  foreach c in array array[
    jsonb_build_object('a', 'rede_nova', 'd', jsonb_build_object('rede', v_fora, 'descricao', 'casa do admin')),
    jsonb_build_object('a', 'liberar', 'd', jsonb_build_object('user_id', pg_temp.uid(1), 'fim', now() + interval '30 days', 'motivo', 'trabalho de casa')),
    jsonb_build_object('a', 'rede_modo', 'd', jsonb_build_object('projeto', 'teste-rede-novo', 'modo', 'observar')),
    jsonb_build_object('a', 'rede_modo', 'd', jsonb_build_object('projeto', '*', 'modo', 'desligado'))] loop
    perform pg_temp.como(null, null, 'service_role');
    r := public.sentinela_srv_rede_acao(pg_temp.uid(1), v_fora, c->>'a', c->'d');
    perform pg_temp.postgres();
    if not (r->>'ok' = 'false' and r->>'codigo' = '42501' and r->>'erro' like 'sentinela: você está fora da rede da Lube:%') then
      m := coalesce(m, '') || c::text || ' → ' || r::text || '; ';
    end if;
  end loop;
  -- IP nulo (a central não leu o IP) também é fora
  perform pg_temp.como(null, null, 'service_role');
  r := public.sentinela_srv_rede_acao(pg_temp.uid(1), null, 'rede_nova', jsonb_build_object('rede', v_fora, 'descricao', 'casa do admin'));
  perform pg_temp.postgres();
  perform pg_temp.ok('R16 pela central, de fora e sem liberação: as 4 formas de afrouxar (e IP nulo) recusadas, nada gravado',
    m is null and r->>'codigo' = '42501' and (select max(id) from sentinela.acoes_admin) = n_acoes
    and (select count(*) from sentinela.redes) = n_redes and (select count(*) from sentinela.rede_liberacoes) = n_libs
    and sentinela.rede_modo('teste-rede-novo') = 'exigir', coalesce(m, r::text));

  -- 3. apertar vale de fora e direto pelo banco: exigir (nada a alterar), remover uma rede que não é a última
  r := pg_temp.adm('rede_modo', '{"projeto":"teste-rede-novo","modo":"exigir"}', v_fora);
  perform pg_temp.ok('R16 de fora, exigir passa (nada a alterar)', (r->>'ok')::boolean and r->'alterados' = '[]'::jsonb, r::text);
  r := pg_temp.adm('rede_nova', '{"rede":"192.0.2.252","descricao":"rede de teste R16"}');      -- de dentro
  v_rede := (r->>'id')::bigint;
  r := pg_temp.adm_direto('rede_remover', jsonb_build_object('id', v_rede));
  perform pg_temp.ok('R16 de dentro cadastra; direto pelo banco, remover passa', (r->>'ok')::boolean
    and (select removido_em is not null from sentinela.redes where id = v_rede), r::text);

  -- 4. liberado pelo TI: de fora, afrouxa (o TI à noite cadastrando o IP novo do escritório)
  r := pg_temp.adm('liberar', jsonb_build_object('user_id', pg_temp.uid(1), 'fim', now() + interval '12 hours', 'motivo', 'TI de plantão'));
  v_lib := (r->>'id')::bigint;
  r := pg_temp.adm('rede_nova', jsonb_build_object('rede', '192.0.2.253', 'descricao', 'link reserva (R16)'), v_fora);
  v_rede := (r->>'id')::bigint;
  perform pg_temp.ok('R16 admin liberado, de fora: cadastra a rede e o registro leva o IP de onde fez',
    (r->>'ok')::boolean and (select a.dados->>'ip_admin' from sentinela.acoes_admin a order by a.id desc limit 1) = v_fora, r::text);
  -- encerrar a liberação vale de fora e direto pelo banco
  r := pg_temp.adm_direto('encerrar', jsonb_build_object('id', v_lib));
  perform pg_temp.ok('R16 direto pelo banco, encerrar passa', (r->>'ok')::boolean, r::text);
  r := pg_temp.adm('rede_remover', jsonb_build_object('id', v_rede), v_fora);
  perform pg_temp.ok('R16 de fora, remover passa', (r->>'ok')::boolean, r::text);

  -- 5. sem sistema exigindo, afrouxar direto pelo banco volta a valer (fase de observar)
  update sentinela.rede_sistemas set modo = 'observar' where projeto_id = 'prj_teste_rede_novo';
  r := pg_temp.adm_direto('rede_nova', '{"rede":"192.0.2.254","descricao":"sem trava (R16)"}');
  v_rede := (r->>'id')::bigint;
  perform pg_temp.ok('R16 sem sistema exigindo, direto pelo banco cadastra (e sem IP no registro)',
    not sentinela.rede_trava() and (r->>'ok')::boolean
    and (select a.dados ? 'ip_admin' from sentinela.acoes_admin a order by a.id desc limit 1) = false, r::text);
  perform pg_temp.adm_direto('rede_remover', jsonb_build_object('id', v_rede));
  update sentinela.rede_sistemas set modo = 'exigir' where projeto_id = 'prj_teste_rede_novo';

  -- 6. só administrador ativo, e as recusas do executor chegam com o SQLSTATE
  perform pg_temp.como(null, null, 'service_role');
  r := jsonb_build_array(
    public.sentinela_srv_rede_acao(pg_temp.uid(2), '203.0.113.7', 'encerrar', '{"id":1}'),
    public.sentinela_srv_rede_acao(pg_temp.uid(6), '203.0.113.7', 'encerrar', '{"id":1}'),
    public.sentinela_srv_rede_acao(null, '203.0.113.7', 'encerrar', '{"id":1}'),
    public.sentinela_srv_rede_acao(pg_temp.uid(1), '203.0.113.7', 'encerrar', '{"id":"x"}'),
    public.sentinela_srv_rede_acao(pg_temp.uid(1), '203.0.113.7', 'encerrar', '{"id":999999999}'),
    public.sentinela_srv_rede_acao(pg_temp.uid(1), '203.0.113.7', 'xpto', '{}'),
    public.sentinela_srv_rede_acao(pg_temp.uid(1), '203.0.113.7', 'rede_nova', '"texto"'));
  perform pg_temp.postgres();
  perform pg_temp.ok('R16 pela central: não admin, inativo e sem usuário → 42501; validação 22023 e P0002 voltam em JSON',
    r->0 = '{"ok":false,"codigo":"42501","erro":"sentinela: acesso restrito ao TI"}'::jsonb
    and r->1 = r->0 and r->2 = r->0
    and r->3 = '{"ok":false,"codigo":"22023","erro":"sentinela: id inválido"}'::jsonb
    and r->4->>'codigo' = 'P0002' and r->4->>'erro' like 'sentinela: liberação não encontrada%'
    and r->5 = '{"ok":false,"codigo":"22023","erro":"sentinela: ação desconhecida"}'::jsonb
    and r->6->>'codigo' = '22023', r::text);

  -- 7. Instant Rollback de um sistema exigindo (guarda volta ao 1.2.0): o painel mostra em vermelho
  insert into sentinela.rede_sistemas (projeto_id, modo) values ('prj_teste_rede_velho', 'exigir')
  on conflict (projeto_id) do update set modo = 'exigir';
  perform pg_temp.como(pg_temp.uid(1), 'rede.teste.admin@lube.com.br');
  p := public.sentinela_rede_painel(1);
  perform pg_temp.postgres();
  select x into s from jsonb_array_elements(p->'sistemas') x where x->>'projeto' = 'teste-rede-velho';
  perform pg_temp.ok('R16 sistema exigindo sem o guarda 1.3.0 em produção: guarda_rede false e contado em exigir_sem_guarda',
    s->>'modo' = 'exigir' and s->'guarda_rede' = 'false'::jsonb and s->>'ultimo_ambiente' = 'production'
    and (p->'contagens'->>'exigir_sem_guarda')::int = 1
    and (select x->'guarda_rede' from jsonb_array_elements(p->'sistemas') x where x->>'projeto' = 'teste-rede-previa') = 'false'::jsonb
    and (select x->'guarda_rede' from jsonb_array_elements(p->'sistemas') x where x->>'projeto' = 'teste-rede-novo') = 'true'::jsonb,
    coalesce(s::text, 'sem linha') || ' ' || (p->'contagens')::text);
  -- como o R11 deixou: tudo em observar
  update sentinela.rede_sistemas set modo = 'observar' where projeto_id in ('prj_teste_rede_velho', 'prj_teste_rede_novo');
exception when others then
  perform pg_temp.postgres();
  perform pg_temp.ok('R16 (erro inesperado)', false, sqlstate || ': ' || sqlerrm);
end $$;

-- ---------------------------------------------------------
-- R13 nada do que já existia mudou (catálogo tocado só nos objetos novos)
-- ---------------------------------------------------------
do $$
declare
  v_novas text[] := array[
    'public.sentinela_rede_acao', 'public.sentinela_rede_painel', 'public.sentinela_srv_rede_acao', 'public.sentinela_srv_rede_decidir',
    'public.sentinela_srv_rede_emergencia', 'public.sentinela_srv_rede_lista',
    'sentinela.email_hash', 'sentinela.emergencia_liberar', 'sentinela.emergencia_pausar_rede', 'sentinela.emergencia_rede',
    'sentinela.guarda_tem_rede', 'sentinela.liberacao_ativa', 'sentinela.rede_acao_exec', 'sentinela.rede_afrouxa',
    'sentinela.rede_fora_gravar', 'sentinela.rede_limpeza',
    'sentinela.rede_lube_valida', 'sentinela.rede_modo', 'sentinela.rede_modo_efetivo', 'sentinela.rede_provas',
    'sentinela.rede_que_contem', 'sentinela.rede_trava', 'sentinela.so_sql_editor'];
  v_mudadas text[];
  v_rel text[];
  v_n int;
begin
  select array_agg(n.nspname || '.' || p.proname order by n.nspname || '.' || p.proname) into v_mudadas
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where (n.nspname = 'sentinela' or (n.nspname = 'public' and p.proname like 'sentinela%'))
     and pg_temp.desta_tx(p.xmin);
  perform pg_temp.ok('R13 funções criadas/mudadas nesta transação = só as 23 novas (nenhuma das de hoje)',
    (select array_agg(u order by u collate "C") from unnest(v_mudadas) u)
      = (select array_agg(u order by u collate "C") from unnest(v_novas) u),
    array_to_string(v_mudadas, ', '));
  perform pg_temp.ok('R13 as funções de hoje continuam lá (25 em public, 32 em sentinela)',
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname like 'sentinela%' and not pg_temp.desta_tx(p.xmin)) = 25
    and (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'sentinela' and not pg_temp.desta_tx(p.xmin)) = 32);
  select array_agg(c.relname::text order by c.relname) into v_rel
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'sentinela' and pg_temp.desta_tx(c.xmin) and c.relname not like 'rede%';
  perform pg_temp.ok('R13 nenhuma tabela, índice ou sequência de hoje foi alterada (pg_class)', v_rel is null, v_rel::text);
  select count(*) into v_n
    from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'sentinela' and pg_temp.desta_tx(t.xmin);
  perform pg_temp.ok('R13 nenhum gatilho novo ou mudado', v_n = 0, v_n::text);
  select array_agg(co.conname::text) into v_rel
    from pg_constraint co join pg_class c on c.oid = co.conrelid join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'sentinela' and pg_temp.desta_tx(co.xmin) and c.relname not like 'rede%';
  perform pg_temp.ok('R13 nenhuma restrição em tabela de hoje', v_rel is null, v_rel::text);
  perform pg_temp.ok('R13 colunas das tabelas de hoje intactas (sem coluna nova em sistemas e config)',
    not exists (select 1 from pg_attribute at join pg_class c on c.oid = at.attrelid join pg_namespace n on n.oid = c.relnamespace
                 where n.nspname = 'sentinela' and c.relname not like 'rede%' and pg_temp.desta_tx(at.xmin)));
exception when others then
  perform pg_temp.postgres();
  perform pg_temp.ok('R13 (erro inesperado)', false, sqlstate || ': ' || sqlerrm);
end $$;

-- ---------------------------------------------------------
-- R10 painel (com eventos dos guardas). Fica no fim: gravar evento trava a cadeia de selos
-- até o rollback.
-- ---------------------------------------------------------
do $$
declare
  r jsonb;
  p jsonb;
  g jsonb;
  s jsonb;
  l3 bigint := (select id from pg_temp.rede_teste_ids where nome = 'l3');
  v_mail2 text := pg_temp.mail(2);
  v_mail3 text := pg_temp.mail(3);
  v_mail4 text := pg_temp.mail(4);
  v_mail5 text := pg_temp.mail(5);
begin
  perform pg_temp.adm('rede_modo', '{"projeto":"teste-rede-novo","modo":"exigir"}');
  -- portal: login de B4 de 192.0.2.122 ontem (segundo dia da sugestão)
  insert into sentinela.identidades (ip, user_id, email, origem, ua, criado_em)
  values ('192.0.2.122', pg_temp.uid(4), v_mail4, 'portal', 'teste', now() - interval '1 day');
  r := public.sentinela_srv_registrar('teste-rede-novo', 'production', 'sentinela-guarda/1.3.0', 'nodejs', jsonb_build_array(
    pg_temp.ev('192.0.2.120', jsonb_build_object('identidade', v_mail3, 'identidade_origem', 'passe', 'decisao', 'bloqueado',
                                                 'regra', 'fora_da_rede', 'motivo', 'fora da rede da Lube')),
    pg_temp.ev('192.0.2.120', jsonb_build_object('identidade', v_mail4, 'identidade_origem', 'passe', 'decisao', 'bloqueado',
                                                 'regra', 'fora_da_rede', 'motivo', 'fora da rede da Lube')),
    pg_temp.ev('192.0.2.120', jsonb_build_object('identidade', v_mail5, 'identidade_origem', 'passe', 'decisao', 'bloqueado',
                                                 'regra', 'fora_da_rede', 'motivo', 'fora da rede da Lube')),
    pg_temp.ev('192.0.2.121', jsonb_build_object('identidade', v_mail2, 'identidade_origem', 'passe', 'decisao', 'liberado',
                                                 'regra', 'rede_liberado', 'motivo', 'fora da rede da Lube · liberado pelo TI')),
    pg_temp.ev('192.0.2.122', jsonb_build_object('identidade', v_mail4, 'identidade_origem', 'passe')),
    pg_temp.ev('192.0.2.122', jsonb_build_object('identidade', v_mail5, 'identidade_origem', 'passe')),
    pg_temp.ev('192.0.2.123', jsonb_build_object('identidade', 'robo do teste (agendador)', 'identidade_origem', 'sessao_app',
                                                 'regra', 'rede_maquina', 'tipo', 'api', 'ua', 'vercel-cron/1.0')),
    pg_temp.ev('192.0.2.123', jsonb_build_object('identidade', 'robo do teste (agendador)', 'identidade_origem', 'sessao_app',
                                                 'tipo', 'api', 'ua', 'vercel-cron/1.0')),
    pg_temp.ev('203.0.113.7', jsonb_build_object('identidade', v_mail4, 'identidade_origem', 'passe')),
    pg_temp.ev('192.0.2.124', jsonb_build_object('decisao', 'observado', 'regra', 'fora_da_rede', 'tipo', 'api',
                                                 'motivo', 'seria bloqueado: fora da rede da Lube')),
    pg_temp.ev('2001:db8:10::99', jsonb_build_object('identidade', v_mail2, 'identidade_origem', 'passe'))));
  perform pg_temp.ok('R10 (preparo) 11 eventos de teste gravados pelo srv_registrar', (r->>'gravados')::int = 11, r::text);

  perform pg_temp.como(pg_temp.uid(1), 'rede.teste.admin@lube.com.br');
  p := public.sentinela_rede_painel(14);
  perform pg_temp.postgres();

  perform pg_temp.ok('R10 formato do painel',
    (select array_agg(k order by k) from jsonb_object_keys(p) k)
      = array['agora','contagens','dias','fora','liberacoes','max_dias','pessoas','redes','sistemas','sugestoes']
    and p->'dias' = '14'::jsonb and p->'max_dias' = '30'::jsonb
    and (select array_agg(k order by k collate "C") from jsonb_object_keys(p->'contagens') k)
      = array['barrados_24h','desligado','exigir','exigir_sem_guarda','isentos','liberacoes_ativas','observar',
              'pessoas_barradas_24h','pessoas_seriam_24h','redes','seriam_barrados_24h']);

  select x into g from jsonb_array_elements(p->'fora') x where x->>'email' = v_mail3 and x->>'ip' = '192.0.2.120';
  perform pg_temp.ok('R10 fora: barrado pelo guarda, por pessoa e IP, com local e sistemas',
    g->>'situacao' = 'barrado' and (g->>'barrados')::int = 1 and g->>'cidade' = 'Cariacica'
    and g->'projetos' = '["teste-rede-novo"]'::jsonb and g->>'nome' = 'Rede Dois'
    and (g->>'user_id')::uuid = pg_temp.uid(3) and (g->>'pessoas_no_ip')::int = 3, g::text);
  select x into g from jsonb_array_elements(p->'fora') x where x->>'email' = v_mail2 and x->>'ip' = '192.0.2.121';
  perform pg_temp.ok('R10 fora: liberado pelo TI, com a liberação aberta',
    g->>'situacao' = 'liberado' and (g->'liberacao'->>'id')::bigint = l3, g::text);
  perform pg_temp.ok('R10 fora: prévia "regra_desligada" para pessoa fora de toda rede, 2 pessoas no IP',
    (select count(*) from jsonb_array_elements(p->'fora') x
      where x->>'ip' = '192.0.2.122' and x->>'situacao' = 'regra_desligada' and (x->>'pessoas_no_ip')::int = 2
        and x->>'email' in (v_mail4, v_mail5)) = 2);
  select x into g from jsonb_array_elements(p->'fora') x where x->>'ip' = '192.0.2.124';
  perform pg_temp.ok('R10 fora: acesso sem login aparece como "sem login" (email nulo), seria barrado',
    g->'email' = 'null'::jsonb and g->>'situacao' = 'seria_barrado' and g->'user_id' = 'null'::jsonb, g::text);
  perform pg_temp.ok('R10 fora: robô nunca entra; acesso de dentro da rede (IPv4 e IPv6) também não',
    not exists (select 1 from jsonb_array_elements(p->'fora') x
                 where x->>'ip' in ('192.0.2.123', '203.0.113.7', '2001:db8:10::99') or x->>'email' like 'robo%'));
  select x into g from jsonb_array_elements(p->'fora') x where x->>'email' = v_mail3 and x->>'ip' = '192.0.2.50';
  perform pg_temp.ok('R10 fora: o que só a central viu (rede_fora) entra somando "vezes"',
    (g->>'barrados')::int = 3 and (g->>'observados')::int = 1 and g->>'situacao' = 'barrado'
    and g->'projetos' = '["teste-rede-novo","teste-rede-velho"]'::jsonb, g::text);

  select x into g from jsonb_array_elements(p->'sugestoes') x where x->>'ip' = '192.0.2.122';
  perform pg_temp.ok('R10 sugestão "isto é uma rede da Lube?": 2 pessoas em 2 dias, com a cidade',
    (g->>'pessoas')::int = 2 and (g->>'dias')::int = 2 and g->>'cidade' = 'Cariacica', g::text);
  perform pg_temp.ok('R10 sem sugestão para IP de 1 dia só, robô ou IP já cadastrado',
    not exists (select 1 from jsonb_array_elements(p->'sugestoes') x
                 where x->>'ip' in ('192.0.2.120', '192.0.2.123', '203.0.113.7', '192.0.2.124')));

  select x into s from jsonb_array_elements(p->'sistemas') x where x->>'projeto' = 'teste-rede-novo';
  perform pg_temp.ok('R10 sistemas: modo, guarda com a regra, e o resumo de fora',
    s->>'modo' = 'exigir' and s->>'modo_efetivo' = 'exigir' and (s->>'guarda_rede')::boolean and not (s->>'isento')::boolean
    and s->>'modo_por' = 'rede.teste.admin@lube.com.br'
    and (s->'fora'->>'barrados')::int >= 3 and (s->'fora'->>'pessoas')::int >= 3 and (s->'fora'->>'liberados')::int >= 2, s::text);
  perform pg_temp.ok('R10 sistemas: guarda velho sem a regra; SAC isento e desligado; Reposições na lista',
    (select not (x->>'guarda_rede')::boolean from jsonb_array_elements(p->'sistemas') x where x->>'projeto' = 'teste-rede-velho')
    and (select (x->>'isento')::boolean and x->>'modo' = 'desligado' from jsonb_array_elements(p->'sistemas') x where x->>'projeto' = 'sac-lube')
    and exists (select 1 from jsonb_array_elements(p->'sistemas') x where x->>'projeto' = 'reposicoes-web' and x->'guarda_versao' = 'null'::jsonb));

  -- entradas: 1 evento do guarda (rede_liberado) + 3 vistas pela central no R08 (passe e portal de
  -- 192.0.2.50, portal de 192.0.2.77)
  select x into g from jsonb_array_elements(p->'liberacoes') x where (x->>'id')::bigint = l3;
  perform pg_temp.ok('R10 liberações: ativa com as entradas de fora (guarda + central)',
    g->>'estado' = 'ativa' and (g->>'entradas')::int = 4 and g->>'nome' = 'Rede Um' and g->>'motivo' = 'viagem prorrogada'
    and (g->>'perfil_ativo')::boolean, g::text);
  perform pg_temp.ok('R10 liberações: agendada, encerrada, substituída e vencida aparecem com o estado certo',
    (select jsonb_object_agg(t.nome, x->>'estado') from pg_temp.rede_teste_ids t
       join jsonb_array_elements(p->'liberacoes') x on (x->>'id')::bigint = t.id
      where t.nome in ('l1','l2','l4','l5'))
    = '{"l1":"encerrada","l2":"agendada","l4":"encerrada","l5":"vencida"}'::jsonb);
  perform pg_temp.ok('R10 pessoas: perfis ativos (inativo fica de fora)',
    exists (select 1 from jsonb_array_elements(p->'pessoas') x where (x->>'id')::uuid = pg_temp.uid(2))
    and not exists (select 1 from jsonb_array_elements(p->'pessoas') x where (x->>'id')::uuid = pg_temp.uid(6)));
  select x into g from jsonb_array_elements(p->'redes') x where x->>'rede' = '203.0.113.7/32';
  perform pg_temp.ok('R10 redes: uso na janela (acessos e pessoas)',
    (g->>'acessos')::int >= 1 and (g->>'pessoas')::int >= 1 and g->>'descricao' = 'Escritório teste', g::text);
  perform pg_temp.ok('R10 contagens',
    (p->'contagens'->>'redes')::int = (select count(*) from sentinela.redes where removido_em is null)
    and (p->'contagens'->>'liberacoes_ativas')::int = 2
    and (p->'contagens'->>'exigir')::int = 1 and (p->'contagens'->>'isentos')::int = 3
    and (p->'contagens'->>'barrados_24h')::int >= 3 and (p->'contagens'->>'pessoas_barradas_24h')::int >= 3
    and (p->'contagens'->>'seriam_barrados_24h')::int >= 2 and (p->'contagens'->>'pessoas_seriam_24h')::int >= 1
    and (p->'contagens'->>'exigir_sem_guarda')::int = 0, (p->'contagens')::text);

  r := pg_temp.dec('192.0.2.120', 1, 'painel-lube-distribuidora', 'portal');
  perform pg_temp.ok('R10 provas da emergência também vêm dos eventos do guarda (3 pessoas barradas)',
    r->'emergencia' = '{"possivel":true,"pessoas":3}'::jsonb, r::text);

  perform pg_temp.como(pg_temp.uid(1), 'rede.teste.admin@lube.com.br');
  r := jsonb_build_array(public.sentinela_rede_painel(0)->'dias', public.sentinela_rede_painel(1000)->'dias');
  perform pg_temp.postgres();
  perform pg_temp.ok('R10 p_dias fora de 1–90 é ajustado', r = '[1, 90]'::jsonb, r::text);
exception when others then
  perform pg_temp.postgres();
  perform pg_temp.ok('R10 (erro inesperado)', false, sqlstate || ': ' || sqlerrm);
end $$;

-- ---------------------------------------------------------
-- R15 ponta a ponta, na ordem em que acontece: o TI cadastra a rede e liga o exigir no
--     Reposições; de fora, a permissão sai mas a central nega o passe e a tentativa fica
--     registrada; o TI vê, libera a pessoa (a lista do guarda leva só o SHA-256), encerra;
--     dentro da rede segue; e o login no portal em observar e em exigir.
--     Só mexe em linha criada nesta transação ou em tabela nova (não trava nada de hoje).
-- ---------------------------------------------------------
do $$
declare
  r jsonb;
  l jsonb;
  p jsonb;
  g jsonb;
  perm jsonb;
  v_lib bigint;
  v_uid uuid := pg_temp.uid(8);
  v_mail text;
  -- SHA-256 de 'rede.teste.ponta@lube.com.br' calculado no Node (o guarda usa crypto.subtle)
  v_h constant text := '581b25c18c2851a6b5e2aa727c7d15287baa2fd24132a0abe5baa2b9d7b5e32c';
  v_fora constant text := '203.0.113.200';
  v_dentro constant text := '203.0.113.100';
  v_portal_120 boolean := not coalesce((select sentinela.guarda_tem_rede(s.guarda_versao) and s.ultimo_ambiente = 'production'
                                          from sentinela.sistemas s where s.projeto = 'painel-lube-distribuidora'), false);
  n0 int;
begin
  insert into auth.users (id, email) values (v_uid, 'rede.teste.ponta@lube.com.br');
  update public.profiles set nome = 'Rede Ponta', ativo = true, is_admin = false, acesso_total = false where id = v_uid;
  insert into public.permissoes (user_id, sistema_id) select v_uid, s.id from public.sistemas s where s.slug = 'reposicoes';
  v_mail := pg_temp.mail(8);
  -- o guarda 1.3.0 do Reposições falou com a central (a linha nasceu nesta transação)
  update sentinela.sistemas set guarda_versao = 'sentinela-guarda/1.3.0', ultimo_sinal = now(), ultimo_ambiente = 'production'
   where projeto = 'reposicoes-web';

  -- 1. o TI cadastra a rede e liga o exigir no Reposições
  r := pg_temp.adm('rede_nova', '{"rede":"203.0.113.64/26","descricao":"Escritório ponta a ponta"}');
  perform pg_temp.ok('R15 TI cadastra a rede da Lube (203.0.113.64/26)', (r->>'ok')::boolean and r->>'rede' = '203.0.113.64/26', r::text);
  r := pg_temp.adm('rede_modo', '{"projeto":"reposicoes-web","modo":"exigir"}');
  perform pg_temp.ok('R15 Reposições (guarda 1.3.0) passa para exigir', r->'alterados' = '["reposicoes-web"]'::jsonb, r::text);
  l := public.sentinela_srv_rede_lista('reposicoes-web');
  perform pg_temp.ok('R15 lista do guarda do Reposições: exigir, com a rede nova, pessoa ainda não liberada',
    l->>'modo' = 'exigir' and l->'redes' ? '203.0.113.64/26'
    and not exists (select 1 from jsonb_array_elements(l->'liberados') x where x->>'h' = v_h), l::text);

  -- 2. de fora: a permissão sai, mas a central nega o passe, e a tentativa fica registrada
  n0 := (select count(*) from sentinela.rede_fora);
  perm := public.sentinela_srv_permissao(v_uid, 'reposicoes');
  r := pg_temp.dec(v_fora, 8, 'reposicoes-web', 'passe');
  perform pg_temp.ok('R15 de fora: permissão ok (guarda ativo), mas o passe é negado (bloquear, sem emergência)',
    (perm->>'permitido')::boolean and perm->'guarda_ativo' = 'true'::jsonb
    and r->>'acao' = 'bloquear' and r->>'modo' = 'exigir' and r->'na_rede' = 'false'::jsonb
    and r->'liberado' = 'null'::jsonb and r->'emergencia' = 'null'::jsonb and r->>'ip' = v_fora,
    perm::text || ' ' || r::text);
  perform pg_temp.ok('R15 a tentativa fica registrada (rede_fora: passe, bloqueado, IP, pessoa e sistema)',
    (select count(*) from sentinela.rede_fora) = n0 + 1
    and exists (select 1 from sentinela.rede_fora f
                 where f.ip = v_fora::inet and f.user_id = v_uid and f.email = v_mail and f.origem = 'passe'
                   and f.projeto = 'reposicoes-web' and f.decisao = 'bloqueado' and f.liberacao_id is null));

  -- 3. o TI vê a tentativa no painel
  perform pg_temp.como(pg_temp.uid(1), 'rede.teste.admin@lube.com.br');
  p := public.sentinela_rede_painel(1);
  perform pg_temp.postgres();
  select x into g from jsonb_array_elements(p->'fora') x where x->>'email' = v_mail and x->>'ip' = v_fora;
  perform pg_temp.ok('R15 "Tentativas de fora": a pessoa barrada no Reposições, sem liberação',
    g->>'situacao' = 'barrado' and g->'projetos' ? 'reposicoes-web' and (g->>'barrados')::int = 1
    and g->'liberacao' = 'null'::jsonb and (g->>'user_id')::uuid = v_uid and g->>'nome' = 'Rede Ponta',
    coalesce(g::text, 'sem linha'));
  select x into g from jsonb_array_elements(p->'sistemas') x where x->>'projeto' = 'reposicoes-web';
  perform pg_temp.ok('R15 "Modo por sistema": Reposições exigindo, guarda com a regra, tentativa contada',
    g->>'modo' = 'exigir' and g->>'modo_efetivo' = 'exigir' and g->'guarda_rede' = 'true'::jsonb
    and (g->'fora'->>'barrados')::int >= 1, coalesce(g::text, 'sem linha'));

  -- 4. "Liberar esta pessoa": entra de fora até o prazo, cada entrada registrada
  r := pg_temp.adm('liberar', jsonb_build_object('user_id', v_uid, 'fim', now() + interval '3 days',
                                                 'motivo', 'gestor comercial viajando'));
  v_lib := (r->>'id')::bigint;
  l := public.sentinela_srv_rede_lista('reposicoes-web');
  perform pg_temp.ok('R15 liberada: a lista do guarda leva o SHA-256 do e-mail (igual ao do Node) e o prazo, nunca o e-mail',
    exists (select 1 from jsonb_array_elements(l->'liberados') x where x->>'h' = v_h and x->>'ate' = r->>'fim')
    and sentinela.email_hash(v_mail) = v_h and position(v_mail in l::text) = 0, l::text);
  r := pg_temp.dec(v_fora, 8, 'reposicoes-web', 'passe');
  perform pg_temp.ok('R15 liberada: o passe sai (seguir, com a liberação) e a entrada fica registrada com ela',
    r->>'acao' = 'seguir' and (r->'liberado'->>'id')::bigint = v_lib
    and exists (select 1 from sentinela.rede_fora f where f.user_id = v_uid and f.decisao = 'liberado' and f.liberacao_id = v_lib),
    r::text);
  perform pg_temp.como(pg_temp.uid(1), 'rede.teste.admin@lube.com.br');
  p := public.sentinela_rede_painel(1);
  perform pg_temp.postgres();
  select x into g from jsonb_array_elements(p->'liberacoes') x where (x->>'id')::bigint = v_lib;
  perform pg_temp.ok('R15 "Liberados fora da rede": ativa, com 1 entrada de fora',
    g->>'estado' = 'ativa' and (g->>'entradas')::int = 1 and g->>'motivo' = 'gestor comercial viajando'
    and g->>'criado_por' = 'rede.teste.admin@lube.com.br', coalesce(g::text, 'sem linha'));

  -- 5. o TI encerra: sai da lista e o passe volta a ser negado
  r := pg_temp.adm('encerrar', jsonb_build_object('id', v_lib));
  l := public.sentinela_srv_rede_lista('reposicoes-web');
  r := pg_temp.dec(v_fora, 8, 'reposicoes-web', 'passe');
  perform pg_temp.ok('R15 encerrada: sai da lista do guarda e o passe volta a ser negado',
    not exists (select 1 from jsonb_array_elements(l->'liberados') x where x->>'h' = v_h) and r->>'acao' = 'bloquear', r::text);

  -- 6. na rede da Lube: segue, com o nome da rede, e nada é registrado
  n0 := (select count(*) from sentinela.rede_fora);
  r := pg_temp.dec(v_dentro, 8, 'reposicoes-web', 'passe');
  perform pg_temp.ok('R15 dentro da rede: seguir, com o nome da rede, e nada registrado',
    r->>'acao' = 'seguir' and r->'na_rede' = 'true'::jsonb and r->'rede'->>'descricao' = 'Escritório ponta a ponta'
    and (select count(*) from sentinela.rede_fora) = n0, r::text);

  -- 7. login no portal: o exigir pede o guarda 1.3.0 no portal; observar segue e registra; exigir barra
  perform pg_temp.ok('R15 exigir no portal recusado enquanto o guarda do portal não for o 1.3.0 (visto na produção)',
    not v_portal_120
    or pg_temp.erro_adm('rede_modo', '{"projeto":"painel-lube-distribuidora","modo":"exigir"}')
         like '22023 sentinela: precisa do guarda 1.3.0 em produção antes de exigir a rede em: painel-lube-distribuidora%');
  perform pg_temp.adm('rede_modo', '{"projeto":"painel-lube-distribuidora","modo":"observar"}');
  r := pg_temp.dec(v_fora, 8, 'painel-lube-distribuidora', 'portal');
  perform pg_temp.ok('R15 login no portal em observar: segue (observar) e fica registrado',
    r->>'acao' = 'observar' and exists (select 1 from sentinela.rede_fora f where f.user_id = v_uid and f.origem = 'portal'
      and f.projeto = 'painel-lube-distribuidora' and f.decisao = 'observado'), r::text);
  -- portal exigindo: posto direto na tabela nova (simula o guarda 1.3.0 do portal sem tocar na linha de hoje)
  update sentinela.rede_sistemas rs set modo = 'exigir'
   where rs.projeto_id = (select s.projeto_id from sentinela.sistemas s where s.projeto = 'painel-lube-distribuidora');
  r := pg_temp.dec(v_fora, 8, 'painel-lube-distribuidora', 'portal');
  perform pg_temp.ok('R15 login no portal exigindo, de fora: bloquear (o portal sai da sessão e mostra a página)',
    r->>'acao' = 'bloquear' and r->'emergencia' = 'null'::jsonb, r::text);
  r := pg_temp.dec(v_fora, 1, 'painel-lube-distribuidora', 'portal');
  perform pg_temp.ok('R15 administrador do mesmo IP: bloquear, sem provas para a emergência (1 pessoa barrada)',
    r->>'acao' = 'bloquear' and r->'emergencia' = '{"possivel":false,"pessoas":1}'::jsonb, r::text);
  r := pg_temp.dec(v_dentro, 8, 'painel-lube-distribuidora', 'portal');
  perform pg_temp.ok('R15 login no portal de dentro da rede: seguir', r->>'acao' = 'seguir' and r->'na_rede' = 'true'::jsonb, r::text);

  -- 8. o painel junta, por pessoa e IP, o portal e o Reposições
  perform pg_temp.como(pg_temp.uid(1), 'rede.teste.admin@lube.com.br');
  p := public.sentinela_rede_painel(1);
  perform pg_temp.postgres();
  select x into g from jsonb_array_elements(p->'fora') x where x->>'email' = v_mail and x->>'ip' = v_fora;
  perform pg_temp.ok('R15 "Tentativas de fora" junta portal e Reposições da pessoa nesse IP (3 barradas, 1 liberada, 1 observada)',
    g->'projetos' ? 'painel-lube-distribuidora' and g->'projetos' ? 'reposicoes-web' and g->>'situacao' = 'barrado'
    and (g->>'barrados')::int = 3 and (g->>'liberados')::int = 1 and (g->>'observados')::int = 1 and (g->>'vezes')::int = 5,
    coalesce(g::text, 'sem linha'));
exception when others then
  perform pg_temp.postgres();
  perform pg_temp.ok('R15 (erro inesperado)', false, sqlstate || ': ' || sqlerrm);
end $$;

-- ---------------------------------------------------------
-- R14 cadeia íntegra no fim de tudo
-- ---------------------------------------------------------
do $$
declare
  v jsonb;
begin
  perform pg_temp.como(pg_temp.uid(1), 'rede.teste.admin@lube.com.br');
  v := public.sentinela_verificar_cadeia(5000);
  perform pg_temp.postgres();
  perform pg_temp.ok('R14 cadeia de selos íntegra depois dos testes', (v->>'ok')::boolean, v::text);
exception when others then
  perform pg_temp.postgres();
  perform pg_temp.ok('R14 (erro inesperado)', false, sqlstate || ': ' || sqlerrm);
end $$;

-- ---------------------------------------------------------
-- Placar (e o md5 da migração que rodou, entre os marcadores)
-- ---------------------------------------------------------
select count(*) filter (where ok)     as passaram,
       count(*) filter (where not ok) as falharam,
       jsonb_agg(jsonb_build_object('teste', teste, 'ok', ok, 'detalhe', left(detalhe, 400)) order by em)
         filter (where not ok)        as falhas,
       jsonb_agg(teste order by em)  filter (where ok) as aprovados,
       md5(substring(current_query()
                     from strpos(current_query(), '-- SENTINELA-13-INICIO')
                     for strpos(current_query(), '-- SENTINELA-13-FIM') + 19
                         - strpos(current_query(), '-- SENTINELA-13-INICIO'))) as md5_migracao
  from pg_temp.rede_teste;

rollback;
