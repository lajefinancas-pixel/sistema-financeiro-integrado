-- ⚠️⚠️ NÃO RODE ESTE ARQUIVO. ELE ABORTA. SUBSTITUÍDO POR:
--    supabase/migrations/20260912160000_storage_logomarca_politicas_corrigidas.sql
--
-- Este arquivo morre no SQL Editor com
--   ERROR: 42883: function public.pode_editar_configuracoes() does not exist
-- na primeira política que confere permissão, porque chama uma função que nunca
-- foi criada neste banco (ela só existe em 20260811140000_configuracoes_sistema.sql,
-- que ficou pela metade) e porque os blocos abaixo só tratam
-- `insufficient_privilege` -- um erro de outra classe aborta o script inteiro.
-- Nada dele chega a ser aplicado. O arquivo fica aqui apenas como registro; o
-- conserto, com a função garantida ANTES das políticas, está no arquivo acima.
--
-- ---------------------------------------------------------------------------
-- DEPÓSITO DE IMAGENS DO SISTEMA — BUCKET E POLÍTICAS DA LOGOMARCA/BRASÃO.
--
-- ATENÇÃO: esta migration precisa ser rodada MANUALMENTE no SQL Editor do
-- Supabase (projeto usado pela aplicação). Nada nela roda sozinho no deploy.
-- Arquivo: supabase/migrations/20260912130000_storage_logomarca.sql
--
-- ---------------------------------------------------------------------------
-- POR QUE ELA EXISTE
-- ---------------------------------------------------------------------------
-- Trocar a logomarca falhava SEMPRE, em Configurações -> Aparência e em
-- Configurações -> Processos -> Identidade visual, com "Não foi possível enviar
-- a logomarca. Tente outra imagem" -- inclusive com PNG de poucos KB, muito
-- abaixo do limite. Não era o arquivo: era o Storage recusando a gravação.
--
-- O bucket 'configuracoes' e as quatro políticas dele foram criados em
-- 20260811140000_configuracoes_sistema.sql. Aquela migration NÃO tem
-- begin/commit: se o `create policy ... on storage.objects` falhou por dono do
-- objeto (o SQL Editor de alguns projetos roda como um papel que não é dono de
-- storage.objects), o `insert into storage.buckets` ANTES dele pode ter passado
-- e as políticas DEPOIS dele não. Resultado: bucket existindo, gravação negada
-- pela RLS do Storage, e a tela sem conseguir dizer o motivo.
--
-- ---------------------------------------------------------------------------
-- O QUE ELA FAZ
-- ---------------------------------------------------------------------------
--   1. garante o bucket 'configuracoes' PÚBLICO (a imagem é lida por URL nos
--      cabeçalhos de impressão);
--   2. garante que o bucket não tenha teto de tamanho baixo nem lista de tipos
--      restrita — era outra causa possível da recusa;
--   3. recria as quatro políticas de storage.objects para o bucket, cada uma
--      dentro de um bloco que AVISA em vez de abortar quando o papel atual não
--      pode mexer em storage.objects;
--   4. no fim, mostra o que ficou valendo, para conferência.
--
-- ---------------------------------------------------------------------------
-- NÃO APAGA IMAGEM NENHUMA
-- ---------------------------------------------------------------------------
-- Nenhum `delete from storage.objects`, nenhum `update` em configuracoes_sistema.
-- A LOGOMARCA JÁ CADASTRADA CONTINUA EXATAMENTE ONDE ESTÁ, com a mesma URL.
-- Nada aqui toca em saldo, conta, fornecedor, nota, baixa, transferência,
-- programação, processo, permissão de usuário ou auditoria.
-- Rodar duas vezes tem o mesmo efeito de rodar uma.

-- ---------------------------------------------------------------------------
-- 1. O bucket
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('configuracoes', 'configuracoes', true)
on conflict (id) do nothing;

-- Já existia privado (criado à mão, por exemplo): passa a público, porque a
-- impressão carrega a imagem por URL.
update storage.buckets set public = true
 where id = 'configuracoes' and public is distinct from true;

