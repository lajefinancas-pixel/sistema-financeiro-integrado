-- Lixeira do sistema — restauração e exclusão definitiva.
--
-- Complemento de 20260823150000_exclusao_controlada_por_permissao.sql, que criou
-- a exclusão lógica (`excluido_em` / `excluido_por`) em fornecedores, certidões e
-- pagamentos. Nada da exclusão já existente muda aqui: o modal de confirmação, o
-- motivo obrigatório e a gravação de `excluido_em` continuam exatamente como
-- estão. Esta migration só acrescenta o que a Lixeira precisa para desfazer ou
-- concluir aquela exclusão.
--
-- O que esta migration faz:
--   1. Cria public.pode_em_administracao(acao) — a mesma checagem de permissão
--      por módulo já usada em certidões e tarefas, agora para 'administracao'.
--   2. Cria public.pode_gerenciar_lixeira() (pode_editar em 'administracao') e
--      public.pode_excluir_definitivamente() (pode_excluir em 'administracao' E
--      perfil Administrador) — duas permissões distintas, de propósito: ver e
--      restaurar é uma coisa, apagar para sempre é outra.
--   3. Libera a LEITURA das linhas já excluídas logicamente para quem gerencia a
--      Lixeira, sem abrir nada além disso: as políticas novas só valem para
--      linhas com `excluido_em is not null`.
--   4. Cria public.restaurar_registro(...) — limpa excluido_em/excluido_por (e
--      reativa o fornecedor, que a exclusão também marcou como inativo) e grava
--      o evento 'restaurou' na auditoria.
--   5. Cria public.excluir_definitivamente(...) — confere permissão, motivo e
--      vínculos, apaga a linha de verdade e grava o evento crítico
--      'excluiu_definitivamente' com a cópia integral do registro apagado.
--
-- As duas funções são SECURITY DEFINER e fazem a exclusão/restauração e o
-- registro de auditoria na MESMA transação: ou as duas coisas acontecem, ou
-- nenhuma. Nenhum saldo, rateio, pagamento efetivado ou permissão existente é
-- alterado. A migration é IDEMPOTENTE: pode ser rodada mais de uma vez.

-- ---------------------------------------------------------------------------
-- 1. Permissões
-- ---------------------------------------------------------------------------
create or replace function public.pode_em_administracao(acao text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.usuarios u
    join public.permissoes_efetivas pe
      on pe.usuario_id = u.id
     and pe.modulo = 'administracao'
    where u.auth_id = auth.uid()
      and u.status = 'ativo'
      and case acao
            when 'visualizar' then pe.pode_visualizar
            when 'cadastrar'  then pe.pode_cadastrar
            when 'editar'     then pe.pode_editar
            when 'excluir'    then pe.pode_excluir
            when 'aprovar'    then pe.pode_aprovar
            else false
          end
  );
$$;

-- Abrir a Lixeira e restaurar: permissão elevada, mas reversível.
create or replace function public.pode_gerenciar_lixeira()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.pode_em_administracao('editar');
$$;

-- Apagar de vez: permissão própria E perfil Administrador. Ter pode_excluir em
-- 'administracao' sem ser Administrador não basta.
create or replace function public.pode_excluir_definitivamente()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.pode_em_administracao('excluir')
     and exists (
       select 1
       from public.usuarios u
       join public.perfis_acesso p on p.id = u.perfil_id
       where u.auth_id = auth.uid()
         and u.status = 'ativo'
         and p.nome = 'Administrador'
     );
$$;

-- ---------------------------------------------------------------------------
-- 2. Leitura das linhas excluídas para quem gerencia a Lixeira
-- ---------------------------------------------------------------------------
-- A Lixeira lista registros de três módulos diferentes; quem administra o
-- sistema pode não ter permissão de leitura em cada um deles. As políticas
-- abaixo se somam às que já existem (políticas permissivas são combinadas com
-- OU) e alcançam apenas as linhas já excluídas logicamente — nenhum registro
-- vigente passa a ser visível por causa delas.
do $$
declare
  alvo text;
