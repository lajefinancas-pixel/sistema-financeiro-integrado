-- FASE 1 + FASE 2 — padronização do id de usuário em toda coluna que aponta
-- para um cadastro de usuário (causa raiz do 23503).
--
-- ATENÇÃO: esta migration precisa ser rodada MANUALMENTE no SQL Editor do
-- Supabase (o mesmo projeto usado pela aplicação), como as da Fase 2, a
-- 20260828170000 e a 20260828190000. Nada nela roda sozinho no deploy.
--
-- PRÉ-REQUISITO: a 20260828190000 precisa ter rodado antes. É dela que vem
-- public.fornecedor_referenciavel, usada pelo salvamento e não redefinida aqui.
--
-- O QUE O DIAGNÓSTICO NO BANCO DE PRODUÇÃO MOSTROU
--
-- Comparando auth.users com public.usuarios: os TRÊS usuários que fazem login
-- no sistema NÃO têm linha correspondente em public.usuarios. Nenhum id de
-- auth.users existe naquela tabela.
--
-- Consequência direta, e é a causa do 23503:
--
--   * public.pagamentos.excluido_por referencia public.usuarios (id). Gravar
--     auth.uid() ali é gravar um id que não existe na tabela referenciada, e o
--     banco recusa com foreign_key_violation -- sempre na mesma etapa, com
--     qualquer valor e qualquer fornecedor.
--   * public.auditoria_eventos.usuario_id referencia public.usuarios (id) do
--     mesmo jeito (20260811130000). Toda trilha gravada com auth.uid() cai pelo
--     mesmo motivo.
--
-- POR QUE public.usuario_auditoria_id() NÃO RESOLVE
--
-- Foi a primeira pergunta a conferir, e a resposta é não. O corpo dela, criado
-- pela Fase 2, é:
--
--   select coalesce(
--     (select u.id from public.usuarios u where u.auth_id = auth.uid() limit 1),
--     auth.uid()                                  -- <= último recurso
--   );
--
-- Quando o usuário NÃO tem linha em public.usuarios -- exatamente o caso dos
-- três usuários deste banco -- ela devolve auth.uid(), que é o id inexistente.
-- Trocar auth.uid() por ela em coluna com chave estrangeira não muda nada: o
-- valor gravado continua sendo o que o banco recusa. Em coluna com vínculo, o
-- "último recurso" É o defeito.
--
-- O PADRÃO QUE ESTA MIGRATION IMPLANTA
--
-- Uma regra, aplicada a TODA coluna de usuário das duas fases, decidida pelo
-- vínculo real da coluna (public.usuario_para_coluna lê pg_constraint):
--
--   coluna aponta para public.usuarios  -> id de public.usuarios, ou NULL
--                                          quando a sessão não tem registro.
--                                          As colunas são anuláveis e a
--                                          exclusão é `on delete set null`:
--                                          NULL é gravação válida, e nenhum
--                                          vínculo é violado.
--   coluna aponta para auth.users       -> auth.uid().
--   coluna sem vínculo nenhum           -> id de public.usuarios quando existe,
--                                          auth.uid() como último recurso. Sem
--                                          chave estrangeira não há o que
--                                          violar, e é o id de public.usuarios
--                                          que as telas usam para mostrar o
--                                          nome de quem fez.
--
-- A regra é lida da coluna, não escrita à mão função por função: se um vínculo
-- for criado amanhã em programacoes_pagamento.responsavel_id, o valor gravado
-- se ajusta sozinho e o 23503 não volta.
--
-- RASTREABILIDADE QUANDO O ID VAI NULO
--
-- Com usuario_id nulo a trilha perderia quem fez -- e auditoria_eventos.usuario_id
-- é justamente uma das colunas com vínculo. Por isso, e SÓ nesse caso,
-- public.rastro_do_login acrescenta ao valor_novo do evento:
--
--   "login_sem_cadastro": true, "login_auth_id": "<id do auth da sessão>"
--
-- A trilha continua identificando a pessoa, dentro de um campo jsonb que já
-- existe, sem coluna nova e sem vínculo novo. Quando o id de public.usuarios
-- existe, nada é acrescentado e o evento fica idêntico ao de hoje.
--
-- AS SEIS FUNÇÕES AUDITADAS E PADRONIZADAS
--
--   public.salvar_planejamento_programacao  pagamentos.excluido_por (com
--                                           vínculo -> NULL quando não há
--                                           registro), responsavel_id,
--                                           auditoria_eventos.usuario_id
--   public.marcar_programacao_em_analise    responsavel_id, auditoria
--   public.aprovar_programacao_pagamento    aprovada_por, auditoria
--   public.definir_conta_origem_pagamento   auditoria
--   public.confirmar_transferencias_programacao  usuario_id do lote e da perna,
--                                           auditoria
--   public.estornar_transferencia           usuario_id do lote e da perna,
--                                           estornada_por, estornado_por,
--                                           auditoria
--
-- Nenhuma outra mudança nos corpos: as regras de negócio, as validações, as
-- mensagens, as etapas nomeadas, a idempotência das transferências e os travamentos
-- por conta são os mesmos, linha por linha, das migrations já aplicadas.
--
-- UMA ÚNICA EXCEÇÃO, E ELA É DA MESMA FAMÍLIA DE DEFEITO
--
-- Em public.definir_conta_origem_pagamento a gravação da trilha NÃO estava
-- isolada: uma recusa exclusiva da auditoria derrubava a definição da conta, que
-- já estava gravada. Passa a ficar isolada em begin/exception com raise warning,
-- como a 20260828170000 fez na Fase 1. Nas duas funções de transferência a
-- trilha continua atômica com a movimentação, de propósito: ali o saldo se move,
-- e movimento sem trilha é pior do que operação recusada.
--
-- REGRAS PRESERVADAS, SEM EXCEÇÃO
--
--   * SALVAR NÃO É PAGAR e APROVAR NÃO É PAGAR: nenhuma linha de saldo, nenhuma
--     baixa, nenhuma nota marcada como paga, nenhum saldo de fornecedor. A
--     transferência continua sendo a única operação que move saldo.
--   * Seleção de contas, saldo total, valores editáveis, fornecedor avulso,
--     blocos recolhíveis, impressão, PDF, Excel e as mensagens de erro
--     detalhadas: nada muda. As assinaturas chamadas pela tela são as mesmas.
--   * Nenhuma tabela, coluna, política ou permissão é criada, alterada ou
--     removida. Nenhum dado é apagado ou reescrito. Nenhum drop de função.
--   * Nada de Saldos das Contas, Fornecedores, Certidões, Baixas, Tarefas,
--     Histórico, Relatórios, Auditoria (estrutura), Configurações ou backup é
--     tocado.
--
-- O QUE ESTA MIGRATION NÃO FAZ, DE PROPÓSITO
--
-- Não cria, não corrige e não sincroniza cadastro de usuário. O fato de nenhum
-- usuário de auth.users ter linha em public.usuarios é um problema de cadastro,
-- separado deste, e fica para avaliação com calma. Esta migration apenas para de
-- gravar um id que o banco recusa.
--
-- IDEMPOTENTE: pode rodar quantas vezes for preciso. Só substitui corpo de
-- função, mantendo assinatura, tipo de retorno e grants.

