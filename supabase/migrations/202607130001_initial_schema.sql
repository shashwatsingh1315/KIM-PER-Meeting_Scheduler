create extension if not exists pgcrypto;

create or replace function public.compute_next_run_at(
  p_days_of_week integer[],
  p_local_time time without time zone,
  p_timezone text,
  p_after timestamptz default now()
)
returns timestamptz
language sql
stable
set search_path = public
as $$
  with candidate_days as (
    select day_value::date as local_date
    from generate_series(
      (p_after at time zone p_timezone)::date,
      (p_after at time zone p_timezone)::date + 14,
      interval '1 day'
    ) as generated(day_value)
    where extract(isodow from day_value)::integer = any (p_days_of_week)
  ), candidates as (
    select (local_date + p_local_time) at time zone p_timezone as candidate
    from candidate_days
  )
  select min(candidate) from candidates where candidate > p_after;
$$;

create table if not exists public.meeting_series (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  title text not null check (char_length(title) between 1 and 120),
  channel_id text not null,
  owner_user_id text not null,
  participant_user_ids text[] not null default '{}',
  days_of_week integer[] not null,
  local_time time without time zone not null,
  timezone text not null default 'Asia/Kolkata',
  duration_minutes integer not null default 30 check (duration_minutes between 5 and 480),
  reminder_minutes integer not null default 10 check (reminder_minutes between 0 and 1440),
  huddle_url text,
  agenda_template text,
  status text not null default 'active' check (status in ('active', 'paused', 'deleted')),
  next_run_at timestamptz,
  last_claimed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint valid_days_of_week check (
    cardinality(days_of_week) > 0
    and days_of_week <@ array[1, 2, 3, 4, 5, 6, 7]
  )
);

create table if not exists public.meeting_occurrences (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references public.meeting_series(id) on delete restrict,
  scheduled_start timestamptz not null,
  actual_start timestamptz,
  actual_end timestamptz,
  channel_id text not null,
  reminder_message_ts text,
  huddle_thread_ts text,
  huddle_thread_url text,
  notes_canvas_id text,
  notes_canvas_url text,
  participant_user_ids text[] not null default '{}',
  status text not null default 'scheduled' check (
    status in ('scheduled', 'reminder_pending', 'reminder_sent', 'started', 'completed', 'skipped', 'cancelled', 'failed')
  ),
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (series_id, scheduled_start)
);

create table if not exists public.meeting_decisions (
  id uuid primary key default gen_random_uuid(),
  occurrence_id uuid not null references public.meeting_occurrences(id) on delete cascade,
  decision_text text not null,
  owner_user_id text,
  supersedes_decision_id uuid references public.meeting_decisions(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.meeting_actions (
  id uuid primary key default gen_random_uuid(),
  occurrence_id uuid not null references public.meeting_occurrences(id) on delete cascade,
  description text not null,
  owner_user_id text,
  due_date date,
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'critical')),
  status text not null default 'open' check (status in ('open', 'in_progress', 'blocked', 'completed', 'cancelled')),
  source_thread_ts text,
  carried_from_action_id uuid references public.meeting_actions(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists meeting_series_due_idx on public.meeting_series (next_run_at) where status = 'active';
create index if not exists meeting_occurrences_series_idx on public.meeting_occurrences (series_id, scheduled_start desc);
create index if not exists meeting_actions_owner_status_idx on public.meeting_actions (owner_user_id, status, due_date);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.set_meeting_next_run_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'active' and (
    tg_op = 'INSERT'
    or new.next_run_at is null
    or new.days_of_week is distinct from old.days_of_week
    or new.local_time is distinct from old.local_time
    or new.timezone is distinct from old.timezone
    or old.status <> 'active'
  ) then
    new.next_run_at = public.compute_next_run_at(new.days_of_week, new.local_time, new.timezone, now());
  end if;
  return new;
end;
$$;

create or replace function public.claim_due_meetings(p_limit integer default 50)
returns setof public.meeting_series
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with due as (
    select id
    from public.meeting_series
    where status = 'active'
      and next_run_at is not null
      and next_run_at - make_interval(mins => reminder_minutes) <= now()
      and (last_claimed_at is null or last_claimed_at < now() - interval '10 minutes')
    order by next_run_at
    limit greatest(1, least(p_limit, 200))
    for update skip locked
  ), claimed as (
    update public.meeting_series series
    set last_claimed_at = now(), updated_at = now()
    from due
    where series.id = due.id
    returning series.*
  )
  select * from claimed;
end;
$$;

create or replace function public.advance_meeting_schedule(p_series_id uuid, p_after timestamptz)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare next_value timestamptz;
begin
  select public.compute_next_run_at(days_of_week, local_time, timezone, p_after)
  into next_value
  from public.meeting_series where id = p_series_id;

  update public.meeting_series
  set next_run_at = next_value, last_claimed_at = null, updated_at = now()
  where id = p_series_id;

  return next_value;
end;
$$;

create trigger meeting_series_updated_at before update on public.meeting_series for each row execute function public.set_updated_at();
create trigger meeting_occurrences_updated_at before update on public.meeting_occurrences for each row execute function public.set_updated_at();
create trigger meeting_actions_updated_at before update on public.meeting_actions for each row execute function public.set_updated_at();
create trigger meeting_series_next_run_at before insert or update of days_of_week, local_time, timezone, status on public.meeting_series for each row execute function public.set_meeting_next_run_at();

alter table public.meeting_series enable row level security;
alter table public.meeting_occurrences enable row level security;
alter table public.meeting_decisions enable row level security;
alter table public.meeting_actions enable row level security;

revoke all on function public.claim_due_meetings(integer) from public, anon, authenticated;
revoke all on function public.advance_meeting_schedule(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.claim_due_meetings(integer) to service_role;
grant execute on function public.advance_meeting_schedule(uuid, timestamptz) to service_role;
