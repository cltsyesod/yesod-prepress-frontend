-- Perfis de produção no banco (antes ficavam só no localStorage do navegador),
-- ficha técnica do trabalho por projeto e deduplicação dos callbacks do analyzer.

-- 1. Perfis de produção: predefinições salvas pelo operador.
--    `settings` guarda o perfil completo como o frontend o edita.
create table if not exists public.production_profiles (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null,
  is_default  boolean not null default false,
  settings    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- set_updated_at() (0003) grava updated_at e updated.
  updated     timestamptz default now()
);

create index if not exists production_profiles_user_idx on public.production_profiles (user_id);

drop trigger if exists trg_production_profiles_updated on public.production_profiles;
create trigger trg_production_profiles_updated
  before update on public.production_profiles
  for each row execute function public.set_updated_at();

alter table public.production_profiles enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'production_profiles' and policyname = 'own_select') then
    create policy own_select on public.production_profiles for select using (user_id = auth.uid());
    create policy own_insert on public.production_profiles for insert with check (user_id = auth.uid());
    create policy own_update on public.production_profiles for update using (user_id = auth.uid()) with check (user_id = auth.uid());
    create policy own_delete on public.production_profiles for delete using (user_id = auth.uid());
  end if;
end $$;

-- 2. Ficha técnica do trabalho: valores definidos pelo operador para este pedido
--    (medida final, escala do arquivo, resolução mínima, sangria, política de RGB...).
--    Sobrepõem os valores do perfil de produção na análise.
alter table public.projects add column if not exists job_ticket jsonb not null default '{}'::jsonb;

-- 3. Callbacks do analyzer: ordem e idempotência.
alter table public.analysis_jobs add column if not exists last_sequence int not null default 0;

create table if not exists public.analysis_callback_events (
  event_id    text primary key,
  analysis    uuid not null references public.analysis_jobs(id) on delete cascade,
  event       text not null,
  sequence    int not null,
  received_at timestamptz not null default now()
);

-- Somente a service role (Edge Function) acessa; sem políticas = sem acesso pelo cliente.
alter table public.analysis_callback_events enable row level security;
