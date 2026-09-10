-- UM DOCUMENTO, UM CADASTRO — trava de fornecedor duplicado por CPF/CNPJ.
--
-- Arquivo: supabase/migrations/20260910130000_fornecedor_documento_unico.sql
--
-- ATENÇÃO: esta migration precisa ser rodada MANUALMENTE no SQL Editor do
-- Supabase (o mesmo projeto usado pela aplicação). Nada nela roda sozinho no
-- deploy.
--
-- A NECESSIDADE
--
-- Hoje o mesmo fornecedor pode ser cadastrado duas vezes com o mesmo CPF/CNPJ.
-- Quando isso acontece, notas, certidões e valores em aberto do MESMO
-- fornecedor ficam espalhados entre dois cadastros, e nenhuma das duas fichas
-- mostra a situação real dele.
--
-- O QUE ESTA MIGRATION CRIA (nada mais)
--
--   1. Índice único fornecedores_cpf_cnpj_unico_idx sobre o documento
--      NORMALIZADO (só dígitos) de public.fornecedores.
--   2. public.fornecedor_com_documento -> consulta de leitura que devolve QUEM
--      já usa um documento, para a tela poder dizer o nome do fornecedor em vez
--      de um erro de banco.
--
-- REGRAS QUE ELA FAZ VALER NO BANCO
--
--   * PONTUAÇÃO NÃO CONTA. '12.345.678/0001-90' e '12345678000190' são o mesmo
--     documento: o índice é sobre regexp_replace(cpf_cnpj, '[^0-9]', '', 'g').
--     O valor gravado na coluna continua exatamente como foi digitado — a
--     normalização existe só para comparar.
--   * A TRAVA É DO BANCO, não da tela. Vale para INSERT e para UPDATE, por
--     qualquer caminho (tela, PostgREST, SQL manual, importação) e resolve
--     também dois cadastros simultâneos, que a validação da tela não pega.
--   * FORNECEDOR SEM CPF/CNPJ CONTINUA PERMITIDO, quantos existirem: o índice é
--     parcial e ignora nulo e documento sem nenhum dígito.
--   * INATIVO E EXCLUÍDO ENTRAM NA TRAVA. O índice cobre TODOS os cadastros,
--     inclusive ativo = false e os que estão na Lixeira (excluido_em não nulo).
--     Motivo: o problema a resolver é o mesmo fornecedor em dois registros, e
--     inativar ou mandar para a Lixeira não deixa de ser o mesmo fornecedor —
--     o caminho certo é REATIVAR ou RESTAURAR o cadastro que já existe. Também
--     é o que protege a restauração da Lixeira: o documento nunca é ocupado por
--     outro cadastro enquanto o original está lá. Excluir definitivamente
--     (Lixeira) libera o documento, como sempre.
--
-- NENHUM FORNECEDOR É ALTERADO POR ESTA MIGRATION. Ela não tem UPDATE, DELETE,
-- INSERT nem MERGE sobre public.fornecedores. Nenhuma coluna, tabela, política,
-- permissão ou função existente é modificada.
--
-- SE JÁ EXISTIREM DUPLICADOS, A MIGRATION ABORTA (item 5 do pedido). Ela conta
-- e LISTA os documentos repetidos com os ids envolvidos, desfaz tudo o que
-- tinha começado a fazer e não cria o índice. A limpeza dos duplicados que já
-- estão no banco é decisão da usuária e será feita em tarefa própria — nada
-- aqui apaga, mescla ou altera fornecedor.
--
-- É IDEMPOTENTE: rodar de novo num banco já tratado não faz nada e não dá erro.

begin;

-- ---------------------------------------------------------------------------
-- 1. Conferência de estrutura
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.fornecedores') is null then
    raise exception 'Estrutura incompatível: public.fornecedores não existe.';
  end if;

  if not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'fornecedores'
       and column_name = 'cpf_cnpj'
  ) then
    raise exception 'Estrutura incompatível: public.fornecedores.cpf_cnpj não existe.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Duplicados já existentes: ABORTA e explica, sem tocar em nada
-- ---------------------------------------------------------------------------
-- Esta é a única conferência que impede a migration de continuar. Ela roda
-- ANTES da criação do índice porque o índice único falharia com uma mensagem
-- de banco ("could not create unique index") que não diz quais cadastros estão
-- repetidos nem quantos são.
do $$
declare
  v_grupos integer := 0;
  v_cadastros integer := 0;
  v_lista text;
begin
  with repetidos as (
    select regexp_replace(f.cpf_cnpj, '[^0-9]', '', 'g') as documento,
           count(*)                                      as cadastros,
           string_agg(f.id::text, ', ' order by f.id)     as ids
      from public.fornecedores f
     where f.cpf_cnpj is not null
       and regexp_replace(f.cpf_cnpj, '[^0-9]', '', 'g') <> ''
     group by regexp_replace(f.cpf_cnpj, '[^0-9]', '', 'g')
    having count(*) > 1
  )
  select count(*),
         coalesce(sum(cadastros), 0),
         string_agg(
           format('%s (%s cadastros, ids %s)', documento, cadastros, ids),
           '; ' order by documento
         )
    into v_grupos, v_cadastros, v_lista
    from repetidos;

  if v_grupos > 0 then
    raise exception
      'MIGRATION ABORTADA: public.fornecedores já tem % documento(s) de CPF/CNPJ repetido(s), em % cadastros. O índice único NÃO foi criado e NENHUM fornecedor foi apagado, mesclado ou alterado. Documentos repetidos: %. Resolva os duplicados (decisão sua, em tarefa própria) e rode esta migration outra vez.',
      v_grupos, v_cadastros, left(v_lista, 3000);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. O índice único sobre o documento normalizado
