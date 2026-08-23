-- Alertas de vencimento das certidões.
--
-- Os avisos são gravados na tabela public.notificacoes que já existe (a mesma
-- do módulo Tarefas e do sino do topo da tela). Para que o sistema saiba a qual
-- certidão cada aviso pertence — e assim NÃO repetir o mesmo alerta a cada vez
-- que a página abre — a tabela ganha três colunas novas:
--
--   certidao_id      -> a certidão que originou o aviso (nulo nos avisos de tarefa);
--   certidao_estagio -> em que prazo o aviso foi gerado ('d30', 'd15', 'd7',
--                       'd0' — dias que faltavam — ou 'vencida'), para o aviso
--                       poder ser atualizado quando o prazo aperta em vez de
--                       virar um aviso novo;
--   dispensada_em    -> quando a pessoa dispensou o aviso.
--
-- Nada é alterado nas colunas, nos índices, nas políticas ou nos dados que o
-- módulo Tarefas já usa: as colunas são novas e aceitam nulo. Os avisos de
-- tarefa continuam gravados exatamente como antes.
--
-- A migration é IDEMPOTENTE: pode ser rodada mais de uma vez sem erro.

do $$
begin
  if to_regclass('public.notificacoes') is null then
    raise exception 'A tabela public.notificacoes não existe. Rode antes a migration 20260810180000_tarefas_delegacao_aprovacao_recorrencia_notificacoes.sql.';
  end if;

  if to_regclass('public.certidoes') is null then
    raise exception 'A tabela public.certidoes não existe. Rode antes a migration 20260823120000_certidoes_fornecedores.sql.';
  end if;
end $$;

-- A referência é criada dentro de um bloco porque "add column if not exists"
-- com "references" repetiria a chave estrangeira em execuções seguintes.
alter table public.notificacoes add column if not exists certidao_id uuid;
alter table public.notificacoes add column if not exists certidao_estagio text;
alter table public.notificacoes add column if not exists dispensada_em timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.notificacoes'::regclass
      and conname = 'notificacoes_certidao_id_fkey'
  ) then
    alter table public.notificacoes
      add constraint notificacoes_certidao_id_fkey
      foreign key (certidao_id) references public.certidoes (id) on delete cascade;
  end if;
end $$;

-- Estágios aceitos: 'vencida' ou 'd' + os dias que faltavam. O formato é aberto
-- (e não uma lista fechada) porque os prazos de alerta são configuráveis: quem
-- trocar os padrões 30/15/7/0 por 45/20/5 grava 'd45', 'd20', 'd5'.
-- Nulo nos avisos que não são de certidão (tarefas).
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.notificacoes'::regclass
      and conname = 'notificacoes_certidao_estagio_check'
  ) then
    alter table public.notificacoes
      add constraint notificacoes_certidao_estagio_check
      check (
        certidao_estagio is null
        or certidao_estagio = 'vencida'
        or certidao_estagio ~ '^d[0-9]{1,4}$'
      );
  end if;
end $$;

-- Uma única pendência por pessoa e por certidão: a regra "não duplicar alerta"
-- passa a valer no banco, e não só na tela. Quando o prazo aperta (30 -> 15 ->
-- 7 -> hoje -> vencida) a mesma linha é atualizada.
create unique index if not exists notificacoes_certidao_unica_idx
  on public.notificacoes (usuario_id, certidao_id)
  where certidao_id is not null;

-- Consulta da tela: as pendências ainda não dispensadas de quem está logado.
create index if not exists notificacoes_certidao_pendentes_idx
  on public.notificacoes (usuario_id, dispensada_em)
  where certidao_id is not null;
