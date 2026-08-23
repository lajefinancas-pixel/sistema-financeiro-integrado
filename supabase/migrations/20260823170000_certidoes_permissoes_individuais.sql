-- Módulo "Certidões" na aba "Permissões" da tela de edição de usuário.
--
-- A aba lê o padrão do perfil em public.perfis_permissoes, a permissão que vale
-- de fato na view public.permissoes_efetivas e grava os ajustes individuais em
-- public.permissoes_excecao. O módulo 'certidoes' entrou nessa lista junto com o
-- módulo de Certidões; esta migration garante que as três peças aceitem esse
-- módulo do mesmo jeito que aceitam Saldos, Fornecedores, Pagamentos e os
-- demais, para que marcar/desmarcar e "Restaurar padrão do perfil" funcionem
-- sem erro para qualquer usuário.
--
-- O que esta migration faz:
--   1. Garante uma linha padrão de 'certidoes' em perfis_permissoes para TODO
--      perfil de acesso — inclusive perfis criados depois da migration do
--      módulo de Certidões, que ficariam sem padrão para a aba comparar.
--   2. Se as tabelas de permissão tiverem uma restrição CHECK enumerando os
--      módulos aceitos e essa lista não incluir 'certidoes', recria a restrição
--      acrescentando somente esse módulo. Nenhum módulo já aceito é removido.
--
-- Nada aqui cria tabela ou coluna, altera a view permissoes_efetivas, mexe em
-- outros módulos (Saldos, Fornecedores, Pagamentos, Tarefas, Histórico,
-- Relatórios, Auditoria, Configurações) ou muda o funcionamento da aba
-- (herança de perfil, exceções, checkboxes por módulo).
--
-- A migration é IDEMPOTENTE: pode ser rodada mais de uma vez sem duplicar
-- linhas nem reescrever restrições que já aceitam 'certidoes'.

-- ---------------------------------------------------------------------------
-- 1. Padrão do perfil para 'certidoes' em todo perfil de acesso
-- ---------------------------------------------------------------------------
-- Mesmos valores da migration do módulo: Administrador com tudo liberado,
-- Gestora Financeira podendo ver, cadastrar e editar, e os demais perfis sem
-- acesso (a própria aba "Permissões" ajusta caso a caso).
insert into public.perfis_permissoes (
  perfil_id, modulo,
  pode_visualizar, pode_cadastrar, pode_editar, pode_excluir, pode_aprovar, pode_visualizar_valores
)
select
  p.id,
  'certidoes',
  p.nome in ('Administrador', 'Gestora Financeira'),
  p.nome in ('Administrador', 'Gestora Financeira'),
  p.nome in ('Administrador', 'Gestora Financeira'),
  p.nome = 'Administrador',
  p.nome = 'Administrador',
  false
from public.perfis_acesso p
where not exists (
  select 1
  from public.perfis_permissoes pp
  where pp.perfil_id = p.id
    and pp.modulo = 'certidoes'
);

-- ---------------------------------------------------------------------------
-- 2. Restrições CHECK de módulo que ainda não conhecem 'certidoes'
-- ---------------------------------------------------------------------------
-- Bancos em que a coluna "modulo" tem uma lista fixa de módulos aceitos
-- rejeitariam a exceção individual de Certidões na hora de salvar. Aqui a
-- restrição é recriada como "(condição original) or modulo = 'certidoes'":
-- tudo que era aceito continua aceito, só o módulo novo é acrescentado.
do $$
declare
  tabela text;
  restricao record;
  corpo text;
begin
  foreach tabela in array array['public.permissoes_excecao', 'public.perfis_permissoes']
  loop
    if to_regclass(tabela) is null then
      continue;
    end if;

    for restricao in
      select conname, pg_get_constraintdef(oid) as definicao
      from pg_constraint
      where conrelid = to_regclass(tabela)
        and contype = 'c'
        and pg_get_constraintdef(oid) like '%modulo%'
        -- Só listas de módulos: a restrição precisa citar um módulo conhecido...
        and pg_get_constraintdef(oid) like '%''saldos''%'
        -- ...e ainda não citar o de Certidões.
        and pg_get_constraintdef(oid) not like '%''certidoes''%'
    loop
      corpo := regexp_replace(restricao.definicao, '\s+NOT VALID$', '');
      corpo := regexp_replace(corpo, '^CHECK\s*', '');

      execute format('alter table %s drop constraint %I', tabela, restricao.conname);
      execute format(
        'alter table %s add constraint %I check ((%s) or modulo = ''certidoes'')',
        tabela, restricao.conname, corpo
      );
    end loop;
  end loop;
end $$;
