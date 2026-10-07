-- =========================================================
-- SENTINELA LUBE — banco (schema sentinela + funções public.sentinela_*)
-- Contrato: docs/SENTINELA-ESPECIFICACAO.md (v1, 2026-10-05), seção 2.
-- Projeto Supabase PAINEL LUBE DISTRIBUIDORA (wkkdcsqwlxjxorutrbnx).
-- Pode rodar de novo: "if not exists" / "create or replace" / seeds sem duplicar.
-- Nenhum segredo aqui: a chave privada do passe nasce na Central e vai direto
-- para o Vault por sentinela_srv_chave_criar.
--
-- APLICAR NUMA TRANSAÇÃO SÓ: SQL Editor do Supabase, apply_migration, ou
-- psql -1 -v ON_ERROR_STOP=1 -f db/02_sentinela.sql. O arquivo não tem
-- begin/commit próprios de propósito: os testes rodam "begin; migração;
-- testes; rollback;" e um commit aqui dentro gravaria a migração de verdade.
-- Mesmo aplicado pela metade, nada fica aberto: toda srv_* recusa anon e
-- authenticated no corpo (sentinela.so_central) e toda função de painel
-- exige is_admin() na primeira linha.
-- =========================================================

create schema if not exists sentinela;
comment on schema sentinela is 'Sentinela Lube: eventos, bloqueios, confiáveis, análises da IA. Acesso só pelas funções public.sentinela_*.';
revoke all on schema sentinela from public, anon, authenticated;

-- ---------------------------------------------------------
-- 1. TABELAS
-- ---------------------------------------------------------
create table if not exists sentinela.config (
  id                    boolean primary key default true check (id),
  modo                  text not null default 'observar' check (modo in ('observar','proteger')),
  casa_nome             text not null default 'Lube Distribuidora · Cariacica-ES',
  casa_lat              double precision not null default -20.2632,
  casa_lon              double precision not null default -40.4165,
  limite_rajada_min     int not null default 120,
  limite_eventos_ip_min int not null default 30,      -- eventos gravados por IP por minuto; acima disso só conta em ips.descartados
  ia_limite_hora        int not null default 60,
  ia_confianca_min      numeric not null default 0.85,
  ia_status             text not null default 'desconhecido' check (ia_status in ('desconhecido','ligada','sem_chave','erro')),
  ia_status_detalhe     text,
  ia_status_em          timestamptz,
  tor_atualizado_em     timestamptz,
  manutencao_em         timestamptz,
  retencao_dias         int not null default 90,
  atualizado_em         timestamptz not null default now(),
  atualizado_por        text
);

create table if not exists sentinela.sistemas (
  projeto_id         text primary key,
  projeto            text not null unique,
  nome               text not null,
  url                text not null,
  sistema_slug       text,                            -- public.sistemas.slug; null = o próprio portal
  exige_login        boolean not null default false,
  rotas_publicas     text[] not null default '{}',
  arquivos_proibidos text[] not null default '{}',    -- regex JS aplicadas ao pathname decodificado
  ultimo_sinal       timestamptz,
  guarda_versao      text,
  guarda_runtime     text,
  ultimo_ambiente    text,
  ativo              boolean not null default true
);

-- Só inserção. O selo encadeia cada evento ao anterior (SHA-256).
create table if not exists sentinela.eventos (
  id                bigint generated always as identity primary key,
  criado_em         timestamptz not null default now(),
  ts_guarda         timestamptz,
  projeto           text not null,
  ambiente          text not null default 'production',
  host              text,
  metodo            text,
  caminho           text,
  consulta          text,
  tipo              text check (tipo in ('pagina','api','arquivo','outro')),
  ip                inet not null,
  pais              text,
  regiao            text,
  cidade            text,
  lat               double precision,
  lon               double precision,
  fuso              text,
  ua                text,
  idioma            text,
  referer           text,
  ja4               text,
  vercel_id         text,
  sec_fetch_site    text,
  sec_fetch_mode    text,
  sec_fetch_dest    text,
  decisao           text not null check (decisao in ('liberado','observado','bloqueado')),
  regra             text,
  motivo            text,
  risco             smallint not null default 0,
  identidade        text,
  identidade_origem text check (identidade_origem in ('passe','sessao_app','provavel') or identidade_origem is null),
  guarda            text,
  selo_anterior     text,
  selo              text not null,
  -- o <canon> do selo junta os campos com "|": só o último (ua) pode ter "|",
  -- senão daria para mover texto de um campo para outro sem mudar o selo
  constraint eventos_canon_sem_separador
    check (strpos(coalesce(projeto, '') || coalesce(metodo, '') || coalesce(caminho, '') || coalesce(decisao, '')
                  || coalesce(regra, '') || coalesce(identidade, ''), '|') = 0)
);
create index if not exists eventos_criado_idx  on sentinela.eventos (criado_em desc);
create index if not exists eventos_ip_idx      on sentinela.eventos (ip, criado_em desc);
create index if not exists eventos_projeto_idx on sentinela.eventos (projeto, criado_em desc);
create index if not exists eventos_decisao_idx on sentinela.eventos (decisao, criado_em desc);

create table if not exists sentinela.cadeia (
  id            boolean primary key default true check (id),
  ultimo_id     bigint,
  ultimo_selo   text,
  atualizado_em timestamptz
);

-- ATIVO = revogado_em is null and (expira_em is null or expira_em > now())
create table if not exists sentinela.bloqueios (
  id           bigint generated always as identity primary key,
  tipo         text not null check (tipo in ('ip','cidr','ja4')),
  valor        text not null,
  rede         cidr,                                  -- preenchido para ip e cidr
  nivel        text not null check (nivel in ('certo','suspeito')),
  origem       text not null check (origem in ('regra','ia','manual')),
  regra        text,
  motivo       text not null,
  criado_em    timestamptz not null default now(),
  expira_em    timestamptz,                           -- null = permanente
  revogado_em  timestamptz,
  revogado_por text,
  criado_por   text,
  evento_id    bigint,
  analise_id   bigint,
  hits         int not null default 0,
  ultimo_hit   timestamptz,
  check ((tipo in ('ip','cidr')) = (rede is not null))
);
create index if not exists bloqueios_rede_idx   on sentinela.bloqueios using gist (rede inet_ops) where revogado_em is null;
create index if not exists bloqueios_valor_idx  on sentinela.bloqueios (tipo, valor);
create index if not exists bloqueios_criado_idx on sentinela.bloqueios (criado_em desc);

-- ATIVO = removido_em is null and (expira_em is null or expira_em > now())
create table if not exists sentinela.confiaveis (
  id          bigint generated always as identity primary key,
  tipo        text not null check (tipo in ('ip','cidr')),
  valor       text not null,
  rede        cidr not null,
  descricao   text not null,
  origem      text not null check (origem in ('manual','login')),
  identidade  text,
  criado_em   timestamptz not null default now(),
  expira_em   timestamptz,                            -- login: now()+7 dias, renovado a cada login; manual: null
  removido_em timestamptz,
  criado_por  text
);
create index if not exists confiaveis_rede_idx on sentinela.confiaveis using gist (rede inet_ops) where removido_em is null;

create table if not exists sentinela.ips (
  ip                inet primary key,
  primeiro_visto    timestamptz not null default now(),
  ultimo_visto      timestamptz not null default now(),
  total             bigint not null default 0,
  descartados       bigint not null default 0,
  pais              text,
  regiao            text,
  cidade            text,
  lat               double precision,
  lon               double precision,
  ua_ultimo         text,
  projetos          text[] not null default '{}',
  risco_max         smallint not null default 0,
  identidade        text,
  identidade_em     timestamptz,
  ultima_analise_em timestamptz,
  ultimo_veredito   text,
  -- internos (fora do contrato): janelas de 60 s da rajada (a atual e a anterior, para
  -- aproximar "os últimos 60 s"; contam também o que foi descartado pelo teto) e pedido
  -- de análise já entregue à Central (evita pedir a IA duas vezes e entra na cota)
  janela_inicio     timestamptz,
  janela_total      int not null default 0,
  janela_anterior   int not null default 0,
  analise_pedida_em timestamptz
);
create index if not exists ips_ultimo_idx on sentinela.ips (ultimo_visto desc);
create index if not exists ips_pedida_idx on sentinela.ips (analise_pedida_em) where analise_pedida_em is not null;

create table if not exists sentinela.identidades (
  id        bigint generated always as identity primary key,
  ip        inet not null,
  user_id   uuid,
  email     text not null,
  origem    text check (origem in ('portal','passe','sessao_app')),
  ua        text,
  criado_em timestamptz not null default now()
);
create index if not exists identidades_ip_idx on sentinela.identidades (ip, criado_em desc);

create table if not exists sentinela.tentativas_login (
  id        bigint generated always as identity primary key,
  ip        inet not null,
  usuario   text,
  ua        text,
  criado_em timestamptz not null default now()
);
create index if not exists tentativas_ip_idx on sentinela.tentativas_login (ip, criado_em desc);

create table if not exists sentinela.analises (
  id             bigint generated always as identity primary key,
  ip             inet not null,
  criado_em      timestamptz not null default now(),
  modelo         text,
  veredito       text check (veredito in ('legitimo','suspeito','malicioso','erro')),
  confianca      numeric,
  motivo         text,
  acao           text,
  aplicado       text,
  tokens_entrada int,
  tokens_saida   int,
  erro           text
);
create index if not exists analises_ip_idx     on sentinela.analises (ip, criado_em desc);
create index if not exists analises_criado_idx on sentinela.analises (criado_em desc);

create table if not exists sentinela.tor_saidas (
  ip            inet primary key,
  atualizado_em timestamptz not null default now()
);

create table if not exists sentinela.passes_usados (
  jti      text primary key,
  usado_em timestamptz not null default now(),
  projeto  text,
  email    text
);
create index if not exists passes_usados_em_idx on sentinela.passes_usados (usado_em);

create table if not exists sentinela.chaves (
  kid        text primary key,
  alg        text not null default 'ES256',
  publica    jsonb not null,
  segredo_id uuid not null,                           -- vault.secrets.id (a parte privada mora só no Vault)
  criada_em  timestamptz not null default now(),
  ativa      boolean not null default true
);

