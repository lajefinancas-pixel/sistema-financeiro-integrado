-- BLINDAGEM DE TIPOS LEGADOS NO MÓDULO DE PAGAMENTOS.
--
-- ATENÇÃO: esta migration precisa ser rodada MANUALMENTE no SQL Editor do
-- Supabase (o mesmo projeto usado pela aplicação). Nada nela roda sozinho no
-- deploy.
--
-- O DEFEITO QUE ELA CORRIGE
--
-- Atribuir a conta do pagamento, na seção "Execução da programação", era
-- recusado pelo banco com o código 22P02 em TODA chamada -- nos três caminhos
-- da tela: "Atribuir conta aos selecionados", "Aplicar conta a todos" e a
-- escolha individual na coluna "Conta do pagamento". A tela mandava rodar
-- 20260828170000_corrigir_aprovacao_programacao.sql, que já tinha sido rodada e
-- que não contém a função da conta do pagamento: o aviso apontava o arquivo
-- errado.
--
-- A CAUSA, MEDIDA
--
-- A função chamada pela tela é public.definir_conta_origem_pagamento. A versão
-- que estava valendo no banco é a da 20260828210000, e ela termina em:
--
--     and coalesce(p.situacao, '') <> 'cancelado'
--
-- public.pagamentos.situacao é o ENUM situacao_pagamento neste banco (a tabela
-- não foi criada por migration deste repositório -- só recebeu colunas novas).
-- Sem o ::text, o '' é convertido para o tipo da coluna e o Postgres devolve
-- `22P02 invalid input value for enum situacao_pagamento: ""` antes de olhar
-- qualquer dado. É EXATAMENTE o defeito que a 20260828170000 corrigiu na
-- aprovação e no salvamento -- a mesma linha, em outra função.
--
-- A correção dessa função existe desde a 20260828230000, mas aquele arquivo se
-- chama "diagnosticar_transferencia_entre_contas": pelo nome, parecia
-- dispensável, e nunca foi rodado. Por isso o defeito voltou a aparecer.
-- Aprovar funcionava porque a 20260828170000 refez a aprovação; definir a conta
-- não, porque a função dela ficou na migration que não rodou.
--
-- A VARREDURA (para não haver uma quarta vez)
--
-- Em vez de corrigir uma função por vez, esta migration passa por TODAS as
-- funções do módulo de pagamentos criadas depois da 20260828170000 e aplica a
-- mesma proteção onde faltava:
--
--   * definir_conta_origem_pagamento -- a do defeito relatado. Leituras de
--     status, fechado, ativa, ativo e situacao como texto, e a GRAVAÇÃO da
--     conta convertida para o tipo REAL da coluna, lido do catálogo.
--   * pode_em_pagamentos_fase2 -- porta de aprovar, executar, definir conta,
--     transferir e estornar. Lia usuarios.status e as colunas de permissão
--     assumindo enum e boolean: com coluna de texto a recusa era 42804, e
--     NENHUMA dessas operações abria.
--   * pode_em_baixas e pode_reabrir_programacao -- o mesmo padrão, nas portas
--     das Baixas e da reabertura.
--   * registrar_baixa_nota -- `coalesce(c.ativo, true)` assumia boolean em
--     contas_bancarias.ativo e derrubava a baixa inteira.
--   * estornar_transferencia -- leitura de status explicitada como texto.
--   * definir_nome_exibicao_programacao -- ganha etapa nomeada e tipo real das
--     colunas em falha inesperada, como as demais.
--
-- Já estavam protegidas e NÃO são tocadas aqui: aprovar_programacao_pagamento,
-- salvar_planejamento_programacao, marcar_programacao_em_analise,
-- reabrir_programacao_pagamento, vinculos_da_programacao,
-- confirmar_transferencias_programacao e estornar_baixa_nota.
--
-- REGRAS PRESERVADAS, SEM EXCEÇÃO
--
--   * DEFINIR CONTA NÃO DEBITA CONTA: a conta do pagamento é o roteiro de onde
--     o dinheiro deve sair. Nenhuma linha desta migration escreve em
--     saldos_historico, contas_bancarias, pagamento_movimentacoes ou
--     pagamentos_baixas por causa de uma atribuição de conta.
--     CONTA SELECIONADA != CONTA DEBITADA.
--   * A BAIXA NÃO DEBITA O SALDO DA CONTA. PROGRAMADO != PAGO. APROVADO != PAGO.
--     TRANSFERÊNCIA NÃO É DESPESA.
--   * Nenhuma permissão é ampliada ou reduzida: ler uma coluna boolean como
--     texto devolve 'true'/'false', e o resultado é idêntico ao de hoje. A
--     ordem de decisão de cada porta (matriz de permissões, módulo de origem,
--     concessão avulsa) continua a mesma.
--   * Nenhuma coluna, tabela, view, política, índice, restrição ou gatilho é
--     criado, alterado ou removido. Nenhum dado é apagado ou reescrito.
--   * Nada de Saldos das Contas, Fornecedores, Certidões, Tarefas, Histórico,
--     Relatórios, Auditoria (estrutura), Configurações ou backup é tocado.
--
-- IDEMPOTENTE: pode rodar quantas vezes for preciso. Só substitui corpo de
-- função, mantendo assinatura, tipo de retorno e grants.

begin;

-- ---------------------------------------------------------------------------
-- 1. Tipo real de uma coluna, para o erro poder dizer a verdade
-- ---------------------------------------------------------------------------
-- Corpo IDÊNTICO ao da 20260828170000, repetido aqui porque é a base das
-- mensagens de erro abaixo: `create or replace` com o mesmo corpo é inócuo se a
-- função já existe. Continua devolvendo o texto 'coluna ausente' quando a
-- coluna não existe -- há tratadores de erro que dependem disso.
-- Só lê catálogo do Postgres: nenhum dado da aplicação passa por aqui.
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

comment on function public.tipo_da_coluna(text, text)
is 'Tipo real de uma coluna, lido do catálogo. Usado nas mensagens de erro dos Pagamentos Diários para apontar incompatibilidade de tipo em vez de acusar o valor digitado.';

-- ---------------------------------------------------------------------------
-- 2. "Esta coluna está dizendo sim?" -- uma única leitura para todo o módulo
-- ---------------------------------------------------------------------------
-- O módulo repete, em função após função, a mesma pergunta sobre colunas que
-- podem ser boolean, text, enum ou domínio: fechado, ativa, ativo, permitido,
-- pode_editar. Cada cópia era uma chance nova de alguém voltar a comparar
-- direto com `true` e reintroduzir o 22P02/42804. Aqui a leitura é uma só.
--
-- NULL entra e NULL sai: "sem valor" é diferente de "não", e há regras que
-- dependem dessa diferença (em pode_em_baixas, coluna nula é o que faz o
-- módulo de origem valer). Quem precisa de um padrão aplica o seu coalesce.
--
-- Em coluna boolean o resultado é IDÊNTICO ao de hoje: true::text é 'true' e
-- false::text é 'false'. Nenhuma permissão muda por causa desta função.
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

