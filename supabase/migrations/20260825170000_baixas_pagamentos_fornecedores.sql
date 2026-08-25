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
  fornecedor_id text not null,
  pagamento_id text,
  valor_total_referencia numeric(14,2) not null,
  valor_pago numeric(14,2) not null check (valor_pago > 0),
  data_pagamento date not null,
  conta_id uuid not null references public.contas_bancarias(id),
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
  conta_id uuid not null references public.contas_bancarias(id),
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
  'legado:'||pm.id::text,p.fornecedor_id::text,p.id::text,
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

create or replace function public.recalcular_situacao_pagamento_baixa(p_pagamento_id text)
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
  select * into v_pagamento from public.pagamentos where id::text = p_pagamento_id for update;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'pagamento_nao_encontrado'); end if;

  v_total := round(coalesce(v_pagamento.valor_a_pagar, 0)::numeric, 2);
  select round(coalesce(sum(valor_pago), 0)::numeric, 2)
    into v_baixado
    from public.pagamentos_baixas
   where pagamento_id = p_pagamento_id and status = 'efetivada';
  v_aberto := greatest(0, v_total - v_baixado);
  v_situacao := case when v_baixado <= 0 then 'em_aberto' when v_aberto > 0 then 'parcialmente_pago' else 'pago' end;

  update public.pagamentos set situacao = v_situacao where id::text = p_pagamento_id;
  if v_pagamento.valor_em_aberto_id is not null then
    update public.valores_em_aberto
       set valor_pago = v_baixado,
           situacao = v_situacao
     where id::text = v_pagamento.valor_em_aberto_id::text;
  end if;

  return jsonb_build_object('ok', true, 'valor_total', v_total, 'total_baixado', v_baixado, 'saldo_em_aberto', v_aberto, 'situacao', v_situacao);
end;
$$;

create or replace function public.registrar_baixa_pagamento(
  p_chave_idempotencia text,
  p_fornecedor_id text,
  p_valor numeric,
  p_data_pagamento date,
  p_conta_id uuid,
  p_pagamento_id text default null,
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
  if nullif(trim(p_fornecedor_id), '') is null then raise exception 'Fornecedor obrigatório.'; end if;
  if coalesce(p_valor, 0) <= 0 then raise exception 'O valor da baixa deve ser maior que zero.'; end if;
  if p_data_pagamento is null then raise exception 'Data do pagamento obrigatória.'; end if;
  if p_data_pagamento > current_date then raise exception 'A data do pagamento não pode ser futura.'; end if;
  if p_conta_id is null then raise exception 'Conta bancária obrigatória.'; end if;
  if not exists(select 1 from public.fornecedores where id::text=p_fornecedor_id and coalesce(ativo,true)=true) then raise exception 'Fornecedor não encontrado.'; end if;
  if not exists(select 1 from public.contas_bancarias where id=p_conta_id and coalesce(ativo,true)=true) then raise exception 'Conta bancária não encontrada.'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_chave_idempotencia,0));
  select * into v_existente from public.pagamentos_baixas where chave_idempotencia=p_chave_idempotencia;
  if found then
    return jsonb_build_object('ok',true,'ja_processada',true,'baixa_id',v_existente.id,'status',v_existente.status);
  end if;

  if p_pagamento_id is not null then
    select * into v_pagamento from public.pagamentos where id::text=p_pagamento_id for update;
    if not found then raise exception 'Pagamento programado não encontrado.' using errcode='P0002'; end if;
    if v_pagamento.fornecedor_id::text is distinct from p_fornecedor_id then raise exception 'O fornecedor não corresponde ao pagamento programado.'; end if;
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

revoke all on function public.recalcular_situacao_pagamento_baixa(text) from public;
revoke all on function public.registrar_baixa_pagamento(text,text,numeric,date,uuid,text,text,text) from public;
revoke all on function public.estornar_baixa_pagamento(uuid,text,text) from public;
revoke all on function public.editar_baixa_pagamento(uuid,text,text) from public;
grant execute on function public.registrar_baixa_pagamento(text,text,numeric,date,uuid,text,text,text) to authenticated;
grant execute on function public.estornar_baixa_pagamento(uuid,text,text) to authenticated;
grant execute on function public.editar_baixa_pagamento(uuid,text,text) to authenticated;

-- O fluxo antigo debitava integralmente sem registrar baixa parcial/rastreável.
-- Ele deixa de ser público para que toda saída passe pela operação correta.
revoke all on function public.marcar_pagamento_pago(text) from public;
revoke execute on function public.marcar_pagamento_pago(text) from authenticated;
