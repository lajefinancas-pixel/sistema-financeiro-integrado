-- Migration consolidada para o fluxo real de pagamentos diários.
-- Substitui as migrations pendentes de 2026-08-25 e 2026-08-26.
-- Todos os identificadores seguem os tipos reais levantados em produção.
-- Não remove dados; backfills usam chaves idempotentes e não movimentam saldo novamente.

begin;

-- Falha antes de qualquer DDL caso o schema-base não corresponda aos tipos
-- esperados pelas tabelas e RPCs consolidadas.
do $$
declare
  v_esperado record;
  v_encontrado text;
begin
  for v_esperado in
    select *
      from (values
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
      ) as tipos(tabela, coluna, tipo)
  loop
    select format_type(a.atttypid, a.atttypmod)
      into v_encontrado
      from pg_attribute a
      join pg_class c on c.oid = a.attrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = v_esperado.tabela
       and a.attname = v_esperado.coluna
       and a.attnum > 0
       and not a.attisdropped;

    if v_encontrado is distinct from v_esperado.tipo then
      raise exception 'Tipo inesperado em public.%.%: esperado %, encontrado %',
        v_esperado.tabela,
        v_esperado.coluna,
        v_esperado.tipo,
        coalesce(v_encontrado, 'coluna ausente');
    end if;
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Efeito consolidado de 20260825120000_conta_pagamento_transferencias_dados_fornecedor.sql
-- -----------------------------------------------------------------------------

-- Programação diária com conta única de pagamento e transferências entre contas próprias.
-- A seleção de contas e os valores informados não alteram saldos; somente as RPCs
-- de confirmação e estorno movimentam as duas pontas na mesma transação.

alter table public.programacoes_pagamento
  add column if not exists conta_pagamento_id integer references public.contas_bancarias(id);

do $$
begin
  if not exists (
    select 1
      from pg_constraint c
      join pg_attribute a
        on a.attrelid = c.conrelid
       and a.attnum = any(c.conkey)
     where c.contype = 'f'
       and c.conrelid = 'public.programacoes_pagamento'::regclass
       and c.confrelid = 'public.contas_bancarias'::regclass
       and a.attname = 'conta_pagamento_id'
  ) then
    alter table public.programacoes_pagamento
      add constraint programacoes_pagamento_conta_pagamento_id_fkey
      foreign key (conta_pagamento_id) references public.contas_bancarias(id);
  end if;
end;
$$;

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

drop policy if exists "permissoes_especiais_select_proprio" on public.permissoes_especiais;
create policy "permissoes_especiais_select_proprio"
  on public.permissoes_especiais for select to authenticated
  using (usuario_id = public.meu_usuario_ativo_id() or exists(select 1 from public.permissoes_efetivas pe where pe.usuario_id=public.meu_usuario_ativo_id() and pe.modulo='administracao' and pe.pode_editar=true));
drop policy if exists "permissoes_especiais_admin_insert" on public.permissoes_especiais;
create policy "permissoes_especiais_admin_insert"
  on public.permissoes_especiais for insert to authenticated
  with check (exists(select 1 from public.permissoes_efetivas pe where pe.usuario_id=public.meu_usuario_ativo_id() and pe.modulo='administracao' and pe.pode_editar=true));
drop policy if exists "permissoes_especiais_admin_update" on public.permissoes_especiais;
create policy "permissoes_especiais_admin_update"
  on public.permissoes_especiais for update to authenticated
  using (exists(select 1 from public.permissoes_efetivas pe where pe.usuario_id=public.meu_usuario_ativo_id() and pe.modulo='administracao' and pe.pode_editar=true))
  with check (exists(select 1 from public.permissoes_efetivas pe where pe.usuario_id=public.meu_usuario_ativo_id() and pe.modulo='administracao' and pe.pode_editar=true));
drop policy if exists "permissoes_especiais_admin_delete" on public.permissoes_especiais;
create policy "permissoes_especiais_admin_delete"
  on public.permissoes_especiais for delete to authenticated
  using (exists(select 1 from public.permissoes_efetivas pe where pe.usuario_id=public.meu_usuario_ativo_id() and pe.modulo='administracao' and pe.pode_editar=true));

grant select,insert,update,delete on public.permissoes_especiais to authenticated;

create table if not exists public.transferencia_lotes (
  id uuid primary key default gen_random_uuid(),
  chave_idempotencia text not null unique,
  programacao_id integer not null references public.programacoes_pagamento(id),
  conta_destino_id integer not null references public.contas_bancarias(id),
  usuario_id uuid references public.usuarios(id) on delete set null,
  status text not null default 'processando' check (status in ('processando','confirmado','falhou')),
  resultado jsonb,
  criado_em timestamptz not null default now()
);

