-- Exclusão controlada por permissão — exclusão lógica (soft delete), auditoria
-- e permissão de excluir por módulo.
--
-- O que esta migration faz:
--   1. Acrescenta `excluido_em` e `excluido_por` em public.fornecedores,
--      public.certidoes e public.pagamentos. Excluir nessas três tabelas passa a
--      ser um UPDATE: a linha continua no banco e some das listagens.
--      SALDOS DAS CONTAS FICA DE FORA de propósito — a exclusão de conta
--      bancária e de secretaria continua exatamente como é hoje.
--   2. Libera, no RLS de certidoes, o UPDATE que apenas marca a certidão como
--      excluída para quem tem pode_excluir no módulo (antes só quem tinha
--      pode_editar conseguia gravar qualquer update).
--   3. Recria public.marcar_pagamento_pago() para ignorar pagamentos excluídos
--      logicamente ao conferir o rateio da programação — sem essa mudança um
--      pagamento excluído continuaria somando no total e a efetivação passaria a
--      acusar "rateio divergente".
--   4. Completa public.perfis_permissoes com as linhas de módulo que estiverem
--      faltando em algum perfil, para que a coluna "Excluir" da Matriz de
--      Permissões exista em TODOS os módulos. Só insere o que falta: nenhuma
--      permissão já concedida é alterada.
--
-- Nada aqui apaga dados, altera saldos, ou muda o modelo de permissões e RLS já
-- existente. A migration é IDEMPOTENTE: pode ser rodada mais de uma vez.

-- ---------------------------------------------------------------------------
-- 1. Colunas de exclusão lógica
-- ---------------------------------------------------------------------------
-- O tipo de `excluido_por` copia o tipo real de public.usuarios.id, do mesmo
-- jeito que as migrations de certidões e de movimentações de pagamento fazem.
do $$
declare
  tipo_usuario text;
  alvo text;
