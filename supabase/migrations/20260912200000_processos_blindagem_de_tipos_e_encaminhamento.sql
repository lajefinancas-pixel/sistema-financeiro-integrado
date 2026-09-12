-- MÓDULO PROCESSOS — BLINDAGEM DE TIPOS E A COLUNA DO ENCAMINHAMENTO.
--
-- ATENÇÃO: esta migration precisa ser rodada MANUALMENTE no SQL Editor do
-- Supabase (o mesmo projeto usado pela aplicação). Nada nela roda sozinho no
-- deploy.
-- Arquivo: supabase/migrations/20260912200000_processos_blindagem_de_tipos_e_encaminhamento.sql
--
-- ---------------------------------------------------------------------------
-- O DEFEITO RELATADO
-- ---------------------------------------------------------------------------
-- Salvar o processo de serviços/materiais na PÁGINA 2 (Liquidação / solicitação
-- de pagamento) era recusado pelo banco com o código 22P02 em toda tentativa —
-- tanto ao salvar rascunho quanto ao finalizar, porque finalizar salva o
-- conteúdo antes de trocar a situação.
--
-- É A QUARTA VEZ QUE O MESMO DEFEITO APARECE: aprovação da programação,
-- salvamento do planejamento, atribuição da conta do pagamento e agora aqui.
-- Sempre a mesma origem — uma coluna cujo TIPO REAL não é o que o código
-- assumiu.
--
-- ---------------------------------------------------------------------------
-- A CAUSA, MEDIDA
-- ---------------------------------------------------------------------------
-- O salvamento da página 2 não passa por função: a tela escreve direto na
-- tabela (PostgREST). A coluna que estoura é
--
--     public.processos_servicos.encaminhar_secretaria_id
--
-- criada em 20260912120000_processos_datas_por_documento_e_encaminhamento.sql
-- como `uuid` — um tipo ESCRITO À MÃO no arquivo:
--
--     add column if not exists encaminhar_secretaria_id uuid
--
-- Mas o que essa coluna guarda é o id de public.secretarias, o cadastro de
-- secretarias do FINANCEIRO, e nesse cadastro o id é `integer` neste banco. A
-- tela manda "3"; o Postgres tenta ler "3" como uuid e devolve
-- `22P02 invalid input syntax for type uuid: "3"` antes de olhar qualquer
-- dado. Nenhuma escolha de secretaria no bloco de encaminhamento da prefeita
-- podia ser gravada — e como a página 2 é onde esse campo aparece, a página 2
-- inteira ficava impossível de salvar.
--
-- public.processos_diarias tinha EXATAMENTE a mesma coluna, com o mesmo tipo
-- escrito à mão, pela mesma migration: o defeito estava lá também, esperando
-- alguém escolher a secretaria de encaminhamento na liquidação da diária.
--
-- Todas as outras colunas de vínculo do módulo já descobrem o tipo no catálogo
-- (`fornecedor_id %1$s`, `secretaria_id %2$s`, `nota_id`) ou apontam para
-- tabela do próprio módulo, que é uuid. Estas duas eram as únicas fora do
-- padrão — e são as duas que quebravam.
--
-- ---------------------------------------------------------------------------
-- A CORREÇÃO DA COLUNA: `text`, o tipo QUE SERVE PARA QUALQUER CADASTRO
-- ---------------------------------------------------------------------------
-- A coluna passa a ser `text` nas duas tabelas, com o conteúdo atual
-- convertido (`using encaminhar_secretaria_id::text`), e isso é o certo aqui,
-- não um remendo:
--
--   * ela é um PONTEIRO SEM CHAVE ESTRANGEIRA, de propósito (a 20260912120000
--     diz isso em comentário): o cadastro do financeiro não é travado nem
--     alterado pelo módulo Processos, e o nome impresso fica congelado em
--     `encaminhar_secretaria_nome`;
--   * `text` aceita id integer, bigint, uuid ou código — então a mesma coluna
--     serve a este banco e a qualquer outro, sem uma quinta correção quando o
--     cadastro do financeiro for diferente;
--   * a tela JÁ compara por texto (`String(s.id) === procurado` em
--     src/lib/processosEncaminhamento.js), então nada muda na escolha, na
--     reabertura do processo nem na impressão;
--   * conversão de uuid para text preserva o valor. Em banco onde o id do
--     financeiro seja uuid e já exista processo gravado, o ponteiro continua
--     encontrando a mesma secretaria.
--
-- ---------------------------------------------------------------------------
-- A VARREDURA COMPLETA (para não haver uma quinta vez)
-- ---------------------------------------------------------------------------
-- Em vez de corrigir só a coluna, esta migration passa por TODAS as funções do
-- módulo Processos e aplica a mesma proteção das correções anteriores: leitura
-- com ::text explícito, gravação convertida para o tipo REAL lido do catálogo,
-- etapa nomeada e mensagem de erro que diz ONDE quebrou e com que tipos.
--
--   1. pode_em_processos — a PORTA ÚNICA de todo o módulo (diárias,
--      serviços/materiais, servidores, prefeita, secretarias solicitantes,
--      bancos e tabela de diárias entram por ela, nas políticas de RLS e
--      dentro dos gatilhos). Lia usuarios.status, permissoes_efetivas.modulo e
--      as cinco colunas de permissão assumindo o tipo, e o `case` que escolhia
--      a coluna unificava boolean com texto: em coluna de texto ou domínio a
--      recusa seria 42804 e o módulo INTEIRO fecharia de uma vez.
--   2. proximo_numero_processo_diaria — etapa nomeada e tipos reais de ano,
--      numero e ultimo_numero na falha.
--   3. proximo_numero_processo_servico — o mesmo.
--   4. conferir_alteracao_processo_diaria — gatilho de editar/finalizar/
--      cancelar/reabrir/excluir. `new.situacao = 'finalizada'` e
--      `old.situacao <> 'rascunho'` passam a sair ::text.
--   5. conferir_alteracao_processo_servico — o mesmo, no gatilho da tabela do
--      defeito relatado.
--   6. conferir_alteracao_servidor_processos — gatilho do cadastro de
--      servidores: a comparação de situacao sai ::text e a falha inesperada
--      ganha etapa e tipos.
--
-- NÃO TÊM FUNÇÃO PRÓPRIA, e por isso não aparecem na lista acima: secretarias
-- solicitantes, bancos, tabela de diárias e prefeita. Os quatro cadastros são
-- protegidos SÓ por RLS, e a porta dessa RLS é pode_em_processos — a função 1.
-- Blindá-la blinda os quatro. Nenhuma política é recriada aqui.
--
-- ---------------------------------------------------------------------------
-- REGRAS PRESERVADAS, SEM EXCEÇÃO
-- ---------------------------------------------------------------------------
--   * PROCESSOS É DOCUMENTAL. Nada nesta migration debita conta, dá baixa em
--     NF, altera saldo, marca fornecedor como pago, cria pagamento ou toca na
--     Programação Diária. Não há uma única linha que escreva, altere ou
--     referencie public.pagamentos, public.pagamentos_baixas,
--     public.valores_em_aberto, public.saldos_historico,
--     public.contas_bancarias, public.transferencias_contas ou
--     public.programacoes_pagamento.
--   * FINALIZAR NÃO É PAGAR. O gatilho refeito aqui continua exigindo as
--     mesmas permissões, nas mesmas situações, e continua não movimentando
--     nada.
--   * NENHUMA PERMISSÃO É AMPLIADA OU REDUZIDA: ler uma coluna boolean como
--     texto devolve 'true'/'false', e o resultado é idêntico ao de hoje. O
--     mapa de ação para coluna (visualizar→pode_visualizar,
--     cadastrar→pode_cadastrar, editar→pode_editar, excluir→pode_excluir,
--     aprovar→pode_aprovar) é o mesmo, e continua valendo por módulo.
--   * CONGELADO UMA VEZ, CONGELADO PARA SEMPRE: as travas de identidade
--     visual, prefeita e tabela de diárias continuam palavra por palavra.
--   * Nenhum dado é apagado ou reescrito, nenhuma tabela, view, política,
--     índice, restrição ou gatilho é criado ou removido, e nenhuma numeração é
--     reutilizada. A única mudança de estrutura é o TIPO da coluna
--     encaminhar_secretaria_id, nas duas tabelas do módulo.
--   * Rodar duas vezes é inofensivo: a conversão só acontece se a coluna ainda
--     não for text.