create table if not exists public.transferencias_contas (
  id uuid primary key default gen_random_uuid(),
  lote_id uuid not null references public.transferencia_lotes(id),
  programacao_id integer not null references public.programacoes_pagamento(id),
  conta_origem_id integer not null references public.contas_bancarias(id),
  conta_destino_id integer not null references public.contas_bancarias(id),
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
drop policy if exists "transferencias_select_pagamentos" on public.transferencia_lotes;
create policy "transferencias_select_pagamentos" on public.transferencia_lotes for select to authenticated using (exists(select 1 from public.permissoes_efetivas pe where pe.usuario_id=public.meu_usuario_ativo_id() and pe.modulo='pagamentos' and pe.pode_visualizar=true));
drop policy if exists "transferencias_itens_select_pagamentos" on public.transferencias_contas;
create policy "transferencias_itens_select_pagamentos" on public.transferencias_contas for select to authenticated using (exists(select 1 from public.permissoes_efetivas pe where pe.usuario_id=public.meu_usuario_ativo_id() and pe.modulo='pagamentos' and pe.pode_visualizar=true));
grant select on public.transferencia_lotes, public.transferencias_contas to authenticated;

create or replace function public.confirmar_transferencias_programacao(
  p_programacao_id integer,
  p_conta_destino_id integer,
  p_transferencias jsonb,
  p_chave_idempotencia text,
  p_observacao text default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_programacao public.programacoes_pagamento%rowtype;
  v_lote public.transferencia_lotes%rowtype;
  v_item jsonb;
  v_origem integer;
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
    v_origem := (v_item->>'conta_origem_id')::integer;
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

grant execute on function public.confirmar_transferencias_programacao(integer,integer,jsonb,text,text) to authenticated;
grant execute on function public.estornar_transferencia(uuid,text) to authenticated;

drop function if exists public.marcar_pagamento_pago(text);

create or replace function public.marcar_pagamento_pago(p_pagamento_id integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  p public.pagamentos%rowtype; pr public.programacoes_pagamento%rowtype; saldo numeric(14,2); ultima_data date; valor numeric(14,2); movimento_id uuid;
begin
  select * into p from public.pagamentos where id=p_pagamento_id for update;
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

grant execute on function public.marcar_pagamento_pago(integer) to authenticated;

-- -----------------------------------------------------------------------------
-- Efeito consolidado de 20260825160000_corrigir_conta_pagamento_programacao.sql
-- -----------------------------------------------------------------------------

-- Corrige a gravação da conta de pagamento da programação sem movimentar saldo.
-- Migration cumulativa: também cria a coluna caso a implantação anterior ainda
-- não tenha sido aplicada no ambiente de produção.

alter table public.programacoes_pagamento
  add column if not exists conta_pagamento_id integer references public.contas_bancarias(id);

create or replace function public.definir_conta_pagamento_programacao(
  p_programacao_id integer,
  p_conta_id integer
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

revoke all on function public.definir_conta_pagamento_programacao(integer, integer) from public;
grant execute on function public.definir_conta_pagamento_programacao(integer, integer) to authenticated;

-- -----------------------------------------------------------------------------
-- Efeito consolidado de 20260825170000_baixas_pagamentos_fornecedores.sql
-- -----------------------------------------------------------------------------

-- Baixas de pagamentos a fornecedores.
-- Programação continua sendo apenas intenção; somente estas RPCs movimentam saldo.

create table if not exists public.permissoes_especiais (
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  acao text not null,
  permitido boolean not null default false,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references public.usuarios(id) on delete set null,
  primary key (usuario_id, acao)
);

alter table public.permissoes_especiais enable row level security;

drop policy if exists "permissoes_especiais_select_proprio" on public.permissoes_especiais;
create policy "permissoes_especiais_select_proprio" on public.permissoes_especiais for select to authenticated
using (usuario_id=public.meu_usuario_ativo_id() or exists(select 1 from public.permissoes_efetivas pe where pe.usuario_id=public.meu_usuario_ativo_id() and pe.modulo='administracao' and pe.pode_editar=true));
drop policy if exists "permissoes_especiais_admin_insert" on public.permissoes_especiais;
create policy "permissoes_especiais_admin_insert" on public.permissoes_especiais for insert to authenticated
with check (exists(select 1 from public.permissoes_efetivas pe where pe.usuario_id=public.meu_usuario_ativo_id() and pe.modulo='administracao' and pe.pode_editar=true));
drop policy if exists "permissoes_especiais_admin_update" on public.permissoes_especiais;
create policy "permissoes_especiais_admin_update" on public.permissoes_especiais for update to authenticated
using (exists(select 1 from public.permissoes_efetivas pe where pe.usuario_id=public.meu_usuario_ativo_id() and pe.modulo='administracao' and pe.pode_editar=true))
with check (exists(select 1 from public.permissoes_efetivas pe where pe.usuario_id=public.meu_usuario_ativo_id() and pe.modulo='administracao' and pe.pode_editar=true));
drop policy if exists "permissoes_especiais_admin_delete" on public.permissoes_especiais;
create policy "permissoes_especiais_admin_delete" on public.permissoes_especiais for delete to authenticated
using (exists(select 1 from public.permissoes_efetivas pe where pe.usuario_id=public.meu_usuario_ativo_id() and pe.modulo='administracao' and pe.pode_editar=true));
grant select,insert,update,delete on public.permissoes_especiais to authenticated;

create table if not exists public.pagamentos_baixas (
  id uuid primary key default gen_random_uuid(),
  chave_idempotencia text not null unique,
  fornecedor_id integer not null references public.fornecedores(id),
  pagamento_id integer references public.pagamentos(id),
  valor_total_referencia numeric(14,2) not null,
  valor_pago numeric(14,2) not null check (valor_pago > 0),
  data_pagamento date not null,
  conta_id integer not null references public.contas_bancarias(id),
  documento text,
  observacao text,
  status text not null default 'efetivada' check (status in ('processando','efetivada','estornada')),
  saldo_antes numeric(14,2),
  saldo_depois numeric(14,2),
  usuario_id uuid references public.usuarios(id) on delete set null,
  criado_em timestamptz not null default now(),
  estornada_em timestamptz,
  estornada_por uuid references public.usuarios(id) on delete set null,
  motivo_estorno text,
  chave_estorno text unique
);

create table if not exists public.pagamentos_baixa_eventos (
  id uuid primary key default gen_random_uuid(),
  baixa_id uuid not null references public.pagamentos_baixas(id),
  tipo text not null check (tipo in ('baixa','estorno','edicao')),
  valor_movimento numeric(14,2) not null,
  conta_id integer not null references public.contas_bancarias(id),
  saldo_antes numeric(14,2) not null,
  saldo_depois numeric(14,2) not null,
  usuario_id uuid references public.usuarios(id) on delete set null,
  motivo text,
  criado_em timestamptz not null default now()
);

create index if not exists pagamentos_baixas_pagamento_idx on public.pagamentos_baixas(pagamento_id);
create index if not exists pagamentos_baixas_fornecedor_idx on public.pagamentos_baixas(fornecedor_id);
create index if not exists pagamentos_baixas_conta_data_idx on public.pagamentos_baixas(conta_id, data_pagamento);
create index if not exists pagamentos_baixa_eventos_baixa_idx on public.pagamentos_baixa_eventos(baixa_id, criado_em);

-- Preserva pagamentos efetivados antes deste módulo sem movimentar saldo de novo.
insert into public.pagamentos_baixas(
  chave_idempotencia,fornecedor_id,pagamento_id,valor_total_referencia,valor_pago,
  data_pagamento,conta_id,observacao,status,saldo_antes,saldo_depois,criado_em
)
select
  'legado:'||pm.id::text,p.fornecedor_id,p.id,
  round(coalesce(p.valor_a_pagar,pm.valor)::numeric,2),round(pm.valor::numeric,2),
  pm.data_movimento,pm.conta_id,'Migrado do débito de pagamento anterior ao módulo de baixas.',
  'efetivada',pm.saldo_anterior,pm.saldo_posterior,pm.criado_em
from public.pagamento_movimentacoes pm
join public.pagamentos p on p.id=pm.pagamento_id
where p.fornecedor_id is not null
on conflict(chave_idempotencia) do nothing;

insert into public.pagamentos_baixa_eventos(baixa_id,tipo,valor_movimento,conta_id,saldo_antes,saldo_depois,motivo,criado_em)
select b.id,'baixa',-b.valor_pago,b.conta_id,coalesce(b.saldo_antes,0),coalesce(b.saldo_depois,0),'Evento migrado sem nova movimentação de saldo.',b.criado_em
from public.pagamentos_baixas b
where b.chave_idempotencia like 'legado:%'
  and not exists(select 1 from public.pagamentos_baixa_eventos e where e.baixa_id=b.id and e.tipo='baixa');

create or replace function public.tem_permissao_especial(p_acao text)
returns boolean language sql stable security definer set search_path = public as $$
  with eu as (select public.meu_usuario_ativo_id() usuario_id),
  explicita as (select pe.permitido from public.permissoes_especiais pe, eu where pe.usuario_id=eu.usuario_id and pe.acao=p_acao),
  base as (
    select case
      when p_acao in ('visualizar_dados_bancarios','visualizar_pix') then coalesce(p.pode_visualizar,false)
      when p_acao in ('cadastrar_dados_bancarios','cadastrar_pix') then coalesce(p.pode_cadastrar,false)
      when p_acao in ('editar_dados_bancarios','editar_pix') then coalesce(p.pode_editar,false)
      when p_acao='excluir_dados_bancarios' then coalesce(p.pode_excluir,false)
      when p_acao='executar_transferencia' then coalesce(pg.pode_aprovar,false)
      when p_acao='estornar_transferencia' then coalesce(pg.pode_excluir,false)
      when p_acao='visualizar_baixas' then coalesce(pg.pode_visualizar,false)
      when p_acao in ('registrar_baixa','registrar_baixa_avulsa') then coalesce(pg.pode_cadastrar,false)
      when p_acao='editar_baixa' then coalesce(pg.pode_editar,false)
      when p_acao='estornar_baixa' then coalesce(pg.pode_excluir,false)
      else false end permitido
    from eu
    left join public.permissoes_efetivas p on p.usuario_id=eu.usuario_id and p.modulo='fornecedores'
    left join public.permissoes_efetivas pg on pg.usuario_id=eu.usuario_id and pg.modulo='pagamentos'
  )
  select coalesce((select permitido from explicita),(select permitido from base),false)
$$;

grant execute on function public.tem_permissao_especial(text) to authenticated;

alter table public.pagamentos_baixas enable row level security;
alter table public.pagamentos_baixa_eventos enable row level security;

drop policy if exists "pagamentos_baixas_select" on public.pagamentos_baixas;
create policy "pagamentos_baixas_select"
  on public.pagamentos_baixas for select to authenticated
  using (public.tem_permissao_especial('visualizar_baixas'));

drop policy if exists "pagamentos_baixa_eventos_select" on public.pagamentos_baixa_eventos;
create policy "pagamentos_baixa_eventos_select"
  on public.pagamentos_baixa_eventos for select to authenticated
  using (public.tem_permissao_especial('visualizar_baixas'));

grant select on public.pagamentos_baixas, public.pagamentos_baixa_eventos to authenticated;

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
      when p_acao = 'visualizar_baixas' then coalesce(pg.pode_visualizar,false)
      when p_acao in ('registrar_baixa','registrar_baixa_avulsa') then coalesce(pg.pode_cadastrar,false)
      when p_acao = 'editar_baixa' then coalesce(pg.pode_editar,false)
      when p_acao = 'estornar_baixa' then coalesce(pg.pode_excluir,false)
      else false end permitido
    from eu
    left join public.permissoes_efetivas p on p.usuario_id=eu.usuario_id and p.modulo='fornecedores'
    left join public.permissoes_efetivas pg on pg.usuario_id=eu.usuario_id and pg.modulo='pagamentos'
  )
  select coalesce((select permitido from explicita), (select permitido from base), false)
$$;

drop function if exists public.recalcular_situacao_pagamento_baixa(text);

create or replace function public.recalcular_situacao_pagamento_baixa(p_pagamento_id integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pagamento public.pagamentos%rowtype;
  v_total numeric(14,2);
  v_baixado numeric(14,2);
  v_aberto numeric(14,2);
  v_situacao text;
begin
  select * into v_pagamento from public.pagamentos where id = p_pagamento_id for update;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'pagamento_nao_encontrado'); end if;

  v_total := round(coalesce(v_pagamento.valor_a_pagar, 0)::numeric, 2);
  select round(coalesce(sum(valor_pago), 0)::numeric, 2)
    into v_baixado
    from public.pagamentos_baixas
   where pagamento_id = p_pagamento_id and status = 'efetivada';
  v_aberto := greatest(0, v_total - v_baixado);
  v_situacao := case when v_baixado <= 0 then 'em_aberto' when v_aberto > 0 then 'parcialmente_pago' else 'pago' end;

  update public.pagamentos set situacao = v_situacao where id = p_pagamento_id;
  if v_pagamento.valor_em_aberto_id is not null then
    update public.valores_em_aberto
       set valor_pago = v_baixado,
           situacao = v_situacao
     where id::text = v_pagamento.valor_em_aberto_id::text;
  end if;

  return jsonb_build_object('ok', true, 'valor_total', v_total, 'total_baixado', v_baixado, 'saldo_em_aberto', v_aberto, 'situacao', v_situacao);
end;
$$;

drop function if exists public.registrar_baixa_pagamento(text,text,numeric,date,integer,text,text,text);

create or replace function public.registrar_baixa_pagamento(
  p_chave_idempotencia text,
  p_fornecedor_id integer,
  p_valor numeric,
  p_data_pagamento date,
  p_conta_id integer,
  p_pagamento_id integer default null,
  p_documento text default null,
  p_observacao text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_usuario uuid;
  v_existente public.pagamentos_baixas%rowtype;
  v_pagamento public.pagamentos%rowtype;
  v_baixa public.pagamentos_baixas%rowtype;
  v_total numeric(14,2);
  v_baixado numeric(14,2);
  v_aberto numeric(14,2);
  v_saldo numeric(14,2);
  v_data_saldo date;
  v_data_lancamento date;
  v_resumo jsonb;
begin
  v_usuario := public.meu_usuario_ativo_id();
  if v_usuario is null then raise exception 'Usuário ativo não identificado.' using errcode='42501'; end if;
  if not public.tem_permissao_especial('registrar_baixa') then raise exception 'Sem permissão para registrar baixa.' using errcode='42501'; end if;
  if p_pagamento_id is null and not public.tem_permissao_especial('registrar_baixa_avulsa') then raise exception 'Sem permissão para registrar baixa avulsa.' using errcode='42501'; end if;
  if nullif(trim(p_chave_idempotencia), '') is null then raise exception 'Chave de idempotência obrigatória.'; end if;
  if p_fornecedor_id is null then raise exception 'Fornecedor obrigatório.'; end if;
  if coalesce(p_valor, 0) <= 0 then raise exception 'O valor da baixa deve ser maior que zero.'; end if;
  if p_data_pagamento is null then raise exception 'Data do pagamento obrigatória.'; end if;
  if p_data_pagamento > current_date then raise exception 'A data do pagamento não pode ser futura.'; end if;
  if p_conta_id is null then raise exception 'Conta bancária obrigatória.'; end if;
  if not exists(select 1 from public.fornecedores where id=p_fornecedor_id and coalesce(ativo,true)=true) then raise exception 'Fornecedor não encontrado.'; end if;
  if not exists(select 1 from public.contas_bancarias where id=p_conta_id and coalesce(ativo,true)=true) then raise exception 'Conta bancária não encontrada.'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_chave_idempotencia,0));
  select * into v_existente from public.pagamentos_baixas where chave_idempotencia=p_chave_idempotencia;
  if found then
    return jsonb_build_object('ok',true,'ja_processada',true,'baixa_id',v_existente.id,'status',v_existente.status);
  end if;

  if p_pagamento_id is not null then
    select * into v_pagamento from public.pagamentos where id=p_pagamento_id for update;
    if not found then raise exception 'Pagamento programado não encontrado.' using errcode='P0002'; end if;
    if v_pagamento.fornecedor_id is distinct from p_fornecedor_id then raise exception 'O fornecedor não corresponde ao pagamento programado.'; end if;
    v_total := round(coalesce(v_pagamento.valor_a_pagar,0)::numeric,2);
    select round(coalesce(sum(valor_pago),0)::numeric,2) into v_baixado from public.pagamentos_baixas where pagamento_id=p_pagamento_id and status='efetivada';
    v_aberto := greatest(0,v_total-v_baixado);
    if round(p_valor::numeric,2) > v_aberto then raise exception 'O valor informado supera o saldo em aberto disponível de R$ %.', replace(to_char(v_aberto,'FM999G999G990D00'),'.',','); end if;
  else
    v_total := round(p_valor::numeric,2);
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_conta_id::text,0));
  select coalesce(valor_saldo,0),data_saldo into v_saldo,v_data_saldo from public.saldos_historico where conta_id=p_conta_id order by data_saldo desc limit 1;
  if not found then v_saldo:=0; v_data_saldo:=p_data_pagamento; end if;
  v_data_lancamento:=greatest(p_data_pagamento,coalesce(v_data_saldo,p_data_pagamento));

  insert into public.pagamentos_baixas(chave_idempotencia,fornecedor_id,pagamento_id,valor_total_referencia,valor_pago,data_pagamento,conta_id,documento,observacao,status,saldo_antes,saldo_depois,usuario_id)
  values(p_chave_idempotencia,p_fornecedor_id,p_pagamento_id,v_total,round(p_valor::numeric,2),p_data_pagamento,p_conta_id,nullif(trim(p_documento),''),nullif(trim(p_observacao),''),'efetivada',v_saldo,v_saldo-round(p_valor::numeric,2),v_usuario)
  returning * into v_baixa;

  insert into public.saldos_historico(conta_id,valor_saldo,data_saldo) values(p_conta_id,v_baixa.saldo_depois,v_data_lancamento)
  on conflict(conta_id,data_saldo) do update set valor_saldo=excluded.valor_saldo;
  insert into public.pagamentos_baixa_eventos(baixa_id,tipo,valor_movimento,conta_id,saldo_antes,saldo_depois,usuario_id,motivo)
  values(v_baixa.id,'baixa',-v_baixa.valor_pago,p_conta_id,v_baixa.saldo_antes,v_baixa.saldo_depois,v_usuario,p_observacao);

  if p_pagamento_id is not null then v_resumo:=public.recalcular_situacao_pagamento_baixa(p_pagamento_id);
  else v_resumo:=jsonb_build_object('valor_total',v_total,'total_baixado',v_baixa.valor_pago,'saldo_em_aberto',0,'situacao','pago'); end if;

  insert into public.auditoria_eventos(usuario_id,modulo,acao,registro_afetado,valor_anterior,valor_novo,nivel)
  values(v_usuario,'pagamentos','registrou_baixa','Baixa de pagamento a fornecedor',jsonb_build_object('saldo_conta',v_baixa.saldo_antes),jsonb_build_object('baixa_id',v_baixa.id,'fornecedor_id',p_fornecedor_id,'pagamento_id',p_pagamento_id,'valor',v_baixa.valor_pago,'data_pagamento',p_data_pagamento,'conta_id',p_conta_id,'saldo_conta',v_baixa.saldo_depois),'critico');

  return jsonb_build_object('ok',true,'ja_processada',false,'baixa_id',v_baixa.id,'saldo_antes',v_baixa.saldo_antes,'saldo_depois',v_baixa.saldo_depois,'resumo_pagamento',v_resumo);
