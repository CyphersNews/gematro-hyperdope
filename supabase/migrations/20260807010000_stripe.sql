-- =====================================================================
-- Stripe: the payment gate for Matching, and nothing else
--
-- The previous migration created public.subscriptions and left the writer
-- unspecified. This names it: the Stripe webhook, running as service_role in
-- an Edge Function. Nothing else writes it, and `authenticated` still has no
-- update grant of any kind.
--
-- THE THREE PROPERTIES THIS FILE IS TRYING TO HAVE
--
-- 1. A missed webhook cannot leave someone paying for nothing OR getting it
--    free forever. current_period_end is always in the future for an active
--    subscription, and subscription_active() checks it, so access lapses on
--    its own if the cancellation webhook never arrives. The webhook is how
--    access is granted promptly; the clock is how it is revoked reliably.
--
-- 2. A replayed webhook cannot double-apply. Stripe retries, and it retries
--    out of order. billing_events is a primary key on the Stripe event id and
--    the apply function returns early on a duplicate.
--
-- 3. An out-of-order webhook cannot resurrect a dead subscription. Stripe
--    delivers events concurrently; a `customer.subscription.deleted` can land
--    before the `updated` that preceded it. Every row carries the event's own
--    timestamp and an older event is ignored.
--
-- WHAT IS NOT STORED, DELIBERATELY
--
-- No card number, no last four, no expiry, no billing address, no name on
-- card. Stripe is the controller for the payment instrument. What lands here
-- is a status, a period end, and two Stripe identifiers - enough to answer
-- "may this member use Matching" and nothing else.
--
-- Safe to re-run.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Webhook idempotency
--
-- Stripe guarantees at-least-once delivery, which means duplicates are normal
-- traffic rather than an error case. The primary key is the whole mechanism.
-- ---------------------------------------------------------------------

create table if not exists public.billing_events (
  event_id     text primary key,
  event_type   text not null,
  received_at  timestamptz not null default now(),
  user_id      uuid references auth.users (id) on delete set null,
  note         text
);

comment on table public.billing_events is
  'Every Stripe event id we have already applied. The primary key is what makes webhook replay a no-op.';

create index if not exists billing_events_received_idx on public.billing_events (received_at desc);

alter table public.billing_events enable row level security;
-- no policy and no grant: this table is service_role only, and members have no
-- reason to read the shape of our webhook traffic
revoke all on public.billing_events from anon, authenticated;


-- ---------------------------------------------------------------------
-- 2. Ordering and identity columns on subscriptions
-- ---------------------------------------------------------------------

alter table public.subscriptions
  add column if not exists provider_price_id text,
  add column if not exists provider_event_at timestamptz,
  add column if not exists started_at        timestamptz,
  add column if not exists cancelled_at      timestamptz;

comment on column public.subscriptions.provider_event_at is
  'Timestamp of the Stripe event that last wrote this row. Older events are ignored, because Stripe delivers concurrently and out of order.';

-- One Stripe customer maps to one member. The unique index is what stops a
-- webhook for customer X from being applied to member Y because of a lookup
-- bug somewhere upstream.
create unique index if not exists subscriptions_customer_key
  on public.subscriptions (provider_customer_id)
  where provider_customer_id is not null;

create unique index if not exists subscriptions_sub_key
  on public.subscriptions (provider_sub_id)
  where provider_sub_id is not null;


-- ---------------------------------------------------------------------
-- 3. Linking a member to a Stripe customer
--
-- Called from create-checkout-session before the redirect, so the webhook
-- that arrives later has a customer id it can resolve to a member. Without
-- this the first webhook has nothing to join on.
-- ---------------------------------------------------------------------

