-- Módulo "Certidões" — controle das certidões e documentos dos fornecedores.
--
-- Cria duas tabelas novas:
--   public.tipos_certidao -> catálogo dos tipos de documento (Federal, Estadual,
--                            Municipal, FGTS, Trabalhista, Cartão de CNPJ...),
--                            cada um dizendo se vence e em quantos dias;
--   public.certidoes      -> a certidão de um fornecedor: número, emissão,
--                            vencimento, situação, observações e o anexo.
--
-- Também cria o bucket de arquivos "certidoes-anexos" e libera o módulo
-- 'certidoes' para os perfis Administrador e Gestora Financeira.
--
-- Nada aqui altera saldos, fornecedores, pagamentos, tarefas, usuários,
-- histórico, relatórios, auditoria ou configurações: as tabelas são novas e as
-- únicas linhas acrescentadas em tabelas existentes são as permissões do módulo
-- novo em public.perfis_permissoes.
--
-- A migration é IDEMPOTENTE: pode ser rodada mais de uma vez sem erro e sem
-- duplicar tipos, permissões ou políticas.

-- ---------------------------------------------------------------------------
-- 1. Checagem de permissão do módulo (mesmo padrão de 'tarefas')
-- ---------------------------------------------------------------------------
-- Security definer para que as políticas não dependam do RLS das tabelas de
-- permissão.
create or replace function public.pode_em_certidoes(acao text)
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
     and pe.modulo = 'certidoes'
    where u.auth_id = auth.uid()
      and u.status = 'ativo'
      and case acao
            when 'visualizar' then pe.pode_visualizar
            when 'cadastrar'  then pe.pode_cadastrar
            when 'editar'     then pe.pode_editar
            when 'excluir'    then pe.pode_excluir
            when 'aprovar'    then pe.pode_aprovar
            else false
          end
  );
$$;

