-- MÓDULO PROCESSOS — SECRETARIAS SOLICITANTES, CADASTRO DE BANCOS E A MATRÍCULA
-- SAINDO DE CENA.
--
-- ATENÇÃO: esta migration precisa ser rodada MANUALMENTE no SQL Editor do
-- Supabase (projeto usado pela aplicação). Nada nela roda sozinho no deploy.
-- Arquivo: supabase/migrations/20260911240000_processos_solicitantes_e_bancos.sql
--
-- ---------------------------------------------------------------------------
-- O QUE ELA FAZ
-- ---------------------------------------------------------------------------
--   1. public.processos_secretarias_solicitantes — o cadastro PRÓPRIO das
--      SECRETARIAS SOLICITANTES do módulo Processos: nome oficial, nome curto,
--      secretário(a) responsável, CPF, cargo e situação.
--      ⚠️ ELE NÃO É, NÃO ALTERA E NÃO SUBSTITUI public.secretarias. Quem
--      REQUISITA a diária quase nunca é quem PAGA: o cadastro de secretarias do
--      MÓDULO FINANCEIRO continua existindo exatamente como está, servindo
--      contas bancárias, fornecedores, Saldos, Pagamentos e relatórios. Os dois
--      passam a coexistir, cada um com a sua finalidade.
--   2. public.processos_bancos — o cadastro de BANCOS, com NÚMERO (001, 104,
--      237...) e nome, para o documento sair "001 — Banco do Brasil" como no
--      modelo oficial. Já vem semeado com os dez bancos mais usados, e novos
--      entram pela tela, sem precisar de deploy.
--   3. colunas ADITIVAS em public.processos_diarias: `solicitante_id` (o
--      ponteiro para a solicitante) e os quatro campos CONGELADOS do documento
--      — nome oficial, secretário, CPF e cargo de quem requisitou. Mais
--      `banco_codigo`, o número do banco gravado junto com o nome.
--   4. colunas ADITIVAS em public.processos_servidores: `solicitante_id` e
--      `banco_codigo`, pelos mesmos motivos.
--   5. a MATRÍCULA sai do sistema. ⚠️ AS COLUNAS NÃO SÃO REMOVIDAS —
--      public.processos_servidores.matricula e
--      public.processos_diarias.beneficiario_matricula ficam onde estão, com o
--      que já tiverem, e o sistema simplesmente para de lê-las e de escrevê-las.
--      Nenhum registro existente é quebrado ou reescrito.
--
-- ---------------------------------------------------------------------------
-- ADITIVA, E SÓ NO MÓDULO PROCESSOS
-- ---------------------------------------------------------------------------
-- Só há `create table if not exists`, `add column if not exists`,
-- `create index if not exists`, `create policy` e `insert ... where not exists`.
-- NENHUMA coluna é removida ou renomeada, NENHUM dado existente é reescrito e
-- NENHUMA permissão existente é alterada. Rodar duas vezes é inofensivo.
--
-- E, como todo o módulo, isto é PAPEL: nada aqui debita conta, dá baixa em NF,
-- altera saldo, marca fornecedor como pago, cria pagamento ou toca na
-- Programação Diária. Esta migration não escreve, não altera e não referencia
-- public.pagamentos, public.pagamentos_baixas, public.valores_em_aberto,
-- public.saldos_historico, public.contas_bancarias, public.transferencias_contas
-- nem public.programacoes_pagamento. E NÃO TOCA em public.secretarias nem em
-- public.fornecedores: os dois cadastros do módulo financeiro continuam
-- exatamente como estão. public.secretarias é apenas LIDA, uma única vez, para
-- semear o cadastro novo com os nomes que a prefeitura já digitou.

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
-- 1. O cadastro das SECRETARIAS SOLICITANTES
-- ---------------------------------------------------------------------------
-- ⚠️ ESTE CADASTRO NÃO É public.secretarias. Ele é do módulo Processos e existe
-- porque QUEM REQUISITA NÃO É QUEM PAGA: a Secretaria Municipal de Educação
-- requisita a diária, e o pagamento sai por onde a Tesouraria determinar. O
-- cadastro financeiro segue intocado; este é documental.
--
-- O SECRETÁRIO RESPONSÁVEL mora aqui para que escolher a secretaria no processo
-- já traga nome oficial, secretário, CPF e cargo prontos. Os quatro são COPIADOS
-- para dentro do processo (seção 3): é o congelamento — trocar o secretário aqui
-- amanhã não reescreve o documento emitido hoje.
--
-- A exclusão é LÓGICA: a secretaria sai de cena passando a 'inativo'. A linha
-- nunca é apagada, porque processos antigos apontam para ela.
do $$
declare
  tipo_usuario text;
