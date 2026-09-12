-- MÓDULO PROCESSOS — ENVIO B: SERVIÇOS/MATERIAIS.
--
-- ATENÇÃO: esta migration precisa ser rodada MANUALMENTE no SQL Editor do
-- Supabase (projeto usado pela aplicação). Nada nela roda sozinho no deploy.
-- Arquivo: supabase/migrations/20260911260000_processos_modulo_servicos.sql
--
-- ---------------------------------------------------------------------------
-- PROCESSOS É DOCUMENTAL, NÃO É FINANCEIRO
-- ---------------------------------------------------------------------------
-- Um processo de serviços/materiais é PAPEL: duas páginas de um mesmo documento
-- administrativo (a Requisição de Material/Serviço e a Liquidação/Solicitação
-- de Pagamento). Criar, preencher, finalizar, duplicar ou imprimir um processo
-- aqui NÃO debita conta, NÃO dá baixa em NF, NÃO altera saldo, NÃO marca
-- fornecedor como pago, NÃO cria pagamento e NÃO toca na Programação Diária.
--
-- "LIQUIDAÇÃO/SOLICITAÇÃO DE PAGAMENTO" é o nome do DOCUMENTO da página 2. Não
-- é baixa de pagamento, não quita nota e não movimenta um centavo.
--
-- Por isso esta migration não escreve, não altera e não referencia
-- public.pagamentos, public.pagamentos_baixas, public.saldos_historico,
-- public.contas_bancarias, public.transferencias_contas nem
-- public.programacoes_pagamento, e não cria gatilho nenhum sobre elas.
--
-- A NF VINCULADA É CONSULTA. A coluna `nota_id` aponta para
-- public.valores_em_aberto apenas para lembrar DE QUAL nota os valores foram
-- copiados. Ela é `on delete set null`, nunca é escrita do outro lado, e os
-- valores ficam copiados dentro do processo: selecionar a nota não a altera, não
-- dá baixa nela e não muda o valor em aberto dela.
--
-- ---------------------------------------------------------------------------
-- UM PROCESSO = UMA LINHA = DOIS DOCUMENTOS
-- ---------------------------------------------------------------------------
-- Não existem "requisições" e "liquidações" como registros independentes: as
-- duas páginas são colunas da MESMA linha de public.processos_servicos. É isso
-- que garante, por construção, que elas compartilhem o mesmo número de processo
-- e os mesmos dados gerais — não há como divergirem.
--
-- OS ITENS DA REQUISIÇÃO ficam em `itens jsonb` na própria linha do processo:
-- eles são conteúdo do documento, na ordem em que serão impressos, e a
-- numeração 01, 02, 03 é a posição na lista. Isso mantém o processo em um
-- registro único (inclusive para o rascunho automático, a duplicação e o
-- antes/depois da auditoria) e a NUMERAÇÃO NUNCA fica com buraco: remover um
-- item renumera a lista inteira.
--
-- ⚠️ A REQUISIÇÃO NÃO TEM VALORES: os itens guardam quantidade e discriminação,
-- e NENHUMA coluna de valor unitário ou total por item existe aqui. Valor só na
-- página 2, e um só: o valor do pagamento solicitado.
--
-- ---------------------------------------------------------------------------
-- O QUE ESTA MIGRATION ENTREGA
-- ---------------------------------------------------------------------------
--   1. public.processos_servicos -> o processo (as duas páginas na mesma linha).
--   2. public.processos_servicos_numeracao -> a sequência por ano, e
--      public.proximo_numero_processo_servico(ano) para consumi-la. Número
--      emitido NUNCA é reutilizado, nem quando o processo é cancelado.
--   3. public.processos_servicos_historico -> a trilha própria de cada processo.
--   4. RLS dos três, com gatilho que separa editar de finalizar e de cancelar.
--   5. Padrão dos módulos 'processos_servicos' e 'processos_servicos_saida' em
--      public.perfis_permissoes. NENHUMA permissão existente é alterada.
--
-- public.pode_em_processos(modulo, acao) já existe desde o ENVIO A e é
-- REAPROVEITADA como está: esta migration não a altera.
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
      ('fornecedores'), ('usuarios'),
      ('perfis_acesso'), ('perfis_permissoes'), ('permissoes_efetivas')
    ) as t(nome)
  loop
    if to_regclass(format('public.%I', item.nome)) is null then
      raise exception 'Estrutura incompatível: public.% não existe. O módulo Processos depende dela.', item.nome;
    end if;
  end loop;

  if to_regproc('public.pode_em_processos') is null then
    raise exception 'Rode primeiro a migration 20260911160000_processos_modulo_diarias.sql: public.pode_em_processos(text, text) ainda não existe neste banco.';
  end if;

  if to_regclass('public.processos_secretarias_solicitantes') is null then
    raise exception 'Rode primeiro a migration 20260911240000_processos_solicitantes_e_bancos.sql: o cadastro de Secretarias Solicitantes ainda não existe neste banco.';
  end if;

  for item in
    select * from (values
      ('fornecedores', 'id'),
      ('usuarios', 'id')
    ) as tipos(tabela, coluna)
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
-- Mesma lição do ENVIO A: em bancos onde "modulo" tem lista fixa, o seed da
-- seção 6 seria recusado e a migration inteira abortaria. A restrição é
-- recriada como "(condição original) or modulo in (...)": tudo que era aceito
-- continua aceito, e nenhuma permissão existente muda.
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
         and pg_get_constraintdef(oid) not like '%''processos_servicos''%'
    loop
      corpo := regexp_replace(restricao.definicao, '\s+NOT VALID$', '');
      corpo := regexp_replace(corpo, '^CHECK\s*', '');

      execute format('alter table %s drop constraint %I', tabela, restricao.conname);
      execute format(
        'alter table %s add constraint %I check ((%s) or modulo in (''processos_servicos'', ''processos_servicos_saida''))',
        tabela, restricao.conname, corpo
      );
    end loop;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. O processo de serviços/materiais (as duas páginas na mesma linha)
