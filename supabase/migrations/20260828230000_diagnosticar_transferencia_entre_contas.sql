-- =============================================================================
-- Transferência entre contas: diagnóstico no erro e conversões à prova de tipo
-- =============================================================================
--
-- O PROBLEMA QUE ESTA MIGRATION RESOLVE
--
-- Uma transferência VÁLIDA (mesma secretaria, saldo suficiente, somas conferidas)
-- era recusada e a tela mostrava só "Não foi possível concluir a operação.": sem
-- etapa, sem código, sem detalhe. Duas causas somadas:
--
--   1. public.confirmar_transferencias_programacao e public.estornar_transferencia
--      não tinham o tratamento de exceção que a 20260828170000 deu às funções da
--      Fase 1. Qualquer recusa inesperada saía como o código cru do Postgres, sem
--      dizer em que etapa quebrou nem qual o tipo real das colunas envolvidas.
--   2. public.definir_conta_origem_pagamento ficou sem as conversões à prova de
--      tipo que as outras funções receberam: comparava pr.status, pr.fechado,
--      pc.ativa e p.situacao sem ::text. É o mesmo padrão que causou o 22P02 na
--      aprovação, e ele também estava nas leituras de contas_bancarias.ativo das
--      duas funções de transferência.
--
-- O QUE ESTA MIGRATION FAZ
--
--   1. public.tipo_da_coluna -> recriada igual à da 20260828170000, para esta
--      migration poder rodar sozinha.
--   2. public.diagnostico_transferencia_contas -> retrato do banco, só leitura:
--      vínculo real de cada coluna de usuário, o que usuario_para_coluna resolve
--      nelas, o índice único de saldos_historico (conta_id, data_saldo), a
--      permissão de transferir, dono e RLS forçada das tabelas gravadas, colunas
--      obrigatórias sem default, restrições de verificação, gatilhos e o retrato
--      do par origem/destino informado.
--   3. Recria as três funções com o nome da ETAPA em qualquer falha inesperada e
--      com as comparações à prova de tipo.
--
-- REGRAS PRESERVADAS, SEM EXCEÇÃO
--
--   * SEGREGAÇÃO POR SECRETARIA: a conferência continua idêntica, incluindo a
--     única exceção (Finanças para Saúde, Educação e Assistência Social).
--   * IDEMPOTÊNCIA: o insert com `on conflict (chave_idempotencia) do nothing` e
--     o retorno da primeira confirmação continuam intactos.
--   * ADVISORY LOCK: pg_advisory_xact_lock(918273645, conta) por conta envolvida,
--     na mesma ordem. É travamento de transação: o bloco de exceção não o solta.
--   * ATOMICIDADE saída/entrada: continuam na MESMA transação. O tratamento de
--     exceção RELEVANTA o erro, então nada é confirmado pela metade.
--   * TRILHA ATÔMICA NA TRANSFERÊNCIA: aqui o saldo se move, então o evento de
--     auditoria continua caindo junto com a movimentação -- ele NÃO é isolado,
--     ao contrário do que a Fase 1 faz onde nada de dinheiro se move.
--   * NÃO É DESPESA: nenhuma escrita em pagamento_movimentacoes, pagamentos_baixas
--     ou marcação de nota paga. 'eh_despesa', false continua no retorno.
--   * Nenhuma tabela, coluna, política, índice ou permissão é criada, alterada ou
--     removida. Nenhum dado é apagado ou reescrito.
--   * Nada de Saldos das Contas, Fornecedores, Certidões, Baixas, Tarefas,
--     Histórico, Relatórios, Auditoria (estrutura) ou Configurações é tocado.
--
-- IDEMPOTENTE: pode rodar quantas vezes for preciso. Só substitui corpo de
-- função, mantendo assinatura, tipo de retorno e grants.

begin;

-- ---------------------------------------------------------------------------
-- 1. Tipo real de uma coluna, para o erro poder dizer a verdade
-- ---------------------------------------------------------------------------
-- Corpo igual ao da 20260828170000. Só lê catálogo do Postgres: nenhum dado da
-- aplicação passa por aqui.
create or replace function public.tipo_da_coluna(p_tabela text, p_coluna text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select format_type(a.atttypid, a.atttypmod)
        from pg_attribute a
       where a.attrelid = to_regclass(format('public.%I', p_tabela))
         and a.attname::text = p_coluna
         and not a.attisdropped
    ),
    'coluna ausente'
  );
$$;

grant execute on function public.tipo_da_coluna(text, text) to authenticated;

comment on function public.tipo_da_coluna(text, text)
is 'Tipo real de uma coluna, lido do catálogo. Usado nas mensagens de erro dos Pagamentos Diários para apontar incompatibilidade de tipo em vez de acusar o valor digitado.';

