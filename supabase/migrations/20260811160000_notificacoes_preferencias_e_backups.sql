-- Categorias NOTIFICAÇÕES e BACKUP da tela "Configurações".
--
-- Duas coisas entram aqui:
--
-- 1. Preferências de notificação (chave 'notificacoes' em
--    public.configuracoes_sistema). A chave é global: um administrador liga ou
--    desliga cada tipo de aviso para o sistema inteiro. Como quem GERA o aviso é
--    qualquer usuário (ao atribuir uma tarefa, ao enviar para aprovação...), a
--    preferência precisa ser LEGÍVEL por qualquer usuário ativo -- senão o
--    interruptor só valeria para quem tem acesso à tela de Configurações. Por
--    isso a política de leitura extra abaixo, restrita a essa única chave.
--    Gravar continua exigindo pode_editar em 'administracao'.
--
-- 2. public.backups_log: registro informativo de backups e de solicitações de
--    restauração. A tabela nasce VAZIA de propósito -- o backup automático do
--    banco é feito pela infraestrutura do Supabase, fora desta aplicação, e a
--    tela prefere dizer "nenhum registro" a exibir número inventado. O que a
--    aplicação realmente registra aqui é a solicitação de restauração feita na
--    tela (com justificativa), que também vira evento crítico na auditoria.
--
-- Nada aqui altera saldos, fornecedores, pagamentos, tarefas, usuários,
-- histórico, relatórios ou auditoria: é uma chave nova em uma tabela que já
-- existe e uma tabela nova.

-- ---------------------------------------------------------------------------
-- 1. Preferências de notificação
-- ---------------------------------------------------------------------------

-- Valores iniciais: todos os avisos ligados, que é o comportamento atual do
-- sistema. 'on conflict do nothing' preserva o que já estiver configurado.
insert into public.configuracoes_sistema (chave, valor)
values (
  'notificacoes',
  jsonb_build_object(
    'tarefa_atribuida', true,
    'tarefa_vence_hoje', true,
    'tarefa_atrasada', true,
    'tarefa_aguardando_aprovacao', true,
    'acao_critica', true
  )
)
on conflict (chave) do nothing;

-- Leitura ampliada SOMENTE da chave 'notificacoes', e somente para usuário
-- ativo. As demais chaves (geral, seguranca, tributario, ...) continuam
-- visíveis apenas para quem tem pode_visualizar em 'administracao', pela
-- política "configuracoes_sistema_select_permissao", que segue valendo.
drop policy if exists "configuracoes_sistema_select_notificacoes" on public.configuracoes_sistema;
create policy "configuracoes_sistema_select_notificacoes"
  on public.configuracoes_sistema
  for select
  to authenticated
  using (chave = 'notificacoes' and public.meu_usuario_ativo_id() is not null);

-- ---------------------------------------------------------------------------
-- 2. Registro informativo de backups e restaurações
-- ---------------------------------------------------------------------------

create table if not exists public.backups_log (
  id uuid primary key default gen_random_uuid(),
  -- 'backup'      -> uma cópia registrada (informativo);
  -- 'restauracao' -> uma solicitação de restauração feita na tela.
  tipo text not null default 'backup'
    constraint backups_log_tipo_check check (tipo in ('backup', 'restauracao')),
  status text not null default 'registrado'
    constraint backups_log_status_check check (status in ('concluido', 'registrado', 'falha')),
  descricao text,
  -- Obrigatória nas solicitações de restauração; nula nos registros de backup.
  justificativa text,
  -- on delete set null: o registro sobrevive à remoção do cadastro do usuário.
  usuario_id uuid references public.usuarios (id) on delete set null,
  criado_em timestamptz not null default now(),
  constraint backups_log_restauracao_justificada check (
    tipo <> 'restauracao' or coalesce(btrim(justificativa), '') <> ''
  )
);

-- Listagem padrão da tela: registros mais recentes primeiro.
create index if not exists backups_log_criado_em_idx
  on public.backups_log (criado_em desc);

create index if not exists backups_log_tipo_criado_em_idx
  on public.backups_log (tipo, criado_em desc);

alter table public.backups_log enable row level security;

-- Leitura: quem pode abrir as Configurações (pode_visualizar em 'administracao').
drop policy if exists "backups_log_select_permissao" on public.backups_log;
create policy "backups_log_select_permissao"
  on public.backups_log
  for select
  to authenticated
  using (public.pode_ver_configuracoes());

-- Gravação: exige permissão elevada (pode_editar em 'administracao') e amarra o
-- registro ao usuário da sessão, para que ninguém registre em nome de outro.
drop policy if exists "backups_log_insert_administracao" on public.backups_log;
create policy "backups_log_insert_administracao"
  on public.backups_log
  for insert
  to authenticated
  with check (
    public.pode_editar_configuracoes()
    and usuario_id is not null
    and usuario_id = public.meu_usuario_ativo_id()
  );

-- Sem política de update e sem política de delete: o registro é imutável, como
-- a trilha de auditoria.

grant select, insert on public.backups_log to authenticated;
revoke update, delete, truncate on public.backups_log from authenticated;
revoke all on public.backups_log from anon;

-- Nenhum insert de exemplo: a tabela começa vazia e a tela mostra "nenhum
-- registro" enquanto assim estiver.
