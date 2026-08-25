-- Programação diária com conta única de pagamento e transferências entre contas próprias.
-- A seleção de contas e os valores informados não alteram saldos; somente as RPCs
-- de confirmação e estorno movimentam as duas pontas na mesma transação.

alter table public.programacoes_pagamento
  add column if not exists conta_pagamento_id uuid references public.contas_bancarias(id);

alter table public.programacao_contas
  add column if not exists valor_transferir numeric(14,2) not null default 0;

alter table public.pagamentos
  add column if not exists forma_pagamento_id text,
  add column if not exists forma_pagamento_resumo text;

create table if not exists public.permissoes_especiais (
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  acao text not null,
  permitido boolean not null default false,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references public.usuarios(id) on delete set null,
  primary key (usuario_id, acao)
);

alter table public.permissoes_especiais enable row level security;

create or replace function public.tem_permissao_especial(p_acao text)
returns boolean language sql stable security definer set search_path = public as $$
  with eu as (select public.meu_usuario_ativo_id() usuario_id),
  explicita as (
    select pe.permitido from public.permissoes_especiais pe, eu
    where pe.usuario_id = eu.usuario_id and pe.acao = p_acao
  ),
  base as (
    select case
      when p_acao in ('visualizar_dados_bancarios','visualizar_pix') then coalesce(p.pode_visualizar,false)
      when p_acao in ('cadastrar_dados_bancarios','cadastrar_pix') then coalesce(p.pode_cadastrar,false)
      when p_acao in ('editar_dados_bancarios','editar_pix') then coalesce(p.pode_editar,false)
      when p_acao = 'excluir_dados_bancarios' then coalesce(p.pode_excluir,false)
      when p_acao = 'executar_transferencia' then coalesce(pg.pode_aprovar,false)
      when p_acao = 'estornar_transferencia' then coalesce(pg.pode_excluir,false)
      else false end permitido
    from eu
    left join public.permissoes_efetivas p on p.usuario_id=eu.usuario_id and p.modulo='fornecedores'
    left join public.permissoes_efetivas pg on pg.usuario_id=eu.usuario_id and pg.modulo='pagamentos'
  )
  select coalesce((select permitido from explicita), (select permitido from base), false)
$$;

grant execute on function public.tem_permissao_especial(text) to authenticated;

create policy "permissoes_especiais_select_proprio"
  on public.permissoes_especiais for select to authenticated
  using (usuario_id = public.meu_usuario_ativo_id() or exists(select 1 from public.permissoes_efetivas pe where pe.usuario_id=public.meu_usuario_ativo_id() and pe.modulo='administracao' and pe.pode_editar=true));
create policy "permissoes_especiais_admin_insert"
  on public.permissoes_especiais for insert to authenticated
  with check (exists(select 1 from public.permissoes_efetivas pe where pe.usuario_id=public.meu_usuario_ativo_id() and pe.modulo='administracao' and pe.pode_editar=true));
create policy "permissoes_especiais_admin_update"
  on public.permissoes_especiais for update to authenticated
  using (exists(select 1 from public.permissoes_efetivas pe where pe.usuario_id=public.meu_usuario_ativo_id() and pe.modulo='administracao' and pe.pode_editar=true))
  with check (exists(select 1 from public.permissoes_efetivas pe where pe.usuario_id=public.meu_usuario_ativo_id() and pe.modulo='administracao' and pe.pode_editar=true));
create policy "permissoes_especiais_admin_delete"
  on public.permissoes_especiais for delete to authenticated
  using (exists(select 1 from public.permissoes_efetivas pe where pe.usuario_id=public.meu_usuario_ativo_id() and pe.modulo='administracao' and pe.pode_editar=true));

grant select,insert,update,delete on public.permissoes_especiais to authenticated;

create table if not exists public.transferencia_lotes (
  id uuid primary key default gen_random_uuid(),
  chave_idempotencia text not null unique,
  programacao_id uuid not null references public.programacoes_pagamento(id),
  conta_destino_id uuid not null references public.contas_bancarias(id),
  usuario_id uuid references public.usuarios(id) on delete set null,
  status text not null default 'processando' check (status in ('processando','confirmado','falhou')),
  resultado jsonb,
  criado_em timestamptz not null default now()
);

