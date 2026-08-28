-- FASE 2 — correção da gravação dos fornecedores da programação (código 23503).
--
-- ATENÇÃO: esta migration precisa ser rodada MANUALMENTE no SQL Editor do
-- Supabase (o mesmo projeto usado pela aplicação), como as da Fase 2 e a
-- 20260828170000. Nada nela roda sozinho no deploy.
--
-- O DEFEITO QUE ELA CORRIGE
--
-- Depois da 20260828170000 a mensagem passou a dizer a etapa, e ela apontou o
-- lugar exato:
--
--   "Não foi possível salvar a programação na etapa 'gravação dos fornecedores
--    da programação'. O banco recusou a operação com o código 23503."
--
-- 23503 é foreign_key_violation. Nessa etapa a função grava três chaves
-- estrangeiras: pagamentos.programacao_id, pagamentos.fornecedor_id e
-- pagamentos.excluido_por. A primeira instrução da etapa é a que quebrava:
--
--   update public.pagamentos
--      set excluido_em = now(),
--          excluido_por = v_usuario      -- v_usuario := auth.uid()
--    where programacao_id = ... ;
--
-- public.pagamentos.excluido_por referencia public.usuarios (id) -- é o que a
-- 20260823150000 criou, e é o mesmo contrato que src/lib/exclusaoRegistros.js
-- respeita ("id em public.usuarios de quem está excluindo"). Só que
-- public.usuarios.id NÃO é o id do auth: o vínculo com a sessão é
-- public.usuarios.auth_id = auth.uid(), como public.meu_usuario_ativo_id() e
-- public.usuario_auditoria_id() já mostravam. Gravar auth.uid() em
-- excluido_por é gravar um id que não existe em public.usuarios -- violação de
-- chave estrangeira em TODA gravação que passe por ali.
--
-- POR QUE ISSO SÓ APARECEU AGORA
--
-- Aquele UPDATE só encontra linhas quando a programação JÁ tem fornecedores
-- gravados. No primeiro salvamento ele afeta zero linhas, nenhuma chave é
-- conferida e o insert seguinte grava normalmente (programacao_id e
-- fornecedor_id são válidos). A partir do segundo salvamento -- exatamente o
-- caso da programação 31, em que os fornecedores foram trocados durante os
-- testes -- o UPDATE encontra as linhas anteriores, tenta marcá-las como
-- excluídas com um excluido_por inexistente e o banco recusa.
--
-- As outras chaves da etapa foram conferidas e não são a causa:
--   * programacao_id -- a função já falha antes com "Programação não
--     encontrada." se o id não existir.
--   * fornecedor_id -- exclusão de fornecedor neste sistema é lógica
--     (excluido_em), a linha continua no banco e a chave continua válida. Ainda
--     assim, id que não existe mais no cadastro passa a ter recusa explicada,
--     em português, em vez de 23503 (item 3 abaixo).
--   * conta_origem_id -- não tem chave estrangeira (a Fase 2 a criou como
--     integer simples) e, principalmente, NÃO é gravada nesta etapa: a proposta
--     não atribui conta por pagamento. Nada a remover.
--   * campos de auditoria -- auditoria_eventos.usuario_id já usa
--     public.usuario_auditoria_id(), e o insert da trilha continua isolado: uma
--     falha só dele não derruba o salvamento.
--
-- O QUE ESTA MIGRATION FAZ
--
--   1. public.usuario_registro_id() -> o id do usuário da sessão em
--      public.usuarios, ou NULL quando não existe registro correspondente.
--      Diferente de public.usuario_auditoria_id(), que devolve auth.uid() como
--      último recurso: em coluna com chave estrangeira esse "último recurso" é
--      justamente o valor que o banco recusa. NULL é aceito (a coluna é
--      anulável, com on delete set null).
--   2. Recria public.salvar_planejamento_programacao gravando excluido_por com
--      esse id -- e nunca mais com auth.uid().
--   3. Recusa fornecedor que não existe mais no cadastro com frase em português
--      dizendo o que fazer, em vez de deixar o banco devolver 23503.
--   4. Em qualquer 23503 que ainda apareça, a mensagem passa a dizer QUAL
--      vínculo falhou em linguagem de quem usa a tela, e o DETAIL (que a
--      aplicação só registra no console) leva constraint, tabela, coluna e o
--      detalhe cru do Postgres -- identificação da chave exata em um único
--      teste.
--
-- REGRAS PRESERVADAS, SEM EXCEÇÃO
--
--   * SALVAR NÃO É PAGAR e APROVAR NÃO É PAGAR: esta função continua gravando
--     somente a proposta (contas consideradas, fornecedores e valores). Nenhuma
--     linha de saldo, nenhuma baixa, nenhuma nota marcada como paga, nenhum
--     saldo de fornecedor.
--   * responsavel_id continua recebendo auth.uid(), exatamente como hoje: é o
--     que a própria tela grava ao criar a programação e o que funciona neste
--     banco. Esta migration não muda o significado de nenhuma coluna.
--   * Nenhuma coluna, tabela, política ou permissão é criada, alterada ou
--     removida. Nenhum dado é apagado ou reescrito.
--   * A mensagem detalhada com o nome da etapa, implantada na 20260828170000,
--     continua igual -- ganhou o detalhe da chave estrangeira, não perdeu nada.
--   * Nada de Saldos das Contas, Fornecedores, Certidões, Baixas, Tarefas,
--     Histórico, Relatórios, Auditoria (estrutura), Configurações ou backup é
--     tocado. public.aprovar_programacao_pagamento e
--     public.marcar_programacao_em_analise ficam como a 20260828170000 deixou.
--
-- IDEMPOTENTE: pode rodar quantas vezes for preciso. Só substitui corpo de
-- função, mantendo assinatura, tipo de retorno e grants.

