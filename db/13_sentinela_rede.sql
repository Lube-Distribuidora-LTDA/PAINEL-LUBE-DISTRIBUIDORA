-- SENTINELA-13-INICIO
-- =========================================================
-- SENTINELA LUBE — regra de rede da Lube (migração sentinela_v2_rede)
-- Contrato: docs/SENTINELA-REDE.md (desenho v1, 2026-10-23), seção 4.
-- Projeto Supabase PAINEL LUBE DISTRIBUIDORA (wkkdcsqwlxjxorutrbnx).
--
-- Mesmas regras do db/02_sentinela.sql: sem begin/commit próprios (aplicar numa
-- transação só), pode rodar de novo ("if not exists", "create or replace", seeds sem
-- duplicar), search_path fixo, toda srv_* começa com sentinela.so_central() e toda
-- função de painel com is_admin().
-- NENHUMA tabela ou função que já existe muda: só objetos novos e seeds. Sem alter table
-- e sem FK para as tabelas de hoje: isso travaria sentinela.sistemas e sentinela.config
-- (lidas a cada /lista e /evento) enquanto a transação durar, e o teste roda em
-- transação revertida com os guardas no ar (§4.8).
-- A rede do escritório NÃO entra aqui: quem cadastra é o TI (tela ou SQL de emergência).
-- Testes: db/13_sentinela_rede_teste.sql (begin; esta migração; o teste; rollback;).
-- =========================================================

-- falha rápido em vez de esperar trava (os guardas estão no ar); fora de transação só avisa
set local lock_timeout = '5s';

-- ---------------------------------------------------------
-- 1. TABELAS (RLS ligado e sem políticas: só as funções mexem)
-- ---------------------------------------------------------

-- 1 linha. Só muda por SQL: afrouxar prazo ou provas da emergência tem de ser um ato pensado.
create table if not exists sentinela.rede_config (
  id                 boolean primary key default true check (id),
  liberacao_max_dias int not null default 30 check (liberacao_max_dias between 1 and 90),
  emergencia_pessoas int not null default 3  check (emergencia_pessoas between 2 and 20),
  emergencia_horas   int not null default 2  check (emergencia_horas between 1 and 24),
  limpeza_em         timestamptz,                      -- última limpeza de rede_fora
  atualizado_em      timestamptz not null default now(),
  atualizado_por     text
);

-- Modo de rede de cada sistema. Sem linha = desligado. Ligado pelo projeto_id (não muda ao
-- renomear o projeto na Vercel). Sem FK para sentinela.sistemas de propósito (ver o topo).
create table if not exists sentinela.rede_sistemas (
  projeto_id text primary key,
  modo       text not null default 'desligado' check (modo in ('desligado','observar','exigir')),
  isento     boolean not null default false,          -- SAC e Supervisor: usados na rua (decisão do Júlio)
  modo_em    timestamptz,
  modo_por   text,
  check (not isento or modo = 'desligado')
);

-- As redes da Lube. ATIVA = removido_em is null. Nada se apaga: remover grava removido_em.
-- Não tem nada a ver com sentinela.confiaveis (aprendida pelo login, inclusive de casa).
create table if not exists sentinela.redes (
  id           bigint generated always as identity primary key,
  rede         cidr not null,
  descricao    text not null check (char_length(btrim(descricao)) between 3 and 120),
  origem       text not null default 'manual' check (origem in ('manual','sugestao','emergencia')),
  criado_em    timestamptz not null default now(),
  criado_por   text not null,
  removido_em  timestamptz,
  removido_por text,
  check ((family(rede) = 4 and masklen(rede) >= 24) or (family(rede) = 6 and masklen(rede) >= 48))
);
create unique index if not exists redes_ativa_uk on sentinela.redes (rede) where removido_em is null;
create index if not exists redes_rede_idx on sentinela.redes using gist (rede inet_ops) where removido_em is null;

