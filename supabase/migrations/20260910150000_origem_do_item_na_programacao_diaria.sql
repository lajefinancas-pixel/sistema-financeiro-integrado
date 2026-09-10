-- ORIGEM DO ITEM DA PROGRAMAÇÃO DIÁRIA — de qual registro de área ele veio.
--
-- ATENÇÃO: esta migration precisa ser rodada MANUALMENTE no SQL Editor do
-- Supabase (o mesmo projeto usado pela aplicação). Nada nela roda sozinho no
-- deploy. Arquivo:
-- supabase/migrations/20260910150000_origem_do_item_na_programacao_diaria.sql
--
-- Enquanto ela não rodar, TUDO continua funcionando como hoje: a tela de
-- Programação Diária repete a consulta sem as colunas novas, a ação
-- "Adicionar à Programação" continua levando fornecedor e valor, e apenas o
-- registro da origem deixa de ser gravado.
--
-- O QUE ELA CRIA (duas colunas NOVAS, OPCIONAIS, no ITEM da programação)
--
--   1. public.pagamentos.origem_tipo -> 'patrocinio', 'aluguel' ou 'banda'.
--   2. public.pagamentos.origem_id   -> o id (uuid) do registro daquela área.
--
-- ITEM SEM ORIGEM É O CASO NORMAL. Todo item já existente fica com as duas
-- colunas vazias, e todo item adicionado do jeito de sempre (marcando o
-- fornecedor na lista) continua sendo gravado com as duas vazias. A origem só
-- aparece quando o item foi criado a partir de um registro de Patrocínios,
-- Aluguéis ou Bandas.
--
-- O VÍNCULO DO PAGAMENTO CONTINUA SENDO fornecedor_id
--
-- origem_tipo/origem_id são INFORMAÇÃO ADICIONAL. Não são, em nenhuma hipótese,
-- critério de busca de nota ou de processo: quem liga o item ao cadastro, à NF
-- e à baixa continua sendo public.pagamentos.fornecedor_id, como sempre. A
-- origem serve para o registro da área saber que foi programado.
--
-- NÃO EXISTE SEGUNDO CONTROLE DE VALOR PAGO
--
-- Esta migration não cria nenhuma coluna de valor pago em nenhuma tabela de
-- área, e não escreve nada nas tabelas de área. Pago e Saldo de um patrocínio,
-- aluguel ou banda continuam sendo CALCULADOS a partir das baixas das NFs
-- vinculadas (public.valores_em_aberto.valor_pago), exatamente como a
-- 20260910140000 definiu.
--
-- REGRAS FINANCEIRAS PRESERVADAS, SEM EXCEÇÃO
--
--   * A BAIXA NÃO DEBITA O SALDO DA CONTA: nada aqui toca baixa, saldo, valor
--     em aberto ou movimentação. Nenhuma lógica de baixa nova é criada — a
--     baixa continua exclusivamente por NF/processo, na aba de Baixas.
--   * CONTA SELECIONADA ≠ CONTA DEBITADA. PROGRAMADO ≠ PAGO. APROVADO ≠ PAGO:
--     salvar_planejamento_programacao continua gravando somente a proposta.
--   * TRANSFERÊNCIA ENTRE CONTAS NÃO É DESPESA: intocada.
--   * Nenhuma coluna é removida ou renomeada, nenhum registro existente é
--     alterado, nenhum saldo é recalculado.
--
-- PRÉ-REQUISITOS (já rodados neste banco): a 20260905120000, que criou
-- public.pagamentos.nome_exibicao_programacao e a versão atual de
-- public.salvar_planejamento_programacao, e a 20260910140000, que criou as
-- tabelas das áreas.
--
-- IDEMPOTENTE: pode rodar quantas vezes for preciso. ADITIVA: não apaga nem
-- reescreve nenhum dado existente.

begin;

-- ---------------------------------------------------------------------------
-- 0. Conferência da estrutura real ANTES de qualquer alteração
-- ---------------------------------------------------------------------------
-- Se algo não bater, a migration aborta aqui, antes do primeiro DDL.
do $$
declare
  item record;
  tipo_real text;
