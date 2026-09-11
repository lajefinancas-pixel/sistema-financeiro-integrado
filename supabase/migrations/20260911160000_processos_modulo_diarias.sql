-- MÓDULO PROCESSOS — ENVIO A: ESTRUTURA E DIÁRIAS.
--
-- ATENÇÃO: esta migration precisa ser rodada MANUALMENTE no SQL Editor do
-- Supabase (projeto usado pela aplicação). Nada nela roda sozinho no deploy.
-- Arquivo: supabase/migrations/20260911160000_processos_modulo_diarias.sql
--
-- ---------------------------------------------------------------------------
-- PROCESSOS É DOCUMENTAL, NÃO É FINANCEIRO
-- ---------------------------------------------------------------------------
-- Um processo de diária é PAPEL: duas páginas de um mesmo documento
-- administrativo (a Solicitação de Diária e a Solicitação de Liquidação da
-- Diária). Criar, preencher, finalizar, duplicar ou imprimir um processo aqui
-- NÃO debita conta, NÃO dá baixa em NF, NÃO altera saldo, NÃO marca fornecedor
-- como pago, NÃO cria pagamento e NÃO toca na Programação Diária.
--
-- Por isso esta migration não escreve, não altera e não referencia
-- public.pagamentos, public.pagamentos_baixas, public.valores_em_aberto,
-- public.saldos_historico, public.contas_bancarias, public.transferencias_contas,
-- public.programacoes_pagamento nem qualquer coluna de saldo. A única tabela
-- existente que ela REFERENCIA (somente pelo id, e sem nunca escrever nela) é
-- public.fornecedores, public.secretarias e public.usuarios.
--
-- "Solicitação de liquidação" é o nome do DOCUMENTO da página 2. Não é baixa de
-- pagamento, não quita nota e não movimenta um centavo.
--
-- ---------------------------------------------------------------------------
-- UM PROCESSO = UMA LINHA = DOIS DOCUMENTOS
-- ---------------------------------------------------------------------------
-- Não existem "solicitações" e "liquidações" como registros independentes: as
-- duas páginas são colunas da MESMA linha de public.processos_diarias. É isso
-- que garante, por construção, que elas compartilhem o mesmo número de processo
-- e os mesmos dados gerais — não há como divergirem.
--
-- ---------------------------------------------------------------------------
-- O QUE ESTA MIGRATION ENTREGA
-- ---------------------------------------------------------------------------
--   1. public.pode_em_processos(modulo, acao) -> permissão do módulo, na mesma
--      forma de public.pode_em_area_fornecedor.
--   2. public.processos_diarias -> o processo (as duas páginas na mesma linha).
--   3. public.processos_diarias_numeracao -> a sequência por ano, e
--      public.proximo_numero_processo_diaria(ano) para consumi-la. Número
--      emitido NUNCA é reutilizado, nem quando o processo é cancelado.
--   4. public.processos_diarias_historico -> a trilha própria de cada processo.
--   5. RLS dos três, com gatilho que separa editar de finalizar e de cancelar.
--   6. Padrão dos módulos 'processos_diarias' e 'processos_diarias_saida' em
--      public.perfis_permissoes. NENHUMA permissão existente é alterada.
--
-- EXCLUSÃO É LÓGICA: nenhuma tabela tem política de delete. Rascunho excluído
-- grava excluido_em/excluido_por e a linha continua no banco. Processo
-- FINALIZADO não tem exclusão comum: usa-se cancelar, que preserva tudo.
--
-- IDEMPOTENTE: pode ser rodada mais de uma vez sem efeito colateral. ADITIVA:
-- não apaga nem reescreve nenhum dado existente.

begin;

-- ---------------------------------------------------------------------------
-- 0. Validação da estrutura real ANTES de qualquer alteração
-- ---------------------------------------------------------------------------
do $$
declare
  item record;
  tipo_real text;
