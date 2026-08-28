-- BAIXAS DE PAGAMENTOS — a baixa por NOTA do fornecedor.
--
-- ATENÇÃO: esta migration precisa ser rodada MANUALMENTE no SQL Editor do
-- Supabase (projeto usado pela aplicação). Nada nela roda sozinho no deploy.
-- Arquivo: supabase/migrations/20260829120000_baixas_pagamentos_por_nota.sql
--
-- O QUE É UMA BAIXA, NESTE SISTEMA
--
-- A baixa é a confirmação de que o pagamento SAIU DE FATO no banco. Ela é
-- independente da Programação Diária: uma nota pode ser baixada sem nunca ter
-- sido programada.
--
-- A BAIXA NÃO DEBITA O SALDO DA CONTA. Ela só faz duas coisas:
--   1. registra o pagamento (uma linha em public.pagamentos_baixas);
--   2. abate o valor em aberto da nota (public.valores_em_aberto.valor_pago).
-- O saldo continua sendo movimentado EXCLUSIVAMENTE pelos fluxos que já
-- existiam (lançamento do saldo do dia e transferência entre contas). Por isso
-- nenhuma função criada aqui escreve uma única linha em
-- public.saldos_historico, public.pagamento_movimentacoes,
-- public.transferencias_contas, public.transferencia_lotes nem em qualquer
-- coluna de saldo de public.contas_bancarias — e essa ausência é proposital,
-- não esquecimento.
--
-- AS DUAS SITUAÇÕES DA NOTA
--
-- O sistema usa apenas duas situações em public.valores_em_aberto: 'em_aberto'
-- e 'pago'. A baixa respeita isso e não inventa uma terceira.
--
-- Baixa PARCIAL mantém a nota 'em_aberto': o abatimento fica registrado em
-- valor_pago, e valor - valor_pago continua sendo o valor em aberto. Só a
-- quitação grava 'pago'. O estorno segue a mesma regra: sobrando saldo em
-- aberto, a nota volta para 'em_aberto'.
--
-- Nada aqui grava 'parcialmente_pago': nenhuma tela, filtro ou relatório do
-- sistema espera essa situação, e a nota sumiria deles.
--
-- A COLUNA DA SITUAÇÃO É UM ENUM
--
-- public.valores_em_aberto.situacao não é texto: é o enum public.situacao_valor
-- (em_aberto, programado, parcialmente_pago, pago, suspenso, cancelado). Por
-- isso a validação da seção 0 aceita as duas formas, confere que o enum tem os
-- dois rótulos que a baixa grava ('em_aberto' e 'pago'), e as funções leem a
-- situação como texto e a gravam de volta convertida para o tipo REAL da coluna.
-- Nada disso muda a regra: só quem decide a situação continua sendo o valor que
-- resta em aberto.
--
-- O QUE ESTA MIGRATION ENTREGA
--
--   1. public.valores_em_aberto.valor_pago -> garante a coluna que guarda
--      quanto da nota já foi baixado. As telas de Fornecedores e de Pagamentos
--      Diários já LEEM essa coluna (valor - valor_pago = em aberto); até agora
--      ninguém a escrevia. A baixa passa a ser quem escreve, e os totais
--      existentes passam a refletir as baixas sozinhos.
--   2. public.pagamentos_baixas -> ganha valor_em_aberto_id (a nota baixada) e
--      situacao_anterior (a situação da nota antes da baixa, guardada como
--      registro do que havia). A tabela é REAPROVEITADA: a Vida do
--      Fornecedor e os Relatórios continuam lendo os MESMOS registros, sem
--      duplicar dado.
--   3. Índice único em chave_idempotencia -> confirmar duas vezes não registra
--      duas baixas.
--   4. public.pode_em_baixas -> as cinco permissões próprias do módulo.
--   5. Padrão do módulo 'baixas' em public.perfis_permissoes, copiado do módulo
--      'pagamentos' de cada perfil (ninguém perde acesso por causa desta
--      migration).
--   6. public.registrar_baixa_nota -> baixa parcial ou integral, transacional e
--      idempotente, com evento em public.auditoria_eventos.
--   7. public.estornar_baixa_nota -> estorno com justificativa obrigatória, que
--      devolve o valor para "em aberto" e PRESERVA a baixa original (nunca
--      apaga), também com evento em public.auditoria_eventos.
--
-- IDEMPOTENTE: pode ser rodada mais de uma vez sem efeito colateral. ADITIVA:
-- não apaga nem reescreve nenhum dado existente.

begin;

-- ---------------------------------------------------------------------------
-- 0. Validação da estrutura real ANTES de qualquer alteração
-- ---------------------------------------------------------------------------
-- Se algo não bater, a migration aborta aqui, antes do primeiro DDL.
do $$
declare
  item record;
  tipo_real text;
  tipo_oid oid;
  eh_enum boolean;
  faltando text[];
