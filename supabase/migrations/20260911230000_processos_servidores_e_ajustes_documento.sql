-- MÓDULO PROCESSOS — CADASTRO DE SERVIDORES E AJUSTES NOS DOCUMENTOS.
--
-- ATENÇÃO: esta migration precisa ser rodada MANUALMENTE no SQL Editor do
-- Supabase (projeto usado pela aplicação). Nada nela roda sozinho no deploy.
-- Arquivo: supabase/migrations/20260911230000_processos_servidores_e_ajustes_documento.sql
--
-- ---------------------------------------------------------------------------
-- O QUE ELA FAZ
-- ---------------------------------------------------------------------------
--   1. public.processos_servidores — o cadastro dos SERVIDORES do município
--      (efetivos, comissionados, secretários e agentes políticos). É um cadastro
--      PRÓPRIO, separado de public.fornecedores: servidor não é fornecedor, e
--      nenhum dos dois cadastros escreve no outro.
--   2. o módulo de permissão PRÓPRIO 'processos_servidores' (visualizar, criar,
--      editar e inativar), acompanhando quem já usa Processos · Diárias.
--   3. CPF único comparando SÓ OS DÍGITOS: o índice ignora ponto, traço e
--      espaço, então "123.456.789-00" e "12345678900" são o mesmo CPF.
--   4. colunas ADITIVAS em public.processos_diarias para o vínculo interno com o
--      servidor beneficiário e para o SIGNATÁRIO do documento (responsável pela
--      secretaria) — nome, CPF e cargo de quem assinou ficam no processo.
--   5. remove a restrição public.processos_diarias_transporte_check: o campo
--      "Transporte" não existe no modelo oficial da prefeitura e sai do sistema.
--      AS COLUNAS transporte e transporte_outro NÃO SÃO REMOVIDAS — elas ficam
--      onde estão, com o que já tiverem, e o sistema simplesmente para de
--      escrevê-las. Nenhum registro existente é quebrado ou reescrito.
--
-- ---------------------------------------------------------------------------
-- ADITIVA, E SÓ NO MÓDULO PROCESSOS
-- ---------------------------------------------------------------------------
-- Só há `create table if not exists`, `add column if not exists`,
-- `create policy` e `drop constraint`. NENHUMA coluna é removida ou renomeada,
-- NENHUM dado existente é reescrito e NENHUMA permissão existente é alterada.
-- Rodar duas vezes é inofensivo.
--
-- E, como todo o módulo, isto é PAPEL: nada aqui debita conta, dá baixa em NF,
-- altera saldo, marca fornecedor como pago, cria pagamento ou toca na
-- Programação Diária. Esta migration não escreve, não altera e não referencia
-- public.pagamentos, public.pagamentos_baixas, public.valores_em_aberto,
-- public.saldos_historico, public.contas_bancarias, public.transferencias_contas
-- nem public.programacoes_pagamento. E NÃO TOCA em public.fornecedores: o
-- cadastro de fornecedores continua exatamente como está.

begin;

do $$
begin
  if to_regclass('public.processos_diarias') is null then
    raise exception
      'public.processos_diarias não existe: rode antes a migration 20260911160000_processos_modulo_diarias.sql.';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. Lista fixa de módulos: acrescentar o módulo novo ANTES de qualquer seed
-- ---------------------------------------------------------------------------
-- Mesma lição das migrations anteriores do módulo: em bancos onde "modulo" tem
-- lista fixa, o seed da seção 6 seria recusado e a migration inteira abortaria.
-- A restrição é recriada como "(condição original) or modulo in (...)": tudo o
-- que era aceito continua aceito.
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
         and pg_get_constraintdef(oid) like '%''processos_diarias''%'
         and pg_get_constraintdef(oid) not like '%''processos_servidores''%'
    loop
      corpo := regexp_replace(restricao.definicao, '\s+NOT VALID$', '');
      corpo := regexp_replace(corpo, '^CHECK\s*', '');

      execute format('alter table %s drop constraint %I', tabela, restricao.conname);
      execute format(
        'alter table %s add constraint %I check ((%s) or modulo in (''processos_servidores''))',
        tabela, restricao.conname, corpo
      );
    end loop;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. O cadastro de SERVIDORES
-- ---------------------------------------------------------------------------
-- ⚠️ ESTE CADASTRO NÃO É O DE FORNECEDORES, e não se mistura com ele. Fornecedor
-- é quem vende para o município; servidor é quem trabalha no município. São duas
-- listas distintas, e nenhuma escreve na outra.
--
-- O mesmo servidor pode aparecer nos processos em DOIS papéis: como BENEFICIÁRIO
-- da diária (quem viaja) e como SIGNATÁRIO do documento (quem assina). O papel é
-- do processo, não do cadastro — aqui a pessoa é cadastrada uma vez só.
--
-- A exclusão é LÓGICA: servidor sai de cena passando a 'inativo'. A linha nunca
-- é apagada, porque processos antigos apontam para ela.
do $$
declare
  tipo_secretaria text;
  tipo_usuario text;