begin;

-- ---------------------------------------------------------------------------
-- 1. Id do usuário da sessão em public.usuarios, ou NULL
-- ---------------------------------------------------------------------------
-- Mesma função da 20260828190000, repetida aqui porque é a base do resolvedor
-- abaixo: `create or replace` com corpo idêntico é inócuo se ela já existe.
create or replace function public.usuario_registro_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select u.id from public.usuarios u where u.auth_id = auth.uid() limit 1),
    (select u.id from public.usuarios u where u.id = auth.uid() limit 1)
  );
$$;

grant execute on function public.usuario_registro_id() to authenticated;

comment on function public.usuario_registro_id()
is 'Id do usuário da sessão em public.usuarios, ou NULL quando não há registro. Use em coluna com chave estrangeira para public.usuarios: auth.uid() não é um id válido dessa tabela e causa 23503.';

-- O aviso fica registrado na própria função que era o caminho natural -- e
-- errado -- para essas colunas. Só o comentário muda; o corpo dela não é tocado,
-- porque objetos fora destas duas fases podem depender do que ela devolve hoje.
comment on function public.usuario_auditoria_id()
is 'ATENÇÃO: devolve auth.uid() como último recurso, e esse id NÃO existe em public.usuarios. NÃO use em coluna com chave estrangeira para public.usuarios (23503) -- use public.usuario_para_coluna(tabela, coluna) ou public.usuario_registro_id().';