end;
$$;

create or replace function public.estornar_baixa_pagamento(p_baixa_id uuid,p_motivo text,p_chave_idempotencia text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_usuario uuid; v_baixa public.pagamentos_baixas%rowtype; v_saldo numeric(14,2); v_data date; v_lancamento date; v_resumo jsonb;
begin
  v_usuario:=public.meu_usuario_ativo_id();
  if not public.tem_permissao_especial('estornar_baixa') then raise exception 'Sem permissão para estornar baixa.' using errcode='42501'; end if;
  if nullif(trim(p_motivo),'') is null then raise exception 'O motivo do estorno é obrigatório.'; end if;
  if nullif(trim(p_chave_idempotencia),'') is null then raise exception 'Chave de idempotência obrigatória.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_chave_idempotencia,0));
  select * into v_baixa from public.pagamentos_baixas where id=p_baixa_id for update;
  if not found then raise exception 'Baixa não encontrada.' using errcode='P0002'; end if;
  if v_baixa.status='estornada' then return jsonb_build_object('ok',true,'ja_processada',true,'baixa_id',v_baixa.id); end if;
  if exists(select 1 from public.pagamentos_baixas where chave_estorno=p_chave_idempotencia) then return jsonb_build_object('ok',true,'ja_processada',true,'baixa_id',v_baixa.id); end if;

  perform pg_advisory_xact_lock(hashtextextended(v_baixa.conta_id::text,0));
  select coalesce(valor_saldo,0),data_saldo into v_saldo,v_data from public.saldos_historico where conta_id=v_baixa.conta_id order by data_saldo desc limit 1;
  if not found then v_saldo:=0; v_data:=current_date; end if;
  v_lancamento:=greatest(current_date,coalesce(v_data,current_date));
  insert into public.saldos_historico(conta_id,valor_saldo,data_saldo) values(v_baixa.conta_id,v_saldo+v_baixa.valor_pago,v_lancamento)
  on conflict(conta_id,data_saldo) do update set valor_saldo=excluded.valor_saldo;
  update public.pagamentos_baixas set status='estornada',estornada_em=now(),estornada_por=v_usuario,motivo_estorno=trim(p_motivo),chave_estorno=p_chave_idempotencia where id=v_baixa.id;
  insert into public.pagamentos_baixa_eventos(baixa_id,tipo,valor_movimento,conta_id,saldo_antes,saldo_depois,usuario_id,motivo)
  values(v_baixa.id,'estorno',v_baixa.valor_pago,v_baixa.conta_id,v_saldo,v_saldo+v_baixa.valor_pago,v_usuario,trim(p_motivo));
  if v_baixa.pagamento_id is not null then v_resumo:=public.recalcular_situacao_pagamento_baixa(v_baixa.pagamento_id); end if;
  insert into public.auditoria_eventos(usuario_id,modulo,acao,registro_afetado,valor_anterior,valor_novo,nivel)
  values(v_usuario,'pagamentos','estornou_baixa','Estorno de baixa de pagamento',jsonb_build_object('baixa_id',v_baixa.id,'saldo_conta',v_saldo),jsonb_build_object('motivo',trim(p_motivo),'saldo_conta',v_saldo+v_baixa.valor_pago),'critico');
  return jsonb_build_object('ok',true,'ja_processada',false,'baixa_id',v_baixa.id,'saldo_antes',v_saldo,'saldo_depois',v_saldo+v_baixa.valor_pago,'resumo_pagamento',v_resumo);
end;
$$;

create or replace function public.editar_baixa_pagamento(p_baixa_id uuid,p_documento text,p_observacao text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_usuario uuid; v_baixa public.pagamentos_baixas%rowtype;
begin
  v_usuario:=public.meu_usuario_ativo_id();
  if not public.tem_permissao_especial('editar_baixa') then raise exception 'Sem permissão para editar baixa.' using errcode='42501'; end if;
  select * into v_baixa from public.pagamentos_baixas where id=p_baixa_id for update;
  if not found then raise exception 'Baixa não encontrada.' using errcode='P0002'; end if;
  update public.pagamentos_baixas set documento=nullif(trim(p_documento),''),observacao=nullif(trim(p_observacao),'') where id=p_baixa_id;
  insert into public.pagamentos_baixa_eventos(baixa_id,tipo,valor_movimento,conta_id,saldo_antes,saldo_depois,usuario_id,motivo)
  values(v_baixa.id,'edicao',0,v_baixa.conta_id,v_baixa.saldo_depois,v_baixa.saldo_depois,v_usuario,'Edição de documento/observação');
  insert into public.auditoria_eventos(usuario_id,modulo,acao,registro_afetado,valor_anterior,valor_novo,nivel)
  values(v_usuario,'pagamentos','editou_baixa','Edição de baixa de pagamento',jsonb_build_object('documento',v_baixa.documento,'observacao',v_baixa.observacao),jsonb_build_object('documento',nullif(trim(p_documento),''),'observacao',nullif(trim(p_observacao),'')),'atencao');
  return jsonb_build_object('ok',true,'baixa_id',p_baixa_id);
end;
$$;

revoke all on function public.recalcular_situacao_pagamento_baixa(integer) from public;
revoke all on function public.registrar_baixa_pagamento(text,integer,numeric,date,integer,integer,text,text) from public;
revoke all on function public.estornar_baixa_pagamento(uuid,text,text) from public;
revoke all on function public.editar_baixa_pagamento(uuid,text,text) from public;
grant execute on function public.registrar_baixa_pagamento(text,integer,numeric,date,integer,integer,text,text) to authenticated;
grant execute on function public.estornar_baixa_pagamento(uuid,text,text) to authenticated;
grant execute on function public.editar_baixa_pagamento(uuid,text,text) to authenticated;

-- O fluxo antigo debitava integralmente sem registrar baixa parcial/rastreável.
-- Ele deixa de ser público para que toda saída passe pela operação correta.
revoke all on function public.marcar_pagamento_pago(integer) from public;
revoke execute on function public.marcar_pagamento_pago(integer) from authenticated;

-- -----------------------------------------------------------------------------
-- Efeito consolidado de 20260825180000_corrigir_tipo_conta_pagamento_integer.sql
-- -----------------------------------------------------------------------------

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
drop function if exists public.definir_conta_pagamento_programacao(integer, uuid);

create or replace function public.definir_conta_pagamento_programacao(
  p_programacao_id integer,
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

revoke all on function public.definir_conta_pagamento_programacao(integer, integer) from public;
grant execute on function public.definir_conta_pagamento_programacao(integer, integer) to authenticated;

-- -----------------------------------------------------------------------------
-- Efeito consolidado de 20260826120000_fluxo_real_pagamentos_diarios.sql
-- -----------------------------------------------------------------------------

-- Pagamentos Diários: a conta de saída passa a ser definida por pagamento.
-- A coluna legada programacoes_pagamento.conta_pagamento_id é preservada sem uso.

alter table public.pagamentos
  add column if not exists conta_origem_id integer references public.contas_bancarias(id);

alter table public.programacoes_pagamento
  add column if not exists ultima_impressao_em timestamptz;

create index if not exists pagamentos_conta_origem_idx
  on public.pagamentos (conta_origem_id);

drop function if exists public.definir_conta_origem_pagamento(text, integer);

create or replace function public.definir_conta_origem_pagamento(
  p_pagamento_id integer,
  p_conta_id integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_pagamento public.pagamentos%rowtype;
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
    raise exception 'Sem permissão para editar pagamentos.' using errcode = '42501';
  end if;

  select *
    into v_pagamento
    from public.pagamentos
   where id = p_pagamento_id
   for update;

  if not found then
    raise exception 'Pagamento não encontrado.' using errcode = 'P0002';
  end if;

  select *
    into v_programacao
    from public.programacoes_pagamento
   where id = v_pagamento.programacao_id
   for update;

  if coalesce(v_programacao.fechado, false) then
    raise exception 'A programação está fechada e não pode ser alterada.';
  end if;

  if coalesce(v_pagamento.situacao, '') = 'pago' then
    raise exception 'A conta de um pagamento já efetivado não pode ser alterada.';
  end if;

  select *
    into v_conta
    from public.contas_bancarias
   where id = p_conta_id
     and coalesce(ativo, true) = true;

  if not found then
    raise exception 'Conta bancária ativa não encontrada.' using errcode = 'P0002';
  end if;

  if v_conta.secretaria_id is distinct from v_programacao.secretaria_id then
    raise exception 'Pagamentos só podem usar contas da secretaria da programação.';
  end if;

  if not exists (
    select 1
      from public.programacao_contas pc
     where pc.programacao_id = v_programacao.id
       and pc.conta_id = p_conta_id
  ) then
    raise exception 'A conta de origem precisa estar selecionada como conta de trabalho.';
  end if;

  update public.pagamentos
     set conta_origem_id = p_conta_id
   where id = p_pagamento_id;

  insert into public.auditoria_eventos(
    usuario_id, modulo, acao, registro_afetado,
    valor_anterior, valor_novo, nivel
  ) values (
    v_usuario, 'pagamentos', 'alterou',
    'Conta de origem do pagamento ' || p_pagamento_id::text,
    jsonb_build_object('conta_origem_id', v_pagamento.conta_origem_id),
    jsonb_build_object('conta_origem_id', p_conta_id),
    'informacao'
  );

  return jsonb_build_object(
    'ok', true,
    'pagamento_id', p_pagamento_id,
    'conta_origem_id', p_conta_id
  );
end;
$$;

revoke all on function public.definir_conta_origem_pagamento(integer, integer) from public;
grant execute on function public.definir_conta_origem_pagamento(integer, integer) to authenticated;

drop function if exists public.registrar_impressao_programacao(uuid);

create or replace function public.registrar_impressao_programacao(p_programacao_id integer)
returns jsonb
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_usuario uuid;
  v_programacao public.programacoes_pagamento%rowtype;
begin
  v_usuario := public.meu_usuario_ativo_id();

  select * into v_programacao
    from public.programacoes_pagamento
   where id = p_programacao_id;

  if not found then
    raise exception 'Programação de pagamento não encontrada.' using errcode = 'P0002';
  end if;

  update public.programacoes_pagamento
     set ultima_impressao_em = now()
   where id = p_programacao_id;

  insert into public.auditoria_eventos(
    usuario_id, modulo, acao, registro_afetado, valor_novo, nivel
  ) values (
    v_usuario, 'pagamentos', 'imprimiu_relacao',
    'Relação de pagamentos ' || p_programacao_id::text,
    jsonb_build_object('programacao_id', p_programacao_id, 'data_programacao', v_programacao.data_programacao),
    'informacao'
  );

  return jsonb_build_object('ok', true, 'programacao_id', p_programacao_id);
end;
$$;

revoke all on function public.registrar_impressao_programacao(integer) from public;
grant execute on function public.registrar_impressao_programacao(integer) to authenticated;

drop function if exists public.confirmar_transferencias_programacao(uuid, uuid, jsonb, text, text);
drop function if exists public.confirmar_transferencias_programacao(uuid, integer, jsonb, text, text);
drop function if exists public.confirmar_transferencias_programacao(integer, uuid, jsonb, text, text);

create or replace function public.confirmar_transferencias_programacao(
  p_programacao_id integer,
  p_conta_destino_id integer,
  p_transferencias jsonb,
  p_chave_idempotencia text,
  p_observacao text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_programacao public.programacoes_pagamento%rowtype;
  v_lote public.transferencia_lotes%rowtype;
  v_item jsonb;
  v_origem integer;
  v_valor numeric(14,2);
  v_saldo_origem numeric(14,2);
  v_saldo_destino numeric(14,2);
  v_data_origem date;
  v_data_destino date;
  v_data_movimento date;
  v_transferencia_id uuid;
  v_usuario uuid := public.meu_usuario_ativo_id();
  v_ids jsonb := '[]'::jsonb;
  v_secretaria_programacao text;
  v_secretaria_destino_id public.secretarias.id%type;
  v_secretaria_destino text;
begin
  if not public.tem_permissao_especial('executar_transferencia') then
    raise exception 'Sem permissão para executar transferência.' using errcode = '42501';
  end if;
  if coalesce(trim(p_chave_idempotencia), '') = '' then
    raise exception 'Chave de idempotência obrigatória.';
  end if;

  select * into v_lote
    from public.transferencia_lotes
   where chave_idempotencia = p_chave_idempotencia;
  if found then
    return coalesce(v_lote.resultado, jsonb_build_object('ok', true, 'ja_confirmado', true, 'lote_id', v_lote.id));
  end if;

  select pp, s.nome
    into v_programacao, v_secretaria_programacao
    from public.programacoes_pagamento pp
    join public.secretarias s on s.id = pp.secretaria_id
   where pp.id = p_programacao_id
   for update of pp;
  if not found then raise exception 'Programação não encontrada.'; end if;
  if jsonb_typeof(p_transferencias) <> 'array' or jsonb_array_length(p_transferencias) = 0 then
    raise exception 'Informe ao menos uma transferência.';
  end if;

  select cb.secretaria_id, s.nome
    into v_secretaria_destino_id, v_secretaria_destino
    from public.contas_bancarias cb
    join public.secretarias s on s.id = cb.secretaria_id
   where cb.id = p_conta_destino_id
     and coalesce(cb.ativo, true) = true;
  if not found then raise exception 'Conta de destino ativa não encontrada.'; end if;

  if v_secretaria_destino_id is distinct from v_programacao.secretaria_id
     and not (
       lower(v_secretaria_programacao) like '%finan%'
       and (
         lower(v_secretaria_destino) like '%saúde%'
         or lower(v_secretaria_destino) like '%saude%'
         or lower(v_secretaria_destino) like '%educa%'
         or lower(v_secretaria_destino) like '%social%'
       )
     ) then
    raise exception 'Transferência entre secretarias permitida somente de Finanças para Saúde, Educação ou Social.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(q.conta_id, 0))
    from (
      select p_conta_destino_id::text conta_id
      union
      select i->>'conta_origem_id' from jsonb_array_elements(p_transferencias) i
      order by conta_id
    ) q;

  insert into public.transferencia_lotes(chave_idempotencia, programacao_id, conta_destino_id, usuario_id)
  values(p_chave_idempotencia, p_programacao_id, p_conta_destino_id, v_usuario)
  returning * into v_lote;

  select coalesce(valor_saldo, 0), data_saldo
    into v_saldo_destino, v_data_destino
    from public.saldos_historico
   where conta_id = p_conta_destino_id
   order by data_saldo desc limit 1;
  if not found then
    v_saldo_destino := 0;
    v_data_destino := v_programacao.data_programacao;
  end if;

  for v_item in select * from jsonb_array_elements(p_transferencias) loop
    v_origem := (v_item->>'conta_origem_id')::integer;
    v_valor := round((v_item->>'valor')::numeric, 2);
    if v_origem = p_conta_destino_id then raise exception 'A conta de origem não pode ser a conta de destino.'; end if;
    if v_valor <= 0 then raise exception 'Valor de transferência inválido.'; end if;
    if not exists (
      select 1
        from public.programacao_contas pc
        join public.contas_bancarias cb on cb.id = pc.conta_id
       where pc.programacao_id = p_programacao_id
         and pc.conta_id = v_origem
         and cb.secretaria_id = v_programacao.secretaria_id
    ) then
      raise exception 'A conta de origem deve estar selecionada e pertencer à secretaria da programação.';
    end if;

    select coalesce(valor_saldo, 0), data_saldo
      into v_saldo_origem, v_data_origem
      from public.saldos_historico
     where conta_id = v_origem
     order by data_saldo desc limit 1;
    if not found then
      v_saldo_origem := 0;
      v_data_origem := v_programacao.data_programacao;
    end if;
    if v_valor > v_saldo_origem then raise exception 'Saldo insuficiente na conta de origem.'; end if;

    v_data_movimento := greatest(v_programacao.data_programacao, coalesce(v_data_origem, v_programacao.data_programacao), coalesce(v_data_destino, v_programacao.data_programacao));
    insert into public.transferencias_contas(
      lote_id, programacao_id, conta_origem_id, conta_destino_id, valor,
      saldo_origem_antes, saldo_origem_depois, saldo_destino_antes,
      saldo_destino_depois, usuario_id, observacao
    ) values (
      v_lote.id, p_programacao_id, v_origem, p_conta_destino_id, v_valor,
      v_saldo_origem, v_saldo_origem - v_valor, v_saldo_destino,
      v_saldo_destino + v_valor, v_usuario, p_observacao
    ) returning id into v_transferencia_id;

    insert into public.saldos_historico(conta_id, valor_saldo, data_saldo)
    values(v_origem, v_saldo_origem - v_valor, v_data_movimento)
    on conflict(conta_id, data_saldo) do update set valor_saldo = excluded.valor_saldo;

    v_saldo_destino := v_saldo_destino + v_valor;
    insert into public.saldos_historico(conta_id, valor_saldo, data_saldo)
    values(p_conta_destino_id, v_saldo_destino, v_data_movimento)
    on conflict(conta_id, data_saldo) do update set valor_saldo = excluded.valor_saldo;

    insert into public.auditoria_eventos(usuario_id, modulo, acao, registro_afetado, valor_anterior, valor_novo, nivel)
    values(
      v_usuario, 'pagamentos', 'transferiu', 'Transferência entre contas',
      jsonb_build_object('conta_origem_id', v_origem, 'saldo_origem', v_saldo_origem, 'conta_destino_id', p_conta_destino_id, 'saldo_destino', v_saldo_destino - v_valor),
      jsonb_build_object('transferencia_id', v_transferencia_id, 'valor', v_valor, 'saldo_origem', v_saldo_origem - v_valor, 'saldo_destino', v_saldo_destino),
      'critico'
    );
    v_ids := v_ids || to_jsonb(v_transferencia_id);
  end loop;

  update public.programacao_contas
     set valor_transferir = 0
   where programacao_id = p_programacao_id;

  update public.transferencia_lotes
     set status = 'confirmado', resultado = jsonb_build_object('ok', true, 'lote_id', v_lote.id, 'transferencias', v_ids)
   where id = v_lote.id
   returning * into v_lote;

  return v_lote.resultado;
exception when others then
  if v_lote.id is not null then
    update public.transferencia_lotes set status = 'falhou', resultado = jsonb_build_object('ok', false, 'erro', sqlerrm) where id = v_lote.id;
  end if;
  raise;
end;
$$;

revoke all on function public.confirmar_transferencias_programacao(integer, integer, jsonb, text, text) from public;
grant execute on function public.confirmar_transferencias_programacao(integer, integer, jsonb, text, text) to authenticated;

commit;
