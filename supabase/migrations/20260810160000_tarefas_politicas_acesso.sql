-- Página "Tarefas": acesso às tabelas public.tarefas e public.tarefas_historico
-- amarrado ao mesmo modelo de permissões usado pelo restante do sistema
-- (view public.permissoes_efetivas, módulo 'tarefas').
--
-- As tabelas já existem no banco; esta migration só garante as políticas de RLS
-- que a tela precisa para ler, criar tarefas e gravar a trilha de histórico.
-- Nada aqui altera saldos, fornecedores, pagamentos ou administração.

-- Checagem central: o usuário logado tem a ação pedida no módulo 'tarefas'?
-- Security definer para que a política não dependa do RLS das tabelas de permissão.
create or replace function public.pode_em_tarefas(acao text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.usuarios u
    join public.permissoes_efetivas pe
      on pe.usuario_id = u.id
     and pe.modulo = 'tarefas'
    where u.auth_id = auth.uid()
      and u.status = 'ativo'
      and case acao
            when 'visualizar' then pe.pode_visualizar
            when 'cadastrar'  then pe.pode_cadastrar
            when 'editar'     then pe.pode_editar
            when 'excluir'    then pe.pode_excluir
            else false
          end
  );
$$;

alter table public.tarefas enable row level security;

drop policy if exists "tarefas_select_modulo" on public.tarefas;
create policy "tarefas_select_modulo"
  on public.tarefas
  for select
  to authenticated
  using (public.pode_em_tarefas('visualizar'));

drop policy if exists "tarefas_insert_modulo" on public.tarefas;
create policy "tarefas_insert_modulo"
  on public.tarefas
  for insert
  to authenticated
  with check (public.pode_em_tarefas('cadastrar'));

-- Edição: quem tem permissão de editar no módulo, ou a própria responsável pela
-- tarefa (que precisa mover o status conforme trabalha nela).
drop policy if exists "tarefas_update_modulo" on public.tarefas;
create policy "tarefas_update_modulo"
  on public.tarefas
  for update
  to authenticated
  using (
    public.pode_em_tarefas('editar')
    or responsavel_id in (select id from public.usuarios where auth_id = auth.uid())
  )
  with check (
    public.pode_em_tarefas('editar')
    or responsavel_id in (select id from public.usuarios where auth_id = auth.uid())
  );

drop policy if exists "tarefas_delete_modulo" on public.tarefas;
create policy "tarefas_delete_modulo"
  on public.tarefas
  for delete
  to authenticated
  using (public.pode_em_tarefas('excluir'));

alter table public.tarefas_historico enable row level security;

drop policy if exists "tarefas_historico_select_modulo" on public.tarefas_historico;
create policy "tarefas_historico_select_modulo"
  on public.tarefas_historico
  for select
  to authenticated
  using (public.pode_em_tarefas('visualizar'));

-- O histórico é uma trilha: cada linha é gravada em nome de quem está logado
-- e não pode ser alterada nem apagada pela tela.
drop policy if exists "tarefas_historico_insert_proprio" on public.tarefas_historico;
create policy "tarefas_historico_insert_proprio"
  on public.tarefas_historico
  for insert
  to authenticated
  with check (
    public.pode_em_tarefas('visualizar')
    and usuario_id in (select id from public.usuarios where auth_id = auth.uid())
  );

-- Consultas da tela: lista ordenada por prazo e contadores por responsável.
create index if not exists tarefas_prazo_idx on public.tarefas (prazo);
create index if not exists tarefas_responsavel_status_idx on public.tarefas (responsavel_id, status);
create index if not exists tarefas_historico_tarefa_idx on public.tarefas_historico (tarefa_id, criado_em desc);
