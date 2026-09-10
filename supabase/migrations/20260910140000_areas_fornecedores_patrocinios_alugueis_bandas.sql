-- ÁREAS ESPECÍFICAS DENTRO DE FORNECEDORES — Patrocínios, Aluguéis e Bandas.
--
-- ATENÇÃO: esta migration precisa ser rodada MANUALMENTE no SQL Editor do
-- Supabase (projeto usado pela aplicação). Nada nela roda sozinho no deploy.
-- Arquivo: supabase/migrations/20260910140000_areas_fornecedores_patrocinios_alugueis_bandas.sql
--
-- O QUE SÃO ESSAS ÁREAS (E O QUE ELAS NÃO SÃO)
--
-- Patrocínios, Aluguéis e Bandas NÃO são categorias nem tipo de fornecedor.
-- Nenhuma coluna "categoria" ou "tipo" é criada no cadastro do fornecedor: esta
-- migration não altera a tabela public.fornecedores em nenhum ponto, apenas
-- referencia o id dela.
--
-- Cada área é um REGISTRO OPERACIONAL próprio, com a sua estrutura e a sua
-- tabela, sempre APONTANDO para um fornecedor JÁ CADASTRADO pelo id. O mesmo
-- fornecedor pode ter dois patrocínios, um aluguel e três contratações de
-- banda ao mesmo tempo, e continua sendo UM cadastro só: nada aqui duplica
-- fornecedor, e nada aqui grava nome de fornecedor como texto.
--
-- "PAGO" E "SALDO" NÃO EXISTEM COMO COLUNA — DE PROPÓSITO
--
-- Nenhuma das tabelas criadas aqui tem coluna de valor pago. Quanto de um
-- registro já foi pago é a soma do que as BAIXAS abateram das NFs vinculadas a
-- ele (public.valores_em_aberto.valor_pago, escrito exclusivamente por
-- public.registrar_baixa_nota). Um segundo controle de valor pago, paralelo ao
-- das notas, divergiria do primeiro no primeiro estorno — e é justamente a
-- duplicidade que este sistema já pagou caro para não ter.
--
-- Enquanto o registro não tiver NF vinculada, Pago = 0 e Saldo = valor total.
--
-- NADA DE FINANCEIRO MUDA
--
-- Esta migration não escreve uma única linha em public.pagamentos_baixas,
-- public.valores_em_aberto, public.pagamentos, public.saldos_historico,
-- public.transferencias_contas, public.contas_bancarias ou qualquer coluna de
-- saldo, e não cria nenhuma lógica de baixa nova. A baixa continua sendo
-- exclusivamente a da aba de Baixas, por NF/processo. A conta selecionada
-- continua não sendo a conta debitada, e a baixa continua não debitando saldo.
--
-- O QUE ESTA MIGRATION ENTREGA
--
--   1. public.pode_em_area_fornecedor(area, acao) -> a permissão própria de
--      cada área, na mesma forma de public.pode_em_saldos.
--   2. public.fornecedor_patrocinios, public.fornecedor_alugueis e
--      public.fornecedor_bandas -> os registros operacionais, um por área.
--   3. public.fornecedor_patrocinio_notas, public.fornecedor_aluguel_notas e
--      public.fornecedor_banda_notas -> o vínculo com NF/processo JÁ EXISTENTE
--      do fornecedor. Nenhuma NF é criada aqui e o vínculo nunca é obrigatório.
--   4. RLS por área (visualizar / criar / editar / inativar), inclusive a
--      garantia de que quem só pode inativar não consegue editar valor.
--   5. Padrão dos módulos 'patrocinios', 'alugueis' e 'bandas' em
--      public.perfis_permissoes, copiado do módulo 'fornecedores' de cada
--      perfil: ninguém ganha nem perde acesso por causa desta migration.
--
-- EXCLUSÃO É LÓGICA: as tabelas não têm política de delete. Registro sai da
-- lista por `ativo = false`, e a linha continua no banco.
--
-- IDEMPOTENTE: pode ser rodada mais de uma vez sem efeito colateral. ADITIVA:
-- não apaga nem reescreve nenhum dado existente.

