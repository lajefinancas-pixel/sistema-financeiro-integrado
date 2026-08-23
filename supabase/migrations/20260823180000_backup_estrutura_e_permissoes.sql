-- Categoria BACKUP das Configurações — estrutura de registro e permissões próprias.
--
-- A tabela public.backups_log já existe desde
-- 20260811160000_notificacoes_preferencias_e_backups.sql, onde nasceu como um
-- registro informativo de duas coisas: cópias ('backup') e solicitações de
-- restauração ('restauracao'). Esta migration NÃO recria a tabela: ela amplia o
-- que já está lá para que a tela passe a registrar a EXECUÇÃO de um backup —
-- quando começou, quando terminou, que tamanho tinha e, quando dá errado, por quê.
--
-- O que esta migration faz:
--   1. Acrescenta a backups_log as colunas iniciado_em, concluido_em,
--      tamanho_bytes e detalhes_erro, e amplia as listas aceitas em `tipo`
--      ('automatico', 'manual') e `status` ('em_andamento', 'concluido',
--      'falhou'). Os valores antigos continuam aceitos, então nenhuma linha já
--      gravada é invalidada.
--   2. Cria o módulo de permissão 'backup', com as CINCO permissões da categoria
--      concedidas separadamente pelo Administrador (ver item 2 abaixo).
--   3. Reescreve as políticas de RLS de backups_log em cima dessas permissões,
--      incluindo — pela primeira vez nesta tabela — um UPDATE bem estreito, que
--      só existe para fechar o backup manual que a própria pessoa abriu.
--
-- Nada aqui altera saldos, fornecedores, pagamentos, tarefas, usuários,
-- histórico, relatórios, auditoria, certidões ou qualquer outra categoria das
-- Configurações. Nenhum módulo de permissão existente é alterado ou removido.
--
-- A migration é IDEMPOTENTE: pode ser rodada mais de uma vez sem duplicar
-- colunas, linhas de permissão ou políticas.

-- ---------------------------------------------------------------------------
-- 1. Estrutura de public.backups_log
-- ---------------------------------------------------------------------------

-- A tabela só existe se a migration de 20260811160000 já tiver rodado. Criar
-- aqui o mínimo garante que este arquivo funcione mesmo num banco novo.
create table if not exists public.backups_log (
  id uuid primary key default gen_random_uuid(),
  tipo text not null default 'manual',
  status text not null default 'em_andamento',
  descricao text,
  justificativa text,
  usuario_id uuid references public.usuarios (id) on delete set null,
  criado_em timestamptz not null default now()
);

-- Quando o backup começou. Em linhas antigas (registros informativos e
-- solicitações de restauração) vale o próprio instante de criação.
alter table public.backups_log
  add column if not exists iniciado_em timestamptz;

update public.backups_log
   set iniciado_em = criado_em
 where iniciado_em is null;

alter table public.backups_log
  alter column iniciado_em set default now();

alter table public.backups_log
  alter column iniciado_em set not null;

-- Nulo enquanto o backup está em andamento e nas linhas que não descrevem uma
-- execução (solicitação de restauração, por exemplo).
alter table public.backups_log
  add column if not exists concluido_em timestamptz;

-- Tamanho do backup concluído. bigint porque um dump de banco passa de 2 GB sem
-- dificuldade. Nulo quando não se aplica ou ainda não se sabe.
alter table public.backups_log
  add column if not exists tamanho_bytes bigint;

-- Preenchido apenas quando status = 'falhou': o motivo, para quem for investigar.
alter table public.backups_log
  add column if not exists detalhes_erro text;

alter table public.backups_log
  drop constraint if exists backups_log_tamanho_nao_negativo;
alter table public.backups_log
  add constraint backups_log_tamanho_nao_negativo
  check (tamanho_bytes is null or tamanho_bytes >= 0)
  not valid;

-- Listas de valores aceitos.
--
-- 'automatico' -> execução da rotina agendada (usuario_id fica nulo: não há
--                 pessoa por trás dela);
-- 'manual'     -> execução pedida por alguém na tela de Configurações.
--
-- 'backup' e 'restauracao' continuam aceitos porque são os valores das linhas já
-- gravadas — tirá-los da lista invalidaria o histórico existente.
alter table public.backups_log
  drop constraint if exists backups_log_tipo_check;
alter table public.backups_log
  add constraint backups_log_tipo_check
  check (tipo in ('automatico', 'manual', 'backup', 'restauracao'));

