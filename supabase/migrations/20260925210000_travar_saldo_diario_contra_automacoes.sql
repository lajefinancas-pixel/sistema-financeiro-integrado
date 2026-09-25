-- Trava definitiva: automações nunca alteram a base diária de saldo.
-- Esta migration é deliberadamente somente preventiva: não restaura dados.
begin;

drop trigger if exists pagamentos_baixas_movimentar_saldo on public.pagamentos_baixas;
drop function if exists public.movimentar_saldo_pela_baixa();

create or replace function public.registrar_saldos_manuais(p_linhas jsonb)
returns jsonb language plpgsql security definer set search_path=public as $fn$
declare v_usuario uuid; v_linha jsonb; v_conta integer; v_valor numeric(14,2); v_data date; v_total integer:=0;
begin
  if auth.uid() is null then raise exception 'Usuário não autenticado.' using errcode='42501'; end if;
  select u.id into v_usuario from public.usuarios u where u.auth_id=auth.uid() and u.status='ativo' limit 1;
  if v_usuario is null or not exists (
    select 1 from public.permissoes_efetivas pe where pe.usuario_id=v_usuario and pe.modulo='saldos'
      and (pe.pode_editar or pe.pode_criar)
  ) then raise exception 'Você não tem permissão para editar saldos.' using errcode='42501'; end if;
  if jsonb_typeof(coalesce(p_linhas,'null'::jsonb)) <> 'array' or jsonb_array_length(p_linhas)=0 then
    raise exception 'Informe ao menos um saldo para lançar.';
  end if;
  perform set_config('app.escrita_manual_saldo','permitida',true);
  for v_linha in select value from jsonb_array_elements(p_linhas) loop
    v_conta:=nullif(v_linha->>'conta_id','')::integer;
    v_valor:=round((v_linha->>'valor_saldo')::numeric,2);
    v_data:=(v_linha->>'data_saldo')::date;
    if v_conta is null or v_valor is null or v_data is null then raise exception 'Conta, valor e data são obrigatórios.'; end if;
    if not exists(select 1 from public.contas_bancarias where id=v_conta) then raise exception 'Conta bancária % não encontrada.',v_conta; end if;
    insert into public.saldos_historico(conta_id,valor_saldo,data_saldo) values(v_conta,v_valor,v_data)
    on conflict(conta_id,data_saldo) do update set valor_saldo=excluded.valor_saldo;
    v_total:=v_total+1;
  end loop;
  return jsonb_build_object('ok',true,'quantidade',v_total,'origem','manual');
end;$fn$;
revoke all on function public.registrar_saldos_manuais(jsonb) from public;
grant execute on function public.registrar_saldos_manuais(jsonb) to authenticated;

create or replace function public.bloquear_escrita_automatica_saldo()
returns trigger language plpgsql set search_path=public as $fn$
begin
  if current_setting('app.escrita_manual_saldo',true) is distinct from 'permitida' then
    raise exception 'O saldo do dia é imutável por automação. Use uma ação manual autorizada em Saldos das Contas.' using errcode='42501';
  end if;
  return case when tg_op='DELETE' then old else new end;
end;$fn$;
drop trigger if exists saldos_historico_bloquear_automacao on public.saldos_historico;
create trigger saldos_historico_bloquear_automacao before insert or update or delete on public.saldos_historico
for each row execute function public.bloquear_escrita_automatica_saldo();

-- As funções validadas continuam gravando a baixa e atualizando a nota. Sem o
-- trigger acima, nenhuma delas toca o saldo; a resposta também afirma isso.
create or replace function public.registrar_baixa_nota(text,text,numeric,date,integer,text default null)
returns jsonb language plpgsql security definer set search_path=public as $fn$
declare v_resultado jsonb; begin
  v_resultado:=public.registrar_baixa_nota_validada($1,$2,$3,$4,$5,$6);
  return jsonb_set(v_resultado,'{movimentou_saldo}','false'::jsonb,true);
end;$fn$;
create or replace function public.estornar_baixa_nota(text,text)
returns jsonb language plpgsql security definer set search_path=public as $fn$
declare v_resultado jsonb; begin
  v_resultado:=public.estornar_baixa_nota_validada($1,$2);
  return jsonb_set(v_resultado,'{movimentou_saldo}','false'::jsonb,true);
end;$fn$;
revoke all on function public.registrar_baixa_nota(text,text,numeric,date,integer,text) from public;
revoke all on function public.estornar_baixa_nota(text,text) from public;
grant execute on function public.registrar_baixa_nota(text,text,numeric,date,integer,text) to authenticated;
grant execute on function public.estornar_baixa_nota(text,text) to authenticated;

