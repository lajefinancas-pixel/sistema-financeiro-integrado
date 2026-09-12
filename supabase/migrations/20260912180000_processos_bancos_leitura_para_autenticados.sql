-- ---------------------------------------------------------------------------
-- A LISTA DE BANCOS PASSA A SER LEGÍVEL POR QUALQUER PESSOA AUTENTICADA
-- ---------------------------------------------------------------------------
-- public.processos_bancos nasceu como cadastro interno do módulo Processos, e
-- por isso a LEITURA dela exigia a permissão de visualizar o módulo
-- (public.pode_em_processos('processos_diarias', 'visualizar')).
--
-- Ela deixou de ser só do módulo. A MESMA lista de número e nome passou a
-- alimentar a escolha do banco em todo o sistema:
--
--   - os dados bancários dos documentos do módulo Processos, como antes;
--   - os DADOS PARA PAGAMENTO do fornecedor;
--   - o cadastro das CONTAS BANCÁRIAS.
--
-- Quem trabalha nessas telas não tem — e não precisa ter — permissão no módulo
-- Processos. Com a regra antiga a consulta voltava vazia para essas pessoas, e a
-- tela caía no campo de texto livre que a lista existe justamente para acabar.
--
-- Então a LEITURA vira pública para quem está autenticado. É seguro: a tabela
-- tem SÓ O NÚMERO E O NOME DO BANCO — "001", "Banco do Brasil" — e nada mais.
-- Não há dado pessoal, valor, saldo, conta, agência, chave PIX nem vínculo com
-- fornecedor. É a mesma informação que está impressa na porta de qualquer
-- agência.
--
-- ---------------------------------------------------------------------------
-- A ESCRITA NÃO MUDA. NADA.
-- ---------------------------------------------------------------------------
-- Cadastrar, editar e inativar banco continuam exigindo EXATAMENTE as mesmas
-- permissões de antes, pelas MESMAS regras, e a exclusão continua proibida para
-- quem está autenticado:
--
--   insert -> public.pode_em_processos('processos_diarias', 'cadastrar')
--   update -> public.pode_em_processos('processos_diarias', 'editar')
--   delete -> revogado
--
-- As duas políticas de escrita são reescritas com o MESMO texto de origem, e
-- apenas para que esta migration seja a fotografia completa das regras da
-- tabela: nenhuma condição é afrouxada, adicionada ou removida.
--
-- ---------------------------------------------------------------------------
-- O QUE ESTA MIGRATION NÃO FAZ
-- ---------------------------------------------------------------------------
-- NENHUMA tabela é criada, removida ou renomeada. NENHUMA coluna é criada,
-- removida ou renomeada. NENHUMA linha é inserida, alterada ou apagada — o que
-- já está cadastrado permanece exatamente como está, inclusive o que foi
-- digitado à mão. NENHUMA permissão de nenhum outro módulo é tocada.
--
-- Ela não escreve, não altera e não referencia public.pagamentos,
-- public.pagamentos_baixas, public.valores_em_aberto, public.saldos_historico,
-- public.contas_bancarias, public.transferencias_contas,
-- public.programacoes_pagamento, public.fornecedores nem public.secretarias.
-- Nada aqui debita conta, dá baixa em nota, altera saldo, marca fornecedor como
-- pago ou cria pagamento.
--
-- Rodar duas vezes é inofensivo.
--
-- ⚠️ RODAR À MÃO no SQL Editor do Supabase, como as outras deste módulo.
-- ⚠️ DEPENDE de 20260911240000_processos_solicitantes_e_bancos.sql, que é quem
--    cria a tabela. Se ela ainda não foi rodada, esta não faz nada e avisa.
-- ---------------------------------------------------------------------------

begin;

do $$
begin
  if to_regclass('public.processos_bancos') is null then
    raise notice
      'public.processos_bancos ainda não existe: rode antes a migration 20260911240000_processos_solicitantes_e_bancos.sql. Nada foi alterado.';
    return;
  end if;

  -- ------------------------------------------------------------------------
  -- LEITURA: qualquer pessoa autenticada. A lista é referência pública.
  -- ------------------------------------------------------------------------
  execute 'drop policy if exists "processos_bancos_select" on public.processos_bancos';
  execute 'create policy "processos_bancos_select"
             on public.processos_bancos
             for select to authenticated
             using (true)';

  -- ------------------------------------------------------------------------
  -- ESCRITA: idêntica à de antes, condição por condição.
  -- ------------------------------------------------------------------------
  execute 'drop policy if exists "processos_bancos_insert" on public.processos_bancos';
  execute 'create policy "processos_bancos_insert"
             on public.processos_bancos
             for insert to authenticated
             with check (public.pode_em_processos(''processos_diarias'', ''cadastrar''))';

  execute 'drop policy if exists "processos_bancos_update" on public.processos_bancos';
  execute 'create policy "processos_bancos_update"
             on public.processos_bancos
             for update to authenticated
             using (public.pode_em_processos(''processos_diarias'', ''editar''))
             with check (public.pode_em_processos(''processos_diarias'', ''editar''))';

  -- Os mesmos direitos de tabela de antes: sem delete, e nada para anon.
  execute 'grant select, insert, update on public.processos_bancos to authenticated';
  execute 'revoke delete on public.processos_bancos from authenticated';
  execute 'revoke all on public.processos_bancos from anon';

  -- O que a tabela é, agora que serve o sistema inteiro.
  execute $ddl$
    comment on table public.processos_bancos is
      'Lista de REFERÊNCIA dos bancos — número e nome — usada em TODO o sistema: nos dados bancários dos documentos do módulo Processos, nos dados para pagamento do fornecedor e no cadastro das contas bancárias. A LEITURA é liberada para qualquer pessoa autenticada, porque o conteúdo é público (só "001" e "Banco do Brasil"); CADASTRAR e EDITAR continuam exigindo permissão no módulo Processos, e a exclusão continua proibida — banco fora de uso é INATIVADO. Documental: não debita conta, não dá baixa em NF, não altera saldo e não cria pagamento. ⚠️ NÃO é o cadastro de contas bancárias do município e não tem relação com ele.'
  $ddl$;
end $$;

commit;
