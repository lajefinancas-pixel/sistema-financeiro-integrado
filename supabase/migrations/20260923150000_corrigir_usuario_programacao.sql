-- Corrige a identidade gravada pelas RPCs da programação diária.
--
-- Uma redefinição posterior de salvar_planejamento_programacao voltou a usar
-- auth.uid() em colunas que podem referenciar public.usuarios. Cada destino
-- passa pelo resolvedor que consulta a chave estrangeira real. As regras de
-- planejamento, análise, aprovação, baixa, estorno e saldo permanecem iguais.

begin;

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
  -- Id em public.usuarios: é ele, e não auth.uid(), que as colunas com chave
  -- estrangeira para essa tabela aceitam.
  v_usuario_exclusao uuid;    -- pagamentos.excluido_por
  v_usuario_responsavel uuid; -- programacoes_pagamento.responsavel_id
  v_usuario_auditoria uuid;   -- auditoria_eventos.usuario_id
  v_status_anterior text;
  v_fechado_texto text;
  v_conta jsonb;
  v_pagamento jsonb;
  v_pagamento_id integer;
  v_fornecedor_id integer;
  v_situacao_fornecedor text;
  v_valor numeric(14,2);
  v_nome_exibicao text;
  -- Origem do item: informação adicional, nunca vínculo de nota.
  v_origem_tipo text;
  v_origem_texto text;
  v_origem_id uuid;
  v_etapa text := 'início';
  -- Campos estruturados do erro, lidos no tratamento de exceção.
  v_constraint text;
  v_tabela_erro text;
  v_coluna_erro text;
  v_detalhe_erro text;
  v_explicacao text;
