import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Linking from "expo-linking";
import { Share, Platform } from "react-native";

/**
 * P7 — invitation deep links.
 *
 *   native:  <scheme>://join?code=ABCD1234EFGH   (scheme from app.config.ts)
 *   web:     https://<host>/join?code=ABCD1234EFGH
 *
 * Both resolve to `app/join.tsx` via Expo Router. When the recipient isn't
 * signed in yet the code is parked in AsyncStorage and replayed after login
 * (see `consumePendingInviteCode`).
 */

const PENDING_KEY = "pendingInviteCode";

export function buildInviteLink(code: string): string {
  return Linking.createURL("join", { queryParams: { code: code.toUpperCase() } });
}

/** Human message for the system share sheet / clipboard. */
export function buildInviteMessage(code: string, familyName: string, zh: boolean): string {
  const link = buildInviteLink(code);
  return zh
    ? `邀请你加入「${familyName}」的金色韶华家庭相册。\n邀请码：${code}\n打开链接加入：${link}\n（7 天内有效）`
    : `You're invited to join "${familyName}" on Golden Memory.\nInvite code: ${code}\nOpen to join: ${link}\n(valid for 7 days)`;
}

export async function shareInvite(code: string, familyName: string, zh: boolean): Promise<boolean> {
  const message = buildInviteMessage(code, familyName, zh);
  if (Platform.OS === "web" && typeof navigator !== "undefined" && "share" in navigator) {
    try {
      await (navigator as Navigator & { share: (d: { text: string }) => Promise<void> }).share({ text: message });
      return true;
    } catch {
      return false;
    }
  }
  try {
    const res = await Share.share({ message, title: zh ? "家庭邀请" : "Family invitation" });
    return res.action !== Share.dismissedAction;
  } catch {
    return false;
  }
}

/** Extract a code from a pasted link / raw code. */
export function parseInviteCode(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    const parsed = Linking.parse(trimmed);
    const q = parsed.queryParams?.code;
    if (typeof q === "string" && q.length >= 6) return q.toUpperCase();
  } catch {
    /* not a URL */
  }
  const m = /[A-Z0-9]{6,16}/i.exec(trimmed);
  return m ? m[0].toUpperCase() : null;
}

export async function setPendingInviteCode(code: string): Promise<void> {
  await AsyncStorage.setItem(PENDING_KEY, code.toUpperCase()).catch(() => undefined);
}

/** Returns and clears the parked code (if any). */
export async function consumePendingInviteCode(): Promise<string | null> {
  const code = await AsyncStorage.getItem(PENDING_KEY).catch(() => null);
  if (code) await AsyncStorage.removeItem(PENDING_KEY).catch(() => undefined);
  return code;
}
