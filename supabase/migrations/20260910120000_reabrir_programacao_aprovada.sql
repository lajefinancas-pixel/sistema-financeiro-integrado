-- REABRIR PROGRAMAÇÃO APROVADA — desfazer a APROVAÇÃO, nunca os dados.
--
-- Arquivo: supabase/migrations/20260910120000_reabrir_programacao_aprovada.sql
--
-- ATENÇÃO: esta migration precisa ser rodada MANUALMENTE no SQL Editor do
-- Supabase (o mesmo projeto usado pela aplicação). Nada nela roda sozinho no
-- deploy.
--
-- A NECESSIDADE
--
-- Uma programação aprovada não tinha caminho de volta: não existia ação na tela
-- para desfazer a aprovação, e ajustar algo depois que o gestor pede uma
-- alteração exigia montar tudo de novo. Esta migration cria a ação de exceção
-- que devolve a programação para "em_elaboracao", permitindo editar contas,
-- fornecedores e valores e aprovar outra vez.
--
-- O QUE ESTA MIGRATION CRIA (nada mais)
--
--   1. public.pode_reabrir_programacao      -> a permissão da ação.
--   2. public.vinculos_da_programacao       -> contagem de baixas e
--                                              transferências, só para a tela
--                                              poder AVISAR antes de confirmar.
--   3. public.reabrir_programacao_pagamento -> a ação em si.
--
-- REGRAS QUE ELA FAZ VALER NO BANCO
--
--   * REABRIR É MUDANÇA DE ESTADO, NÃO DESFAZIMENTO DE DADOS. O único UPDATE de
--     dados escreve QUATRO colunas de public.programacoes_pagamento: status,
--     aprovada_em, aprovada_por e updated_at. Contas de trabalho, fornecedores,
--     valores, conta de pagamento, saldos congelados (
--     programacao_contas.saldo_considerado), baixas, transferências e saldos
--     reais das contas ficam exatamente como estão.
--   * REABRIR NÃO DESFAZ BAIXA E NÃO DESFAZ TRANSFERÊNCIA. Quando existirem, a
--     tela avisa antes de confirmar — e a operação continua permitida, porque
--     desfazer cada uma delas tem caminho próprio (estorno), com registro
--     próprio.
--   * NENHUM SALDO SE MOVE. Nenhuma linha em saldos_historico,
--     pagamento_movimentacoes, pagamentos_baixas ou transferencias_contas é
--     escrita, alterada ou apagada.
--   * A APROVAÇÃO ANTERIOR NÃO É APAGADA DO HISTÓRICO. As colunas aprovada_em e
--     aprovada_por são limpas porque a programação deixa de estar aprovada, mas
--     o evento da aprovação continua em public.auditoria_eventos: ela aconteceu,
--     e a trilha é imutável. A reabertura entra como um SEGUNDO fato, em nível
--     crítico, com a justificativa, o usuário e a data.
--   * JUSTIFICATIVA OBRIGATÓRIA, mínimo de 10 caracteres. Sem ela o banco
--     recusa — a exigência não depende da tela.
--   * PROGRAMAÇÃO FECHADA CONTINUA INTOCÁVEL: fechado = true é histórico e não
--     pode ser reaberta, como já não podia ser salva nem aprovada.
--   * IDEMPOTENTE NA AÇÃO: reabrir uma programação que já está em elaboração não
--     faz nada e não gera erro. Não grava, não audita, devolve ja_em_elaboracao.
--   * TRANSACIONAL: uma única transação grava o novo status e o evento de
--     auditoria com a justificativa. Aqui, ao contrário das demais ações do
--     módulo, a auditoria NÃO é isolada de propósito: a justificativa exigida é
--     parte do resultado da operação, e uma reabertura sem justificativa
--     registrada não é o que foi pedido. Ou as duas coisas acontecem, ou nenhuma.
--
-- NADA É REMOVIDO OU ALTERADO: nenhuma coluna, tabela, política, permissão ou
-- função existente é modificada. Aprovar, salvar, marcar em análise, definir
-- conta, transferir, estornar e baixar continuam com o mesmo corpo e a mesma
-- assinatura.
--
-- IDEMPOTENTE COMO ARQUIVO: pode ser executada quantas vezes for preciso.