-- 'em_andamento' -> começou e ainda não terminou;
-- 'concluido'    -> terminou bem (tamanho_bytes e concluido_em preenchidos);
-- 'falhou'       -> terminou mal (detalhes_erro preenchido).
--
-- 'registrado' e 'falha' seguem aceitos pelo mesmo motivo do bloco acima.
alter table public.backups_log
  drop constraint if exists backups_log_status_check;
alter table public.backups_log
  add constraint backups_log_status_check
  check (status in ('em_andamento', 'concluido', 'falhou', 'registrado', 'falha'));

-- Um backup automático não tem autor; um manual sempre tem. A regra fica no
-- banco para que nenhuma rotina futura grave um backup manual órfão.
alter table public.backups_log
  drop constraint if exists backups_log_autor_por_tipo;
alter table public.backups_log
  add constraint backups_log_autor_por_tipo
  check (tipo <> 'manual' or usuario_id is not null)
  not valid;

-- A tela lista "mais recentes primeiro" por iniciado_em.
create index if not exists backups_log_iniciado_em_idx
  on public.backups_log (iniciado_em desc);

create index if not exists backups_log_tipo_iniciado_em_idx
  on public.backups_log (tipo, iniciado_em desc);

-- ---------------------------------------------------------------------------
-- 2. Módulo de permissão 'backup'
-- ---------------------------------------------------------------------------
-- O sistema inteiro modela permissão como "cinco ações por módulo", gravadas em
-- perfis_permissoes (padrão do perfil), ajustadas em permissoes_excecao (por
-- usuário) e resolvidas na view permissoes_efetivas. Em vez de inventar um
-- mecanismo novo só para o Backup, a categoria ganha um MÓDULO próprio e usa as
-- cinco colunas que já existem — cada uma com um significado explícito aqui:
--
--   pode_visualizar -> Visualizar backups (abrir a categoria e ver a situação)
--   pode_cadastrar  -> Gerar backup manual
--   pode_aprovar    -> Visualizar o histórico de backups
--   pode_excluir    -> Restaurar backup
--   pode_editar     -> Administrar as configurações de backup
--
-- São cinco permissões DISTINTAS: alguém pode gerar backup manual sem poder
-- restaurar, ver o histórico sem poder gerar, e assim por diante.

-- 2.1. Restrições CHECK que enumeram os módulos aceitos precisam conhecer
-- 'backup', senão a exceção individual da categoria seria recusada na gravação.
-- Mesma abordagem da migration de Certidões: a condição original é preservada
-- inteira e o módulo novo é acrescentado com um "or".
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
        and pg_get_constraintdef(oid) like '%''saldos''%'
        and pg_get_constraintdef(oid) not like '%''backup''%'
    loop
      corpo := regexp_replace(restricao.definicao, '\s+NOT VALID$', '');
      corpo := regexp_replace(corpo, '^CHECK\s*', '');

      execute format('alter table %s drop constraint %I', tabela, restricao.conname);
      execute format(
        'alter table %s add constraint %I check ((%s) or modulo = ''backup'')',
        tabela, restricao.conname, corpo
      );
    end loop;
  end loop;
end $$;

-- 2.2. Padrão do perfil para 'backup' em TODO perfil de acesso.
--
-- Só o Administrador nasce com as cinco permissões. Os demais perfis nascem sem
-- nenhuma, de propósito: o enunciado da categoria é que estas permissões sejam
-- concedidas SEPARADAMENTE pelo Administrador, caso a caso, na aba "Permissões"
-- da tela de usuário. Conceder por padrão contrariaria isso.
insert into public.perfis_permissoes (
  perfil_id, modulo,
  pode_visualizar, pode_cadastrar, pode_editar, pode_excluir, pode_aprovar, pode_visualizar_valores
)
select
  p.id,
  'backup',
  p.nome = 'Administrador',
  p.nome = 'Administrador',
  p.nome = 'Administrador',
  p.nome = 'Administrador',
  p.nome = 'Administrador',
  false
from public.perfis_acesso p
where not exists (
  select 1
  from public.perfis_permissoes pp
  where pp.perfil_id = p.id
    and pp.modulo = 'backup'
);

-- 2.3. Uma função por permissão, para que as políticas de RLS (e uma eventual
-- Edge Function) leiam como a regra é enunciada.
create or replace function public.pode_em_backup(acao text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.usuarios u
    join public.permissoes_efetivas pe
      on pe.usuario_id = u.id
     and pe.modulo = 'backup'
    where u.auth_id = auth.uid()
      and u.status = 'ativo'
      and case acao
            when 'visualizar' then pe.pode_visualizar
            when 'cadastrar'  then pe.pode_cadastrar
            when 'editar'     then pe.pode_editar
            when 'excluir'    then pe.pode_excluir
            when 'aprovar'    then pe.pode_aprovar
            else false
          end
  );
