-- Trilha de auditoria do sistema (tela "Auditoria").
--
-- public.auditoria_eventos guarda o que aconteceu no sistema: quem fez, quando,
-- em qual módulo, qual registro foi tocado e como o registro estava antes/depois.
--
-- A tabela é deliberadamente SOMENTE-INSERÇÃO e SOMENTE-LEITURA:
--   * insert  -> qualquer usuário ativo pode registrar os próprios eventos;
--   * select  -> apenas quem tem pode_visualizar no módulo 'auditoria';
--   * update  -> NENHUMA política. Ninguém altera um evento, nem administradores;
--   * delete  -> NENHUMA política. Ninguém apaga um evento, nem administradores.
-- Com RLS habilitado, a ausência de política já bloqueia update/delete pela API;
-- o revoke abaixo é a segunda tranca, para que nem um GRANT amplo no schema
-- public reabra a porta.
--
-- Nada aqui altera saldos, fornecedores, pagamentos, tarefas, usuários,
-- histórico ou relatórios: é uma tabela nova.

-- Id do usuário ATIVO em public.usuarios correspondente à sessão atual.
-- Security definer para que as políticas não dependam do RLS de public.usuarios.
create or replace function public.meu_usuario_ativo_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select u.id
    from public.usuarios u
   where u.auth_id = auth.uid()
     and u.status = 'ativo'
   limit 1;
$$;

-- O usuário logado pode consultar a trilha de auditoria?
create or replace function public.pode_consultar_auditoria()
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
     and pe.modulo = 'auditoria'
    where u.auth_id = auth.uid()
      and u.status = 'ativo'
      and pe.pode_visualizar
  );
$$;

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

-- Listagem padrão da tela: eventos mais recentes primeiro.
create index if not exists auditoria_eventos_data_hora_idx
  on public.auditoria_eventos (data_hora desc);

-- Consultas por módulo e por usuário (filtros das próximas etapas da tela).
create index if not exists auditoria_eventos_modulo_data_idx
  on public.auditoria_eventos (modulo, data_hora desc);

create index if not exists auditoria_eventos_usuario_data_idx
  on public.auditoria_eventos (usuario_id, data_hora desc);

alter table public.auditoria_eventos enable row level security;

-- Leitura: somente quem tem visualização no módulo 'auditoria'.
drop policy if exists "auditoria_eventos_select_permissao" on public.auditoria_eventos;
create policy "auditoria_eventos_select_permissao"
  on public.auditoria_eventos
  for select
  to authenticated
  using (public.pode_consultar_auditoria());

-- Gravação: qualquer usuário ativo registra os PRÓPRIOS eventos (o registro
-- automático acontece durante a ação, em qualquer módulo). Amarrar usuario_id ao
-- usuário da sessão impede que alguém lance um evento no nome de outra pessoa.
drop policy if exists "auditoria_eventos_insert_proprio" on public.auditoria_eventos;
create policy "auditoria_eventos_insert_proprio"
  on public.auditoria_eventos
  for insert
  to authenticated
  with check (usuario_id is not null and usuario_id = public.meu_usuario_ativo_id());

-- Sem política de update e sem política de delete: a trilha é imutável.

grant select, insert on public.auditoria_eventos to authenticated;
revoke update, delete, truncate on public.auditoria_eventos from authenticated;
revoke all on public.auditoria_eventos from anon;
