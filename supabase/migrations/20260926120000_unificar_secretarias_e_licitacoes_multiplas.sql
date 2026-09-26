-- Cadastro único de secretarias e vínculos múltiplos em licitações/contratos.
-- Rodar manualmente no SQL Editor do Supabase. Esta migration é aditiva e
-- preserva os identificadores financeiros e os vínculos documentais existentes.

begin;

create extension if not exists unaccent;

create or replace function public.chave_secretaria(valor text)
returns text language sql immutable set search_path = public as $$
  select regexp_replace(
    lower(unaccent(btrim(coalesce(valor, '')))),
    '^(secretaria municipal|secretaria|sec[.]?)[ ]+(de|da|do|das|dos)?[ ]*',
    ''
  );
$$;

alter table public.secretarias
  add column if not exists cadastro_unico_id uuid default gen_random_uuid(),
  add column if not exists possui_financeiro boolean not null default false,
  add column if not exists nome_curto text,
  add column if not exists secretario text,
  add column if not exists secretario_cpf text,
  add column if not exists secretario_cargo text;

update public.secretarias set cadastro_unico_id = gen_random_uuid() where cadastro_unico_id is null;
create unique index if not exists secretarias_cadastro_unico_id_uq
  on public.secretarias (cadastro_unico_id);
create index if not exists secretarias_financeiras_ativas_idx
  on public.secretarias (possui_financeiro, ativo, nome);

-- Consolida eventuais duplicatas preexistentes pelo núcleo do nome. Todas as
-- FKs simples que apontam para secretarias são redirecionadas antes da remoção.
do $$
declare fk record;
begin
  for fk in
    select conrelid::regclass as tabela,
           (select attname from pg_attribute where attrelid=c.conrelid and attnum=c.conkey[1]) as coluna
    from pg_constraint c
    where c.contype='f' and c.confrelid='public.secretarias'::regclass
      and array_length(c.conkey,1)=1
  loop
    execute format($sql$
      update %s filho set %I = manter.id
      from public.secretarias duplicada
      join public.secretarias manter
        on public.chave_secretaria(manter.nome)=public.chave_secretaria(duplicada.nome)
       and manter.ctid=(select min(x.ctid) from public.secretarias x where public.chave_secretaria(x.nome)=public.chave_secretaria(duplicada.nome))
      where filho.%I=duplicada.id and duplicada.id<>manter.id
    $sql$, fk.tabela, fk.coluna, fk.coluna);
  end loop;

  delete from public.secretarias duplicada
  using public.secretarias manter
  where public.chave_secretaria(manter.nome)=public.chave_secretaria(duplicada.nome)
    and manter.ctid=(select min(x.ctid) from public.secretarias x where public.chave_secretaria(x.nome)=public.chave_secretaria(duplicada.nome))
    and duplicada.id<>manter.id;
end $$;

create unique index if not exists secretarias_nome_normalizado_uq
  on public.secretarias (public.chave_secretaria(nome));

-- Nomes curtos preexistentes (por exemplo, "Educação") conservam o mesmo ID
-- e recebem o nome oficial aprovado, evitando criar uma segunda secretaria.
update public.secretarias s set nome = v.nome
from (values
  ('Secretaria Municipal de Educação'), ('Secretaria Municipal da Mulher'),
  ('Secretaria Municipal de Administração'), ('Secretaria Municipal de Agricultura'),
  ('Secretaria Municipal de Assistência Social'), ('Secretaria Municipal de Comunicação e Eventos'),
  ('Secretaria Municipal de Cultura e Turismo'), ('Secretaria Municipal de Desporto'),
  ('Secretaria Municipal de Finanças'), ('Secretaria Municipal de Governo'),
  ('Secretaria Municipal de Infraestrutura'), ('Secretaria Municipal de Saúde'),
  ('Secretaria Municipal de Transportes e Abastecimento')
) as v(nome)
where public.chave_secretaria(s.nome) = public.chave_secretaria(v.nome)
  and not exists (
    select 1 from public.secretarias oficial
    where lower(unaccent(btrim(oficial.nome))) = lower(unaccent(btrim(v.nome)))
  );

-- A carga aprovada. Reaproveita a linha existente quando o nome já está no
-- cadastro; novos nomes entram ativos e não financeiros por padrão.
insert into public.secretarias (nome, ativo, possui_financeiro)
select v.nome, true, v.financeiro
from (values
  ('Secretaria Municipal de Educação', true),
  ('Secretaria Municipal da Mulher', false),
  ('Secretaria Municipal de Administração', false),
  ('Secretaria Municipal de Agricultura', false),
  ('Secretaria Municipal de Assistência Social', true),
  ('Secretaria Municipal de Comunicação e Eventos', false),
  ('Secretaria Municipal de Cultura e Turismo', false),
  ('Secretaria Municipal de Desporto', false),
  ('Secretaria Municipal de Finanças', true),
  ('Secretaria Municipal de Governo', false),
  ('Secretaria Municipal de Infraestrutura', false),
  ('Secretaria Municipal de Saúde', true),
  ('Secretaria Municipal de Transportes e Abastecimento', false)
) as v(nome, financeiro)
where not exists (
  select 1 from public.secretarias s
  where public.chave_secretaria(s.nome) = public.chave_secretaria(v.nome)
);

-- A marca é deliberadamente exclusiva: somente as quatro aprovadas ficam SIM.
update public.secretarias
set possui_financeiro = lower(unaccent(nome)) similar to
  '%(financ|saude|educac|assistencia social)%';

