-- FASE 2 — Pagamentos Diários: execução financeira.
--
-- ATENÇÃO: esta migration precisa ser rodada MANUALMENTE no SQL Editor do
-- Supabase (projeto usado pela aplicação). Nada nela roda sozinho no deploy.
--
-- O que ela entrega, reaproveitando o que já existe em produção:
--
--   1. programacoes_pagamento.aprovada_em / aprovada_por  -> registro de quem
--      aprovou e quando. APROVAR NÃO É PAGAR: nenhuma coluna de saldo é tocada.
--   2. pagamentos.conta_origem_id -> a conta definida POR PAGAMENTO. Definir a
--      conta NÃO debita nada; o débito só existirá na baixa (Fase 3).
--   3. public.transferencia_lotes / public.transferencias_contas -> a razão das
--      transferências entre contas próprias. Criadas apenas se ainda não
--      existirem; se existirem, são reaproveitadas e só ganham as colunas que
--      faltarem.
--   4. public.confirmar_transferencias_programacao -> transferência ATÔMICA e
--      IDEMPOTENTE de VÁRIAS origens para UM destino.
--   5. public.estornar_transferencia -> movimentação inversa, com motivo
--      obrigatório, preservando a transferência original.
--   6. public.definir_conta_origem_pagamento -> conta por pagamento, individual
--      ou em lote.
--   7. public.aprovar_programacao_pagamento -> aprovação sem movimentar saldo.
--   8. public.pode_em_pagamentos_fase2 -> as cinco permissões desta fase.
--
-- REGRAS QUE ESTA MIGRATION FAZ VALER NO BANCO:
--
--   * A ÚNICA operação desta fase que movimenta saldo é a transferência entre
--     contas confirmada (e o estorno dela). Aprovar, marcar em análise e
--     definir a conta de um pagamento não escrevem uma única linha de saldo.
--   * Transferência entre contas próprias NÃO É DESPESA: ela não escreve em
--     public.pagamento_movimentacoes nem em public.pagamentos_baixas, que são as
--     tabelas lidas pelos Relatórios. Origem debita, destino credita, o
--     patrimônio total fica igual.
--   * Transferência não se apaga: o estorno lança o movimento contrário e a
--     original continua na razão, no Histórico e na Auditoria.
--   * Segregação por secretaria: contas de secretarias diferentes não se
--     misturam, com uma única exceção — Finanças pode transferir para Saúde,
--     Educação e Assistência Social.
--
-- IDEMPOTENTE: pode rodar mais de uma vez sem efeito colateral. Aditiva: não
-- apaga nem altera nenhum dado existente.

begin;

-- ---------------------------------------------------------------------------
-- 0. Validação dos tipos reais ANTES de qualquer alteração de estrutura
-- ---------------------------------------------------------------------------
-- Se algo não bater, a migration aborta aqui, antes do primeiro DDL.
do $$
declare
  item record;
  tipo_real text;
begin
  for item in
    select * from (values
      ('contas_bancarias', 'id', 'integer'),
      ('contas_bancarias', 'secretaria_id', 'integer'),
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
    ) as tipos(tabela, coluna, esperado)
  loop
    if to_regclass(format('public.%I', item.tabela)) is null then
      raise exception 'Estrutura incompatível: public.% não existe.', item.tabela;
    end if;

    select format_type(a.atttypid, a.atttypmod)
      into tipo_real
      from pg_attribute a
     where a.attrelid = to_regclass(format('public.%I', item.tabela))
       and a.attname::text = item.coluna
       and not a.attisdropped;

    if tipo_real is distinct from item.esperado then
      raise exception 'Tipo incompatível em public.%.%: esperado %, encontrado %.',
        item.tabela, item.coluna, item.esperado, coalesce(tipo_real, 'coluna ausente');
    end if;
  end loop;
end $$;

-- A coluna pagamentos.conta_origem_id pode já existir em produção. Se existir
-- com outro tipo, a Fase 2 não funciona: aborta antes de qualquer DDL.
do $$
declare
  tipo_real text;
begin
  select format_type(a.atttypid, a.atttypmod)
    into tipo_real
    from pg_attribute a
   where a.attrelid = to_regclass('public.pagamentos')
     and a.attname::text = 'conta_origem_id'
     and not a.attisdropped;

  if tipo_real is not null and tipo_real <> 'integer' then
    raise exception 'Tipo incompatível em public.pagamentos.conta_origem_id: esperado integer, encontrado %.', tipo_real;
  end if;
end $$;

-- saldos_historico tem de aceitar uma linha por conta e por data (é o upsert que
-- a transferência usa para gravar o saldo novo sem duplicar o dia).
do $$
declare
  tem_unico boolean;
begin
  select exists (
    select 1
      from pg_index ix
      join pg_class ic on ic.oid = ix.indexrelid
     where ix.indrelid = to_regclass('public.saldos_historico')
       and ix.indisunique
       -- Só um índice válido, total e sobre colunas simples serve de árbitro
       -- para o `on conflict (conta_id, data_saldo)` que a transferência usa.
       and ix.indisvalid
       and ix.indpred is null
       and ix.indexprs is null
       -- attname é `name`; sem o ::text a comparação viraria name[] = text[],
       -- para a qual o Postgres não tem operador (erro 42883).
       and (
         select array_agg(a.attname::text order by a.attname::text)
           from pg_attribute a
          where a.attrelid = ix.indrelid
            and a.attnum = any (ix.indkey)
            and not a.attisdropped
       ) = array['conta_id', 'data_saldo']::text[]
  ) into tem_unico;

  if not tem_unico then
    raise exception 'Estrutura incompatível: public.saldos_historico não tem índice único em (conta_id, data_saldo). A transferência depende dele para não duplicar o saldo do dia.';
  end if;
end $$;

