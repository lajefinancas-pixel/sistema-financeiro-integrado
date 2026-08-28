-- Cadastro de contas bancárias (módulo Saldos das Contas).
--
-- O que esta migration acrescenta, sem tocar em nenhum saldo já lançado:
--
--   1. public.fontes_recurso  -> catálogo das fontes de recurso (FPM, FUNDEB,
--      recursos próprios, ...), para que a conta possa apontar a sua fonte.
--   2. contas_bancarias.fonte_recurso_id -> a coluna que liga a conta à fonte.
--      Criada apenas se ainda não existir; se já existir, é reaproveitada.
--   3. contas_bancarias.ativo -> garantia de que a coluna existe (é ela que
--      desativa a conta sem apagar o histórico).
--   4. Unicidade da conta: mesma secretaria + mesmo banco + mesmo número não
--      pode repetir entre as contas ATIVAS.
--   5. public.pode_em_saldos(acao) -> mesma forma de public.pode_em_certidoes,
--      usada nas políticas da tabela nova.
--
-- O saldo continua morando SÓ em public.saldos_historico, por data. Nada aqui
-- insere, altera ou apaga linha de saldo, e nenhuma coluna é removida.
--
-- IDEMPOTENTE: pode rodar mais de uma vez sem efeito colateral.

begin;

-- ---------------------------------------------------------------------------
-- 0. Validação dos tipos reais antes de qualquer alteração de estrutura
-- ---------------------------------------------------------------------------
do $$
declare
  item record;
  tipo_real text;
begin
  for item in
    select * from (values
      ('contas_bancarias', 'id', 'integer'),
      ('contas_bancarias', 'secretaria_id', 'integer'),
      ('contas_bancarias', 'banco_id', 'integer'),
      ('saldos_historico', 'conta_id', 'integer')
    ) as tipos(tabela, coluna, esperado)
  loop
    if to_regclass(format('public.%I', item.tabela)) is null then
      raise exception 'Estrutura incompatível: public.% não existe.', item.tabela;
    end if;

    select format_type(a.atttypid, a.atttypmod)
      into tipo_real
      from pg_attribute a
     where a.attrelid = to_regclass(format('public.%I', item.tabela))
       and a.attname = item.coluna
       and not a.attisdropped;

    if tipo_real is distinct from item.esperado then
      raise exception 'Tipo incompatível em public.%.%: esperado %, encontrado %.',
        item.tabela, item.coluna, item.esperado, coalesce(tipo_real, 'coluna ausente');
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Permissão do módulo Saldos, no mesmo formato dos outros módulos
-- ---------------------------------------------------------------------------
-- Cadastrar conta bancária   -> pode_cadastrar
-- Editar conta bancária      -> pode_editar
-- Desativar/reativar conta   -> pode_excluir
create or replace function public.pode_em_saldos(acao text)
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
     and pe.modulo = 'saldos'
    where u.auth_id = auth.uid()
      and u.status = 'ativo'
      and case acao
            when 'visualizar' then pe.pode_visualizar
            when 'cadastrar'  then pe.pode_cadastrar
            when 'editar'     then pe.pode_editar
            when 'excluir'    then pe.pode_excluir
            when 'aprovar'    then pe.pode_aprovar
            else false
          end
  );
$$;