begin;

-- ---------------------------------------------------------------------------
-- 0. As tabelas do módulo precisam existir
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.processos_diarias') is null then
    raise exception
      'public.processos_diarias não existe: rode antes a migration 20260911160000_processos_modulo_diarias.sql.';
  end if;
  if to_regclass('public.processos_servicos') is null then
    raise exception
      'public.processos_servicos não existe: rode antes a migration 20260911260000_processos_modulo_servicos.sql.';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. "Que tipo essa coluna TEM?" — a pergunta que evita supor
-- ---------------------------------------------------------------------------
-- Corpo IDÊNTICO ao da 20260828170000 e da 20260911120000, repetido aqui
-- porque é a base das mensagens de erro abaixo: `create or replace` com o
-- mesmo corpo é inócuo se a função já existe. Continua devolvendo o texto
-- 'coluna ausente' quando a coluna não existe — há tratadores de erro que
-- dependem disso. Só lê catálogo do Postgres: nenhum dado da aplicação passa
-- por aqui.
create or replace function public.tipo_da_coluna(p_tabela text, p_coluna text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select format_type(a.atttypid, a.atttypmod)
        from pg_attribute a
       where a.attrelid = to_regclass(format('public.%I', p_tabela))
         and a.attname::text = p_coluna
         and not a.attisdropped
    ),
    'coluna ausente'
  );
$$;

