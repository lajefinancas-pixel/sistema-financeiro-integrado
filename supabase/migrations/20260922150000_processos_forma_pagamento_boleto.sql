-- Forma de pagamento é informação documental. Esta migration não movimenta
-- saldo, não altera baixas e não redefine funções financeiras.
alter table if exists public.processos_servicos
  add column if not exists forma_pagamento text not null default 'dados_bancarios_pix',
  add column if not exists boleto_codigo text,
  add column if not exists boleto_beneficiario text,
  add column if not exists boleto_documento text,
  add column if not exists boleto_vencimento date,
  add column if not exists boleto_valor numeric(14,2);

alter table if exists public.processos_diarias
  add column if not exists forma_pagamento text not null default 'dados_bancarios_pix',
  add column if not exists boleto_codigo text,
  add column if not exists boleto_beneficiario text,
  add column if not exists boleto_documento text,
  add column if not exists boleto_vencimento date,
  add column if not exists boleto_valor numeric(14,2);

do $$ begin
  alter table public.processos_servicos add constraint processos_servicos_forma_pagamento_check
    check (forma_pagamento in ('dados_bancarios_pix', 'boleto'));
exception when duplicate_object or undefined_table then null; end $$;
do $$ begin
  alter table public.processos_diarias add constraint processos_diarias_forma_pagamento_check
    check (forma_pagamento in ('dados_bancarios_pix', 'boleto'));
exception when duplicate_object or undefined_table then null; end $$;
