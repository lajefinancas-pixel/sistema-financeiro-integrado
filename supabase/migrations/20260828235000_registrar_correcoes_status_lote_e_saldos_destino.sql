-- =============================================================================
-- Registro no repositório de duas correções JÁ APLICADAS MANUALMENTE no Supabase
-- =============================================================================
--
-- As duas correções abaixo já estão no banco e validadas em uso. Esta migration
-- não muda o comportamento atual: ela existe para que as correções não se
-- perdam quando as migrations forem reaplicadas em um deploy futuro, em um novo
-- ambiente ou em um branch de banco recriado do zero. É idempotente de ponta a
-- ponta -- rodar de novo, quantas vezes for, não altera nada.
--
-- 1. public.confirmar_transferencias_programacao gravava 'confirmada' no status
--    do INSERT em public.transferencia_lotes, e a check constraint
--    transferencia_lotes_status_check só aceita 'processando', 'confirmado' e
--    'falhou'. Toda transferência era recusada por violação de check antes de
--    mover um centavo. O corpo da função é o da 20260828230000, integralmente
--    preservado: muda SÓ aquele literal, para 'confirmado'.
--
--    O INSERT em public.transferencias_contas continua gravando 'confirmada' --
--    é o vocabulário aceito por AQUELA tabela -- e as chaves ja_confirmada do
--    JSON de retorno seguem com o mesmo nome, porque o front-end aprovado já
--    lê exatamente esse nome.
--
-- 2. public.transferencias_contas.saldo_destino_antes e saldo_destino_depois
--    estavam NOT NULL, mas só recebem valor DEPOIS -- o INSERT de cada perna
--    grava os saldos de origem, e o UPDATE seguinte, já com a soma de todas as
--    origens, preenche os de destino. Com NOT NULL o INSERT era recusado.
--
-- O QUE ESTA MIGRATION NÃO FAZ, DE PROPÓSITO
--
--   * Não altera a check constraint transferencia_lotes_status_check.
--   * Não toca no front-end nem em nada já aprovado.
--   * Não uniformiza o vocabulário confirmado/confirmada entre as duas tabelas.
--     A inconsistência é conhecida e será tratada em tarefa própria.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. confirmar_transferencias_programacao — status do lote: 'confirmado'
-- ---------------------------------------------------------------------------
create or replace function public.confirmar_transferencias_programacao(
  p_programacao_id integer,
  p_conta_destino_id integer,
  p_transferencias jsonb,
  p_chave_idempotencia text,
  p_observacao text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  -- Um id de usuário por coluna, resolvido pelo vínculo real da coluna:
  -- public.usuario_para_coluna devolve o id de public.usuarios quando a coluna
  -- aponta para lá (NULL quando a sessão não tem registro), e nunca um id que a
  -- chave estrangeira recusaria.
  v_usuario_lote uuid;      -- transferencia_lotes.usuario_id
  v_usuario_perna uuid;     -- transferencias_contas.usuario_id
  v_usuario_auditoria uuid; -- auditoria_eventos.usuario_id
  v_lote_id uuid;
  v_existente uuid;
  v_destino_secretaria integer;
  v_destino_ativa_texto text;
  v_destino_nome text;
  v_secretaria_destino_nome text;
  v_item jsonb;
  v_origem_id integer;
  v_valor numeric(14,2);
  v_total numeric(14,2) := 0;
  v_quantidade integer := 0;
  v_origem_secretaria integer;
  v_origem_ativa_texto text;
  v_secretaria_origem_nome text;
  v_saldo_origem numeric(14,2);
  v_data_origem date;
  v_saldo_destino numeric(14,2);
  v_data_destino date;
  v_data_alvo date;
  v_destino_antes numeric(14,2);
  v_transferencia_id uuid;
  v_pernas jsonb := '[]'::jsonb;
  v_contas integer[];
  v_conta integer;
  v_etapa text := 'início';
  v_constraint text;
  v_tabela_erro text;
  v_coluna_erro text;
  v_detalhe_erro text;
begin
  v_etapa := 'conferência do login';
  if auth.uid() is null then
    raise exception 'Usuário não autenticado.' using errcode = '42501';
  end if;

  v_etapa := 'resolução do usuário de cada coluna';
  v_usuario_lote := public.usuario_para_coluna('transferencia_lotes', 'usuario_id');
  v_usuario_perna := public.usuario_para_coluna('transferencias_contas', 'usuario_id');
  v_usuario_auditoria := public.usuario_para_coluna('auditoria_eventos', 'usuario_id');

  v_etapa := 'conferência da permissão de transferir';
  if not public.pode_em_pagamentos_fase2('executar_transferencia') then
    raise exception 'Você não tem permissão para transferir entre contas.' using errcode = '42501';
  end if;

  v_etapa := 'conferência dos dados enviados';
  if coalesce(trim(p_chave_idempotencia), '') = '' then
    raise exception 'A transferência precisa de um identificador único.';
  end if;

  if jsonb_typeof(coalesce(p_transferencias, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_transferencias, '[]'::jsonb)) = 0 then
    raise exception 'Informe ao menos uma conta de origem com valor.';
  end if;

  -- IDEMPOTÊNCIA. O índice único da chave é a tranca: duplo clique, F5, reenvio
  -- ou dupla confirmação caem aqui e a segunda tentativa não move nada.
  v_etapa := 'registro do lote com a chave de idempotência';
  insert into public.transferencia_lotes (
    chave_idempotencia, programacao_id, conta_destino_id, observacao, usuario_id, status
  ) values (
    trim(p_chave_idempotencia), p_programacao_id, p_conta_destino_id,
    nullif(trim(coalesce(p_observacao, '')), ''), v_usuario_lote, 'confirmado'
  )
  on conflict (chave_idempotencia) do nothing
  returning id into v_lote_id;

  if v_lote_id is null then
    v_etapa := 'leitura da transferência já confirmada com esta chave';
    select tl.id into v_existente
      from public.transferencia_lotes tl
     where tl.chave_idempotencia = trim(p_chave_idempotencia);

    select coalesce(jsonb_agg(jsonb_build_object(
             'id', tc.id,
             'conta_origem_id', tc.conta_origem_id,
             'valor', tc.valor
           ) order by tc.criado_em), '[]'::jsonb)
      into v_pernas
      from public.transferencias_contas tc
     where tc.lote_id = v_existente;

    return jsonb_build_object(
      'ok', true,
      'ja_confirmada', true,
      'lote_id', v_existente,
      'transferencias', v_pernas
    );
  end if;

  -- Conta de destino
  v_etapa := 'leitura da conta de destino';
  select cb.secretaria_id, coalesce(cb.ativo::text, 'true'), cb.nome_conta
    into v_destino_secretaria, v_destino_ativa_texto, v_destino_nome
    from public.contas_bancarias cb
   where cb.id = p_conta_destino_id;

  if not found then
    raise exception 'Conta de destino não encontrada.';
  end if;
  if lower(coalesce(v_destino_ativa_texto, '')) not in ('true', 't', 'sim', '1', 'y', 'yes') then
    raise exception 'Conta de destino desativada não pode receber transferência.';
  end if;

  select s.nome into v_secretaria_destino_nome
    from public.secretarias s
   where s.id = v_destino_secretaria;

  -- Serializa as contas envolvidas: duas transferências simultâneas na mesma
  -- conta entram em fila, então o saldo nunca é lido desatualizado.
  v_etapa := 'trava das contas envolvidas';
  select array_agg(distinct conta order by conta)
    into v_contas
    from (
      select p_conta_destino_id as conta
      union
      select (valor->>'conta_origem_id')::integer
        from jsonb_array_elements(p_transferencias) as itens(valor)
    ) todas
   where conta is not null;

  foreach v_conta in array coalesce(v_contas, array[]::integer[]) loop
    perform pg_advisory_xact_lock(918273645, v_conta);
  end loop;

  -- Saldo atual do destino (último lançamento de saldos_historico).
  v_etapa := 'leitura do saldo da conta de destino';
  select sh.valor_saldo, sh.data_saldo
    into v_saldo_destino, v_data_destino
    from public.saldos_historico sh
   where sh.conta_id = p_conta_destino_id
   order by sh.data_saldo desc, sh.id desc
   limit 1;

  if not found then
    v_saldo_destino := 0;
    v_data_destino := null;
  end if;

  v_destino_antes := round(coalesce(v_saldo_destino, 0), 2);

  -- Cada origem: valida tudo primeiro, debita depois. Qualquer exceção aqui
  -- desfaz o lote inteiro (saída e entrada estão na MESMA transação).
  for v_item in select value from jsonb_array_elements(p_transferencias)
  loop
    v_etapa := 'leitura dos dados de uma conta de origem';
    v_origem_id := nullif(v_item->>'conta_origem_id', '')::integer;
    v_valor := round(coalesce((v_item->>'valor')::numeric, 0), 2);

    if v_origem_id is null then
      raise exception 'Informe a conta de origem de cada transferência.';
    end if;
    if v_valor <= 0 then
      raise exception 'O valor da transferência precisa ser maior que zero.';
    end if;
    if v_origem_id = p_conta_destino_id then
      raise exception 'A conta de origem e a de destino precisam ser diferentes.';
    end if;

    v_etapa := 'leitura da conta de origem ' || v_origem_id::text;
    select cb.secretaria_id, coalesce(cb.ativo::text, 'true')
      into v_origem_secretaria, v_origem_ativa_texto
      from public.contas_bancarias cb
     where cb.id = v_origem_id;

    if not found then
      raise exception 'Conta de origem % não encontrada.', v_origem_id;
    end if;
    if lower(coalesce(v_origem_ativa_texto, '')) not in ('true', 't', 'sim', '1', 'y', 'yes') then
      raise exception 'Conta de origem desativada não pode transferir.';
    end if;

    -- SEGREGAÇÃO POR SECRETARIA
    v_etapa := 'conferência da segregação por secretaria';
    if v_origem_secretaria is distinct from v_destino_secretaria then
      select s.nome into v_secretaria_origem_nome
        from public.secretarias s
       where s.id = v_origem_secretaria;

      if not public.transferencia_entre_secretarias_permitida(v_secretaria_origem_nome, v_secretaria_destino_nome) then
        raise exception 'Transferência entre secretarias diferentes não é permitida (% para %). A única exceção é a Secretaria de Finanças para Saúde, Educação e Assistência Social.',
          coalesce(v_secretaria_origem_nome, 'origem'), coalesce(v_secretaria_destino_nome, 'destino');
      end if;
    end if;

    v_etapa := 'leitura do saldo da conta de origem';
    select sh.valor_saldo, sh.data_saldo
      into v_saldo_origem, v_data_origem
      from public.saldos_historico sh
     where sh.conta_id = v_origem_id
     order by sh.data_saldo desc, sh.id desc
     limit 1;

    if not found then
      v_saldo_origem := 0;
      v_data_origem := null;
    end if;

    v_saldo_origem := round(coalesce(v_saldo_origem, 0), 2);

    if v_valor > v_saldo_origem then
      raise exception 'Saldo insuficiente na conta de origem: saldo % e transferência de %.',
        to_char(v_saldo_origem, 'FM999999999990.00'), to_char(v_valor, 'FM999999999990.00');
    end if;

    -- SAÍDA. O lançamento entra na data de hoje, ou na data do último saldo da
    -- conta quando esta for mais recente (é ela que as telas leem).
    v_data_alvo := greatest(current_date, coalesce(v_data_origem, current_date));

    v_etapa := 'gravação da saída na conta de origem';
    insert into public.saldos_historico (conta_id, valor_saldo, data_saldo)
    values (v_origem_id, round(v_saldo_origem - v_valor, 2), v_data_alvo)
    on conflict (conta_id, data_saldo)
    do update set valor_saldo = excluded.valor_saldo;

    v_etapa := 'registro da perna da transferência';
    insert into public.transferencias_contas (
      lote_id, programacao_id, conta_origem_id, conta_destino_id, valor,
      saldo_origem_antes, saldo_origem_depois,
      data_movimento, observacao, usuario_id, status
    ) values (
      v_lote_id, p_programacao_id, v_origem_id, p_conta_destino_id, v_valor,
      v_saldo_origem, round(v_saldo_origem - v_valor, 2),
      v_data_alvo, nullif(trim(coalesce(p_observacao, '')), ''), v_usuario_perna, 'confirmada'
    )
    returning id into v_transferencia_id;

    v_total := round(v_total + v_valor, 2);
    v_quantidade := v_quantidade + 1;
    v_pernas := v_pernas || jsonb_build_object(
      'id', v_transferencia_id,
      'conta_origem_id', v_origem_id,
      'valor', v_valor,
      'saldo_origem_antes', v_saldo_origem,
      'saldo_origem_depois', round(v_saldo_origem - v_valor, 2)
    );
  end loop;

  -- ENTRADA, uma vez, com a soma de todas as origens.
  v_data_alvo := greatest(current_date, coalesce(v_data_destino, current_date));

  v_etapa := 'gravação da entrada na conta de destino';
  insert into public.saldos_historico (conta_id, valor_saldo, data_saldo)
  values (p_conta_destino_id, round(v_destino_antes + v_total, 2), v_data_alvo)
  on conflict (conta_id, data_saldo)
  do update set valor_saldo = excluded.valor_saldo;

  v_etapa := 'atualização dos saldos do lote';
  update public.transferencias_contas
     set saldo_destino_antes = v_destino_antes,
         saldo_destino_depois = round(v_destino_antes + v_total, 2)
   where lote_id = v_lote_id;

  update public.transferencia_lotes
     set valor_total = v_total,
         quantidade_origens = v_quantidade
   where id = v_lote_id;

  -- Histórico e Auditoria: saldo antes e saldo depois de cada conta. ATÔMICO de
  -- propósito -- aqui o dinheiro se move, e movimentação sem trilha não vale.
  v_etapa := 'registro na auditoria';
  insert into public.auditoria_eventos (
    usuario_id, modulo, acao, registro_afetado, valor_anterior, valor_novo, nivel
  ) values (
    v_usuario_auditoria,
    'pagamentos',
    'transferiu',
    'Transferência entre contas — lote ' || v_lote_id::text,
    jsonb_build_object(
      'conta_destino_id', p_conta_destino_id,
      'saldo_destino_antes', v_destino_antes,
      'origens', v_pernas
    ),
    jsonb_build_object(
      'lote_id', v_lote_id,
      'chave_idempotencia', trim(p_chave_idempotencia),
      'programacao_id', p_programacao_id,
      'conta_destino_id', p_conta_destino_id,
      'conta_destino', v_destino_nome,
      'valor_total', v_total,
      'quantidade_origens', v_quantidade,
      'saldo_destino_antes', v_destino_antes,
      'saldo_destino_depois', round(v_destino_antes + v_total, 2),
      'observacao', nullif(trim(coalesce(p_observacao, '')), ''),
      'transferencias', v_pernas,
      'eh_despesa', false
    ) || public.rastro_do_login(v_usuario_auditoria),
    'critico'
  );

  return jsonb_build_object(
    'ok', true,
    'ja_confirmada', false,
    'lote_id', v_lote_id,
    'valor_total', v_total,
    'quantidade_origens', v_quantidade,
    'conta_destino_id', p_conta_destino_id,
    'saldo_destino_antes', v_destino_antes,
    'saldo_destino_depois', round(v_destino_antes + v_total, 2),
    'eh_despesa', false,
    'transferencias', v_pernas
  );

exception
  when others then
    -- Passam intactas: as mensagens escritas para o usuário (P0001), as recusas
    -- de permissão (42501) e a falta de objeto no banco (42P01/42703/42883/
    -- 42P13). Estes últimos são o que a tela usa para reconhecer "a migration
    -- ainda não rodou" e dizer qual arquivo executar -- reescrevê-los como
    -- P0001 apagaria esse aviso.
    if sqlstate in ('P0001', '42501', '42P01', '42703', '42883', '42P13') then
      raise;
    end if;

    -- Campos estruturados do erro. Um raise exception novo os perderia, então
    -- eles são lidos aqui e vão para o DETAIL. 42P10 com tabela
    -- saldos_historico, por exemplo, é o índice único (conta_id, data_saldo)
    -- faltando -- sem ele o `on conflict` acima não tem árbitro.
    get stacked diagnostics
      v_constraint = constraint_name,
      v_tabela_erro = table_name,
      v_coluna_erro = column_name,
      v_detalhe_erro = pg_exception_detail;

    raise exception
      'Não foi possível concluir a transferência entre contas na etapa "%". O banco recusou a operação com o código %.',
      v_etapa, sqlstate
      using errcode = 'P0001',
            detail = format(
              '%s | etapa=%s sqlstate=%s constraint=%s tabela=%s coluna=%s detalhe=%s | contas_bancarias.ativo=%s contas_bancarias.secretaria_id=%s saldos_historico.conta_id=%s saldos_historico.valor_saldo=%s saldos_historico.data_saldo=%s transferencia_lotes.usuario_id=%s transferencia_lotes.status=%s transferencias_contas.usuario_id=%s transferencias_contas.status=%s transferencias_contas.data_movimento=%s auditoria_eventos.usuario_id=%s auditoria_eventos.acao=%s auditoria_eventos.nivel=%s',
              sqlerrm, v_etapa, sqlstate,
              coalesce(v_constraint, '-'),
              coalesce(v_tabela_erro, '-'),
              coalesce(v_coluna_erro, '-'),
              coalesce(v_detalhe_erro, '-'),
              public.tipo_da_coluna('contas_bancarias', 'ativo'),
              public.tipo_da_coluna('contas_bancarias', 'secretaria_id'),
              public.tipo_da_coluna('saldos_historico', 'conta_id'),
              public.tipo_da_coluna('saldos_historico', 'valor_saldo'),
              public.tipo_da_coluna('saldos_historico', 'data_saldo'),
              public.tipo_da_coluna('transferencia_lotes', 'usuario_id'),
              public.tipo_da_coluna('transferencia_lotes', 'status'),
              public.tipo_da_coluna('transferencias_contas', 'usuario_id'),
              public.tipo_da_coluna('transferencias_contas', 'status'),
              public.tipo_da_coluna('transferencias_contas', 'data_movimento'),
              public.tipo_da_coluna('auditoria_eventos', 'usuario_id'),
              public.tipo_da_coluna('auditoria_eventos', 'acao'),
              public.tipo_da_coluna('auditoria_eventos', 'nivel')
            ),
            hint = 'Leia o DETAIL: ele traz a mensagem crua do banco, a etapa, a restrição recusada e o tipo real de cada coluna envolvida. Para o retrato completo do banco rode select public.diagnostico_transferencia_contas(conta_origem, conta_destino).';
end;
$fn$;

grant execute on function public.confirmar_transferencias_programacao(integer, integer, jsonb, text, text) to authenticated;

comment on function public.confirmar_transferencias_programacao(integer, integer, jsonb, text, text)
is 'Transferência entre contas próprias: várias origens para um destino, atômica e idempotente pela chave. NAO E DESPESA — não escreve em pagamento_movimentacoes nem em pagamentos_baixas. Id de usuário resolvido pelo vínculo de cada coluna, leitura de contas_bancarias.ativo à prova de tipo e etapa nomeada em qualquer falha inesperada.';

-- ---------------------------------------------------------------------------
-- 2. transferencias_contas — saldos de destino são preenchidos depois
-- ---------------------------------------------------------------------------
-- drop not null é idempotente: em coluna já anulável o Postgres não faz nada.
alter table public.transferencias_contas
  alter column saldo_destino_antes drop not null,
  alter column saldo_destino_depois drop not null;