-- ---------------------------------------------------------------------------
-- 2. Qual id de usuário esta coluna aceita?
-- ---------------------------------------------------------------------------
-- A pergunta é respondida pelo catálogo, não por convenção de nome: pg_constraint
-- diz para onde a coluna aponta, e o valor gravado segue esse destino.
--
--   -> public.usuarios : id de public.usuarios, ou NULL. Nunca um id que a
--                        chave estrangeira recusaria.
--   -> auth.users      : auth.uid().
--   sem vínculo        : id de public.usuarios quando existe, auth.uid() como
--                        último recurso -- não há vínculo para violar, e é o id
--                        de public.usuarios que as telas usam para mostrar o
--                        nome de quem fez.
--
-- Tabela inexistente, coluna inexistente ou qualquer falha na leitura do
-- catálogo caem no mesmo último recurso: esta função não pode derrubar uma
-- gravação.
create or replace function public.usuario_para_coluna(p_tabela text, p_coluna text)
returns uuid
language plpgsql
stable
set search_path = public
as $$
declare
  v_registro uuid;
  v_destino text;
  v_atributo smallint;
begin
  v_registro := public.usuario_registro_id();

  select a.attnum
    into v_atributo
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname = p_tabela
     and a.attname = p_coluna
     and a.attnum > 0
     and not a.attisdropped;

  if v_atributo is null then
    return coalesce(v_registro, auth.uid());
  end if;

  select case
           when destino_ns.nspname = 'public' and destino.relname = 'usuarios' then 'usuarios'
           when destino_ns.nspname = 'auth' and destino.relname = 'users' then 'auth'
           else 'outro'
         end
    into v_destino
    from pg_constraint fk
    join pg_class origem on origem.oid = fk.conrelid
    join pg_namespace origem_ns on origem_ns.oid = origem.relnamespace
    join pg_class destino on destino.oid = fk.confrelid
    join pg_namespace destino_ns on destino_ns.oid = destino.relnamespace
   where fk.contype = 'f'
     and origem_ns.nspname = 'public'
     and origem.relname = p_tabela
     and fk.conkey = array[v_atributo]::smallint[]
   limit 1;

  if v_destino = 'usuarios' then
    return v_registro;
  elsif v_destino = 'auth' then
    return auth.uid();
  end if;

  return coalesce(v_registro, auth.uid());
exception
  when others then
    return coalesce(v_registro, auth.uid());
end $$;

grant execute on function public.usuario_para_coluna(text, text) to authenticated;

comment on function public.usuario_para_coluna(text, text)
is 'Id de usuário que a coluna informada aceita, decidido pelo vínculo real dela em pg_constraint: public.usuarios (ou NULL), auth.uid(), ou o melhor id disponível quando não há vínculo. Evita o 23503 de gravar auth.uid() em coluna que referencia public.usuarios.';

-- ---------------------------------------------------------------------------
-- 3. Rastro do login quando o id do usuário vai nulo
-- ---------------------------------------------------------------------------
-- Só acrescenta algo no caso degradado: id nulo significa login sem cadastro em
-- public.usuarios, e sem isso a trilha perderia quem fez. Com id presente
-- devolve objeto vazio, e o evento de auditoria fica idêntico ao de hoje.
create or replace function public.rastro_do_login(p_usuario_id uuid)
returns jsonb
language sql
stable
as $$
  select case
           when p_usuario_id is not null then '{}'::jsonb
           else jsonb_build_object('login_sem_cadastro', true, 'login_auth_id', auth.uid())
         end;
$$;

grant execute on function public.rastro_do_login(uuid) to authenticated;

comment on function public.rastro_do_login(uuid)
is 'Acréscimo para o valor_novo do evento de auditoria quando o id do usuário vai nulo (login sem registro em public.usuarios): guarda login_sem_cadastro e login_auth_id. Objeto vazio quando o id existe.';

