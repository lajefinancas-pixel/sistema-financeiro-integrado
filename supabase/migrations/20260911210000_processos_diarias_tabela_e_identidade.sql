-- MÓDULO PROCESSOS — TABELA DE DIÁRIAS E IDENTIDADE VISUAL.
--
-- ATENÇÃO: esta migration precisa ser rodada MANUALMENTE no SQL Editor do
-- Supabase (projeto usado pela aplicação). Nada nela roda sozinho no deploy.
-- Arquivo: supabase/migrations/20260911210000_processos_diarias_tabela_e_identidade.sql
--
-- ---------------------------------------------------------------------------
-- O QUE ELA FAZ
-- ---------------------------------------------------------------------------
--   1. public.processos_diarias_tabela — o cadastro VERSIONADO da Tabela de
--      Diárias (faixa de distância × categoria do cargo), com o percentual de
--      pernoite e a memória do cálculo. Cada atualização é uma LINHA NOVA: a
--      versão anterior nunca é apagada, porque processos antigos dependem dela.
--   2. o módulo de permissão PRÓPRIO 'processos_diarias_tabela' — editar a
--      tabela é um parâmetro que afeta valores de pagamento e não acompanha
--      quem edita processo. Visualizar acompanha quem vê o módulo Processos.
--   3. colunas ADITIVAS em public.processos_diarias para a escolha feita no
--      formulário (faixa, categoria, pernoite) e para o CONGELAMENTO do que foi
--      usado (valor unitário, percentual de pernoite, versão da tabela) mais a
--      identidade visual vigente na finalização.
--   4. o gatilho de alteração passa a PROIBIR a reescrita do que já foi
--      congelado: atualizar a tabela ou trocar o brasão não altera — e não
--      consegue alterar — nenhum processo já finalizado.
--
-- ---------------------------------------------------------------------------
-- ADITIVA, E SÓ NO MÓDULO PROCESSOS
-- ---------------------------------------------------------------------------
-- Só há `create table if not exists`, `add column if not exists` e
-- `create or replace`. Nenhuma coluna é removida ou renomeada, nenhum dado
-- existente é reescrito e NENHUMA permissão existente é alterada. Rodar duas
-- vezes é inofensivo.
--
-- E, como todo o módulo, isto é PAPEL: nada aqui debita conta, dá baixa em NF,
-- altera saldo, marca fornecedor como pago, cria pagamento ou toca na
-- Programação Diária. Esta migration não escreve, não altera e não referencia
-- public.pagamentos, public.pagamentos_baixas, public.valores_em_aberto,
-- public.saldos_historico, public.contas_bancarias, public.transferencias_contas,
-- public.programacoes_pagamento nem public.fornecedores. A Tabela de Diárias é
-- um PARÂMETRO: ela sugere o valor unitário do formulário, e nada mais.

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
-- lista fixa, o seed da seção 5 seria recusado e a migration inteira abortaria.
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
         and pg_get_constraintdef(oid) not like '%''processos_diarias_tabela''%'
    loop
      corpo := regexp_replace(restricao.definicao, '\s+NOT VALID$', '');
      corpo := regexp_replace(corpo, '^CHECK\s*', '');

      execute format('alter table %s drop constraint %I', tabela, restricao.conname);
      execute format(
        'alter table %s add constraint %I check ((%s) or modulo in (''processos_diarias_tabela''))',
        tabela, restricao.conname, corpo
      );
    end loop;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. A Tabela de Diárias, versionada
-- ---------------------------------------------------------------------------
-- Uma LINHA POR VERSÃO. Atualizar a tabela insere uma versão nova e marca a
-- anterior como não vigente — nunca apaga e nunca reescreve, porque os
-- processos emitidos sob a versão antiga precisam continuar explicáveis.
--
-- `valores` é jsonb no formato { faixa: { categoria: valor } }, com as quatro
-- faixas de distância e as cinco categorias de cargo do documento oficial. Os
-- valores são SEM pernoite; `pernoite_percentual` é o acréscimo aplicado quando
-- há pernoite, e fica GRAVADO AQUI (não no código) para que mudar a regra não
-- exija alteração de sistema.
create table if not exists public.processos_diarias_tabela (
  id uuid primary key default gen_random_uuid(),
  titulo text not null default 'Tabela de Diárias',
  atualizada_em date not null,
  pernoite_percentual numeric(7,3) not null default 30,
  memoria_calculo text,
  valores jsonb not null default '{}'::jsonb,
  vigente boolean not null default false,
  criado_em timestamptz not null default now(),
  criado_por uuid
);

