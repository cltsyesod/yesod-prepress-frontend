-- Montagens (nesting): os trabalhos escolhidos, os parâmetros do material definidos pelo
-- operador e o PDF montado gerado pelo analisador.

create table if not exists public.nesting_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null default '',
  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'failed', 'cancelled')),
  progress integer not null default 0,
  current_step text not null default '',
  params jsonb not null default '{}'::jsonb,
  items jsonb not null default '[]'::jsonb,
  result jsonb not null default '{}'::jsonb,
  output_path text not null default '',
  external_job_id text not null default '',
  error_message text not null default '',
  last_sequence integer not null default 0,
  created timestamptz not null default now(),
  updated timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists nesting_runs_user_created_idx on public.nesting_runs (user_id, created desc);

alter table public.nesting_runs enable row level security;

create policy "nesting_runs_select_own" on public.nesting_runs
  for select using (user_id = auth.uid());
create policy "nesting_runs_insert_own" on public.nesting_runs
  for insert with check (user_id = auth.uid());
create policy "nesting_runs_update_own" on public.nesting_runs
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "nesting_runs_delete_own" on public.nesting_runs
  for delete using (user_id = auth.uid());

alter publication supabase_realtime add table public.nesting_runs;
