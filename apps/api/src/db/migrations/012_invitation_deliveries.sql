-- Invitation codes are delivered through an outbox, written in the same transaction as the invitation.
-- Before: the SMS/email was sent after the commit, so a crash in between left an invitation whose code was never
-- sent (and an idempotent retry replayed "created" without sending it).
--
-- The code is needed to send the message, so it is kept here ENCRYPTED (AES-256-GCM, DATA_ENCRYPTION_KEY) and
-- wiped as soon as the message is sent or the delivery is cancelled. org_invitations keeps only its hash.
create table invitation_deliveries (
  invitation_id uuid primary key references org_invitations(id),
  channel       text not null check (channel in ('sms','email')),
  destination   text not null,
  org_name      text not null,
  token_enc     text,                                  -- null once sent or cancelled
  status        text not null default 'queued' check (status in ('queued','sent','failed','cancelled')),
  attempts      int not null default 0,
  locked_until  timestamptz,                           -- a sender claimed it until then
  last_error    text,
  sent_at       timestamptz,
  created_at    timestamptz not null default now(),
  check (status = 'queued' or token_enc is null)
);
create index invitation_deliveries_queued_idx on invitation_deliveries (created_at) where status = 'queued';