-- Teto de tamanho e lista de tipos: em versões do Storage que têm estas colunas,
-- um teto baixo ou uma lista restrita recusam o envio com mensagem de MIME/tamanho.
-- 26 MB acompanha o teto do navegador (src/lib/logomarcaImagem.js, 25 MB) e a
-- lista fica nula = qualquer tipo, já que a validação de formato é da aplicação.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit'
  ) then
    execute $sql$
      update storage.buckets
         set file_size_limit = greatest(coalesce(file_size_limit, 0), 26214400)
       where id = 'configuracoes'
    $sql$;
  end if;

  if exists (
    select 1 from information_schema.columns
     where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types'
  ) then
    execute $sql$
      update storage.buckets set allowed_mime_types = null
       where id = 'configuracoes' and allowed_mime_types is not null
    $sql$;
  end if;
exception
  when insufficient_privilege then
    raise notice 'AVISO: o papel atual não pôde ajustar o bucket. Ajuste em Storage -> configuracoes -> Settings: público, limite 26 MB, sem lista de tipos.';
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. As políticas de storage.objects
-- ---------------------------------------------------------------------------
-- Cada uma num bloco próprio: se o papel do SQL Editor não for dono de
-- storage.objects, a execução AVISA qual política não pôde ser criada e segue,
-- em vez de abortar tudo e deixar metade no lugar (foi o que aconteceu antes).
-- Sem estas políticas o navegador não grava, e a aplicação cai na função
-- /api/configuracoes/logomarca, que grava com a chave de serviço.

-- Leitura pública: a imagem aparece em cabeçalho de relatório e de impressão.
do $$
begin
  drop policy if exists "configuracoes_leitura_publica" on storage.objects;
  create policy "configuracoes_leitura_publica"
    on storage.objects for select
    using (bucket_id = 'configuracoes');
exception
  when insufficient_privilege then
    raise notice 'AVISO: política configuracoes_leitura_publica NÃO criada (sem privilégio em storage.objects). Crie-a em Storage -> Policies.';
end;
$$;

-- Enviar: exige edição no módulo 'administracao', a mesma permissão da tela.
do $$
begin
  drop policy if exists "configuracoes_insert_administracao" on storage.objects;
  create policy "configuracoes_insert_administracao"
    on storage.objects for insert to authenticated
    with check (bucket_id = 'configuracoes' and public.pode_editar_configuracoes());
exception
  when insufficient_privilege then
    raise notice 'AVISO: política configuracoes_insert_administracao NÃO criada (sem privilégio em storage.objects). Crie-a em Storage -> Policies.';
end;
$$;

do $$
begin
  drop policy if exists "configuracoes_update_administracao" on storage.objects;
  create policy "configuracoes_update_administracao"
    on storage.objects for update to authenticated
    using (bucket_id = 'configuracoes' and public.pode_editar_configuracoes())
    with check (bucket_id = 'configuracoes' and public.pode_editar_configuracoes());
exception
  when insufficient_privilege then
    raise notice 'AVISO: política configuracoes_update_administracao NÃO criada (sem privilégio em storage.objects). Crie-a em Storage -> Policies.';
end;
$$;

do $$
begin
  drop policy if exists "configuracoes_delete_administracao" on storage.objects;
  create policy "configuracoes_delete_administracao"
    on storage.objects for delete to authenticated
    using (bucket_id = 'configuracoes' and public.pode_editar_configuracoes());
exception
  when insufficient_privilege then
    raise notice 'AVISO: política configuracoes_delete_administracao NÃO criada (sem privilégio em storage.objects). Crie-a em Storage -> Policies.';
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Conferência
-- ---------------------------------------------------------------------------
-- O bucket existe e está público?
select id, name, public from storage.buckets where id = 'configuracoes';

-- As quatro políticas ficaram no lugar? Tem de vir 4 linhas.
select policyname, cmd
  from pg_policies
 where schemaname = 'storage' and tablename = 'objects'
   and policyname like 'configuracoes_%'
 order by policyname;

-- As imagens já enviadas continuam lá (a logomarca em uso NÃO foi tocada).
select name, created_at
  from storage.objects
 where bucket_id = 'configuracoes'
 order by created_at desc
 limit 10;
