-- Identificação mínima dos fornecedores usada pelo módulo de Certidões.
--
-- Esta view já existe no banco de produção e esta migration apenas versiona a
-- definição existente. Ela não expõe dados bancários nem alíquotas tributárias.
create or replace view public.fornecedores_identificacao
with (security_barrier = true) as
select
  f.id,
  f.razao_social,
  f.nome_fantasia,
  f.cpf_cnpj,
  f.secretaria_id,
  f.ativo
from public.fornecedores f
where f.excluido_em is null
  and public.pode_em_certidoes('visualizar');

comment on view public.fornecedores_identificacao is
  'Identificação mínima dos fornecedores para o módulo Certidões, liberada pela permissão efetiva do próprio módulo.';

revoke all on public.fornecedores_identificacao from public;
revoke all on public.fornecedores_identificacao from anon;
grant select on public.fornecedores_identificacao to authenticated;