$$;

-- Ver a situação dos backups.
--
-- Vale também para quem tem pode_visualizar em 'administracao': a categoria vive
-- dentro das Configurações, e quem já podia abrir a tela não perde o acesso de
-- leitura por causa desta migration. As demais permissões abaixo NÃO têm essa
-- porta: gerar, restaurar e administrar exigem o módulo 'backup'.
create or replace function public.pode_ver_backups()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.pode_em_backup('visualizar')
      or exists (
           select 1
           from public.usuarios u
           join public.permissoes_efetivas pe
             on pe.usuario_id = u.id
            and pe.modulo = 'administracao'
           where u.auth_id = auth.uid()
             and u.status = 'ativo'
             and pe.pode_visualizar
         );
$$;

create or replace function public.pode_gerar_backup_manual()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.pode_em_backup('cadastrar');
$$;

create or replace function public.pode_ver_historico_backups()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.pode_em_backup('aprovar');
$$;

create or replace function public.pode_restaurar_backup()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.pode_em_backup('excluir');
$$;

create or replace function public.pode_administrar_backup()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.pode_em_backup('editar');
$$;

-- ---------------------------------------------------------------------------
-- 3. Políticas de acesso a public.backups_log
-- ---------------------------------------------------------------------------

alter table public.backups_log enable row level security;

-- Leitura: quem pode ver os backups OU quem tem a permissão de histórico.
-- (São a mesma tabela; a distinção entre "ver a situação" e "abrir o histórico
-- completo" é aplicada na tela, que só oferece o histórico a quem tem a segunda.)
drop policy if exists "backups_log_select_permissao" on public.backups_log;
create policy "backups_log_select_permissao"
  on public.backups_log
  for select
  to authenticated
  using (public.pode_ver_backups() or public.pode_ver_historico_backups());

-- Gravação a partir da tela. Três caminhos, três permissões:
--   backup manual   -> pode_gerar_backup_manual()
--   restauração     -> pode_restaurar_backup()
--   linha antiga    -> pode_administrar_backup()  (tipo 'backup' informativo)
--
-- Em todos eles o autor é obrigatoriamente o usuário da sessão, para que ninguém
-- registre em nome de outra pessoa. Backup 'automatico' não entra por aqui: ele
-- não tem autor e será gravado pela rotina de backend, com a chave de serviço.
drop policy if exists "backups_log_insert_administracao" on public.backups_log;
drop policy if exists "backups_log_insert_permissao" on public.backups_log;
create policy "backups_log_insert_permissao"
  on public.backups_log
  for insert
  to authenticated
  with check (
    usuario_id is not null
    and usuario_id = public.meu_usuario_ativo_id()
    and case tipo
          when 'manual'      then public.pode_gerar_backup_manual()
          when 'restauracao' then public.pode_restaurar_backup()
          when 'backup'      then public.pode_administrar_backup()
          else false
        end
  );

-- Atualização: existe por um motivo só. Um backup manual é aberto como
-- 'em_andamento' e precisa ser FECHADO quando termina — como 'concluido', com o
-- tamanho, ou como 'falhou', com o motivo. Fora disso a tabela continua imutável:
--   - só a própria linha, do próprio autor;
--   - só quando ela ainda está em andamento;
--   - só para um dos dois estados finais;
--   - tipo e autor não podem mudar no caminho.
drop policy if exists "backups_log_update_fechar_manual" on public.backups_log;
create policy "backups_log_update_fechar_manual"
  on public.backups_log
  for update
  to authenticated
  using (
    public.pode_gerar_backup_manual()
    and tipo = 'manual'
    and status = 'em_andamento'
    and usuario_id = public.meu_usuario_ativo_id()
  )
  with check (
    tipo = 'manual'
    and status in ('concluido', 'falhou')
    and usuario_id = public.meu_usuario_ativo_id()
  );

-- Sem política de delete: nenhum registro de backup é apagado pela aplicação.

grant select, insert, update on public.backups_log to authenticated;
revoke delete, truncate on public.backups_log from authenticated;
revoke all on public.backups_log from anon;

-- Nenhum insert de exemplo: a tabela continua começando vazia, e a tela mostra
-- "nenhum registro" enquanto assim estiver.
