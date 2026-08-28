-- FASE 2 — correção da aprovação da programação diária.
--
-- ATENÇÃO: esta migration precisa ser rodada MANUALMENTE no SQL Editor do
-- Supabase (o mesmo projeto usado pela aplicação), como a da Fase 2. Nada nela
-- roda sozinho no deploy.
--
-- O DEFEITO QUE ELA CORRIGE
--
-- A tela recusava a aprovação com "Algum valor informado está em um formato
-- inválido", em qualquer valor. Aquela frase não é uma validação da tela: é a
-- tradução do código 22P02 do Postgres (invalid_text_representation) feita em
-- src/lib/erros.js. Ou seja, os valores digitados nunca foram o problema -- a
-- tela chamava a função do banco com números normais e o banco recusava.
--
-- O 22P02 vem de comparações que assumem que colunas antigas de produção são
-- text, quando elas podem ser enum ou domínio (public.pagamentos e
-- public.programacoes_pagamento não foram criadas por migration deste
-- repositório -- só receberam colunas novas):
--
--   * `coalesce(p.situacao, '') <> 'cancelado'` em aprovar_programacao_pagamento.
--     Se `situacao` for enum, o '' é convertido para o tipo do enum e o Postgres
--     devolve 22P02 (invalid input value for enum ...: "") em TODA chamada,
--     independentemente dos valores da programação. Esta expressão existe só na
--     aprovação: salvar usa `situacao in ('programado','em_aberto')`, que são
--     rótulos válidos -- é exatamente por isso que salvar funcionava e aprovar
--     não.
--   * `pr.fechado` lido para uma variável boolean. Se a coluna for text, a
--     conversão implícita também estoura 22P02.
--
-- Junto vinham dois problemas que podiam derrubar a mesma operação depois de o
-- trabalho já estar feito:
--
--   * salvar_planejamento_programacao e marcar_programacao_em_analise gravavam
--     `nivel = 'normal'` em public.auditoria_eventos, valor fora do domínio da
--     coluna ('informacao', 'atencao', 'critico') e fora do mapa de níveis da
--     tela de Auditoria. Onde a restrição existe isso é erro; onde não existe,
--     o evento aparecia sem nível reconhecido.
--   * o evento de auditoria era gravado no mesmo bloco da ação principal, então
--     uma falha só de auditoria desfazia o salvamento ou a aprovação. A regra do
--     sistema é a oposta (src/lib/auditoria.js): auditar NUNCA derruba a ação.
--
-- O QUE ESTA MIGRATION FAZ
--
--   1. public.tipo_da_coluna -> leitura do tipo real de uma coluna, usada para
--      dizer no erro qual tipo o banco tem de verdade.
--   2. Recria as três funções da tela com as comparações à prova de tipo, com o
--      registro de auditoria isolado e com o nome da ETAPA em qualquer falha
--      inesperada: em vez de um 22P02 solto, a mensagem diz onde quebrou, qual o
--      código e qual o tipo real das colunas envolvidas.
--
-- REGRAS PRESERVADAS, SEM EXCEÇÃO
--
--   * APROVAR NÃO É PAGAR: a aprovação continua gravando somente status,
--     aprovada_em, aprovada_por e a conferência (saldo, total, restante). Nenhuma
--     linha de saldo, nenhuma baixa, nenhuma nota marcada como paga, nenhum saldo
--     de fornecedor.
--   * Nenhuma coluna, tabela, política ou permissão é criada, alterada ou
--     removida. Nenhum dado é apagado ou reescrito.
--   * Nada de Saldos das Contas, Fornecedores, Certidões, Baixas, Tarefas,
--     Histórico, Relatórios, Auditoria (estrutura), Configurações ou backup é
--     tocado.
--
-- IDEMPOTENTE: pode rodar quantas vezes for preciso. Só substitui corpo de
-- função, mantendo assinatura, tipo de retorno e grants.

begin;