begin
  for item in
    select * from (values
      ('pagamentos', 'id', 'integer'),
      ('pagamentos', 'fornecedor_id', 'integer'),
      ('pagamentos', 'nome_exibicao_programacao', 'text'),
      -- As áreas usam uuid como chave: é esse o tipo de origem_id.
      ('fornecedor_patrocinios', 'id', 'uuid'),
      ('fornecedor_alugueis', 'id', 'uuid'),
      ('fornecedor_bandas', 'id', 'uuid')
    ) as tipos(tabela, coluna, esperado)
  loop
    if to_regclass(format('public.%I', item.tabela)) is null then
      raise exception 'Estrutura incompatível: public.% não existe. Rode antes a migration que a cria (20260905120000 para pagamentos.nome_exibicao_programacao, 20260910140000 para as tabelas das áreas).', item.tabela;
    end if;

    select format_type(a.atttypid, a.atttypmod)
      into tipo_real
      from pg_attribute a
     where a.attrelid = to_regclass(format('public.%I', item.tabela))
       and a.attname = item.coluna
       and not a.attisdropped;

    if tipo_real is distinct from item.esperado then
      raise exception 'Tipo incompatível em public.%.%: esperado %, encontrado %.',
        item.tabela, item.coluna, item.esperado, coalesce(tipo_real, 'coluna ausente');
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 1. As duas colunas de origem, no item da programação
-- ---------------------------------------------------------------------------
alter table public.pagamentos
  add column if not exists origem_tipo text;

alter table public.pagamentos
  add column if not exists origem_id uuid;

comment on column public.pagamentos.origem_tipo is
  'De qual área veio este item da programação: patrocinio, aluguel ou banda. Vazio no caso normal (item adicionado direto pela lista de fornecedores). Informação adicional: NUNCA é critério de busca de nota ou de processo.';

comment on column public.pagamentos.origem_id is
  'Id (uuid) do registro da área que originou este item. Vazio no caso normal. O vínculo do pagamento com o cadastro continua sendo fornecedor_id.';

-- ---------------------------------------------------------------------------
-- 2. Regras das duas colunas
-- ---------------------------------------------------------------------------
-- Sem chave estrangeira de propósito: são três tabelas de origem possíveis, e
-- uma FK só aceitaria uma. O tipo aceito é conferido por constraint.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = to_regclass('public.pagamentos')
       and conname = 'pagamentos_origem_tipo_check'
  ) then
    alter table public.pagamentos
      add constraint pagamentos_origem_tipo_check
      check (origem_tipo is null or origem_tipo in ('patrocinio', 'aluguel', 'banda'));
  end if;

  -- Ou os dois vazios (o caso normal), ou os dois preenchidos. Meia origem não
  -- serve para nada e esconderia erro de gravação.
  if not exists (
    select 1 from pg_constraint
     where conrelid = to_regclass('public.pagamentos')
       and conname = 'pagamentos_origem_completa_check'
  ) then
    alter table public.pagamentos
      add constraint pagamentos_origem_completa_check
      check (
        (origem_tipo is null and origem_id is null)
        or (origem_tipo is not null and origem_id is not null)
      );
  end if;
end $$;

-- Índice parcial: só os itens COM origem entram nele. Serve para o registro da
-- área encontrar as programações que o citaram.
create index if not exists pagamentos_origem_idx
  on public.pagamentos (origem_tipo, origem_id)
  where origem_tipo is not null;

