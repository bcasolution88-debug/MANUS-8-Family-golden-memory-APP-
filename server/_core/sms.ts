/**
 * P10 — outbound SMS for verification codes, same degradation model as mailer.ts.
 *
 * Transport by environment:
 *   1. `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` + `TWILIO_FROM`  → Twilio Messages API (HTTP, no SDK)
 *   2. `SMS_WEBHOOK_URL` (+ optional `SMS_WEBHOOK_TOKEN`)           → generic JSON POST `{to, text}` for
 *                                                                     Aliyun / Tencent / any gateway relay
 *   3. otherwise                                                    → console (returns `delivered:false`)
 */
import { ENV } from "./env";

export interface SmsMessage {
  /** E.164, e.g. +8613800138000 */
  to: string;
  text: string;
}

export interface SmsResult {
  delivered: boolean;
  transport: "twilio" | "webhook" | "console";
  id?: string;
  error?: string;
}

export function isSmsConfigured(): boolean {
  return !!((process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM) || process.env.SMS_WEBHOOK_URL);
}

export function smsTransportName(): SmsResult["transport"] {
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM) return "twilio";
  if (process.env.SMS_WEBHOOK_URL) return "webhook";
  return "console";
}

/** Loose E.164 normalisation: strips spaces / dashes, requires leading + and 8–15 digits. */
export function normalizePhone(raw: string): string | null {
  const cleaned = raw.replace(/[\s\-().]/g, "");
  const withPlus = cleaned.startsWith("00") ? `+${cleaned.slice(2)}` : cleaned;
  return /^\+[1-9]\d{7,14}$/.test(withPlus) ? withPlus : null;
}

/** +8613800138000 → +86 138****8000 (for UI / logs). */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 7) return phone;
  return `${phone.slice(0, phone.length - digits.length + 2)} ${digits.slice(2, 5)}****${digits.slice(-4)}`;
}

async function sendViaTwilio(msg: SmsMessage): Promise<SmsResult> {
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const auth = Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64");
  const body = new URLSearchParams({ To: msg.to, From: process.env.TWILIO_FROM!, Body: msg.text });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    return { delivered: false, transport: "twilio", error: `Twilio ${res.status}: ${text.slice(0, 200)}` };
  }
  const json = (await res.json().catch(() => ({}))) as { sid?: string };
  return { delivered: true, transport: "twilio", id: json.sid };
}

async function sendViaWebhook(msg: SmsMessage): Promise<SmsResult> {
  const res = await fetch(process.env.SMS_WEBHOOK_URL!, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.SMS_WEBHOOK_TOKEN ? { Authorization: `Bearer ${process.env.SMS_WEBHOOK_TOKEN}` } : {}),
    },
    body: JSON.stringify({ to: msg.to, text: msg.text, app: "golden-memory" }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    return { delivered: false, transport: "webhook", error: `SMS webhook ${res.status}: ${text.slice(0, 200)}` };
  }
  const json = (await res.json().catch(() => ({}))) as { id?: string; messageId?: string };
  return { delivered: true, transport: "webhook", id: json.id ?? json.messageId };
}

export async function sendSms(msg: SmsMessage): Promise<SmsResult> {
  const transport = smsTransportName();
  if (transport !== "console") {
    let r: SmsResult;
    try {
      r = transport === "twilio" ? await sendViaTwilio(msg) : await sendViaWebhook(msg);
    } catch (error) {
      r = { delivered: false, transport, error: error instanceof Error ? error.message : "SMS send failed" };
    }
    const { recordMetric } = await import("./metrics");
    recordMetric("sms", r.delivered, { detail: r.error ?? r.transport });
    return r;
  }
  if (!ENV.isProduction || process.env.SMS_CONSOLE === "1") {
    console.log(`[sms:console] to=${maskPhone(msg.to)}\n${msg.text}`);
  }
  return { delivered: false, transport: "console", error: "SMS transport not configured (set TWILIO_* or SMS_WEBHOOK_URL)" };
}

/** Short, carrier-friendly code text (< 70 chars so it stays one UCS-2 segment in Chinese). */
export function codeSms(opts: { code: string; purpose: "password_reset" | "verify_email" | "login_2fa" | "verify_phone" | "login_sms" | "merge_account"; minutes: number; zh: boolean }): string {
  const { code, minutes, zh } = opts;
  const what = {
    password_reset: zh ? "重置密码" : "password reset",
    verify_email: zh ? "验证邮箱" : "email verification",
    login_2fa: zh ? "登录" : "sign-in",
    verify_phone: zh ? "验证手机" : "phone verification",
    login_sms: zh ? "登录" : "sign-in",
    merge_account: zh ? "合并账户" : "account merge",
  }[opts.purpose];
  return zh
    ? `【金色韶华】${what}验证码 ${code}，${minutes} 分钟内有效，请勿泄露。`
    : `[Golden Memory] Your ${what} code is ${code}. Valid for ${minutes} min. Do not share it.`;
}
