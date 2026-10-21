-- =========================================================
-- LUBE OFFICE — teste de ponta a ponta do motor (2026-10-21)
-- Porta POST /office/motor/teste da Edge Function: abre um arquivo de teste no
-- editor sem login no painel, para o TI (ou o Claude) conferir o motor depois de
-- instalar ou reinstalar. Só funciona com uma senha de uso temporário gravada
-- por quem tem acesso ao banco (SQL), que vence sozinha:
--
--   insert into office.config (chave, valor) values ('teste_motor', jsonb_build_object(
--     'token', '<senha aleatória longa>', 'dono', '<id do perfil dono do arquivo de teste>',
--     'expira_em', now() + interval '30 minutes'))
--   on conflict (chave) do update set valor = excluded.valor, atualizado_em = now();
--
-- Depois do teste: delete from office.config where chave = 'teste_motor';
-- =========================================================

create or replace function public.office_srv_teste_motor(p_token text)
returns jsonb language plpgsql stable security definer
set search_path = office, public, extensions, pg_temp
as $$
declare v jsonb;
begin
  perform office.so_funcao();
  select valor into v from office.config where chave = 'teste_motor';
  if v is null or length(coalesce(p_token, '')) < 32 or v->>'token' is distinct from p_token
     or coalesce((v->>'expira_em')::timestamptz, '-infinity') < now() then
    perform office.erro('teste não autorizado', '42501');
  end if;
  perform office.exige_ativo((v->>'dono')::uuid);
  return jsonb_build_object('dono', v->>'dono', 'expira_em', v->>'expira_em');
end $$;

revoke execute on function public.office_srv_teste_motor(text) from public, anon, authenticated;
grant execute on function public.office_srv_teste_motor(text) to service_role;