-- ---------------------------------------------------------------------------
-- 4. Salvar o planejamento — Fase 1
-- ---------------------------------------------------------------------------
-- Corpo idêntico ao da 20260828190000. Mudam três gravações de id de usuário:
-- excluido_por, responsavel_id e o usuario_id da trilha passam pelo resolvedor.
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
  -- Um id de usuário por coluna, resolvido pelo vínculo real da coluna:
  -- public.usuario_para_coluna devolve o id de public.usuarios quando a coluna
  -- aponta para lá (NULL quando a sessão não tem registro), e nunca um id que a
  -- chave estrangeira recusaria.
  v_usuario_registro uuid;    -- pagamentos.excluido_por
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
  v_usuario_registro := public.usuario_para_coluna('pagamentos', 'excluido_por');
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
  -- AQUI ESTAVA O 23503: excluido_por aponta para public.usuarios (id), e o que
  -- ia nele era auth.uid(). Agora vai o id do registro do usuário -- ou NULL,
  -- que a coluna aceita, quando a sessão não tem registro em public.usuarios.
  update public.pagamentos
     set excluido_em = now(),
         excluido_por = v_usuario_registro
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
    -- ainda não rodou" e dizer qual arquivo executar -- reescrevê-los como
    -- P0001 apagaria esse aviso.
    if sqlstate in ('P0001', '42501', '42P01', '42703', '42883', '42P13') then
      raise;
    end if;

    -- Campos estruturados do erro. Um raise exception novo os perderia, então
    -- eles são lidos aqui e vão para o DETAIL: é o que identifica a chave
    -- estrangeira exata em um único teste, sem adivinhação.
    get stacked diagnostics
      v_constraint = constraint_name,
      v_tabela_erro = table_name,
      v_coluna_erro = column_name,
      v_detalhe_erro = pg_exception_detail;

    -- 23503 ganha explicação em português por vínculo, para a tela poder dizer o
    -- que fazer. O nome da constraint fica no DETAIL, fora da tela.
    -- A ordem é do mais específico para o mais genérico, e casa com a coluna,
    -- não com a tabela: o nome padrão de uma chave estrangeira no Postgres é
    -- <tabela>_<coluna>_fkey, e é a COLUNA que diz qual vínculo caiu. Sem isso
    -- 'programacao_contas_conta_id_fkey' e
    -- 'programacao_contas_programacao_id_fkey' cairiam na mesma explicação.
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
              '%s | etapa=%s sqlstate=%s constraint=%s tabela=%s coluna=%s detalhe=%s | pagamentos.situacao=%s pagamentos.excluido_por=%s programacoes_pagamento.status=%s programacoes_pagamento.fechado=%s programacao_contas.ativa=%s auditoria_eventos.nivel=%s',
              sqlerrm, v_etapa, sqlstate,
              coalesce(v_constraint, '-'),
              coalesce(v_tabela_erro, '-'),
              coalesce(v_coluna_erro, '-'),
              coalesce(v_detalhe_erro, '-'),
              public.tipo_da_coluna('pagamentos', 'situacao'),
              public.tipo_da_coluna('pagamentos', 'excluido_por'),
              public.tipo_da_coluna('programacoes_pagamento', 'status'),
              public.tipo_da_coluna('programacoes_pagamento', 'fechado'),
              public.tipo_da_coluna('programacao_contas', 'ativa'),
              public.tipo_da_coluna('auditoria_eventos', 'nivel')
            ),
            hint = 'Leia o DETAIL: constraint, tabela e coluna dizem qual chave estrangeira o banco recusou, e detalhe traz o valor que não existe na tabela referenciada.';
end $$;

grant execute on function public.salvar_planejamento_programacao(integer, jsonb, jsonb, numeric, numeric, numeric) to authenticated;

comment on function public.salvar_planejamento_programacao(integer, jsonb, jsonb, numeric, numeric, numeric)
is 'Salva somente a proposta diária: contas consideradas, fornecedores e valores. Não altera saldos nem registra movimentações financeiras. Toda coluna de usuário recebe o id que o vínculo dela aceita (public.usuario_para_coluna), nunca auth.uid() às cegas.';

-- ---------------------------------------------------------------------------
-- 5. Marcar em análise — Fase 1
-- ---------------------------------------------------------------------------
-- Corpo idêntico ao da 20260828170000. Mudam responsavel_id e o usuario_id da
-- trilha.
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