-- As tabelas da razão de transferências já existem em produção. Se alguma tiver
-- coluna obrigatória (not null, sem default) que esta fase não sabe preencher,
-- aborta antes do DDL em vez de gravar transferência pela metade.
do $$
declare
  conhecidas text[] := array[
    'id', 'chave_idempotencia', 'programacao_id', 'conta_destino_id', 'valor_total',
    'quantidade_origens', 'observacao', 'usuario_id', 'criado_em', 'status',
    'estorno_de_lote_id', 'motivo_estorno', 'estornado_em', 'estornado_por',
    'lote_id', 'conta_origem_id', 'valor', 'saldo_origem_antes', 'saldo_origem_depois',
    'saldo_destino_antes', 'saldo_destino_depois', 'data_movimento',
    'estorno_de_transferencia_id', 'estornada_em', 'estornada_por',
    'secretaria_origem_id', 'secretaria_destino_id'
  ];
  tabela text;
  obrigatoria text;
begin
  foreach tabela in array array['transferencia_lotes', 'transferencias_contas'] loop
    if to_regclass(format('public.%I', tabela)) is null then
      continue;
    end if;

    select string_agg(a.attname::text, ', ' order by a.attname::text)
      into obrigatoria
      from pg_attribute a
     where a.attrelid = to_regclass(format('public.%I', tabela))
       and a.attnum > 0
       and not a.attisdropped
       and a.attnotnull
       and not exists (
         select 1 from pg_attrdef d where d.adrelid = a.attrelid and d.adnum = a.attnum
       )
       and not (a.attname::text = any (conhecidas));

    if obrigatoria is not null then
      raise exception 'public.% tem coluna obrigatória que a Fase 2 não sabe preencher: %. Ajuste a coluna (default ou nulo permitido) e rode a migration de novo.', tabela, obrigatoria;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Auxiliares
-- ---------------------------------------------------------------------------

-- Id que vai na trilha de auditoria: o registro em public.usuarios da sessão,
-- com auth.uid() como último recurso (é o que a Fase 1 já grava).
create or replace function public.usuario_auditoria_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select u.id from public.usuarios u where u.auth_id = auth.uid() limit 1),
    auth.uid()
  );
$$;

grant execute on function public.usuario_auditoria_id() to authenticated;

-- Nome de secretaria sem acento e em minúsculas, para a regra de segregação não
-- depender de como o nome foi digitado no cadastro.
create or replace function public.nome_secretaria_normalizado(p_nome text)
returns text
language sql
immutable
as $$
  select lower(translate(
    coalesce(p_nome, ''),
    'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç',
    'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc'
  ));
$$;

grant execute on function public.nome_secretaria_normalizado(text) to authenticated;

-- Transferência entre secretarias DIFERENTES é permitida?
--
-- Regra do sistema: não. A única exceção legítima é a Secretaria de Finanças,
-- que pode transferir para contas da Saúde, da Educação e da Assistência
-- Social. Qualquer outro par de secretarias diferentes é bloqueado.
create or replace function public.transferencia_entre_secretarias_permitida(
  p_secretaria_origem text,
  p_secretaria_destino text
)
returns boolean
language sql
immutable
as $$
  select public.nome_secretaria_normalizado(p_secretaria_origem) like '%financ%'
     and (
       public.nome_secretaria_normalizado(p_secretaria_destino) like '%saude%'
       or public.nome_secretaria_normalizado(p_secretaria_destino) like '%educac%'
       or public.nome_secretaria_normalizado(p_secretaria_destino) like '%assist%'
     );
$$;

grant execute on function public.transferencia_entre_secretarias_permitida(text, text) to authenticated;