begin
  v_etapa := 'conferência da sessão';
  v_usuario := auth.uid();
  if v_usuario is null then
    raise exception 'Usuário não autenticado.' using errcode = '42501';
  end if;
  v_usuario_exclusao := public.usuario_para_coluna('pagamentos', 'excluido_por');
  v_usuario_responsavel := public.usuario_para_coluna('programacoes_pagamento', 'responsavel_id');
  v_usuario_auditoria := public.usuario_para_coluna('auditoria_eventos', 'usuario_id');

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

  -- Conferência dos fornecedores ANTES de gravar qualquer coisa: id que não
  -- existe mais no cadastro vira recusa explicada, e nada foi alterado.
  v_etapa := 'conferência dos fornecedores selecionados';
  for v_pagamento in select value from jsonb_array_elements(coalesce(p_pagamentos, '[]'::jsonb))
  loop
    v_fornecedor_id := nullif(v_pagamento->>'fornecedor_id', '')::integer;
    if v_fornecedor_id is not null then
      v_situacao_fornecedor := public.fornecedor_referenciavel(v_fornecedor_id);
      if v_situacao_fornecedor = 'ausente' then
        raise exception 'Um dos fornecedores escolhidos não existe mais no cadastro. Remova-o da lista de fornecedores da programação, escolha o fornecedor novamente e salve.';
      end if;
    end if;
  end loop;

  v_etapa := 'gravação dos totais da programação';
  update public.programacoes_pagamento
     set saldo_considerado = round(coalesce(p_saldo_considerado, 0), 2),
         total_programado = round(coalesce(p_total_programado, 0), 2),
         restante = round(coalesce(p_restante, 0), 2),
         responsavel_id = v_usuario_responsavel,
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
  -- excluido_por aponta para public.usuarios (id): vai o id do registro do
  -- usuário -- ou NULL, que a coluna aceita -- e NUNCA auth.uid().
  update public.pagamentos
     set excluido_em = now(),
         excluido_por = v_usuario_exclusao
   where programacao_id = p_programacao_id
     and excluido_em is null
     and coalesce(situacao::text, '') in ('programado', 'em_aberto');

  for v_pagamento in select value from jsonb_array_elements(coalesce(p_pagamentos, '[]'::jsonb))
  loop
    v_valor := round(coalesce((v_pagamento->>'valor_a_pagar')::numeric, 0), 2);
    if v_valor < 0 then
      raise exception 'O valor programado não pode ser negativo.';
    end if;

    -- Nome de exibição DESTE item: espaços normalizados, vazio virando NULL
    -- ("usar o apelido; não havendo, a razão social") e tamanho limitado. Ele
    -- não é usado para nada além de mostrar e imprimir.
    v_nome_exibicao := nullif(btrim(regexp_replace(coalesce(v_pagamento->>'nome_exibicao_programacao', ''), '\s+', ' ', 'g')), '');
    if v_nome_exibicao is not null then
      v_nome_exibicao := left(v_nome_exibicao, 120);
    end if;

    -- Origem DESTE item. Vazia é o caso normal. Origem incompleta ou com tipo
    -- desconhecido é recusada em português, antes de gravar.
    v_origem_tipo := nullif(btrim(lower(coalesce(v_pagamento->>'origem_tipo', ''))), '');
    v_origem_texto := nullif(btrim(coalesce(v_pagamento->>'origem_id', '')), '');

    if v_origem_tipo is not null and v_origem_tipo not in ('patrocinio', 'aluguel', 'banda') then
      raise exception 'A origem enviada para um item da programação não é reconhecida (%). Recarregue a página e tente de novo.', v_origem_tipo;
    end if;

    if v_origem_texto is not null
       and v_origem_texto !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'A origem enviada para um item da programação não tem um identificador válido. Recarregue a página e tente de novo.';
    end if;

    if (v_origem_tipo is null) <> (v_origem_texto is null) then
      raise exception 'A origem enviada para um item da programação está incompleta. Recarregue a página e tente de novo.';
    end if;

    v_origem_id := v_origem_texto::uuid;

    v_pagamento_id := nullif(v_pagamento->>'id', '')::integer;
    if v_pagamento_id is not null then
      update public.pagamentos
         set fornecedor_id = nullif(v_pagamento->>'fornecedor_id', '')::integer,
             nome_avulso = nullif(trim(v_pagamento->>'nome_avulso'), ''),
             nome_exibicao_programacao = v_nome_exibicao,
             valor_a_pagar = v_valor,
             cadastrar_fornecedor_posteriormente = coalesce((v_pagamento->>'cadastrar_fornecedor_posteriormente')::boolean, false),
             -- Origem preservada quando o cliente não manda nada.
             origem_tipo = coalesce(v_origem_tipo, pagamentos.origem_tipo),
             origem_id = coalesce(v_origem_id, pagamentos.origem_id),
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
        nome_exibicao_programacao,
        valor_a_pagar,
        situacao,
        cadastrar_fornecedor_posteriormente,
        origem_tipo,
        origem_id
      ) values (
        p_programacao_id,
        nullif(v_pagamento->>'fornecedor_id', '')::integer,
        nullif(trim(v_pagamento->>'nome_avulso'), ''),
        v_nome_exibicao,
        v_valor,
        'programado',
        coalesce((v_pagamento->>'cadastrar_fornecedor_posteriormente')::boolean, false),
        v_origem_tipo,
        v_origem_id
      );
    end if;
  end loop;

  v_etapa := 'registro na auditoria';
  begin
    insert into public.auditoria_eventos (
      usuario_id, modulo, acao, registro_afetado, valor_anterior, valor_novo, nivel
    ) values (
      v_usuario_auditoria,
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
      ) || public.rastro_do_login(v_usuario_auditoria),
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
    -- ainda não rodou" e dizer qual arquivo executar.
    if sqlstate in ('P0001', '42501', '42P01', '42703', '42883', '42P13') then
      raise;
    end if;

    get stacked diagnostics
      v_constraint = constraint_name,
      v_tabela_erro = table_name,
      v_coluna_erro = column_name,
      v_detalhe_erro = pg_exception_detail;

    if sqlstate = '23503' then
      v_explicacao := case
        when coalesce(v_constraint, '') like '%excluido_por%'
          or coalesce(v_constraint, '') like '%criado_por%'
          or coalesce(v_constraint, '') like '%usuario%'
          or coalesce(v_constraint, '') like '%responsavel%'
          or coalesce(v_constraint, '') like '%aprovada_por%'
          then ' O vínculo recusado foi o do usuário responsável pela gravação: o seu login não tem registro correspondente no cadastro de usuários do sistema. Peça para a Equipe conferir o seu cadastro.'
        when coalesce(v_constraint, '') like '%fornecedor%'
          then ' O vínculo recusado foi o de um fornecedor: um dos fornecedores escolhidos não existe mais no cadastro. Remova-o da lista, escolha o fornecedor novamente e salve.'
        when coalesce(v_constraint, '') like '%conta_id%'
          or coalesce(v_constraint, '') like '%conta_origem%'
          or coalesce(v_constraint, '') like '%conta_destino%'
          or coalesce(v_constraint, '') like '%conta_pagamento%'
          then ' O vínculo recusado foi o de uma conta bancária: alguma das contas escolhidas não existe mais. Recarregue a página, refaça a seleção de contas e salve.'
        when coalesce(v_constraint, '') like '%programacao%'
          then ' O vínculo recusado foi o da própria programação: ela não existe mais. Recarregue a página e abra a programação de novo.'
        when coalesce(v_constraint, '') like '%secretaria%'
          then ' O vínculo recusado foi o da secretaria: a secretaria escolhida não existe mais. Recarregue a página e selecione a secretaria de novo.'
        else ' O banco recusou um vínculo entre registros. O detalhe está no console do navegador (F12).'
      end;
    else
      v_explicacao := '';
    end if;

    raise exception
      'Não foi possível salvar a programação na etapa "%". O banco recusou a operação com o código %.%',
      v_etapa, sqlstate, v_explicacao
      using errcode = 'P0001',
            detail = format(
              '%s | etapa=%s sqlstate=%s constraint=%s tabela=%s coluna=%s detalhe=%s | pagamentos.situacao=%s pagamentos.excluido_por=%s pagamentos.nome_exibicao_programacao=%s pagamentos.origem_tipo=%s pagamentos.origem_id=%s programacoes_pagamento.status=%s programacoes_pagamento.fechado=%s programacao_contas.ativa=%s auditoria_eventos.nivel=%s',
              sqlerrm, v_etapa, sqlstate,
              coalesce(v_constraint, '-'),
              coalesce(v_tabela_erro, '-'),
              coalesce(v_coluna_erro, '-'),
              coalesce(v_detalhe_erro, '-'),
              public.tipo_da_coluna('pagamentos', 'situacao'),
              public.tipo_da_coluna('pagamentos', 'excluido_por'),
              public.tipo_da_coluna('pagamentos', 'nome_exibicao_programacao'),
              public.tipo_da_coluna('pagamentos', 'origem_tipo'),
              public.tipo_da_coluna('pagamentos', 'origem_id'),
              public.tipo_da_coluna('programacoes_pagamento', 'status'),
              public.tipo_da_coluna('programacoes_pagamento', 'fechado'),
              public.tipo_da_coluna('programacao_contas', 'ativa'),
              public.tipo_da_coluna('auditoria_eventos', 'nivel')
            ),
            hint = 'Leia o DETAIL: constraint, tabela e coluna dizem qual chave estrangeira o banco recusou, e detalhe traz o valor que não existe na tabela referenciada.';
