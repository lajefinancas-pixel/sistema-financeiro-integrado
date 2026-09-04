-- Apelido do fornecedor e nome de exibição do item da programação diária.
--
-- ATENÇÃO: esta migration precisa ser rodada MANUALMENTE no SQL Editor do
-- Supabase (o mesmo projeto usado pela aplicação). Nada nela roda sozinho no
-- deploy. Enquanto ela não rodar, as telas continuam funcionando exatamente
-- como hoje: as consultas repetem sem as colunas novas e os campos de apelido
-- e de nome de exibição simplesmente não aparecem.
--
-- O QUE ELA CRIA (tudo NOVO e OPCIONAL)
--
--   1. public.fornecedores.apelido -> "Apelido / Nome de exibição" do cadastro
--      ("Zé Alimentos"). NÃO substitui e NÃO altera a razão social
--      ("José da Silva Comércio de Alimentos Ltda."), que continua gravada e
--      continua sendo a usada nos locais oficiais e fiscais. Fornecedor sem
--      apelido continua salvando e aparecendo como sempre.
--   2. public.pagamentos.nome_exibicao_programacao -> o nome com que o
--      fornecedor aparece NAQUELA programação ("Zé Alimentos — Merenda"). É do
--      ITEM da programação, não do cadastro.
--   3. public.definir_nome_exibicao_programacao(integer, text) -> grava esse
--      nome de um item já salvo, sem sair da tela. Ela escreve UMA coluna e
--      mais nada.
--   4. public.fornecedores_identificacao passa a expor o apelido, para a busca
--      de fornecedor do módulo Certidões encontrar por ele. A view continua sem
--      dado bancário e sem alíquota, e continua liberada pela mesma permissão.
--   5. public.salvar_planejamento_programacao volta a ser criada IGUAL à da
--      20260828190000, com uma única diferença: grava também o nome de exibição
--      do item.
--
-- O QUE A EDIÇÃO DO NOME NA PROGRAMAÇÃO NÃO PODE ALTERAR -- E NÃO ALTERA
--
--   * razão social, nome fantasia, apelido, CNPJ/CPF e qualquer outro campo do
--     cadastro do fornecedor: nenhuma instrução desta migration escreve em
--     public.fornecedores;
--   * notas, processos, valores em aberto, dados bancários, histórico e
--     auditoria: nada é apagado, reescrito ou reclassificado;
--   * o VÍNCULO: pagamentos.fornecedor_id continua sendo o único vínculo do
--     item com o cadastro. O nome de exibição é texto de tela e de papel, nunca
--     critério de busca de nota ou de processo.
--
-- REGRAS FINANCEIRAS PRESERVADAS, SEM EXCEÇÃO
--
--   * A BAIXA NÃO DEBITA O SALDO DA CONTA: nada aqui toca baixa, saldo ou
--     valor em aberto.
--   * CONTA SELECIONADA ≠ CONTA DEBITADA. PROGRAMADO ≠ PAGO. APROVADO ≠ PAGO:
--     salvar_planejamento_programacao continua gravando somente a proposta.
--   * TRANSFERÊNCIA ENTRE CONTAS NÃO É DESPESA: intocada.
--   * Nenhuma coluna é removida ou renomeada, nenhum registro existente é
--     alterado, nenhum saldo é recalculado.
--
-- PRÉ-REQUISITOS (já rodados neste banco): a 20260828190000, que criou
-- public.usuario_registro_id() e public.fornecedor_referenciavel(), e a
-- 20260824130000, que versionou public.fornecedores_identificacao.
--
-- IDEMPOTENTE: pode rodar quantas vezes for preciso.

begin;

-- ---------------------------------------------------------------------------
-- 0. Conferência dos tipos reais antes de qualquer alteração de estrutura
-- ---------------------------------------------------------------------------
do $$
declare
  item record;
  tipo_real text;
begin
  for item in
    select * from (values
      ('fornecedores', 'id', 'integer'),
      ('pagamentos', 'id', 'integer'),
      ('pagamentos', 'fornecedor_id', 'integer')
    ) as tipos(tabela, coluna, esperado)
  loop
    if to_regclass(format('public.%I', item.tabela)) is null then
      raise exception 'Estrutura incompatível: public.% não existe.', item.tabela;
    end if;

    select format_type(a.atttypid, a.atttypmod)
      into tipo_real
      from pg_attribute a
     where a.attrelid = to_regclass(format('public.%I', item.tabela))
       and a.attname = item.coluna
       and not a.attisdropped;

    if tipo_real is distinct from item.esperado then
      raise exception 'Tipo incompatível em public.%.%: esperado %, encontrado %.',
        item.tabela, item.coluna, item.esperado, coalesce(tipo_real, 'coluna ausente');
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Apelido no cadastro do fornecedor
-- ---------------------------------------------------------------------------
-- Coluna NOVA e OPCIONAL. A razão social não é tocada: continua no mesmo lugar,
-- com o mesmo conteúdo, e continua obrigatória no cadastro.
alter table public.fornecedores
  add column if not exists apelido text;