begin
  for item in
    select * from (values
      ('valores_em_aberto'), ('fornecedores'), ('contas_bancarias'),
      ('usuarios'), ('auditoria_eventos'), ('perfis_acesso'),
      ('perfis_permissoes'), ('permissoes_efetivas')
    ) as t(nome)
  loop
    if to_regclass(format('public.%I', item.nome)) is null then
      raise exception 'Estrutura incompatível: public.% não existe. A aba de Baixas depende dela.', item.nome;
    end if;
  end loop;

  -- Colunas de que a baixa depende, com a FAMÍLIA de tipo aceita. A checagem é
  -- por família (numérico, textual, inteiro) para não abortar em bancos que
  -- usem decimal em vez de numeric ou varchar em vez de text.
  --
  -- 'texto_ou_enum' existe por causa de public.valores_em_aberto.situacao: no
  -- banco em uso ela NÃO é texto, é o enum public.situacao_valor (em_aberto,
  -- programado, parcialmente_pago, pago, suspenso, cancelado). As duas formas
  -- servem para a baixa, e a família reflete isso em vez de abortar no enum.
  for item in
    select * from (values
      ('valores_em_aberto', 'id', 'chave'),
      ('valores_em_aberto', 'fornecedor_id', 'inteiro'),
      ('valores_em_aberto', 'valor', 'numerico'),
      ('valores_em_aberto', 'situacao', 'texto_ou_enum'),
      ('valores_em_aberto', 'numero_nota_fiscal', 'texto'),
      ('fornecedores', 'id', 'inteiro'),
      ('contas_bancarias', 'id', 'inteiro'),
      ('usuarios', 'id', 'chave')
    ) as tipos(tabela, coluna, familia)
  loop
    select format_type(a.atttypid, null), a.atttypid, t.typtype = 'e'
      into tipo_real, tipo_oid, eh_enum
      from pg_attribute a
      join pg_type t on t.oid = a.atttypid
     where a.attrelid = to_regclass(format('public.%I', item.tabela))
       and a.attname::text = item.coluna
       and not a.attisdropped;

    if tipo_real is null then
      raise exception 'Estrutura incompatível: public.%.% não existe. A aba de Baixas depende dela.',
        item.tabela, item.coluna;
    end if;

    if not (
      (item.familia = 'inteiro'  and tipo_real in ('integer', 'bigint', 'smallint'))
      or (item.familia = 'numerico' and tipo_real in ('numeric', 'double precision', 'real', 'integer', 'bigint'))
      or (item.familia = 'texto'    and tipo_real in ('text', 'character varying', 'character'))
      or (item.familia = 'texto_ou_enum' and (eh_enum or tipo_real in ('text', 'character varying', 'character')))
      or (item.familia = 'chave'    and tipo_real in ('integer', 'bigint', 'uuid', 'text', 'character varying'))
    ) then
      raise exception 'Tipo incompatível em public.%.%: a aba de Baixas espera % e encontrou %.',
        item.tabela, item.coluna, item.familia, tipo_real;
    end if;
  end loop;

  -- Rótulos que a baixa GRAVA. Onde a coluna é texto, qualquer valor entra e
  -- não há o que conferir. Onde é enum, o rótulo tem de existir no tipo: sem
  -- ele a gravação falharia no meio de uma baixa de verdade, e é melhor abortar
  -- aqui dizendo exatamente qual valor falta.
  for item in
    select * from (values
      -- As DUAS únicas situações que a baixa escreve na nota. 'parcialmente_pago'
      -- existe no enum do banco em uso, mas a baixa NÃO o grava: a baixa parcial
      -- mantém a nota 'em_aberto' e só a quitação grava 'pago'.
      ('valores_em_aberto', 'situacao', array['em_aberto', 'pago']),
      ('usuarios',          'status',   array['ativo']),
      ('auditoria_eventos', 'modulo',   array['pagamentos']),
      ('auditoria_eventos', 'acao',     array['registrou_baixa', 'estornou_baixa']),
      ('auditoria_eventos', 'nivel',    array['atencao', 'critico']),
      ('perfis_permissoes', 'modulo',   array['baixas', 'pagamentos'])
    ) as alvos(tabela, coluna, rotulos)
  loop
    select format_type(a.atttypid, null), a.atttypid, t.typtype = 'e'
      into tipo_real, tipo_oid, eh_enum
      from pg_attribute a
      join pg_type t on t.oid = a.atttypid
     where a.attrelid = to_regclass(format('public.%I', item.tabela))
       and a.attname::text = item.coluna
       and not a.attisdropped;

    -- Coluna ausente ou textual: nada a conferir aqui.
    if tipo_real is null or not coalesce(eh_enum, false) then
      continue;
    end if;

    select array_agg(rotulo order by rotulo)
      into faltando
      from unnest(item.rotulos) as rotulo
     where not exists (
       select 1 from pg_enum e
        where e.enumtypid = tipo_oid
          and e.enumlabel::text = rotulo
     );

    if faltando is not null then
      raise exception 'Enum incompatível em public.%.%: o tipo % não tem o(s) valor(es) %, e a aba de Baixas precisa gravá-lo(s). Acrescente-o(s) ao enum (alter type % add value ...) numa execução separada e rode esta migration depois.',
        item.tabela, item.coluna, tipo_real, array_to_string(faltando, ', '), tipo_real;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Quanto da nota já foi baixado
-- ---------------------------------------------------------------------------
-- A coluna já existe no banco em uso e é lida pelas telas de Fornecedores e de
-- Pagamentos Diários. O `if not exists` é para bancos novos; onde ela já
-- existir, esta linha não faz nada.
alter table public.valores_em_aberto
  add column if not exists valor_pago numeric(14,2) not null default 0;

-- Se existir com outro tipo numérico, a baixa continua funcionando; só um tipo
-- não numérico impediria a soma.
do $$
declare
  tipo_real text;
begin
  select format_type(a.atttypid, null)
    into tipo_real
    from pg_attribute a
   where a.attrelid = to_regclass('public.valores_em_aberto')
     and a.attname::text = 'valor_pago'
     and not a.attisdropped;

  if tipo_real not in ('numeric', 'double precision', 'real', 'integer', 'bigint') then
    raise exception 'Tipo incompatível em public.valores_em_aberto.valor_pago: esperado numérico, encontrado %.', tipo_real;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. A razão das baixas
-- ---------------------------------------------------------------------------
-- Em bancos novos a tabela nasce aqui. No banco em uso ela já existe (a Vida do
-- Fornecedor e os Relatórios já a leem) e só ganha as colunas que faltam.
create table if not exists public.pagamentos_baixas (
  id uuid primary key default gen_random_uuid(),
  chave_idempotencia text,
  fornecedor_id integer,
  pagamento_id integer,
  valor_total_referencia numeric(14,2),
  valor_pago numeric(14,2) not null default 0,
  data_pagamento date not null default current_date,
  conta_id integer,
  documento text,
  observacao text,
  status text not null default 'efetivada',
  saldo_antes numeric(14,2),
  saldo_depois numeric(14,2),
  usuario_id uuid,
  criado_em timestamptz not null default now(),
  estornada_em timestamptz,
  estornada_por uuid,
  motivo_estorno text
);

