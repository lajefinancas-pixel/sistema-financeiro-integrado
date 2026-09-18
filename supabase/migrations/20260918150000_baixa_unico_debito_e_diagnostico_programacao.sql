begin;

-- A programação é planejamento. A marcação registra somente a decisão e nunca
-- escolhe conta, reserva recursos ou escreve em saldos_historico.
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
  if auth.uid() is null then raise exception 'Usuário não autenticado.' using errcode = '42501'; end if;
  select u.id into v_usuario from public.usuarios u where u.auth_id = auth.uid() and u.status = 'ativo' limit 1;
  if v_usuario is null or not exists (
    select 1 from public.permissoes_efetivas pe
     where pe.usuario_id = v_usuario and pe.modulo = 'pagamentos' and pe.pode_editar
  ) then
    raise exception 'Você não tem permissão para marcar a programação diária.' using errcode = '42501';
  end if;

  select p.id::text id, p.valor_a_pagar, p.situacao::text situacao, pr.fechado
    into v_pagamento
    from public.pagamentos p
    join public.programacoes_pagamento pr on pr.id = p.programacao_id
   where p.id::text = p_pagamento_id
   for update of p, pr;
  if not found then raise exception 'Pagamento não encontrado.'; end if;
  if coalesce(v_pagamento.fechado, false) then raise exception 'A programação está fechada e não pode ser alterada.'; end if;

  v_situacao := case p_situacao
    when 'pago' then 'pago'
    when 'parcialmente_pago' then 'parcialmente_pago'
    when 'nao_pago' then 'suspenso'
    when 'pendente' then 'programado'
    else null end;
  if v_situacao is null then raise exception 'Marcação inválida.'; end if;
  v_pago := case
    when v_situacao = 'pago' then round(coalesce(v_pagamento.valor_a_pagar, 0), 2)
    when v_situacao = 'parcialmente_pago' then round(coalesce(p_valor_pago, 0), 2)
    else 0 end;
  if v_situacao = 'parcialmente_pago' and (v_pago <= 0 or v_pago >= v_pagamento.valor_a_pagar) then
    raise exception 'O valor parcial deve ser maior que zero e menor que o programado.';
  end if;

  v_tipo_situacao := public.tipo_da_coluna('pagamentos', 'situacao');
  execute format('update public.pagamentos set situacao = $1::%s, valor_pago = $2 where id::text = $3', v_tipo_situacao)
    using v_situacao, v_pago, p_pagamento_id;
  return jsonb_build_object('ok', true, 'situacao', v_situacao, 'valor_pago', v_pago, 'movimentou_saldo', false);
end;
$fn$;
revoke all on function public.marcar_situacao_programacao(text, text, numeric) from public;
grant execute on function public.marcar_situacao_programacao(text, text, numeric) to authenticated;

-- Compatibilidade com clientes antigos: "marcar pago" passa a ser apenas uma
-- marcação de planejamento e delega à função acima.
create or replace function public.marcar_pagamento_pago(p_pagamento_id text)
returns jsonb language sql security definer set search_path = public
as $$ select public.marcar_situacao_programacao(p_pagamento_id, 'pago', 0) $$;
revoke all on function public.marcar_pagamento_pago(text) from public;
grant execute on function public.marcar_pagamento_pago(text) to authenticated;

alter table public.pagamentos_baixas
  add column if not exists saldo_antes numeric(14,2),
  add column if not exists saldo_depois numeric(14,2);

-- O débito acompanha a razão da baixa. O gatilho roda dentro da mesma transação
-- da RPC existente, portanto baixa, nota e saldo confirmam ou falham juntos.
create or replace function public.movimentar_saldo_pela_baixa()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  v_saldo numeric(14,2);
  v_data date;
begin
  if tg_op = 'INSERT' and new.status::text = 'efetivada' then
    if new.conta_id is null then raise exception 'Informe a conta bancária utilizada no pagamento.'; end if;
    perform pg_advisory_xact_lock(731905, new.conta_id::integer);
    select sh.valor_saldo, sh.data_saldo into v_saldo, v_data
      from public.saldos_historico sh where sh.conta_id = new.conta_id
      order by sh.data_saldo desc, sh.id desc limit 1 for update;
    v_saldo := round(coalesce(v_saldo, 0), 2);
    if round(new.valor_pago, 2) > v_saldo then raise exception 'Saldo insuficiente na conta selecionada para esta baixa.'; end if;
    v_data := greatest(coalesce(v_data, new.data_pagamento), new.data_pagamento);
    insert into public.saldos_historico(conta_id, valor_saldo, data_saldo)
      values(new.conta_id, round(v_saldo - new.valor_pago, 2), v_data)
      on conflict(conta_id, data_saldo) do update set valor_saldo = excluded.valor_saldo;
    update public.pagamentos_baixas set saldo_antes = v_saldo, saldo_depois = round(v_saldo - new.valor_pago, 2)
      where id = new.id;
  elsif tg_op = 'UPDATE' and old.status::text = 'efetivada' and new.status::text = 'estornada' then
    perform pg_advisory_xact_lock(731905, new.conta_id::integer);
    select sh.valor_saldo, sh.data_saldo into v_saldo, v_data
      from public.saldos_historico sh where sh.conta_id = new.conta_id
      order by sh.data_saldo desc, sh.id desc limit 1 for update;
    v_saldo := round(coalesce(v_saldo, 0), 2);
    v_data := greatest(coalesce(v_data, current_date), current_date);
    insert into public.saldos_historico(conta_id, valor_saldo, data_saldo)
      values(new.conta_id, round(v_saldo + new.valor_pago, 2), v_data)
      on conflict(conta_id, data_saldo) do update set valor_saldo = excluded.valor_saldo;
  end if;
  return new;