-- ---------------------------------------------------------------------------
do $$
declare
  tipo_fornecedor text;
  tipo_usuario text;
  tipo_nota text;
begin
  select format_type(a.atttypid, a.atttypmod) into tipo_fornecedor
    from pg_attribute a
   where a.attrelid = to_regclass('public.fornecedores') and a.attname = 'id' and not a.attisdropped;
  select format_type(a.atttypid, a.atttypmod) into tipo_usuario
    from pg_attribute a
   where a.attrelid = to_regclass('public.usuarios') and a.attname = 'id' and not a.attisdropped;

  if to_regclass('public.processos_servicos') is null then
    execute format($ddl$
      create table public.processos_servicos (
        id uuid primary key default gen_random_uuid(),

        -- NUMERAÇÃO: única por processo, sequencial e separada por ano. É
        -- INTERNA -- o papel não a imprime, como nas diárias.
        ano integer not null,
        numero integer not null,

        -- DADOS GERAIS (compartilhados pelas duas páginas)
        data_processo date,
        -- A SECRETARIA SOLICITANTE vem do cadastro PRÓPRIO do módulo Processos
        -- (public.processos_secretarias_solicitantes), não do cadastro
        -- financeiro de secretarias. Os quatro campos seguintes são o
        -- CONGELAMENTO: trocar o secretário amanhã não reescreve o documento
        -- emitido hoje.
        solicitante_id uuid references public.processos_secretarias_solicitantes (id),
        solicitante_nome text,
        solicitante_secretario text,
        solicitante_secretario_cpf text,
        solicitante_secretario_cargo text,
        objeto text,
        observacoes text,

        -- PÁGINA 1 — REQUISIÇÃO DE MATERIAL/SERVIÇO
        -- Um dos quatro tipos do modelo oficial, marcado com "X"; os outros
        -- três saem impressos em branco.
        tipo text,
        -- OS ITENS DO QUADRO DESCRITIVO, na ordem de impressão:
        -- [{ "quantidade": "10", "discriminacao": "Resma de papel A4" }]
        -- ⚠️ SEM VALOR: a requisição não tem coluna de valor nenhuma.
        itens jsonb not null default '[]'::jsonb,
        -- "À SECRETARIA MUNICIPAL DE ____", no despacho da prefeita.
        despacho_secretaria text,
        -- Quem assina como requisitante (nome, cargo e identificação
        -- funcional). É conteúdo do DOCUMENTO: fica gravado aqui e não é lido
        -- do cadastro na hora de imprimir.
        requisitante_servidor_id uuid,
        requisitante_nome text,
        requisitante_cpf text,
        requisitante_cargo text,

        -- PÁGINA 2 — LIQUIDAÇÃO/SOLICITAÇÃO DE PAGAMENTO
        -- A atestação: 'servicos' (prestou serviços) ou 'materiais' (forneceu
        -- os materiais). É SUGERIDA pelo tipo da página 1 e pode ser trocada.
        atestado text,
        referencia text,
        fundamentacao text,
        -- O FAVORECIDO. `fornecedor_id` é só o vínculo interno com o cadastro,
        -- quando o favorecido foi buscado nele: NADA aqui escreve em
        -- public.fornecedores, e o preenchimento manual (sem vínculo) é
        -- igualmente válido -- e não cria fornecedor.
        fornecedor_id %1$s references public.fornecedores (id) on delete set null,
        favorecido_nome text,
        favorecido_cpf_cnpj text,
        favorecido_endereco text,
        banco_codigo text,
        banco text,
        agencia text,
        conta text,
        pix text,
        titular text,
        -- O VALOR do pagamento solicitado, em algarismo e POR EXTENSO.
        valor_total numeric(14,2) not null default 0,
        valor_extenso text,
        valor_extenso_manual boolean not null default false,
        liquidacao_data date,
        liquidacao_assinante_servidor_id uuid,
        liquidacao_assinante_nome text,
        liquidacao_assinante_cpf text,
        liquidacao_assinante_cargo text,
        liquidacao_observacoes text,

        -- NF VINCULADA — ⚠️ CONSULTA. Os valores são COPIADOS para cá; a nota
        -- original não é alterada, não recebe baixa e não muda de valor em
        -- aberto por causa deste vínculo.
        nota_numero text,
        nota_emissao date,
        nota_valor_bruto numeric(14,2),
        nota_retencoes numeric(14,2),
        nota_valor_liquido numeric(14,2),

        -- A identidade visual (brasão e rodapé) congelada na finalização.
        identidade_visual jsonb,

        -- SITUAÇÃO: rascunho, finalizada, cancelada. FINALIZAR NÃO É PAGAR.
        situacao text not null default 'rascunho',
        finalizada_em timestamptz,
        finalizada_por %2$s references public.usuarios (id) on delete set null,
        cancelada_em timestamptz,
        cancelada_por %2$s references public.usuarios (id) on delete set null,
        motivo_cancelamento text,

        -- Exclusão LÓGICA, no padrão do sistema.
        excluido_em timestamptz,
        excluido_por %2$s references public.usuarios (id) on delete set null,
        motivo_exclusao text,

        criado_em timestamptz not null default now(),
        criado_por %2$s references public.usuarios (id) on delete set null,
        atualizado_em timestamptz not null default now(),
        atualizado_por %2$s references public.usuarios (id) on delete set null,

        -- Número emitido é único dentro do ano — e continua ocupado mesmo
        -- depois de o processo ser cancelado.
        unique (ano, numero)
      )
    $ddl$, tipo_fornecedor, tipo_usuario);
  end if;

  -- Colunas acrescentadas depois da criação da tabela (idempotência).
  execute 'alter table public.processos_servicos
             add column if not exists itens jsonb not null default ''[]''::jsonb,
             add column if not exists identidade_visual jsonb';

  -- O VÍNCULO DE CONSULTA com a NF, quando este banco tem a tabela de notas. O
  -- tipo do id de public.valores_em_aberto varia de banco para banco, então ele
  -- é lido antes. Sem a tabela, a coluna nasce como texto e o processo grava
  -- apenas a referência -- os valores copiados continuam valendo do mesmo jeito.
  if not exists (
    select 1 from pg_attribute
     where attrelid = to_regclass('public.processos_servicos')
       and attname = 'nota_id' and not attisdropped
  ) then
    if to_regclass('public.valores_em_aberto') is null then
      execute 'alter table public.processos_servicos add column nota_id text';
    else
      select format_type(a.atttypid, a.atttypmod) into tipo_nota
        from pg_attribute a
       where a.attrelid = to_regclass('public.valores_em_aberto')
         and a.attname = 'id' and not a.attisdropped;
      execute format(
        'alter table public.processos_servicos add column nota_id %s references public.valores_em_aberto (id) on delete set null',
        coalesce(tipo_nota, 'text')
      );
    end if;
  end if;

  -- Sequência por ano. Guardar o último número emitido (em vez de calcular
  -- max(numero)+1) é o que impede a reutilização: cancelar ou excluir um
  -- processo não devolve o número dele para a fila.
  if to_regclass('public.processos_servicos_numeracao') is null then
    create table public.processos_servicos_numeracao (
      ano integer primary key,
      ultimo_numero integer not null default 0,
      atualizado_em timestamptz not null default now()
    );
  end if;

  -- Trilha própria do processo (além da auditoria geral do sistema).
  if to_regclass('public.processos_servicos_historico') is null then
    execute format($ddl$
      create table public.processos_servicos_historico (
        id uuid primary key default gen_random_uuid(),
        processo_id uuid not null references public.processos_servicos (id) on delete cascade,
        acao text not null,
        detalhes jsonb not null default '{}'::jsonb,
        usuario_id %1$s references public.usuarios (id) on delete set null,
        criado_em timestamptz not null default now()
      )
    $ddl$, tipo_usuario);
  end if;