begin
  select format_type(a.atttypid, a.atttypmod) into tipo_usuario
    from pg_attribute a
   where a.attrelid = to_regclass('public.usuarios') and a.attname = 'id' and not a.attisdropped;

  if to_regclass('public.processos_secretarias_solicitantes') is null then
    execute format($ddl$
      create table public.processos_secretarias_solicitantes (
        id uuid primary key default gen_random_uuid(),

        -- "Secretaria Municipal de Educação": o nome que sai IMPRESSO.
        nome text not null,
        -- "Educação": o apelido das listas e dos filtros da tela.
        nome_curto text,

        -- Quem responde pela secretaria hoje. Vai COPIADO para o processo.
        secretario text,
        secretario_cpf text,
        secretario_cargo text,

        -- Situação: ativo ou inativo. Inativar é a exclusão do cadastro.
        situacao text not null default 'ativo',

        criado_em timestamptz not null default now(),
        criado_por %1$s references public.usuarios (id) on delete set null,
        atualizado_em timestamptz not null default now(),
        atualizado_por %1$s references public.usuarios (id) on delete set null
      )
    $ddl$, tipo_usuario);
  end if;
end $$;

alter table public.processos_secretarias_solicitantes
  add column if not exists nome_curto text,
  add column if not exists secretario text,
  add column if not exists secretario_cpf text,
  add column if not exists secretario_cargo text;

alter table public.processos_secretarias_solicitantes
  drop constraint if exists processos_secretarias_solicitantes_situacao_check;
alter table public.processos_secretarias_solicitantes
  add constraint processos_secretarias_solicitantes_situacao_check
  check (situacao in ('ativo', 'inativo'));

-- Nome oficial único IGNORANDO maiúsculas e espaços nas pontas: a mesma
-- secretaria não entra duas vezes por causa de digitação. Vale também para a
-- inativa — reativar a existente é o caminho, e não criar uma segunda.
create unique index if not exists processos_solicitantes_nome_unico
  on public.processos_secretarias_solicitantes (lower(btrim(nome)));

create index if not exists processos_solicitantes_situacao
  on public.processos_secretarias_solicitantes (situacao);

-- ---------------------------------------------------------------------------
-- 2. O cadastro de BANCOS
-- ---------------------------------------------------------------------------
-- O NÚMERO é o que o modelo oficial pede ao lado do nome: "001 — Banco do
-- Brasil". Ele é guardado como TEXTO, e não como número, porque o zero à
-- esquerda faz parte do código ("001" nunca é "1").
do $$
declare
  tipo_usuario text;
begin
  select format_type(a.atttypid, a.atttypmod) into tipo_usuario
    from pg_attribute a
   where a.attrelid = to_regclass('public.usuarios') and a.attname = 'id' and not a.attisdropped;

  if to_regclass('public.processos_bancos') is null then
    execute format($ddl$
      create table public.processos_bancos (
        id uuid primary key default gen_random_uuid(),

        -- "001", "104", "237": o código do banco, com o zero à esquerda.
        numero text not null,
        nome text not null,

        situacao text not null default 'ativo',

        criado_em timestamptz not null default now(),
        criado_por %1$s references public.usuarios (id) on delete set null,
        atualizado_em timestamptz not null default now(),
        atualizado_por %1$s references public.usuarios (id) on delete set null
      )
    $ddl$, tipo_usuario);
  end if;
end $$;

alter table public.processos_bancos drop constraint if exists processos_bancos_situacao_check;
alter table public.processos_bancos add constraint processos_bancos_situacao_check
  check (situacao in ('ativo', 'inativo'));

