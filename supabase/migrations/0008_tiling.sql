-- Painelamento (tiling): uma arte grande dividida em painéis imprimíveis, com
-- sobreposição, frestas, guia de instalação e modelos reutilizáveis.

create table if not exists public.tiling_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  project_id uuid references public.projects (id) on delete set null,
  file_id uuid references public.project_files (id) on delete set null,
  name text not null default '',
  status text not null default 'draft'
    check (status in ('draft', 'queued', 'running', 'completed', 'failed')),
  progress integer not null default 0,
  current_step text not null default '',
  -- Configuração da tela (tamanho, escala, material, sobreposição, gap, nomes) e o
  -- resultado editado (painéis e emendas), em mm no tamanho final.
  config jsonb not null default '{}'::jsonb,
  tiles jsonb not null default '[]'::jsonb,
  seams jsonb not null default '[]'::jsonb,
  background jsonb,
  result jsonb not null default '{}'::jsonb,
  output jsonb not null default '{}'::jsonb,
  external_job_id text not null default '',
  error_message text not null default '',
  last_sequence integer not null default 0,
  created timestamptz not null default now(),
  updated timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists tiling_projects_user_updated_idx
  on public.tiling_projects (user_id, updated desc);

alter table public.tiling_projects enable row level security;

create policy "tiling_projects_select_own" on public.tiling_projects
  for select using (user_id = auth.uid());
create policy "tiling_projects_insert_own" on public.tiling_projects
  for insert with check (user_id = auth.uid());
create policy "tiling_projects_update_own" on public.tiling_projects
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "tiling_projects_delete_own" on public.tiling_projects
  for delete using (user_id = auth.uid());

alter publication supabase_realtime add table public.tiling_projects;

-- Modelos: a estrutura de um veículo/fachada para reaproveitar em outro trabalho.
create table if not exists public.tiling_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  config jsonb not null default '{}'::jsonb,
  tiles jsonb not null default '[]'::jsonb,
  seams jsonb not null default '[]'::jsonb,
  background jsonb,
  created timestamptz not null default now()
);

alter table public.tiling_templates enable row level security;

create policy "tiling_templates_select_own" on public.tiling_templates
  for select using (user_id = auth.uid());
create policy "tiling_templates_insert_own" on public.tiling_templates
  for insert with check (user_id = auth.uid());
create policy "tiling_templates_update_own" on public.tiling_templates
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "tiling_templates_delete_own" on public.tiling_templates
  for delete using (user_id = auth.uid());