-- Diagnóstico de 25/09: somente leitura e sem restauração automática.
create or replace view public.diagnostico_alteracoes_automaticas_saldo_20260925 as
select ae.criado_em as horario,ae.usuario_id,u.nome as usuario,ae.acao as origem,
 coalesce(ae.valor_novo->>'conta_id',ae.valor_anterior->>'conta_id') as conta_id,
 cb.nome_conta as conta,
 coalesce(ae.valor_anterior->>'saldo',ae.valor_anterior->>'saldo_antes',ae.valor_anterior->>'saldo_origem_antes',ae.valor_anterior->>'saldo_destino_antes') as saldo_antes,
 coalesce(ae.valor_novo->>'saldo',ae.valor_novo->>'saldo_depois',ae.valor_novo->>'saldo_origem_depois',ae.valor_novo->>'saldo_destino_depois') as saldo_depois,
 ae.valor_novo as detalhes
from public.auditoria_eventos ae
left join public.usuarios u on u.id=ae.usuario_id
left join public.contas_bancarias cb on cb.id::text=coalesce(ae.valor_novo->>'conta_id',ae.valor_anterior->>'conta_id')
where (ae.criado_em at time zone 'America/Maceio')::date=date '2026-09-25' and ae.modulo<>'saldos'
  and (ae.valor_anterior::text ilike '%saldo%' or ae.valor_novo::text ilike '%saldo%');
grant select on public.diagnostico_alteracoes_automaticas_saldo_20260925 to authenticated;

comment on function public.registrar_saldos_manuais(jsonb) is 'Única porta de escrita do saldo diário: ação manual autenticada.';
notify pgrst,'reload schema';
commit;

begin;
create or replace function public.confirmar_transferencias_programacao(
 p_programacao_id integer,p_conta_destino_id integer,p_transferencias jsonb,p_chave_idempotencia text,p_observacao text default null)
returns jsonb language plpgsql security definer set search_path=public as $fn$
declare v_usuario_lote uuid; v_usuario_perna uuid; v_usuario_auditoria uuid; v_lote uuid; v_existente uuid;
 v_item jsonb; v_origem integer; v_valor numeric(14,2); v_total numeric(14,2):=0; v_qtd integer:=0;
 v_id uuid; v_pernas jsonb:='[]'::jsonb;
begin
 if auth.uid() is null then raise exception 'Usuário não autenticado.' using errcode='42501'; end if;
 if not public.pode_em_pagamentos_fase2('executar_transferencia') then raise exception 'Você não tem permissão para transferir entre contas.' using errcode='42501'; end if;
 if coalesce(trim(p_chave_idempotencia),'')='' then raise exception 'A transferência precisa de um identificador único.'; end if;
 if jsonb_typeof(coalesce(p_transferencias,'null'::jsonb))<>'array' or jsonb_array_length(p_transferencias)=0 then raise exception 'Informe ao menos uma conta de origem com valor.'; end if;
 if not exists(select 1 from public.contas_bancarias where id=p_conta_destino_id and coalesce(ativo::text,'true') in ('true','t','1')) then raise exception 'Conta de destino não encontrada ou desativada.'; end if;
 v_usuario_lote:=public.usuario_para_coluna('transferencia_lotes','usuario_id');
 v_usuario_perna:=public.usuario_para_coluna('transferencias_contas','usuario_id');
 v_usuario_auditoria:=public.usuario_para_coluna('auditoria_eventos','usuario_id');
 insert into public.transferencia_lotes(chave_idempotencia,programacao_id,conta_destino_id,observacao,usuario_id,status)
 values(trim(p_chave_idempotencia),p_programacao_id,p_conta_destino_id,nullif(trim(coalesce(p_observacao,'')),''),v_usuario_lote,'confirmado')
 on conflict(chave_idempotencia) do nothing returning id into v_lote;
 if v_lote is null then
   select id into v_existente from public.transferencia_lotes where chave_idempotencia=trim(p_chave_idempotencia);
   select coalesce(jsonb_agg(jsonb_build_object('id',id,'conta_origem_id',conta_origem_id,'valor',valor)),'[]'::jsonb)
    into v_pernas from public.transferencias_contas where lote_id=v_existente;
   return jsonb_build_object('ok',true,'ja_confirmada',true,'lote_id',v_existente,'transferencias',v_pernas,'movimentou_saldo',false);
 end if;
 for v_item in select value from jsonb_array_elements(p_transferencias) loop
   v_origem:=nullif(v_item->>'conta_origem_id','')::integer; v_valor:=round(coalesce((v_item->>'valor')::numeric,0),2);
   if v_origem is null or v_valor<=0 then raise exception 'Informe conta de origem e valor maior que zero.'; end if;
   if v_origem=p_conta_destino_id then raise exception 'A conta de origem e a de destino precisam ser diferentes.'; end if;
   if not exists(select 1 from public.contas_bancarias where id=v_origem and coalesce(ativo::text,'true') in ('true','t','1')) then raise exception 'Conta de origem não encontrada ou desativada.'; end if;
   insert into public.transferencias_contas(lote_id,programacao_id,conta_origem_id,conta_destino_id,valor,data_movimento,observacao,usuario_id,status)
   values(v_lote,p_programacao_id,v_origem,p_conta_destino_id,v_valor,current_date,nullif(trim(coalesce(p_observacao,'')),''),v_usuario_perna,'confirmada') returning id into v_id;
   v_total:=v_total+v_valor; v_qtd:=v_qtd+1;
   v_pernas:=v_pernas||jsonb_build_object('id',v_id,'conta_origem_id',v_origem,'valor',v_valor,'movimentou_saldo',false);
 end loop;
 update public.transferencia_lotes set valor_total=v_total,quantidade_origens=v_qtd where id=v_lote;
 insert into public.auditoria_eventos(usuario_id,modulo,acao,registro_afetado,valor_anterior,valor_novo,nivel)
 values(v_usuario_auditoria,'pagamentos','transferiu','Transferência entre contas — lote '||v_lote::text,
  jsonb_build_object('saldos','preservados'),jsonb_build_object('lote_id',v_lote,'conta_destino_id',p_conta_destino_id,'valor_total',v_total,'transferencias',v_pernas,'movimentou_saldo',false)||public.rastro_do_login(v_usuario_auditoria),'critico');
 return jsonb_build_object('ok',true,'ja_confirmada',false,'lote_id',v_lote,'valor_total',v_total,'quantidade_origens',v_qtd,'conta_destino_id',p_conta_destino_id,'transferencias',v_pernas,'movimentou_saldo',false);
