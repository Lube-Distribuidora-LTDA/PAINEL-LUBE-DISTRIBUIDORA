-- =========================================================
-- 03_sac_acesso.sql — contas do SAC (RCAs e supervisores), 2026-10-09
--
-- O SAC (sac-lube.vercel.app) passou a ter login próprio, na mesma base de
-- login do Painel (Supabase Auth deste projeto), com "Entrar" e "Primeiro
-- acesso" iguais aos do portal. Pedido do Júlio: o primeiro acesso avisa o TI
-- no painel administrativo, numa aba separada da dos usuários do painel.
--
-- Regras:
--  - Conta do SAC NUNCA vira usuário do painel: não ganha linha em profiles,
--    então is_admin()/is_ativo() dão falso e o portal não abre nada para ela.
--  - Nasce "pendente"; só o TI libera (aba SAC do painel administrativo).
--  - O cadastro pelo SAC aceita e-mail de fora de @lube.com.br (os RCAs usam
--    Gmail/Hotmail). A marca vem em raw_user_meta_data->>'sistema' = 'sac', que
--    o navegador controla: por isso a marca só dá direito a uma conta PENDENTE do
--    SAC — nunca a perfil do painel. Quem cadastra lixo fica parado na fila.
-- =========================================================

-- ---------------------------------------------------------
-- 1. Contas do SAC
-- ---------------------------------------------------------
create table if not exists public.sac_usuarios (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text not null unique check (email = lower(email)),
  nome          text not null default '',
  tipo          text not null default 'rca' check (tipo in ('rca', 'supervisor')),
  codusur       integer,              -- código do RCA no WinThor (conferido pelo SAC no cadastro); null para supervisor
  situacao      text not null default 'pendente'
                check (situacao in ('pendente', 'liberado', 'recusado', 'bloqueado')),
  criado_em     timestamptz not null default now(),
  decidido_em   timestamptz,
  decidido_por  uuid references public.profiles(id) on delete set null
);

comment on table public.sac_usuarios is
  'Contas do SAC (RCAs e supervisores, sistema de fora). Separadas de profiles: nunca abrem o painel. Nascem pendentes; o TI libera na aba SAC do painel admin.';

create index if not exists sac_usuarios_pendentes_idx on public.sac_usuarios (criado_em) where situacao = 'pendente';

-- ---------------------------------------------------------
-- 2. Acessos do SAC (separados de public.acessos, que é do painel)
-- ---------------------------------------------------------
create table if not exists public.sac_acessos (
  id         bigserial primary key,
  user_id    uuid references auth.users(id) on delete set null,
  email      text,
  acao       text not null check (acao in ('cadastro', 'pedido', 'login', 'logout', 'chamado')),
  detalhe    text not null default '',
  criado_em  timestamptz not null default now()
);

create index if not exists sac_acessos_data_idx on public.sac_acessos (criado_em desc);

-- ---------------------------------------------------------
-- 3. Gatilho de novo usuário: conta do SAC desvia antes da regra do domínio
-- ---------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tipo text;
  v_cod  text;
begin
  -- Conta do SAC: fila do TI, sem perfil do painel.
  if coalesce(new.raw_user_meta_data->>'sistema', '') = 'sac' then
    v_tipo := case when new.raw_user_meta_data->>'tipo' = 'supervisor' then 'supervisor' else 'rca' end;
    v_cod  := new.raw_user_meta_data->>'codusur';
    insert into public.sac_usuarios (id, email, nome, tipo, codusur)
    values (
      new.id,
      lower(new.email),
      left(btrim(coalesce(new.raw_user_meta_data->>'nome', '')), 120),
      v_tipo,
      case when v_tipo = 'rca' and v_cod ~ '^[0-9]{1,6}$' then v_cod::integer end
    )
    on conflict (id) do nothing;
    insert into public.sac_acessos (user_id, email, acao, detalhe)
    values (new.id, lower(new.email), 'cadastro', v_tipo);
    return new;
  end if;

  -- Painel: só @lube.com.br ou e-mail liberado um a um.
  if lower(new.email) not like '%@lube.com.br'
     and not exists (select 1 from public.emails_externos e where e.email = lower(new.email)) then
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

-- ---------------------------------------------------------
-- 4. Funções que o SAC chama (com o token de quem está logado)
-- ---------------------------------------------------------
-- Situação da conta de quem está logado. Sem linha no SAC:
--   'sem_cadastro' (e corporativo = true se for usuário do painel).
create or replace function public.sac_meu_acesso()
returns json
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select json_build_object('situacao', s.situacao, 'nome', s.nome, 'email', s.email,
                              'tipo', s.tipo, 'codusur', s.codusur)
       from public.sac_usuarios s where s.id = auth.uid()),
    json_build_object('situacao', 'sem_cadastro',
                      'corporativo', exists (select 1 from public.profiles p where p.id = auth.uid()))
  );
$$;

-- Usuário do painel (e-mail @lube) que quer usar o SAC: entra na mesma fila.
create or replace function public.sac_pedir_acesso(p_tipo text default 'rca')
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_nome  text;
begin
  if auth.uid() is null then
    raise exception 'sem sessão';
  end if;
  select lower(u.email), coalesce(p.nome, '') into v_email, v_nome
    from auth.users u left join public.profiles p on p.id = u.id
   where u.id = auth.uid();
  insert into public.sac_usuarios (id, email, nome, tipo)
  values (auth.uid(), v_email, v_nome, case when p_tipo = 'supervisor' then 'supervisor' else 'rca' end)
  on conflict (id) do nothing;
  insert into public.sac_acessos (user_id, email, acao) values (auth.uid(), v_email, 'pedido');
  return public.sac_meu_acesso();
end;
$$;

-- Registro de entrada, saída e chamado enviado — só para conta liberada.
create or replace function public.sac_registrar(p_acao text, p_detalhe text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
begin
  if p_acao not in ('login', 'logout', 'chamado') then
    raise exception 'ação inválida';
  end if;
  select s.email into v_email from public.sac_usuarios s
   where s.id = auth.uid() and s.situacao = 'liberado';
  if v_email is null then
    return;
  end if;
  insert into public.sac_acessos (user_id, email, acao, detalhe)
  values (auth.uid(), v_email, p_acao, left(coalesce(p_detalhe, ''), 200));
end;
$$;

revoke all on function public.sac_meu_acesso()            from public, anon;
revoke all on function public.sac_pedir_acesso(text)       from public, anon;
revoke all on function public.sac_registrar(text, text)    from public, anon;
grant execute on function public.sac_meu_acesso()          to authenticated;
grant execute on function public.sac_pedir_acesso(text)    to authenticated;
grant execute on function public.sac_registrar(text, text) to authenticated;

-- ---------------------------------------------------------
-- 5. RLS: a pessoa vê a própria conta; o admin vê e decide tudo
-- ---------------------------------------------------------
alter table public.sac_usuarios enable row level security;
alter table public.sac_acessos  enable row level security;

drop policy if exists sac_usuarios_self  on public.sac_usuarios;
drop policy if exists sac_usuarios_admin on public.sac_usuarios;
create policy sac_usuarios_self on public.sac_usuarios
  for select to authenticated using (id = auth.uid());
create policy sac_usuarios_admin on public.sac_usuarios
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists sac_acessos_admin on public.sac_acessos;
create policy sac_acessos_admin on public.sac_acessos
  for select to authenticated using (public.is_admin());

revoke all on public.sac_usuarios from anon;
revoke all on public.sac_acessos  from anon;
revoke insert, update, delete on public.sac_acessos from authenticated;
