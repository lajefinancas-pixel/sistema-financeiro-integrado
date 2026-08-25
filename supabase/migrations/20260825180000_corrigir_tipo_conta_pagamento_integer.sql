-- Alinha a RPC de seleção da conta de pagamento ao tipo real de
-- public.contas_bancarias.id e public.programacoes_pagamento.conta_pagamento_id.
-- A atualização permanece encapsulada em security definer, sem depender da
-- política RLS de UPDATE da tabela para a chamada feita pelo frontend.

do $$
declare
  v_tipo_coluna text;
begin
  select format_type(a.atttypid, a.atttypmod)
    into v_tipo_coluna
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname = 'programacoes_pagamento'
     and a.attname = 'conta_pagamento_id'
     and a.attnum > 0
     and not a.attisdropped;

  if v_tipo_coluna is distinct from 'integer' then
    raise exception 'public.programacoes_pagamento.conta_pagamento_id deve ser integer; tipo encontrado: %',
      coalesce(v_tipo_coluna, 'coluna ausente');
  end if;
end;
$$;

drop function if exists public.definir_conta_pagamento_programacao(uuid, uuid);
drop function if exists public.definir_conta_pagamento_programacao(uuid, integer);

create function public.definir_conta_pagamento_programacao(
  p_programacao_id uuid,
  p_conta_id integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
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
    raise exception 'Sem permissão para editar programações de pagamento.' using errcode = '42501';
  end if;

  select *
    into v_programacao
    from public.programacoes_pagamento
   where id = p_programacao_id
   for update;

  if not found then
    raise exception 'Programação de pagamento não encontrada.' using errcode = 'P0002';
  end if;

  if coalesce(v_programacao.fechado, false) then
    raise exception 'A programação está fechada e não pode ser alterada.';
  end if;

  if p_conta_id is not null then
    select *
      into v_conta
      from public.contas_bancarias
     where id = p_conta_id
       and coalesce(ativo, true) = true;

    if not found then
      raise exception 'Conta bancária ativa não encontrada.' using errcode = 'P0002';
    end if;

    if v_conta.secretaria_id is distinct from v_programacao.secretaria_id then
      raise exception 'A conta de pagamento deve pertencer à secretaria da programação.';
    end if;
  end if;

  update public.programacoes_pagamento
     set conta_pagamento_id = p_conta_id
   where id = p_programacao_id;

  return jsonb_build_object(
    'ok', true,
    'programacao_id', p_programacao_id,
    'conta_pagamento_id', p_conta_id
  );
end;
$$;

revoke all on function public.definir_conta_pagamento_programacao(uuid, integer) from public;
grant execute on function public.definir_conta_pagamento_programacao(uuid, integer) to authenticated;
