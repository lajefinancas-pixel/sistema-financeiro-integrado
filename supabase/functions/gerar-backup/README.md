# Backup real do sistema

A funcao exporta dinamicamente todas as tabelas fisicas do schema `public`, compacta o JSON com gzip e guarda o arquivo no bucket privado `backups-sistema`. Chamadas manuais exigem uma sessao valida e a permissao `Gerar backup manual`.

## Publicacao

1. No Supabase CLI conectado ao projeto, aplique as migrations com `supabase db push`.
2. Defina um segredo longo e aleatorio: `supabase secrets set BACKUP_CRON_SECRET=...`.
3. Publique a funcao: `supabase functions deploy gerar-backup --no-verify-jwt`.
4. Confirme em **Storage > backups-sistema** que o bucket esta privado.

`SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` sao fornecidos automaticamente pelo ambiente das Edge Functions e nao devem ser enviados ao navegador.

## Agendamento diario as 02:00

No **SQL Editor** do Supabase, habilite as extensoes `pg_cron`, `pg_net` e `vault`, e execute o bloco abaixo uma unica vez, substituindo somente os dois valores indicados. O cron do Supabase usa UTC; `0 5 * * *` corresponde a 02:00 em `America/Maceio` (UTC-3).

```sql
select vault.create_secret('https://SEU-PROJETO.supabase.co', 'backup_project_url');
select vault.create_secret('O-MESMO-BACKUP-CRON-SECRET', 'backup_cron_secret');

select cron.schedule(
  'backup-diario-02h',
  '0 5 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'backup_project_url') || '/functions/v1/gerar-backup',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-backup-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'backup_cron_secret')
    ),
    body := '{"tipo":"automatico"}'::jsonb
  );
  $$
);
```

Verifique o agendamento com `select * from cron.job where jobname = 'backup-diario-02h';`. Cada tentativa que chega autorizada a funcao cria uma linha em `backups_log` e termina como `concluido` ou `falhou`.
