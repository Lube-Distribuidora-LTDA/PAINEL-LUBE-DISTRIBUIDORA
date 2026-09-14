-- =========================================================
-- PAINEL LUBE DISTRIBUIDORA — controle de acesso
-- Tabelas, gatilhos e políticas (RLS)
-- =========================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------
-- 1. PERFIS (espelho de auth.users com os dados do portal)
-- ---------------------------------------------------------
create table if not exists public.profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  email          text not null unique,
  nome           text not null default '',
  cargo          text not null default '',
  is_admin       boolean not null default false,
  ativo          boolean not null default false,   -- primeiro acesso nasce pendente
  aprovado_em    timestamptz,                      -- null = ainda não liberado pelo TI
  aprovado_por   uuid references public.profiles(id) on delete set null,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);

comment on table public.profiles is 'Usuários do painel. Criado automaticamente ao cadastrar em auth.users.';
comment on column public.profiles.aprovado_em is
  'null = cadastro feito pelo botão "Primeiro acesso" e ainda não liberado pelo TI';

-- ---------------------------------------------------------
-- 2. SISTEMAS DA EMPRESA
-- ---------------------------------------------------------
create table if not exists public.sistemas (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique,
  nome       text not null,
  categoria  text not null default '',
  descricao  text not null default '',
  url        text not null,
  badge      text not null default 'saida',   -- chave do ícone: saida | rh | icms
  ordem      int  not null default 0,
  ativo      boolean not null default true,
  criado_em  timestamptz not null default now()
);

-- ---------------------------------------------------------
-- 3. PERMISSÕES (quem enxerga qual sistema)
-- ---------------------------------------------------------
create table if not exists public.permissoes (
  user_id       uuid not null references public.profiles(id) on delete cascade,
  sistema_id    uuid not null references public.sistemas(id) on delete cascade,
  concedido_em  timestamptz not null default now(),
  concedido_por uuid references public.profiles(id) on delete set null,
  primary key (user_id, sistema_id)
);

create index if not exists permissoes_user_idx on public.permissoes(user_id);

-- ---------------------------------------------------------
-- 4. REGISTRO DE ACESSOS
-- ---------------------------------------------------------
create table if not exists public.acessos (
  id         bigserial primary key,
  user_id    uuid references public.profiles(id) on delete set null,
  email      text,
  acao       text not null,                   -- login | logout | abriu_sistema
  sistema_id uuid references public.sistemas(id) on delete set null,
  criado_em  timestamptz not null default now()
);

create index if not exists acessos_data_idx on public.acessos(criado_em desc);

-- ---------------------------------------------------------
-- 5. DOMÍNIO OBRIGATÓRIO @lube.com.br + criação do perfil
--    Roda no banco: não dá para burlar pelo navegador.
-- ---------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if lower(new.email) not like '%@lube.com.br' then
    raise exception 'Acesso restrito: use um e-mail @lube.com.br';
  end if;

  insert into public.profiles (id, email, nome, cargo)
  values (
    new.id,
    lower(new.email),
    coalesce(new.raw_user_meta_data->>'nome', ''),
    coalesce(new.raw_user_meta_data->>'cargo', '')
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- mantém atualizado_em em dia
create or replace function public.touch_profile()
returns trigger language plpgsql set search_path = public as $$
begin
  new.atualizado_em = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch
  before update on public.profiles
  for each row execute function public.touch_profile();

-- ---------------------------------------------------------
-- 6. AJUDANTES (security definer evita recursão nas policies)
-- ---------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.is_admin and p.ativo from public.profiles p where p.id = auth.uid()),
    false
  );
$$;

create or replace function public.is_ativo()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.ativo from public.profiles p where p.id = auth.uid()),
    false
  );
$$;

-- ---------------------------------------------------------
-- 7. RLS
-- ---------------------------------------------------------
alter table public.profiles   enable row level security;
alter table public.sistemas   enable row level security;
alter table public.permissoes enable row level security;
alter table public.acessos    enable row level security;

-- perfis ------------------------------------------------
drop policy if exists profiles_self_select  on public.profiles;
drop policy if exists profiles_admin_select on public.profiles;
drop policy if exists profiles_admin_write  on public.profiles;

create policy profiles_self_select on public.profiles
  for select to authenticated using (id = auth.uid());

create policy profiles_admin_select on public.profiles
  for select to authenticated using (public.is_admin());

create policy profiles_admin_write on public.profiles
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- sistemas ----------------------------------------------
drop policy if exists sistemas_read  on public.sistemas;
drop policy if exists sistemas_admin on public.sistemas;

create policy sistemas_read on public.sistemas
  for select to authenticated
  using (
    public.is_admin()
    or (
      public.is_ativo()
      and exists (
        select 1 from public.permissoes p
        where p.sistema_id = sistemas.id and p.user_id = auth.uid()
      )
    )
  );

create policy sistemas_admin on public.sistemas
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- permissões --------------------------------------------
drop policy if exists permissoes_self  on public.permissoes;
drop policy if exists permissoes_admin on public.permissoes;

create policy permissoes_self on public.permissoes
  for select to authenticated using (user_id = auth.uid() and public.is_ativo());

create policy permissoes_admin on public.permissoes
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- acessos -----------------------------------------------
drop policy if exists acessos_insert on public.acessos;
drop policy if exists acessos_admin  on public.acessos;

create policy acessos_insert on public.acessos
  for insert to authenticated with check (user_id = auth.uid());

create policy acessos_admin on public.acessos
  for select to authenticated using (public.is_admin());

-- ---------------------------------------------------------
-- 8. PRIVILÉGIOS DAS FUNÇÕES
--    Gatilhos não devem ser chamáveis pela API REST; os
--    ajudantes das policies só valem para quem já entrou.
-- ---------------------------------------------------------
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.touch_profile()  from public, anon, authenticated;
revoke all on function public.is_admin() from public, anon;
revoke all on function public.is_ativo() from public, anon;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_ativo() to authenticated;

-- ---------------------------------------------------------
-- 9. SISTEMAS INICIAIS
-- ---------------------------------------------------------
insert into public.sistemas (slug, nome, categoria, descricao, url, badge, ordem) values
  ('saida-veiculos', 'Gestão de Saída de Veículos', 'Gestão Operacional e Comercial',
   'Controle de liberação, conferência e rastreio da frota em saída.',
   'https://gestao-de-saidas-de-veiculos.vercel.app/', 'saida', 1),
  ('rh-absenteismo', 'Controle RH — Absenteísmo', 'Gestão de RH',
   'Indicadores de faltas, afastamentos e presença por setor.',
   'https://rh-absentismo.vercel.app/', 'rh', 2),
  ('painel-icms', 'Painel ICMS', 'Contabilidade',
   'Apuração, acompanhamento fiscal e visão analítica do ICMS.',
   'https://painel-icms.vercel.app/', 'icms', 3)
on conflict (slug) do nothing;