-- ---------------------------------------------------------------------------
-- 2. public.tipos_certidao — catálogo dos tipos de documento
-- ---------------------------------------------------------------------------
create table if not exists public.tipos_certidao (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  descricao text,
  -- Documentos como o Cartão de CNPJ não vencem: nesses tipos a tela esconde o
  -- campo de vencimento e a certidão fica com data_vencimento nula.
  possui_vencimento boolean not null default true,
  -- Validade sugerida em dias, usada para pré-preencher o vencimento no cadastro.
  prazo_padrao_dias integer,
  obrigatorio boolean not null default false,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

-- Colunas acrescentadas caso a tabela já exista parcialmente no banco.
alter table public.tipos_certidao add column if not exists descricao text;
alter table public.tipos_certidao add column if not exists possui_vencimento boolean not null default true;
alter table public.tipos_certidao add column if not exists prazo_padrao_dias integer;
alter table public.tipos_certidao add column if not exists obrigatorio boolean not null default false;
alter table public.tipos_certidao add column if not exists ativo boolean not null default true;
alter table public.tipos_certidao add column if not exists criado_em timestamptz not null default now();

-- Um tipo por nome: evita "Certidão Federal" duplicada e sustenta o seed abaixo.
create unique index if not exists tipos_certidao_nome_idx on public.tipos_certidao (nome);

-- ---------------------------------------------------------------------------
-- 3. public.certidoes — a certidão de cada fornecedor
-- ---------------------------------------------------------------------------
-- As chaves estrangeiras copiam o tipo real de public.fornecedores.id e
-- public.usuarios.id (o mesmo cuidado da migration de movimentações de
-- pagamento), para que a tabela funcione independentemente de como esses ids
-- foram definidos na primeira versão do banco.
do $$
declare
  tipo_fornecedor text;
  tipo_usuario text;
begin
  if to_regclass('public.certidoes') is not null then
    return;
  end if;

  select format_type(a.atttypid, a.atttypmod) into tipo_fornecedor
    from pg_attribute a
   where a.attrelid = 'public.fornecedores'::regclass and a.attname = 'id';

  select format_type(a.atttypid, a.atttypmod) into tipo_usuario
    from pg_attribute a
   where a.attrelid = 'public.usuarios'::regclass and a.attname = 'id';

  execute format($ddl$
    create table public.certidoes (
      id uuid primary key default gen_random_uuid(),
      fornecedor_id %1$s not null references public.fornecedores (id) on delete cascade,
      tipo_certidao_id uuid not null references public.tipos_certidao (id) on delete restrict,
      numero_documento text,
      data_emissao date not null,
      -- Nula quando o tipo não possui vencimento (ex.: Cartão de CNPJ).
      data_vencimento date,
      -- Situação gravada no cadastro. A tela reavalia pelas datas ao exibir,
      -- para que uma certidão salva como válida não continue "válida" depois
      -- de a data de vencimento passar.
      situacao text not null default 'valida'
        constraint certidoes_situacao_check
        check (situacao in ('valida', 'a_vencer', 'vencida', 'sem_vencimento', 'em_renovacao')),
      observacoes text,
      -- URL pública do arquivo no bucket "certidoes-anexos" (opcional).
      arquivo_url text,
      -- on delete set null: a certidão sobrevive à remoção do cadastro do usuário.
      responsavel_id %2$s references public.usuarios (id) on delete set null,
      criado_em timestamptz not null default now(),
      atualizado_em timestamptz not null default now()
    )
  $ddl$, tipo_fornecedor, tipo_usuario);
end $$;

alter table public.certidoes add column if not exists numero_documento text;
alter table public.certidoes add column if not exists data_vencimento date;
alter table public.certidoes add column if not exists observacoes text;
alter table public.certidoes add column if not exists arquivo_url text;
alter table public.certidoes add column if not exists criado_em timestamptz not null default now();
alter table public.certidoes add column if not exists atualizado_em timestamptz not null default now();

-- Consultas da tela: lista por fornecedor e ordenação por vencimento
-- (base dos filtros "a vencer" e "vencidas" da próxima etapa).
create index if not exists certidoes_fornecedor_idx on public.certidoes (fornecedor_id);
create index if not exists certidoes_tipo_idx on public.certidoes (tipo_certidao_id);
create index if not exists certidoes_vencimento_idx on public.certidoes (data_vencimento);

-- "atualizado_em" sempre reflete a última edição, sem depender da tela.
create or replace function public.certidoes_marcar_atualizacao()
returns trigger
language plpgsql
as $$
begin
  new.atualizado_em := now();
  return new;
end;
$$;

drop trigger if exists certidoes_atualizado_em on public.certidoes;
create trigger certidoes_atualizado_em
  before update on public.certidoes
  for each row
  execute function public.certidoes_marcar_atualizacao();

-- ---------------------------------------------------------------------------
-- 4. RLS — mesmo modelo de permissões do restante do sistema
-- ---------------------------------------------------------------------------
alter table public.tipos_certidao enable row level security;

drop policy if exists "tipos_certidao_select_modulo" on public.tipos_certidao;
create policy "tipos_certidao_select_modulo"
  on public.tipos_certidao
  for select
  to authenticated
  using (public.pode_em_certidoes('visualizar'));

drop policy if exists "tipos_certidao_insert_modulo" on public.tipos_certidao;
create policy "tipos_certidao_insert_modulo"
  on public.tipos_certidao
  for insert
  to authenticated
  with check (public.pode_em_certidoes('cadastrar'));

drop policy if exists "tipos_certidao_update_modulo" on public.tipos_certidao;
create policy "tipos_certidao_update_modulo"
  on public.tipos_certidao
  for update
  to authenticated
  using (public.pode_em_certidoes('editar'))
  with check (public.pode_em_certidoes('editar'));

drop policy if exists "tipos_certidao_delete_modulo" on public.tipos_certidao;
create policy "tipos_certidao_delete_modulo"
  on public.tipos_certidao
  for delete
  to authenticated
  using (public.pode_em_certidoes('excluir'));

alter table public.certidoes enable row level security;

drop policy if exists "certidoes_select_modulo" on public.certidoes;
create policy "certidoes_select_modulo"
  on public.certidoes
  for select
  to authenticated
  using (public.pode_em_certidoes('visualizar'));

drop policy if exists "certidoes_insert_modulo" on public.certidoes;
create policy "certidoes_insert_modulo"
  on public.certidoes
  for insert
  to authenticated
  with check (public.pode_em_certidoes('cadastrar'));

drop policy if exists "certidoes_update_modulo" on public.certidoes;
create policy "certidoes_update_modulo"
  on public.certidoes
  for update
  to authenticated
  using (public.pode_em_certidoes('editar'))
  with check (public.pode_em_certidoes('editar'));

drop policy if exists "certidoes_delete_modulo" on public.certidoes;
create policy "certidoes_delete_modulo"
  on public.certidoes
  for delete
  to authenticated
  using (public.pode_em_certidoes('excluir'));

grant select, insert, update, delete on public.tipos_certidao to authenticated;
grant select, insert, update, delete on public.certidoes to authenticated;
revoke all on public.tipos_certidao from anon;
revoke all on public.certidoes from anon;

-- ---------------------------------------------------------------------------
-- 5. Bucket dos arquivos anexados
-- ---------------------------------------------------------------------------
-- Mesmo desenho dos anexos de tarefas: leitura pública porque a tela guarda a
-- URL pública em certidoes.arquivo_url, e o caminho inclui o id do fornecedor,
-- que não é adivinhável.
insert into storage.buckets (id, name, public)
values ('certidoes-anexos', 'certidoes-anexos', true)
on conflict (id) do nothing;

drop policy if exists "certidoes_anexos_leitura_publica" on storage.objects;
create policy "certidoes_anexos_leitura_publica"
  on storage.objects
  for select
  using (bucket_id = 'certidoes-anexos');

drop policy if exists "certidoes_anexos_insert_autenticado" on storage.objects;
create policy "certidoes_anexos_insert_autenticado"
  on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'certidoes-anexos');

