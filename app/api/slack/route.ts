import { NextRequest, NextResponse } from "next/server";

import { createMeetingModal } from "@/lib/meeting-modal";
import { callSlackApi, verifySlackRequest } from "@/lib/slack";
import { createSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SlackOption = { value: string };
type SlackViewState = Record<string, Record<string, {
  value?: string | null;
  selected_option?: SlackOption | null;
  selected_options?: SlackOption[];
  selected_time?: string | null;
}>>;

type Submission = {
  type: "view_submission";
  team?: { id?: string };
  user?: { id?: string };
  view: {
    callback_id: string;
    private_metadata: string;
    state: { values: SlackViewState };
  };
};

function field(state: SlackViewState, blockId: string) {
  return state[blockId]?.value;
}

async function saveMeeting(payload: Submission) {
  const state = payload.view.state.values;
  const metadata = JSON.parse(payload.view.private_metadata) as {
    channelId: string;
    userId: string;
    teamId: string;
  };

  const title = field(state, "meeting_name")?.value?.trim();
  const days = field(state, "weekdays")?.selected_options?.map((option) => Number(option.value)) ?? [];
  const localTime = field(state, "start_time")?.selected_time;
  const durationMinutes = Number(field(state, "duration")?.selected_option?.value ?? "30");
  const reminderMinutes = Number(field(state, "reminder")?.selected_option?.value ?? "10");
  const huddleUrl = field(state, "huddle_url")?.value?.trim() || null;
  const agendaTemplate = field(state, "agenda")?.value?.trim() || null;

  if (!title || !localTime || days.length === 0) {
    return NextResponse.json({
      response_action: "errors",
      errors: {
        meeting_name: title ? undefined : "Enter a meeting name.",
        weekdays: days.length ? undefined : "Select at least one day.",
        start_time: localTime ? undefined : "Select a start time.",
      },
    });
  }

  const { data, error } = await createSupabaseAdmin()
    .from("meeting_series")
    .insert({
      workspace_id: payload.team?.id ?? metadata.teamId,
      title,
      channel_id: metadata.channelId,
      owner_user_id: payload.user?.id ?? metadata.userId,
      days_of_week: days,
      local_time: localTime,
      timezone: "Asia/Kolkata",
      duration_minutes: durationMinutes,
      reminder_minutes: reminderMinutes,
      huddle_url: huddleUrl,
      agenda_template: agendaTemplate,
      status: "active",
    })
    .select("id, next_run_at")
    .single();

  if (error) {
    console.error("Meeting insert failed", error);
    return NextResponse.json({
      response_action: "update",
      view: {
        type: "modal",
        title: { type: "plain_text", text: "Creation failed" },
        close: { type: "plain_text", text: "Close" },
        blocks: [{
          type: "section",
          text: { type: "mrkdwn", text: "The meeting could not be saved. Check the Vercel and Supabase configuration." },
        }],
      },
    });
  }

  const dayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  return NextResponse.json({
    response_action: "update",
    view: {
      type: "modal",
      title: { type: "plain_text", text: "Meeting created" },
      close: { type: "plain_text", text: "Done" },
      blocks: [{
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${title}*\n*Days:* ${days.map((day) => dayNames[day - 1]).join(", ")}\n*Time:* ${localTime} Asia/Kolkata\n*Meeting ID:* ${data.id}`,
        },
      }],
    },
  });
}

export async function GET() {
  return NextResponse.json({ ok: true, service: "KIM-PER Meeting Scheduler" });
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const valid = verifySlackRequest(
    rawBody,
    request.headers.get("x-slack-request-timestamp"),
    request.headers.get("x-slack-signature"),
  );

  if (!valid) {
    return NextResponse.json({ error: "Invalid Slack signature" }, { status: 401 });
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = JSON.parse(rawBody) as { type?: string; challenge?: string };
    if (body.type === "url_verification" && body.challenge) {
      return NextResponse.json({ challenge: body.challenge });
    }
    return NextResponse.json({ ok: true });
  }

  const form = new URLSearchParams(rawBody);
  const interactivePayload = form.get("payload");
  if (interactivePayload) {
    const payload = JSON.parse(interactivePayload) as Submission | { type: string };
    if (payload.type === "view_submission" && "view" in payload && payload.view.callback_id === "create_meeting_submission") {
      return saveMeeting(payload as Submission);
    }
    return NextResponse.json({ ok: true });
  }

  if (form.get("command") === "/meeting") {
    const triggerId = form.get("trigger_id");
    const channelId = form.get("channel_id");
    const userId = form.get("user_id");
    const teamId = form.get("team_id");

    if (!triggerId || !channelId || !userId || !teamId) {
      return NextResponse.json({ response_type: "ephemeral", text: "Missing Slack command context." });
    }

    const result = await callSlackApi("views.open", {
      trigger_id: triggerId,
      view: createMeetingModal({ channelId, userId, teamId }),
    });

    if (!result.ok) {
      return NextResponse.json({
        response_type: "ephemeral",
        text: `Could not open Meeting Scheduler: ${result.error ?? "unknown_error"}`,
      });
    }

    return new NextResponse(null, { status: 200 });
  }

  return NextResponse.json({ ok: true });
}
