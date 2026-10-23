-- =========================================================
-- LUBE OFFICE — Agenda e salas de reunião (2026-10-23)
-- Migração office_v8_agenda.
--
-- Pedido do Júlio: "colocar o Google calendário [...] no PAINEL OFFICE onde eles podem ter
-- controle das agendas deles e também compartilhar agendas de reunião nas salas de reunião
-- aqui na Lube. e todos vão vê que vai ter uma reunião e não marca lá".
-- Decisões do Júlio (2026-10-23):
--   * agenda pessoal fechada: os colegas não veem nada dela; as reservas das salas são de todos;
--   * convite pelo sino do painel e por e-mail (caixa do Office, com o convite .ics);
--   * todo usuário ativo reserva sala. Sala ocupada não aceita outra reserva no mesmo horário:
--     a trava é do banco (exclusion constraint), não só da tela. O TI cadastra as salas.
-- Agenda própria, no estilo do Google Agenda, sem copiar código dele (o REA não entra, pelo
-- mesmo motivo do Office: engenharia reversa vai contra os termos do Google).
--
-- Repetição: cada ocorrência é uma linha (mesma `serie`), para a trava da sala valer em todas.
-- `repeticao` guarda a regra e o horário-padrão da série (freq, ate, hora, minutos): é dele que
-- sai o convite .ics (RRULE, EXDATE e RECURRENCE-ID).
-- Nada se apaga: cancelar marca cancelado_em. Horário de Brasília (America/Sao_Paulo).
-- Só a Edge Function `office` (service_role) mexe, pelas funções public.office_srv_*.
-- =========================================================

create extension if not exists btree_gist with schema extensions;

-- ---------------------------------------------------------
-- 1. TABELAS
-- ---------------------------------------------------------
create table if not exists office.salas (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null check (char_length(btrim(nome)) between 1 and 60),
  local       text not null default '' check (char_length(local) <= 120),
  capacidade  int check (capacidade is null or capacidade between 1 and 500),
  recursos    text not null default '' check (char_length(recursos) <= 200),
  cor         text not null default '#2C3FC4' check (cor ~ '^#[0-9A-Fa-f]{6}$'),
  ativa       boolean not null default true,
  criada_em   timestamptz not null default now(),
  criada_por  uuid references public.profiles(id) on delete set null,
  alterada_em timestamptz
);
create unique index if not exists office_salas_nome_idx on office.salas (lower(btrim(nome)));

create table if not exists office.eventos (
  id            uuid primary key default gen_random_uuid(),
  serie         uuid,                       -- ocorrências da mesma repetição
  dono          uuid not null references public.profiles(id) on delete cascade,
  titulo        text not null check (char_length(btrim(titulo)) between 1 and 160),
  descricao     text not null default '' check (char_length(descricao) <= 4000),
  local         text not null default '' check (char_length(local) <= 200),
  sala          uuid references office.salas(id),
  inicio        timestamptz not null,
  fim           timestamptz not null,
  original      timestamptz not null,       -- início com que a ocorrência nasceu (a data dela na série)
  dia_inteiro   boolean not null default false,
  particular    boolean not null default false,   -- na agenda da sala, quem não participa vê "Reservada"
  repeticao     jsonb,                      -- {freq, ate, hora, minutos}, igual em toda a série
  sequencia     int not null default 0,     -- sobe a cada mudança (o convite por e-mail usa)
  criado_em     timestamptz not null default now(),
  alterado_em   timestamptz,
  alterado_por  uuid references public.profiles(id) on delete set null,
  cancelado_em  timestamptz,
  cancelado_por uuid references public.profiles(id) on delete set null,
  periodo       tstzrange generated always as (tstzrange(inicio, fim, '[)')) stored,
  constraint office_eventos_horario check (fim > inicio and fim - inicio <= interval '14 days'),
  -- a trava: a mesma sala não tem duas reservas vivas que se cruzam
  constraint office_eventos_sala_livre exclude using gist (sala with =, periodo with &&)
    where (sala is not null and cancelado_em is null)
);
create index if not exists office_eventos_dono_idx    on office.eventos (dono, inicio);
create index if not exists office_eventos_serie_idx   on office.eventos (serie) where serie is not null;
create index if not exists office_eventos_periodo_idx on office.eventos using gist (periodo);

create table if not exists office.convidados (
  id            uuid primary key default gen_random_uuid(),
  evento        uuid not null references office.eventos(id) on delete cascade,
  pessoa        uuid references public.profiles(id) on delete cascade,   -- alguém do painel
  email         text check (email is null or email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),  -- alguém de fora
  resposta      text not null default 'pendente' check (resposta in ('pendente', 'sim', 'nao', 'talvez')),
  respondido_em timestamptz,
  email_em      timestamptz,
  email_erro    text,
  constraint office_convidados_quem check ((pessoa is null) <> (email is null))
);
create unique index if not exists office_convidados_pessoa_idx on office.convidados (evento, pessoa) where pessoa is not null;
create unique index if not exists office_convidados_email_idx  on office.convidados (evento, lower(email)) where email is not null;
create index if not exists office_convidados_quem_idx on office.convidados (pessoa) where pessoa is not null;

-- avisos e atividades passam a apontar também para reuniões
alter table office.avisos add column if not exists evento uuid references office.eventos(id) on delete cascade;
alter table office.avisos drop constraint if exists avisos_tipo_check;
alter table office.avisos add constraint avisos_tipo_check
  check (tipo in ('mencao', 'compartilhou', 'enviou', 'convite', 'convite_mudou', 'convite_cancelado', 'resposta'));
alter table office.atividades add column if not exists evento uuid references office.eventos(id) on delete cascade;
create index if not exists office_ativ_evento_idx on office.atividades (evento, em desc) where evento is not null;

alter table office.salas      enable row level security;
alter table office.eventos    enable row level security;
alter table office.convidados enable row level security;
revoke all on all tables    in schema office from public, anon, authenticated;
revoke all on all sequences in schema office from public, anon, authenticated;