-- ---------------------------------------------------------------------------
-- 2. Retrato do banco para a transferência entre contas
-- ---------------------------------------------------------------------------
-- SÓ LEITURA: nenhum insert, update, delete ou DDL. Responde, em um único
-- select, o que só o banco de produção sabe:
--
--   * as colunas de usuário de transferencia_lotes e transferencias_contas têm
--     chave estrangeira para public.usuarios? o que usuario_para_coluna resolve
--     em cada uma?
--   * existe índice único válido e total em saldos_historico (conta_id,
--     data_saldo)? sem ele o `on conflict` da transferência falha com 42P10.
--   * pode_em_pagamentos_fase2('executar_transferencia') devolve true para quem
--     está chamando? (o botão da tela cai no padrão do módulo quando essa RPC
--     falha, então botão habilitado NÃO prova que ela devolveu true)
--   * quem é o dono das tabelas gravadas e alguma delas tem RLS FORÇADA? tabela
--     com force RLS aplica política até para o dono, e aí a trilha de auditoria
--     -- que é atômica com a movimentação -- derruba a transferência inteira.
--   * há coluna obrigatória sem default, restrição de verificação ou gatilho que
--     a transferência não sabe satisfazer?
--   * o par origem/destino informado: secretaria, situação e último saldo.
--
-- Uso: select public.diagnostico_transferencia_contas(<origem>, <destino>);
create or replace function public.diagnostico_transferencia_contas(
  p_conta_origem_id integer default null,
  p_conta_destino_id integer default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_tabelas text[] := array['saldos_historico', 'transferencia_lotes', 'transferencias_contas', 'auditoria_eventos'];
  v_usuario uuid;
  v_status_usuario text;
  v_vinculos jsonb := '[]'::jsonb;
  v_par record;
  v_destino_fk text;
  v_resolvido uuid;
  v_indice_ok boolean;
  v_permissoes jsonb;
  v_conta_origem jsonb;
  v_conta_destino jsonb;
  v_mesma_secretaria boolean;
begin
  select u.id, u.status::text
    into v_usuario, v_status_usuario
    from public.usuarios u
   where u.auth_id = auth.uid()
   limit 1;

  -- Ponto 1 do pedido: vínculo real de cada coluna de usuário e o que o
  -- resolvedor devolve nela. Nenhum uuid é exposto: só se veio id ou nulo.
  for v_par in
    select * from (values
      ('transferencia_lotes', 'usuario_id'),
      ('transferencia_lotes', 'estornado_por'),
      ('transferencias_contas', 'usuario_id'),
      ('transferencias_contas', 'estornada_por'),
      ('auditoria_eventos', 'usuario_id')
    ) as pares(tabela, coluna)
  loop
    v_destino_fk := null;

    select destino_ns.nspname || '.' || destino.relname
      into v_destino_fk
      from pg_constraint fk
      join pg_class origem on origem.oid = fk.conrelid
      join pg_namespace origem_ns on origem_ns.oid = origem.relnamespace
      join pg_class destino on destino.oid = fk.confrelid
      join pg_namespace destino_ns on destino_ns.oid = destino.relnamespace
      join pg_attribute a
        on a.attrelid = origem.oid
       and a.attname::text = v_par.coluna
       and a.attnum > 0
       and not a.attisdropped
     where fk.contype = 'f'
       and origem_ns.nspname = 'public'
       and origem.relname::text = v_par.tabela
       and fk.conkey = array[a.attnum]::smallint[]
     limit 1;

    v_resolvido := public.usuario_para_coluna(v_par.tabela, v_par.coluna);

    v_vinculos := v_vinculos || jsonb_build_object(
      'tabela', v_par.tabela,
      'coluna', v_par.coluna,
      'tipo', public.tipo_da_coluna(v_par.tabela, v_par.coluna),
      'chave_estrangeira_para', coalesce(v_destino_fk, 'sem chave estrangeira'),
      'usuario_para_coluna', case when v_resolvido is null then 'nulo' else 'id presente' end,
      'igual_ao_registro_do_login', v_resolvido is not distinct from v_usuario
    );
  end loop;

  -- Ponto 2 do pedido: o árbitro do `on conflict (conta_id, data_saldo)`.
  -- Mesma conferência que a 20260828140000 usa para abortar: índice único,
  -- válido, total e sobre colunas simples.
  select exists (
    select 1
      from pg_index ix
     where ix.indrelid = to_regclass('public.saldos_historico')
       and ix.indisunique
       and ix.indisvalid
       and ix.indpred is null
       and ix.indexprs is null
       and (
         select array_agg(a.attname::text order by a.attname::text)
           from pg_attribute a
          where a.attrelid = ix.indrelid
            and a.attnum = any (ix.indkey)
            and not a.attisdropped
       ) = array['conta_id', 'data_saldo']::text[]
  ) into v_indice_ok;

  -- Ponto 4 do pedido. Envolvido em bloco próprio: função ausente responde
  -- "indisponível" em vez de derrubar o diagnóstico inteiro.
  begin
    v_permissoes := jsonb_build_object(
      'executar_transferencia', public.pode_em_pagamentos_fase2('executar_transferencia'),
      'estornar_transferencia', public.pode_em_pagamentos_fase2('estornar_transferencia'),
      'definir_conta_pagamento', public.pode_em_pagamentos_fase2('definir_conta_pagamento')
    );
  exception when others then
    v_permissoes := jsonb_build_object('indisponivel', true, 'sqlstate', sqlstate, 'mensagem', sqlerrm);
  end;

  -- Ponto 3 do pedido: o retrato das duas contas. banco_id sai só como id, para
  -- mostrar que bancos diferentes são irrelevantes para a regra -- o que a
  -- função compara é secretaria_id, e nada mais.
  select jsonb_build_object(
           'id', cb.id,
           'nome_conta', cb.nome_conta,
           'banco_id', cb.banco_id,
           'secretaria_id', cb.secretaria_id,
           'secretaria', s.nome,
           'ativo', coalesce(cb.ativo::text, 'nulo'),
           'ultimo_saldo', sh.valor_saldo,
           'data_ultimo_saldo', sh.data_saldo
         )
    into v_conta_origem
    from public.contas_bancarias cb
    left join public.secretarias s on s.id = cb.secretaria_id
    left join lateral (
      select h.valor_saldo, h.data_saldo
        from public.saldos_historico h
       where h.conta_id = cb.id
       order by h.data_saldo desc, h.id desc
       limit 1
    ) sh on true
   where cb.id = p_conta_origem_id;

  select jsonb_build_object(
           'id', cb.id,
           'nome_conta', cb.nome_conta,
           'banco_id', cb.banco_id,
           'secretaria_id', cb.secretaria_id,
           'secretaria', s.nome,
           'ativo', coalesce(cb.ativo::text, 'nulo'),
           'ultimo_saldo', sh.valor_saldo,
           'data_ultimo_saldo', sh.data_saldo
         )
    into v_conta_destino
    from public.contas_bancarias cb
    left join public.secretarias s on s.id = cb.secretaria_id
    left join lateral (
      select h.valor_saldo, h.data_saldo
        from public.saldos_historico h
       where h.conta_id = cb.id
       order by h.data_saldo desc, h.id desc
       limit 1
    ) sh on true
   where cb.id = p_conta_destino_id;

  -- Nulo quando uma das contas não foi encontrada: dizer "mesma secretaria"
  -- comparando dois nulos seria uma resposta inventada.
  v_mesma_secretaria := case
    when v_conta_origem is null or v_conta_destino is null then null
    else (v_conta_origem->>'secretaria_id') is not distinct from (v_conta_destino->>'secretaria_id')
  end;

  return jsonb_build_object(
    'login', jsonb_build_object(
      'autenticado', auth.uid() is not null,
      'tem_registro_em_usuarios', v_usuario is not null,
      'status_do_registro', coalesce(v_status_usuario, 'sem registro')
    ),
    'vinculos_de_usuario', v_vinculos,
    'saldos_historico', jsonb_build_object(
      'indice_unico_conta_id_data_saldo', v_indice_ok,
      'indices_unicos', (
        select coalesce(jsonb_agg(pg_get_indexdef(ix.indexrelid) order by pg_get_indexdef(ix.indexrelid)), '[]'::jsonb)
          from pg_index ix
         where ix.indrelid = to_regclass('public.saldos_historico')
           and ix.indisunique
      )
    ),
    'permissoes', v_permissoes,
    'contas', jsonb_build_object(
      'origem', coalesce(v_conta_origem, jsonb_build_object('encontrada', false, 'id', p_conta_origem_id)),
      'destino', coalesce(v_conta_destino, jsonb_build_object('encontrada', false, 'id', p_conta_destino_id)),
      'mesma_secretaria', v_mesma_secretaria,
      'a_regra_olha_banco', false
    ),
    'tabelas_gravadas', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'tabela', c.relname,
               'dono', pg_get_userbyid(c.relowner),
               'rls_ativa', c.relrowsecurity,
               'rls_forcada', c.relforcerowsecurity
             ) order by c.relname), '[]'::jsonb)
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relname::text = any (v_tabelas)
    ),
    'funcoes', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'funcao', p.proname,
               'dono', pg_get_userbyid(p.proowner),
               'security_definer', p.prosecdef
             ) order by p.proname), '[]'::jsonb)
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname::text in (
           'confirmar_transferencias_programacao',
           'estornar_transferencia',
           'definir_conta_origem_pagamento',
           'pode_em_pagamentos_fase2',
           'usuario_para_coluna',
           'usuario_registro_id',
           'rastro_do_login',
           'transferencia_entre_secretarias_permitida'
         )
    ),
    'objetos_esperados', jsonb_build_object(
      'tabela_transferencia_lotes', to_regclass('public.transferencia_lotes') is not null,
      'tabela_transferencias_contas', to_regclass('public.transferencias_contas') is not null,
      'tabela_saldos_historico', to_regclass('public.saldos_historico') is not null,
      'tabela_permissoes_efetivas', to_regclass('public.permissoes_efetivas') is not null,
      'funcao_usuario_registro_id', to_regprocedure('public.usuario_registro_id()') is not null,
      'funcao_usuario_para_coluna', to_regprocedure('public.usuario_para_coluna(text,text)') is not null,
      'funcao_rastro_do_login', to_regprocedure('public.rastro_do_login(uuid)') is not null,
      'funcao_segregacao', to_regprocedure('public.transferencia_entre_secretarias_permitida(text,text)') is not null,
      'funcao_permissao_fase2', to_regprocedure('public.pode_em_pagamentos_fase2(text)') is not null
    ),
    'colunas_obrigatorias_sem_default', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'tabela', c.relname,
               'coluna', a.attname::text,
               'tipo', format_type(a.atttypid, a.atttypmod)
             ) order by c.relname, a.attname::text), '[]'::jsonb)
        from pg_attribute a
        join pg_class c on c.oid = a.attrelid
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relname::text = any (v_tabelas)
         and a.attnum > 0
         and not a.attisdropped
         and a.attnotnull
         and not exists (
           select 1 from pg_attrdef d
            where d.adrelid = a.attrelid and d.adnum = a.attnum
         )
         and not exists (
           select 1 from pg_index ix
            where ix.indrelid = c.oid and ix.indisprimary and a.attnum = any (ix.indkey)
         )
    ),
    'restricoes_de_verificacao', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'tabela', c.relname,
               'nome', k.conname,
               'definicao', pg_get_constraintdef(k.oid)
             ) order by c.relname, k.conname), '[]'::jsonb)
        from pg_constraint k
        join pg_class c on c.oid = k.conrelid
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and k.contype = 'c'
         and c.relname::text = any (v_tabelas)
    ),
    'gatilhos', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'tabela', c.relname,
               'nome', t.tgname,
               'definicao', pg_get_triggerdef(t.oid)
             ) order by c.relname, t.tgname), '[]'::jsonb)
        from pg_trigger t
        join pg_class c on c.oid = t.tgrelid
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and not t.tgisinternal
         and c.relname::text = any (v_tabelas)
    ),
    'tipos_das_colunas', jsonb_build_object(
      'contas_bancarias.ativo', public.tipo_da_coluna('contas_bancarias', 'ativo'),
      'contas_bancarias.secretaria_id', public.tipo_da_coluna('contas_bancarias', 'secretaria_id'),
      'saldos_historico.valor_saldo', public.tipo_da_coluna('saldos_historico', 'valor_saldo'),
      'saldos_historico.data_saldo', public.tipo_da_coluna('saldos_historico', 'data_saldo'),
      'transferencia_lotes.status', public.tipo_da_coluna('transferencia_lotes', 'status'),
      'transferencias_contas.status', public.tipo_da_coluna('transferencias_contas', 'status'),
      'transferencias_contas.data_movimento', public.tipo_da_coluna('transferencias_contas', 'data_movimento'),
      'auditoria_eventos.nivel', public.tipo_da_coluna('auditoria_eventos', 'nivel'),
      'auditoria_eventos.acao', public.tipo_da_coluna('auditoria_eventos', 'acao'),
      'programacoes_pagamento.status', public.tipo_da_coluna('programacoes_pagamento', 'status'),
      'programacoes_pagamento.fechado', public.tipo_da_coluna('programacoes_pagamento', 'fechado'),
      'programacao_contas.ativa', public.tipo_da_coluna('programacao_contas', 'ativa'),
      'pagamentos.situacao', public.tipo_da_coluna('pagamentos', 'situacao')
    )
  );