create table if not exists sentinela.exposicoes (
  id            bigint generated always as identity primary key,
  sistema       text,
  severidade    text check (severidade in ('critica','alta','media','baixa')),
  titulo        text,
  evidencia     text,
  recomendacao  text,
  status        text not null default 'aberta' check (status in ('aberta','aceita','corrigida')),
  decisao       text,
  verificado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table if not exists sentinela.acoes_admin (
  id        bigint generated always as identity primary key,
  criado_em timestamptz not null default now(),
  email     text,
  acao      text,
  dados     jsonb
);
create index if not exists acoes_admin_criado_idx on sentinela.acoes_admin (criado_em desc);

-- interno: KPIs da janela guardados por 10 s (o painel pede "novos" a cada 4 s por aba)
create table if not exists sentinela.cache_kpis (
  ini   timestamptz primary key,
  dados jsonb not null,
  em    timestamptz not null default now()
);

-- RLS ligado e sem políticas: ninguém lê pela API; só as funções (security definer) mexem.
alter table sentinela.config           enable row level security;
alter table sentinela.sistemas         enable row level security;
alter table sentinela.eventos          enable row level security;
alter table sentinela.cadeia           enable row level security;
alter table sentinela.bloqueios        enable row level security;
alter table sentinela.confiaveis       enable row level security;
alter table sentinela.ips              enable row level security;
alter table sentinela.identidades      enable row level security;
alter table sentinela.tentativas_login enable row level security;
alter table sentinela.analises         enable row level security;
alter table sentinela.tor_saidas       enable row level security;
alter table sentinela.passes_usados    enable row level security;
alter table sentinela.chaves           enable row level security;
alter table sentinela.exposicoes       enable row level security;
alter table sentinela.acoes_admin      enable row level security;
alter table sentinela.cache_kpis       enable row level security;

-- ---------------------------------------------------------
-- 2. AJUDANTES (schema sentinela, fora da API)
-- ---------------------------------------------------------

-- ISO 8601 em UTC com milissegundos: formato único de data em todo JSON da Sentinela
create or replace function sentinela.iso(p timestamptz)
returns text language sql stable
set search_path = sentinela, public, extensions, pg_temp
as $$
  select to_char(p at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;

-- texto aparado e cortado; vazio vira null
create or replace function sentinela.txt(p text, n int)
returns text language sql immutable
set search_path = sentinela, public, extensions, pg_temp
as $$
  select left(nullif(btrim(p), ''), n)
$$;

-- IP de host (IPv4 /32 ou IPv6 /128); inválido → null. ::ffff:a.b.c.d vira IPv4.
create or replace function sentinela.ip_ou_nulo(p text)
returns inet language plpgsql immutable
set search_path = sentinela, public, extensions, pg_temp
as $$
declare
  v_txt text := btrim(p);
  v inet;
begin
  if v_txt is null or length(v_txt) > 64 or v_txt !~ '^[0-9A-Fa-f:.]+$' then
    return null;
  end if;
  v := v_txt::inet;
  if family(v) = 6 and host(v) ~* '^::ffff:[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' then
    v := substr(host(v), 8)::inet;
  end if;
  if masklen(v) <> (case when family(v) = 4 then 32 else 128 end) then
    return null;
  end if;
  return v;
exception when others then
  return null;
end $$;

-- IP ou rede digitados pelo admin; inválido → erro 22023 com mensagem para a tela
create or replace function sentinela.rede_valida(p text)
returns cidr language plpgsql immutable
set search_path = sentinela, public, extensions, pg_temp
as $$
declare
  v_txt text := btrim(coalesce(p, ''));
  v inet;
begin
  if v_txt = '' or length(v_txt) > 64 then
    raise exception 'sentinela: informe um IP ou uma rede CIDR' using errcode = '22023';
  end if;
  begin
    v := v_txt::inet;
  exception when others then
    raise exception 'sentinela: "%" não é um IP nem uma rede válida', v_txt using errcode = '22023';
  end;
  if family(v) = 6 and masklen(v) = 128 and host(v) ~* '^::ffff:[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' then
    v := substr(host(v), 8)::inet;
  end if;
  if host(v) <> host(network(v)) then
    raise exception 'sentinela: "%" tem bits de host ligados; use %', v_txt, network(v)::text using errcode = '22023';
  end if;
  if (family(v) = 4 and masklen(v) < 16) or (family(v) = 6 and masklen(v) < 32) then
    raise exception 'sentinela: rede ampla demais (mínimo /16 em IPv4 e /32 em IPv6)' using errcode = '22023';
  end if;
  return network(v);
end $$;

create or replace function sentinela.num_ou_nulo(p text)
returns numeric language plpgsql immutable
set search_path = sentinela, public, extensions, pg_temp
as $$
begin
  if p is null or length(p) > 40 or p !~ '^\s*-?[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]{1,3})?\s*$' then
    return null;
  end if;
  return p::numeric;
exception when others then
  return null;
end $$;

create or replace function sentinela.int_ou_nulo(p text)
returns int language sql immutable
set search_path = sentinela, public, extensions, pg_temp
as $$
  select case when p ~ '^\s*-?[0-9]{1,9}\s*$' then btrim(p)::int end
$$;

create or replace function sentinela.big_ou_nulo(p text)
returns bigint language sql immutable
set search_path = sentinela, public, extensions, pg_temp
as $$
  select case when p ~ '^\s*[0-9]{1,18}\s*$' then btrim(p)::bigint end
$$;

-- coordenada dentro de ±limite, senão null
create or replace function sentinela.coord(p text, p_lim numeric)
returns double precision language sql immutable
set search_path = sentinela, public, extensions, pg_temp
as $$
  select case when v between -p_lim and p_lim then v::double precision end
    from (select sentinela.num_ou_nulo(p) as v) x
$$;

create or replace function sentinela.ts_ou_nulo(p text)
returns timestamptz language plpgsql stable
set search_path = sentinela, public, extensions, pg_temp
as $$
declare
  v timestamptz;
begin
  if p is null or length(p) > 40 or p !~ '^\s*[0-9]{4}-[0-9]{2}-[0-9]{2}' then
    return null;
  end if;
  v := p::timestamptz;
  return case when isfinite(v) then v end;
exception when others then
  return null;
end $$;

-- arquivos_proibidos são aplicados pelo guarda como RegExp do JavaScript (flag i), mas aqui só dá
-- para compilar com o motor do PostgreSQL. Aceita só o que existe IGUAL nos dois e recusa
-- quantificador aninhado (risco de lentidão a cada requisição). null = aceito; senão o motivo.
create or replace function sentinela.regex_problema(p text)
returns text language plpgsql immutable
set search_path = sentinela, public, extensions, pg_temp
as $$
declare
  s text;
  s2 text;
  i int := 0;
begin
  -- regexp_matches com 'g' consome os pares da esquerda para a direita (\\ conta como um par)
  if exists (select 1 from regexp_matches(p, '\\(.)', 'g') as m(x)
              where m.x[1] ~ '^[A-Za-z0]$' and m.x[1] !~ '^[dDwWsSbBnrtfv]$') then
    return 'escape que não existe igual no JavaScript (use só \d \D \w \W \s \S \b \B \n \r \t \f \v, \1 a \9 ou \ antes de símbolo)';
  end if;
  s := regexp_replace(p, '\\.', 'E', 'g');            -- tira os escapes da análise
  if s ~ '^\*\*\*' then
    return 'prefixo *** só existe no PostgreSQL';
  end if;
  if s ~ '\[[:.=]' then
    return 'classe POSIX ([[:digit:]] etc.) não existe no JavaScript';
  end if;
  if s ~ '\[\^?\]' then
    return 'classe começando com ] tem outro sentido no JavaScript; escape o ]';
  end if;
  if s ~ '\{,' then
    return 'repetição {,n} não existe no JavaScript; use {0,n}';
  end if;
  s := regexp_replace(s, '\[[^\]]*\]', 'C', 'g');       -- classes viram um caractere
  if s ~ '\(\?(?![:=!]|<[=!]|<[A-Za-z_][A-Za-z0-9_]*>)' then
    return 'grupo (?...) não aceito; use (?:  (?=  (?!  (?<=  (?<!  ou (?<nome>';
  end if;
  s := regexp_replace(s, '\(\?(:|=|!|<=|<!|<[A-Za-z_][A-Za-z0-9_]*>)', '(', 'g');
  -- de dentro para fora: grupo com quantificador dentro (Q) não pode ser repetido
  loop
    i := i + 1;
    if s ~ '\([^()]*[+*?{Q][^()]*\)[+*{]' or s ~ 'Q[+*{]' then
      return 'quantificador aninhado, como (a+)+ (pode travar o guarda)';
    end if;
    s2 := regexp_replace(regexp_replace(s, '\([^()]*[+*?{Q][^()]*\)', 'Q', 'g'), '\([^()+*?{Q]*\)', 'x', 'g');
    exit when s2 = s or i > 30;
    s := s2;
  end loop;
  return null;
end $$;

-- lista de textos vinda do painel (rotas públicas, arquivos proibidos)
create or replace function sentinela.lista_textos(p jsonb, p_nome text, p_max_itens int, p_max_len int, p_regex boolean)
returns text[] language plpgsql immutable
set search_path = sentinela, public, extensions, pg_temp
as $$
declare
  x jsonb;
  t text;
  r text[] := '{}';
begin
  if p is null or jsonb_typeof(p) <> 'array' then
    raise exception 'sentinela: % deve ser uma lista de textos', p_nome using errcode = '22023';
  end if;
  if jsonb_array_length(p) > p_max_itens then
    raise exception 'sentinela: % aceita no máximo % itens', p_nome, p_max_itens using errcode = '22023';
  end if;
  for x in select value from jsonb_array_elements(p) loop
    if jsonb_typeof(x) <> 'string' then
      raise exception 'sentinela: cada item de % deve ser texto', p_nome using errcode = '22023';
    end if;
    t := btrim(x #>> '{}');
    continue when t = '';
    if length(t) > p_max_len or t ~ '[[:cntrl:]]' then
      raise exception 'sentinela: item inválido em % (máximo % caracteres, sem quebras de linha)', p_nome, p_max_len using errcode = '22023';
    end if;
    if p_regex then
      if sentinela.regex_problema(t) is not null then
        raise exception 'sentinela: expressão não aceita em %: % (%)', p_nome, t, sentinela.regex_problema(t)
          using errcode = '22023';
      end if;
      begin
        -- grupo nomeado (?<x>...) é do JavaScript; para compilar aqui vira (?:...)
        perform '' ~ regexp_replace(t, '\(\?<([A-Za-z_][A-Za-z0-9_]*)>', '(?:', 'g');
      exception when invalid_regular_expression then
        raise exception 'sentinela: expressão inválida em %: %', p_nome, t using errcode = '22023';
      end;
    end if;
    if not (t = any(r)) then
      r := r || t;
    end if;
  end loop;
  return r;
end $$;

-- risco base por regra (seção 1)
create or replace function sentinela.risco_base(p_regra text)
returns int language sql immutable
set search_path = sentinela, public, extensions, pg_temp
as $$
  select case p_regra
    when 'ferramenta'       then 95
    when 'injecao'          then 95
    when 'varredura'        then 90
    when 'lista'            then 80
    when 'rajada'           then 70
    when 'forca_bruta'      then 70
    when 'arquivo_proibido' then 60
    when 'tor'              then 60
    when 'robo'             then 50
    when 'sem_login'        then 30
    when 'buscador'         then 10
    else 0
  end
$$;

create or replace function sentinela.eh_confiavel(p_ip inet)
returns boolean language sql stable
set search_path = sentinela, public, extensions, pg_temp
as $$
  select exists (
    select 1 from sentinela.confiaveis c
     where c.removido_em is null
       and (c.expira_em is null or c.expira_em > now())
       and c.rede >>= p_ip
  )
$$;

-- Rede que as regras automáticas contam e bloqueiam: IPv4 = o próprio IP; IPv6 = o /64
-- (em IPv6 cada casa/celular/escritório recebe um /64 e troca de endereço dentro dele)
create or replace function sentinela.rede_auto(p_ip inet)
returns cidr language sql immutable
set search_path = sentinela, public, extensions, pg_temp
as $$
  select network(set_masklen(p_ip, case when family(p_ip) = 6 then 64 else 32 end))
$$;

-- Alvo de um bloqueio automático: a rede_auto, ou só o IP se o /64 encostar numa rede confiável
create or replace function sentinela.alvo_auto(p_ip inet, out tipo text, out valor text, out rede cidr)
language plpgsql stable
set search_path = sentinela, public, extensions, pg_temp
as $$
declare
  v_rede cidr := sentinela.rede_auto(p_ip);
begin
  if family(p_ip) = 6 and exists (
       select 1 from sentinela.confiaveis c
        where c.removido_em is null and (c.expira_em is null or c.expira_em > now()) and c.rede && v_rede) then
    v_rede := network(set_masklen(p_ip, 128));
  end if;
  rede := v_rede;
  if masklen(v_rede) = (case when family(v_rede) = 4 then 32 else 128 end) then
    tipo := 'ip';
    valor := host(v_rede);
  else
    tipo := 'cidr';
    valor := v_rede::text;
  end if;
end $$;

-- Primeira linha de toda srv_*: só a Central (service_role) ou o dono do banco.
-- Vale mesmo se os grants da seção 6 não rodarem (default ACL do Supabase dá EXECUTE a anon).
create or replace function sentinela.so_central()
returns void language plpgsql stable
set search_path = sentinela, public, extensions, pg_temp
as $$
begin
  if current_setting('role', true) in ('anon', 'authenticated')
     or coalesce(auth.role(), '') in ('anon', 'authenticated') then
    raise exception 'sentinela: função restrita à Central' using errcode = '42501';
  end if;
end $$;

-- Acessos estimados nos últimos 60 s a partir de duas janelas fixas seguidas
-- (a anterior entra proporcional ao pedaço dela que ainda cai nos últimos 60 s)
create or replace function sentinela.janela_estimada(p_inicio timestamptz, p_total int, p_anterior int)
returns numeric language sql stable
set search_path = sentinela, public, extensions, pg_temp
as $$
  select case
    when p_inicio is null then 0
    when now() - p_inicio < interval '60 seconds'
      then p_total + coalesce(p_anterior, 0) * (60 - extract(epoch from now() - p_inicio)) / 60
    when now() - p_inicio < interval '120 seconds'
      then p_total * (120 - extract(epoch from now() - p_inicio)) / 60
    else 0
  end
$$;

-- Início da janela do painel: alinhado à hora, para os KPIs somarem igual ao gráfico por hora
create or replace function sentinela.janela_ini(p_horas int)
returns timestamptz language sql stable
set search_path = sentinela, public, extensions, pg_temp
as $$
  select date_trunc('hour', now(), 'UTC') - make_interval(hours => greatest(coalesce(p_horas, 24), 1) - 1)
$$;

-- bloqueio ativo mais forte que cobre o IP (certo antes de suspeito, mais específico, mais novo)
create or replace function sentinela.bloqueio_do_ip(p_ip inet, p_ja4 text default null)
returns sentinela.bloqueios language sql stable
set search_path = sentinela, public, extensions, pg_temp
as $$
  select b.*
    from sentinela.bloqueios b
   where b.revogado_em is null
     and (b.expira_em is null or b.expira_em > now())
     and ((b.tipo in ('ip','cidr') and b.rede >>= p_ip) or (b.tipo = 'ja4' and p_ja4 is not null and b.valor = p_ja4))
   order by (b.nivel = 'certo') desc, masklen(b.rede) desc nulls last, b.criado_em desc
   limit 1
$$;

-- Cria bloqueio ou, se já há um ativo para o mesmo valor, MESMO nível e MESMA origem,
-- estende expira_em (máximo dos dois; null = permanente) e soma 1 em hits.
-- Nível ou origem diferentes viram outra linha: um pedido suspeito nunca alonga um certo
-- (no modo observar ele não pode ser aplicado), e o manual do admin nunca se mistura com
-- um automático (que o "confiar" revoga).
create or replace function sentinela.bloquear(
  p_tipo text, p_valor text, p_rede cidr, p_nivel text, p_origem text, p_regra text, p_motivo text,
  p_expira timestamptz, p_criado_por text default null, p_evento_id bigint default null, p_analise_id bigint default null,
  out bloqueio_id bigint, out novo boolean, out ate timestamptz)
language plpgsql
set search_path = sentinela, public, extensions, pg_temp
as $$
declare
  v_id bigint;
begin
  -- serializa por valor: duas chamadas ao mesmo tempo não criam o mesmo bloqueio duas vezes
  perform pg_advisory_xact_lock(hashtextextended('sentinela.bloqueio|' || p_tipo || '|' || p_valor, 0));

  select b.id into v_id
    from sentinela.bloqueios b
   where b.tipo = p_tipo and b.valor = p_valor and b.nivel = p_nivel and b.origem = p_origem
     and b.revogado_em is null and (b.expira_em is null or b.expira_em > now())
   order by b.expira_em desc nulls first
   limit 1
   for update;

  if v_id is not null then
    update sentinela.bloqueios b
       set expira_em  = case when b.expira_em is null or p_expira is null then null
                             else greatest(b.expira_em, p_expira) end,
           hits       = b.hits + 1,
           ultimo_hit = now(),
           -- manual: vale o que o admin escreveu por último
           motivo     = case when p_origem = 'manual' and nullif(btrim(p_motivo), '') is not null
                             then left(btrim(p_motivo), 200) else b.motivo end,
           criado_por = case when p_origem = 'manual' then coalesce(p_criado_por, b.criado_por) else b.criado_por end
     where b.id = v_id
     returning b.id, b.expira_em into bloqueio_id, ate;
    novo := false;
    return;
  end if;

  insert into sentinela.bloqueios as b
         (tipo, valor, rede, nivel, origem, regra, motivo, expira_em, criado_por, evento_id, analise_id)
  values (p_tipo, p_valor, p_rede, p_nivel, p_origem, p_regra,
          left(coalesce(nullif(btrim(p_motivo), ''), coalesce(p_regra, 'bloqueio')), 200),
          p_expira, p_criado_por, p_evento_id, p_analise_id)
  returning b.id, b.expira_em into bloqueio_id, ate;
  novo := true;
end $$;

-- Selo de um evento. O <canon> é exatamente o da especificação; o gatilho e a verificação usam esta função.
create or replace function sentinela.selo(e sentinela.eventos)
returns text language sql stable
set search_path = sentinela, public, extensions, pg_temp
as $$
  select encode(extensions.digest(
    coalesce(e.selo_anterior, '') || '|' ||
    concat_ws('|', e.id, to_char(e.criado_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), e.projeto,
              host(e.ip), coalesce(e.metodo, ''), coalesce(e.caminho, ''), e.decisao, coalesce(e.regra, ''),
              coalesce(e.identidade, ''), coalesce(e.ua, '')),
    'sha256'), 'hex')
$$;

-- JSON padronizados (feed, listas, gaveta)
create or replace function sentinela.ev_json(e sentinela.eventos, p_sistema_nome text, p_geo boolean default false)
returns jsonb language sql stable
set search_path = sentinela, public, extensions, pg_temp
as $$
  select jsonb_build_object(
           'id', e.id, 'criado_em', sentinela.iso(e.criado_em), 'projeto', e.projeto, 'sistema_nome', p_sistema_nome,
           'metodo', e.metodo, 'caminho', e.caminho, 'ip', host(e.ip), 'pais', e.pais, 'cidade', e.cidade,
           'decisao', e.decisao, 'regra', e.regra, 'motivo', e.motivo, 'risco', e.risco, 'identidade', e.identidade)
         || case when p_geo then jsonb_build_object('lat', e.lat, 'lon', e.lon) else '{}'::jsonb end
$$;

create or replace function sentinela.bloqueio_json(b sentinela.bloqueios)
returns jsonb language sql stable
set search_path = sentinela, public, extensions, pg_temp
as $$
  select jsonb_build_object(
    'id', b.id, 'tipo', b.tipo, 'valor', b.valor, 'nivel', b.nivel, 'origem', b.origem, 'regra', b.regra,
    'motivo', b.motivo, 'criado_em', sentinela.iso(b.criado_em), 'expira_em', sentinela.iso(b.expira_em),
    'revogado_em', sentinela.iso(b.revogado_em), 'revogado_por', b.revogado_por, 'criado_por', b.criado_por,
    'hits', b.hits, 'ultimo_hit', sentinela.iso(b.ultimo_hit), 'evento_id', b.evento_id, 'analise_id', b.analise_id,
    'ativo', (b.revogado_em is null and (b.expira_em is null or b.expira_em > now())))
$$;

create or replace function sentinela.confiavel_json(c sentinela.confiaveis)
returns jsonb language sql stable
set search_path = sentinela, public, extensions, pg_temp
as $$
  select jsonb_build_object(
    'id', c.id, 'tipo', c.tipo, 'valor', c.valor, 'descricao', c.descricao, 'origem', c.origem,
    'identidade', c.identidade, 'criado_em', sentinela.iso(c.criado_em), 'expira_em', sentinela.iso(c.expira_em),
    'criado_por', c.criado_por,
    'ativo', (c.removido_em is null and (c.expira_em is null or c.expira_em > now())))
$$;

create or replace function sentinela.analise_json(a sentinela.analises)
returns jsonb language sql stable
set search_path = sentinela, public, extensions, pg_temp
as $$
  select jsonb_build_object(
    'id', a.id, 'ip', host(a.ip), 'criado_em', sentinela.iso(a.criado_em), 'modelo', a.modelo,
    'veredito', a.veredito, 'confianca', a.confianca, 'motivo', a.motivo, 'acao', a.acao, 'aplicado', a.aplicado,
    'tokens_entrada', a.tokens_entrada, 'tokens_saida', a.tokens_saida, 'erro', a.erro)
$$;

-- KPIs de uma janela (mesmo formato no painel e no "novos"); uma leitura só dos eventos
create or replace function sentinela.kpis(p_ini timestamptz)
returns jsonb language sql stable
set search_path = sentinela, public, extensions, pg_temp
as $$
  with w as materialized (
    select e.ip, e.pais, e.decisao from sentinela.eventos e where e.criado_em >= p_ini
  ),
  t as (
    select count(*) as acessos,
           count(*) filter (where w.decisao = 'bloqueado') as bloqueados,
           count(*) filter (where w.decisao = 'observado') as observados,
           count(distinct w.pais) as paises
      from w
  ),
  p as (
    select count(*) as ips, count(*) filter (where i.identidade is not null) as identificados
      from (select distinct w.ip from w) d
      left join sentinela.ips i on i.ip = d.ip
  )
  select jsonb_build_object(
    'acessos', t.acessos, 'bloqueados', t.bloqueados, 'observados', t.observados,
    'ips', p.ips, 'paises', t.paises,
    'analises', (select count(*) from sentinela.analises a where a.criado_em >= p_ini and a.veredito <> 'erro'),
    'identificados', p.identificados)
  from t, p
$$;

-- Os mesmos KPIs guardados por 10 s (painel e "novos" leem daqui: os números não pulam
-- para trás entre um e outro, e várias abas abertas não recalculam a cada 4 s)
create or replace function sentinela.kpis_cacheados(p_ini timestamptz)
returns jsonb language plpgsql volatile
set search_path = sentinela, public, extensions, pg_temp
as $$
declare
  v jsonb;
begin
  select k.dados into v from sentinela.cache_kpis k where k.ini = p_ini and k.em > now() - interval '10 seconds';
  if v is not null then
    return v;
  end if;
  v := sentinela.kpis(p_ini);
  if current_setting('transaction_read_only') <> 'on' then
    insert into sentinela.cache_kpis as k (ini, dados, em) values (p_ini, v, now())
    on conflict (ini) do update set dados = excluded.dados, em = excluded.em;
    delete from sentinela.cache_kpis k where k.ini < p_ini - interval '8 days';
  end if;
  return v;
end $$;

-- Contexto de um IP (Central → IA, e base da gaveta do painel)
create or replace function sentinela.contexto(p_ip inet)
returns jsonb language sql stable
set search_path = sentinela, public, extensions, pg_temp
as $$
  select jsonb_build_object(
    'ip', host(p_ip),
    'perfil', (select jsonb_build_object(
                 'ip', host(i.ip), 'primeiro_visto', sentinela.iso(i.primeiro_visto), 'ultimo_visto', sentinela.iso(i.ultimo_visto),
                 'total', i.total, 'descartados', i.descartados, 'pais', i.pais, 'regiao', i.regiao, 'cidade', i.cidade,
                 'lat', i.lat, 'lon', i.lon, 'ua_ultimo', i.ua_ultimo, 'projetos', to_jsonb(i.projetos),
                 'risco_max', i.risco_max, 'identidade', i.identidade, 'identidade_em', sentinela.iso(i.identidade_em),
                 'ultima_analise_em', sentinela.iso(i.ultima_analise_em), 'ultimo_veredito', i.ultimo_veredito)
                 from sentinela.ips i where i.ip = p_ip),
    'confiavel', sentinela.eh_confiavel(p_ip),
    'tor', exists (select 1 from sentinela.tor_saidas t where t.ip = p_ip),
    'bloqueios', coalesce((
        select jsonb_agg(sentinela.bloqueio_json(b) order by b.criado_em desc, b.id desc)
          from sentinela.bloqueios b
         where b.id in (select b2.id from sentinela.bloqueios b2 where b2.rede >>= p_ip
                         order by b2.criado_em desc, b2.id desc limit 10)), '[]'::jsonb),
    'identidades', coalesce((
        select jsonb_agg(jsonb_build_object('email', d.email, 'origem', d.origem, 'criado_em', sentinela.iso(d.criado_em))
                         order by d.criado_em desc, d.id desc)
          from (select * from sentinela.identidades d2 where d2.ip = p_ip
                 order by d2.criado_em desc, d2.id desc limit 10) d), '[]'::jsonb),
    'tentativas_10min', (select count(*) from sentinela.tentativas_login t
                          where t.ip = p_ip and t.criado_em > now() - interval '10 minutes'),
    'eventos', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', e.id, 'criado_em', sentinela.iso(e.criado_em), 'projeto', e.projeto, 'metodo', e.metodo,
                 'caminho', e.caminho, 'consulta', e.consulta, 'tipo', e.tipo, 'pais', e.pais, 'cidade', e.cidade,
                 'ua', e.ua, 'idioma', e.idioma, 'sec_fetch_mode', e.sec_fetch_mode, 'decisao', e.decisao,
                 'regra', e.regra, 'risco', e.risco, 'identidade', e.identidade) order by e.id desc)
          from (select * from sentinela.eventos e2 where e2.ip = p_ip order by e2.criado_em desc, e2.id desc limit 40) e),
        '[]'::jsonb)
  )
