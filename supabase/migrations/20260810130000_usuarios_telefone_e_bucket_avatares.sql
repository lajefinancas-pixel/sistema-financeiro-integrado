-- Cadastro de usuários da equipe: telefone e bucket das fotos de perfil.

-- Telefone informado no cadastro/edição de usuário.
alter table public.usuarios add column if not exists telefone text;

-- Bucket público com as fotos de perfil da equipe.
insert into storage.buckets (id, name, public)
values ('avatares', 'avatares', true)
on conflict (id) do nothing;

-- Fotos são exibidas na listagem por URL pública, então a leitura é aberta.
drop policy if exists "avatares_leitura_publica" on storage.objects;
create policy "avatares_leitura_publica"
  on storage.objects
  for select
  using (bucket_id = 'avatares');

-- Envio, substituição e remoção ficam restritos a quem está autenticado.
drop policy if exists "avatares_insert_autenticado" on storage.objects;
create policy "avatares_insert_autenticado"
  on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'avatares');

drop policy if exists "avatares_update_autenticado" on storage.objects;
create policy "avatares_update_autenticado"
  on storage.objects
  for update
  to authenticated
  using (bucket_id = 'avatares')
  with check (bucket_id = 'avatares');

drop policy if exists "avatares_delete_autenticado" on storage.objects;
create policy "avatares_delete_autenticado"
  on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'avatares');