begin;

-- ---------------------------------------------------------------------------
-- 1. A permissão de reabrir
-- ---------------------------------------------------------------------------
-- Permissão própria, com o MESMO padrão de aprovar: quem pode aprovar
-- programação (pode_aprovar no módulo pagamentos) pode reabrir. A ação tem nome
-- próprio para que uma concessão ou uma recusa avulsa em
-- public.permissoes_especiais possa tratá-la separadamente quando isso for
-- desejado; na ausência dessa linha — que é o caso de todo mundo hoje — vale
-- exatamente a permissão de aprovar, e ninguém ganha acesso que já não tivesse.
create or replace function public.pode_reabrir_programacao()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_usuario uuid;
  v_explicito boolean;
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
        using v_usuario, 'reabrir_programacao';
      if v_explicito is not null then
        return v_explicito;
      end if;
    exception when others then
      v_explicito := null; -- estrutura diferente: cai no padrão de aprovar
    end;
  end if;

  -- Padrão: a mesma permissão de aprovar programação.
  begin
    return public.pode_em_pagamentos_fase2('aprovar_programacao');
  exception when undefined_function then
    -- Banco em que a Fase 2 ainda não rodou: lê o módulo direto, com o mesmo
    -- resultado que a função daria.
    return exists (
      select 1
        from public.permissoes_efetivas pe
       where pe.usuario_id = v_usuario
         and pe.modulo = 'pagamentos'
         and pe.pode_aprovar
    );
  end;
end $$;

grant execute on function public.pode_reabrir_programacao() to authenticated;

comment on function public.pode_reabrir_programacao()
is 'Quem pode reabrir uma programação aprovada. Padrão: a mesma permissão de aprovar (pode_aprovar no módulo pagamentos); a concessão ou recusa avulsa da ação reabrir_programacao em permissoes_especiais tem precedência quando existir.';