begin
  select format_type(a.atttypid, a.atttypmod) into tipo_secretaria
    from pg_attribute a
   where a.attrelid = to_regclass('public.secretarias') and a.attname = 'id' and not a.attisdropped;
  select format_type(a.atttypid, a.atttypmod) into tipo_usuario
    from pg_attribute a
   where a.attrelid = to_regclass('public.usuarios') and a.attname = 'id' and not a.attisdropped;

  if to_regclass('public.processos_servidores') is null then
    execute format($ddl$
      create table public.processos_servidores (
        id uuid primary key default gen_random_uuid(),

        -- Identificação
        nome text not null,
        cpf text not null,
        endereco text,
        matricula text,
        cargo text,
        -- A secretaria é uma das JÁ CADASTRADAS no sistema. O módulo não cria
        -- nenhuma segunda lista de secretarias.
        secretaria_id %1$s references public.secretarias (id),
        lotacao text,

        -- A categoria para fins de DIÁRIA: é a coluna da Tabela de Diárias, e é
        -- ela que o formulário da diária sugere para o cálculo automático do
        -- valor. Sugestão de preenchimento de papel — não paga nada.
        categoria_diaria text,

        telefone text,
        email text,

        -- Dados bancários do servidor, para o documento da diária.
        banco text,
        agencia text,
        conta text,
        pix text,
        pix_titular text,

        -- Situação: ativo ou inativo. Inativar é a exclusão do cadastro.
        situacao text not null default 'ativo',
        inativado_em timestamptz,
        inativado_por %2$s references public.usuarios (id) on delete set null,
        motivo_inativacao text,

        criado_em timestamptz not null default now(),
        criado_por %2$s references public.usuarios (id) on delete set null,
        atualizado_em timestamptz not null default now(),
        atualizado_por %2$s references public.usuarios (id) on delete set null
      )
    $ddl$, tipo_secretaria, tipo_usuario);
  end if;
end $$;

alter table public.processos_servidores
  add column if not exists endereco text,
  add column if not exists matricula text,
  add column if not exists cargo text,
  add column if not exists lotacao text,
  add column if not exists categoria_diaria text,
  add column if not exists telefone text,
  add column if not exists email text,
  add column if not exists banco text,
  add column if not exists agencia text,
  add column if not exists conta text,
  add column if not exists pix text,
  add column if not exists pix_titular text,
  add column if not exists motivo_inativacao text;

alter table public.processos_servidores drop constraint if exists processos_servidores_situacao_check;
alter table public.processos_servidores add constraint processos_servidores_situacao_check
  check (situacao in ('ativo', 'inativo'));

-- As cinco categorias do documento oficial, as MESMAS colunas da Tabela de
-- Diárias — é o que permite o cálculo automático do valor a partir do cadastro.
alter table public.processos_servidores drop constraint if exists processos_servidores_categoria_check;
alter table public.processos_servidores add constraint processos_servidores_categoria_check
  check (categoria_diaria is null or categoria_diaria in
    ('prefeito_vice', 'secretarios', 'auditor_procurador', 'comissionados', 'outros_agentes'));

-- ---------------------------------------------------------------------------
-- 3. CPF único COMPARANDO SÓ OS DÍGITOS
-- ---------------------------------------------------------------------------
-- A pontuação não pode criar um segundo cadastro da mesma pessoa: o índice é
-- sobre os dígitos, então "123.456.789-00", "12345678900" e "123 456 789 00"
-- colidem entre si. Vale também para servidor INATIVO — reativar o cadastro
-- existente é o caminho, e não criar um novo com o mesmo CPF.
--
-- A tela avisa antes, dizendo QUEM já usa aquele CPF. Este índice é a trava
-- final, a que vale mesmo com duas pessoas cadastrando ao mesmo tempo.
create unique index if not exists processos_servidores_cpf_digitos_unico
  on public.processos_servidores ((regexp_replace(cpf, '[^0-9]', '', 'g')))
  where cpf is not null and regexp_replace(cpf, '[^0-9]', '', 'g') <> '';

create index if not exists processos_servidores_nome on public.processos_servidores (nome);
create index if not exists processos_servidores_secretaria on public.processos_servidores (secretaria_id);
create index if not exists processos_servidores_situacao on public.processos_servidores (situacao);

