-- Fonte de identificação de fornecedores para o módulo "Certidões".
--
-- PROBLEMA QUE ESTA MIGRATION RESOLVE
-- O seletor de fornecedor do cadastro de certidão lia public.fornecedores
-- direto. Essa tabela é protegida pelo RLS do módulo Fornecedores, então quem
-- cuida da regularidade documental — e só tem o módulo Certidões — recebia uma
-- lista vazia e não conseguia cadastrar certidão pela própria aba.
--
-- O QUE ELA CRIA
--   public.fornecedores_identificacao -> view somente de IDENTIFICAÇÃO do
--     fornecedor: id, razão social, nome fantasia, CPF/CNPJ, secretaria e
--     situação (ativo/inativo). Nada financeiro passa por aqui.
--
-- O QUE NUNCA APARECE NA VIEW
--   dados bancários (public.fornecedores.dados_bancarios), valores em aberto,
--   notas/lançamentos, histórico de pagamentos, informação tributária e
--   qualquer campo monetário. As colunas são listadas uma a uma, de propósito:
--   um "select *" faria a view herdar colunas novas do cadastro sem revisão.
--
-- LEITURA LIBERADA POR CERTIDÕES, NÃO POR FORNECEDORES
-- O Postgres não aceita política de RLS sobre view (só sobre tabela), e criar
-- uma política nova em public.fornecedores exporia a linha INTEIRA do cadastro
-- — inclusive o que esta migration existe para esconder. Por isso a regra de
-- leitura fica no corpo da própria view, com o mesmo efeito de uma policy de
-- SELECT: a view só devolve linha para quem tem permissão efetiva no módulo
-- 'certidoes', reaproveitando public.permissoes_efetivas e
-- public.meu_usuario_id(). O privilégio concedido é apenas SELECT.
--
-- NENHUMA POLÍTICA EXISTENTE DE public.fornecedores É CRIADA, ALTERADA OU
-- REMOVIDA AQUI. O módulo Fornecedores continua exatamente como está.
--
-- A migration é IDEMPOTENTE: pode ser rodada mais de uma vez sem erro.

-- ---------------------------------------------------------------------------
-- 1. Quem pode ler a identificação do fornecedor
-- ---------------------------------------------------------------------------
-- Security definer para que a checagem não dependa do RLS das tabelas de
-- permissão — mesmo padrão de public.pode_em_certidoes.
--
-- Visualizar, cadastrar ou editar em Certidões já basta: o seletor aparece na
-- listagem (certidoes.pode_visualizar) e no modal de cadastro
-- (certidoes.pode_cadastrar). Permissão no módulo Fornecedores não é
-- consultada em momento algum.
create or replace function public.pode_ler_fornecedores_identificacao()
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
    where u.id = public.meu_usuario_id()
      and u.status = 'ativo'
      and (pe.pode_visualizar or pe.pode_cadastrar or pe.pode_editar)
  );
$$;

-- ---------------------------------------------------------------------------
-- 2. Secretarias que o usuário enxerga
-- ---------------------------------------------------------------------------
-- Ponto único do controle de acesso por secretaria do seletor.
--
-- NULL significa ACESSO TOTAL (vê os fornecedores de todas as secretarias).
-- Uma lista significa usuário RESTRITO: só as secretarias listadas.
--
-- Hoje o banco não guarda restrição de secretaria por usuário — não há coluna
-- em public.usuarios nem tabela de vínculo usuário x secretaria —, então todo
-- mundo é "acesso total" e a função devolve NULL. Ela existe separada para que
-- o dia em que essa restrição for criada baste substituir ESTA função: a view
-- e a tela não mudam.
--
-- Os ids saem como texto para a comparação não depender do tipo da chave de
-- public.secretarias (integer neste banco).
create or replace function public.secretarias_do_meu_usuario_em_certidoes()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select null::text[];
$$;

-- ---------------------------------------------------------------------------
-- 3. A view de identificação
-- ---------------------------------------------------------------------------
-- O corpo é montado dinamicamente por um único motivo: o filtro de exclusão
-- lógica só entra se public.fornecedores já tiver a coluna `excluido_em`
-- (migration 20260823150000). Em banco que ainda não a recebeu, a view é criada
-- do mesmo jeito, sem esse pedaço, em vez de falhar.
drop view if exists public.fornecedores_identificacao;

do $$
declare
  filtro_excluidos text := '';
begin
  if exists (
    select 1
    from pg_attribute
    where attrelid = 'public.fornecedores'::regclass
      and attname = 'excluido_em'
      and not attisdropped
  ) then
    filtro_excluidos := 'and f.excluido_em is null';
  end if;

  execute format($ddl$
    create view public.fornecedores_identificacao
    with (security_barrier = true) as
    select
      f.id,
      f.razao_social,
      f.nome_fantasia,
      f.cpf_cnpj,
      f.secretaria_id,
      s.nome as secretaria_nome,
      f.ativo
    from public.fornecedores f
    left join public.secretarias s on s.id = f.secretaria_id
    where public.pode_ler_fornecedores_identificacao()
      and (
        public.secretarias_do_meu_usuario_em_certidoes() is null
        or f.secretaria_id::text = any (public.secretarias_do_meu_usuario_em_certidoes())
      )
      %s
  $ddl$, filtro_excluidos);
end $$;

comment on view public.fornecedores_identificacao is
  'Identificação dos fornecedores para o módulo Certidões: id, razão social, '
  'nome fantasia, CPF/CNPJ, secretaria e situação. Nunca expõe dados '
  'bancários, valores, notas, pagamentos ou informação tributária. Leitura '
  'liberada por permissão efetiva no módulo certidoes.';

-- A view precisa rodar com os privilégios do dono (e não do usuário logado)
-- para não recair no RLS de public.fornecedores — é justamente esse RLS que
-- deixava o seletor vazio. `security_invoker = false` é o padrão do Postgres;
-- fica explícito aqui para o dia em que o padrão mudar. O bloco tolera versões
-- antigas do Postgres, que não conhecem a opção.
do $$
begin
  execute 'alter view public.fornecedores_identificacao set (security_invoker = false)';
exception
  when others then
    null;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Privilégios: apenas SELECT, apenas para quem está autenticado
-- ---------------------------------------------------------------------------
revoke all on public.fornecedores_identificacao from public;
revoke all on public.fornecedores_identificacao from anon;
grant select on public.fornecedores_identificacao to authenticated;