-- ---------------------------------------------------------------------------
-- 1. Tipo real de uma coluna, para o erro poder dizer a verdade
-- ---------------------------------------------------------------------------
-- Só lê catálogo do Postgres: nenhum dado da aplicação passa por aqui.
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
-- 2. Aprovar programação — NENHUM saldo se move
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
  v_fechado_texto text;
  v_secretaria integer;
  v_contas integer;
  v_fornecedores integer;
  v_total numeric(14,2);
  v_saldo numeric(14,2);
  -- Nome da etapa em curso: é ele que aparece na mensagem quando o banco recusa
  -- a operação por um motivo que esta função não previu.
  v_etapa text := 'início';
begin
  v_etapa := 'conferência da sessão';
  if auth.uid() is null then
    raise exception 'Usuário não autenticado.' using errcode = '42501';
  end if;
  v_usuario := public.usuario_auditoria_id();

  v_etapa := 'conferência da permissão de aprovar';
  if not public.pode_em_pagamentos_fase2('aprovar_programacao') then
    raise exception 'Você não tem permissão para aprovar programações de pagamento.' using errcode = '42501';
  end if;

  -- status e fechado saem como TEXTO. A conversão explícita funciona para text,
  -- para enum e para domínio -- e é o que impede o 22P02 que travava a tela.
  v_etapa := 'leitura da programação';
  select pr.status::text, pr.fechado::text, pr.secretaria_id
    into v_status_anterior, v_fechado_texto, v_secretaria
    from public.programacoes_pagamento pr
   where pr.id = p_programacao_id
   for update;

  if not found then
    raise exception 'Programação não encontrada.';
  end if;

  if lower(coalesce(v_fechado_texto, '')) in ('true', 't', 'sim', '1', 'y', 'yes') then
    raise exception 'Programações históricas fechadas não podem ser aprovadas.';
  end if;

  if coalesce(v_status_anterior, '') = 'aprovada' then
    return jsonb_build_object('ok', true, 'ja_aprovada', true, 'programacao_id', p_programacao_id, 'status', 'aprovada');
  end if;

  -- `situacao::text` antes do coalesce: sem isso o '' é convertido para o tipo da
  -- coluna e um enum recusa a comparação com 22P02.
  v_etapa := 'soma dos fornecedores da programação';
  select count(*), round(coalesce(sum(p.valor_a_pagar), 0)::numeric, 2)
    into v_fornecedores, v_total
    from public.pagamentos p
   where p.programacao_id = p_programacao_id
     and p.excluido_em is null
     and coalesce(p.situacao::text, '') <> 'cancelado';

  if v_fornecedores = 0 then
    raise exception 'Não é possível aprovar uma programação sem fornecedores.';
  end if;

  v_etapa := 'soma das contas de trabalho';
  select count(*), round(coalesce(sum(pc.saldo_considerado), 0)::numeric, 2)
    into v_contas, v_saldo
    from public.programacao_contas pc
   where pc.programacao_id = p_programacao_id
     and lower(coalesce(pc.ativa::text, '')) in ('true', 't', 'sim', '1', 'y', 'yes');

  if v_contas = 0 then
    raise exception 'Não é possível aprovar uma programação sem contas de trabalho.';
  end if;

  -- Aprovar grava status e conferência. Nenhuma linha de saldo, nenhuma baixa,
  -- nenhum saldo de fornecedor, nenhuma nota marcada como paga.
  v_etapa := 'gravação da aprovação';
  update public.programacoes_pagamento
     set status = 'aprovada',
         aprovada_em = now(),
         aprovada_por = v_usuario,
         saldo_considerado = round(coalesce(p_saldo_considerado, v_saldo), 2),
         total_programado = round(coalesce(p_total_programado, v_total), 2),
         restante = round(coalesce(p_restante, v_saldo - v_total), 2),
         updated_at = now()
   where id = p_programacao_id;

  -- Auditar NUNCA derruba a ação principal: a aprovação acima já está gravada e
  -- uma falha exclusiva da trilha desfaz só este bloco.
  v_etapa := 'registro na auditoria';
  begin
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
  exception when others then
    raise warning 'Programação % aprovada, mas o evento de auditoria não foi gravado (% -- %).',
      p_programacao_id, sqlstate, sqlerrm;
  end;

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
    -- Qualquer outra falha deixa de chegar à tela como um código solto: a
    -- MENSAGEM diz, em português, em que etapa quebrou e com que código -- é ela
    -- que a tela mostra. A mensagem crua do Postgres e o tipo real das colunas
    -- que costumam estar por trás de incompatibilidade de tipo vão em DETAIL e
    -- HINT, que a aplicação registra no console e não exibe: texto de backend
    -- continua fora da tela.
    raise exception
      'Não foi possível aprovar a programação na etapa "%". O banco recusou a operação com o código %.',
      v_etapa, sqlstate
      using errcode = 'P0001',
            detail = format(
              '%s | etapa=%s sqlstate=%s | pagamentos.situacao=%s programacoes_pagamento.status=%s programacoes_pagamento.fechado=%s programacao_contas.ativa=%s auditoria_eventos.nivel=%s',
              sqlerrm, v_etapa, sqlstate,
              public.tipo_da_coluna('pagamentos', 'situacao'),
              public.tipo_da_coluna('programacoes_pagamento', 'status'),
              public.tipo_da_coluna('programacoes_pagamento', 'fechado'),
              public.tipo_da_coluna('programacao_contas', 'ativa'),
              public.tipo_da_coluna('auditoria_eventos', 'nivel')
            ),
            hint = 'Leia o DETAIL: ele traz a mensagem crua do Postgres, a etapa e o tipo real de cada coluna suspeita. Tipo diferente do esperado indica qual comparação o banco recusou.';