$$;

create or replace function sentinela.chave_ativa()
returns jsonb language sql stable
set search_path = sentinela, public, extensions, pg_temp
as $$
  select jsonb_build_object('kid', k.kid, 'publica', k.publica, 'privada', s.decrypted_secret)
    from sentinela.chaves k
    join vault.decrypted_secrets s on s.id = k.segredo_id
   where k.ativa
   order by k.criada_em desc
   limit 1
$$;

-- ---------------------------------------------------------
-- 3. GATILHOS DE EVENTOS (cadeia de selos e só-inserção)
-- ---------------------------------------------------------
create or replace function sentinela.tg_eventos_selar()
returns trigger language plpgsql
set search_path = sentinela, public, extensions, pg_temp
as $$
declare
  k sentinela.cadeia;
begin
  -- trava a linha da cadeia: um selo por vez, sempre em cima do último
  select * into k from sentinela.cadeia c where c.id for update;
  if not found then
    raise exception 'sentinela: cadeia sem a linha inicial';
  end if;
  -- id reservado antes da trava pode ter ficado para trás de outro lote: pega um novo,
  -- para que a ordem de id seja a ordem da cadeia
  if NEW.id <= coalesce(k.ultimo_id, 0) then
    NEW.id := nextval(pg_get_serial_sequence('sentinela.eventos', 'id'));
  end if;
  NEW.criado_em := now();
  NEW.selo_anterior := k.ultimo_selo;
  NEW.selo := sentinela.selo(NEW);
  update sentinela.cadeia c
     set ultimo_id = NEW.id, ultimo_selo = NEW.selo, atualizado_em = now()
   where c.id;
  return NEW;
end $$;

create or replace function sentinela.tg_eventos_imutavel()
returns trigger language plpgsql
set search_path = sentinela, public, extensions, pg_temp
as $$
begin
  -- só a manutenção (sentinela_srv_manutencao) liga esta chave, e só dentro da própria transação
  if TG_OP = 'DELETE' and current_setting('sentinela.limpeza', true) = 'on' then
    return OLD;
  end if;
  raise exception 'sentinela: eventos são só-inserção (% barrado)', TG_OP using errcode = '42501';
end $$;

drop trigger if exists eventos_selar on sentinela.eventos;
create trigger eventos_selar
  before insert on sentinela.eventos
  for each row execute function sentinela.tg_eventos_selar();

drop trigger if exists eventos_sem_update on sentinela.eventos;
create trigger eventos_sem_update
  before update on sentinela.eventos
  for each row execute function sentinela.tg_eventos_imutavel();

drop trigger if exists eventos_sem_delete on sentinela.eventos;
create trigger eventos_sem_delete
  before delete on sentinela.eventos
  for each row execute function sentinela.tg_eventos_imutavel();

drop trigger if exists eventos_sem_truncate on sentinela.eventos;
create trigger eventos_sem_truncate
  before truncate on sentinela.eventos
  for each statement execute function sentinela.tg_eventos_imutavel();

-- ---------------------------------------------------------
-- 4. FUNÇÕES DO SERVIDOR (só service_role — chamadas pela Central)
-- ---------------------------------------------------------
create or replace function public.sentinela_srv_lista(p_projeto text)
returns jsonb
language plpgsql
stable
security definer
set search_path = sentinela, public, extensions, pg_temp
as $$
declare
  v_cfg sentinela.config;
  v_sis jsonb;
begin
  perform sentinela.so_central();
  select * into v_cfg from sentinela.config c where c.id;

  -- projeto_id: extra (fora do §2) para a Central conferir o project_id do OIDC contra
  -- sentinela.sistemas (§3.2), em vez de um mapa fixo no código dela
  select jsonb_build_object(
           'projeto', s.projeto, 'projeto_id', s.projeto_id, 'nome', s.nome, 'sistema_slug', s.sistema_slug,
           'exige_login', s.exige_login,
           'rotas_publicas', to_jsonb(s.rotas_publicas), 'arquivos_proibidos', to_jsonb(s.arquivos_proibidos))
    into v_sis
    from sentinela.sistemas s
   where s.projeto = p_projeto;

  return jsonb_build_object(
    'v', 1,
    'gerado_em', sentinela.iso(now()),
    'ttl', 20,
    'modo', v_cfg.modo,
    -- no corte dos 5000 entram primeiro os manuais, depois os certos, os permanentes e os
    -- mais novos: uma enxurrada de IPs descartáveis não empurra o bloqueio do admin para fora.
    -- A lista sai em ordem de mais novo.
    'bloqueios', coalesce((
        select jsonb_agg(jsonb_build_object('id', b.id, 't', b.tipo, 'v', b.valor, 'n', b.nivel, 'ate', sentinela.iso(b.expira_em))
                         order by b.criado_em desc, b.id desc)
          from (select * from sentinela.bloqueios b2
                 where b2.revogado_em is null and (b2.expira_em is null or b2.expira_em > now())
                 order by (b2.origem = 'manual') desc, (b2.nivel = 'certo') desc, (b2.expira_em is null) desc,
                          b2.criado_em desc, b2.id desc
                 limit 5000) b), '[]'::jsonb),
    'confiaveis', coalesce((
        select jsonb_agg(jsonb_build_object('t', c.tipo, 'v', c.valor) order by c.id)
          from sentinela.confiaveis c
         where c.removido_em is null and (c.expira_em is null or c.expira_em > now())), '[]'::jsonb),
    'sistema', v_sis,
    'portal', 'https://painel-lube-distribuidora.vercel.app',
    -- extra (fora do contrato): a Central sabe quando renovar a lista Tor sem outra consulta
    'tor_atualizado_em', sentinela.iso(v_cfg.tor_atualizado_em)
  );
end $$;

create or replace function public.sentinela_srv_registrar(
  p_projeto text, p_ambiente text, p_guarda text, p_runtime text, p_eventos jsonb)
returns jsonb
language plpgsql
security definer
set search_path = sentinela, public, extensions, pg_temp
as $$
declare
  v_cfg sentinela.config;
  v_proj text := sentinela.txt(p_projeto, 100);
  v_amb  text := coalesce(sentinela.txt(p_ambiente, 30), 'production');
  e jsonb;
  v_ip inet;
  v_ipt text;
  v_rede cidr;
  v_gravar boolean;
  v_primeira boolean;
  v_confiavel boolean;
  v_tor boolean;
  v_recentes int;
  v_risco int;
  v_id bigint;
  v_tipo text;
  v_decisao text;
  v_regra text;
  v_motivo text;
  v_metodo text;
  v_caminho text;
  v_ua text;
  v_ident text;
  v_ident_origem text;
  v_pais text;
  v_regiao text;
  v_cidade text;
  v_lat double precision;
  v_lon double precision;
  v_sec_site text;
  v_sec_mode text;
  v_idioma text;
  v_ja4 text;
  v_forjada boolean;
  v_gravados int := 0;
  v_descartados int := 0;
  v_ips inet[] := '{}';
  v_primeiras inet[] := '{}';
  v_robo inet[] := '{}';
  v_ids bigint[] := '{}';
  v_certos jsonb := '[]';
  v_novos jsonb := '[]';
  v_analisar jsonb := '[]';
  v_analisar_ips inet[] := '{}';
  v_cota int;
  v_qtd int;
  v_est numeric;
  v_dur interval;
  al record;
  r record;
  b record;