do $$
declare
  tipo_usuario text;
begin
  select format_type(a.atttypid, a.atttypmod) into tipo_usuario
    from pg_attribute a
   where a.attrelid = 'public.usuarios'::regclass and a.attname = 'id' and a.attnum > 0;

  if tipo_usuario is not null
     and not exists (
       select 1 from pg_constraint
        where conrelid = 'public.processos_diarias_tabela'::regclass
          and conname = 'processos_diarias_tabela_criado_por_fkey'
     )
  then
    execute 'alter table public.processos_diarias_tabela
               add constraint processos_diarias_tabela_criado_por_fkey
               foreign key (criado_por) references public.usuarios (id) on delete set null';
  end if;
end $$;

alter table public.processos_diarias_tabela
  drop constraint if exists processos_diarias_tabela_pernoite_check;
alter table public.processos_diarias_tabela
  add constraint processos_diarias_tabela_pernoite_check
  check (pernoite_percentual >= 0 and pernoite_percentual <= 200);

-- Uma só versão vigente por vez.
create unique index if not exists processos_diarias_tabela_vigente_unica
  on public.processos_diarias_tabela (vigente)
  where vigente;

create index if not exists processos_diarias_tabela_atualizada_em
  on public.processos_diarias_tabela (atualizada_em desc, criado_em desc);

-- ---------------------------------------------------------------------------
-- 3. Colunas do processo: a escolha e o CONGELAMENTO
-- ---------------------------------------------------------------------------
-- A escolha (faixa, categoria, pernoite) é digitada no rascunho como qualquer
-- outro campo do documento. O congelamento é o retrato do que foi usado: valor
-- unitário, percentual de pernoite e a identificação da versão da tabela
-- vigente na hora de finalizar, mais a identidade visual daquele momento.
alter table public.processos_diarias
  add column if not exists diaria_faixa text,
  add column if not exists diaria_categoria text,
  add column if not exists diaria_pernoite boolean not null default false,
  add column if not exists valor_unitario_manual boolean not null default false,
  add column if not exists diaria_valor_unitario numeric(14,2),
  add column if not exists diaria_pernoite_percentual numeric(7,3),
  add column if not exists diaria_tabela_versao text,
  add column if not exists diaria_tabela_id uuid,
  add column if not exists identidade_visual jsonb;

alter table public.processos_diarias drop constraint if exists processos_diarias_faixa_check;
alter table public.processos_diarias add constraint processos_diarias_faixa_check
  check (diaria_faixa is null or diaria_faixa in
    ('al_ate_100', 'al_acima_100', 'nordeste', 'demais_regioes'));

alter table public.processos_diarias drop constraint if exists processos_diarias_categoria_check;
alter table public.processos_diarias add constraint processos_diarias_categoria_check
  check (diaria_categoria is null or diaria_categoria in
    ('prefeito_vice', 'secretarios', 'auditor_procurador', 'comissionados', 'outros_agentes'));

comment on column public.processos_diarias.diaria_faixa is
  'Faixa de distância escolhida no formulário (linha da Tabela de Diárias).';
comment on column public.processos_diarias.diaria_categoria is
  'Categoria do cargo escolhida no formulário (coluna da Tabela de Diárias).';
comment on column public.processos_diarias.diaria_pernoite is
  'true quando a diária é COM pernoite. O acréscimo aplicado é o percentual da tabela vigente.';
comment on column public.processos_diarias.valor_unitario_manual is
  'true quando o valor unitário foi digitado à mão, diferente do que a tabela sugere. Vai para a auditoria.';
comment on column public.processos_diarias.diaria_valor_unitario is
  'CONGELADO na finalização: o valor unitário efetivamente utilizado. Atualizar a tabela não muda este número.';