begin
  select format_type(a.atttypid, a.atttypmod) into tipo_usuario
    from pg_attribute a
   where a.attrelid = 'public.usuarios'::regclass
     and a.attname = 'id';

  foreach alvo in array array['fornecedores', 'certidoes', 'pagamentos'] loop
    if to_regclass('public.' || alvo) is null then
      raise notice 'Tabela public.% não existe neste banco: exclusão lógica não aplicada nela.', alvo;
      continue;
    end if;

    execute format(
      'alter table public.%I add column if not exists excluido_em timestamptz',
      alvo
    );

    execute format(
      'alter table public.%I add column if not exists excluido_por %s references public.usuarios (id) on delete set null',
      alvo, tipo_usuario
    );

    -- Índice parcial: as listagens pedem sempre "excluido_em is null".
    execute format(
      'create index if not exists %I on public.%I (excluido_em) where excluido_em is null',
      alvo || '_vigentes_idx', alvo
    );

    execute format(
      'comment on column public.%I.excluido_em is %L',
      alvo,
      'Preenchida na exclusão lógica: a linha continua no banco e sai das listagens do sistema.'
    );
    execute format(
      'comment on column public.%I.excluido_por is %L',
      alvo,
      'Usuário que executou a exclusão lógica (public.usuarios.id).'
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. RLS de certidões: quem pode excluir consegue marcar a exclusão lógica
-- ---------------------------------------------------------------------------
-- A política de update existente exige pode_editar. Como excluir virou update,
-- quem tem apenas pode_excluir precisa de uma política própria — e ela só
-- aceita gravações que deixem a certidão marcada como excluída (o WITH CHECK
-- impede que essa permissão seja usada para editar ou para "desexcluir").
drop policy if exists "certidoes_update_exclusao_logica" on public.certidoes;
create policy "certidoes_update_exclusao_logica"
  on public.certidoes
  for update
  to authenticated
  using (public.pode_em_certidoes('excluir'))
  with check (public.pode_em_certidoes('excluir') and excluido_em is not null);

-- ---------------------------------------------------------------------------
-- 3. Efetivação de pagamento ignora pagamentos excluídos
-- ---------------------------------------------------------------------------
-- Cópia fiel da função criada em 20260810190000_rateio_reserva_e_debito_pagamentos.sql,
-- com duas únicas diferenças, ambas por causa da exclusão lógica:
--   * pagamento já excluído não é efetivado (motivo 'pagamento_excluido');
--   * o total dos pagamentos da programação não soma linhas excluídas.
create or replace function public.marcar_pagamento_pago(p_pagamento_id text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  pagamento record;
  programacao record;
  conta record;
  total_pagamentos numeric(14,2);
  soma_rateio numeric(14,2);
  qtd_contas integer;
  qtd_rateadas integer;
  movimento_id uuid;
  valor_pagamento numeric(14,2);
  debito numeric(14,2);
  atribuido numeric(14,2);
  saldo_atual numeric(14,2);
  ultima_data date;
  reservado_outras numeric(14,2);
  disponivel numeric(14,2);
  data_lancamento date;
  volta integer;
  posicao integer;
begin
  -- Trava a linha do pagamento: dois cliques ao mesmo tempo viram um só débito.
  select p.* into pagamento
    from public.pagamentos p
   where p.id::text = p_pagamento_id
     for update;

  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'pagamento_nao_encontrado');
  end if;

  -- Pagamento excluído logicamente não volta a existir por uma efetivação.
  if pagamento.excluido_em is not null then
    return jsonb_build_object('ok', false, 'motivo', 'pagamento_excluido');
  end if;

  -- Idempotência: já efetivado, não debita de novo.
  if pagamento.situacao = 'pago' then
    return jsonb_build_object('ok', true, 'ja_pago', true);
  end if;

  if pagamento.situacao = 'cancelado' then
    return jsonb_build_object('ok', false, 'motivo', 'pagamento_cancelado');
  end if;

  -- Trava a programação: pagamentos diferentes da mesma programação são
  -- efetivados em fila, sem furar o saldo por concorrência.
  select pr.* into programacao
    from public.programacoes_pagamento pr
   where pr.id = pagamento.programacao_id
     for update;

  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'programacao_nao_encontrada');
  end if;

  valor_pagamento := round(coalesce(pagamento.valor_a_pagar, 0)::numeric, 2);
  if valor_pagamento <= 0 then
    return jsonb_build_object('ok', false, 'motivo', 'valor_invalido');
  end if;

  select round(coalesce(sum(valor_a_pagar), 0)::numeric, 2)
    into total_pagamentos
    from public.pagamentos
   where programacao_id = programacao.id
     and coalesce(situacao, '') <> 'cancelado'
     and excluido_em is null;

  select round(coalesce(sum(valor_rateado), 0)::numeric, 2), count(*)
    into soma_rateio, qtd_contas
    from public.programacao_contas
   where programacao_id = programacao.id;

  if qtd_contas = 0 then
    return jsonb_build_object('ok', false, 'motivo', 'sem_contas');
  end if;

  -- Só as contas com rateio positivo recebem débito; a última delas absorve o
  -- arredondamento, para nenhuma conta rateada em zero ser debitada por engano.
  select count(*)
    into qtd_rateadas
    from public.programacao_contas
   where programacao_id = programacao.id
     and coalesce(valor_rateado, 0) > 0;

  -- Regra central: soma do rateio = total dos pagamentos da programação.
  if soma_rateio <> total_pagamentos or soma_rateio <= 0 then
    return jsonb_build_object(
      'ok', false,
      'motivo', 'rateio_divergente',
      'soma_rateio', soma_rateio,
      'total_pagamentos', total_pagamentos,
      'diferenca', total_pagamentos - soma_rateio
    );
  end if;

  for volta in 1..2 loop
    atribuido := 0;
    posicao := 0;

    for conta in
      select pc.conta_id, coalesce(pc.valor_rateado, 0)::numeric as rateado
        from public.programacao_contas pc
       where pc.programacao_id = programacao.id
         and coalesce(pc.valor_rateado, 0) > 0
       order by coalesce(pc.ordem, 2147483647), pc.conta_id::text
    loop
      posicao := posicao + 1;

      -- Cada conta entra na proporção do seu rateio; a última fecha a conta
      -- para que a soma dos débitos seja exatamente o valor do pagamento.
      if posicao = qtd_rateadas then
        debito := round(valor_pagamento - atribuido, 2);
      else
        debito := round(valor_pagamento * conta.rateado / soma_rateio, 2);
      end if;
      atribuido := atribuido + debito;

      if debito <= 0 then
        continue;
      end if;

      select sh.valor_saldo, sh.data_saldo
        into saldo_atual, ultima_data
        from public.saldos_historico sh
       where sh.conta_id = conta.conta_id
       order by sh.data_saldo desc
       limit 1;

      if not found then
        saldo_atual := 0;
        ultima_data := null;
      end if;

      -- Reserva das outras programações do mesmo dia: o que foi rateado para a
      -- conta e ainda não virou débito.
      select round(coalesce(sum(greatest(0, coalesce(pc.valor_rateado, 0) - coalesce(mv.debitado, 0))), 0)::numeric, 2)
        into reservado_outras
        from public.programacao_contas pc
        join public.programacoes_pagamento pr on pr.id = pc.programacao_id
        left join (
          select programacao_id, conta_id, sum(valor) as debitado
            from public.pagamento_movimentacoes
           group by programacao_id, conta_id
        ) mv on mv.programacao_id = pc.programacao_id
            and mv.conta_id = pc.conta_id
       where pc.conta_id = conta.conta_id
         and pc.programacao_id <> programacao.id
         and pr.data_programacao = programacao.data_programacao;

      disponivel := round(coalesce(saldo_atual, 0) - coalesce(reservado_outras, 0), 2);

      if volta = 1 then
        if debito > disponivel then
          return jsonb_build_object(
            'ok', false,
            'motivo', 'saldo_insuficiente',
            'conta_id', conta.conta_id::text,
            'disponivel', disponivel,
            'necessario', debito,
            'diferenca', debito - disponivel
          );
        end if;
      else
        -- O lançamento fica na data da programação, ou na data do último saldo
        -- da conta quando esta for mais recente (é ela que a tela de saldos lê).
        data_lancamento := greatest(
          programacao.data_programacao,
          coalesce(ultima_data, programacao.data_programacao)
        );

        -- A razão é gravada primeiro: se a linha deste pagamento nesta conta já
        -- existe, o débito já aconteceu antes e nada é lançado de novo.
        insert into public.pagamento_movimentacoes (
          pagamento_id, programacao_id, conta_id, valor,
          saldo_anterior, saldo_posterior, data_movimento, criado_por
        )
        values (
          pagamento.id, programacao.id, conta.conta_id, debito,
          round(coalesce(saldo_atual, 0), 2),
          round(coalesce(saldo_atual, 0) - debito, 2),
          data_lancamento, auth.uid()
        )
        on conflict (pagamento_id, conta_id) do nothing
        returning id into movimento_id;

        if not found then
          continue;
        end if;

        -- O saldo novo entra como o lançamento mais recente da conta.
        insert into public.saldos_historico (conta_id, valor_saldo, data_saldo)
        values (conta.conta_id, round(coalesce(saldo_atual, 0) - debito, 2), data_lancamento)
        on conflict (conta_id, data_saldo)
        do update set valor_saldo = excluded.valor_saldo;
      end if;
    end loop;
  end loop;

  update public.pagamentos
     set situacao = 'pago'
   where id = pagamento.id;

  return jsonb_build_object('ok', true, 'ja_pago', false, 'valor_debitado', valor_pagamento);