end $$;

-- Situação: as três do andamento do documento. Nenhuma delas significa "pago".
alter table public.processos_servicos drop constraint if exists processos_servicos_situacao_check;
alter table public.processos_servicos add constraint processos_servicos_situacao_check
  check (situacao in ('rascunho', 'finalizada', 'cancelada'));

-- Os quatro tipos do modelo oficial, e só um por processo.
alter table public.processos_servicos drop constraint if exists processos_servicos_tipo_check;
alter table public.processos_servicos add constraint processos_servicos_tipo_check
  check (tipo is null or tipo in ('aquisicao', 'servicos', 'contratacao', 'locacao'));

-- As duas atestações do modelo oficial, e só uma por processo.
alter table public.processos_servicos drop constraint if exists processos_servicos_atestado_check;
alter table public.processos_servicos add constraint processos_servicos_atestado_check
  check (atestado is null or atestado in ('servicos', 'materiais'));

alter table public.processos_servicos drop constraint if exists processos_servicos_itens_lista;
alter table public.processos_servicos add constraint processos_servicos_itens_lista
  check (jsonb_typeof(itens) = 'array');

alter table public.processos_servicos drop constraint if exists processos_servicos_numero_positivo;
alter table public.processos_servicos add constraint processos_servicos_numero_positivo
  check (numero > 0 and ano between 2000 and 2999);

