-- Módulo "Certidões" — renovação com histórico preservado.
--
-- A renovação NÃO apaga e NÃO sobrescreve a certidão anterior: ela cadastra uma
-- nova emissão e marca a antiga como substituída. Assim a cadeia de versões de
-- um mesmo documento continua inteira no banco, disponível só para consulta.
--
-- Uma única coluna sustenta isso:
--   certidoes.substituida_por -> id da certidão que passou a valer no lugar
--                                desta. Nula = certidão vigente (o caso de
--                                todas as linhas que já existem hoje).
--   certidoes.substituida_em  -> quando a substituição aconteceu.
--
-- Consequência para as telas: "vigente" é `substituida_por is null`. A listagem
-- de Certidões, o card do Painel Principal e a Vida do Fornecedor continuam
-- mostrando exatamente o mesmo conteúdo de antes, porque nenhuma linha existente
-- é marcada por esta migration.
--
-- Nada aqui altera saldos, fornecedores, pagamentos, tarefas, usuários,
-- histórico, relatórios, auditoria ou configurações. As permissões, o RLS e o
-- bucket de anexos do módulo seguem como estão: renovar é um insert + um update
-- em public.certidoes, já cobertos pelas políticas existentes.
--
-- A migration é IDEMPOTENTE: pode ser rodada mais de uma vez sem erro.

-- ---------------------------------------------------------------------------
-- 1. Colunas da cadeia de versões
-- ---------------------------------------------------------------------------
-- on delete set null: se a certidão nova for excluída, a anterior volta a ser a
-- vigente em vez de sumir junto — o documento do fornecedor nunca fica órfão.
alter table public.certidoes
  add column if not exists substituida_por uuid references public.certidoes (id) on delete set null;

alter table public.certidoes
  add column if not exists substituida_em timestamptz;

-- ---------------------------------------------------------------------------
-- 2. Índices
-- ---------------------------------------------------------------------------
-- Montagem da cadeia no detalhe da certidão (quem foi substituída por quem).
create index if not exists certidoes_substituida_por_idx
  on public.certidoes (substituida_por);

-- A listagem só pede as vigentes, ordenadas por vencimento.
create index if not exists certidoes_vigentes_vencimento_idx
  on public.certidoes (data_vencimento)
  where substituida_por is null;

-- A cadeia é linear: uma certidão nova substitui no máximo uma anterior.
create unique index if not exists certidoes_substituta_unica_idx
  on public.certidoes (substituida_por)
  where substituida_por is not null;

-- ---------------------------------------------------------------------------
-- 3. Uma certidão não pode substituir a si mesma
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.certidoes'::regclass
      and conname = 'certidoes_substituida_por_check'
  ) then
    alter table public.certidoes
      add constraint certidoes_substituida_por_check
      check (substituida_por is null or substituida_por <> id);
  end if;
end $$;