-- ---------------------------------------------------------
-- 2. AJUDANTES
-- ---------------------------------------------------------
create or replace function office.e_admin(p_user uuid)
returns boolean language sql stable
set search_path = office, public, extensions, pg_temp
as $$ select coalesce((select p.is_admin and p.ativo from public.profiles p where p.id = p_user), false) $$;

create or replace function office.participa(p_user uuid, p_evento uuid)
returns boolean language sql stable
set search_path = office, public, extensions, pg_temp
as $$
  select exists (select 1 from office.eventos e where e.id = p_evento and e.dono = p_user)
      or exists (select 1 from office.convidados c where c.evento = p_evento and c.pessoa = p_user)
$$;

create or replace function office.json_sala(p_sala uuid)
returns jsonb language sql stable
set search_path = office, public, extensions, pg_temp
as $$
  select jsonb_build_object('id', s.id, 'nome', s.nome, 'local', s.local, 'capacidade', s.capacidade,
                            'recursos', s.recursos, 'cor', s.cor, 'ativa', s.ativa)
    from office.salas s where s.id = p_sala
$$;

-- a reunião como a pessoa pode ver: quem participa vê tudo; quem só olha a sala vê horário,
-- sala e quem marcou (e "Reservada" no lugar do título, se a reunião é particular)
create or replace function office.json_evento(p_user uuid, e office.eventos)
returns jsonb language plpgsql stable
set search_path = office, public, extensions, pg_temp
as $$
declare v_part boolean := e.dono = p_user
          or exists (select 1 from office.convidados c where c.evento = e.id and c.pessoa = p_user);
begin
  return jsonb_build_object(
    'id', e.id, 'serie', e.serie,
    'repeticao', case when e.repeticao is null then null
                      else jsonb_build_object('freq', e.repeticao->>'freq', 'ate', e.repeticao->>'ate') end,
    'titulo', case when v_part or not e.particular then e.titulo else 'Reservada' end,
    'particular', e.particular,
    'descricao', case when v_part then e.descricao else '' end,
    'local', case when v_part then e.local else '' end,
    'sala', office.json_sala(e.sala),
    'inicio', e.inicio, 'fim', e.fim, 'dia_inteiro', e.dia_inteiro,
    'dono', office.json_pessoa(e.dono),
    'eu', case when e.dono = p_user then 'dono' when v_part then 'convidado' end,
    'minha_resposta', (select c.resposta from office.convidados c where c.evento = e.id and c.pessoa = p_user),
    'convidados', case when v_part then (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'pessoa', office.json_pessoa(c.pessoa), 'email', c.email, 'resposta', c.resposta,
                 'email_em', c.email_em, 'email_erro', c.email_erro)
               order by c.pessoa is null, lower(coalesce(p.nome, c.email))), '[]'::jsonb)
          from office.convidados c left join public.profiles p on p.id = c.pessoa
         where c.evento = e.id) end,
    'n_convidados', (select count(*) from office.convidados c where c.evento = e.id),
    'alterado_em', e.alterado_em, 'cancelado_em', e.cancelado_em);
end $$;

-- horário de Brasília
create or replace function office.dia_local(p timestamptz)
returns date language sql immutable
as $$ select (p at time zone 'America/Sao_Paulo')::date $$;

create or replace function office.no_dia(p_dia date, p_hora time)
returns timestamptz language sql immutable
as $$ select (p_dia + p_hora) at time zone 'America/Sao_Paulo' $$;

-- onde a série põe a ocorrência que nasceu em p_original (data dela + horário-padrão da série):
-- é o RECURRENCE-ID e o EXDATE do convite
create or replace function office.instancia(p_original timestamptz, p_rep jsonb)
returns timestamptz language sql immutable
as $$ select office.no_dia(office.dia_local(p_original), coalesce(p_rep->>'hora', '00:00')::time) $$;

-- as datas de uma repetição (até 1 ano, até 400 ocorrências)
create or replace function office.ocorrencias(p_inicio timestamptz, p_fim timestamptz, p_rep jsonb)
returns table (inicio timestamptz, fim timestamptz) language plpgsql stable
set search_path = office, public, extensions, pg_temp
as $$
declare
  v_dia0 date := office.dia_local(p_inicio);
  v_hora time := (p_inicio at time zone 'America/Sao_Paulo')::time;
  v_dur interval := p_fim - p_inicio;
  v_freq text := p_rep->>'freq';
  v_ate date := (p_rep->>'ate')::date;
  v_d date := v_dia0;
  v_n int := 0;
begin
  if p_rep is null then
    inicio := p_inicio; fim := p_fim; return next; return;
  end if;
  while v_d <= v_ate and v_n < 400 loop
    if v_freq = 'dia'
       or (v_freq = 'dia_util' and extract(isodow from v_d) < 6)
       or (v_freq = 'semana' and extract(isodow from v_d) = extract(isodow from v_dia0))
       or (v_freq = 'mes' and extract(day from v_d) = extract(day from v_dia0)) then
      inicio := office.no_dia(v_d, v_hora);
      fim := inicio + v_dur;
      v_n := v_n + 1;
      return next;
    end if;
    v_d := v_d + 1;
  end loop;
end $$;

-- frase do conflito de sala, no jeito que a pessoa pode ver
create or replace function office.txt_conflito(p_user uuid, e office.eventos)
returns text language sql stable
set search_path = office, public, extensions, pg_temp
as $$
  select format('A sala "%s" já está reservada em %s, %s, por %s%s. Escolha outro horário ou outra sala.',
           s.nome,
           to_char(e.inicio at time zone 'America/Sao_Paulo', 'DD/MM'),
           case when e.dia_inteiro then 'o dia todo'
                else 'das ' || to_char(e.inicio at time zone 'America/Sao_Paulo', 'HH24:MI') ||
                     ' às ' || to_char(e.fim at time zone 'America/Sao_Paulo', 'HH24:MI') end,
           coalesce(nullif(p.nome, ''), split_part(p.email, '@', 1), 'outra pessoa'),
           case when e.particular and not office.participa(p_user, e.id) then '' else ' ("' || e.titulo || '")' end)
    from office.salas s, public.profiles p
   where s.id = e.sala and p.id = e.dono