grant execute on function public.tipo_da_coluna(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. "Esta coluna está dizendo sim?" — uma única leitura para o módulo
-- ---------------------------------------------------------------------------
-- Corpo IDÊNTICO ao da 20260911120000. NULL entra e NULL sai: "sem valor" é
-- diferente de "não". Em coluna boolean o resultado é IDÊNTICO ao de hoje
-- (true::text é 'true'), então nenhuma permissão muda por causa desta função.
create or replace function public.texto_verdadeiro(p_texto text)
returns boolean
language sql
immutable
as $$
  select case
           when p_texto is null then null
           else lower(btrim(p_texto)) in ('true', 't', 'sim', '1', 'y', 'yes')
         end;
$$;

grant execute on function public.texto_verdadeiro(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. A COLUNA DO DEFEITO: encaminhar_secretaria_id passa a ser text
-- ---------------------------------------------------------------------------
-- Idempotente e sem perder valor: converte só se a coluna ainda não for text,
-- e cria como text se a coluna faltar (banco onde a 20260912120000 não rodou).
-- Nenhuma linha é apagada e o conteúdo atual é preservado pelo `using ::text`.
do $$
declare
  v_tabela text;
  v_tipo text;
begin
  foreach v_tabela in array array['processos_servicos', 'processos_diarias'] loop
    v_tipo := public.tipo_da_coluna(v_tabela, 'encaminhar_secretaria_id');

    if v_tipo = 'coluna ausente' then
      execute format(
        'alter table public.%I add column encaminhar_secretaria_id text',
        v_tabela
      );
      raise notice 'public.%.encaminhar_secretaria_id criada como text.', v_tabela;

    elsif v_tipo <> 'text' then
      execute format(
        'alter table public.%I alter column encaminhar_secretaria_id type text using encaminhar_secretaria_id::text',
        v_tabela
      );
      raise notice 'public.%.encaminhar_secretaria_id convertida de % para text.', v_tabela, v_tipo;

    else
      raise notice 'public.%.encaminhar_secretaria_id já é text: nada a fazer.', v_tabela;
    end if;
  end loop;
end
$$;

comment on column public.processos_servicos.encaminhar_secretaria_id is
  'A secretaria do cadastro FINANCEIRO (public.secretarias) a quem a prefeita encaminha o processo. Guardada como TEXTO justamente porque é ponteiro sem chave estrangeira: o id do cadastro financeiro é integer neste banco e pode ser uuid em outro, e texto serve aos dois sem quebrar o salvamento com 22P02. O nome impresso fica congelado em encaminhar_secretaria_nome. NÃO é a secretaria solicitante.';
comment on column public.processos_diarias.encaminhar_secretaria_id is
  'A secretaria do cadastro FINANCEIRO (public.secretarias) a quem a prefeita encaminha o processo, no bloco de autorização da Liquidação. Guardada como TEXTO pelo mesmo motivo da coluna homônima de processos_servicos: ponteiro sem chave estrangeira, id do financeiro de tipo variável. NÃO é a secretaria solicitante.';

-- ---------------------------------------------------------------------------
-- 4. A PORTA ÚNICA do módulo — a que fecharia tudo de uma vez
-- ---------------------------------------------------------------------------
-- Mesma decisão da versão da 20260911160000, com as leituras explicitadas: o
-- status do usuário e as cinco colunas de permissão saem ::text e passam por
-- public.texto_verdadeiro, então os ramos do `case` têm todos o mesmo tipo e
-- não há mais unificação para o Postgres recusar com 42804.
--
-- A REGRA NÃO MUDA: a permissão vale POR MÓDULO (processos_diarias,
-- processos_diarias_saida, processos_servicos, processos_servicos_saida,
-- processos_servidores, processos_prefeita, processos_solicitantes,
-- processos_bancos, processos_tabela_diarias), e o mapa de ação para coluna é o
-- mesmo: visualizar→pode_visualizar, cadastrar→pode_cadastrar,
-- editar→pode_editar, excluir→pode_excluir, aprovar→pode_aprovar (aprovar é
-- FINALIZAR, e finalizar não é pagar). Ação desconhecida continua devolvendo
-- false, usuário sem linha continua devolvendo false.
--
-- Passa a ser plpgsql por um motivo prático: função de uma linha em SQL não
-- tem onde dizer em que etapa quebrou. Continua `stable` e `security definer`,
-- então o uso dentro das políticas de RLS é o mesmo.
create or replace function public.pode_em_processos(p_modulo text, p_acao text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_etapa text := 'início';
  v_usuario uuid;
  v_coluna text;
  v_texto text;
  v_constraint text;
  v_tabela_erro text;
  v_coluna_erro text;
  v_detalhe_erro text;
begin
  v_etapa := 'conferência do login';
  if auth.uid() is null then
    return false;
  end if;

  v_etapa := 'leitura do usuário ativo';
  select u.id into v_usuario
    from public.usuarios u
   where u.auth_id = auth.uid()
     and u.status::text = 'ativo'
   limit 1;

  if v_usuario is null then
    return false;
  end if;

  v_etapa := 'escolha da coluna de permissão da ação';
  v_coluna := case p_acao
    when 'visualizar' then 'pode_visualizar'
    when 'cadastrar'  then 'pode_cadastrar'
    when 'editar'     then 'pode_editar'
    when 'excluir'    then 'pode_excluir'
    when 'aprovar'    then 'pode_aprovar'
    else null
  end;

  if v_coluna is null then
    return false;
  end if;

  v_etapa := format('leitura da permissão %s no módulo %s', v_coluna, coalesce(p_modulo, '-'));
  select case v_coluna
           when 'pode_visualizar' then pe.pode_visualizar::text
           when 'pode_cadastrar'  then pe.pode_cadastrar::text
           when 'pode_editar'     then pe.pode_editar::text
           when 'pode_excluir'    then pe.pode_excluir::text
           when 'pode_aprovar'    then pe.pode_aprovar::text
           else 'false'
         end
    into v_texto
    from public.permissoes_efetivas pe
   where pe.usuario_id = v_usuario
     and pe.modulo::text = p_modulo
   limit 1;

  -- Sem linha do módulo, o texto é NULL e o coalesce devolve false — a mesma
  -- resposta que o `exists` dava antes.
  return coalesce(public.texto_verdadeiro(v_texto), false);

exception
  when others then
    if sqlstate in ('P0001', '42501', '42P01', '42703', '42883', '42P13') then
      raise;
    end if;

    get stacked diagnostics
      v_constraint = constraint_name,
      v_tabela_erro = table_name,
      v_coluna_erro = column_name,
      v_detalhe_erro = pg_exception_detail;

    raise exception
      'Não foi possível conferir a permissão "%" no módulo "%" na etapa "%". O banco recusou a leitura com o código %.',
      coalesce(p_acao, '-'), coalesce(p_modulo, '-'), v_etapa, sqlstate
      using errcode = 'P0001',
            detail = format(
              '%s | etapa=%s sqlstate=%s constraint=%s tabela=%s coluna=%s detalhe=%s | usuarios.status=%s permissoes_efetivas.modulo=%s permissoes_efetivas.pode_visualizar=%s permissoes_efetivas.pode_cadastrar=%s permissoes_efetivas.pode_editar=%s permissoes_efetivas.pode_excluir=%s permissoes_efetivas.pode_aprovar=%s',
              sqlerrm, v_etapa, sqlstate,
              coalesce(v_constraint, '-'),
              coalesce(v_tabela_erro, '-'),
              coalesce(v_coluna_erro, '-'),
              coalesce(v_detalhe_erro, '-'),
              public.tipo_da_coluna('usuarios', 'status'),
              public.tipo_da_coluna('permissoes_efetivas', 'modulo'),
              public.tipo_da_coluna('permissoes_efetivas', 'pode_visualizar'),
              public.tipo_da_coluna('permissoes_efetivas', 'pode_cadastrar'),
              public.tipo_da_coluna('permissoes_efetivas', 'pode_editar'),
              public.tipo_da_coluna('permissoes_efetivas', 'pode_excluir'),
              public.tipo_da_coluna('permissoes_efetivas', 'pode_aprovar')
            ),
            hint = 'Leia o DETAIL: ele traz a mensagem crua do banco, a etapa e o tipo real de cada coluna envolvida. Esta função só LÊ permissão — não altera dado, permissão, saldo nem processo.';
end
$fn$;

grant execute on function public.pode_em_processos(text, text) to authenticated;

comment on function public.pode_em_processos(text, text) is
  'Permissão efetiva do usuário logado nos módulos do menu PROCESSOS, e a porta única da RLS de todas as tabelas do módulo. Não altera nenhuma permissão existente. Leituras à prova de tipo: status do usuário, módulo e as cinco colunas de permissão são lidos como texto, para que coluna enum, text ou domínio não feche o módulo inteiro com 42804. Em falha inesperada diz a etapa e o tipo real de cada coluna.';

-- ---------------------------------------------------------------------------
-- 5. Numeração das DIÁRIAS — mesma regra, com etapa nomeada
-- ---------------------------------------------------------------------------
-- Decisão IDÊNTICA à da 20260911160000: o número do ano é consumido na mesma
-- transação, a fila continua depois do maior número já existente e NÚMERO
-- EMITIDO NUNCA É REUTILIZADO, mesmo se o processo for cancelado. O que entra
-- é a etapa e o tipo real das colunas na falha inesperada.
create or replace function public.proximo_numero_processo_diaria(p_ano integer)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_etapa text := 'início';
  proximo integer;
  v_constraint text;
  v_tabela_erro text;
  v_coluna_erro text;
  v_detalhe_erro text;
begin
  v_etapa := 'conferência do ano informado';
  if p_ano is null or p_ano < 2000 or p_ano > 2999 then
    raise exception 'Ano inválido para a numeração de processos: %', p_ano;
  end if;

  -- Sem sessão de usuário (SQL Editor, service role) a RLS também não se
  -- aplica; com sessão, só quem pode criar ou duplicar consome número.
  v_etapa := 'conferência da permissão de criar ou duplicar';
  if auth.uid() is not null
     and not public.pode_em_processos('processos_diarias', 'cadastrar')
     and not public.pode_em_processos('processos_diarias_saida', 'cadastrar')
  then
    raise exception 'Sem permissão para criar processos de diária.';
  end if;

  v_etapa := 'consumo do próximo número do ano';
  insert into public.processos_diarias_numeracao (ano, ultimo_numero)
  values (
    p_ano,
    coalesce((select max(numero) from public.processos_diarias where ano = p_ano), 0) + 1
  )
  on conflict (ano) do update
    set ultimo_numero = greatest(
          public.processos_diarias_numeracao.ultimo_numero,
          coalesce((select max(numero) from public.processos_diarias where ano = p_ano), 0)
        ) + 1,
        atualizado_em = now()
  returning ultimo_numero into proximo;

  return proximo;

exception
  when others then
    if sqlstate in ('P0001', '42501', '42P01', '42703', '42883', '42P13') then
      raise;
    end if;

    get stacked diagnostics
      v_constraint = constraint_name,
      v_tabela_erro = table_name,
      v_coluna_erro = column_name,
      v_detalhe_erro = pg_exception_detail;

    raise exception
      'Não foi possível emitir o número do processo de diária na etapa "%". O banco recusou a operação com o código %.',
      v_etapa, sqlstate
      using errcode = 'P0001',
            detail = format(
              '%s | etapa=%s sqlstate=%s constraint=%s tabela=%s coluna=%s detalhe=%s | processos_diarias.ano=%s processos_diarias.numero=%s processos_diarias_numeracao.ano=%s processos_diarias_numeracao.ultimo_numero=%s',
              sqlerrm, v_etapa, sqlstate,
              coalesce(v_constraint, '-'),
              coalesce(v_tabela_erro, '-'),
              coalesce(v_coluna_erro, '-'),
              coalesce(v_detalhe_erro, '-'),
              public.tipo_da_coluna('processos_diarias', 'ano'),
              public.tipo_da_coluna('processos_diarias', 'numero'),
              public.tipo_da_coluna('processos_diarias_numeracao', 'ano'),
              public.tipo_da_coluna('processos_diarias_numeracao', 'ultimo_numero')
            ),
            hint = 'Leia o DETAIL: ele traz a mensagem crua do banco, a etapa e o tipo real de cada coluna da numeração. Emitir número não cria pagamento, não debita conta e não altera saldo.';
end
$fn$;

grant execute on function public.proximo_numero_processo_diaria(integer) to authenticated;

comment on function public.proximo_numero_processo_diaria(integer) is
  'Próximo número do processo de diária no ano, já consumido da fila. Número emitido nunca é reutilizado, mesmo se o processo for cancelado. Em falha inesperada diz a etapa e o tipo real das colunas da numeração.';

-- ---------------------------------------------------------------------------
-- 6. Numeração dos SERVIÇOS/MATERIAIS — o mesmo
-- ---------------------------------------------------------------------------
create or replace function public.proximo_numero_processo_servico(p_ano integer)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_etapa text := 'início';
  proximo integer;
  v_constraint text;
  v_tabela_erro text;
  v_coluna_erro text;
  v_detalhe_erro text;
begin
  v_etapa := 'conferência do ano informado';
  if p_ano is null or p_ano < 2000 or p_ano > 2999 then
    raise exception 'Ano inválido para a numeração de processos: %', p_ano;
  end if;

  v_etapa := 'conferência da permissão de criar ou duplicar';
  if auth.uid() is not null
     and not public.pode_em_processos('processos_servicos', 'cadastrar')
     and not public.pode_em_processos('processos_servicos_saida', 'cadastrar')
  then
    raise exception 'Sem permissão para criar processos de serviços/materiais.';
  end if;

  v_etapa := 'consumo do próximo número do ano';
  insert into public.processos_servicos_numeracao (ano, ultimo_numero)
  values (
    p_ano,
    coalesce((select max(numero) from public.processos_servicos where ano = p_ano), 0) + 1
  )
  on conflict (ano) do update
    set ultimo_numero = greatest(
          public.processos_servicos_numeracao.ultimo_numero,
          coalesce((select max(numero) from public.processos_servicos where ano = p_ano), 0)
        ) + 1,
        atualizado_em = now()
  returning ultimo_numero into proximo;

  return proximo;

exception
  when others then
    if sqlstate in ('P0001', '42501', '42P01', '42703', '42883', '42P13') then
      raise;
    end if;

    get stacked diagnostics
      v_constraint = constraint_name,
      v_tabela_erro = table_name,
      v_coluna_erro = column_name,
      v_detalhe_erro = pg_exception_detail;

    raise exception
      'Não foi possível emitir o número do processo de serviços/materiais na etapa "%". O banco recusou a operação com o código %.',
      v_etapa, sqlstate
      using errcode = 'P0001',
            detail = format(
              '%s | etapa=%s sqlstate=%s constraint=%s tabela=%s coluna=%s detalhe=%s | processos_servicos.ano=%s processos_servicos.numero=%s processos_servicos_numeracao.ano=%s processos_servicos_numeracao.ultimo_numero=%s',
              sqlerrm, v_etapa, sqlstate,
              coalesce(v_constraint, '-'),
              coalesce(v_tabela_erro, '-'),
              coalesce(v_coluna_erro, '-'),
              coalesce(v_detalhe_erro, '-'),
              public.tipo_da_coluna('processos_servicos', 'ano'),
              public.tipo_da_coluna('processos_servicos', 'numero'),
              public.tipo_da_coluna('processos_servicos_numeracao', 'ano'),
              public.tipo_da_coluna('processos_servicos_numeracao', 'ultimo_numero')
            ),
            hint = 'Leia o DETAIL: ele traz a mensagem crua do banco, a etapa e o tipo real de cada coluna da numeração. Emitir número não cria pagamento, não debita conta e não altera saldo.';
end
$fn$;

grant execute on function public.proximo_numero_processo_servico(integer) to authenticated;

comment on function public.proximo_numero_processo_servico(integer) is
  'Próximo número do processo de serviços/materiais no ano, já consumido da fila. Número emitido nunca é reutilizado, mesmo se o processo for cancelado. Em falha inesperada diz a etapa e o tipo real das colunas da numeração.';

-- ---------------------------------------------------------------------------
-- 7. Gatilho das DIÁRIAS — editar, finalizar e cancelar são permissões
--    DIFERENTES, e a leitura da situação sai ::text
-- ---------------------------------------------------------------------------
-- Corpo IGUAL ao da 20260912140000, campo por campo: a MESMA lista de
-- controle (com prefeita, identidade visual e o congelamento da tabela de
-- diárias), as MESMAS quatro travas de "congelado uma vez, congelado para
-- sempre", as MESMAS permissões por destino de situação e a MESMA recusa de
-- excluir processo finalizado. Mudam três coisas:
--   a) `situacao` é comparada com literal SEMPRE como texto — em banco onde
--      ela seja enum ou domínio, `new.situacao = 'finalizada'` derrubaria
--      qualquer update com 22P02, e finalizar, cancelar e reabrir parariam;
--   b) cada trecho ganha o nome da ETAPA;
--   c) falha inesperada diz a etapa e o tipo real das colunas envolvidas, em
--      vez de devolver só um código.
create or replace function public.conferir_alteracao_processo_diaria()
returns trigger
language plpgsql
as $fn$
declare
  v_etapa text := 'início';
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
  v_constraint text;
  v_tabela_erro text;
  v_coluna_erro text;
  v_detalhe_erro text;
