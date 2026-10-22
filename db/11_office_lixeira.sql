-- =========================================================
-- LUBE OFFICE — lixeira de 3 dias (2026-10-22)
-- Migração office_v7_lixeira_3_dias. Pedido do Júlio: "A lixeira só pode ficar arquivo
-- ali até 3 dias, depois disso é excluído e retirado do banco para não ocupar espaço".
--
-- Passou do prazo (office.config 'lixeira' = {"dias": 3}): o item não volta mais e, na
-- limpeza de hora em hora, sai do Storage (todas as versões) e do banco. Pasta leva tudo o
-- que está dentro (subpastas e arquivos). Envio que nunca foi confirmado (versao 0) sai
-- depois de 1 dia. Cada limpeza fica em office.limpezas (só contagens, sem nomes).
--
-- Quem limpa: o pg_cron (aos :17 de toda hora) chama a Edge Function office
-- (/office/limpeza) só quando há algo vencido. O arquivo sai pela API do Storage: o
-- Supabase não deixa apagar pelo SQL (gatilho protect_objects_delete) e, se deixasse, o
-- arquivo continuaria ocupando espaço. A chamada leva uma senha gerada aqui, que fica só
-- em office.config ('limpeza'): ninguém cadastra nem copia.
-- =========================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

insert into office.config (chave, valor) values ('lixeira', '{"dias": 3}')
on conflict (chave) do nothing;
insert into office.config (chave, valor)
values ('limpeza', jsonb_build_object('token', encode(extensions.gen_random_bytes(32), 'hex')))
on conflict (chave) do nothing;

create table if not exists office.limpezas (
  id       bigserial primary key,
  em       timestamptz not null default now(),
  arquivos int not null default 0,
  pastas   int not null default 0,
  objetos  int not null default 0,
  bytes    bigint not null default 0,
  erro     text
);
alter table office.limpezas enable row level security;
revoke all on office.limpezas from public, anon, authenticated;
revoke all on sequence office.limpezas_id_seq from public, anon, authenticated;

-- ---------------------------------------------------------
-- prazo e o que venceu
-- ---------------------------------------------------------
create or replace function office.lixeira_dias()
returns int language sql stable
set search_path = office, public, extensions, pg_temp
as $$
  select least(greatest(coalesce((select (valor->>'dias')::int from office.config where chave = 'lixeira'), 3), 1), 90)
$$;

create or replace function office.lixeira_vencida(p_em timestamptz)
returns boolean language sql stable
set search_path = office, public, extensions, pg_temp
as $$ select p_em is not null and p_em < now() - make_interval(days => office.lixeira_dias()) $$;

-- a pasta (ou uma acima dela) passou do prazo na lixeira
create or replace function office.vencida_pasta(p_pasta uuid)
returns boolean language sql stable
set search_path = office, public, extensions, pg_temp
as $$ select exists (select 1 from office.cadeia(p_pasta) c where office.lixeira_vencida(c.lixeira_em)) $$;

create or replace function office.vencido_arquivo(p_arquivo uuid)
returns boolean language sql stable
set search_path = office, public, extensions, pg_temp
as $$
  select coalesce((select office.lixeira_vencida(a.lixeira_em) or (a.pasta is not null and office.vencida_pasta(a.pasta))
                     from office.arquivos a where a.id = p_arquivo), false)
$$;

-- o que a limpeza leva: arquivos (até p_limite por vez) e pastas, com a profundidade
-- (a pasta mais funda sai primeiro)
create or replace function office.vencidos(p_limite int default 100)
returns table (tipo text, id uuid, nivel int)
language sql stable
set search_path = office, public, extensions, pg_temp
as $$
  with recursive arvore as (
    select p.id, 0 as nivel from office.pastas p where office.lixeira_vencida(p.lixeira_em)
    union all
    select p.id, a.nivel + 1 from office.pastas p join arvore a on p.pai = a.id where a.nivel < 64
  ),
  fora as (select arvore.id, max(arvore.nivel) as nivel from arvore group by arvore.id)
  select * from (
    select 'arquivo'::text, a.id, 0 from office.arquivos a
     where office.lixeira_vencida(a.lixeira_em)
        or (a.versao = 0 and a.criado_em < now() - interval '1 day')
        or a.pasta in (select fora.id from fora)
     order by a.criado_em
     limit greatest(coalesce(p_limite, 100), 1)
  ) x
  union all
  select 'pasta'::text, fora.id, fora.nivel from fora
$$;

create or replace function office.exige_limpeza(p_token text)
returns void language plpgsql stable
set search_path = office, public, extensions, pg_temp
as $$
begin
  if length(coalesce(p_token, '')) < 32
     or p_token is distinct from (select valor->>'token' from office.config where chave = 'limpeza') then
    perform office.erro('limpeza não autorizada', '42501');
  end if;
end $$;

-- ---------------------------------------------------------
-- funções da Edge Function
-- ---------------------------------------------------------
create or replace function public.office_srv_lixeira_dias()
returns int language sql stable security definer
set search_path = office, public, extensions, pg_temp
as $$ select office.lixeira_dias() $$;

