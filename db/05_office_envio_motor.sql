-- =========================================================
-- LUBE OFFICE v2 (2026-10-21)
-- 1. O motor de edição roda na SRV-IA e sai para a internet por um túnel da
--    Cloudflare cujo endereço muda quando o túnel reinicia: a SRV-IA registra o
--    endereço (assinado com a chave do motor) e a função lê daqui.
-- 2. Nada de baixar (pedido do Júlio): o arquivo sai do painel só pelo "Enviar",
--    para alguém do painel (ganha acesso e aviso no sino) ou por e-mail (anexo).
--    Só quem pode editar envia, e todo envio fica na atividade do arquivo.
-- =========================================================

create table if not exists office.config (
  chave         text primary key,
  valor         jsonb not null default '{}',
  atualizado_em timestamptz not null default now()
);
alter table office.config enable row level security;
revoke all on office.config from public, anon, authenticated;

alter table office.avisos drop constraint if exists avisos_tipo_check;
alter table office.avisos add constraint avisos_tipo_check check (tipo in ('mencao', 'compartilhou', 'enviou'));

-- a SRV-IA avisa o endereço do motor (a cada início do túnel e de 5 em 5 minutos)
create or replace function public.office_srv_motor_registrar(p_url text, p_info jsonb)
returns jsonb language plpgsql security definer
set search_path = office, public, extensions, pg_temp
as $$
declare
  v_url text := rtrim(btrim(coalesce(p_url, '')), '/');
  v_antes jsonb;
begin
  perform office.so_funcao();
  if v_url !~ '^https://[a-z0-9.-]+(:[0-9]{2,5})?$' then
    perform office.erro('endereço do motor inválido', '22023');
  end if;
  select valor into v_antes from office.config where chave = 'motor';
  insert into office.config (chave, valor, atualizado_em)
  values ('motor', jsonb_build_object(
            'url', v_url, 'visto_em', now(), 'info', coalesce(p_info, '{}'::jsonb),
            'desde', case when v_antes->>'url' = v_url then coalesce(v_antes->'desde', to_jsonb(now())) else to_jsonb(now()) end),
          now())
  on conflict (chave) do update set valor = excluded.valor, atualizado_em = now();
  return (select valor from office.config where chave = 'motor');
end $$;

create or replace function public.office_srv_motor()
returns jsonb language plpgsql stable security definer
set search_path = office, public, extensions, pg_temp
as $$
begin
  perform office.so_funcao();
  return coalesce((select valor from office.config where chave = 'motor'), '{}'::jsonb);
end $$;

-- Enviar: pessoas do painel ganham acesso (se ainda não têm) e um aviso; os e-mails
-- de fora são conferidos aqui e a função manda o anexo. Só quem pode editar envia.
create or replace function public.office_srv_enviar(p_user uuid, p_arquivo uuid, p_internos jsonb, p_externos text[], p_mensagem text)
returns jsonb language plpgsql security definer
set search_path = office, public, extensions, pg_temp
as $$
declare
  v office.arquivos;
  v_papel int;
  i jsonb;
  v_pessoa uuid;
  v_p text;
  v_e text;
  v_msg text := left(btrim(coalesce(p_mensagem, '')), 1000);
  v_internos jsonb := '[]'::jsonb;
  v_externos text[] := '{}';
  v_invalidos text[] := '{}';
begin
  perform office.so_funcao(); perform office.exige_ativo(p_user);
  select * into v from office.arquivos where id = p_arquivo;
  v_papel := office.papel_arquivo(p_user, p_arquivo);
  if v.id is null or v_papel = 0 or not office.vivo_arquivo(p_arquivo) then
    perform office.erro('arquivo não encontrado ou sem acesso', 'P0002');
  end if;
  if v_papel < 3 then perform office.erro('só quem pode editar envia o arquivo', '42501'); end if;

  foreach v_e in array coalesce(p_externos, '{}') loop
    v_e := lower(btrim(v_e));
    continue when v_e = '';
    if v_e !~ '^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$' then
      v_invalidos := v_invalidos || v_e;
    elsif not (v_e = any(v_externos)) then
      v_externos := v_externos || v_e;
    end if;
  end loop;
  if cardinality(v_invalidos) > 0 then
    perform office.erro('e-mail inválido: ' || array_to_string(v_invalidos, ', '), '22023');
  end if;
  if cardinality(v_externos) > 20 then perform office.erro('no máximo 20 e-mails por envio', '22023'); end if;

  for i in select * from jsonb_array_elements(coalesce(p_internos, '[]'::jsonb)) loop
    begin
      v_pessoa := (i->>'pessoa')::uuid;
    exception when others then
      continue;
    end;
    v_p := coalesce(i->>'papel', 'ver');
    if v_p not in ('ver', 'comentar', 'editar') then v_p := 'ver'; end if;
    continue when v_pessoa = p_user;
    continue when not exists (select 1 from public.profiles where id = v_pessoa and ativo);
    if office.papel_arquivo(v_pessoa, p_arquivo) < office.nivel(v_p) then
      delete from office.compartilhamentos where arquivo = p_arquivo and pessoa = v_pessoa;
      insert into office.compartilhamentos (arquivo, pessoa, papel, criado_por) values (p_arquivo, v_pessoa, v_p, p_user);
    end if;
    insert into office.avisos (para, de, arquivo, tipo, mensagem) values (v_pessoa, p_user, p_arquivo, 'enviou', v_msg);
    v_internos := v_internos || office.json_pessoa(v_pessoa);
  end loop;

  if jsonb_array_length(v_internos) = 0 and cardinality(v_externos) = 0 then
    perform office.erro('escolha pelo menos uma pessoa do painel ou um e-mail', '22023');
  end if;
  if jsonb_array_length(v_internos) > 0 then
    perform office.registrar(p_user, 'enviou', p_arquivo, null,
      jsonb_build_object('internos', v_internos, 'mensagem', v_msg));
  end if;
  return jsonb_build_object(
    'arquivo', office.json_arquivo(p_user, v),
    'caminho', v.caminho, 'nome_arquivo', v.nome || '.' || v.extensao, 'extensao', v.extensao, 'tamanho', v.tamanho,
    'externos', to_jsonb(v_externos), 'internos', v_internos, 'remetente', office.json_pessoa(p_user),
    'mensagem', v_msg);
end $$;

-- o resultado do e-mail (saiu ou não) também fica na atividade
create or replace function public.office_srv_enviar_registrar(p_user uuid, p_arquivo uuid, p_externos text[], p_ok boolean, p_erro text)
returns void language plpgsql security definer
set search_path = office, public, extensions, pg_temp
as $$
begin
  perform office.so_funcao(); perform office.exige_ativo(p_user);
  perform office.registrar(p_user, case when p_ok then 'enviou_email' else 'email_falhou' end, p_arquivo, null,
    jsonb_build_object('externos', to_jsonb(coalesce(p_externos, '{}')), 'erro', left(coalesce(p_erro, ''), 300)));
end $$;

-- só a service_role executa (a Edge Function)
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
