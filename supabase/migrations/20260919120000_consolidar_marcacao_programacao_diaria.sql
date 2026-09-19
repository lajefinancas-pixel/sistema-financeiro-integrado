-- Consolida a marcação da Programação Diária depois da retirada do pagamento
-- parcial. Marcar pago, não pago e desfazer são anotações: nenhuma delas
-- movimenta saldo, cria baixa ou escreve no histórico de saldos.

begin;

-- Alguns bancos legados têm pagamentos.situacao como enum sem o rótulo
-- "suspenso". A tentativa de marcar NÃO PAGO terminava em 22P02 ao converter
-- esse texto. Completa apenas o enum realmente ligado à coluna; em coluna text
-- ou domínio nada é alterado. O bloco é idempotente.
do $bloco$
declare
  v_tipo regtype;
  v_tipo_nome text;
  v_e_enum boolean;
begin
  select a.atttypid::regtype,
         format('%I.%I', n.nspname, t.typname),
         t.typtype = 'e'
    into v_tipo, v_tipo_nome, v_e_enum
    from pg_attribute a
    join pg_type t on t.oid = a.atttypid
    join pg_namespace n on n.oid = t.typnamespace
   where a.attrelid = 'public.pagamentos'::regclass
     and a.attname = 'situacao'
     and not a.attisdropped;

  if coalesce(v_e_enum, false) and not exists (
    select 1 from pg_enum e
     where e.enumtypid = v_tipo::oid and e.enumlabel = 'suspenso'
  ) then
    execute format('alter type %s add value if not exists %L', v_tipo_nome, 'suspenso');
  end if;
end
$bloco$;

-- Elimina a assinatura com numeric herdada da baixa parcial. O wrapper antigo
-- é recriado depois para não manter dependência sobre a assinatura removida.
drop function if exists public.marcar_pagamento_pago(text);
drop function if exists public.marcar_situacao_programacao(text, text, numeric);

create or replace function public.marcar_situacao_programacao(
  p_pagamento_id text,
  p_situacao text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_pagamento record;
  v_usuario uuid;
  v_tipo_situacao text;
  v_situacao text;
  v_valor_pago numeric(14,2);
  v_etapa text := 'início';
  v_constraint text;
  v_tabela text;
  v_coluna text;
  v_detalhe text;
begin
  v_etapa := 'conferência do login';
  if auth.uid() is null then
    raise exception 'Usuário não autenticado.' using errcode = '42501';
  end if;

  select u.id into v_usuario
    from public.usuarios u
   where u.auth_id = auth.uid() and u.status::text = 'ativo'
   limit 1;

  if v_usuario is null or not exists (
    select 1 from public.permissoes_efetivas pe
     where pe.usuario_id = v_usuario
       and pe.modulo = 'pagamentos'
       and coalesce(pe.pode_editar::text, 'false') in ('true', 't', '1')
  ) then
    raise exception 'Você não tem permissão para marcar a programação diária.' using errcode = '42501';
  end if;

  v_etapa := 'leitura do pagamento e da programação';
  select p.id::text id, p.valor_a_pagar,
         pr.status::text status_programacao, pr.fechado::text fechado
    into v_pagamento
    from public.pagamentos p
    join public.programacoes_pagamento pr on pr.id = p.programacao_id
   where p.id::text = nullif(btrim(p_pagamento_id), '')
     and p.excluido_em is null
   for update of p, pr;

  if not found then raise exception 'Pagamento não encontrado.'; end if;
  if coalesce(lower(v_pagamento.fechado), 'false') in ('true', 't', '1', 'sim') then
    raise exception 'A programação está fechada e não pode ser alterada.';
  end if;
  if v_pagamento.status_programacao <> 'aprovada' then
    raise exception 'Confirme a programação antes de marcar os pagamentos.';
  end if;

  v_situacao := case nullif(btrim(p_situacao), '')
    when 'pago' then 'pago'
    when 'nao_pago' then 'suspenso'
    when 'pendente' then 'programado'
    else null
  end;
  if v_situacao is null then raise exception 'Marcação inválida.'; end if;

  v_valor_pago := case when v_situacao = 'pago'
    then round(coalesce(v_pagamento.valor_a_pagar, 0), 2)
    else 0
  end;

  v_etapa := 'gravação da marcação';
  v_tipo_situacao := public.tipo_da_coluna('pagamentos', 'situacao');
  execute format(
    'update public.pagamentos set situacao = $1::%s, valor_pago = $2 where id::text = $3',
    v_tipo_situacao
  ) using v_situacao, v_valor_pago, p_pagamento_id;

  return jsonb_build_object(
    'ok', true, 'situacao', v_situacao, 'valor_pago', v_valor_pago,
    'movimentou_saldo', false
  );
exception
  when others then
    if sqlstate in ('P0001', '42501') then raise; end if;
    get stacked diagnostics
      v_constraint = constraint_name, v_tabela = table_name,
      v_coluna = column_name, v_detalhe = pg_exception_detail;
    raise exception 'Não foi possível atualizar a marcação na etapa "%". Código do banco: %.', v_etapa, sqlstate
      using errcode = 'P0001',
            detail = format(
              '%s | etapa=%s sqlstate=%s constraint=%s tabela=%s coluna=%s detalhe=%s | pagamentos.situacao=%s pagamentos.valor_pago=%s programacoes_pagamento.status=%s programacoes_pagamento.fechado=%s',
              sqlerrm, v_etapa, sqlstate, coalesce(v_constraint, '-'),
              coalesce(v_tabela, '-'), coalesce(v_coluna, '-'),
              coalesce(v_detalhe, '-'),
              public.tipo_da_coluna('pagamentos', 'situacao'),
              public.tipo_da_coluna('pagamentos', 'valor_pago'),
              public.tipo_da_coluna('programacoes_pagamento', 'status'),
              public.tipo_da_coluna('programacoes_pagamento', 'fechado')
            ),
            hint = 'Leia o DETAIL para identificar a etapa, a coluna e os tipos reais envolvidos.';
end;
$fn$;

revoke all on function public.marcar_situacao_programacao(text, text) from public;
grant execute on function public.marcar_situacao_programacao(text, text) to authenticated;

create function public.marcar_pagamento_pago(p_pagamento_id text)
returns jsonb
language sql
security definer
set search_path = public
as $$ select public.marcar_situacao_programacao(p_pagamento_id, 'pago') $$;

revoke all on function public.marcar_pagamento_pago(text) from public;
grant execute on function public.marcar_pagamento_pago(text) to authenticated;

commit;