begin
  perform sentinela.so_central();
  if v_proj is null or not exists (select 1 from sentinela.sistemas s where s.projeto = v_proj) then
    raise exception 'sentinela: projeto desconhecido' using errcode = '22023';
  end if;
  if p_eventos is null or jsonb_typeof(p_eventos) <> 'array' then
    raise exception 'sentinela: p_eventos deve ser uma lista' using errcode = '22023';
  end if;

  -- um lote por vez: a cadeia de selos precisa de ordem, e assim lotes não se travam entre si
  perform 1 from sentinela.cadeia k where k.id for update;
  select * into v_cfg from sentinela.config c where c.id;

  for e in
    select x.v from jsonb_array_elements(p_eventos) with ordinality as x(v, n)
     where x.n <= 100
     order by x.n
  loop
    v_ip := null;
    v_decisao := null;
    if jsonb_typeof(e) = 'object' then
      v_ip := sentinela.ip_ou_nulo(e->>'ip');
      v_decisao := e->>'decisao';
    end if;
    if v_ip is null or v_decisao is null or v_decisao not in ('liberado','observado','bloqueado') then
      v_descartados := v_descartados + 1;
      continue;
    end if;

    v_ipt := host(v_ip);
    v_rede := sentinela.rede_auto(v_ip);
    v_tipo := e->>'tipo';
    if v_tipo is null or v_tipo not in ('pagina','api','arquivo','outro') then
      v_tipo := 'outro';
    end if;
    v_regra := e->>'regra';
    if v_regra is not null and v_regra !~ '^[a-z_]{1,40}$' then
      v_regra := null;
    end if;
    v_motivo  := sentinela.txt(e->>'motivo', 200);
    v_metodo  := upper(sentinela.txt(e->>'metodo', 10));
    if v_metodo is not null and v_metodo !~ '^[A-Z]+$' then
      v_metodo := null;
    end if;
    -- "|" separa os campos do selo: no caminho vira %7C (mesmo endereço); identidade com "|" não é e-mail
    v_caminho := left(replace(sentinela.txt(e->>'caminho', 300), '|', '%7C'), 300);
    v_ua      := sentinela.txt(e->>'ua', 300);
    v_ident   := lower(sentinela.txt(e->>'identidade', 200));
    if strpos(v_ident, '|') > 0 then
      v_ident := null;
    end if;
    v_ident_origem := case when v_ident is not null and e->>'identidade_origem' in ('passe','sessao_app','provavel')
                           then e->>'identidade_origem' end;
    v_pais := upper(sentinela.txt(e->>'pais', 8));
    if v_pais is not null and v_pais !~ '^[A-Z]{2}$' then
      v_pais := null;
    end if;
    v_regiao := sentinela.txt(e->>'regiao', 80);
    v_cidade := sentinela.txt(e->>'cidade', 80);
    v_lat := sentinela.coord(e->>'lat', 90);
    v_lon := sentinela.coord(e->>'lon', 180);
    if v_lat is null or v_lon is null then
      v_lat := null;
      v_lon := null;
    end if;
    v_sec_site := sentinela.txt(e->>'sec_fetch_site', 40);
    v_sec_mode := sentinela.txt(e->>'sec_fetch_mode', 40);
    v_idioma   := sentinela.txt(e->>'idioma', 60);
    v_ja4      := sentinela.txt(e->>'ja4', 100);
    -- varredura/injeção com sec-fetch-site cross-site: possível requisição forjada por outro site
    -- (um <img> ou link de terceiro faz o navegador do funcionário pedir /.env). O evento é gravado
    -- com o motivo marcado, mas NÃO vira bloqueio de IP (abaixo). 'ferramenta' (user-agent) continua.
    v_forjada := coalesce(v_regra in ('varredura','injecao') and lower(coalesce(v_sec_site, '')) = 'cross-site', false);

    if not (v_ip = any(v_ips)) then
      v_ips := v_ips || v_ip;
    end if;
    -- primeira vez = rede nunca vista (IPv6: o /64 todo, senão cada endereço novo contaria)
    v_primeira := not exists (select 1 from sentinela.ips i where i.ip <<= v_rede);
    if v_primeira then
      v_primeiras := v_primeiras || v_ip;
    end if;

    -- teto de gravação por IP (IPv6: por /64) por minuto
    select count(*) into v_recentes
      from sentinela.eventos ev
     where ev.ip <<= v_rede and ev.criado_em > now() - interval '60 seconds';
    v_gravar := v_recentes < v_cfg.limite_eventos_ip_min;
    v_risco := 0;
    v_id := null;

    if v_gravar then
      v_confiavel := sentinela.eh_confiavel(v_ip);
      v_tor := exists (select 1 from sentinela.tor_saidas t where t.ip = v_ip);
      v_risco := greatest(sentinela.risco_base(v_regra), case when v_tor then 60 else 0 end)
               + case when v_tipo = 'pagina' and v_sec_mode is null then 15 else 0 end
               + case when v_idioma is null then 10 else 0 end
               + case when v_primeira and v_pais is not null and v_pais <> 'BR' then 10 else 0 end
               - case when v_ident_origem in ('passe','sessao_app') then 50 else 0 end
               - case when v_confiavel then 40 else 0 end;
      if v_confiavel and v_regra in ('ferramenta','varredura','injecao') then
        v_risco  := 100;
        v_motivo := 'ataque partindo de rede confiável — verificar máquina';
      end if;
      if v_forjada and coalesce(v_motivo, '') !~* 'forjada por outro site' then
        v_motivo := left(coalesce(left(v_motivo, 110) || ' · ', '')
                         || 'possível requisição forjada por outro site (cross-site): sem bloqueio de IP', 200);
      end if;
      v_risco := least(100, greatest(0, v_risco));

      insert into sentinela.eventos as ev
             (ts_guarda, projeto, ambiente, host, metodo, caminho, consulta, tipo, ip, pais, regiao, cidade, lat, lon, fuso,
              ua, idioma, referer, ja4, vercel_id, sec_fetch_site, sec_fetch_mode, sec_fetch_dest,
              decisao, regra, motivo, risco, identidade, identidade_origem, guarda)
      values (sentinela.ts_ou_nulo(e->>'ts'), v_proj, v_amb, sentinela.txt(e->>'host', 200), v_metodo, v_caminho,
              sentinela.txt(e->>'consulta', 300), v_tipo, v_ip, v_pais, v_regiao, v_cidade, v_lat, v_lon,
              sentinela.txt(e->>'fuso', 60), v_ua, v_idioma, sentinela.txt(e->>'referer', 120), v_ja4,
              sentinela.txt(e->>'vercel_id', 120), v_sec_site, v_sec_mode,
              sentinela.txt(e->>'sec_fetch_dest', 40), v_decisao, v_regra, v_motivo, v_risco, v_ident, v_ident_origem,
              sentinela.txt(p_guarda, 60))
      returning ev.id into v_id;
      v_gravados := v_gravados + 1;
      v_ids := v_ids || v_id;

      if v_decisao = 'bloqueado' and v_regra = 'lista' then
        update sentinela.bloqueios bl
           set hits = bl.hits + 1, ultimo_hit = now()
         where bl.id = (sentinela.bloqueio_do_ip(v_ip, v_ja4)).id;
      end if;
    else
      v_descartados := v_descartados + 1;
    end if;

    -- regras centrais que dependem do lote: guardadas aqui, aplicadas por IP depois do laço.
    -- Varredura/injeção pedida por outro site (v_forjada) não vira bloqueio de IP, igual ao
    -- guarda; senão qualquer site bloquearia quem o visitasse.
    if v_regra in ('ferramenta','varredura','injecao') and not v_forjada then
      v_certos := v_certos || jsonb_build_object(
        'ip', v_ipt, 'regra', v_regra, 'evento_id', v_id,
        'motivo', left(coalesce(case when v_motivo like 'ataque partindo de rede confiável%' then null else v_motivo end,
                                case v_regra
                                  when 'ferramenta' then 'ferramenta de ataque: ' || coalesce(left(v_ua, 80), 'sem user-agent')
                                  when 'varredura'  then 'varredura de caminhos: ' || concat_ws(' ', v_metodo, v_caminho)
                                  else 'tentativa de injeção: ' || concat_ws(' ', v_metodo, v_caminho)
                                end), 200));
    end if;
    if v_regra = 'robo' and not (v_ip = any(v_robo)) then
      v_robo := v_robo || v_ip;
    end if;

    -- perfil do IP; as janelas de 60 s contam tudo que chega (gravado ou não) para a rajada.
    -- Janela vencida há menos de 60 s vira a "anterior" e a nova começa logo em seguida.
    insert into sentinela.ips as i
           (ip, primeiro_visto, ultimo_visto, total, descartados, pais, regiao, cidade, lat, lon, ua_ultimo,
            projetos, risco_max, identidade, identidade_em, janela_inicio, janela_total, janela_anterior)
    values (v_ip, now(), now(),
            case when v_gravar then 1 else 0 end,
            case when v_gravar then 0 else 1 end,
            case when v_gravar then v_pais end,
            case when v_gravar then v_regiao end,
            case when v_gravar then v_cidade end,
            case when v_gravar then v_lat end,
            case when v_gravar then v_lon end,
            case when v_gravar then v_ua end,
            case when v_gravar then array[v_proj] else '{}'::text[] end,
            v_risco,
            case when v_gravar then v_ident end,
            case when v_gravar and v_ident is not null then now() end,
            now(), 1, 0)
    on conflict (ip) do update set
      ultimo_visto  = now(),
      total         = i.total + excluded.total,
      descartados   = i.descartados + excluded.descartados,
      pais          = case when excluded.pais is not null then excluded.pais   else i.pais   end,
      regiao        = case when excluded.pais is not null then excluded.regiao else i.regiao end,
      cidade        = case when excluded.pais is not null then excluded.cidade else i.cidade end,
      lat           = case when excluded.lat  is not null then excluded.lat    else i.lat    end,
      lon           = case when excluded.lat  is not null then excluded.lon    else i.lon    end,
      ua_ultimo     = coalesce(excluded.ua_ultimo, i.ua_ultimo),
      projetos      = case when cardinality(excluded.projetos) = 0 or excluded.projetos[1] = any(i.projetos)
                           then i.projetos else i.projetos || excluded.projetos end,
      risco_max     = greatest(i.risco_max, excluded.risco_max),
      identidade    = coalesce(excluded.identidade, i.identidade),
      identidade_em = coalesce(excluded.identidade_em, i.identidade_em),
      janela_inicio = case when i.janela_inicio is null or i.janela_inicio <= now() - interval '120 seconds' then now()
                           when i.janela_inicio <= now() - interval '60 seconds' then i.janela_inicio + interval '60 seconds'
                           else i.janela_inicio end,
      janela_anterior = case when i.janela_inicio is null or i.janela_inicio <= now() - interval '120 seconds' then 0
                             when i.janela_inicio <= now() - interval '60 seconds' then i.janela_total
                             else i.janela_anterior end,
      janela_total  = case when i.janela_inicio is null or i.janela_inicio <= now() - interval '60 seconds'
                           then 1 else i.janela_total + 1 end;
  end loop;

  -- regras centrais por IP (nunca para confiável). O alvo e a contagem são o /64 em IPv6.
  foreach v_ip in array v_ips loop
    continue when sentinela.eh_confiavel(v_ip);
    v_ipt := host(v_ip);
    select * into al from sentinela.alvo_auto(v_ip);

    -- ataque certo (ferramenta, varredura, injeção): 24 h; varredura com 3+ bloqueios certos em 7 dias: 7 dias
    for r in
      select distinct on (x->>'regra')
             x->>'regra' as regra, x->>'motivo' as motivo, (x->>'evento_id')::bigint as evento_id
        from jsonb_array_elements(v_certos) x
       where x->>'ip' = v_ipt
       order by x->>'regra', (x->>'evento_id')::bigint nulls last
    loop
      v_dur := interval '24 hours';
      if r.regra = 'varredura' then
        select count(*) into v_qtd
          from sentinela.bloqueios bl
         where bl.tipo = al.tipo and bl.valor = al.valor and bl.nivel = 'certo'
           and bl.criado_em > now() - interval '7 days';
        if not exists (select 1 from sentinela.bloqueios bl
                        where bl.tipo = al.tipo and bl.valor = al.valor and bl.nivel = 'certo' and bl.origem = 'regra'
                          and bl.revogado_em is null and (bl.expira_em is null or bl.expira_em > now())) then
          v_qtd := v_qtd + 1;   -- o que vai nascer agora
        end if;
        if v_qtd >= 3 then
          v_dur := interval '7 days';
        end if;
      end if;
      select * into b from sentinela.bloquear(al.tipo, al.valor, al.rede, 'certo', 'regra', r.regra, r.motivo,
                                              now() + v_dur, 'sentinela', r.evento_id);
      if b.novo then
        v_novos := v_novos || jsonb_build_object('id', b.bloqueio_id, 'v', al.valor, 'n', 'certo', 'regra', r.regra,
                                                 'ate', sentinela.iso(b.ate));
      end if;
    end loop;

    -- robô: 20 ou mais eventos "robo" em 10 min → suspeito 1 h
    if v_ip = any(v_robo) then
      select count(*) into v_qtd
        from sentinela.eventos ev
       where ev.ip <<= al.rede and ev.regra = 'robo' and ev.criado_em > now() - interval '10 minutes';
      if v_qtd >= 20 then
        select * into b from sentinela.bloquear(al.tipo, al.valor, al.rede, 'suspeito', 'regra', 'robo',
                                                'robô: ' || v_qtd || ' acessos automatizados em 10 min',
                                                now() + interval '1 hour', 'sentinela');
        if b.novo then
          v_novos := v_novos || jsonb_build_object('id', b.bloqueio_id, 'v', al.valor, 'n', 'suspeito', 'regra', 'robo',
                                                   'ate', sentinela.iso(b.ate));
        end if;
      end if;
    end if;

    -- rajada: mais que limite_rajada_min acessos estimados nos últimos 60 s → suspeito 15 min
    select coalesce(sum(sentinela.janela_estimada(i.janela_inicio, i.janela_total, i.janela_anterior)), 0)
      into v_est
      from sentinela.ips i
     where i.ip <<= al.rede;
    if v_est > v_cfg.limite_rajada_min then
      select * into b from sentinela.bloquear(al.tipo, al.valor, al.rede, 'suspeito', 'regra', 'rajada',
                                              'rajada: ' || round(v_est) || ' acessos em 60 s',
                                              now() + interval '15 minutes', 'sentinela');
      if b.novo then
        v_novos := v_novos || jsonb_build_object('id', b.bloqueio_id, 'v', al.valor, 'n', 'suspeito', 'regra', 'rajada',
                                                 'ate', sentinela.iso(b.ate));
      end if;
    end if;

    -- saída Tor → suspeito 24 h (só o próprio IP: a lista Tor é de endereços exatos)
    if exists (select 1 from sentinela.tor_saidas t where t.ip = v_ip) then
      select * into b from sentinela.bloquear('ip', v_ipt, v_ip::cidr, 'suspeito', 'regra', 'tor',
                                              'saída da rede Tor', now() + interval '24 hours', 'sentinela');
      if b.novo then
        v_novos := v_novos || jsonb_build_object('id', b.bloqueio_id, 'v', v_ipt, 'n', 'suspeito', 'regra', 'tor',
                                                 'ate', sentinela.iso(b.ate));
      end if;
    end if;
  end loop;

  -- quem vai para a IA: risco >= 30, ou primeira vez fora do BR sem identidade; não confiável,
  -- sem bloqueio certo ativo, sem análise em 6 h nem pedido em 10 min (IPv6: no /64), um por /64;
  -- no máximo 3 por lote e dentro da cota da hora, que desconta também os pedidos já entregues à
  -- Central e ainda sem resposta (lotes seguidos não passam da cota)
  if cardinality(v_ids) > 0 then
    select coalesce(array_agg(x.ip order by x.risco desc, x.ip), '{}')
      into v_analisar_ips
      from (
        select y.ip, y.risco
          from (
            select distinct on (sentinela.rede_auto(l.ip)) l.ip, l.risco
              from (select ev.ip, max(ev.risco) as risco, bool_or(ev.identidade is not null) as ident
                      from sentinela.eventos ev
                     where ev.id = any(v_ids)
                     group by ev.ip) l
              join sentinela.ips i on i.ip = l.ip
             where (l.risco >= 30
                    or (l.ip = any(v_primeiras) and i.pais is not null and i.pais <> 'BR'
                        and not l.ident and i.identidade is null))
               and not sentinela.eh_confiavel(l.ip)
               and not exists (select 1 from sentinela.bloqueios bl
                                where bl.nivel = 'certo' and bl.rede >>= l.ip
                                  and bl.revogado_em is null and (bl.expira_em is null or bl.expira_em > now()))
               and not exists (select 1 from sentinela.ips i2
                                where i2.ip <<= sentinela.rede_auto(l.ip)
                                  and (i2.ultima_analise_em >= now() - interval '6 hours'
                                       or i2.analise_pedida_em >= now() - interval '10 minutes'))
             order by sentinela.rede_auto(l.ip), l.risco desc, l.ip
          ) y
         order by y.risco desc, y.ip
         limit 3
      ) x;
    if cardinality(v_analisar_ips) > 0 then
      v_cota := greatest(0, v_cfg.ia_limite_hora
                  - (select count(*) from sentinela.analises an where an.criado_em > now() - interval '1 hour')::int
                  - (select count(*) from sentinela.ips i
                      where i.analise_pedida_em > now() - interval '10 minutes'
                        and (i.ultima_analise_em is null or i.ultima_analise_em < i.analise_pedida_em))::int);
      v_analisar_ips := v_analisar_ips[1:v_cota];
    end if;
    if cardinality(v_analisar_ips) > 0 then
      update sentinela.ips i set analise_pedida_em = now() where i.ip = any(v_analisar_ips);
      select coalesce(jsonb_agg(host(u.ip) order by u.n), '[]'::jsonb)
        into v_analisar
        from unnest(v_analisar_ips) with ordinality as u(ip, n);
    end if;
  end if;

  update sentinela.sistemas s
     set ultimo_sinal    = now(),
         guarda_versao   = coalesce(sentinela.txt(p_guarda, 60), s.guarda_versao),
         guarda_runtime  = coalesce(sentinela.txt(p_runtime, 20), s.guarda_runtime),
         ultimo_ambiente = v_amb
   where s.projeto = v_proj;

  return jsonb_build_object('gravados', v_gravados, 'descartados', v_descartados,
                            'bloqueios_novos', v_novos, 'analisar', v_analisar);
end $$;

create or replace function public.sentinela_srv_contexto_ip(p_ip text)
returns jsonb
language plpgsql
stable
security definer
set search_path = sentinela, public, extensions, pg_temp
as $$
declare
  v_ip inet := sentinela.ip_ou_nulo(p_ip);
begin
  perform sentinela.so_central();
  if v_ip is null then
    raise exception 'sentinela: ip inválido' using errcode = '22023';
  end if;
  return sentinela.contexto(v_ip);
end $$;

create or replace function public.sentinela_srv_registrar_analise(p_ip text, p_dados jsonb)
returns jsonb
language plpgsql
security definer
set search_path = sentinela, public, extensions, pg_temp
as $$
declare
  v_cfg sentinela.config;
  v_ip inet := sentinela.ip_ou_nulo(p_ip);
  d jsonb := coalesce(p_dados, '{}'::jsonb);
  v_veredito text;
  v_conf numeric;
  v_acao text;
  v_motivo text;
  v_id bigint;
  v_aplicado text := 'nenhum';
  v_dur interval;
  al record;
  b record;
begin
  perform sentinela.so_central();
  if v_ip is null then
    raise exception 'sentinela: ip inválido' using errcode = '22023';
  end if;
  if jsonb_typeof(d) <> 'object' then
    raise exception 'sentinela: p_dados deve ser um objeto' using errcode = '22023';
  end if;
  select * into v_cfg from sentinela.config c where c.id;

  v_veredito := d->>'veredito';
  if v_veredito is null or v_veredito not in ('legitimo','suspeito','malicioso','erro') then
    v_veredito := 'erro';
  end if;
  v_conf := sentinela.num_ou_nulo(d->>'confianca');
  if v_conf is not null then
    v_conf := least(1, greatest(0, v_conf));
  end if;
  v_acao := d->>'acao';
  if v_acao is not null and v_acao not in ('nenhuma','observar','bloquear_1h','bloquear_24h','bloquear_7d') then
    v_acao := null;
  end if;
  v_motivo := sentinela.txt(d->>'motivo', 200);

  insert into sentinela.analises as a
         (ip, modelo, veredito, confianca, motivo, acao, tokens_entrada, tokens_saida, erro)
  values (v_ip, sentinela.txt(d->>'modelo', 80), v_veredito, v_conf, v_motivo, v_acao,
          sentinela.int_ou_nulo(d->>'tokens_entrada'), sentinela.int_ou_nulo(d->>'tokens_saida'),
          sentinela.txt(d->>'erro', 300))
  returning a.id into v_id;

  -- perfil antes do bloqueio (mesma ordem de travas do srv_registrar)
  update sentinela.ips i
     set ultima_analise_em = now(), ultimo_veredito = v_veredito
   where i.ip = v_ip;

  if v_veredito = 'malicioso' and v_conf >= v_cfg.ia_confianca_min
     and v_acao in ('bloquear_1h','bloquear_24h','bloquear_7d') then
    if sentinela.eh_confiavel(v_ip) then
      v_aplicado := 'confiável: ignorado';
    else
      v_dur := case v_acao when 'bloquear_1h' then interval '1 hour'
                           when 'bloquear_24h' then interval '24 hours'
                           else interval '7 days' end;
      -- linha própria (suspeito, origem ia): não alonga um bloqueio certo que já exista
      select * into al from sentinela.alvo_auto(v_ip);
      select * into b from sentinela.bloquear(al.tipo, al.valor, al.rede, 'suspeito', 'ia', 'ia',
                                              'IA: ' || coalesce(v_motivo, 'veredito malicioso'),
                                              now() + v_dur, 'sentinela', null, v_id);
      v_aplicado := case when v_cfg.modo = 'proteger' then 'bloqueio #' || b.bloqueio_id
                         else 'seria bloqueado (modo observar) #' || b.bloqueio_id end;
    end if;
  end if;

  update sentinela.analises a set aplicado = v_aplicado where a.id = v_id;
  return jsonb_build_object('analise_id', v_id, 'aplicado', v_aplicado);
