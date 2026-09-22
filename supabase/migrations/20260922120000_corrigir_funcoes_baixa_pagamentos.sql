-- Corrige as RPCs de baixa que ficaram como invólucros de funções ausentes.
-- Esta migration não altera tabelas, dados, triggers ou Programação Diária.

begin;

-- CREATE OR REPLACE não consegue corrigir nomes de argumentos já existentes.
drop function if exists public.registrar_baixa_nota(text, text, numeric, date, integer, text);
drop function if exists public.estornar_baixa_nota(text, text);

create function public.registrar_baixa_nota(
  p_chave_idempotencia text,
  p_valor_em_aberto_id text,
  p_valor numeric,
  p_data_pagamento date,
  p_conta_id integer,
  p_observacao text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_usuario uuid;
  v_chave text;
  v_valor numeric(14,2);
  v_nota record;
  v_conta record;
  v_existente record;
  v_baixa_id text;
  v_valor_nota numeric(14,2);
  v_pago_antes numeric(14,2);
  v_aberto_antes numeric(14,2);
  v_pago_depois numeric(14,2);
  v_aberto_depois numeric(14,2);
  v_situacao_nova text;
  v_tipo_nota text;
  v_tipo_fornecedor text;
  v_tipo_conta text;
  v_tipo_situacao text;
  v_tipo_situacao_anterior text;
  v_documento text;
  v_observacao text;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado.' using errcode = '42501';
  end if;
  if not public.pode_em_baixas('registrar_baixa') then
    raise exception 'Você não tem permissão para registrar baixas de pagamento.' using errcode = '42501';
  end if;

  v_chave := nullif(trim(coalesce(p_chave_idempotencia, '')), '');
  if v_chave is null then
    raise exception 'A baixa precisa de um identificador único para não ser registrada duas vezes.';
  end if;
  if nullif(trim(coalesce(p_valor_em_aberto_id, '')), '') is null then
    raise exception 'Informe a nota do fornecedor que está sendo baixada.';
  end if;
  v_valor := round(coalesce(p_valor, 0), 2);
  if v_valor <= 0 then raise exception 'O valor da baixa deve ser maior que zero.'; end if;
  if p_data_pagamento is null then raise exception 'Informe a data do pagamento.'; end if;
  if p_conta_id is null then raise exception 'Informe a conta bancária utilizada no pagamento.'; end if;

  select b.id::text id, b.valor_pago
    into v_existente
    from public.pagamentos_baixas b
   where b.chave_idempotencia = v_chave
   limit 1;
  if found then
    return jsonb_build_object('ok', true, 'ja_registrada', true,
      'baixa_id', v_existente.id, 'valor_pago', v_existente.valor_pago,
      'movimentou_saldo', false);
  end if;

  select v.id::text id, v.fornecedor_id, v.valor,
         coalesce(v.valor_pago, 0) valor_pago, v.situacao::text situacao,
         v.numero_nota_fiscal
    into v_nota
    from public.valores_em_aberto v
   where v.id::text = p_valor_em_aberto_id
   for update;
  if not found then
    raise exception 'A nota informada não foi encontrada. Atualize a tela e tente novamente.';
  end if;
  if v_nota.situacao = 'cancelado' then
    raise exception 'Esta nota está cancelada e não recebe baixas.';
  end if;

  v_valor_nota := round(coalesce(v_nota.valor, 0), 2);
  v_pago_antes := round(coalesce(v_nota.valor_pago, 0), 2);
  v_aberto_antes := round(v_valor_nota - v_pago_antes, 2);
  if v_aberto_antes <= 0.004 then
    raise exception 'Esta nota já está quitada e não recebe novas baixas.';
  end if;
  if v_valor > v_aberto_antes + 0.004 then
    raise exception 'O valor da baixa (R$ %) é maior do que o valor em aberto da nota (R$ %). Informe um valor até o que está em aberto.',
      translate(to_char(v_valor, 'FM999,999,999,990.00'), ',.', '.,'),
      translate(to_char(v_aberto_antes, 'FM999,999,999,990.00'), ',.', '.,');
  end if;

  select c.id, coalesce(c.ativo::text, 'true') ativo_texto
    into v_conta from public.contas_bancarias c where c.id = p_conta_id;
  if not found then raise exception 'A conta bancária informada não foi encontrada.'; end if;
  if not coalesce(public.texto_verdadeiro(v_conta.ativo_texto), true) then
    raise exception 'Conta bancária desativada não pode ser usada em uma baixa.';
  end if;

  v_pago_depois := round(v_pago_antes + v_valor, 2);
  v_aberto_depois := greatest(round(v_valor_nota - v_pago_depois, 2), 0);
  v_situacao_nova := case when v_aberto_depois <= 0.004 then 'pago' else 'em_aberto' end;
  v_documento := nullif(trim(coalesce(v_nota.numero_nota_fiscal, '')), '');
  v_observacao := nullif(trim(coalesce(p_observacao, '')), '');
  v_usuario := public.usuario_para_coluna('pagamentos_baixas', 'usuario_id');
  v_tipo_nota := public.tipo_da_coluna('pagamentos_baixas', 'valor_em_aberto_id');
  v_tipo_fornecedor := public.tipo_da_coluna('pagamentos_baixas', 'fornecedor_id');
  v_tipo_conta := public.tipo_da_coluna('pagamentos_baixas', 'conta_id');
  v_tipo_situacao := public.tipo_da_coluna('valores_em_aberto', 'situacao');
  v_tipo_situacao_anterior := public.tipo_da_coluna('pagamentos_baixas', 'situacao_anterior');

  execute format($sql$
    insert into public.pagamentos_baixas (
      chave_idempotencia, fornecedor_id, valor_em_aberto_id,
      valor_total_referencia, valor_pago, data_pagamento, conta_id,
      documento, observacao, status, situacao_anterior, usuario_id
    ) values ($1, $2::%s, $3::%s, $4, $5, $6, $7::%s,
      $8, $9, 'efetivada', $10::%s, $11)
    on conflict (chave_idempotencia) where chave_idempotencia is not null
    do nothing returning id::text
  $sql$, v_tipo_fornecedor, v_tipo_nota, v_tipo_conta, v_tipo_situacao_anterior)
  into v_baixa_id
  using v_chave, v_nota.fornecedor_id::text, v_nota.id, v_valor_nota,
        v_valor, p_data_pagamento, p_conta_id::text, v_documento,
        v_observacao, v_nota.situacao, v_usuario;

  if v_baixa_id is null then
    select b.id::text id, b.valor_pago into v_existente
      from public.pagamentos_baixas b where b.chave_idempotencia = v_chave limit 1;
    return jsonb_build_object('ok', true, 'ja_registrada', true,
      'baixa_id', v_existente.id, 'valor_pago', v_existente.valor_pago,
      'movimentou_saldo', false);
  end if;

  execute format('update public.valores_em_aberto set valor_pago=$1, situacao=$2::%s where id::text=$3', v_tipo_situacao)
    using v_pago_depois, v_situacao_nova, p_valor_em_aberto_id;

  insert into public.auditoria_eventos
    (usuario_id, modulo, acao, registro_afetado, valor_anterior, valor_novo, nivel)
  values (v_usuario, 'pagamentos', 'registrou_baixa',
    'Baixa de pagamento — nota ' || coalesce(v_documento, v_nota.id),
    jsonb_build_object('valor_em_aberto_id', v_nota.id, 'situacao', v_nota.situacao,
      'valor_pago', v_pago_antes, 'valor_em_aberto', v_aberto_antes),
    jsonb_build_object('baixa_id', v_baixa_id, 'fornecedor_id', v_nota.fornecedor_id,
      'valor_da_baixa', v_valor, 'data_pagamento', p_data_pagamento,
      'conta_id', p_conta_id, 'situacao', v_situacao_nova,
      'valor_pago', v_pago_depois, 'valor_em_aberto', v_aberto_depois,
      'quitada', v_aberto_depois <= 0.004, 'observacao', v_observacao,
      'movimentou_saldo', true), 'atencao');

  return jsonb_build_object('ok', true, 'ja_registrada', false,
    'baixa_id', v_baixa_id, 'valor_em_aberto_id', v_nota.id,
    'fornecedor_id', v_nota.fornecedor_id, 'valor_da_baixa', v_valor,
    'valor_total', v_valor_nota, 'valor_pago', v_pago_depois,
    'valor_em_aberto', v_aberto_depois, 'situacao', v_situacao_nova,
    'quitada', v_aberto_depois <= 0.004, 'movimentou_saldo', true);
end;
$fn$;

create function public.estornar_baixa_nota(
  p_baixa_id text,
  p_motivo text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_usuario uuid;
  v_motivo text;
  v_baixa record;
  v_nota record;
  v_valor_nota numeric(14,2);
  v_pago_antes numeric(14,2);
  v_pago_depois numeric(14,2);
  v_aberto_depois numeric(14,2);
  v_situacao_nova text;
  v_tipo_situacao text;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado.' using errcode = '42501';
  end if;
  if not public.pode_em_baixas('estornar_baixa') then
    raise exception 'Você não tem permissão para estornar baixas de pagamento.' using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_baixa_id, '')), '') is null then
    raise exception 'Informe qual baixa deve ser estornada.';
  end if;
  v_motivo := nullif(trim(coalesce(p_motivo, '')), '');
  if v_motivo is null then raise exception 'Informe a justificativa do estorno.'; end if;
  if length(v_motivo) < 5 then
    raise exception 'A justificativa do estorno precisa explicar o motivo (use ao menos 5 caracteres).';
  end if;

  select b.id::text id, b.valor_em_aberto_id::text nota_id, b.fornecedor_id,
         b.valor_pago, b.conta_id, b.data_pagamento, b.status::text status,
         b.situacao_anterior::text situacao_anterior, b.documento
    into v_baixa from public.pagamentos_baixas b
   where b.id::text = p_baixa_id for update;
  if not found then
    raise exception 'A baixa informada não foi encontrada. Atualize a tela e tente novamente.';
  end if;
  if v_baixa.status = 'estornada' then
    return jsonb_build_object('ok', true, 'ja_estornada', true,
      'baixa_id', v_baixa.id, 'movimentou_saldo', false);
  end if;
  if v_baixa.nota_id is null then
    raise exception 'Esta baixa não está ligada a uma nota do fornecedor e não pode ser estornada por esta tela.';
  end if;

  select v.id::text id, v.valor, coalesce(v.valor_pago, 0) valor_pago,
         v.situacao::text situacao
    into v_nota from public.valores_em_aberto v
   where v.id::text = v_baixa.nota_id for update;
  if not found then
    raise exception 'A nota desta baixa não foi encontrada. Atualize a tela e tente novamente.';
  end if;

  v_valor_nota := round(coalesce(v_nota.valor, 0), 2);
  v_pago_antes := round(coalesce(v_nota.valor_pago, 0), 2);
  v_pago_depois := greatest(round(v_pago_antes - round(coalesce(v_baixa.valor_pago, 0), 2), 2), 0);
  v_aberto_depois := round(v_valor_nota - v_pago_depois, 2);
  v_situacao_nova := case when v_aberto_depois <= 0.004 then 'pago' else 'em_aberto' end;
  v_usuario := public.usuario_para_coluna('pagamentos_baixas', 'estornada_por');

  -- A alteração de status dispara o trigger já existente, que recompõe o saldo.
  update public.pagamentos_baixas
     set status = 'estornada', estornada_em = now(), estornada_por = v_usuario,
         motivo_estorno = v_motivo
   where id::text = p_baixa_id;

  v_tipo_situacao := public.tipo_da_coluna('valores_em_aberto', 'situacao');
  execute format('update public.valores_em_aberto set valor_pago=$1, situacao=$2::%s where id::text=$3', v_tipo_situacao)
    using v_pago_depois, v_situacao_nova, v_baixa.nota_id;

  insert into public.auditoria_eventos
    (usuario_id, modulo, acao, registro_afetado, valor_anterior, valor_novo, nivel)
  values (v_usuario, 'pagamentos', 'estornou_baixa',
    'Estorno de baixa — nota ' || coalesce(nullif(trim(coalesce(v_baixa.documento, '')), ''), v_nota.id),
    jsonb_build_object('baixa_id', v_baixa.id, 'status', v_baixa.status,
      'valor_da_baixa', v_baixa.valor_pago, 'conta_id', v_baixa.conta_id,
      'data_pagamento', v_baixa.data_pagamento, 'situacao_da_nota', v_nota.situacao,
      'valor_pago', v_pago_antes),
    jsonb_build_object('baixa_id', v_baixa.id, 'status', 'estornada',
      'motivo', v_motivo, 'situacao_da_nota', v_situacao_nova,
      'valor_pago', v_pago_depois, 'valor_em_aberto', v_aberto_depois,
      'movimentou_saldo', true, 'preservada', true), 'critico');

  return jsonb_build_object('ok', true, 'ja_estornada', false,
    'baixa_id', v_baixa.id, 'valor_em_aberto_id', v_nota.id,
    'valor_estornado', v_baixa.valor_pago, 'valor_pago', v_pago_depois,
    'valor_em_aberto', v_aberto_depois, 'situacao', v_situacao_nova,
    'movimentou_saldo', true);
end;
$fn$;

revoke all on function public.registrar_baixa_nota(text, text, numeric, date, integer, text) from public;
revoke all on function public.estornar_baixa_nota(text, text) from public;
grant execute on function public.registrar_baixa_nota(text, text, numeric, date, integer, text) to authenticated;
grant execute on function public.estornar_baixa_nota(text, text) to authenticated;

comment on function public.registrar_baixa_nota(text, text, numeric, date, integer, text)
  is 'RPC canônica: registra baixa parcial ou integral, atualiza a nota e deixa o trigger debitar a conta atomicamente.';
comment on function public.estornar_baixa_nota(text, text)
  is 'RPC canônica: preserva e estorna a baixa, reabre a nota e deixa o trigger recompor a conta atomicamente.';

notify pgrst, 'reload schema';

commit;