comment on function public.texto_verdadeiro(text)
is 'Interpreta como sim/não o TEXTO de uma coluna que pode ser boolean, text, enum ou domínio (true/t/sim/1/y/yes). NULL entra e NULL sai: sem valor não é "não". Existe para que nenhuma função do módulo de pagamentos volte a comparar essas colunas assumindo o tipo.';

-- ---------------------------------------------------------------------------
-- 3. A porta da Fase 2 — a que fechava TODAS as operações de uma vez
-- ---------------------------------------------------------------------------
-- Corpo IGUAL ao da 20260828140000, com três leituras protegidas: usuarios.status,
-- permissoes_especiais.permitido e as colunas de permissão da matriz. A antiga
-- lia as três assumindo o tipo, e o `case` que escolhia a coluna unificava
-- boolean com texto -- o que o Postgres recusa com 42804 antes de olhar
-- qualquer permissão. Como esta função é a porta de aprovar, executar, definir
-- a conta, transferir e estornar, uma coluna fora do tipo esperado fechava
-- todas elas ao mesmo tempo.
--
-- A REGRA NÃO MUDA: exceção individual em permissoes_especiais manda; sem
-- exceção, vale a permissão do módulo 'pagamentos'; e é o MESMO mapa de ação
-- para coluna de antes. Em coluna boolean o resultado é idêntico ao de hoje.
create or replace function public.pode_em_pagamentos_fase2(p_acao text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_usuario uuid;
  v_explicito boolean;
  v_explicito_texto text;
  v_modulo text;
begin
  select u.id into v_usuario
    from public.usuarios u
   where u.auth_id = auth.uid()
     and u.status::text = 'ativo'
   limit 1;

  if v_usuario is null then
    return false;
  end if;

  if to_regclass('public.permissoes_especiais') is not null then
    begin
      execute 'select pe.permitido::text from public.permissoes_especiais pe where pe.usuario_id = $1 and pe.acao::text = $2 limit 1'
        into v_explicito_texto
        using v_usuario, p_acao;
      v_explicito := public.texto_verdadeiro(v_explicito_texto);
      if v_explicito is not null then
        return v_explicito;
      end if;
    exception when others then
      v_explicito := null; -- estrutura diferente: cai no padrão do módulo
    end;
  end if;

  v_modulo := case p_acao
    when 'aprovar_programacao'    then 'pode_aprovar'
    when 'executar_programacao'   then 'pode_aprovar'
    when 'executar_transferencia' then 'pode_aprovar'
    when 'definir_conta_pagamento' then 'pode_editar'
    when 'estornar_transferencia' then 'pode_excluir'
    else null
  end;

  if v_modulo is null then
    return false;
  end if;

  -- `exists` continua sendo `exists`: a linha tem de existir E a permissão tem
  -- de estar concedida. O que muda é que cada coluna sai ::text e é lida por
  -- public.texto_verdadeiro, então os três ramos do `case` têm o mesmo tipo e
  -- não há mais unificação para o Postgres recusar.
  return exists (
    select 1
      from public.permissoes_efetivas pe
     where pe.usuario_id = v_usuario
       and pe.modulo::text = 'pagamentos'
       and coalesce(
             public.texto_verdadeiro(
               case v_modulo
                 when 'pode_aprovar' then pe.pode_aprovar::text
                 when 'pode_editar'  then pe.pode_editar::text
                 when 'pode_excluir' then pe.pode_excluir::text
                 else 'false'
               end
             ),
             false
           )
  );
end $$;

grant execute on function public.pode_em_pagamentos_fase2(text) to authenticated;

comment on function public.pode_em_pagamentos_fase2(text)
is 'As cinco permissões da execução financeira dos Pagamentos Diários. Exceção individual em permissoes_especiais manda; sem exceção vale a permissão do módulo pagamentos. Leituras à prova de tipo: status do usuário e colunas de permissão são lidas como texto, para que coluna enum, text ou domínio não feche todas as operações da fase com 42804.';

-- ---------------------------------------------------------------------------
-- 4. Permissões do módulo de Baixas — mesma proteção
-- ---------------------------------------------------------------------------
-- Corpo IGUAL ao da 20260829120000. Mudam só as leituras: usuarios.status e as
-- colunas de permissão saem como texto e passam por public.texto_verdadeiro.
-- A ORDEM DE DECISÃO NÃO MUDA: módulo 'baixas' manda; sem linha dele vale o
-- que a pessoa tem em 'pagamentos'; a concessão avulsa SOMA e nunca subtrai.
create or replace function public.pode_em_baixas(p_acao text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_usuario uuid;
  v_coluna text;
  v_legada text;
  v_valor boolean;
  v_especial boolean;
  -- As permissões saem como TEXTO e são interpretadas depois. 'true'::text é
  -- 'true' e 'false'::text é 'false', então o resultado é idêntico ao de hoje
  -- em coluna boolean -- e deixa de estourar onde a coluna é texto ou domínio.
  v_texto text;
  v_especial_texto text;
begin
  select u.id into v_usuario
    from public.usuarios u
   where u.auth_id = auth.uid()
     and u.status::text = 'ativo'
   limit 1;

  if v_usuario is null then
    return false;
  end if;

  v_coluna := case p_acao
    when 'visualizar'        then 'pode_visualizar'
    when 'visualizar_baixas' then 'pode_visualizar'
    when 'registrar_baixa'   then 'pode_cadastrar'
    when 'imprimir'          then 'pode_editar'
    when 'exportar'          then 'pode_aprovar'
    when 'estornar_baixa'    then 'pode_excluir'
    else null
  end;

  if v_coluna is null then
    return false;
  end if;

  -- 1. O módulo próprio 'baixas' da Matriz de Permissões é quem manda.
  select case v_coluna
           when 'pode_visualizar' then pe.pode_visualizar::text
           when 'pode_cadastrar'  then pe.pode_cadastrar::text
           when 'pode_editar'     then pe.pode_editar::text
           when 'pode_aprovar'    then pe.pode_aprovar::text
           when 'pode_excluir'    then pe.pode_excluir::text
           else 'false'
         end
    into v_texto
    from public.permissoes_efetivas pe
   where pe.usuario_id = v_usuario
     and pe.modulo::text = 'baixas'
   limit 1;

  -- Sem linha, ou coluna nula, continua sendo NULL -- é o que faz o passo 2
  -- valer. Só um valor presente decide aqui.
  v_valor := public.texto_verdadeiro(v_texto);

  -- 2. Sem linha de 'baixas' (perfil criado depois desta migration, por
  --    exemplo): vale o que a pessoa já tinha em 'pagamentos', para ninguém
  --    ficar sem acesso. Imprimir e exportar seguem a visualização.
  if v_valor is null then
    select case v_coluna
             when 'pode_visualizar' then pe.pode_visualizar::text
             when 'pode_cadastrar'  then pe.pode_cadastrar::text
             when 'pode_editar'     then pe.pode_visualizar::text
             when 'pode_aprovar'    then pe.pode_visualizar::text
             when 'pode_excluir'    then pe.pode_excluir::text
             else 'false'
           end
      into v_texto
      from public.permissoes_efetivas pe
     where pe.usuario_id = v_usuario
       and pe.modulo::text = 'pagamentos'
     limit 1;

    v_valor := public.texto_verdadeiro(v_texto);
  end if;

  if coalesce(v_valor, false) then
    return true;
  end if;

  -- 3. Concessão avulsa da aba de permissões especiais, que já existia para a
  --    versão anterior desta tela. Ela SOMA, nunca subtrai: quem foi liberado
  --    lá continua liberado, e um "não" gravado lá (a aba grava todas as ações,
  --    marcadas ou não) não tira o que a Matriz de Permissões concedeu.
  v_legada := case p_acao
    when 'visualizar'        then 'visualizar_baixas'
    when 'visualizar_baixas' then 'visualizar_baixas'
    when 'imprimir'          then 'visualizar_baixas'
    when 'exportar'          then 'visualizar_baixas'
    when 'registrar_baixa'   then 'registrar_baixa'
    when 'estornar_baixa'    then 'estornar_baixa'
    else null
  end;

  if v_legada is not null and to_regclass('public.permissoes_especiais') is not null then
    begin
      execute 'select pe.permitido::text from public.permissoes_especiais pe where pe.usuario_id = $1 and pe.acao::text = $2 limit 1'
        into v_especial_texto
        using v_usuario, v_legada;
      v_especial := public.texto_verdadeiro(v_especial_texto);
      if coalesce(v_especial, false) then
        return true;
      end if;
    exception when others then
      v_especial := null; -- estrutura diferente: só a Matriz de Permissões vale
    end;
  end if;

  return false;
end $$;

grant execute on function public.pode_em_baixas(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Quem pode reabrir programação — mesma proteção
-- ---------------------------------------------------------------------------
-- Corpo IGUAL ao da 20260910120000, com as mesmas leituras como texto. A REGRA
-- NÃO MUDA: padrão é a permissão de aprovar; a ação avulsa reabrir_programacao
-- em permissoes_especiais continua tendo precedência quando existir.
create or replace function public.pode_reabrir_programacao()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_usuario uuid;
  v_explicito boolean;
  v_explicito_texto text;
begin
  select u.id into v_usuario
    from public.usuarios u
   where u.auth_id = auth.uid()
     and u.status::text = 'ativo'
   limit 1;

  if v_usuario is null then
    return false;
  end if;

  if to_regclass('public.permissoes_especiais') is not null then
    begin
      execute 'select pe.permitido::text from public.permissoes_especiais pe where pe.usuario_id = $1 and pe.acao::text = $2 limit 1'
        into v_explicito_texto
        using v_usuario, 'reabrir_programacao';
      v_explicito := public.texto_verdadeiro(v_explicito_texto);
      if v_explicito is not null then
        return v_explicito;
      end if;
    exception when others then
      v_explicito := null; -- estrutura diferente: cai no padrão de aprovar
    end;
  end if;

  -- Padrão: a mesma permissão de aprovar programação.
  begin
    return public.pode_em_pagamentos_fase2('aprovar_programacao');
  exception when undefined_function then
    -- Banco em que a Fase 2 ainda não rodou: lê o módulo direto, com o mesmo
    -- resultado que a função daria.
    return exists (
      select 1
        from public.permissoes_efetivas pe
       where pe.usuario_id = v_usuario
         and pe.modulo::text = 'pagamentos'
         and coalesce(public.texto_verdadeiro(pe.pode_aprovar::text), false)
    );
  end;
end $$;

grant execute on function public.pode_reabrir_programacao() to authenticated;

-- ---------------------------------------------------------------------------
-- 6. A CORREÇÃO DO DEFEITO RELATADO: a conta do pagamento
-- ---------------------------------------------------------------------------
-- Esta é a função usada pelos três caminhos da tela: "Atribuir conta aos
-- selecionados", "Aplicar conta a todos" e a escolha individual em cada linha.
-- O que estava no banco era a versão da 20260828210000, que terminava com
--
--     and coalesce(p.situacao, '') <> 'cancelado'
--
-- Com public.pagamentos.situacao em enum -- como está na produção -- o Postgres
-- precisa transformar a string vazia em valor do enum para poder comparar, e
-- recusa: 22P02, "invalid input value for enum situacao_pagamento". Recusa na
-- montagem do comando, antes de olhar um único pagamento, então falhava sempre,
-- com qualquer seleção. É a MESMA linha que a 20260828170000 já havia corrigido
-- em aprovar_programacao_pagamento e em salvar_planejamento_programacao -- e é
-- por isso que aprovar funcionava e definir a conta não.
--
-- O corpo abaixo é o da 20260828230000, que já trazia as leituras protegidas
-- mas ficou fora do banco porque o nome do arquivo ("diagnosticar") fez o
-- arquivo parecer opcional. Duas coisas foram acrescentadas a ele:
--   a) a gravação agora converte o valor para o tipo REAL de
--      pagamentos.conta_origem_id, descoberto em public.tipo_da_coluna, em vez
--      de confiar que a coluna é integer;
--   b) quando a coluna não existe, o erro sai como 42703 -- o código que a tela
--      reconhece como "falta estrutura" e que faz a mensagem apontar a
--      migration certa, a da Fase 2.
--
-- REGRA INALTERADA: definir a conta NÃO move saldo. Nenhuma linha de
-- saldos_historico, nenhuma movimentação, nenhum débito. Conta selecionada não
-- é conta debitada.
create or replace function public.definir_conta_origem_pagamento(
  p_programacao_id integer,
  p_pagamento_ids integer[],
  p_conta_id integer
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  -- Um id de usuário por coluna, resolvido pelo vínculo real da coluna:
  -- public.usuario_para_coluna devolve o id de public.usuarios quando a coluna
  -- aponta para lá (NULL quando a sessão não tem registro), e nunca um id que a
  -- chave estrangeira recusaria.
  v_usuario_auditoria uuid; -- auditoria_eventos.usuario_id
  v_secretaria integer;
  -- Texto, não boolean nem enum: é o que sobrevive a coluna legada de qualquer
  -- tipo. A conferência acontece depois, sobre o texto.
  v_status text;
  v_fechado_texto text;
  v_conta_secretaria integer;
  v_conta_ativa_texto text;
  v_na_programacao boolean;
  v_atualizados integer;
  -- O tipo que a coluna tem de verdade, lido do catálogo. A gravação converte
  -- para ele; não se presume integer.
  v_tipo_conta_origem text;
  v_etapa text := 'início';
  v_constraint text;
  v_tabela_erro text;
  v_coluna_erro text;
  v_detalhe_erro text;
begin
  v_etapa := 'conferência do login';
  if auth.uid() is null then
    raise exception 'Usuário não autenticado.' using errcode = '42501';
  end if;

  v_etapa := 'resolução do usuário da trilha';
  v_usuario_auditoria := public.usuario_para_coluna('auditoria_eventos', 'usuario_id');

  v_etapa := 'conferência da permissão de definir a conta';
  if not public.pode_em_pagamentos_fase2('definir_conta_pagamento') then
    raise exception 'Você não tem permissão para definir a conta de pagamento.' using errcode = '42501';
  end if;

  v_etapa := 'conferência dos pagamentos enviados';
  if p_pagamento_ids is null or array_length(p_pagamento_ids, 1) is null then
    raise exception 'Escolha ao menos um pagamento.';
  end if;

  v_etapa := 'leitura da programação';
  select pr.secretaria_id, pr.status::text, pr.fechado::text
    into v_secretaria, v_status, v_fechado_texto
    from public.programacoes_pagamento pr
   where pr.id = p_programacao_id
   for update;

  if not found then
    raise exception 'Programação não encontrada.';
  end if;

  if public.texto_verdadeiro(v_fechado_texto) then
    raise exception 'Programações históricas fechadas não podem ser alteradas.';
  end if;

  if coalesce(v_status, '') <> 'aprovada' then
    raise exception 'A conta de cada pagamento só é definida depois da aprovação da programação.';
  end if;

  if p_conta_id is not null then
    v_etapa := 'leitura da conta bancária escolhida';
    select cb.secretaria_id, coalesce(cb.ativo::text, 'true')
      into v_conta_secretaria, v_conta_ativa_texto
      from public.contas_bancarias cb
     where cb.id = p_conta_id;

    if not found then
      raise exception 'Conta bancária não encontrada.';
    end if;
    if not coalesce(public.texto_verdadeiro(v_conta_ativa_texto), false) then
      raise exception 'Conta bancária desativada não pode receber pagamentos.';
    end if;
    if v_conta_secretaria is distinct from v_secretaria then
      raise exception 'Só é possível usar contas da secretaria da programação.';
    end if;

    v_etapa := 'conferência da conta entre as contas de trabalho';
    select exists (
      select 1
        from public.programacao_contas pc
       where pc.programacao_id = p_programacao_id
         and pc.conta_id = p_conta_id
         and coalesce(public.texto_verdadeiro(pc.ativa::text), false)
    ) into v_na_programacao;

    if not v_na_programacao then
      raise exception 'Só é possível usar contas que estão entre as contas de trabalho selecionadas na programação.';
    end if;
  end if;

  v_etapa := 'leitura do tipo real da coluna conta_origem_id';
  v_tipo_conta_origem := public.tipo_da_coluna('pagamentos', 'conta_origem_id');

  if v_tipo_conta_origem = 'coluna ausente' then
    -- 42703 é "coluna não existe". A tela classifica esse código como falta de
    -- estrutura e aponta a migration da Fase 2, que é justamente quem cria
    -- pagamentos.conta_origem_id. Quem nomeia arquivo é a tela, não o banco.
    raise exception 'A coluna que guarda a conta de origem do pagamento não existe no banco.'
      using errcode = '42703';
  end if;

  -- Grava SÓ o vínculo. Nenhuma linha de saldo, nenhuma movimentação.
  -- A conversão é para o tipo que a coluna TEM, não para o que se supõe que
  -- ela tenha: integer hoje, e continua funcionando se a coluna for bigint,
  -- numeric ou um domínio sobre inteiro. O mesmo vale para situacao, lida como
  -- texto -- a comparação que derrubava a operação inteira.
  v_etapa := 'gravação da conta de origem nos pagamentos';
  execute format(
    $sql$
      update public.pagamentos p
         set conta_origem_id = $1::%s
       where p.programacao_id = $2
         and p.id = any ($3)
         and p.excluido_em is null
         and coalesce(p.situacao::text, '') <> 'cancelado'
    $sql$,
    v_tipo_conta_origem
  ) using p_conta_id::text, p_programacao_id, p_pagamento_ids;

  get diagnostics v_atualizados = row_count;

  if v_atualizados = 0 then
    raise exception 'Nenhum pagamento desta programação corresponde à seleção.';
  end if;

  -- Auditar NUNCA derruba a ação principal: o vínculo acima já está gravado e
  -- uma falha exclusiva da trilha desfaz só este bloco. É a disciplina que a
  -- 20260828170000 aplicou na Fase 1, e ela cabe aqui porque definir a conta
  -- não move saldo -- ao contrário da transferência, em que trilha e
  -- movimentação precisam cair juntas.
  v_etapa := 'registro na auditoria';
  begin
    insert into public.auditoria_eventos (
      usuario_id, modulo, acao, registro_afetado, valor_anterior, valor_novo, nivel
    ) values (
      v_usuario_auditoria,
      'pagamentos',
      'alterou',
      'Conta de pagamento da programação ' || p_programacao_id::text,
      jsonb_build_object('pagamentos', to_jsonb(p_pagamento_ids)),
      jsonb_build_object(
        'conta_origem_id', p_conta_id,
        'pagamentos_atualizados', v_atualizados,
        'debitou_conta', false
      ) || public.rastro_do_login(v_usuario_auditoria),
      'informacao'
    );
  exception when others then
    raise warning 'Conta de pagamento da programação % definida, mas o evento de auditoria não foi gravado (% -- %).',
      p_programacao_id, sqlstate, sqlerrm;
  end;

  return jsonb_build_object(
    'ok', true,
    'programacao_id', p_programacao_id,
    'conta_origem_id', p_conta_id,
    'pagamentos_atualizados', v_atualizados,
    'debitou_conta', false
  );

exception
  when others then
    -- Passam intactas: as mensagens escritas para o usuário (P0001), as recusas
    -- de permissão (42501) e a falta de objeto no banco (42P01/42703/42883/
    -- 42P13). Estes últimos são o que a tela usa para reconhecer "a migration
    -- ainda não rodou" e dizer qual arquivo executar.
    if sqlstate in ('P0001', '42501', '42P01', '42703', '42883', '42P13') then
      raise;
    end if;

    get stacked diagnostics
      v_constraint = constraint_name,
      v_tabela_erro = table_name,
      v_coluna_erro = column_name,
      v_detalhe_erro = pg_exception_detail;

    raise exception
      'Não foi possível definir a conta de pagamento na etapa "%". O banco recusou a operação com o código %.',
      v_etapa, sqlstate
      using errcode = 'P0001',
            detail = format(
              '%s | etapa=%s sqlstate=%s constraint=%s tabela=%s coluna=%s detalhe=%s | programacoes_pagamento.status=%s programacoes_pagamento.fechado=%s programacao_contas.ativa=%s contas_bancarias.ativo=%s pagamentos.situacao=%s pagamentos.conta_origem_id=%s auditoria_eventos.nivel=%s',
              sqlerrm, v_etapa, sqlstate,
              coalesce(v_constraint, '-'),
              coalesce(v_tabela_erro, '-'),
              coalesce(v_coluna_erro, '-'),
              coalesce(v_detalhe_erro, '-'),
              public.tipo_da_coluna('programacoes_pagamento', 'status'),
              public.tipo_da_coluna('programacoes_pagamento', 'fechado'),
              public.tipo_da_coluna('programacao_contas', 'ativa'),
              public.tipo_da_coluna('contas_bancarias', 'ativo'),
              public.tipo_da_coluna('pagamentos', 'situacao'),
              public.tipo_da_coluna('pagamentos', 'conta_origem_id'),
              public.tipo_da_coluna('auditoria_eventos', 'nivel')
            ),
            hint = 'Leia o DETAIL: ele traz a mensagem crua do banco, a etapa, a restrição recusada e o tipo real de cada coluna suspeita. Tipo diferente do esperado indica qual comparação foi recusada.';
end;
$fn$;

grant execute on function public.definir_conta_origem_pagamento(integer, integer[], integer) to authenticated;

comment on function public.definir_conta_origem_pagamento(integer, integer[], integer)
is 'Define a conta de origem de um ou mais pagamentos da programação, para os três caminhos da tela: atribuir aos selecionados, aplicar a todos e escolha individual. CONTA DEFINIDA NAO E DEBITO: nenhum saldo é movimentado aqui. Comparações lidas como texto para sobreviver a coluna enum, domínio ou boolean; gravação convertida para o tipo real de pagamentos.conta_origem_id lido do catálogo; auditoria isolada; e qualquer falha inesperada diz a etapa e os tipos reais das colunas.';

-- ---------------------------------------------------------------------------
-- 7. Registrar baixa — a leitura da conta que faltava
-- ---------------------------------------------------------------------------
-- Corpo IGUAL ao da 20260829120000. Muda UMA leitura: coalesce(c.ativo, true)
-- assumia boolean e derrubava a baixa inteira onde a coluna é texto ou domínio.
-- A BAIXA CONTINUA NÃO DEBITANDO CONTA: não há escrita em saldos_historico,
-- pagamento_movimentacoes ou contas_bancarias abaixo.
create or replace function public.registrar_baixa_nota(
  p_chave_idempotencia text,
  p_valor_em_aberto_id text,
  p_valor numeric,
  p_data_pagamento date,
  p_conta_id integer,
  p_observacao text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_usuario uuid;
  v_chave text;
  v_valor numeric(14,2);
  v_nota record;
  v_conta record;
  v_valor_nota numeric(14,2);
  v_pago_antes numeric(14,2);
  v_aberto_antes numeric(14,2);
  v_pago_depois numeric(14,2);
  v_aberto_depois numeric(14,2);
  v_situacao_nova text;
  v_baixa_id text;
  v_existente record;
  v_tipo_nota text;
  v_tipo_fornecedor text;
  v_tipo_conta text;
  -- Os tipos reais das colunas de situação: no banco em uso a situação da nota
  -- é o enum situacao_valor e situacao_anterior é texto, e a gravação precisa
  -- converter para o tipo de cada uma.
  v_tipo_situacao text;
  v_tipo_situacao_anterior text;
  v_documento text;
  v_observacao text;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado.' using errcode = '42501';
  end if;

  if not public.pode_em_baixas('registrar_baixa') then
    raise exception 'Você não tem permissão para registrar baixas de pagamento.' using errcode = '42501';
  end if;

  v_chave := nullif(trim(coalesce(p_chave_idempotencia, '')), '');
  if v_chave is null then
    raise exception 'A baixa precisa de um identificador único para não ser registrada duas vezes.';
  end if;

  if nullif(trim(coalesce(p_valor_em_aberto_id, '')), '') is null then
    raise exception 'Informe a nota do fornecedor que está sendo baixada.';
  end if;

  v_valor := round(coalesce(p_valor, 0), 2);
  if v_valor <= 0 then
    raise exception 'O valor da baixa deve ser maior que zero.';
  end if;

  if p_data_pagamento is null then
    raise exception 'Informe a data do pagamento.';
  end if;

  if p_conta_id is null then
    raise exception 'Informe a conta bancária utilizada no pagamento.';
  end if;

  -- Baixa já registrada com esta chave: devolve a mesma resposta e não repete
  -- nada. É o duplo clique / F5 / reenvio chegando de novo.
  select b.id::text as id, b.valor_pago, b.data_pagamento, b.conta_id, b.status
    into v_existente
    from public.pagamentos_baixas b
   where b.chave_idempotencia = v_chave
   limit 1;

  if found then
    return jsonb_build_object(
      'ok', true,
      'ja_registrada', true,
      'baixa_id', v_existente.id,
      'valor_pago', v_existente.valor_pago,
      'movimentou_saldo', false
    );
  end if;

  -- A nota, travada até o fim da transação: duas baixas simultâneas na mesma
  -- nota entram em fila e o valor em aberto nunca é lido desatualizado.
  -- A situação vem ::text de propósito: a coluna é o enum situacao_valor no
  -- banco em uso, e lida como texto ela compara, entra no evento de auditoria e
  -- é guardada em situacao_anterior sem depender do tipo.
  select v.id::text as id, v.fornecedor_id, v.valor, coalesce(v.valor_pago, 0) as valor_pago,
         v.situacao::text as situacao, v.numero_nota_fiscal, v.data_vencimento
    into v_nota
    from public.valores_em_aberto v
   where v.id::text = p_valor_em_aberto_id
     for update;

  if not found then
    raise exception 'A nota informada não foi encontrada. Atualize a tela e tente novamente.';
  end if;

  -- Comparação de texto com texto: um rótulo de enum lido como texto é o
  -- próprio rótulo, então 'cancelado' continua sendo 'cancelado'.
  if v_nota.situacao = 'cancelado' then
    raise exception 'Esta nota está cancelada e não recebe baixas.';
  end if;

  v_valor_nota := round(coalesce(v_nota.valor, 0), 2);
  v_pago_antes := round(coalesce(v_nota.valor_pago, 0), 2);
  v_aberto_antes := round(v_valor_nota - v_pago_antes, 2);

  if v_aberto_antes <= 0.004 then
    raise exception 'Esta nota já está quitada e não recebe novas baixas.';
  end if;

  if v_valor > v_aberto_antes + 0.004 then
    raise exception 'O valor da baixa (R$ %) é maior do que o valor em aberto da nota (R$ %). Informe um valor até o que está em aberto.',
      translate(to_char(v_valor, 'FM999,999,999,990.00'), ',.', '.,'),
      translate(to_char(v_aberto_antes, 'FM999,999,999,990.00'), ',.', '.,');
  end if;

  -- contas_bancarias.ativo sai como TEXTO: 'true'/'t'/'1' continuam valendo
  -- "ativa", e coluna de texto ou domínio deixa de estourar a baixa inteira.
  -- Ausência de valor continua sendo tratada como ativa, como antes.
  select c.id, c.nome_conta, coalesce(c.ativo::text, 'true') as ativo_texto
    into v_conta
    from public.contas_bancarias c
   where c.id = p_conta_id;

  if not found then
    raise exception 'A conta bancária informada não foi encontrada.';
  end if;
  if not coalesce(public.texto_verdadeiro(v_conta.ativo_texto), true) then
    raise exception 'Conta bancária desativada não pode ser usada em uma baixa.';
  end if;

  v_pago_depois := round(v_pago_antes + v_valor, 2);
  v_aberto_depois := round(v_valor_nota - v_pago_depois, 2);
  if v_aberto_depois < 0 then
    v_aberto_depois := 0;
  end if;

  -- Quitou: grava 'pago' e a nota sai da lista de notas em aberto. Sobrou
  -- saldo: a nota CONTINUA 'em_aberto' e recebe quantas baixas precisar. O
  -- abatimento parcial não muda a situação — ele fica em valor_pago, e o que
  -- resta em aberto continua sendo valor - valor_pago.
  v_situacao_nova := case when v_aberto_depois <= 0.004 then 'pago' else 'em_aberto' end;

  v_documento := nullif(trim(coalesce(v_nota.numero_nota_fiscal, '')), '');
  v_observacao := nullif(trim(coalesce(p_observacao, '')), '');
  v_usuario := public.usuario_para_coluna('pagamentos_baixas', 'usuario_id');

  -- Os tipos reais das colunas de vínculo: a baixa recebe tudo como texto e
  -- devolve para a coluna no tipo que ela tem, seja integer, bigint ou uuid.
  v_tipo_nota := public.tipo_da_coluna('pagamentos_baixas', 'valor_em_aberto_id');
  v_tipo_fornecedor := public.tipo_da_coluna('pagamentos_baixas', 'fornecedor_id');
  v_tipo_conta := public.tipo_da_coluna('pagamentos_baixas', 'conta_id');
  v_tipo_situacao := public.tipo_da_coluna('valores_em_aberto', 'situacao');
  v_tipo_situacao_anterior := public.tipo_da_coluna('pagamentos_baixas', 'situacao_anterior');

  -- O insert é a tranca da idempotência: o índice único da chave garante uma
  -- baixa só. `on conflict do nothing` sem id devolvido = alguém chegou antes,
  -- e então a nota NÃO é abatida de novo.
  execute format($sql$
    insert into public.pagamentos_baixas (
      chave_idempotencia, fornecedor_id, valor_em_aberto_id, valor_total_referencia,
      valor_pago, data_pagamento, conta_id, documento, observacao,
      status, situacao_anterior, usuario_id
    ) values (
      $1, $2::%s, $3::%s, $4, $5, $6, $7::%s, $8, $9, 'efetivada', $10::%s, $11
    )
    on conflict (chave_idempotencia) where chave_idempotencia is not null do nothing
    returning id::text
  $sql$, v_tipo_fornecedor, v_tipo_nota, v_tipo_conta, v_tipo_situacao_anterior)
    into v_baixa_id
   using v_chave, v_nota.fornecedor_id::text, v_nota.id, v_valor_nota, v_valor,
         p_data_pagamento, p_conta_id::text, v_documento, v_observacao,
         v_nota.situacao, v_usuario;

  if v_baixa_id is null then
    select b.id::text as id, b.valor_pago
      into v_existente
      from public.pagamentos_baixas b
     where b.chave_idempotencia = v_chave
     limit 1;

    return jsonb_build_object(
      'ok', true,
      'ja_registrada', true,
      'baixa_id', v_existente.id,
      'valor_pago', v_existente.valor_pago,
      'movimentou_saldo', false
    );
  end if;

  -- O ÚNICO efeito da baixa fora da própria razão: o valor em aberto da nota.
  -- A situação nova é calculada como texto e convertida para o tipo REAL da
  -- coluna (o enum situacao_valor no banco em uso, text em bancos novos). Sem a
  -- conversão, gravar texto numa coluna de enum não é aceito.
  execute format($sql$
    update public.valores_em_aberto
       set valor_pago = $1,
           situacao = $2::%s
     where id::text = $3
  $sql$, v_tipo_situacao)
   using v_pago_depois, v_situacao_nova, p_valor_em_aberto_id;

  insert into public.auditoria_eventos (
    usuario_id, modulo, acao, registro_afetado, valor_anterior, valor_novo, nivel
  ) values (
    v_usuario,
    'pagamentos',
    'registrou_baixa',
    'Baixa de pagamento — nota ' || coalesce(v_documento, v_nota.id),
    jsonb_build_object(
      'valor_em_aberto_id', v_nota.id,
      'situacao', v_nota.situacao,
      'valor_pago', v_pago_antes,
      'valor_em_aberto', v_aberto_antes
    ),
    jsonb_build_object(
      'baixa_id', v_baixa_id,
      'fornecedor_id', v_nota.fornecedor_id,
      'valor_da_baixa', v_valor,
      'data_pagamento', p_data_pagamento,
      'conta_id', p_conta_id,
      'situacao', v_situacao_nova,
      'valor_pago', v_pago_depois,
      'valor_em_aberto', v_aberto_depois,
      'quitada', v_aberto_depois <= 0.004,
      'observacao', v_observacao,
      -- A baixa registra o pagamento; ela não debita conta nenhuma.
      'movimentou_saldo', false
    ),
    'atencao'
  );

  return jsonb_build_object(
    'ok', true,
    'ja_registrada', false,
    'baixa_id', v_baixa_id,
    'valor_em_aberto_id', v_nota.id,
    'fornecedor_id', v_nota.fornecedor_id,
    'valor_da_baixa', v_valor,
    'valor_total', v_valor_nota,
    'valor_pago', v_pago_depois,
    'valor_em_aberto', v_aberto_depois,
    'situacao', v_situacao_nova,
    'quitada', v_aberto_depois <= 0.004,
    'movimentou_saldo', false
  );
end;
$fn$;

grant execute on function public.registrar_baixa_nota(text, text, numeric, date, integer, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Estornar transferência — leitura do status explicitamente como texto
-- ---------------------------------------------------------------------------
-- Corpo IGUAL ao da 20260828210000, com UMA leitura explicitada: tc.status sai
-- ::text, como em todo o resto do módulo. Nenhuma regra do estorno muda -- ele
-- continua sendo a ÚNICA operação, junto da transferência, que move saldo, e
-- continua desfazendo exatamente as duas pernas do lançamento original.
create or replace function public.estornar_transferencia(
  p_transferencia_id uuid,
  p_observacao text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  -- Um id de usuário por coluna, resolvido pelo vínculo real da coluna:
  -- public.usuario_para_coluna devolve o id de public.usuarios quando a coluna
  -- aponta para lá (NULL quando a sessão não tem registro), e nunca um id que a
  -- chave estrangeira recusaria.
  v_usuario_lote uuid;      -- transferencia_lotes.usuario_id
  v_usuario_perna uuid;     -- transferencias_contas.usuario_id
  v_usuario_estorno uuid;   -- transferencias_contas.estornada_por
  v_usuario_lote_estorno uuid; -- transferencia_lotes.estornado_por
  v_usuario_auditoria uuid; -- auditoria_eventos.usuario_id
  v_origem_id integer;
  v_destino_id integer;
  v_valor numeric(14,2);
  v_status text;
  v_programacao integer;
  v_lote_id uuid;
  v_motivo text;
  v_lote_estorno uuid;
  v_saldo_origem numeric(14,2);
  v_data_origem date;
  v_saldo_destino numeric(14,2);
  v_data_destino date;
  v_data_alvo date;
  v_estorno_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado.' using errcode = '42501';
  end if;
  v_usuario_lote := public.usuario_para_coluna('transferencia_lotes', 'usuario_id');
  v_usuario_perna := public.usuario_para_coluna('transferencias_contas', 'usuario_id');
  v_usuario_estorno := public.usuario_para_coluna('transferencias_contas', 'estornada_por');
  v_usuario_lote_estorno := public.usuario_para_coluna('transferencia_lotes', 'estornado_por');
  v_usuario_auditoria := public.usuario_para_coluna('auditoria_eventos', 'usuario_id');

  if not public.pode_em_pagamentos_fase2('estornar_transferencia') then
    raise exception 'Você não tem permissão para estornar transferências.' using errcode = '42501';
  end if;

  v_motivo := nullif(trim(coalesce(p_observacao, '')), '');
  if v_motivo is null then
    raise exception 'Informe o motivo do estorno.';
  end if;

  select tc.conta_origem_id, tc.conta_destino_id, tc.valor, tc.status::text, tc.programacao_id, tc.lote_id
    into v_origem_id, v_destino_id, v_valor, v_status, v_programacao, v_lote_id
    from public.transferencias_contas tc
   where tc.id = p_transferencia_id
   for update;

  if not found then
    raise exception 'Transferência não encontrada.';
  end if;

  if v_status = 'estornada' then
    return jsonb_build_object('ok', true, 'ja_estornada', true, 'transferencia_id', p_transferencia_id);
  end if;

  if v_status = 'estorno' then
    raise exception 'Um estorno não pode ser estornado.';
  end if;

  perform pg_advisory_xact_lock(918273645, least(v_origem_id, v_destino_id));
  perform pg_advisory_xact_lock(918273645, greatest(v_origem_id, v_destino_id));

  -- Idempotência do estorno: a chave carrega o id da transferência original.
  insert into public.transferencia_lotes (
    chave_idempotencia, programacao_id, conta_destino_id, observacao, usuario_id,
    status, estorno_de_lote_id, motivo_estorno, valor_total, quantidade_origens
  ) values (
    'estorno:' || p_transferencia_id::text, v_programacao, v_origem_id, v_motivo, v_usuario_lote,
    'estorno', v_lote_id, v_motivo, v_valor, 1
  )
  on conflict (chave_idempotencia) do nothing
  returning id into v_lote_estorno;

  if v_lote_estorno is null then
    return jsonb_build_object('ok', true, 'ja_estornada', true, 'transferencia_id', p_transferencia_id);
  end if;

  -- Movimento inverso: o destino devolve, a origem recebe.
  select sh.valor_saldo, sh.data_saldo
    into v_saldo_destino, v_data_destino
    from public.saldos_historico sh
   where sh.conta_id = v_destino_id
   order by sh.data_saldo desc, sh.id desc
   limit 1;

  if not found then
    v_saldo_destino := 0;
    v_data_destino := null;
  end if;
  v_saldo_destino := round(coalesce(v_saldo_destino, 0), 2);

  if v_valor > v_saldo_destino then
    raise exception 'Saldo insuficiente na conta que recebeu a transferência: saldo % e estorno de %.',
      to_char(v_saldo_destino, 'FM999999999990.00'), to_char(v_valor, 'FM999999999990.00');
  end if;

  select sh.valor_saldo, sh.data_saldo
    into v_saldo_origem, v_data_origem
    from public.saldos_historico sh
   where sh.conta_id = v_origem_id
   order by sh.data_saldo desc, sh.id desc
   limit 1;

  if not found then
    v_saldo_origem := 0;
    v_data_origem := null;
  end if;
  v_saldo_origem := round(coalesce(v_saldo_origem, 0), 2);

  v_data_alvo := greatest(current_date, coalesce(v_data_destino, current_date));
  insert into public.saldos_historico (conta_id, valor_saldo, data_saldo)
  values (v_destino_id, round(v_saldo_destino - v_valor, 2), v_data_alvo)
  on conflict (conta_id, data_saldo)
  do update set valor_saldo = excluded.valor_saldo;

  v_data_alvo := greatest(current_date, coalesce(v_data_origem, current_date));
  insert into public.saldos_historico (conta_id, valor_saldo, data_saldo)
  values (v_origem_id, round(v_saldo_origem + v_valor, 2), v_data_alvo)
  on conflict (conta_id, data_saldo)
  do update set valor_saldo = excluded.valor_saldo;

  -- A perna do estorno entra como registro NOVO: a original permanece.
  insert into public.transferencias_contas (
    lote_id, programacao_id, conta_origem_id, conta_destino_id, valor,
    saldo_origem_antes, saldo_origem_depois,
    saldo_destino_antes, saldo_destino_depois,
    data_movimento, observacao, usuario_id, status, estorno_de_transferencia_id, motivo_estorno
  ) values (
    v_lote_estorno, v_programacao, v_destino_id, v_origem_id, v_valor,
    v_saldo_destino, round(v_saldo_destino - v_valor, 2),
    v_saldo_origem, round(v_saldo_origem + v_valor, 2),
    v_data_alvo, v_motivo, v_usuario_perna, 'estorno', p_transferencia_id, v_motivo
  )
  returning id into v_estorno_id;

  update public.transferencias_contas
     set status = 'estornada',
         estornada_em = now(),
         estornada_por = v_usuario_estorno,
         motivo_estorno = v_motivo
   where id = p_transferencia_id;

  update public.transferencia_lotes
     set status = case
                    when not exists (
                      select 1 from public.transferencias_contas tc
                       where tc.lote_id = v_lote_id and tc.status = 'confirmada'
                    ) then 'estornada'
                    else status
                  end,
         estornado_em = now(),
         estornado_por = v_usuario_lote_estorno,
         motivo_estorno = v_motivo
   where id = v_lote_id;

  -- DOIS eventos: o estorno da original e a movimentação inversa.
  insert into public.auditoria_eventos (
    usuario_id, modulo, acao, registro_afetado, valor_anterior, valor_novo, nivel
  ) values (
    v_usuario_auditoria,
    'pagamentos',
    'estornou',
    'Transferência ' || p_transferencia_id::text,
    jsonb_build_object('status', v_status, 'valor', v_valor, 'conta_origem_id', v_origem_id, 'conta_destino_id', v_destino_id),
    jsonb_build_object('status', 'estornada', 'motivo', v_motivo, 'preservada', true)
      || public.rastro_do_login(v_usuario_auditoria),
    'critico'
  ), (
    v_usuario_auditoria,
    'pagamentos',
    'transferiu',
    'Estorno de transferência — lote ' || v_lote_estorno::text,
    jsonb_build_object(
      'conta_origem_id', v_destino_id,
      'saldo_antes', v_saldo_destino,
      'conta_destino_id', v_origem_id,
      'saldo_destino_antes', v_saldo_origem
    ),
    jsonb_build_object(
      'lote_id', v_lote_estorno,
      'estorno_de_transferencia_id', p_transferencia_id,
      'programacao_id', v_programacao,
      'valor', v_valor,
      'conta_origem_id', v_destino_id,
      'saldo_origem_depois', round(v_saldo_destino - v_valor, 2),
      'conta_destino_id', v_origem_id,
      'saldo_destino_depois', round(v_saldo_origem + v_valor, 2),
      'motivo', v_motivo,
      'eh_despesa', false
    ) || public.rastro_do_login(v_usuario_auditoria),
    'critico'
  );

  return jsonb_build_object(
    'ok', true,
    'ja_estornada', false,
    'transferencia_id', p_transferencia_id,
    'estorno_id', v_estorno_id,
    'lote_id', v_lote_estorno,
    'valor', v_valor,
    'eh_despesa', false
  );
end;
$fn$;

grant execute on function public.estornar_transferencia(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Nome de exibição do item — etapa nomeada e tipos reais no erro
-- ---------------------------------------------------------------------------
-- Corpo IGUAL ao da 20260905120000. As leituras já estavam protegidas
-- (pr.fechado::text), então aqui não há mudança de comportamento nenhuma: o
-- que faltava era o item 3 do pedido, o tratamento de erro que diz em que
-- ETAPA quebrou e qual o tipo real de cada coluna envolvida. Sem isso, uma
-- recusa de tipo nesta função chegaria à tela como 22P02 sem pista alguma --
-- exatamente o que aconteceu na conta do pagamento.
create or replace function public.definir_nome_exibicao_programacao(
  p_pagamento_id integer,
  p_nome text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_nome text;
  v_anterior text;
  v_programacao_id integer;
  v_fornecedor_id integer;
  v_fechado_texto text;
  v_etapa text := 'início';
  v_constraint text;
  v_tabela_erro text;
  v_coluna_erro text;
  v_detalhe_erro text;
begin
  v_etapa := 'conferência do login';
  if auth.uid() is null then
    raise exception 'Usuário não autenticado.' using errcode = '42501';
  end if;

  v_etapa := 'conferência do item enviado';
  if p_pagamento_id is null then
    raise exception 'Salve a programação antes de renomear este fornecedor.';
  end if;

  -- Espaços repetidos viram um só, campo vazio vira NULL ("usar o nome de
  -- sempre") e o texto é limitado ao mesmo tamanho aceito pela tela.
  v_etapa := 'limpeza do nome digitado';
  v_nome := nullif(btrim(regexp_replace(coalesce(p_nome, ''), '\s+', ' ', 'g')), '');
  if v_nome is not null then
    v_nome := left(v_nome, 120);
  end if;

  v_etapa := 'leitura do item da programação';
  select p.programacao_id, p.fornecedor_id, p.nome_exibicao_programacao
    into v_programacao_id, v_fornecedor_id, v_anterior
    from public.pagamentos p
   where p.id = p_pagamento_id
     and p.excluido_em is null
   for update;

  if not found then
    raise exception 'Item de pagamento não encontrado nesta programação.';
  end if;

  v_etapa := 'leitura da programação do item';
  select pr.fechado::text
    into v_fechado_texto
    from public.programacoes_pagamento pr
   where pr.id = v_programacao_id;

  if public.texto_verdadeiro(v_fechado_texto) then
    raise exception 'Programações históricas fechadas não podem ser alteradas.';
  end if;

  v_etapa := 'gravação do nome de exibição';
  update public.pagamentos
     set nome_exibicao_programacao = v_nome
   where id = p_pagamento_id;

  -- Trilha isolada: falha só dela não derruba a renomeação.
  v_etapa := 'registro na auditoria';
  begin
    insert into public.auditoria_eventos (
      usuario_id, modulo, acao, registro_afetado, valor_anterior, valor_novo, nivel
    ) values (
      public.usuario_auditoria_id(),
      'pagamentos',
      'alterou',
      'Nome de exibição do fornecedor na programação ' || coalesce(v_programacao_id::text, '--'),
      jsonb_build_object('nome_exibicao_programacao', v_anterior),
      jsonb_build_object(
        'nome_exibicao_programacao', v_nome,
        'pagamento_id', p_pagamento_id,
        'fornecedor_id', v_fornecedor_id
      ),
      'informacao'
    );
  exception when others then
    raise warning 'Nome de exibição do pagamento % gravado, mas o evento de auditoria não foi registrado (% -- %).',
      p_pagamento_id, sqlstate, sqlerrm;
  end;

  -- fornecedor_id volta na resposta de propósito: é a prova, na própria
  -- gravação, de que renomear não trocou o vínculo do item.
  return jsonb_build_object(
    'ok', true,
    'pagamento_id', p_pagamento_id,
    'programacao_id', v_programacao_id,
    'fornecedor_id', v_fornecedor_id,
    'nome_exibicao_programacao', v_nome
  );

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
      'Não foi possível gravar o nome de exibição na etapa "%". O banco recusou a operação com o código %.',
      v_etapa, sqlstate
      using errcode = 'P0001',
            detail = format(
              '%s | etapa=%s sqlstate=%s constraint=%s tabela=%s coluna=%s detalhe=%s | programacoes_pagamento.fechado=%s pagamentos.nome_exibicao_programacao=%s pagamentos.situacao=%s auditoria_eventos.nivel=%s',
              sqlerrm, v_etapa, sqlstate,
              coalesce(v_constraint, '-'),
              coalesce(v_tabela_erro, '-'),
              coalesce(v_coluna_erro, '-'),
              coalesce(v_detalhe_erro, '-'),
              public.tipo_da_coluna('programacoes_pagamento', 'fechado'),
              public.tipo_da_coluna('pagamentos', 'nome_exibicao_programacao'),
              public.tipo_da_coluna('pagamentos', 'situacao'),
              public.tipo_da_coluna('auditoria_eventos', 'nivel')
            ),
            hint = 'Leia o DETAIL: ele traz a mensagem crua do banco, a etapa e o tipo real de cada coluna envolvida. Renomear escreve uma única coluna de texto e não toca em valor, situação, conta ou saldo.';
end $$;

grant execute on function public.definir_nome_exibicao_programacao(integer, text) to authenticated;

comment on function public.definir_nome_exibicao_programacao(integer, text)
is 'Grava o nome de exibição de UM item da programação. Escreve somente pagamentos.nome_exibicao_programacao: não altera razão social, nome fantasia, apelido, CNPJ/CPF, cadastro, notas, processos, dados bancários, valores, saldos nem o vínculo fornecedor_id. Qualquer falha inesperada informa a etapa e os tipos reais das colunas.';

commit;
