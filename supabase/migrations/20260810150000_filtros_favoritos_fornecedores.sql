-- Filtros favoritos salvos na área de filtros avançados da aba "Fornecedores".
-- Cada linha guarda uma combinação de filtros nomeada pelo próprio usuário;
-- "criterios" recebe o pacote de filtros da tela (jsonb), sem esquema fixo, para
-- que novos campos de filtro possam ser salvos sem migration nova.
create table if not exists public.filtros_favoritos (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users (id) on delete cascade,
  nome text not null,
  criterios jsonb not null default '{}'::jsonb,
  criado_em timestamptz not null default now()
);

-- Um nome por usuário: salvar de novo com o mesmo nome avisa em vez de duplicar.
create unique index if not exists filtros_favoritos_usuario_nome_idx
  on public.filtros_favoritos (usuario_id, lower(nome));

-- Listagem dos atalhos do usuário, do mais novo para o mais antigo.
create index if not exists filtros_favoritos_usuario_criado_idx
  on public.filtros_favoritos (usuario_id, criado_em desc);

alter table public.filtros_favoritos enable row level security;

-- Cada usuário lê e mantém somente os próprios filtros salvos.
drop policy if exists "filtros_favoritos_select_proprio" on public.filtros_favoritos;
create policy "filtros_favoritos_select_proprio"
  on public.filtros_favoritos
  for select
  to authenticated
  using (auth.uid() = usuario_id);

drop policy if exists "filtros_favoritos_insert_proprio" on public.filtros_favoritos;
create policy "filtros_favoritos_insert_proprio"
  on public.filtros_favoritos
  for insert
  to authenticated
  with check (auth.uid() = usuario_id);

drop policy if exists "filtros_favoritos_update_proprio" on public.filtros_favoritos;
create policy "filtros_favoritos_update_proprio"
  on public.filtros_favoritos
  for update
  to authenticated
  using (auth.uid() = usuario_id)
  with check (auth.uid() = usuario_id);

drop policy if exists "filtros_favoritos_delete_proprio" on public.filtros_favoritos;
create policy "filtros_favoritos_delete_proprio"
  on public.filtros_favoritos
  for delete
  to authenticated
  using (auth.uid() = usuario_id);