alter table public.pagamentos_baixas
  add column if not exists chave_idempotencia text,
  add column if not exists pagamento_id integer,
  add column if not exists valor_total_referencia numeric(14,2),
  add column if not exists documento text,
  add column if not exists observacao text,
  add column if not exists status text not null default 'efetivada',
  add column if not exists usuario_id uuid,
  add column if not exists criado_em timestamptz not null default now(),
  add column if not exists estornada_em timestamptz,
  add column if not exists estornada_por uuid,
  add column if not exists motivo_estorno text,
  -- Situação da nota ANTES desta baixa, guardada como registro do que havia.
  -- Quem decide a situação no estorno é o saldo que sobrar em aberto.
  add column if not exists situacao_anterior text;

-- As colunas de public.pagamentos_baixas em que a baixa grava valor FIXO ou
-- copiado. Elas nascem como texto acima, mas no banco em uso a tabela JÁ
-- EXISTE, e nada garante que sejam texto lá: se alguma for enum, o rótulo tem
-- de existir no tipo. situacao_anterior é o caso delicado — ela recebe a
-- situação que a nota tinha, e a situação da nota é o enum situacao_valor, com
-- seis rótulos. A gravação converte para texto explicitamente; onde a coluna
-- for enum, ela precisa aceitar todos os rótulos que a nota pode ter, senão a
-- baixa quebraria só nas notas com o rótulo que falta.
do $$
declare
  item record;
  rotulos_da_nota text[];
  tipo_real text;
  tipo_oid oid;
  eh_enum boolean;
  faltando text[];
begin
  -- Rótulos possíveis da situação da nota. Coluna de texto: array vazio, nada a
  -- exigir de situacao_anterior.
  select coalesce(array_agg(e.enumlabel::text order by e.enumsortorder), array[]::text[])
    into rotulos_da_nota
    from pg_attribute a
    join pg_enum e on e.enumtypid = a.atttypid
   where a.attrelid = to_regclass('public.valores_em_aberto')
     and a.attname::text = 'situacao'
     and not a.attisdropped;

  for item in
    select * from (values
      ('status', array['efetivada', 'estornada']),
      ('situacao_anterior', rotulos_da_nota)
    ) as alvos(coluna, rotulos)
  loop
    select format_type(a.atttypid, null), a.atttypid, t.typtype = 'e'
      into tipo_real, tipo_oid, eh_enum
      from pg_attribute a
      join pg_type t on t.oid = a.atttypid
     where a.attrelid = to_regclass('public.pagamentos_baixas')
       and a.attname::text = item.coluna
       and not a.attisdropped;

    if tipo_real is null or not coalesce(eh_enum, false) then
      continue;
    end if;

    select array_agg(rotulo order by rotulo)
      into faltando
      from unnest(item.rotulos) as rotulo
     where not exists (
       select 1 from pg_enum e
        where e.enumtypid = tipo_oid
          and e.enumlabel::text = rotulo
     );

    if faltando is not null then
      raise exception 'Enum incompatível em public.pagamentos_baixas.%: o tipo % não tem o(s) valor(es) %, e a aba de Baixas precisa gravá-lo(s). Acrescente-o(s) ao enum (alter type % add value ...) numa execução separada e rode esta migration depois.',
        item.coluna, tipo_real, array_to_string(faltando, ', '), tipo_real;
    end if;
  end loop;
end $$;

-- valor_em_aberto_id tem de ter EXATAMENTE o tipo de valores_em_aberto.id
-- (integer, bigint ou uuid, conforme o banco). Por isso o DDL é dinâmico.
do $$
declare
  tipo_nota text;
  tipo_atual text;
begin
  select format_type(a.atttypid, a.atttypmod)
    into tipo_nota
    from pg_attribute a
   where a.attrelid = to_regclass('public.valores_em_aberto')
     and a.attname::text = 'id'
     and not a.attisdropped;

  if tipo_nota is null then
    raise exception 'Estrutura incompatível: public.valores_em_aberto.id não existe.';
  end if;

  select format_type(a.atttypid, a.atttypmod)
    into tipo_atual
    from pg_attribute a
   where a.attrelid = to_regclass('public.pagamentos_baixas')
     and a.attname::text = 'valor_em_aberto_id'
     and not a.attisdropped;

  if tipo_atual is null then
    execute format('alter table public.pagamentos_baixas add column valor_em_aberto_id %s', tipo_nota);
  elsif tipo_atual is distinct from tipo_nota then
    raise exception 'Tipo incompatível em public.pagamentos_baixas.valor_em_aberto_id: a nota é % e a coluna é %.',
      tipo_nota, tipo_atual;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Índices: idempotência e as consultas da tela
-- ---------------------------------------------------------------------------
-- Chaves repetidas já gravadas impediriam o índice único, e sem ele a baixa não
-- é idempotente. Nesse caso a migration aborta explicando o que ajustar.
do $$
declare
  repetidas bigint;
begin
  select count(*) into repetidas
    from (
      select chave_idempotencia
        from public.pagamentos_baixas
       where chave_idempotencia is not null
       group by chave_idempotencia
      having count(*) > 1
    ) duplicadas;

  if repetidas > 0 then
    raise exception 'Existem % chaves de idempotência repetidas nas baixas já gravadas. Ajuste-as antes de rodar esta migration: sem chave única a baixa poderia ser registrada duas vezes.', repetidas;
  end if;
end $$;