begin;

-- ---------------------------------------------------------------------------
-- 0. Validação da estrutura real ANTES de qualquer alteração
-- ---------------------------------------------------------------------------
-- Se algo não bater, a migration aborta aqui, antes do primeiro DDL.
do $$
declare
  item record;
  tipo_real text;
begin
  for item in
    select * from (values
      ('fornecedores'), ('valores_em_aberto'), ('secretarias'), ('usuarios'),
      ('auditoria_eventos'), ('perfis_acesso'), ('perfis_permissoes'),
      ('permissoes_efetivas')
    ) as t(nome)
  loop
    if to_regclass(format('public.%I', item.nome)) is null then
      raise exception 'Estrutura incompatível: public.% não existe. As áreas de Fornecedores dependem dela.', item.nome;
    end if;
  end loop;

  -- Colunas de que as áreas dependem, conferidas pela FAMÍLIA de tipo (e não
  -- pelo tipo exato) para não abortar em banco que use bigint no lugar de
  -- integer ou varchar no lugar de text.
  for item in
    select * from (values
      ('fornecedores', 'id', 'chave'),
      ('fornecedores', 'razao_social', 'texto'),
      ('valores_em_aberto', 'id', 'chave'),
      ('valores_em_aberto', 'fornecedor_id', 'chave'),
      ('valores_em_aberto', 'valor', 'numerico'),
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
      raise exception 'Estrutura incompatível: public.%.% não existe. As áreas de Fornecedores dependem dela.',
        item.tabela, item.coluna;
    end if;

    if not (
      (item.familia = 'numerico' and tipo_real in ('numeric', 'double precision', 'real', 'integer', 'bigint'))
      or (item.familia = 'texto' and tipo_real in ('text', 'character varying', 'character'))
      or (item.familia = 'chave' and tipo_real in ('integer', 'bigint', 'smallint', 'uuid', 'text', 'character varying'))
    ) then
      raise exception 'Tipo incompatível em public.%.%: as áreas de Fornecedores esperam % e encontraram %.',
        item.tabela, item.coluna, item.familia, tipo_real;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Lista fixa de módulos: acrescentar os três novos ANTES de qualquer seed
-- ---------------------------------------------------------------------------
-- A ORDEM AQUI IMPORTA (a mesma lição da migration de Baixas): bancos em que
-- "modulo" tem lista fixa recusariam o seed da seção 6 e a migration inteira
-- abortaria. A restrição é recriada como "(condição original) or modulo in
-- (...)": tudo que era aceito continua aceito, só os módulos novos entram.
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
         and pg_get_constraintdef(oid) not like '%''patrocinios''%'
    loop
      corpo := regexp_replace(restricao.definicao, '\s+NOT VALID$', '');
      corpo := regexp_replace(corpo, '^CHECK\s*', '');

      execute format('alter table %s drop constraint %I', tabela, restricao.conname);
      execute format(
        'alter table %s add constraint %I check ((%s) or modulo in (''patrocinios'', ''alugueis'', ''bandas''))',
        tabela, restricao.conname, corpo
      );
    end loop;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Permissão própria de cada área
-- ---------------------------------------------------------------------------
-- Mesma forma de public.pode_em_saldos e public.pode_em_certidoes. As quatro
-- ações da área, e o que cada uma governa:
--   visualizar -> ver a subaba e a listagem
--   cadastrar  -> criar registro
--   editar     -> alterar registro e vincular/desvincular NF
--   excluir    -> INATIVAR (exclusão lógica; nunca apaga a linha)
--
-- 'aprovar' não é usada por nenhuma das três áreas: a aprovação de pagamento
-- continua sendo assunto da Programação Diária, e nada aqui aprova nada.
create or replace function public.pode_em_area_fornecedor(p_area text, p_acao text)
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
     and pe.modulo = p_area
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

grant execute on function public.pode_em_area_fornecedor(text, text) to authenticated;

comment on function public.pode_em_area_fornecedor(text, text) is
  'Permissão efetiva do usuário logado em uma das áreas de Fornecedores (patrocinios, alugueis, bandas). Não altera nenhuma permissão existente.';

-- ---------------------------------------------------------------------------
-- 3. Quem só pode INATIVAR não pode editar
-- ---------------------------------------------------------------------------
-- A política de update abaixo aceita tanto quem tem 'editar' quanto quem tem
-- só 'excluir' (porque inativar é um update de `ativo`). Sem esta conferência,
-- quem só pode inativar conseguiria alterar valor ou situação no mesmo update.
-- A comparação é por jsonb: fora de `ativo` e dos campos de registro do
-- próprio ato, nada pode ter mudado.
create or replace function public.conferir_alteracao_area_fornecedor()
returns trigger
language plpgsql
as $$
declare
  area text := tg_argv[0];
  antes jsonb;
  depois jsonb;
begin
  -- Sem sessão de usuário (SQL Editor do Supabase, service role, esta própria
  -- migration): a RLS também não se aplica, e o gatilho não pode ser mais
  -- restritivo que ela.
  if auth.uid() is null then
    return new;
  end if;

  if public.pode_em_area_fornecedor(area, 'editar') then
    return new;
  end if;

  antes  := to_jsonb(old) - 'ativo' - 'inativado_em' - 'inativado_por' - 'atualizado_em' - 'atualizado_por';
  depois := to_jsonb(new) - 'ativo' - 'inativado_em' - 'inativado_por' - 'atualizado_em' - 'atualizado_por';

  if new.ativo is distinct from old.ativo
     and antes = depois
     and public.pode_em_area_fornecedor(area, 'excluir')
  then
    return new;
  end if;

  raise exception 'Sem permissão para editar este registro. Sua permissão nesta área permite apenas inativar ou reativar.';
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. As três áreas
-- ---------------------------------------------------------------------------
-- O DDL é montado com os tipos REAIS das chaves (fornecedores.id pode ser
-- integer, bigint ou uuid dependendo do banco; usuarios.id é uuid no banco em
-- uso). É o mesmo cuidado da migration de certidões.
--
-- Situação do registro (`situacao`) é o andamento dele — e NÃO tem relação com
-- a situação da NF nem com pagamento: programado ≠ pago, aprovado ≠ pago. Quem
-- diz quanto foi pago continua sendo a baixa da NF, e só ela.
do $$
declare
  tipo_fornecedor text;
  tipo_usuario text;
  tipo_secretaria text;
  tipo_nota text;
  comuns text;
  vinculo text;
begin
  select format_type(a.atttypid, a.atttypmod) into tipo_fornecedor
    from pg_attribute a
   where a.attrelid = to_regclass('public.fornecedores') and a.attname = 'id' and not a.attisdropped;
  select format_type(a.atttypid, a.atttypmod) into tipo_usuario
    from pg_attribute a
   where a.attrelid = to_regclass('public.usuarios') and a.attname = 'id' and not a.attisdropped;
  select format_type(a.atttypid, a.atttypmod) into tipo_secretaria
    from pg_attribute a
   where a.attrelid = to_regclass('public.secretarias') and a.attname = 'id' and not a.attisdropped;
  select format_type(a.atttypid, a.atttypmod) into tipo_nota
    from pg_attribute a
   where a.attrelid = to_regclass('public.valores_em_aberto') and a.attname = 'id' and not a.attisdropped;

  -- O tronco comum das três áreas. Não há coluna de valor pago aqui, e é
  -- proposital: Pago e Saldo são calculados a partir das baixas das NFs.
  comuns := format($comuns$
    id uuid primary key default gen_random_uuid(),
    -- O VÍNCULO É PELO ID. O fornecedor é sempre um cadastro que já existe.
    fornecedor_id %1$s not null references public.fornecedores (id) on delete restrict,
    secretaria_id %2$s references public.secretarias (id),
    valor numeric(14,2) not null default 0,
    observacoes text,
    situacao text not null default 'vigente',
    ativo boolean not null default true,
    inativado_em timestamptz,
    inativado_por %3$s references public.usuarios (id) on delete set null,
    criado_em timestamptz not null default now(),
    criado_por %3$s references public.usuarios (id) on delete set null,
    atualizado_em timestamptz not null default now(),
    atualizado_por %3$s references public.usuarios (id) on delete set null
  $comuns$, tipo_fornecedor, tipo_secretaria, tipo_usuario);

  -- PATROCÍNIOS
  if to_regclass('public.fornecedor_patrocinios') is null then
    execute format($ddl$
      create table public.fornecedor_patrocinios (
        %1$s,
        -- "Patrocínio Festa de São José"
        nome text not null,
        -- Evento/Finalidade do patrocínio
        evento text
      )
    $ddl$, comuns);
  end if;

  -- ALUGUÉIS
  if to_regclass('public.fornecedor_alugueis') is null then
    execute format($ddl$
      create table public.fornecedor_alugueis (
        %1$s,
        -- "Aluguel de imóvel — Secretaria de Saúde"
        descricao text not null,
        -- O que está alugado NESTE aluguel (imóvel, veículo, equipamento,
        -- estrutura, outro). É texto descritivo do registro, escrito à mão:
        -- não é catálogo, não é categoria global e não se repete em lugar
        -- nenhum do cadastro do fornecedor.
        objeto text,
        -- Preenchido só quando há recorrência mensal; `valor` continua sendo o
        -- valor do registro.
        valor_mensal numeric(14,2),
        data_inicio date,
        data_fim date
      )
    $ddl$, comuns);
  end if;

  -- BANDAS
  if to_regclass('public.fornecedor_bandas') is null then
    execute format($ddl$
      create table public.fornecedor_bandas (
        %1$s,
        -- Nome artístico, que NÃO precisa ser igual à razão social do
        -- fornecedor (empresa, produtora, empresário ou representante). Um
        -- mesmo fornecedor tem quantas bandas/artistas forem contratados, cada
        -- contratação com registro próprio.
        banda text not null,
        evento text,
        data_apresentacao date
      )
    $ddl$, comuns);
  end if;

  -- Vínculo com NF/processo JÁ EXISTENTE. Nenhuma NF é criada por aqui, e o
  -- vínculo não é obrigatório em nenhum momento. Apagar o vínculo não devolve
  -- nem retira um centavo: a baixa mora na NF.
  foreach vinculo in array array[
    'fornecedor_patrocinio_notas:fornecedor_patrocinios:patrocinio_id',
    'fornecedor_aluguel_notas:fornecedor_alugueis:aluguel_id',
    'fornecedor_banda_notas:fornecedor_bandas:banda_id'
  ]
  loop
    if to_regclass(format('public.%I', split_part(vinculo, ':', 1))) is null then
      execute format($ddl$
        create table public.%1$I (
          id uuid primary key default gen_random_uuid(),
          %3$I uuid not null references public.%2$I (id) on delete cascade,
          valor_em_aberto_id %4$s not null references public.valores_em_aberto (id) on delete cascade,
          criado_em timestamptz not null default now(),
          criado_por %5$s references public.usuarios (id) on delete set null,
          unique (%3$I, valor_em_aberto_id)
        )
      $ddl$,
        split_part(vinculo, ':', 1), split_part(vinculo, ':', 2), split_part(vinculo, ':', 3),
        tipo_nota, tipo_usuario);
    end if;
  end loop;
end $$;

-- Colunas acrescentadas caso a tabela já exista parcialmente no banco.
alter table public.fornecedor_patrocinios add column if not exists evento text;
alter table public.fornecedor_patrocinios add column if not exists observacoes text;
alter table public.fornecedor_alugueis add column if not exists objeto text;
alter table public.fornecedor_alugueis add column if not exists valor_mensal numeric(14,2);
alter table public.fornecedor_alugueis add column if not exists data_inicio date;
alter table public.fornecedor_alugueis add column if not exists data_fim date;
alter table public.fornecedor_alugueis add column if not exists observacoes text;
alter table public.fornecedor_bandas add column if not exists evento text;
alter table public.fornecedor_bandas add column if not exists data_apresentacao date;
alter table public.fornecedor_bandas add column if not exists observacoes text;

-- Situação: as cinco do andamento do registro. Nenhuma delas significa "pago"
-- — quem paga é a baixa da NF.
do $$
declare
  tabela text;
begin
  foreach tabela in array array['fornecedor_patrocinios', 'fornecedor_alugueis', 'fornecedor_bandas']
  loop
    execute format(
      'alter table public.%1$I drop constraint if exists %1$s_situacao_check',
      tabela
    );
    execute format($sql$
      alter table public.%1$I add constraint %1$s_situacao_check
        check (situacao in ('previsto', 'vigente', 'concluido', 'suspenso', 'cancelado'))
    $sql$, tabela);
  end loop;
end $$;

-- Índices: a listagem sempre busca por fornecedor e por secretaria.
create index if not exists fornecedor_patrocinios_fornecedor_idx on public.fornecedor_patrocinios (fornecedor_id);
create index if not exists fornecedor_patrocinios_secretaria_idx on public.fornecedor_patrocinios (secretaria_id);
create index if not exists fornecedor_alugueis_fornecedor_idx on public.fornecedor_alugueis (fornecedor_id);
create index if not exists fornecedor_alugueis_secretaria_idx on public.fornecedor_alugueis (secretaria_id);
create index if not exists fornecedor_bandas_fornecedor_idx on public.fornecedor_bandas (fornecedor_id);
create index if not exists fornecedor_bandas_secretaria_idx on public.fornecedor_bandas (secretaria_id);
create index if not exists fornecedor_patrocinio_notas_nota_idx on public.fornecedor_patrocinio_notas (valor_em_aberto_id);
create index if not exists fornecedor_aluguel_notas_nota_idx on public.fornecedor_aluguel_notas (valor_em_aberto_id);
create index if not exists fornecedor_banda_notas_nota_idx on public.fornecedor_banda_notas (valor_em_aberto_id);

-- ---------------------------------------------------------------------------
-- 5. RLS de cada área
-- ---------------------------------------------------------------------------
-- Sem política de delete em nenhuma das seis tabelas de registro: exclusão é
-- lógica (`ativo = false`) e a linha fica no banco para sempre.
--
-- O vínculo com a NF é editar o registro: quem pode editar vincula e
-- desvincula. Desvincular apaga a linha do vínculo, e só ela — a NF, o valor
-- em aberto e as baixas dela ficam intactos, por isso o vínculo (e só ele) tem
-- política de delete.
do $$
declare
  item record;
begin
  for item in
    select * from (values
      ('fornecedor_patrocinios',      'patrocinios', 'registro'),
      ('fornecedor_alugueis',         'alugueis',    'registro'),
      ('fornecedor_bandas',           'bandas',      'registro'),
      ('fornecedor_patrocinio_notas', 'patrocinios', 'vinculo'),
      ('fornecedor_aluguel_notas',    'alugueis',    'vinculo'),
      ('fornecedor_banda_notas',      'bandas',      'vinculo')
    ) as t(tabela, area, especie)
  loop
    execute format('alter table public.%I enable row level security', item.tabela);

    execute format('drop policy if exists %I on public.%I', item.tabela || '_select', item.tabela);
    execute format($sql$
      create policy %1$I on public.%2$I for select to authenticated
        using (public.pode_em_area_fornecedor(%3$L, 'visualizar'))
    $sql$, item.tabela || '_select', item.tabela, item.area);

    execute format('drop policy if exists %I on public.%I', item.tabela || '_insert', item.tabela);
    execute format('drop policy if exists %I on public.%I', item.tabela || '_update', item.tabela);
    execute format('drop policy if exists %I on public.%I', item.tabela || '_delete', item.tabela);
    execute format('drop trigger if exists %I on public.%I', item.tabela || '_alteracao', item.tabela);

    if item.especie = 'registro' then
      execute format($sql$
        create policy %1$I on public.%2$I for insert to authenticated
          with check (public.pode_em_area_fornecedor(%3$L, 'cadastrar'))
      $sql$, item.tabela || '_insert', item.tabela, item.area);

      -- Editar OU inativar. Qual das duas o update é de fato fica com o
      -- gatilho da seção 3, que confere o que mudou linha a linha.
      execute format($sql$
        create policy %1$I on public.%2$I for update to authenticated
          using (public.pode_em_area_fornecedor(%3$L, 'editar') or public.pode_em_area_fornecedor(%3$L, 'excluir'))
          with check (public.pode_em_area_fornecedor(%3$L, 'editar') or public.pode_em_area_fornecedor(%3$L, 'excluir'))
      $sql$, item.tabela || '_update', item.tabela, item.area);

      execute format($sql$
        create trigger %1$I before update on public.%2$I
          for each row execute function public.conferir_alteracao_area_fornecedor(%3$L)
      $sql$, item.tabela || '_alteracao', item.tabela, item.area);
    else
      execute format($sql$
        create policy %1$I on public.%2$I for insert to authenticated
          with check (public.pode_em_area_fornecedor(%3$L, 'editar'))
      $sql$, item.tabela || '_insert', item.tabela, item.area);

      execute format($sql$
        create policy %1$I on public.%2$I for delete to authenticated
          using (public.pode_em_area_fornecedor(%3$L, 'editar'))
      $sql$, item.tabela || '_delete', item.tabela, item.area);
    end if;

    execute format('grant select, insert, update on public.%I to authenticated', item.tabela);
    if item.especie = 'vinculo' then
      execute format('grant delete on public.%I to authenticated', item.tabela);
    else
      execute format('revoke delete on public.%I from authenticated', item.tabela);
    end if;
    execute format('revoke all on public.%I from anon', item.tabela);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Padrão dos três módulos nos perfis
-- ---------------------------------------------------------------------------
-- Cópia do que o perfil já tem em 'fornecedores': quem enxerga Fornecedores
-- enxerga as áreas, e quem não enxerga continua sem enxergar. NENHUMA
-- permissão existente é alterada — só linhas novas, para módulos novos.
insert into public.perfis_permissoes (
  perfil_id, modulo,
  pode_visualizar, pode_cadastrar, pode_editar, pode_excluir, pode_aprovar, pode_visualizar_valores
)
select
  pp.perfil_id,
  area.modulo,
  pp.pode_visualizar,
  pp.pode_cadastrar,
  pp.pode_editar,
  pp.pode_excluir,
  false,
  false
from public.perfis_permissoes pp
cross join (values ('patrocinios'), ('alugueis'), ('bandas')) as area(modulo)
where pp.modulo = 'fornecedores'
  and not exists (
    select 1 from public.perfis_permissoes x
     where x.perfil_id = pp.perfil_id and x.modulo = area.modulo
  );

-- Perfis que não têm nem linha de 'fornecedores': só Administrador nasce liberado.
insert into public.perfis_permissoes (
  perfil_id, modulo,
  pode_visualizar, pode_cadastrar, pode_editar, pode_excluir, pode_aprovar, pode_visualizar_valores
)
select
  p.id,
  area.modulo,
  p.nome = 'Administrador',
  p.nome = 'Administrador',
  p.nome = 'Administrador',
  p.nome = 'Administrador',
  false,
  false
from public.perfis_acesso p
cross join (values ('patrocinios'), ('alugueis'), ('bandas')) as area(modulo)
where not exists (
  select 1 from public.perfis_permissoes x
   where x.perfil_id = p.id and x.modulo = area.modulo
);

comment on table public.fornecedor_patrocinios is
  'Patrocínios: registro operacional ligado a um fornecedor já cadastrado. Não é categoria de fornecedor e não guarda valor pago (Pago e Saldo vêm das baixas das NFs vinculadas).';
comment on table public.fornecedor_alugueis is
  'Aluguéis: registro operacional ligado a um fornecedor já cadastrado. Não é categoria de fornecedor e não guarda valor pago (Pago e Saldo vêm das baixas das NFs vinculadas).';
comment on table public.fornecedor_bandas is
  'Contratações de banda/artista: registro operacional ligado a um fornecedor já cadastrado. Não é categoria de fornecedor e não guarda valor pago (Pago e Saldo vêm das baixas das NFs vinculadas).';

commit;