comment on column public.processos_diarias.diaria_pernoite_percentual is
  'CONGELADO na finalização: o percentual de pernoite da tabela vigente naquele momento.';
comment on column public.processos_diarias.diaria_tabela_versao is
  'CONGELADO na finalização: a identificação da versão da Tabela de Diárias em vigor (título e data da atualização).';
comment on column public.processos_diarias.diaria_tabela_id is
  'CONGELADO na finalização: o id da linha de public.processos_diarias_tabela usada.';
comment on column public.processos_diarias.identidade_visual is
  'CONGELADO na finalização: brasão e dados institucionais do cabeçalho/rodapé vigentes. Trocar o logo depois não altera este documento.';

-- ---------------------------------------------------------------------------
-- 4. O que foi congelado não é reescrito
-- ---------------------------------------------------------------------------
-- Duas mudanças no gatilho já existente, e nenhuma regra antiga afrouxada:
--
--   a) as colunas de CONGELAMENTO entram na lista de controle, porque são
--      escritas pelo sistema no mesmo update que finaliza — e quem só tem
--      permissão de finalizar não deve precisar também de permissão de editar;
--   b) congelado UMA VEZ, congelado para sempre: alterar um valor de
--      congelamento já preenchido é recusado pelo banco, independentemente de
--      permissão. É a trava do item 6 e do item 12 — atualizar a Tabela de
--      Diárias ou trocar o brasão não altera processo já finalizado, e nem
--      sequer consegue.
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
    -- Congelamento da Tabela de Diárias e da identidade visual (escrito na finalização).
    'diaria_valor_unitario', 'diaria_pernoite_percentual', 'diaria_tabela_versao',
    'diaria_tabela_id', 'identidade_visual'
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
-- 5. RLS da Tabela de Diárias
-- ---------------------------------------------------------------------------
-- VER acompanha quem vê o módulo Processos. EDITAR exige o módulo próprio
-- 'processos_diarias_tabela' — permissão restrita, porque a tabela é um
-- parâmetro que afeta valores de pagamento.
--
-- Não há política de DELETE: versão de tabela não é apagada. É essa ausência
-- que garante que a tabela antiga continue disponível para consulta.
alter table public.processos_diarias_tabela enable row level security;

drop policy if exists "processos_diarias_tabela_select" on public.processos_diarias_tabela;
create policy "processos_diarias_tabela_select"
  on public.processos_diarias_tabela
  for select to authenticated
  using (public.pode_em_processos('processos_diarias', 'visualizar'));

drop policy if exists "processos_diarias_tabela_insert" on public.processos_diarias_tabela;
create policy "processos_diarias_tabela_insert"
  on public.processos_diarias_tabela
  for insert to authenticated
  with check (public.pode_em_processos('processos_diarias_tabela', 'editar'));

-- O update existe só para baixar a bandeira `vigente` da versão anterior: o
-- conteúdo de uma versão publicada não é reescrito, uma nova é inserida.
drop policy if exists "processos_diarias_tabela_update_vigencia" on public.processos_diarias_tabela;
create policy "processos_diarias_tabela_update_vigencia"
  on public.processos_diarias_tabela
  for update to authenticated
  using (public.pode_em_processos('processos_diarias_tabela', 'editar'))
  with check (public.pode_em_processos('processos_diarias_tabela', 'editar'));

revoke all on public.processos_diarias_tabela from anon;

-- ---------------------------------------------------------------------------
-- 5b. A identidade visual dos documentos (chave 'processos')
-- ---------------------------------------------------------------------------
-- O brasão e os dados institucionais do cabeçalho/rodapé moram na tabela
-- chave-valor public.configuracoes_sistema, na chave 'processos', como todas as
-- outras categorias da tela de Configurações.
--
-- A gravação continua sendo a que já existe: só quem pode EDITAR no módulo
-- 'administracao'. A leitura ganha uma política PERMISSIVA A MAIS, e só para
-- esta chave: quem vê o módulo Processos precisa ler o cabeçalho para imprimir o
-- documento. Políticas de select são somadas (OR), então NADA do que já era
-- visível deixa de ser, e nenhuma outra chave passa a ser visível.
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
      using (chave = 'processos' and public.pode_em_processos('processos_diarias', 'visualizar'))
  $pol$;