-- ---------------------------------------------------------------------------
-- 7. Conta por pagamento — Fase 2, definir NÃO debita conta
-- ---------------------------------------------------------------------------
-- Corpo idêntico ao da Fase 2, com duas mudanças: o usuario_id da trilha passa
-- pelo resolvedor e a gravação da trilha fica isolada, para não derrubar uma
-- definição de conta que já está gravada.
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
  -- Um id de usuário por coluna, resolvido pelo vínculo real da coluna:
  -- public.usuario_para_coluna devolve o id de public.usuarios quando a coluna
  -- aponta para lá (NULL quando a sessão não tem registro), e nunca um id que a
  -- chave estrangeira recusaria.
  v_usuario_auditoria uuid; -- auditoria_eventos.usuario_id
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
  v_usuario_auditoria := public.usuario_para_coluna('auditoria_eventos', 'usuario_id');

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

  -- Auditar NUNCA derruba a ação principal: o vínculo acima já está gravado e
  -- uma falha exclusiva da trilha desfaz só este bloco. É a disciplina que a
  -- 20260828170000 aplicou na Fase 1, e ela cabe aqui porque definir a conta
  -- não move saldo -- ao contrário da transferência, em que trilha e
  -- movimentação precisam cair juntas.
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
end $$;

grant execute on function public.definir_conta_origem_pagamento(integer, integer[], integer) to authenticated;

comment on function public.definir_conta_origem_pagamento(integer, integer[], integer)
is 'Define a conta de origem de um ou mais pagamentos da programação. CONTA DEFINIDA NAO E DEBITO: nenhum saldo é movimentado aqui. Auditoria isolada e id de usuário resolvido pelo vínculo da coluna.';

-- ---------------------------------------------------------------------------
-- 8. Transferência entre contas — Fase 2, a ÚNICA que move saldo
-- ---------------------------------------------------------------------------
-- Corpo idêntico ao da Fase 2. Mudam os usuario_id do lote, da perna e da
-- trilha. A trilha continua atômica com a movimentação: aqui o saldo se move.
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
  v_usuario_lote := public.usuario_para_coluna('transferencia_lotes', 'usuario_id');
  v_usuario_perna := public.usuario_para_coluna('transferencias_contas', 'usuario_id');
  v_usuario_auditoria := public.usuario_para_coluna('auditoria_eventos', 'usuario_id');

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
    nullif(trim(coalesce(p_observacao, '')), ''), v_usuario_lote, 'confirmada'
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
end;
$fn$;

grant execute on function public.confirmar_transferencias_programacao(integer, integer, jsonb, text, text) to authenticated;

comment on function public.confirmar_transferencias_programacao(integer, integer, jsonb, text, text)
is 'Transferência entre contas próprias: várias origens para um destino, atômica e idempotente pela chave. NAO E DESPESA — não escreve em pagamento_movimentacoes nem em pagamentos_baixas. Id de usuário resolvido pelo vínculo de cada coluna.';

-- ---------------------------------------------------------------------------
-- 9. Estorno — Fase 2, transferência não se exclui, se estorna
-- ---------------------------------------------------------------------------
-- Corpo idêntico ao da Fase 2. Mudam os usuario_id do lote e da perna,
-- estornada_por, estornado_por e os dois eventos da trilha.
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
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado.' using errcode = '42501';
  end if;
  v_usuario_lote := public.usuario_para_coluna('transferencia_lotes', 'usuario_id');
  v_usuario_perna := public.usuario_para_coluna('transferencias_contas', 'usuario_id');
  v_usuario_estorno := public.usuario_para_coluna('transferencias_contas', 'estornada_por');
  v_usuario_lote_estorno := public.usuario_para_coluna('transferencia_lotes', 'estornado_por');
  v_usuario_auditoria := public.usuario_para_coluna('auditoria_eventos', 'usuario_id');

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
    'estorno:' || p_transferencia_id::text, v_programacao, v_origem_id, v_motivo, v_usuario_lote,
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
    v_data_alvo, v_motivo, v_usuario_perna, 'estorno', p_transferencia_id, v_motivo
  )
  returning id into v_estorno_id;

  update public.transferencias_contas
     set status = 'estornada',
         estornada_em = now(),
         estornada_por = v_usuario_estorno,
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
         estornado_por = v_usuario_lote_estorno,
         motivo_estorno = v_motivo
   where id = v_lote_id;

  -- DOIS eventos: o estorno da original e a movimentação inversa.
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
end;
$fn$;

grant execute on function public.estornar_transferencia(uuid, text) to authenticated;

comment on function public.estornar_transferencia(uuid, text)
is 'Estorna uma transferência entre contas lançando a movimentação inversa. Exige motivo e PRESERVA a transferência original na razão, no Histórico e na Auditoria. Id de usuário resolvido pelo vínculo de cada coluna.';

commit;
