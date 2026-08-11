-- Relatórios personalizados salvos pelo usuário na Central de Relatórios
-- (botão "Salvar Relatório" do construtor de relatório personalizado).
--
-- "configuracao" recebe o pacote inteiro do construtor (fonte de dados, período,
-- filtros, colunas escolhidas, agrupamento e ordenação) em jsonb, sem esquema
-- fixo, para que novos critérios possam ser salvos sem migration nova -- a mesma
-- ideia de public.filtros_favoritos.
--
-- Nada aqui altera saldos, fornecedores, pagamentos, tarefas ou os relatórios
-- prontos: é uma tabela nova, só de preferências do próprio usuário.

-- Id do usuário na tabela public.usuarios correspondente à sessão atual.
-- Security definer para que a política não dependa do RLS de public.usuarios.
create or replace function public.meu_usuario_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select u.id
    from public.usuarios u
   where u.auth_id = auth.uid()
   limit 1;
$$;

create table if not exists public.relatorios_favoritos (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users (id) on delete cascade,
  nome text not null,
  configuracao jsonb not null default '{}'::jsonb,
  criado_em timestamptz not null default now()
);

-- Um nome por usuário: salvar de novo com o mesmo nome avisa em vez de duplicar.
create unique index if not exists relatorios_favoritos_usuario_nome_idx
  on public.relatorios_favoritos (usuario_id, lower(nome));

-- Listagem dos atalhos do usuário, do mais novo para o mais antigo.
create index if not exists relatorios_favoritos_usuario_criado_idx
  on public.relatorios_favoritos (usuario_id, criado_em desc);

alter table public.relatorios_favoritos enable row level security;

-- Cada usuário lê e mantém somente os próprios relatórios salvos.
drop policy if exists "relatorios_favoritos_select_proprio" on public.relatorios_favoritos;
create policy "relatorios_favoritos_select_proprio"
  on public.relatorios_favoritos
  for select
  to authenticated
  using (auth.uid() = usuario_id or usuario_id = public.meu_usuario_id());

drop policy if exists "relatorios_favoritos_insert_proprio" on public.relatorios_favoritos;
create policy "relatorios_favoritos_insert_proprio"
  on public.relatorios_favoritos
  for insert
  to authenticated
  with check (auth.uid() = usuario_id or usuario_id = public.meu_usuario_id());

drop policy if exists "relatorios_favoritos_update_proprio" on public.relatorios_favoritos;
create policy "relatorios_favoritos_update_proprio"
  on public.relatorios_favoritos
  for update
  to authenticated
  using (auth.uid() = usuario_id or usuario_id = public.meu_usuario_id())
  with check (auth.uid() = usuario_id or usuario_id = public.meu_usuario_id());

drop policy if exists "relatorios_favoritos_delete_proprio" on public.relatorios_favoritos;
create policy "relatorios_favoritos_delete_proprio"
  on public.relatorios_favoritos
  for delete
  to authenticated
  using (auth.uid() = usuario_id or usuario_id = public.meu_usuario_id());