create table if not exists public.transferencias_contas (
  id uuid primary key default gen_random_uuid(),
  lote_id uuid not null references public.transferencia_lotes(id),
  programacao_id uuid not null references public.programacoes_pagamento(id),
  conta_origem_id uuid not null references public.contas_bancarias(id),
  conta_destino_id uuid not null references public.contas_bancarias(id),
  valor numeric(14,2) not null check (valor > 0),
  saldo_origem_antes numeric(14,2) not null,
  saldo_origem_depois numeric(14,2) not null,
  saldo_destino_antes numeric(14,2) not null,
  saldo_destino_depois numeric(14,2) not null,
  usuario_id uuid references public.usuarios(id) on delete set null,
  observacao text,
  criada_em timestamptz not null default now(),
  estornada_em timestamptz,
  estornada_por uuid references public.usuarios(id) on delete set null,
  estorno_id uuid references public.transferencias_contas(id),
  transferencia_original_id uuid references public.transferencias_contas(id),
  unique (lote_id, conta_origem_id)
);

alter table public.transferencia_lotes enable row level security;
alter table public.transferencias_contas enable row level security;
create policy "transferencias_select_pagamentos" on public.transferencia_lotes for select to authenticated using (exists(select 1 from public.permissoes_efetivas pe where pe.usuario_id=public.meu_usuario_ativo_id() and pe.modulo='pagamentos' and pe.pode_visualizar=true));
create policy "transferencias_itens_select_pagamentos" on public.transferencias_contas for select to authenticated using (exists(select 1 from public.permissoes_efetivas pe where pe.usuario_id=public.meu_usuario_ativo_id() and pe.modulo='pagamentos' and pe.pode_visualizar=true));
grant select on public.transferencia_lotes, public.transferencias_contas to authenticated;

