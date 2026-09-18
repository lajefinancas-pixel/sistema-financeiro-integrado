begin;

-- A implementação validada criada pela migration do débito passa a ser a
-- própria função pública. Assim existe uma única RPC de registro e uma de
-- estorno, com a assinatura que o frontend usa.
do $migration$
declare
  v_definicao text;
  v_funcao record;
begin
  if to_regprocedure('public.registrar_baixa_nota_validada(text,text,numeric,date,integer,text)') is not null then
    drop function if exists public.registrar_baixa_nota(text,text,numeric,date,integer,text);
    alter function public.registrar_baixa_nota_validada(text,text,numeric,date,integer,text)
      rename to registrar_baixa_nota;
  end if;

  if to_regprocedure('public.estornar_baixa_nota_validada(text,text)') is not null then
    drop function if exists public.estornar_baixa_nota(text,text);
    alter function public.estornar_baixa_nota_validada(text,text)
      rename to estornar_baixa_nota;
  end if;

  if to_regprocedure('public.registrar_baixa_nota(text,text,numeric,date,integer,text)') is null
     or to_regprocedure('public.estornar_baixa_nota(text,text)') is null then
    raise exception 'As funções canônicas de baixa não existem. Aplique antes as migrations de baixas por nota.';
  end if;

  -- A implementação anterior dizia "false" no retorno e na auditoria porque o
  -- débito ainda não existia. O gatilho atual já movimenta o saldo na mesma
  -- transação; a definição consolidada passa a registrar esse fato corretamente.
  select pg_get_functiondef('public.registrar_baixa_nota(text,text,numeric,date,integer,text)'::regprocedure)
    into v_definicao;
  execute replace(v_definicao, '''movimentou_saldo'', false', '''movimentou_saldo'', true');

  select pg_get_functiondef('public.estornar_baixa_nota(text,text)'::regprocedure)
    into v_definicao;
  execute replace(v_definicao, '''movimentou_saldo'', false', '''movimentou_saldo'', true');

  -- Remove todas as assinaturas das duas famílias antigas. Não se usa CASCADE:
  -- uma dependência inesperada aborta a migration em vez de apagar outro objeto.
  for v_funcao in
    select p.oid::regprocedure as assinatura
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'registrar_baixa_pagamento', 'estornar_baixa_pagamento',
         'registrar_baixa_nota_validada', 'estornar_baixa_nota_validada'
       )
  loop
    execute format('drop function %s', v_funcao.assinatura);
  end loop;
end
$migration$;

revoke all on function public.registrar_baixa_nota(text,text,numeric,date,integer,text) from public;
revoke all on function public.estornar_baixa_nota(text,text) from public;
grant execute on function public.registrar_baixa_nota(text,text,numeric,date,integer,text) to authenticated;
grant execute on function public.estornar_baixa_nota(text,text) to authenticated;

comment on function public.registrar_baixa_nota(text,text,numeric,date,integer,text)
  is 'RPC canônica: registra a baixa da nota, zera ou reduz o valor em aberto, debita a conta e audita atomicamente.';
comment on function public.estornar_baixa_nota(text,text)
  is 'RPC canônica: estorna a baixa da nota, recompõe o valor em aberto, devolve o saldo e audita atomicamente.';

-- A varredura cria alertas somente para o usuário da própria sessão. Esta
-- política não amplia acesso às certidões nem permite avisar em nome de outro.
alter table public.notificacoes enable row level security;
grant select, insert, update, delete on public.notificacoes to authenticated;

drop policy if exists "notificacoes_insert_certidao_propria" on public.notificacoes;
create policy "notificacoes_insert_certidao_propria"
  on public.notificacoes
  for insert
  to authenticated
  with check (
    certidao_id is not null
    and usuario_id in (
      select u.id from public.usuarios u where u.auth_id = auth.uid()
    )
  );

-- Garante que o PostgREST descarte imediatamente assinaturas antigas em cache.
notify pgrst, 'reload schema';

commit;
