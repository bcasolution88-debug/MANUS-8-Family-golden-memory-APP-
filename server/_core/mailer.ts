/**
 * P9 — outbound email with graceful degradation.
 *
 * Transport is chosen by environment:
 *   1. `RESEND_API_KEY`  → Resend HTTP API (https://resend.com/docs/api-reference/emails/send-email)
 *   2. `SMTP_URL`        → plain SMTP via `nodemailer` *if installed* (optional dependency; not bundled)
 *   3. otherwise         → console transport (logs the message; returns `{ delivered: false }`)
 *
 * The console transport keeps dev / CI fully functional: verification codes
 * are still issued and can be read from the server log. Callers never throw on
 * a missing transport — they surface `delivered` so the UI can say
 * "邮件服务未配置" instead of pretending it was sent.
 */
import { ENV } from "./env";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface MailResult {
  delivered: boolean;
  transport: "resend" | "smtp" | "console";
  id?: string;
  error?: string;
}

const FROM = process.env.MAIL_FROM ?? "金色韶华 Golden Memory <no-reply@golden-memory.app>";

export function isMailConfigured(): boolean {
  return !!(process.env.RESEND_API_KEY || process.env.SMTP_URL);
}

export function mailTransportName(): MailResult["transport"] {
  if (process.env.RESEND_API_KEY) return "resend";
  if (process.env.SMTP_URL) return "smtp";
  return "console";
}

/** Domain part of MAIL_FROM (handles `Name <addr>` form). */
export function mailFromDomain(from = FROM): string | null {
  const addr = /<([^>]+)>/.exec(from)?.[1] ?? from;
  const at = addr.lastIndexOf("@");
  return at > 0 ? addr.slice(at + 1).trim().toLowerCase() : null;
}

export interface MailDiagnostics {
  configured: boolean;
  transport: MailResult["transport"];
  from: string;
  fromDomain: string | null;
  /** Resend only: is the sending domain verified in the account? */
  domainStatus: "verified" | "pending" | "not_found" | "unknown";
  /** Resend only: DNS records still missing (type + name). */
  pendingRecords: string[];
  /** SMTP only: whether the optional `nodemailer` dependency resolves. */
  smtpDependency?: "ok" | "missing";
  hint: string | null;
}

/**
 * P10 — production mail readiness check for Settings/Ops (admin only).
 * For Resend it lists account domains and matches MAIL_FROM; a sending domain
 * that is missing or still pending DNS is the #1 reason production mail fails.
 */
export async function mailDiagnostics(): Promise<MailDiagnostics> {
  const transport = mailTransportName();
  const fromDomain = mailFromDomain();
  const base: MailDiagnostics = { configured: transport !== "console", transport, from: FROM, fromDomain, domainStatus: "unknown", pendingRecords: [], hint: null };
  if (transport === "console") return { ...base, hint: "Set RESEND_API_KEY (or SMTP_URL) and MAIL_FROM to send real email." };
  if (transport === "smtp") {
    try {
      const modName = "nodemailer";
      await import(/* @vite-ignore */ modName);
      return { ...base, smtpDependency: "ok" };
    } catch {
      return { ...base, smtpDependency: "missing", hint: "SMTP_URL is set but `nodemailer` is not installed — run `pnpm add nodemailer`." };
    }
  }
  try {
    const res = await fetch("https://api.resend.com/domains", { headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` } });
    if (!res.ok) return { ...base, hint: `Resend API returned ${res.status} — check RESEND_API_KEY.` };
    const json = (await res.json()) as { data?: Array<{ name: string; status: string; records?: Array<{ type: string; name: string; status: string }> }> };
    const match = json.data?.find((d) => d.name.toLowerCase() === fromDomain);
    if (!match) {
      return { ...base, domainStatus: "not_found", hint: fromDomain ? `Add and verify ${fromDomain} at resend.com/domains, or set MAIL_FROM to a verified domain.` : "MAIL_FROM has no domain." };
    }
    const pending = (match.records ?? []).filter((r) => r.status !== "verified").map((r) => `${r.type} ${r.name}`);
    const verified = match.status === "verified";
    return { ...base, domainStatus: verified ? "verified" : "pending", pendingRecords: pending, hint: verified ? null : `Domain ${fromDomain} is ${match.status}; publish the pending DNS records.` };
  } catch (error) {
    return { ...base, hint: `Resend check failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

async function sendViaResend(msg: MailMessage): Promise<MailResult> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [msg.to], subject: msg.subject, text: msg.text, html: msg.html }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => res.statusText);
    return { delivered: false, transport: "resend", error: `Resend ${res.status}: ${body.slice(0, 200)}` };
  }
  const json = (await res.json().catch(() => ({}))) as { id?: string };
  return { delivered: true, transport: "resend", id: json.id };
}

async function sendViaSmtp(msg: MailMessage): Promise<MailResult> {
  try {
    // Optional dependency — resolved at runtime so the project builds without it.
    const modName = "nodemailer";
    const nodemailer = (await import(/* @vite-ignore */ modName)) as { createTransport: (url: string) => { sendMail: (m: unknown) => Promise<{ messageId?: string }> } };
    const transporter = nodemailer.createTransport(process.env.SMTP_URL!);
    const info = await transporter.sendMail({ from: FROM, to: msg.to, subject: msg.subject, text: msg.text, html: msg.html });
    return { delivered: true, transport: "smtp", id: info.messageId };
  } catch (error) {
    return { delivered: false, transport: "smtp", error: error instanceof Error ? error.message : "SMTP send failed" };
  }
}