comment on column public.fornecedores.apelido is
  'Apelido / nome de exibição do fornecedor ("Zé Alimentos"). Opcional. NÃO substitui a razão social, que continua gravada em razao_social e continua sendo usada nos documentos oficiais e fiscais.';

-- ---------------------------------------------------------------------------
-- 2. Nome de exibição do item da programação
-- ---------------------------------------------------------------------------
-- Coluna NOVA e OPCIONAL, no ITEM da programação (public.pagamentos). Vazia
-- significa "usar o apelido; não havendo, a razão social".
alter table public.pagamentos
  add column if not exists nome_exibicao_programacao text;

comment on column public.pagamentos.nome_exibicao_programacao is
  'Nome com que o fornecedor aparece NESTA programação ("Zé Alimentos — Merenda"). Vale só para este item: não altera o cadastro do fornecedor, não altera o apelido e nunca é usado como critério de busca -- o vínculo é sempre fornecedor_id.';

-- ---------------------------------------------------------------------------
-- 3. Gravar o nome de exibição de um item já salvo
-- ---------------------------------------------------------------------------
-- Escreve UMA coluna de UM item da programação. Security invoker: valem as
-- mesmas policies que já governam public.pagamentos hoje.
--
-- O que ela NÃO faz, por construção: não escreve em public.fornecedores, não
-- mexe em fornecedor_id, não mexe em valor, situação ou conta, não movimenta
-- saldo e não dá baixa em nota.
create or replace function public.definir_nome_exibicao_programacao(
  p_pagamento_id integer,
  p_nome text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_nome text;
  v_anterior text;
  v_programacao_id integer;
  v_fornecedor_id integer;
  v_fechado_texto text;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado.' using errcode = '42501';
  end if;

  if p_pagamento_id is null then
    raise exception 'Salve a programação antes de renomear este fornecedor.';
  end if;

  -- Espaços repetidos viram um só, campo vazio vira NULL ("usar o nome de
  -- sempre") e o texto é limitado ao mesmo tamanho aceito pela tela.
  v_nome := nullif(btrim(regexp_replace(coalesce(p_nome, ''), '\s+', ' ', 'g')), '');
  if v_nome is not null then
    v_nome := left(v_nome, 120);
  end if;

  select p.programacao_id, p.fornecedor_id, p.nome_exibicao_programacao
    into v_programacao_id, v_fornecedor_id, v_anterior
    from public.pagamentos p
   where p.id = p_pagamento_id
     and p.excluido_em is null
   for update;

  if not found then
    raise exception 'Item de pagamento não encontrado nesta programação.';
  end if;

  select pr.fechado::text
    into v_fechado_texto
    from public.programacoes_pagamento pr
   where pr.id = v_programacao_id;

  if lower(coalesce(v_fechado_texto, '')) in ('true', 't', 'sim', '1', 'y', 'yes') then
    raise exception 'Programações históricas fechadas não podem ser alteradas.';
  end if;

  update public.pagamentos
     set nome_exibicao_programacao = v_nome
   where id = p_pagamento_id;

  -- Trilha isolada: falha só dela não derruba a renomeação.
  begin
    insert into public.auditoria_eventos (
      usuario_id, modulo, acao, registro_afetado, valor_anterior, valor_novo, nivel
    ) values (
      public.usuario_auditoria_id(),
      'pagamentos',
      'alterou',
      'Nome de exibição do fornecedor na programação ' || coalesce(v_programacao_id::text, '--'),
      jsonb_build_object('nome_exibicao_programacao', v_anterior),
      jsonb_build_object(
        'nome_exibicao_programacao', v_nome,
        'pagamento_id', p_pagamento_id,
        'fornecedor_id', v_fornecedor_id
      ),
      'informacao'
    );
  exception when others then
    raise warning 'Nome de exibição do pagamento % gravado, mas o evento de auditoria não foi registrado (% -- %).',
      p_pagamento_id, sqlstate, sqlerrm;
  end;

  -- fornecedor_id volta na resposta de propósito: é a prova, na própria
  -- gravação, de que renomear não trocou o vínculo do item.
  return jsonb_build_object(
    'ok', true,
    'pagamento_id', p_pagamento_id,
    'programacao_id', v_programacao_id,
    'fornecedor_id', v_fornecedor_id,
    'nome_exibicao_programacao', v_nome
  );
end $$;

grant execute on function public.definir_nome_exibicao_programacao(integer, text) to authenticated;

comment on function public.definir_nome_exibicao_programacao(integer, text)
is 'Grava o nome de exibição de UM item da programação. Escreve somente pagamentos.nome_exibicao_programacao: não altera razão social, nome fantasia, apelido, CNPJ/CPF, cadastro, notas, processos, dados bancários, valores, saldos nem o vínculo fornecedor_id.';

-- ---------------------------------------------------------------------------
-- 4. Apelido na identificação mínima usada pelo módulo Certidões
-- ---------------------------------------------------------------------------
-- Mesma view da 20260824130000, com o apelido acrescentado ao FIM da lista de
-- colunas (o que `create or replace view` permite). Continua sem dado bancário
-- e sem alíquota tributária, e continua liberada pela permissão do próprio
-- módulo.
create or replace view public.fornecedores_identificacao
with (security_barrier = true) as
select
  f.id,
  f.razao_social,
  f.nome_fantasia,
  f.cpf_cnpj,
  f.secretaria_id,
  f.ativo,
  f.apelido
from public.fornecedores f
where f.excluido_em is null
  and public.pode_em_certidoes('visualizar');

comment on view public.fornecedores_identificacao is
  'Identificação mínima dos fornecedores para o módulo Certidões, liberada pela permissão efetiva do próprio módulo. Inclui o apelido para que a busca por fornecedor encontre também por ele.';

revoke all on public.fornecedores_identificacao from public;
revoke all on public.fornecedores_identificacao from anon;
grant select on public.fornecedores_identificacao to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Salvar o planejamento -- agora gravando também o nome de exibição
-- ---------------------------------------------------------------------------
-- Corpo IGUAL ao da 20260828190000. A única diferença é a coluna
-- nome_exibicao_programacao no UPDATE e no INSERT dos itens. Tudo o mais fica
-- como está: excluido_por continua recebendo public.usuarios.id (nunca
-- auth.uid()), fornecedor inexistente continua recusado em português, o 23503
-- continua explicado por vínculo e SALVAR CONTINUA NÃO SENDO PAGAR.
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
  v_usuario_registro uuid;
  v_status_anterior text;
  v_fechado_texto text;
  v_conta jsonb;
  v_pagamento jsonb;
  v_pagamento_id integer;
  v_fornecedor_id integer;
  v_situacao_fornecedor text;
  v_valor numeric(14,2);
  v_nome_exibicao text;
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
  v_usuario_registro := public.usuario_registro_id();

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
  -- excluido_por aponta para public.usuarios (id): vai o id do registro do
  -- usuário -- ou NULL, que a coluna aceita -- e NUNCA auth.uid().
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

    -- Nome de exibição DESTE item: espaços normalizados, vazio virando NULL
    -- ("usar o apelido; não havendo, a razão social") e tamanho limitado. Ele
    -- não é usado para nada além de mostrar e imprimir.
    v_nome_exibicao := nullif(btrim(regexp_replace(coalesce(v_pagamento->>'nome_exibicao_programacao', ''), '\s+', ' ', 'g')), '');
    if v_nome_exibicao is not null then
      v_nome_exibicao := left(v_nome_exibicao, 120);
    end if;

    v_pagamento_id := nullif(v_pagamento->>'id', '')::integer;
    if v_pagamento_id is not null then
      update public.pagamentos
         set fornecedor_id = nullif(v_pagamento->>'fornecedor_id', '')::integer,
             nome_avulso = nullif(trim(v_pagamento->>'nome_avulso'), ''),
             nome_exibicao_programacao = v_nome_exibicao,
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
        nome_exibicao_programacao,
        valor_a_pagar,
        situacao,
        cadastrar_fornecedor_posteriormente
      ) values (
        p_programacao_id,
        nullif(v_pagamento->>'fornecedor_id', '')::integer,
        nullif(trim(v_pagamento->>'nome_avulso'), ''),
        v_nome_exibicao,
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
              '%s | etapa=%s sqlstate=%s constraint=%s tabela=%s coluna=%s detalhe=%s | pagamentos.situacao=%s pagamentos.excluido_por=%s pagamentos.nome_exibicao_programacao=%s programacoes_pagamento.status=%s programacoes_pagamento.fechado=%s programacao_contas.ativa=%s auditoria_eventos.nivel=%s',
              sqlerrm, v_etapa, sqlstate,
              coalesce(v_constraint, '-'),
              coalesce(v_tabela_erro, '-'),
              coalesce(v_coluna_erro, '-'),
              coalesce(v_detalhe_erro, '-'),
              public.tipo_da_coluna('pagamentos', 'situacao'),
              public.tipo_da_coluna('pagamentos', 'excluido_por'),
              public.tipo_da_coluna('pagamentos', 'nome_exibicao_programacao'),
              public.tipo_da_coluna('programacoes_pagamento', 'status'),
              public.tipo_da_coluna('programacoes_pagamento', 'fechado'),
              public.tipo_da_coluna('programacao_contas', 'ativa'),
              public.tipo_da_coluna('auditoria_eventos', 'nivel')
            ),
            hint = 'Leia o DETAIL: constraint, tabela e coluna dizem qual chave estrangeira o banco recusou, e detalhe traz o valor que não existe na tabela referenciada.';
end $$;

grant execute on function public.salvar_planejamento_programacao(integer, jsonb, jsonb, numeric, numeric, numeric) to authenticated;

comment on function public.salvar_planejamento_programacao(integer, jsonb, jsonb, numeric, numeric, numeric)
is 'Salva somente a proposta diária: contas consideradas, fornecedores, valores e o nome de exibição de cada item. Não altera saldos nem registra movimentações financeiras, e não escreve nada em public.fornecedores.';

commit;