begin
  for item in
    select * from (values
      ('fornecedores'), ('secretarias'), ('usuarios'),
      ('perfis_acesso'), ('perfis_permissoes'), ('permissoes_efetivas')
    ) as t(nome)
  loop
    if to_regclass(format('public.%I', item.nome)) is null then
      raise exception 'Estrutura incompatível: public.% não existe. O módulo Processos depende dela.', item.nome;
    end if;
  end loop;

  for item in
    select * from (values
      ('fornecedores', 'id', 'chave'),
      ('secretarias', 'id', 'chave'),
      ('usuarios', 'id', 'chave')
    ) as tipos(tabela, coluna, familia)
  loop
    select format_type(a.atttypid, null)
      into tipo_real
      from pg_attribute a
     where a.attrelid = to_regclass(format('public.%I', item.tabela))
       and a.attname::text = item.coluna
       and not a.attisdropped;

    if tipo_real is null then
      raise exception 'Estrutura incompatível: public.%.% não existe. O módulo Processos depende dela.',
        item.tabela, item.coluna;
    end if;

    if not (tipo_real in ('integer', 'bigint', 'smallint', 'uuid', 'text', 'character varying')) then
      raise exception 'Tipo incompatível em public.%.%: o módulo Processos esperava uma chave e encontrou %.',
        item.tabela, item.coluna, tipo_real;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Lista fixa de módulos: acrescentar os novos ANTES de qualquer seed
-- ---------------------------------------------------------------------------
-- Mesma lição das migrations de Baixas e das áreas de Fornecedores: em bancos
-- onde "modulo" tem lista fixa, o seed da seção 7 seria recusado e a migration
-- inteira abortaria. A restrição é recriada como "(condição original) or modulo
-- in (...)": tudo que era aceito continua aceito.
do $$
declare
  tabela text;
  restricao record;
  corpo text;
begin
  foreach tabela in array array['public.permissoes_excecao', 'public.perfis_permissoes']
  loop
    if to_regclass(tabela) is null then
      continue;
    end if;

    for restricao in
      select conname, pg_get_constraintdef(oid) as definicao
        from pg_constraint
       where conrelid = to_regclass(tabela)
         and contype = 'c'
         and pg_get_constraintdef(oid) like '%modulo%'
         and pg_get_constraintdef(oid) like '%''fornecedores''%'
         and pg_get_constraintdef(oid) not like '%''processos_diarias''%'
    loop
      corpo := regexp_replace(restricao.definicao, '\s+NOT VALID$', '');
      corpo := regexp_replace(corpo, '^CHECK\s*', '');

      execute format('alter table %s drop constraint %I', tabela, restricao.conname);
      execute format(
        'alter table %s add constraint %I check ((%s) or modulo in (''processos_diarias'', ''processos_diarias_saida''))',
        tabela, restricao.conname, corpo
      );
    end loop;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Permissão do módulo
-- ---------------------------------------------------------------------------
-- As sete ações pedidas para Diárias moram em DOIS módulos, porque a matriz de
-- permissões do sistema tem cinco colunas por módulo e nenhuma delas pode ser
-- criada ou alterada por este envio:
--
--   processos_diarias        visualizar -> ver a subaba e a lista
--                            cadastrar  -> criar
--                            editar     -> editar
--                            aprovar    -> FINALIZAR (finalizar não é pagar)
--                            excluir    -> CANCELAR e excluir rascunho
--
--   processos_diarias_saida  visualizar -> imprimir e gerar PDF
--                            cadastrar  -> duplicar
--
-- É o mesmo recurso já usado em 'baixas' e em 'backup', onde as cinco colunas
-- também recebem os rótulos das ações reais da tela.
create or replace function public.pode_em_processos(p_modulo text, p_acao text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.usuarios u
    join public.permissoes_efetivas pe
      on pe.usuario_id = u.id
     and pe.modulo = p_modulo
    where u.auth_id = auth.uid()
      and u.status = 'ativo'
      and case p_acao
            when 'visualizar' then pe.pode_visualizar
            when 'cadastrar'  then pe.pode_cadastrar
            when 'editar'     then pe.pode_editar
            when 'excluir'    then pe.pode_excluir
            when 'aprovar'    then pe.pode_aprovar
            else false
          end
  );
$$;

grant execute on function public.pode_em_processos(text, text) to authenticated;

comment on function public.pode_em_processos(text, text) is
  'Permissão efetiva do usuário logado nos módulos do menu PROCESSOS. Não altera nenhuma permissão existente.';

-- ---------------------------------------------------------------------------
-- 3. O processo de diária (as duas páginas na mesma linha)
-- ---------------------------------------------------------------------------
do $$
declare
  tipo_fornecedor text;
  tipo_secretaria text;
  tipo_usuario text;
