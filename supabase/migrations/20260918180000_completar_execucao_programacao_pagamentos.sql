-- Estrutura complementar da execução da Programação Diária.
-- A programação apenas registra marcações; nenhum comando deste arquivo
-- movimenta saldo, reserva conta ou cria baixa.

begin;

alter table public.pagamentos
  add column if not exists valor_pago numeric(14,2) not null default 0,
  add column if not exists conta_origem_id integer,
  add column if not exists nome_exibicao_programacao text,
  add column if not exists origem_tipo text,
  add column if not exists origem_id uuid,
  add column if not exists cadastrar_fornecedor_posteriormente boolean not null default false,
  add column if not exists excluido_em timestamptz,
  add column if not exists excluido_por uuid;

alter table public.programacao_contas
  add column if not exists ativa boolean not null default true,
  add column if not exists saldo_considerado numeric(14,2) not null default 0,
  add column if not exists valor_rateado numeric(14,2) not null default 0,
  add column if not exists ordem integer;

alter table public.pagamentos_baixas
  add column if not exists saldo_antes numeric(14,2),
  add column if not exists saldo_depois numeric(14,2);

create index if not exists pagamentos_programacao_situacao_idx
  on public.pagamentos (programacao_id, situacao)
  where excluido_em is null;

-- Marcar é uma anotação da programação. O valor efetivamente pago aqui é o
-- valor marcado para conferência; o débito real continua exclusivo da baixa.
create or replace function public.marcar_situacao_programacao(
  p_pagamento_id text,
  p_situacao text,
  p_valor_pago numeric default 0
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
  v_pago numeric(14,2);
begin
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
       and pe.pode_editar
  ) then
    raise exception 'Você não tem permissão para marcar a programação diária.' using errcode = '42501';
  end if;

  select p.id::text id, p.valor_a_pagar, p.situacao::text situacao,
         pr.status::text status_programacao, pr.fechado
    into v_pagamento
    from public.pagamentos p
    join public.programacoes_pagamento pr on pr.id = p.programacao_id
   where p.id::text = p_pagamento_id
     and p.excluido_em is null
   for update of p, pr;

  if not found then raise exception 'Pagamento não encontrado.'; end if;
  if coalesce(v_pagamento.fechado, false) then
    raise exception 'A programação está fechada e não pode ser alterada.';
  end if;
  if v_pagamento.status_programacao <> 'aprovada' then
    raise exception 'Confirme a programação antes de marcar os pagamentos.';
  end if;

  v_situacao := case p_situacao
    when 'pago' then 'pago'
    when 'parcial' then 'parcialmente_pago'
    when 'parcialmente_pago' then 'parcialmente_pago'
    when 'nao_pago' then 'suspenso'
    else null
  end;
  if v_situacao is null then raise exception 'Marcação inválida.'; end if;

  v_pago := case
    when v_situacao = 'pago' then round(coalesce(v_pagamento.valor_a_pagar, 0), 2)
    when v_situacao = 'parcialmente_pago' then round(coalesce(p_valor_pago, 0), 2)
    else 0
  end;
  if v_situacao = 'parcialmente_pago'
     and (v_pago <= 0 or v_pago >= v_pagamento.valor_a_pagar) then
    raise exception 'O valor parcial deve ser maior que zero e menor que o programado.';
  end if;

  v_tipo_situacao := public.tipo_da_coluna('pagamentos', 'situacao');
  execute format(
    'update public.pagamentos set situacao = $1::%s, valor_pago = $2 where id::text = $3',
    v_tipo_situacao
  ) using v_situacao, v_pago, p_pagamento_id;

  return jsonb_build_object(
    'ok', true,
    'situacao', v_situacao,
    'valor_pago', v_pago,
    'movimentou_saldo', false
  );
end;
$fn$;

revoke all on function public.marcar_situacao_programacao(text, text, numeric) from public;
grant execute on function public.marcar_situacao_programacao(text, text, numeric) to authenticated;

commit;