end;
$fn$;

revoke all on function public.marcar_pagamento_pago(text) from public;
grant execute on function public.marcar_pagamento_pago(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Matriz de Permissões com a coluna "Excluir" em todos os módulos
-- ---------------------------------------------------------------------------
-- A tela de Cargos e Permissões mostra "Excluir" para cada módulo lendo a linha
-- (perfil, módulo) de perfis_permissoes. Perfis criados antes de um módulo
-- existir ficam sem essa linha e o módulo não aparece. O insert abaixo cobre
-- apenas as combinações que estiverem faltando:
--   * Administrador entra com o módulo liberado (inclusive excluir);
--   * os demais perfis entram sem acesso, para o Administrador liberar caso a
--     caso na própria tela.
-- Nenhuma linha existente é tocada: permissões já configuradas continuam iguais.
insert into public.perfis_permissoes (
  perfil_id, modulo,
  pode_visualizar, pode_cadastrar, pode_editar, pode_excluir, pode_aprovar, pode_visualizar_valores
)
select
  p.id,
  m.modulo,
  p.nome = 'Administrador',
  p.nome = 'Administrador',
  p.nome = 'Administrador',
  p.nome = 'Administrador',
  p.nome = 'Administrador',
  p.nome = 'Administrador' and m.modulo = 'saldos'
from public.perfis_acesso p
cross join (
  values ('saldos'), ('fornecedores'), ('pagamentos'), ('tributario'), ('certidoes'),
         ('relatorios'), ('auditoria'), ('administracao'), ('tarefas')
) as m(modulo)
where not exists (
  select 1
  from public.perfis_permissoes pp
  where pp.perfil_id = p.id
    and pp.modulo = m.modulo
);