create index if not exists processos_servicos_ano_numero_idx on public.processos_servicos (ano desc, numero desc);
create index if not exists processos_servicos_solicitante_idx on public.processos_servicos (solicitante_id);
create index if not exists processos_servicos_fornecedor_idx on public.processos_servicos (fornecedor_id);
create index if not exists processos_servicos_situacao_idx on public.processos_servicos (situacao);
create index if not exists processos_servicos_historico_processo_idx on public.processos_servicos_historico (processo_id);

-- ---------------------------------------------------------------------------
-- 3. Numeração sequencial por ano
-- ---------------------------------------------------------------------------
-- Devolve o próximo número do ano e já o marca como consumido, na mesma
-- transação. Dois usuários criando ao mesmo tempo recebem números diferentes:
-- o "on conflict do update" serializa no próprio banco.
create or replace function public.proximo_numero_processo_servico(p_ano integer)
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
     and not public.pode_em_processos('processos_servicos', 'cadastrar')
     and not public.pode_em_processos('processos_servicos_saida', 'cadastrar')
  then
    raise exception 'Sem permissão para criar processos de serviços/materiais.';
  end if;

  -- O ponto de partida do ano respeita o que já existir na tabela: em banco que
  -- receba processos importados, a fila continua depois do maior número.
  insert into public.processos_servicos_numeracao (ano, ultimo_numero)
  values (
    p_ano,
    coalesce((select max(numero) from public.processos_servicos where ano = p_ano), 0) + 1
  )
  on conflict (ano) do update
    set ultimo_numero = greatest(
          public.processos_servicos_numeracao.ultimo_numero,
          coalesce((select max(numero) from public.processos_servicos where ano = p_ano), 0)
        ) + 1,
        atualizado_em = now()
  returning ultimo_numero into proximo;

  return proximo;