begin
  -- Sem sessão de usuário (SQL Editor, service role, esta própria migration):
  -- a RLS também não se aplica, e o gatilho não pode ser mais restritivo.
  v_etapa := 'conferência do login';
  if auth.uid() is null then
    return new;
  end if;

  v_etapa := 'conferência do número do processo';
  if new.ano is distinct from old.ano or new.numero is distinct from old.numero then
    raise exception 'O número do processo não pode ser alterado.';
  end if;

  -- Congelado uma vez, congelado para sempre.
  v_etapa := 'conferência dos congelamentos do processo';
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

  v_etapa := 'separação do conteúdo do documento dos campos de controle';
  antes := to_jsonb(old);
  depois := to_jsonb(new);
  foreach campo in array controle loop
    antes := antes - campo;
    depois := depois - campo;
  end loop;

  -- Mudança de situação: cada destino tem a sua permissão. A situação é lida
  -- como TEXTO nas comparações com literal.
  v_etapa := 'conferência da mudança de situação do processo';
  if new.situacao::text is distinct from old.situacao::text then
    if new.situacao::text = 'finalizada' and not public.pode_em_processos('processos_diarias', 'aprovar') then
      raise exception 'Sem permissão para finalizar processos de diária.';
    end if;
    if new.situacao::text = 'cancelada' and not public.pode_em_processos('processos_diarias', 'excluir') then
      raise exception 'Sem permissão para cancelar processos de diária.';
    end if;
    if new.situacao::text = 'rascunho' and not public.pode_em_processos('processos_diarias', 'editar') then
      raise exception 'Sem permissão para reabrir processos de diária.';
    end if;
  end if;

  -- Exclusão lógica do rascunho.
  v_etapa := 'conferência da exclusão lógica do processo';
  if new.excluido_em is distinct from old.excluido_em then
    if not public.pode_em_processos('processos_diarias', 'excluir') then
      raise exception 'Sem permissão para excluir processos de diária.';
    end if;
    if old.situacao::text = 'finalizada' and new.excluido_em is not null then
      raise exception 'Processo finalizado não tem exclusão comum: use cancelar, que preserva o registro e o histórico.';
    end if;
  end if;

  -- Conteúdo do documento.
  v_etapa := 'conferência da alteração do conteúdo do documento';
  if antes is distinct from depois then
    if not public.pode_em_processos('processos_diarias', 'editar') then
      raise exception 'Sem permissão para editar processos de diária.';
    end if;
    if old.situacao::text <> 'rascunho' then
      raise exception 'Processo % não está em rascunho: o conteúdo dele não pode mais ser alterado.', old.numero;
    end if;
  end if;

  return new;

