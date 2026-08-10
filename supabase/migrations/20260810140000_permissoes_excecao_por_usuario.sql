-- Exceções de permissão por usuário (aba "Permissões" da tela de edição de usuário).
--
-- A tabela public.permissoes_excecao já existe no banco; esta migration apenas
-- garante o que a tela precisa para gravar com segurança:
--   1. o índice único (usuario_id, modulo) usado no upsert de cada módulo;
--   2. políticas de RLS permitindo que administradoras leiam e ajustem exceções.
--
-- Nada aqui altera perfis_acesso, perfis_permissoes ou a view permissoes_efetivas.

-- 1. Uma exceção por usuário e módulo.
create unique index if not exists permissoes_excecao_usuario_modulo_idx
  on public.permissoes_excecao (usuario_id, modulo);

-- 2. Quem administra a equipe pode manter as exceções.
alter table public.permissoes_excecao enable row level security;

-- A checagem olha o padrão do perfil (perfis_permissoes) em vez da view
-- permissoes_efetivas para não criar recursão de RLS sobre a própria tabela.
create or replace function public.pode_administrar_permissoes()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.usuarios u
    join public.perfis_permissoes pp
      on pp.perfil_id = u.perfil_id
     and pp.modulo = 'administracao'
    where u.auth_id = auth.uid()
      and u.status = 'ativo'
      and pp.pode_editar
  );
$$;

drop policy if exists "permissoes_excecao_select_admin" on public.permissoes_excecao;
create policy "permissoes_excecao_select_admin"
  on public.permissoes_excecao
  for select
  to authenticated
  using (public.pode_administrar_permissoes());

drop policy if exists "permissoes_excecao_insert_admin" on public.permissoes_excecao;
create policy "permissoes_excecao_insert_admin"
  on public.permissoes_excecao
  for insert
  to authenticated
  with check (public.pode_administrar_permissoes());

drop policy if exists "permissoes_excecao_update_admin" on public.permissoes_excecao;
create policy "permissoes_excecao_update_admin"
  on public.permissoes_excecao
  for update
  to authenticated
  using (public.pode_administrar_permissoes())
  with check (public.pode_administrar_permissoes());

drop policy if exists "permissoes_excecao_delete_admin" on public.permissoes_excecao;
create policy "permissoes_excecao_delete_admin"
  on public.permissoes_excecao
  for delete
  to authenticated
  using (public.pode_administrar_permissoes());