-- ---------------------------------------------------------------------------
-- 2. O que está vinculado à programação — só para AVISAR
-- ---------------------------------------------------------------------------
-- Devolve CONTAGEM, nunca dado financeiro: é o que a tela precisa para dizer
-- "esta programação tem N baixas e M transferências, e reabrir não desfaz
-- nenhuma delas". É security definer porque quem aprova pode não ter permissão
-- de VER a aba de Baixas — e um aviso que aparece como "nenhuma baixa" por falta
-- de leitura seria pior do que aviso nenhum. Nada aqui escreve.
create or replace function public.vinculos_da_programacao(p_programacao_id integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_baixas integer;
  v_transferencias integer;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado.' using errcode = '42501';
  end if;

  -- Baixas da programação: a razão das baixas se liga ao pagamento, e o
  -- pagamento à programação. Estornada não conta como baixa em vigor.
  if to_regclass('public.pagamentos_baixas') is not null then
    begin
      execute $q$
        select count(*)
          from public.pagamentos_baixas b
          join public.pagamentos p on p.id = b.pagamento_id
         where p.programacao_id = $1
           and lower(coalesce(b.status::text, 'efetivada')) <> 'estornada'
      $q$ into v_baixas using p_programacao_id;
    exception when others then
      -- Estrutura diferente da esperada: não dá para afirmar que não há baixa.
      v_baixas := null;
    end;
  end if;

  if to_regclass('public.transferencias_contas') is not null then
    begin
      execute $q$
        select count(*)
          from public.transferencias_contas t
         where t.programacao_id = $1
           and lower(coalesce(t.status::text, 'efetivada')) <> 'estornada'
      $q$ into v_transferencias using p_programacao_id;
    exception when others then
      v_transferencias := null;
    end;
  end if;

  return jsonb_build_object(
    'programacao_id', p_programacao_id,
    'baixas', v_baixas,
    'transferencias', v_transferencias
  );
end $$;

grant execute on function public.vinculos_da_programacao(integer) to authenticated;

comment on function public.vinculos_da_programacao(integer)
is 'Contagem de baixas em vigor e transferências vinculadas a uma programação. Só leitura, só contagem: existe para a tela avisar antes de reabrir que nenhuma delas será desfeita.';

-- ---------------------------------------------------------------------------
-- 3. Reabrir a programação aprovada
-- ---------------------------------------------------------------------------
create or replace function public.reabrir_programacao_pagamento(
  p_programacao_id integer,
  p_justificativa text
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
  v_aprovada_em timestamptz;
  v_aprovada_por uuid;
  v_justificativa text;
  v_vinculos jsonb;
  -- Nome da etapa em curso: é ele que aparece na mensagem quando o banco recusa
  -- a operação por um motivo que esta função não previu.
  v_etapa text := 'início';
begin
  v_etapa := 'conferência da sessão';
  if auth.uid() is null then
    raise exception 'Usuário não autenticado.' using errcode = '42501';
  end if;
  v_usuario := public.usuario_auditoria_id();

  v_etapa := 'conferência da permissão de reabrir';
  if not public.pode_reabrir_programacao() then
    raise exception 'Você não tem permissão para reabrir programações aprovadas.' using errcode = '42501';
  end if;

  v_etapa := 'conferência da justificativa';
  v_justificativa := btrim(coalesce(p_justificativa, ''));
  if length(v_justificativa) < 10 then
    raise exception 'Informe a justificativa da reabertura, com pelo menos 10 caracteres. Ela fica registrada na Auditoria.'
      using errcode = 'P0001';
  end if;

  -- status e fechado saem como TEXTO. A conversão explícita funciona para text,
  -- para enum e para domínio -- é a mesma proteção contra 22P02 usada na
  -- aprovação, onde a comparação com o tipo cru derrubava a tela.
  v_etapa := 'leitura da programação';
  select pr.status::text, pr.fechado::text, pr.secretaria_id, pr.aprovada_em, pr.aprovada_por
    into v_status_anterior, v_fechado_texto, v_secretaria, v_aprovada_em, v_aprovada_por
    from public.programacoes_pagamento pr
   where pr.id = p_programacao_id
   for update;

  if not found then
    raise exception 'Programação não encontrada.';
  end if;

  -- Fechada é histórico: não podia ser salva nem aprovada, e não pode ser
  -- reaberta. Esta trava não muda com permissão nenhuma.
  if lower(coalesce(v_fechado_texto, '')) in ('true', 't', 'sim', '1', 'y', 'yes') then
    raise exception 'Programações históricas fechadas não podem ser reabertas.';
  end if;

  -- IDEMPOTENTE: já está em elaboração, então não há aprovação para desfazer.
  -- Não grava, não audita, não reclama.
  if coalesce(v_status_anterior, '') = 'em_elaboracao' then
    return jsonb_build_object(
      'ok', true,
      'ja_em_elaboracao', true,
      'programacao_id', p_programacao_id,
      'status', 'em_elaboracao',
      'status_anterior', v_status_anterior,
      'alterou_dados', false
    );
  end if;

  -- Reabrir é desfazer a APROVAÇÃO. Programação em análise já é editável e não
  -- tem aprovação a desfazer: a recusa diz isso em palavras.
  if coalesce(v_status_anterior, '') <> 'aprovada' then
    raise exception 'Somente uma programação aprovada pode ser reaberta. Esta está com o status "%".', coalesce(v_status_anterior, 'sem status');
  end if;

  -- Contagem para o registro: baixas e transferências CONTINUAM como estão, e o
  -- evento guarda quantas existiam no momento da reabertura.
  v_etapa := 'conferência das baixas e transferências vinculadas';
  begin
    v_vinculos := public.vinculos_da_programacao(p_programacao_id);
  exception when others then
    v_vinculos := jsonb_build_object('baixas', null, 'transferencias', null);
  end;

  -- O ÚNICO UPDATE de dados desta função. Quatro colunas: o status, os dois
  -- campos da aprovação e o carimbo de alteração. Nenhuma outra tabela é
  -- tocada -- contas, fornecedores, valores, conta de pagamento, saldos
  -- congelados, baixas, transferências e saldos reais ficam como estão.
  v_etapa := 'gravação da reabertura';
  update public.programacoes_pagamento
     set status = 'em_elaboracao',
         aprovada_em = null,
         aprovada_por = null,
         updated_at = now()
   where id = p_programacao_id;

  -- Auditoria na MESMA transação: a justificativa exigida é parte do resultado
  -- da operação. Se ela não puder ser registrada, a reabertura não acontece.
  v_etapa := 'registro na auditoria';
  insert into public.auditoria_eventos (
    usuario_id, modulo, acao, registro_afetado, valor_anterior, valor_novo, nivel
  ) values (
    v_usuario,
    'pagamentos',
    'reabriu_programacao',
    'Programação ' || p_programacao_id::text,
    jsonb_build_object(
      'status', v_status_anterior,
      'aprovada_em', v_aprovada_em,
      'aprovada_por', v_aprovada_por
    ),
    jsonb_build_object(
      'status', 'em_elaboracao',
      'justificativa', v_justificativa,
      'secretaria_id', v_secretaria,
      'reaberta_por', v_usuario,
      'reaberta_em', now(),
      'baixas_registradas', v_vinculos->'baixas',
      'transferencias_vinculadas', v_vinculos->'transferencias',
      'baixas_desfeitas', 0,
      'transferencias_desfeitas', 0,
      'movimentou_saldo', false,
      'alterou_dados', false,
      'aprovacao_anterior_preservada_na_trilha', true
    ),
    'critico'
  );

  return jsonb_build_object(
    'ok', true,
    'ja_em_elaboracao', false,
    'programacao_id', p_programacao_id,
    'status', 'em_elaboracao',
    'status_anterior', v_status_anterior,
    'justificativa', v_justificativa,
    'baixas_registradas', v_vinculos->'baixas',
    'transferencias_vinculadas', v_vinculos->'transferencias',
    'movimentou_saldo', false,
    'alterou_dados', false
  );

exception
  when others then
    -- Passam intactas: as mensagens escritas para o usuário (P0001), as recusas
    -- de permissão (42501) e a falta de objeto no banco (42P01/42703/42883/
    -- 42P13) -- estes últimos são o que a tela usa para reconhecer "a migration
    -- ainda não rodou" e dizer qual arquivo executar.
    if sqlstate in ('P0001', '42501', '42P01', '42703', '42883', '42P13') then
      raise;
    end if;
    raise exception
      'Não foi possível reabrir a programação na etapa "%". O banco recusou a operação com o código %.',
      v_etapa, sqlstate
      using errcode = 'P0001',
            detail = format(
              '%s | etapa=%s sqlstate=%s | programacoes_pagamento.status=%s programacoes_pagamento.fechado=%s programacoes_pagamento.aprovada_em=%s programacoes_pagamento.aprovada_por=%s auditoria_eventos.nivel=%s',
              sqlerrm, v_etapa, sqlstate,
              public.tipo_da_coluna('programacoes_pagamento', 'status'),
              public.tipo_da_coluna('programacoes_pagamento', 'fechado'),
              public.tipo_da_coluna('programacoes_pagamento', 'aprovada_em'),
              public.tipo_da_coluna('programacoes_pagamento', 'aprovada_por'),
              public.tipo_da_coluna('auditoria_eventos', 'nivel')
            ),
            hint = 'Leia o DETAIL: ele traz a mensagem crua do Postgres, a etapa e o tipo real de cada coluna suspeita. Tipo diferente do esperado indica qual comparação o banco recusou.';
end $$;

grant execute on function public.reabrir_programacao_pagamento(integer, text) to authenticated;

comment on function public.reabrir_programacao_pagamento(integer, text)
is 'Desfaz a APROVAÇÃO de uma programação: devolve o status para em_elaboracao e limpa aprovada_em/aprovada_por. Exige justificativa de 10 caracteres e a permissão de aprovar. NÃO desfaz dados: contas, fornecedores, valores, saldos congelados, baixas, transferências e saldos reais ficam como estão. Registra evento crítico na auditoria, sem apagar o evento da aprovação anterior.';

commit;