export async function sendMail(msg: MailMessage): Promise<MailResult> {
  const r = await sendMailInner(msg);
  // Only configured transports count toward the success rate (console = not a delivery attempt).
  if (r.transport !== "console") {
    const { recordMetric } = await import("./metrics");
    recordMetric("mail", r.delivered, { detail: r.error ?? r.transport });
  }
  return r;
}

async function sendMailInner(msg: MailMessage): Promise<MailResult> {
  if (process.env.RESEND_API_KEY) return sendViaResend(msg);
  if (process.env.SMTP_URL) return sendViaSmtp(msg);
  if (!ENV.isProduction || process.env.MAIL_CONSOLE === "1") {
    console.log(`[mail:console] to=${msg.to} subject=${JSON.stringify(msg.subject)}\n${msg.text}`);
  }
  return { delivered: false, transport: "console", error: "Mail transport not configured (set RESEND_API_KEY or SMTP_URL)" };
}

/* ------------------------------------------------------------------ */
/* Templates                                                           */
/* ------------------------------------------------------------------ */

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function codeEmail(opts: { code: string; purpose: "password_reset" | "verify_email" | "login_2fa" | "verify_phone" | "login_sms" | "merge_account"; name?: string | null; minutes: number; zh: boolean }): Pick<MailMessage, "subject" | "text" | "html"> {
  const { code, purpose, minutes, zh } = opts;
  const name = opts.name?.trim() || (zh ? "您好" : "Hello");
  const headline = {
    password_reset: zh ? "重置密码验证码" : "Your password reset code",
    verify_email: zh ? "验证您的邮箱" : "Verify your email",
    login_2fa: zh ? "登录验证码" : "Your sign-in code",
    verify_phone: zh ? "验证您的手机" : "Verify your phone",
    login_sms: zh ? "登录验证码" : "Your sign-in code",
    merge_account: zh ? "确认合并账户" : "Confirm account merge",
  }[purpose];
  const intro = {
    password_reset: zh ? "您正在重置金色韶华账户密码。" : "You asked to reset your Golden Memory password.",
    verify_email: zh ? "感谢加入金色韶华，请验证这个邮箱属于您。" : "Thanks for joining Golden Memory — please confirm this address is yours.",
    login_2fa: zh ? "您正在登录金色韶华。" : "You are signing in to Golden Memory.",
    verify_phone: zh ? "您正在为金色韶华账户绑定手机号。" : "You are linking a phone number to your Golden Memory account.",
    login_sms: zh ? "您正在登录金色韶华。" : "You are signing in to Golden Memory.",
    merge_account: zh ? "有人请求把这个账户并入另一个金色韶华账户。如果不是您本人操作，请勿输入验证码。" : "Someone asked to merge this account into another Golden Memory account. If this wasn't you, do not enter the code.",
  }[purpose];
  const ignore = zh ? "如果这不是您本人操作，请忽略此邮件。" : "If this wasn't you, you can safely ignore this email.";
  const valid = zh ? `验证码 ${minutes} 分钟内有效。` : `This code expires in ${minutes} minutes.`;
  const text = `${name}，\n\n${intro}\n\n${zh ? "验证码" : "Code"}: ${code}\n${valid}\n\n${ignore}\n\n— 金色韶华 · Golden Memory`;
  const html = `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,'Noto Sans SC',sans-serif;background:#FBF8F1;padding:24px;color:#2B2B2B">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:20px;padding:32px;box-shadow:0 4px 24px rgba(0,0,0,.06)">
    <div style="font-size:14px;color:#B8942A;font-weight:700;letter-spacing:.08em">金色韶华 · GOLDEN MEMORY</div>
    <h1 style="font-size:22px;margin:16px 0 8px">${escapeHtml(headline)}</h1>
    <p style="margin:0 0 20px;color:#555">${escapeHtml(name)}，${escapeHtml(intro)}</p>
    <div style="font-size:36px;font-weight:800;letter-spacing:.35em;text-align:center;background:linear-gradient(90deg,#D4AF37,#B8942A);color:#fff;border-radius:16px;padding:18px 0">${escapeHtml(code)}</div>
    <p style="margin:20px 0 0;font-size:13px;color:#777">${escapeHtml(valid)}<br>${escapeHtml(ignore)}</p>
  </div></body></html>`;
  return { subject: `${headline} · ${code}`, text, html };
}

export function backupEmail(opts: { name?: string | null; itemCount: number; bytes: number; downloadUrl?: string; zh: boolean }): Pick<MailMessage, "subject" | "text" | "html"> {
  const { itemCount, bytes, downloadUrl, zh } = opts;
  const name = opts.name?.trim() || (zh ? "您好" : "Hello");
  const mb = (bytes / 1024 / 1024).toFixed(2);
  const subject = zh ? `每周备份已完成 · ${itemCount} 条记录` : `Weekly backup complete · ${itemCount} items`;
  const body = zh
    ? `${name}，\n\n您的金色韶华每周备份已生成：${itemCount} 条照片 / 视频记录（${mb} MB，JSON，含 15 分钟有效的下载链接）。${downloadUrl ? `\n\n下载：${downloadUrl}` : "\n\n可在 App → 设置 → 自动备份 中下载。"}\n\n— 金色韶华`
    : `${name},\n\nYour weekly Golden Memory backup is ready: ${itemCount} photo / video records (${mb} MB, JSON with 15-minute download links).${downloadUrl ? `\n\nDownload: ${downloadUrl}` : "\n\nDownload it from App → Settings → Auto backup."}\n\n— Golden Memory`;
  return { subject, text: body, html: `<pre style="font-family:inherit;white-space:pre-wrap">${escapeHtml(body)}</pre>` };
}