exception
  when others then
    if sqlstate in ('P0001', '42501', '42P01', '42703', '42883', '42P13') then
      raise;
    end if;

    get stacked diagnostics
      v_constraint = constraint_name,
      v_tabela_erro = table_name,
      v_coluna_erro = column_name,
      v_detalhe_erro = pg_exception_detail;

    raise exception
      'Não foi possível gravar o processo de diária na etapa "%". O banco recusou a operação com o código %.',
      v_etapa, sqlstate
      using errcode = 'P0001',
            detail = format(
              '%s | etapa=%s sqlstate=%s constraint=%s tabela=%s coluna=%s detalhe=%s | processos_diarias.situacao=%s processos_diarias.encaminhar_secretaria_id=%s processos_diarias.encaminhar_secretaria_nome=%s processos_diarias.secretaria_id=%s processos_diarias.beneficiario_servidor_id=%s processos_diarias.identidade_visual=%s processos_diarias.prefeita=%s processos_diarias.excluido_em=%s processos_diarias.requisicao_data=%s processos_diarias.liquidacao_data=%s processos_diarias.prestacao_data=%s',
              sqlerrm, v_etapa, sqlstate,
              coalesce(v_constraint, '-'),
              coalesce(v_tabela_erro, '-'),
              coalesce(v_coluna_erro, '-'),
              coalesce(v_detalhe_erro, '-'),
              public.tipo_da_coluna('processos_diarias', 'situacao'),
              public.tipo_da_coluna('processos_diarias', 'encaminhar_secretaria_id'),
              public.tipo_da_coluna('processos_diarias', 'encaminhar_secretaria_nome'),
              public.tipo_da_coluna('processos_diarias', 'secretaria_id'),
              public.tipo_da_coluna('processos_diarias', 'beneficiario_servidor_id'),
              public.tipo_da_coluna('processos_diarias', 'identidade_visual'),
              public.tipo_da_coluna('processos_diarias', 'prefeita'),
              public.tipo_da_coluna('processos_diarias', 'excluido_em'),
              public.tipo_da_coluna('processos_diarias', 'requisicao_data'),
              public.tipo_da_coluna('processos_diarias', 'liquidacao_data'),
              public.tipo_da_coluna('processos_diarias', 'prestacao_data')
            ),
            hint = 'Leia o DETAIL: ele traz a mensagem crua do banco, a etapa e o tipo real de cada coluna do processo. Tipo diferente do esperado indica qual gravação foi recusada. Este gatilho é documental: não debita conta, não dá baixa em NF e não altera saldo.';