drop policy if exists "certidoes_anexos_delete_autenticado" on storage.objects;
create policy "certidoes_anexos_delete_autenticado"
  on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'certidoes-anexos');

-- ---------------------------------------------------------------------------
-- 6. Seed dos tipos padrão
-- ---------------------------------------------------------------------------
-- Prazos usuais das certidões de regularidade fiscal (180 dias, 90 dias no
-- FGTS). O Cartão de CNPJ é um comprovante de cadastro: não vence.
insert into public.tipos_certidao (nome, descricao, possui_vencimento, prazo_padrao_dias, obrigatorio, ativo)
values
  ('Certidão Federal', 'Certidão negativa de débitos relativos a tributos federais e à dívida ativa da União.', true, 180, true, true),
  ('Certidão Estadual', 'Certidão negativa de débitos com a Fazenda Estadual.', true, 180, true, true),
  ('Certidão Municipal', 'Certidão negativa de débitos com a Fazenda Municipal.', true, 180, true, true),
  ('Certidão de Regularidade do FGTS', 'Certificado de regularidade do FGTS (CRF) emitido pela Caixa Econômica Federal.', true, 90, true, true),
  ('Certidão Trabalhista', 'Certidão negativa de débitos trabalhistas (CNDT) emitida pela Justiça do Trabalho.', true, 180, true, true),
  ('Cartão de CNPJ', 'Comprovante de inscrição e de situação cadastral do fornecedor na Receita Federal.', false, null, false, true)
on conflict (nome) do nothing;

-- ---------------------------------------------------------------------------
-- 7. Permissões do módulo 'certidoes'
-- ---------------------------------------------------------------------------
-- Cada perfil ganha uma linha do módulo novo, do mesmo jeito que os demais
-- módulos: Administrador com tudo liberado, Gestora Financeira podendo ver,
-- cadastrar e editar, e os demais perfis criados sem acesso (a aba "Permissões"
-- da tela de usuários ajusta caso a caso).
insert into public.perfis_permissoes (
  perfil_id, modulo,
  pode_visualizar, pode_cadastrar, pode_editar, pode_excluir, pode_aprovar, pode_visualizar_valores
)
select
  p.id,
  'certidoes',
  p.nome in ('Administrador', 'Gestora Financeira'),
  p.nome in ('Administrador', 'Gestora Financeira'),
  p.nome in ('Administrador', 'Gestora Financeira'),
  p.nome = 'Administrador',
  p.nome = 'Administrador',
  false
from public.perfis_acesso p
where not exists (
  select 1
  from public.perfis_permissoes pp
  where pp.perfil_id = p.id
    and pp.modulo = 'certidoes'
);