begin
  foreach alvo in array array['fornecedores', 'certidoes', 'pagamentos'] loop
    if to_regclass('public.' || alvo) is null then
      raise notice 'Tabela public.% não existe neste banco: política da Lixeira não criada.', alvo;
      continue;
    end if;

    execute format('drop policy if exists %I on public.%I', alvo || '_select_lixeira', alvo);
    execute format(
      'create policy %I on public.%I for select to authenticated
         using (public.pode_gerenciar_lixeira() and excluido_em is not null)',
      alvo || '_select_lixeira', alvo
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Restaurar
-- ---------------------------------------------------------------------------
-- Restaurar devolve o registro às listagens normais e registra o evento
-- 'restaurou' no módulo correspondente. O motivo NÃO é exigido aqui: a ação é
-- reversível (basta excluir de novo, pelo fluxo de sempre).
create or replace function public.restaurar_registro(
  p_tabela text,
  p_id text,
  p_rotulo text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  registro jsonb;
  autor uuid;
  reativar text := '';
begin
  if p_tabela not in ('fornecedores', 'certidoes', 'pagamentos') then
    return jsonb_build_object('ok', false, 'motivo', 'tabela_invalida');
  end if;

  if not public.pode_gerenciar_lixeira() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;

  autor := public.meu_usuario_ativo_id();

  execute format('select to_jsonb(t) from public.%I t where t.id::text = $1', p_tabela)
    into registro using p_id;

  if registro is null then
    return jsonb_build_object('ok', false, 'motivo', 'registro_nao_encontrado');
  end if;

  if registro->>'excluido_em' is null then
    return jsonb_build_object('ok', true, 'ja_restaurado', true, 'auditado', false);
  end if;

  -- O fornecedor é excluído com `ativo = false` junto; restaurar sem reativar
  -- deixaria o cadastro fora das listagens do mesmo jeito.
  if p_tabela = 'fornecedores'
     and exists (
       select 1 from pg_attribute
        where attrelid = 'public.fornecedores'::regclass
          and attname = 'ativo'
          and not attisdropped
     )
  then
    reativar := ', ativo = true';
  end if;

  execute format(
    'update public.%I set excluido_em = null, excluido_por = null%s where id::text = $1',
    p_tabela, reativar
  ) using p_id;

  insert into public.auditoria_eventos (
    usuario_id, modulo, acao, registro_afetado, valor_anterior, valor_novo, resultado, nivel
  )
  values (
    autor,
    p_tabela,
    'restaurou',
    coalesce(nullif(btrim(coalesce(p_rotulo, '')), ''), p_tabela || ' ' || p_id),
    jsonb_build_object(
      'situacao', 'Excluído do sistema (exclusão lógica)',
      'excluido_em', registro->>'excluido_em'
    ),
    jsonb_build_object('situacao', 'Restaurado pela Lixeira do sistema'),
    'sucesso',
    'atencao'
  );

  return jsonb_build_object('ok', true, 'ja_restaurado', false, 'auditado', true);
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 4. Excluir definitivamente
-- ---------------------------------------------------------------------------
-- Aqui a linha sai do banco de verdade. Por isso a função confere, nesta ordem:
-- permissão específica, justificativa, registro realmente na Lixeira e vínculos
-- que quebrariam o sistema. Só então apaga — e grava o evento crítico com a
-- cópia integral do registro, que passa a ser o único lugar onde ele existe.
create or replace function public.excluir_definitivamente(
  p_tabela text,
  p_id text,
  p_motivo text,
  p_rotulo text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  registro jsonb;
  autor uuid;
  motivo text := btrim(coalesce(p_motivo, ''));
  quantidade bigint;
  partes text[] := array[]::text[];
begin
  if p_tabela not in ('fornecedores', 'certidoes', 'pagamentos') then
    return jsonb_build_object('ok', false, 'motivo', 'tabela_invalida');
  end if;

  if not public.pode_excluir_definitivamente() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;

  if length(motivo) < 5 then
    return jsonb_build_object('ok', false, 'motivo', 'justificativa_obrigatoria');
  end if;

  autor := public.meu_usuario_ativo_id();

  execute format('select to_jsonb(t) from public.%I t where t.id::text = $1', p_tabela)
    into registro using p_id;

  if registro is null then
    return jsonb_build_object('ok', false, 'motivo', 'registro_nao_encontrado');
  end if;

  -- Só o que já está na Lixeira pode ser apagado: a exclusão definitiva nunca é
  -- um atalho da exclusão comum.
  if registro->>'excluido_em' is null then
    return jsonb_build_object('ok', false, 'motivo', 'registro_vigente');
  end if;

  -- Vínculos que impedem o apagamento. Mesma regra do bloqueio da exclusão
  -- lógica de fornecedores, com uma diferença: aqui contam TAMBÉM os registros
  -- que já estão na Lixeira, porque a linha some do banco e a referência deles
  -- ficaria apontando para o vazio.
  if p_tabela = 'fornecedores' then
    if to_regclass('public.pagamentos') is not null then
      execute 'select count(*) from public.pagamentos where fornecedor_id::text = $1'
        into quantidade using p_id;
      if quantidade > 0 then
        partes := partes || format('%s %s', quantidade, case when quantidade = 1 then 'pagamento' else 'pagamentos' end);
      end if;
    end if;

    if to_regclass('public.certidoes') is not null then
      execute 'select count(*) from public.certidoes where fornecedor_id::text = $1'
        into quantidade using p_id;
      if quantidade > 0 then
        partes := partes || format('%s %s', quantidade, case when quantidade = 1 then 'certidão' else 'certidões' end);
      end if;
    end if;

    if to_regclass('public.valores_em_aberto') is not null then
      execute 'select count(*) from public.valores_em_aberto where fornecedor_id::text = $1'
        into quantidade using p_id;
      if quantidade > 0 then
        partes := partes || format('%s %s', quantidade, case when quantidade = 1 then 'valor em aberto' else 'valores em aberto' end);
      end if;
    end if;

  elsif p_tabela = 'pagamentos' then
    if to_regclass('public.pagamento_movimentacoes') is not null then
      execute 'select count(*) from public.pagamento_movimentacoes where pagamento_id::text = $1'
        into quantidade using p_id;
      if quantidade > 0 then
        partes := partes || format(
          '%s %s de débito em conta',
          quantidade,
          case when quantidade = 1 then 'lançamento' else 'lançamentos' end
        );
      end if;
    end if;
  end if;

  if array_length(partes, 1) > 0 then
    return jsonb_build_object(
      'ok', false,
      'motivo', 'possui_vinculos',
      'vinculos', array_to_string(partes, ' e ')
    );
  end if;

  begin
    execute format('delete from public.%I where id::text = $1', p_tabela) using p_id;
  exception
    when foreign_key_violation then
      return jsonb_build_object('ok', false, 'motivo', 'possui_vinculos', 'vinculos', 'outros registros do sistema');
  end;

  insert into public.auditoria_eventos (
    usuario_id, modulo, acao, registro_afetado, valor_anterior, valor_novo, resultado, nivel
  )
  values (
    autor,
    p_tabela,
    'excluiu_definitivamente',
    coalesce(nullif(btrim(coalesce(p_rotulo, '')), ''), p_tabela || ' ' || p_id),
    registro,
    jsonb_build_object(
      'situacao', 'Apagado permanentemente do banco de dados',
      'motivo_exclusao', motivo
    ),
    'sucesso',
    'critico'
  );

  return jsonb_build_object('ok', true, 'auditado', true);
end;
$fn$;

revoke all on function public.pode_em_administracao(text) from public;
revoke all on function public.pode_gerenciar_lixeira() from public;
revoke all on function public.pode_excluir_definitivamente() from public;
revoke all on function public.restaurar_registro(text, text, text) from public;
revoke all on function public.excluir_definitivamente(text, text, text, text) from public;

grant execute on function public.pode_em_administracao(text) to authenticated;
grant execute on function public.pode_gerenciar_lixeira() to authenticated;
grant execute on function public.pode_excluir_definitivamente() to authenticated;
grant execute on function public.restaurar_registro(text, text, text) to authenticated;
grant execute on function public.excluir_definitivamente(text, text, text, text) to authenticated;
