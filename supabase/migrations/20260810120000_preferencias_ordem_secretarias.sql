-- Ordem personalizada dos cards de secretarias na página "Saldos das Contas".
-- Uma linha por usuário; a coluna "ordem" guarda os IDs das secretarias na sequência escolhida.
create table if not exists public.preferencias_ordem_secretarias (
  usuario_id uuid primary key references auth.users (id) on delete cascade,
  ordem jsonb not null default '[]'::jsonb,
  atualizado_em timestamptz not null default now()
);

alter table public.preferencias_ordem_secretarias enable row level security;

-- Cada usuário lê e grava somente a própria preferência.
drop policy if exists "ordem_secretarias_select_proprio" on public.preferencias_ordem_secretarias;
create policy "ordem_secretarias_select_proprio"
  on public.preferencias_ordem_secretarias
  for select
  using (auth.uid() = usuario_id);

drop policy if exists "ordem_secretarias_insert_proprio" on public.preferencias_ordem_secretarias;
create policy "ordem_secretarias_insert_proprio"
  on public.preferencias_ordem_secretarias
  for insert
  with check (auth.uid() = usuario_id);

drop policy if exists "ordem_secretarias_update_proprio" on public.preferencias_ordem_secretarias;
create policy "ordem_secretarias_update_proprio"
  on public.preferencias_ordem_secretarias
  for update
  using (auth.uid() = usuario_id)
  with check (auth.uid() = usuario_id);

drop policy if exists "ordem_secretarias_delete_proprio" on public.preferencias_ordem_secretarias;
create policy "ordem_secretarias_delete_proprio"
  on public.preferencias_ordem_secretarias
  for delete
  using (auth.uid() = usuario_id);