end
$fn$;

comment on function public.conferir_alteracao_processo_diaria() is
  'Gatilho do processo de diária: editar, finalizar, cancelar, reabrir e excluir são permissões DIFERENTES, e congelamento preenchido nunca é reescrito. Situação lida como texto, para que coluna enum ou domínio não derrube o update com 22P02. Em falha inesperada diz a etapa e o tipo real das colunas do processo. Documental: não debita conta, não dá baixa em NF, não altera saldo e não cria pagamento.';

-- ---------------------------------------------------------------------------
-- 8. Gatilho dos SERVIÇOS/MATERIAIS — a tabela do defeito relatado
-- ---------------------------------------------------------------------------
-- Corpo IGUAL ao da 20260912140000, com as mesmas três mudanças do gatilho das
-- diárias. A lista de controle e as duas travas de congelamento continuam
-- palavra por palavra.
create or replace function public.conferir_alteracao_processo_servico()
returns trigger
language plpgsql
as $fn$
declare
  v_etapa text := 'início';
  antes jsonb;
  depois jsonb;
  controle text[] := array[
    'situacao', 'finalizada_em', 'finalizada_por', 'cancelada_em', 'cancelada_por',
    'motivo_cancelamento', 'excluido_em', 'excluido_por', 'motivo_exclusao',
    'identidade_visual', 'prefeita', 'atualizado_em', 'atualizado_por'
  ];
  campo text;
  v_constraint text;
  v_tabela_erro text;
  v_coluna_erro text;
  v_detalhe_erro text;
