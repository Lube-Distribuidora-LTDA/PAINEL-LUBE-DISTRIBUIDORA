-- =========================================================
-- PAINEL LUBE — menu lateral "BI LUBE" e BI aberto dentro do painel
-- (pedido do Júlio, 2026-10-22)
--
-- 1) sistemas.abre_no_painel: o TI liga, no admin, quando o sistema já aceita
--    ser mostrado dentro do painel (frame-ancestors liberado para o portal e
--    guarda da Sentinela 1.2.0). Desligado = abre em nova aba, como sempre.
-- 2) favoritos: os BIs que cada pessoa fixa no menu. Cada um só vê e mexe
--    nos próprios.
-- =========================================================

alter table public.sistemas
  add column if not exists abre_no_painel boolean not null default false;

create table if not exists public.favoritos (
  user_id    uuid not null references auth.users(id) on delete cascade,
  sistema_id uuid not null references public.sistemas(id) on delete cascade,
  criado_em  timestamptz not null default now(),
  primary key (user_id, sistema_id)
);

alter table public.favoritos enable row level security;

drop policy if exists favoritos_ler on public.favoritos;
create policy favoritos_ler on public.favoritos
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists favoritos_criar on public.favoritos;
create policy favoritos_criar on public.favoritos
  for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists favoritos_apagar on public.favoritos;
create policy favoritos_apagar on public.favoritos
  for delete to authenticated using (user_id = (select auth.uid()));

create index if not exists favoritos_sistema_idx on public.favoritos (sistema_id);

grant select, insert, delete on public.favoritos to authenticated;