create or replace function public.confirmar_transferencias_programacao(
  p_programacao_id uuid,
  p_conta_destino_id uuid,
  p_transferencias jsonb,
  p_chave_idempotencia text,
  p_observacao text default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_programacao public.programacoes_pagamento%rowtype;
  v_lote public.transferencia_lotes%rowtype;
  v_item jsonb;
  v_origem uuid;
  v_valor numeric(14,2);
  v_saldo_origem numeric(14,2);
  v_saldo_destino numeric(14,2);
  v_data_origem date;
  v_data_destino date;
  v_data_movimento date;
  v_transferencia_id uuid;
  v_usuario uuid := public.meu_usuario_ativo_id();
  v_ids jsonb := '[]'::jsonb;
begin
  if not public.tem_permissao_especial('executar_transferencia') then raise exception 'Sem permissão para executar transferência.' using errcode='42501'; end if;
  if coalesce(trim(p_chave_idempotencia),'')='' then raise exception 'Chave de idempotência obrigatória.'; end if;

  select * into v_lote from public.transferencia_lotes where chave_idempotencia=p_chave_idempotencia;
  if found then return coalesce(v_lote.resultado, jsonb_build_object('ok',true,'ja_confirmado',true,'lote_id',v_lote.id)); end if;

  select * into v_programacao from public.programacoes_pagamento where id=p_programacao_id for update;
  if not found then raise exception 'Programação não encontrada.'; end if;
  if v_programacao.conta_pagamento_id is distinct from p_conta_destino_id then raise exception 'A conta de destino deve ser a conta de pagamento da programação.'; end if;
  if jsonb_typeof(p_transferencias) <> 'array' or jsonb_array_length(p_transferencias)=0 then raise exception 'Informe ao menos uma transferência.'; end if;

  perform pg_advisory_xact_lock(hashtextextended(q.conta_id,0))
  from (
    select p_conta_destino_id::text conta_id
    union
    select i->>'conta_origem_id' from jsonb_array_elements(p_transferencias) i
    order by conta_id
  ) q;

  insert into public.transferencia_lotes(chave_idempotencia,programacao_id,conta_destino_id,usuario_id)
  values(p_chave_idempotencia,p_programacao_id,p_conta_destino_id,v_usuario) returning * into v_lote;

  select coalesce(valor_saldo,0),data_saldo into v_saldo_destino,v_data_destino
  from public.saldos_historico where conta_id=p_conta_destino_id order by data_saldo desc limit 1;
  if not found then v_saldo_destino:=0; v_data_destino:=v_programacao.data_programacao; end if;

  for v_item in select * from jsonb_array_elements(p_transferencias) loop
    v_origem := (v_item->>'conta_origem_id')::uuid;
    v_valor := round((v_item->>'valor')::numeric,2);
    if v_origem=p_conta_destino_id then raise exception 'A conta de origem não pode ser a conta de destino.'; end if;
    if v_valor<=0 then raise exception 'Valor de transferência inválido.'; end if;
    if not exists(select 1 from public.programacao_contas where programacao_id=p_programacao_id and conta_id=v_origem) then raise exception 'Conta de origem não selecionada na programação.'; end if;

    select coalesce(valor_saldo,0),data_saldo into v_saldo_origem,v_data_origem
    from public.saldos_historico where conta_id=v_origem order by data_saldo desc limit 1;
    if not found then v_saldo_origem:=0; v_data_origem:=v_programacao.data_programacao; end if;
    if v_valor>v_saldo_origem then raise exception 'Saldo insuficiente na conta de origem.'; end if;
    v_data_movimento:=greatest(v_programacao.data_programacao,coalesce(v_data_origem,v_programacao.data_programacao),coalesce(v_data_destino,v_programacao.data_programacao));

    insert into public.transferencias_contas(lote_id,programacao_id,conta_origem_id,conta_destino_id,valor,saldo_origem_antes,saldo_origem_depois,saldo_destino_antes,saldo_destino_depois,usuario_id,observacao)
    values(v_lote.id,p_programacao_id,v_origem,p_conta_destino_id,v_valor,v_saldo_origem,v_saldo_origem-v_valor,v_saldo_destino,v_saldo_destino+v_valor,v_usuario,p_observacao)
    returning id into v_transferencia_id;

    insert into public.saldos_historico(conta_id,valor_saldo,data_saldo) values(v_origem,v_saldo_origem-v_valor,v_data_movimento)
    on conflict(conta_id,data_saldo) do update set valor_saldo=excluded.valor_saldo;
    v_saldo_destino:=v_saldo_destino+v_valor;
    insert into public.saldos_historico(conta_id,valor_saldo,data_saldo) values(p_conta_destino_id,v_saldo_destino,v_data_movimento)
    on conflict(conta_id,data_saldo) do update set valor_saldo=excluded.valor_saldo;

    insert into public.auditoria_eventos(usuario_id,modulo,acao,registro_afetado,valor_anterior,valor_novo,nivel)
    values(v_usuario,'pagamentos','transferiu','Transferência entre contas próprias',
      jsonb_build_object('conta_origem_id',v_origem,'saldo_origem',v_saldo_origem,'conta_destino_id',p_conta_destino_id,'saldo_destino',v_saldo_destino-v_valor),
      jsonb_build_object('transferencia_id',v_transferencia_id,'valor',v_valor,'saldo_origem',v_saldo_origem-v_valor,'saldo_destino',v_saldo_destino),'critico');
    v_ids:=v_ids||jsonb_build_array(v_transferencia_id);
  end loop;

  update public.programacao_contas set valor_transferir=0 where programacao_id=p_programacao_id;
  v_lote.resultado:=jsonb_build_object('ok',true,'ja_confirmado',false,'lote_id',v_lote.id,'transferencias',v_ids,'saldo_destino',v_saldo_destino);
  update public.transferencia_lotes set status='confirmado',resultado=v_lote.resultado where id=v_lote.id;
  return v_lote.resultado;
exception when unique_violation then
  select * into v_lote from public.transferencia_lotes where chave_idempotencia=p_chave_idempotencia;
  return coalesce(v_lote.resultado,jsonb_build_object('ok',true,'ja_confirmado',true,'lote_id',v_lote.id));
end $$;

create or replace function public.estornar_transferencia(p_transferencia_id uuid, p_observacao text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_original public.transferencias_contas%rowtype;
  v_origem numeric(14,2); v_destino numeric(14,2); v_data date; v_estorno uuid; v_lote_estorno uuid; v_usuario uuid:=public.meu_usuario_ativo_id();
begin
  if not public.tem_permissao_especial('estornar_transferencia') then raise exception 'Sem permissão para estornar transferência.' using errcode='42501'; end if;
  select * into v_original from public.transferencias_contas where id=p_transferencia_id for update;
  if not found then raise exception 'Transferência não encontrada.'; end if;
  if v_original.estornada_em is not null then return jsonb_build_object('ok',true,'ja_estornada',true,'estorno_id',v_original.estorno_id); end if;
  perform pg_advisory_xact_lock(hashtextextended(least(v_original.conta_origem_id::text,v_original.conta_destino_id::text),0));
  perform pg_advisory_xact_lock(hashtextextended(greatest(v_original.conta_origem_id::text,v_original.conta_destino_id::text),0));
  select coalesce(valor_saldo,0),data_saldo into v_origem,v_data from public.saldos_historico where conta_id=v_original.conta_origem_id order by data_saldo desc limit 1;
  select coalesce(valor_saldo,0),greatest(v_data,data_saldo) into v_destino,v_data from public.saldos_historico where conta_id=v_original.conta_destino_id order by data_saldo desc limit 1;
  if v_destino<v_original.valor then raise exception 'A conta de destino não possui saldo suficiente para o estorno.'; end if;
  insert into public.transferencia_lotes(chave_idempotencia,programacao_id,conta_destino_id,usuario_id,status)
  values('estorno:'||v_original.id::text,v_original.programacao_id,v_original.conta_origem_id,v_usuario,'confirmado') returning id into v_lote_estorno;
  insert into public.transferencias_contas(lote_id,programacao_id,conta_origem_id,conta_destino_id,valor,saldo_origem_antes,saldo_origem_depois,saldo_destino_antes,saldo_destino_depois,usuario_id,observacao,transferencia_original_id)
  values(v_lote_estorno,v_original.programacao_id,v_original.conta_destino_id,v_original.conta_origem_id,v_original.valor,v_destino,v_destino-v_original.valor,v_origem,v_origem+v_original.valor,v_usuario,p_observacao,v_original.id) returning id into v_estorno;
  insert into public.saldos_historico(conta_id,valor_saldo,data_saldo) values(v_original.conta_destino_id,v_destino-v_original.valor,v_data) on conflict(conta_id,data_saldo) do update set valor_saldo=excluded.valor_saldo;
  insert into public.saldos_historico(conta_id,valor_saldo,data_saldo) values(v_original.conta_origem_id,v_origem+v_original.valor,v_data) on conflict(conta_id,data_saldo) do update set valor_saldo=excluded.valor_saldo;
  update public.transferencias_contas set estornada_em=now(),estornada_por=v_usuario,estorno_id=v_estorno where id=v_original.id;
  insert into public.auditoria_eventos(usuario_id,modulo,acao,registro_afetado,valor_anterior,valor_novo,nivel) values(v_usuario,'pagamentos','estornou','Estorno de transferência entre contas próprias',to_jsonb(v_original),jsonb_build_object('estorno_id',v_estorno),'critico');
  return jsonb_build_object('ok',true,'ja_estornada',false,'estorno_id',v_estorno);
end $$;

grant execute on function public.confirmar_transferencias_programacao(uuid,uuid,jsonb,text,text) to authenticated;
grant execute on function public.estornar_transferencia(uuid,text) to authenticated;

create or replace function public.marcar_pagamento_pago(p_pagamento_id text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  p public.pagamentos%rowtype; pr public.programacoes_pagamento%rowtype; saldo numeric(14,2); ultima_data date; valor numeric(14,2); movimento_id uuid;
begin
  select * into p from public.pagamentos where id::text=p_pagamento_id for update;
  if not found then return jsonb_build_object('ok',false,'motivo','pagamento_nao_encontrado'); end if;
  if p.situacao='pago' then return jsonb_build_object('ok',true,'ja_pago',true); end if;
  if p.situacao='cancelado' then return jsonb_build_object('ok',false,'motivo','pagamento_cancelado'); end if;
  select * into pr from public.programacoes_pagamento where id=p.programacao_id for update;
  if pr.conta_pagamento_id is null then return jsonb_build_object('ok',false,'motivo','sem_conta_pagamento'); end if;
  perform pg_advisory_xact_lock(hashtextextended(pr.conta_pagamento_id::text,0));
  valor:=round(coalesce(p.valor_a_pagar,0)::numeric,2);
  select coalesce(valor_saldo,0),data_saldo into saldo,ultima_data from public.saldos_historico where conta_id=pr.conta_pagamento_id order by data_saldo desc limit 1;
  if not found then saldo:=0; ultima_data:=pr.data_programacao; end if;
  if valor>saldo then return jsonb_build_object('ok',false,'motivo','saldo_insuficiente','conta_id',pr.conta_pagamento_id,'disponivel',saldo,'necessario',valor,'diferenca',valor-saldo); end if;
  insert into public.pagamento_movimentacoes(pagamento_id,programacao_id,conta_id,valor,saldo_anterior,saldo_posterior,data_movimento,criado_por)
  values(p.id,pr.id,pr.conta_pagamento_id,valor,saldo,saldo-valor,greatest(pr.data_programacao,ultima_data),auth.uid())
  on conflict(pagamento_id,conta_id) do nothing returning id into movimento_id;
  if movimento_id is null then return jsonb_build_object('ok',true,'ja_pago',true); end if;
  insert into public.saldos_historico(conta_id,valor_saldo,data_saldo) values(pr.conta_pagamento_id,saldo-valor,greatest(pr.data_programacao,ultima_data)) on conflict(conta_id,data_saldo) do update set valor_saldo=excluded.valor_saldo;
  update public.pagamentos set situacao='pago' where id=p.id;
  return jsonb_build_object('ok',true,'ja_pago',false,'valor_debitado',valor,'conta_id',pr.conta_pagamento_id);
end $$;

grant execute on function public.marcar_pagamento_pago(text) to authenticated;