end $$;

grant execute on function public.aprovar_programacao_pagamento(integer, numeric, numeric, numeric) to authenticated;

comment on function public.aprovar_programacao_pagamento(integer, numeric, numeric, numeric)
is 'Aprova a programação diária. APROVADO NAO E PAGO: não debita conta, não dá baixa em NF, não altera saldo de fornecedor e não marca nota como paga. Comparações à prova de tipo (situacao/fechado/ativa lidos como texto) e auditoria isolada.';

-- ---------------------------------------------------------------------------
-- 3. Salvar o planejamento — mesma correção, nível de auditoria válido
-- ---------------------------------------------------------------------------
-- A tela salva antes de aprovar, então uma falha aqui aparecia como falha de
-- aprovação. O corpo é o da Fase 1, com quatro mudanças: `situacao::text` nas
-- comparações, `nivel = 'informacao'` (o antigo 'normal' está fora do domínio da
-- coluna), auditoria isolada e etapa nomeada em falha inesperada.
create or replace function public.salvar_planejamento_programacao(
  p_programacao_id integer,
  p_contas jsonb,
  p_pagamentos jsonb,
  p_saldo_considerado numeric,
  p_total_programado numeric,
  p_restante numeric
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_usuario uuid;
  v_status_anterior text;
  v_fechado_texto text;
  v_conta jsonb;
  v_pagamento jsonb;
  v_pagamento_id integer;
  v_valor numeric(14,2);
  v_etapa text := 'início';
begin
  v_etapa := 'conferência da sessão';
  v_usuario := auth.uid();
  if v_usuario is null then
    raise exception 'Usuário não autenticado.' using errcode = '42501';
  end if;

  v_etapa := 'leitura da programação';
  select pr.status::text, pr.fechado::text
    into v_status_anterior, v_fechado_texto
    from public.programacoes_pagamento pr
   where pr.id = p_programacao_id
   for update;

  if not found then
    raise exception 'Programação não encontrada.';
  end if;

  if lower(coalesce(v_fechado_texto, '')) in ('true', 't', 'sim', '1', 'y', 'yes') then
    raise exception 'Programações históricas fechadas não podem ser alteradas.';
  end if;

  if jsonb_typeof(coalesce(p_contas, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_pagamentos, '[]'::jsonb)) <> 'array' then
    raise exception 'Contas e pagamentos devem ser listas.';
  end if;

  v_etapa := 'gravação dos totais da programação';
  update public.programacoes_pagamento
     set saldo_considerado = round(coalesce(p_saldo_considerado, 0), 2),
         total_programado = round(coalesce(p_total_programado, 0), 2),
         restante = round(coalesce(p_restante, 0), 2),
         responsavel_id = v_usuario,
         updated_at = now()
   where id = p_programacao_id;

  v_etapa := 'gravação das contas de trabalho';
  update public.programacao_contas
     set ativa = false
   where programacao_id = p_programacao_id;

  for v_conta in select value from jsonb_array_elements(coalesce(p_contas, '[]'::jsonb))
  loop
    update public.programacao_contas
       set saldo_considerado = round(coalesce((v_conta->>'saldo_considerado')::numeric, 0), 2),
           ordem = coalesce((v_conta->>'ordem')::integer, 1),
           ativa = true,
           valor_rateado = 0
     where programacao_id = p_programacao_id
       and conta_id = (v_conta->>'conta_id')::integer;

    if not found then
      insert into public.programacao_contas (
        programacao_id, conta_id, saldo_considerado, ordem, ativa, valor_rateado
      ) values (
        p_programacao_id,
        (v_conta->>'conta_id')::integer,
        round(coalesce((v_conta->>'saldo_considerado')::numeric, 0), 2),
        coalesce((v_conta->>'ordem')::integer, 1),
        true,
        0
      );
    end if;
  end loop;

  v_etapa := 'gravação dos fornecedores da programação';
  update public.pagamentos
     set excluido_em = now(),
         excluido_por = v_usuario
   where programacao_id = p_programacao_id
     and excluido_em is null
     and coalesce(situacao::text, '') in ('programado', 'em_aberto');

  for v_pagamento in select value from jsonb_array_elements(coalesce(p_pagamentos, '[]'::jsonb))
  loop
    v_valor := round(coalesce((v_pagamento->>'valor_a_pagar')::numeric, 0), 2);
    if v_valor < 0 then
      raise exception 'O valor programado não pode ser negativo.';
    end if;

    v_pagamento_id := nullif(v_pagamento->>'id', '')::integer;
    if v_pagamento_id is not null then
      update public.pagamentos
         set fornecedor_id = nullif(v_pagamento->>'fornecedor_id', '')::integer,
             nome_avulso = nullif(trim(v_pagamento->>'nome_avulso'), ''),
             valor_a_pagar = v_valor,
             cadastrar_fornecedor_posteriormente = coalesce((v_pagamento->>'cadastrar_fornecedor_posteriormente')::boolean, false),
             excluido_em = null,
             excluido_por = null
       where id = v_pagamento_id
         and programacao_id = p_programacao_id
         and coalesce(situacao::text, '') in ('programado', 'em_aberto');

      if not found then
        raise exception 'Item de pagamento inválido para esta programação.';
      end if;
    else
      insert into public.pagamentos (
        programacao_id,
        fornecedor_id,
        nome_avulso,
        valor_a_pagar,
        situacao,
        cadastrar_fornecedor_posteriormente
      ) values (
        p_programacao_id,
        nullif(v_pagamento->>'fornecedor_id', '')::integer,
        nullif(trim(v_pagamento->>'nome_avulso'), ''),
        v_valor,
        'programado',
        coalesce((v_pagamento->>'cadastrar_fornecedor_posteriormente')::boolean, false)
      );
    end if;
  end loop;

  v_etapa := 'registro na auditoria';
  begin
    insert into public.auditoria_eventos (
      usuario_id, modulo, acao, registro_afetado, valor_anterior, valor_novo, nivel
    ) values (
      public.usuario_auditoria_id(),
      'pagamentos',
      'alterou',
      'Planejamento da programação ' || p_programacao_id::text,
      jsonb_build_object('status', v_status_anterior),
      jsonb_build_object(
        'contas', jsonb_array_length(coalesce(p_contas, '[]'::jsonb)),
        'fornecedores', jsonb_array_length(coalesce(p_pagamentos, '[]'::jsonb)),
        'saldo_considerado', round(coalesce(p_saldo_considerado, 0), 2),
        'total_programado', round(coalesce(p_total_programado, 0), 2),
        'restante', round(coalesce(p_restante, 0), 2)
      ),
      'informacao'
    );
  exception when others then
    raise warning 'Planejamento da programação % salvo, mas o evento de auditoria não foi gravado (% -- %).',
      p_programacao_id, sqlstate, sqlerrm;
  end;

  return jsonb_build_object(
    'ok', true,
    'programacao_id', p_programacao_id,
    'status', v_status_anterior
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
    raise exception
      'Não foi possível salvar a programação na etapa "%". O banco recusou a operação com o código %.',
      v_etapa, sqlstate
      using errcode = 'P0001',
            detail = format(
              '%s | etapa=%s sqlstate=%s | pagamentos.situacao=%s programacoes_pagamento.status=%s programacoes_pagamento.fechado=%s programacao_contas.ativa=%s auditoria_eventos.nivel=%s',
              sqlerrm, v_etapa, sqlstate,
              public.tipo_da_coluna('pagamentos', 'situacao'),
              public.tipo_da_coluna('programacoes_pagamento', 'status'),
              public.tipo_da_coluna('programacoes_pagamento', 'fechado'),
              public.tipo_da_coluna('programacao_contas', 'ativa'),
              public.tipo_da_coluna('auditoria_eventos', 'nivel')
            ),
            hint = 'Leia o DETAIL: ele traz a mensagem crua do Postgres, a etapa e o tipo real de cada coluna suspeita. Tipo diferente do esperado indica qual comparação o banco recusou.';
end $$;

grant execute on function public.salvar_planejamento_programacao(integer, jsonb, jsonb, numeric, numeric, numeric) to authenticated;

comment on function public.salvar_planejamento_programacao(integer, jsonb, jsonb, numeric, numeric, numeric)
is 'Salva somente a proposta diária: contas consideradas, fornecedores e valores. Não altera saldos nem registra movimentações financeiras. Comparações à prova de tipo e auditoria isolada.';

-- ---------------------------------------------------------------------------
-- 4. Marcar em análise — mesma correção
-- ---------------------------------------------------------------------------
create or replace function public.marcar_programacao_em_analise(p_programacao_id integer)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_usuario uuid;
  v_status_anterior text;
  v_fechado_texto text;
  v_etapa text := 'início';
begin
  v_etapa := 'conferência da sessão';
  v_usuario := auth.uid();
  if v_usuario is null then
    raise exception 'Usuário não autenticado.' using errcode = '42501';
  end if;

  v_etapa := 'leitura da programação';
  select pr.status::text, pr.fechado::text
    into v_status_anterior, v_fechado_texto
    from public.programacoes_pagamento pr
   where pr.id = p_programacao_id
   for update;

  if not found then
    raise exception 'Programação não encontrada.';
  end if;

  if lower(coalesce(v_fechado_texto, '')) in ('true', 't', 'sim', '1', 'y', 'yes') then
    raise exception 'Programações históricas fechadas não podem ser alteradas.';
  end if;

  v_etapa := 'gravação do status em análise';
  update public.programacoes_pagamento
     set status = 'em_analise',
         responsavel_id = v_usuario,
         updated_at = now()
   where id = p_programacao_id;

  v_etapa := 'registro na auditoria';
  begin
    insert into public.auditoria_eventos (
      usuario_id, modulo, acao, registro_afetado, valor_anterior, valor_novo, nivel
    ) values (
      public.usuario_auditoria_id(),
      'pagamentos',
      'alterou_status',
      'Programação ' || p_programacao_id::text,
      jsonb_build_object('status', v_status_anterior),
      jsonb_build_object('status', 'em_analise'),
      'informacao'
    );
  exception when others then
    raise warning 'Programação % marcada em análise, mas o evento de auditoria não foi gravado (% -- %).',
      p_programacao_id, sqlstate, sqlerrm;
  end;

  return jsonb_build_object('ok', true, 'programacao_id', p_programacao_id, 'status', 'em_analise');

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
    raise exception
      'Não foi possível marcar a programação como em análise na etapa "%". O banco recusou a operação com o código %.',
      v_etapa, sqlstate
      using errcode = 'P0001',
            detail = format(
              '%s | etapa=%s sqlstate=%s | programacoes_pagamento.status=%s programacoes_pagamento.fechado=%s auditoria_eventos.nivel=%s',
              sqlerrm, v_etapa, sqlstate,
              public.tipo_da_coluna('programacoes_pagamento', 'status'),
              public.tipo_da_coluna('programacoes_pagamento', 'fechado'),
              public.tipo_da_coluna('auditoria_eventos', 'nivel')
            ),
            hint = 'Leia o DETAIL: ele traz a mensagem crua do Postgres, a etapa e o tipo real de cada coluna suspeita. Tipo diferente do esperado indica qual comparação o banco recusou.';
end $$;

grant execute on function public.marcar_programacao_em_analise(integer) to authenticated;

commit;
