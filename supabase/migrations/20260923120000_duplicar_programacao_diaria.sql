-- Duplica apenas o planejamento da Proposta. Contas, saldos congelados,
-- execução, baixas e vínculos financeiros permanecem exclusivos da origem.
begin;

create or replace function public.duplicar_programacao_diaria(p_programacao_origem_id integer, p_data_destino date)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_origem public.programacoes_pagamento%rowtype;
  v_nova_id integer;
  v_total numeric(14,2);
  v_usuario uuid;
begin
  v_usuario := auth.uid();
  if v_usuario is null then raise exception 'Usuário não autenticado.' using errcode = '42501'; end if;
  if p_data_destino is null then raise exception 'Informe a data de destino.'; end if;

  select * into v_origem from public.programacoes_pagamento
   where id = p_programacao_origem_id and excluido_em is null;
  if not found then raise exception 'Programação de origem não encontrada.'; end if;

  select round(coalesce(sum(p.valor_a_pagar), 0), 2) into v_total
    from public.pagamentos p where p.programacao_id = p_programacao_origem_id and p.excluido_em is null;

  insert into public.programacoes_pagamento (
    secretaria_id, data_programacao, responsavel_id, nome_programacao,
    status, fechado, saldo_considerado, total_programado, restante
  ) values (
    v_origem.secretaria_id, p_data_destino, v_usuario,
    'PROGRAMAÇÃO DIÁRIA — ' || to_char(p_data_destino, 'DD/MM/YYYY'),
    'em_elaboracao', false, 0, v_total, -v_total
  ) returning id into v_nova_id;

  insert into public.pagamentos (
    programacao_id, fornecedor_id, nome_avulso, valor_a_pagar, situacao,
    cadastrar_fornecedor_posteriormente, nome_exibicao_programacao, origem_tipo, origem_id
  )
  select v_nova_id, p.fornecedor_id, p.nome_avulso, p.valor_a_pagar, 'programado',
    coalesce(p.cadastrar_fornecedor_posteriormente, false), p.nome_exibicao_programacao, p.origem_tipo, p.origem_id
  from public.pagamentos p
  where p.programacao_id = p_programacao_origem_id and p.excluido_em is null
  order by p.id;

  begin
    insert into public.auditoria_eventos (usuario_id, modulo, acao, registro_afetado, valor_anterior, valor_novo, nivel)
    values (public.usuario_auditoria_id(), 'pagamentos', 'criou', 'Programação ' || v_nova_id::text,
      jsonb_build_object('programacao_origem_id', p_programacao_origem_id),
      jsonb_build_object('programacao_id', v_nova_id, 'data_destino', p_data_destino, 'contas_copiadas', 0), 'informacao');
  exception when others then
    raise warning 'Programação % duplicada, mas o evento de auditoria não foi gravado (% -- %).', v_nova_id, sqlstate, sqlerrm;
  end;
  return v_nova_id;
end;
$$;

grant execute on function public.duplicar_programacao_diaria(integer, date) to authenticated;
comment on function public.duplicar_programacao_diaria(integer, date)
is 'Cria novo rascunho com fornecedores e valores da Proposta, sem copiar contas, saldos ou execução.';
commit;
