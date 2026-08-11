-- Criação das três tabelas que o código já usa mas que NÃO existem no banco:
--   * public.configuracoes_sistema  -> tela "Configurações"
--   * public.auditoria_eventos      -> tela "Auditoria" (e o Histórico de Movimentações)
--   * public.relatorios_favoritos   -> "Salvar Relatório" da Central de Relatórios
--
-- É a ausência dessas tabelas que produz hoje as mensagens "Não foi possível
-- carregar..." nessas três telas.
--
-- Esta migration é SOMENTE estrutura de banco. Nenhuma tela, componente, regra
-- de negócio ou comportamento visual foi alterado, e nenhum dado existente é
-- tocado: saldos, fornecedores, pagamentos, tarefas, usuários, secretarias,
-- contas bancárias e histórico continuam exatamente como estão.
--
-- Ela é INDEPENDENTE e IDEMPOTENTE de propósito:
--   * pode ser rodada mesmo que as migrations anteriores nunca tenham sido
--     aplicadas -- não depende de nada criado por elas;
--   * pode ser rodada mais de uma vez sem erro e sem duplicar nada;
--   * se alguma das tabelas já existir parcialmente, as colunas que faltarem são
--     acrescentadas em vez de a criação ser silenciosamente ignorada.
--
-- As colunas abaixo são exatamente as que o código já lê e grava:
--   src/lib/configuracoesSistema.js, src/lib/informacoesSistema.js,
--   src/lib/notificacoes.js, src/lib/auditoria.js,
--   src/lib/historicoMovimentacoes.js e src/lib/relatoriosFavoritos.js.

-- ---------------------------------------------------------------------------
-- Função de apoio usada pelas políticas (mesmo padrão das outras tabelas)
-- ---------------------------------------------------------------------------

-- Id do usuário em public.usuarios correspondente à sessão atual.
-- Security definer para que as políticas não dependam do RLS de public.usuarios.
-- As telas gravam ora o id do auth (relatórios favoritos), ora o id de
-- public.usuarios (auditoria); por isso as políticas aceitam os dois formatos,
-- com `auth.uid() = usuario_id or usuario_id = public.meu_usuario_id()`.
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

-- ---------------------------------------------------------------------------
-- 1. public.configuracoes_sistema  (tela "Configurações")
-- ---------------------------------------------------------------------------
--
-- Tabela chave-valor: cada categoria da tela grava UMA linha, com o conteúdo
-- inteiro em jsonb. Chaves usadas pelo código hoje: 'geral', 'seguranca',
-- 'tributario', 'notificacoes' e 'aparencia'. Categorias novas entram sem
-- migration nova -- basta uma chave nova.
--
-- A gravação da tela é um upsert com onConflict: "chave", por isso "chave"
-- precisa ser única.

create table if not exists public.configuracoes_sistema (
  id uuid primary key default gen_random_uuid(),
  chave text not null,
  valor jsonb not null default '{}'::jsonb,
  atualizado_em timestamptz not null default now(),
  -- on delete set null: a configuração sobrevive à remoção do cadastro de quem salvou.
  atualizado_por uuid references public.usuarios (id) on delete set null
);

-- Redes de segurança, caso a tabela já exista sem alguma dessas colunas.
alter table public.configuracoes_sistema add column if not exists chave text;
alter table public.configuracoes_sistema add column if not exists valor jsonb not null default '{}'::jsonb;
alter table public.configuracoes_sistema add column if not exists atualizado_em timestamptz not null default now();
alter table public.configuracoes_sistema add column if not exists atualizado_por uuid;

-- Uma linha por chave (exigência do upsert da tela).
create unique index if not exists configuracoes_sistema_chave_idx
  on public.configuracoes_sistema (chave);

-- Quem salvou e quando são preenchidos pelo banco, não pela tela: o rodapé
-- "Última alteração em ... por ..." nunca depende de o cliente mandar a
-- informação certa (a tela envia apenas chave e valor).
create or replace function public.configuracoes_sistema_marcar_autoria()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.atualizado_em := now();
  new.atualizado_por := coalesce(public.meu_usuario_id(), new.atualizado_por);
  return new;
