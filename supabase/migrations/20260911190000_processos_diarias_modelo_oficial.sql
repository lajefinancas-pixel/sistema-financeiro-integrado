-- MÓDULO PROCESSOS — DIÁRIAS NO MODELO OFICIAL DA PREFEITURA.
--
-- ATENÇÃO: esta migration precisa ser rodada MANUALMENTE no SQL Editor do
-- Supabase (projeto usado pela aplicação). Nada nela roda sozinho no deploy.
-- Arquivo: supabase/migrations/20260911190000_processos_diarias_modelo_oficial.sql
--
-- ---------------------------------------------------------------------------
-- O QUE ELA FAZ
-- ---------------------------------------------------------------------------
-- Acrescenta em public.processos_diarias as colunas que o modelo oficial de São
-- José da Laje pede e que a migration 20260911160000 ainda não tinha:
--
--   PÁGINA 1 — REQUISIÇÃO DE DIÁRIAS
--     beneficiario_endereco  endereço do servidor, no bloco de identificação
--     tipo_diaria            o "Tipo de Diária" do formulário
--     custeio_despesas       o custeio a que as diárias se destinam
--     data_diarias           a "Data da(s) Diária(s)", escrita como no papel
--     valor_extenso          a coluna "VALOR POR EXTENSO" do quadro de valores
--     valor_extenso_manual   quem assumiu a redação do extenso à mão
--
--   PÁGINA 3 — PRESTAÇÃO DE CONTAS DE DIÁRIAS
--     prestacao_relatorio    o RELATÓRIO DE ATIVIDADES
--     prestacao_data         a data da prestação de contas
--
-- ---------------------------------------------------------------------------
-- ADITIVA, E SÓ NESTA TABELA
-- ---------------------------------------------------------------------------
-- Só há `add column if not exists`: nenhuma coluna é removida ou renomeada,
-- nenhum dado existente é reescrito e NENHUMA outra tabela é tocada. Os campos
-- antigos da liquidação continuam onde estão, com o conteúdo que têm — os
-- relatórios já digitados em liquidacao_relatorio seguem sendo lidos e
-- impressos na página 3 enquanto prestacao_relatorio estiver vazio.
--
-- Rodar duas vezes é inofensivo. E, como todo o módulo, isto é PAPEL: estas
-- colunas não debitam conta, não dão baixa em NF, não alteram saldo, não marcam
-- fornecedor como pago e não criam pagamento. Esta migration não escreve, não
-- altera e não referencia public.pagamentos, public.pagamentos_baixas,
-- public.valores_em_aberto, public.saldos_historico, public.contas_bancarias,
-- public.transferencias_contas, public.programacoes_pagamento nem
-- public.fornecedores.
--
-- O gatilho public.conferir_alteracao_processo_diaria compara o conteúdo por
-- to_jsonb(old)/to_jsonb(new), então as colunas novas já entram na mesma trava
-- de edição (só rascunho, e só com permissão de editar) sem precisar de ajuste.

begin;

do $$
begin
  if to_regclass('public.processos_diarias') is null then
    raise exception
      'public.processos_diarias não existe: rode antes a migration 20260911160000_processos_modulo_diarias.sql.';
  end if;
end
$$;

-- PÁGINA 1 — REQUISIÇÃO DE DIÁRIAS -----------------------------------------
-- O endereço e o valor por extenso são COMPARTILHADOS: a página 1 os usa na
-- identificação do servidor e no quadro de valores, e a página 2 os repete no
-- favorecido e no valor autorizado. Uma coluna só, lida pelas duas — é o que
-- impede as páginas de divergirem.
alter table public.processos_diarias
  add column if not exists beneficiario_endereco text,
  add column if not exists tipo_diaria text,
  add column if not exists custeio_despesas text,
  add column if not exists data_diarias text,
  add column if not exists valor_extenso text,
  add column if not exists valor_extenso_manual boolean not null default false;

-- PÁGINA 3 — PRESTAÇÃO DE CONTAS DE DIÁRIAS ---------------------------------
-- Ela é preenchida DEPOIS da viagem. Ficar pendente é o normal, e não impede
-- salvar, finalizar nem imprimir a Requisição e a Liquidação.
alter table public.processos_diarias
  add column if not exists prestacao_relatorio text,
  add column if not exists prestacao_data date;

comment on column public.processos_diarias.beneficiario_endereco is
  'Endereço do servidor. Página 1 (identificação) e página 2 (favorecido) leem esta mesma coluna.';
comment on column public.processos_diarias.tipo_diaria is
  'Tipo de Diária, como escrito no formulário oficial. Texto livre: o sistema não impõe lista.';
comment on column public.processos_diarias.custeio_despesas is
  'O custeio a que as diárias se destinam ("Requisita: N diária(s) destinada(s) ao custeio de despesas ...").';
comment on column public.processos_diarias.data_diarias is
  'Data da(s) Diária(s) como no papel ("10 e 11/03/2026"). Vazio: o documento imprime o período da viagem.';
comment on column public.processos_diarias.valor_extenso is
  'Coluna VALOR POR EXTENSO do quadro de valores. Gerada do valor total e editável à mão.';
comment on column public.processos_diarias.valor_extenso_manual is
  'true quando a redação do extenso foi assumida à mão e o automático não deve sobrescrevê-la.';
comment on column public.processos_diarias.prestacao_relatorio is
  'RELATÓRIO DE ATIVIDADES da página 3. Preenchido depois da viagem; pendente não impede nada.';
comment on column public.processos_diarias.prestacao_data is
  'Data da prestação de contas (o "São José da Laje - AL, __ de __ de ____" da página 3).';

comment on table public.processos_diarias is
  'Processo de diária: UMA linha com as TRÊS páginas do documento oficial (Requisição, Liquidação/Solicitação de Pagamento e Prestação de Contas). Documental, não financeiro — nada aqui debita conta, dá baixa em NF, altera saldo ou cria pagamento.';

commit;
