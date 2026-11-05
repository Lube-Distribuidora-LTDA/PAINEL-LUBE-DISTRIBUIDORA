-- =========================================================
-- SENTINELA — liberação fora da rede SEM PRAZO, para UMA pessoa só.
--
-- Pedido do Júlio (2026-11-05): "preciso que libere o acesso do ANDERSON SILVA (g.comercial) para acessar fora
-- da rede sem um prazo, ele é o Único da empresa que pode acessar fora da rede sem prazo."
--
-- A liberação comum continua como era: com prazo (até 30 dias pelo painel, 90 no banco). A sem prazo é a mesma
-- linha de sentinela.rede_liberacoes, com sem_prazo = true e fim = 31/12/2099. O guarda, a central e o painel já
-- leem uma data de fim, então nada fora do banco muda, e nenhuma função que já existe é tocada.
-- No máximo UMA liberação sem prazo aberta na empresa (índice único). Para trocar de pessoa, encerre a atual
-- (painel da Sentinela › Encerrar) e rode a função de novo.
--
-- Uso, só no SQL Editor (como a emergencia_liberar):
--   select sentinela.liberar_sem_prazo('pessoa@lube.com.br', 'motivo de 5 a 300 caracteres', 'quem pediu');
-- Encerrar: pelo painel da Sentinela, ou
--   update sentinela.rede_liberacoes set encerrado_em = now(), encerrado_por = '<quem>'
--    where sem_prazo and encerrado_em is null;
-- =========================================================
set lock_timeout = '3s';

alter table sentinela.rede_liberacoes add column if not exists sem_prazo boolean not null default false;

-- o limite de 90 dias continua para todas, menos a sem prazo (que tem o fim fixo em 31/12/2099)
alter table sentinela.rede_liberacoes drop constraint if exists rede_liberacoes_check;
alter table sentinela.rede_liberacoes add constraint rede_liberacoes_check
  check (fim > inicio and (
           (not sem_prazo and fim <= inicio + interval '90 days')
        or (sem_prazo and fim = timestamptz '2099-12-31 23:59:59-03')));

-- uma só na empresa
create unique index if not exists rede_liberacoes_sem_prazo_uk
  on sentinela.rede_liberacoes ((true)) where sem_prazo and encerrado_em is null;

create or replace function sentinela.liberar_sem_prazo(p_email text, p_motivo text, p_por text)
returns text language plpgsql
set search_path = sentinela, public, extensions, pg_temp
as $$
declare
  v_perfil public.profiles;
  v_mail   text := lower(btrim(coalesce(p_email, '')));
  v_motivo text;
  v_por    text := sentinela.txt(p_por, 120);
  v_outra  text;
  v_id     bigint;
begin
  perform sentinela.so_sql_editor();
  select * into v_perfil from public.profiles p where lower(p.email) = v_mail and p.ativo limit 1;
  if v_perfil.id is null then
    raise exception 'sentinela: perfil ativo não encontrado para %', v_mail using errcode = '22023';
  end if;
  if v_mail !~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$' then
    raise exception 'sentinela: e-mail fora do padrão' using errcode = '22023';
  end if;
  v_motivo := sentinela.txt(p_motivo, 400);
  if v_motivo is null or char_length(v_motivo) not between 5 and 300 or v_motivo ~ '[[:cntrl:]]' then
    raise exception 'sentinela: informe o motivo (de 5 a 300 caracteres)' using errcode = '22023';
  end if;
  if v_por is null then
    raise exception 'sentinela: informe quem pediu' using errcode = '22023';
  end if;
  select l.email into v_outra from sentinela.rede_liberacoes l
   where l.sem_prazo and l.encerrado_em is null and l.user_id <> v_perfil.id limit 1;
  if v_outra is not null then
    raise exception 'sentinela: % já tem a única liberação sem prazo; encerre a dela antes', v_outra
      using errcode = '23505';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('sentinela.rede_liberacao|' || v_perfil.id::text, 0));
  -- uma aberta por pessoa: a anterior dela (com prazo ou sem) é encerrada ANTES de gravar a nova, senão o
  -- índice de "uma sem prazo só" recusa quem já tem a sem prazo e é liberado de novo
  update sentinela.rede_liberacoes l
     set encerrado_em = now(), encerrado_por = 'substituída pela liberação sem prazo'
   where l.user_id = v_perfil.id and l.encerrado_em is null and l.fim > now();
  insert into sentinela.rede_liberacoes (user_id, email, inicio, fim, motivo, criado_por, sem_prazo)
  values (v_perfil.id, v_mail, now(), timestamptz '2099-12-31 23:59:59-03', v_motivo, v_por, true)
  returning id into v_id;
  insert into sentinela.acoes_admin (email, acao, dados)
  values (v_por, 'rede_liberar_sem_prazo', jsonb_build_object('id', v_id, 'email', v_mail));
  return format('liberação #%s: %s sem prazo (fim gravado como 31/12/2099)', v_id, v_mail);
end $$;

revoke execute on function sentinela.liberar_sem_prazo(text, text, text) from public, anon, authenticated, service_role;