begin
  v_etapa := 'conferência do login';
  if auth.uid() is null then
    return new;
  end if;

  v_etapa := 'conferência do número do processo';
  if new.ano is distinct from old.ano or new.numero is distinct from old.numero then
    raise exception 'O número do processo não pode ser alterado.';
  end if;

  -- Congelado uma vez, congelado para sempre.
  v_etapa := 'conferência dos congelamentos do processo';
  if old.identidade_visual is not null
     and new.identidade_visual is distinct from old.identidade_visual then
    raise exception 'A identidade visual congelada do processo % não pode ser alterada.', old.numero;
  end if;
  if old.prefeita is not null
     and new.prefeita is distinct from old.prefeita then
    raise exception 'Os dados da prefeita congelados no processo % não podem ser alterados.', old.numero;
  end if;

  v_etapa := 'separação do conteúdo do documento dos campos de controle';
  antes := to_jsonb(old);
  depois := to_jsonb(new);
  foreach campo in array controle loop
    antes := antes - campo;
    depois := depois - campo;
  end loop;

  v_etapa := 'conferência da mudança de situação do processo';
  if new.situacao::text is distinct from old.situacao::text then
    if new.situacao::text = 'finalizada' and not public.pode_em_processos('processos_servicos', 'aprovar') then
      raise exception 'Sem permissão para finalizar processos de serviços/materiais.';
    end if;
    if new.situacao::text = 'cancelada' and not public.pode_em_processos('processos_servicos', 'excluir') then
      raise exception 'Sem permissão para cancelar processos de serviços/materiais.';
    end if;
    if new.situacao::text = 'rascunho' and not public.pode_em_processos('processos_servicos', 'editar') then
      raise exception 'Sem permissão para reabrir processos de serviços/materiais.';
    end if;
  end if;

  v_etapa := 'conferência da exclusão lógica do processo';
  if new.excluido_em is distinct from old.excluido_em then
    if not public.pode_em_processos('processos_servicos', 'excluir') then
      raise exception 'Sem permissão para excluir processos de serviços/materiais.';
    end if;
    if old.situacao::text = 'finalizada' and new.excluido_em is not null then
      raise exception 'Processo finalizado não tem exclusão comum: use cancelar, que preserva o registro e o histórico.';
    end if;
  end if;

  v_etapa := 'conferência da alteração do conteúdo do documento';
  if antes is distinct from depois then
    if not public.pode_em_processos('processos_servicos', 'editar') then
      raise exception 'Sem permissão para editar processos de serviços/materiais.';
    end if;
    if old.situacao::text <> 'rascunho' then
      raise exception 'Processo % não está em rascunho: o conteúdo dele não pode mais ser alterado.', old.numero;
    end if;
  end if;

  return new;

exception
  when others then
    if sqlstate in ('P0001', '42501', '42P01', '42703', '42883', '42P13') then
      raise;
    end if;

    get stacked diagnostics
      v_constraint = constraint_name,
      v_tabela_erro = table_name,
      v_coluna_erro = column_name,
      v_detalhe_erro = pg_exception_detail;

    raise exception
      'Não foi possível gravar o processo de serviços/materiais na etapa "%". O banco recusou a operação com o código %.',
      v_etapa, sqlstate
      using errcode = 'P0001',
            detail = format(
              '%s | etapa=%s sqlstate=%s constraint=%s tabela=%s coluna=%s detalhe=%s | processos_servicos.situacao=%s processos_servicos.encaminhar_secretaria_id=%s processos_servicos.encaminhar_secretaria_nome=%s processos_servicos.fornecedor_id=%s processos_servicos.nota_id=%s processos_servicos.solicitante_id=%s processos_servicos.identidade_visual=%s processos_servicos.prefeita=%s processos_servicos.excluido_em=%s processos_servicos.requisicao_data=%s processos_servicos.liquidacao_data=%s processos_servicos.tipo=%s processos_servicos.atestado=%s',
              sqlerrm, v_etapa, sqlstate,
              coalesce(v_constraint, '-'),
              coalesce(v_tabela_erro, '-'),
              coalesce(v_coluna_erro, '-'),
              coalesce(v_detalhe_erro, '-'),
              public.tipo_da_coluna('processos_servicos', 'situacao'),
              public.tipo_da_coluna('processos_servicos', 'encaminhar_secretaria_id'),
              public.tipo_da_coluna('processos_servicos', 'encaminhar_secretaria_nome'),
              public.tipo_da_coluna('processos_servicos', 'fornecedor_id'),
              public.tipo_da_coluna('processos_servicos', 'nota_id'),
              public.tipo_da_coluna('processos_servicos', 'solicitante_id'),
              public.tipo_da_coluna('processos_servicos', 'identidade_visual'),
              public.tipo_da_coluna('processos_servicos', 'prefeita'),
              public.tipo_da_coluna('processos_servicos', 'excluido_em'),
              public.tipo_da_coluna('processos_servicos', 'requisicao_data'),
              public.tipo_da_coluna('processos_servicos', 'liquidacao_data'),
              public.tipo_da_coluna('processos_servicos', 'tipo'),
              public.tipo_da_coluna('processos_servicos', 'atestado')
            ),
            hint = 'Leia o DETAIL: ele traz a mensagem crua do banco, a etapa e o tipo real de cada coluna do processo. Tipo diferente do esperado indica qual gravação foi recusada. Este gatilho é documental: não debita conta, não dá baixa em NF e não altera saldo.';
