-- The pipeline's audit log.
--
-- One append-only record of everything the autonomous loop does — queued,
-- claimed, built, verified, reviewed, risk-classified, merged, deployed — so
-- that when it eventually does something wrong there is a single place that
-- explains how it got there. Without this the history is scattered across
-- Linear comments, PR threads and CI logs, and none of it is queryable
-- together.
--
-- Deliberately NOT in the lumen schema and NOT in config.toml's exposed
-- schemas: the pipeline is not the product. The app's lumen_read credential
-- never sees it, and it is unreachable from the PostgREST surface. The runner
-- holds a direct Postgres DSN, so it loses nothing by being invisible to the
-- web API.

create schema if not exists agent;

create table if not exists agent.events (
  id       bigint generated always as identity primary key,
  at       timestamptz not null default now(),

  -- The queue item: a Linear issue key, a roadmap feature id, whatever the
  -- queue is that week. Text rather than an FK because the queue lives
  -- outside this database and should stay swappable.
  task_id  text,

  -- One ATTEMPT at a task. A task that fails verification and is retried has
  -- one task_id and several run_ids — without this you cannot tell "attempt 3
  -- of feature X" from "feature X", which is exactly the question you ask when
  -- something has gone wrong repeatedly.
  run_id   uuid,

  -- Who acted. Not an FK to auth.users: most actors are models, not people.
  -- Convention is "<kind>:<name>" — claude:builder, codex:reviewer,
  -- human:abram, system:cron.
  actor    text not null,

  kind     text not null,
  -- Only meaningful on kind='risk_classified', but promoted out of payload
  -- because "show me everything that auto-merged at medium risk" is the query
  -- you will actually run.
  risk     text,

  -- PR url, commit sha, branch name — whatever this event points at.
  ref      text,
  summary  text not null,
  payload  jsonb not null default '{}'::jsonb,

  constraint events_kind_check check (kind in (
    'queued', 'claimed', 'planned', 'built', 'verified', 'verify_failed',
    'pr_opened', 'reviewed', 'risk_classified', 'merge_blocked', 'merged',
    'deployed', 'rolled_back', 'failed', 'paused', 'resumed', 'note'
  )),
  constraint events_risk_check check (risk is null or risk in ('low', 'medium', 'high'))
);

create index if not exists events_at_idx on agent.events (at desc);
create index if not exists events_task_idx on agent.events (task_id, at desc);
create index if not exists events_run_idx on agent.events (run_id, at);
create index if not exists events_kind_idx on agent.events (kind, at desc);

-- Append-only, enforced by the database rather than by convention.
--
-- The entire value of this table is that the agent cannot quietly rewrite its
-- own history. A policy the runner could bypass by writing different code is
-- not an audit log. Revoking the privilege is necessary but not sufficient —
-- the runner may end up connecting as an owner or superuser on someone's
-- laptop, and owners are not subject to their own REVOKEs — so the trigger is
-- the actual backstop.
create or replace function agent.events_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'agent.events is append-only (attempted %)', tg_op;
end
$$;

drop trigger if exists events_append_only on agent.events;
create trigger events_append_only
  before update or delete or truncate on agent.events
  for each statement execute function agent.events_append_only();

-- The runner's role. Created here so a fresh local stack matches production;
-- in production, set a real password out of band.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'lumen_agent') then
    create role lumen_agent login password 'lumen_agent';
  end if;
end $$;

grant usage on schema agent to lumen_agent;
grant select, insert on agent.events to lumen_agent;
grant usage on sequence agent.events_id_seq to lumen_agent;

-- Belt and braces alongside the trigger.
revoke update, delete, truncate on agent.events from lumen_agent;

-- The product's read credential has no business here.
revoke all on schema agent from lumen_read;
