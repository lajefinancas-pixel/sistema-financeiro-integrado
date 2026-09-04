-- Agência e PIX no cadastro da conta bancária (módulo Saldos das Contas).
--
-- O que esta migration acrescenta, sem tocar em nenhum saldo já lançado:
--
--   1. contas_bancarias.agencia -> a agência da conta, no MESMO registro da
--      conta. Opcional: conta sem agência informada continua valendo.
--   2. contas_bancarias.possui_pix + pix_tipo_chave + pix_chave + pix_titular
--      + pix_documento_titular -> os dados de PIX da conta, também no MESMO
--      registro. Não existe tabela separada de PIX, nem cadastro à parte:
--      é o mesmo formulário e o mesmo INSERT/UPDATE da conta.
--   3. Conferência do tipo da chave (cpf, cnpj, telefone, email, aleatoria),
--      declarada só quando os dados já gravados a respeitam.
--
-- Todas as colunas são NOVAS e OPCIONAIS. Nenhuma coluna é removida ou
-- renomeada, nenhum registro é alterado e nenhum saldo é recalculado:
--
--   * o saldo continua morando SÓ em public.saldos_historico, por data;
--   * a baixa continua NÃO debitando saldo de conta;
--   * conta selecionada continua não sendo conta debitada.
--
-- PIX é informação de cadastro da conta. Nada aqui movimenta, reserva ou
-- bloqueia valor.
--
-- IDEMPOTENTE: pode rodar mais de uma vez sem efeito colateral.

begin;

-- ---------------------------------------------------------------------------
-- 0. Validação dos tipos reais antes de qualquer alteração de estrutura
-- ---------------------------------------------------------------------------
do $$
declare
  item record;
  tipo_real text;
begin
  for item in
    select * from (values
      ('contas_bancarias', 'id', 'integer'),
      ('contas_bancarias', 'secretaria_id', 'integer'),
      ('contas_bancarias', 'banco_id', 'integer')
    ) as tipos(tabela, coluna, esperado)
  loop
    if to_regclass(format('public.%I', item.tabela)) is null then
      raise exception 'Estrutura incompatível: public.% não existe.', item.tabela;
    end if;

    select format_type(a.atttypid, a.atttypmod)
      into tipo_real
      from pg_attribute a
     where a.attrelid = to_regclass(format('public.%I', item.tabela))
       and a.attname = item.coluna
       and not a.attisdropped;

    if tipo_real is distinct from item.esperado then
      raise exception 'Tipo incompatível em public.%.%: esperado %, encontrado %.',
        item.tabela, item.coluna, item.esperado, coalesce(tipo_real, 'coluna ausente');
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Colunas de agência e PIX, no próprio registro da conta
-- ---------------------------------------------------------------------------
alter table public.contas_bancarias
  add column if not exists agencia text,
  add column if not exists possui_pix boolean not null default false,
  add column if not exists pix_tipo_chave text,
  add column if not exists pix_chave text,
  add column if not exists pix_titular text,
  add column if not exists pix_documento_titular text;

-- ---------------------------------------------------------------------------
-- 2. Tipo da chave PIX conferido no banco
-- ---------------------------------------------------------------------------
-- Os mesmos cinco tipos oferecidos no formulário. A restrição só é declarada
-- quando os dados já gravados a respeitam; se algum registro tiver outro
-- valor, fica o aviso e NADA é alterado ou apagado — a validação da tela
-- continua valendo para os cadastros novos.
do $$
declare
  fora integer;
begin
  if exists (
    select 1
      from pg_constraint
     where conrelid = to_regclass('public.contas_bancarias')
       and conname = 'contas_bancarias_pix_tipo_chave_check'
  ) then
    return;
  end if;

  select count(*)
    into fora
    from public.contas_bancarias
   where pix_tipo_chave is not null
     and pix_tipo_chave not in ('cpf', 'cnpj', 'telefone', 'email', 'aleatoria');

  if fora > 0 then
    raise notice 'public.contas_bancarias tem % registro(s) com pix_tipo_chave fora da lista conhecida. A restrição não foi criada; nada foi alterado.', fora;
  else
    alter table public.contas_bancarias
      add constraint contas_bancarias_pix_tipo_chave_check
      check (
        pix_tipo_chave is null
        or pix_tipo_chave in ('cpf', 'cnpj', 'telefone', 'email', 'aleatoria')
      );
  end if;
end $$;

commit;
