-- Exclusão de secretaria pela tela de Configurações > Financeiro.
--
-- A tabela public.secretarias já existe e continua exatamente como está: esta
-- migration NÃO cria coluna, NÃO altera dado nenhum e NÃO habilita RLS onde ela
-- ainda não estiver habilitada (ligar RLS aqui derrubaria a leitura das telas
-- de Saldos, Fornecedores, Pagamentos, Histórico e Relatórios). O que ela faz é
-- só liberar o DELETE para quem administra o sistema.
--
-- Por que é preciso: as telas aprovadas nunca apagam uma secretaria -- Saldos
-- faz baixa lógica (ativo = false). A categoria Financeiro das Configurações
-- passa a permitir a exclusão de verdade, e somente quando a secretaria não
-- tem nenhuma conta bancária nem nenhum fornecedor vinculado (a conferência é
-- feita na aplicação, antes do delete, e refeita contra o banco no momento do
-- clique). Sem uma política de delete, a exclusão simplesmente não afeta linha
-- alguma quando a RLS está ligada.
--
-- Quem pode: a mesma regra de todas as configurações -- pode_editar no módulo
-- 'administracao', conferido pela função public.pode_editar_configuracoes()
-- criada em 20260811140000_configuracoes_sistema.sql.
--
-- Segurança de integridade: as chaves estrangeiras de contas_bancarias e
-- fornecedores continuam sendo a última barreira. Se algum registro ainda
-- apontar para a secretaria, o próprio banco recusa o delete (erro 23503) e a
-- tela mostra a mensagem explicando o bloqueio.

grant delete on public.secretarias to authenticated;

drop policy if exists "secretarias_delete_administracao" on public.secretarias;
create policy "secretarias_delete_administracao"
  on public.secretarias
  for delete
  to authenticated
  using (public.pode_editar_configuracoes());