-- As cinco permissões desta fase.
--
-- Ordem de decisão: exceção individual gravada em public.permissoes_especiais
-- manda; sem exceção, vale a permissão do módulo 'pagamentos'. É a mesma
-- correspondência que a matriz de permissões já mostra na tela, então nenhum
-- usuário perde acesso por causa desta migration.
create or replace function public.pode_em_pagamentos_fase2(p_acao text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_usuario uuid;
  v_explicito boolean;
  v_modulo text;
begin
  select u.id into v_usuario
    from public.usuarios u
   where u.auth_id = auth.uid()
     and u.status = 'ativo'
   limit 1;

  if v_usuario is null then
    return false;
  end if;

  if to_regclass('public.permissoes_especiais') is not null then
    begin
      execute 'select pe.permitido from public.permissoes_especiais pe where pe.usuario_id = $1 and pe.acao = $2 limit 1'
        into v_explicito
        using v_usuario, p_acao;
      if v_explicito is not null then
        return v_explicito;
      end if;
    exception when others then
      v_explicito := null; -- estrutura diferente: cai no padrão do módulo
    end;
  end if;

  v_modulo := case p_acao
    when 'aprovar_programacao'    then 'pode_aprovar'
    when 'executar_programacao'   then 'pode_aprovar'
    when 'executar_transferencia' then 'pode_aprovar'
    when 'definir_conta_pagamento' then 'pode_editar'
    when 'estornar_transferencia' then 'pode_excluir'
    else null
  end;

  if v_modulo is null then
    return false;
  end if;

  return exists (
    select 1
      from public.permissoes_efetivas pe
     where pe.usuario_id = v_usuario
       and pe.modulo = 'pagamentos'
       and case v_modulo
             when 'pode_aprovar' then pe.pode_aprovar
             when 'pode_editar'  then pe.pode_editar
             when 'pode_excluir' then pe.pode_excluir
             else false
           end
  );
end $$;

grant execute on function public.pode_em_pagamentos_fase2(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Colunas da aprovação e da conta por pagamento
-- ---------------------------------------------------------------------------
alter table public.programacoes_pagamento
  add column if not exists aprovada_em timestamptz,
  add column if not exists aprovada_por uuid;

alter table public.pagamentos
  add column if not exists conta_origem_id integer;

create index if not exists pagamentos_conta_origem_idx
  on public.pagamentos (conta_origem_id)
  where conta_origem_id is not null;

-- Uma restrição antiga em `status` impediria a programação de chegar a
-- 'aprovada'. Nesse caso a restrição sai (nenhum dado é apagado) e fica o
-- aviso — a Fase 1 nunca criou restrição nessa coluna.
do $$
declare
  restricao record;
begin
  for restricao in
    select c.conname, pg_get_constraintdef(c.oid) as definicao
      from pg_constraint c
     where c.conrelid = to_regclass('public.programacoes_pagamento')
       and c.contype = 'c'
       and pg_get_constraintdef(c.oid) ilike '%status%'
  loop
    if restricao.definicao not ilike '%aprovada%' then
      execute format('alter table public.programacoes_pagamento drop constraint %I', restricao.conname);
      raise notice 'Restrição % removida: ela não aceitava o status aprovada. Nenhum dado foi alterado.', restricao.conname;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Razão das transferências entre contas próprias
-- ---------------------------------------------------------------------------
-- Um LOTE é uma confirmação (pode ter várias origens para um mesmo destino).
-- Cada linha de transferencias_contas é uma perna origem -> destino, com o
-- saldo antes e depois das DUAS contas.
create table if not exists public.transferencia_lotes (
  id uuid primary key default gen_random_uuid(),
  chave_idempotencia text not null,
  programacao_id integer,
  conta_destino_id integer not null,
  valor_total numeric(14,2) not null default 0,
  quantidade_origens integer not null default 0,
  observacao text,
  usuario_id uuid,
  criado_em timestamptz not null default now(),
  status text not null default 'confirmada',
  estorno_de_lote_id uuid,
  motivo_estorno text,
  estornado_em timestamptz,
  estornado_por uuid
);

-- Redes de segurança, caso a tabela já exista sem alguma coluna.
alter table public.transferencia_lotes
  add column if not exists chave_idempotencia text,
  add column if not exists programacao_id integer,
  add column if not exists conta_destino_id integer,
  add column if not exists valor_total numeric(14,2) not null default 0,
  add column if not exists quantidade_origens integer not null default 0,
  add column if not exists observacao text,
  add column if not exists usuario_id uuid,
  add column if not exists criado_em timestamptz not null default now(),
  add column if not exists status text not null default 'confirmada',
  add column if not exists estorno_de_lote_id uuid,
  add column if not exists motivo_estorno text,
  add column if not exists estornado_em timestamptz,
  add column if not exists estornado_por uuid;

-- É ESTE índice que impede a mesma transferência de acontecer duas vezes:
-- duplo clique, F5, reenvio e dupla confirmação chegam com a mesma chave.
create unique index if not exists transferencia_lotes_idempotencia_idx
  on public.transferencia_lotes (chave_idempotencia);

create index if not exists transferencia_lotes_programacao_idx
  on public.transferencia_lotes (programacao_id, criado_em desc);

create table if not exists public.transferencias_contas (
  id uuid primary key default gen_random_uuid(),
  lote_id uuid,
  programacao_id integer,
  conta_origem_id integer not null,
  conta_destino_id integer not null,
  valor numeric(14,2) not null,
  saldo_origem_antes numeric(14,2),
  saldo_origem_depois numeric(14,2),
  saldo_destino_antes numeric(14,2),
  saldo_destino_depois numeric(14,2),
  data_movimento date not null default current_date,
  observacao text,
  usuario_id uuid,
  criado_em timestamptz not null default now(),
  status text not null default 'confirmada',
  estorno_de_transferencia_id uuid,
  motivo_estorno text,
  estornada_em timestamptz,
  estornada_por uuid
);

alter table public.transferencias_contas
  add column if not exists lote_id uuid,
  add column if not exists programacao_id integer,
  add column if not exists conta_origem_id integer,
  add column if not exists conta_destino_id integer,
  add column if not exists valor numeric(14,2),
  add column if not exists saldo_origem_antes numeric(14,2),
  add column if not exists saldo_origem_depois numeric(14,2),
  add column if not exists saldo_destino_antes numeric(14,2),
  add column if not exists saldo_destino_depois numeric(14,2),
  add column if not exists data_movimento date not null default current_date,
  add column if not exists observacao text,
  add column if not exists usuario_id uuid,
  add column if not exists criado_em timestamptz not null default now(),
  add column if not exists status text not null default 'confirmada',
  add column if not exists estorno_de_transferencia_id uuid,
  add column if not exists motivo_estorno text,
  add column if not exists estornada_em timestamptz,
  add column if not exists estornada_por uuid;

create index if not exists transferencias_contas_lote_idx
  on public.transferencias_contas (lote_id);

create index if not exists transferencias_contas_programacao_idx
  on public.transferencias_contas (programacao_id, criado_em desc);

create index if not exists transferencias_contas_conta_idx
  on public.transferencias_contas (conta_origem_id, conta_destino_id, criado_em desc);

-- Uma transferência só pode ser estornada uma vez.
create unique index if not exists transferencias_contas_estorno_unico_idx
  on public.transferencias_contas (estorno_de_transferencia_id)
  where estorno_de_transferencia_id is not null;

alter table public.transferencia_lotes enable row level security;
alter table public.transferencias_contas enable row level security;

-- Leitura para quem está autenticado: a razão aparece na etapa de execução, no
-- Histórico e na Auditoria. Gravação só pelas funções desta migration, que são
-- security definer e conferem a permissão antes de mover qualquer centavo --
-- por isso não existe política de insert, update ou delete aqui.
drop policy if exists "transferencia_lotes_select" on public.transferencia_lotes;
create policy "transferencia_lotes_select"
  on public.transferencia_lotes
  for select
  to authenticated
  using (true);

drop policy if exists "transferencias_contas_select" on public.transferencias_contas;
create policy "transferencias_contas_select"
  on public.transferencias_contas
  for select
  to authenticated
  using (true);

grant select on public.transferencia_lotes to authenticated;
grant select on public.transferencias_contas to authenticated;
revoke insert, update, delete, truncate on public.transferencia_lotes from authenticated;
revoke insert, update, delete, truncate on public.transferencias_contas from authenticated;
revoke all on public.transferencia_lotes from anon;
revoke all on public.transferencias_contas from anon;

-- ---------------------------------------------------------------------------
-- 4. Aprovar programação — NENHUM saldo se move
-- ---------------------------------------------------------------------------
create or replace function public.aprovar_programacao_pagamento(
  p_programacao_id integer,
  p_saldo_considerado numeric default null,
  p_total_programado numeric default null,
  p_restante numeric default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_usuario uuid;
  v_status_anterior text;
  v_fechado boolean;
  v_secretaria integer;
  v_contas integer;
  v_fornecedores integer;
  v_total numeric(14,2);
  v_saldo numeric(14,2);
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado.' using errcode = '42501';
  end if;
  v_usuario := public.usuario_auditoria_id();

  if not public.pode_em_pagamentos_fase2('aprovar_programacao') then
    raise exception 'Você não tem permissão para aprovar programações de pagamento.' using errcode = '42501';
  end if;

  select pr.status, pr.fechado, pr.secretaria_id
    into v_status_anterior, v_fechado, v_secretaria
    from public.programacoes_pagamento pr
   where pr.id = p_programacao_id
   for update;

  if not found then
    raise exception 'Programação não encontrada.';
  end if;

  if v_fechado is true then
    raise exception 'Programações históricas fechadas não podem ser aprovadas.';
  end if;

  if v_status_anterior = 'aprovada' then
    return jsonb_build_object('ok', true, 'ja_aprovada', true, 'programacao_id', p_programacao_id, 'status', 'aprovada');
  end if;

  select count(*), round(coalesce(sum(p.valor_a_pagar), 0)::numeric, 2)
    into v_fornecedores, v_total
    from public.pagamentos p
   where p.programacao_id = p_programacao_id
     and p.excluido_em is null
     and coalesce(p.situacao, '') <> 'cancelado';

  if v_fornecedores = 0 then
    raise exception 'Não é possível aprovar uma programação sem fornecedores.';
  end if;

  select count(*), round(coalesce(sum(pc.saldo_considerado), 0)::numeric, 2)
    into v_contas, v_saldo
    from public.programacao_contas pc
   where pc.programacao_id = p_programacao_id
     and pc.ativa = true;

  if v_contas = 0 then
    raise exception 'Não é possível aprovar uma programação sem contas de trabalho.';
  end if;

  -- Aprovar grava status e conferência. Nenhuma linha de saldo, nenhuma baixa,
  -- nenhum saldo de fornecedor, nenhuma nota marcada como paga.
  update public.programacoes_pagamento
     set status = 'aprovada',
         aprovada_em = now(),
         aprovada_por = v_usuario,
         saldo_considerado = round(coalesce(p_saldo_considerado, v_saldo), 2),
         total_programado = round(coalesce(p_total_programado, v_total), 2),
         restante = round(coalesce(p_restante, v_saldo - v_total), 2),
         updated_at = now()
   where id = p_programacao_id;

  insert into public.auditoria_eventos (
    usuario_id, modulo, acao, registro_afetado, valor_anterior, valor_novo, nivel
  ) values (
    v_usuario,
    'pagamentos',
    'aprovou',
    'Programação ' || p_programacao_id::text,
    jsonb_build_object('status', v_status_anterior),
    jsonb_build_object(
      'status', 'aprovada',
      'secretaria_id', v_secretaria,
      'contas', v_contas,
      'fornecedores', v_fornecedores,
      'saldo_disponivel', v_saldo,
      'total_aprovado', v_total,
      'restante', round(v_saldo - v_total, 2),
      'movimentou_saldo', false
    ),
    'atencao'
  );

  return jsonb_build_object(
    'ok', true,
    'ja_aprovada', false,
    'programacao_id', p_programacao_id,
    'status', 'aprovada',
    'contas', v_contas,
    'fornecedores', v_fornecedores,
    'saldo_disponivel', v_saldo,
    'total_aprovado', v_total,
    'restante', round(v_saldo - v_total, 2)
  );
end $$;

grant execute on function public.aprovar_programacao_pagamento(integer, numeric, numeric, numeric) to authenticated;

comment on function public.aprovar_programacao_pagamento(integer, numeric, numeric, numeric)
is 'Aprova a programação diária. APROVADO NAO E PAGO: não debita conta, não dá baixa em NF, não altera saldo de fornecedor e não marca nota como paga.';

-- ---------------------------------------------------------------------------
-- 5. Conta por pagamento — definir conta NÃO debita conta
-- ---------------------------------------------------------------------------
-- Aceita um ou muitos pagamentos na mesma chamada: é isso que atende a
-- atribuição individual, a atribuição aos selecionados e o aplicar a todos.
-- Assinaturas anteriores já existem em produção e o create or replace não
-- consegue alterar defaults, nomes de parâmetros ou tipo de retorno: o drop
-- antes da recriação evita o erro 42P13. Os grants abaixo são reaplicados.
drop function if exists public.definir_conta_origem_pagamento(integer, integer[], integer);

create or replace function public.definir_conta_origem_pagamento(
  p_programacao_id integer,
  p_pagamento_ids integer[],
  p_conta_id integer
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_usuario uuid;
  v_secretaria integer;
  v_status text;
  v_fechado boolean;
  v_conta_secretaria integer;
  v_conta_ativa boolean;
  v_na_programacao boolean;
  v_atualizados integer;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado.' using errcode = '42501';
  end if;
  v_usuario := public.usuario_auditoria_id();

  if not public.pode_em_pagamentos_fase2('definir_conta_pagamento') then
    raise exception 'Você não tem permissão para definir a conta de pagamento.' using errcode = '42501';
  end if;

  if p_pagamento_ids is null or array_length(p_pagamento_ids, 1) is null then
    raise exception 'Escolha ao menos um pagamento.';
  end if;

  select pr.secretaria_id, pr.status, pr.fechado
    into v_secretaria, v_status, v_fechado
    from public.programacoes_pagamento pr
   where pr.id = p_programacao_id
   for update;

  if not found then
    raise exception 'Programação não encontrada.';
  end if;

  if v_fechado is true then
    raise exception 'Programações históricas fechadas não podem ser alteradas.';
  end if;

  if v_status <> 'aprovada' then
    raise exception 'A conta de cada pagamento só é definida depois da aprovação da programação.';
  end if;

  if p_conta_id is not null then
    select cb.secretaria_id, coalesce(cb.ativo, true)
      into v_conta_secretaria, v_conta_ativa
      from public.contas_bancarias cb
     where cb.id = p_conta_id;

    if not found then
      raise exception 'Conta bancária não encontrada.';
    end if;
    if v_conta_ativa is not true then
      raise exception 'Conta bancária desativada não pode receber pagamentos.';
    end if;
    if v_conta_secretaria is distinct from v_secretaria then
      raise exception 'Só é possível usar contas da secretaria da programação.';
    end if;

    select exists (
      select 1
        from public.programacao_contas pc
       where pc.programacao_id = p_programacao_id
         and pc.conta_id = p_conta_id
         and pc.ativa = true
    ) into v_na_programacao;

    if not v_na_programacao then
      raise exception 'Só é possível usar contas que estão entre as contas de trabalho selecionadas na programação.';
    end if;
  end if;

  -- Grava SÓ o vínculo. Nenhuma linha de saldo, nenhuma movimentação.
  update public.pagamentos p
     set conta_origem_id = p_conta_id
   where p.programacao_id = p_programacao_id
     and p.id = any (p_pagamento_ids)
     and p.excluido_em is null
     and coalesce(p.situacao, '') <> 'cancelado';

  get diagnostics v_atualizados = row_count;

  if v_atualizados = 0 then
    raise exception 'Nenhum pagamento desta programação corresponde à seleção.';
  end if;

  insert into public.auditoria_eventos (
    usuario_id, modulo, acao, registro_afetado, valor_anterior, valor_novo, nivel
  ) values (
    v_usuario,
    'pagamentos',
    'alterou',
    'Conta de pagamento da programação ' || p_programacao_id::text,
    jsonb_build_object('pagamentos', to_jsonb(p_pagamento_ids)),
    jsonb_build_object(
      'conta_origem_id', p_conta_id,
      'pagamentos_atualizados', v_atualizados,
      'debitou_conta', false
    ),
    'informacao'
  );

  return jsonb_build_object(
    'ok', true,
    'programacao_id', p_programacao_id,
    'conta_origem_id', p_conta_id,
    'pagamentos_atualizados', v_atualizados,
    'debitou_conta', false
  );
end $$;

grant execute on function public.definir_conta_origem_pagamento(integer, integer[], integer) to authenticated;

comment on function public.definir_conta_origem_pagamento(integer, integer[], integer)
is 'Define a conta de origem de um ou mais pagamentos da programação. CONTA DEFINIDA NAO E DEBITO: nenhum saldo é movimentado aqui.';

-- ---------------------------------------------------------------------------
-- 6. Transferência entre contas — a ÚNICA operação desta fase que move saldo
-- ---------------------------------------------------------------------------
-- Assinaturas anteriores já existem em produção e o create or replace não
-- consegue alterar defaults, nomes de parâmetros ou tipo de retorno: o drop
-- antes da recriação evita o erro 42P13. Os grants abaixo são reaplicados.
drop function if exists public.confirmar_transferencias_programacao(integer, integer, jsonb, text, text);

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
as $fn$
declare
  v_usuario uuid;
  v_lote_id uuid;
  v_existente uuid;
  v_destino_secretaria integer;
  v_destino_ativa boolean;
  v_destino_nome text;
  v_secretaria_destino_nome text;
  v_item jsonb;
  v_origem_id integer;
  v_valor numeric(14,2);
  v_total numeric(14,2) := 0;
  v_quantidade integer := 0;
  v_origem_secretaria integer;
  v_origem_ativa boolean;
  v_secretaria_origem_nome text;
  v_saldo_origem numeric(14,2);
  v_data_origem date;
  v_saldo_destino numeric(14,2);
  v_data_destino date;
  v_data_alvo date;
  v_destino_antes numeric(14,2);
  v_transferencia_id uuid;
  v_pernas jsonb := '[]'::jsonb;
  v_contas integer[];
  v_conta integer;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado.' using errcode = '42501';
  end if;
  v_usuario := public.usuario_auditoria_id();

  if not public.pode_em_pagamentos_fase2('executar_transferencia') then
    raise exception 'Você não tem permissão para transferir entre contas.' using errcode = '42501';
  end if;

  if coalesce(trim(p_chave_idempotencia), '') = '' then
    raise exception 'A transferência precisa de um identificador único.';
  end if;

  if jsonb_typeof(coalesce(p_transferencias, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_transferencias, '[]'::jsonb)) = 0 then
    raise exception 'Informe ao menos uma conta de origem com valor.';
  end if;

  -- IDEMPOTÊNCIA. O índice único da chave é a tranca: duplo clique, F5, reenvio
  -- ou dupla confirmação caem aqui e a segunda tentativa não move nada.
  insert into public.transferencia_lotes (
    chave_idempotencia, programacao_id, conta_destino_id, observacao, usuario_id, status
  ) values (
    trim(p_chave_idempotencia), p_programacao_id, p_conta_destino_id,
    nullif(trim(coalesce(p_observacao, '')), ''), v_usuario, 'confirmada'
  )
  on conflict (chave_idempotencia) do nothing
  returning id into v_lote_id;

  if v_lote_id is null then
    select tl.id into v_existente
      from public.transferencia_lotes tl
     where tl.chave_idempotencia = trim(p_chave_idempotencia);

    select coalesce(jsonb_agg(jsonb_build_object(
             'id', tc.id,
             'conta_origem_id', tc.conta_origem_id,
             'valor', tc.valor
           ) order by tc.criado_em), '[]'::jsonb)
      into v_pernas
      from public.transferencias_contas tc
     where tc.lote_id = v_existente;

    return jsonb_build_object(
      'ok', true,
      'ja_confirmada', true,
      'lote_id', v_existente,
      'transferencias', v_pernas
    );
  end if;

  -- Conta de destino
  select cb.secretaria_id, coalesce(cb.ativo, true), cb.nome_conta
    into v_destino_secretaria, v_destino_ativa, v_destino_nome
    from public.contas_bancarias cb
   where cb.id = p_conta_destino_id;

  if not found then
    raise exception 'Conta de destino não encontrada.';
  end if;
  if v_destino_ativa is not true then
    raise exception 'Conta de destino desativada não pode receber transferência.';
  end if;

  select s.nome into v_secretaria_destino_nome
    from public.secretarias s
   where s.id = v_destino_secretaria;

  -- Serializa as contas envolvidas: duas transferências simultâneas na mesma
  -- conta entram em fila, então o saldo nunca é lido desatualizado.
  select array_agg(distinct conta order by conta)
    into v_contas
    from (
      select p_conta_destino_id as conta
      union
      select (valor->>'conta_origem_id')::integer
        from jsonb_array_elements(p_transferencias) as itens(valor)
    ) todas
   where conta is not null;

  foreach v_conta in array v_contas loop
    perform pg_advisory_xact_lock(918273645, v_conta);
  end loop;

  -- Saldo atual do destino (último lançamento de saldos_historico).
  select sh.valor_saldo, sh.data_saldo
    into v_saldo_destino, v_data_destino
    from public.saldos_historico sh
   where sh.conta_id = p_conta_destino_id
   order by sh.data_saldo desc, sh.id desc
   limit 1;

  if not found then
    v_saldo_destino := 0;
    v_data_destino := null;
  end if;

  v_destino_antes := round(coalesce(v_saldo_destino, 0), 2);

  -- Cada origem: valida tudo primeiro, debita depois. Qualquer exceção aqui
  -- desfaz o lote inteiro (saída e entrada estão na MESMA transação).
  for v_item in select value from jsonb_array_elements(p_transferencias)
  loop
    v_origem_id := nullif(v_item->>'conta_origem_id', '')::integer;
    v_valor := round(coalesce((v_item->>'valor')::numeric, 0), 2);

    if v_origem_id is null then
      raise exception 'Informe a conta de origem de cada transferência.';
    end if;
    if v_valor <= 0 then
      raise exception 'O valor da transferência precisa ser maior que zero.';
    end if;
    if v_origem_id = p_conta_destino_id then
      raise exception 'A conta de origem e a de destino precisam ser diferentes.';
    end if;

    select cb.secretaria_id, coalesce(cb.ativo, true)
      into v_origem_secretaria, v_origem_ativa
      from public.contas_bancarias cb
     where cb.id = v_origem_id;

    if not found then
      raise exception 'Conta de origem % não encontrada.', v_origem_id;
    end if;
    if v_origem_ativa is not true then
      raise exception 'Conta de origem desativada não pode transferir.';
    end if;

    -- SEGREGAÇÃO POR SECRETARIA
    if v_origem_secretaria is distinct from v_destino_secretaria then
      select s.nome into v_secretaria_origem_nome
        from public.secretarias s
       where s.id = v_origem_secretaria;

      if not public.transferencia_entre_secretarias_permitida(v_secretaria_origem_nome, v_secretaria_destino_nome) then
        raise exception 'Transferência entre secretarias diferentes não é permitida (% para %). A única exceção é a Secretaria de Finanças para Saúde, Educação e Assistência Social.',
          coalesce(v_secretaria_origem_nome, 'origem'), coalesce(v_secretaria_destino_nome, 'destino');
      end if;
    end if;

    select sh.valor_saldo, sh.data_saldo
      into v_saldo_origem, v_data_origem
      from public.saldos_historico sh
     where sh.conta_id = v_origem_id
     order by sh.data_saldo desc, sh.id desc
     limit 1;

    if not found then
      v_saldo_origem := 0;
      v_data_origem := null;
    end if;

    v_saldo_origem := round(coalesce(v_saldo_origem, 0), 2);

    if v_valor > v_saldo_origem then
      raise exception 'Saldo insuficiente na conta de origem: saldo % e transferência de %.',
        to_char(v_saldo_origem, 'FM999999999990.00'), to_char(v_valor, 'FM999999999990.00');
    end if;

    -- SAÍDA. O lançamento entra na data de hoje, ou na data do último saldo da
    -- conta quando esta for mais recente (é ela que as telas leem).
    v_data_alvo := greatest(current_date, coalesce(v_data_origem, current_date));

    insert into public.saldos_historico (conta_id, valor_saldo, data_saldo)
    values (v_origem_id, round(v_saldo_origem - v_valor, 2), v_data_alvo)
    on conflict (conta_id, data_saldo)
    do update set valor_saldo = excluded.valor_saldo;

    insert into public.transferencias_contas (
      lote_id, programacao_id, conta_origem_id, conta_destino_id, valor,
      saldo_origem_antes, saldo_origem_depois,
      data_movimento, observacao, usuario_id, status
    ) values (
      v_lote_id, p_programacao_id, v_origem_id, p_conta_destino_id, v_valor,
      v_saldo_origem, round(v_saldo_origem - v_valor, 2),
      v_data_alvo, nullif(trim(coalesce(p_observacao, '')), ''), v_usuario, 'confirmada'
    )
    returning id into v_transferencia_id;

    v_total := round(v_total + v_valor, 2);
    v_quantidade := v_quantidade + 1;
    v_pernas := v_pernas || jsonb_build_object(
      'id', v_transferencia_id,
      'conta_origem_id', v_origem_id,
      'valor', v_valor,
      'saldo_origem_antes', v_saldo_origem,
      'saldo_origem_depois', round(v_saldo_origem - v_valor, 2)
    );
  end loop;

  -- ENTRADA, uma vez, com a soma de todas as origens.
  v_data_alvo := greatest(current_date, coalesce(v_data_destino, current_date));

  insert into public.saldos_historico (conta_id, valor_saldo, data_saldo)
  values (p_conta_destino_id, round(v_destino_antes + v_total, 2), v_data_alvo)
  on conflict (conta_id, data_saldo)
  do update set valor_saldo = excluded.valor_saldo;

  update public.transferencias_contas
     set saldo_destino_antes = v_destino_antes,
         saldo_destino_depois = round(v_destino_antes + v_total, 2)
   where lote_id = v_lote_id;

  update public.transferencia_lotes
     set valor_total = v_total,
         quantidade_origens = v_quantidade
   where id = v_lote_id;

  -- Histórico e Auditoria: saldo antes e saldo depois de cada conta.
  insert into public.auditoria_eventos (
    usuario_id, modulo, acao, registro_afetado, valor_anterior, valor_novo, nivel
  ) values (
    v_usuario,
    'pagamentos',
    'transferiu',
    'Transferência entre contas — lote ' || v_lote_id::text,
    jsonb_build_object(
      'conta_destino_id', p_conta_destino_id,
      'saldo_destino_antes', v_destino_antes,
      'origens', v_pernas
    ),
    jsonb_build_object(
      'lote_id', v_lote_id,
      'chave_idempotencia', trim(p_chave_idempotencia),
      'programacao_id', p_programacao_id,
      'conta_destino_id', p_conta_destino_id,
      'conta_destino', v_destino_nome,
      'valor_total', v_total,
      'quantidade_origens', v_quantidade,
      'saldo_destino_antes', v_destino_antes,
      'saldo_destino_depois', round(v_destino_antes + v_total, 2),
      'observacao', nullif(trim(coalesce(p_observacao, '')), ''),
      'transferencias', v_pernas,
      'eh_despesa', false
    ),
    'critico'
  );

  return jsonb_build_object(
    'ok', true,
    'ja_confirmada', false,
    'lote_id', v_lote_id,
    'valor_total', v_total,
    'quantidade_origens', v_quantidade,
    'conta_destino_id', p_conta_destino_id,
    'saldo_destino_antes', v_destino_antes,
    'saldo_destino_depois', round(v_destino_antes + v_total, 2),
    'eh_despesa', false,
    'transferencias', v_pernas
  );
end;
$fn$;

grant execute on function public.confirmar_transferencias_programacao(integer, integer, jsonb, text, text) to authenticated;

comment on function public.confirmar_transferencias_programacao(integer, integer, jsonb, text, text)
is 'Transferência entre contas próprias: várias origens para um destino, atômica e idempotente pela chave. NAO E DESPESA — não escreve em pagamento_movimentacoes nem em pagamentos_baixas.';

-- ---------------------------------------------------------------------------
-- 7. Estorno — transferência não se exclui, se estorna
-- ---------------------------------------------------------------------------
-- Assinaturas anteriores já existem em produção e o create or replace não
-- consegue alterar defaults, nomes de parâmetros ou tipo de retorno: o drop
-- antes da recriação evita o erro 42P13. Os grants abaixo são reaplicados.
drop function if exists public.estornar_transferencia(uuid, text);

create or replace function public.estornar_transferencia(
  p_transferencia_id uuid,
  p_observacao text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_usuario uuid;
  v_origem_id integer;
  v_destino_id integer;
  v_valor numeric(14,2);
  v_status text;
  v_programacao integer;
  v_lote_id uuid;
  v_motivo text;
  v_lote_estorno uuid;
  v_saldo_origem numeric(14,2);
  v_data_origem date;
  v_saldo_destino numeric(14,2);
  v_data_destino date;
  v_data_alvo date;
  v_estorno_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado.' using errcode = '42501';
  end if;
  v_usuario := public.usuario_auditoria_id();

  if not public.pode_em_pagamentos_fase2('estornar_transferencia') then
    raise exception 'Você não tem permissão para estornar transferências.' using errcode = '42501';
  end if;

  v_motivo := nullif(trim(coalesce(p_observacao, '')), '');
  if v_motivo is null then
    raise exception 'Informe o motivo do estorno.';
  end if;

  select tc.conta_origem_id, tc.conta_destino_id, tc.valor, tc.status, tc.programacao_id, tc.lote_id
    into v_origem_id, v_destino_id, v_valor, v_status, v_programacao, v_lote_id
    from public.transferencias_contas tc
   where tc.id = p_transferencia_id
   for update;

  if not found then
    raise exception 'Transferência não encontrada.';
  end if;

  if v_status = 'estornada' then
    return jsonb_build_object('ok', true, 'ja_estornada', true, 'transferencia_id', p_transferencia_id);
  end if;

  if v_status = 'estorno' then
    raise exception 'Um estorno não pode ser estornado.';
  end if;

  perform pg_advisory_xact_lock(918273645, least(v_origem_id, v_destino_id));
  perform pg_advisory_xact_lock(918273645, greatest(v_origem_id, v_destino_id));

  -- Idempotência do estorno: a chave carrega o id da transferência original.
  insert into public.transferencia_lotes (
    chave_idempotencia, programacao_id, conta_destino_id, observacao, usuario_id,
    status, estorno_de_lote_id, motivo_estorno, valor_total, quantidade_origens
  ) values (
    'estorno:' || p_transferencia_id::text, v_programacao, v_origem_id, v_motivo, v_usuario,
    'estorno', v_lote_id, v_motivo, v_valor, 1
  )
  on conflict (chave_idempotencia) do nothing
  returning id into v_lote_estorno;

  if v_lote_estorno is null then
    return jsonb_build_object('ok', true, 'ja_estornada', true, 'transferencia_id', p_transferencia_id);
  end if;

  -- Movimento inverso: o destino devolve, a origem recebe.
  select sh.valor_saldo, sh.data_saldo
    into v_saldo_destino, v_data_destino
    from public.saldos_historico sh
   where sh.conta_id = v_destino_id
   order by sh.data_saldo desc, sh.id desc
   limit 1;

  if not found then
    v_saldo_destino := 0;
    v_data_destino := null;
  end if;
  v_saldo_destino := round(coalesce(v_saldo_destino, 0), 2);

  if v_valor > v_saldo_destino then
    raise exception 'Saldo insuficiente na conta que recebeu a transferência: saldo % e estorno de %.',
      to_char(v_saldo_destino, 'FM999999999990.00'), to_char(v_valor, 'FM999999999990.00');
  end if;

  select sh.valor_saldo, sh.data_saldo
    into v_saldo_origem, v_data_origem
    from public.saldos_historico sh
   where sh.conta_id = v_origem_id
   order by sh.data_saldo desc, sh.id desc
   limit 1;

  if not found then
    v_saldo_origem := 0;
    v_data_origem := null;
  end if;
  v_saldo_origem := round(coalesce(v_saldo_origem, 0), 2);

  v_data_alvo := greatest(current_date, coalesce(v_data_destino, current_date));
  insert into public.saldos_historico (conta_id, valor_saldo, data_saldo)
  values (v_destino_id, round(v_saldo_destino - v_valor, 2), v_data_alvo)
  on conflict (conta_id, data_saldo)
  do update set valor_saldo = excluded.valor_saldo;

  v_data_alvo := greatest(current_date, coalesce(v_data_origem, current_date));
  insert into public.saldos_historico (conta_id, valor_saldo, data_saldo)
  values (v_origem_id, round(v_saldo_origem + v_valor, 2), v_data_alvo)
  on conflict (conta_id, data_saldo)
  do update set valor_saldo = excluded.valor_saldo;

  -- A perna do estorno entra como registro NOVO: a original permanece.
  insert into public.transferencias_contas (
    lote_id, programacao_id, conta_origem_id, conta_destino_id, valor,
    saldo_origem_antes, saldo_origem_depois,
    saldo_destino_antes, saldo_destino_depois,
    data_movimento, observacao, usuario_id, status, estorno_de_transferencia_id, motivo_estorno
  ) values (
    v_lote_estorno, v_programacao, v_destino_id, v_origem_id, v_valor,
    v_saldo_destino, round(v_saldo_destino - v_valor, 2),
    v_saldo_origem, round(v_saldo_origem + v_valor, 2),
    v_data_alvo, v_motivo, v_usuario, 'estorno', p_transferencia_id, v_motivo
  )
  returning id into v_estorno_id;

  update public.transferencias_contas
     set status = 'estornada',
         estornada_em = now(),
         estornada_por = v_usuario,
         motivo_estorno = v_motivo
   where id = p_transferencia_id;

  update public.transferencia_lotes
     set status = case
                    when not exists (
                      select 1 from public.transferencias_contas tc
                       where tc.lote_id = v_lote_id and tc.status = 'confirmada'
                    ) then 'estornada'
                    else status
                  end,
         estornado_em = now(),
         estornado_por = v_usuario,
         motivo_estorno = v_motivo
   where id = v_lote_id;

  -- DOIS eventos: o estorno da original e a movimentação inversa.
  insert into public.auditoria_eventos (
    usuario_id, modulo, acao, registro_afetado, valor_anterior, valor_novo, nivel
  ) values (
    v_usuario,
    'pagamentos',
    'estornou',
    'Transferência ' || p_transferencia_id::text,
    jsonb_build_object('status', v_status, 'valor', v_valor, 'conta_origem_id', v_origem_id, 'conta_destino_id', v_destino_id),
    jsonb_build_object('status', 'estornada', 'motivo', v_motivo, 'preservada', true),
    'critico'
  ), (
    v_usuario,
    'pagamentos',
    'transferiu',
    'Estorno de transferência — lote ' || v_lote_estorno::text,
    jsonb_build_object(
      'conta_origem_id', v_destino_id,
      'saldo_antes', v_saldo_destino,
      'conta_destino_id', v_origem_id,
      'saldo_destino_antes', v_saldo_origem
    ),
    jsonb_build_object(
      'lote_id', v_lote_estorno,
      'estorno_de_transferencia_id', p_transferencia_id,
      'programacao_id', v_programacao,
      'valor', v_valor,
      'conta_origem_id', v_destino_id,
      'saldo_origem_depois', round(v_saldo_destino - v_valor, 2),
      'conta_destino_id', v_origem_id,
      'saldo_destino_depois', round(v_saldo_origem + v_valor, 2),
      'motivo', v_motivo,
      'eh_despesa', false
    ),
    'critico'
  );

  return jsonb_build_object(
    'ok', true,
    'ja_estornada', false,
    'transferencia_id', p_transferencia_id,
    'estorno_id', v_estorno_id,
    'lote_id', v_lote_estorno,
    'valor', v_valor,
    'eh_despesa', false
  );
end;
$fn$;

grant execute on function public.estornar_transferencia(uuid, text) to authenticated;

comment on function public.estornar_transferencia(uuid, text)
is 'Estorna uma transferência entre contas lançando a movimentação inversa. Exige motivo e PRESERVA a transferência original na razão, no Histórico e na Auditoria.';

commit;