-- Liberados fora da rede, por pessoa. ATIVA = não encerrada, já começou, não venceu e perfil
-- ativo. No máximo uma aberta por pessoa: liberar de novo encerra a anterior.
create table if not exists sentinela.rede_liberacoes (
  id            bigint generated always as identity primary key,
  user_id       uuid not null,                         -- public.profiles.id (sem FK: o histórico fica se a conta sair)
  email         text not null check (email = lower(email) and email ~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$'),
  inicio        timestamptz not null default now(),
  fim           timestamptz not null,
  motivo        text not null check (char_length(btrim(motivo)) between 5 and 300),
  criado_em     timestamptz not null default now(),
  criado_por    text not null,
  encerrado_em  timestamptz,
  encerrado_por text,
  check (fim > inicio and fim <= inicio + interval '90 days')
);
create index if not exists rede_liberacoes_user_idx on sentinela.rede_liberacoes (user_id) where encerrado_em is null;
create index if not exists rede_liberacoes_fim_idx  on sentinela.rede_liberacoes (fim) where encerrado_em is null;

-- Acessos de fora que só a central vê (login no portal e pedido de passe). Os do guarda
-- ficam em sentinela.eventos. Repetição em 10 min soma em "vezes" (sem linha nova).
create table if not exists sentinela.rede_fora (
  id           bigint generated always as identity primary key,
  criado_em    timestamptz not null default now(),
  ultimo_em    timestamptz not null default now(),
  vezes        int not null default 1,
  ip           inet,                                   -- null = a central não recebeu IP
  user_id      uuid,
  email        text,
  origem       text not null check (origem in ('portal','passe')),
  projeto      text not null,                          -- 'painel-lube-distribuidora' no login do portal
  decisao      text not null check (decisao in ('bloqueado','observado','liberado')),
  liberacao_id bigint,
  ua           text
);
create index if not exists rede_fora_ultimo_idx on sentinela.rede_fora (ultimo_em desc);
create index if not exists rede_fora_ip_idx     on sentinela.rede_fora (ip, ultimo_em desc);
create index if not exists rede_fora_user_idx   on sentinela.rede_fora (user_id, ultimo_em desc);

alter table sentinela.rede_config     enable row level security;
alter table sentinela.rede_sistemas   enable row level security;
alter table sentinela.redes           enable row level security;
alter table sentinela.rede_liberacoes enable row level security;
alter table sentinela.rede_fora       enable row level security;

-- ---------------------------------------------------------
-- 2. AJUDANTES (schema sentinela, fora da API)
-- ---------------------------------------------------------

-- IP ou faixa digitados para a rede da Lube; inválido → 22023 com texto para a tela.
-- IP solto vira /32 (IPv4) ou /128 (IPv6); ::ffff:a.b.c.d vira IPv4. A Vercel só vê o IP
-- público: IP interno é recusado, e faixa larga incluiria outros clientes da operadora.
create or replace function sentinela.rede_lube_valida(p text)
returns cidr language plpgsql immutable
set search_path = sentinela, public, extensions, pg_temp
as $$
declare
  v_txt text := btrim(coalesce(p, ''));
  v inet;
  v_rede cidr;
begin
  if v_txt = '' or length(v_txt) > 64 then
    raise exception 'sentinela: informe o IP ou a faixa da rede (ex.: 203.0.113.7 ou 203.0.113.0/24)' using errcode = '22023';
  end if;
  if v_txt !~ '^[0-9A-Fa-f:./]+$' then
    raise exception 'sentinela: "%" não é um IP nem uma faixa válida', left(regexp_replace(v_txt, '[^[:print:]]', '?', 'g'), 64)
      using errcode = '22023';
  end if;
  begin
    v := v_txt::inet;
  exception when others then
    raise exception 'sentinela: "%" não é um IP nem uma faixa válida', v_txt using errcode = '22023';
  end;
  if family(v) = 6 and masklen(v) >= 96 and host(v) ~* '^::ffff:[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' then
    v := set_masklen(substr(host(v), 8)::inet, masklen(v) - 96);
  end if;
  if (family(v) = 4 and masklen(v) < 24) or (family(v) = 6 and masklen(v) < 48) then
    raise exception 'sentinela: rede ampla demais: incluiria outros clientes da operadora (mínimo /24 em IPv4 e /48 em IPv6)'
      using errcode = '22023';
  end if;
  if host(v) <> host(network(v)) then
    raise exception 'sentinela: "%" tem bits de host ligados; use %', v_txt, network(v)::text using errcode = '22023';
  end if;
  v_rede := network(v);
  if exists (select 1 from unnest(array['0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16',
                                        '172.16.0.0/12', '192.168.0.0/16', '224.0.0.0/4', '240.0.0.0/4',
                                        '::/128', '::1/128', 'fc00::/7', 'fe80::/10', 'ff00::/8']::cidr[]) r
              where r && v_rede) then
    raise exception 'sentinela: "%" é um IP interno da rede; cadastre o IP público, que aparece em https://painel-lube-distribuidora.vercel.app/.sentinela/saude', v_txt
      using errcode = '22023';
  end if;
  -- faixa de IPv4 escrito em IPv6 (::ffff:0:0/96): o guarda compara IPv4 com IPv4
  if family(v_rede) = 6 and v_rede && '::ffff:0:0/96'::cidr then
    raise exception 'sentinela: "%" é IPv4 escrito em IPv6; cadastre o IPv4', v_txt using errcode = '22023';
  end if;
  return v_rede;
end $$;

-- id da rede ativa mais específica que contém o IP, ou null
create or replace function sentinela.rede_que_contem(p_ip inet)
returns bigint language sql stable
set search_path = sentinela, public, extensions, pg_temp
as $$
  select r.id
    from sentinela.redes r
   where p_ip is not null and r.removido_em is null and r.rede >>= p_ip
   order by masklen(r.rede) desc, r.id
   limit 1
$$;

-- SHA-256 do e-mail em minúsculas: é o que vai na lista do guarda (nunca o e-mail)
create or replace function sentinela.email_hash(p text)
returns text language sql immutable
set search_path = sentinela, public, extensions, pg_temp
as $$
  select encode(extensions.digest(lower(btrim(p)), 'sha256'), 'hex')
$$;

-- 'sentinela-guarda/X.Y.Z' com X.Y.Z >= 1.3.0 (o guarda que confere a rede); nulo = antigo
create or replace function sentinela.guarda_tem_rede(p_versao text)
returns boolean language sql immutable
set search_path = sentinela, public, extensions, pg_temp
as $$
  select coalesce((
    select (m[1]::int, m[2]::int, m[3]::int) >= (1, 3, 0)
      from regexp_match(coalesce(p_versao, ''), '^sentinela-guarda/([0-9]{1,4})\.([0-9]{1,4})\.([0-9]{1,4})$') as m
     where m is not null), false)
$$;

-- modo do sistema pelo nome do projeto: sem linha, isento, inativo ou desconhecido → desligado
create or replace function sentinela.rede_modo(p_projeto text)
returns text language sql stable
set search_path = sentinela, public, extensions, pg_temp
as $$
  select coalesce((
    select case when rs.isento then 'desligado' else rs.modo end
      from sentinela.sistemas s
      join sentinela.rede_sistemas rs on rs.projeto_id = s.projeto_id
     where s.projeto = p_projeto and s.ativo), 'desligado')
$$;

-- o modo que vale de fato: exigir sem nenhuma rede ativa vira observar (não tranca a empresa)
create or replace function sentinela.rede_modo_efetivo(p_projeto text)
returns text language sql stable
set search_path = sentinela, public, extensions, pg_temp
as $$
  select case when x.m = 'exigir' and not exists (select 1 from sentinela.redes r where r.removido_em is null)
              then 'observar' else x.m end
    from (select sentinela.rede_modo(p_projeto) as m) x
$$;

-- algum sistema ativo (não isento) está exigindo a rede: a partir daí, afrouxar a regra só de
-- dentro da rede da Lube (ou com liberação), pela central, que vê o IP do pedido (§4.4)
create or replace function sentinela.rede_trava()
returns boolean language sql stable
set search_path = sentinela, public, extensions, pg_temp
as $$
  select exists (select 1 from sentinela.rede_sistemas rs
                   join sentinela.sistemas s on s.projeto_id = rs.projeto_id
                  where rs.modo = 'exigir' and not rs.isento and s.ativo)
$$;

-- a ação do painel afrouxa a regra? (rede nova, liberar pessoa, passar para observar ou desligar)
-- Apertar (remover rede, encerrar liberação, exigir) vale de qualquer lugar.
create or replace function sentinela.rede_afrouxa(p_acao text, p_dados jsonb)
returns boolean language sql immutable
set search_path = sentinela, public, extensions, pg_temp
as $$
  select coalesce(p_acao, '') in ('rede_nova', 'liberar')
      or (coalesce(p_acao, '') = 'rede_modo' and coalesce(p_dados->>'modo', '') <> 'exigir')
$$;

-- liberação ativa da pessoa (perfil ativo), ou null
create or replace function sentinela.liberacao_ativa(p_user_id uuid)
returns sentinela.rede_liberacoes language sql stable
set search_path = sentinela, public, extensions, pg_temp
as $$
  select l.*
    from sentinela.rede_liberacoes l
   where l.user_id = p_user_id and l.encerrado_em is null and l.inicio <= now() and l.fim > now()
     and exists (select 1 from public.profiles p where p.id = l.user_id and p.ativo)
   order by l.fim desc, l.id desc
   limit 1
$$;

-- Provas da emergência: OUTRAS pessoas ativas barradas deste IP (IPv6: do /64) nas últimas
-- rede_config.emergencia_horas horas, pela central (rede_fora) e pelos guardas (eventos).
create or replace function sentinela.rede_provas(p_ip inet, p_user_id uuid)
returns jsonb language sql stable
set search_path = sentinela, public, extensions, pg_temp
as $$
  with cfg as (
    select make_interval(hours => coalesce((select c.emergencia_horas from sentinela.rede_config c where c.id), 2)) as janela,
           sentinela.rede_auto(p_ip) as alvo
  ),
  barrados as (
    select lower(f.email) as email
      from sentinela.rede_fora f, cfg
     where f.ip <<= cfg.alvo and f.decisao = 'bloqueado' and f.ultimo_em > now() - cfg.janela and f.email is not null
    union
    select lower(e.identidade)
      from sentinela.eventos e, cfg
     where e.ip <<= cfg.alvo and e.regra = 'fora_da_rede' and e.decisao = 'bloqueado'
       and e.criado_em > now() - cfg.janela and e.identidade like '%@%'
  ),
  pessoas as (
    select distinct b.email
      from barrados b
      join public.profiles p on lower(p.email) = b.email and p.ativo and p.id is distinct from p_user_id
  )
  select jsonb_build_object('pessoas', (select count(*) from pessoas),
                            'emails', coalesce(to_jsonb((select (array_agg(x.email order by x.email))[1:20] from pessoas x)), '[]'::jsonb))
$$;

-- grava (ou soma) um acesso de fora visto pela central
create or replace function sentinela.rede_fora_gravar(
  p_ip inet, p_user_id uuid, p_email text, p_origem text, p_projeto text, p_decisao text, p_liberacao_id bigint, p_ua text)
returns void language plpgsql
set search_path = sentinela, public, extensions, pg_temp
as $$
declare
  v_id bigint;
begin
  -- serializa a mesma chave: duas chamadas juntas não abrem duas linhas
  perform pg_advisory_xact_lock(hashtextextended(
    'sentinela.rede_fora|' || coalesce(host(p_ip), '-') || '|' || coalesce(p_user_id::text, '-') || '|' || p_origem
    || '|' || p_projeto || '|' || p_decisao, 0));
  update sentinela.rede_fora f
     set vezes = f.vezes + 1, ultimo_em = now(),
         email = coalesce(p_email, f.email), liberacao_id = coalesce(p_liberacao_id, f.liberacao_id), ua = coalesce(p_ua, f.ua)
   where f.id = (select f2.id from sentinela.rede_fora f2
                  where f2.ultimo_em > now() - interval '10 minutes'
                    and f2.ip is not distinct from p_ip and f2.user_id is not distinct from p_user_id
                    and f2.origem = p_origem and f2.projeto = p_projeto and f2.decisao = p_decisao
                  order by f2.ultimo_em desc, f2.id desc
                  limit 1)
  returning f.id into v_id;
  if v_id is null then
    insert into sentinela.rede_fora (ip, user_id, email, origem, projeto, decisao, liberacao_id, ua)
    values (p_ip, p_user_id, p_email, p_origem, p_projeto, p_decisao, p_liberacao_id, p_ua);
  end if;
end $$;

-- Retenção de rede_fora: 1x por dia, até 5 mil linhas por vez (passou disso, continua na
-- próxima chamada). Mesmo prazo dos eventos (config.retencao_dias, mínimo 7).
create or replace function sentinela.rede_limpeza()
returns int language plpgsql
set search_path = sentinela, public, extensions, pg_temp
as $$
declare
  v_ret int;
  v_n int := 0;
begin
  if current_setting('transaction_read_only') = 'on'
     or exists (select 1 from sentinela.rede_config c where c.id and c.limpeza_em > now() - interval '1 day')
     or not pg_try_advisory_xact_lock(hashtextextended('sentinela.rede_limpeza', 0)) then
    return 0;
  end if;
  select greatest(coalesce(c.retencao_dias, 90), 7) into v_ret from sentinela.config c where c.id;
  delete from sentinela.rede_fora f
   where f.id in (select f2.id from sentinela.rede_fora f2
                   where f2.ultimo_em < now() - make_interval(days => coalesce(v_ret, 90)) limit 5000);
  get diagnostics v_n = row_count;
  if v_n < 5000 then
    update sentinela.rede_config c set limpeza_em = now() where c.id;
  end if;
  return v_n;
end $$;

-- Primeira linha das funções de emergência: só o SQL Editor (dono do banco), nunca a API.
create or replace function sentinela.so_sql_editor()
returns void language plpgsql stable
set search_path = sentinela, public, extensions, pg_temp
as $$
begin
  if current_user::text in ('anon', 'authenticated', 'service_role', 'authenticator')
     or session_user::text in ('anon', 'authenticated', 'service_role', 'authenticator')
     or coalesce(current_setting('role', true), '') in ('anon', 'authenticated', 'service_role')
     or coalesce(auth.role(), '') in ('anon', 'authenticated', 'service_role') then
    raise exception 'sentinela: emergência só pelo SQL Editor do Supabase' using errcode = '42501';
  end if;
end $$;

-- ---------------------------------------------------------
-- 3. FUNÇÕES DO SERVIDOR (só service_role — chamadas pela Central)
-- ---------------------------------------------------------

-- Bloco "rede" da /lista do guarda. Os liberados vão pelo SHA-256 do e-mail, nunca o e-mail.
create or replace function public.sentinela_srv_rede_lista(p_projeto text)
returns jsonb
language plpgsql
stable
security definer
set search_path = sentinela, public, extensions, pg_temp
as $$
declare
  v_modo text;
  v_redes jsonb;
  v_lib jsonb := '[]'::jsonb;
begin
  perform sentinela.so_central();
  v_modo := sentinela.rede_modo(sentinela.txt(p_projeto, 100));
  select coalesce(jsonb_agg(x.rede::text order by x.id), '[]'::jsonb)
    into v_redes
    from (select r.id, r.rede from sentinela.redes r where r.removido_em is null order by r.id limit 200) x;
  -- rede de segurança: exigir sem nenhuma rede cadastrada sai como observar
  if v_modo = 'exigir' and v_redes = '[]'::jsonb then
    v_modo := 'observar';
  end if;
  -- hash do e-mail ATUAL do perfil (é o que o passe e a sessão levam)
  if v_modo <> 'desligado' then
    select coalesce(jsonb_agg(jsonb_build_object('h', x.h, 'ate', sentinela.iso(x.ate)) order by x.ate desc, x.h), '[]'::jsonb)
      into v_lib
      from (select sentinela.email_hash(p.email) as h, max(l.fim) as ate
              from sentinela.rede_liberacoes l
              join public.profiles p on p.id = l.user_id and p.ativo
             where l.encerrado_em is null and l.inicio <= now() and l.fim > now() and p.email is not null
             group by 1
             order by max(l.fim) desc
             limit 500) x;
  end if;
  return jsonb_build_object('v', 1, 'gerado_em', sentinela.iso(now()), 'modo', v_modo,
                            'redes', v_redes, 'liberados', v_lib);
end $$;

-- Decide um acesso visto pela central (login no portal ou pedido de passe). Nesta ordem:
-- desligado → seguir; IP numa rede → seguir; liberado → seguir (grava); observar (ou
-- exigir sem rede) → observar (grava); exigir → bloquear (grava). IP nulo = fora.
create or replace function public.sentinela_srv_rede_decidir(
  p_ip text, p_user_id uuid, p_email text, p_projeto text, p_origem text, p_ua text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = sentinela, public, extensions, pg_temp
as $$
declare
  v_proj text := sentinela.txt(p_projeto, 100);
  v_ip inet := sentinela.ip_ou_nulo(p_ip);
  v_email text := lower(sentinela.txt(p_email, 200));
  v_cfg sentinela.rede_config;
  v_modo text;
  v_rede sentinela.redes;
  v_lib sentinela.rede_liberacoes;
  v_acao text;
  v_decisao text;
  v_provas jsonb;
  v_emerg jsonb;
begin
  perform sentinela.so_central();
  if p_origem is null or p_origem not in ('portal','passe') then
    raise exception 'sentinela: origem inválida (portal ou passe)' using errcode = '22023';
  end if;
  if v_proj is null or not exists (select 1 from sentinela.sistemas s where s.projeto = v_proj) then
    raise exception 'sentinela: projeto desconhecido' using errcode = '22023';
  end if;
  if v_email is not null and v_email !~ '^[^@[:space:]|]+@[^@[:space:]|]+$' then
    v_email := null;
  end if;
  select * into v_cfg from sentinela.rede_config c where c.id;
  v_modo := sentinela.rede_modo_efetivo(v_proj);
  select * into v_rede from sentinela.redes r where r.id = sentinela.rede_que_contem(v_ip);

  -- botão de emergência (§12.2): só para administrador ativo, fora da rede, com IP
  if v_rede.id is null and v_ip is not null and p_user_id is not null
     and exists (select 1 from public.profiles p where p.id = p_user_id and p.ativo and p.is_admin) then
    v_provas := sentinela.rede_provas(v_ip, p_user_id);
    v_emerg := jsonb_build_object(
      'possivel', (v_provas->>'pessoas')::int >= coalesce(v_cfg.emergencia_pessoas, 3),
      'pessoas', (v_provas->>'pessoas')::int);
  end if;

  if v_modo = 'desligado' or v_rede.id is not null then
    v_acao := 'seguir';
  else
    if p_user_id is not null then
      v_lib := sentinela.liberacao_ativa(p_user_id);
    end if;
    if v_lib.id is not null then
      v_acao := 'seguir';
      v_decisao := 'liberado';
    elsif v_modo = 'observar' then
      v_acao := 'observar';
      v_decisao := 'observado';
    else
      v_acao := 'bloquear';
      v_decisao := 'bloqueado';
    end if;
    perform sentinela.rede_fora_gravar(v_ip, p_user_id, v_email, p_origem, v_proj, v_decisao, v_lib.id,
                                       sentinela.txt(p_ua, 300));
  end if;
  perform sentinela.rede_limpeza();

  return jsonb_build_object(
    'modo', v_modo,
    'na_rede', v_rede.id is not null,
    'rede', case when v_rede.id is not null then jsonb_build_object('id', v_rede.id, 'descricao', v_rede.descricao) end,
    'liberado', case when v_lib.id is not null
                     then jsonb_build_object('id', v_lib.id, 'ate', sentinela.iso(v_lib.fim), 'motivo', v_lib.motivo) end,
    'acao', v_acao,
    'ip', host(v_ip),
    'emergencia', v_emerg);
end $$;

-- Botão de emergência do portal (§12.2). O IP vem do pedido (a central o tira dos
-- cabeçalhos), nunca do corpo; entra como /32 (IPv4) ou /64 (IPv6).
create or replace function public.sentinela_srv_rede_emergencia(p_ip text, p_user_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = sentinela, public, extensions, pg_temp
as $$
declare
  v_ip inet := sentinela.ip_ou_nulo(p_ip);
  v_adm public.profiles;
  v_cfg sentinela.rede_config;
  v_rede cidr;
  v_provas jsonb;
  v_n int;
  v_id bigint;
  v_email text;
begin
  perform sentinela.so_central();
  select * into v_adm from public.profiles p where p.id = p_user_id;
  if v_adm.id is null or not v_adm.ativo or not v_adm.is_admin then
    return jsonb_build_object('ok', false, 'motivo', 'so_admin');
  end if;
  v_email := left(lower(coalesce(nullif(btrim(v_adm.email), ''), v_adm.id::text)), 200);
  if v_ip is null then
    return jsonb_build_object('ok', false, 'motivo', 'ip_invalido');
  end if;
  begin
    v_rede := sentinela.rede_lube_valida(case when family(v_ip) = 4 then host(v_ip)
                                              else network(set_masklen(v_ip, 64))::text end);
  exception when sqlstate '22023' then
    return jsonb_build_object('ok', false, 'motivo', 'ip_invalido');
  end;
  -- uma mudança de rede por vez (mesma trava das ações do painel)
  perform pg_advisory_xact_lock(hashtextextended('sentinela.rede', 0));
  if sentinela.rede_que_contem(v_ip) is not null then
    return jsonb_build_object('ok', false, 'motivo', 'ja_cadastrada');
  end if;
  select * into v_cfg from sentinela.rede_config c where c.id;
  v_provas := sentinela.rede_provas(v_ip, p_user_id);
  v_n := (v_provas->>'pessoas')::int;
  if v_n < coalesce(v_cfg.emergencia_pessoas, 3) then
    return jsonb_build_object('ok', false, 'motivo', 'sem_provas', 'pessoas', v_n);
  end if;
  insert into sentinela.redes (rede, descricao, origem, criado_por)
  values (v_rede, 'emergência: IP novo do escritório (' || v_n || ' pessoas barradas)', 'emergencia', v_email)
  returning id into v_id;
  insert into sentinela.acoes_admin (email, acao, dados)
  values (v_email, 'rede_emergencia',
          jsonb_build_object('id', v_id, 'rede', v_rede::text, 'ip', host(v_ip), 'pessoas', v_n,
                             'horas', coalesce(v_cfg.emergencia_horas, 2), 'emails', v_provas->'emails'));
  return jsonb_build_object('ok', true, 'id', v_id, 'rede', v_rede::text);
end $$;

-- ---------------------------------------------------------
-- 4. FUNÇÕES DO PAINEL (authenticated + is_admin)
-- ---------------------------------------------------------
create or replace function public.sentinela_rede_painel(p_dias int default 14)
returns jsonb
language plpgsql
stable
security definer
set search_path = sentinela, public, extensions, pg_temp
as $$
declare
  v_d int := least(greatest(coalesce(p_dias, 14), 1), 90);
  v_ini timestamptz;
  v_cfg sentinela.rede_config;
  v_res jsonb;
begin
  if not public.is_admin() then
    raise exception 'sentinela: acesso restrito ao TI' using errcode = '42501';
  end if;
  v_ini := now() - make_interval(days => v_d);
  select * into v_cfg from sentinela.rede_config c where c.id;

  with
  ativas as materialized (
    select r.id, r.rede, r.descricao, r.origem, r.criado_em, r.criado_por
      from sentinela.redes r
     where r.removido_em is null
  ),
  ev as materialized (
    select e.id, e.criado_em, e.projeto, e.ip, e.decisao, e.regra, e.identidade,
           (select a.id from ativas a where a.rede >>= e.ip order by masklen(a.rede) desc, a.id limit 1) as rede_id
      from sentinela.eventos e
     where e.criado_em >= v_ini
  ),
  -- tudo o que é "de fora": email null = sem login; robô (nome sem '@') nunca entra
  fora_bruto as materialized (
    -- (a) eventos da regra de rede
    select case when x.identidade like '%@%' then x.identidade end as email, x.ip, x.projeto,
           x.criado_em as pri, x.criado_em as ult, 1 as vezes,
           case when x.decisao = 'bloqueado' then 'barrado'
                when x.regra = 'rede_liberado' or x.decisao = 'liberado' then 'liberado'
                else 'seria_barrado' end as sit
      from ev x
     where x.regra in ('fora_da_rede','rede_liberado')
       and (x.identidade is null or x.identidade like '%@%')
    union all
    -- (b) prévia: pessoa com login fora de toda rede ativa, sem a regra de rede no evento
    select x.identidade, x.ip, x.projeto, x.criado_em, x.criado_em, 1, 'regra_desligada'
      from ev x
     where x.identidade like '%@%' and x.rede_id is null
       and (x.regra is null or x.regra not in ('fora_da_rede','rede_liberado','rede_maquina'))
    union all
    -- (c) o que só a central viu (login no portal e pedido de passe)
    select f.email, f.ip, f.projeto, f.criado_em, f.ultimo_em, f.vezes,
           case f.decisao when 'bloqueado' then 'barrado' when 'observado' then 'seria_barrado' else 'liberado' end
      from sentinela.rede_fora f
     where f.ultimo_em >= v_ini
  ),
  fora_g as (
    select b.email, b.ip,
           array_agg(distinct b.projeto) as projetos,
           sum(b.vezes)::int as vezes,
           coalesce(sum(b.vezes) filter (where b.sit = 'barrado'), 0)::int as barrados,
           coalesce(sum(b.vezes) filter (where b.sit = 'seria_barrado'), 0)::int as observados,
           coalesce(sum(b.vezes) filter (where b.sit = 'liberado'), 0)::int as liberados,
           coalesce(sum(b.vezes) filter (where b.sit = 'regra_desligada'), 0)::int as sem_regra,
           min(b.pri) as primeiro, max(b.ult) as ultimo,
           -- a do acesso mais recente; no mesmo instante, a mais grave
           (array_agg(b.sit order by b.ult desc, case b.sit when 'barrado' then 0 when 'seria_barrado' then 1
                                                            when 'liberado' then 2 else 3 end))[1] as situacao
      from fora_bruto b
     group by b.email, b.ip
  ),
  -- pessoas com login vistas de cada IP na janela (guardas, login no portal e central)
  pessoas_ip as (
    select y.ip, count(distinct y.email) as n
      from (select e.ip, e.identidade as email from ev e where e.identidade like '%@%'
            union all
            select d.ip, lower(d.email) from sentinela.identidades d where d.criado_em >= v_ini
            union all
            select f.ip, f.email from sentinela.rede_fora f
             where f.ultimo_em >= v_ini and f.email is not null and f.ip is not null) y
     group by y.ip
  ),
  abertas as (
    select distinct on (l.user_id) l.id, l.user_id, l.fim
      from sentinela.rede_liberacoes l
     where l.encerrado_em is null and l.fim > now()
     order by l.user_id, l.inicio, l.id desc
  ),
  fora_top as (
    select g.*, p.id as user_id, p.nome, i.pais, i.regiao, i.cidade, coalesce(pi.n, 0) as pessoas_no_ip,
           ab.id as lib_id, ab.fim as lib_fim
      from fora_g g
      left join public.profiles p on g.email is not null and lower(p.email) = g.email
      left join sentinela.ips i on i.ip = g.ip
      left join pessoas_ip pi on pi.ip = g.ip
      left join abertas ab on ab.user_id = p.id
     order by g.ultimo desc, g.email nulls last, g.ip
     limit 300
  ),
  -- "Parece rede da Lube": IP fora de toda rede com 2+ pessoas ativas em 2+ dias
  atividade as (
    select e.ip, e.identidade as email, e.criado_em as em from ev e where e.identidade like '%@%' and e.rede_id is null
    union all
    select d.ip, lower(d.email), d.criado_em
      from sentinela.identidades d
     where d.criado_em >= v_ini and not exists (select 1 from ativas a where a.rede >>= d.ip)
  ),
  sug as (
    select a.ip, count(distinct a.email) as pessoas, count(*) as acessos,
           count(distinct (a.em at time zone 'America/Sao_Paulo')::date) as dias,
           min(a.em) as primeiro, max(a.em) as ultimo
      from atividade a
      join public.profiles p on lower(p.email) = a.email and p.ativo
     group by a.ip
    having count(distinct a.email) >= 2 and count(distinct (a.em at time zone 'America/Sao_Paulo')::date) >= 2
  ),
  fora_proj as (
    select b.projeto, count(distinct b.email) as pessoas,
           coalesce(sum(b.vezes) filter (where b.sit = 'barrado'), 0) as barrados,
           coalesce(sum(b.vezes) filter (where b.sit = 'seria_barrado'), 0) as observados,
           coalesce(sum(b.vezes) filter (where b.sit = 'liberado'), 0) as liberados,
           coalesce(sum(b.vezes) filter (where b.sit = 'regra_desligada'), 0) as sem_regra
      from fora_bruto b
     group by b.projeto
  ),
  uso_rede as (
    select x.rede_id, count(*) as acessos,
           count(distinct x.identidade) filter (where x.identidade like '%@%') as pessoas,
           max(x.criado_em) as ultimo
      from ev x
     where x.rede_id is not null
     group by x.rede_id
  ),
  libs as (
    select l.*, p.nome, coalesce(p.ativo, false) as perfil_ativo,
           case when l.encerrado_em is not null then 'encerrada'
                when l.fim <= now() then 'vencida'
                when l.inicio > now() then 'agendada'
                else 'ativa' end as estado
      from sentinela.rede_liberacoes l
      left join public.profiles p on p.id = l.user_id
     where coalesce(l.encerrado_em, l.fim) > now() - interval '30 days'
     order by (l.encerrado_em is null and l.fim > now()) desc, l.fim desc, l.id desc
     limit 200
  ),
  -- barrados (exigir) e "seriam barrados" (observar) nas últimas 24 h: no observar, a fase de medir,
  -- o topo do módulo mostra os que seriam barrados
  fora24 as (
    select e.identidade as email, 1 as vezes, e.decisao
      from sentinela.eventos e
     where e.criado_em > now() - interval '24 hours' and e.regra = 'fora_da_rede' and e.decisao in ('bloqueado','observado')
    union all
    select f.email, f.vezes, f.decisao
      from sentinela.rede_fora f
     where f.ultimo_em > now() - interval '24 hours' and f.decisao in ('bloqueado','observado')
  ),
  sis as (
    select s.*, coalesce(rs.isento, false) as isento2,
           case when coalesce(rs.isento, false) then 'desligado' else coalesce(rs.modo, 'desligado') end as modo2,
           rs.modo_em, rs.modo_por,
           sentinela.guarda_tem_rede(s.guarda_versao) and coalesce(s.ultimo_ambiente = 'production', false) as guarda_ok
      from sentinela.sistemas s
      left join sentinela.rede_sistemas rs on rs.projeto_id = s.projeto_id
  )
  select jsonb_build_object(
    'agora', sentinela.iso(now()),
    'dias', v_d,
    'max_dias', coalesce(v_cfg.liberacao_max_dias, 30),
    'redes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', a.id, 'rede', a.rede::text, 'descricao', a.descricao, 'origem', a.origem,
               'criado_em', sentinela.iso(a.criado_em), 'criado_por', a.criado_por,
               'acessos', coalesce(u.acessos, 0), 'pessoas', coalesce(u.pessoas, 0), 'ultimo', sentinela.iso(u.ultimo))
             order by a.id)
        from ativas a left join uso_rede u on u.rede_id = a.id), '[]'::jsonb),
    'sistemas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'projeto', s.projeto, 'projeto_id', s.projeto_id, 'nome', s.nome, 'url', s.url,
               'modo', s.modo2, 'modo_efetivo', sentinela.rede_modo_efetivo(s.projeto),
               'isento', s.isento2, 'modo_em', sentinela.iso(s.modo_em), 'modo_por', s.modo_por,
               'exige_login', s.exige_login, 'ativo', s.ativo, 'guarda_versao', s.guarda_versao,
               -- guarda que confere a rede, visto na produção (o sinal de uma prévia não conta)
               'guarda_rede', s.guarda_ok, 'ultimo_ambiente', s.ultimo_ambiente,
               'ultimo_sinal', sentinela.iso(s.ultimo_sinal),
               'fora', jsonb_build_object('pessoas', coalesce(fp.pessoas, 0), 'barrados', coalesce(fp.barrados, 0),
                                          'observados', coalesce(fp.observados, 0), 'liberados', coalesce(fp.liberados, 0),
                                          'sem_regra', coalesce(fp.sem_regra, 0)))
             order by s.isento2, (s.sistema_slug is not null), s.nome)
        from sis s left join fora_proj fp on fp.projeto = s.projeto), '[]'::jsonb),
    'liberacoes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', l.id, 'user_id', l.user_id, 'email', l.email, 'nome', l.nome,
               'inicio', sentinela.iso(l.inicio), 'fim', sentinela.iso(l.fim), 'motivo', l.motivo,
               'criado_em', sentinela.iso(l.criado_em), 'criado_por', l.criado_por,
               'encerrado_em', sentinela.iso(l.encerrado_em), 'encerrado_por', l.encerrado_por,
               'estado', l.estado, 'perfil_ativo', l.perfil_ativo,
               'entradas', coalesce(ent.n, 0), 'ultima_entrada', sentinela.iso(ent.ultima))
             order by (l.estado in ('ativa','agendada')) desc, l.fim desc, l.id desc)
        from libs l
        left join lateral (
          select sum(z.n)::int as n, max(z.em) as ultima
            from (select count(*) as n, max(e.criado_em) as em
                    from sentinela.eventos e
                   where e.regra = 'rede_liberado' and e.identidade = l.email
                     and e.criado_em >= l.inicio and e.criado_em <= coalesce(l.encerrado_em, l.fim)
                  union all
                  select coalesce(sum(f.vezes), 0), max(f.ultimo_em)
                    from sentinela.rede_fora f
                   where f.liberacao_id = l.id) z) ent on true), '[]'::jsonb),
    'fora', coalesce((
      select jsonb_agg(jsonb_build_object(
               'email', t.email, 'nome', t.nome, 'user_id', t.user_id, 'ip', host(t.ip),
               'pais', t.pais, 'regiao', t.regiao, 'cidade', t.cidade, 'projetos', to_jsonb(t.projetos),
               'vezes', t.vezes, 'barrados', t.barrados, 'observados', t.observados, 'liberados', t.liberados,
               'sem_regra', t.sem_regra, 'primeiro', sentinela.iso(t.primeiro), 'ultimo', sentinela.iso(t.ultimo),
               'situacao', t.situacao,
               'liberacao', case when t.lib_id is not null then jsonb_build_object('id', t.lib_id, 'fim', sentinela.iso(t.lib_fim)) end,
               'pessoas_no_ip', t.pessoas_no_ip)
             order by t.ultimo desc, t.email nulls last, t.ip)
        from fora_top t), '[]'::jsonb),
    'sugestoes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'ip', host(s.ip), 'pais', i.pais, 'regiao', i.regiao, 'cidade', i.cidade,
               'pessoas', s.pessoas, 'acessos', s.acessos, 'dias', s.dias,
               'primeiro', sentinela.iso(s.primeiro), 'ultimo', sentinela.iso(s.ultimo))
             order by s.pessoas desc, s.acessos desc, s.ip)
        from (select s2.* from sug s2
               where not exists (select 1 from sentinela.tor_saidas t where t.ip = s2.ip)
                 and not exists (select 1 from sentinela.bloqueios b
                                  where b.nivel = 'certo' and b.rede >>= s2.ip
                                    and b.revogado_em is null and (b.expira_em is null or b.expira_em > now()))
               order by s2.pessoas desc, s2.acessos desc, s2.ip
               limit 20) s
        left join sentinela.ips i on i.ip = s.ip), '[]'::jsonb),
    'pessoas', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'nome', p.nome, 'email', p.email) order by lower(p.nome), p.email)
        from public.profiles p
       where p.ativo), '[]'::jsonb),
    'contagens', jsonb_build_object(
      'exigir',    (select count(*) from sis s where s.ativo and not s.isento2 and s.modo2 = 'exigir'),
      'observar',  (select count(*) from sis s where s.ativo and not s.isento2 and s.modo2 = 'observar'),
      'desligado', (select count(*) from sis s where s.ativo and not s.isento2 and s.modo2 = 'desligado'),
      'isentos',   (select count(*) from sis s where s.isento2),
      'redes',     (select count(*) from ativas),
      'liberacoes_ativas', (select count(*) from sentinela.rede_liberacoes l
                             join public.profiles p on p.id = l.user_id and p.ativo
                            where l.encerrado_em is null and l.inicio <= now() and l.fim > now()),
      'barrados_24h', (select coalesce(sum(b.vezes), 0) from fora24 b where b.decisao = 'bloqueado'),
      'pessoas_barradas_24h', (select count(distinct b.email) from fora24 b where b.decisao = 'bloqueado' and b.email like '%@%'),
      'seriam_barrados_24h', (select coalesce(sum(b.vezes), 0) from fora24 b where b.decisao = 'observado'),
      'pessoas_seriam_24h', (select count(distinct b.email) from fora24 b where b.decisao = 'observado' and b.email like '%@%'),
      -- exigindo sem um guarda que confere a rede (Instant Rollback para o 1.2.0, por exemplo): o painel
      -- mostra em vermelho; a sessão levada para casa voltaria a valer nesse sistema
      'exigir_sem_guarda', (select count(*) from sis s where s.ativo and not s.isento2 and s.modo2 = 'exigir' and not s.guarda_ok)))
  into v_res;

  return v_res;