$$;

-- destinatários do convite por e-mail: pessoas do painel (e-mail do perfil) e e-mails de fora
create or replace function office.destinos(p_pessoas uuid[], p_emails text[])
returns jsonb language sql stable
set search_path = office, public, extensions, pg_temp
as $$
  select coalesce(jsonb_agg(x), '[]'::jsonb) from (
    select jsonb_build_object('nome', coalesce(nullif(p.nome, ''), split_part(p.email, '@', 1)), 'email', lower(p.email)) x
      from public.profiles p where p.id = any(coalesce(p_pessoas, '{}')) and coalesce(p.email, '') <> ''
    union all
    select jsonb_build_object('nome', '', 'email', lower(e)) from unnest(coalesce(p_emails, '{}')) e
  ) t
$$;

create or replace function office.componente(e office.eventos, p_inicio timestamptz, p_fim timestamptz, p_status text)
returns jsonb language sql stable
set search_path = office, public, extensions, pg_temp
as $$
  select jsonb_build_object(
    'titulo', e.titulo, 'descricao', e.descricao,
    'local', concat_ws(' · ', (select s.nome || case when s.local <> '' then ' (' || s.local || ')' else '' end
                                 from office.salas s where s.id = e.sala), nullif(e.local, '')),
    'inicio', p_inicio, 'fim', p_fim, 'dia_inteiro', e.dia_inteiro, 'status', p_status,
    'participantes', (select coalesce(jsonb_agg(jsonb_build_object(
                        'nome', coalesce(nullif(p.nome, ''), ''), 'email', lower(coalesce(p.email, c.email)),
                        'resposta', c.resposta)), '[]'::jsonb)
                        from office.convidados c left join public.profiles p on p.id = c.pessoa
                       where c.evento = e.id and coalesce(p.email, c.email) is not null))
$$;

-- a "carta" do convite por e-mail: o que a Edge Function precisa para montar o .ics.
-- p_toda_serie: a série inteira (RRULE, EXDATE das canceladas e as ocorrências que fogem do
-- horário-padrão); senão, só esta ocorrência (RECURRENCE-ID) ou a reunião sem repetição.
create or replace function office.carta(p_evento uuid, p_metodo text, p_toda_serie boolean, p_destinos jsonb)
returns jsonb language plpgsql stable
set search_path = office, public, extensions, pg_temp
as $$
declare
  e office.eventos;
  b office.eventos;
  x office.eventos;
  v_metodo text := p_metodo;
  v_comp jsonb := '[]'::jsonb;
  v_uid text;
  v_seq int;
  v_ini timestamptz;
  v_mestre jsonb;
  v_ex jsonb;
  v_n int := 0;
begin
  if p_destinos is null or jsonb_array_length(p_destinos) = 0 then return null; end if;
  select * into e from office.eventos where id = p_evento;
  if e.serie is null then
    v_uid := e.id::text;
    v_seq := e.sequencia;
    v_comp := jsonb_build_array(office.componente(e, e.inicio, e.fim, case when v_metodo = 'CANCEL' then 'CANCELLED' else 'CONFIRMED' end));
  elsif not p_toda_serie then
    v_uid := e.serie::text;
    select max(sequencia) into v_seq from office.eventos where serie = e.serie;
    v_comp := jsonb_build_array(office.componente(e, e.inicio, e.fim, case when v_metodo = 'CANCEL' then 'CANCELLED' else 'CONFIRMED' end)
                || jsonb_build_object('recorrencia', office.instancia(e.original, e.repeticao)));
  else
    v_uid := e.serie::text;
    select max(sequencia) into v_seq from office.eventos where serie = e.serie;
    select * into b from office.eventos where serie = e.serie and cancelado_em is null order by inicio limit 1;
    if not found then
      select * into b from office.eventos where serie = e.serie order by original limit 1;
      v_metodo := 'CANCEL';
    end if;
    -- a série começa na data da primeira ocorrência, no horário-padrão
    select office.instancia(min(original), b.repeticao) into v_ini from office.eventos where serie = e.serie;
    select coalesce(jsonb_agg(office.instancia(c.original, c.repeticao) order by c.original), '[]'::jsonb) into v_ex
      from office.eventos c where c.serie = e.serie and c.cancelado_em is not null;
    v_mestre := office.componente(b, v_ini, v_ini + make_interval(mins => coalesce((b.repeticao->>'minutos')::int, 60)),
                                  case when v_metodo = 'CANCEL' then 'CANCELLED' else 'CONFIRMED' end)
                || jsonb_build_object('rrule', jsonb_build_object('freq', b.repeticao->>'freq', 'ate', b.repeticao->>'ate'),
                                      'exdates', case when v_metodo = 'CANCEL' then '[]'::jsonb else v_ex end);
    v_comp := jsonb_build_array(v_mestre);
    -- ocorrências que fogem do horário-padrão vão junto, cada uma com o RECURRENCE-ID dela
    if v_metodo = 'REQUEST' then
      for x in select * from office.eventos c
                where c.serie = e.serie and c.cancelado_em is null
                  and (c.inicio <> office.instancia(c.original, c.repeticao)
                       or c.fim - c.inicio <> make_interval(mins => coalesce((c.repeticao->>'minutos')::int, 60))
                       or c.titulo <> b.titulo or c.sala is distinct from b.sala)
                order by c.inicio loop
        exit when v_n >= 50;
        v_comp := v_comp || jsonb_build_array(office.componente(x, x.inicio, x.fim, 'CONFIRMED')
                              || jsonb_build_object('recorrencia', office.instancia(x.original, x.repeticao)));
        v_n := v_n + 1;
      end loop;
    end if;
  end if;
  return jsonb_build_object(
    'metodo', v_metodo, 'uid', v_uid, 'sequencia', coalesce(v_seq, 0), 'evento', e.id,
    'organizador', (select jsonb_build_object('nome', coalesce(nullif(p.nome, ''), split_part(p.email, '@', 1)), 'email', lower(p.email))
                      from public.profiles p where p.id = e.dono),
    'para', p_destinos, 'componentes', v_comp);