end
$fn$;

comment on function public.conferir_alteracao_processo_servico() is
  'Gatilho do processo de serviços/materiais: editar, finalizar, cancelar, reabrir e excluir são permissões DIFERENTES, e congelamento preenchido nunca é reescrito. Situação lida como texto, para que coluna enum ou domínio não derrube o update com 22P02. Em falha inesperada diz a etapa e o tipo real das colunas do processo. Documental: não debita conta, não dá baixa em NF, não altera saldo e não cria pagamento.';

-- ---------------------------------------------------------------------------
-- 9. Gatilho do cadastro de SERVIDORES — inativar é uma permissão, editar é
--    outra (a regra não muda)
-- ---------------------------------------------------------------------------
-- Corpo IGUAL ao da 20260911230000, com a comparação de situacao explicitada
-- como texto e a mesma etapa nomeada das demais.
create or replace function public.conferir_alteracao_servidor_processos()
returns trigger
language plpgsql
as $fn$
declare
  v_etapa text := 'início';
  antes jsonb;
  depois jsonb;
  controle text[] := array[
    'situacao', 'inativado_em', 'inativado_por', 'motivo_inativacao',
    'atualizado_em', 'atualizado_por'
  ];
  campo text;
  v_constraint text;
  v_tabela_erro text;
  v_coluna_erro text;
  v_detalhe_erro text;
begin
  -- Sem sessão de usuário (SQL Editor, service role, esta própria migration):
  -- a RLS também não se aplica, e o gatilho não pode ser mais restritivo.
  v_etapa := 'conferência do login';
  if auth.uid() is null then
    return new;
  end if;

  v_etapa := 'conferência da inativação ou reativação do servidor';
  if new.situacao::text is distinct from old.situacao::text
     and not public.pode_em_processos('processos_servidores', 'excluir') then
    raise exception 'Sem permissão para inativar ou reativar servidores.';
  end if;

  v_etapa := 'separação do cadastro dos campos de controle';
  antes := to_jsonb(old);
  depois := to_jsonb(new);
  foreach campo in array controle loop
    antes := antes - campo;
    depois := depois - campo;
  end loop;

  v_etapa := 'conferência da alteração do cadastro do servidor';
  if antes is distinct from depois
     and not public.pode_em_processos('processos_servidores', 'editar') then
    raise exception 'Sem permissão para editar o cadastro de servidores.';
  end if;

  return new;

exception
  when others then
    if sqlstate in ('P0001', '42501', '42P01', '42703', '42883', '42P13') then
      raise;
    end if;

    get stacked diagnostics
      v_constraint = constraint_name,
      v_tabela_erro = table_name,
      v_coluna_erro = column_name,
      v_detalhe_erro = pg_exception_detail;

    raise exception
      'Não foi possível gravar o cadastro do servidor na etapa "%". O banco recusou a operação com o código %.',
      v_etapa, sqlstate
      using errcode = 'P0001',
            detail = format(
              '%s | etapa=%s sqlstate=%s constraint=%s tabela=%s coluna=%s detalhe=%s | processos_servidores.situacao=%s processos_servidores.cpf=%s processos_servidores.categoria_diaria=%s processos_servidores.inativado_em=%s',
              sqlerrm, v_etapa, sqlstate,
              coalesce(v_constraint, '-'),
              coalesce(v_tabela_erro, '-'),
              coalesce(v_coluna_erro, '-'),
              coalesce(v_detalhe_erro, '-'),
              public.tipo_da_coluna('processos_servidores', 'situacao'),
              public.tipo_da_coluna('processos_servidores', 'cpf'),
              public.tipo_da_coluna('processos_servidores', 'categoria_diaria'),
              public.tipo_da_coluna('processos_servidores', 'inativado_em')
            ),
            hint = 'Leia o DETAIL: ele traz a mensagem crua do banco, a etapa e o tipo real de cada coluna do cadastro. O cadastro de servidores é documental: não debita conta, não dá baixa em NF e não altera saldo.';
end
$fn$;

comment on function public.conferir_alteracao_servidor_processos() is
  'Gatilho do cadastro de servidores do módulo Processos: inativar é uma permissão e editar é outra. Situação lida como texto, para que coluna enum ou domínio não derrube o update com 22P02. Em falha inesperada diz a etapa e o tipo real das colunas do cadastro.';

commit;

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA (opcional, depois de rodar)
-- ---------------------------------------------------------------------------
-- 1. As duas colunas do encaminhamento são text nas duas tabelas:
--   select table_name, column_name, data_type
--     from information_schema.columns
--    where table_schema = 'public'
--      and table_name in ('processos_servicos', 'processos_diarias')
--      and column_name = 'encaminhar_secretaria_id'
--    order by table_name;
--
-- 2. As seis funções varridas existem e estão protegidas (cada corpo deve
--    conter ::text e v_etapa):
--   select p.proname,
--          position('v_etapa' in pg_get_functiondef(p.oid)) > 0 as tem_etapa
--     from pg_proc p
--     join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname in (
--            'pode_em_processos',
--            'proximo_numero_processo_diaria',
--            'proximo_numero_processo_servico',
--            'conferir_alteracao_processo_diaria',
--            'conferir_alteracao_processo_servico',
--            'conferir_alteracao_servidor_processos'
--          )
--    order by p.proname;
--
-- 3. O cadastro de secretarias do financeiro continua intacto (a contagem é a
--    mesma de antes de rodar):
--   select count(*) from public.secretarias;
