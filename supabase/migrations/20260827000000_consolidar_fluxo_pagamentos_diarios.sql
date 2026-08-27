begin;

-- Validação obrigatória dos tipos reais antes de qualquer alteração de estrutura.
do $$
declare
  item record;
  tipo_real text;
begin
  for item in
    select * from (values
      ('contas_bancarias', 'id', 'integer'),
      ('fornecedores', 'id', 'integer'),
      ('usuarios', 'id', 'uuid'),
      ('programacoes_pagamento', 'id', 'integer'),
      ('programacoes_pagamento', 'secretaria_id', 'integer'),
      ('programacoes_pagamento', 'conta_pagamento_id', 'integer'),
      ('programacao_contas', 'id', 'integer'),
      ('programacao_contas', 'programacao_id', 'integer'),
      ('programacao_contas', 'conta_id', 'integer'),
      ('pagamentos', 'id', 'integer'),
      ('pagamentos', 'programacao_id', 'integer'),
      ('pagamentos', 'fornecedor_id', 'integer'),
      ('pagamento_movimentacoes', 'id', 'uuid'),
      ('pagamento_movimentacoes', 'pagamento_id', 'integer'),
      ('pagamento_movimentacoes', 'programacao_id', 'integer'),
      ('pagamento_movimentacoes', 'conta_id', 'integer'),
      ('saldos_historico', 'id', 'bigint'),
      ('saldos_historico', 'conta_id', 'integer')
    ) as tipos(tabela, coluna, esperado)
  loop
    if to_regclass(format('public.%I', item.tabela)) is null then
      raise exception 'Estrutura incompatível: public.% não existe.', item.tabela;
    end if;

    select format_type(a.atttypid, a.atttypmod)
      into tipo_real
      from pg_attribute a
     where a.attrelid = to_regclass(format('public.%I', item.tabela))
       and a.attname = item.coluna
       and not a.attisdropped;

    if tipo_real is distinct from item.esperado then
      raise exception 'Tipo incompatível em public.%.%: esperado %, encontrado %.', item.tabela, item.coluna, item.esperado, coalesce(tipo_real, 'coluna ausente');
    end if;
  end loop;
end $$;

alter table public.programacoes_pagamento
  add column if not exists status text not null default 'em_elaboracao',
  add column if not exists saldo_considerado numeric(14,2) not null default 0,
  add column if not exists total_programado numeric(14,2) not null default 0,
  add column if not exists restante numeric(14,2) not null default 0,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists ultima_impressao_em timestamptz;

alter table public.programacao_contas
  add column if not exists saldo_considerado numeric(14,2) not null default 0,
  add column if not exists ativa boolean not null default true;

alter table public.pagamentos
  add column if not exists cadastrar_fornecedor_posteriormente boolean not null default false;

create index if not exists programacoes_pagamento_status_idx
  on public.programacoes_pagamento (secretaria_id, data_programacao, status);

create index if not exists programacao_contas_ativas_idx
  on public.programacao_contas (programacao_id, ordem)
  where ativa = true;

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
  v_programacao public.programacoes_pagamento%rowtype;
  v_conta jsonb;
  v_pagamento jsonb;
  v_pagamento_id integer;
  v_valor numeric(14,2);
