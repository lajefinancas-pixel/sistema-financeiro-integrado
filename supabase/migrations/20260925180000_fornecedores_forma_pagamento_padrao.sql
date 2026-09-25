-- Preferência documental do fornecedor. Não movimenta saldo, não altera
-- baixas/estornos, Programação Diária nem processos já existentes.
alter table if exists public.fornecedores
  add column if not exists forma_pagamento_padrao text not null default 'dados_bancarios_pix';

do $$ begin
  alter table public.fornecedores
    add constraint fornecedores_forma_pagamento_padrao_check
    check (forma_pagamento_padrao in ('dados_bancarios_pix', 'boleto'));
exception when duplicate_object or undefined_table then null; end $$;
