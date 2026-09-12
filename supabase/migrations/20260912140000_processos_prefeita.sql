-- MÓDULO PROCESSOS — O CADASTRO DA PREFEITA (chefe do Poder Executivo) E O
-- CONGELAMENTO DELA NOS PROCESSOS.
--
-- ATENÇÃO: esta migration precisa ser rodada MANUALMENTE no SQL Editor do
-- Supabase (projeto usado pela aplicação). Nada nela roda sozinho no deploy.
-- Arquivo: supabase/migrations/20260912140000_processos_prefeita.sql
--
-- ---------------------------------------------------------------------------
-- O QUE ELA FAZ
-- ---------------------------------------------------------------------------
--   1. o módulo de permissão PRÓPRIO 'processos_prefeita' entra na lista fixa
--      de módulos (quando o banco tiver essa lista), ANTES de qualquer seed.
--   2. public.processos_prefeita — o cadastro da chefe do Poder Executivo:
--      nome completo, CPF, cargo, período de vigência (início e fim, os dois
--      OPCIONAIS) e situação ativo/inativo. Uma LINHA POR GESTÃO: a anterior é
--      inativada, nunca apagada, porque é ela que explica documento antigo.
--   3. colunas ADITIVAS `prefeita jsonb` em public.processos_diarias e
--      public.processos_servicos — os dados de quem autorizou, CONGELADOS na
--      finalização.
--   4. os dois gatilhos de alteração passam a tratar `prefeita` como CONTROLE
--      (para quem finaliza não precisar de permissão de editar) e a recusar
--      qualquer reescrita do que já está congelado: ⚠️ MUDANÇA DE GESTÃO NÃO
--      REESCREVE DOCUMENTO JÁ FINALIZADO, e nem sequer consegue.
--   5. RLS do cadastro: CONSULTAR acompanha quem vê o módulo Processos (o
--      documento imprime o nome de quem autoriza); EDITAR exige o módulo
--      próprio 'processos_prefeita' — permissão restrita, que não se herda.
--   6. semeadura das permissões nos perfis: visualizar acompanha quem já vê
--      Processos · Diárias; editar nasce SÓ para o perfil 'Administrador'.
--   7. a política permissiva de leitura da chave 'processos' em
--      public.configuracoes_sistema passa a valer também para a chave 'geral'
--      — é a LOGOMARCA CADASTRADA DO SISTEMA, que o documento precisa ler para
--      imprimir o brasão certo (item 4 do comando).
--
-- ---------------------------------------------------------------------------
-- ADITIVA, E SÓ NO MÓDULO PROCESSOS
-- ---------------------------------------------------------------------------
-- Só há `create table if not exists`, `add column if not exists`,
-- `create index if not exists`, `create or replace function`, `create policy` e
-- `insert ... where not exists`. NENHUMA coluna é removida ou renomeada,
-- NENHUM dado existente é reescrito e NENHUMA permissão existente é alterada.
-- Rodar duas vezes é inofensivo.
--
-- E, como todo o módulo, isto é PAPEL: nada aqui debita conta, dá baixa em NF,
-- altera saldo, marca fornecedor como pago, cria pagamento ou toca na
-- Programação Diária. Esta migration não escreve, não altera e não referencia
-- public.pagamentos, public.pagamentos_baixas, public.valores_em_aberto,
-- public.saldos_historico, public.contas_bancarias, public.transferencias_contas
-- nem public.programacoes_pagamento. Não toca em public.secretarias nem em
-- public.fornecedores.

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
         and pg_get_constraintdef(oid) not like '%''processos_prefeita''%'
    loop
      corpo := regexp_replace(restricao.definicao, '\s+NOT VALID$', '');
      corpo := regexp_replace(corpo, '^CHECK\s*', '');

      execute format('alter table %s drop constraint %I', tabela, restricao.conname);
      execute format(
        'alter table %s add constraint %I check ((%s) or modulo in (''processos_prefeita''))',
        tabela, restricao.conname, corpo
      );
    end loop;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. O cadastro da PREFEITA
-- ---------------------------------------------------------------------------
-- UMA LINHA POR GESTÃO. A vigência é opcional dos dois lados: a prefeitura pode
-- registrar só "de 01/01/2025" e deixar o fim em branco enquanto o mandato
-- corre. `situacao` é a exclusão do cadastro — inativar, nunca apagar, porque
-- documento finalizado aponta para a gestão que o autorizou.
--
-- ⚠️ O documento NÃO LÊ DAQUI depois de finalizado: na finalização, nome, CPF e
-- cargo são COPIADOS para dentro do processo (seção 3). Este cadastro serve para
-- PREENCHER o documento em rascunho, sem redigitação em cada processo.
do $$
declare
  tipo_usuario text;