end;$fn$;

create or replace function public.estornar_transferencia(p_transferencia_id uuid,p_observacao text)
returns jsonb language plpgsql security definer set search_path=public as $fn$
declare v_t record; v_motivo text; v_lote uuid; v_id uuid; v_ul uuid; v_up uuid; v_ue uuid; v_ua uuid;
begin
 if auth.uid() is null then raise exception 'Usuário não autenticado.' using errcode='42501'; end if;
 if not public.pode_em_pagamentos_fase2('estornar_transferencia') then raise exception 'Você não tem permissão para estornar transferências.' using errcode='42501'; end if;
 v_motivo:=nullif(trim(coalesce(p_observacao,'')),''); if v_motivo is null then raise exception 'Informe o motivo do estorno.'; end if;
 select * into v_t from public.transferencias_contas where id=p_transferencia_id for update;
 if not found then raise exception 'Transferência não encontrada.'; end if;
 if v_t.status::text='estornada' then return jsonb_build_object('ok',true,'ja_estornada',true,'transferencia_id',p_transferencia_id,'movimentou_saldo',false); end if;
 if v_t.status::text='estorno' then raise exception 'Um estorno não pode ser estornado.'; end if;
 v_ul:=public.usuario_para_coluna('transferencia_lotes','usuario_id'); v_up:=public.usuario_para_coluna('transferencias_contas','usuario_id');
 v_ue:=public.usuario_para_coluna('transferencias_contas','estornada_por'); v_ua:=public.usuario_para_coluna('auditoria_eventos','usuario_id');
 insert into public.transferencia_lotes(chave_idempotencia,programacao_id,conta_destino_id,observacao,usuario_id,status,estorno_de_lote_id,motivo_estorno,valor_total,quantidade_origens)
 values('estorno:'||p_transferencia_id,v_t.programacao_id,v_t.conta_origem_id,v_motivo,v_ul,'estorno',v_t.lote_id,v_motivo,v_t.valor,1)
 on conflict(chave_idempotencia) do nothing returning id into v_lote;
 if v_lote is null then return jsonb_build_object('ok',true,'ja_estornada',true,'transferencia_id',p_transferencia_id,'movimentou_saldo',false); end if;
 insert into public.transferencias_contas(lote_id,programacao_id,conta_origem_id,conta_destino_id,valor,data_movimento,observacao,usuario_id,status,estorno_de_transferencia_id,motivo_estorno)
 values(v_lote,v_t.programacao_id,v_t.conta_destino_id,v_t.conta_origem_id,v_t.valor,current_date,v_motivo,v_up,'estorno',p_transferencia_id,v_motivo) returning id into v_id;
 update public.transferencias_contas set status='estornada',estornada_em=now(),estornada_por=v_ue,motivo_estorno=v_motivo where id=p_transferencia_id;
 insert into public.auditoria_eventos(usuario_id,modulo,acao,registro_afetado,valor_anterior,valor_novo,nivel)
 values(v_ua,'pagamentos','estornou','Transferência '||p_transferencia_id,jsonb_build_object('status',v_t.status,'valor',v_t.valor),jsonb_build_object('status','estornada','motivo',v_motivo,'movimentou_saldo',false)||public.rastro_do_login(v_ua),'critico');
 return jsonb_build_object('ok',true,'ja_estornada',false,'transferencia_id',p_transferencia_id,'estorno_id',v_id,'lote_id',v_lote,'valor',v_t.valor,'movimentou_saldo',false);
end;$fn$;
revoke all on function public.confirmar_transferencias_programacao(integer,integer,jsonb,text,text) from public;
revoke all on function public.estornar_transferencia(uuid,text) from public;
grant execute on function public.confirmar_transferencias_programacao(integer,integer,jsonb,text,text) to authenticated;
grant execute on function public.estornar_transferencia(uuid,text) to authenticated;
notify pgrst,'reload schema';
commit;
