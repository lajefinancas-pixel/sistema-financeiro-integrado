-- Página "Tarefas" — recursos avançados: quadro Kanban, checklist, comentários,
-- anexos e linha do tempo.
--
-- As tabelas public.subtarefas, public.tarefas_comentarios e public.tarefas_anexos
-- já existem no banco; esta migration só garante as políticas de RLS que a tela
-- precisa e cria o bucket usado pelos anexos. O acesso continua amarrado ao mesmo
-- modelo de permissões do restante do sistema (módulo 'tarefas', via a função
-- public.pode_em_tarefas criada na migration anterior).
--
-- Nada aqui altera saldos, fornecedores, pagamentos ou administração.

-- Quem pode mexer no conteúdo de uma tarefa: quem tem edição no módulo ou a
-- própria responsável por ela. É a mesma regra da política de update de
-- public.tarefas, isolada aqui para ser reaproveitada pelas tabelas filhas.
create or replace function public.pode_editar_tarefa(id_tarefa uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.pode_em_tarefas('editar')
     or exists (
          select 1
          from public.tarefas t
          join public.usuarios u on u.id = t.responsavel_id
          where t.id = id_tarefa
            and u.auth_id = auth.uid()
        );
$$;

-- ---------------------------------------------------------------------------
-- Checklist / subtarefas
-- ---------------------------------------------------------------------------
alter table public.subtarefas enable row level security;

drop policy if exists "subtarefas_select_modulo" on public.subtarefas;
create policy "subtarefas_select_modulo"
  on public.subtarefas
  for select
  to authenticated
  using (public.pode_em_tarefas('visualizar'));

drop policy if exists "subtarefas_insert_modulo" on public.subtarefas;
create policy "subtarefas_insert_modulo"
  on public.subtarefas
  for insert
  to authenticated
  with check (public.pode_editar_tarefa(tarefa_id));

drop policy if exists "subtarefas_update_modulo" on public.subtarefas;
create policy "subtarefas_update_modulo"
  on public.subtarefas
  for update
  to authenticated
  using (public.pode_editar_tarefa(tarefa_id))
  with check (public.pode_editar_tarefa(tarefa_id));

drop policy if exists "subtarefas_delete_modulo" on public.subtarefas;
create policy "subtarefas_delete_modulo"
  on public.subtarefas
  for delete
  to authenticated
  using (public.pode_em_tarefas('excluir'));

-- ---------------------------------------------------------------------------
-- Comentários
-- ---------------------------------------------------------------------------
alter table public.tarefas_comentarios enable row level security;

drop policy if exists "tarefas_comentarios_select_modulo" on public.tarefas_comentarios;
create policy "tarefas_comentarios_select_modulo"
  on public.tarefas_comentarios
  for select
  to authenticated
  using (public.pode_em_tarefas('visualizar'));

-- Comentar é parte de acompanhar a tarefa: basta enxergar o módulo, mas o
-- comentário sempre fica em nome de quem está logado.
drop policy if exists "tarefas_comentarios_insert_proprio" on public.tarefas_comentarios;
create policy "tarefas_comentarios_insert_proprio"
  on public.tarefas_comentarios
  for insert
  to authenticated
  with check (
    public.pode_em_tarefas('visualizar')
    and usuario_id in (select id from public.usuarios where auth_id = auth.uid())
  );

drop policy if exists "tarefas_comentarios_delete_modulo" on public.tarefas_comentarios;
create policy "tarefas_comentarios_delete_modulo"
  on public.tarefas_comentarios
  for delete
  to authenticated
  using (public.pode_em_tarefas('excluir'));

-- ---------------------------------------------------------------------------
-- Anexos
-- ---------------------------------------------------------------------------
alter table public.tarefas_anexos enable row level security;

drop policy if exists "tarefas_anexos_select_modulo" on public.tarefas_anexos;
create policy "tarefas_anexos_select_modulo"
  on public.tarefas_anexos
  for select
  to authenticated
  using (public.pode_em_tarefas('visualizar'));

drop policy if exists "tarefas_anexos_insert_proprio" on public.tarefas_anexos;
create policy "tarefas_anexos_insert_proprio"
  on public.tarefas_anexos
  for insert
  to authenticated
  with check (
    public.pode_em_tarefas('visualizar')
    and usuario_id in (select id from public.usuarios where auth_id = auth.uid())
  );

drop policy if exists "tarefas_anexos_delete_modulo" on public.tarefas_anexos;
create policy "tarefas_anexos_delete_modulo"
  on public.tarefas_anexos
  for delete
  to authenticated
  using (public.pode_em_tarefas('excluir'));

-- ---------------------------------------------------------------------------
-- Bucket dos arquivos anexados
-- ---------------------------------------------------------------------------
-- Público na leitura porque a tela guarda a URL pública em tarefas_anexos.arquivo_url;
-- o caminho inclui o id da tarefa, que não é adivinhável.
insert into storage.buckets (id, name, public)
values ('tarefas-anexos', 'tarefas-anexos', true)
on conflict (id) do nothing;

drop policy if exists "tarefas_anexos_leitura_publica" on storage.objects;
create policy "tarefas_anexos_leitura_publica"
  on storage.objects
  for select
  using (bucket_id = 'tarefas-anexos');

drop policy if exists "tarefas_anexos_insert_autenticado" on storage.objects;
create policy "tarefas_anexos_insert_autenticado"
  on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'tarefas-anexos');

drop policy if exists "tarefas_anexos_delete_autenticado" on storage.objects;
create policy "tarefas_anexos_delete_autenticado"
  on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'tarefas-anexos');

-- ---------------------------------------------------------------------------
-- Consultas do detalhe da tarefa
-- ---------------------------------------------------------------------------
create index if not exists subtarefas_tarefa_idx on public.subtarefas (tarefa_id, ordem);
create index if not exists tarefas_comentarios_tarefa_idx on public.tarefas_comentarios (tarefa_id, criado_em);
create index if not exists tarefas_anexos_tarefa_idx on public.tarefas_anexos (tarefa_id, criado_em);