end $$;

-- O que as ações do painel fazem (rede nova, remover, modo, liberar, encerrar). Fora da API: quem
-- chama é sentinela_rede_acao (painel, direto pelo banco) ou sentinela_srv_rede_acao (pela central,
-- que sabe de onde vem o pedido). p_email = quem fez; p_ip = de onde (só pela central; vai no registro).
create or replace function sentinela.rede_acao_exec(p_email text, p_acao text, p_dados jsonb, p_ip text default null)
returns jsonb
language plpgsql
set search_path = sentinela, public, extensions, pg_temp
as $$
declare
  d jsonb := coalesce(p_dados, '{}'::jsonb);
  v_email text := left(coalesce(nullif(btrim(p_email), ''), 'admin'), 200);
  v_res jsonb;
  v_cfg sentinela.rede_config;
  v_rede cidr;
  v_txt text;
  v_id bigint;
  v_id2 bigint;
  v_outra sentinela.redes;
  v_modo text;
  v_alvos text[];
  v_isento boolean;
  v_falta text;
  v_alt jsonb;
  v_uid uuid;
  v_perfil public.profiles;
  v_mail text;
  v_ini timestamptz;
  v_fim timestamptz;
  v_max int;
  v_acao_log text;
begin
  if jsonb_typeof(d) <> 'object' then
    raise exception 'sentinela: dados devem ser um objeto JSON' using errcode = '22023';
  end if;
  if pg_column_size(d) > 20000 then
    raise exception 'sentinela: dados grandes demais' using errcode = '22023';
  end if;
  select * into v_cfg from sentinela.rede_config c where c.id;

  case coalesce(p_acao, '')

  when 'rede_nova' then
    v_rede := sentinela.rede_lube_valida(d->>'rede');
    v_txt := sentinela.txt(d->>'descricao', 200);
    if v_txt is null or char_length(v_txt) not between 3 and 120 or v_txt ~ '[[:cntrl:]]' then
      raise exception 'sentinela: informe a descrição da rede (de 3 a 120 caracteres, ex.: Escritório Cariacica)'
        using errcode = '22023';
    end if;
    if coalesce(d->>'origem', 'manual') not in ('manual','sugestao') then
      raise exception 'sentinela: origem inválida (manual ou sugestao)' using errcode = '22023';
    end if;
    -- uma mudança de rede por vez
    perform pg_advisory_xact_lock(hashtextextended('sentinela.rede', 0));
    select * into v_outra from sentinela.redes r
     where r.removido_em is null and r.rede >>= v_rede
     order by masklen(r.rede) desc, r.id limit 1;
    if v_outra.id is not null then
      raise exception 'sentinela: já coberta pela rede #% (%)', v_outra.id, v_outra.rede::text using errcode = '22023';
    end if;
    select * into v_outra from sentinela.redes r
     where r.removido_em is null and r.rede << v_rede
     order by r.id limit 1;
    if v_outra.id is not null then
      raise exception 'sentinela: a faixa inclui a rede #% (%), já cadastrada; remova-a antes de cadastrar a faixa maior',
        v_outra.id, v_outra.rede::text using errcode = '22023';
    end if;
    insert into sentinela.redes (rede, descricao, origem, criado_por)
    values (v_rede, v_txt, coalesce(d->>'origem', 'manual'), v_email)
    returning id into v_id;
    v_res := jsonb_build_object('ok', true, 'id', v_id, 'rede', v_rede::text);
    v_acao_log := 'rede_nova';

  when 'rede_remover' then
    v_id := sentinela.big_ou_nulo(d->>'id');
    if v_id is null then
      raise exception 'sentinela: id inválido' using errcode = '22023';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('sentinela.rede', 0));
    if not exists (select 1 from sentinela.redes r where r.id = v_id and r.removido_em is null) then
      raise exception 'sentinela: rede não encontrada ou já removida' using errcode = 'P0002';
    end if;
    if not exists (select 1 from sentinela.redes r where r.removido_em is null and r.id <> v_id)
       and exists (select 1 from sentinela.rede_sistemas rs where rs.modo = 'exigir') then
      raise exception 'sentinela: é a última rede da Lube e há sistema exigindo a rede; passe os sistemas para observar antes'
        using errcode = '22023';
    end if;
    update sentinela.redes r set removido_em = now(), removido_por = v_email where r.id = v_id;
    v_res := jsonb_build_object('ok', true);
    v_acao_log := 'rede_remover';

  when 'rede_modo' then
    v_modo := d->>'modo';
    if v_modo is null or v_modo not in ('desligado','observar','exigir') then
      raise exception 'sentinela: modo inválido (desligado, observar ou exigir)' using errcode = '22023';
    end if;
    v_txt := sentinela.txt(d->>'projeto', 100);
    if v_txt is null then
      raise exception 'sentinela: informe o sistema (nome do projeto) ou * para todos' using errcode = '22023';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('sentinela.rede', 0));
    if v_txt = '*' then
      -- todos os sistemas ativos, menos os isentos (SAC e Supervisor). Em exigir, só os que exigem
      -- login: o portal (que é o login) passa a exigir à parte, por último (roteiro, passo 8c)
      select coalesce(array_agg(s.projeto order by s.projeto), '{}') into v_alvos
        from sentinela.sistemas s
        left join sentinela.rede_sistemas rs on rs.projeto_id = s.projeto_id
       where s.ativo and not coalesce(rs.isento, false) and (v_modo <> 'exigir' or s.exige_login);
    else
      select coalesce(rs.isento, false) into v_isento
        from sentinela.sistemas s
        left join sentinela.rede_sistemas rs on rs.projeto_id = s.projeto_id
       where s.projeto = v_txt;
      if not found then
        raise exception 'sentinela: sistema não encontrado' using errcode = 'P0002';
      end if;
      if v_isento then
        raise exception 'sentinela: % fica fora da regra de rede (usado na rua)', v_txt using errcode = '22023';
      end if;
      v_alvos := array[v_txt];
    end if;
    if v_modo = 'exigir' then
      if not exists (select 1 from sentinela.redes r where r.removido_em is null) then
        raise exception 'sentinela: cadastre pelo menos uma rede da Lube antes de exigir' using errcode = '22023';
      end if;
      -- guarda antigo deixaria a sessão levada para casa valer fora: só exige com o 1.3.0. E visto na
      -- produção: guarda_versao é de quem mandou o último evento, e uma prévia com o 1.3.0 não prova
      -- que a produção já tem o guarda novo
      select string_agg(s.projeto, ', ' order by s.projeto) into v_falta
        from sentinela.sistemas s
       where s.projeto = any(v_alvos)
         and not (sentinela.guarda_tem_rede(s.guarda_versao) and coalesce(s.ultimo_ambiente = 'production', false));
      if v_falta is not null then
        raise exception 'sentinela: precisa do guarda 1.3.0 em produção antes de exigir a rede em: % (o último sinal tem de vir do endereço de produção)', v_falta
          using errcode = '22023';
      end if;
    end if;
    with alvo as (
      select s.projeto_id, s.projeto
        from sentinela.sistemas s
        left join sentinela.rede_sistemas rs on rs.projeto_id = s.projeto_id
       where s.projeto = any(v_alvos) and not coalesce(rs.isento, false)
         and coalesce(rs.modo, 'desligado') <> v_modo
    ),
    up as (
      insert into sentinela.rede_sistemas as t (projeto_id, modo, modo_em, modo_por)
      select a.projeto_id, v_modo, now(), v_email from alvo a
      on conflict (projeto_id) do update
         set modo = excluded.modo, modo_em = excluded.modo_em, modo_por = excluded.modo_por
       where not t.isento
      returning t.projeto_id
    )
    select coalesce(jsonb_agg(a.projeto order by a.projeto), '[]'::jsonb) into v_alt
      from alvo a join up u on u.projeto_id = a.projeto_id;
    v_res := jsonb_build_object('ok', true, 'alterados', v_alt);
    v_acao_log := 'rede_modo';

  when 'liberar' then
    if coalesce(d->>'user_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'sentinela: pessoa inválida' using errcode = '22023';
    end if;
    v_uid := (d->>'user_id')::uuid;
    select * into v_perfil from public.profiles p where p.id = v_uid;
    if v_perfil.id is null then
      raise exception 'sentinela: pessoa não encontrada' using errcode = 'P0002';
    end if;
    if not v_perfil.ativo then
      raise exception 'sentinela: a conta desta pessoa não está ativa no Painel Lube' using errcode = '22023';
    end if;
    -- o guarda compara o SHA-256 do e-mail em minúsculas: só ASCII dá o mesmo resultado nos dois lados
    v_mail := lower(btrim(coalesce(v_perfil.email, '')));
    if v_mail !~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$' then
      raise exception 'sentinela: o e-mail desta conta tem caractere fora do padrão; não dá para liberar por aqui'
        using errcode = '22023';
    end if;
    if d->'inicio' is null or jsonb_typeof(d->'inicio') = 'null' then
      v_ini := now();
    else
      v_ini := sentinela.ts_ou_nulo(d->>'inicio');
    end if;
    if v_ini is null or v_ini < now() - interval '5 minutes' or v_ini > now() + interval '30 days' then
      raise exception 'sentinela: início inválido (de agora até 30 dias à frente)' using errcode = '22023';
    end if;
    v_fim := sentinela.ts_ou_nulo(d->>'fim');
    if v_fim is null then
      raise exception 'sentinela: informe até quando vale a liberação (data e hora)' using errcode = '22023';
    end if;
    if v_fim <= now() + interval '5 minutes' then
      raise exception 'sentinela: o fim da liberação tem de ser daqui a mais de 5 minutos' using errcode = '22023';
    end if;
    if v_fim <= v_ini then
      raise exception 'sentinela: o fim tem de ser depois do início' using errcode = '22023';
    end if;
    v_max := coalesce(v_cfg.liberacao_max_dias, 30);
    if v_fim - v_ini > make_interval(days => v_max) then
      raise exception 'sentinela: prazo máximo de % dias', v_max using errcode = '22023';
    end if;
    v_txt := sentinela.txt(d->>'motivo', 400);
    if v_txt is null or char_length(v_txt) not between 5 and 300 or v_txt ~ '[[:cntrl:]]' then
      raise exception 'sentinela: informe o motivo (de 5 a 300 caracteres)' using errcode = '22023';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('sentinela.rede_liberacao|' || v_uid::text, 0));
    insert into sentinela.rede_liberacoes (user_id, email, inicio, fim, motivo, criado_por)
    values (v_uid, v_mail, v_ini, v_fim, v_txt, v_email)
    returning id into v_id;
    -- uma aberta por pessoa: a anterior (ativa ou agendada) é encerrada
    with enc as (
      update sentinela.rede_liberacoes l
         set encerrado_em = now(), encerrado_por = 'substituída por #' || v_id
       where l.user_id = v_uid and l.id <> v_id and l.encerrado_em is null and l.fim > now()
      returning l.id
    )
    select max(enc.id) into v_id2 from enc;
    v_res := jsonb_build_object('ok', true, 'id', v_id, 'fim', sentinela.iso(v_fim), 'substituida', v_id2);
    v_acao_log := 'rede_liberar';

  when 'encerrar' then
    v_id := sentinela.big_ou_nulo(d->>'id');
    if v_id is null then
      raise exception 'sentinela: id inválido' using errcode = '22023';
    end if;
    update sentinela.rede_liberacoes l
       set encerrado_em = now(), encerrado_por = v_email
     where l.id = v_id and l.encerrado_em is null and l.fim > now();
    if not found then
      raise exception 'sentinela: liberação não encontrada, já encerrada ou vencida' using errcode = 'P0002';
    end if;
    v_res := jsonb_build_object('ok', true);
    v_acao_log := 'rede_encerrar';

  else
    raise exception 'sentinela: ação desconhecida' using errcode = '22023';
  end case;

  insert into sentinela.acoes_admin (email, acao, dados)
  values (v_email, v_acao_log, case when p_ip is null then d else d || jsonb_build_object('ip_admin', left(p_ip, 45)) end);
  return v_res;