-- É ESTE índice que impede a mesma baixa de acontecer duas vezes: duplo
-- clique, F5, reenvio e dupla confirmação chegam com a mesma chave.
create unique index if not exists pagamentos_baixas_idempotencia_idx
  on public.pagamentos_baixas (chave_idempotencia)
  where chave_idempotencia is not null;

-- Histórico de baixas de uma nota (a lista que abre quando a nota é expandida).
create index if not exists pagamentos_baixas_nota_idx
  on public.pagamentos_baixas (valor_em_aberto_id, criado_em desc)
  where valor_em_aberto_id is not null;

-- Baixas de um fornecedor por data (tela, Vida do Fornecedor e relatórios).
create index if not exists pagamentos_baixas_fornecedor_data_idx
  on public.pagamentos_baixas (fornecedor_id, data_pagamento desc);

create index if not exists pagamentos_baixas_conta_data_idx
  on public.pagamentos_baixas (conta_id, data_pagamento desc);

-- Notas em aberto de um fornecedor: é a primeira consulta da tela.
create index if not exists valores_em_aberto_fornecedor_situacao_idx
  on public.valores_em_aberto (fornecedor_id, situacao);

-- ---------------------------------------------------------------------------
-- 3.1. Auxiliar REAPROVEITADO: public.tipo_da_coluna
-- ---------------------------------------------------------------------------
-- As funções da baixa recebem os identificadores como TEXTO, porque o id da
-- nota pode ser integer, bigint ou uuid dependendo do banco. Na hora de gravar,
-- o texto tem de voltar ao tipo da coluna — e quem diz qual é esse tipo é
-- public.tipo_da_coluna, que JÁ EXISTE no banco.
--
-- ESTA MIGRATION NÃO A RECRIA, E ISSO É DE PROPÓSITO. A versão em produção
-- devolve o texto 'coluna ausente' quando a coluna não existe, e é exatamente
-- disso que o tratador de erros de confirmar_transferencias_programacao
-- depende para montar a mensagem. Trocá-la por uma versão que levanta exceção
-- quebraria esse tratador justamente no momento em que ele é acionado. Então a
-- função existente fica intacta.
--
-- A baixa só a chama para colunas de public.pagamentos_baixas que a seção 2
-- acima garante existirem, portanto o retorno 'coluna ausente' não tem como
-- aparecer por aqui. Mesmo caso de public.usuario_para_coluna, também
-- reaproveitada e não recriada.

