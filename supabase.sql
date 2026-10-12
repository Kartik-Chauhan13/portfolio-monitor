create table if not exists public.portfolios (
  id text primary key,
  positions jsonb not null default '[]'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.portfolios (id)
values ('shared')
on conflict (id) do nothing;

alter table public.portfolios enable row level security;

drop policy if exists "public can read shared portfolio" on public.portfolios;
create policy "public can read shared portfolio"
on public.portfolios for select
to anon
using (id = 'shared');

drop policy if exists "public can insert shared portfolio" on public.portfolios;
create policy "public can insert shared portfolio"
on public.portfolios for insert
to anon
with check (id = 'shared');

drop policy if exists "public can update shared portfolio" on public.portfolios;
create policy "public can update shared portfolio"
on public.portfolios for update
to anon
using (id = 'shared')
with check (id = 'shared');
