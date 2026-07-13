# KIM-PER Meeting Scheduler

Slack-native recurring meeting scheduling using Vercel, Supabase, Slack Huddles and Slack AI Notes.

## Implemented MVP

- `/meeting` opens a structured Slack modal.
- Slack requests are verified using the signing secret.
- Meeting series are stored in Supabase.
- PostgreSQL calculates the next occurrence in `Asia/Kolkata`.
- A Supabase Edge Function posts due reminders to Slack.
- Duplicate occurrence protection is included.
- Tables are ready for Huddle threads, AI Notes Canvas links, decisions and actions.

The raw Huddle transcript remains in Slack. Supabase stores operational state and structured meeting records.

## 1. Create Supabase

Create a free Supabase project. In SQL Editor, run:

```text
supabase/migrations/202607130001_initial_schema.sql
```

Copy the project URL and service-role key.

## 2. Deploy to Vercel

Import this repository into Vercel and add:

```text
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
```

Deploy. The Slack endpoint is:

```text
https://YOUR-VERCEL-DOMAIN.vercel.app/api/slack
```

Opening that URL in a browser should return `ok: true`.

## 3. Update Slack

Open `slack-manifest.yaml`, replace both `YOUR-VERCEL-DOMAIN` placeholders, paste the manifest into Slack App Manifest, save, and reinstall the app if requested.

Socket Mode is disabled for this deployment. The `xapp-...` token is not used.

Run `/meeting`. The modal should open and save a meeting into Supabase.

## 4. Deploy reminders

Using the Supabase CLI:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase secrets set SLACK_BOT_TOKEN=xoxb-replace-me
supabase secrets set CRON_SECRET=generate-a-long-random-value
supabase functions deploy send-meeting-reminders --no-verify-jwt
```

Enable `pg_cron` and `pg_net`, then schedule the function every minute:

```sql
select cron.schedule(
  'send-kim-per-meeting-reminders',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/send-meeting-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer YOUR_CRON_SECRET'
    ),
    body := '{}'::jsonb
  );
  $$
);
```

## Data split

Slack stores the Huddle transcript and AI Notes Canvas. Supabase stores schedules, occurrences, reminder state, Huddle/Canvas links, decisions and action items.

## Remaining product work

- List/edit/pause/delete meeting series.
- Detect and match Huddle threads to occurrences.
- Save AI Notes Canvas links.
- Confirm decisions and action items.
- Add Google Calendar invitations if required.

## Validation

```bash
npm install
npm run lint
npm run typecheck
npm run build
```

Rotate the Slack credentials exposed during development before production use.