end $$;

-- a pessoa só entra na lista se estiver ativa; e-mail de alguém do painel vira a pessoa
create or replace function office.ler_convidados(p_user uuid, p_lista jsonb, out pessoas uuid[], out emails text[])
language plpgsql stable
set search_path = office, public, extensions, pg_temp
as $$
declare
  v_x jsonb;
  v_id uuid;
  v_email text;
begin
  pessoas := '{}'; emails := '{}';
  if p_lista is null or jsonb_typeof(p_lista) <> 'array' then return; end if;
  if jsonb_array_length(p_lista) > 100 then perform office.erro('até 100 convidados por reunião', '22023'); end if;
  for v_x in select * from jsonb_array_elements(p_lista) loop
    v_id := null; v_email := null;
    if coalesce(v_x->>'pessoa', '') <> '' then
      begin v_id := (v_x->>'pessoa')::uuid; exception when others then v_id := null; end;
      if v_id is null or not exists (select 1 from public.profiles p where p.id = v_id and p.ativo) then
        perform office.erro('um dos convidados não está ativo no painel', '22023');
      end if;
    elsif coalesce(v_x->>'email', '') <> '' then
      v_email := lower(btrim(v_x->>'email'));
      if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or length(v_email) > 200 then
        perform office.erro('e-mail inválido: ' || left(v_email, 80), '22023');
      end if;
      select p.id into v_id from public.profiles p where lower(p.email) = v_email and p.ativo;
      if v_id is not null then v_email := null; end if;
    end if;
    if v_id is not null then
      if v_id <> p_user and not (v_id = any(pessoas)) then pessoas := pessoas || v_id; end if;
    elsif v_email is not null and not (v_email = any(emails)) then
      emails := emails || v_email;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------
-- 3. FUNÇÕES DA EDGE FUNCTION (public.office_srv_*)
-- ---------------------------------------------------------

-- o que aparece na agenda num período: as minhas (marquei ou fui convidado) e as reservas de sala
create or replace function public.office_srv_agenda(p_user uuid, p_de timestamptz, p_ate timestamptz)
returns jsonb language plpgsql stable security definer
set search_path = office, public, extensions, pg_temp
as $$
declare v_admin boolean;
begin
  perform office.so_funcao(); perform office.exige_ativo(p_user);
  if p_de is null or p_ate is null or p_ate <= p_de or p_ate - p_de > interval '63 days' then
    perform office.erro('período inválido', '22023');
  end if;
  v_admin := office.e_admin(p_user);
  return jsonb_build_object(
    'admin', v_admin,
    'salas', (select coalesce(jsonb_agg(office.json_sala(s.id) order by s.ativa desc, lower(s.nome)), '[]'::jsonb)
                from office.salas s where s.ativa or v_admin),
    'eventos', (select coalesce(jsonb_agg(office.json_evento(p_user, e) order by e.inicio), '[]'::jsonb)
                  from office.eventos e
                 where e.cancelado_em is null and e.periodo && tstzrange(p_de, p_ate, '[)')
                   and (e.sala is not null or e.dono = p_user
                        or exists (select 1 from office.convidados c where c.evento = e.id and c.pessoa = p_user))));
end $$;

-- uma reunião (quem participa vê também o histórico: quem marcou, mudou, respondeu, cancelou)
create or replace function public.office_srv_evento(p_user uuid, p_evento uuid)
returns jsonb language plpgsql stable security definer
set search_path = office, public, extensions, pg_temp
as $$
declare
  e office.eventos;
  v_part boolean;
begin
  perform office.so_funcao(); perform office.exige_ativo(p_user);
  select * into e from office.eventos where id = p_evento;
  if not found then perform office.erro('reunião não encontrada', 'P0002'); end if;
  v_part := office.participa(p_user, p_evento);
  if not (v_part or e.sala is not null) then perform office.erro('reunião não encontrada', 'P0002'); end if;
  return office.json_evento(p_user, e) || jsonb_build_object(
    'pode_cancelar', e.cancelado_em is null and (e.dono = p_user or (e.sala is not null and office.e_admin(p_user))),
    'historico', case when v_part then (
      select coalesce(jsonb_agg(jsonb_build_object('pessoa', office.json_pessoa(a.pessoa), 'acao', a.acao,
                                                   'detalhe', a.detalhe, 'em', a.em) order by a.em desc), '[]'::jsonb)
        from (select * from office.atividades a
               where a.evento = p_evento
                  or (e.serie is not null and a.evento in (select id from office.eventos where serie = e.serie)
                      and a.acao in ('criou_evento', 'alterou_evento', 'cancelou_evento'))
               order by a.em desc limit 30) a) end);
end $$;

-- marcar ou mudar uma reunião. p_escopo 'serie' = esta e as próximas da repetição.
-- Devolve a reunião e as cartas do convite por e-mail (a Edge Function envia).
create or replace function public.office_srv_evento_salvar(p_user uuid, p_evento uuid, p_dados jsonb, p_escopo text)
returns jsonb language plpgsql security definer
set search_path = office, public, extensions, pg_temp
as $$
declare
  tz constant text := 'America/Sao_Paulo';
  v_titulo text := left(btrim(coalesce(p_dados->>'titulo', '')), 160);
  v_desc   text := left(btrim(coalesce(p_dados->>'descricao', '')), 4000);
  v_local  text := left(btrim(coalesce(p_dados->>'local', '')), 200);
  v_dia    boolean := coalesce((p_dados->>'dia_inteiro')::boolean, false);
  v_part   boolean := coalesce((p_dados->>'particular')::boolean, false);
  v_sala   uuid;
  v_ini    timestamptz;
  v_fim    timestamptz;
  v_rep    jsonb;
  v_freq   text;
  v_ate    date;
  v_pessoas uuid[];
  v_emails  text[];
  v_antigo office.eventos;
  v_conf   office.eventos;
  v_o      record;
  v_id     uuid;
  v_primeiro uuid;
  v_serie  uuid;
  v_alvos  uuid[];
  v_n      int := 0;
  v_seq    int;
  v_hora   time;
  v_dur    interval;
  v_mudou_hora boolean;
  v_velhos_p uuid[];
  v_velhos_e text[];
  v_add_p  uuid[];
  v_rem_p  uuid[];
  v_rem_e  text[];
  v_serie_toda boolean;
  v_cartas jsonb := '[]'::jsonb;
  v_carta  jsonb;
