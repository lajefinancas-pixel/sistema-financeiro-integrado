-- Corrige a gravação da conta de pagamento da programação sem movimentar saldo.
-- Migration cumulativa: também cria a coluna caso a implantação anterior ainda
-- não tenha sido aplicada no ambiente de produção.

alter table public.programacoes_pagamento
  add column if not exists conta_pagamento_id uuid references public.contas_bancarias(id);

create or replace function public.definir_conta_pagamento_programacao(
  p_programacao_id uuid,
  p_conta_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
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

revoke all on function public.definir_conta_pagamento_programacao(uuid, uuid) from public;
grant execute on function public.definir_conta_pagamento_programacao(uuid, uuid) to authenticated;