-- ---------------------------------------------------------------------------
-- 2. Catálogo de fontes de recurso
-- ---------------------------------------------------------------------------
create table if not exists public.fontes_recurso (
  id serial primary key,
  nome text not null,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists fontes_recurso_nome_idx
  on public.fontes_recurso (lower(nome));

alter table public.fontes_recurso enable row level security;

-- Leitura livre para quem está autenticado: o nome da fonte aparece junto da
-- conta em Saldos, Histórico e Relatórios.
drop policy if exists "fontes_recurso_select" on public.fontes_recurso;
create policy "fontes_recurso_select"
  on public.fontes_recurso
  for select
  to authenticated
  using (true);

drop policy if exists "fontes_recurso_insert" on public.fontes_recurso;
create policy "fontes_recurso_insert"
  on public.fontes_recurso
  for insert
  to authenticated
  with check (public.pode_em_saldos('cadastrar'));

drop policy if exists "fontes_recurso_update" on public.fontes_recurso;
create policy "fontes_recurso_update"
  on public.fontes_recurso
  for update
  to authenticated
  using (public.pode_em_saldos('editar'))
  with check (public.pode_em_saldos('editar'));

-- Sem política de delete: fonte usada por conta com histórico não se apaga.

-- ---------------------------------------------------------------------------
-- 3. Colunas do cadastro da conta
-- ---------------------------------------------------------------------------
alter table public.contas_bancarias
  add column if not exists fonte_recurso_id integer,
  add column if not exists ativo boolean not null default true;

-- Ligação com o catálogo, só quando é seguro: mesma família de tipo, nenhuma
-- chave estrangeira já declarada na coluna e nenhum valor órfão para validar.
-- Fora dessas condições a coluna continua existindo e sendo usada; apenas sem
-- a restrição, para que a migration nunca falhe num banco já povoado.
do $$
declare
  tipo_fonte text;
  ja_tem_fk boolean;
  tem_orfao boolean;
begin
  select format_type(a.atttypid, a.atttypmod)
    into tipo_fonte
    from pg_attribute a
   where a.attrelid = to_regclass('public.fontes_recurso')
     and a.attname = 'id'
     and not a.attisdropped;

  select exists (
    select 1
      from pg_constraint c
     where c.conrelid = to_regclass('public.contas_bancarias')
       and c.contype = 'f'
       and exists (
         select 1
           from pg_attribute a
          where a.attrelid = c.conrelid
            and a.attnum = any (c.conkey)
            and a.attname = 'fonte_recurso_id'
       )
  ) into ja_tem_fk;

  select exists (
    select 1
      from public.contas_bancarias cb
     where cb.fonte_recurso_id is not null
       and not exists (
         select 1 from public.fontes_recurso f where f.id = cb.fonte_recurso_id
       )
  ) into tem_orfao;

  if tipo_fonte = 'integer' and not ja_tem_fk and not tem_orfao then
    alter table public.contas_bancarias
      add constraint contas_bancarias_fonte_recurso_fkey
      foreign key (fonte_recurso_id) references public.fontes_recurso (id);
  elsif tem_orfao then
    raise notice 'contas_bancarias.fonte_recurso_id tem valores fora de public.fontes_recurso: a coluna segue em uso, sem chave estrangeira.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Unicidade da conta entre as contas ativas
-- ---------------------------------------------------------------------------
-- Mesma secretaria + mesmo banco + mesmo número não repete. A comparação
-- ignora pontos, traços e espaços ("2.042-7" e "20427" são a mesma conta) e
-- vale só para contas ativas: uma conta desativada não impede o cadastro, o
-- sistema oferece reativá-la.
--
-- Se o banco já tiver duplicidade cadastrada, o índice NÃO é criado (nenhum
-- dado é apagado nem alterado) e fica o aviso: a validação da tela continua
-- valendo para os cadastros novos.
do $$
declare
  duplicadas integer;
begin
  select count(*)
    into duplicadas
    from (
      select 1
        from public.contas_bancarias
       where ativo is true
         and coalesce(numero_conta, '') <> ''
       group by secretaria_id,
                banco_id,
                upper(regexp_replace(numero_conta, '[^0-9A-Za-z]', '', 'g'))
      having count(*) > 1
    ) grupos;

  if duplicadas > 0 then
    raise notice 'public.contas_bancarias tem % grupo(s) de contas ativas repetidas (secretaria + banco + número). O índice de unicidade não foi criado; nada foi alterado.', duplicadas;
  else
    create unique index if not exists contas_bancarias_conta_unica_idx
      on public.contas_bancarias (
        secretaria_id,
        banco_id,
        upper(regexp_replace(numero_conta, '[^0-9A-Za-z]', '', 'g'))
      )
      where ativo is true and numero_conta is not null and numero_conta <> '';
  end if;
end $$;

-- Listagem das contas desativadas (seção separada da tela de Saldos).
create index if not exists contas_bancarias_situacao_idx
  on public.contas_bancarias (ativo, secretaria_id);

commit;
