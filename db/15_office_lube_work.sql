-- =========================================================
-- Lube Work (2026-11-09): as mensagens do banco com o nome novo
-- O LUBE OFFICE virou Lube Work (decisão do Júlio, 2026-11-06), e quem cadastra as salas é
-- "o administrador", nunca "o TI" (regra do Júlio, 2026-11-06). Só muda o texto das mensagens:
-- a função é regravada a partir dela mesma (pg_get_functiondef), sem tocar no resto.
-- Aplicada no Supabase do Painel como a migração office_v9_lube_work.
-- =========================================================
do $$
declare
  d text;
begin
  d := pg_get_functiondef('office.so_funcao()'::regprocedure);
  if position('função restrita ao LUBE OFFICE' in d) > 0 then
    execute replace(d, 'função restrita ao LUBE OFFICE', 'função restrita ao Lube Work');
  end if;

  d := pg_get_functiondef('public.office_srv_sala_salvar(uuid,uuid,jsonb)'::regprocedure);
  if position('só o TI cadastra salas' in d) > 0 then
    execute replace(d, 'só o TI cadastra salas', 'só o administrador cadastra salas');
  end if;
end $$;