-- ---------------------------------------------------------------------------
-- A expressão está escrita à mão, e não dentro de uma função auxiliar, de
-- propósito: índice que depende de função fica preso a ela (substituir a função
-- depois passa a ser operação de risco). regexp_replace é imutável, que é o que
-- o índice de expressão exige.
create unique index if not exists fornecedores_cpf_cnpj_unico_idx
  on public.fornecedores ((regexp_replace(cpf_cnpj, '[^0-9]', '', 'g')))
  where cpf_cnpj is not null
    and regexp_replace(cpf_cnpj, '[^0-9]', '', 'g') <> '';

comment on index public.fornecedores_cpf_cnpj_unico_idx is
  'Um documento, um cadastro: impede dois fornecedores com o mesmo CPF/CNPJ, comparando só os dígitos (pontuação ignorada). Vale para insert e update, e cobre também cadastro inativo e cadastro na Lixeira — nesses casos o caminho é reativar ou restaurar. Fornecedor sem CPF/CNPJ fica fora do índice e continua permitido.';

-- ---------------------------------------------------------------------------
-- 4. Quem já usa este documento?
-- ---------------------------------------------------------------------------
-- Só leitura. Existe para a tela recusar o cadastro dizendo O NOME do
-- fornecedor que já tem aquele documento — inclusive quando esse cadastro está
-- inativo, na Lixeira ou em outra secretaria e por isso não aparece na lista
-- carregada. Devolve apenas identificação (nome, documento e situação): nenhum
-- dado bancário e nenhuma alíquota tributária saem daqui.
create or replace function public.fornecedor_com_documento(
  p_documento text,
  p_ignorar_id text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_documento text;
  v_linha     jsonb;
  v_situacao  text;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado.' using errcode = '42501';
  end if;

  -- Quem já pode ver, cadastrar ou editar fornecedor pode fazer esta consulta.
  -- Nenhuma permissão nova é criada e nenhuma existente é alterada.
  if not exists (
    select 1
      from public.usuarios u
      join public.permissoes_efetivas pe
        on pe.usuario_id = u.id
       and pe.modulo = 'fornecedores'
     where u.auth_id = auth.uid()
       and u.status = 'ativo'
       and (coalesce(pe.pode_visualizar, false)
         or coalesce(pe.pode_cadastrar, false)
         or coalesce(pe.pode_editar, false))
  ) then
    raise exception 'Você não tem permissão para consultar o cadastro de fornecedores.'
      using errcode = '42501';
  end if;

  v_documento := regexp_replace(coalesce(p_documento, ''), '[^0-9]', '', 'g');
  if v_documento = '' then
    return jsonb_build_object('documento', v_documento, 'encontrado', false, 'fornecedor', null);
  end if;

  -- to_jsonb no lugar de uma lista de colunas: bancos que ainda não têm
  -- excluido_em (exclusão lógica) respondem sem erro, e a chave simplesmente
  -- não vem. A mesma expressão do índice é usada na comparação.
  select to_jsonb(f)
    into v_linha
    from public.fornecedores f
   where f.cpf_cnpj is not null
     and regexp_replace(f.cpf_cnpj, '[^0-9]', '', 'g') = v_documento
     and (p_ignorar_id is null or f.id::text <> p_ignorar_id)
   order by case
              when (to_jsonb(f) ->> 'excluido_em') is not null then 2
              when coalesce((to_jsonb(f) ->> 'ativo')::boolean, true) = false then 1
              else 0
            end,
            f.id
   limit 1;

  if v_linha is null then
    return jsonb_build_object('documento', v_documento, 'encontrado', false, 'fornecedor', null);
  end if;

  v_situacao := case
    when (v_linha ->> 'excluido_em') is not null then 'excluido'
    when coalesce((v_linha ->> 'ativo')::boolean, true) = false then 'inativo'
    else 'ativo'
  end;

  return jsonb_build_object(
    'documento', v_documento,
    'encontrado', true,
    'fornecedor', jsonb_build_object(
      'id', v_linha -> 'id',
      'razao_social', coalesce(v_linha -> 'razao_social', 'null'::jsonb),
      'nome_fantasia', coalesce(v_linha -> 'nome_fantasia', 'null'::jsonb),
      'cpf_cnpj', coalesce(v_linha -> 'cpf_cnpj', 'null'::jsonb),
      'ativo', coalesce(v_linha -> 'ativo', 'true'::jsonb),
      'excluido_em', coalesce(v_linha -> 'excluido_em', 'null'::jsonb),
      'situacao', v_situacao
    )
  );
end $$;

revoke all on function public.fornecedor_com_documento(text, text) from public;
revoke all on function public.fornecedor_com_documento(text, text) from anon;
grant execute on function public.fornecedor_com_documento(text, text) to authenticated;

comment on function public.fornecedor_com_documento(text, text) is
  'Quem já usa este CPF/CNPJ? Só leitura e só identificação (nome, documento e situação ativo/inativo/excluído), comparando apenas os dígitos. Serve para o cadastro ser recusado com o NOME do fornecedor que já existe, inclusive quando ele está inativo, na Lixeira ou fora da lista carregada. p_ignorar_id exclui o próprio fornecedor na edição.';

commit;
