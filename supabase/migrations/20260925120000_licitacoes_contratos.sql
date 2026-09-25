-- Acompanhamento documental de licitações e contratos, sempre vinculado ao
-- fornecedor existente. Não altera fornecedores nem qualquer tabela financeira.

create table if not exists public.tipos_licitacao_contrato (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

-- Os ids legados variam entre instalações; copiar o tipo real evita qualquer
-- conversão e mantém o vínculo estritamente por FK, como em Certidões.
do $$
declare tipo_fornecedor text; tipo_secretaria text; tipo_usuario text;
begin
  if to_regclass('public.licitacoes_contratos') is not null then return; end if;
  select format_type(atttypid, atttypmod) into tipo_fornecedor from pg_attribute where attrelid='public.fornecedores'::regclass and attname='id';
  select format_type(atttypid, atttypmod) into tipo_secretaria from pg_attribute where attrelid='public.secretarias'::regclass and attname='id';
  select format_type(atttypid, atttypmod) into tipo_usuario from pg_attribute where attrelid='public.usuarios'::regclass and attname='id';
  execute format($ddl$ create table public.licitacoes_contratos (
    id uuid primary key default gen_random_uuid(),
    fornecedor_id %1$s not null references public.fornecedores(id) on delete restrict,
    tipo_id uuid not null references public.tipos_licitacao_contrato(id) on delete restrict,
    numero text not null, objeto text not null, data_inicio date not null,
    data_validade date not null, valor numeric(15,2),
    secretaria_id %2$s references public.secretarias(id) on delete set null,
    observacoes text, encerrado boolean not null default false,
    criado_por %3$s references public.usuarios(id) on delete set null,
    criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now(),
    constraint licitacoes_datas_validas check (data_validade >= data_inicio),
    constraint licitacoes_valor_valido check (valor is null or valor >= 0)
  ) $ddl$, tipo_fornecedor, tipo_secretaria, tipo_usuario);
end $$;

create table if not exists public.licitacoes_contratos_anexos (
  id uuid primary key default gen_random_uuid(),
  licitacao_contrato_id uuid not null references public.licitacoes_contratos(id) on delete cascade,
  nome text not null,
  arquivo_url text not null,
  criado_em timestamptz not null default now()
);

create index if not exists licitacoes_fornecedor_idx on public.licitacoes_contratos(fornecedor_id);
create index if not exists licitacoes_validade_idx on public.licitacoes_contratos(data_validade);
create index if not exists licitacoes_secretaria_idx on public.licitacoes_contratos(secretaria_id);

create or replace function public.licitacoes_marcar_atualizacao() returns trigger language plpgsql as $$
begin new.atualizado_em := now(); return new; end;
$$;
drop trigger if exists licitacoes_atualizado_em on public.licitacoes_contratos;
create trigger licitacoes_atualizado_em before update on public.licitacoes_contratos
for each row execute function public.licitacoes_marcar_atualizacao();

insert into public.tipos_licitacao_contrato(nome) values
 ('Licitação'), ('Dispensa'), ('Inexigibilidade'), ('Contrato direto'),
 ('Ata de registro de preços'), ('Outro')
on conflict (nome) do nothing;

-- Herda a autorização do módulo Fornecedores, sem criar uma matriz paralela.
create or replace function public.pode_em_licitacoes_contratos(acao text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.usuarios u
    join public.permissoes_efetivas p on p.usuario_id = u.id
    where u.auth_id = auth.uid() and p.modulo = 'fornecedores'
      and case acao
        when 'visualizar' then p.pode_visualizar
        when 'cadastrar' then p.pode_cadastrar
        when 'editar' then p.pode_editar
        when 'excluir' then p.pode_excluir
        else false end
  );
$$;
grant execute on function public.pode_em_licitacoes_contratos(text) to authenticated;

alter table public.tipos_licitacao_contrato enable row level security;
alter table public.licitacoes_contratos enable row level security;
alter table public.licitacoes_contratos_anexos enable row level security;

do $$ declare t text; begin
  foreach t in array array['tipos_licitacao_contrato','licitacoes_contratos','licitacoes_contratos_anexos'] loop
    execute format('drop policy if exists %I on public.%I', t || '_ver', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.pode_em_licitacoes_contratos(''visualizar''))', t || '_ver', t);
    execute format('drop policy if exists %I on public.%I', t || '_criar', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.pode_em_licitacoes_contratos(''cadastrar''))', t || '_criar', t);
    execute format('drop policy if exists %I on public.%I', t || '_editar', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.pode_em_licitacoes_contratos(''editar'')) with check (public.pode_em_licitacoes_contratos(''editar''))', t || '_editar', t);
    execute format('drop policy if exists %I on public.%I', t || '_excluir', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.pode_em_licitacoes_contratos(''excluir''))', t || '_excluir', t);
  end loop;
end $$;

grant select, insert, update, delete on public.tipos_licitacao_contrato, public.licitacoes_contratos, public.licitacoes_contratos_anexos to authenticated;

insert into storage.buckets(id, name, public) values ('licitacoes-contratos-anexos','licitacoes-contratos-anexos',true)
on conflict (id) do nothing;
drop policy if exists "licitacoes_anexos_leitura" on storage.objects;
create policy "licitacoes_anexos_leitura" on storage.objects for select using (bucket_id='licitacoes-contratos-anexos');
drop policy if exists "licitacoes_anexos_gravar" on storage.objects;
create policy "licitacoes_anexos_gravar" on storage.objects for insert to authenticated with check (bucket_id='licitacoes-contratos-anexos' and public.pode_em_licitacoes_contratos('cadastrar'));
drop policy if exists "licitacoes_anexos_excluir" on storage.objects;
create policy "licitacoes_anexos_excluir" on storage.objects for delete to authenticated using (bucket_id='licitacoes-contratos-anexos' and public.pode_em_licitacoes_contratos('excluir'));