end $$;

-- Só as análises gravadas, como no contrato: é a trava que a Central consulta antes de cada
-- chamada à IA. Os pedidos ainda sem resposta já são descontados na entrega (srv_registrar);
-- contá-los aqui também faria a Central recusar justamente os IPs que recebeu.
create or replace function public.sentinela_srv_ia_cota()
returns int
language plpgsql
stable
security definer
set search_path = sentinela, public, extensions, pg_temp
as $$
begin
  perform sentinela.so_central();
  return (select greatest(0, c.ia_limite_hora
                             - (select count(*) from sentinela.analises a where a.criado_em > now() - interval '1 hour')::int)
            from sentinela.config c
           where c.id);
end $$;

create or replace function public.sentinela_srv_ia_status(p_status text, p_detalhe text)
returns void
language plpgsql
security definer
set search_path = sentinela, public, extensions, pg_temp
as $$
begin
  perform sentinela.so_central();
  if p_status is null or p_status not in ('desconhecido','ligada','sem_chave','erro') then
    raise exception 'sentinela: status da IA inválido' using errcode = '22023';
  end if;
  update sentinela.config c
     set ia_status = p_status, ia_status_detalhe = sentinela.txt(p_detalhe, 300), ia_status_em = now()
   where c.id;
end $$;

create or replace function public.sentinela_srv_identidade(
  p_ip text, p_user_id uuid, p_email text, p_origem text, p_ua text)
returns jsonb
language plpgsql
security definer
set search_path = sentinela, public, extensions, pg_temp
as $$
declare
  v_ip inet := sentinela.ip_ou_nulo(p_ip);
  v_email text := lower(sentinela.txt(p_email, 200));
  v_id bigint;
begin
  perform sentinela.so_central();
  if v_ip is null then
    raise exception 'sentinela: ip inválido' using errcode = '22023';
  end if;
  if v_email is null or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+$' then
    raise exception 'sentinela: e-mail inválido' using errcode = '22023';
  end if;
  if p_origem is null or p_origem not in ('portal','passe','sessao_app') then
    raise exception 'sentinela: origem inválida' using errcode = '22023';
  end if;
  -- só conta com perfil ATIVO vira identidade (cadastro pendente não tira o IP da IA nem vira
  -- "provável" no painel). Não depende da Central conferir antes; ela responde 403 perfil_inativo.
  if p_user_id is null or not exists (select 1 from public.profiles p where p.id = p_user_id and p.ativo) then
    return jsonb_build_object('ok', false, 'motivo', 'perfil_inativo');
  end if;

  insert into sentinela.identidades (ip, user_id, email, origem, ua)
  values (v_ip, p_user_id, v_email, p_origem, sentinela.txt(p_ua, 300));

  insert into sentinela.ips as i (ip, primeiro_visto, ultimo_visto, identidade, identidade_em)
  values (v_ip, now(), now(), v_email, now())
  on conflict (ip) do update set identidade = excluded.identidade, identidade_em = now();

  -- confiável aprendido pelo login (o próprio IP, 7 dias, renovado a cada login).
  -- Não aprende: saída Tor (IP de todo mundo); IP com bloqueio certo ativo (ataque visto
  -- dele: o TI decide); e IP cuja confiança o TI tirou há menos de 30 dias (senão o
  -- próximo login desfaria o "desconfiar"). Perfil inativo já saiu acima.
  if not exists (select 1 from sentinela.tor_saidas t where t.ip = v_ip)
     and not exists (select 1 from sentinela.bloqueios b
                      where b.nivel = 'certo' and b.rede >>= v_ip
                        and b.revogado_em is null and (b.expira_em is null or b.expira_em > now()))
     and not exists (select 1 from sentinela.confiaveis c
                      where c.rede >>= v_ip and c.removido_em > now() - interval '30 days') then
    perform pg_advisory_xact_lock(hashtextextended('sentinela.confiavel|' || host(v_ip), 0));
    update sentinela.confiaveis c
       set expira_em = now() + interval '7 days', identidade = v_email
     where c.id = (select c2.id from sentinela.confiaveis c2
                    where c2.origem = 'login' and c2.rede = v_ip::cidr and c2.removido_em is null
                    order by c2.criado_em desc limit 1)
    returning c.id into v_id;
    if v_id is null then
      insert into sentinela.confiaveis (tipo, valor, rede, descricao, origem, identidade, expira_em, criado_por)
      values ('ip', host(v_ip), v_ip::cidr, 'aprendido pelo login de ' || v_email, 'login', v_email,
              now() + interval '7 days', 'sentinela');
    end if;
    -- confiável não fica com bloqueio automático (§1), igual ao "confiar" do painel
    update sentinela.bloqueios bl
       set revogado_em = now(), revogado_por = left('login de ' || v_email, 200)
     where bl.revogado_em is null and (bl.expira_em is null or bl.expira_em > now())
       and bl.origem in ('regra','ia') and bl.rede && v_ip::cidr;
  end if;

  return jsonb_build_object('ok', true);
end $$;

create or replace function public.sentinela_srv_tentativa(p_ip text, p_usuario text, p_ua text)
returns jsonb
language plpgsql
security definer
set search_path = sentinela, public, extensions, pg_temp
as $$
declare
  v_ip inet := sentinela.ip_ou_nulo(p_ip);
  v_qtd int;
  v_bloq boolean := false;
  al record;
  b record;
begin
  perform sentinela.so_central();
  if v_ip is null then
    raise exception 'sentinela: ip inválido' using errcode = '22023';
  end if;

  insert into sentinela.tentativas_login (ip, usuario, ua)
  values (v_ip, lower(sentinela.txt(p_usuario, 80)), sentinela.txt(p_ua, 300));

  -- conta e bloqueia o alvo automático (IPv6: o /64, onde o endereço troca à vontade)
  select * into al from sentinela.alvo_auto(v_ip);
  select count(*) into v_qtd
    from sentinela.tentativas_login t
   where t.ip <<= al.rede and t.criado_em > now() - interval '10 minutes';

  if v_qtd >= 5 and not sentinela.eh_confiavel(v_ip) then
    select * into b from sentinela.bloquear(al.tipo, al.valor, al.rede, 'suspeito', 'regra', 'forca_bruta',
                                            'força bruta: ' || v_qtd || ' tentativas de login falhas em 10 min',
                                            now() + interval '1 hour', 'sentinela');
    v_bloq := true;
  end if;

  return jsonb_build_object('ok', true, 'bloqueado', v_bloq);
end $$;

