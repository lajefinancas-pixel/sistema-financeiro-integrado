-- Página "Tarefas" — recursos finais: "Minhas tarefas", delegação e
-- compartilhamento, aprovação/devolução, tarefas recorrentes e notificações.
--
-- As tabelas public.tarefas_compartilhadas e public.notificacoes já existem no
-- banco; esta migration garante as colunas, as políticas de RLS e os índices que
-- a tela passa a usar. Tudo é idempotente e pode ser executado mais de uma vez.
--
-- O acesso continua amarrado ao mesmo modelo de permissões do restante do
-- sistema (módulo 'tarefas', via public.pode_em_tarefas / public.pode_editar_tarefa,
-- criadas nas migrations anteriores).
--
-- Nada aqui altera saldos, fornecedores, pagamentos ou administração.

-- ---------------------------------------------------------------------------
-- Colunas usadas pelos novos recursos em public.tarefas
-- ---------------------------------------------------------------------------
alter table public.tarefas add column if not exists importante boolean not null default false;
alter table public.tarefas add column if not exists recorrencia jsonb;
alter table public.tarefas add column if not exists aprovada boolean;
alter table public.tarefas add column if not exists aprovada_por uuid references public.usuarios (id);
alter table public.tarefas add column if not exists aprovada_em timestamptz;

comment on column public.tarefas.importante is
  'Tarefa que, ao ser concluída pela responsável, vai para "em_analise" e depende da aprovação da gestora.';
comment on column public.tarefas.recorrencia is
  'Regra de repetição: {"tipo":"dia_util|semanal|mensal"}. Nulo quando a tarefa não se repete.';

-- O fluxo de aprovação grava o status "em_analise". Se o banco tiver um check de
-- status antigo que não conheça esse valor, ele é substituído por outro com a
-- lista completa (NOT VALID: vale para o que for gravado daqui em diante, sem
-- reprovar linhas antigas).
do $$
declare
  restricao record;
  trocou boolean := false;
begin
  for restricao in
    select conname
    from pg_constraint
    where conrelid = 'public.tarefas'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
      and pg_get_constraintdef(oid) not ilike '%em_analise%'
  loop
    execute format('alter table public.tarefas drop constraint %I', restricao.conname);
    trocou := true;
  end loop;

  if trocou and not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.tarefas'::regclass
      and conname = 'tarefas_status_valores_check'
  ) then
    alter table public.tarefas
      add constraint tarefas_status_valores_check
      check (
        status in (
          'nova', 'recebida', 'em_andamento', 'aguardando_resposta',
          'em_analise', 'concluida', 'atrasada', 'cancelada'
        )
      )
      not valid;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Compartilhamento de tarefas
-- ---------------------------------------------------------------------------
create table if not exists public.tarefas_compartilhadas (
  id uuid primary key default gen_random_uuid(),
  tarefa_id uuid not null references public.tarefas (id) on delete cascade,
  usuario_id uuid not null references public.usuarios (id) on delete cascade
);

-- Uma pessoa só entra uma vez em cada tarefa. Se o banco já tiver duplicidades,
-- o índice não é criado e a migration segue (a tela também evita repetir).
do $$
begin
  create unique index if not exists tarefas_compartilhadas_unica_idx
    on public.tarefas_compartilhadas (tarefa_id, usuario_id);
exception
  when others then
    raise notice 'Índice único de tarefas_compartilhadas não criado: %', sqlerrm;
end $$;

create index if not exists tarefas_compartilhadas_usuario_idx
  on public.tarefas_compartilhadas (usuario_id);

alter table public.tarefas_compartilhadas enable row level security;

drop policy if exists "tarefas_compartilhadas_select_modulo" on public.tarefas_compartilhadas;
create policy "tarefas_compartilhadas_select_modulo"
  on public.tarefas_compartilhadas
  for select
  to authenticated
  using (public.pode_em_tarefas('visualizar'));