create or replace function public.billing_link_customer(
  target uuid, customer_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.subscriptions (user_id, provider, provider_customer_id, status)
  values (target, 'stripe', customer_id, 'none')
  on conflict (user_id) do update
     set provider_customer_id = excluded.provider_customer_id,
         provider = 'stripe',
         updated_at = now()
   -- the existing row is referenced by the bare table name inside ON CONFLICT;
   -- a schema-qualified reference is not accepted there
   where subscriptions.provider_customer_id is distinct from excluded.provider_customer_id;
end;
$$;


-- ---------------------------------------------------------------------
-- 4. Applying a webhook
--
-- One function, so the ordering rule and the idempotency rule live in one
-- place rather than being re-implemented per event type in TypeScript.
--
-- Returns true when the event was applied, false when it was a duplicate or
-- stale. The Edge Function returns 200 either way - telling Stripe an already
-- -applied event failed just makes it retry forever.
-- ---------------------------------------------------------------------

create or replace function public.billing_apply_event(
  event_id      text,
  event_type    text,
  event_at      timestamptz,
  customer_id   text,
  sub_id        text,
  new_status    text,
  period_end    timestamptz,
  cancel_at_end boolean default false,
  price_id      text default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid;
begin
  -- 1. Idempotency. A duplicate is not an error; it is Stripe doing its job.
  insert into public.billing_events (event_id, event_type)
  values (billing_apply_event.event_id, billing_apply_event.event_type)
  on conflict (event_id) do nothing;

  if not found then
    return false;   -- already applied
  end if;

  -- 2. Whose subscription is this? Resolved from the customer id we stored at
  --    checkout time. If we cannot resolve it, record why rather than writing
  --    a row we cannot attribute.
  select s.user_id into target
    from public.subscriptions s
   where s.provider_customer_id = customer_id;

  if target is null then
    update public.billing_events
       set note = 'unknown customer ' || coalesce(customer_id, 'null')
     where public.billing_events.event_id = billing_apply_event.event_id;
    return false;
  end if;

  -- 3. Ordering. Stripe delivers concurrently, so a delete can arrive before
  --    the update that preceded it. The event's own timestamp decides.
  update public.subscriptions s
     set status               = new_status,
         provider_sub_id      = coalesce(sub_id, s.provider_sub_id),
         provider_price_id    = coalesce(price_id, s.provider_price_id),
         current_period_end   = period_end,
         cancel_at_period_end = coalesce(cancel_at_end, false),
         provider_event_at    = event_at,
         started_at           = case when new_status in ('active', 'trialing')
                                      and s.started_at is null then now()
                                     else s.started_at end,
         cancelled_at         = case when new_status = 'canceled' then now() else null end,
         updated_at           = now()
   where s.user_id = target
     and (s.provider_event_at is null or s.provider_event_at <= event_at);

  if not found then
    update public.billing_events
       set note = 'stale event, ignored', user_id = target
     where public.billing_events.event_id = billing_apply_event.event_id;
    return false;
  end if;

  update public.billing_events
     set user_id = target
   where public.billing_events.event_id = billing_apply_event.event_id;

  return true;
end;
$$;

-- Both of these are service_role only. There is no path from a browser.
revoke all on function public.billing_link_customer(uuid, text) from anon, authenticated;
revoke all on function public.billing_apply_event(text, text, timestamptz, text, text, text, timestamptz, boolean, text)
  from anon, authenticated;


-- ---------------------------------------------------------------------
-- 5. What the member is allowed to know, restated
--
-- subscription_mine() from the previous migration gains the fields the
-- billing page needs. Still no provider identifiers: a Stripe customer id is
-- not a secret, but it is not the browser's business either, and the portal
-- session is minted server-side from the JWT rather than from anything the
-- page sends up.
-- ---------------------------------------------------------------------

create or replace function public.subscription_mine()
returns table (
  status text, plan text, current_period_end timestamptz,
  cancel_at_period_end boolean, active boolean,
  has_customer boolean, started_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(s.status, 'none'),
         coalesce(s.plan, 'match_monthly'),
         s.current_period_end,
         coalesce(s.cancel_at_period_end, false),
         public.subscription_active(auth.uid()),
         (s.provider_customer_id is not null),
         s.started_at
    from (values (1)) as one(x)
    left join public.subscriptions s on s.user_id = auth.uid();
$$;

grant execute on function public.subscription_mine() to authenticated;


-- ---------------------------------------------------------------------
-- 6. Admin view of billing
--
-- Enough to answer "did their payment go through" without opening Stripe, and
-- without putting provider identifiers in front of anyone who does not need
-- them. Reuses admin_require(), so it inherits the same authorization as the
-- rest of the panel.
-- ---------------------------------------------------------------------

create or replace function public.admin_billing(lim integer default 50)
returns table (
  user_id uuid, username text, status text,
  current_period_end timestamptz, cancel_at_period_end boolean,
  started_at timestamptz, provider text, updated_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select s.user_id,
         coalesce(p.username, p.discord_username, 'Anonymous'),
         s.status, s.current_period_end, s.cancel_at_period_end,
         s.started_at, s.provider, s.updated_at
    from public.subscriptions s
    join public.profiles p on p.id = s.user_id
   where public.admin_require() is not null
     and s.status <> 'none'
   order by s.updated_at desc
   limit greatest(1, least(coalesce(lim, 50), 200));
$$;

grant execute on function public.admin_billing(integer) to authenticated;


-- ---------------------------------------------------------------------
-- 7. Right to erasure, and the one thing it must not do
--
-- Deleting the account cascades subscriptions away with it. That is correct
-- for us and wrong for the accountant: UK VAT and company law require
-- transaction records to be kept for six years, and those records live in
-- Stripe, which is the controller for them.
--
-- So the rule is: erasing an account removes our copy of the subscription
-- state. It does not and cannot erase Stripe's transaction history, and it
-- would be wrong to tell a member that it does. The privacy notice has to say
-- this plainly - see README.md.
-- ---------------------------------------------------------------------

comment on table public.subscriptions is
  'Subscription state mirrored from Stripe. No payment instrument data of any kind. Deleting the account removes this row; Stripe retains its own transaction records under its own retention obligations.';