end;
$$;

drop trigger if exists configuracoes_sistema_autoria on public.configuracoes_sistema;
create trigger configuracoes_sistema_autoria
  before insert or update on public.configuracoes_sistema
  for each row
  execute function public.configuracoes_sistema_marcar_autoria();

alter table public.configuracoes_sistema enable row level security;

-- Esta tabela é do SISTEMA, não de um usuário: não existe coluna usuario_id
-- para comparar. O equivalente ao "próprio usuário" das outras tabelas é,
-- aqui, "a sessão corresponde a um usuário cadastrado em public.usuarios" --
-- é essa a condição usada nas quatro políticas abaixo. Assim a tela abre e
-- salva para quem está logado, e nada fica exposto a sessão anônima.
drop policy if exists "configuracoes_sistema_select_usuario" on public.configuracoes_sistema;
create policy "configuracoes_sistema_select_usuario"
  on public.configuracoes_sistema
  for select
  to authenticated
  using (public.meu_usuario_id() is not null);

drop policy if exists "configuracoes_sistema_insert_usuario" on public.configuracoes_sistema;
create policy "configuracoes_sistema_insert_usuario"
  on public.configuracoes_sistema
  for insert
  to authenticated
  with check (public.meu_usuario_id() is not null);

drop policy if exists "configuracoes_sistema_update_usuario" on public.configuracoes_sistema;
create policy "configuracoes_sistema_update_usuario"
  on public.configuracoes_sistema
  for update
  to authenticated
  using (public.meu_usuario_id() is not null)
  with check (public.meu_usuario_id() is not null);

-- Sem política de delete: nenhuma tela apaga uma chave de configuração.

grant select, insert, update on public.configuracoes_sistema to authenticated;
revoke delete, truncate on public.configuracoes_sistema from authenticated;
revoke all on public.configuracoes_sistema from anon;

-- Nenhum valor inicial é inserido: o próprio código já preenche cada categoria
-- com os valores padrão quando a chave ainda não existe no banco. Semear aqui
-- faria a tela abrir com textos diferentes dos padrões do código.

-- ---------------------------------------------------------------------------
-- 2. public.auditoria_eventos  (tela "Auditoria" e Histórico de Movimentações)
-- ---------------------------------------------------------------------------
--
-- Guarda o que aconteceu no sistema: quem fez, quando, em qual módulo, qual
-- registro foi tocado e como ele estava antes/depois.
--
-- usuario_id aponta para public.usuarios (e não para auth.users) porque as duas
-- telas leem o autor pelo relacionamento `usuarios ( id, nome_completo )` --
-- sem essa chave estrangeira o nome de quem agiu não é resolvido.

create table if not exists public.auditoria_eventos (
  id uuid primary key default gen_random_uuid(),
  -- on delete set null: a trilha sobrevive à remoção do cadastro do usuário.
  usuario_id uuid references public.usuarios (id) on delete set null,
  data_hora timestamptz not null default now(),
  modulo text not null,
  acao text not null,
  registro_afetado text,
  valor_anterior jsonb,
  valor_novo jsonb,
  resultado text not null default 'sucesso'
    constraint auditoria_eventos_resultado_check check (resultado in ('sucesso', 'falha')),
  nivel text not null default 'informacao'
    constraint auditoria_eventos_nivel_check check (nivel in ('informacao', 'atencao', 'critico'))
);

-- Redes de segurança, caso a tabela já exista sem alguma dessas colunas.
alter table public.auditoria_eventos add column if not exists usuario_id uuid;
alter table public.auditoria_eventos add column if not exists data_hora timestamptz not null default now();
alter table public.auditoria_eventos add column if not exists modulo text;
alter table public.auditoria_eventos add column if not exists acao text;
alter table public.auditoria_eventos add column if not exists registro_afetado text;
alter table public.auditoria_eventos add column if not exists valor_anterior jsonb;
alter table public.auditoria_eventos add column if not exists valor_novo jsonb;
alter table public.auditoria_eventos add column if not exists resultado text not null default 'sucesso';
alter table public.auditoria_eventos add column if not exists nivel text not null default 'informacao';

