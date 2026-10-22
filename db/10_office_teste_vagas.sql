-- =========================================================
-- LUBE OFFICE — porta de teste do motor com mais de uma vaga (2026-10-22)
-- Migração office_v6_teste_motor_vagas. A senha temporária do db/06 pode ficar na
-- chave 'teste_motor' ou em 'teste_motor_<nome>' (ex.: 'teste_motor_apresentacao'):
-- duas sessões de teste ao mesmo tempo não derrubam a senha uma da outra.
-- Apague a chave de teste ao terminar:
--   delete from office.config where chave = 'teste_motor_<nome>';
-- =========================================================

create or replace function public.office_srv_teste_motor(p_token text)
returns jsonb language plpgsql stable security definer
set search_path = office, public, extensions, pg_temp
as $$
declare v jsonb;
begin
  perform office.so_funcao();
  if length(coalesce(p_token, '')) < 32 then
    perform office.erro('teste não autorizado', '42501');
  end if;
  select valor into v from office.config
   where (chave = 'teste_motor' or chave like 'teste\_motor\_%')
     and valor->>'token' = p_token
     and coalesce((valor->>'expira_em')::timestamptz, '-infinity') >= now()
   limit 1;
  if v is null then
    perform office.erro('teste não autorizado', '42501');
  end if;
  perform office.exige_ativo((v->>'dono')::uuid);
  return jsonb_build_object('dono', v->>'dono', 'expira_em', v->>'expira_em');
end $$;

revoke execute on function public.office_srv_teste_motor(text) from public, anon, authenticated;
grant execute on function public.office_srv_teste_motor(text) to service_role;
