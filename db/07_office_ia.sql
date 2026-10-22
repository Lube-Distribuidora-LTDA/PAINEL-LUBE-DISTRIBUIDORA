-- =========================================================
-- LUBE OFFICE v4 — IA da Lube (2026-10-21)
-- A IA cria e mexe em documentos, planilhas e apresentações dentro do editor
-- (pedido do Júlio). Decisões dele: modelo Claude Haiku 5.5, teto de US$ 10 por
-- dia somando a Lube toda, todo usuário ativo pode usar.
-- Cada pedido fica em office.ia_uso (quem, o quê, tokens, custo, deu certo ou
-- não) e, quando é sobre um arquivo, também na atividade dele.
-- O teto fica em office.config ('ia') para mudar sem publicar código:
--   update office.config set valor = valor || '{"teto_dia_usd": 15}' where chave = 'ia';
-- =========================================================

create table if not exists office.ia_uso (
  id             bigserial primary key,
  pessoa         uuid not null references public.profiles(id) on delete cascade,
  arquivo        uuid references office.arquivos(id) on delete set null,
  fonte          uuid references office.arquivos(id) on delete set null,   -- arquivo lido para "transformar"
  tipo           text not null check (tipo in ('docx', 'xlsx', 'pptx')),
  modo           text not null check (modo in ('criar', 'editor', 'transformar')),
  pedido         text not null default '',
  imagens        int not null default 0,
  modelo         text not null default '',
  tokens_entrada int not null default 0,
  tokens_saida   int not null default 0,
  custo_usd      numeric(12,6) not null default 0,
  ok             boolean not null default false,
  erro           text,
  em             timestamptz not null default now()
);
create index if not exists office_ia_uso_em_idx on office.ia_uso(em);
create index if not exists office_ia_uso_pessoa_idx on office.ia_uso(pessoa, em);
alter table office.ia_uso enable row level security;
revoke all on office.ia_uso from public, anon, authenticated;

insert into office.config (chave, valor)
values ('ia', jsonb_build_object('teto_dia_usd', 10, 'modelo', 'claude-haiku-5-5'))
on conflict (chave) do nothing;

-- o dia é o de Brasília: o teto zera à meia-noite daqui
create or replace function office.ia_inicio_do_dia()
returns timestamptz language sql stable
set search_path = office, public, extensions, pg_temp
as $$ select date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo' $$;

create or replace function office.ia_situacao(p_user uuid)
returns jsonb language sql stable
set search_path = office, public, extensions, pg_temp
as $$
  with c as (select coalesce((valor->>'teto_dia_usd')::numeric, 10) as teto from office.config where chave = 'ia'),
       g as (select coalesce(sum(custo_usd), 0) as gasto,
                    count(*) filter (where pessoa = p_user) as meus
               from office.ia_uso where em >= office.ia_inicio_do_dia())
  select jsonb_build_object(
    'teto_dia_usd', coalesce((select teto from c), 10),
    'gasto_hoje_usd', round((select gasto from g), 4),
    'meus_hoje', (select meus from g),
    'livre', (select gasto from g) < coalesce((select teto from c), 10))
$$;

create or replace function public.office_srv_ia_situacao(p_user uuid)
returns jsonb language plpgsql stable security definer
set search_path = office, public, extensions, pg_temp
as $$
begin
  perform office.so_funcao(); perform office.exige_ativo(p_user);
  return office.ia_situacao(p_user);
end $$;

-- antes de chamar a IA: confere o teto do dia, o papel no arquivo que vai receber
-- o resultado (editar) e no arquivo lido para transformar (ver). Devolve o caminho
-- da versão atual da fonte, que só a função lê.
create or replace function public.office_srv_ia_liberar(p_user uuid, p_arquivo uuid, p_fonte uuid)
returns jsonb language plpgsql security definer
set search_path = office, public, extensions, pg_temp
as $$
declare
  v_sit jsonb;
  f office.arquivos;
begin
  perform office.so_funcao(); perform office.exige_ativo(p_user);
  if p_arquivo is not null then
    if not office.vivo_arquivo(p_arquivo) or office.papel_arquivo(p_user, p_arquivo) = 0 then
      perform office.erro('arquivo não encontrado ou sem acesso', 'P0002');
    end if;
    if office.papel_arquivo(p_user, p_arquivo) < 3 then
      perform office.erro('só quem pode editar usa a IA neste arquivo', '42501');
    end if;
  end if;
  if p_fonte is not null then
    select * into f from office.arquivos where id = p_fonte;
    if f.id is null or f.versao = 0 or not office.vivo_arquivo(p_fonte) or office.papel_arquivo(p_user, p_fonte) = 0 then
      perform office.erro('arquivo de origem não encontrado ou sem acesso', 'P0002');
    end if;
  end if;
  v_sit := office.ia_situacao(p_user);
  return v_sit || jsonb_build_object(
    'modelo', (select valor->>'modelo' from office.config where chave = 'ia'),
    'fonte', case when f.id is null then null else jsonb_build_object(
      'id', f.id, 'nome', f.nome, 'extensao', f.extensao, 'caminho', f.caminho, 'tamanho', f.tamanho) end);
end $$;

-- depois da IA: guarda o uso (com o custo) e, se foi num arquivo, a atividade dele
create or replace function public.office_srv_ia_registrar(
  p_user uuid, p_arquivo uuid, p_fonte uuid, p_tipo text, p_modo text, p_pedido text, p_imagens int,
  p_modelo text, p_tokens_entrada int, p_tokens_saida int, p_custo numeric, p_ok boolean, p_erro text)
returns jsonb language plpgsql security definer
set search_path = office, public, extensions, pg_temp
as $$
begin
  perform office.so_funcao(); perform office.exige_ativo(p_user);
  insert into office.ia_uso (pessoa, arquivo, fonte, tipo, modo, pedido, imagens, modelo,
                             tokens_entrada, tokens_saida, custo_usd, ok, erro)
  values (p_user, p_arquivo, p_fonte, p_tipo, p_modo, left(coalesce(p_pedido, ''), 2000), coalesce(p_imagens, 0),
          coalesce(p_modelo, ''), coalesce(p_tokens_entrada, 0), coalesce(p_tokens_saida, 0),
          coalesce(p_custo, 0), coalesce(p_ok, false), left(p_erro, 500));
  if p_arquivo is not null and p_ok then
    perform office.registrar(p_user, 'ia', p_arquivo, null, jsonb_build_object(
      'modo', p_modo, 'pedido', left(coalesce(p_pedido, ''), 200), 'imagens', coalesce(p_imagens, 0),
      'custo_usd', round(coalesce(p_custo, 0), 4),
      'fonte', (select jsonb_build_object('id', id, 'nome', nome, 'extensao', extensao) from office.arquivos where id = p_fonte)));
  end if;
  return office.ia_situacao(p_user);
end $$;

-- só a service_role executa (a Edge Function)
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as assinatura
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'office\_srv\_ia\_%'
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.assinatura);
    execute format('grant execute on function %s to service_role', f.assinatura);
  end loop;
end $$;