begin;

-- ---------------------------------------------------------------------------
-- 1. Id do usuário da sessão em public.usuarios, ou NULL
-- ---------------------------------------------------------------------------
-- Serve para as colunas que apontam para public.usuarios (id). O vínculo normal
-- é auth_id = auth.uid(); a segunda leitura cobre o banco em que id e auth id
-- coincidem. Não havendo registro, devolve NULL -- coluna anulável aceita NULL,
-- e nenhuma chave estrangeira é violada.
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

-- ---------------------------------------------------------------------------
-- 2. O fornecedor pode ser referenciado?
-- ---------------------------------------------------------------------------
-- Lê apenas id e excluido_em de public.fornecedores, e por isso é security
-- definer: a conferência precisa ver o que a CHAVE ESTRANGEIRA vê (a tabela
-- inteira), não o que o RLS mostra para a sessão -- senão fornecedor válido de
-- outra secretaria seria acusado de inexistente. Nenhum dado do cadastro sai
-- daqui: a resposta é uma das três palavras abaixo.
--
--   'ausente'  -> não existe linha com esse id: a chave estrangeira recusaria.
--   'excluido' -> existe, com exclusão lógica: a chave estrangeira ACEITA.
--   'ok'       -> existe e está vigente.
create or replace function public.fornecedor_referenciavel(p_fornecedor_id integer)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_excluido timestamptz;
  v_achou boolean := false;
begin
  if p_fornecedor_id is null then
    return 'ok';
  end if;

  select true, f.excluido_em
    into v_achou, v_excluido
    from public.fornecedores f
   where f.id = p_fornecedor_id;

  if not coalesce(v_achou, false) then
    return 'ausente';
  end if;
  if v_excluido is not null then
    return 'excluido';
  end if;
  return 'ok';
exception
  -- Banco sem a coluna de exclusão lógica: a conferência que importa é só a
  -- existência do id, e ela não pode derrubar o salvamento.
  when undefined_column then
    if exists (select 1 from public.fornecedores f where f.id = p_fornecedor_id) then
      return 'ok';
    end if;
    return 'ausente';
end $$;

grant execute on function public.fornecedor_referenciavel(integer) to authenticated;

comment on function public.fornecedor_referenciavel(integer)
is 'Diz se o id existe em public.fornecedores (ausente/excluido/ok), do ponto de vista da chave estrangeira. Usada para recusar fornecedor inexistente com mensagem em português em vez de 23503.';

-- ---------------------------------------------------------------------------
-- 3. Salvar o planejamento — excluido_por deixa de receber auth.uid()
-- ---------------------------------------------------------------------------
-- Corpo igual ao da 20260828170000, com quatro mudanças e nada mais:
--   a) v_usuario_registro (public.usuarios.id) grava excluido_por;
--   b) fornecedor inexistente é recusado com frase escrita para o usuário;
--   c) o tratamento de exceção lê constraint/tabela/coluna do erro e explica o
--      23503 em português;
--   d) DETAIL passa a levar esses campos, para o console apontar a chave exata.
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
is 'Salva somente a proposta diária: contas consideradas, fornecedores e valores. Não altera saldos nem registra movimentações financeiras. excluido_por recebe public.usuarios.id (nunca auth.uid()), fornecedor inexistente é recusado com mensagem própria e 23503 passa a dizer qual vínculo falhou.';

commit;