-- Listagem padrão da tela: eventos mais recentes primeiro.
create index if not exists auditoria_eventos_data_hora_idx
  on public.auditoria_eventos (data_hora desc);

-- Filtros por módulo e por usuário.
create index if not exists auditoria_eventos_modulo_data_idx
  on public.auditoria_eventos (modulo, data_hora desc);

create index if not exists auditoria_eventos_usuario_data_idx
  on public.auditoria_eventos (usuario_id, data_hora desc);

-- Alerta de ações críticas das últimas 24 horas.
create index if not exists auditoria_eventos_nivel_data_idx
  on public.auditoria_eventos (nivel, data_hora desc);

alter table public.auditoria_eventos enable row level security;

-- A trilha é SOMENTE-LEITURA e SOMENTE-INSERÇÃO: existem apenas as políticas de
-- select e de insert. Sem política de update e sem política de delete, ninguém
-- altera nem apaga um evento -- nem administrador. Com o RLS habilitado, a
-- ausência de política já bloqueia pela API; o revoke mais abaixo é a segunda
-- tranca, para que nem um grant amplo no schema public reabra a porta.

-- Leitura: a tela de Auditoria é uma consulta do sistema inteiro (tem filtro por
-- usuário e mostra o nome de quem agiu), então ela não pode ser recortada ao
-- próprio usuário -- seria a mesma tela mostrando apenas os próprios eventos.
-- A condição é a mesma das configurações: sessão de um usuário cadastrado.
drop policy if exists "auditoria_eventos_select_usuario" on public.auditoria_eventos;
create policy "auditoria_eventos_select_usuario"
  on public.auditoria_eventos
  for select
  to authenticated
  using (public.meu_usuario_id() is not null);

-- Gravação: cada usuário registra somente os PRÓPRIOS eventos. Amarrar
-- usuario_id ao usuário da sessão impede que alguém lance um evento no nome de
-- outra pessoa.
drop policy if exists "auditoria_eventos_insert_proprio" on public.auditoria_eventos;
create policy "auditoria_eventos_insert_proprio"
  on public.auditoria_eventos
  for insert
  to authenticated
  with check (
    usuario_id is not null
    and (auth.uid() = usuario_id or usuario_id = public.meu_usuario_id())
  );

grant select, insert on public.auditoria_eventos to authenticated;
revoke update, delete, truncate on public.auditoria_eventos from authenticated;
revoke all on public.auditoria_eventos from anon;

-- ---------------------------------------------------------------------------
-- 3. public.relatorios_favoritos  (botão "Salvar Relatório" dos Relatórios)
-- ---------------------------------------------------------------------------
--
-- Relatórios personalizados salvos pelo próprio usuário. "configuracao" recebe
-- o pacote inteiro do construtor (fonte de dados, período, filtros, colunas,
-- agrupamento e ordenação) em jsonb, sem esquema fixo, para que novos critérios
-- possam ser salvos sem migration nova -- a mesma ideia de public.filtros_favoritos.
--
-- usuario_id aqui é o id do usuário no auth (é o que a tela grava, vindo de
-- supabase.auth.getUser()).

create table if not exists public.relatorios_favoritos (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users (id) on delete cascade,
  nome text not null,
  configuracao jsonb not null default '{}'::jsonb,
  criado_em timestamptz not null default now()
);

-- Redes de segurança, caso a tabela já exista sem alguma dessas colunas.
alter table public.relatorios_favoritos add column if not exists usuario_id uuid;
alter table public.relatorios_favoritos add column if not exists nome text;
alter table public.relatorios_favoritos add column if not exists configuracao jsonb not null default '{}'::jsonb;
alter table public.relatorios_favoritos add column if not exists criado_em timestamptz not null default now();

-- Um nome por usuário: salvar de novo com o mesmo nome avisa (erro 23505, que a
-- tela traduz para "Você já tem um relatório salvo com esse nome") em vez de duplicar.
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

grant select, insert, update, delete on public.relatorios_favoritos to authenticated;
revoke all on public.relatorios_favoritos from anon;