-- Mesma regra do portal (portal.js): perfil ativo, sistema ativo e
-- acesso_total sem exceção, ou (sem acesso_total) linha em permissoes.
create or replace function public.sentinela_srv_permissao(p_user_id uuid, p_sistema_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = sentinela, public, extensions, pg_temp
as $$
declare
  v_perfil public.profiles;
  v_pub public.sistemas;
  v_sis sentinela.sistemas;
  v_ok boolean := false;
  v_motivo text;
begin
  perform sentinela.so_central();
  select * into v_perfil from public.profiles p where p.id = p_user_id;
  select * into v_pub from public.sistemas s where s.slug = p_sistema_slug;
  select * into v_sis from sentinela.sistemas s where s.sistema_slug = p_sistema_slug order by s.ativo desc limit 1;

  if v_perfil.id is null then
    v_motivo := 'perfil_inexistente';
  elsif not v_perfil.ativo then
    v_motivo := 'perfil_inativo';
  elsif v_pub.id is null or v_sis.projeto is null then
    v_motivo := 'sistema_desconhecido';
  elsif not v_pub.ativo or not v_sis.ativo then
    v_motivo := 'sistema_inativo';
  elsif v_perfil.acesso_total then
    if exists (select 1 from public.permissoes_excecao x where x.user_id = v_perfil.id and x.sistema_id = v_pub.id) then
      v_motivo := 'excecao_acesso_total';
    else
      v_ok := true;
      v_motivo := 'acesso_total';
    end if;
  elsif exists (select 1 from public.permissoes x where x.user_id = v_perfil.id and x.sistema_id = v_pub.id) then
    v_ok := true;
    v_motivo := 'permissao';
  else
    v_motivo := 'sem_permissao';
  end if;

  -- guarda_ativo (extra): o guarda do sistema já falou com a Central (ultimo_sinal preenchido).
  -- Sem guarda, a Central não põe o passe na URL (ninguém o trocaria por sessão e ele ficaria
  -- exposto no endereço e no histórico).
  return jsonb_build_object('permitido', v_ok, 'motivo', v_motivo, 'email', v_perfil.email, 'nome', v_perfil.nome,
                            'projeto', v_sis.projeto, 'url', v_sis.url,
                            'guarda_ativo', coalesce(v_sis.ultimo_sinal is not null, false));
end $$;

-- true só no primeiro uso do jti
create or replace function public.sentinela_srv_passe_usar(p_jti text, p_projeto text, p_email text)
returns boolean
language plpgsql
security definer
set search_path = sentinela, public, extensions, pg_temp
as $$
begin
  perform sentinela.so_central();
  if p_jti is null or length(p_jti) < 8 or length(p_jti) > 100 then
    return false;
  end if;
  insert into sentinela.passes_usados (jti, projeto, email)
  values (p_jti, sentinela.txt(p_projeto, 100), lower(sentinela.txt(p_email, 200)))
  on conflict (jti) do nothing;
  return found;
end $$;

create or replace function public.sentinela_srv_chave_ativa()
returns jsonb
language plpgsql
stable
security definer
set search_path = sentinela, public, extensions, pg_temp
as $$
begin
  perform sentinela.so_central();
  return sentinela.chave_ativa();
end $$;

create or replace function public.sentinela_srv_chave_criar(p_kid text, p_publica jsonb, p_privada text)
returns jsonb
language plpgsql
security definer
set search_path = sentinela, public, extensions, pg_temp
as $$
declare
  v jsonb;
  v_priv jsonb;
  v_pub jsonb;
  v_sid uuid;
begin
  perform sentinela.so_central();
  -- uma criação por vez: se duas instâncias da Central correrem, a segunda recebe a chave da primeira
  perform pg_advisory_xact_lock(hashtextextended('sentinela.chave', 0));
  v := sentinela.chave_ativa();
  if v is not null then
    return v;
  end if;

  if p_kid is null or p_kid !~ '^[A-Za-z0-9_-]{8,64}$' then
    raise exception 'sentinela: kid inválido' using errcode = '22023';
  end if;
  if p_publica is null or jsonb_typeof(p_publica) <> 'object'
     or p_publica->>'kty' is distinct from 'EC' or p_publica->>'crv' is distinct from 'P-256'
     or coalesce(p_publica->>'x', '') !~ '^[A-Za-z0-9_-]{43}$'
     or coalesce(p_publica->>'y', '') !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception 'sentinela: chave pública inválida (esperado JWK EC P-256)' using errcode = '22023';
  end if;
  if p_publica->'d' is not null then
    raise exception 'sentinela: a chave pública não pode conter a parte privada' using errcode = '22023';
  end if;
  begin
    v_priv := p_privada::jsonb;
  exception when others then
    v_priv := null;
  end;
  if v_priv is null or jsonb_typeof(v_priv) <> 'object'
     or coalesce(v_priv->>'d', '') !~ '^[A-Za-z0-9_-]{43}$'
     or v_priv->>'x' is distinct from p_publica->>'x'
     or v_priv->>'y' is distinct from p_publica->>'y' then
    raise exception 'sentinela: chave privada inválida ou de outro par' using errcode = '22023';
  end if;

  v_sid := vault.create_secret(p_privada, 'sentinela_chave_' || p_kid, 'chave privada ES256 da Sentinela');
  v_pub := jsonb_build_object('kty', 'EC', 'crv', 'P-256', 'x', p_publica->>'x', 'y', p_publica->>'y');
  insert into sentinela.chaves (kid, alg, publica, segredo_id) values (p_kid, 'ES256', v_pub, v_sid);

  return jsonb_build_object('kid', p_kid, 'publica', v_pub, 'privada', p_privada);
end $$;

create or replace function public.sentinela_srv_chaves_publicas()
returns jsonb
language plpgsql
stable
security definer
set search_path = sentinela, public, extensions, pg_temp
as $$
begin
  perform sentinela.so_central();
  return (select coalesce(jsonb_agg((k.publica - 'd') || jsonb_build_object('kid', k.kid, 'alg', 'ES256', 'use', 'sig')
                                    order by k.criada_em desc), '[]'::jsonb)
            from sentinela.chaves k
           where k.ativa);
end $$;

-- Substitui a lista de saídas Tor. Lista sem nenhum IP válido não apaga a atual (devolve 0).
create or replace function public.sentinela_srv_tor_atualizar(p_ips text[])
returns int
language plpgsql
security definer
set search_path = sentinela, public, extensions, pg_temp
as $$
declare
  v_ips inet[];
begin
  perform sentinela.so_central();
  select array_agg(distinct x.ip)
    into v_ips
    from (select sentinela.ip_ou_nulo(t) as ip from unnest((coalesce(p_ips, '{}'::text[]))[1:50000]) as t) x
   where x.ip is not null;

  if v_ips is null then
    return 0;
  end if;

  -- "where true": o Supabase liga o safeupdate na API, que recusa DELETE sem WHERE
  -- ("21000 DELETE requires a WHERE clause"); sem isto a lista Tor nunca carregava
  delete from sentinela.tor_saidas where true;
  insert into sentinela.tor_saidas (ip, atualizado_em) select u, now() from unnest(v_ips) as u;
  update sentinela.config c set tor_atualizado_em = now() where c.id;
  return cardinality(v_ips);
end $$;

-- Retenção em lotes (única porta para apagar eventos: liga sentinela.limpeza só nesta transação).
-- Eventos saem sempre do começo da cadeia (prefixo de id): o que fica continua encadeado.
-- Com atraso grande, para em ~3 s (o PostgREST corta em 8 s), devolve "pendente" e NÃO marca
-- manutencao_em, para a próxima chamada da Central continuar; zerado o atraso, volta a 1x/dia.
create or replace function sentinela.manutencao(p_lote int default 100000, p_max_lotes int default 20)
returns jsonb
language plpgsql
set search_path = sentinela, public, extensions, pg_temp
as $$
declare
  v_cfg sentinela.config;
  v_lim timestamptz;
  v_t0 timestamptz := clock_timestamp();
  v_lote int := greatest(coalesce(p_lote, 100000), 1);
  v_corte bigint;
  v_max bigint;
  v_n int;
  v_k int;
  v_lotes int := 0;
  v_eventos int := 0;
  v_tentativas int;
  v_passes int;
  v_identidades int;
  v_pendente boolean := false;
begin
  -- uma por vez; quem chega junto sai na hora, sem esperar trava
  if not pg_try_advisory_xact_lock(hashtextextended('sentinela.manutencao', 0)) then
    return jsonb_build_object('apagados', '{}'::jsonb, 'executada', false, 'ocupada', true);
  end if;
  select * into v_cfg from sentinela.config c where c.id;
  if v_cfg.manutencao_em is not null and v_cfg.manutencao_em > now() - interval '1 day' then
    return jsonb_build_object('apagados', '{}'::jsonb, 'executada', false,
                              'proxima_em', sentinela.iso(v_cfg.manutencao_em + interval '1 day'));
  end if;
  v_lim := now() - make_interval(days => greatest(v_cfg.retencao_dias, 7));

  perform set_config('sentinela.limpeza', 'on', true);
  loop
    select min(x.id) filter (where x.criado_em >= v_lim), max(x.id), count(*)
      into v_corte, v_max, v_n
      from (select e.id, e.criado_em from sentinela.eventos e order by e.id limit v_lote) x;
    exit when v_n = 0;
    delete from sentinela.eventos e where e.id < coalesce(v_corte, v_max + 1);
    get diagnostics v_k = row_count;
    v_eventos := v_eventos + v_k;
    v_lotes := v_lotes + 1;
    exit when v_corte is not null or v_n < v_lote;      -- chegou nos recentes ou no fim da tabela
    if v_lotes >= greatest(coalesce(p_max_lotes, 20), 1) or clock_timestamp() - v_t0 > interval '3 seconds' then
      v_pendente := exists (select 1 from sentinela.eventos e
                             where e.id = (select min(e2.id) from sentinela.eventos e2) and e.criado_em < v_lim);
      exit;
    end if;
  end loop;
  perform set_config('sentinela.limpeza', 'off', true);

  delete from sentinela.tentativas_login t
   where t.id in (select t2.id from sentinela.tentativas_login t2
                   where t2.criado_em < now() - interval '30 days' limit v_lote);
  get diagnostics v_tentativas = row_count;
  delete from sentinela.passes_usados p
   where p.jti in (select p2.jti from sentinela.passes_usados p2
                    where p2.usado_em < now() - interval '2 days' limit v_lote);
  get diagnostics v_passes = row_count;
  -- extra (dado pessoal): identidades seguem a mesma retenção dos eventos
  delete from sentinela.identidades d
   where d.id in (select d2.id from sentinela.identidades d2 where d2.criado_em < v_lim limit v_lote);
  get diagnostics v_identidades = row_count;
  v_pendente := v_pendente or v_tentativas >= v_lote or v_passes >= v_lote or v_identidades >= v_lote;

  if not v_pendente then
    update sentinela.config c set manutencao_em = now() where c.id;
  end if;

  return jsonb_build_object('apagados', jsonb_build_object(
           'eventos', v_eventos, 'tentativas_login', v_tentativas, 'passes_usados', v_passes,
           'identidades', v_identidades),
         'executada', true, 'pendente', v_pendente);
end $$;

-- No máximo 1x por dia, salvo atraso pendente (ver sentinela.manutencao).
create or replace function public.sentinela_srv_manutencao()
returns jsonb
language plpgsql
security definer
set search_path = sentinela, public, extensions, pg_temp
as $$
begin
  perform sentinela.so_central();
  return sentinela.manutencao(100000, 20);
end $$;

-- ---------------------------------------------------------
-- 5. FUNÇÕES DO PAINEL (authenticated + is_admin)
-- ---------------------------------------------------------
-- volatile: grava o cache dos KPIs (sentinela.kpis_cacheados)
create or replace function public.sentinela_painel(p_horas int default 24)
returns jsonb
language plpgsql
volatile
security definer
set search_path = sentinela, public, extensions, pg_temp
as $$
declare
  v_cfg sentinela.config;
  v_cad sentinela.cadeia;
  v_h int := least(greatest(coalesce(p_horas, 24), 1), 168);
  v_ini timestamptz;
  v_res jsonb;
begin
  if not public.is_admin() then
    raise exception 'sentinela: acesso restrito ao TI' using errcode = '42501';
  end if;
  select * into v_cfg from sentinela.config c where c.id;
  select * into v_cad from sentinela.cadeia k where k.id;
  -- janela começa no primeiro balde do gráfico por hora: KPIs = soma do gráfico
  v_ini := sentinela.janela_ini(v_h);

  with ev as materialized (
    select e.id, e.criado_em, e.projeto, e.ip, e.pais, e.regiao, e.cidade, e.lat, e.lon, e.ua, e.ja4,
           e.decisao, e.regra, e.risco, e.identidade, e.identidade_origem
      from sentinela.eventos e
     where e.criado_em >= v_ini
  ),
  por_ip as (
    select e.ip,
           count(*) as total,
           count(*) filter (where e.decisao = 'bloqueado') as bloqueados,
           count(*) filter (where e.decisao = 'observado') as observados,
           max(e.criado_em) as ultimo,
           max(e.risco) as risco,
           array_agg(distinct e.projeto) as projetos,
           (array_agg(e.regra order by e.id desc) filter (where e.decisao in ('observado','bloqueado')))[1] as regra_obs,
           (array_agg(e.identidade order by e.id desc) filter (where e.identidade is not null))[1] as ident,
           (array_agg(e.identidade_origem order by e.id desc) filter (where e.identidade is not null))[1] as ident_origem,
           (array_agg(e.ua order by e.id desc))[1] as ua,
           (array_agg(e.ja4 order by e.id desc) filter (where e.ja4 is not null))[1] as ja4,
           (array_agg(e.pais order by e.id desc) filter (where e.pais is not null))[1] as pais,
           (array_agg(e.regiao order by e.id desc) filter (where e.pais is not null))[1] as regiao,
           (array_agg(e.cidade order by e.id desc) filter (where e.pais is not null))[1] as cidade,
           (array_agg(e.lat order by e.id desc) filter (where e.lat is not null and e.lon is not null))[1] as lat,
           (array_agg(e.lon order by e.id desc) filter (where e.lat is not null and e.lon is not null))[1] as lon
      from ev e
     group by e.ip
  ),
  base as (
    select p.*,
           coalesce(p.pais, i.pais) as pais2,
           case when p.pais is not null then p.regiao else i.regiao end as regiao2,
           case when p.pais is not null then p.cidade else i.cidade end as cidade2,
           coalesce(p.lat, i.lat) as lat2,
           case when p.lat is not null then p.lon else i.lon end as lon2,
           i.identidade as ident_ip,
           i.ultima_analise_em,
           row_number() over (order by p.ultimo desc, p.ip) as rn,
           row_number() over (partition by (coalesce(p.lat, i.lat) is not null)
                              order by p.ultimo desc, p.ip) as rn_geo
      from por_ip p
      left join sentinela.ips i on i.ip = p.ip
  ),
  vis as (
    select a.*,
           exists (select 1 from sentinela.confiaveis cf
                    where cf.removido_em is null and (cf.expira_em is null or cf.expira_em > now())
                      and cf.rede >>= a.ip) as confiavel,
           bl.id as b_id, bl.nivel as b_nivel, bl.regra as b_regra, bl.origem as b_origem,
           bl.expira_em as b_ate, bl.motivo as b_motivo, bl.tipo as b_tipo, bl.valor as b_valor,
           an.veredito as an_veredito, an.confianca as an_confianca, an.motivo as an_motivo, an.criado_em as an_em
      from base a
      left join lateral (
        select b.id, b.nivel, b.regra, b.origem, b.expira_em, b.motivo, b.tipo, b.valor
          from sentinela.bloqueios b
         where b.revogado_em is null and (b.expira_em is null or b.expira_em > now())
           and ((b.tipo in ('ip','cidr') and b.rede >>= a.ip) or (b.tipo = 'ja4' and a.ja4 is not null and b.valor = a.ja4))
         order by (b.nivel = 'certo') desc, masklen(b.rede) desc nulls last, b.criado_em desc
         limit 1) bl on true
      left join lateral (
        select x.veredito, x.confianca, x.motivo, x.criado_em
          from sentinela.analises x
         where x.ip = a.ip
         order by x.criado_em desc, x.id desc
         limit 1) an on true
     where a.rn <= 300 or (a.lat2 is not null and a.rn_geo <= 500)
  ),
  -- bloqueio que o guarda aplicaria a este visitante: certo sempre; suspeito nunca para
  -- confiável (o guarda ignora) e só no modo proteger para os demais
  vis1 as (
    select v.*, (v.b_id is not null and (v.b_nivel = 'certo' or not v.confiavel)) as b_vale
      from vis v
  ),
  vis2 as (
    select v.*,
           case
             when v.b_vale and (v.b_nivel = 'certo' or v_cfg.modo = 'proteger') then 'bloqueado'
             -- acesso barrado na janela também é observado (ex.: ataque vindo de rede confiável)
             when v.b_vale or v.observados > 0 or v.bloqueados > 0 then 'observado'
             when v.risco >= 30 and not v.confiavel
                  and (v.ultima_analise_em is null or v.ultima_analise_em < now() - interval '6 hours') then 'analise'
             else 'seguro'
           end as status
      from vis1 v
  ),
  vis3 as (
    select v.*,
           case v.status
             when 'bloqueado' then coalesce(v.b_regra, v.b_origem)
             when 'observado' then case when v.b_vale then coalesce(v.b_regra, v.b_origem) else v.regra_obs end
             when 'analise'   then 'IA analisando'
           end as status_motivo
      from vis2 v
  ),
  horas as (
    select date_trunc('hour', e.criado_em, 'UTC') as h,
           count(*) filter (where e.decisao = 'liberado')  as liberado,
           count(*) filter (where e.decisao = 'observado') as observado,
           count(*) filter (where e.decisao = 'bloqueado') as bloqueado
      from ev e
     group by 1
  ),
  por_projeto as (
    select e.projeto, count(*) as acessos, count(*) filter (where e.decisao = 'bloqueado') as bloqueados
      from ev e
     group by e.projeto
  )
  select jsonb_build_object(
    'agora', sentinela.iso(now()),
    'modo', v_cfg.modo,
    'casa', jsonb_build_object('nome', v_cfg.casa_nome, 'lat', v_cfg.casa_lat, 'lon', v_cfg.casa_lon),
    'ia', jsonb_build_object(
            'status', v_cfg.ia_status, 'detalhe', v_cfg.ia_status_detalhe, 'status_em', sentinela.iso(v_cfg.ia_status_em),
            'analises_janela', (select count(*) from sentinela.analises a where a.criado_em >= v_ini and a.veredito <> 'erro'),
            'ultima_em', (select sentinela.iso(max(a.criado_em)) from sentinela.analises a),
            'limite_hora', v_cfg.ia_limite_hora,
            'modelo', (select a.modelo from sentinela.analises a where a.modelo is not null
                        order by a.criado_em desc, a.id desc limit 1)),
    'kpis', sentinela.kpis_cacheados(v_ini),
    'por_hora', (
      select jsonb_agg(jsonb_build_object('h', sentinela.iso(g.h), 'liberado', coalesce(x.liberado, 0),
                                          'observado', coalesce(x.observado, 0), 'bloqueado', coalesce(x.bloqueado, 0))
                       order by g.h)
        from generate_series(date_trunc('hour', now(), 'UTC') - make_interval(hours => v_h - 1),
                             date_trunc('hour', now(), 'UTC'), interval '1 hour') as g(h)
        left join horas x on x.h = g.h),
    'pontos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'ip', host(v.ip), 'lat', v.lat2, 'lon', v.lon2, 'cidade', v.cidade2, 'regiao', v.regiao2, 'pais', v.pais2,
               'total', v.total, 'bloqueados', v.bloqueados, 'observados', v.observados, 'status', v.status,
               'risco', v.risco, 'ultimo', sentinela.iso(v.ultimo)) order by v.ultimo desc, v.ip)
        from vis3 v
       where v.lat2 is not null and v.lon2 is not null and v.rn_geo <= 500), '[]'::jsonb),
    'visitantes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'ip', host(v.ip), 'pais', v.pais2, 'regiao', v.regiao2, 'cidade', v.cidade2, 'lat', v.lat2, 'lon', v.lon2,
               'identidade', coalesce(v.ident, v.ident_ip),
               'identidade_origem', case when v.ident is not null then v.ident_origem
                                         when v.ident_ip is not null then 'provavel' end,
               'confiavel', v.confiavel, 'ua', v.ua, 'projetos', to_jsonb(v.projetos), 'total', v.total,
               'ultimo', sentinela.iso(v.ultimo), 'risco', v.risco, 'status', v.status, 'status_motivo', v.status_motivo,
               -- tipo, valor e origem: extra (fora do §2) para o painel mostrar o alvo real ao liberar
               'bloqueio', case when v.b_id is not null then jsonb_build_object(
                             'id', v.b_id, 'nivel', v.b_nivel, 'regra', v.b_regra, 'ate', sentinela.iso(v.b_ate),
                             'motivo', v.b_motivo, 'tipo', v.b_tipo, 'valor', v.b_valor, 'origem', v.b_origem) end,
               'veredito', case when v.an_veredito is not null then jsonb_build_object(
                             'veredito', v.an_veredito, 'confianca', v.an_confianca, 'motivo', v.an_motivo,
                             'em', sentinela.iso(v.an_em)) end)
             order by v.ultimo desc, v.ip)
        from vis3 v
       where v.rn <= 300), '[]'::jsonb),
    'feed', coalesce((
      select jsonb_agg(sentinela.ev_json(e, s.nome) order by e.id desc)
        from sentinela.eventos e
        left join sentinela.sistemas s on s.projeto = e.projeto
       where e.id in (select e2.id from sentinela.eventos e2 order by e2.id desc limit 40)), '[]'::jsonb),
    'sistemas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'projeto', s.projeto, 'nome', s.nome, 'url', s.url, 'sistema_slug', s.sistema_slug,
               'ultimo_sinal', sentinela.iso(s.ultimo_sinal), 'guarda_versao', s.guarda_versao,
               'guarda_runtime', s.guarda_runtime, 'exige_login', s.exige_login,
               'acessos', coalesce(pp.acessos, 0), 'bloqueados', coalesce(pp.bloqueados, 0))
             order by (s.sistema_slug is not null), s.nome)
        from sentinela.sistemas s
        left join por_projeto pp on pp.projeto = s.projeto), '[]'::jsonb),
    'contagens', jsonb_build_object(
      'bloqueios_ativos', (select count(*) from sentinela.bloqueios b
                            where b.revogado_em is null and (b.expira_em is null or b.expira_em > now())),
      'confiaveis_ativos', (select count(*) from sentinela.confiaveis c
                             where c.removido_em is null and (c.expira_em is null or c.expira_em > now())),
      'exposicoes', (select jsonb_build_object(
                       'critica', count(*) filter (where x.severidade = 'critica'),
                       'alta',    count(*) filter (where x.severidade = 'alta'),
                       'media',   count(*) filter (where x.severidade = 'media'),
                       'baixa',   count(*) filter (where x.severidade = 'baixa'))
                       from sentinela.exposicoes x where x.status <> 'corrigida')),
    'cadeia', jsonb_build_object('ultimo_id', v_cad.ultimo_id, 'ultimo_selo', v_cad.ultimo_selo),
    'ultimo_id', (select max(e.id) from sentinela.eventos e)
  )
  into v_res;

  return v_res;
end $$;

-- volatile: lê e grava o cache dos KPIs (chamado a cada 4 s por aba aberta)
create or replace function public.sentinela_novos(p_desde_id bigint)
returns jsonb
language plpgsql
volatile
security definer
set search_path = sentinela, public, extensions, pg_temp
as $$
declare
  v_desde bigint := p_desde_id;
  v_ev jsonb;
  v_ult bigint;
begin
  if not public.is_admin() then
    raise exception 'sentinela: acesso restrito ao TI' using errcode = '42501';
  end if;
  if v_desde is null or v_desde < 0 then
    select greatest(coalesce(max(e.id), 0) - 100, 0) into v_desde from sentinela.eventos e;
  end if;

  select coalesce(jsonb_agg(sentinela.ev_json(e, s.nome, true) order by e.id), '[]'::jsonb), max(e.id)
    into v_ev, v_ult
    from sentinela.eventos e
    left join sentinela.sistemas s on s.projeto = e.projeto
   where e.id in (select e2.id from sentinela.eventos e2 where e2.id > v_desde order by e2.id limit 100);

  if v_ult is null then
    select coalesce(max(e.id), 0) into v_ult from sentinela.eventos e;
  end if;

  -- mesma janela (alinhada à hora) e mesmo cache do sentinela_painel(24)
  return jsonb_build_object('eventos', v_ev, 'ultimo_id', v_ult,
                            'kpis', sentinela.kpis_cacheados(sentinela.janela_ini(24)));
end $$;

create or replace function public.sentinela_ip(p_ip text)
returns jsonb
language plpgsql
stable
security definer
set search_path = sentinela, public, extensions, pg_temp
as $$
declare
  v_ip inet;
