-- Correções automáticas: a ocorrência descreve a correção oferecida e o arquivo
-- corrigido aponta para o original, que é mantido.

alter table public.analysis_issues
  add column if not exists fix jsonb;

alter table public.project_files
  add column if not exists derived_from uuid references public.project_files (id) on delete set null,
  add column if not exists applied_fixes jsonb not null default '[]'::jsonb;

create index if not exists project_files_derived_from_idx on public.project_files (derived_from);