-- ---------------------------------------------------------------------------
-- 3. Salvar o planejamento — agora gravando também a origem do item
-- ---------------------------------------------------------------------------
-- Corpo IGUAL ao da 20260905120000. As únicas diferenças são origem_tipo e
-- origem_id no UPDATE e no INSERT dos itens. Tudo o mais fica como está:
-- excluido_por continua recebendo public.usuarios.id (nunca auth.uid()),
-- fornecedor inexistente continua recusado em português, o 23503 continua
-- explicado por vínculo e SALVAR CONTINUA NÃO SENDO PAGAR.
--
-- No UPDATE a origem é PRESERVADA quando o cliente não manda nada (coalesce):
-- uma tela antiga, que não conhece as colunas novas, não apaga a origem de um
-- item que já tinha.
create or replace function public.salvar_planejamento_programacao(
  p_programacao_id integer,
  p_contas jsonb,
  p_pagamentos jsonb,
  p_saldo_considerado numeric,
  p_total_programado numeric,
  p_restante numeric
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_usuario uuid;
  -- Id em public.usuarios: é ele, e não auth.uid(), que as colunas com chave
  -- estrangeira para essa tabela aceitam.
  v_usuario_registro uuid;
  v_status_anterior text;
  v_fechado_texto text;
  v_conta jsonb;
  v_pagamento jsonb;
  v_pagamento_id integer;
  v_fornecedor_id integer;
  v_situacao_fornecedor text;
  v_valor numeric(14,2);
  v_nome_exibicao text;
  -- Origem do item: informação adicional, nunca vínculo de nota.
  v_origem_tipo text;
  v_origem_texto text;
  v_origem_id uuid;
  v_etapa text := 'início';
  -- Campos estruturados do erro, lidos no tratamento de exceção.
  v_constraint text;
  v_tabela_erro text;
  v_coluna_erro text;
  v_detalhe_erro text;
  v_explicacao text;
begin
  v_etapa := 'conferência da sessão';
  v_usuario := auth.uid();
  if v_usuario is null then
    raise exception 'Usuário não autenticado.' using errcode = '42501';
  end if;
  v_usuario_registro := public.usuario_registro_id();

  v_etapa := 'leitura da programação';
  select pr.status::text, pr.fechado::text
    into v_status_anterior, v_fechado_texto
    from public.programacoes_pagamento pr
   where pr.id = p_programacao_id
   for update;

  if not found then
    raise exception 'Programação não encontrada.';
  end if;

  if lower(coalesce(v_fechado_texto, '')) in ('true', 't', 'sim', '1', 'y', 'yes') then
    raise exception 'Programações históricas fechadas não podem ser alteradas.';
  end if;

  if jsonb_typeof(coalesce(p_contas, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_pagamentos, '[]'::jsonb)) <> 'array' then
    raise exception 'Contas e pagamentos devem ser listas.';
  end if;

  -- Conferência dos fornecedores ANTES de gravar qualquer coisa: id que não
  -- existe mais no cadastro vira recusa explicada, e nada foi alterado.
  v_etapa := 'conferência dos fornecedores selecionados';
  for v_pagamento in select value from jsonb_array_elements(coalesce(p_pagamentos, '[]'::jsonb))
  loop
    v_fornecedor_id := nullif(v_pagamento->>'fornecedor_id', '')::integer;
    if v_fornecedor_id is not null then
      v_situacao_fornecedor := public.fornecedor_referenciavel(v_fornecedor_id);
      if v_situacao_fornecedor = 'ausente' then
        raise exception 'Um dos fornecedores escolhidos não existe mais no cadastro. Remova-o da lista de fornecedores da programação, escolha o fornecedor novamente e salve.';
      end if;
    end if;
  end loop;

  v_etapa := 'gravação dos totais da programação';
  update public.programacoes_pagamento
     set saldo_considerado = round(coalesce(p_saldo_considerado, 0), 2),
         total_programado = round(coalesce(p_total_programado, 0), 2),
         restante = round(coalesce(p_restante, 0), 2),
         responsavel_id = v_usuario,
         updated_at = now()
   where id = p_programacao_id;

  v_etapa := 'gravação das contas de trabalho';
  update public.programacao_contas
     set ativa = false
   where programacao_id = p_programacao_id;

  for v_conta in select value from jsonb_array_elements(coalesce(p_contas, '[]'::jsonb))
  loop
    update public.programacao_contas
       set saldo_considerado = round(coalesce((v_conta->>'saldo_considerado')::numeric, 0), 2),
           ordem = coalesce((v_conta->>'ordem')::integer, 1),
           ativa = true,
           valor_rateado = 0
     where programacao_id = p_programacao_id
       and conta_id = (v_conta->>'conta_id')::integer;

    if not found then
      insert into public.programacao_contas (
        programacao_id, conta_id, saldo_considerado, ordem, ativa, valor_rateado
      ) values (
        p_programacao_id,
        (v_conta->>'conta_id')::integer,
        round(coalesce((v_conta->>'saldo_considerado')::numeric, 0), 2),
        coalesce((v_conta->>'ordem')::integer, 1),
        true,
        0
      );
    end if;
  end loop;

  v_etapa := 'gravação dos fornecedores da programação';
  -- excluido_por aponta para public.usuarios (id): vai o id do registro do
  -- usuário -- ou NULL, que a coluna aceita -- e NUNCA auth.uid().
  update public.pagamentos
     set excluido_em = now(),
         excluido_por = v_usuario_registro
   where programacao_id = p_programacao_id
     and excluido_em is null
     and coalesce(situacao::text, '') in ('programado', 'em_aberto');

  for v_pagamento in select value from jsonb_array_elements(coalesce(p_pagamentos, '[]'::jsonb))
  loop
    v_valor := round(coalesce((v_pagamento->>'valor_a_pagar')::numeric, 0), 2);
    if v_valor < 0 then
      raise exception 'O valor programado não pode ser negativo.';
    end if;

    -- Nome de exibição DESTE item: espaços normalizados, vazio virando NULL
    -- ("usar o apelido; não havendo, a razão social") e tamanho limitado. Ele
    -- não é usado para nada além de mostrar e imprimir.
    v_nome_exibicao := nullif(btrim(regexp_replace(coalesce(v_pagamento->>'nome_exibicao_programacao', ''), '\s+', ' ', 'g')), '');
    if v_nome_exibicao is not null then
      v_nome_exibicao := left(v_nome_exibicao, 120);
    end if;

    -- Origem DESTE item. Vazia é o caso normal. Origem incompleta ou com tipo
    -- desconhecido é recusada em português, antes de gravar.
    v_origem_tipo := nullif(btrim(lower(coalesce(v_pagamento->>'origem_tipo', ''))), '');
    v_origem_texto := nullif(btrim(coalesce(v_pagamento->>'origem_id', '')), '');

    if v_origem_tipo is not null and v_origem_tipo not in ('patrocinio', 'aluguel', 'banda') then
      raise exception 'A origem enviada para um item da programação não é reconhecida (%). Recarregue a página e tente de novo.', v_origem_tipo;
    end if;

    if v_origem_texto is not null
       and v_origem_texto !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'A origem enviada para um item da programação não tem um identificador válido. Recarregue a página e tente de novo.';
    end if;

    if (v_origem_tipo is null) <> (v_origem_texto is null) then
      raise exception 'A origem enviada para um item da programação está incompleta. Recarregue a página e tente de novo.';
    end if;

    v_origem_id := v_origem_texto::uuid;

    v_pagamento_id := nullif(v_pagamento->>'id', '')::integer;
    if v_pagamento_id is not null then
      update public.pagamentos
         set fornecedor_id = nullif(v_pagamento->>'fornecedor_id', '')::integer,
             nome_avulso = nullif(trim(v_pagamento->>'nome_avulso'), ''),
             nome_exibicao_programacao = v_nome_exibicao,
             valor_a_pagar = v_valor,
             cadastrar_fornecedor_posteriormente = coalesce((v_pagamento->>'cadastrar_fornecedor_posteriormente')::boolean, false),
             -- Origem preservada quando o cliente não manda nada.
             origem_tipo = coalesce(v_origem_tipo, pagamentos.origem_tipo),
             origem_id = coalesce(v_origem_id, pagamentos.origem_id),
             excluido_em = null,
             excluido_por = null
       where id = v_pagamento_id
         and programacao_id = p_programacao_id
         and coalesce(situacao::text, '') in ('programado', 'em_aberto');

      if not found then
        raise exception 'Item de pagamento inválido para esta programação.';
      end if;
    else
      insert into public.pagamentos (
        programacao_id,
        fornecedor_id,
        nome_avulso,
        nome_exibicao_programacao,
        valor_a_pagar,
        situacao,
        cadastrar_fornecedor_posteriormente,
        origem_tipo,
        origem_id
      ) values (
        p_programacao_id,
        nullif(v_pagamento->>'fornecedor_id', '')::integer,
        nullif(trim(v_pagamento->>'nome_avulso'), ''),
        v_nome_exibicao,
        v_valor,
        'programado',
        coalesce((v_pagamento->>'cadastrar_fornecedor_posteriormente')::boolean, false),
        v_origem_tipo,
        v_origem_id
      );
    end if;
  end loop;

  v_etapa := 'registro na auditoria';
  begin
    insert into public.auditoria_eventos (
      usuario_id, modulo, acao, registro_afetado, valor_anterior, valor_novo, nivel
    ) values (
      public.usuario_auditoria_id(),
      'pagamentos',
      'alterou',
      'Planejamento da programação ' || p_programacao_id::text,
      jsonb_build_object('status', v_status_anterior),
      jsonb_build_object(
        'contas', jsonb_array_length(coalesce(p_contas, '[]'::jsonb)),
        'fornecedores', jsonb_array_length(coalesce(p_pagamentos, '[]'::jsonb)),
        'saldo_considerado', round(coalesce(p_saldo_considerado, 0), 2),
        'total_programado', round(coalesce(p_total_programado, 0), 2),
        'restante', round(coalesce(p_restante, 0), 2)
      ),
      'informacao'
    );
  exception when others then
    raise warning 'Planejamento da programação % salvo, mas o evento de auditoria não foi gravado (% -- %).',
      p_programacao_id, sqlstate, sqlerrm;
  end;

  return jsonb_build_object(
    'ok', true,
    'programacao_id', p_programacao_id,
    'status', v_status_anterior
  );

exception
  when others then
    -- Passam intactas: as mensagens escritas para o usuário (P0001), as recusas
    -- de permissão (42501) e a falta de objeto no banco (42P01/42703/42883/
    -- 42P13). Estes últimos são o que a tela usa para reconhecer "a migration
    -- ainda não rodou" e dizer qual arquivo executar.
    if sqlstate in ('P0001', '42501', '42P01', '42703', '42883', '42P13') then
      raise;
    end if;

    get stacked diagnostics
      v_constraint = constraint_name,
      v_tabela_erro = table_name,
      v_coluna_erro = column_name,
      v_detalhe_erro = pg_exception_detail;

    if sqlstate = '23503' then
      v_explicacao := case
        when coalesce(v_constraint, '') like '%excluido_por%'
          or coalesce(v_constraint, '') like '%criado_por%'
          or coalesce(v_constraint, '') like '%usuario%'
          or coalesce(v_constraint, '') like '%responsavel%'
          or coalesce(v_constraint, '') like '%aprovada_por%'
          then ' O vínculo recusado foi o do usuário responsável pela gravação: o seu login não tem registro correspondente no cadastro de usuários do sistema. Peça para a Equipe conferir o seu cadastro.'
        when coalesce(v_constraint, '') like '%fornecedor%'
          then ' O vínculo recusado foi o de um fornecedor: um dos fornecedores escolhidos não existe mais no cadastro. Remova-o da lista, escolha o fornecedor novamente e salve.'
        when coalesce(v_constraint, '') like '%conta_id%'
          or coalesce(v_constraint, '') like '%conta_origem%'
          or coalesce(v_constraint, '') like '%conta_destino%'
          or coalesce(v_constraint, '') like '%conta_pagamento%'
          then ' O vínculo recusado foi o de uma conta bancária: alguma das contas escolhidas não existe mais. Recarregue a página, refaça a seleção de contas e salve.'
        when coalesce(v_constraint, '') like '%programacao%'
          then ' O vínculo recusado foi o da própria programação: ela não existe mais. Recarregue a página e abra a programação de novo.'
        when coalesce(v_constraint, '') like '%secretaria%'
          then ' O vínculo recusado foi o da secretaria: a secretaria escolhida não existe mais. Recarregue a página e selecione a secretaria de novo.'
        else ' O banco recusou um vínculo entre registros. O detalhe está no console do navegador (F12).'
      end;
    else
      v_explicacao := '';
    end if;

    raise exception
      'Não foi possível salvar a programação na etapa "%". O banco recusou a operação com o código %.%',
      v_etapa, sqlstate, v_explicacao
      using errcode = 'P0001',
            detail = format(
              '%s | etapa=%s sqlstate=%s constraint=%s tabela=%s coluna=%s detalhe=%s | pagamentos.situacao=%s pagamentos.excluido_por=%s pagamentos.nome_exibicao_programacao=%s pagamentos.origem_tipo=%s pagamentos.origem_id=%s programacoes_pagamento.status=%s programacoes_pagamento.fechado=%s programacao_contas.ativa=%s auditoria_eventos.nivel=%s',
              sqlerrm, v_etapa, sqlstate,
              coalesce(v_constraint, '-'),
              coalesce(v_tabela_erro, '-'),
              coalesce(v_coluna_erro, '-'),
              coalesce(v_detalhe_erro, '-'),
              public.tipo_da_coluna('pagamentos', 'situacao'),
              public.tipo_da_coluna('pagamentos', 'excluido_por'),
              public.tipo_da_coluna('pagamentos', 'nome_exibicao_programacao'),
              public.tipo_da_coluna('pagamentos', 'origem_tipo'),
              public.tipo_da_coluna('pagamentos', 'origem_id'),
              public.tipo_da_coluna('programacoes_pagamento', 'status'),
              public.tipo_da_coluna('programacoes_pagamento', 'fechado'),
              public.tipo_da_coluna('programacao_contas', 'ativa'),
              public.tipo_da_coluna('auditoria_eventos', 'nivel')
            ),
            hint = 'Leia o DETAIL: constraint, tabela e coluna dizem qual chave estrangeira o banco recusou, e detalhe traz o valor que não existe na tabela referenciada.';
end $$;

grant execute on function public.salvar_planejamento_programacao(integer, jsonb, jsonb, numeric, numeric, numeric) to authenticated;

comment on function public.salvar_planejamento_programacao(integer, jsonb, jsonb, numeric, numeric, numeric)
is 'Salva somente a proposta diária: contas consideradas, fornecedores, valores, o nome de exibição e a origem (área) de cada item. Não altera saldos, não registra movimentações financeiras, não dá baixa em nota e não escreve nada em public.fornecedores nem nas tabelas das áreas.';

commit;
