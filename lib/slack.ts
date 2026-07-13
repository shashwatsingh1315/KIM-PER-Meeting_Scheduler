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