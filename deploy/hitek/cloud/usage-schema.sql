begin;
create table if not exists public.hitek_workspaces (
  id text primary key check (id ~ '^[a-z][a-z0-9-]{1,39}$'),
  label text not null,
  public_url text not null,
  created_at timestamptz not null default now()
);
create table if not exists public.hitek_usage_events (
  workspace_id text not null references public.hitek_workspaces(id),
  event_id text not null check (event_id ~ '^[a-f0-9]{64}$'),
  occurred_at timestamptz not null,
  bot_id text not null,
  thread_id text not null,
  turn_id text,
  model text not null,
  driver text not null,
  input_tokens bigint not null check (input_tokens >= 0),
  output_tokens bigint not null check (output_tokens >= 0),
  cost_usd numeric check (cost_usd >= 0),
  imported_at timestamptz not null default now(),
  primary key (workspace_id, event_id)
);
create index if not exists hitek_usage_month_idx
  on public.hitek_usage_events(workspace_id, occurred_at);
alter table public.hitek_workspaces enable row level security;
alter table public.hitek_usage_events enable row level security;
revoke all on public.hitek_workspaces, public.hitek_usage_events from public, anon, authenticated;
grant select, insert, update on public.hitek_workspaces to service_role;
grant select, insert on public.hitek_usage_events to service_role;
commit;