begin
  select format_type(a.atttypid, a.atttypmod) into tipo_usuario
    from pg_attribute a
   where a.attrelid = to_regclass('public.usuarios') and a.attname = 'id' and not a.attisdropped;

  if to_regclass('public.processos_prefeita') is null then
    execute format($ddl$
      create table public.processos_prefeita (
        id uuid primary key default gen_random_uuid(),

        -- O nome completo, como sai IMPRESSO abaixo da linha de assinatura.
        nome text not null,
        -- O CPF, guardado formatado, como o resto do módulo guarda CPF.
        cpf text,
        -- "Prefeita Municipal", "Prefeito Municipal", "Prefeita em exercício"...
        cargo text,

        -- O período de validade. Os dois lados são OPCIONAIS.
        vigencia_inicio date,
        vigencia_fim date,

        situacao text not null default 'ativo',

        criado_em timestamptz not null default now(),
        criado_por %1$s references public.usuarios (id) on delete set null,
        atualizado_em timestamptz not null default now(),
        atualizado_por %1$s references public.usuarios (id) on delete set null
      )
    $ddl$, tipo_usuario);
  end if;
end $$;

alter table public.processos_prefeita
  add column if not exists cpf text,
  add column if not exists cargo text,
  add column if not exists vigencia_inicio date,
  add column if not exists vigencia_fim date,
  add column if not exists situacao text;

alter table public.processos_prefeita alter column situacao set default 'ativo';
update public.processos_prefeita set situacao = 'ativo' where situacao is null;
alter table public.processos_prefeita alter column situacao set not null;

alter table public.processos_prefeita drop constraint if exists processos_prefeita_situacao_check;
alter table public.processos_prefeita add constraint processos_prefeita_situacao_check
  check (situacao in ('ativo', 'inativo'));

-- O fim nunca é anterior ao início. Vigência em branco continua aceita.
alter table public.processos_prefeita drop constraint if exists processos_prefeita_vigencia_check;
alter table public.processos_prefeita add constraint processos_prefeita_vigencia_check
  check (vigencia_fim is null or vigencia_inicio is null or vigencia_fim >= vigencia_inicio);

create index if not exists processos_prefeita_situacao on public.processos_prefeita (situacao);
create index if not exists processos_prefeita_vigencia
  on public.processos_prefeita (vigencia_inicio desc, criado_em desc);

comment on table public.processos_prefeita is
  'Cadastro da chefe do Poder Executivo que AUTORIZA os documentos do módulo Processos. Documental: não debita conta, não dá baixa em NF, não altera saldo e não cria pagamento. Uma linha por gestão; a anterior é inativada, nunca apagada.';

-- ---------------------------------------------------------------------------
-- 3. O processo CONGELA quem autorizou
-- ---------------------------------------------------------------------------
-- `prefeita` é jsonb { nome, cpf, cargo }: a cópia que o documento passa a ter
-- por conta própria. É o que faz a MUDANÇA DE GESTÃO não reescrever documento
-- antigo — a mesma regra já usada para os dados do secretário e para a
-- identidade visual.
alter table public.processos_diarias
  add column if not exists prefeita jsonb;

do $$
begin
  if to_regclass('public.processos_servicos') is not null then
    execute 'alter table public.processos_servicos add column if not exists prefeita jsonb';
  end if;
end $$;

comment on column public.processos_diarias.prefeita is
  'CONGELADO na finalização: { nome, cpf, cargo } da prefeita em vigor naquele momento. Alterar o cadastro depois NÃO altera este processo.';

do $$
begin
  if to_regclass('public.processos_servicos') is not null then
    execute $c$comment on column public.processos_servicos.prefeita is
      'CONGELADO na finalização: { nome, cpf, cargo } da prefeita em vigor naquele momento. Alterar o cadastro depois NÃO altera este processo.'$c$;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4a. O gatilho das DIÁRIAS passa a conhecer `prefeita`
