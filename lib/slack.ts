import { createHmac, timingSafeEqual } from "node:crypto";

export type SlackApiResult = {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
};

export function verifySlackRequest(
  rawBody: string,
  timestamp: string | null,
  slackSignature: string | null,
): boolean {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;

  if (!signingSecret || !timestamp || !slackSignature) {
    return false;
  }

  const numericTimestamp = Number(timestamp);
  const ageSeconds = Math.abs(Math.floor(Date.now() / 1000) - numericTimestamp);

  if (!Number.isFinite(numericTimestamp) || ageSeconds > 300) {
    return false;
  }

  const baseString = `v0:${timestamp}:${rawBody}`;
  const expectedSignature =
    "v0=" + createHmac("sha256", signingSecret).update(baseString).digest("hex");

  const expected = Buffer.from(expectedSignature, "utf8");
  const received = Buffer.from(slackSignature, "utf8");

  return expected.length === received.length && timingSafeEqual(expected, received);
}

export async function callSlackApi(
  method: string,
  body: Record<string, unknown>,
): Promise<SlackApiResult> {
  const botToken = process.env.SLACK_BOT_TOKEN;

  if (!botToken) {
    throw new Error("SLACK_BOT_TOKEN is missing");
  }

  const response = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${botToken}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  const result = (await response.json()) as SlackApiResult;

  if (!result.ok) {
    console.error(`Slack API ${method} failed`, result.error);
  }

  return result;
}