-- Número único comparando SÓ OS DÍGITOS: "001" e "1" são o mesmo banco.
create unique index if not exists processos_bancos_numero_unico
  on public.processos_bancos ((ltrim(regexp_replace(numero, '[^0-9]', '', 'g'), '0')));

create index if not exists processos_bancos_nome on public.processos_bancos (nome);
create index if not exists processos_bancos_situacao on public.processos_bancos (situacao);

-- ---------------------------------------------------------------------------
-- 3. O processo aponta para a solicitante — e CONGELA o que ela dizia
-- ---------------------------------------------------------------------------
-- `solicitante_id` é só um PONTEIRO. Os quatro campos seguintes são a CÓPIA que
-- o documento passa a ter por conta própria. Como o conteúdo de processo
-- finalizado não pode mais ser alterado (gatilho
-- public.conferir_alteracao_processo_diaria), trocar o secretário no cadastro
-- depois NÃO altera documento antigo: ele continua imprimindo quem requisitou.
--
-- ⚠️ `secretaria_id` CONTINUA ONDE ESTÁ, apontando para public.secretarias, e
-- continua sendo lido: é assim que processo gravado antes deste cadastro existir
-- continua abrindo e imprimindo exatamente como sempre imprimiu. Nenhuma linha
-- existente é reescrita por esta migration.
alter table public.processos_diarias
  add column if not exists solicitante_id uuid,
  add column if not exists solicitante_nome text,
  add column if not exists solicitante_secretario text,
  add column if not exists solicitante_secretario_cpf text,
  add column if not exists solicitante_secretario_cargo text,
  add column if not exists banco_codigo text;

alter table public.processos_servidores
  add column if not exists solicitante_id uuid,
  add column if not exists banco_codigo text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.processos_diarias'::regclass
       and conname = 'processos_diarias_solicitante_fkey'
  ) then
    execute 'alter table public.processos_diarias
               add constraint processos_diarias_solicitante_fkey
               foreign key (solicitante_id)
               references public.processos_secretarias_solicitantes (id) on delete set null';
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.processos_servidores'::regclass
       and conname = 'processos_servidores_solicitante_fkey'
  ) then
    execute 'alter table public.processos_servidores
               add constraint processos_servidores_solicitante_fkey
               foreign key (solicitante_id)
               references public.processos_secretarias_solicitantes (id) on delete set null';
  end if;
end $$;

create index if not exists processos_diarias_solicitante
  on public.processos_diarias (solicitante_id);
create index if not exists processos_servidores_solicitante
  on public.processos_servidores (solicitante_id);

-- ---------------------------------------------------------------------------
-- 4. A MATRÍCULA sai do sistema — as colunas ficam
-- ---------------------------------------------------------------------------
-- A prefeitura não usa matrícula nestes documentos, e o campo saiu do cadastro
-- de servidores, do formulário da diária e do documento impresso.
--
-- ⚠️ `drop column` apagaria o que já foi gravado. Aqui as colunas continuam
-- exatamente onde estão, com o conteúdo que tiverem; o sistema apenas parou de
-- lê-las e de escrevê-las. Registro existente continua íntegro e legível.
comment on column public.processos_servidores.matricula is
  'DESATIVADO: a matrícula saiu da interface, do formulário da diária e do documento impresso. A coluna é preservada com o que já foi gravado; o sistema não lê nem escreve mais nela.';
comment on column public.processos_diarias.beneficiario_matricula is
  'DESATIVADO junto com processos_servidores.matricula. Coluna preservada só para não perder o que já foi gravado.';

-- ---------------------------------------------------------------------------
-- 5. RLS dos dois cadastros novos
-- ---------------------------------------------------------------------------
-- Os dois são PARÂMETRO do módulo Processos · Diárias, como a Identidade Visual:
-- quem vê diárias precisa lê-los (a tela do processo os oferece), e quem cadastra
-- ou edita diárias os mantém em Configurações → Processos.
--
-- Não há política de DELETE em nenhum dos dois: nada é apagado, é inativado. É
-- essa ausência que garante que processo antigo nunca perca a referência.
alter table public.processos_secretarias_solicitantes enable row level security;