-- ---------------------------------------------------------------------------
-- Duas coisas, as mesmas de sempre:
--   a) `prefeita` entra na lista de CONTROLE, porque é escrita no mesmo update
--      da finalização: quem tem permissão de finalizar não deve precisar também
--      de permissão de editar;
--   b) congelado UMA VEZ, congelado para sempre: alterar um congelamento já
--      preenchido é recusado pelo banco, independentemente de permissão.
--
-- O resto da função é IDÊNTICO ao que já estava em
-- 20260911210000_processos_diarias_tabela_e_identidade.sql.
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
    'atualizado_em', 'atualizado_por',
    -- Congelamento da Tabela de Diárias, da identidade visual e da PREFEITA
    -- (todos escritos na finalização).
    'diaria_valor_unitario', 'diaria_pernoite_percentual', 'diaria_tabela_versao',
    'diaria_tabela_id', 'identidade_visual', 'prefeita'
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

  -- Congelado uma vez, congelado para sempre.
  if old.diaria_tabela_versao is not null
     and new.diaria_tabela_versao is distinct from old.diaria_tabela_versao then
    raise exception 'A tabela de diárias usada no processo % já está congelada e não pode ser trocada.', old.numero;
  end if;
  if old.diaria_valor_unitario is not null
     and new.diaria_valor_unitario is distinct from old.diaria_valor_unitario then
    raise exception 'O valor unitário congelado do processo % não pode ser alterado.', old.numero;
  end if;
  if old.identidade_visual is not null
     and new.identidade_visual is distinct from old.identidade_visual then
    raise exception 'A identidade visual congelada do processo % não pode ser alterada.', old.numero;
  end if;
  if old.prefeita is not null
     and new.prefeita is distinct from old.prefeita then
    raise exception 'Os dados da prefeita congelados no processo % não podem ser alterados.', old.numero;
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

-- ---------------------------------------------------------------------------
-- 4b. O gatilho dos SERVIÇOS/MATERIAIS, pelo mesmo motivo
-- ---------------------------------------------------------------------------
-- Idêntico ao de 20260911260000_processos_modulo_servicos.sql, com `prefeita`
-- no controle e as duas travas de congelamento (a identidade visual ganha a
-- dela agora: ela já era controle, mas não era protegida contra reescrita).
do $$
begin
  if to_regclass('public.processos_servicos') is null then
    return;
  end if;

  execute $fn$
  create or replace function public.conferir_alteracao_processo_servico()
  returns trigger
  language plpgsql
  as $corpo$
  declare
    antes jsonb;
    depois jsonb;
    controle text[] := array[
      'situacao', 'finalizada_em', 'finalizada_por', 'cancelada_em', 'cancelada_por',
      'motivo_cancelamento', 'excluido_em', 'excluido_por', 'motivo_exclusao',
      'identidade_visual', 'prefeita', 'atualizado_em', 'atualizado_por'
    ];
    campo text;
  begin
    if auth.uid() is null then
      return new;
    end if;

    if new.ano is distinct from old.ano or new.numero is distinct from old.numero then
      raise exception 'O número do processo não pode ser alterado.';
    end if;

    -- Congelado uma vez, congelado para sempre.
    if old.identidade_visual is not null
       and new.identidade_visual is distinct from old.identidade_visual then
      raise exception 'A identidade visual congelada do processo % não pode ser alterada.', old.numero;
    end if;
    if old.prefeita is not null
       and new.prefeita is distinct from old.prefeita then
      raise exception 'Os dados da prefeita congelados no processo % não podem ser alterados.', old.numero;
    end if;

    antes := to_jsonb(old);
    depois := to_jsonb(new);
    foreach campo in array controle loop
      antes := antes - campo;
      depois := depois - campo;
    end loop;

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

    if new.excluido_em is distinct from old.excluido_em then
      if not public.pode_em_processos('processos_servicos', 'excluir') then
        raise exception 'Sem permissão para excluir processos de serviços/materiais.';
      end if;
      if old.situacao = 'finalizada' and new.excluido_em is not null then
        raise exception 'Processo finalizado não tem exclusão comum: use cancelar, que preserva o registro e o histórico.';
      end if;
    end if;

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
  $corpo$;
  $fn$;
end $$;

-- ---------------------------------------------------------------------------
-- 5. RLS do cadastro
-- ---------------------------------------------------------------------------
-- CONSULTAR acompanha quem vê o módulo Processos: o documento IMPRIME o nome de
-- quem autoriza, então quem monta processo precisa ler o cadastro.
-- EDITAR exige o módulo próprio 'processos_prefeita' — permissão restrita, que
-- não se herda de nenhuma outra. Trocar quem autoriza os documentos do
-- município não acompanha quem preenche processo.
--
-- Não há política de DELETE: a gestão anterior é INATIVADA, nunca apagada.
alter table public.processos_prefeita enable row level security;

drop policy if exists "processos_prefeita_select" on public.processos_prefeita;
create policy "processos_prefeita_select"
  on public.processos_prefeita
  for select to authenticated
  using (
    public.pode_em_processos('processos_prefeita', 'visualizar')
    or public.pode_em_processos('processos_diarias', 'visualizar')
    or public.pode_em_processos('processos_servicos', 'visualizar')
  );