-- ---------------------------------------------------------------------------
-- 4. Permissões próprias do módulo de Baixas
-- ---------------------------------------------------------------------------
-- As cinco ações pedidas usam as cinco colunas booleanas que a Matriz de
-- Permissões já tem, com rótulos próprios (o mesmo recurso que o módulo de
-- Backup usa). O mapa abaixo está escrito igual em src/lib/permissoesUsuario.js
-- e em src/lib/permissoesBaixas.js:
--
--   pode_visualizar -> Visualizar baixas
--   pode_cadastrar  -> Registrar baixa
--   pode_editar     -> Imprimir
--   pode_aprovar    -> Exportar
--   pode_excluir    -> Estornar baixa
--
-- As cinco são independentes: dá para conceder "Registrar baixa" sem conceder
-- "Estornar baixa".
create or replace function public.pode_em_baixas(p_acao text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_usuario uuid;
  v_coluna text;
  v_legada text;
  v_valor boolean;
  v_especial boolean;
begin
  select u.id into v_usuario
    from public.usuarios u
   where u.auth_id = auth.uid()
     and u.status = 'ativo'
   limit 1;

  if v_usuario is null then
    return false;
  end if;

  v_coluna := case p_acao
    when 'visualizar'        then 'pode_visualizar'
    when 'visualizar_baixas' then 'pode_visualizar'
    when 'registrar_baixa'   then 'pode_cadastrar'
    when 'imprimir'          then 'pode_editar'
    when 'exportar'          then 'pode_aprovar'
    when 'estornar_baixa'    then 'pode_excluir'
    else null
  end;

  if v_coluna is null then
    return false;
  end if;

  -- 1. O módulo próprio 'baixas' da Matriz de Permissões é quem manda.
  select case v_coluna
           when 'pode_visualizar' then pe.pode_visualizar
           when 'pode_cadastrar'  then pe.pode_cadastrar
           when 'pode_editar'     then pe.pode_editar
           when 'pode_aprovar'    then pe.pode_aprovar
           when 'pode_excluir'    then pe.pode_excluir
           else false
         end
    into v_valor
    from public.permissoes_efetivas pe
   where pe.usuario_id = v_usuario
     and pe.modulo = 'baixas'
   limit 1;

  -- 2. Sem linha de 'baixas' (perfil criado depois desta migration, por
  --    exemplo): vale o que a pessoa já tinha em 'pagamentos', para ninguém
  --    ficar sem acesso. Imprimir e exportar seguem a visualização.
  if v_valor is null then
    select case v_coluna
             when 'pode_visualizar' then pe.pode_visualizar
             when 'pode_cadastrar'  then pe.pode_cadastrar
             when 'pode_editar'     then pe.pode_visualizar
             when 'pode_aprovar'    then pe.pode_visualizar
             when 'pode_excluir'    then pe.pode_excluir
             else false
           end
      into v_valor
      from public.permissoes_efetivas pe
     where pe.usuario_id = v_usuario
       and pe.modulo = 'pagamentos'
     limit 1;
  end if;

  if coalesce(v_valor, false) then
    return true;
  end if;

  -- 3. Concessão avulsa da aba de permissões especiais, que já existia para a
  --    versão anterior desta tela. Ela SOMA, nunca subtrai: quem foi liberado
  --    lá continua liberado, e um "não" gravado lá (a aba grava todas as ações,
  --    marcadas ou não) não tira o que a Matriz de Permissões concedeu.
  v_legada := case p_acao
    when 'visualizar'        then 'visualizar_baixas'
    when 'visualizar_baixas' then 'visualizar_baixas'
    when 'imprimir'          then 'visualizar_baixas'
    when 'exportar'          then 'visualizar_baixas'
    when 'registrar_baixa'   then 'registrar_baixa'
    when 'estornar_baixa'    then 'estornar_baixa'
    else null
  end;

  if v_legada is not null and to_regclass('public.permissoes_especiais') is not null then
    begin
      execute 'select pe.permitido from public.permissoes_especiais pe where pe.usuario_id = $1 and pe.acao = $2 limit 1'
        into v_especial
        using v_usuario, v_legada;
      if coalesce(v_especial, false) then
        return true;
      end if;
    exception when others then
      v_especial := null; -- estrutura diferente: só a Matriz de Permissões vale
    end;
  end if;

  return false;
end $$;

grant execute on function public.pode_em_baixas(text) to authenticated;

comment on function public.pode_em_baixas(text)
is 'As cinco permissões do módulo de Baixas (visualizar, registrar baixa, imprimir, exportar, estornar). Vale o módulo baixas da Matriz de Permissões, com o módulo pagamentos como padrão na falta dele; a concessão avulsa de permissões especiais soma, nunca subtrai.';

-- A ORDEM AQUI IMPORTA: a restrição de lista fixa de módulos é relaxada
-- ANTES de qualquer insert com modulo = 'baixas'. Na ordem inversa, o próprio
-- seed abaixo seria recusado pela restrição e a migration inteira abortaria.
-- Bancos em que "modulo" tem lista fixa de módulos aceitos rejeitariam a
-- exceção individual de Baixas na hora de salvar. A restrição é recriada como
-- "(condição original) or modulo = 'baixas'": tudo que era aceito continua
-- aceito, só o módulo novo é acrescentado.
do $$
declare
  tabela text;
  restricao record;
  corpo text;
begin
  foreach tabela in array array['public.permissoes_excecao', 'public.perfis_permissoes']
  loop
    if to_regclass(tabela) is null then
      continue;
    end if;

    for restricao in
      select conname, pg_get_constraintdef(oid) as definicao
        from pg_constraint
       where conrelid = to_regclass(tabela)
         and contype = 'c'
         and pg_get_constraintdef(oid) like '%modulo%'
         and pg_get_constraintdef(oid) like '%''pagamentos''%'
         and pg_get_constraintdef(oid) not like '%''baixas''%'
    loop
      corpo := regexp_replace(restricao.definicao, '\s+NOT VALID$', '');
      corpo := regexp_replace(corpo, '^CHECK\s*', '');

      execute format('alter table %s drop constraint %I', tabela, restricao.conname);
      execute format(
        'alter table %s add constraint %I check ((%s) or modulo = ''baixas'')',
        tabela, restricao.conname, corpo
      );
    end loop;
  end loop;
end $$;

-- Padrão do perfil para 'baixas': cópia do que o perfil já tem em
-- 'pagamentos'. Imprimir e Exportar seguem a visualização.
insert into public.perfis_permissoes (
  perfil_id, modulo,
  pode_visualizar, pode_cadastrar, pode_editar, pode_excluir, pode_aprovar, pode_visualizar_valores
)
select
  pp.perfil_id,
  'baixas',
  pp.pode_visualizar,
  pp.pode_cadastrar,
  pp.pode_visualizar,
  pp.pode_excluir,
  pp.pode_visualizar,
  false
from public.perfis_permissoes pp
where pp.modulo = 'pagamentos'
  and not exists (
    select 1 from public.perfis_permissoes x
     where x.perfil_id = pp.perfil_id and x.modulo = 'baixas'
  );

-- Perfis que não têm nem linha de 'pagamentos': só Administrador nasce liberado.
insert into public.perfis_permissoes (
  perfil_id, modulo,
  pode_visualizar, pode_cadastrar, pode_editar, pode_excluir, pode_aprovar, pode_visualizar_valores
)
select
  p.id,
  'baixas',
  p.nome = 'Administrador',
  p.nome = 'Administrador',
  p.nome = 'Administrador',
  p.nome = 'Administrador',
  p.nome = 'Administrador',
  false
from public.perfis_acesso p
where not exists (
  select 1 from public.perfis_permissoes x
   where x.perfil_id = p.id and x.modulo = 'baixas'
);


-- ---------------------------------------------------------------------------
-- 5. RLS da razão de baixas
-- ---------------------------------------------------------------------------
-- Leitura para quem está autenticado (a tela filtra pelo que a pessoa pode
-- ver). Gravação SÓ pelas funções desta migration, que são security definer e
-- conferem a permissão antes de registrar qualquer centavo — por isso não
-- existe política de insert, update ou delete aqui.
alter table public.pagamentos_baixas enable row level security;

drop policy if exists "pagamentos_baixas_select" on public.pagamentos_baixas;
create policy "pagamentos_baixas_select"
  on public.pagamentos_baixas
  for select
  to authenticated
  using (true);

grant select on public.pagamentos_baixas to authenticated;
revoke insert, update, delete, truncate on public.pagamentos_baixas from authenticated;
revoke all on public.pagamentos_baixas from anon;

-- ---------------------------------------------------------------------------
-- 6. Registrar a baixa de uma nota
-- ---------------------------------------------------------------------------
-- Parcial ou integral. O parâmetro da nota é TEXTO de propósito: o id de
-- public.valores_em_aberto pode ser integer, bigint ou uuid dependendo do
-- banco, e a comparação por ::text funciona em todos.
--
-- NÃO MOVIMENTA SALDO. Confira: abaixo não existe uma única escrita em
-- saldos_historico, pagamento_movimentacoes ou contas_bancarias.
create or replace function public.registrar_baixa_nota(
  p_chave_idempotencia text,
  p_valor_em_aberto_id text,
  p_valor numeric,
  p_data_pagamento date,
  p_conta_id integer,
  p_observacao text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_usuario uuid;
  v_chave text;
  v_valor numeric(14,2);
  v_nota record;
  v_conta record;
  v_valor_nota numeric(14,2);
  v_pago_antes numeric(14,2);
  v_aberto_antes numeric(14,2);
  v_pago_depois numeric(14,2);
  v_aberto_depois numeric(14,2);
  v_situacao_nova text;
  v_baixa_id text;
  v_existente record;
  v_tipo_nota text;
  v_tipo_fornecedor text;
  v_tipo_conta text;
  -- Os tipos reais das colunas de situação: no banco em uso a situação da nota
  -- é o enum situacao_valor e situacao_anterior é texto, e a gravação precisa
  -- converter para o tipo de cada uma.
  v_tipo_situacao text;
  v_tipo_situacao_anterior text;
  v_documento text;
  v_observacao text;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado.' using errcode = '42501';
  end if;

  if not public.pode_em_baixas('registrar_baixa') then
    raise exception 'Você não tem permissão para registrar baixas de pagamento.' using errcode = '42501';
  end if;

  v_chave := nullif(trim(coalesce(p_chave_idempotencia, '')), '');
  if v_chave is null then
    raise exception 'A baixa precisa de um identificador único para não ser registrada duas vezes.';
  end if;

  if nullif(trim(coalesce(p_valor_em_aberto_id, '')), '') is null then
    raise exception 'Informe a nota do fornecedor que está sendo baixada.';
  end if;

  v_valor := round(coalesce(p_valor, 0), 2);
  if v_valor <= 0 then
    raise exception 'O valor da baixa deve ser maior que zero.';
  end if;

  if p_data_pagamento is null then
    raise exception 'Informe a data do pagamento.';
  end if;

  if p_conta_id is null then
    raise exception 'Informe a conta bancária utilizada no pagamento.';
  end if;

  -- Baixa já registrada com esta chave: devolve a mesma resposta e não repete
  -- nada. É o duplo clique / F5 / reenvio chegando de novo.
  select b.id::text as id, b.valor_pago, b.data_pagamento, b.conta_id, b.status
    into v_existente
    from public.pagamentos_baixas b
   where b.chave_idempotencia = v_chave
   limit 1;

  if found then
    return jsonb_build_object(
      'ok', true,
      'ja_registrada', true,
      'baixa_id', v_existente.id,
      'valor_pago', v_existente.valor_pago,
      'movimentou_saldo', false
    );
  end if;

  -- A nota, travada até o fim da transação: duas baixas simultâneas na mesma
  -- nota entram em fila e o valor em aberto nunca é lido desatualizado.
  -- A situação vem ::text de propósito: a coluna é o enum situacao_valor no
  -- banco em uso, e lida como texto ela compara, entra no evento de auditoria e
  -- é guardada em situacao_anterior sem depender do tipo.
  select v.id::text as id, v.fornecedor_id, v.valor, coalesce(v.valor_pago, 0) as valor_pago,
         v.situacao::text as situacao, v.numero_nota_fiscal, v.data_vencimento
    into v_nota
    from public.valores_em_aberto v
   where v.id::text = p_valor_em_aberto_id
     for update;

  if not found then
    raise exception 'A nota informada não foi encontrada. Atualize a tela e tente novamente.';
  end if;

  -- Comparação de texto com texto: um rótulo de enum lido como texto é o
  -- próprio rótulo, então 'cancelado' continua sendo 'cancelado'.
  if v_nota.situacao = 'cancelado' then
    raise exception 'Esta nota está cancelada e não recebe baixas.';
  end if;

  v_valor_nota := round(coalesce(v_nota.valor, 0), 2);
  v_pago_antes := round(coalesce(v_nota.valor_pago, 0), 2);
  v_aberto_antes := round(v_valor_nota - v_pago_antes, 2);

  if v_aberto_antes <= 0.004 then
    raise exception 'Esta nota já está quitada e não recebe novas baixas.';
  end if;

  if v_valor > v_aberto_antes + 0.004 then
    raise exception 'O valor da baixa (R$ %) é maior do que o valor em aberto da nota (R$ %). Informe um valor até o que está em aberto.',
      translate(to_char(v_valor, 'FM999,999,999,990.00'), ',.', '.,'),
      translate(to_char(v_aberto_antes, 'FM999,999,999,990.00'), ',.', '.,');
  end if;

  select c.id, c.nome_conta, coalesce(c.ativo, true) as ativo
    into v_conta
    from public.contas_bancarias c
   where c.id = p_conta_id;

  if not found then
    raise exception 'A conta bancária informada não foi encontrada.';
  end if;
  if v_conta.ativo is not true then
    raise exception 'Conta bancária desativada não pode ser usada em uma baixa.';
  end if;

  v_pago_depois := round(v_pago_antes + v_valor, 2);
  v_aberto_depois := round(v_valor_nota - v_pago_depois, 2);
  if v_aberto_depois < 0 then
    v_aberto_depois := 0;
  end if;

  -- Quitou: grava 'pago' e a nota sai da lista de notas em aberto. Sobrou
  -- saldo: a nota CONTINUA 'em_aberto' e recebe quantas baixas precisar. O
  -- abatimento parcial não muda a situação — ele fica em valor_pago, e o que
  -- resta em aberto continua sendo valor - valor_pago.
  v_situacao_nova := case when v_aberto_depois <= 0.004 then 'pago' else 'em_aberto' end;

  v_documento := nullif(trim(coalesce(v_nota.numero_nota_fiscal, '')), '');
  v_observacao := nullif(trim(coalesce(p_observacao, '')), '');
  v_usuario := public.usuario_para_coluna('pagamentos_baixas', 'usuario_id');

  -- Os tipos reais das colunas de vínculo: a baixa recebe tudo como texto e
  -- devolve para a coluna no tipo que ela tem, seja integer, bigint ou uuid.
  v_tipo_nota := public.tipo_da_coluna('pagamentos_baixas', 'valor_em_aberto_id');
  v_tipo_fornecedor := public.tipo_da_coluna('pagamentos_baixas', 'fornecedor_id');
  v_tipo_conta := public.tipo_da_coluna('pagamentos_baixas', 'conta_id');
  v_tipo_situacao := public.tipo_da_coluna('valores_em_aberto', 'situacao');
  v_tipo_situacao_anterior := public.tipo_da_coluna('pagamentos_baixas', 'situacao_anterior');

  -- O insert é a tranca da idempotência: o índice único da chave garante uma
  -- baixa só. `on conflict do nothing` sem id devolvido = alguém chegou antes,
  -- e então a nota NÃO é abatida de novo.
  execute format($sql$
    insert into public.pagamentos_baixas (
      chave_idempotencia, fornecedor_id, valor_em_aberto_id, valor_total_referencia,
      valor_pago, data_pagamento, conta_id, documento, observacao,
      status, situacao_anterior, usuario_id
    ) values (
      $1, $2::%s, $3::%s, $4, $5, $6, $7::%s, $8, $9, 'efetivada', $10::%s, $11
    )
    on conflict (chave_idempotencia) where chave_idempotencia is not null do nothing
    returning id::text
  $sql$, v_tipo_fornecedor, v_tipo_nota, v_tipo_conta, v_tipo_situacao_anterior)
    into v_baixa_id
   using v_chave, v_nota.fornecedor_id::text, v_nota.id, v_valor_nota, v_valor,
         p_data_pagamento, p_conta_id::text, v_documento, v_observacao,
         v_nota.situacao, v_usuario;

  if v_baixa_id is null then
    select b.id::text as id, b.valor_pago
      into v_existente
      from public.pagamentos_baixas b
     where b.chave_idempotencia = v_chave
     limit 1;

    return jsonb_build_object(
      'ok', true,
      'ja_registrada', true,
      'baixa_id', v_existente.id,
      'valor_pago', v_existente.valor_pago,
      'movimentou_saldo', false
    );
  end if;

  -- O ÚNICO efeito da baixa fora da própria razão: o valor em aberto da nota.
  -- A situação nova é calculada como texto e convertida para o tipo REAL da
  -- coluna (o enum situacao_valor no banco em uso, text em bancos novos). Sem a
  -- conversão, gravar texto numa coluna de enum não é aceito.
  execute format($sql$
    update public.valores_em_aberto
       set valor_pago = $1,
           situacao = $2::%s
     where id::text = $3
  $sql$, v_tipo_situacao)
   using v_pago_depois, v_situacao_nova, p_valor_em_aberto_id;

  insert into public.auditoria_eventos (
    usuario_id, modulo, acao, registro_afetado, valor_anterior, valor_novo, nivel
  ) values (
    v_usuario,
    'pagamentos',
    'registrou_baixa',
    'Baixa de pagamento — nota ' || coalesce(v_documento, v_nota.id),
    jsonb_build_object(
      'valor_em_aberto_id', v_nota.id,
      'situacao', v_nota.situacao,
      'valor_pago', v_pago_antes,
      'valor_em_aberto', v_aberto_antes
    ),
    jsonb_build_object(
      'baixa_id', v_baixa_id,
      'fornecedor_id', v_nota.fornecedor_id,
      'valor_da_baixa', v_valor,
      'data_pagamento', p_data_pagamento,
      'conta_id', p_conta_id,
      'situacao', v_situacao_nova,
      'valor_pago', v_pago_depois,
      'valor_em_aberto', v_aberto_depois,
      'quitada', v_aberto_depois <= 0.004,
      'observacao', v_observacao,
      -- A baixa registra o pagamento; ela não debita conta nenhuma.
      'movimentou_saldo', false
    ),
    'atencao'
  );

  return jsonb_build_object(
    'ok', true,
    'ja_registrada', false,
    'baixa_id', v_baixa_id,
    'valor_em_aberto_id', v_nota.id,
    'fornecedor_id', v_nota.fornecedor_id,
    'valor_da_baixa', v_valor,
    'valor_total', v_valor_nota,
    'valor_pago', v_pago_depois,
    'valor_em_aberto', v_aberto_depois,
    'situacao', v_situacao_nova,
    'quitada', v_aberto_depois <= 0.004,
    'movimentou_saldo', false
  );
end;
$fn$;

grant execute on function public.registrar_baixa_nota(text, text, numeric, date, integer, text) to authenticated;

comment on function public.registrar_baixa_nota(text, text, numeric, date, integer, text)
is 'Registra a baixa (parcial ou integral) de uma nota do fornecedor. Transacional e idempotente pela chave. Abate o valor em aberto da nota e NÃO movimenta saldo de conta alguma.';

-- ---------------------------------------------------------------------------
-- 7. Estornar uma baixa
-- ---------------------------------------------------------------------------
-- Baixa não se apaga: o estorno marca a original como estornada, guarda o
-- motivo e devolve o valor para "em aberto". O registro continua na razão, na
-- Vida do Fornecedor, no Histórico e na Auditoria.
create or replace function public.estornar_baixa_nota(
  p_baixa_id text,
  p_motivo text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_usuario uuid;
  v_motivo text;
  v_baixa record;
  v_nota record;
  v_valor_nota numeric(14,2);
  v_pago_antes numeric(14,2);
  v_pago_depois numeric(14,2);
  v_aberto_depois numeric(14,2);
  v_situacao_nova text;
  -- O tipo real da situação da nota: enum situacao_valor no banco em uso.
  v_tipo_situacao text;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado.' using errcode = '42501';
  end if;

  if not public.pode_em_baixas('estornar_baixa') then
    raise exception 'Você não tem permissão para estornar baixas de pagamento.' using errcode = '42501';
  end if;

  if nullif(trim(coalesce(p_baixa_id, '')), '') is null then
    raise exception 'Informe qual baixa deve ser estornada.';
  end if;

  v_motivo := nullif(trim(coalesce(p_motivo, '')), '');
  if v_motivo is null then
    raise exception 'Informe a justificativa do estorno.';
  end if;
  if length(v_motivo) < 5 then
    raise exception 'A justificativa do estorno precisa explicar o motivo (use ao menos 5 caracteres).';
  end if;

  -- status e situacao_anterior vêm ::text: no banco em uso a tabela já existia,
  -- e lidas como texto elas comparam e entram no evento de auditoria seja a
  -- coluna texto ou enum.
  select b.id::text as id, b.valor_em_aberto_id::text as nota_id, b.fornecedor_id,
         b.valor_pago, b.conta_id, b.data_pagamento, b.status::text as status,
         b.situacao_anterior::text as situacao_anterior, b.documento
    into v_baixa
    from public.pagamentos_baixas b
   where b.id::text = p_baixa_id
     for update;

  if not found then
    raise exception 'A baixa informada não foi encontrada. Atualize a tela e tente novamente.';
  end if;

  -- Idempotente: estornar duas vezes não devolve o valor duas vezes.
  if v_baixa.status = 'estornada' then
    return jsonb_build_object(
      'ok', true,
      'ja_estornada', true,
      'baixa_id', v_baixa.id,
      'movimentou_saldo', false
    );
  end if;

  if v_baixa.nota_id is null then
    raise exception 'Esta baixa não está ligada a uma nota do fornecedor e não pode ser estornada por esta tela.';
  end if;

  select v.id::text as id, v.valor, coalesce(v.valor_pago, 0) as valor_pago,
         v.situacao::text as situacao
    into v_nota
    from public.valores_em_aberto v
   where v.id::text = v_baixa.nota_id
     for update;

  if not found then
    raise exception 'A nota desta baixa não foi encontrada. Atualize a tela e tente novamente.';
  end if;

  v_valor_nota := round(coalesce(v_nota.valor, 0), 2);
  v_pago_antes := round(coalesce(v_nota.valor_pago, 0), 2);
  v_pago_depois := round(v_pago_antes - round(coalesce(v_baixa.valor_pago, 0), 2), 2);
  if v_pago_depois < 0 then
    v_pago_depois := 0;
  end if;
  v_aberto_depois := round(v_valor_nota - v_pago_depois, 2);

  -- A MESMA regra do registro, pelo avesso: sobrou saldo em aberto, a nota
  -- volta para 'em_aberto' (tenha o estorno zerado o valor baixado ou apenas
  -- devolvido parte dele). Só continua 'pago' se, depois do estorno, não
  -- sobrar nada em aberto.
  v_situacao_nova := case when v_aberto_depois <= 0.004 then 'pago' else 'em_aberto' end;

  v_usuario := public.usuario_para_coluna('pagamentos_baixas', 'estornada_por');

  -- A baixa original PERMANECE: só muda de situação e ganha o motivo.
  update public.pagamentos_baixas
     set status = 'estornada',
         estornada_em = now(),
         estornada_por = v_usuario,
         motivo_estorno = v_motivo
   where id::text = p_baixa_id;

  -- O valor volta para "em aberto". Mesma conversão do registro: a situação
  -- nova é texto e vai para a coluna no tipo que ela tem de fato.
  v_tipo_situacao := public.tipo_da_coluna('valores_em_aberto', 'situacao');

  execute format($sql$
    update public.valores_em_aberto
       set valor_pago = $1,
           situacao = $2::%s
     where id::text = $3
  $sql$, v_tipo_situacao)
   using v_pago_depois, v_situacao_nova, v_baixa.nota_id;

  insert into public.auditoria_eventos (
    usuario_id, modulo, acao, registro_afetado, valor_anterior, valor_novo, nivel
  ) values (
    v_usuario,
    'pagamentos',
    'estornou_baixa',
    'Estorno de baixa — nota ' || coalesce(nullif(trim(coalesce(v_baixa.documento, '')), ''), v_nota.id),
    jsonb_build_object(
      'baixa_id', v_baixa.id,
      'status', v_baixa.status,
      'valor_da_baixa', v_baixa.valor_pago,
      'conta_id', v_baixa.conta_id,
      'data_pagamento', v_baixa.data_pagamento,
      'situacao_da_nota', v_nota.situacao,
      'valor_pago', v_pago_antes
    ),
    jsonb_build_object(
      'baixa_id', v_baixa.id,
      'status', 'estornada',
      'motivo', v_motivo,
      'situacao_da_nota', v_situacao_nova,
      'valor_pago', v_pago_depois,
      'valor_em_aberto', v_aberto_depois,
      -- O estorno devolve o valor para "em aberto"; ele não credita conta alguma.
      'movimentou_saldo', false,
      'preservada', true
    ),
    'critico'
  );

  return jsonb_build_object(
    'ok', true,
    'ja_estornada', false,
    'baixa_id', v_baixa.id,
    'valor_em_aberto_id', v_nota.id,
    'valor_estornado', v_baixa.valor_pago,
    'valor_pago', v_pago_depois,
    'valor_em_aberto', v_aberto_depois,
    'situacao', v_situacao_nova,
    'movimentou_saldo', false
  );
end;
$fn$;

grant execute on function public.estornar_baixa_nota(text, text) to authenticated;

comment on function public.estornar_baixa_nota(text, text)
is 'Estorna uma baixa devolvendo o valor para "em aberto" na nota. Exige justificativa, PRESERVA a baixa original (nunca apaga) e NÃO movimenta saldo de conta alguma.';

commit;
