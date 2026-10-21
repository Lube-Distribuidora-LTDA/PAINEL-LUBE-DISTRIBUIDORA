-- =========================================================
-- LUBE OFFICE — documentos, planilhas e apresentações do portal
-- (2026-10-21)
--
-- Schema próprio (office), separado das tabelas do portal. Ninguém lê
-- pela API: RLS ligado e sem políticas. Só a Edge Function `office`
-- (service_role) mexe, pelas funções public.office_srv_*, e cada uma
-- confere o papel de quem pediu:
--   4 dono · 3 editar · 2 comentar · 1 ver · 0 nada
-- O papel vem do dono do item, do compartilhamento direto ou do
-- compartilhamento de qualquer pasta acima (inclusive "todos da Lube").
-- Nada se apaga: excluir manda para a lixeira (lixeira_em).
-- Os arquivos ficam no bucket privado `office`, um objeto por versão.
-- =========================================================

create schema if not exists office;
revoke all on schema office from public, anon, authenticated;
grant usage on schema office to service_role;

-- ---------------------------------------------------------
-- 1. TABELAS
-- ---------------------------------------------------------
create table if not exists office.pastas (
  id          uuid primary key default gen_random_uuid(),
  dono        uuid references public.profiles(id) on delete set null,
  pai         uuid references office.pastas(id) on delete restrict,
  nome        text not null check (length(btrim(nome)) between 1 and 120),
  criado_em   timestamptz not null default now(),
  alterado_em timestamptz not null default now(),
  lixeira_em  timestamptz,
  lixeira_por uuid references public.profiles(id) on delete set null
);
create index if not exists office_pastas_pai_idx  on office.pastas(pai);
create index if not exists office_pastas_dono_idx on office.pastas(dono);

create table if not exists office.arquivos (
  id           uuid primary key default gen_random_uuid(),
  dono         uuid references public.profiles(id) on delete set null,
  pasta        uuid references office.pastas(id) on delete restrict,
  nome         text not null check (length(btrim(nome)) between 1 and 160),   -- sem a extensão
  extensao     text not null check (extensao ~ '^[a-z0-9]{1,8}$'),
  tamanho      bigint not null default 0,
  versao       int not null default 0,          -- 0 = envio ainda não confirmado (não aparece)
  caminho      text,                            -- objeto da versão atual no bucket office
  criado_em    timestamptz not null default now(),
  criado_por   uuid references public.profiles(id) on delete set null,
  alterado_em  timestamptz not null default now(),
  alterado_por uuid references public.profiles(id) on delete set null,
  lixeira_em   timestamptz,
  lixeira_por  uuid references public.profiles(id) on delete set null
);
create index if not exists office_arquivos_pasta_idx on office.arquivos(pasta);
create index if not exists office_arquivos_dono_idx  on office.arquivos(dono);

create table if not exists office.versoes (
  id        uuid primary key default gen_random_uuid(),
  arquivo   uuid not null references office.arquivos(id) on delete restrict,
  numero    int not null,
  caminho   text not null,
  tamanho   bigint not null default 0,
  origem    text not null check (origem in ('novo', 'modelo', 'envio', 'editor', 'forcada', 'restaurada')),
  autores   uuid[] not null default '{}',
  criado_em timestamptz not null default now(),
  unique (arquivo, numero)
);

