-- DEPÓSITO DE IMAGENS DO SISTEMA — BUCKET E POLÍTICAS DA LOGOMARCA/BRASÃO.
--
-- ATENÇÃO: esta migration precisa ser rodada MANUALMENTE no SQL Editor do
-- Supabase (projeto usado pela aplicação). Nada nela roda sozinho no deploy.
-- Arquivo: supabase/migrations/20260912160000_storage_logomarca_politicas_corrigidas.sql
--
-- ⚠️ ESTA SUBSTITUI 20260912130000_storage_logomarca.sql, que ABORTAVA. Rode
-- ESTA. Não é preciso desfazer nada da anterior: ela parou na primeira política
-- e não deixou nada gravado.
--
-- ---------------------------------------------------------------------------
-- O QUE ESTAVA ERRADO
-- ---------------------------------------------------------------------------
-- A migration anterior morria no SQL Editor com:
--
--   ERROR: 42883: function public.pode_editar_configuracoes() does not exist
--   CONTEXT: SQL statement "create policy "configuracoes_insert_administracao"
--            on storage.objects for insert to authenticated
--            with check (bucket_id = 'configuracoes' and public.pode_editar_configuracoes())"
--
-- Duas causas somadas:
--
--   1. ELA CHAMAVA UMA FUNÇÃO QUE NÃO EXISTE NESTE BANCO.
--      public.pode_editar_configuracoes() só é definida em
--      20260811140000_configuracoes_sistema.sql -- a mesma migration que, por
--      não ter transação, ficou pela metade. O 42883 é a prova de que ela nunca
--      chegou ao fim: o bucket entrou, as funções não.
--
--   2. OS BLOCOS SÓ TRATAVAM `insufficient_privilege`.
--      Um erro de outra classe -- e 42883 undefined_function é de outra classe
--      -- escapava do `exception when insufficient_privilege`, abortava o script
--      inteiro e derrubava também as três políticas seguintes. Por isso "nada
--      foi aplicado" e o envio da logomarca continuou falhando.
--
-- ---------------------------------------------------------------------------
-- COMO A PERMISSÃO DE "EDITAR CONFIGURAÇÕES" É RESOLVIDA DE FATO
-- ---------------------------------------------------------------------------
-- Não por um nome próprio de tela, e sim pelo MÓDULO: é `pode_editar` no módulo
-- 'administracao', lido da view public.permissoes_efetivas. É exatamente isso
-- que a tela confere (src/lib/permissoesUsuario.js) e que a função do servidor
-- confere antes de gravar com a chave de serviço
-- (netlify/functions/enviar-logomarca.mts: MODULO = "administracao",
-- select pode_editar from permissoes_efetivas where modulo = MODULO).
--
-- E o padrão deste projeto para isso é UMA FUNÇÃO POR MÓDULO, recebendo a ação:
--
--   public.pode_em_administracao(acao)          -- 20260823160000
--   public.pode_em_processos(modulo, acao)      -- 20260911160000
--   public.pode_em_baixas(acao)                 -- 20260911120000
--   public.pode_em_pagamentos_fase2(acao)       -- 20260828140000
--   public.pode_em_saldos(acao)                 -- 20260828120000
--   public.pode_em_certidoes(acao)              -- 20260823120000
--
-- Então as quatro políticas passam a chamar public.pode_em_administracao('editar')
-- -- a função do padrão, que JÁ EXISTE no projeto -- em vez de
-- public.pode_editar_configuracoes(), que nunca foi criada neste banco.
--
-- ---------------------------------------------------------------------------
-- O QUE ESTA MIGRATION FAZ, NESTA ORDEM
-- ---------------------------------------------------------------------------
--   1. garante o bucket 'configuracoes' público, sem teto baixo e sem lista de
--      tipos restrita (passo idempotente, e o único que já existia antes);
--   2. GARANTE A FUNÇÃO DE PERMISSÃO ANTES DAS POLÍTICAS. Se
--      public.pode_em_administracao(text) não existir, ela é criada aqui, com o
--      MESMO corpo de 20260823160000 -- nenhuma permissão muda de valor para
--      ninguém --, e recebe grant execute para authenticated. Se a função não
--      puder ser garantida, o script PARA AQUI, antes de encostar em política
--      alguma: não há como ficar metade no lugar;
--   3. recria as QUATRO políticas do bucket (select, insert, update, delete) --
--      a anterior tinha o mesmo defeito nas três que checam permissão, e a de
--      leitura pública nem função chama. Cada uma num bloco próprio que trata
--      insufficient_privilege E qualquer outro erro, avisando o nome da política
--      e o motivo (SQLSTATE/SQLERRM) e seguindo para a próxima;
--   4. no fim, mostra o que ficou valendo, para conferência.
--
-- ---------------------------------------------------------------------------
-- NÃO APAGA IMAGEM NENHUMA
-- ---------------------------------------------------------------------------
-- ⚠️ A LOGOMARCA EM USO NÃO É PERDIDA. Não há `delete from storage.objects`,
-- não há `delete from storage.buckets`, não há `update` em
-- public.configuracoes_sistema: o arquivo já enviado continua onde está, com a
-- mesma URL pública, e a linha que guarda essa URL não é tocada. Só políticas
-- de acesso são recriadas -- e recriar política não mexe em arquivo.
--
-- Nada aqui toca em saldo, conta, fornecedor, nota, baixa, transferência,
-- programação diária, processo, permissão de usuário, auditoria ou backup.
-- É IDEMPOTENTE: rodar duas vezes tem o mesmo efeito de rodar uma.

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
  when others then
    raise notice 'AVISO: o bucket não pôde ser ajustado (% / %). Ajuste em Storage -> configuracoes -> Settings.', sqlstate, sqlerrm;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. A FUNÇÃO DE PERMISSÃO, ANTES DAS POLÍTICAS