begin
  perform office.so_funcao(); perform office.exige_ativo(p_user);
  if v_titulo = '' then perform office.erro('dê um título para a reunião', '22023'); end if;
  begin
    v_sala := nullif(p_dados->>'sala', '')::uuid;
    v_ini := (p_dados->>'inicio')::timestamptz;
    v_fim := (p_dados->>'fim')::timestamptz;
  exception when others then
    perform office.erro('data, hora ou sala inválida', '22023');
  end;
  if v_ini is null or v_fim is null then perform office.erro('diga o início e o fim', '22023'); end if;
  if v_dia then
    v_ini := office.no_dia(office.dia_local(v_ini), '00:00');
    v_fim := office.no_dia(office.dia_local(v_fim - interval '1 microsecond') + 1, '00:00');
    if v_fim <= v_ini then v_fim := v_ini + interval '1 day'; end if;
  end if;
  if v_fim <= v_ini then perform office.erro('o fim tem que ser depois do início', '22023'); end if;
  if v_fim - v_ini > interval '14 days' then perform office.erro('uma reunião dura no máximo 14 dias', '22023'); end if;
  if v_sala is not null and not exists (select 1 from office.salas s where s.id = v_sala and s.ativa) then
    perform office.erro('a sala não existe ou foi desativada', '22023');
  end if;
  select l.pessoas, l.emails into v_pessoas, v_emails from office.ler_convidados(p_user, p_dados->'convidados') l;
  v_hora := (v_ini at time zone tz)::time;
  v_dur := v_fim - v_ini;

  -- ===== reunião nova =====
  if p_evento is null then
    if jsonb_typeof(p_dados->'repeticao') = 'object' and coalesce(p_dados->'repeticao'->>'freq', '') <> '' then
      v_freq := p_dados->'repeticao'->>'freq';
      if v_freq not in ('dia', 'dia_util', 'semana', 'mes') then perform office.erro('repetição inválida', '22023'); end if;
      begin v_ate := (p_dados->'repeticao'->>'ate')::date; exception when others then v_ate := null; end;
      if v_ate is null or v_ate < office.dia_local(v_ini) then
        perform office.erro('diga até quando a reunião se repete (depois do primeiro dia)', '22023');
      end if;
      if v_ate > office.dia_local(v_ini) + 366 then perform office.erro('a repetição vai até 1 ano', '22023'); end if;
      v_rep := jsonb_build_object('freq', v_freq, 'ate', to_char(v_ate, 'YYYY-MM-DD'),
                                  'hora', to_char(v_hora, 'HH24:MI'), 'minutos', (extract(epoch from v_dur) / 60)::int);
      v_serie := gen_random_uuid();
    end if;
    -- a sala tem que estar livre em todas as datas (a trava do banco segura a corrida entre duas pessoas)
    if v_sala is not null then
      for v_o in select * from office.ocorrencias(v_ini, v_fim, v_rep) loop
        select * into v_conf from office.eventos e
         where e.sala = v_sala and e.cancelado_em is null and e.periodo && tstzrange(v_o.inicio, v_o.fim, '[)')
         order by e.inicio limit 1;
        if found then perform office.erro(office.txt_conflito(p_user, v_conf), '23P01'); end if;
      end loop;
    end if;
    begin
      for v_o in select * from office.ocorrencias(v_ini, v_fim, v_rep) loop
        insert into office.eventos (serie, dono, titulo, descricao, local, sala, inicio, fim, original, dia_inteiro, particular, repeticao)
        values (v_serie, p_user, v_titulo, v_desc, v_local, v_sala, v_o.inicio, v_o.fim, v_o.inicio, v_dia, v_part, v_rep)
        returning id into v_id;
        v_primeiro := coalesce(v_primeiro, v_id);
        v_n := v_n + 1;
        insert into office.convidados (evento, pessoa) select v_id, x from unnest(v_pessoas) x;
        insert into office.convidados (evento, email)  select v_id, x from unnest(v_emails) x;
      end loop;
    exception when exclusion_violation then
      perform office.erro('a sala acabou de ser reservada por outra pessoa nesse horário. Escolha outro horário ou outra sala.', '23P01');
    end;
    if v_primeiro is null then perform office.erro('a repetição não caiu em nenhum dia', '22023'); end if;
    insert into office.avisos (para, de, evento, tipo, mensagem)
      select x, p_user, v_primeiro, 'convite', v_titulo from unnest(v_pessoas) x;
    insert into office.atividades (pessoa, acao, evento, detalhe)
      values (p_user, 'criou_evento', v_primeiro, jsonb_build_object('ocorrencias', v_n, 'sala', v_sala,
              'convidados', coalesce(array_length(v_pessoas, 1), 0) + coalesce(array_length(v_emails, 1), 0)));
    v_carta := office.carta(v_primeiro, 'REQUEST', v_serie is not null, office.destinos(v_pessoas, v_emails));
    if v_carta is not null then v_cartas := jsonb_build_array(v_carta); end if;
    return jsonb_build_object('evento', (select office.json_evento(p_user, e) from office.eventos e where e.id = v_primeiro),
                              'ocorrencias', v_n, 'cartas', v_cartas);
  end if;

  -- ===== mudar uma reunião =====
  select * into v_antigo from office.eventos where id = p_evento for update;
  if not found or v_antigo.cancelado_em is not null then perform office.erro('reunião não encontrada', 'P0002'); end if;
  if v_antigo.dono <> p_user then perform office.erro('só quem marcou a reunião pode mudar', '42501'); end if;
  v_serie_toda := p_escopo = 'serie' and v_antigo.serie is not null;
  if v_serie_toda then
    if office.dia_local(v_ini) <> office.dia_local(v_antigo.inicio) then
      perform office.erro('na repetição inteira dá para mudar o horário, não o dia. Para mudar o dia, mude só esta reunião ou marque de novo.', '22023');
    end if;
    select array_agg(id order by inicio) into v_alvos from office.eventos
     where serie = v_antigo.serie and cancelado_em is null and inicio >= v_antigo.inicio;
  else
    v_alvos := array[p_evento];
  end if;
  v_mudou_hora := v_ini <> v_antigo.inicio or v_fim <> v_antigo.fim or v_dia <> v_antigo.dia_inteiro;
  -- a sala tem que estar livre nos horários novos
  if v_sala is not null then
    for v_o in select e.id,
                      case when v_serie_toda then office.no_dia(office.dia_local(e.inicio), v_hora) else v_ini end as ni
                 from office.eventos e where e.id = any(v_alvos) loop
      select * into v_conf from office.eventos e
       where e.sala = v_sala and e.cancelado_em is null and not (e.id = any(v_alvos))
         and e.periodo && tstzrange(v_o.ni, v_o.ni + v_dur, '[)')
       order by e.inicio limit 1;
      if found then perform office.erro(office.txt_conflito(p_user, v_conf), '23P01'); end if;
    end loop;
  end if;
  select coalesce(max(sequencia), 0) + 1 into v_seq from office.eventos
   where id = p_evento or (v_antigo.serie is not null and serie = v_antigo.serie);
  begin
    update office.eventos e set
      titulo = v_titulo, descricao = v_desc, local = v_local, sala = v_sala, dia_inteiro = v_dia, particular = v_part,
      inicio = case when v_serie_toda then office.no_dia(office.dia_local(e.inicio), v_hora) else v_ini end,
      fim    = case when v_serie_toda then office.no_dia(office.dia_local(e.inicio), v_hora) else v_ini end + v_dur,
      sequencia = v_seq, alterado_em = now(), alterado_por = p_user
     where e.id = any(v_alvos);
  exception when exclusion_violation then
    perform office.erro('a sala acabou de ser reservada por outra pessoa nesse horário. Escolha outro horário ou outra sala.', '23P01');
  end;
  if v_serie_toda then
    -- o horário-padrão da série muda em todas as ocorrências (o convite por e-mail sai dele)
    update office.eventos set repeticao = repeticao || jsonb_build_object('hora', to_char(v_hora, 'HH24:MI'),
                                                                         'minutos', (extract(epoch from v_dur) / 60)::int)
     where serie = v_antigo.serie;
  end if;
  -- convidados: quem saiu, quem entrou; mudou o horário, a resposta volta a "pendente"
  select coalesce(array_agg(pessoa) filter (where pessoa is not null), '{}'),
         coalesce(array_agg(lower(email)) filter (where email is not null), '{}')
    into v_velhos_p, v_velhos_e from office.convidados where evento = p_evento;
  v_add_p := array(select unnest(v_pessoas) except select unnest(v_velhos_p));
  v_rem_p := array(select unnest(v_velhos_p) except select unnest(v_pessoas));
  v_rem_e := array(select unnest(v_velhos_e) except select unnest(v_emails));
  delete from office.convidados c
   where c.evento = any(v_alvos)
     and ((c.pessoa is not null and not (c.pessoa = any(v_pessoas))) or (c.email is not null and not (lower(c.email) = any(v_emails))));
  insert into office.convidados (evento, pessoa) select a, x from unnest(v_alvos) a, unnest(v_pessoas) x
    on conflict (evento, pessoa) where pessoa is not null do nothing;
  insert into office.convidados (evento, email) select a, x from unnest(v_alvos) a, unnest(v_emails) x
    on conflict (evento, lower(email)) where email is not null do nothing;
  if v_mudou_hora then
    update office.convidados set resposta = 'pendente', respondido_em = null where evento = any(v_alvos);
  end if;
  insert into office.avisos (para, de, evento, tipo, mensagem)
    select x, p_user, p_evento, case when x = any(v_add_p) then 'convite' else 'convite_mudou' end, v_titulo
      from unnest(v_pessoas) x;
  insert into office.avisos (para, de, evento, tipo, mensagem)
    select x, p_user, p_evento, 'convite_cancelado', v_titulo from unnest(v_rem_p) x;
  insert into office.atividades (pessoa, acao, evento, detalhe)
    values (p_user, 'alterou_evento', p_evento, jsonb_build_object('escopo', case when v_serie_toda then 'serie' else 'este' end,
            'ocorrencias', coalesce(array_length(v_alvos, 1), 0), 'horario', v_mudou_hora));
  v_carta := office.carta(p_evento, 'REQUEST', v_serie_toda, office.destinos(v_pessoas, v_emails));
  if v_carta is not null then v_cartas := v_cartas || jsonb_build_array(v_carta); end if;
  v_carta := office.carta(p_evento, 'CANCEL', v_serie_toda, office.destinos(v_rem_p, v_rem_e));
  if v_carta is not null then v_cartas := v_cartas || jsonb_build_array(v_carta); end if;
  return jsonb_build_object('evento', (select office.json_evento(p_user, e) from office.eventos e where e.id = p_evento),
                            'ocorrencias', coalesce(array_length(v_alvos, 1), 0), 'cartas', v_cartas);