end;
$fn$;

grant execute on function public.diagnostico_transferencia_contas(integer, integer) to authenticated;

comment on function public.diagnostico_transferencia_contas(integer, integer)
is 'Retrato somente-leitura do que a transferência entre contas precisa do banco: vínculo real das colunas de usuário, índice único de saldos_historico (conta_id, data_saldo), permissão de transferir, dono e RLS forçada das tabelas gravadas, colunas obrigatórias sem default, restrições, gatilhos e o par origem/destino. Não grava nada.';

-- ---------------------------------------------------------------------------
-- 3. Conta por pagamento — conversões à prova de tipo e etapa nomeada
-- ---------------------------------------------------------------------------
-- Corpo igual ao da 20260828210000, com duas mudanças e nada mais:
--   a) as comparações passam a ler as colunas legadas como texto, do mesmo jeito
--      que a 20260828170000 fez em aprovar_programacao_pagamento. pr.status,
--      pr.fechado, cb.ativo, pc.ativa e p.situacao eram lidos sem ::text: com
--      coluna enum, domínio ou texto no lugar de boolean isso vira 22P02;
--   b) qualquer falha inesperada passa a dizer em que ETAPA quebrou, com que
--      código, e leva no DETAIL a mensagem crua do banco e o tipo real de cada
--      coluna suspeita.
-- A gravação da trilha continua isolada: definir a conta não move saldo, então
-- uma falha só de auditoria não pode derrubar um vínculo já gravado.
create or replace function public.definir_conta_origem_pagamento(
  p_programacao_id integer,
  p_pagamento_ids integer[],
  p_conta_id integer
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  -- Um id de usuário por coluna, resolvido pelo vínculo real da coluna:
  -- public.usuario_para_coluna devolve o id de public.usuarios quando a coluna
  -- aponta para lá (NULL quando a sessão não tem registro), e nunca um id que a
  -- chave estrangeira recusaria.
  v_usuario_auditoria uuid; -- auditoria_eventos.usuario_id
  v_secretaria integer;
  -- Texto, não boolean nem enum: é o que sobrevive a coluna legada de qualquer
  -- tipo. A conferência acontece depois, sobre o texto.
  v_status text;
  v_fechado_texto text;
  v_conta_secretaria integer;
  v_conta_ativa_texto text;
  v_na_programacao boolean;
  v_atualizados integer;
  v_etapa text := 'início';
  v_constraint text;
  v_tabela_erro text;
  v_coluna_erro text;
  v_detalhe_erro text;
begin
  v_etapa := 'conferência do login';
  if auth.uid() is null then
    raise exception 'Usuário não autenticado.' using errcode = '42501';
  end if;

  v_etapa := 'resolução do usuário da trilha';
  v_usuario_auditoria := public.usuario_para_coluna('auditoria_eventos', 'usuario_id');

  v_etapa := 'conferência da permissão de definir a conta';
  if not public.pode_em_pagamentos_fase2('definir_conta_pagamento') then
    raise exception 'Você não tem permissão para definir a conta de pagamento.' using errcode = '42501';
  end if;

  v_etapa := 'conferência dos pagamentos enviados';
  if p_pagamento_ids is null or array_length(p_pagamento_ids, 1) is null then
    raise exception 'Escolha ao menos um pagamento.';
  end if;

  v_etapa := 'leitura da programação';
  select pr.secretaria_id, pr.status::text, pr.fechado::text
    into v_secretaria, v_status, v_fechado_texto
    from public.programacoes_pagamento pr
   where pr.id = p_programacao_id
   for update;

  if not found then
    raise exception 'Programação não encontrada.';
  end if;

  if lower(coalesce(v_fechado_texto, '')) in ('true', 't', 'sim', '1', 'y', 'yes') then
    raise exception 'Programações históricas fechadas não podem ser alteradas.';
  end if;

  if coalesce(v_status, '') <> 'aprovada' then
    raise exception 'A conta de cada pagamento só é definida depois da aprovação da programação.';
  end if;

  if p_conta_id is not null then
    v_etapa := 'leitura da conta bancária escolhida';
    select cb.secretaria_id, coalesce(cb.ativo::text, 'true')
      into v_conta_secretaria, v_conta_ativa_texto
      from public.contas_bancarias cb
     where cb.id = p_conta_id;

    if not found then
      raise exception 'Conta bancária não encontrada.';
    end if;
    if lower(coalesce(v_conta_ativa_texto, '')) not in ('true', 't', 'sim', '1', 'y', 'yes') then
      raise exception 'Conta bancária desativada não pode receber pagamentos.';
    end if;
    if v_conta_secretaria is distinct from v_secretaria then
      raise exception 'Só é possível usar contas da secretaria da programação.';
    end if;

    v_etapa := 'conferência da conta entre as contas de trabalho';
    select exists (
      select 1
        from public.programacao_contas pc
       where pc.programacao_id = p_programacao_id
         and pc.conta_id = p_conta_id
         and lower(coalesce(pc.ativa::text, '')) in ('true', 't', 'sim', '1', 'y', 'yes')
    ) into v_na_programacao;

    if not v_na_programacao then
      raise exception 'Só é possível usar contas que estão entre as contas de trabalho selecionadas na programação.';
    end if;
  end if;

  -- Grava SÓ o vínculo. Nenhuma linha de saldo, nenhuma movimentação.
  v_etapa := 'gravação da conta de origem nos pagamentos';
  update public.pagamentos p
     set conta_origem_id = p_conta_id
   where p.programacao_id = p_programacao_id
     and p.id = any (p_pagamento_ids)
     and p.excluido_em is null
     and coalesce(p.situacao::text, '') <> 'cancelado';

  get diagnostics v_atualizados = row_count;

  if v_atualizados = 0 then
    raise exception 'Nenhum pagamento desta programação corresponde à seleção.';
  end if;

  -- Auditar NUNCA derruba a ação principal: o vínculo acima já está gravado e
  -- uma falha exclusiva da trilha desfaz só este bloco. É a disciplina que a
  -- 20260828170000 aplicou na Fase 1, e ela cabe aqui porque definir a conta
  -- não move saldo -- ao contrário da transferência, em que trilha e
  -- movimentação precisam cair juntas.
  v_etapa := 'registro na auditoria';
  begin
    insert into public.auditoria_eventos (
      usuario_id, modulo, acao, registro_afetado, valor_anterior, valor_novo, nivel
    ) values (
      v_usuario_auditoria,
      'pagamentos',
      'alterou',
      'Conta de pagamento da programação ' || p_programacao_id::text,
      jsonb_build_object('pagamentos', to_jsonb(p_pagamento_ids)),
      jsonb_build_object(
        'conta_origem_id', p_conta_id,
        'pagamentos_atualizados', v_atualizados,
        'debitou_conta', false
      ) || public.rastro_do_login(v_usuario_auditoria),
      'informacao'
    );
  exception when others then
    raise warning 'Conta de pagamento da programação % definida, mas o evento de auditoria não foi gravado (% -- %).',
      p_programacao_id, sqlstate, sqlerrm;
  end;

  return jsonb_build_object(
    'ok', true,
    'programacao_id', p_programacao_id,
    'conta_origem_id', p_conta_id,
    'pagamentos_atualizados', v_atualizados,
    'debitou_conta', false
  );

exception
  when others then
    -- Passam intactas: as mensagens escritas para o usuário (P0001), as recusas
    -- de permissão (42501) e a falta de objeto no banco (42P01/42703/42883/
    -- 42P13). Estes últimos são o que a tela usa para reconhecer "a migration
    -- ainda não rodou" e dizer qual arquivo executar.
    if sqlstate in ('P0001', '42501', '42P01', '42703', '42883', '42P13') then
      raise;
    end if;

    get stacked diagnostics
      v_constraint = constraint_name,
      v_tabela_erro = table_name,
      v_coluna_erro = column_name,
      v_detalhe_erro = pg_exception_detail;

    raise exception
      'Não foi possível definir a conta de pagamento na etapa "%". O banco recusou a operação com o código %.',
      v_etapa, sqlstate
      using errcode = 'P0001',
            detail = format(
              '%s | etapa=%s sqlstate=%s constraint=%s tabela=%s coluna=%s detalhe=%s | programacoes_pagamento.status=%s programacoes_pagamento.fechado=%s programacao_contas.ativa=%s contas_bancarias.ativo=%s pagamentos.situacao=%s pagamentos.conta_origem_id=%s auditoria_eventos.nivel=%s',
              sqlerrm, v_etapa, sqlstate,
              coalesce(v_constraint, '-'),
              coalesce(v_tabela_erro, '-'),
              coalesce(v_coluna_erro, '-'),
              coalesce(v_detalhe_erro, '-'),
              public.tipo_da_coluna('programacoes_pagamento', 'status'),
              public.tipo_da_coluna('programacoes_pagamento', 'fechado'),
              public.tipo_da_coluna('programacao_contas', 'ativa'),
              public.tipo_da_coluna('contas_bancarias', 'ativo'),
              public.tipo_da_coluna('pagamentos', 'situacao'),
              public.tipo_da_coluna('pagamentos', 'conta_origem_id'),
              public.tipo_da_coluna('auditoria_eventos', 'nivel')
            ),
            hint = 'Leia o DETAIL: ele traz a mensagem crua do banco, a etapa, a restrição recusada e o tipo real de cada coluna suspeita. Tipo diferente do esperado indica qual comparação foi recusada.';
end;
$fn$;

grant execute on function public.definir_conta_origem_pagamento(integer, integer[], integer) to authenticated;

comment on function public.definir_conta_origem_pagamento(integer, integer[], integer)
is 'Define a conta de origem de um ou mais pagamentos da programação. CONTA DEFINIDA NAO E DEBITO: nenhum saldo é movimentado aqui. Comparações à prova de tipo, auditoria isolada, id de usuário resolvido pelo vínculo da coluna e etapa nomeada em qualquer falha inesperada.';

-- ---------------------------------------------------------------------------
-- 4. Transferência entre contas — a ÚNICA que move saldo
-- ---------------------------------------------------------------------------
-- Corpo igual ao da 20260828210000, com duas mudanças e nada mais:
--   a) contas_bancarias.ativo passa a ser lido como texto. Era o único lugar do
--      caminho da transferência que atribuía coluna legada direto a uma variável
--      boolean -- o mesmo padrão que gerou o 22P02 na aprovação;
--   b) qualquer falha inesperada passa a dizer em que ETAPA quebrou e com que
--      código, levando no DETAIL a mensagem crua do banco, a restrição recusada
--      e o tipo real das colunas envolvidas.
-- PRESERVADO SEM ALTERAÇÃO: segregação por secretaria, idempotência pela chave,
-- advisory lock por conta, atomicidade entre saída e entrada e a trilha de
-- auditoria ATÔMICA com a movimentação (aqui o saldo se move, então a trilha
-- NÃO é isolada -- ela cai junto). O bloco de exceção relevanta o erro, então
-- nada é confirmado pela metade e o advisory lock, que é de transação, segue a
-- mesma sorte da transação.
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
  -- Um id de usuário por coluna, resolvido pelo vínculo real da coluna:
  -- public.usuario_para_coluna devolve o id de public.usuarios quando a coluna
  -- aponta para lá (NULL quando a sessão não tem registro), e nunca um id que a
  -- chave estrangeira recusaria.
  v_usuario_lote uuid;      -- transferencia_lotes.usuario_id
  v_usuario_perna uuid;     -- transferencias_contas.usuario_id
  v_usuario_auditoria uuid; -- auditoria_eventos.usuario_id
  v_lote_id uuid;
  v_existente uuid;
  v_destino_secretaria integer;
  v_destino_ativa_texto text;
  v_destino_nome text;
  v_secretaria_destino_nome text;
  v_item jsonb;
  v_origem_id integer;
  v_valor numeric(14,2);
  v_total numeric(14,2) := 0;
  v_quantidade integer := 0;
  v_origem_secretaria integer;
  v_origem_ativa_texto text;
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
  v_etapa text := 'início';
  v_constraint text;
  v_tabela_erro text;
  v_coluna_erro text;
  v_detalhe_erro text;
