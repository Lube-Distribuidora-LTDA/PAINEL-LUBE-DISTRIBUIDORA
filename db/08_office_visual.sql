-- =========================================================
-- LUBE OFFICE — visual do editor (2026-10-22)
-- O topo do editor (ONLYOFFICE) com a cara da Lube: tema Lube Claro, cabeçalho compacto
-- (o nome do arquivo já está no topo do portal) e abas em linha.
-- Liga e desliga sem publicar código; vale para quem abrir um arquivo depois da troca:
--   novo:     update office.config set valor = '{"visual": "lube", "tema": "theme-lube-claro"}' where chave = 'editor';
--   de antes: update office.config set valor = '{"visual": "classico"}' where chave = 'editor';
-- O tema e a página tema-lube.html precisam estar no motor (INSTALAR TEMA LUBE.bat na
-- SRV-IA); sem eles o editor abre nas cores padrão do ONLYOFFICE.
-- =========================================================

insert into office.config (chave, valor) values ('editor', '{"visual": "classico"}')
on conflict (chave) do nothing;

create or replace function public.office_srv_editor()
returns jsonb language plpgsql stable security definer
set search_path = office, public, extensions, pg_temp
as $$
begin
  perform office.so_funcao();
  return coalesce((select valor from office.config where chave = 'editor'), '{}'::jsonb);
end $$;

-- só a service_role executa (a Edge Function)
revoke execute on function public.office_srv_editor() from public, anon, authenticated;
grant execute on function public.office_srv_editor() to service_role;