end $$;

-- cancelar (nada se apaga). Quem marcou cancela; o TI cancela reserva de sala de qualquer um.
-- p_escopo 'serie' = esta e as próximas: a série fica até o dia anterior.
create or replace function public.office_srv_evento_cancelar(p_user uuid, p_evento uuid, p_escopo text)
returns jsonb language plpgsql security definer
set search_path = office, public, extensions, pg_temp
as $$
declare
  e office.eventos;
  v_alvos uuid[];
  v_serie_toda boolean;
  v_pessoas uuid[];
  v_emails text[];
  v_resta boolean := false;
  v_cartas jsonb := '[]'::jsonb;
  v_carta jsonb;
begin
  perform office.so_funcao(); perform office.exige_ativo(p_user);
  select * into e from office.eventos where id = p_evento for update;
  if not found or e.cancelado_em is not null then perform office.erro('reunião não encontrada ou já cancelada', 'P0002'); end if;
  if e.dono <> p_user and not (e.sala is not null and office.e_admin(p_user)) then
    perform office.erro('só quem marcou a reunião pode cancelar', '42501');
  end if;
  v_serie_toda := p_escopo = 'serie' and e.serie is not null;
  if v_serie_toda then
    select array_agg(id) into v_alvos from office.eventos where serie = e.serie and cancelado_em is null and inicio >= e.inicio;
  else
    v_alvos := array[p_evento];
  end if;
  select coalesce(array_agg(pessoa) filter (where pessoa is not null), '{}'),
         coalesce(array_agg(lower(email)) filter (where email is not null), '{}')
    into v_pessoas, v_emails from office.convidados where evento = p_evento;
  update office.eventos set cancelado_em = now(), cancelado_por = p_user,
         sequencia = (select coalesce(max(sequencia), 0) + 1 from office.eventos
                       where id = p_evento or (e.serie is not null and serie = e.serie))
   where id = any(v_alvos);
  if v_serie_toda then
    v_resta := exists (select 1 from office.eventos where serie = e.serie and cancelado_em is null);
    if v_resta then
      -- a série passa a terminar no dia anterior
      update office.eventos set repeticao = repeticao || jsonb_build_object('ate', to_char(office.dia_local(e.inicio) - 1, 'YYYY-MM-DD'))
       where serie = e.serie;
    end if;
  end if;
  insert into office.avisos (para, de, evento, tipo, mensagem)
    select x, p_user, p_evento, 'convite_cancelado', e.titulo from unnest(v_pessoas) x where x <> p_user;
  if e.dono <> p_user then
    insert into office.avisos (para, de, evento, tipo, mensagem) values (e.dono, p_user, p_evento, 'convite_cancelado', e.titulo);
  end if;
  insert into office.atividades (pessoa, acao, evento, detalhe)
    values (p_user, 'cancelou_evento', p_evento, jsonb_build_object('escopo', case when v_serie_toda then 'serie' else 'este' end,
            'ocorrencias', coalesce(array_length(v_alvos, 1), 0)));
  -- série que continua: o convite muda para terminar antes; senão, cancela
  v_carta := office.carta(p_evento, case when v_resta then 'REQUEST' else 'CANCEL' end, v_serie_toda, office.destinos(v_pessoas, v_emails));
  if v_carta is not null then v_cartas := jsonb_build_array(v_carta); end if;
  return jsonb_build_object('cancelados', coalesce(array_length(v_alvos, 1), 0), 'cartas', v_cartas);
