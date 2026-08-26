-- Pagamentos Diários: a conta de saída passa a ser definida por pagamento.
-- A coluna legada programacoes_pagamento.conta_pagamento_id é preservada sem uso.

alter table public.pagamentos
  add column if not exists conta_origem_id integer references public.contas_bancarias(id);

alter table public.programacoes_pagamento
  add column if not exists ultima_impressao_em timestamptz;

create index if not exists pagamentos_conta_origem_idx
  on public.pagamentos (conta_origem_id);

create or replace function public.definir_conta_origem_pagamento(
  p_pagamento_id text,
  p_conta_id integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_pagamento public.pagamentos%rowtype;
  v_programacao public.programacoes_pagamento%rowtype;
  v_conta public.contas_bancarias%rowtype;
  v_usuario uuid;
begin
  v_usuario := public.meu_usuario_ativo_id();

  if v_usuario is null then
    raise exception 'Usuário ativo não identificado.' using errcode = '42501';
  end if;

  if not exists (
    select 1
      from public.permissoes_efetivas pe
     where pe.usuario_id = v_usuario
       and pe.modulo = 'pagamentos'
       and coalesce(pe.pode_editar, false) = true
  ) then
    raise exception 'Sem permissão para editar pagamentos.' using errcode = '42501';
  end if;

  select *
    into v_pagamento
    from public.pagamentos
   where id::text = p_pagamento_id
   for update;

  if not found then
    raise exception 'Pagamento não encontrado.' using errcode = 'P0002';
  end if;

  select *
    into v_programacao
    from public.programacoes_pagamento
   where id = v_pagamento.programacao_id
   for update;

  if coalesce(v_programacao.fechado, false) then
    raise exception 'A programação está fechada e não pode ser alterada.';
  end if;

  if coalesce(v_pagamento.situacao, '') = 'pago' then
    raise exception 'A conta de um pagamento já efetivado não pode ser alterada.';
  end if;

  select *
    into v_conta
    from public.contas_bancarias
   where id = p_conta_id
     and coalesce(ativo, true) = true;

  if not found then
    raise exception 'Conta bancária ativa não encontrada.' using errcode = 'P0002';
  end if;

  if v_conta.secretaria_id is distinct from v_programacao.secretaria_id then
    raise exception 'Pagamentos só podem usar contas da secretaria da programação.';
  end if;

  if not exists (
    select 1
      from public.programacao_contas pc
     where pc.programacao_id = v_programacao.id
       and pc.conta_id = p_conta_id
  ) then
    raise exception 'A conta de origem precisa estar selecionada como conta de trabalho.';
  end if;

  update public.pagamentos
     set conta_origem_id = p_conta_id
   where id::text = p_pagamento_id;

  insert into public.auditoria_eventos(
    usuario_id, modulo, acao, registro_afetado,
    valor_anterior, valor_novo, nivel
  ) values (
    v_usuario, 'pagamentos', 'alterou',
    'Conta de origem do pagamento ' || p_pagamento_id,
    jsonb_build_object('conta_origem_id', v_pagamento.conta_origem_id),
    jsonb_build_object('conta_origem_id', p_conta_id),
    'informacao'
  );

  return jsonb_build_object(
    'ok', true,
    'pagamento_id', p_pagamento_id,
    'conta_origem_id', p_conta_id
  );
end;
$$;

revoke all on function public.definir_conta_origem_pagamento(text, integer) from public;
grant execute on function public.definir_conta_origem_pagamento(text, integer) to authenticated;

create or replace function public.registrar_impressao_programacao(p_programacao_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_usuario uuid;
  v_programacao public.programacoes_pagamento%rowtype;
begin
  v_usuario := public.meu_usuario_ativo_id();

  select * into v_programacao
    from public.programacoes_pagamento
   where id = p_programacao_id;

  if not found then
    raise exception 'Programação de pagamento não encontrada.' using errcode = 'P0002';
  end if;

  update public.programacoes_pagamento
     set ultima_impressao_em = now()
   where id = p_programacao_id;

  insert into public.auditoria_eventos(
    usuario_id, modulo, acao, registro_afetado, valor_novo, nivel
  ) values (
    v_usuario, 'pagamentos', 'imprimiu_relacao',
    'Relação de pagamentos ' || p_programacao_id,
    jsonb_build_object('programacao_id', p_programacao_id, 'data_programacao', v_programacao.data_programacao),
    'informacao'
  );

  return jsonb_build_object('ok', true, 'programacao_id', p_programacao_id);
end;
$$;

revoke all on function public.registrar_impressao_programacao(uuid) from public;
grant execute on function public.registrar_impressao_programacao(uuid) to authenticated;

drop function if exists public.confirmar_transferencias_programacao(uuid, uuid, jsonb, text, text);
drop function if exists public.confirmar_transferencias_programacao(uuid, integer, jsonb, text, text);

create function public.confirmar_transferencias_programacao(
  p_programacao_id uuid,
  p_conta_destino_id integer,
  p_transferencias jsonb,
  p_chave_idempotencia text,
  p_observacao text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_programacao public.programacoes_pagamento%rowtype;
  v_lote public.transferencia_lotes%rowtype;
  v_item jsonb;
  v_origem integer;
  v_valor numeric(14,2);
  v_saldo_origem numeric(14,2);
  v_saldo_destino numeric(14,2);
  v_data_origem date;
  v_data_destino date;
  v_data_movimento date;
  v_transferencia_id uuid;
  v_usuario uuid := public.meu_usuario_ativo_id();
  v_ids jsonb := '[]'::jsonb;
  v_secretaria_programacao text;
  v_secretaria_destino_id public.secretarias.id%type;
  v_secretaria_destino text;
begin
  if not public.tem_permissao_especial('executar_transferencia') then
    raise exception 'Sem permissão para executar transferência.' using errcode = '42501';
  end if;
  if coalesce(trim(p_chave_idempotencia), '') = '' then
    raise exception 'Chave de idempotência obrigatória.';
  end if;

  select * into v_lote
    from public.transferencia_lotes
   where chave_idempotencia = p_chave_idempotencia;
  if found then
    return coalesce(v_lote.resultado, jsonb_build_object('ok', true, 'ja_confirmado', true, 'lote_id', v_lote.id));
  end if;

  select pp, s.nome
    into v_programacao, v_secretaria_programacao
    from public.programacoes_pagamento pp
    join public.secretarias s on s.id = pp.secretaria_id
   where pp.id = p_programacao_id
   for update of pp;
  if not found then raise exception 'Programação não encontrada.'; end if;
  if jsonb_typeof(p_transferencias) <> 'array' or jsonb_array_length(p_transferencias) = 0 then
    raise exception 'Informe ao menos uma transferência.';
  end if;

  select cb.secretaria_id, s.nome
    into v_secretaria_destino_id, v_secretaria_destino
    from public.contas_bancarias cb
    join public.secretarias s on s.id = cb.secretaria_id
   where cb.id = p_conta_destino_id
     and coalesce(cb.ativo, true) = true;
  if not found then raise exception 'Conta de destino ativa não encontrada.'; end if;

  if v_secretaria_destino_id is distinct from v_programacao.secretaria_id
     and not (
       lower(v_secretaria_programacao) like '%finan%'
       and (
         lower(v_secretaria_destino) like '%saúde%'
         or lower(v_secretaria_destino) like '%saude%'
         or lower(v_secretaria_destino) like '%educa%'
         or lower(v_secretaria_destino) like '%social%'
       )
     ) then
    raise exception 'Transferência entre secretarias permitida somente de Finanças para Saúde, Educação ou Social.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(q.conta_id, 0))
    from (
      select p_conta_destino_id::text conta_id
      union
      select i->>'conta_origem_id' from jsonb_array_elements(p_transferencias) i
      order by conta_id
    ) q;

  insert into public.transferencia_lotes(chave_idempotencia, programacao_id, conta_destino_id, usuario_id)
  values(p_chave_idempotencia, p_programacao_id, p_conta_destino_id, v_usuario)
  returning * into v_lote;

  select coalesce(valor_saldo, 0), data_saldo
    into v_saldo_destino, v_data_destino
    from public.saldos_historico
   where conta_id = p_conta_destino_id
   order by data_saldo desc limit 1;
  if not found then
    v_saldo_destino := 0;
    v_data_destino := v_programacao.data_programacao;
  end if;

  for v_item in select * from jsonb_array_elements(p_transferencias) loop
    v_origem := (v_item->>'conta_origem_id')::integer;
    v_valor := round((v_item->>'valor')::numeric, 2);
    if v_origem = p_conta_destino_id then raise exception 'A conta de origem não pode ser a conta de destino.'; end if;
    if v_valor <= 0 then raise exception 'Valor de transferência inválido.'; end if;
    if not exists (
      select 1
        from public.programacao_contas pc
        join public.contas_bancarias cb on cb.id = pc.conta_id
       where pc.programacao_id = p_programacao_id
         and pc.conta_id = v_origem
         and cb.secretaria_id = v_programacao.secretaria_id
    ) then
      raise exception 'A conta de origem deve estar selecionada e pertencer à secretaria da programação.';
    end if;

    select coalesce(valor_saldo, 0), data_saldo
      into v_saldo_origem, v_data_origem
      from public.saldos_historico
     where conta_id = v_origem
     order by data_saldo desc limit 1;
    if not found then
      v_saldo_origem := 0;
      v_data_origem := v_programacao.data_programacao;
    end if;
    if v_valor > v_saldo_origem then raise exception 'Saldo insuficiente na conta de origem.'; end if;

    v_data_movimento := greatest(v_programacao.data_programacao, coalesce(v_data_origem, v_programacao.data_programacao), coalesce(v_data_destino, v_programacao.data_programacao));
    insert into public.transferencias_contas(
      lote_id, programacao_id, conta_origem_id, conta_destino_id, valor,
      saldo_origem_antes, saldo_origem_depois, saldo_destino_antes,
      saldo_destino_depois, usuario_id, observacao
    ) values (
      v_lote.id, p_programacao_id, v_origem, p_conta_destino_id, v_valor,
      v_saldo_origem, v_saldo_origem - v_valor, v_saldo_destino,
      v_saldo_destino + v_valor, v_usuario, p_observacao
    ) returning id into v_transferencia_id;

    insert into public.saldos_historico(conta_id, valor_saldo, data_saldo)
    values(v_origem, v_saldo_origem - v_valor, v_data_movimento)
    on conflict(conta_id, data_saldo) do update set valor_saldo = excluded.valor_saldo;

    v_saldo_destino := v_saldo_destino + v_valor;
    insert into public.saldos_historico(conta_id, valor_saldo, data_saldo)
    values(p_conta_destino_id, v_saldo_destino, v_data_movimento)
    on conflict(conta_id, data_saldo) do update set valor_saldo = excluded.valor_saldo;

    insert into public.auditoria_eventos(usuario_id, modulo, acao, registro_afetado, valor_anterior, valor_novo, nivel)
    values(
      v_usuario, 'pagamentos', 'transferiu', 'Transferência entre contas',
      jsonb_build_object('conta_origem_id', v_origem, 'saldo_origem', v_saldo_origem, 'conta_destino_id', p_conta_destino_id, 'saldo_destino', v_saldo_destino - v_valor),
      jsonb_build_object('transferencia_id', v_transferencia_id, 'valor', v_valor, 'saldo_origem', v_saldo_origem - v_valor, 'saldo_destino', v_saldo_destino),
      'critico'
    );
    v_ids := v_ids || to_jsonb(v_transferencia_id);
  end loop;

  update public.programacao_contas
     set valor_transferir = 0
   where programacao_id = p_programacao_id;

  update public.transferencia_lotes
     set status = 'confirmado', resultado = jsonb_build_object('ok', true, 'lote_id', v_lote.id, 'transferencias', v_ids)
   where id = v_lote.id
   returning * into v_lote;

  return v_lote.resultado;
exception when others then
  if v_lote.id is not null then
    update public.transferencia_lotes set status = 'falhou', resultado = jsonb_build_object('ok', false, 'erro', sqlerrm) where id = v_lote.id;
  end if;
  raise;
end;
$$;

revoke all on function public.confirmar_transferencias_programacao(uuid, integer, jsonb, text, text) from public;
grant execute on function public.confirmar_transferencias_programacao(uuid, integer, jsonb, text, text) to authenticated;
