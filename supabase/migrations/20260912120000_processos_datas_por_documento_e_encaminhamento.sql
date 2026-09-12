-- MÓDULO PROCESSOS — UMA DATA PRÓPRIA POR DOCUMENTO E O ENCAMINHAMENTO DA
-- PREFEITA À SECRETARIA COM FINANCEIRO.
--
-- ATENÇÃO: esta migration precisa ser rodada MANUALMENTE no SQL Editor do
-- Supabase (projeto usado pela aplicação). Nada nela roda sozinho no deploy.
-- Arquivo: supabase/migrations/20260912120000_processos_datas_por_documento_e_encaminhamento.sql
--
-- ---------------------------------------------------------------------------
-- O QUE ELA FAZ
-- ---------------------------------------------------------------------------
--   1. `requisicao_data` em public.processos_servicos e em
--      public.processos_diarias — a DATA DA REQUISIÇÃO, a data da PÁGINA 1.
--      Cada documento do processo passa a ter a data DELE: a solicitação é
--      feita num dia, a liquidação dias ou semanas depois e a prestação de
--      contas depois ainda. `liquidacao_data` (página 2) e `prestacao_data`
--      (página 3 das diárias) já existiam e continuam como estão.
--      ⚠️ `data_processo` NÃO É REMOVIDA e NÃO MUDA DE SENTIDO: ela continua
--      sendo a data de ABERTURA do processo, usada na listagem e na ordenação.
--      Documento de processo antigo, que não tem `requisicao_data`, continua
--      saindo com `data_processo` — nada impresso muda sozinho.
--   2. `encaminhar_secretaria_id` e `encaminhar_secretaria_nome` nas duas
--      tabelas — a secretaria a quem a PREFEITA encaminha o processo, no bloco
--      de autorização dela ("À SECRETARIA MUNICIPAL DE ______" na Requisição e
--      "À SECRETARIA DE FINANÇAS" na Liquidação).
--      ⚠️ ELA NÃO É A SECRETARIA SOLICITANTE. Quem SOLICITA vem do cadastro
--      próprio do módulo (public.processos_secretarias_solicitantes) e pode ser
--      qualquer secretaria do município; quem PAGA é uma das que têm
--      financeiro, e sai deste campo novo. Uma solicita, a outra paga.
--
-- ---------------------------------------------------------------------------
-- O CADASTRO DE SECRETARIAS DO FINANCEIRO É APENAS LIDO
-- ---------------------------------------------------------------------------
-- As secretarias oferecidas na escolha são as de public.secretarias, o mesmo
-- cadastro que Saldos das Contas e Pagamentos Diários usam. Esta migration NÃO
-- CRIA, NÃO ALTERA e NÃO APAGA nada nele: não há um único insert, update ou
-- delete em public.secretarias neste arquivo, e `encaminhar_secretaria_id` é
-- gravada SEM chave estrangeira, de propósito — assim inativar ou remover uma
-- secretaria no cadastro financeiro nunca é travado nem alterado por causa do
-- módulo Processos, e o documento emitido continua imprimindo o nome que
-- CONGELOU em `encaminhar_secretaria_nome`.
--
-- ---------------------------------------------------------------------------
-- ADITIVA, E SÓ NO MÓDULO PROCESSOS
-- ---------------------------------------------------------------------------
-- Só há `add column if not exists`. NENHUMA coluna é removida ou renomeada,
-- NENHUM dado existente é reescrito, NENHUMA permissão existente é alterada e
-- nenhum gatilho ou política é recriado. Rodar duas vezes é inofensivo.
--
-- E, como todo o módulo, isto é PAPEL: nada aqui debita conta, dá baixa em NF,
-- altera saldo, marca fornecedor como pago, cria pagamento ou toca na
-- Programação Diária. Esta migration não escreve, não altera e não referencia
-- public.pagamentos, public.pagamentos_baixas, public.valores_em_aberto,
-- public.saldos_historico, public.contas_bancarias, public.transferencias_contas
-- nem public.programacoes_pagamento.

begin;

do $$
begin
  if to_regclass('public.processos_diarias') is null then
    raise exception
      'public.processos_diarias não existe: rode antes a migration 20260911160000_processos_modulo_diarias.sql.';
  end if;
  if to_regclass('public.processos_servicos') is null then
    raise exception
      'public.processos_servicos não existe: rode antes a migration 20260911260000_processos_modulo_servicos.sql.';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. Serviços/Materiais — a data da página 1 e o encaminhamento
-- ---------------------------------------------------------------------------
-- A página 2 já tem a data dela (`liquidacao_data`). O que faltava era a da
-- página 1: sem ela, as duas folhas eram obrigadas a sair com a mesma data.
alter table public.processos_servicos
  add column if not exists requisicao_data date,
  add column if not exists encaminhar_secretaria_id uuid,
  add column if not exists encaminhar_secretaria_nome text;

comment on column public.processos_servicos.requisicao_data is
  'Data da Requisição de Material/Serviço (página 1). Em branco, o documento sai com data_processo -- é o que mantém o processo antigo imprimindo como sempre imprimiu.';
comment on column public.processos_servicos.encaminhar_secretaria_id is
  'A secretaria do cadastro FINANCEIRO (public.secretarias) a quem a prefeita encaminha o processo. Sem chave estrangeira de propósito: o cadastro financeiro não é travado nem alterado pelo módulo Processos, e o nome impresso fica congelado em encaminhar_secretaria_nome. NÃO é a secretaria solicitante.';
comment on column public.processos_servicos.encaminhar_secretaria_nome is
  'O nome da secretaria de encaminhamento CONGELADO no processo: renomear a secretaria no cadastro financeiro amanhã não reescreve o documento emitido hoje.';

-- ---------------------------------------------------------------------------
-- 2. Diárias — a data da página 1 e o encaminhamento
-- ---------------------------------------------------------------------------
-- As páginas 2 e 3 já têm as datas delas (`liquidacao_data` e
-- `prestacao_data`). Aqui entra a da página 1, pelo mesmo motivo.
alter table public.processos_diarias
  add column if not exists requisicao_data date,
  add column if not exists encaminhar_secretaria_id uuid,
  add column if not exists encaminhar_secretaria_nome text;

comment on column public.processos_diarias.requisicao_data is
  'Data da Requisição de Diárias (página 1). Em branco, o documento sai com data_processo -- é o que mantém o processo antigo imprimindo como sempre imprimiu.';
comment on column public.processos_diarias.encaminhar_secretaria_id is
  'A secretaria do cadastro FINANCEIRO (public.secretarias) a quem a prefeita encaminha o processo, no bloco de autorização da Liquidação. Sem chave estrangeira de propósito. NÃO é a secretaria solicitante.';
comment on column public.processos_diarias.encaminhar_secretaria_nome is
  'O nome da secretaria de encaminhamento CONGELADO no processo.';

commit;

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA (opcional, depois de rodar)
-- ---------------------------------------------------------------------------
-- As seis colunas novas existem:
--   select table_name, column_name
--     from information_schema.columns
--    where table_schema = 'public'
--      and table_name in ('processos_servicos', 'processos_diarias')
--      and column_name in ('requisicao_data', 'encaminhar_secretaria_id', 'encaminhar_secretaria_nome')
--    order by table_name, column_name;
--
-- O cadastro de secretarias do financeiro continua intacto (a contagem é a
-- mesma de antes de rodar):
--   select count(*) from public.secretarias;