-- o que venceu, com os caminhos no Storage (versão atual e todas as antigas)
create or replace function public.office_srv_lixeira_vencidos(p_token text, p_limite int default 100)
returns jsonb language plpgsql stable security definer
set search_path = office, public, extensions, pg_temp
as $$
declare v jsonb;
begin
  perform office.so_funcao(); perform office.exige_limpeza(p_token);
  select jsonb_build_object(
    'dias', office.lixeira_dias(),
    'arquivos', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'caminhos',
               (select coalesce(jsonb_agg(distinct c), '[]'::jsonb) from (
                  select a.caminho as c where a.caminho is not null
                  union select s.caminho from office.versoes s where s.arquivo = a.id) cs)))
        from office.vencidos(p_limite) x join office.arquivos a on a.id = x.id where x.tipo = 'arquivo'), '[]'::jsonb),
    'pastas', coalesce((select jsonb_agg(x.id order by x.nivel desc) from office.vencidos(p_limite) x where x.tipo = 'pasta'), '[]'::jsonb))
  into v;
  return v;
end $$;

-- apaga do banco o que já saiu do Storage. Confere de novo o prazo: só apaga o que venceu.
-- Pasta só sai vazia (o que ficou dentro sai na próxima hora).
create or replace function public.office_srv_lixeira_apagar(p_token text, p_arquivos uuid[], p_pastas uuid[],
  p_objetos int, p_bytes bigint, p_erro text)
returns jsonb language plpgsql security definer
set search_path = office, public, extensions, pg_temp
as $$
declare
  v_arq uuid[];
  v_pastas int := 0;
  v_p record;
  n int;
begin
  perform office.so_funcao(); perform office.exige_limpeza(p_token);
  select coalesce(array_agg(x.id), '{}') into v_arq
    from office.vencidos(100000) x where x.tipo = 'arquivo' and x.id = any(coalesce(p_arquivos, '{}'));
  delete from office.versoes where arquivo = any(v_arq);
  delete from office.arquivos where id = any(v_arq);
  for v_p in select x.id from office.vencidos(0) x
              where x.tipo = 'pasta' and x.id = any(coalesce(p_pastas, '{}')) order by x.nivel desc loop
    delete from office.pastas p where p.id = v_p.id
       and not exists (select 1 from office.arquivos a where a.pasta = v_p.id)
       and not exists (select 1 from office.pastas f where f.pai = v_p.id);
    get diagnostics n = row_count;
    v_pastas := v_pastas + n;
  end loop;
  if cardinality(v_arq) > 0 or v_pastas > 0 or p_erro is not null then
    insert into office.limpezas (arquivos, pastas, objetos, bytes, erro)
    values (cardinality(v_arq), v_pastas, coalesce(p_objetos, 0), coalesce(p_bytes, 0), left(p_erro, 2000));
  end if;
  return jsonb_build_object('arquivos', cardinality(v_arq), 'pastas', v_pastas,
                            'objetos', coalesce(p_objetos, 0), 'bytes', coalesce(p_bytes, 0));
end $$;

revoke execute on function public.office_srv_lixeira_dias() from public, anon, authenticated;
revoke execute on function public.office_srv_lixeira_vencidos(text, int) from public, anon, authenticated;
revoke execute on function public.office_srv_lixeira_apagar(text, uuid[], uuid[], int, bigint, text) from public, anon, authenticated;
grant execute on function public.office_srv_lixeira_dias() to service_role;
grant execute on function public.office_srv_lixeira_vencidos(text, int) to service_role;
grant execute on function public.office_srv_lixeira_apagar(text, uuid[], uuid[], int, bigint, text) to service_role;

-- ---------------------------------------------------------
-- restaurar: passou do prazo, não volta mais (a limpeza já pode estar apagando)
-- ---------------------------------------------------------
create or replace function public.office_srv_lixeira(p_user uuid, p_tipo text, p_id uuid, p_restaurar boolean)
returns jsonb language plpgsql security definer
set search_path = office, public, extensions, pg_temp
as $$
declare
  vp office.pastas;
  va office.arquivos;
  v_venceu text := 'passou de ' || office.lixeira_dias() || ' dias na lixeira e vai ser apagado para sempre; não dá mais para restaurar';
begin
  perform office.so_funcao(); perform office.exige_ativo(p_user);
  if p_tipo = 'pasta' then
    select * into vp from office.pastas where id = p_id for update;
    if vp.id is null then perform office.erro('pasta não encontrada', 'P0002'); end if;
    if coalesce(p_restaurar, false) then
      if vp.lixeira_em is null or (vp.dono is distinct from p_user and vp.lixeira_por is distinct from p_user) then
        perform office.erro('sem permissão para restaurar', '42501');
      end if;
      if office.vencida_pasta(p_id) then perform office.erro(v_venceu, '22023'); end if;
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
    if office.vencido_arquivo(p_id) then perform office.erro(v_venceu, '22023'); end if;
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

-- ---------------------------------------------------------
-- agendamento: de hora em hora, só chama a função quando há algo vencido
-- ---------------------------------------------------------
create or replace function office.limpeza_disparar()
returns bigint language plpgsql security definer
set search_path = office, public, extensions, pg_temp
as $$
declare
  v_token text;
begin
  if not exists (select 1 from office.vencidos(1)) then return null; end if;
  select valor->>'token' into v_token from office.config where chave = 'limpeza';
  if v_token is null then return null; end if;
  return net.http_post(
    url := 'https://wkkdcsqwlxjxorutrbnx.supabase.co/functions/v1/office/limpeza',
    body := jsonb_build_object('token', v_token),
    headers := jsonb_build_object('Content-Type', 'application/json'),
    timeout_milliseconds := 120000);
end $$;
revoke execute on function office.limpeza_disparar() from public, anon, authenticated;

select cron.schedule('office-limpeza-lixeira', '17 * * * *', 'select office.limpeza_disparar()');