-- ---------------------------------------------------------------------------
-- É o conserto do 42883. A função é a do padrão do projeto e o corpo é o MESMO
-- de 20260823160000_lixeira_restauracao_exclusao_definitiva.sql, copiado sem
-- alteração: quem já podia editar continua podendo, quem não podia continua não
-- podendo. `create or replace` sobre uma função idêntica não muda nada.
--
-- Ela é criada só se as duas origens de permissão existirem -- public.usuarios e
-- a view public.permissoes_efetivas --, porque uma função `language sql` tem o
-- corpo validado na criação e falharia com elas ausentes.
--
-- ⚠️ A EXISTÊNCIA É CONFERIDA COM `to_regprocedure`, e não comparando o texto
-- de pg_get_function_identity_arguments com 'text': esse texto INCLUI o nome do
-- parâmetro ('acao text'), então a comparação com 'text' nunca casaria e a
-- função seria recriada sempre -- inclusive num banco onde ela existe e a view
-- de permissões não pudesse ser lida. `to_regprocedure` compara por assinatura,
-- sem depender do nome do parâmetro, e devolve nulo em vez de erro quando a
-- função não existe.
do $$
declare
  tem_funcao boolean;
begin
  tem_funcao := to_regprocedure('public.pode_em_administracao(text)') is not null;

  if tem_funcao then
    raise notice 'OK: public.pode_em_administracao(text) já existe -- nada a criar.';
  elsif to_regclass('public.usuarios') is null or to_regclass('public.permissoes_efetivas') is null then
    raise exception
      'PARADO ANTES DE MUDAR QUALQUER COISA: public.pode_em_administracao(text) não existe e não pode ser criada, porque falta public.usuarios ou a view public.permissoes_efetivas. Rode primeiro as migrations de usuários e permissões e execute este arquivo de novo. Nenhuma política foi tocada.';
  else
    execute $sql$
      create or replace function public.pode_em_administracao(acao text)
      returns boolean
      language sql
      stable
      security definer
      set search_path = public
      as $corpo$
        select exists (
          select 1
          from public.usuarios u
          join public.permissoes_efetivas pe
            on pe.usuario_id = u.id
           and pe.modulo = 'administracao'
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
      $corpo$
    $sql$;
    raise notice 'OK: public.pode_em_administracao(text) criada (corpo igual ao de 20260823160000).';
  end if;

  begin
    execute 'grant execute on function public.pode_em_administracao(text) to authenticated';
  exception
    when others then
      raise notice 'AVISO: grant execute em public.pode_em_administracao(text) não pôde ser aplicado (% / %).', sqlstate, sqlerrm;
  end;
end;
$$;

-- Daqui para baixo a função EXISTE. Se não existisse, o bloco acima teria
-- levantado exceção e o script pararia sem ter criado política nenhuma.

-- ---------------------------------------------------------------------------
-- 3. As quatro políticas de storage.objects
-- ---------------------------------------------------------------------------
-- Cada uma num bloco próprio, e cada bloco trata TODOS os erros -- não só
-- insufficient_privilege. Assim, se o papel do SQL Editor não for dono de
-- storage.objects (acontece em alguns projetos), a execução avisa QUAL política
-- não entrou e por quê, e segue para a seguinte, em vez de abortar tudo.
--
-- O `drop` e o `create` moram no MESMO bloco de propósito: se o create falhar, o
-- rollback até o início do bloco desfaz o drop e a política antiga continua
-- valendo. Não existe estado "política apagada e não recriada".
--
-- Sem estas políticas o navegador não grava direto, e a aplicação cai na função
-- /api/configuracoes/logomarca, que confere a MESMA permissão e grava com a
-- chave de serviço. Ou seja: a tela funciona de um jeito ou do outro.

-- 3.1 Leitura pública: a imagem aparece em cabeçalho de relatório e de
--     impressão, carregada por URL, sem sessão. Não chama função nenhuma --
--     esta nunca foi a que dava 42883, mas é recriada junto para as quatro
--     ficarem no mesmo estado conhecido.
do $$
begin
  drop policy if exists "configuracoes_leitura_publica" on storage.objects;
  create policy "configuracoes_leitura_publica"
    on storage.objects for select
    using (bucket_id = 'configuracoes');
  raise notice 'OK: política configuracoes_leitura_publica (select).';
exception
  when insufficient_privilege then
    raise notice 'AVISO: política configuracoes_leitura_publica NÃO criada (sem privilégio em storage.objects). Crie-a em Storage -> Policies.';
  when others then
    raise notice 'AVISO: política configuracoes_leitura_publica NÃO criada (% / %). Crie-a em Storage -> Policies.', sqlstate, sqlerrm;
end;
$$;

-- 3.2 Enviar: exige EDIÇÃO no módulo 'administracao' -- a mesma permissão da
--     tela de Configurações e a mesma que a função do servidor confere.
do $$
begin
  drop policy if exists "configuracoes_insert_administracao" on storage.objects;
  create policy "configuracoes_insert_administracao"
    on storage.objects for insert to authenticated
    with check (bucket_id = 'configuracoes' and public.pode_em_administracao('editar'));
  raise notice 'OK: política configuracoes_insert_administracao (insert).';
exception
  when insufficient_privilege then
    raise notice 'AVISO: política configuracoes_insert_administracao NÃO criada (sem privilégio em storage.objects). Crie-a em Storage -> Policies.';
  when others then
    raise notice 'AVISO: política configuracoes_insert_administracao NÃO criada (% / %). Crie-a em Storage -> Policies.', sqlstate, sqlerrm;
end;
$$;

-- 3.3 Substituir o arquivo (upsert do Storage).
do $$
begin
  drop policy if exists "configuracoes_update_administracao" on storage.objects;
  create policy "configuracoes_update_administracao"
    on storage.objects for update to authenticated
    using (bucket_id = 'configuracoes' and public.pode_em_administracao('editar'))
    with check (bucket_id = 'configuracoes' and public.pode_em_administracao('editar'));
  raise notice 'OK: política configuracoes_update_administracao (update).';
exception
  when insufficient_privilege then
    raise notice 'AVISO: política configuracoes_update_administracao NÃO criada (sem privilégio em storage.objects). Crie-a em Storage -> Policies.';
  when others then
    raise notice 'AVISO: política configuracoes_update_administracao NÃO criada (% / %). Crie-a em Storage -> Policies.', sqlstate, sqlerrm;
end;
$$;

-- 3.4 Remover um arquivo antigo do bucket. ⚠️ A POLÍTICA dá o direito; ela não
--     apaga nada. Nenhuma linha desta migration remove arquivo.
do $$
begin
  drop policy if exists "configuracoes_delete_administracao" on storage.objects;
  create policy "configuracoes_delete_administracao"
    on storage.objects for delete to authenticated
    using (bucket_id = 'configuracoes' and public.pode_em_administracao('editar'));
  raise notice 'OK: política configuracoes_delete_administracao (delete).';
exception
  when insufficient_privilege then
    raise notice 'AVISO: política configuracoes_delete_administracao NÃO criada (sem privilégio em storage.objects). Crie-a em Storage -> Policies.';
  when others then
    raise notice 'AVISO: política configuracoes_delete_administracao NÃO criada (% / %). Crie-a em Storage -> Policies.', sqlstate, sqlerrm;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Conferência
-- ---------------------------------------------------------------------------
-- A função de permissão existe? Tem de vir 1 linha, com `pode_em_administracao`
-- e a assinatura completa.
select to_regprocedure('public.pode_em_administracao(text)')::text as funcao
 where to_regprocedure('public.pode_em_administracao(text)') is not null;

-- O bucket existe e está público?
select id, name, public from storage.buckets where id = 'configuracoes';

-- As quatro políticas ficaram no lugar? Tem de vir 4 linhas.
select policyname, cmd
  from pg_policies
 where schemaname = 'storage' and tablename = 'objects'
   and policyname like 'configuracoes_%'
 order by policyname;

-- ⚠️ A LOGOMARCA JÁ ENVIADA CONTINUA LÁ. Esta consulta é a prova: os arquivos
-- do bucket seguem listados, com a data de envio original.
select name, created_at
  from storage.objects
 where bucket_id = 'configuracoes'
 order by created_at desc
 limit 10;
