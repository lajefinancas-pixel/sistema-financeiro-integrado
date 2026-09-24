-- Linhas estruturadas de diária dentro do mesmo processo documental.
-- Mantém todas as colunas legadas para compatibilidade com processos existentes.
alter table public.processos_diarias
  add column if not exists diaria_itens jsonb;

comment on column public.processos_diarias.diaria_itens is
  'Composição estruturada das diárias: faixa, categoria, pernoite, quantidade e valor unitário por linha.';