-- ---------------------------------------------------------------------------
-- 4. O processo aponta para o servidor — beneficiário e signatário
-- ---------------------------------------------------------------------------
-- `beneficiario_servidor_id` é só um PONTEIRO para o cadastro, como
-- `fornecedor_id` já era: o documento guarda o próprio texto, e editar um campo
-- no documento NÃO altera o cadastro do servidor. Preencher à mão, sem vínculo,
-- continua igualmente válido.
--
-- O SIGNATÁRIO é o item 12: quem assina como responsável pela secretaria. O
-- nome, o CPF e o cargo ficam GRAVADOS NO PROCESSO. Como o conteúdo de processo
-- finalizado não pode mais ser alterado (gatilho
-- public.conferir_alteracao_processo_diaria), mudar o cadastro do servidor
-- depois NÃO altera documento antigo: ele continua imprimindo quem assinou.
alter table public.processos_diarias
  add column if not exists beneficiario_servidor_id uuid,
  add column if not exists assinante_secretaria_servidor_id uuid,
  add column if not exists assinante_secretaria_nome text,
  add column if not exists assinante_secretaria_cpf text,
  add column if not exists assinante_secretaria_cargo text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.processos_diarias'::regclass
       and conname = 'processos_diarias_beneficiario_servidor_fkey'
  ) then
    execute 'alter table public.processos_diarias
               add constraint processos_diarias_beneficiario_servidor_fkey
               foreign key (beneficiario_servidor_id)
               references public.processos_servidores (id) on delete set null';
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.processos_diarias'::regclass
       and conname = 'processos_diarias_assinante_secretaria_fkey'
  ) then
    execute 'alter table public.processos_diarias
               add constraint processos_diarias_assinante_secretaria_fkey
               foreign key (assinante_secretaria_servidor_id)
               references public.processos_servidores (id) on delete set null';
  end if;
end $$;

create index if not exists processos_diarias_beneficiario_servidor
  on public.processos_diarias (beneficiario_servidor_id);

-- ---------------------------------------------------------------------------
-- 5. O campo "Transporte" sai — a restrição vai embora, as colunas ficam
-- ---------------------------------------------------------------------------
-- O meio de transporte não existe no modelo oficial da prefeitura: entrou por
-- engano e sai do formulário e do documento impresso.
--
-- ⚠️ AS COLUNAS NÃO SÃO REMOVIDAS. `drop column` apagaria o que processos
-- antigos já gravaram; aqui só a restrição de valores é retirada, e o sistema
-- para de escrever nas duas colunas. Registro existente continua íntegro e
-- continua legível.
alter table public.processos_diarias drop constraint if exists processos_diarias_transporte_check;

comment on column public.processos_diarias.transporte is
  'DESATIVADO: o campo Transporte não existe no modelo oficial e saiu do formulário e do documento. A coluna é preservada com o histórico já gravado; o sistema não escreve mais nela.';
comment on column public.processos_diarias.transporte_outro is
  'DESATIVADO junto com transporte. Coluna preservada só para não perder o que já foi gravado.';

-- ---------------------------------------------------------------------------
-- 6. RLS do cadastro de servidores
-- ---------------------------------------------------------------------------
-- Todas as ações passam pelo módulo PRÓPRIO 'processos_servidores': ver, criar,
-- editar e inativar têm cada uma a sua permissão.
--
-- Não há política de DELETE: servidor não é apagado, é inativado. É essa
-- ausência que garante que processo antigo nunca perca a referência.
alter table public.processos_servidores enable row level security;

drop policy if exists "processos_servidores_select" on public.processos_servidores;
create policy "processos_servidores_select"
  on public.processos_servidores
  for select to authenticated
  using (public.pode_em_processos('processos_servidores', 'visualizar'));

drop policy if exists "processos_servidores_insert" on public.processos_servidores;
create policy "processos_servidores_insert"
  on public.processos_servidores
  for insert to authenticated
  with check (public.pode_em_processos('processos_servidores', 'cadastrar'));

-- Editar e inativar são o mesmo update; cada um exige a sua permissão, e o
-- gatilho abaixo separa os dois casos.
drop policy if exists "processos_servidores_update" on public.processos_servidores;
create policy "processos_servidores_update"
  on public.processos_servidores
  for update to authenticated
  using (
    public.pode_em_processos('processos_servidores', 'editar')
    or public.pode_em_processos('processos_servidores', 'excluir')
  )
  with check (
    public.pode_em_processos('processos_servidores', 'editar')
    or public.pode_em_processos('processos_servidores', 'excluir')
  );

grant select, insert, update on public.processos_servidores to authenticated;
revoke delete on public.processos_servidores from authenticated;
revoke all on public.processos_servidores from anon;