begin
  select format_type(a.atttypid, a.atttypmod) into tipo_fornecedor
    from pg_attribute a
   where a.attrelid = to_regclass('public.fornecedores') and a.attname = 'id' and not a.attisdropped;
  select format_type(a.atttypid, a.atttypmod) into tipo_secretaria
    from pg_attribute a
   where a.attrelid = to_regclass('public.secretarias') and a.attname = 'id' and not a.attisdropped;
  select format_type(a.atttypid, a.atttypmod) into tipo_usuario
    from pg_attribute a
   where a.attrelid = to_regclass('public.usuarios') and a.attname = 'id' and not a.attisdropped;

  if to_regclass('public.processos_diarias') is null then
    execute format($ddl$
      create table public.processos_diarias (
        id uuid primary key default gen_random_uuid(),

        -- NUMERAÇÃO: única por processo, sequencial e separada por ano. As DUAS
        -- páginas exibem este mesmo número, porque são a mesma linha.
        ano integer not null,
        numero integer not null,

        -- DADOS GERAIS (compartilhados pelas duas páginas)
        data_processo date,
        secretaria_id %2$s references public.secretarias (id),
        -- Vínculo interno com o cadastro, quando o beneficiário foi buscado
        -- nele. É só um ponteiro: NADA aqui escreve em public.fornecedores, e
        -- o preenchimento manual (sem vínculo) é igualmente válido.
        fornecedor_id %1$s references public.fornecedores (id) on delete set null,
        beneficiario_nome text,
        beneficiario_cpf text,
        objeto text,
        valor_total numeric(14,2) not null default 0,

        -- PÁGINA 1 — SOLICITAÇÃO DE DIÁRIA
        beneficiario_matricula text,
        beneficiario_cargo text,
        beneficiario_lotacao text,
        destino text,
        data_saida date,
        hora_saida text,
        data_retorno date,
        hora_retorno text,
        quantidade_diarias numeric(10,2) not null default 0,
        valor_unitario numeric(14,2) not null default 0,
        -- Marca que o total foi digitado à mão em vez de sair de
        -- quantidade x valor unitário. A alteração manual também vai para a
        -- auditoria, com o antes e o depois.
        valor_total_manual boolean not null default false,
        finalidade text,
        transporte text,
        transporte_outro text,
        banco text,
        agencia text,
        conta text,
        pix text,
        titular text,
        observacoes text,

        -- PÁGINA 2 — SOLICITAÇÃO DE LIQUIDAÇÃO DA DIÁRIA
        -- Só os campos PRÓPRIOS da liquidação moram aqui: tudo o que ela tem em
        -- comum com a página 1 (beneficiário, CPF, secretaria, destino,
        -- finalidade, valor, dados bancários) é lido das colunas acima e nunca
        -- é digitado duas vezes.
        liquidacao_data date,
        liquidacao_data_saida date,
        liquidacao_data_retorno date,
        liquidacao_quantidade numeric(10,2),
        liquidacao_valor numeric(14,2),
        liquidacao_relatorio text,
        liquidacao_documentos text,
        liquidacao_responsavel text,
        liquidacao_observacoes text,

        -- SITUAÇÃO: rascunho, finalizada, cancelada. FINALIZAR NÃO É PAGAR.
        situacao text not null default 'rascunho',
        finalizada_em timestamptz,
        finalizada_por %3$s references public.usuarios (id) on delete set null,
        cancelada_em timestamptz,
        cancelada_por %3$s references public.usuarios (id) on delete set null,
        motivo_cancelamento text,

        -- Exclusão LÓGICA, no padrão do sistema.
        excluido_em timestamptz,
        excluido_por %3$s references public.usuarios (id) on delete set null,
        motivo_exclusao text,

        criado_em timestamptz not null default now(),
        criado_por %3$s references public.usuarios (id) on delete set null,
        atualizado_em timestamptz not null default now(),
        atualizado_por %3$s references public.usuarios (id) on delete set null,

        -- Número emitido é único dentro do ano — e continua ocupado mesmo
        -- depois de o processo ser cancelado.
        unique (ano, numero)
      )
    $ddl$, tipo_fornecedor, tipo_secretaria, tipo_usuario);
  end if;

  -- Sequência por ano. Guardar o último número emitido (em vez de calcular
  -- max(numero)+1) é o que impede a reutilização: cancelar ou excluir um
  -- processo não devolve o número dele para a fila.
  if to_regclass('public.processos_diarias_numeracao') is null then
    create table public.processos_diarias_numeracao (
      ano integer primary key,
      ultimo_numero integer not null default 0,
      atualizado_em timestamptz not null default now()
    );
  end if;

  -- Trilha própria do processo (além da auditoria geral do sistema).
  if to_regclass('public.processos_diarias_historico') is null then
    execute format($ddl$
      create table public.processos_diarias_historico (
        id uuid primary key default gen_random_uuid(),
        processo_id uuid not null references public.processos_diarias (id) on delete cascade,
        acao text not null,
        detalhes jsonb not null default '{}'::jsonb,
        usuario_id %1$s references public.usuarios (id) on delete set null,
        criado_em timestamptz not null default now()
      )
    $ddl$, tipo_usuario);
  end if;