drop policy if exists "processos_prefeita_insert" on public.processos_prefeita;
create policy "processos_prefeita_insert"
  on public.processos_prefeita
  for insert to authenticated
  with check (public.pode_em_processos('processos_prefeita', 'editar'));

drop policy if exists "processos_prefeita_update" on public.processos_prefeita;
create policy "processos_prefeita_update"
  on public.processos_prefeita
  for update to authenticated
  using (public.pode_em_processos('processos_prefeita', 'editar'))
  with check (public.pode_em_processos('processos_prefeita', 'editar'));

grant select, insert, update on public.processos_prefeita to authenticated;
revoke delete on public.processos_prefeita from authenticated;
revoke all on public.processos_prefeita from anon;

-- ---------------------------------------------------------------------------
-- 6. Padrão do módulo novo nos perfis
-- ---------------------------------------------------------------------------
-- VISUALIZAR acompanha quem já vê Processos · Diárias. EDITAR nasce SÓ para o
-- Administrador: é permissão restrita, e permissão restrita não se herda.
-- Nenhuma permissão existente é alterada — só entram linhas novas.
insert into public.perfis_permissoes (
  perfil_id, modulo,
  pode_visualizar, pode_cadastrar, pode_editar, pode_excluir, pode_aprovar, pode_visualizar_valores
)
select
  pp.perfil_id,
  'processos_prefeita',
  pp.pode_visualizar,
  false,
  coalesce(p.nome = 'Administrador', false),
  false, false, false
from public.perfis_permissoes pp
join public.perfis_acesso p on p.id = pp.perfil_id
where pp.modulo = 'processos_diarias'
  and not exists (
    select 1 from public.perfis_permissoes x
     where x.perfil_id = pp.perfil_id and x.modulo = 'processos_prefeita'
  );

insert into public.perfis_permissoes (
  perfil_id, modulo,
  pode_visualizar, pode_cadastrar, pode_editar, pode_excluir, pode_aprovar, pode_visualizar_valores
)
select
  p.id, 'processos_prefeita',
  p.nome = 'Administrador', false, p.nome = 'Administrador', false, false, false
from public.perfis_acesso p
where not exists (
  select 1 from public.perfis_permissoes x
   where x.perfil_id = p.id and x.modulo = 'processos_prefeita'
);

-- ---------------------------------------------------------------------------
-- 7. O documento precisa LER A LOGOMARCA CADASTRADA DO SISTEMA
-- ---------------------------------------------------------------------------
-- O brasão impresso passa a obedecer a esta ordem: a imagem enviada em
-- Configurações → Processos; senão, a LOGOMARCA DO SISTEMA (Configurações →
-- Aparência, chave 'geral'); só então o desenho embutido no código. Sem esta
-- política, quem não é do módulo Administração não conseguia LER a chave
-- 'geral' e o documento caía no desenho embutido — era o "brasão diferente do
-- cadastrado" visto na pré-visualização.
--
-- A política de leitura da chave 'processos' já existia; ela é RECRIADA aqui
-- cobrindo as duas chaves. Políticas de select são somadas (OR), então nada do
-- que já era visível deixa de ser, e NENHUMA outra chave passa a ser visível.
-- A GRAVAÇÃO não muda: continua exigindo edição no módulo 'administracao'.
do $$
begin
  if to_regclass('public.configuracoes_sistema') is null then
    return;
  end if;

  execute 'drop policy if exists "configuracoes_sistema_select_processos" on public.configuracoes_sistema';
  execute $pol$
    create policy "configuracoes_sistema_select_processos"
      on public.configuracoes_sistema
      for select to authenticated
      using (
        chave in ('processos', 'geral')
        and (
          public.pode_em_processos('processos_diarias', 'visualizar')
          or public.pode_em_processos('processos_servicos', 'visualizar')
        )
      )
  $pol$;
end $$;

commit;

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA (rode depois, se quiser ver o resultado)
-- ---------------------------------------------------------------------------
-- O cadastro existe e está vazio (é a tela que cadastra a prefeita):
--   select * from public.processos_prefeita;
--
-- As colunas de congelamento existem:
--   select table_name, column_name
--     from information_schema.columns
--    where table_schema = 'public' and column_name = 'prefeita';
--
-- O módulo novo entrou nos perfis (editar só para o Administrador):
--   select p.nome, pp.pode_visualizar, pp.pode_editar
--     from public.perfis_permissoes pp
--     join public.perfis_acesso p on p.id = pp.perfil_id
--    where pp.modulo = 'processos_prefeita'
--    order by p.nome;
--
-- A leitura da logomarca do sistema pelo módulo Processos:
--   select polname, pg_get_expr(polqual, polrelid) as condicao
--     from pg_policy
--    where polrelid = 'public.configuracoes_sistema'::regclass;