end $$;

-- o convidado responde (sim, não, talvez); quem marcou recebe o aviso
create or replace function public.office_srv_evento_responder(p_user uuid, p_evento uuid, p_resposta text, p_escopo text)
returns jsonb language plpgsql security definer
set search_path = office, public, extensions, pg_temp
as $$
declare
  e office.eventos;
  v_alvos uuid[];
  v_antes text;
begin
  perform office.so_funcao(); perform office.exige_ativo(p_user);
  if p_resposta not in ('sim', 'nao', 'talvez') then perform office.erro('resposta inválida', '22023'); end if;
  select * into e from office.eventos where id = p_evento;
  if not found or e.cancelado_em is not null then perform office.erro('reunião não encontrada ou cancelada', 'P0002'); end if;
  select resposta into v_antes from office.convidados where evento = p_evento and pessoa = p_user;
  if not found then perform office.erro('você não foi convidado para esta reunião', '42501'); end if;
  if p_escopo = 'serie' and e.serie is not null then
    select array_agg(id) into v_alvos from office.eventos where serie = e.serie and cancelado_em is null and inicio >= e.inicio;
  else
    v_alvos := array[p_evento];
  end if;
  update office.convidados set resposta = p_resposta, respondido_em = now()
   where evento = any(v_alvos) and pessoa = p_user;
  if v_antes is distinct from p_resposta and e.dono <> p_user then
    insert into office.avisos (para, de, evento, tipo, mensagem) values (e.dono, p_user, p_evento, 'resposta', p_resposta);
  end if;
  insert into office.atividades (pessoa, acao, evento, detalhe)
    values (p_user, 'respondeu', p_evento, jsonb_build_object('resposta', p_resposta,
            'ocorrencias', coalesce(array_length(v_alvos, 1), 0)));
  return office.json_evento(p_user, e);
end $$;

-- as salas e, se vier um horário, quem está nele (para a tela mostrar livre ou ocupada)
create or replace function public.office_srv_salas(p_user uuid, p_inicio timestamptz, p_fim timestamptz, p_ignorar uuid)
returns jsonb language plpgsql stable security definer
set search_path = office, public, extensions, pg_temp
as $$
declare
  v_admin boolean;
  v_janela boolean;
begin
  perform office.so_funcao(); perform office.exige_ativo(p_user);
  v_admin := office.e_admin(p_user);
  v_janela := p_inicio is not null and p_fim is not null and p_fim > p_inicio and p_fim - p_inicio <= interval '14 days';
  return jsonb_build_object('admin', v_admin, 'salas', (
    select coalesce(jsonb_agg(office.json_sala(s.id) || jsonb_build_object('ocupada', case when v_janela then (
             select office.json_evento(p_user, e) from office.eventos e
              where e.sala = s.id and e.cancelado_em is null and e.id is distinct from p_ignorar
                and e.periodo && tstzrange(p_inicio, p_fim, '[)')
              order by e.inicio limit 1) end)
           order by s.ativa desc, lower(s.nome)), '[]'::jsonb)
      from office.salas s where s.ativa or v_admin));
end $$;