begin
  v_etapa := 'conferência do login';
  if auth.uid() is null then
    raise exception 'Usuário não autenticado.' using errcode = '42501';
  end if;

  v_etapa := 'resolução do usuário de cada coluna';
  v_usuario_lote := public.usuario_para_coluna('transferencia_lotes', 'usuario_id');
  v_usuario_perna := public.usuario_para_coluna('transferencias_contas', 'usuario_id');
  v_usuario_auditoria := public.usuario_para_coluna('auditoria_eventos', 'usuario_id');

  v_etapa := 'conferência da permissão de transferir';
  if not public.pode_em_pagamentos_fase2('executar_transferencia') then
    raise exception 'Você não tem permissão para transferir entre contas.' using errcode = '42501';
  end if;

  v_etapa := 'conferência dos dados enviados';
  if coalesce(trim(p_chave_idempotencia), '') = '' then
    raise exception 'A transferência precisa de um identificador único.';
  end if;

  if jsonb_typeof(coalesce(p_transferencias, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_transferencias, '[]'::jsonb)) = 0 then
    raise exception 'Informe ao menos uma conta de origem com valor.';
  end if;

  -- IDEMPOTÊNCIA. O índice único da chave é a tranca: duplo clique, F5, reenvio
  -- ou dupla confirmação caem aqui e a segunda tentativa não move nada.
  v_etapa := 'registro do lote com a chave de idempotência';
  insert into public.transferencia_lotes (
    chave_idempotencia, programacao_id, conta_destino_id, observacao, usuario_id, status
  ) values (
    trim(p_chave_idempotencia), p_programacao_id, p_conta_destino_id,
    nullif(trim(coalesce(p_observacao, '')), ''), v_usuario_lote, 'confirmada'
  )
  on conflict (chave_idempotencia) do nothing
  returning id into v_lote_id;

  if v_lote_id is null then
    v_etapa := 'leitura da transferência já confirmada com esta chave';
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
  v_etapa := 'leitura da conta de destino';
  select cb.secretaria_id, coalesce(cb.ativo::text, 'true'), cb.nome_conta
    into v_destino_secretaria, v_destino_ativa_texto, v_destino_nome
    from public.contas_bancarias cb
   where cb.id = p_conta_destino_id;

  if not found then
    raise exception 'Conta de destino não encontrada.';
  end if;
  if lower(coalesce(v_destino_ativa_texto, '')) not in ('true', 't', 'sim', '1', 'y', 'yes') then
    raise exception 'Conta de destino desativada não pode receber transferência.';
  end if;

  select s.nome into v_secretaria_destino_nome
    from public.secretarias s
   where s.id = v_destino_secretaria;

  -- Serializa as contas envolvidas: duas transferências simultâneas na mesma
  -- conta entram em fila, então o saldo nunca é lido desatualizado.
  v_etapa := 'trava das contas envolvidas';
  select array_agg(distinct conta order by conta)
    into v_contas
    from (
      select p_conta_destino_id as conta
      union
      select (valor->>'conta_origem_id')::integer
        from jsonb_array_elements(p_transferencias) as itens(valor)
    ) todas
   where conta is not null;

  foreach v_conta in array coalesce(v_contas, array[]::integer[]) loop
    perform pg_advisory_xact_lock(918273645, v_conta);
  end loop;

  -- Saldo atual do destino (último lançamento de saldos_historico).
  v_etapa := 'leitura do saldo da conta de destino';
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
    v_etapa := 'leitura dos dados de uma conta de origem';
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

    v_etapa := 'leitura da conta de origem ' || v_origem_id::text;
    select cb.secretaria_id, coalesce(cb.ativo::text, 'true')
      into v_origem_secretaria, v_origem_ativa_texto
      from public.contas_bancarias cb
     where cb.id = v_origem_id;

    if not found then
      raise exception 'Conta de origem % não encontrada.', v_origem_id;
    end if;
    if lower(coalesce(v_origem_ativa_texto, '')) not in ('true', 't', 'sim', '1', 'y', 'yes') then
      raise exception 'Conta de origem desativada não pode transferir.';
    end if;

    -- SEGREGAÇÃO POR SECRETARIA
    v_etapa := 'conferência da segregação por secretaria';
    if v_origem_secretaria is distinct from v_destino_secretaria then
      select s.nome into v_secretaria_origem_nome
        from public.secretarias s
       where s.id = v_origem_secretaria;

      if not public.transferencia_entre_secretarias_permitida(v_secretaria_origem_nome, v_secretaria_destino_nome) then
        raise exception 'Transferência entre secretarias diferentes não é permitida (% para %). A única exceção é a Secretaria de Finanças para Saúde, Educação e Assistência Social.',
          coalesce(v_secretaria_origem_nome, 'origem'), coalesce(v_secretaria_destino_nome, 'destino');
      end if;
    end if;

    v_etapa := 'leitura do saldo da conta de origem';
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

    v_etapa := 'gravação da saída na conta de origem';
    insert into public.saldos_historico (conta_id, valor_saldo, data_saldo)
    values (v_origem_id, round(v_saldo_origem - v_valor, 2), v_data_alvo)
    on conflict (conta_id, data_saldo)
    do update set valor_saldo = excluded.valor_saldo;

    v_etapa := 'registro da perna da transferência';
    insert into public.transferencias_contas (
      lote_id, programacao_id, conta_origem_id, conta_destino_id, valor,
      saldo_origem_antes, saldo_origem_depois,
      data_movimento, observacao, usuario_id, status
    ) values (
      v_lote_id, p_programacao_id, v_origem_id, p_conta_destino_id, v_valor,
      v_saldo_origem, round(v_saldo_origem - v_valor, 2),
      v_data_alvo, nullif(trim(coalesce(p_observacao, '')), ''), v_usuario_perna, 'confirmada'
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

  v_etapa := 'gravação da entrada na conta de destino';
  insert into public.saldos_historico (conta_id, valor_saldo, data_saldo)
  values (p_conta_destino_id, round(v_destino_antes + v_total, 2), v_data_alvo)
  on conflict (conta_id, data_saldo)
  do update set valor_saldo = excluded.valor_saldo;

  v_etapa := 'atualização dos saldos do lote';
  update public.transferencias_contas
     set saldo_destino_antes = v_destino_antes,
         saldo_destino_depois = round(v_destino_antes + v_total, 2)
   where lote_id = v_lote_id;

  update public.transferencia_lotes
     set valor_total = v_total,
         quantidade_origens = v_quantidade
   where id = v_lote_id;

  -- Histórico e Auditoria: saldo antes e saldo depois de cada conta. ATÔMICO de
  -- propósito -- aqui o dinheiro se move, e movimentação sem trilha não vale.
  v_etapa := 'registro na auditoria';
  insert into public.auditoria_eventos (
    usuario_id, modulo, acao, registro_afetado, valor_anterior, valor_novo, nivel
  ) values (
    v_usuario_auditoria,
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
    ) || public.rastro_do_login(v_usuario_auditoria),
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

exception
  when others then
    -- Passam intactas: as mensagens escritas para o usuário (P0001), as recusas
    -- de permissão (42501) e a falta de objeto no banco (42P01/42703/42883/
    -- 42P13). Estes últimos são o que a tela usa para reconhecer "a migration
    -- ainda não rodou" e dizer qual arquivo executar -- reescrevê-los como
    -- P0001 apagaria esse aviso.
    if sqlstate in ('P0001', '42501', '42P01', '42703', '42883', '42P13') then
      raise;
    end if;

    -- Campos estruturados do erro. Um raise exception novo os perderia, então
    -- eles são lidos aqui e vão para o DETAIL. 42P10 com tabela
    -- saldos_historico, por exemplo, é o índice único (conta_id, data_saldo)
    -- faltando -- sem ele o `on conflict` acima não tem árbitro.
    get stacked diagnostics
      v_constraint = constraint_name,
      v_tabela_erro = table_name,
      v_coluna_erro = column_name,
      v_detalhe_erro = pg_exception_detail;

    raise exception
      'Não foi possível concluir a transferência entre contas na etapa "%". O banco recusou a operação com o código %.',
      v_etapa, sqlstate
      using errcode = 'P0001',
            detail = format(
              '%s | etapa=%s sqlstate=%s constraint=%s tabela=%s coluna=%s detalhe=%s | contas_bancarias.ativo=%s contas_bancarias.secretaria_id=%s saldos_historico.conta_id=%s saldos_historico.valor_saldo=%s saldos_historico.data_saldo=%s transferencia_lotes.usuario_id=%s transferencia_lotes.status=%s transferencias_contas.usuario_id=%s transferencias_contas.status=%s transferencias_contas.data_movimento=%s auditoria_eventos.usuario_id=%s auditoria_eventos.acao=%s auditoria_eventos.nivel=%s',
              sqlerrm, v_etapa, sqlstate,
              coalesce(v_constraint, '-'),
              coalesce(v_tabela_erro, '-'),
              coalesce(v_coluna_erro, '-'),
              coalesce(v_detalhe_erro, '-'),
              public.tipo_da_coluna('contas_bancarias', 'ativo'),
              public.tipo_da_coluna('contas_bancarias', 'secretaria_id'),
              public.tipo_da_coluna('saldos_historico', 'conta_id'),
              public.tipo_da_coluna('saldos_historico', 'valor_saldo'),
              public.tipo_da_coluna('saldos_historico', 'data_saldo'),
              public.tipo_da_coluna('transferencia_lotes', 'usuario_id'),
              public.tipo_da_coluna('transferencia_lotes', 'status'),
              public.tipo_da_coluna('transferencias_contas', 'usuario_id'),
              public.tipo_da_coluna('transferencias_contas', 'status'),
              public.tipo_da_coluna('transferencias_contas', 'data_movimento'),
              public.tipo_da_coluna('auditoria_eventos', 'usuario_id'),
              public.tipo_da_coluna('auditoria_eventos', 'acao'),
              public.tipo_da_coluna('auditoria_eventos', 'nivel')
            ),
            hint = 'Leia o DETAIL: ele traz a mensagem crua do banco, a etapa, a restrição recusada e o tipo real de cada coluna envolvida. Para o retrato completo do banco rode select public.diagnostico_transferencia_contas(conta_origem, conta_destino).';
end;
$fn$;

grant execute on function public.confirmar_transferencias_programacao(integer, integer, jsonb, text, text) to authenticated;

comment on function public.confirmar_transferencias_programacao(integer, integer, jsonb, text, text)
is 'Transferência entre contas próprias: várias origens para um destino, atômica e idempotente pela chave. NAO E DESPESA — não escreve em pagamento_movimentacoes nem em pagamentos_baixas. Id de usuário resolvido pelo vínculo de cada coluna, leitura de contas_bancarias.ativo à prova de tipo e etapa nomeada em qualquer falha inesperada.';

-- ---------------------------------------------------------------------------
-- 5. Estorno — transferência não se exclui, se estorna
-- ---------------------------------------------------------------------------
-- Corpo igual ao da 20260828210000, com uma mudança e nada mais: qualquer falha
-- inesperada passa a dizer em que ETAPA quebrou e com que código, levando no
-- DETAIL a mensagem crua do banco, a restrição recusada e o tipo real das
-- colunas envolvidas. O status da transferência passa a ser lido como texto,
-- pela mesma razão das outras funções.
-- PRESERVADO SEM ALTERAÇÃO: idempotência pela chave 'estorno:<id>', o índice
-- único que impede estornar duas vezes, os dois advisory locks na ordem
-- menor/maior, a movimentação inversa atômica, a preservação da transferência
-- original e os DOIS eventos de auditoria, atômicos com a movimentação.
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
  -- Um id de usuário por coluna, resolvido pelo vínculo real da coluna:
  -- public.usuario_para_coluna devolve o id de public.usuarios quando a coluna
  -- aponta para lá (NULL quando a sessão não tem registro), e nunca um id que a
  -- chave estrangeira recusaria.
  v_usuario_lote uuid;      -- transferencia_lotes.usuario_id
  v_usuario_perna uuid;     -- transferencias_contas.usuario_id
  v_usuario_estorno uuid;   -- transferencias_contas.estornada_por
  v_usuario_lote_estorno uuid; -- transferencia_lotes.estornado_por
  v_usuario_auditoria uuid; -- auditoria_eventos.usuario_id
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
  v_etapa text := 'início';
  v_constraint text;
  v_tabela_erro text;
  v_coluna_erro text;
  v_detalhe_erro text;
begin
  v_etapa := 'conferência do login';
  if auth.uid() is null then
    raise exception 'Usuário não autenticado.' using errcode = '42501';
  end if;

  v_etapa := 'resolução do usuário de cada coluna';
  v_usuario_lote := public.usuario_para_coluna('transferencia_lotes', 'usuario_id');
  v_usuario_perna := public.usuario_para_coluna('transferencias_contas', 'usuario_id');
  v_usuario_estorno := public.usuario_para_coluna('transferencias_contas', 'estornada_por');
  v_usuario_lote_estorno := public.usuario_para_coluna('transferencia_lotes', 'estornado_por');
  v_usuario_auditoria := public.usuario_para_coluna('auditoria_eventos', 'usuario_id');

  v_etapa := 'conferência da permissão de estornar';
  if not public.pode_em_pagamentos_fase2('estornar_transferencia') then
    raise exception 'Você não tem permissão para estornar transferências.' using errcode = '42501';
  end if;

  v_etapa := 'conferência do motivo do estorno';
  v_motivo := nullif(trim(coalesce(p_observacao, '')), '');
  if v_motivo is null then
    raise exception 'Informe o motivo do estorno.';
  end if;

  v_etapa := 'leitura da transferência a estornar';
  select tc.conta_origem_id, tc.conta_destino_id, tc.valor, tc.status::text, tc.programacao_id, tc.lote_id
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

  v_etapa := 'trava das contas envolvidas';
  perform pg_advisory_xact_lock(918273645, least(v_origem_id, v_destino_id));
  perform pg_advisory_xact_lock(918273645, greatest(v_origem_id, v_destino_id));

  -- Idempotência do estorno: a chave carrega o id da transferência original.
  v_etapa := 'registro do lote de estorno com a chave de idempotência';
  insert into public.transferencia_lotes (
    chave_idempotencia, programacao_id, conta_destino_id, observacao, usuario_id,
    status, estorno_de_lote_id, motivo_estorno, valor_total, quantidade_origens
  ) values (
    'estorno:' || p_transferencia_id::text, v_programacao, v_origem_id, v_motivo, v_usuario_lote,
    'estorno', v_lote_id, v_motivo, v_valor, 1
  )
  on conflict (chave_idempotencia) do nothing
  returning id into v_lote_estorno;

  if v_lote_estorno is null then
    return jsonb_build_object('ok', true, 'ja_estornada', true, 'transferencia_id', p_transferencia_id);
  end if;

  -- Movimento inverso: o destino devolve, a origem recebe.
  v_etapa := 'leitura do saldo da conta que recebeu a transferência';
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

  v_etapa := 'leitura do saldo da conta de origem';
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

  v_etapa := 'devolução do valor pela conta que recebeu';
  v_data_alvo := greatest(current_date, coalesce(v_data_destino, current_date));
  insert into public.saldos_historico (conta_id, valor_saldo, data_saldo)
  values (v_destino_id, round(v_saldo_destino - v_valor, 2), v_data_alvo)
  on conflict (conta_id, data_saldo)
  do update set valor_saldo = excluded.valor_saldo;

  v_etapa := 'devolução do valor para a conta de origem';
  v_data_alvo := greatest(current_date, coalesce(v_data_origem, current_date));
  insert into public.saldos_historico (conta_id, valor_saldo, data_saldo)
  values (v_origem_id, round(v_saldo_origem + v_valor, 2), v_data_alvo)
  on conflict (conta_id, data_saldo)
  do update set valor_saldo = excluded.valor_saldo;

  -- A perna do estorno entra como registro NOVO: a original permanece.
  v_etapa := 'registro da perna do estorno';
  insert into public.transferencias_contas (
    lote_id, programacao_id, conta_origem_id, conta_destino_id, valor,
    saldo_origem_antes, saldo_origem_depois,
    saldo_destino_antes, saldo_destino_depois,
    data_movimento, observacao, usuario_id, status, estorno_de_transferencia_id, motivo_estorno
  ) values (
    v_lote_estorno, v_programacao, v_destino_id, v_origem_id, v_valor,
    v_saldo_destino, round(v_saldo_destino - v_valor, 2),
    v_saldo_origem, round(v_saldo_origem + v_valor, 2),
    v_data_alvo, v_motivo, v_usuario_perna, 'estorno', p_transferencia_id, v_motivo
  )
  returning id into v_estorno_id;

  v_etapa := 'marcação da transferência original como estornada';
  update public.transferencias_contas
     set status = 'estornada',
         estornada_em = now(),
         estornada_por = v_usuario_estorno,
         motivo_estorno = v_motivo
   where id = p_transferencia_id;

  v_etapa := 'atualização do lote original';
  update public.transferencia_lotes
     set status = case
                    when not exists (
                      select 1 from public.transferencias_contas tc
                       where tc.lote_id = v_lote_id and tc.status = 'confirmada'
                    ) then 'estornada'
                    else status
                  end,
         estornado_em = now(),
         estornado_por = v_usuario_lote_estorno,
         motivo_estorno = v_motivo
   where id = v_lote_id;

  -- DOIS eventos: o estorno da original e a movimentação inversa. ATÔMICOS de
  -- propósito -- aqui o dinheiro se move de volta.
  v_etapa := 'registro na auditoria';
  insert into public.auditoria_eventos (
    usuario_id, modulo, acao, registro_afetado, valor_anterior, valor_novo, nivel
  ) values (
    v_usuario_auditoria,
    'pagamentos',
    'estornou',
    'Transferência ' || p_transferencia_id::text,
    jsonb_build_object('status', v_status, 'valor', v_valor, 'conta_origem_id', v_origem_id, 'conta_destino_id', v_destino_id),
    jsonb_build_object('status', 'estornada', 'motivo', v_motivo, 'preservada', true)
      || public.rastro_do_login(v_usuario_auditoria),
    'critico'
  ), (
    v_usuario_auditoria,
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
    ) || public.rastro_do_login(v_usuario_auditoria),
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

exception
  when others then
    -- Passam intactas: as mensagens escritas para o usuário (P0001), as recusas
    -- de permissão (42501) e a falta de objeto no banco (42P01/42703/42883/
    -- 42P13).
    if sqlstate in ('P0001', '42501', '42P01', '42703', '42883', '42P13') then
      raise;
    end if;

    get stacked diagnostics
      v_constraint = constraint_name,
      v_tabela_erro = table_name,
      v_coluna_erro = column_name,
      v_detalhe_erro = pg_exception_detail;

    raise exception
      'Não foi possível concluir o estorno da transferência na etapa "%". O banco recusou a operação com o código %.',
      v_etapa, sqlstate
      using errcode = 'P0001',
            detail = format(
              '%s | etapa=%s sqlstate=%s constraint=%s tabela=%s coluna=%s detalhe=%s | saldos_historico.conta_id=%s saldos_historico.valor_saldo=%s saldos_historico.data_saldo=%s transferencia_lotes.usuario_id=%s transferencia_lotes.estornado_por=%s transferencia_lotes.status=%s transferencias_contas.usuario_id=%s transferencias_contas.estornada_por=%s transferencias_contas.status=%s auditoria_eventos.usuario_id=%s auditoria_eventos.acao=%s auditoria_eventos.nivel=%s',
              sqlerrm, v_etapa, sqlstate,
              coalesce(v_constraint, '-'),
              coalesce(v_tabela_erro, '-'),
              coalesce(v_coluna_erro, '-'),
              coalesce(v_detalhe_erro, '-'),
              public.tipo_da_coluna('saldos_historico', 'conta_id'),
              public.tipo_da_coluna('saldos_historico', 'valor_saldo'),
              public.tipo_da_coluna('saldos_historico', 'data_saldo'),
              public.tipo_da_coluna('transferencia_lotes', 'usuario_id'),
              public.tipo_da_coluna('transferencia_lotes', 'estornado_por'),
              public.tipo_da_coluna('transferencia_lotes', 'status'),
              public.tipo_da_coluna('transferencias_contas', 'usuario_id'),
              public.tipo_da_coluna('transferencias_contas', 'estornada_por'),
              public.tipo_da_coluna('transferencias_contas', 'status'),
              public.tipo_da_coluna('auditoria_eventos', 'usuario_id'),
              public.tipo_da_coluna('auditoria_eventos', 'acao'),
              public.tipo_da_coluna('auditoria_eventos', 'nivel')
            ),
            hint = 'Leia o DETAIL: ele traz a mensagem crua do banco, a etapa, a restrição recusada e o tipo real de cada coluna envolvida. Para o retrato completo do banco rode select public.diagnostico_transferencia_contas(conta_origem, conta_destino).';
end;
$fn$;

grant execute on function public.estornar_transferencia(uuid, text) to authenticated;

comment on function public.estornar_transferencia(uuid, text)
is 'Estorna uma transferência entre contas lançando a movimentação inversa. Exige motivo e PRESERVA a transferência original na razão, no Histórico e na Auditoria. Id de usuário resolvido pelo vínculo de cada coluna e etapa nomeada em qualquer falha inesperada.';

commit;