begin
  v_usuario := auth.uid();
  if v_usuario is null then
    raise exception 'Usuário não autenticado.' using errcode = '42501';
  end if;

  select *
    into v_programacao
    from public.programacoes_pagamento
   where id = p_programacao_id
   for update;

  if not found then
    raise exception 'Programação não encontrada.';
  end if;

  if v_programacao.fechado is true then
    raise exception 'Programações históricas fechadas não podem ser alteradas.';
  end if;

  if jsonb_typeof(coalesce(p_contas, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_pagamentos, '[]'::jsonb)) <> 'array' then
    raise exception 'Contas e pagamentos devem ser listas.';
  end if;

  update public.programacoes_pagamento
     set saldo_considerado = round(coalesce(p_saldo_considerado, 0), 2),
         total_programado = round(coalesce(p_total_programado, 0), 2),
         restante = round(coalesce(p_restante, 0), 2),
         responsavel_id = v_usuario,
         updated_at = now()
   where id = p_programacao_id;

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

  update public.pagamentos
     set excluido_em = now(),
         excluido_por = v_usuario
   where programacao_id = p_programacao_id
     and excluido_em is null
     and situacao in ('programado', 'em_aberto');

  for v_pagamento in select value from jsonb_array_elements(coalesce(p_pagamentos, '[]'::jsonb))
  loop
    v_valor := round(coalesce((v_pagamento->>'valor_a_pagar')::numeric, 0), 2);
    if v_valor < 0 then
      raise exception 'O valor programado não pode ser negativo.';
    end if;

    v_pagamento_id := nullif(v_pagamento->>'id', '')::integer;
    if v_pagamento_id is not null then
      update public.pagamentos
         set fornecedor_id = nullif(v_pagamento->>'fornecedor_id', '')::integer,
             nome_avulso = nullif(trim(v_pagamento->>'nome_avulso'), ''),
             valor_a_pagar = v_valor,
             cadastrar_fornecedor_posteriormente = coalesce((v_pagamento->>'cadastrar_fornecedor_posteriormente')::boolean, false),
             excluido_em = null,
             excluido_por = null
       where id = v_pagamento_id
         and programacao_id = p_programacao_id
         and situacao in ('programado', 'em_aberto');

      if not found then
        raise exception 'Item de pagamento inválido para esta programação.';
      end if;
    else
      insert into public.pagamentos (
        programacao_id,
        fornecedor_id,
        nome_avulso,
        valor_a_pagar,
        situacao,
        cadastrar_fornecedor_posteriormente
      ) values (
        p_programacao_id,
        nullif(v_pagamento->>'fornecedor_id', '')::integer,
        nullif(trim(v_pagamento->>'nome_avulso'), ''),
        v_valor,
        'programado',
        coalesce((v_pagamento->>'cadastrar_fornecedor_posteriormente')::boolean, false)
      );
    end if;
  end loop;

  insert into public.auditoria_eventos (
    usuario_id, modulo, acao, registro_afetado, valor_anterior, valor_novo, nivel
  ) values (
    v_usuario,
    'pagamentos',
    'alterou',
    'Planejamento da programação ' || p_programacao_id::text,
    jsonb_build_object('status', v_programacao.status),
    jsonb_build_object(
      'contas', jsonb_array_length(coalesce(p_contas, '[]'::jsonb)),
      'fornecedores', jsonb_array_length(coalesce(p_pagamentos, '[]'::jsonb)),
      'saldo_considerado', round(coalesce(p_saldo_considerado, 0), 2),
      'total_programado', round(coalesce(p_total_programado, 0), 2),
      'restante', round(coalesce(p_restante, 0), 2)
    ),
    'normal'
  );

  return jsonb_build_object(
    'ok', true,
    'programacao_id', p_programacao_id,
    'status', v_programacao.status
  );
end $$;

grant execute on function public.salvar_planejamento_programacao(integer, jsonb, jsonb, numeric, numeric, numeric) to authenticated;

comment on function public.salvar_planejamento_programacao(integer, jsonb, jsonb, numeric, numeric, numeric)
is 'Salva somente a proposta diária: contas consideradas, fornecedores e valores. Não altera saldos nem registra movimentações financeiras.';

create or replace function public.marcar_programacao_em_analise(p_programacao_id integer)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_usuario uuid;
  v_programacao public.programacoes_pagamento%rowtype;
begin
  v_usuario := auth.uid();
  if v_usuario is null then
    raise exception 'Usuário não autenticado.' using errcode = '42501';
  end if;

  select *
    into v_programacao
    from public.programacoes_pagamento
   where id = p_programacao_id
   for update;

  if not found then
    raise exception 'Programação não encontrada.';
  end if;

  if v_programacao.fechado is true then
    raise exception 'Programações históricas fechadas não podem ser alteradas.';
  end if;

  update public.programacoes_pagamento
     set status = 'em_analise',
         responsavel_id = v_usuario,
         updated_at = now()
   where id = p_programacao_id;

  insert into public.auditoria_eventos (
    usuario_id, modulo, acao, registro_afetado, valor_anterior, valor_novo, nivel
  ) values (
    v_usuario,
    'pagamentos',
    'alterou_status',
    'Programação ' || p_programacao_id::text,
    jsonb_build_object('status', v_programacao.status),
    jsonb_build_object('status', 'em_analise'),
    'normal'
  );

  return jsonb_build_object('ok', true, 'programacao_id', p_programacao_id, 'status', 'em_analise');
end $$;

grant execute on function public.marcar_programacao_em_analise(integer) to authenticated;

commit;
