-- Folha (montagem / folha DTF) enviada ao RIP: quando e por quem. Marcar a folha marca
-- também cada trabalho dela (feito na tela, trabalho a trabalho, pelas regras da empresa).
alter table public.nesting_runs
  add column if not exists sent_to_rip_at timestamptz,
  add column if not exists sent_to_rip_by uuid references auth.users(id) on delete set null;

-- Em quais folhas um trabalho entrou (items é uma lista de { projectId, ... }).
create index if not exists nesting_runs_items_idx on public.nesting_runs using gin (items jsonb_path_ops);
