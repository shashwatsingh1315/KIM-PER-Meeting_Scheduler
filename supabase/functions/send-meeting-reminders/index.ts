import { createClient } from "npm:@supabase/supabase-js@2.110.2";

type Meeting = {
  id: string;
  title: string;
  channel_id: string;
  timezone: string;
  duration_minutes: number;
  huddle_url: string | null;
  agenda_template: string | null;
  next_run_at: string;
};

function env(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is missing`);
  return value;
}

async function postReminder(meeting: Meeting) {
  const agenda = meeting.agenda_template
    ?.split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `• ${line}`)
    .join("\n");

  const start = new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: meeting.timezone,
  }).format(new Date(meeting.next_run_at));

  const blocks: Array<Record<string, unknown>> = [{
    type: "section",
    text: {
      type: "mrkdwn",
      text: `*${meeting.title}*\nStarts: ${start}\nDuration: ${meeting.duration_minutes} minutes${agenda ? `\n\n*Agenda*\n${agenda}` : ""}`,
    },
  }];

  if (meeting.huddle_url) {
    blocks.push({
      type: "actions",
      elements: [{
        type: "button",
        action_id: "open_huddle",
        text: { type: "plain_text", text: "Start Huddle" },
        url: meeting.huddle_url,
      }],
    });
  }

  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env("SLACK_BOT_TOKEN")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      channel: meeting.channel_id,
      text: `${meeting.title} starts at ${start}`,
      blocks,
    }),
  });

  const result = await response.json() as { ok: boolean; ts?: string; error?: string };
  if (!result.ok || !result.ts) throw new Error(result.error ?? "Slack reminder failed");
  return result.ts;
}

Deno.serve(async (request) => {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${env("CRON_SECRET")}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const supabase = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase.rpc("claim_due_meetings", { p_limit: 50 });
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

  const meetings = (data ?? []) as Meeting[];
  const results = [];

  for (const meeting of meetings) {
    const { data: occurrence, error: occurrenceError } = await supabase
      .from("meeting_occurrences")
      .upsert({
        series_id: meeting.id,
        scheduled_start: meeting.next_run_at,
        channel_id: meeting.channel_id,
        status: "reminder_pending",
      }, { onConflict: "series_id,scheduled_start", ignoreDuplicates: true })
      .select("id, reminder_message_ts")
      .maybeSingle();

    if (occurrenceError) {
      results.push({ id: meeting.id, ok: false, error: occurrenceError.message });
      continue;
    }

    const existing = occurrence ?? (await supabase
      .from("meeting_occurrences")
      .select("id, reminder_message_ts")
      .eq("series_id", meeting.id)
      .eq("scheduled_start", meeting.next_run_at)
      .single()).data;

    if (!existing) continue;

    try {
      if (!existing.reminder_message_ts) {
        const ts = await postReminder(meeting);
        await supabase.from("meeting_occurrences").update({
          status: "reminder_sent",
          reminder_message_ts: ts,
          failure_reason: null,
        }).eq("id", existing.id);
      }

      const { data: nextRunAt, error: advanceError } = await supabase.rpc(
        "advance_meeting_schedule",
        { p_series_id: meeting.id, p_after: meeting.next_run_at },
      );
      if (advanceError) throw advanceError;
      results.push({ id: meeting.id, ok: true, nextRunAt });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Unknown reminder error";
      await supabase.from("meeting_occurrences").update({ status: "failed", failure_reason: message }).eq("id", existing.id);
      await supabase.from("meeting_series").update({ last_claimed_at: null }).eq("id", meeting.id);
      results.push({ id: meeting.id, ok: false, error: message });
    }
  }

  return Response.json({ ok: true, processed: meetings.length, results });
});