create table if not exists office.compartilhamentos (
  id         uuid primary key default gen_random_uuid(),
  arquivo    uuid references office.arquivos(id) on delete cascade,
  pasta      uuid references office.pastas(id) on delete cascade,
  pessoa     uuid references public.profiles(id) on delete cascade,   -- null = todos da Lube
  papel      text not null check (papel in ('ver', 'comentar', 'editar')),
  criado_por uuid references public.profiles(id) on delete set null,
  criado_em  timestamptz not null default now(),
  check ((arquivo is null) <> (pasta is null))
);
create unique index if not exists office_compart_unico_idx on office.compartilhamentos
  (coalesce(arquivo, pasta), coalesce(pessoa, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists office_compart_pessoa_idx on office.compartilhamentos(pessoa);

-- quem fez o quê e quando (rastreabilidade e "Recentes")
create table if not exists office.atividades (
  id      bigserial primary key,
  arquivo uuid references office.arquivos(id) on delete cascade,
  pasta   uuid references office.pastas(id) on delete cascade,
  pessoa  uuid references public.profiles(id) on delete set null,
  acao    text not null,
  detalhe jsonb not null default '{}',
  em      timestamptz not null default now()
);
create index if not exists office_ativ_arquivo_idx on office.atividades(arquivo, em desc);
create index if not exists office_ativ_pessoa_idx  on office.atividades(pessoa, em desc);

-- avisos que acendem no portal: @menção num comentário e compartilhamento
create table if not exists office.avisos (
  id        uuid primary key default gen_random_uuid(),
  para      uuid not null references public.profiles(id) on delete cascade,
  de        uuid references public.profiles(id) on delete set null,
  arquivo   uuid references office.arquivos(id) on delete cascade,
  pasta     uuid references office.pastas(id) on delete cascade,
  tipo      text not null check (tipo in ('mencao', 'compartilhou')),
  mensagem  text not null default '',
  criado_em timestamptz not null default now(),
  lido_em   timestamptz
);
create index if not exists office_avisos_para_idx on office.avisos(para, criado_em desc);

alter table office.pastas            enable row level security;
alter table office.arquivos          enable row level security;
alter table office.versoes           enable row level security;
alter table office.compartilhamentos enable row level security;
alter table office.atividades        enable row level security;
alter table office.avisos            enable row level security;
revoke all on all tables    in schema office from public, anon, authenticated;
revoke all on all sequences in schema office from public, anon, authenticated;

-- ---------------------------------------------------------
-- 2. BUCKET (privado, sem políticas: só a função mexe)
-- ---------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('office', 'office', false, 104857600)   -- 100 MB por arquivo
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

-- ---------------------------------------------------------
-- 3. AJUDANTES
-- ---------------------------------------------------------
-- Primeira linha de toda srv_*: só a função (service_role) ou o dono do banco.
create or replace function office.so_funcao()
returns void language plpgsql stable
set search_path = office, public, extensions, pg_temp
as $$
begin
  if current_setting('role', true) in ('anon', 'authenticated')
     or coalesce(auth.role(), '') in ('anon', 'authenticated') then
    raise exception 'office: função restrita ao LUBE OFFICE' using errcode = '42501';
  end if;
end $$;

create or replace function office.exige_ativo(p_user uuid)
returns void language plpgsql stable
set search_path = office, public, extensions, pg_temp
as $$
begin
  if p_user is null or not exists (select 1 from public.profiles p where p.id = p_user and p.ativo) then
    raise exception 'office: usuário sem acesso ao portal' using errcode = '42501';
  end if;
end $$;

create or replace function office.nivel(p_papel text)
returns int language sql immutable
set search_path = office, public, extensions, pg_temp
as $$ select case p_papel when 'dono' then 4 when 'editar' then 3 when 'comentar' then 2 when 'ver' then 1 else 0 end $$;

create or replace function office.papel_txt(p_nivel int)
returns text language sql immutable
set search_path = office, public, extensions, pg_temp
as $$ select case p_nivel when 4 then 'dono' when 3 then 'editar' when 2 then 'comentar' when 1 then 'ver' end $$;

create or replace function office.limpar_nome(p_nome text)
returns text language sql immutable
set search_path = office, public, extensions, pg_temp
as $$ select left(btrim(regexp_replace(coalesce(p_nome, ''), '[[:cntrl:]]', '', 'g')), 160) $$;

-- a pasta e todas as de cima, da pasta (nivel 0) até a raiz
create or replace function office.cadeia(p_pasta uuid)
returns table (id uuid, pai uuid, dono uuid, nome text, lixeira_em timestamptz, nivel int)
language sql stable
set search_path = office, public, extensions, pg_temp
as $$
  with recursive c as (
    select p.id, p.pai, p.dono, p.nome, p.lixeira_em, 0 as nivel
      from office.pastas p where p.id = p_pasta
    union all
    select p.id, p.pai, p.dono, p.nome, p.lixeira_em, c.nivel + 1
      from office.pastas p join c on p.id = c.pai
     where c.nivel < 64
  )
  select * from c
$$;

create or replace function office.papel_pasta(p_user uuid, p_pasta uuid)
returns int language sql stable
set search_path = office, public, extensions, pg_temp
as $$
  select coalesce(max(v), 0) from (
    select 4 as v from office.cadeia(p_pasta) c where c.dono = p_user
    union all
    select office.nivel(s.papel)
      from office.compartilhamentos s
      join office.cadeia(p_pasta) c on s.pasta = c.id
     where s.pessoa = p_user or s.pessoa is null
  ) x
$$;

create or replace function office.papel_arquivo(p_user uuid, p_arquivo uuid)
returns int language sql stable
set search_path = office, public, extensions, pg_temp
as $$
  select coalesce((
    select greatest(
      case when a.dono = p_user then 4 else 0 end,
      coalesce((select max(office.nivel(s.papel)) from office.compartilhamentos s
                 where s.arquivo = a.id and (s.pessoa = p_user or s.pessoa is null)), 0),
      case when a.pasta is null then 0 else office.papel_pasta(p_user, a.pasta) end)
    from office.arquivos a where a.id = p_arquivo), 0)
$$;

create or replace function office.papel_item(p_user uuid, p_tipo text, p_id uuid)
returns int language sql stable
set search_path = office, public, extensions, pg_temp
as $$
  select case p_tipo when 'pasta' then office.papel_pasta(p_user, p_id)
                     when 'arquivo' then office.papel_arquivo(p_user, p_id) else 0 end
$$;

-- vivo = nem ele nem nenhuma pasta acima está na lixeira
create or replace function office.vivo_pasta(p_pasta uuid)
returns boolean language sql stable
set search_path = office, public, extensions, pg_temp
as $$ select exists (select 1 from office.pastas where id = p_pasta)
         and not exists (select 1 from office.cadeia(p_pasta) c where c.lixeira_em is not null) $$;

create or replace function office.vivo_arquivo(p_arquivo uuid)
returns boolean language sql stable
set search_path = office, public, extensions, pg_temp
as $$
  select coalesce((select a.lixeira_em is null and a.versao > 0
                          and (a.pasta is null or office.vivo_pasta(a.pasta))
                     from office.arquivos a where a.id = p_arquivo), false)
$$;

create or replace function office.json_pessoa(p_id uuid)
returns jsonb language sql stable
set search_path = office, public, extensions, pg_temp
as $$
  select jsonb_build_object('id', p.id, 'nome', coalesce(nullif(p.nome, ''), split_part(p.email, '@', 1)),
                            'email', p.email, 'cargo', p.cargo)
    from public.profiles p where p.id = p_id
$$;

create or replace function office.json_compart(p_arquivo uuid, p_pasta uuid)
returns jsonb language sql stable
set search_path = office, public, extensions, pg_temp
as $$
  select jsonb_build_object(
    'total', count(*),
    'todos', coalesce(bool_or(s.pessoa is null), false),
    'pessoas', coalesce(jsonb_agg(office.json_pessoa(s.pessoa) order by s.criado_em)
                        filter (where s.pessoa is not null), '[]'::jsonb))
  from office.compartilhamentos s
  where (p_arquivo is not null and s.arquivo = p_arquivo) or (p_pasta is not null and s.pasta = p_pasta)
$$;

create or replace function office.json_pasta(p_user uuid, p office.pastas)
returns jsonb language sql stable
set search_path = office, public, extensions, pg_temp
as $$
  select jsonb_build_object(
    'tipo', 'pasta', 'id', p.id, 'nome', p.nome, 'pai', p.pai,
    'dono', office.json_pessoa(p.dono),
    'criado_em', p.criado_em, 'alterado_em', p.alterado_em,
    'papel', office.papel_txt(office.papel_pasta(p_user, p.id)),
    'lixeira_em', p.lixeira_em,
    'compartilhado', office.json_compart(null, p.id))
$$;

create or replace function office.json_arquivo(p_user uuid, a office.arquivos)
returns jsonb language sql stable
set search_path = office, public, extensions, pg_temp
as $$
  select jsonb_build_object(
    'tipo', 'arquivo', 'id', a.id, 'nome', a.nome, 'extensao', a.extensao, 'pasta', a.pasta,
    'tamanho', a.tamanho, 'versao', a.versao,
    'dono', office.json_pessoa(a.dono),
    'criado_em', a.criado_em, 'alterado_em', a.alterado_em,
    'alterado_por', office.json_pessoa(a.alterado_por),
    'papel', office.papel_txt(office.papel_arquivo(p_user, a.id)),
    'lixeira_em', a.lixeira_em,
    'compartilhado', office.json_compart(a.id, null))
$$;

create or replace function office.registrar(p_pessoa uuid, p_acao text, p_arquivo uuid, p_pasta uuid, p_detalhe jsonb default '{}')
returns void language sql
set search_path = office, public, extensions, pg_temp
as $$
  insert into office.atividades (pessoa, acao, arquivo, pasta, detalhe)
  values (p_pessoa, p_acao, p_arquivo, p_pasta, coalesce(p_detalhe, '{}'::jsonb))
$$;

create or replace function office.erro(p_msg text, p_codigo text default 'P0001')
returns void language plpgsql
set search_path = office, public, extensions, pg_temp
as $$ begin raise exception 'office: %', p_msg using errcode = p_codigo; end $$;

-- ---------------------------------------------------------
-- 4. FUNÇÕES DA EDGE FUNCTION (public.office_srv_*)
-- ---------------------------------------------------------

-- quem sou eu + contadores do topo
create or replace function public.office_srv_eu(p_user uuid)
returns jsonb language plpgsql stable security definer
set search_path = office, public, extensions, pg_temp
as $$
begin
  perform office.so_funcao(); perform office.exige_ativo(p_user);
  return jsonb_build_object(
    'pessoa', office.json_pessoa(p_user),
    'avisos_nao_lidos', (select count(*) from office.avisos v where v.para = p_user and v.lido_em is null),
    'uso', (select jsonb_build_object('arquivos', count(*), 'bytes', coalesce(sum(a.tamanho), 0))
              from office.arquivos a where a.dono = p_user and a.versao > 0 and a.lixeira_em is null));
end $$;

-- lista: visão (meus | compartilhados | recentes | lixeira | busca) ou o conteúdo de uma pasta
create or replace function public.office_srv_listar(p_user uuid, p_visao text, p_pasta uuid, p_busca text)
returns jsonb language plpgsql stable security definer
set search_path = office, public, extensions, pg_temp
as $$
declare
  v_papel int;
  v_itens jsonb;
  v_caminho jsonb := '[]'::jsonb;
  v_busca text := nullif(btrim(coalesce(p_busca, '')), '');
  v_padrao text;
begin
  perform office.so_funcao(); perform office.exige_ativo(p_user);

  if p_pasta is not null then
    v_papel := office.papel_pasta(p_user, p_pasta);
    if v_papel = 0 or not office.vivo_pasta(p_pasta) then
      perform office.erro('pasta não encontrada ou sem acesso', 'P0002');
    end if;
    -- caminho da raiz até a pasta, só com as pastas que a pessoa enxerga
    select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'nome', c.nome) order by c.nivel desc), '[]'::jsonb)
      into v_caminho from office.cadeia(p_pasta) c where office.papel_pasta(p_user, c.id) > 0;
    select coalesce(jsonb_agg(x.j order by x.ord, x.chave), '[]'::jsonb) into v_itens from (
      select office.json_pasta(p_user, p) as j, 0 as ord, lower(p.nome) as chave
        from office.pastas p where p.pai = p_pasta and p.lixeira_em is null
      union all
      select office.json_arquivo(p_user, a), 1, lower(a.nome)
        from office.arquivos a where a.pasta = p_pasta and a.lixeira_em is null and a.versao > 0
    ) x;
    return jsonb_build_object('visao', 'pasta', 'caminho', v_caminho, 'itens', v_itens,
      'pasta', jsonb_build_object('id', p_pasta, 'papel', office.papel_txt(v_papel),
        'dono', office.json_pessoa((select dono from office.pastas where id = p_pasta))));
  end if;

  case coalesce(p_visao, 'meus')
  when 'meus' then
    select coalesce(jsonb_agg(x.j order by x.ord, x.chave), '[]'::jsonb) into v_itens from (
      select office.json_pasta(p_user, p) as j, 0 as ord, lower(p.nome) as chave
        from office.pastas p where p.dono = p_user and p.pai is null and p.lixeira_em is null
      union all
      select office.json_arquivo(p_user, a), 1, lower(a.nome)
        from office.arquivos a
       where a.dono = p_user and a.pasta is null and a.lixeira_em is null and a.versao > 0
    ) x;

  when 'compartilhados' then
    select coalesce(jsonb_agg(x.j order by x.quando desc), '[]'::jsonb) into v_itens from (
      select office.json_pasta(p_user, p) as j, q.quando
        from (select s.pasta, max(s.criado_em) as quando from office.compartilhamentos s
               where s.pasta is not null and (s.pessoa = p_user or s.pessoa is null) group by s.pasta) q
        join office.pastas p on p.id = q.pasta
       where p.dono is distinct from p_user and office.vivo_pasta(p.id)
      union all
      select office.json_arquivo(p_user, a), q.quando
        from (select s.arquivo, max(s.criado_em) as quando from office.compartilhamentos s
               where s.arquivo is not null and (s.pessoa = p_user or s.pessoa is null) group by s.arquivo) q
        join office.arquivos a on a.id = q.arquivo
       where a.dono is distinct from p_user and office.vivo_arquivo(a.id)
    ) x;

  when 'recentes' then
    select coalesce(jsonb_agg(office.json_arquivo(p_user, a) order by r.ultima desc), '[]'::jsonb) into v_itens
      from (select t.arquivo, max(t.em) as ultima
              from office.atividades t
             where t.pessoa = p_user and t.arquivo is not null and t.em > now() - interval '60 days'
             group by t.arquivo order by max(t.em) desc limit 50) r
      join office.arquivos a on a.id = r.arquivo
     where office.vivo_arquivo(a.id) and office.papel_arquivo(p_user, a.id) > 0;

  when 'lixeira' then
    select coalesce(jsonb_agg(x.j order by x.quando desc), '[]'::jsonb) into v_itens from (
      select office.json_pasta(p_user, p) as j, p.lixeira_em as quando
        from office.pastas p where p.lixeira_em is not null and (p.dono = p_user or p.lixeira_por = p_user)
      union all
      select office.json_arquivo(p_user, a), a.lixeira_em
        from office.arquivos a where a.lixeira_em is not null and (a.dono = p_user or a.lixeira_por = p_user)
    ) x;

  when 'busca' then
    if v_busca is null then
      v_itens := '[]'::jsonb;
    else
      v_padrao := '%' || replace(replace(replace(v_busca, '\', '\\'), '%', '\%'), '_', '\_') || '%';
      select coalesce(jsonb_agg(x.j order by x.ord, x.chave), '[]'::jsonb) into v_itens from (
        select office.json_pasta(p_user, p) as j, 0 as ord, lower(p.nome) as chave
          from office.pastas p
         where p.nome ilike v_padrao and p.lixeira_em is null
           and office.papel_pasta(p_user, p.id) > 0 and office.vivo_pasta(p.id)
        union all
        select office.json_arquivo(p_user, a), 1, lower(a.nome)
          from office.arquivos a
         where a.nome ilike v_padrao and a.versao > 0 and a.lixeira_em is null
           and office.papel_arquivo(p_user, a.id) > 0 and office.vivo_arquivo(a.id)
        limit 100
      ) x;
    end if;

  else
    perform office.erro('visão desconhecida', '22023');
  end case;

  return jsonb_build_object('visao', coalesce(p_visao, 'meus'), 'caminho', v_caminho, 'itens', v_itens);
end $$;

create or replace function public.office_srv_pasta_criar(p_user uuid, p_pai uuid, p_nome text)
returns jsonb language plpgsql security definer
set search_path = office, public, extensions, pg_temp
as $$
declare
  v office.pastas;
  v_nome text := office.limpar_nome(p_nome);
begin
  perform office.so_funcao(); perform office.exige_ativo(p_user);
  if v_nome = '' then perform office.erro('dê um nome para a pasta', '22023'); end if;
  if p_pai is not null and (office.papel_pasta(p_user, p_pai) < 3 or not office.vivo_pasta(p_pai)) then
    perform office.erro('sem permissão para criar nesta pasta', '42501');
  end if;
  insert into office.pastas (dono, pai, nome) values (p_user, p_pai, left(v_nome, 120)) returning * into v;
  perform office.registrar(p_user, 'criou', null, v.id);
  return office.json_pasta(p_user, v);
end $$;

-- arquivo novo (documento em branco, modelo ou envio do computador): reserva o
-- caminho no bucket; só aparece depois que a função confirma o envio
create or replace function public.office_srv_arquivo_criar(p_user uuid, p_pasta uuid, p_nome text, p_extensao text)
returns jsonb language plpgsql security definer
set search_path = office, public, extensions, pg_temp
as $$
declare
  v_id uuid := gen_random_uuid();
  v_nome text := office.limpar_nome(p_nome);
  v_ext text := lower(btrim(coalesce(p_extensao, '')));
  v_caminho text;
begin
  perform office.so_funcao(); perform office.exige_ativo(p_user);
  if v_nome = '' then perform office.erro('dê um nome para o arquivo', '22023'); end if;
  if v_ext not in ('docx', 'xlsx', 'pptx', 'pdf', 'doc', 'xls', 'ppt', 'odt', 'ods', 'odp', 'csv', 'txt', 'rtf') then
    perform office.erro('tipo de arquivo não aceito: ' || v_ext, '22023');
  end if;
  if p_pasta is not null and (office.papel_pasta(p_user, p_pasta) < 3 or not office.vivo_pasta(p_pasta)) then
    perform office.erro('sem permissão para criar nesta pasta', '42501');
  end if;
  v_caminho := 'arquivos/' || v_id || '/' || to_char(clock_timestamp() at time zone 'UTC', 'YYYYMMDDHH24MISSMS')
               || '-' || substr(md5(random()::text), 1, 6) || '.' || v_ext;
  insert into office.arquivos (id, dono, pasta, nome, extensao, versao, caminho, criado_por, alterado_por)
  values (v_id, p_user, p_pasta, v_nome, v_ext, 0, v_caminho, p_user, p_user);
  return jsonb_build_object('id', v_id, 'caminho', v_caminho);
end $$;

create or replace function public.office_srv_arquivo_confirmar(p_user uuid, p_arquivo uuid, p_tamanho bigint, p_origem text)
returns jsonb language plpgsql security definer
set search_path = office, public, extensions, pg_temp
as $$
declare v office.arquivos;
begin
  perform office.so_funcao(); perform office.exige_ativo(p_user);
  if p_origem not in ('novo', 'modelo', 'envio') then perform office.erro('origem inválida', '22023'); end if;
  select * into v from office.arquivos a where a.id = p_arquivo for update;
  if v.id is null or v.criado_por is distinct from p_user or v.versao <> 0 then
    perform office.erro('envio não encontrado', 'P0002');
  end if;
  update office.arquivos set versao = 1, tamanho = greatest(coalesce(p_tamanho, 0), 0),
         alterado_em = now(), alterado_por = p_user
   where id = p_arquivo returning * into v;
  insert into office.versoes (arquivo, numero, caminho, tamanho, origem, autores)
  values (v.id, 1, v.caminho, v.tamanho, p_origem, array[p_user]);
  perform office.registrar(p_user, 'criou', v.id, null, jsonb_build_object('origem', p_origem));
  return office.json_arquivo(p_user, v);
end $$;

create or replace function public.office_srv_renomear(p_user uuid, p_tipo text, p_id uuid, p_nome text)
returns jsonb language plpgsql security definer
set search_path = office, public, extensions, pg_temp
as $$
declare
  v_nome text := office.limpar_nome(p_nome);
  v_antes text;
  vp office.pastas;
  va office.arquivos;
begin
  perform office.so_funcao(); perform office.exige_ativo(p_user);
  if v_nome = '' then perform office.erro('o nome não pode ficar vazio', '22023'); end if;
  if office.papel_item(p_user, p_tipo, p_id) < 3 then perform office.erro('sem permissão para renomear', '42501'); end if;
  if p_tipo = 'pasta' then
    select nome into v_antes from office.pastas where id = p_id;
    update office.pastas set nome = left(v_nome, 120), alterado_em = now() where id = p_id returning * into vp;
    perform office.registrar(p_user, 'renomeou', null, p_id, jsonb_build_object('de', v_antes, 'para', vp.nome));
    return office.json_pasta(p_user, vp);
  end if;
  select nome into v_antes from office.arquivos where id = p_id;
  update office.arquivos set nome = v_nome where id = p_id returning * into va;
  perform office.registrar(p_user, 'renomeou', p_id, null, jsonb_build_object('de', v_antes, 'para', va.nome));
  return office.json_arquivo(p_user, va);
end $$;

-- mover: destino nulo = a raiz de quem move (só para o que é dele)
create or replace function public.office_srv_mover(p_user uuid, p_tipo text, p_id uuid, p_destino uuid)
returns jsonb language plpgsql security definer
set search_path = office, public, extensions, pg_temp
as $$
declare
  v_dono uuid;
  vp office.pastas;
  va office.arquivos;
begin
  perform office.so_funcao(); perform office.exige_ativo(p_user);
  if office.papel_item(p_user, p_tipo, p_id) < 3 then perform office.erro('sem permissão para mover', '42501'); end if;
  if p_destino is null then
    v_dono := case p_tipo when 'pasta' then (select dono from office.pastas where id = p_id)
                          else (select dono from office.arquivos where id = p_id) end;
    if v_dono is distinct from p_user then
      perform office.erro('só o dono pode levar para Meus arquivos', '42501');
    end if;
  elsif office.papel_pasta(p_user, p_destino) < 3 or not office.vivo_pasta(p_destino) then
    perform office.erro('sem permissão na pasta de destino', '42501');
  end if;

  if p_tipo = 'pasta' then
    if p_destino is not null and exists (select 1 from office.cadeia(p_destino) c where c.id = p_id) then
      perform office.erro('uma pasta não pode entrar nela mesma', '22023');
    end if;
    update office.pastas set pai = p_destino, alterado_em = now() where id = p_id returning * into vp;
    perform office.registrar(p_user, 'moveu', null, p_id, jsonb_build_object('para', p_destino));
    return office.json_pasta(p_user, vp);
  end if;
  update office.arquivos set pasta = p_destino where id = p_id returning * into va;
  perform office.registrar(p_user, 'moveu', p_id, null, jsonb_build_object('para', p_destino));
  return office.json_arquivo(p_user, va);
end $$;

-- lixeira: só o dono (ou o dono de uma pasta acima) manda; quem mandou ou o dono restaura
create or replace function public.office_srv_lixeira(p_user uuid, p_tipo text, p_id uuid, p_restaurar boolean)
returns jsonb language plpgsql security definer
set search_path = office, public, extensions, pg_temp
as $$
declare
  vp office.pastas;
  va office.arquivos;
begin
  perform office.so_funcao(); perform office.exige_ativo(p_user);
  if p_tipo = 'pasta' then
    select * into vp from office.pastas where id = p_id for update;
    if vp.id is null then perform office.erro('pasta não encontrada', 'P0002'); end if;
    if coalesce(p_restaurar, false) then
      if vp.lixeira_em is null or (vp.dono is distinct from p_user and vp.lixeira_por is distinct from p_user) then
        perform office.erro('sem permissão para restaurar', '42501');
      end if;
      -- a pasta de cima também foi para a lixeira: volta para a raiz do dono
      if vp.pai is not null and not office.vivo_pasta(vp.pai) then vp.pai := null; end if;
      update office.pastas set lixeira_em = null, lixeira_por = null, pai = vp.pai where id = p_id returning * into vp;
      perform office.registrar(p_user, 'restaurou', null, p_id);
    else
      if office.papel_pasta(p_user, p_id) < 4 then perform office.erro('só o dono manda para a lixeira', '42501'); end if;
      update office.pastas set lixeira_em = now(), lixeira_por = p_user where id = p_id returning * into vp;
      perform office.registrar(p_user, 'lixeira', null, p_id);
    end if;
    return office.json_pasta(p_user, vp);
  end if;

  select * into va from office.arquivos where id = p_id for update;
  if va.id is null or va.versao = 0 then perform office.erro('arquivo não encontrado', 'P0002'); end if;
  if coalesce(p_restaurar, false) then
    if va.lixeira_em is null or (va.dono is distinct from p_user and va.lixeira_por is distinct from p_user) then
      perform office.erro('sem permissão para restaurar', '42501');
    end if;
    if va.pasta is not null and not office.vivo_pasta(va.pasta) then va.pasta := null; end if;
    update office.arquivos set lixeira_em = null, lixeira_por = null, pasta = va.pasta where id = p_id returning * into va;
    perform office.registrar(p_user, 'restaurou', p_id, null);
  else
    if office.papel_arquivo(p_user, p_id) < 4 then perform office.erro('só o dono manda para a lixeira', '42501'); end if;
    update office.arquivos set lixeira_em = now(), lixeira_por = p_user where id = p_id returning * into va;
    perform office.registrar(p_user, 'lixeira', p_id, null);
  end if;
  return office.json_arquivo(p_user, va);
end $$;

-- quem tem acesso a um item: dono, todos da Lube e pessoas (diretas e herdadas das pastas de cima)
create or replace function public.office_srv_acessos(p_user uuid, p_tipo text, p_id uuid)
returns jsonb language plpgsql stable security definer
set search_path = office, public, extensions, pg_temp
as $$
declare
  v_papel int := office.papel_item(p_user, p_tipo, p_id);
  v_pasta uuid;
  v_dono uuid;
begin
  perform office.so_funcao(); perform office.exige_ativo(p_user);
  if v_papel = 0 then perform office.erro('sem acesso', '42501'); end if;
  if p_tipo = 'pasta' then
    select pai, dono into v_pasta, v_dono from office.pastas where id = p_id;
  else
    select pasta, dono into v_pasta, v_dono from office.arquivos where id = p_id;
  end if;
  return jsonb_build_object(
    'meu_papel', office.papel_txt(v_papel),
    'dono', office.json_pessoa(v_dono),
    'diretos', (select coalesce(jsonb_agg(jsonb_build_object(
                  'pessoa', office.json_pessoa(s.pessoa), 'todos', s.pessoa is null, 'papel', s.papel)
                  order by s.pessoa is not null, s.criado_em), '[]'::jsonb)
                from office.compartilhamentos s
               where (p_tipo = 'pasta' and s.pasta = p_id) or (p_tipo = 'arquivo' and s.arquivo = p_id)),
    'herdados', (select coalesce(jsonb_agg(jsonb_build_object(
                  'pessoa', office.json_pessoa(s.pessoa), 'todos', s.pessoa is null, 'papel', s.papel,
                  'pasta', jsonb_build_object('id', c.id, 'nome', c.nome)) order by c.nivel, s.criado_em), '[]'::jsonb)
                from office.cadeia(v_pasta) c join office.compartilhamentos s on s.pasta = c.id
               where v_pasta is not null));
end $$;

-- compartilhar: p_pessoa nula = todos da Lube; p_papel nulo = tirar o acesso
create or replace function public.office_srv_compartilhar(p_user uuid, p_tipo text, p_id uuid, p_pessoa uuid, p_papel text)
returns jsonb language plpgsql security definer
set search_path = office, public, extensions, pg_temp
as $$
declare
  v_dono uuid;
  v_antes text;
  v_arq uuid := case when p_tipo = 'arquivo' then p_id end;
  v_pas uuid := case when p_tipo = 'pasta' then p_id end;
begin
  perform office.so_funcao(); perform office.exige_ativo(p_user);
  if p_tipo not in ('pasta', 'arquivo') then perform office.erro('tipo inválido', '22023'); end if;
  if office.papel_item(p_user, p_tipo, p_id) < 3 then perform office.erro('sem permissão para compartilhar', '42501'); end if;
  if p_papel is not null and p_papel not in ('ver', 'comentar', 'editar') then perform office.erro('papel inválido', '22023'); end if;
  if (p_tipo = 'pasta' and not office.vivo_pasta(p_id)) or (p_tipo = 'arquivo' and not office.vivo_arquivo(p_id)) then
    perform office.erro('item na lixeira', '22023');
  end if;
  v_dono := case p_tipo when 'pasta' then (select dono from office.pastas where id = p_id)
                        else (select dono from office.arquivos where id = p_id) end;
  if p_pessoa is not null then
    if p_pessoa = v_dono then perform office.erro('o dono já tem acesso total', '22023'); end if;
    if not exists (select 1 from public.profiles where id = p_pessoa and ativo) then
      perform office.erro('pessoa sem acesso ao portal', '22023');
    end if;
  end if;

  select papel into v_antes from office.compartilhamentos s
   where coalesce(s.arquivo, s.pasta) = p_id and s.pessoa is not distinct from p_pessoa;
  delete from office.compartilhamentos s
   where coalesce(s.arquivo, s.pasta) = p_id and s.pessoa is not distinct from p_pessoa;

  if p_papel is not null then
    insert into office.compartilhamentos (arquivo, pasta, pessoa, papel, criado_por)
    values (v_arq, v_pas, p_pessoa, p_papel, p_user);
    if p_pessoa is not null and p_pessoa <> p_user and v_antes is distinct from p_papel then
      insert into office.avisos (para, de, arquivo, pasta, tipo, mensagem)
      values (p_pessoa, p_user, v_arq, v_pas, 'compartilhou', p_papel);
    end if;
  end if;
  perform office.registrar(p_user, case when p_papel is null then 'tirou_acesso' else 'compartilhou' end,
                           v_arq, v_pas, jsonb_build_object('pessoa', p_pessoa, 'papel', p_papel, 'antes', v_antes));
  return public.office_srv_acessos(p_user, p_tipo, p_id);
end $$;

-- pessoas do portal para compartilhar e mencionar
create or replace function public.office_srv_pessoas(p_user uuid, p_busca text)
returns jsonb language plpgsql stable security definer
set search_path = office, public, extensions, pg_temp
as $$
declare
  v_busca text := nullif(btrim(coalesce(p_busca, '')), '');
  v_padrao text;
begin
  perform office.so_funcao(); perform office.exige_ativo(p_user);
  v_padrao := case when v_busca is null then '%'
                   else '%' || replace(replace(replace(v_busca, '\', '\\'), '%', '\%'), '_', '\_') || '%' end;
  return (select coalesce(jsonb_agg(office.json_pessoa(p.id) order by lower(coalesce(nullif(p.nome, ''), p.email))), '[]'::jsonb)
            from (select p.id, p.nome, p.email from public.profiles p
                   where p.ativo and (p.nome ilike v_padrao or p.email ilike v_padrao)
                   order by lower(coalesce(nullif(p.nome, ''), p.email)) limit 200) p);
end $$;

-- abrir no editor: confere o papel e devolve o que a função precisa para montar o editor
create or replace function public.office_srv_abrir(p_user uuid, p_arquivo uuid)
returns jsonb language plpgsql security definer
set search_path = office, public, extensions, pg_temp
as $$
declare
  v office.arquivos;
  v_papel int;
begin
  perform office.so_funcao(); perform office.exige_ativo(p_user);
  select * into v from office.arquivos where id = p_arquivo;
  v_papel := office.papel_arquivo(p_user, p_arquivo);
  if v.id is null or v_papel = 0 or not office.vivo_arquivo(p_arquivo) then
    perform office.erro('arquivo não encontrado ou sem acesso', 'P0002');
  end if;
  -- "abriu" conta uma vez a cada 10 minutos por pessoa (alimenta os Recentes)
  if not exists (select 1 from office.atividades t where t.arquivo = p_arquivo and t.pessoa = p_user
                   and t.acao = 'abriu' and t.em > now() - interval '10 minutes') then
    perform office.registrar(p_user, 'abriu', p_arquivo, null);
  end if;
  return office.json_arquivo(p_user, v) || jsonb_build_object(
    'caminho', v.caminho,
    'chave', v.id || '-' || v.versao,
    'pasta_nome', (select nome from office.pastas where id = v.pasta));
end $$;

-- baixar: versão atual (p_numero nulo) ou uma versão do histórico
create or replace function public.office_srv_baixar(p_user uuid, p_arquivo uuid, p_numero int)
returns jsonb language plpgsql security definer
set search_path = office, public, extensions, pg_temp
as $$
declare
  v office.arquivos;
  v_caminho text;
begin
  perform office.so_funcao(); perform office.exige_ativo(p_user);
  select * into v from office.arquivos where id = p_arquivo;
  if v.id is null or v.versao = 0 or office.papel_arquivo(p_user, p_arquivo) = 0 then
    perform office.erro('arquivo não encontrado ou sem acesso', 'P0002');
  end if;
  if p_numero is null then v_caminho := v.caminho;
  else select caminho into v_caminho from office.versoes where arquivo = p_arquivo and numero = p_numero;
  end if;
  if v_caminho is null then perform office.erro('versão não encontrada', 'P0002'); end if;
  perform office.registrar(p_user, 'baixou', p_arquivo, null, jsonb_build_object('versao', coalesce(p_numero, v.versao)));
  return jsonb_build_object('caminho', v_caminho, 'nome', v.nome || '.' || v.extensao);
end $$;

-- o motor de edição devolveu o arquivo: nova versão com quem editou
create or replace function public.office_srv_salvar(p_arquivo uuid, p_chave text, p_autores uuid[], p_tamanho bigint, p_caminho text, p_origem text)
returns jsonb language plpgsql security definer
set search_path = office, public, extensions, pg_temp
as $$
declare
  v office.arquivos;
  v_autores uuid[];
  v_pessoa uuid;
begin
  perform office.so_funcao();
  if p_origem not in ('editor', 'forcada') then perform office.erro('origem inválida', '22023'); end if;
  select * into v from office.arquivos where id = p_arquivo for update;
  if v.id is null or v.versao = 0 then perform office.erro('arquivo não encontrado', 'P0002'); end if;
  if p_caminho is null or left(p_caminho, length('arquivos/' || p_arquivo || '/')) <> 'arquivos/' || p_arquivo || '/' then
    perform office.erro('caminho fora do arquivo', '22023');
  end if;
  select coalesce(array_agg(p.id), '{}') into v_autores
    from public.profiles p where p.id = any(coalesce(p_autores, '{}'));
  update office.arquivos
     set versao = v.versao + 1, caminho = p_caminho, tamanho = greatest(coalesce(p_tamanho, 0), 0),
         alterado_em = now(), alterado_por = coalesce(v_autores[1], v.alterado_por)
   where id = p_arquivo returning * into v;
  insert into office.versoes (arquivo, numero, caminho, tamanho, origem, autores)
  values (v.id, v.versao, v.caminho, v.tamanho, p_origem, v_autores);
  foreach v_pessoa in array v_autores loop
    perform office.registrar(v_pessoa, 'editou', p_arquivo, null,
      jsonb_build_object('versao', v.versao, 'chave', p_chave));
  end loop;
  return jsonb_build_object('versao', v.versao, 'chave', v.id || '-' || v.versao);
end $$;

create or replace function public.office_srv_versoes(p_user uuid, p_arquivo uuid)
returns jsonb language plpgsql stable security definer
set search_path = office, public, extensions, pg_temp
as $$
begin
  perform office.so_funcao(); perform office.exige_ativo(p_user);
  if office.papel_arquivo(p_user, p_arquivo) = 0 then perform office.erro('sem acesso', '42501'); end if;
  return jsonb_build_object(
    'versoes', (select coalesce(jsonb_agg(jsonb_build_object(
                  'numero', r.numero, 'criado_em', r.criado_em, 'tamanho', r.tamanho, 'origem', r.origem,
                  'autores', (select coalesce(jsonb_agg(office.json_pessoa(u)), '[]'::jsonb) from unnest(r.autores) u))
                  order by r.numero desc), '[]'::jsonb)
                from office.versoes r where r.arquivo = p_arquivo),
    'atividades', (select coalesce(jsonb_agg(jsonb_build_object(
                  'pessoa', office.json_pessoa(t.pessoa), 'acao', t.acao, 'detalhe', t.detalhe, 'em', t.em)
                  order by t.em desc), '[]'::jsonb)
                from (select * from office.atividades where arquivo = p_arquivo order by em desc limit 40) t));
end $$;

create or replace function public.office_srv_versao_restaurar(p_user uuid, p_arquivo uuid, p_numero int)
returns jsonb language plpgsql security definer
set search_path = office, public, extensions, pg_temp
as $$
declare
  v office.arquivos;
  r office.versoes;
begin
  perform office.so_funcao(); perform office.exige_ativo(p_user);
  if office.papel_arquivo(p_user, p_arquivo) < 3 or not office.vivo_arquivo(p_arquivo) then
    perform office.erro('sem permissão para restaurar versão', '42501');
  end if;
  select * into r from office.versoes where arquivo = p_arquivo and numero = p_numero;
  if r.id is null then perform office.erro('versão não encontrada', 'P0002'); end if;
  select * into v from office.arquivos where id = p_arquivo for update;
  update office.arquivos set versao = v.versao + 1, caminho = r.caminho, tamanho = r.tamanho,
         alterado_em = now(), alterado_por = p_user
   where id = p_arquivo returning * into v;
  insert into office.versoes (arquivo, numero, caminho, tamanho, origem, autores)
  values (v.id, v.versao, r.caminho, r.tamanho, 'restaurada', array[p_user]);
  perform office.registrar(p_user, 'versao_restaurada', p_arquivo, null,
    jsonb_build_object('de', p_numero, 'nova', v.versao));
  return office.json_arquivo(p_user, v);
end $$;

-- @menção num comentário: aviso para quem já tem acesso; devolve quem ficou sem
create or replace function public.office_srv_mencionar(p_user uuid, p_arquivo uuid, p_emails text[], p_mensagem text)
returns jsonb language plpgsql security definer
set search_path = office, public, extensions, pg_temp
as $$
declare
  v_email text;
  v_pessoa uuid;
  v_avisados jsonb := '[]'::jsonb;
  v_sem jsonb := '[]'::jsonb;
  v_msg text := left(btrim(coalesce(p_mensagem, '')), 500);
begin
  perform office.so_funcao(); perform office.exige_ativo(p_user);
  if office.papel_arquivo(p_user, p_arquivo) < 2 or not office.vivo_arquivo(p_arquivo) then
    perform office.erro('sem permissão para comentar', '42501');
  end if;
  foreach v_email in array coalesce(p_emails, '{}') loop
    select p.id into v_pessoa from public.profiles p where p.email = lower(btrim(v_email)) and p.ativo;
    if v_pessoa is null then
      v_sem := v_sem || to_jsonb(lower(btrim(v_email)));
    elsif office.papel_arquivo(v_pessoa, p_arquivo) = 0 then
      v_sem := v_sem || office.json_pessoa(v_pessoa);
    elsif v_pessoa <> p_user then
      insert into office.avisos (para, de, arquivo, tipo, mensagem)
      values (v_pessoa, p_user, p_arquivo, 'mencao', v_msg);
      v_avisados := v_avisados || office.json_pessoa(v_pessoa);
    end if;
    v_pessoa := null;
  end loop;
  perform office.registrar(p_user, 'mencionou', p_arquivo, null,
    jsonb_build_object('avisados', jsonb_array_length(v_avisados)));
  return jsonb_build_object('avisados', v_avisados, 'sem_acesso', v_sem);
end $$;

create or replace function public.office_srv_avisos(p_user uuid, p_limite int)
returns jsonb language plpgsql stable security definer
set search_path = office, public, extensions, pg_temp
as $$
begin
  perform office.so_funcao(); perform office.exige_ativo(p_user);
  return jsonb_build_object(
    'nao_lidos', (select count(*) from office.avisos where para = p_user and lido_em is null),
    'avisos', (select coalesce(jsonb_agg(jsonb_build_object(
                 'id', v.id, 'tipo', v.tipo, 'mensagem', v.mensagem, 'criado_em', v.criado_em, 'lido_em', v.lido_em,
                 'de', office.json_pessoa(v.de),
                 'arquivo', (select jsonb_build_object('id', a.id, 'nome', a.nome, 'extensao', a.extensao)
                               from office.arquivos a where a.id = v.arquivo),
                 'pasta', (select jsonb_build_object('id', p.id, 'nome', p.nome) from office.pastas p where p.id = v.pasta))
                 order by v.criado_em desc), '[]'::jsonb)
               from (select * from office.avisos where para = p_user
                      order by criado_em desc limit least(greatest(coalesce(p_limite, 30), 1), 100)) v));
end $$;

create or replace function public.office_srv_avisos_lidos(p_user uuid, p_ids uuid[])
returns jsonb language plpgsql security definer
set search_path = office, public, extensions, pg_temp
as $$
declare v_n int;
begin
  perform office.so_funcao(); perform office.exige_ativo(p_user);
  update office.avisos set lido_em = now()
   where para = p_user and lido_em is null and (p_ids is null or id = any(p_ids));
  get diagnostics v_n = row_count;
  return jsonb_build_object('marcados', v_n);
end $$;

-- ---------------------------------------------------------
-- 5. QUEM EXECUTA: só a service_role (a Edge Function)
-- ---------------------------------------------------------
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as assinatura
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'office\_srv\_%'
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.assinatura);
    execute format('grant execute on function %s to service_role', f.assinatura);
  end loop;
end $$;
