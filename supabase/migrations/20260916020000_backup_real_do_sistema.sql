-- Backup real do sistema. A exportacao e acessivel somente pela service role.
-- O catalogo e descoberto em tempo de execucao para incluir automaticamente
-- tabelas atuais e futuras do schema public.

alter table public.backups_log
  add column if not exists arquivo_caminho text,
  add column if not exists tabelas_incluidas text[],
  add column if not exists formato text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('backups-sistema', 'backups-sistema', false, null, array['application/gzip'])
on conflict (id) do update
set public = false,
    allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.exportar_backup_completo()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  tabela record;
  linhas jsonb;
  conteudo jsonb := '{}'::jsonb;
  contagens jsonb := '{}'::jsonb;
  nomes text[] := array[]::text[];
begin
  if auth.role() <> 'service_role' then
    raise exception 'A exportacao exige credencial de servico.' using errcode = '42501';
  end if;

  for tabela in
    select c.relname as nome
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('r', 'p')
     order by c.relname
  loop
    execute format('select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from public.%I t', tabela.nome)
       into linhas;
    conteudo := conteudo || jsonb_build_object(tabela.nome, linhas);
    contagens := contagens || jsonb_build_object(tabela.nome, jsonb_array_length(linhas));
    nomes := array_append(nomes, tabela.nome);
  end loop;

  return jsonb_build_object(
    'formato', 'lajefinancas-backup-v1',
    'gerado_em', now(),
    'schema', 'public',
    'tabelas', nomes,
    'contagens', contagens,
    'dados', conteudo
  );
end;
$$;

revoke all on function public.exportar_backup_completo() from public, anon, authenticated;
grant execute on function public.exportar_backup_completo() to service_role;

comment on function public.exportar_backup_completo() is
  'Exporta todas as tabelas fisicas de public para a Edge Function de backup; service role somente.';

