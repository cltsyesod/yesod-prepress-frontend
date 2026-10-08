-- Estoque de retalhos: o que sobra de uma chapa depois da montagem volta ao estoque e
-- pode ser escolhido como material da próxima montagem.

create table if not exists public.material_offcuts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null default '',
  width_mm numeric not null check (width_mm > 0),
  length_mm numeric not null check (length_mm > 0),
  source_run uuid references public.nesting_runs (id) on delete set null,
  status text not null default 'available' check (status in ('available', 'used')),
  created timestamptz not null default now(),
  used_at timestamptz
);

create index if not exists material_offcuts_user_status_idx
  on public.material_offcuts (user_id, status, created desc);

alter table public.material_offcuts enable row level security;

create policy "material_offcuts_select_own" on public.material_offcuts
  for select using (user_id = auth.uid());
create policy "material_offcuts_insert_own" on public.material_offcuts
  for insert with check (user_id = auth.uid());
create policy "material_offcuts_update_own" on public.material_offcuts
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "material_offcuts_delete_own" on public.material_offcuts
  for delete using (user_id = auth.uid());