end;
$$;

grant execute on function public.proximo_numero_processo_servico(integer) to authenticated;

comment on function public.proximo_numero_processo_servico(integer) is
  'Próximo número do processo de serviços/materiais no ano, já consumido da fila. Número emitido nunca é reutilizado, mesmo se o processo for cancelado.';

-- ---------------------------------------------------------------------------
-- 4. Editar, finalizar e cancelar são permissões DIFERENTES
-- ---------------------------------------------------------------------------
-- A política de update precisa aceitar as três (finalizar e cancelar também são
-- updates). Sem esta conferência, quem só pode finalizar conseguiria reescrever
-- o conteúdo do documento no mesmo update.
create or replace function public.conferir_alteracao_processo_servico()
returns trigger
language plpgsql
as $$
declare
  antes jsonb;
  depois jsonb;
  controle text[] := array[
    'situacao', 'finalizada_em', 'finalizada_por', 'cancelada_em', 'cancelada_por',
    'motivo_cancelamento', 'excluido_em', 'excluido_por', 'motivo_exclusao',
    'identidade_visual', 'atualizado_em', 'atualizado_por'
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
    if new.situacao = 'finalizada' and not public.pode_em_processos('processos_servicos', 'aprovar') then
      raise exception 'Sem permissão para finalizar processos de serviços/materiais.';
    end if;
    if new.situacao = 'cancelada' and not public.pode_em_processos('processos_servicos', 'excluir') then
      raise exception 'Sem permissão para cancelar processos de serviços/materiais.';
    end if;
    if new.situacao = 'rascunho' and not public.pode_em_processos('processos_servicos', 'editar') then
      raise exception 'Sem permissão para reabrir processos de serviços/materiais.';
    end if;
  end if;

  -- Exclusão lógica do rascunho.
  if new.excluido_em is distinct from old.excluido_em then
    if not public.pode_em_processos('processos_servicos', 'excluir') then
      raise exception 'Sem permissão para excluir processos de serviços/materiais.';
    end if;
    if old.situacao = 'finalizada' and new.excluido_em is not null then
      raise exception 'Processo finalizado não tem exclusão comum: use cancelar, que preserva o registro e o histórico.';
    end if;
  end if;

  -- Conteúdo do documento.
  if antes is distinct from depois then
    if not public.pode_em_processos('processos_servicos', 'editar') then
      raise exception 'Sem permissão para editar processos de serviços/materiais.';
    end if;
    if old.situacao <> 'rascunho' then
      raise exception 'Processo % não está em rascunho: o conteúdo dele não pode mais ser alterado.', old.numero;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists processos_servicos_alteracao on public.processos_servicos;
create trigger processos_servicos_alteracao before update on public.processos_servicos
  for each row execute function public.conferir_alteracao_processo_servico();

-- ---------------------------------------------------------------------------
-- 5. RLS
-- ---------------------------------------------------------------------------
-- Nenhuma das três tabelas tem política de delete: exclusão é lógica e o
-- histórico é somente-inserção.
alter table public.processos_servicos enable row level security;
alter table public.processos_servicos_numeracao enable row level security;
alter table public.processos_servicos_historico enable row level security;

drop policy if exists processos_servicos_select on public.processos_servicos;
create policy processos_servicos_select on public.processos_servicos for select to authenticated
  using (public.pode_em_processos('processos_servicos', 'visualizar'));

-- Criar e DUPLICAR entram pela mesma porta: duplicar é criar um processo novo,
-- com id e numeração próprios, sem tocar no original.
drop policy if exists processos_servicos_insert on public.processos_servicos;
create policy processos_servicos_insert on public.processos_servicos for insert to authenticated
  with check (
    public.pode_em_processos('processos_servicos', 'cadastrar')
    or public.pode_em_processos('processos_servicos_saida', 'cadastrar')
  );

drop policy if exists processos_servicos_update on public.processos_servicos;
create policy processos_servicos_update on public.processos_servicos for update to authenticated
  using (
    public.pode_em_processos('processos_servicos', 'editar')
    or public.pode_em_processos('processos_servicos', 'aprovar')
    or public.pode_em_processos('processos_servicos', 'excluir')
  )
  with check (
    public.pode_em_processos('processos_servicos', 'editar')
    or public.pode_em_processos('processos_servicos', 'aprovar')
    or public.pode_em_processos('processos_servicos', 'excluir')
  );

drop policy if exists processos_servicos_numeracao_select on public.processos_servicos_numeracao;
create policy processos_servicos_numeracao_select on public.processos_servicos_numeracao for select to authenticated
  using (public.pode_em_processos('processos_servicos', 'visualizar'));

drop policy if exists processos_servicos_historico_select on public.processos_servicos_historico;
create policy processos_servicos_historico_select on public.processos_servicos_historico for select to authenticated
  using (public.pode_em_processos('processos_servicos', 'visualizar'));

drop policy if exists processos_servicos_historico_insert on public.processos_servicos_historico;
create policy processos_servicos_historico_insert on public.processos_servicos_historico for insert to authenticated
  with check (
    public.pode_em_processos('processos_servicos', 'cadastrar')
    or public.pode_em_processos('processos_servicos', 'editar')
    or public.pode_em_processos('processos_servicos', 'aprovar')
    or public.pode_em_processos('processos_servicos', 'excluir')
    or public.pode_em_processos('processos_servicos_saida', 'cadastrar')
  );

grant select, insert, update on public.processos_servicos to authenticated;
grant select on public.processos_servicos_numeracao to authenticated;
grant select, insert on public.processos_servicos_historico to authenticated;
revoke delete on public.processos_servicos from authenticated;
revoke delete on public.processos_servicos_historico from authenticated;
revoke all on public.processos_servicos from anon;
revoke all on public.processos_servicos_numeracao from anon;
revoke all on public.processos_servicos_historico from anon;

-- ---------------------------------------------------------------------------
-- 6. Padrão dos dois módulos novos nos perfis
-- ---------------------------------------------------------------------------
-- Cópia do que o perfil já tem em 'processos_diarias' -- a subaba irmã, do
-- mesmo módulo -- e, para quem não a tem, de 'pagamentos'. NENHUMA permissão
-- existente é alterada: só entram linhas novas, para módulos novos.
insert into public.perfis_permissoes (
  perfil_id, modulo,
  pode_visualizar, pode_cadastrar, pode_editar, pode_excluir, pode_aprovar, pode_visualizar_valores
)
select
  pp.perfil_id,
  'processos_servicos',
  pp.pode_visualizar,
  pp.pode_cadastrar,
  pp.pode_editar,
  pp.pode_excluir,
  pp.pode_aprovar,
  false
from public.perfis_permissoes pp
where pp.modulo in ('processos_diarias', 'pagamentos')
  and not exists (
    select 1 from public.perfis_permissoes x
     where x.perfil_id = pp.perfil_id and x.modulo = 'processos_servicos'
  )
  -- 'processos_diarias' tem preferência quando o perfil tem as duas linhas.
  and (
    pp.modulo = 'processos_diarias'
    or not exists (
      select 1 from public.perfis_permissoes d
       where d.perfil_id = pp.perfil_id and d.modulo = 'processos_diarias'
    )
  );

-- Imprimir acompanha quem pode ver; duplicar acompanha quem pode criar.
insert into public.perfis_permissoes (
  perfil_id, modulo,
  pode_visualizar, pode_cadastrar, pode_editar, pode_excluir, pode_aprovar, pode_visualizar_valores
)
select
  pp.perfil_id,
  'processos_servicos_saida',
  pp.pode_visualizar,
  pp.pode_cadastrar,
  false, false, false, false
from public.perfis_permissoes pp
where pp.modulo = 'processos_servicos'
  and not exists (
    select 1 from public.perfis_permissoes x
     where x.perfil_id = pp.perfil_id and x.modulo = 'processos_servicos_saida'
  );

-- Perfis que não têm nenhuma das duas linhas de origem: só Administrador nasce
-- liberado.
insert into public.perfis_permissoes (
  perfil_id, modulo,
  pode_visualizar, pode_cadastrar, pode_editar, pode_excluir, pode_aprovar, pode_visualizar_valores
)
select
  p.id,
  modulo.nome,
  p.nome = 'Administrador',
  p.nome = 'Administrador',
  p.nome = 'Administrador' and modulo.nome = 'processos_servicos',
  p.nome = 'Administrador' and modulo.nome = 'processos_servicos',
  p.nome = 'Administrador' and modulo.nome = 'processos_servicos',
  false
from public.perfis_acesso p
cross join (values ('processos_servicos'), ('processos_servicos_saida')) as modulo(nome)
where not exists (
  select 1 from public.perfis_permissoes x
   where x.perfil_id = p.id and x.modulo = modulo.nome
);

comment on table public.processos_servicos is
  'Processo de serviços/materiais: UMA linha com as DUAS páginas do documento (Requisição de Material/Serviço e Liquidação/Solicitação de Pagamento). Documental, não financeiro — nada aqui debita conta, dá baixa em NF, altera saldo ou cria pagamento.';
comment on column public.processos_servicos.itens is
  'Itens do QUADRO DESCRITIVO da requisição, na ordem de impressão: [{quantidade, discriminacao}]. A numeração 01, 02, 03 é a posição na lista. SEM VALORES: a requisição não tem coluna de valor.';
comment on column public.processos_servicos.nota_id is
  'NF/processo financeiro de onde os valores foram COPIADOS. Consulta apenas: o vínculo não altera a nota, não dá baixa e não muda o valor em aberto dela.';
comment on table public.processos_servicos_numeracao is
  'Sequência do número de processo de serviços/materiais por ano. Número emitido nunca volta para a fila, nem quando o processo é cancelado.';
comment on table public.processos_servicos_historico is
  'Trilha própria de cada processo de serviços/materiais (criação, alteração, finalização, cancelamento, duplicação, impressão e vínculo de NF).';

commit;