begin
  if not public.is_admin() then
    raise exception 'sentinela: acesso restrito ao TI' using errcode = '42501';
  end if;
  v_ip := sentinela.ip_ou_nulo(p_ip);
  if v_ip is null then
    raise exception 'sentinela: ip inválido' using errcode = '22023';
  end if;

  return sentinela.contexto(v_ip) || jsonb_build_object(
    'analises', coalesce((
      select jsonb_agg(sentinela.analise_json(a) order by a.criado_em desc, a.id desc)
        from sentinela.analises a
       where a.id in (select a2.id from sentinela.analises a2 where a2.ip = v_ip
                       order by a2.criado_em desc, a2.id desc limit 10)), '[]'::jsonb),
    'confiaveis', coalesce((
      select jsonb_agg(sentinela.confiavel_json(c) order by c.criado_em desc, c.id desc)
        from sentinela.confiaveis c
       where c.removido_em is null and (c.expira_em is null or c.expira_em > now()) and c.rede >>= v_ip), '[]'::jsonb));
end $$;

create or replace function public.sentinela_lista_bloqueios(p_incluir_inativos boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = sentinela, public, extensions, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'sentinela: acesso restrito ao TI' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(sentinela.bloqueio_json(b) order by b.criado_em desc, b.id desc)
      from sentinela.bloqueios b
     where b.id in (select b2.id from sentinela.bloqueios b2
                     where coalesce(p_incluir_inativos, false)
                        or (b2.revogado_em is null and (b2.expira_em is null or b2.expira_em > now()))
                     order by b2.criado_em desc, b2.id desc
                     limit 2000)), '[]'::jsonb);
end $$;

create or replace function public.sentinela_lista_confiaveis()
returns jsonb
language plpgsql
stable
security definer
set search_path = sentinela, public, extensions, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'sentinela: acesso restrito ao TI' using errcode = '42501';
  end if;
  -- removidos ficam de fora; vencidos aparecem com "ativo": false
  return coalesce((
    select jsonb_agg(sentinela.confiavel_json(c) order by c.criado_em desc, c.id desc)
      from sentinela.confiaveis c
     where c.id in (select c2.id from sentinela.confiaveis c2 where c2.removido_em is null
                     order by c2.criado_em desc, c2.id desc limit 2000)), '[]'::jsonb);
end $$;

create or replace function public.sentinela_lista_analises(p_limite int default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = sentinela, public, extensions, pg_temp
as $$
declare
  v_lim int := least(greatest(coalesce(p_limite, 100), 1), 1000);
begin
  if not public.is_admin() then
    raise exception 'sentinela: acesso restrito ao TI' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(sentinela.analise_json(a) order by a.criado_em desc, a.id desc)
      from sentinela.analises a
     where a.id in (select a2.id from sentinela.analises a2 order by a2.criado_em desc, a2.id desc limit v_lim)),
    '[]'::jsonb);
end $$;

create or replace function public.sentinela_lista_exposicoes()
returns jsonb
language plpgsql
stable
security definer
set search_path = sentinela, public, extensions, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'sentinela: acesso restrito ao TI' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', x.id, 'sistema', x.sistema, 'severidade', x.severidade, 'titulo', x.titulo, 'evidencia', x.evidencia,
             'recomendacao', x.recomendacao, 'status', x.status, 'decisao', x.decisao,
             'verificado_em', sentinela.iso(x.verificado_em), 'atualizado_em', sentinela.iso(x.atualizado_em))
           order by case x.severidade when 'critica' then 1 when 'alta' then 2 when 'media' then 3 else 4 end,
                    case x.status when 'aberta' then 1 when 'aceita' then 2 else 3 end, x.id)
      from sentinela.exposicoes x), '[]'::jsonb);
end $$;

create or replace function public.sentinela_config_ler()
returns jsonb
language plpgsql
stable
security definer
set search_path = sentinela, public, extensions, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'sentinela: acesso restrito ao TI' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'config', (select jsonb_build_object(
                 'modo', c.modo, 'casa_nome', c.casa_nome, 'casa_lat', c.casa_lat, 'casa_lon', c.casa_lon,
                 'limite_rajada_min', c.limite_rajada_min, 'limite_eventos_ip_min', c.limite_eventos_ip_min,
                 'ia_limite_hora', c.ia_limite_hora, 'ia_confianca_min', c.ia_confianca_min,
                 'ia_status', c.ia_status, 'ia_status_detalhe', c.ia_status_detalhe, 'ia_status_em', sentinela.iso(c.ia_status_em),
                 'tor_atualizado_em', sentinela.iso(c.tor_atualizado_em), 'manutencao_em', sentinela.iso(c.manutencao_em),
                 'retencao_dias', c.retencao_dias, 'atualizado_em', sentinela.iso(c.atualizado_em),
                 'atualizado_por', c.atualizado_por)
                 from sentinela.config c where c.id),
    'sistemas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'projeto_id', s.projeto_id, 'projeto', s.projeto, 'nome', s.nome, 'url', s.url,
               'sistema_slug', s.sistema_slug, 'exige_login', s.exige_login,
               'rotas_publicas', to_jsonb(s.rotas_publicas), 'arquivos_proibidos', to_jsonb(s.arquivos_proibidos),
               'ultimo_sinal', sentinela.iso(s.ultimo_sinal), 'guarda_versao', s.guarda_versao,
               'guarda_runtime', s.guarda_runtime, 'ultimo_ambiente', s.ultimo_ambiente, 'ativo', s.ativo)
             order by (s.sistema_slug is not null), s.nome)
        from sentinela.sistemas s), '[]'::jsonb));
end $$;

create or replace function public.sentinela_acao(p_acao text, p_dados jsonb)
returns jsonb
language plpgsql
security definer
set search_path = sentinela, public, extensions, pg_temp
as $$
declare
  d jsonb := coalesce(p_dados, '{}'::jsonb);
  v_email text;
  v_res jsonb;
  v_rede cidr;
  v_tipo text;
  v_valor text;
  v_exp timestamptz;
  v_id bigint;
  v_n int;
  v_txt text;
  v_num numeric;
  v_num2 numeric;
  v_int int;
  v_rotas text[];
  v_arqs text[];
  b record;