drop policy if exists "processos_solicitantes_select" on public.processos_secretarias_solicitantes;
create policy "processos_solicitantes_select"
  on public.processos_secretarias_solicitantes
  for select to authenticated
  using (public.pode_em_processos('processos_diarias', 'visualizar'));

drop policy if exists "processos_solicitantes_insert" on public.processos_secretarias_solicitantes;
create policy "processos_solicitantes_insert"
  on public.processos_secretarias_solicitantes
  for insert to authenticated
  with check (public.pode_em_processos('processos_diarias', 'cadastrar'));

drop policy if exists "processos_solicitantes_update" on public.processos_secretarias_solicitantes;
create policy "processos_solicitantes_update"
  on public.processos_secretarias_solicitantes
  for update to authenticated
  using (public.pode_em_processos('processos_diarias', 'editar'))
  with check (public.pode_em_processos('processos_diarias', 'editar'));

grant select, insert, update on public.processos_secretarias_solicitantes to authenticated;
revoke delete on public.processos_secretarias_solicitantes from authenticated;
revoke all on public.processos_secretarias_solicitantes from anon;

alter table public.processos_bancos enable row level security;

drop policy if exists "processos_bancos_select" on public.processos_bancos;
create policy "processos_bancos_select"
  on public.processos_bancos
  for select to authenticated
  using (public.pode_em_processos('processos_diarias', 'visualizar'));

drop policy if exists "processos_bancos_insert" on public.processos_bancos;
create policy "processos_bancos_insert"
  on public.processos_bancos
  for insert to authenticated
  with check (public.pode_em_processos('processos_diarias', 'cadastrar'));

drop policy if exists "processos_bancos_update" on public.processos_bancos;
create policy "processos_bancos_update"
  on public.processos_bancos
  for update to authenticated
  using (public.pode_em_processos('processos_diarias', 'editar'))
  with check (public.pode_em_processos('processos_diarias', 'editar'));

grant select, insert, update on public.processos_bancos to authenticated;
revoke delete on public.processos_bancos from authenticated;
revoke all on public.processos_bancos from anon;

-- ---------------------------------------------------------------------------
-- 6. Os dez bancos mais usados, já semeados
-- ---------------------------------------------------------------------------
-- Semente, não trava: a lista é editável na tela e novos bancos entram por lá,
-- sem deploy. `where not exists` pelo número em dígitos — rodar de novo não
-- duplica nada e não reescreve o que a prefeitura já tiver ajustado.
insert into public.processos_bancos (numero, nome)
select b.numero, b.nome
  from (values
    ('001', 'Banco do Brasil'),
    ('104', 'Caixa Econômica Federal'),
    ('237', 'Bradesco'),
    ('341', 'Itaú'),
    ('033', 'Santander'),
    ('756', 'Sicoob'),
    ('748', 'Sicredi'),
    ('077', 'Banco Inter'),
    ('260', 'Nu Pagamentos'),
    ('336', 'Banco C6')
  ) as b (numero, nome)
 where not exists (
   select 1 from public.processos_bancos x
    where ltrim(regexp_replace(x.numero, '[^0-9]', '', 'g'), '0')
        = ltrim(regexp_replace(b.numero, '[^0-9]', '', 'g'), '0')
 );

-- ---------------------------------------------------------------------------
-- 7. A primeira carga das solicitantes, a partir dos nomes já digitados
-- ---------------------------------------------------------------------------
-- ⚠️ ISTO É UMA CÓPIA DE NOMES, EM UM SENTIDO SÓ. public.secretarias é apenas
-- LIDA; nada é alterado, mesclado ou apagado lá, e daqui em diante os dois
-- cadastros seguem vidas separadas — editar uma solicitante não mexe na
-- secretaria financeira, e editar a secretaria financeira não mexe na
-- solicitante.
--
-- Serve para a tela não nascer vazia: as secretarias que a prefeitura já
-- digitou aparecem como solicitantes, prontas para receber o secretário, o CPF e
-- o cargo. O secretário NÃO é copiado porque o cadastro financeiro não o tem —
-- ele é preenchido em Configurações → Processos.
--
-- Só na PRIMEIRA carga: com o cadastro já povoado, nada é inserido.
do $$
begin
  if to_regclass('public.secretarias') is null then
    return;
  end if;
  if exists (select 1 from public.processos_secretarias_solicitantes) then
    return;
  end if;

  -- `distinct on` pelo nome em minúsculas: duas secretarias que diferem só por
  -- maiúsculas entram uma vez, respeitando o índice único.
  insert into public.processos_secretarias_solicitantes (nome, situacao)
  select distinct on (lower(btrim(s.nome))) btrim(s.nome), 'ativo'
    from public.secretarias s
   where btrim(coalesce(s.nome, '')) <> ''
   order by lower(btrim(s.nome)), btrim(s.nome);