-- o TI cadastra, muda e desativa salas
create or replace function public.office_srv_sala_salvar(p_user uuid, p_sala uuid, p_dados jsonb)
returns jsonb language plpgsql security definer
set search_path = office, public, extensions, pg_temp
as $$
declare
  v_nome text := btrim(coalesce(p_dados->>'nome', ''));
  v_cap int;
  v_cor text := coalesce(nullif(p_dados->>'cor', ''), '#2C3FC4');
  v_id uuid;
  v_futuras int := 0;
begin
  perform office.so_funcao(); perform office.exige_ativo(p_user);
  if not office.e_admin(p_user) then perform office.erro('só o TI cadastra salas', '42501'); end if;
  if v_nome = '' or char_length(v_nome) > 60 then perform office.erro('dê um nome à sala (até 60 letras)', '22023'); end if;
  if v_cor !~ '^#[0-9A-Fa-f]{6}$' then perform office.erro('cor inválida', '22023'); end if;
  begin v_cap := nullif(p_dados->>'capacidade', '')::int; exception when others then perform office.erro('capacidade inválida', '22023'); end;
  if v_cap is not null and (v_cap < 1 or v_cap > 500) then perform office.erro('capacidade de 1 a 500 pessoas', '22023'); end if;
  begin
    if p_sala is null then
      insert into office.salas (nome, local, capacidade, recursos, cor, ativa, criada_por)
      values (v_nome, left(btrim(coalesce(p_dados->>'local', '')), 120), v_cap, left(btrim(coalesce(p_dados->>'recursos', '')), 200),
              v_cor, coalesce((p_dados->>'ativa')::boolean, true), p_user)
      returning id into v_id;
    else
      update office.salas set nome = v_nome, local = left(btrim(coalesce(p_dados->>'local', '')), 120), capacidade = v_cap,
             recursos = left(btrim(coalesce(p_dados->>'recursos', '')), 200), cor = v_cor,
             ativa = coalesce((p_dados->>'ativa')::boolean, ativa), alterada_em = now()
       where id = p_sala returning id into v_id;
      if v_id is null then perform office.erro('sala não encontrada', 'P0002'); end if;
    end if;
  exception when unique_violation then
    perform office.erro('já existe uma sala com esse nome', '22023');
  end;
  select count(*) into v_futuras from office.eventos where sala = v_id and cancelado_em is null and fim > now();
  insert into office.atividades (pessoa, acao, detalhe)
    values (p_user, case when p_sala is null then 'criou_sala' else 'alterou_sala' end,
            jsonb_build_object('sala', v_id, 'nome', v_nome, 'ativa', coalesce((p_dados->>'ativa')::boolean, true)));
  return office.json_sala(v_id) || jsonb_build_object('reservas_futuras', v_futuras);
end $$;

-- a Edge Function anota o que saiu e o que falhou no convite por e-mail
create or replace function public.office_srv_evento_emails(p_user uuid, p_evento uuid, p_enviados text[], p_falhas jsonb)
returns jsonb language plpgsql security definer
set search_path = office, public, extensions, pg_temp
as $$
declare
  e office.eventos;
  v_alvos uuid[];
  v_f jsonb;
begin
  perform office.so_funcao(); perform office.exige_ativo(p_user);
  select * into e from office.eventos where id = p_evento;
  if not found then perform office.erro('reunião não encontrada', 'P0002'); end if;
  if not (office.participa(p_user, p_evento) or office.e_admin(p_user)) then perform office.erro('sem acesso à reunião', '42501'); end if;
  if e.serie is not null then
    select array_agg(id) into v_alvos from office.eventos where serie = e.serie;
  else
    v_alvos := array[p_evento];
  end if;
  update office.convidados c set email_em = now(), email_erro = null
    from (select c2.id, lower(coalesce(c2.email, p.email)) em from office.convidados c2
            left join public.profiles p on p.id = c2.pessoa where c2.evento = any(v_alvos)) q
   where q.id = c.id and q.em = any(select lower(x) from unnest(coalesce(p_enviados, '{}')) x);
  for v_f in select * from jsonb_array_elements(coalesce(p_falhas, '[]'::jsonb)) loop
    update office.convidados c set email_erro = left(coalesce(v_f->>'erro', 'falhou'), 200)
      from (select c2.id, lower(coalesce(c2.email, p.email)) em from office.convidados c2
              left join public.profiles p on p.id = c2.pessoa where c2.evento = any(v_alvos)) q
     where q.id = c.id and q.em = lower(v_f->>'para');
  end loop;
  insert into office.atividades (pessoa, acao, evento, detalhe)
    values (p_user, 'convite_email', p_evento, jsonb_build_object(
            'enviados', coalesce(array_length(p_enviados, 1), 0), 'falhas', jsonb_array_length(coalesce(p_falhas, '[]'::jsonb)),
            'erro', (select string_agg(f->>'para' || ': ' || coalesce(f->>'erro', ''), ' | ') from jsonb_array_elements(coalesce(p_falhas, '[]'::jsonb)) f)));
  return jsonb_build_object('ok', true);
end $$;

-- o sino passa a mostrar também convites, mudanças, cancelamentos e respostas de reunião
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
                 'pasta', (select jsonb_build_object('id', p.id, 'nome', p.nome) from office.pastas p where p.id = v.pasta),
                 'evento', (select jsonb_build_object('id', e.id, 'titulo', e.titulo, 'inicio', e.inicio, 'fim', e.fim,
                                                      'dia_inteiro', e.dia_inteiro, 'cancelado', e.cancelado_em is not null,
                                                      'sala', (select s.nome from office.salas s where s.id = e.sala))
                              from office.eventos e where e.id = v.evento))
                 order by v.criado_em desc), '[]'::jsonb)
               from (select * from office.avisos where para = p_user
                      order by criado_em desc limit least(greatest(coalesce(p_limite, 30), 1), 100)) v));
end $$;

-- ---------------------------------------------------------
-- 4. QUEM EXECUTA: só a service_role (a Edge Function)
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