begin
  if not public.is_admin() then
    raise exception 'sentinela: acesso restrito ao TI' using errcode = '42501';
  end if;
  v_email := left(coalesce(nullif(auth.jwt()->>'email', ''), auth.uid()::text, 'admin'), 200);
  if jsonb_typeof(d) <> 'object' then
    raise exception 'sentinela: dados devem ser um objeto JSON' using errcode = '22023';
  end if;
  if pg_column_size(d) > 20000 then
    raise exception 'sentinela: dados grandes demais' using errcode = '22023';
  end if;

  case coalesce(p_acao, '')

  when 'bloquear' then
    v_rede := sentinela.rede_valida(d->>'valor');
    v_tipo := case when masklen(v_rede) = case when family(v_rede) = 4 then 32 else 128 end then 'ip' else 'cidr' end;
    v_valor := case when v_tipo = 'ip' then host(v_rede) else v_rede::text end;
    if coalesce(d->>'duracao', '') not in ('1h','24h','7d','permanente') then
      raise exception 'sentinela: duração inválida (1h, 24h, 7d ou permanente)' using errcode = '22023';
    end if;
    v_exp := case d->>'duracao' when '1h' then now() + interval '1 hour'
                                when '24h' then now() + interval '24 hours'
                                when '7d' then now() + interval '7 days'
                                else null end;
    v_txt := sentinela.txt(d->>'motivo', 200);
    if v_txt is null then
      raise exception 'sentinela: informe o motivo do bloqueio' using errcode = '22023';
    end if;
    select * into b from sentinela.bloquear(v_tipo, v_valor, v_rede, 'certo', 'manual', 'manual', v_txt, v_exp, v_email);
    v_res := jsonb_build_object('ok', true, 'id', b.bloqueio_id, 'novo', b.novo, 'ate', sentinela.iso(b.ate),
               'confiavel', exists (select 1 from sentinela.confiaveis c
                                     where c.removido_em is null and (c.expira_em is null or c.expira_em > now())
                                       and c.rede && v_rede));

  when 'desbloquear' then
    v_id := sentinela.big_ou_nulo(d->>'id');
    if v_id is null then
      raise exception 'sentinela: id inválido' using errcode = '22023';
    end if;
    update sentinela.bloqueios bl
       set revogado_em = now(), revogado_por = v_email
     where bl.id = v_id and bl.revogado_em is null;
    if not found then
      raise exception 'sentinela: bloqueio não encontrado ou já revogado' using errcode = 'P0002';
    end if;
    v_res := jsonb_build_object('ok', true, 'id', v_id);

  when 'confiar' then
    v_rede := sentinela.rede_valida(d->>'valor');
    v_tipo := case when masklen(v_rede) = case when family(v_rede) = 4 then 32 else 128 end then 'ip' else 'cidr' end;
    v_valor := case when v_tipo = 'ip' then host(v_rede) else v_rede::text end;
    v_txt := sentinela.txt(d->>'descricao', 200);
    if v_txt is null then
      raise exception 'sentinela: informe a descrição (de quem é este IP ou rede)' using errcode = '22023';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('sentinela.confiavel|' || v_rede::text, 0));
    select c.id into v_id
      from sentinela.confiaveis c
     where c.origem = 'manual' and c.rede = v_rede and c.removido_em is null
       and (c.expira_em is null or c.expira_em > now())
     order by c.criado_em desc
     limit 1;
    if v_id is not null then
      update sentinela.confiaveis c set descricao = v_txt where c.id = v_id;
    else
      insert into sentinela.confiaveis (tipo, valor, rede, descricao, origem, criado_por)
      values (v_tipo, v_valor, v_rede, v_txt, 'manual', v_email)
      returning id into v_id;
    end if;
    -- confiável não fica com bloqueio automático: revoga os de regra/IA que encostam na rede
    -- (&&: inclui o /64 automático de IPv6 que contém um IP confiado)
    update sentinela.bloqueios bl
       set revogado_em = now(), revogado_por = left(v_email || ' (confiar)', 200)
     where bl.revogado_em is null and (bl.expira_em is null or bl.expira_em > now())
       and bl.origem in ('regra','ia') and bl.rede && v_rede;
    get diagnostics v_n = row_count;
    v_res := jsonb_build_object('ok', true, 'id', v_id, 'bloqueios_revogados', v_n);

  when 'desconfiar' then
    v_id := sentinela.big_ou_nulo(d->>'id');
    if v_id is null then
      raise exception 'sentinela: id inválido' using errcode = '22023';
    end if;
    update sentinela.confiaveis c set removido_em = now() where c.id = v_id and c.removido_em is null;
    if not found then
      raise exception 'sentinela: confiável não encontrado ou já removido' using errcode = 'P0002';
    end if;
    v_res := jsonb_build_object('ok', true, 'id', v_id);

  when 'modo' then
    if coalesce(d->>'modo', '') not in ('observar','proteger') then
      raise exception 'sentinela: modo inválido (observar ou proteger)' using errcode = '22023';
    end if;
    update sentinela.config c
       set modo = d->>'modo', atualizado_em = now(), atualizado_por = v_email
     where c.id;
    v_res := jsonb_build_object('ok', true, 'modo', d->>'modo');

  when 'casa' then
    v_txt := sentinela.txt(d->>'nome', 80);
    v_num := sentinela.num_ou_nulo(d->>'lat');
    v_num2 := sentinela.num_ou_nulo(d->>'lon');
    if v_txt is null then
      raise exception 'sentinela: informe o nome da casa' using errcode = '22023';
    end if;
    if v_num is null or v_num not between -90 and 90 or v_num2 is null or v_num2 not between -180 and 180 then
      raise exception 'sentinela: latitude (-90 a 90) e longitude (-180 a 180) inválidas' using errcode = '22023';
    end if;
    update sentinela.config c
       set casa_nome = v_txt, casa_lat = v_num, casa_lon = v_num2, atualizado_em = now(), atualizado_por = v_email
     where c.id;
    v_res := jsonb_build_object('ok', true);

  when 'sistema' then
    v_txt := sentinela.txt(d->>'projeto', 100);
    if v_txt is null or not exists (select 1 from sentinela.sistemas s where s.projeto = v_txt) then
      raise exception 'sentinela: sistema não encontrado' using errcode = 'P0002';
    end if;
    if d->'exige_login' is not null and jsonb_typeof(d->'exige_login') <> 'boolean' then
      raise exception 'sentinela: exige_login deve ser verdadeiro ou falso' using errcode = '22023';
    end if;
    if d->'rotas_publicas' is not null then
      -- rota vazia ("" ou só espaços) é recusada, não ignorada: o admin vê o erro em vez de
      -- achar que salvou uma rota. A LISTA vazia ([]) continua valendo: nenhuma rota pública.
      if jsonb_typeof(d->'rotas_publicas') = 'array'
         and exists (select 1 from jsonb_array_elements(d->'rotas_publicas') x
                      where jsonb_typeof(x) = 'string' and btrim(x #>> '{}') = '') then
        raise exception 'sentinela: rota pública vazia' using errcode = '22023';
      end if;
      v_rotas := sentinela.lista_textos(d->'rotas_publicas', 'rotas_publicas', 50, 200, false);
      -- "/" e "/*" (e "*") casam com qualquer caminho no guarda: desligariam o exige_login inteiro
      if exists (select 1 from unnest(v_rotas) t where t in ('/', '/*', '*')) then
        raise exception 'sentinela: rota pública "/", "/*" ou "*" libera o sistema inteiro; para isso desligue exige_login'
          using errcode = '22023';
      end if;
      -- cada rota é "/" seguida de pelo menos um caractere
      if exists (select 1 from unnest(v_rotas) t where t !~ '^/.') then
        raise exception 'sentinela: cada rota pública deve começar com / seguida do caminho (ex.: /acompanhar)'
          using errcode = '22023';
      end if;
    end if;
    if d->'arquivos_proibidos' is not null then
      v_arqs := sentinela.lista_textos(d->'arquivos_proibidos', 'arquivos_proibidos', 50, 200, true);
    end if;
    update sentinela.sistemas s
       set exige_login        = case when d->'exige_login' is not null then (d->>'exige_login')::boolean else s.exige_login end,
           rotas_publicas     = case when d->'rotas_publicas' is not null then v_rotas else s.rotas_publicas end,
           arquivos_proibidos = case when d->'arquivos_proibidos' is not null then v_arqs else s.arquivos_proibidos end
     where s.projeto = v_txt;
    v_res := jsonb_build_object('ok', true, 'projeto', v_txt);

  when 'exposicao' then
    v_id := sentinela.big_ou_nulo(d->>'id');
    if v_id is null then
      raise exception 'sentinela: id inválido' using errcode = '22023';
    end if;
    if coalesce(d->>'status', '') not in ('aberta','aceita','corrigida') then
      raise exception 'sentinela: status inválido (aberta, aceita ou corrigida)' using errcode = '22023';
    end if;
    update sentinela.exposicoes x
       set status = d->>'status',
           decisao = case when d->'decisao' is not null then sentinela.txt(d->>'decisao', 500) else x.decisao end,
           atualizado_em = now()
     where x.id = v_id;
    if not found then
      raise exception 'sentinela: exposição não encontrada' using errcode = 'P0002';
    end if;
    v_res := jsonb_build_object('ok', true, 'id', v_id);

  when 'limites' then
    -- só os três do contrato. Retenção e teto de gravação não mudam pelo painel (só por
    -- migração): uma sessão de admin roubada não pode apagar a trilha nem reduzir o registro.
    if exists (select 1 from jsonb_object_keys(d) k
                where k not in ('limite_rajada_min','ia_limite_hora','ia_confianca_min')) then
      raise exception 'sentinela: limites aceita só limite_rajada_min, ia_limite_hora e ia_confianca_min'
        using errcode = '22023';
    end if;
    if d->'limite_rajada_min' is null and d->'ia_limite_hora' is null and d->'ia_confianca_min' is null then
      raise exception 'sentinela: nenhum limite informado' using errcode = '22023';
    end if;
    if d->'limite_rajada_min' is not null then
      v_int := sentinela.int_ou_nulo(d->>'limite_rajada_min');
      if v_int is null or v_int not between 10 and 100000 then
        raise exception 'sentinela: limite_rajada_min deve ser inteiro entre 10 e 100000' using errcode = '22023';
      end if;
      update sentinela.config c set limite_rajada_min = v_int where c.id;
    end if;
    if d->'ia_limite_hora' is not null then
      v_int := sentinela.int_ou_nulo(d->>'ia_limite_hora');
      if v_int is null or v_int not between 0 and 1000 then
        raise exception 'sentinela: ia_limite_hora deve ser inteiro entre 0 e 1000' using errcode = '22023';
      end if;
      update sentinela.config c set ia_limite_hora = v_int where c.id;
    end if;
    if d->'ia_confianca_min' is not null then
      v_num := sentinela.num_ou_nulo(d->>'ia_confianca_min');
      if v_num is null or v_num not between 0.5 and 1 then
        raise exception 'sentinela: ia_confianca_min deve ficar entre 0,5 e 1' using errcode = '22023';
      end if;
      update sentinela.config c set ia_confianca_min = v_num where c.id;
    end if;
    update sentinela.config c set atualizado_em = now(), atualizado_por = v_email where c.id;
    v_res := jsonb_build_object('ok', true);

  else
    raise exception 'sentinela: ação desconhecida' using errcode = '22023';
  end case;

  insert into sentinela.acoes_admin (email, acao, dados) values (v_email, p_acao, d);
  return v_res;
end $$;

create or replace function public.sentinela_verificar_cadeia(p_limite int default 5000)
returns jsonb
language plpgsql
stable
security definer
set search_path = sentinela, public, extensions, pg_temp
as $$
declare
  v_lim int := least(greatest(coalesce(p_limite, 5000), 1), 100000);
  v_cad sentinela.cadeia;
  ev sentinela.eventos;
  v_ancora bigint;
  v_prev text;
  v_tem_prev boolean := false;
  v_n int := 0;
  v_desde bigint;
  v_ate bigint;
  v_quebra bigint;
  v_detalhe text;
  v_ret int;
begin
  if not public.is_admin() then
    raise exception 'sentinela: acesso restrito ao TI' using errcode = '42501';
  end if;
  select * into v_cad from sentinela.cadeia k where k.id;

  -- o registro logo antes da janela serve só de âncora para o primeiro elo
  select e.id into v_ancora from sentinela.eventos e order by e.id desc offset v_lim limit 1;

  for ev in select * from sentinela.eventos e where v_ancora is null or e.id >= v_ancora order by e.id loop
    if ev.id = v_ancora then
      v_prev := ev.selo;
      v_tem_prev := true;
      continue;
    end if;
    v_n := v_n + 1;
    v_desde := coalesce(v_desde, ev.id);
    v_ate := ev.id;
    if v_tem_prev and ev.selo_anterior is distinct from v_prev then
      v_quebra := ev.id;
      v_detalhe := 'elo quebrado: o selo anterior não confere com o registro anterior';
      exit;
    end if;
    if sentinela.selo(ev) is distinct from ev.selo then
      v_quebra := ev.id;
      v_detalhe := 'o selo não confere com o conteúdo do registro';
      exit;
    end if;
    -- o registro nunca grava "|" antes do user-agent; se aparecer, alguém moveu texto entre
    -- campos do selo (o canon com "|" não muda, mas o registro foi alterado)
    if strpos(concat(ev.projeto, ev.metodo, ev.caminho, ev.decisao, ev.regra, ev.identidade), '|') > 0 then
      v_quebra := ev.id;
      v_detalhe := 'campo com "|" (separador do selo): conteúdo deslocado entre campos';
      exit;
    end if;
    v_prev := ev.selo;
    v_tem_prev := true;
  end loop;

  if v_quebra is null then
    if v_ate is not null and (v_cad.ultimo_id is distinct from v_ate or v_cad.ultimo_selo is distinct from v_prev) then
      v_quebra := v_ate;
      v_detalhe := 'o fim da cadeia não confere com o último registro (registros finais removidos ou alterados)';
    elsif v_ate is null and v_cad.ultimo_id is not null then
      select c.retencao_dias into v_ret from sentinela.config c where c.id;
      if v_cad.atualizado_em > now() - make_interval(days => greatest(coalesce(v_ret, 90), 7)) then
        v_quebra := v_cad.ultimo_id;
        v_detalhe := 'nenhum registro encontrado, mas a cadeia aponta para um registro recente';
      end if;
    end if;
  end if;

  return jsonb_build_object('ok', v_quebra is null, 'verificados', v_n, 'desde_id', v_desde, 'ate_id', v_ate,
                            'quebra_id', v_quebra, 'ultimo_selo', v_cad.ultimo_selo, 'detalhe', v_detalhe);
end $$;

-- ---------------------------------------------------------
-- 6. PRIVILÉGIOS (antes dos seeds: se um seed falhar, as funções já estão fechadas)
--    anon: nada. authenticated: só as de painel (e elas exigem is_admin).
--    service_role: as srv_*. Ajudantes e tabelas: ninguém pela API.
-- ---------------------------------------------------------
revoke all on all tables    in schema sentinela from public, anon, authenticated;
revoke all on all sequences in schema sentinela from public, anon, authenticated;
revoke all on all functions in schema sentinela from public, anon, authenticated;

revoke execute on function public.sentinela_srv_lista(text)                              from public, anon, authenticated;
revoke execute on function public.sentinela_srv_registrar(text, text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.sentinela_srv_contexto_ip(text)                        from public, anon, authenticated;
revoke execute on function public.sentinela_srv_registrar_analise(text, jsonb)           from public, anon, authenticated;
revoke execute on function public.sentinela_srv_ia_cota()                                from public, anon, authenticated;
revoke execute on function public.sentinela_srv_ia_status(text, text)                    from public, anon, authenticated;
revoke execute on function public.sentinela_srv_identidade(text, uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.sentinela_srv_tentativa(text, text, text)              from public, anon, authenticated;
revoke execute on function public.sentinela_srv_permissao(uuid, text)                    from public, anon, authenticated;
revoke execute on function public.sentinela_srv_passe_usar(text, text, text)             from public, anon, authenticated;
revoke execute on function public.sentinela_srv_chave_ativa()                            from public, anon, authenticated;
revoke execute on function public.sentinela_srv_chave_criar(text, jsonb, text)           from public, anon, authenticated;
revoke execute on function public.sentinela_srv_chaves_publicas()                        from public, anon, authenticated;
revoke execute on function public.sentinela_srv_tor_atualizar(text[])                    from public, anon, authenticated;
revoke execute on function public.sentinela_srv_manutencao()                             from public, anon, authenticated;

grant execute on function public.sentinela_srv_lista(text)                              to service_role;
grant execute on function public.sentinela_srv_registrar(text, text, text, text, jsonb) to service_role;
grant execute on function public.sentinela_srv_contexto_ip(text)                        to service_role;
grant execute on function public.sentinela_srv_registrar_analise(text, jsonb)           to service_role;
grant execute on function public.sentinela_srv_ia_cota()                                to service_role;
grant execute on function public.sentinela_srv_ia_status(text, text)                    to service_role;
grant execute on function public.sentinela_srv_identidade(text, uuid, text, text, text) to service_role;
grant execute on function public.sentinela_srv_tentativa(text, text, text)              to service_role;
grant execute on function public.sentinela_srv_permissao(uuid, text)                    to service_role;
grant execute on function public.sentinela_srv_passe_usar(text, text, text)             to service_role;
grant execute on function public.sentinela_srv_chave_ativa()                            to service_role;
grant execute on function public.sentinela_srv_chave_criar(text, jsonb, text)           to service_role;
grant execute on function public.sentinela_srv_chaves_publicas()                        to service_role;
grant execute on function public.sentinela_srv_tor_atualizar(text[])                    to service_role;
grant execute on function public.sentinela_srv_manutencao()                             to service_role;

revoke execute on function public.sentinela_painel(int)                  from public, anon;
revoke execute on function public.sentinela_novos(bigint)                from public, anon;
revoke execute on function public.sentinela_ip(text)                     from public, anon;
revoke execute on function public.sentinela_lista_bloqueios(boolean)     from public, anon;
revoke execute on function public.sentinela_lista_confiaveis()           from public, anon;
revoke execute on function public.sentinela_lista_analises(int)          from public, anon;
revoke execute on function public.sentinela_lista_exposicoes()           from public, anon;
revoke execute on function public.sentinela_config_ler()                 from public, anon;
revoke execute on function public.sentinela_acao(text, jsonb)            from public, anon;
revoke execute on function public.sentinela_verificar_cadeia(int)        from public, anon;

grant execute on function public.sentinela_painel(int)                   to authenticated;
grant execute on function public.sentinela_novos(bigint)                 to authenticated;
grant execute on function public.sentinela_ip(text)                      to authenticated;
grant execute on function public.sentinela_lista_bloqueios(boolean)      to authenticated;
grant execute on function public.sentinela_lista_confiaveis()            to authenticated;
grant execute on function public.sentinela_lista_analises(int)           to authenticated;
grant execute on function public.sentinela_lista_exposicoes()            to authenticated;
grant execute on function public.sentinela_config_ler()                  to authenticated;
grant execute on function public.sentinela_acao(text, jsonb)             to authenticated;
grant execute on function public.sentinela_verificar_cadeia(int)         to authenticated;

-- ---------------------------------------------------------
-- 7. SEEDS
-- ---------------------------------------------------------
insert into sentinela.config (id) values (true) on conflict (id) do nothing;
insert into sentinela.cadeia (id) values (true) on conflict (id) do nothing;

insert into sentinela.sistemas (projeto_id, projeto, nome, url, sistema_slug, arquivos_proibidos) values
  ('prj_WGmlGvONBuausosdw6AgnDhrCnge', 'painel-lube-distribuidora', 'Painel Lube',
   'https://painel-lube-distribuidora.vercel.app', null,
   array['^/db/', '^/supabase/', '^/\.claude/', '^/README\.md$', '^/guarda/']),
  ('prj_DcJI82KyPyvSc4eUMuL9iJV6I7cp', 'painel-compras', 'BI Compras',
   'https://painel-compras-rosy.vercel.app', 'gestao-compras', '{}'),
  ('prj_YZjoZIiVcDyuWVzNVXMuApfiDGYt', 'gestao-comercial-web', 'BI Comercial',
   'https://gestao-comercial-web-three.vercel.app', 'gestao-comercial',
   array['^/db/']),
  ('prj_1TWb4V3Cl1m9CbOwhoXuw8fdzHwR', 'gestao-finaceiro', 'Gestão Financeiro',
   'https://gestao-finaceiro.vercel.app', 'gestao-financeiro', '{}'),
  ('prj_sxnusj4EGtvYF30N5VxoyBbleW83', 'gestao-ti', 'Gestão TI',
   'https://gestao-ti-ruddy.vercel.app', 'gestao-ti', '{}'),
  ('prj_DVpjRACXDvWA5e3x87ettwPn1sJL', 'rh-absentismo', 'RH Absenteísmo',
   'https://rh-absentismo.vercel.app', 'rh-absenteismo',
   array['\.(xlsx?|csv|sql|ps1)$', '^/planilhas', '^/migrations/', '^/dashboard_dataset\.json$',
         '^/powerbi_data\.json$', '^/generate-config\.js$', '^/README\.md$', '^/verify_', '^/deploy_schema',
         '^/migrate_data']),
  ('prj_ObANJiC1HKBSzrUPQdU79V4VEnLR', 'gestao-de-saidas-de-veiculos', 'Saída de Veículos',
   'https://gestao-de-saidas-de-veiculos.vercel.app', 'saida-veiculos',
   array['^/processar\.py$', '^/PLANILHAS REFERENCIAS/', '^/design do sistema', '^/README\.md$']),
  ('prj_5h9PoHWB6qCeoEhUNzQ4RVxnGrbn', 'painel-icms', 'Painel ICMS',
   'https://painel-icms.vercel.app', 'painel-icms', '{}')
on conflict (projeto_id) do nothing;

-- Exposições verificadas em 2026-10-05 (seção 6). Não duplica se rodar de novo.
insert into sentinela.exposicoes (sistema, severidade, titulo, evidencia, recomendacao, status, decisao)
select v.sistema, v.severidade, v.titulo, v.evidencia, v.recomendacao, v.status, v.decisao
  from (values
    ('Gestão Financeiro', 'critica', 'Folha de pagamento aberta no endereço principal',
     'GET https://gestao-finaceiro.vercel.app/api/dados respondeu 200 sem login (66 KB: 21 colaboradores com salário contratual, líquido e rubricas; 203 nomes). A proteção "Standard" da Vercel cobre só as URLs de deploy, não o domínio de produção.',
     'Ligar "exige login" deste sistema na Sentinela (porta do Painel Lube).',
     'aceita', 'Júlio decidiu manter aberto por enquanto (2026-10-05).'),
    ('BI Comercial', 'alta', 'Comissão por RCA aberta no endereço principal',
     'GET https://gestao-comercial-web-three.vercel.app/api/dados respondeu 200 sem login (223 KB). /db/*.sql também publicados.',
     'Ligar "exige login"; tirar web/db do que é publicado.',
     'aceita', 'Júlio decidiu manter como está (2026-10-05).'),
    ('RH Absenteísmo', 'critica', 'Banco aceita leitura, alteração e exclusão anônimas',
     'pg_policies: as 11 tabelas públicas têm política para o papel public com USING(true)/WITH CHECK(true); a chave anon é servida em /supabase-config.js (200).',
     'Login no app + RLS por usuário; depois trocar a chave. O guarda não protege acesso direto ao banco.',
     'aceita', 'Júlio decidiu manter como está (2026-10-05).'),
    ('RH Absenteísmo', 'alta', 'Site publica o repositório inteiro',
     'outputDirectory "." — /dashboard_dataset.json (200), planilhas, SQL e scripts acessíveis sem login.',
     'Ativar os arquivos proibidos no modo proteger; mover dados para fora do que é publicado.',
     'aceita', 'Júlio decidiu manter como está (2026-10-05).'),
    ('Painel ICMS', 'alta', 'Login desligado "temporariamente" e banco com políticas TEMP para anônimo',
     'AUTH_DESLIGADA_TEMPORARIAMENTE = true; anon lê periodos, lê/grava pedidos_atualizacao (que aciona consulta ao WinThor) e gera URL das planilhas. /api/assistente aberto (gasta crédito da Anthropic).',
     'Religar o login; remover políticas TEMP; exigir sessão no /api/assistente.',
     'aberta', null),
    ('Saída de Veículos', 'alta', 'Sistema público e banco aceita inserção anônima',
     'Produção 200 sem login; dados.json e planilhas públicos; políticas permitem SELECT e INSERT para anon.',
     'Login + RLS; ligar "exige login" na Sentinela.',
     'aberta', null),
    ('BI Compras', 'media', 'Assistente de IA aberto para qualquer pessoa',
     'POST /api/agente sem autenticação nem limite repassa até 60 mensagens à Anthropic com a chave do projeto.',
     'Limitar por origem/sessão e taxa; ou ligar "exige login".',
     'aberta', null),
    ('BI Compras', 'baixa', 'Painel aberto por decisão',
     'Sem proteção desde 2026-09-22 (faturamento, margem e custo por fornecedor).',
     '—',
     'aceita', 'Decisão do Júlio em 2026-09-22.'),
    ('RH Absenteísmo', 'media', 'Rotas de IA abertas (custo Gemini)',
     '/api/diagnostico e /api/assistente aceitam POST anônimo.',
     'Exigir sessão/limite.',
     'aberta', null),
    ('Gestão TI', 'media', 'Três rotas dependem só do middleware',
     '/api/chamados (GET), /api/notas-avulsas/[id]/documentos e /api/pendencias não checam sessão por conta própria.',
     'Checagem de sessão em cada rota.',
     'aberta', null),
    ('Painel Lube', 'media', 'Proteção contra senha vazada desligada',
     'Advisor do Supabase: leaked password protection off no projeto do portal.',
     'Ligar em Authentication › Passwords.',
     'aberta', null),
    ('Painel Lube', 'baixa', 'Arquivos internos publicados',
     '/db/01_schema.sql, /supabase/functions/admin-users/index.ts e /.claude/launch.json respondem 200.',
     'Arquivos proibidos no modo proteger, ou mover para fora do output.',
     'aberta', null),
    ('Conta Vercel', 'media', 'Plano Hobby em uso empresarial',
     'Termos da Vercel: Hobby só para uso pessoal e não comercial. Limita firewall (3 IP blocks/projeto), sem Log Drains, logs de 1 h.',
     'Avaliar plano Pro.',
     'aberta', null)
  ) as v(sistema, severidade, titulo, evidencia, recomendacao, status, decisao)
 where not exists (select 1 from sentinela.exposicoes x where x.sistema = v.sistema and x.titulo = v.titulo);