end;
$fn$;
drop trigger if exists pagamentos_baixas_movimentar_saldo on public.pagamentos_baixas;
create trigger pagamentos_baixas_movimentar_saldo
after insert or update of status on public.pagamentos_baixas
for each row execute function public.movimentar_saldo_pela_baixa();

-- Mantém toda a validação consolidada das RPCs existentes e ajusta apenas a
-- resposta pública para refletir o efeito transacional novo do gatilho.
alter function public.registrar_baixa_nota(text, text, numeric, date, integer, text)
  rename to registrar_baixa_nota_validada;
create function public.registrar_baixa_nota(text, text, numeric, date, integer, text default null)
returns jsonb language plpgsql security definer set search_path=public as $fn$
declare v_resultado jsonb;
begin
  v_resultado := public.registrar_baixa_nota_validada($1,$2,$3,$4,$5,$6);
  return jsonb_set(v_resultado,'{movimentou_saldo}','true'::jsonb,true);
end;$fn$;
revoke all on function public.registrar_baixa_nota(text,text,numeric,date,integer,text) from public;
grant execute on function public.registrar_baixa_nota(text,text,numeric,date,integer,text) to authenticated;

alter function public.estornar_baixa_nota(text, text) rename to estornar_baixa_nota_validada;
create function public.estornar_baixa_nota(text,text)
returns jsonb language plpgsql security definer set search_path=public as $fn$
declare v_resultado jsonb;
begin
  v_resultado := public.estornar_baixa_nota_validada($1,$2);
  return jsonb_set(v_resultado,'{movimentou_saldo}','true'::jsonb,true);
end;$fn$;
revoke all on function public.estornar_baixa_nota(text,text) from public;
grant execute on function public.estornar_baixa_nota(text,text) to authenticated;

-- Diagnóstico somente leitura dos débitos históricos feitos pela marcação
-- antiga. Nenhuma linha é corrigida ou estornada automaticamente.
create or replace view public.diagnostico_debitos_programacao as
select pm.id, pm.pagamento_id, pm.programacao_id, pr.data_programacao,
       pm.conta_id, cb.nome_conta, pm.valor,
       pm.saldo_anterior, pm.saldo_posterior, pm.data_movimento,
       p.fornecedor_id, coalesce(f.apelido, f.razao_social, p.nome_avulso) fornecedor
  from public.pagamento_movimentacoes pm
  join public.pagamentos p on p.id = pm.pagamento_id
  join public.programacoes_pagamento pr on pr.id = pm.programacao_id
  left join public.contas_bancarias cb on cb.id = pm.conta_id
  left join public.fornecedores f on f.id = p.fornecedor_id;
grant select on public.diagnostico_debitos_programacao to authenticated;

-- Reaproveita a matriz existente: ações de transferência consultam Baixas;
-- ações de planejamento continuam consultando Pagamentos Diários.
create or replace function public.pode_em_pagamentos_fase2(p_acao text)
returns boolean language plpgsql stable security definer set search_path = public as $fn$
declare v_usuario uuid; v_explicito boolean; v_coluna text; v_modulo text;
begin
  select u.id into v_usuario from public.usuarios u where u.auth_id=auth.uid() and u.status='ativo' limit 1;
  if v_usuario is null then return false; end if;
  if to_regclass('public.permissoes_especiais') is not null then
    begin
      execute 'select pe.permitido from public.permissoes_especiais pe where pe.usuario_id=$1 and pe.acao=$2 limit 1'
        into v_explicito using v_usuario,p_acao;
      if v_explicito is not null then return v_explicito; end if;
    exception when others then v_explicito:=null; end;
  end if;
  v_modulo := case when p_acao in ('executar_transferencia','estornar_transferencia') then 'baixas' else 'pagamentos' end;
  v_coluna := case p_acao when 'aprovar_programacao' then 'pode_aprovar' when 'executar_programacao' then 'pode_editar'
    when 'definir_conta_pagamento' then 'pode_editar' when 'executar_transferencia' then 'pode_criar'
    when 'estornar_transferencia' then 'pode_excluir' else null end;
  if v_coluna is null then return false; end if;
  return exists(select 1 from public.permissoes_efetivas pe where pe.usuario_id=v_usuario and pe.modulo=v_modulo
    and case v_coluna when 'pode_aprovar' then pe.pode_aprovar when 'pode_editar' then pe.pode_editar
      when 'pode_criar' then pe.pode_criar when 'pode_excluir' then pe.pode_excluir else false end);
end;$fn$;
grant execute on function public.pode_em_pagamentos_fase2(text) to authenticated;

commit;
