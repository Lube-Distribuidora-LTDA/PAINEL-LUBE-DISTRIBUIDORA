-- =========================================================
-- PAINEL LUBE — foto de perfil e aviso de novidade
-- (pedido do Júlio, 2026-11-10)
--
-- 1) profiles.foto: caminho da foto no bucket PRIVADO "avatares"
--    (<id da pessoa>/<arquivo>.jpg). Não é público: só quem está ativo no
--    painel lê as fotos dos colegas; cada um só grava e apaga a própria.
-- 2) meu_perfil_salvar: a própria pessoa troca o nome que aparece e a foto.
--    Ela não tem UPDATE em profiles (lá ficam is_admin, ativo, acesso_total);
--    a função mexe só em nome e foto da linha de quem chama.
-- 3) avisos_vistos: o aviso de novidade aparece uma vez por pessoa.
-- 4) office.json_pessoa leva a foto: aparece em todo o Lube Work.
-- =========================================================

alter table public.profiles add column if not exists foto text;

-- quem está ativo no painel (para ler as fotos dos colegas)
create or replace function public.painel_ativo()
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.ativo)
$$;
revoke all on function public.painel_ativo() from public, anon;
grant execute on function public.painel_ativo() to authenticated;

-- bucket privado, só imagem pequena (a tela já manda a foto recortada em 320 px)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatares', 'avatares', false, 524288, array['image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = false, file_size_limit = 524288, allowed_mime_types = array['image/jpeg', 'image/webp'];

drop policy if exists "avatares leitura de quem esta ativo" on storage.objects;
create policy "avatares leitura de quem esta ativo" on storage.objects
  for select to authenticated
  using (bucket_id = 'avatares'
         and (public.painel_ativo() or (storage.foldername(name))[1] = (select auth.uid())::text));

drop policy if exists "avatares envia a propria" on storage.objects;
create policy "avatares envia a propria" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatares' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "avatares troca a propria" on storage.objects;
create policy "avatares troca a propria" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatares' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'avatares' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "avatares apaga a propria" on storage.objects;
create policy "avatares apaga a propria" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatares'
         and ((storage.foldername(name))[1] = (select auth.uid())::text or public.is_admin()));

-- a própria pessoa salva o nome que aparece e a foto
create or replace function public.meu_perfil_salvar(
  p_nome text default null, p_foto text default null, p_tira_foto boolean default false)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_id   uuid := auth.uid();
  v_nome text;
  r      public.profiles;
begin
  if v_id is null then
    raise exception 'Entre no painel para salvar o perfil.' using errcode = '28000';
  end if;
  if p_nome is not null then
    v_nome := regexp_replace(btrim(p_nome), '\s+', ' ', 'g');
    if char_length(v_nome) < 2 or char_length(v_nome) > 60 then
      raise exception 'O nome precisa ter de 2 a 60 letras.' using errcode = '22023';
    end if;
  end if;
  -- só aceita arquivo da pasta da própria pessoa
  if p_foto is not null and p_foto !~ ('^' || v_id::text || '/[A-Za-z0-9_-]{1,40}\.(jpg|webp)$') then
    raise exception 'Foto inválida.' using errcode = '22023';
  end if;

  update public.profiles
     set nome = coalesce(v_nome, nome),
         foto = case when coalesce(p_tira_foto, false) then null
                     when p_foto is not null then p_foto
                     else foto end,
         atualizado_em = now()
   where id = v_id
  returning * into r;
  if not found then
    raise exception 'Perfil não encontrado.' using errcode = 'P0002';
  end if;
  return jsonb_build_object('nome', r.nome, 'foto', r.foto);
end
$$;
revoke all on function public.meu_perfil_salvar(text, text, boolean) from public, anon;
grant execute on function public.meu_perfil_salvar(text, text, boolean) to authenticated;

-- aviso de novidade: uma vez por pessoa (vale em qualquer computador)
create table if not exists public.avisos_vistos (
  user_id  uuid not null references auth.users(id) on delete cascade,
  aviso    text not null check (char_length(aviso) between 1 and 60),
  visto_em timestamptz not null default now(),
  primary key (user_id, aviso)
);
alter table public.avisos_vistos enable row level security;

drop policy if exists avisos_vistos_ler on public.avisos_vistos;
create policy avisos_vistos_ler on public.avisos_vistos
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists avisos_vistos_marcar on public.avisos_vistos;
create policy avisos_vistos_marcar on public.avisos_vistos
  for insert to authenticated with check (user_id = (select auth.uid()));

revoke all on public.avisos_vistos from anon;
grant select, insert on public.avisos_vistos to authenticated;

-- Lube Work: toda pessoa mostrada lá passa por esta função
create or replace function office.json_pessoa(p_id uuid)
returns jsonb language sql stable
set search_path = office, public, extensions, pg_temp
as $$
  select jsonb_build_object('id', p.id, 'nome', coalesce(nullif(p.nome, ''), split_part(p.email, '@', 1)),
                            'email', p.email, 'cargo', p.cargo, 'foto', p.foto)
    from public.profiles p where p.id = p_id
$$;