-- Traz os dados complementares do antigo cadastro de Processos para a linha
-- única, sem sobrescrever informação já preenchida.
update public.secretarias s
set nome_curto = coalesce(s.nome_curto, p.nome_curto),
    secretario = coalesce(s.secretario, p.secretario),
    secretario_cpf = coalesce(s.secretario_cpf, p.secretario_cpf),
    secretario_cargo = coalesce(s.secretario_cargo, p.secretario_cargo)
from public.processos_secretarias_solicitantes p
where public.chave_secretaria(s.nome) = public.chave_secretaria(p.nome);

-- Processos passam a referenciar a chave UUID estável do cadastro único. A
-- tabela anterior permanece somente como legado recuperável e não recebe dados.
do $$
declare tabela text;
begin
  foreach tabela in array array['processos_diarias','processos_servicos','processos_servidores'] loop
    if to_regclass('public.' || tabela) is null then continue; end if;
    execute format('alter table public.%I drop constraint if exists %I', tabela, tabela || '_solicitante_fkey');
    execute format($sql$
      update public.%I x set solicitante_id = s.cadastro_unico_id
      from public.processos_secretarias_solicitantes p
      join public.secretarias s
        on public.chave_secretaria(s.nome) = public.chave_secretaria(p.nome)
      where x.solicitante_id = p.id
    $sql$, tabela);
    execute format(
      'alter table public.%I add constraint %I foreign key (solicitante_id) references public.secretarias(cadastro_unico_id) on delete set null',
      tabela, tabela || '_solicitante_fkey'
    );
  end loop;
end $$;

-- Relação N:N de licitações/contratos. O tipo da secretaria é copiado do
-- cadastro existente para funcionar tanto com bigint quanto com uuid.
do $$
declare tipo_secretaria text;
begin
  select format_type(atttypid, atttypmod) into tipo_secretaria
  from pg_attribute
  where attrelid='public.secretarias'::regclass and attname='id' and not attisdropped;

  if to_regclass('public.licitacoes_contratos_secretarias') is null then
    execute format($ddl$
      create table public.licitacoes_contratos_secretarias (
        licitacao_contrato_id uuid not null references public.licitacoes_contratos(id) on delete cascade,
        secretaria_id %s not null references public.secretarias(id) on delete restrict,
        criado_em timestamptz not null default now(),
        primary key (licitacao_contrato_id, secretaria_id)
      )
    $ddl$, tipo_secretaria);
  end if;
end $$;

insert into public.licitacoes_contratos_secretarias (licitacao_contrato_id, secretaria_id)
select id, secretaria_id from public.licitacoes_contratos where secretaria_id is not null
on conflict do nothing;

alter table public.licitacoes_contratos
  add column if not exists todas_secretarias boolean not null default false;

create index if not exists licitacoes_secretarias_por_secretaria_idx
  on public.licitacoes_contratos_secretarias (secretaria_id, licitacao_contrato_id);

alter table public.licitacoes_contratos_secretarias enable row level security;
drop policy if exists "licitacoes_secretarias_select" on public.licitacoes_contratos_secretarias;
create policy "licitacoes_secretarias_select" on public.licitacoes_contratos_secretarias
  for select to authenticated using (public.pode_em_licitacoes_contratos('visualizar'));
drop policy if exists "licitacoes_secretarias_insert" on public.licitacoes_contratos_secretarias;
create policy "licitacoes_secretarias_insert" on public.licitacoes_contratos_secretarias
  for insert to authenticated with check (public.pode_em_licitacoes_contratos('cadastrar'));
drop policy if exists "licitacoes_secretarias_update" on public.licitacoes_contratos_secretarias;
create policy "licitacoes_secretarias_update" on public.licitacoes_contratos_secretarias
  for update to authenticated using (public.pode_em_licitacoes_contratos('editar'))
  with check (public.pode_em_licitacoes_contratos('editar'));
drop policy if exists "licitacoes_secretarias_delete" on public.licitacoes_contratos_secretarias;
create policy "licitacoes_secretarias_delete" on public.licitacoes_contratos_secretarias
  for delete to authenticated using (public.pode_em_licitacoes_contratos('editar'));
grant select, insert, update, delete on public.licitacoes_contratos_secretarias to authenticated;
revoke all on public.licitacoes_contratos_secretarias from anon;

-- Gestão do cadastro único: leitura para autenticados; escrita somente para
-- quem administra Configurações. Mantém as políticas existentes compatíveis.
create or replace function public.eh_administrador()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.usuarios u
    join public.perfis_acesso p on p.id = u.perfil_id
    where u.auth_id = auth.uid() and u.status = 'ativo'
      and lower(unaccent(p.nome)) = 'administrador'
  );
$$;
drop policy if exists "secretarias_insert_administracao" on public.secretarias;
create policy "secretarias_insert_administracao" on public.secretarias
  for insert to authenticated with check (public.eh_administrador());
drop policy if exists "secretarias_update_administracao" on public.secretarias;
create policy "secretarias_update_administracao" on public.secretarias
  for update to authenticated using (public.eh_administrador())
  with check (public.eh_administrador());

comment on column public.secretarias.possui_financeiro is
  'Define se a secretaria aparece em Saldos, contas bancárias, baixas, transferências e demais escolhas financeiras.';
comment on table public.licitacoes_contratos_secretarias is
  'Vínculo de uma licitação/contrato com uma ou várias secretarias do cadastro único.';

commit;