end $$;

-- Situação: as três do andamento do documento. Nenhuma delas significa "pago".
alter table public.processos_diarias drop constraint if exists processos_diarias_situacao_check;
alter table public.processos_diarias add constraint processos_diarias_situacao_check
  check (situacao in ('rascunho', 'finalizada', 'cancelada'));

alter table public.processos_diarias drop constraint if exists processos_diarias_transporte_check;
alter table public.processos_diarias add constraint processos_diarias_transporte_check
  check (transporte is null or transporte in ('veiculo_oficial', 'veiculo_proprio', 'onibus', 'aviao', 'outro'));

alter table public.processos_diarias drop constraint if exists processos_diarias_numero_positivo;
alter table public.processos_diarias add constraint processos_diarias_numero_positivo
  check (numero > 0 and ano between 2000 and 2999);

create index if not exists processos_diarias_ano_numero_idx on public.processos_diarias (ano desc, numero desc);
create index if not exists processos_diarias_secretaria_idx on public.processos_diarias (secretaria_id);
create index if not exists processos_diarias_fornecedor_idx on public.processos_diarias (fornecedor_id);
create index if not exists processos_diarias_situacao_idx on public.processos_diarias (situacao);
create index if not exists processos_diarias_historico_processo_idx on public.processos_diarias_historico (processo_id);