end $$;

grant execute on function public.salvar_planejamento_programacao(integer, jsonb, jsonb, numeric, numeric, numeric) to authenticated;

comment on function public.salvar_planejamento_programacao(integer, jsonb, jsonb, numeric, numeric, numeric)
is 'Salva somente a proposta diária: contas consideradas, fornecedores, valores, o nome de exibição e a origem (área) de cada item. Não altera saldos, não registra movimentações financeiras, não dá baixa em nota e não escreve nada em public.fornecedores nem nas tabelas das áreas.';


create or replace function public.marcar_programacao_em_analise(p_programacao_id integer)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_usuario uuid;
  -- Um id de usuário por coluna, resolvido pelo vínculo real da coluna:
  -- public.usuario_para_coluna devolve o id de public.usuarios quando a coluna
  -- aponta para lá (NULL quando a sessão não tem registro), e nunca um id que a
  -- chave estrangeira recusaria.
  v_usuario_responsavel uuid; -- programacoes_pagamento.responsavel_id
  v_usuario_auditoria uuid;   -- auditoria_eventos.usuario_id
  v_status_anterior text;
  v_fechado_texto text;
  v_etapa text := 'início';
begin
  v_etapa := 'conferência da sessão';
  v_usuario := auth.uid();
  if v_usuario is null then
    raise exception 'Usuário não autenticado.' using errcode = '42501';
  end if;
  v_usuario_responsavel := public.usuario_para_coluna('programacoes_pagamento', 'responsavel_id');
  v_usuario_auditoria := public.usuario_para_coluna('auditoria_eventos', 'usuario_id');

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
         responsavel_id = v_usuario_responsavel,
         updated_at = now()
   where id = p_programacao_id;

  v_etapa := 'registro na auditoria';
  begin
    insert into public.auditoria_eventos (
      usuario_id, modulo, acao, registro_afetado, valor_anterior, valor_novo, nivel
    ) values (
      v_usuario_auditoria,
      'pagamentos',
      'alterou_status',
      'Programação ' || p_programacao_id::text,
      jsonb_build_object('status', v_status_anterior),
      jsonb_build_object('status', 'em_analise') || public.rastro_do_login(v_usuario_auditoria),
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

comment on function public.marcar_programacao_em_analise(integer)
is 'Marca a programação como em análise. Não move saldo. responsavel_id e o usuario_id da auditoria recebem o id que o vínculo da coluna aceita.';

-- ---------------------------------------------------------------------------
-- 6. Aprovar a programação — Fase 2, NENHUM saldo se move
-- ---------------------------------------------------------------------------
-- Corpo idêntico ao da 20260828170000. Mudam aprovada_por e o usuario_id da
-- trilha.
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
  -- Um id de usuário por coluna, resolvido pelo vínculo real da coluna:
  -- public.usuario_para_coluna devolve o id de public.usuarios quando a coluna
  -- aponta para lá (NULL quando a sessão não tem registro), e nunca um id que a
  -- chave estrangeira recusaria.
  v_usuario_aprovacao uuid; -- programacoes_pagamento.aprovada_por
  v_usuario_auditoria uuid; -- auditoria_eventos.usuario_id
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
  v_usuario_aprovacao := public.usuario_para_coluna('programacoes_pagamento', 'aprovada_por');
  v_usuario_auditoria := public.usuario_para_coluna('auditoria_eventos', 'usuario_id');

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
         aprovada_por = v_usuario_aprovacao,
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
      v_usuario_auditoria,
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
      ) || public.rastro_do_login(v_usuario_auditoria),
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
is 'Aprova a programação diária. APROVADO NAO E PAGO: não debita conta, não dá baixa em NF, não altera saldo de fornecedor e não marca nota como paga. Comparações à prova de tipo, auditoria isolada e id de usuário resolvido pelo vínculo da coluna.';


commit;