end $$;

-- ---------------------------------------------------------------------------
-- 8. Documentação
-- ---------------------------------------------------------------------------
comment on table public.processos_secretarias_solicitantes is
  'Cadastro PRÓPRIO das secretarias SOLICITANTES do módulo Processos: quem REQUISITA o documento. ⚠️ NÃO é public.secretarias e não a altera, mescla ou substitui — o cadastro de secretarias do módulo financeiro continua intocado, servindo contas bancárias, fornecedores, Saldos e Pagamentos. Os dois coexistem, cada um com a sua finalidade. Documental: não debita conta, não dá baixa em NF, não altera saldo e não cria pagamento.';
comment on column public.processos_secretarias_solicitantes.nome is
  'O nome OFICIAL, como sai impresso: "Secretaria Municipal de Educação".';
comment on column public.processos_secretarias_solicitantes.nome_curto is
  'O apelido das listas e dos filtros da tela: "Educação". Não vai impresso.';
comment on column public.processos_secretarias_solicitantes.secretario is
  'Quem responde pela secretaria HOJE. É COPIADO para dentro do processo ao escolher a solicitante: trocar o secretário aqui não reescreve documento já emitido.';
comment on column public.processos_secretarias_solicitantes.situacao is
  'ativo ou inativo. A exclusão é LÓGICA: a linha nunca é apagada, porque processos antigos apontam para ela.';

comment on table public.processos_bancos is
  'Cadastro de BANCOS do módulo Processos, com número e nome, para o documento sair "001 — Banco do Brasil" como no modelo oficial. Semeado com os dez mais usados; novos entram pela tela, sem deploy. Documental: não debita conta, não dá baixa em NF, não altera saldo e não cria pagamento. ⚠️ NÃO é o cadastro de contas bancárias do município e não tem relação com ele.';
comment on column public.processos_bancos.numero is
  'O código do banco como TEXTO, com o zero à esquerda ("001" nunca é "1"). Único comparando só os dígitos.';
comment on column public.processos_bancos.situacao is
  'ativo ou inativo. A exclusão é LÓGICA: banco inativo sai das escolhas novas, mas continua legível nos documentos que o gravaram.';

comment on column public.processos_diarias.solicitante_id is
  'Vínculo interno com public.processos_secretarias_solicitantes: a secretaria que REQUISITOU. Só um ponteiro — o documento guarda o próprio texto nas colunas solicitante_*.';
comment on column public.processos_diarias.solicitante_nome is
  'O nome oficial da secretaria solicitante, GRAVADO NO PROCESSO. Processo finalizado não é mais alterado, então mudar o cadastro depois não altera este documento.';
comment on column public.processos_diarias.secretaria_id is
  'LEGADO, e preservado: a secretaria do módulo FINANCEIRO que o processo gravou antes de as solicitantes existirem. Continua sendo lida para que documento antigo imprima exatamente como sempre imprimiu. Processo novo usa solicitante_id.';
comment on column public.processos_diarias.banco_codigo is
  'O NÚMERO do banco, gravado junto com o nome em `banco`: o par que imprime "001 — Banco do Brasil". Sem chave estrangeira, de propósito — renomear um banco no cadastro não reescreve documento antigo.';
comment on column public.processos_servidores.banco_codigo is
  'O NÚMERO do banco do servidor, escolhido em public.processos_bancos. Guardado como texto junto com o nome, pelo mesmo motivo do processo.';

commit;
