/**
 * P13 — multi-channel alert delivery.
 *
 *   webhook   POST JSON {title, text, kinds, at} (+ optional `Authorization: Bearer <secret>`)
 *   slack     Incoming Webhook — {text, blocks}
 *   wecom     企业微信群机器人 — {msgtype:"markdown", markdown:{content}}
 *   dingtalk  钉钉自定义机器人 — {msgtype:"markdown"} with optional HMAC-SHA256 `timestamp`/`sign`
 *
 * URLs and secrets are sealed with the same AES-256-GCM helper used for backup
 * targets. Each delivery records a `metricEvents.alert` row so channel health
 * shows up in the dashboard like every other outbound path.
 */
import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";

import { alertChannels, type AlertChannel, type AlertChannelKind } from "@/drizzle/schema";
import { getDb } from "@/server/db";
import { recordMetric } from "./metrics";
import { openSecret } from "./webdav";

export interface AlertPayload {
  title: string;
  text: string;
  kinds: string[];
  at?: Date;
}

export const ALERT_CHANNEL_LABELS: Record<AlertChannelKind, { zh: string; en: string }> = {
  webhook: { zh: "通用 Webhook", en: "Generic webhook" },
  slack: { zh: "Slack", en: "Slack" },
  wecom: { zh: "企业微信机器人", en: "WeCom bot" },
  dingtalk: { zh: "钉钉机器人", en: "DingTalk bot" },
};

const HOST_RULES: Record<AlertChannelKind, RegExp | null> = {
  webhook: null,
  slack: /^hooks\.slack\.com$/i,
  wecom: /^qyapi\.weixin\.qq\.com$/i,
  dingtalk: /^oapi\.dingtalk\.com$/i,
};

/** Validate a channel URL for its kind (https only, known hosts for vendor bots). */
export function validateChannelUrl(kind: AlertChannelKind, raw: string): { ok: true; url: string } | { ok: false; error: string } {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return { ok: false, error: "Enter a valid https:// URL" };
  }
  if (u.protocol !== "https:") return { ok: false, error: "Webhook URLs must use https://" };
  const rule = HOST_RULES[kind];
  if (rule && !rule.test(u.hostname)) return { ok: false, error: `Expected a ${ALERT_CHANNEL_LABELS[kind].en} URL on ${rule.source.replace(/[\^$\\]/g, "")}` };
  return { ok: true, url: u.toString() };
}

/** DingTalk signed URL: timestamp + HMAC-SHA256(secret, `${timestamp}\n${secret}`) base64, URL-encoded. */
export function dingtalkSign(url: string, secret: string, now = Date.now()): string {
  const sign = createHmac("sha256", secret).update(`${now}\n${secret}`).digest("base64");
  const u = new URL(url);
  u.searchParams.set("timestamp", String(now));
  u.searchParams.set("sign", sign);
  return u.toString();
}

/** Build the vendor-specific request body. Exported for tests. */
export function buildChannelBody(kind: AlertChannelKind, p: AlertPayload): Record<string, unknown> {
  const at = (p.at ?? new Date()).toISOString();
  const md = `**${p.title}**\n\n${p.text.replace(/\n/g, "\n\n")}\n\n_${at}_`;
  switch (kind) {
    case "slack":
      return { text: `${p.title}\n${p.text}`, blocks: [{ type: "header", text: { type: "plain_text", text: p.title.slice(0, 150) } }, { type: "section", text: { type: "mrkdwn", text: p.text.slice(0, 2900) } }, { type: "context", elements: [{ type: "mrkdwn", text: at }] }] };
    case "wecom":
      return { msgtype: "markdown", markdown: { content: md.slice(0, 4000) } };
    case "dingtalk":
      return { msgtype: "markdown", markdown: { title: p.title.slice(0, 60), text: md.slice(0, 19000) } };
    case "webhook":
    default:
      return { source: "golden-memory", title: p.title, text: p.text, kinds: p.kinds, at };
  }
}

export async function sendToChannel(ch: Pick<AlertChannel, "kind" | "urlEnc" | "secretEnc">, payload: AlertPayload, timeoutMs = 8000): Promise<{ ok: true } | { ok: false; error: string }> {
  let url = openSecret(ch.urlEnc);
  const secret = ch.secretEnc ? openSecret(ch.secretEnc) : null;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (ch.kind === "dingtalk" && secret) url = dingtalkSign(url, secret);
  if (ch.kind === "webhook" && secret) headers.Authorization = `Bearer ${secret}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(buildChannelBody(ch.kind, payload)), signal: ctrl.signal });
    const bodyText = await res.text().catch(() => "");
    if (!res.ok) return { ok: false, error: `HTTP ${res.status} ${bodyText.slice(0, 120)}`.trim() };
    // WeCom / DingTalk return 200 with {errcode} on logical failures.
    if (ch.kind === "wecom" || ch.kind === "dingtalk") {
      try {
        const j = JSON.parse(bodyText) as { errcode?: number; errmsg?: string };
        if (j.errcode && j.errcode !== 0) return { ok: false, error: `${j.errcode} ${j.errmsg ?? ""}`.trim() };
      } catch {
        /* non-JSON 200 → treat as success */
      }
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "request failed" };
  } finally {
    clearTimeout(timer);
  }
}

/** Fan an alert out to every enabled channel; records per-channel status + metric. */
export async function broadcastAlert(payload: AlertPayload): Promise<Array<{ id: number; name: string; ok: boolean; error?: string }>> {
  const database = await getDb();
  if (!database) return [];
  const rows = await database.select().from(alertChannels).where(eq(alertChannels.enabled, true));
  const out: Array<{ id: number; name: string; ok: boolean; error?: string }> = [];
  for (const ch of rows) {
    const started = Date.now();
    const r = await sendToChannel(ch, payload);
    recordMetric("alert", r.ok, { durationMs: Date.now() - started, detail: r.ok ? `${ch.kind}:${ch.name}` : `${ch.kind}:${r.ok ? "" : r.error}`.slice(0, 120) });
    await database.update(alertChannels).set({ lastStatus: r.ok ? "ok" : "failed", lastError: r.ok ? null : r.error.slice(0, 300), lastSentAt: new Date() }).where(eq(alertChannels.id, ch.id));
    out.push(r.ok ? { id: ch.id, name: ch.name, ok: true } : { id: ch.id, name: ch.name, ok: false, error: r.error });
  }
  return out;
}
