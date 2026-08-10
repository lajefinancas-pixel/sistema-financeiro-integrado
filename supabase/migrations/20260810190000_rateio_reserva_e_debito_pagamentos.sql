-- Pagamentos Diários: rateio do valor por conta, reserva de saldo e débito
-- definitivo apenas no momento do pagamento.
--
-- Problema corrigido: com mais de uma conta bancária escolhida na programação, o
-- valor integral do pagamento era considerado (e debitado) em CADA conta, o que
-- multiplicava a saída e estragava os saldos.
--
-- Modelo desta migration:
--   * public.programacao_contas.valor_rateado -- quanto sai de cada conta na
--     programação. A soma do rateio tem de ser igual ao total dos pagamentos.
--   * public.programacao_contas.ordem -- sequência em que as contas foram
--     escolhidas, usada pelo rateio automático.
--   * public.pagamento_movimentacoes -- razão do que já foi efetivamente
--     debitado (uma linha por pagamento/conta), base da idempotência.
--   * public.marcar_pagamento_pago() -- valida, debita e muda a situação numa
--     única transação; chamar duas vezes não debita duas vezes.
--
-- Enquanto o pagamento está pendente/programado, nada é lançado em
-- public.saldos_historico: o valor só fica reservado (rateado e ainda não
-- debitado), o que impede outra programação do mesmo dia de usar o mesmo
-- dinheiro sem alterar o saldo contábil da conta.
--
-- Nada aqui altera saldos, fornecedores, equipe, tarefas ou histórico.

-- 1. Rateio por conta ------------------------------------------------------

alter table public.programacao_contas
  add column if not exists valor_rateado numeric(14,2) not null default 0;

alter table public.programacao_contas
  add column if not exists ordem integer;

-- Programações antigas ganham uma ordem estável para o rateio automático.
update public.programacao_contas pc
   set ordem = sub.posicao
  from (
    select ctid as linha,
           row_number() over (partition by programacao_id order by ctid) as posicao
      from public.programacao_contas
  ) sub
 where pc.ctid = sub.linha
   and pc.ordem is null;

-- Uma conta aparece uma única vez por programação (o rateio depende disso).
-- Se o banco já tiver duplicatas antigas, a migration segue e apenas avisa.
do $$
begin
  begin
    create unique index if not exists programacao_contas_programacao_conta_idx
      on public.programacao_contas (programacao_id, conta_id);
  exception
    when unique_violation then
      raise notice 'Há contas repetidas em programacao_contas: índice único não criado.';
  end;
end $$;

-- 2. Razão dos débitos efetivados -----------------------------------------

-- Os tipos das chaves vêm das próprias tabelas do sistema, para a migration
-- funcionar independente de como os IDs foram definidos na primeira versão.
do $$
declare
  tipo_pagamento text;
  tipo_programacao text;
  tipo_conta text;
begin
  if to_regclass('public.pagamento_movimentacoes') is not null then
    return;
  end if;

  select format_type(a.atttypid, a.atttypmod) into tipo_pagamento
    from pg_attribute a
   where a.attrelid = 'public.pagamentos'::regclass and a.attname = 'id';

  select format_type(a.atttypid, a.atttypmod) into tipo_programacao
    from pg_attribute a
   where a.attrelid = 'public.programacoes_pagamento'::regclass and a.attname = 'id';

  select format_type(a.atttypid, a.atttypmod) into tipo_conta
    from pg_attribute a
   where a.attrelid = 'public.contas_bancarias'::regclass and a.attname = 'id';

  execute format($ddl$
    create table public.pagamento_movimentacoes (
      id uuid primary key default gen_random_uuid(),
      pagamento_id %1$s not null references public.pagamentos (id) on delete cascade,
      programacao_id %2$s not null references public.programacoes_pagamento (id) on delete cascade,
      conta_id %3$s not null references public.contas_bancarias (id),
      valor numeric(14,2) not null,
      saldo_anterior numeric(14,2),
      saldo_posterior numeric(14,2),
      data_movimento date not null,
      criado_em timestamptz not null default now(),
      criado_por uuid references auth.users (id)
    )
  $ddl$, tipo_pagamento, tipo_programacao, tipo_conta);
end $$;

-- Uma linha por pagamento/conta: é o que garante que um duplo clique em
-- "Marcar como pago" não gere um segundo débito.
create unique index if not exists pagamento_movimentacoes_pagamento_conta_idx
  on public.pagamento_movimentacoes (pagamento_id, conta_id);

create index if not exists pagamento_movimentacoes_programacao_conta_idx
  on public.pagamento_movimentacoes (programacao_id, conta_id);

alter table public.pagamento_movimentacoes enable row level security;

-- Quem usa o sistema lê a razão e grava movimentação em seu próprio nome; a
-- linha nunca é alterada nem apagada à mão (sai junto com o pagamento).
drop policy if exists "pagamento_movimentacoes_select" on public.pagamento_movimentacoes;
create policy "pagamento_movimentacoes_select"
  on public.pagamento_movimentacoes
  for select
  to authenticated
  using (true);

drop policy if exists "pagamento_movimentacoes_insert" on public.pagamento_movimentacoes;
create policy "pagamento_movimentacoes_insert"
  on public.pagamento_movimentacoes
  for insert
  to authenticated
  with check (auth.uid() is not null);

-- 3. Débito automático antigo ---------------------------------------------

-- Remove qualquer gatilho que lançava saldo a partir de pagamentos ou das
-- contas da programação -- era ele que repetia o valor integral em cada conta.
-- O débito passa a acontecer só dentro de marcar_pagamento_pago().
do $$
declare
  gatilho record;
begin
  for gatilho in
    select tg.tgname as nome, cl.relname as tabela
      from pg_trigger tg
      join pg_class cl on cl.oid = tg.tgrelid
      join pg_namespace ns on ns.oid = cl.relnamespace
      join pg_proc pr on pr.oid = tg.tgfoid
     where not tg.tgisinternal
       and ns.nspname = 'public'
       and cl.relname in ('pagamentos', 'programacao_contas', 'programacoes_pagamento')
       and pg_get_functiondef(pr.oid) ilike '%saldos_historico%'
  loop
    execute format('drop trigger if exists %I on public.%I', gatilho.nome, gatilho.tabela);
    raise notice 'Débito automático antigo removido: gatilho % da tabela %', gatilho.nome, gatilho.tabela;
  end loop;
end $$;

-- 4. Efetivação do pagamento ----------------------------------------------

-- Recebe o ID como texto para não depender do tipo da chave de pagamentos.
--
-- Devolve jsonb: { ok: true, ja_pago: bool } quando efetiva (ou quando já
-- estava pago) e { ok: false, motivo: ... } quando barra. Motivos possíveis:
-- pagamento_nao_encontrado, pagamento_cancelado, programacao_nao_encontrada,
-- valor_invalido, sem_contas, rateio_divergente, saldo_insuficiente.
--
-- Tudo ou nada: as validações rodam antes de qualquer gravação (primeira volta
-- do laço) e só a segunda volta lança saldo e movimentação.
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
     and coalesce(situacao, '') <> 'cancelado';

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