-- ---------------------------------------------------------------------------
-- 6b. Inativar é uma permissão, editar é outra
-- ---------------------------------------------------------------------------
-- Mesma separação que o módulo já usa nos processos: quem pode editar o cadastro
-- não passa a poder tirá-lo de circulação, e quem pode inativar não precisa de
-- permissão de edição para fazê-lo.
create or replace function public.conferir_alteracao_servidor_processos()
returns trigger
language plpgsql
as $$
declare
  antes jsonb;
  depois jsonb;
  controle text[] := array[
    'situacao', 'inativado_em', 'inativado_por', 'motivo_inativacao',
    'atualizado_em', 'atualizado_por'
  ];
  campo text;
begin
  -- Sem sessão de usuário (SQL Editor, service role, esta própria migration):
  -- a RLS também não se aplica, e o gatilho não pode ser mais restritivo.
  if auth.uid() is null then
    return new;
  end if;

  if new.situacao is distinct from old.situacao
     and not public.pode_em_processos('processos_servidores', 'excluir') then
    raise exception 'Sem permissão para inativar ou reativar servidores.';
  end if;

  antes := to_jsonb(old);
  depois := to_jsonb(new);
  foreach campo in array controle loop
    antes := antes - campo;
    depois := depois - campo;
  end loop;

  if antes is distinct from depois
     and not public.pode_em_processos('processos_servidores', 'editar') then
    raise exception 'Sem permissão para editar o cadastro de servidores.';
  end if;

  return new;
end;
$$;

drop trigger if exists conferir_alteracao_servidor_processos on public.processos_servidores;
create trigger conferir_alteracao_servidor_processos
  before update on public.processos_servidores
  for each row execute function public.conferir_alteracao_servidor_processos();

-- ---------------------------------------------------------------------------
-- 7. Padrão do módulo novo nos perfis
-- ---------------------------------------------------------------------------
-- O cadastro de servidores é trabalho de quem já trabalha em Processos ·
-- Diárias: quem vê, cria, edita e cancela processo passa a ver, criar, editar e
-- inativar servidor. Nenhuma permissão existente é alterada — só entram linhas
-- novas, e perfil sem Processos continua sem Processos.
insert into public.perfis_permissoes (
  perfil_id, modulo,
  pode_visualizar, pode_cadastrar, pode_editar, pode_excluir, pode_aprovar, pode_visualizar_valores
)
select
  pp.perfil_id,
  'processos_servidores',
  pp.pode_visualizar,
  pp.pode_cadastrar,
  pp.pode_editar,
  pp.pode_excluir,
  false, false
from public.perfis_permissoes pp
where pp.modulo = 'processos_diarias'
  and not exists (
    select 1 from public.perfis_permissoes x
     where x.perfil_id = pp.perfil_id and x.modulo = 'processos_servidores'
  );

insert into public.perfis_permissoes (
  perfil_id, modulo,
  pode_visualizar, pode_cadastrar, pode_editar, pode_excluir, pode_aprovar, pode_visualizar_valores
)
select
  p.id, 'processos_servidores',
  p.nome = 'Administrador', p.nome = 'Administrador', p.nome = 'Administrador',
  p.nome = 'Administrador', false, false
from public.perfis_acesso p
where not exists (
  select 1 from public.perfis_permissoes x
   where x.perfil_id = p.id and x.modulo = 'processos_servidores'
);

comment on table public.processos_servidores is
  'Cadastro dos SERVIDORES do município (efetivos, comissionados, secretários e agentes políticos), usados nos processos como beneficiário da diária e como signatário dos documentos. NÃO é o cadastro de fornecedores e não se mistura com ele. Documental: não debita conta, não dá baixa em NF, não altera saldo e não cria pagamento.';
comment on column public.processos_servidores.cpf is
  'CPF do servidor. Único comparando SÓ OS DÍGITOS (índice processos_servidores_cpf_digitos_unico): a pontuação não cria um segundo cadastro da mesma pessoa.';
comment on column public.processos_servidores.categoria_diaria is
  'Categoria para fins de diária — a coluna da Tabela de Diárias. Alimenta o cálculo automático do valor no formulário da diária.';
comment on column public.processos_servidores.situacao is
  'ativo ou inativo. A exclusão é LÓGICA: a linha nunca é apagada, porque processos antigos apontam para ela.';
comment on column public.processos_diarias.beneficiario_servidor_id is
  'Vínculo interno com public.processos_servidores quando o beneficiário veio do cadastro. Só um ponteiro: editar o documento não altera o cadastro.';
comment on column public.processos_diarias.assinante_secretaria_nome is
  'Quem assinou como responsável pela secretaria, GRAVADO NO PROCESSO. Processo finalizado não é mais alterado, então mudar o cadastro depois não altera este documento.';

commit;