-- ---------------------------------------------------------------------------
-- 4. Numeração sequencial por ano
-- ---------------------------------------------------------------------------
-- Devolve o próximo número do ano e já o marca como consumido, na mesma
-- transação. Dois usuários criando ao mesmo tempo recebem números diferentes:
-- o "on conflict do update" serializa no próprio banco.
create or replace function public.proximo_numero_processo_diaria(p_ano integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  proximo integer;
begin
  if p_ano is null or p_ano < 2000 or p_ano > 2999 then
    raise exception 'Ano inválido para a numeração de processos: %', p_ano;
  end if;

  -- Sem sessão de usuário (SQL Editor, service role) a RLS também não se
  -- aplica; com sessão, só quem pode criar ou duplicar consome número.
  if auth.uid() is not null
     and not public.pode_em_processos('processos_diarias', 'cadastrar')
     and not public.pode_em_processos('processos_diarias_saida', 'cadastrar')
  then
    raise exception 'Sem permissão para criar processos de diária.';
  end if;

  -- O ponto de partida do ano respeita o que já existir na tabela: em banco que
  -- receba processos importados, a fila continua depois do maior número.
  insert into public.processos_diarias_numeracao (ano, ultimo_numero)
  values (
    p_ano,
    coalesce((select max(numero) from public.processos_diarias where ano = p_ano), 0) + 1
  )
  on conflict (ano) do update
    set ultimo_numero = greatest(
          public.processos_diarias_numeracao.ultimo_numero,
          coalesce((select max(numero) from public.processos_diarias where ano = p_ano), 0)
        ) + 1,
        atualizado_em = now()
  returning ultimo_numero into proximo;

  return proximo;
end;
$$;

grant execute on function public.proximo_numero_processo_diaria(integer) to authenticated;

comment on function public.proximo_numero_processo_diaria(integer) is
  'Próximo número do processo de diária no ano, já consumido da fila. Número emitido nunca é reutilizado, mesmo se o processo for cancelado.';

-- ---------------------------------------------------------------------------
-- 5. Editar, finalizar e cancelar são permissões DIFERENTES
-- ---------------------------------------------------------------------------
-- A política de update precisa aceitar as três (finalizar e cancelar também são
-- updates). Sem esta conferência, quem só pode finalizar conseguiria reescrever
-- o conteúdo do documento no mesmo update.
create or replace function public.conferir_alteracao_processo_diaria()
returns trigger
language plpgsql
as $$
declare
  antes jsonb;
  depois jsonb;
  controle text[] := array[
    'situacao', 'finalizada_em', 'finalizada_por', 'cancelada_em', 'cancelada_por',
    'motivo_cancelamento', 'excluido_em', 'excluido_por', 'motivo_exclusao',
    'atualizado_em', 'atualizado_por'
  ];
  campo text;
begin
  -- Sem sessão de usuário (SQL Editor, service role, esta própria migration):
  -- a RLS também não se aplica, e o gatilho não pode ser mais restritivo.
  if auth.uid() is null then
    return new;
  end if;

  if new.ano is distinct from old.ano or new.numero is distinct from old.numero then
    raise exception 'O número do processo não pode ser alterado.';
  end if;

  antes := to_jsonb(old);
  depois := to_jsonb(new);
  foreach campo in array controle loop
    antes := antes - campo;
    depois := depois - campo;
  end loop;

  -- Mudança de situação: cada destino tem a sua permissão.
  if new.situacao is distinct from old.situacao then
    if new.situacao = 'finalizada' and not public.pode_em_processos('processos_diarias', 'aprovar') then
      raise exception 'Sem permissão para finalizar processos de diária.';
    end if;
    if new.situacao = 'cancelada' and not public.pode_em_processos('processos_diarias', 'excluir') then
      raise exception 'Sem permissão para cancelar processos de diária.';
    end if;
    if new.situacao = 'rascunho' and not public.pode_em_processos('processos_diarias', 'editar') then
      raise exception 'Sem permissão para reabrir processos de diária.';
    end if;
  end if;

  -- Exclusão lógica do rascunho.
  if new.excluido_em is distinct from old.excluido_em then
    if not public.pode_em_processos('processos_diarias', 'excluir') then
      raise exception 'Sem permissão para excluir processos de diária.';
    end if;
    if old.situacao = 'finalizada' and new.excluido_em is not null then
      raise exception 'Processo finalizado não tem exclusão comum: use cancelar, que preserva o registro e o histórico.';
    end if;
  end if;

  -- Conteúdo do documento.
  if antes is distinct from depois then
    if not public.pode_em_processos('processos_diarias', 'editar') then
      raise exception 'Sem permissão para editar processos de diária.';
    end if;
    if old.situacao <> 'rascunho' then
      raise exception 'Processo % não está em rascunho: o conteúdo dele não pode mais ser alterado.', old.numero;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists processos_diarias_alteracao on public.processos_diarias;
create trigger processos_diarias_alteracao before update on public.processos_diarias
  for each row execute function public.conferir_alteracao_processo_diaria();

-- ---------------------------------------------------------------------------
-- 6. RLS
-- ---------------------------------------------------------------------------
-- Nenhuma das três tabelas tem política de delete: exclusão é lógica e o
-- histórico é somente-inserção.
alter table public.processos_diarias enable row level security;
alter table public.processos_diarias_numeracao enable row level security;
alter table public.processos_diarias_historico enable row level security;

drop policy if exists processos_diarias_select on public.processos_diarias;
create policy processos_diarias_select on public.processos_diarias for select to authenticated
  using (public.pode_em_processos('processos_diarias', 'visualizar'));

-- Criar e DUPLICAR entram pela mesma porta: duplicar é criar um processo novo,
-- com id e numeração próprios, sem tocar no original.
drop policy if exists processos_diarias_insert on public.processos_diarias;
create policy processos_diarias_insert on public.processos_diarias for insert to authenticated
  with check (
    public.pode_em_processos('processos_diarias', 'cadastrar')
    or public.pode_em_processos('processos_diarias_saida', 'cadastrar')
  );

drop policy if exists processos_diarias_update on public.processos_diarias;
create policy processos_diarias_update on public.processos_diarias for update to authenticated
  using (
    public.pode_em_processos('processos_diarias', 'editar')
    or public.pode_em_processos('processos_diarias', 'aprovar')
    or public.pode_em_processos('processos_diarias', 'excluir')
  )
  with check (
    public.pode_em_processos('processos_diarias', 'editar')
    or public.pode_em_processos('processos_diarias', 'aprovar')
    or public.pode_em_processos('processos_diarias', 'excluir')
  );

drop policy if exists processos_diarias_numeracao_select on public.processos_diarias_numeracao;
create policy processos_diarias_numeracao_select on public.processos_diarias_numeracao for select to authenticated
  using (public.pode_em_processos('processos_diarias', 'visualizar'));

drop policy if exists processos_diarias_historico_select on public.processos_diarias_historico;
create policy processos_diarias_historico_select on public.processos_diarias_historico for select to authenticated
  using (public.pode_em_processos('processos_diarias', 'visualizar'));

drop policy if exists processos_diarias_historico_insert on public.processos_diarias_historico;
create policy processos_diarias_historico_insert on public.processos_diarias_historico for insert to authenticated
  with check (
    public.pode_em_processos('processos_diarias', 'cadastrar')
    or public.pode_em_processos('processos_diarias', 'editar')
    or public.pode_em_processos('processos_diarias', 'aprovar')
    or public.pode_em_processos('processos_diarias', 'excluir')
    or public.pode_em_processos('processos_diarias_saida', 'cadastrar')
  );

grant select, insert, update on public.processos_diarias to authenticated;
grant select on public.processos_diarias_numeracao to authenticated;
grant select, insert on public.processos_diarias_historico to authenticated;
revoke delete on public.processos_diarias from authenticated;
revoke delete on public.processos_diarias_historico from authenticated;
revoke all on public.processos_diarias from anon;
revoke all on public.processos_diarias_numeracao from anon;
revoke all on public.processos_diarias_historico from anon;

-- ---------------------------------------------------------------------------
-- 7. Padrão dos dois módulos novos nos perfis
-- ---------------------------------------------------------------------------
-- Cópia do que o perfil já tem em 'pagamentos', que é o módulo administrativo
-- mais próximo de quem trabalha com diárias. NENHUMA permissão existente é
-- alterada — só entram linhas novas, para módulos novos.
insert into public.perfis_permissoes (
  perfil_id, modulo,
  pode_visualizar, pode_cadastrar, pode_editar, pode_excluir, pode_aprovar, pode_visualizar_valores
)
select
  pp.perfil_id,
  'processos_diarias',
  pp.pode_visualizar,
  pp.pode_cadastrar,
  pp.pode_editar,
  pp.pode_excluir,
  pp.pode_aprovar,
  false
from public.perfis_permissoes pp
where pp.modulo = 'pagamentos'
  and not exists (
    select 1 from public.perfis_permissoes x
     where x.perfil_id = pp.perfil_id and x.modulo = 'processos_diarias'
  );

-- Imprimir acompanha quem pode ver; duplicar acompanha quem pode criar.
insert into public.perfis_permissoes (
  perfil_id, modulo,
  pode_visualizar, pode_cadastrar, pode_editar, pode_excluir, pode_aprovar, pode_visualizar_valores
)
select
  pp.perfil_id,
  'processos_diarias_saida',
  pp.pode_visualizar,
  pp.pode_cadastrar,
  false, false, false, false
from public.perfis_permissoes pp
where pp.modulo = 'processos_diarias'
  and not exists (
    select 1 from public.perfis_permissoes x
     where x.perfil_id = pp.perfil_id and x.modulo = 'processos_diarias_saida'
  );

-- Perfis que não têm nem linha de 'pagamentos': só Administrador nasce liberado.
insert into public.perfis_permissoes (
  perfil_id, modulo,
  pode_visualizar, pode_cadastrar, pode_editar, pode_excluir, pode_aprovar, pode_visualizar_valores
)
select
  p.id,
  modulo.nome,
  p.nome = 'Administrador',
  p.nome = 'Administrador',
  p.nome = 'Administrador' and modulo.nome = 'processos_diarias',
  p.nome = 'Administrador' and modulo.nome = 'processos_diarias',
  p.nome = 'Administrador' and modulo.nome = 'processos_diarias',
  false
from public.perfis_acesso p
cross join (values ('processos_diarias'), ('processos_diarias_saida')) as modulo(nome)
where not exists (
  select 1 from public.perfis_permissoes x
   where x.perfil_id = p.id and x.modulo = modulo.nome
);

comment on table public.processos_diarias is
  'Processo de diária: UMA linha com as DUAS páginas do documento (Solicitação e Liquidação). Documental, não financeiro — nada aqui debita conta, dá baixa em NF, altera saldo ou cria pagamento.';
comment on table public.processos_diarias_numeracao is
  'Sequência do número de processo por ano. Número emitido nunca volta para a fila, nem quando o processo é cancelado.';
comment on table public.processos_diarias_historico is
  'Trilha própria de cada processo de diária (criação, alteração, finalização, cancelamento, duplicação e alteração manual de valor).';

commit;