-- Compartilhar é mexer no conteúdo da tarefa: mesma regra do checklist e dos
-- anexos (edição no módulo ou ser a responsável pela tarefa).
drop policy if exists "tarefas_compartilhadas_insert_modulo" on public.tarefas_compartilhadas;
create policy "tarefas_compartilhadas_insert_modulo"
  on public.tarefas_compartilhadas
  for insert
  to authenticated
  with check (public.pode_editar_tarefa(tarefa_id));

drop policy if exists "tarefas_compartilhadas_delete_modulo" on public.tarefas_compartilhadas;
create policy "tarefas_compartilhadas_delete_modulo"
  on public.tarefas_compartilhadas
  for delete
  to authenticated
  using (public.pode_editar_tarefa(tarefa_id));

-- ---------------------------------------------------------------------------
-- Notificações
-- ---------------------------------------------------------------------------
create table if not exists public.notificacoes (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuarios (id) on delete cascade,
  tarefa_id uuid references public.tarefas (id) on delete cascade,
  tipo text not null,
  mensagem text not null,
  lida boolean not null default false,
  criado_em timestamptz not null default now()
);

-- Se a tabela já existia com um formato mais enxuto, estas colunas completam o
-- que a tela usa. Todas têm valor padrão, então funcionam com dados antigos.
alter table public.notificacoes
  add column if not exists tarefa_id uuid references public.tarefas (id) on delete cascade;
alter table public.notificacoes add column if not exists lida boolean not null default false;
alter table public.notificacoes add column if not exists criado_em timestamptz not null default now();

-- A tela grava tipos novos ('tarefa_atribuida', 'tarefa_devolvida', ...). Um
-- check antigo com uma lista fechada de tipos é removido para não barrá-los.
do $$
declare
  restricao record;
begin
  for restricao in
    select conname
    from pg_constraint
    where conrelid = 'public.notificacoes'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%tipo%'
      and pg_get_constraintdef(oid) not ilike '%tarefa_devolvida%'
  loop
    execute format('alter table public.notificacoes drop constraint %I', restricao.conname);
  end loop;
end $$;

create index if not exists notificacoes_usuario_idx
  on public.notificacoes (usuario_id, lida, criado_em desc);

alter table public.notificacoes enable row level security;

-- Cada pessoa enxerga e marca como lida apenas as próprias notificações.
drop policy if exists "notificacoes_select_proprias" on public.notificacoes;
create policy "notificacoes_select_proprias"
  on public.notificacoes
  for select
  to authenticated
  using (usuario_id in (select id from public.usuarios where auth_id = auth.uid()));

drop policy if exists "notificacoes_update_proprias" on public.notificacoes;
create policy "notificacoes_update_proprias"
  on public.notificacoes
  for update
  to authenticated
  using (usuario_id in (select id from public.usuarios where auth_id = auth.uid()))
  with check (usuario_id in (select id from public.usuarios where auth_id = auth.uid()));

drop policy if exists "notificacoes_delete_proprias" on public.notificacoes;
create policy "notificacoes_delete_proprias"
  on public.notificacoes
  for delete
  to authenticated
  using (usuario_id in (select id from public.usuarios where auth_id = auth.uid()));

-- Avisar um colega faz parte do dia a dia da equipe: qualquer usuário ativo
-- pode gerar notificação para outra pessoa (atribuição, comentário, devolução).
drop policy if exists "notificacoes_insert_equipe" on public.notificacoes;
create policy "notificacoes_insert_equipe"
  on public.notificacoes
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.usuarios u
      where u.auth_id = auth.uid() and u.status = 'ativo'
    )
  );

-- ---------------------------------------------------------------------------
-- Consultas de "Minhas tarefas" e do painel da gestora
-- ---------------------------------------------------------------------------
create index if not exists tarefas_status_prazo_idx on public.tarefas (status, prazo);