end $$;

-- Painel da Sentinela, direto pelo banco (PostgREST). O banco não sabe de onde vem o pedido, então
-- com algum sistema exigindo a rede, o que afrouxa a regra é recusado aqui: vai pela central
-- (sentinela_srv_rede_acao), que confere o IP. Sem isso, a senha de um administrador, de fora,
-- desligaria a regra para ele mesmo (cadastrando a casa como rede, liberando-se ou desligando o modo).
create or replace function public.sentinela_rede_acao(p_acao text, p_dados jsonb)
returns jsonb
language plpgsql
security definer
set search_path = sentinela, public, extensions, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'sentinela: acesso restrito ao TI' using errcode = '42501';
  end if;
  if sentinela.rede_afrouxa(p_acao, p_dados) and sentinela.rede_trava() then
    raise exception 'sentinela: com sistema exigindo a rede, cadastrar rede, liberar pessoa, observar e desligar passam pela central (atualize a página e tente de novo)'
      using errcode = '42501';
  end if;
  return sentinela.rede_acao_exec(coalesce(nullif(auth.jwt()->>'email', ''), auth.uid()::text, 'admin'), p_acao, p_dados);
end $$;

-- Painel da Sentinela pela central (POST /rede com "acao"): a central confere o token, o perfil
-- ativo e manda o IP do próprio pedido. Com algum sistema exigindo a rede, afrouxar a regra só de
-- dentro de uma rede da Lube ou com liberação ativa do TI; apertar vale de qualquer lugar.
-- Recusa → {"ok":false,"codigo":"<sqlstate>","erro":"sentinela: ..."} (nada gravado).
create or replace function public.sentinela_srv_rede_acao(p_user_id uuid, p_ip text, p_acao text, p_dados jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = sentinela, public, extensions, pg_temp
as $$
declare
  v_adm public.profiles;
  v_ip inet := sentinela.ip_ou_nulo(p_ip);
  v_email text;
begin
  perform sentinela.so_central();
  select * into v_adm from public.profiles p where p.id = p_user_id;
  if v_adm.id is null or not v_adm.ativo or not v_adm.is_admin then
    return jsonb_build_object('ok', false, 'codigo', '42501', 'erro', 'sentinela: acesso restrito ao TI');
  end if;
  v_email := left(lower(coalesce(nullif(btrim(v_adm.email), ''), v_adm.id::text)), 200);
  if sentinela.rede_afrouxa(p_acao, p_dados) and sentinela.rede_trava()
     and sentinela.rede_que_contem(v_ip) is null and (sentinela.liberacao_ativa(v_adm.id)).id is null then
    return jsonb_build_object('ok', false, 'codigo', '42501',
      'erro', 'sentinela: você está fora da rede da Lube: com sistema exigindo a rede, cadastrar rede, liberar pessoa, '
              || 'observar e desligar só de dentro da empresa (ou com liberação do TI). Emergência: passo a passo por SQL');
  end if;
  begin
    return sentinela.rede_acao_exec(v_email, p_acao, p_dados, host(v_ip));
  exception when sqlstate '22023' or sqlstate 'P0002' or sqlstate '42501' then
    return jsonb_build_object('ok', false, 'codigo', sqlstate, 'erro', sqlerrm);
  end;
end $$;

-- ---------------------------------------------------------
-- 5. EMERGÊNCIA POR SQL (schema sentinela, só no SQL Editor — §12.1)
-- ---------------------------------------------------------

-- O IP do escritório mudou: cadastra a rede nova. Vale em até 30 s (10 s da central + 20 s do guarda).
create or replace function sentinela.emergencia_rede(p_ip text, p_descricao text default 'emergência: IP novo do escritório')
returns text language plpgsql
set search_path = sentinela, public, extensions, pg_temp
as $$
declare
  v_rede cidr;
  v_desc text;
  v_outra sentinela.redes;
  v_id bigint;
  v_txt text := btrim(coalesce(p_ip, ''));
  v_ip inet;
begin
  perform sentinela.so_sql_editor();
  -- IPv6 sem máscara: cada computador do escritório sai com um endereço próprio dentro do mesmo
  -- prefixo; cadastra o /64 inteiro (como o botão do portal), não só o endereço de quem rodou
  if position('/' in v_txt) = 0 and position(':' in v_txt) > 0 then
    v_ip := sentinela.ip_ou_nulo(v_txt);
    if v_ip is not null and family(v_ip) = 6 then
      v_txt := network(set_masklen(v_ip, 64))::text;
    end if;
  end if;
  v_rede := sentinela.rede_lube_valida(v_txt);
  v_desc := sentinela.txt(p_descricao, 120);
  if v_desc is null or char_length(v_desc) < 3 then
    v_desc := 'emergência: IP novo do escritório';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('sentinela.rede', 0));
  select * into v_outra from sentinela.redes r
   where r.removido_em is null and r.rede >>= v_rede
   order by masklen(r.rede) desc, r.id limit 1;
  if v_outra.id is not null then
    return format('já coberta pela rede #%s (%s): nada mudou', v_outra.id, v_outra.rede::text);
  end if;
  insert into sentinela.redes (rede, descricao, origem, criado_por)
  values (v_rede, v_desc, 'emergencia', 'sql-emergencia')
  returning id into v_id;
  insert into sentinela.acoes_admin (email, acao, dados)
  values ('sql-emergencia', 'rede_emergencia_sql', jsonb_build_object('id', v_id, 'rede', v_rede::text, 'descricao', v_desc));
  return format('rede #%s cadastrada: %s (vale em até 30 s)', v_id, v_rede::text);