end $$;

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
  'processos_diarias_tabela',
  pp.pode_visualizar,
  false,
  coalesce(p.nome = 'Administrador', false),
  false, false, false
from public.perfis_permissoes pp
join public.perfis_acesso p on p.id = pp.perfil_id
where pp.modulo = 'processos_diarias'
  and not exists (
    select 1 from public.perfis_permissoes x
     where x.perfil_id = pp.perfil_id and x.modulo = 'processos_diarias_tabela'
  );

insert into public.perfis_permissoes (
  perfil_id, modulo,
  pode_visualizar, pode_cadastrar, pode_editar, pode_excluir, pode_aprovar, pode_visualizar_valores
)
select
  p.id, 'processos_diarias_tabela',
  p.nome = 'Administrador', false, p.nome = 'Administrador', false, false, false
from public.perfis_acesso p
where not exists (
  select 1 from public.perfis_permissoes x
   where x.perfil_id = p.id and x.modulo = 'processos_diarias_tabela'
);

-- ---------------------------------------------------------------------------
-- 7. A primeira versão da tabela: a vigente informada pela prefeitura
-- ---------------------------------------------------------------------------
-- Valores SEM pernoite, atualizados em 23/03/2026, com o acréscimo de 30% para
-- pernoite gravado como PARÂMETRO e a memória do cálculo ao lado. Entra só se a
-- tabela ainda estiver vazia: rodar de novo não duplica e não sobrescreve uma
-- atualização já feita pela prefeitura na tela.
insert into public.processos_diarias_tabela (
  titulo, atualizada_em, pernoite_percentual, memoria_calculo, valores, vigente
)
select
  'Tabela de Diárias',
  date '2026-03-23',
  30,
  'Variação do índice IGP-M entre 31-maio-2024 e 28-fevereiro-2026. Em percentual: 5,716740%. Em fator de multiplicação: 1,05716740.',
  jsonb_build_object(
    'al_ate_100', jsonb_build_object(
      'prefeito_vice', 597.70, 'secretarios', 271.67, 'auditor_procurador', 271.67,
      'comissionados', 115.91, 'outros_agentes', 97.78),
    'al_acima_100', jsonb_build_object(
      'prefeito_vice', 670.14, 'secretarios', 289.77, 'auditor_procurador', 289.77,
      'comissionados', 159.37, 'outros_agentes', 119.54),
    'nordeste', jsonb_build_object(
      'prefeito_vice', 796.84, 'secretarios', 398.48, 'auditor_procurador', 398.48,
      'comissionados', 191.98, 'outros_agentes', 137.64),
    'demais_regioes', jsonb_build_object(
      'prefeito_vice', 869.37, 'secretarios', 507.12, 'auditor_procurador', 507.12,
      'comissionados', 326.03, 'outros_agentes', 217.33)
  ),
  true
where not exists (select 1 from public.processos_diarias_tabela);

comment on table public.processos_diarias_tabela is
  'Tabela de Diárias (faixa de distância × categoria do cargo), VERSIONADA: cada atualização é uma linha nova e a anterior é preservada para consulta. Parâmetro documental — não debita conta, não dá baixa em NF, não altera saldo e não cria pagamento.';
comment on column public.processos_diarias_tabela.valores is
  'jsonb { faixa: { categoria: valor } }. Valores SEM pernoite; o acréscimo do pernoite é pernoite_percentual.';
comment on column public.processos_diarias_tabela.pernoite_percentual is
  'Acréscimo aplicado quando há pernoite, em percentual. Configurável com a tabela: não é número escrito no código.';
comment on column public.processos_diarias_tabela.memoria_calculo is
  'Memória do cálculo da atualização (índice, período, percentual e fator). Informativa.';
comment on column public.processos_diarias_tabela.vigente is
  'A versão em uso. Só uma por vez; as demais ficam para consulta e para explicar processos antigos.';

commit;
