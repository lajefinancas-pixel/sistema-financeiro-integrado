-- Configurações do sistema (tela "Configurações").
--
-- public.configuracoes_sistema é uma tabela chave-valor: cada categoria da tela
-- grava UMA linha, com o conteúdo inteiro em jsonb. Assim as próximas categorias
-- (Financeiro, Tributário, Notificações, Backup, Aparência...) entram sem
-- migration nova -- basta uma chave nova.
--
-- Chaves usadas nesta etapa:
--   'geral'      -> { nome_instituicao, nome_sistema, logo_url, cnpj, telefone,
--                     email, endereco }  (alimentará os cabeçalhos de relatórios)
--   'seguranca'  -> { sessao_minutos, tentativas_bloqueio }
--
-- Acesso: leitura para quem tem pode_visualizar no módulo 'administracao';
-- gravação somente para quem tem pode_editar no mesmo módulo. Nenhuma política
-- de delete: as chaves são fixas do sistema e não são removidas pela tela.
--
-- Nada aqui altera saldos, fornecedores, pagamentos, tarefas, usuários,
-- histórico, relatórios ou auditoria: é uma tabela nova e um bucket novo.

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

-- O usuário logado pode ABRIR a tela de configurações?
create or replace function public.pode_ver_configuracoes()
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
     and pe.modulo = 'administracao'
    where u.auth_id = auth.uid()
      and u.status = 'ativo'
      and pe.pode_visualizar
  );
$$;

-- O usuário logado pode ALTERAR uma configuração?
create or replace function public.pode_editar_configuracoes()
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
     and pe.modulo = 'administracao'
    where u.auth_id = auth.uid()
      and u.status = 'ativo'
      and pe.pode_editar
  );
$$;

create table if not exists public.configuracoes_sistema (
  id uuid primary key default gen_random_uuid(),
  chave text not null unique,
  valor jsonb not null default '{}'::jsonb,
  atualizado_em timestamptz not null default now(),
  -- on delete set null: a configuração sobrevive à remoção do cadastro de quem salvou.
  atualizado_por uuid references public.usuarios (id) on delete set null
);

-- Quem salvou e quando são preenchidos pelo banco, não pela tela: o rodapé
-- "última alteração" nunca depende de o cliente mandar a informação certa.
create or replace function public.configuracoes_sistema_marcar_autoria()
returns trigger
language plpgsql
as $$
begin
  new.atualizado_em := now();
  new.atualizado_por := coalesce(public.meu_usuario_ativo_id(), new.atualizado_por);
  return new;
end;
$$;

drop trigger if exists configuracoes_sistema_autoria on public.configuracoes_sistema;
create trigger configuracoes_sistema_autoria
  before insert or update on public.configuracoes_sistema
  for each row
  execute function public.configuracoes_sistema_marcar_autoria();

alter table public.configuracoes_sistema enable row level security;

-- Leitura: somente quem tem visualização no módulo 'administracao'.
drop policy if exists "configuracoes_sistema_select_permissao" on public.configuracoes_sistema;
create policy "configuracoes_sistema_select_permissao"
  on public.configuracoes_sistema
  for select
  to authenticated
  using (public.pode_ver_configuracoes());

-- Gravação (a tela usa upsert, então precisa de insert e de update): somente
-- quem tem edição no módulo 'administracao'.
drop policy if exists "configuracoes_sistema_insert_permissao" on public.configuracoes_sistema;
create policy "configuracoes_sistema_insert_permissao"
  on public.configuracoes_sistema
  for insert
  to authenticated
  with check (public.pode_editar_configuracoes());

drop policy if exists "configuracoes_sistema_update_permissao" on public.configuracoes_sistema;
create policy "configuracoes_sistema_update_permissao"
  on public.configuracoes_sistema
  for update
  to authenticated
  using (public.pode_editar_configuracoes())
  with check (public.pode_editar_configuracoes());

-- Sem política de delete: nenhuma tela apaga uma chave de configuração.

grant select, insert, update on public.configuracoes_sistema to authenticated;
revoke delete, truncate on public.configuracoes_sistema from authenticated;
revoke all on public.configuracoes_sistema from anon;

-- Valores iniciais: a tela abre já com a identificação que o sistema usa hoje
-- no topo da barra lateral e nos cabeçalhos de relatório.
insert into public.configuracoes_sistema (chave, valor)
values
  (
    'geral',
    jsonb_build_object(
      'nome_instituicao', 'Secretaria de Finanças',
      'nome_sistema', 'Sistema Financeiro Integrado',
      'logo_url', null,
      'cnpj', '',
      'telefone', '',
      'email', '',
      'endereco', ''
    )
  ),
  (
    'seguranca',
    jsonb_build_object(
      'sessao_minutos', 480,
      'tentativas_bloqueio', 5
    )
  )
on conflict (chave) do nothing;

-- Bucket público da logomarca da instituição. Público porque a imagem aparece
-- em cabeçalhos de relatório e impressões, carregada por URL -- como 'avatares'.
insert into storage.buckets (id, name, public)
values ('configuracoes', 'configuracoes', true)
on conflict (id) do nothing;

drop policy if exists "configuracoes_leitura_publica" on storage.objects;
create policy "configuracoes_leitura_publica"
  on storage.objects
  for select
  using (bucket_id = 'configuracoes');

-- Enviar, substituir e remover a logomarca exige edição em 'administracao'.
drop policy if exists "configuracoes_insert_administracao" on storage.objects;
create policy "configuracoes_insert_administracao"
  on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'configuracoes' and public.pode_editar_configuracoes());

drop policy if exists "configuracoes_update_administracao" on storage.objects;
create policy "configuracoes_update_administracao"
  on storage.objects
  for update
  to authenticated
  using (bucket_id = 'configuracoes' and public.pode_editar_configuracoes())
  with check (bucket_id = 'configuracoes' and public.pode_editar_configuracoes());

drop policy if exists "configuracoes_delete_administracao" on storage.objects;
create policy "configuracoes_delete_administracao"
  on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'configuracoes' and public.pode_editar_configuracoes());