end $$;

-- Não deu para achar o IP novo: todo "exigir" vira "observar" (volta pelo painel).
create or replace function sentinela.emergencia_pausar_rede()
returns text language plpgsql
set search_path = sentinela, public, extensions, pg_temp
as $$
declare
  v_lista text[];
begin
  perform sentinela.so_sql_editor();
  perform pg_advisory_xact_lock(hashtextextended('sentinela.rede', 0));
  with alt as (
    update sentinela.rede_sistemas rs
       set modo = 'observar', modo_em = now(), modo_por = 'sql-emergencia'
     where rs.modo = 'exigir'
    returning rs.projeto_id
  )
  select coalesce(array_agg(coalesce(s.projeto, a.projeto_id) order by coalesce(s.projeto, a.projeto_id)), '{}')
    into v_lista
    from alt a left join sentinela.sistemas s on s.projeto_id = a.projeto_id;
  insert into sentinela.acoes_admin (email, acao, dados)
  values ('sql-emergencia', 'rede_pausar_sql', jsonb_build_object('alterados', to_jsonb(v_lista)));
  if cardinality(v_lista) = 0 then
    return 'nenhum sistema estava exigindo a rede';
  end if;
  return format('%s sistemas passaram de exigir para observar: %s', cardinality(v_lista), array_to_string(v_lista, ', '));
