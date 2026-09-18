-- Exclusão controlada de programações. Não escreve em saldos_historico nem em
-- movimentações: liberar a reserva significa somente zerar o rateio ainda não
-- debitado. Pagamento efetivado impede exclusão e oferece cancelamento.

alter table public.programacoes_pagamento
  add column if not exists excluido_em timestamptz,
  add column if not exists excluido_por uuid references public.usuarios(id) on delete set null,
  add column if not exists motivo_exclusao text,
  add column if not exists cancelada_em timestamptz,
  add column if not exists cancelada_por uuid references public.usuarios(id) on delete set null,
  add column if not exists motivo_cancelamento text;

create index if not exists programacoes_pagamento_ativas_idx
  on public.programacoes_pagamento (secretaria_id, data_programacao)
  where excluido_em is null;

create or replace function public.pode_excluir_programacao()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.usuarios u
    join public.permissoes_efetivas pe on pe.usuario_id = u.id and pe.modulo = 'pagamentos'
    where u.auth_id = auth.uid() and u.status::text = 'ativo'
      and pe.pode_excluir::text in ('true', 't', '1')
  );
$$;

create or replace function public.verificar_exclusao_programacao(p_programacao_id integer)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'tem_pagamento_pago', exists (
      select 1 from public.pagamentos p
      where p.programacao_id = p_programacao_id
        and (p.situacao::text = 'pago' or exists (
          select 1 from public.pagamentos_baixas b
          where b.pagamento_id::text = p.id::text and b.status::text = 'confirmada'
        ))
    )
  );
$$;

create or replace function public.excluir_programacao_pagamento(p_programacao_id integer, p_motivo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_programacao public.programacoes_pagamento%rowtype; v_usuario uuid; v_motivo text := btrim(coalesce(p_motivo, ''));
begin
  if not public.pode_excluir_programacao() then raise exception 'Você não tem permissão para excluir programações.' using errcode='42501'; end if;
  if length(v_motivo) < 5 then raise exception 'Informe o motivo da exclusão (mínimo 5 caracteres).'; end if;
  select * into v_programacao from public.programacoes_pagamento where id=p_programacao_id and excluido_em is null for update;
  if not found then raise exception 'Programação não encontrada.'; end if;
  if (public.verificar_exclusao_programacao(p_programacao_id)->>'tem_pagamento_pago')::boolean then
    raise exception 'Programação com pagamento pago não pode ser excluída. Cancele a programação.';
  end if;
  select id into v_usuario from public.usuarios where auth_id=auth.uid() and status::text='ativo';
  update public.programacao_contas set valor_rateado=0, ativa=false where programacao_id=p_programacao_id;
  update public.pagamentos set excluido_em=now(), excluido_por=v_usuario where programacao_id=p_programacao_id and excluido_em is null;
  update public.programacoes_pagamento set excluido_em=now(), excluido_por=v_usuario, motivo_exclusao=v_motivo where id=p_programacao_id;
  insert into public.auditoria_eventos(usuario_id,modulo,acao,registro_afetado,valor_anterior,valor_novo,nivel)
  values(v_usuario,'pagamentos','excluiu_programacao','Programação '||p_programacao_id,
    jsonb_build_object('status',v_programacao.status,'total_programado',v_programacao.total_programado),
    jsonb_build_object('motivo_exclusao',v_motivo,'reserva_liberada',true),'atencao');
  return jsonb_build_object('ok',true,'programacao_id',p_programacao_id);
end $$;

create or replace function public.cancelar_programacao_pagamento(p_programacao_id integer, p_motivo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_programacao public.programacoes_pagamento%rowtype; v_usuario uuid; v_motivo text := btrim(coalesce(p_motivo, ''));
begin
  if not public.pode_excluir_programacao() then raise exception 'Você não tem permissão para cancelar programações.' using errcode='42501'; end if;
  if length(v_motivo) < 5 then raise exception 'Informe o motivo do cancelamento (mínimo 5 caracteres).'; end if;
  select * into v_programacao from public.programacoes_pagamento where id=p_programacao_id and excluido_em is null for update;
  if not found then raise exception 'Programação não encontrada.'; end if;
  select id into v_usuario from public.usuarios where auth_id=auth.uid() and status::text='ativo';
  update public.programacao_contas set valor_rateado=0, ativa=false where programacao_id=p_programacao_id;
  update public.programacoes_pagamento set status='cancelada',cancelada_em=now(),cancelada_por=v_usuario,motivo_cancelamento=v_motivo where id=p_programacao_id;
  insert into public.auditoria_eventos(usuario_id,modulo,acao,registro_afetado,valor_anterior,valor_novo,nivel)
  values(v_usuario,'pagamentos','cancelou_programacao','Programação '||p_programacao_id,
    jsonb_build_object('status',v_programacao.status),jsonb_build_object('status','cancelada','motivo',v_motivo,'reserva_liberada',true),'atencao');
  return jsonb_build_object('ok',true,'programacao_id',p_programacao_id);
end $$;

grant execute on function public.verificar_exclusao_programacao(integer) to authenticated;
grant execute on function public.excluir_programacao_pagamento(integer,text) to authenticated;
grant execute on function public.cancelar_programacao_pagamento(integer,text) to authenticated;

drop policy if exists programacoes_pagamento_select_lixeira on public.programacoes_pagamento;
create policy programacoes_pagamento_select_lixeira on public.programacoes_pagamento for select to authenticated
using (public.pode_gerenciar_lixeira() and excluido_em is not null);