end $$;

-- TI de fora e precisando das telas: liberação de até 72 h para um perfil ativo.
create or replace function sentinela.emergencia_liberar(p_email text, p_horas int default 12,
                                                        p_motivo text default 'emergência: TI fora da rede')
returns text language plpgsql
set search_path = sentinela, public, extensions, pg_temp
as $$
declare
  v_perfil public.profiles;
  v_mail text := lower(btrim(coalesce(p_email, '')));
  v_motivo text;
  v_id bigint;
  v_fim timestamptz;
begin
  perform sentinela.so_sql_editor();
  if p_horas is null or p_horas not between 1 and 72 then
    raise exception 'sentinela: horas de 1 a 72' using errcode = '22023';
  end if;
  select * into v_perfil from public.profiles p where lower(p.email) = v_mail and p.ativo limit 1;
  if v_perfil.id is null then
    raise exception 'sentinela: perfil ativo não encontrado para %', v_mail using errcode = '22023';
  end if;
  if v_mail !~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$' then
    raise exception 'sentinela: e-mail fora do padrão' using errcode = '22023';
  end if;
  v_motivo := sentinela.txt(p_motivo, 300);
  if v_motivo is null or char_length(v_motivo) < 5 then
    v_motivo := 'emergência: TI fora da rede';
  end if;
  v_fim := now() + make_interval(hours => p_horas);
  perform pg_advisory_xact_lock(hashtextextended('sentinela.rede_liberacao|' || v_perfil.id::text, 0));
  insert into sentinela.rede_liberacoes (user_id, email, inicio, fim, motivo, criado_por)
  values (v_perfil.id, v_mail, now(), v_fim, v_motivo, 'sql-emergencia')
  returning id into v_id;
  update sentinela.rede_liberacoes l
     set encerrado_em = now(), encerrado_por = 'substituída por #' || v_id
   where l.user_id = v_perfil.id and l.id <> v_id and l.encerrado_em is null and l.fim > now();
  insert into sentinela.acoes_admin (email, acao, dados)
  values ('sql-emergencia', 'rede_liberar_sql', jsonb_build_object('id', v_id, 'email', v_mail, 'horas', p_horas));
  return format('liberação #%s: %s até %s (horário de Brasília)', v_id, v_mail,
                to_char(v_fim at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'));
end $$;

-- ---------------------------------------------------------
-- 6. PRIVILÉGIOS (antes dos seeds). Só objetos NOVOS: nada do que já existe é tocado.
--    anon: nada. authenticated: só as 2 de painel (com is_admin). service_role: as 4 srv_rede_*.
--    O executor das ações (rede_acao_exec) não tem porta nenhuma: só as duas funções de ação o chamam.
-- ---------------------------------------------------------
revoke all on table sentinela.rede_config, sentinela.rede_sistemas, sentinela.redes,
                    sentinela.rede_liberacoes, sentinela.rede_fora from public, anon, authenticated;
revoke all on sequence sentinela.redes_id_seq, sentinela.rede_liberacoes_id_seq, sentinela.rede_fora_id_seq
  from public, anon, authenticated;

revoke execute on function sentinela.rede_lube_valida(text)                 from public, anon, authenticated;
revoke execute on function sentinela.rede_que_contem(inet)                  from public, anon, authenticated;
revoke execute on function sentinela.email_hash(text)                       from public, anon, authenticated;
revoke execute on function sentinela.guarda_tem_rede(text)                  from public, anon, authenticated;
revoke execute on function sentinela.rede_modo(text)                        from public, anon, authenticated;
revoke execute on function sentinela.rede_modo_efetivo(text)                from public, anon, authenticated;
revoke execute on function sentinela.rede_trava()                           from public, anon, authenticated;
revoke execute on function sentinela.rede_afrouxa(text, jsonb)              from public, anon, authenticated;
revoke execute on function sentinela.rede_acao_exec(text, text, jsonb, text) from public, anon, authenticated, service_role;
revoke execute on function sentinela.liberacao_ativa(uuid)                  from public, anon, authenticated;
revoke execute on function sentinela.rede_provas(inet, uuid)                from public, anon, authenticated;
revoke execute on function sentinela.rede_fora_gravar(inet, uuid, text, text, text, text, bigint, text) from public, anon, authenticated;
revoke execute on function sentinela.rede_limpeza()                         from public, anon, authenticated;
revoke execute on function sentinela.so_sql_editor()                        from public, anon, authenticated;
revoke execute on function sentinela.emergencia_rede(text, text)            from public, anon, authenticated, service_role;
revoke execute on function sentinela.emergencia_pausar_rede()               from public, anon, authenticated, service_role;
revoke execute on function sentinela.emergencia_liberar(text, int, text)    from public, anon, authenticated, service_role;

revoke execute on function public.sentinela_srv_rede_lista(text)                              from public, anon, authenticated;
revoke execute on function public.sentinela_srv_rede_decidir(text, uuid, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.sentinela_srv_rede_emergencia(text, uuid)                   from public, anon, authenticated;
revoke execute on function public.sentinela_srv_rede_acao(uuid, text, text, jsonb)            from public, anon, authenticated;
grant  execute on function public.sentinela_srv_rede_lista(text)                              to service_role;
grant  execute on function public.sentinela_srv_rede_decidir(text, uuid, text, text, text, text) to service_role;
grant  execute on function public.sentinela_srv_rede_emergencia(text, uuid)                   to service_role;
grant  execute on function public.sentinela_srv_rede_acao(uuid, text, text, jsonb)            to service_role;

revoke execute on function public.sentinela_rede_painel(int)        from public, anon;
revoke execute on function public.sentinela_rede_acao(text, jsonb)  from public, anon;
grant  execute on function public.sentinela_rede_painel(int)        to authenticated;
grant  execute on function public.sentinela_rede_acao(text, jsonb)  to authenticated;

-- ---------------------------------------------------------
-- 7. SEEDS
-- ---------------------------------------------------------
insert into sentinela.rede_config (id) values (true) on conflict (id) do nothing;

-- SAC e Supervisor Lube ficam fora da regra (usados na rua; decisão do Júlio, 2026-10-23)
insert into sentinela.rede_sistemas (projeto_id, isento) values
  ('prj_HnjGoS8pFCFCIDD17iz3nvQ1LoB1', true),   -- sac-lube
  ('prj_qq6Fj5E22JGIdPTVDrxDpJVDzBdn', true)    -- supervisor-lube
on conflict (projeto_id) do update set isento = true, modo = 'desligado';

-- Reposições entra na central ANTES do primeiro deploy do guarda (lição do Trade, 2026-10-14).
-- Sem guarda (ultimo_sinal nulo) o /passe já devolve a URL sem passe: nada muda para ninguém.
-- Modo de rede: sem linha em rede_sistemas = desligado. Arquivos proibidos como os do Inventário
-- (o web/ do Reposições tem o mesmo desenho: db/, servidor_local.js, package*.json, vercel.json).
insert into sentinela.sistemas (projeto_id, projeto, nome, url, sistema_slug, exige_login, arquivos_proibidos)
values ('prj_IjVNqbwMq19wyDsAE0mfJZ7r3OIJ', 'reposicoes-web', 'Reposições e Chamados',
        'https://reposicoes-web.vercel.app', 'reposicoes', true,
        array['^/db/', '^/servidor_local\.js$', '^/package(-lock)?\.json$', '^/vercel\.json$',
              '^/(middleware|sentinela-guarda)\.ts$'])
on conflict do nothing;
-- SENTINELA-13-FIM
