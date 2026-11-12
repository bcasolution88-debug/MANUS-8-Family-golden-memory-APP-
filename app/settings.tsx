import { ScrollView, Text, View, Pressable, Switch, Modal, ActivityIndicator, TextInput, Platform, Share } from "react-native";
import { useState } from "react";
import { useRouter } from "expo-router";
import { Image as ExpoImage } from "expo-image";
import * as Clipboard from "expo-clipboard";
import { useLanguage } from "@/lib/language-provider";
import { useColors } from "@/hooks/use-colors";
import { useAuth } from "@/hooks/use-auth";
import { useFamilyId } from "@/hooks/use-family-id";
import * as DocumentPicker from "expo-document-picker";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { useToast } from "@/components/toast";
import { trpc } from "@/lib/trpc";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { ScreenContainer } from "@/components/screen-container";

/** Human-readable bytes (GB with one decimal above 1 GB, otherwise MB). */
function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(bytes >= 10 * 1024 ** 3 ? 0 : 1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export default function SettingsScreen() {
  const router = useRouter();
  const { t, l, language, setLanguage } = useLanguage();
  const colors = useColors();
  const toast = useToast();
  const { user, isAuthenticated } = useAuth();
  const utils = trpc.useUtils();
  const [showExportModal, setShowExportModal] = useState(false);
  const [clearing, setClearing] = useState(false);

  // P8: server-side preferences (optimistic toggles). Notification switches are
  // enforced in createNotification; hideActivity filters the family timeline;
  // defaultPrivateAlbums pre-fills /album/new.
  const prefs = trpc.preferences.get.useQuery(undefined, { enabled: isAuthenticated, staleTime: 60_000 });
  const updatePrefs = trpc.preferences.update.useMutation({
    onMutate: async (patch) => {
      await utils.preferences.get.cancel();
      const previous = utils.preferences.get.getData();
      if (previous) {
        // P12: list columns are JSON strings on the wire; mirror the server encoding in the optimistic cache.
        const { pushMutedTypes, pushMutedFamilies, ...rest } = patch;
        utils.preferences.get.setData(undefined, {
          ...previous,
          ...rest,
          ...(pushMutedTypes !== undefined ? { pushMutedTypes: pushMutedTypes ? JSON.stringify(pushMutedTypes) : null } : {}),
          ...(pushMutedFamilies !== undefined ? { pushMutedFamilies: pushMutedFamilies ? JSON.stringify(pushMutedFamilies) : null } : {}),
        });
      }
      return { previous };
    },
    onError: (e, _patch, ctxData) => {
      if (ctxData?.previous) utils.preferences.get.setData(undefined, ctxData.previous);
      toast.error(e.message);
    },
    onSettled: () => utils.preferences.get.invalidate(),
  });
  const pref = <K extends keyof NonNullable<typeof prefs.data>>(key: K, fallback: NonNullable<typeof prefs.data>[K]) =>
    prefs.data?.[key] ?? fallback;
  const setPref = (patch: Parameters<typeof updatePrefs.mutate>[0]) => {
    if (!isAuthenticated) return toast.warning(l("请先登录", "Please sign in first"));
    updatePrefs.mutate(patch);
  };
  const notifications = pref("notifyEnabled", true);
  const comments = pref("notifyComments", true);
  const likes = pref("notifyLikes", true);
  const shares = pref("notifyShares", true);
  const uploads = pref("notifyUploads", true);
  const isPrivate = pref("defaultPrivateAlbums", false);
  const hideActivity = pref("hideActivity", false);
  const autoBackup = pref("autoBackup", false);

  // P8: password (set / change) for email accounts; OAuth users can add one
  const passwordStatus = trpc.auth.passwordStatus.useQuery(undefined, { enabled: isAuthenticated, staleTime: 60_000 });

  // P9: email verification + two-step sign-in
  const security = trpc.auth.securityStatus.useQuery(undefined, { enabled: isAuthenticated, staleTime: 30_000 });
  const [showVerifyModal, setShowVerifyModal] = useState(false);
  const [verifyCode, setVerifyCode] = useState("");
  const requestVerify = trpc.auth.requestEmailVerification.useMutation({
    onSuccess: (r) => {
      setShowVerifyModal(true);
      toast.success(r.delivered ? l("验证码已发送到邮箱", "Code sent to your email") : l("邮件服务未配置，验证码已写入服务器日志", "Mail not configured — code written to server log"));
    },
    onError: (e) => toast.error(e.message),
  });
  const verifyEmail = trpc.auth.verifyEmail.useMutation({
    onSuccess: async () => {
      await utils.auth.securityStatus.invalidate();
      setShowVerifyModal(false);
      setVerifyCode("");
      toast.success(l("邮箱已验证", "Email verified"));
    },
    onError: (e) => toast.error(e.message),
  });
  const setTwoFactor = trpc.auth.setTwoFactor.useMutation({
    onSuccess: async ({ twoFactorEnabled }) => {
      await utils.auth.securityStatus.invalidate();
      toast.success(twoFactorEnabled ? l("两步验证已开启", "Two-step sign-in enabled") : l("两步验证已关闭", "Two-step sign-in disabled"));
    },
    onError: (e) => toast.error(e.message),
  });

  // P10: phone number + SMS code channel
  const [showPhoneModal, setShowPhoneModal] = useState(false);
  const [phoneInput, setPhoneInput] = useState("");
  const [phoneCode, setPhoneCode] = useState("");
  const [phoneStep, setPhoneStep] = useState<"number" | "code">("number");
  const requestPhone = trpc.auth.requestPhoneVerification.useMutation({
    onSuccess: (r) => {
      setPhoneStep("code");
      toast.success(r.delivered ? l(`验证码已发送到 ${r.phoneMasked}`, `Code sent to ${r.phoneMasked}`) : l("短信服务未配置，验证码已写入服务器日志", "SMS not configured — code written to server log"));
    },
    onError: (e) => toast.error(e.message),
  });
  const verifyPhone = trpc.auth.verifyPhone.useMutation({
    onSuccess: async () => {
      await utils.auth.securityStatus.invalidate();
      setShowPhoneModal(false);
      setPhoneCode("");
      setPhoneStep("number");
      toast.success(l("手机号已验证", "Phone verified"));
    },
    onError: (e) => toast.error(e.message),
  });
  const removePhone = trpc.auth.removePhone.useMutation({
    onSuccess: async () => {
      await utils.auth.securityStatus.invalidate();
      toast.success(l("已移除手机号", "Phone removed"));
    },
    onError: (e) => toast.error(e.message),
  });
  const setChannel = trpc.auth.setTwoFactorChannel.useMutation({
    onSuccess: async ({ twoFactorChannel }) => {
      await utils.auth.securityStatus.invalidate();
      toast.success(twoFactorChannel === "sms" ? l("验证码将通过短信发送", "Codes will be sent by SMS") : l("验证码将通过邮件发送", "Codes will be sent by email"));
    },
    onError: (e) => toast.error(e.message),
  });

  // P10: push devices
  const pushEnabled = pref("pushEnabled", true);
  const devices = trpc.push.devices.useQuery(undefined, { enabled: isAuthenticated, staleTime: 30_000 });
  const testPush = trpc.push.test.useMutation({
    onSuccess: (r) => toast.success(r.sent > 0 ? l(`已向 ${r.sent} 台设备发送测试推送`, `Test push sent to ${r.sent} device(s)`) : l("没有可用设备（请在手机上登录并允许通知）", "No device available — sign in on your phone and allow notifications")),
    onError: (e) => toast.error(e.message),
  });
  const removeDevice = trpc.push.removeDevice.useMutation({ onSuccess: () => utils.push.devices.invalidate(), onError: (e) => toast.error(e.message) });

  // P10: backup target (WebDAV)
  const includeMedia = pref("backupIncludeMedia", false);
  const [showTargetModal, setShowTargetModal] = useState(false);
  const [davUrl, setDavUrl] = useState("");
  const [davUser, setDavUser] = useState("");
  const [davPass, setDavPass] = useState("");
  // P11: target kind (webdav | s3 | gdrive) + S3 config + restore
  const [targetKind, setTargetKind] = useState<"webdav" | "s3" | "gdrive">("webdav");
  const [s3Bucket, setS3Bucket] = useState("");
  const [s3Region, setS3Region] = useState("us-east-1");
  const [s3Prefix, setS3Prefix] = useState("");
  const [s3PathStyle, setS3PathStyle] = useState(true);
  const { familyId, family } = useFamilyId();
  const [showRestoreModal, setShowRestoreModal] = useState(false);
  const [restoreSource, setRestoreSource] = useState<{ backupId?: number; importKey?: string; remoteKey?: string; targetId?: number; label: string } | null>(null);
  const [restoreUploading, setRestoreUploading] = useState(false);
  const gdriveRedirect = Linking.createURL("/settings");
  const gdriveAuth = trpc.backup.gdriveAuthUrl.useQuery({ redirectUri: gdriveRedirect }, { enabled: isAuthenticated && showTargetModal && targetKind === "gdrive", staleTime: 60_000 });
  const presignImport = trpc.backup.presignImport.useMutation();
  const restorePlan = trpc.backup.restorePlan.useMutation({ onError: (e) => toast.error(e.message) });
  // P12: async restore with progress + selective albums + cloud history + quiet hours + merge
  const [restoreJobId, setRestoreJobId] = useState<string | null>(null);
  const [selectedAlbums, setSelectedAlbums] = useState<string[] | null>(null);
  const restoreJob = trpc.backup.restoreJob.useQuery({ jobId: restoreJobId ?? "" }, { enabled: !!restoreJobId, refetchInterval: (q) => (q.state.data && (q.state.data.status === "completed" || q.state.data.status === "failed") ? false : 1500) });
  const restoreAsync = trpc.backup.restoreAsync.useMutation({
    onSuccess: ({ jobId }) => {
      setRestoreJobId(jobId);
      toast.info(l("恢复已在后台开始", "Restore started in the background"));
    },
    onError: (e) => toast.error(e.message),
  });
  const restoreFinished = restoreJob.data?.status === "completed" || restoreJob.data?.status === "failed";
  const [restoreNotified, setRestoreNotified] = useState<string | null>(null);
  if (restoreFinished && restoreJobId && restoreNotified !== restoreJobId) {
    setRestoreNotified(restoreJobId);
    const r = restoreJob.data!.result;
    if (restoreJob.data!.status === "completed" && r) {
      void Promise.all([utils.album.invalidate(), utils.media.invalidate(), utils.timeline.invalidate()]);
      toast.success(l(`恢复完成：新建相册 ${r.albumsCreated}，恢复 ${r.mediaCreated} 条（上传文件 ${r.filesUploaded}，跳过 ${r.skipped.length}）`, `Restored: ${r.albumsCreated} album(s), ${r.mediaCreated} item(s) (${r.filesUploaded} files, ${r.skipped.length} skipped)`));
    } else if (restoreJob.data!.status === "failed") {
      toast.error(restoreJob.data!.error ?? l("恢复失败", "Restore failed"));
    }
  }
  const [showCloudModal, setShowCloudModal] = useState(false);
  const [cloudTargetId, setCloudTargetId] = useState<number | null>(null);
  const remoteList = trpc.backup.remoteList.useQuery({ targetId: cloudTargetId ?? undefined }, { enabled: isAuthenticated && showCloudModal, staleTime: 30_000, retry: false });
  const quietStart = pref("quietStart", null);
  const quietEnd = pref("quietEnd", null);
  const mutedTypesRaw = pref("pushMutedTypes", null);
  const mutedFamiliesRaw = pref("pushMutedFamilies", null);
  const mutedTypes: string[] = mutedTypesRaw ? (JSON.parse(mutedTypesRaw) as string[]) : [];
  const mutedFamilies: number[] = mutedFamiliesRaw ? (JSON.parse(mutedFamiliesRaw) as number[]) : [];
  const { families: myFamilies } = useFamilyId();
  const fmtMin = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const deviceTz = (() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return "UTC";
    }
  })();
  const toggleQuiet = (on: boolean) => setPref(on ? { quietStart: 22 * 60, quietEnd: 7 * 60, quietTz: deviceTz } : { quietStart: null, quietEnd: null, quietTz: null });
  const shiftQuiet = (which: "start" | "end", delta: number) => {
    const cur = which === "start" ? (quietStart ?? 22 * 60) : (quietEnd ?? 7 * 60);
    const next = ((cur + delta) % 1440 + 1440) % 1440;
    setPref(which === "start" ? { quietStart: next } : { quietEnd: next });
  };
  const toggleMutedType = (t: string) => setPref({ pushMutedTypes: mutedTypes.includes(t) ? mutedTypes.filter((x) => x !== t) : [...mutedTypes, t] });
  const toggleMutedFamily = (id: number) => setPref({ pushMutedFamilies: mutedFamilies.includes(id) ? mutedFamilies.filter((x) => x !== id) : [...mutedFamilies, id] });
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [mergeEmail, setMergeEmail] = useState("");
  const [mergeCode, setMergeCode] = useState("");
  const [mergeStep, setMergeStep] = useState<"email" | "code" | "preview">("email");
  // P14: merge preview wizard
  const [mergeChoices, setMergeChoices] = useState<Record<string, "target" | "source">>({});
  const previewMerge = trpc.auth.previewMerge.useMutation({
    onSuccess: (p) => {
      setMergeChoices(Object.fromEntries(p.conflicts.map((c) => [String(c.familyId), c.defaultKeep])));
      setMergeStep("preview");
    },
    onError: (e) => toast.error(e.message),
  });
  // P14: restore per-item preview + undo
  const [showItemPreview, setShowItemPreview] = useState(false);
  const [selectedItems, setSelectedItems] = useState<number[] | null>(null);
  const restorePreview = trpc.backup.restorePreview.useMutation({ onError: (e) => toast.error(e.message) });
  const undoRestore = trpc.backup.undoRestore.useMutation({
    onSuccess: async (r) => {
      await Promise.all([utils.album.invalidate(), utils.media.invalidate(), utils.timeline.invalidate(), utils.backup.restoreJob.invalidate()]);
      toast.success(l(`已撤销恢复：删除 ${r.mediaDeleted} 条记录、${r.albumsDeleted} 个相册${r.albumsKept ? `（${r.albumsKept} 个相册因有其他内容保留）` : ""}`, `Restore undone: ${r.mediaDeleted} items, ${r.albumsDeleted} albums removed${r.albumsKept ? ` (${r.albumsKept} kept — not empty)` : ""}`));
    },
    onError: (e) => toast.error(e.message),
  });
  // P14: target retention / quota / storage class
  const targetQuota = trpc.backup.targetQuota.useMutation({
    onSuccess: async (q) => {
      await utils.backup.status.invalidate();
      toast.success(l(`云端备份占用 ${formatBytes(q.usedBytes)}（${q.entries} 份）${q.quotaBytes ? `，总配额 ${formatBytes(q.quotaBytes)}` : ""}${q.estMonthlyUsd != null ? `，约 $${q.estMonthlyUsd}/月` : ""}`, `Backups use ${formatBytes(q.usedBytes)} (${q.entries} files)${q.quotaBytes ? `, quota ${formatBytes(q.quotaBytes)}` : ""}${q.estMonthlyUsd != null ? `, ≈ $${q.estMonthlyUsd}/mo` : ""}`));
    },
    onError: (e) => toast.error(e.message),
  });
  const pruneTarget = trpc.backup.pruneTarget.useMutation({
    onSuccess: (r) => toast.success(r.removed.length ? l(`已清理 ${r.removed.length} 份旧备份`, `Removed ${r.removed.length} old backups`) : l("没有需要清理的备份", "Nothing to prune")),
    onError: (e) => toast.error(e.message),
  });
  // P15: copy backups between targets
  const [copyFromId, setCopyFromId] = useState<number | null>(null);
  const [copyToId, setCopyToId] = useState<number | null>(null);
  const [copyClass, setCopyClass] = useState<string | null>(null);
  const [copyJobId, setCopyJobId] = useState<string | null>(null);
  const copyJobs = trpc.backup.copyJobs.useQuery({ take: 5 }, { enabled: isAuthenticated && copyFromId !== null, staleTime: 10_000 });
  const copyJob = trpc.backup.copyJob.useQuery({ jobId: copyJobId ?? "" }, { enabled: isAuthenticated && !!copyJobId, refetchInterval: (q) => (q.state.data && (q.state.data.status === "queued" || q.state.data.status === "running") ? 2000 : false) });
  const copyTarget = trpc.backup.copyTarget.useMutation({
    onSuccess: (r) => { setCopyJobId(r.jobId); utils.backup.copyJobs.invalidate(); toast.success(l("已开始复制，可在下方查看进度", "Copy started — progress below")); },
    onError: (e) => toast.error(e.message),
  });
  const cancelCopy = trpc.backup.cancelCopy.useMutation({ onSuccess: () => { utils.backup.copyJob.invalidate(); utils.backup.copyJobs.invalidate(); }, onError: (e) => toast.error(e.message) });
  // P15: merge ownership audit
  const [showOwnership, setShowOwnership] = useState(false);
  const [ownershipTable, setOwnershipTable] = useState<string | null>(null);
  const [ownershipMerge, setOwnershipMerge] = useState<number | null>(null);
  const ownership = trpc.auth.mergeOwnership.useQuery({ all: false, table: (ownershipTable ?? undefined) as never, mergeId: ownershipMerge ?? undefined, limit: 100 }, { enabled: isAuthenticated && showOwnership, staleTime: 15_000 });
  const ownershipCsv = trpc.auth.mergeOwnershipCsv.useMutation({
    onSuccess: async (file) => {
      if (Platform.OS === "web" && typeof document !== "undefined") {
        const blob = new Blob([file.content], { type: `${file.contentType};charset=utf-8` });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = file.filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else {
        try {
          await Share.share({ title: file.filename, message: file.content });
        } catch {
          await Clipboard.setStringAsync(file.content);
          toast.info(l("已复制到剪贴板", "Copied to clipboard"));
        }
      }
      if (file.truncated) toast.info(l(`仅导出前 500 行（共 ${file.total}）`, `First 500 of ${file.total} rows exported`));
    },
    onError: (e) => toast.error(e.message),
  });
  const [targetSettingsId, setTargetSettingsId] = useState<number | null>(null);
  const requestMerge = trpc.auth.requestMerge.useMutation({
    onSuccess: (r) => {
      setMergeStep("code");
      toast.success(r.delivered ? l(`验证码已发送到 ${r.destination}`, `Code sent to ${r.destination}`) : l("如果该邮箱对应另一个账户，验证码已发出（未配置邮件时见服务器日志）", "If that email belongs to another account, a code was sent (dev: see server log)"));
    },
    onError: (e) => toast.error(e.message),
  });
  const completeMerge = trpc.auth.completeMerge.useMutation({
    onSuccess: async (r) => {
      await utils.invalidate();
      setShowMergeModal(false);
      setMergeStep("email");
      setMergeCode("");
      const total = Object.values(r.moved).reduce((a, b) => a + b, 0);
      toast.success(l(`账户已合并：迁移 ${total} 条记录（照片 ${r.moved.media ?? 0}，相册 ${r.moved.albums ?? 0}）${r.undoDeadline ? `，可在 ${formatWhen(r.undoDeadline)} 前撤销` : ""}`, `Accounts merged: ${total} rows moved (${r.moved.media ?? 0} photos, ${r.moved.albums ?? 0} albums)${r.undoDeadline ? `; undo until ${formatWhen(r.undoDeadline)}` : ""}`));
    },
    onError: (e) => toast.error(e.message),
  });

  // P13: digest prefs · restore strategy · multi-target · merge undo / CSV
  const pushDigest = pref("pushDigest", "off") as "off" | "daily" | "weekly";
  const pushDigestHour = pref("pushDigestHour", 20) as number;
  const [albumConflict, setAlbumConflict] = useState<"merge" | "copy" | "skip">("merge");
  const [dedupeByHash, setDedupeByHash] = useState(true);
  const updateTarget = trpc.backup.updateTarget.useMutation({ onSuccess: () => utils.backup.status.invalidate(), onError: (e) => toast.error(e.message) });
  const [showMergeHistory, setShowMergeHistory] = useState(false);
  const mergeHistory = trpc.auth.mergeHistory.useQuery(undefined, { enabled: isAuthenticated && showMergeHistory, staleTime: 15_000 });
  const undoMerge = trpc.auth.undoMerge.useMutation({
    onSuccess: async (r) => {
      await utils.invalidate();
      const total = Object.values(r.restored).reduce((a, b) => a + b, 0);
      toast.success(l(`已撤销合并，恢复 ${total} 条记录到原账户`, `Merge undone — ${total} rows returned to the original account`));
    },
    onError: (e) => toast.error(e.message),
  });
  const mergeAuditCsv = trpc.auth.mergeAuditCsv.useMutation({
    onSuccess: async (file) => {
      if (Platform.OS === "web" && typeof document !== "undefined") {
        const blob = new Blob([file.content], { type: `${file.contentType};charset=utf-8` });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = file.filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else {
        try {
          await Share.share({ title: file.filename, message: file.content });
        } catch {
          await Clipboard.setStringAsync(file.content);
          toast.info(l("已复制到剪贴板", "Copied to clipboard"));
        }
      }
      toast.success(l(file.all ? "已导出全部合并审计（管理员）" : "已导出合并审计", file.all ? "Exported all merge audits (admin)" : "Exported merge audit"));
    },
    onError: (e) => toast.error(e.message),
  });

  const openRestore = (src: { backupId?: number; importKey?: string; remoteKey?: string; targetId?: number; label: string }) => {
    if (!familyId) return toast.warning(l("请先选择或创建一个家庭", "Pick or create a family first"));
    setRestoreSource(src);
    setSelectedAlbums(null);
    setRestoreJobId(null);
    setAlbumConflict("merge");
    setDedupeByHash(true);
    setSelectedItems(null);
    setShowItemPreview(false);
    restorePreview.reset();
    setShowRestoreModal(true);
    restorePlan.mutate({ familyId, backupId: src.backupId, importKey: src.importKey, remoteKey: src.remoteKey, targetId: src.targetId, options: { albumConflict: "merge", dedupeByHash: true } });
  };
  const replan = (next: { albumConflict?: "merge" | "copy" | "skip"; dedupeByHash?: boolean }) => {
    const ac = next.albumConflict ?? albumConflict;
    const dh = next.dedupeByHash ?? dedupeByHash;
    setAlbumConflict(ac);
    setDedupeByHash(dh);
    if (familyId && restoreSource) restorePlan.mutate({ familyId, backupId: restoreSource.backupId, importKey: restoreSource.importKey, remoteKey: restoreSource.remoteKey, targetId: restoreSource.targetId, albums: selectedAlbums ?? undefined, options: { albumConflict: ac, dedupeByHash: dh } });
  };
  const pickImportFile = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: ["application/zip", "application/json", "application/x-zip-compressed"], copyToCacheDirectory: true, multiple: false });
      if (res.canceled || !res.assets?.[0]) return;
      const asset = res.assets[0];
      setRestoreUploading(true);
      const { importKey, presignedUrl } = await presignImport.mutateAsync({ fileName: asset.name, fileSize: Math.max(1, asset.size ?? 1) });
      const blob = await (await fetch(asset.uri)).blob();
      const put = await fetch(presignedUrl, { method: "PUT", headers: { "Content-Type": asset.name.toLowerCase().endsWith(".zip") ? "application/zip" : "application/json" }, body: blob });
      if (!put.ok) throw new Error(`Upload failed (${put.status})`);
      openRestore({ importKey, label: asset.name });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : l("导入文件上传失败", "Import upload failed"));
    } finally {
      setRestoreUploading(false);
    }
  };
  const connectGDrive = async () => {
    if (!gdriveAuth.data?.url) return toast.warning(l("服务器未配置 Google Drive（GOOGLE_CLIENT_ID / SECRET）", "Google Drive is not configured on the server"));
    const result = await WebBrowser.openAuthSessionAsync(gdriveAuth.data.url, gdriveRedirect);
    if (result.type !== "success" || !result.url) return;
    const code = new URL(result.url).searchParams.get("code");
    if (!code) return toast.error(l("未获得授权码", "No authorization code returned"));
    setTarget.mutate({ kind: "gdrive", code, redirectUri: gdriveRedirect, config: { folderName: "GoldenMemory" } });
  };
  const submitTarget = () => {
    if (targetKind === "webdav") return setTarget.mutate({ kind: "webdav", url: davUrl, username: davUser, password: davPass });
    if (targetKind === "s3") return setTarget.mutate({ kind: "s3", url: davUrl, username: davUser, password: davPass, config: { bucket: s3Bucket, region: s3Region || "us-east-1", prefix: s3Prefix || undefined, pathStyle: s3PathStyle } });
    return connectGDrive();
  };
  const setTarget = trpc.backup.setTarget.useMutation({
    onSuccess: async () => {
      await utils.backup.status.invalidate();
      setShowTargetModal(false);
      setDavPass("");
      toast.success(l("云盘目标已添加，之后的备份会并行同步到所有已启用目标", "Cloud target added — future backups sync to every enabled target in parallel"));
    },
    onError: (e) => toast.error(e.message),
  });
  const testTarget = trpc.backup.testTarget.useMutation({
    onSuccess: async (r) => {
      await utils.backup.status.invalidate();
      if (r.ok) toast.success(l("连接正常", "Connection OK"));
      else toast.error(r.error);
    },
    onError: (e) => toast.error(e.message),
  });
  const removeTarget = trpc.backup.removeTarget.useMutation({
    onSuccess: async () => {
      await utils.backup.status.invalidate();
      toast.success(l("已断开云盘", "Cloud target removed"));
    },
    onError: (e) => toast.error(e.message),
  });

  // P9: backups
  const backupStatus = trpc.backup.status.useQuery(undefined, { enabled: isAuthenticated, staleTime: 30_000 });
  const backupList = trpc.backup.list.useQuery({ take: 5 }, { enabled: isAuthenticated, staleTime: 30_000 });
  const runBackup = trpc.backup.runNow.useMutation({
    onSuccess: async (r) => {
      await Promise.all([utils.backup.status.invalidate(), utils.backup.list.invalidate()]);
      const remote = r.remoteStatus === "uploaded" ? l("，已同步到云盘", ", copied to cloud") : r.remoteStatus === "failed" ? l("，云盘同步失败", ", cloud copy failed") : "";
      const media = r.format === "zip" ? l(`（含 ${r.mediaCount} 个原文件${r.skippedCount ? `，跳过 ${r.skippedCount}` : ""}）`, ` (${r.mediaCount} files${r.skippedCount ? `, ${r.skippedCount} skipped` : ""})`) : "";
      toast.success(l(`备份完成：${r.itemCount} 条记录${media}${r.delivered ? "，摘要已发送到邮箱" : ""}${remote}`, `Backup done: ${r.itemCount} items${media}${r.delivered ? ", summary emailed" : ""}${remote}`));
    },
    onError: (e) => toast.error(e.message),
  });
  const downloadBackup = trpc.backup.download.useMutation({
    onSuccess: async (r) => {
      const content = r.inline ?? null;
      if (Platform.OS === "web" && typeof document !== "undefined") {
        if (r.url) {
          window.open(r.url, "_blank", "noopener");
        } else if (content) {
          const blob = new Blob([content], { type: r.format === "zip" ? "application/zip" : "application/json" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = r.filename;
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
      } else if (r.url) {
        await Clipboard.setStringAsync(r.url);
        toast.info(l("下载链接已复制（15 分钟内有效）", "Download link copied (valid 15 min)"));
      } else if (content) {
        try {
          await Share.share({ title: r.filename, message: content });
        } catch {
          await Clipboard.setStringAsync(content);
          toast.info(l("已复制到剪贴板", "Copied to clipboard"));
        }
      }
    },
    onError: (e) => toast.error(e.message),
  });
  const formatWhen = (d: Date | string | null | undefined) => (d ? new Date(d).toLocaleString() : "—");
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNew, setConfirmNew] = useState("");
  const changePassword = trpc.auth.changePassword.useMutation({
    onSuccess: async ({ hadPassword }) => {
      await utils.auth.passwordStatus.invalidate();
      setShowPasswordModal(false);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmNew("");
      toast.success(hadPassword ? l("密码已更新", "Password updated") : l("密码已设置，现在可以用邮箱登录", "Password set — you can now sign in with email"));
    },
    onError: (e) => toast.error(e.message),
  });
  const submitPassword = () => {
    if (newPassword.length < 8) return toast.warning(l("新密码至少 8 位", "New password must be at least 8 characters"));
    if (newPassword !== confirmNew) return toast.warning(t("register.passwordsDoNotMatch"));
    changePassword.mutate({ currentPassword: passwordStatus.data?.hasPassword ? currentPassword : undefined, newPassword });
  };

  // P8: data export — CSV / JSON (+ signed links). Web downloads a file; native shares text.
  const exportData = trpc.profile.exportData.useMutation({
    onSuccess: async (file) => {
      setShowExportModal(false);
      if (Platform.OS === "web" && typeof document !== "undefined") {
        const blob = new Blob([file.content], { type: `${file.mimeType};charset=utf-8` });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = file.filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else {
        try {
          await Share.share({ title: file.filename, message: file.content });
        } catch {
          await Clipboard.setStringAsync(file.content);
          toast.info(l("已复制到剪贴板", "Copied to clipboard"));
        }
      }
      toast.success(l(`已导出 ${file.count} 条记录`, `Exported ${file.count} records`));
    },
    onError: (e) => toast.error(e.message),
  });

  // P7: real storage usage + account identity
  const me = trpc.auth.me.useQuery(undefined, { enabled: isAuthenticated, staleTime: 30_000 });
  const usage = trpc.profile.storageUsage.useQuery(undefined, { enabled: isAuthenticated, staleTime: 60_000 });
  const families = trpc.family.getUserFamilies.useQuery(undefined, { enabled: isAuthenticated, staleTime: 60_000 });
  const usedBytes = usage.data?.usedBytes ?? 0;
  const quotaBytes = usage.data?.quotaBytes ?? 10 * 1024 ** 3;
  const usedPct = Math.min(100, Math.round((usedBytes / Math.max(1, quotaBytes)) * 100));
  const accountEmail = me.data?.email ?? user?.email ?? "";
  const familyName = (id: number) => (families.data as { id: number; name: string }[] | undefined)?.find((f) => f.id === id)?.name ?? `#${id}`;

  const handleClearCache = async () => {
    if (clearing) return;
    setClearing(true);
    try {
      await Promise.all([ExpoImage.clearDiskCache(), ExpoImage.clearMemoryCache()]);
      // Drop cached signed URLs / lists so they're re-fetched fresh.
      await Promise.all([utils.media.getSignedUrl.invalidate(), utils.profile.avatarUrl.invalidate()]);
      utils.media.listMedia.reset();
      toast.success(l("缓存已清除", "Cache cleared"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : l("清除失败", "Failed to clear cache"));
    } finally {
      setClearing(false);
    }
  };

  const handleSetLanguage = async (lang: "zh" | "en") => {
    if (lang === language) return;
    await setLanguage(lang);
    toast.success(lang === "zh" ? "已切换为中文" : "Switched to English");
  };

  return (
    <ScreenContainer className="bg-background p-0">
      <ScrollView
        contentContainerStyle={{ flexGrow: 1 }}
        showsVerticalScrollIndicator={false}
      >
        <View className="flex-1">
          {/* 顶部导航 */}
          <View className="flex-row items-center justify-between px-6 py-4 bg-surface">
            <Pressable onPress={() => router.back()} className="p-2 min-w-[48px] min-h-[48px] items-center justify-center">
              <MaterialIcons name="arrow-back" size={24} color={colors.foreground} />
            </Pressable>
            <Text className="text-lg font-bold text-foreground">
              {t("settings")}
            </Text>
            <View className="w-10" />
          </View>

          {/* 主要内容 */}
          <View className="flex-1 px-6 py-4 gap-6">
            {/* 通知设置 */}
            <View className="gap-3">
              <Text className="text-lg font-bold text-foreground">
                {t("settings.notificationPreferences")}
              </Text>

              <View className="flex-row items-center justify-between bg-surface rounded-2xl p-4">
                <View className="flex-row items-center gap-3">
                  <MaterialIcons name="notifications" size={24} color={colors.primary} />
                  <View>
                    <Text className="font-semibold text-foreground">
                      {t("settings.enableNotifications")}
                    </Text>
                    <Text className="text-xs text-muted">
                      {t("settings.receiveAllNotifications")}
                    </Text>
                  </View>
                </View>
                <Switch
                  value={notifications}
                  onValueChange={(v) => setPref({ notifyEnabled: v })}
                  trackColor={{ false: colors.border, true: colors.primary }}
                />
              </View>

              {/* P10: 设备推送 */}
              <View className="bg-surface rounded-2xl p-4 gap-3">
                <View className="flex-row items-center justify-between">
                  <View className="flex-row items-center gap-3 flex-1">
                    <MaterialIcons name="phonelink-ring" size={24} color={colors.primary} />
                    <View className="flex-1">
                      <Text className="font-semibold text-foreground">{l("设备推送", "Push to devices")}</Text>
                      <Text className="text-xs text-muted">
                        {devices.data?.devices.length
                          ? l(`${devices.data.devices.length} 台设备已注册`, `${devices.data.devices.length} device(s) registered`)
                          : l("在手机上登录并允许通知后自动注册", "Registers automatically after signing in on your phone")}
                      </Text>
                    </View>
                  </View>
                  <Switch
                    value={pushEnabled}
                    disabled={!notifications}
                    onValueChange={(v) => setPref({ pushEnabled: v })}
                    trackColor={{ false: colors.border, true: colors.primary }}
                  />
                </View>
                {isAuthenticated && (devices.data?.devices ?? []).map((d) => (
                  <View key={d.id} className="flex-row items-center justify-between pt-2 border-t border-border">
                    <View className="flex-1">
                      <Text className="text-xs text-foreground">{d.deviceName ?? d.platform} · {d.platform}{d.failedAt ? l(" · 已失效", " · expired") : ""}</Text>
                      <Text className="text-[10px] text-muted">…{d.tokenSuffix} · {formatWhen(d.lastSeenAt)}</Text>
                    </View>
                    <Pressable onPress={() => removeDevice.mutate({ id: d.id })} accessibilityLabel={l("移除设备", "Remove device")} className="min-w-[44px] min-h-[44px] items-center justify-center">
                      <MaterialIcons name="close" size={18} color={colors.muted} />
                    </Pressable>
                  </View>
                ))}
                {isAuthenticated && (
                  <Pressable
                    onPress={() => testPush.mutate()}
                    disabled={testPush.isPending || !pushEnabled}
                    accessibilityRole="button"
                    className="self-start flex-row items-center gap-1 rounded-full px-3 min-h-[40px]"
                    style={{ backgroundColor: `${colors.primary}22`, opacity: pushEnabled ? 1 : 0.5 }}
                  >
                    {testPush.isPending ? <ActivityIndicator size="small" color={colors.primary} /> : <MaterialIcons name="notifications-active" size={18} color={colors.primary} />}
                    <Text className="text-sm font-semibold text-primary">{l("发送测试推送", "Send test push")}</Text>
                  </Pressable>
                )}

                {/* P12: 免打扰时段 */}
                {isAuthenticated && pushEnabled && (
                  <View className="pt-2 border-t border-border gap-2">
                    <View className="flex-row items-center justify-between">
                      <View className="flex-1 pr-3">
                        <Text className="font-semibold text-foreground text-sm">{l("免打扰时段", "Quiet hours")}</Text>
                        <Text className="text-xs text-muted">{quietStart != null && quietEnd != null ? l(`${fmtMin(quietStart)} – ${fmtMin(quietEnd)} 不推送（${pref("quietTz", null) ?? deviceTz}），邀请除外`, `${fmtMin(quietStart)} – ${fmtMin(quietEnd)} silent (${pref("quietTz", null) ?? deviceTz}); invites still push`) : l("夜间静默，应用内消息照常", "Silence pushes at night; in-app messages still arrive")}</Text>
                      </View>
                      <Switch value={quietStart != null && quietEnd != null} onValueChange={toggleQuiet} trackColor={{ false: colors.border, true: colors.primary }} />
                    </View>
                    {quietStart != null && quietEnd != null && (
                      <View className="flex-row gap-2">
                        {(["start", "end"] as const).map((w) => (
                          <View key={w} className="flex-1 flex-row items-center justify-between bg-background rounded-2xl px-2 min-h-[44px]">
                            <Pressable onPress={() => shiftQuiet(w, -30)} className="min-w-[40px] min-h-[40px] items-center justify-center" accessibilityLabel={l("提前 30 分钟", "Earlier by 30 min")}>
                              <MaterialIcons name="remove" size={18} color={colors.primary} />
                            </Pressable>
                            <Text className="text-sm font-mono text-foreground">{w === "start" ? l("从", "From") : l("到", "To")} {fmtMin(w === "start" ? quietStart : quietEnd)}</Text>
                            <Pressable onPress={() => shiftQuiet(w, 30)} className="min-w-[40px] min-h-[40px] items-center justify-center" accessibilityLabel={l("推后 30 分钟", "Later by 30 min")}>
                              <MaterialIcons name="add" size={18} color={colors.primary} />
                            </Pressable>
                          </View>
                        ))}
                      </View>
                    )}
                    {/* P12: 推送分类 */}
                    <Text className="font-semibold text-foreground text-sm mt-1">{l("推送分类（关闭的仅在应用内显示）", "Push categories (off = in-app only)")}</Text>
                    <View className="flex-row flex-wrap gap-2">
                      {([
                        ["like", l("点赞", "Likes")],
                        ["comment", l("评论", "Comments")],
                        ["reply", l("回复", "Replies")],
                        ["upload", l("新照片", "Uploads")],
                        ["share", l("分享", "Shares")],
                        ["anniversary", l("纪念日", "Anniversaries")],
                        ["member_joined", l("新成员", "New members")],
                      ] as const).map(([tKey, label]) => {
                        const on = !mutedTypes.includes(tKey);
                        return (
                          <Pressable key={tKey} onPress={() => toggleMutedType(tKey)} accessibilityRole="button" accessibilityState={{ selected: on }} className="rounded-full px-3 min-h-[36px] items-center justify-center flex-row gap-1" style={{ backgroundColor: on ? colors.primary : colors.background }}>
                            <MaterialIcons name={on ? "notifications" : "notifications-off"} size={14} color={on ? colors.onPrimary : colors.muted} />
                            <Text className={on ? "text-xs font-semibold text-onPrimary" : "text-xs font-semibold text-muted"}>{label}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                    {/* P12: 按家庭静音 */}
                    {myFamilies.length > 1 && (
                      <>
                        <Text className="font-semibold text-foreground text-sm mt-1">{l("按家庭静音", "Mute by family")}</Text>
                        <View className="flex-row flex-wrap gap-2">
                          {myFamilies.map((f) => {
                            const muted = mutedFamilies.includes(f.id);
                            return (
                              <Pressable key={f.id} onPress={() => toggleMutedFamily(f.id)} accessibilityRole="button" accessibilityState={{ selected: muted }} className="rounded-full px-3 min-h-[36px] items-center justify-center flex-row gap-1" style={{ backgroundColor: muted ? colors.background : colors.primary }}>
                                <MaterialIcons name={muted ? "volume-off" : "volume-up"} size={14} color={muted ? colors.muted : colors.onPrimary} />
                                <Text className={muted ? "text-xs font-semibold text-muted" : "text-xs font-semibold text-onPrimary"}>{f.name}</Text>
                              </Pressable>
                            );
                          })}
                        </View>
                      </>
                    )}
                    {/* P13: 摘要日报 / 周报 */}
                    <Text className="font-semibold text-foreground text-sm mt-1">{l("互动摘要", "Activity digest")}</Text>
                    <Text className="text-xs text-muted">{l("开启后点赞 / 评论 / 上传 / 分享不再即时推送，而是合并为一条每日或每周摘要；邀请、纪念日与系统通知仍即时送达。", "Likes / comments / uploads / shares are batched into one daily or weekly summary instead of pushing immediately; invites, anniversaries and system notices still arrive right away.")}</Text>
                    <View className="flex-row bg-background rounded-full p-1">
                      {(["off", "daily", "weekly"] as const).map((v) => (
                        <Pressable key={v} onPress={() => setPref({ pushDigest: v })} accessibilityRole="button" accessibilityState={{ selected: pushDigest === v }} className="flex-1 rounded-full min-h-[36px] items-center justify-center" style={{ backgroundColor: pushDigest === v ? colors.primary : "transparent" }}>
                          <Text className="text-xs font-semibold" style={{ color: pushDigest === v ? colors.onPrimary : colors.foreground }}>{v === "off" ? l("即时", "Instant") : v === "daily" ? l("每日", "Daily") : l("每周", "Weekly")}</Text>
                        </Pressable>
                      ))}
                    </View>
                    {pushDigest !== "off" && (
                      <>
                        <View className="flex-row items-center justify-between min-h-[40px]">
                          <View className="flex-1 pr-2">
                            <Text className="text-xs text-foreground">{l("智能送达时间", "Smart delivery time")}</Text>
                            <Text className="text-[10px] text-muted">{l("根据您最常点开通知的时段自动选择（需要一定点击记录）", "Learns the hour you usually open pushes (needs some tap history)")}</Text>
                          </View>
                          <Switch value={pref("pushDigestSmart", false) as boolean} onValueChange={(v) => setPref({ pushDigestSmart: v })} trackColor={{ false: colors.border, true: colors.primary }} />
                        </View>
                        <View className="flex-row items-center justify-between min-h-[40px]">
                          <View className="flex-1 pr-2">
                            <Text className="text-xs text-foreground">{l("按家庭分别摘要", "One digest per family")}</Text>
                            <Text className="text-[10px] text-muted">{l("多个家庭各发一条，标题带家庭名", "Separate pushes per family, family name in the title")}</Text>
                          </View>
                          <Switch value={pref("pushDigestPerFamily", false) as boolean} onValueChange={(v) => setPref({ pushDigestPerFamily: v })} trackColor={{ false: colors.border, true: colors.primary }} />
                        </View>
                        <View className="flex-row items-center justify-between min-h-[40px]">
                          <View className="flex-1 pr-2">
                            <Text className="text-xs text-foreground">{l("附上本周精选照片", "Attach weekly picks")}</Text>
                            <Text className="text-[10px] text-muted">{l("按点赞 / 评论热度挑一张，作为带缩略图的富推送", "Hottest photo by likes / comments as a rich push with thumbnail")}</Text>
                          </View>
                          <Switch value={pref("pushDigestHighlights", true) as boolean} onValueChange={(v) => setPref({ pushDigestHighlights: v })} trackColor={{ false: colors.border, true: colors.primary }} />
                        </View>
                      </>
                    )}
                    {pushDigest !== "off" && !(pref("pushDigestSmart", false) as boolean) && (
                      <View className="flex-row items-center justify-between">
                        <Text className="text-xs text-muted">{l(`送达时间 ${String(pushDigestHour).padStart(2, "0")}:00${pushDigest === "weekly" ? "（周日）" : ""}`, `Delivered at ${String(pushDigestHour).padStart(2, "0")}:00${pushDigest === "weekly" ? " (Sundays)" : ""}`)}</Text>
                        <View className="flex-row items-center gap-1">
                          <Pressable onPress={() => setPref({ pushDigestHour: (pushDigestHour + 23) % 24 })} accessibilityLabel={l("提前一小时", "One hour earlier")} className="w-9 h-9 rounded-full items-center justify-center bg-background"><MaterialIcons name="remove" size={16} color={colors.foreground} /></Pressable>
                          <Pressable onPress={() => setPref({ pushDigestHour: (pushDigestHour + 1) % 24 })} accessibilityLabel={l("推后一小时", "One hour later")} className="w-9 h-9 rounded-full items-center justify-center bg-background"><MaterialIcons name="add" size={16} color={colors.foreground} /></Pressable>
                        </View>
                      </View>
                    )}
                  </View>
                )}
              </View>

              {notifications && (
                <>
                  <View className="flex-row items-center justify-between bg-surface rounded-2xl p-4">
                    <View className="flex-row items-center gap-3">
                      <MaterialIcons name="message" size={24} color={colors.primary} />
                      <View>
                        <Text className="font-semibold text-foreground">
                          {t("settings.commentNotifications")}
                        </Text>
                      </View>
                    </View>
                    <Switch
                      value={comments}
                      onValueChange={(v) => setPref({ notifyComments: v })}
                      trackColor={{ false: colors.border, true: colors.primary }}
                    />
                  </View>

                  <View className="flex-row items-center justify-between bg-surface rounded-2xl p-4">
                    <View className="flex-row items-center gap-3">
                      <MaterialIcons name="favorite" size={24} color={colors.primary} />
                      <View>
                        <Text className="font-semibold text-foreground">
                          {t("settings.likeNotifications")}
                        </Text>
                      </View>
                    </View>
                    <Switch
                      value={likes}
                      onValueChange={(v) => setPref({ notifyLikes: v })}
                      trackColor={{ false: colors.border, true: colors.primary }}
                    />
                  </View>

                  <View className="flex-row items-center justify-between bg-surface rounded-2xl p-4">
                    <View className="flex-row items-center gap-3">
                      <MaterialIcons name="share" size={24} color={colors.primary} />
                      <View>
                        <Text className="font-semibold text-foreground">
                          {t("settings.shareNotifications")}
                        </Text>
                      </View>
                    </View>
                    <Switch
                      value={shares}
                      onValueChange={(v) => setPref({ notifyShares: v })}
                      trackColor={{ false: colors.border, true: colors.primary }}
                    />
                  </View>

                  <View className="flex-row items-center justify-between bg-surface rounded-2xl p-4">
                    <View className="flex-row items-center gap-3">
                      <MaterialIcons name="cloud-upload" size={24} color={colors.primary} />
                      <View>
                        <Text className="font-semibold text-foreground">{l("上传通知", "Upload notifications")}</Text>
                        <Text className="text-xs text-muted">{l("家人上传新照片 / 视频时提醒", "When family members add photos or videos")}</Text>
                      </View>
                    </View>
                    <Switch
                      value={uploads}
                      onValueChange={(v) => setPref({ notifyUploads: v })}
                      trackColor={{ false: colors.border, true: colors.primary }}
                    />
                  </View>
                </>
              )}
            </View>

            {/* 隐私控制 */}
            <View className="gap-3">
              <Text className="text-lg font-bold text-foreground">
                {t("settings.privacyControl")}
              </Text>

              <View className="flex-row items-center justify-between bg-surface rounded-2xl p-4">
                <View className="flex-row items-center gap-3">
                  <MaterialIcons name="lock" size={24} color={colors.primary} />
                  <View>
                    <Text className="font-semibold text-foreground">
                      {t("settings.privateAlbum")}
                    </Text>
                    <Text className="text-xs text-muted">
                      {t("settings.onlyVisibleToYou")}
                    </Text>
                  </View>
                </View>
                <Switch
                  value={isPrivate}
                  onValueChange={(v) => setPref({ defaultPrivateAlbums: v })}
                  trackColor={{ false: colors.border, true: colors.primary }}
                />
              </View>

              <View className="flex-row items-center justify-between bg-surface rounded-2xl p-4">
                <View className="flex-row items-center gap-3 flex-1">
                  <MaterialIcons name="visibility-off" size={24} color={colors.primary} />
                  <View className="flex-1">
                    <Text className="font-semibold text-foreground">
                      {t("settings.hideMyActivity")}
                    </Text>
                    <Text className="text-xs text-muted">
                      {l("我的点赞 / 评论不出现在家人的时间线里", "My likes / comments won't appear in the family timeline")}
                    </Text>
                  </View>
                </View>
                <Switch
                  value={hideActivity}
                  onValueChange={(v) => setPref({ hideActivity: v })}
                  trackColor={{ false: colors.border, true: colors.primary }}
                />
              </View>

              <Pressable className="flex-row items-center justify-between bg-surface rounded-2xl p-4 active:opacity-80">
                <View className="flex-row items-center gap-3">
                  <MaterialIcons name="block" size={24} color={colors.primary} />
                  <View>
                    <Text className="font-semibold text-foreground">
                      {t("settings.blockUsers")}
                    </Text>
                    <Text className="text-xs text-muted">
                      {t("settings.manageBlockedUsers")}
                    </Text>
                  </View>
                </View>
                <MaterialIcons name="chevron-right" size={24} color={colors.muted} />
              </Pressable>

              {/* P9: 邮箱验证 */}
              <Pressable
                onPress={() => {
                  if (!isAuthenticated) return toast.warning(l("请先登录", "Please sign in first"));
                  if (security.data?.emailVerified) return toast.info(l("邮箱已验证", "Email already verified"));
                  requestVerify.mutate({ language: l("zh", "en") as "zh" | "en" });
                }}
                disabled={requestVerify.isPending}
                accessibilityRole="button"
                className="flex-row items-center justify-between bg-surface rounded-2xl p-4 active:opacity-80 min-h-[56px]"
              >
                <View className="flex-row items-center gap-3 flex-1">
                  <MaterialIcons name={security.data?.emailVerified ? "verified" : "mark-email-unread"} size={24} color={security.data?.emailVerified ? colors.success : colors.primary} />
                  <View className="flex-1">
                    <Text className="font-semibold text-foreground">{l("邮箱验证", "Email verification")}</Text>
                    <Text className="text-xs text-muted">
                      {security.data?.emailVerified
                        ? l(`已验证 · ${formatWhen(security.data.emailVerifiedAt)}`, `Verified · ${formatWhen(security.data.emailVerifiedAt)}`)
                        : security.data?.mailConfigured === false
                          ? l("未验证 · 邮件服务未配置（开发环境验证码见服务器日志）", "Unverified · mail not configured (dev: code in server log)")
                          : l("未验证 · 点击发送验证码", "Unverified · tap to send a code")}
                    </Text>
                  </View>
                </View>
                {requestVerify.isPending ? <ActivityIndicator size="small" color={colors.primary} /> : <MaterialIcons name={security.data?.emailVerified ? "check-circle" : "chevron-right"} size={24} color={security.data?.emailVerified ? colors.success : colors.muted} />}
              </Pressable>

              {/* P9: 两步验证 */}
              <View className="flex-row items-center justify-between bg-surface rounded-2xl p-4">
                <View className="flex-row items-center gap-3 flex-1">
                  <MaterialIcons name="security" size={24} color={colors.primary} />
                  <View className="flex-1">
                    <Text className="font-semibold text-foreground">{l("两步验证", "Two-step sign-in")}</Text>
                    <Text className="text-xs text-muted">
                      {security.data?.emailVerified && security.data?.hasPassword
                        ? l("密码登录后需输入邮箱验证码", "Email code required after password sign-in")
                        : l("需先设置密码并验证邮箱", "Set a password and verify your email first")}
                    </Text>
                  </View>
                </View>
                <Switch
                  value={security.data?.twoFactorEnabled ?? false}
                  disabled={!security.data?.emailVerified || !security.data?.hasPassword || setTwoFactor.isPending}
                  onValueChange={(v) => setTwoFactor.mutate({ enabled: v })}
                  trackColor={{ false: colors.border, true: colors.primary }}
                />
              </View>

              {/* P10: 手机号 / 短信 */}
              <Pressable
                onPress={() => {
                  if (!isAuthenticated) return toast.warning(l("请先登录", "Please sign in first"));
                  setPhoneInput(security.data?.phone ?? "");
                  setPhoneStep("number");
                  setShowPhoneModal(true);
                }}
                accessibilityRole="button"
                className="flex-row items-center justify-between bg-surface rounded-2xl p-4 active:opacity-80 min-h-[56px]"
              >
                <View className="flex-row items-center gap-3 flex-1">
                  <MaterialIcons name={security.data?.phoneVerified ? "phone-iphone" : "phonelink-setup"} size={24} color={security.data?.phoneVerified ? colors.success : colors.primary} />
                  <View className="flex-1">
                    <Text className="font-semibold text-foreground">{l("手机号（短信验证码）", "Phone (SMS codes)")}</Text>
                    <Text className="text-xs text-muted">
                      {security.data?.phone
                        ? security.data.phoneVerified
                          ? l(`${security.data.phoneMasked} · 已验证`, `${security.data.phoneMasked} · verified`)
                          : l(`${security.data.phoneMasked} · 未验证，点击验证`, `${security.data.phoneMasked} · unverified, tap to verify`)
                        : security.data?.smsConfigured === false
                          ? l("未绑定 · 短信服务未配置（开发环境验证码见日志）", "Not linked · SMS not configured (dev: code in server log)")
                          : l("未绑定 · 绑定后可用短信接收验证码", "Not linked · receive codes by SMS")}
                    </Text>
                  </View>
                </View>
                <MaterialIcons name="chevron-right" size={24} color={colors.muted} />
              </Pressable>

              {/* P10: 验证码渠道 */}
              {isAuthenticated && security.data && (
                <View className="bg-surface rounded-2xl p-4 gap-3">
                  <View className="flex-row items-center gap-3">
                    <MaterialIcons name="forward-to-inbox" size={24} color={colors.primary} />
                    <View className="flex-1">
                      <Text className="font-semibold text-foreground">{l("验证码发送方式", "Code delivery")}</Text>
                      <Text className="text-xs text-muted">{l("用于两步验证与找回密码", "Used for two-step sign-in and password reset")}</Text>
                    </View>
                  </View>
                  <View className="flex-row gap-2">
                    {(["email", "sms"] as const).map((ch) => {
                      const active = security.data?.twoFactorChannel === ch;
                      const disabled = ch === "sms" && !security.data?.phoneVerified;
                      return (
                        <Pressable
                          key={ch}
                          onPress={() => !disabled && !active && setChannel.mutate({ channel: ch })}
                          disabled={disabled || setChannel.isPending}
                          accessibilityRole="button"
                          accessibilityState={{ selected: active, disabled }}
                          className="flex-1 rounded-full min-h-[44px] items-center justify-center flex-row gap-1"
                          style={{ backgroundColor: active ? colors.primary : colors.background, opacity: disabled ? 0.5 : 1 }}
                        >
                          <MaterialIcons name={ch === "email" ? "email" : "sms"} size={16} color={active ? colors.onPrimary : colors.muted} />
                          <Text className={active ? "font-semibold text-onPrimary" : "font-semibold text-foreground"}>{ch === "email" ? l("邮件", "Email") : l("短信", "SMS")}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              )}
            </View>

            {/* P12: 账号合并 */}
            {isAuthenticated && (
              <Pressable
                onPress={() => {
                  setMergeEmail("");
                  setMergeCode("");
                  setMergeStep("email");
                  setShowMergeModal(true);
                }}
                accessibilityRole="button"
                className="flex-row items-center justify-between bg-surface rounded-2xl p-4 active:opacity-80 min-h-[56px]"
              >
                <View className="flex-row items-center gap-3 flex-1">
                  <MaterialIcons name="merge-type" size={24} color={colors.primary} />
                  <View className="flex-1">
                    <Text className="font-semibold text-foreground">{l("合并另一个账户", "Merge another account")}</Text>
                    <Text className="text-xs text-muted">{l("把手机号 / 邮箱 / Google 注册的另一个账户并入当前账户", "Fold an account you created with another email / phone / Google into this one")}</Text>
                  </View>
                </View>
                <MaterialIcons name="chevron-right" size={24} color={colors.muted} />
              </Pressable>
            )}

            {/* 存储管理 */}
            <View className="gap-3">
              <Text className="text-lg font-bold text-foreground">
                {t("settings.storageManagement")}
              </Text>

              <View className="bg-surface rounded-2xl p-4 gap-3">
                <View className="flex-row items-center justify-between">
                  <Text className="font-semibold text-foreground">
                    {t("settings.used")}
                  </Text>
                  {usage.isLoading ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <Text className="font-semibold text-foreground">
                      {isAuthenticated ? `${formatBytes(usedBytes)} / ${formatBytes(quotaBytes)}` : "—"}
                    </Text>
                  )}
                </View>

                <View className="w-full h-2 rounded-full overflow-hidden bg-border">
                  <View
                    className="h-full"
                    style={{ width: `${usedPct}%`, backgroundColor: usedPct >= 90 ? colors.error : colors.primary }}
                  />
                </View>

                {isAuthenticated && usage.data ? (
                  <>
                    <Text className="text-xs text-muted">
                      {t("settings.tofixedGbAvailable", { toFixed: (usage.data.availableBytes / 1024 ** 3).toFixed(1) })}
                      {" · "}
                      {l(`${usage.data.photos} 张照片 ${formatBytes(usage.data.photoBytes)}`, `${usage.data.photos} photos ${formatBytes(usage.data.photoBytes)}`)}
                      {" · "}
                      {l(`${usage.data.videos} 个视频 ${formatBytes(usage.data.videoBytes)}`, `${usage.data.videos} videos ${formatBytes(usage.data.videoBytes)}`)}
                    </Text>
                    {usage.data.families.length > 0 && (
                      <View className="gap-1 pt-1 border-t border-border">
                        <Text className="text-xs font-semibold text-muted">{l("各家庭总用量（含其他成员）", "Per family (all members)")}</Text>
                        {usage.data.families.map((f) => (
                          <View key={f.familyId} className="flex-row items-center justify-between">
                            <Text className="text-xs text-foreground" numberOfLines={1}>{familyName(f.familyId)}</Text>
                            <Text className="text-xs text-muted">{formatBytes(f.bytes)} · {f.count}</Text>
                          </View>
                        ))}
                      </View>
                    )}
                  </>
                ) : (
                  <Text className="text-xs text-muted">{l("登录后查看存储用量", "Sign in to see storage usage")}</Text>
                )}
              </View>

              <Pressable
                onPress={handleClearCache}
                disabled={clearing}
                accessibilityRole="button"
                className="flex-row items-center justify-between bg-surface rounded-2xl p-4 active:opacity-80 min-h-[56px]"
              >
                <View className="flex-row items-center gap-3">
                  <MaterialIcons name="delete" size={24} color={colors.error} />
                  <View>
                    <Text className="font-semibold text-foreground">
                      {t("settings.clearCache")}
                    </Text>
                    <Text className="text-xs text-muted">
                      {l("清除已下载图片缓存与签名链接（不影响云端）", "Clear downloaded image cache and signed links (cloud untouched)")}
                    </Text>
                  </View>
                </View>
                {clearing ? <ActivityIndicator size="small" color={colors.primary} /> : <MaterialIcons name="chevron-right" size={24} color={colors.muted} />}
              </Pressable>
            </View>

            {/* 语言（P7） */}
            <View className="gap-3">
              <Text className="text-lg font-bold text-foreground">{t("language")}</Text>
              <View className="flex-row bg-surface rounded-2xl p-1">
                {(["zh", "en"] as const).map((lang) => {
                  const active = language === lang;
                  return (
                    <Pressable
                      key={lang}
                      onPress={() => handleSetLanguage(lang)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      className="flex-1 items-center justify-center rounded-xl min-h-[48px]"
                      style={active ? { backgroundColor: colors.primary } : undefined}
                    >
                      <Text className={active ? "font-semibold text-onPrimary" : "font-semibold text-foreground"}>
                        {lang === "zh" ? "中文" : "English"}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {/* 账户绑定 */}
            <View className="gap-3">
              <Text className="text-lg font-bold text-foreground">
                {t("settings.accountBinding")}
              </Text>

              <Pressable className="flex-row items-center justify-between bg-surface rounded-2xl p-4 active:opacity-80">
                <View className="flex-row items-center gap-3">
                  <MaterialIcons name="email" size={24} color={colors.primary} />
                  <View>
                    <Text className="font-semibold text-foreground">
                      {t("email")}
                    </Text>
                    <Text className="text-xs text-muted">{accountEmail || t("settings.notBound")}</Text>
                  </View>
                </View>
                <MaterialIcons name={accountEmail ? "check-circle" : "chevron-right"} size={24} color={accountEmail ? colors.success : colors.muted} />
              </Pressable>

              <Pressable
                onPress={() => (isAuthenticated ? setShowPasswordModal(true) : toast.warning(l("请先登录", "Please sign in first")))}
                accessibilityRole="button"
                className="flex-row items-center justify-between bg-surface rounded-2xl p-4 active:opacity-80 min-h-[56px]"
              >
                <View className="flex-row items-center gap-3 flex-1">
                  <MaterialIcons name="password" size={24} color={colors.primary} />
                  <View className="flex-1">
                    <Text className="font-semibold text-foreground">{t("password")}</Text>
                    <Text className="text-xs text-muted">
                      {passwordStatus.data?.hasPassword
                        ? l("已设置 · 点击修改", "Set · tap to change")
                        : passwordStatus.data
                          ? l(`当前通过 ${passwordStatus.data.loginMethod ?? "社交账号"} 登录 · 设置密码后可用邮箱登录`, `Signed in via ${passwordStatus.data.loginMethod ?? "social"} · set one to sign in with email`)
                          : t("settings.notBound")}
                    </Text>
                  </View>
                </View>
                <MaterialIcons name="chevron-right" size={24} color={colors.muted} />
              </Pressable>

              <Pressable className="flex-row items-center justify-between bg-surface rounded-2xl p-4 active:opacity-80">
                <View className="flex-row items-center gap-3">
                  <MaterialIcons name="phone" size={24} color={colors.primary} />
                  <View>
                    <Text className="font-semibold text-foreground">
                      {t("settings.phoneNumber")}
                    </Text>
                    <Text className="text-xs text-muted">
                      {t("settings.notBound")}
                    </Text>
                  </View>
                </View>
                <MaterialIcons name="chevron-right" size={24} color={colors.muted} />
              </Pressable>

              <Pressable className="flex-row items-center justify-between bg-surface rounded-2xl p-4 active:opacity-80">
                <View className="flex-row items-center gap-3">
                  <MaterialIcons name="account-circle" size={24} color={colors.primary} />
                  <View>
                    <Text className="font-semibold text-foreground">
                      {t("settings.socialAccounts")}
                    </Text>
                    <Text className="text-xs text-muted">
                      {t("settings.connectSocialMedia")}
                    </Text>
                  </View>
                </View>
                <MaterialIcons name="chevron-right" size={24} color={colors.muted} />
              </Pressable>
            </View>

            {/* 数据导出 */}
            <View className="gap-3">
              <Text className="text-lg font-bold text-foreground">
                {t("settings.dataExport")}
              </Text>

              <Pressable
                onPress={() => setShowExportModal(true)}
                className="flex-row items-center justify-between bg-surface rounded-2xl p-4 active:opacity-80"
              >
                <View className="flex-row items-center gap-3">
                  <MaterialIcons name="download" size={24} color={colors.primary} />
                  <View>
                    <Text className="font-semibold text-foreground">
                      {t("settings.exportData")}
                    </Text>
                    <Text className="text-xs text-muted">
                      {t("settings.downloadAllYourData")}
                    </Text>
                  </View>
                </View>
                <MaterialIcons name="chevron-right" size={24} color={colors.muted} />
              </Pressable>

              <View className="bg-surface rounded-2xl p-4 gap-3">
                <View className="flex-row items-center justify-between">
                  <View className="flex-row items-center gap-3 flex-1">
                    <MaterialIcons name="backup" size={24} color={colors.primary} />
                    <View className="flex-1">
                      <Text className="font-semibold text-foreground">{t("settings.autoBackup")}</Text>
                      <Text className="text-xs text-muted">
                        {autoBackup
                          ? l(`每周自动 · 下次约 ${formatWhen(backupStatus.data?.nextRunAt)}`, `Weekly · next ≈ ${formatWhen(backupStatus.data?.nextRunAt)}`)
                          : t("settings.autoBackupWeekly")}
                      </Text>
                    </View>
                  </View>
                  <Switch
                    value={autoBackup}
                    onValueChange={(v) => {
                      setPref({ autoBackup: v });
                      setTimeout(() => utils.backup.status.invalidate(), 500);
                    }}
                    trackColor={{ false: colors.border, true: colors.primary }}
                  />
                </View>

                {/* P10: 含媒体原文件 */}
                <View className="flex-row items-center justify-between pt-2 border-t border-border">
                  <View className="flex-1 pr-3">
                    <Text className="font-semibold text-foreground text-sm">{l("包含照片 / 视频原文件", "Include original photos / videos")}</Text>
                    <Text className="text-xs text-muted">
                      {includeMedia
                        ? l(`打包为 zip（上限 ${formatBytes(backupStatus.data?.zipMaxBytes ?? 0)}，超出的文件记录在清单中）`, `Packed as zip (cap ${formatBytes(backupStatus.data?.zipMaxBytes ?? 0)}; oversize files listed in manifest)`)
                        : l("仅元数据 JSON + 15 分钟下载链接", "Metadata JSON + 15-minute links only")}
                    </Text>
                  </View>
                  <Switch value={includeMedia} onValueChange={(v) => setPref({ backupIncludeMedia: v })} trackColor={{ false: colors.border, true: colors.primary }} />
                </View>

                {/* P10/P13: 云盘目标（可多个，并行同步） */}
                <Pressable
                  onPress={() => {
                    if (!isAuthenticated) return toast.warning(l("请先登录", "Please sign in first"));
                    setTargetKind("webdav");
                    setDavUrl("");
                    setDavUser("");
                    setDavPass("");
                    setS3Bucket("");
                    setS3Region("us-east-1");
                    setS3Prefix("");
                    setS3PathStyle(true);
                    setShowTargetModal(true);
                  }}
                  accessibilityRole="button"
                  className="flex-row items-center justify-between pt-2 border-t border-border min-h-[48px]"
                >
                  <View className="flex-row items-center gap-3 flex-1">
                    <MaterialIcons name={backupStatus.data?.targets?.length ? "cloud-done" : "cloud-queue"} size={22} color={colors.primary} />
                    <View className="flex-1">
                      <Text className="font-semibold text-foreground text-sm">{l("同步到云盘", "Copy to cloud")}{backupStatus.data?.targets?.length ? ` · ${backupStatus.data.targets.length} ${l("个目标", backupStatus.data.targets.length > 1 ? "targets" : "target")}` : ""}</Text>
                      <Text className="text-xs text-muted" numberOfLines={1}>{l("添加 WebDAV / S3 / Google Drive 目标；每次备份并行同步到所有已启用目标，失败自动重试", "Add WebDAV / S3 / Google Drive targets; each backup syncs to every enabled target in parallel, failures retry automatically")}</Text>
                    </View>
                  </View>
                  <MaterialIcons name="add-circle-outline" size={22} color={colors.primary} />
                </Pressable>
                {(backupStatus.data?.targets ?? []).map((tg) => {
                  const healthColor = tg.health === "ok" ? colors.success : tg.health === "down" ? colors.error : tg.health === "degraded" ? colors.warning : colors.muted;
                  return (
                    <View key={tg.id} className="flex-row items-center gap-2 pl-8 min-h-[44px]" style={{ opacity: tg.enabled ? 1 : 0.5 }}>
                      <View className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: healthColor }} />
                      <View className="flex-1">
                        <Text className="text-xs font-semibold text-foreground" numberOfLines={1}>{tg.label ?? l(tg.kindLabel.zh, tg.kindLabel.en)} <Text className="text-muted font-normal">· {l(tg.kindLabel.zh, tg.kindLabel.en)}</Text></Text>
                        <Text className="text-[10px] text-muted" numberOfLines={1}>
                          {tg.lastError ? tg.lastError : tg.lastSuccessAt ? l(`上次同步 ${formatWhen(tg.lastSuccessAt)}`, `Last sync ${formatWhen(tg.lastSuccessAt)}`) : tg.lastCheckedAt ? l(`巡检 ${formatWhen(tg.lastCheckedAt)}`, `Probed ${formatWhen(tg.lastCheckedAt)}`) : l("尚未同步", "Not synced yet")}
                        </Text>
                      </View>
                      <Pressable onPress={() => setTargetSettingsId(targetSettingsId === tg.id ? null : tg.id)} accessibilityLabel={l("保留与配额", "Retention & quota")} className="w-10 h-10 items-center justify-center"><MaterialIcons name="tune" size={18} color={targetSettingsId === tg.id ? colors.primary : colors.muted} /></Pressable>
                      <Pressable onPress={() => testTarget.mutate({ id: tg.id })} disabled={testTarget.isPending} accessibilityLabel={l("测试连接", "Test connection")} className="w-10 h-10 items-center justify-center"><MaterialIcons name="network-check" size={18} color={colors.primary} /></Pressable>
                      <Switch value={tg.enabled} onValueChange={(v) => updateTarget.mutate({ id: tg.id, enabled: v })} trackColor={{ false: colors.border, true: colors.primary }} />
                      <Pressable onPress={() => removeTarget.mutate({ id: tg.id })} accessibilityLabel={l("删除目标", "Remove target")} className="w-10 h-10 items-center justify-center"><MaterialIcons name="delete-outline" size={18} color={colors.error} /></Pressable>
                    </View>
                  );
                })}
                {/* P14: per-target retention / quota / storage class */}
                {(backupStatus.data?.targets ?? []).filter((tg) => tg.id === targetSettingsId).map((tg) => {
                  const pct = tg.quotaBytes && tg.usedBytes != null ? Math.min(100, Math.round((tg.usedBytes / tg.quotaBytes) * 100)) : null;
                  return (
                    <View key={`cfg-${tg.id}`} className="ml-8 bg-background rounded-2xl p-3 gap-2">
                      <View className="flex-row items-center justify-between">
                        <Text className="text-xs font-semibold text-foreground">{l("云端占用", "Cloud usage")}</Text>
                        <Pressable onPress={() => targetQuota.mutate({ id: tg.id })} disabled={targetQuota.isPending} accessibilityRole="button" className="rounded-full px-3 min-h-[32px] justify-center bg-surface">
                          {targetQuota.isPending ? <ActivityIndicator size="small" color={colors.primary} /> : <Text className="text-xs font-semibold text-primary">{l("刷新", "Refresh")}</Text>}
                        </Pressable>
                      </View>
                      <Text className="text-xs text-muted">
                        {tg.usedBytes != null ? l(`备份占用 ${formatBytes(tg.usedBytes)}`, `Backups use ${formatBytes(tg.usedBytes)}`) : l("尚未统计", "Not measured yet")}
                        {tg.quotaBytes ? l(` · 总配额 ${formatBytes(tg.quotaBytes)}${pct != null ? `（${pct}%）` : ""}`, ` · quota ${formatBytes(tg.quotaBytes)}${pct != null ? ` (${pct}%)` : ""}`) : tg.kind === "s3" ? l(" · S3 无总配额", " · S3 has no hard quota") : ""}
                        {tg.estMonthlyUsd != null ? l(` · 约 $${tg.estMonthlyUsd}/月`, ` · ≈ $${tg.estMonthlyUsd}/mo`) : ""}
                      </Text>
                      {pct != null && (
                        <View className="h-2 rounded-full bg-border overflow-hidden">
                          <View className="h-2 rounded-full" style={{ width: `${pct}%`, backgroundColor: pct >= 90 ? colors.error : colors.primary }} />
                        </View>
                      )}
                      <View className="flex-row items-center justify-between">
                        <Text className="text-xs text-foreground">{l("只保留最近", "Keep newest")}</Text>
                        <View className="flex-row items-center gap-1">
                          {[null, 3, 5, 10, 20].map((n) => (
                            <Pressable key={String(n)} onPress={() => updateTarget.mutate({ id: tg.id, keepCount: n })} accessibilityRole="button" accessibilityState={{ selected: tg.keepCount === n }} className="rounded-full px-2.5 min-h-[32px] justify-center" style={{ backgroundColor: tg.keepCount === n ? colors.primary : colors.surface }}>
                              <Text className="text-[11px] font-semibold" style={{ color: tg.keepCount === n ? colors.onPrimary : colors.foreground }}>{n === null ? l("全部", "All") : `${n}`}</Text>
                            </Pressable>
                          ))}
                          {tg.keepCount && (
                            <Pressable onPress={() => pruneTarget.mutate({ id: tg.id })} disabled={pruneTarget.isPending} accessibilityLabel={l("立即清理", "Prune now")} className="w-8 h-8 items-center justify-center"><MaterialIcons name="cleaning-services" size={16} color={colors.primary} /></Pressable>
                          )}
                        </View>
                      </View>
                      {tg.kind === "s3" && (
                        <View className="gap-1">
                          <Text className="text-xs text-foreground">{l("存储类别（冷归档更便宜，取回更慢）", "Storage class (colder = cheaper, slower to retrieve)")}</Text>
                          <View className="flex-row flex-wrap gap-1">
                            {(backupStatus.data?.storageClasses ?? []).map((cls) => {
                              const on = (tg.storageClass ?? "STANDARD") === cls;
                              return (
                                <Pressable key={cls} onPress={() => updateTarget.mutate({ id: tg.id, storageClass: cls === "STANDARD" ? null : cls })} accessibilityRole="button" accessibilityState={{ selected: on }} className="rounded-full px-2.5 min-h-[30px] justify-center" style={{ backgroundColor: on ? colors.primary : colors.surface }}>
                                  <Text className="text-[10px] font-semibold" style={{ color: on ? colors.onPrimary : colors.foreground }}>{cls.replace(/_/g, " ")}</Text>
                                </Pressable>
                              );
                            })}
                          </View>
                        </View>
                      )}
                      {/* P15: copy this target's backups to another target */}
                      {(backupStatus.data?.targets ?? []).filter((o) => o.id !== tg.id).length > 0 && (
                        <View className="gap-1 pt-1 border-t border-border">
                          <View className="flex-row items-center justify-between">
                            <Text className="text-xs text-foreground">{l("复制历史备份到…", "Copy backups to…")}</Text>
                            <Pressable onPress={() => { setCopyFromId(copyFromId === tg.id ? null : tg.id); setCopyToId(null); setCopyClass(null); }} accessibilityRole="button" className="rounded-full px-3 min-h-[32px] justify-center bg-surface">
                              <Text className="text-xs font-semibold text-primary">{copyFromId === tg.id ? l("收起", "Hide") : l("选择目标", "Choose")}</Text>
                            </Pressable>
                          </View>
                          {copyFromId === tg.id && (
                            <View className="gap-2">
                              <View className="flex-row flex-wrap gap-1">
                                {(backupStatus.data?.targets ?? []).filter((o) => o.id !== tg.id).map((o) => (
                                  <Pressable key={o.id} onPress={() => { setCopyToId(o.id); setCopyClass(null); }} accessibilityRole="button" accessibilityState={{ selected: copyToId === o.id }} className="rounded-full px-2.5 min-h-[32px] justify-center" style={{ backgroundColor: copyToId === o.id ? colors.primary : colors.surface }}>
                                    <Text className="text-[11px] font-semibold" style={{ color: copyToId === o.id ? colors.onPrimary : colors.foreground }}>{o.label ?? o.kind} · {o.kind}</Text>
                                  </Pressable>
                                ))}
                              </View>
                              {copyToId !== null && backupStatus.data?.targets?.find((o) => o.id === copyToId)?.kind === "s3" && (
                                <View className="flex-row flex-wrap gap-1">
                                  {(backupStatus.data?.storageClasses ?? []).map((cls) => {
                                    const on = (copyClass ?? backupStatus.data?.targets?.find((o) => o.id === copyToId)?.storageClass ?? "STANDARD") === cls;
                                    return (
                                      <Pressable key={cls} onPress={() => setCopyClass(cls)} accessibilityRole="button" accessibilityState={{ selected: on }} className="rounded-full px-2 min-h-[28px] justify-center" style={{ backgroundColor: on ? colors.primary : colors.surface }}>
                                        <Text className="text-[10px] font-semibold" style={{ color: on ? colors.onPrimary : colors.foreground }}>{cls.replace(/_/g, " ")}</Text>
                                      </Pressable>
                                    );
                                  })}
                                </View>
                              )}
                              <Pressable onPress={() => copyToId && copyTarget.mutate({ fromTargetId: tg.id, toTargetId: copyToId, storageClass: (copyClass ?? undefined) as never })} disabled={!copyToId || copyTarget.isPending} accessibilityRole="button" className="rounded-full min-h-[40px] items-center justify-center" style={{ backgroundColor: colors.primary, opacity: !copyToId || copyTarget.isPending ? 0.5 : 1 }}>
                                <Text className="text-xs font-semibold" style={{ color: colors.onPrimary }}>{copyTarget.isPending ? l("启动中…", "Starting…") : l("开始复制（后台 · 逐文件校验）", "Start copy (background · verified per file)")}</Text>
                              </Pressable>
                              {copyJob.data && copyJob.data.fromTargetId === tg.id && (
                                <View className="gap-1">
                                  <View className="flex-row items-center justify-between">
                                    <Text className="text-[11px] text-muted">
                                      {copyJob.data.status === "running" ? l("复制中", "Copying") : copyJob.data.status === "queued" ? l("排队中", "Queued") : copyJob.data.status === "completed" ? l("已完成", "Done") : copyJob.data.status === "cancelled" ? l("已取消", "Cancelled") : l("失败", "Failed")} · {copyJob.data.done}/{copyJob.data.total}{copyJob.data.failed ? l(` · 失败 ${copyJob.data.failed}`, ` · ${copyJob.data.failed} failed`) : ""} · {formatBytes(copyJob.data.bytes)}
                                    </Text>
                                    {(copyJob.data.status === "running" || copyJob.data.status === "queued") && (
                                      <Pressable onPress={() => cancelCopy.mutate({ jobId: copyJob.data!.id })} accessibilityRole="button" className="min-h-[28px] justify-center"><Text className="text-[11px] font-semibold" style={{ color: colors.error }}>{l("取消", "Cancel")}</Text></Pressable>
                                    )}
                                  </View>
                                  <View className="h-2 rounded-full bg-border overflow-hidden"><View className="h-2 rounded-full" style={{ width: `${copyJob.data.progress}%`, backgroundColor: copyJob.data.status === "failed" ? colors.error : colors.primary }} /></View>
                                  {copyJob.data.results.slice(-3).map((r) => (
                                    <Text key={r.key} className="text-[10px] text-muted" numberOfLines={1}>{r.ok ? (r.verified === null ? "☑" : r.verified ? "✓" : "✗") : "✗"} {r.name}{r.error ? ` · ${r.error}` : r.verified === null ? l(" · 冷归档，按大小校验", " · cold class, size check") : ""}</Text>
                                  ))}
                                  {copyJob.data.error && <Text className="text-[10px]" style={{ color: colors.error }}>{copyJob.data.error}</Text>}
                                </View>
                              )}
                              {!copyJob.data && (copyJobs.data ?? []).filter((j) => j.fromTargetId === tg.id).slice(0, 2).map((j) => (
                                <Pressable key={j.id} onPress={() => setCopyJobId(j.id)} accessibilityRole="button" className="min-h-[32px] justify-center"><Text className="text-[10px] text-muted">{new Date(j.createdAt).toLocaleString()} · {j.status} · {j.done}/{j.total}</Text></Pressable>
                              ))}
                            </View>
                          )}
                        </View>
                      )}
                    </View>
                  );
                })}

                {/* P12: 云端历史 */}
                {isAuthenticated && !!backupStatus.data?.targets?.length && (
                  <Pressable onPress={() => { setCloudTargetId(backupStatus.data?.targets?.find((x) => x.enabled)?.id ?? backupStatus.data?.targets?.[0]?.id ?? null); setShowCloudModal(true); }} accessibilityRole="button" className="flex-row items-center justify-between pt-2 border-t border-border min-h-[48px]">
                    <View className="flex-row items-center gap-3 flex-1">
                      <MaterialIcons name="cloud-download" size={22} color={colors.primary} />
                      <View className="flex-1">
                        <Text className="font-semibold text-foreground text-sm">{l("云端备份历史", "Cloud backup history")}</Text>
                        <Text className="text-xs text-muted">{l("查看云盘上的备份并一键回拉恢复", "Browse backups on the cloud target and restore directly")}</Text>
                      </View>
                    </View>
                    <MaterialIcons name="chevron-right" size={22} color={colors.muted} />
                  </Pressable>
                )}

                {isAuthenticated && (
                  <>
                    <View className="flex-row items-center justify-between pt-2 border-t border-border">
                      <Text className="text-xs text-muted">
                        {backupStatus.data?.lastBackupAt
                          ? l(`上次备份 ${formatWhen(backupStatus.data.lastBackupAt)} · ${backupStatus.data.lastItemCount} 条`, `Last backup ${formatWhen(backupStatus.data.lastBackupAt)} · ${backupStatus.data.lastItemCount} items`)
                          : l("还没有备份", "No backups yet")}
                      </Text>
                      <Pressable
                        onPress={() => runBackup.mutate({ language: l("zh", "en") as "zh" | "en" })}
                        disabled={runBackup.isPending}
                        accessibilityRole="button"
                        className="flex-row items-center gap-1 rounded-full px-3 min-h-[40px]"
                        style={{ backgroundColor: `${colors.primary}22` }}
                      >
                        {runBackup.isPending ? <ActivityIndicator size="small" color={colors.primary} /> : <MaterialIcons name="cloud-upload" size={18} color={colors.primary} />}
                        <Text className="text-sm font-semibold text-primary">{l("立即备份", "Back up now")}</Text>
                      </Pressable>
                    </View>
                    {(backupList.data ?? []).map((b) => (
                      <View key={b.id} className="flex-row items-center justify-between">
                        <View className="flex-1">
                          <Text className="text-xs text-foreground">{formatWhen(b.createdAt)}</Text>
                          <Text className="text-[10px] text-muted">
                            {b.itemCount} {l("条", "items")} · {formatBytes(b.bytes)} · {b.format === "zip" ? "zip" : "json"} · {b.trigger === "scheduled" ? l("自动", "scheduled") : l("手动", "manual")}{b.remoteStatus === "uploaded" ? l(" · 已同步云盘", " · cloud") : b.remoteStatus === "failed" ? l(" · 云盘失败", " · cloud failed") : ""}
                          </Text>
                        </View>
                        <Pressable
                          onPress={() => openRestore({ backupId: b.id, label: formatWhen(b.createdAt) })}
                          accessibilityLabel={l("从此备份恢复", "Restore from this backup")}
                          className="min-w-[44px] min-h-[44px] items-center justify-center"
                        >
                          <MaterialIcons name="settings-backup-restore" size={20} color={colors.primary} />
                        </Pressable>
                        <Pressable
                          onPress={() => downloadBackup.mutate({ id: b.id })}
                          disabled={downloadBackup.isPending}
                          accessibilityLabel={l("下载备份", "Download backup")}
                          className="min-w-[44px] min-h-[44px] items-center justify-center"
                        >
                          <MaterialIcons name="download" size={20} color={colors.primary} />
                        </Pressable>
                      </View>
                    ))}
                    {/* P11: 从文件导入 */}
                    <Pressable
                      onPress={pickImportFile}
                      disabled={restoreUploading || backupStatus.data?.storageConfigured === false}
                      accessibilityRole="button"
                      className="flex-row items-center gap-2 pt-2 border-t border-border min-h-[44px]"
                      style={{ opacity: backupStatus.data?.storageConfigured === false ? 0.5 : 1 }}
                    >
                      {restoreUploading ? <ActivityIndicator size="small" color={colors.primary} /> : <MaterialIcons name="upload-file" size={20} color={colors.primary} />}
                      <Text className="text-sm font-semibold text-primary">{l("从备份文件导入（zip / json）", "Import from a backup file (zip / json)")}</Text>
                    </Pressable>
                    {backupStatus.data && !backupStatus.data.mailConfigured && (
                      <Text className="text-[10px] text-muted">{l("提示：未配置邮件服务（RESEND_API_KEY / SMTP_URL），备份完成后不会发送邮件摘要。", "Note: mail isn't configured (RESEND_API_KEY / SMTP_URL) — no email summary will be sent.")}</Text>
                    )}
                  </>
                )}
              </View>
            </View>

            {/* 关于和帮助 */}
            <View className="gap-3">
              {me.data?.role === "admin" && (
                <Pressable onPress={() => router.push("/ops" as never)} accessibilityRole="button" className="flex-row items-center justify-between bg-surface rounded-2xl p-4 active:opacity-80 min-h-[56px]">
                  <View className="flex-row items-center gap-3">
                    <MaterialIcons name="admin-panel-settings" size={24} color={colors.primary} />
                    <View>
                      <Text className="font-semibold text-foreground">{l("运维面板", "Ops panel")}</Text>
                      <Text className="text-xs text-muted">{l("邮件 / 短信 / 推送 / Redis 状态与一键测试", "Mail / SMS / push / Redis status + one-tap tests")}</Text>
                    </View>
                  </View>
                  <MaterialIcons name="chevron-right" size={24} color={colors.muted} />
                </Pressable>
              )}
              <Pressable className="flex-row items-center justify-between bg-surface rounded-2xl p-4 active:opacity-80">
                <View className="flex-row items-center gap-3">
                  <MaterialIcons name="help" size={24} color={colors.primary} />
                  <View>
                    <Text className="font-semibold text-foreground">
                      {t("common.helpFeedback")}
                    </Text>
                  </View>
                </View>
                <MaterialIcons name="chevron-right" size={24} color={colors.muted} />
              </Pressable>

              <Pressable className="flex-row items-center justify-between bg-surface rounded-2xl p-4 active:opacity-80">
                <View className="flex-row items-center gap-3">
                  <MaterialIcons name="info" size={24} color={colors.primary} />
                  <View>
                    <Text className="font-semibold text-foreground">
                      {t("common.aboutApp")}
                    </Text>
                    <Text className="text-xs text-muted">v1.0.0</Text>
                  </View>
                </View>
                <MaterialIcons name="chevron-right" size={24} color={colors.muted} />
              </Pressable>
            </View>
          </View>
        </View>
      </ScrollView>

      {/* 导出数据模态框 */}
      <Modal
        visible={showExportModal}
        onRequestClose={() => setShowExportModal(false)}
        transparent
        animationType="fade"
      >
        <View className="flex-1 bg-black/50 items-center justify-center p-6">
          <View className="bg-background rounded-3xl p-6 w-full gap-4">
            <Text className="text-2xl font-bold text-foreground">
              {t("settings.exportData")}
            </Text>

            <View className="gap-3">
              <Pressable
                onPress={() => exportData.mutate({ format: "csv", includeLinks: true })}
                disabled={exportData.isPending}
                accessibilityRole="button"
                className="bg-surface rounded-2xl p-4 active:opacity-80 min-h-[64px]"
              >
                <Text className="font-semibold text-foreground">{l("CSV + 下载链接", "CSV + download links")}</Text>
                <Text className="text-xs text-muted mt-1">{l("全部照片 / 视频元数据，附 15 分钟有效的下载链接", "All photo / video metadata with 15-minute download links")}</Text>
              </Pressable>

              <Pressable
                onPress={() => exportData.mutate({ format: "csv", includeLinks: false })}
                disabled={exportData.isPending}
                accessibilityRole="button"
                className="bg-surface rounded-2xl p-4 active:opacity-80 min-h-[64px]"
              >
                <Text className="font-semibold text-foreground">{t("settings.exportAsCsv")}</Text>
                <Text className="text-xs text-muted mt-1">{t("settings.exportMetadataOnly")}</Text>
              </Pressable>

              <Pressable
                onPress={() => exportData.mutate({ format: "json", includeLinks: true })}
                disabled={exportData.isPending}
                accessibilityRole="button"
                className="bg-surface rounded-2xl p-4 active:opacity-80 min-h-[64px]"
              >
                <Text className="font-semibold text-foreground">JSON</Text>
                <Text className="text-xs text-muted mt-1">{l("结构化数据，便于迁移到其他服务", "Structured data for migrating to another service")}</Text>
              </Pressable>
              {exportData.isPending && <ActivityIndicator color={colors.primary} />}
            </View>

            <Pressable
              onPress={() => setShowExportModal(false)}
              className="bg-surface rounded-full py-3 items-center justify-center active:opacity-80"
            >
              <Text className="font-semibold text-foreground">
                {t("close")}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* P9: 邮箱验证码 */}
      <Modal visible={showVerifyModal} onRequestClose={() => setShowVerifyModal(false)} transparent animationType="fade">
        <View className="flex-1 bg-black/50 items-center justify-center p-6">
          <View className="bg-background rounded-3xl p-6 w-full gap-4">
            <Text className="text-2xl font-bold text-foreground">{l("验证邮箱", "Verify email")}</Text>
            <Text className="text-sm text-muted">{l(`已向 ${accountEmail} 发送 6 位验证码，10 分钟内有效。`, `We sent a 6-digit code to ${accountEmail} (valid 10 min).`)}</Text>
            <TextInput
              value={verifyCode}
              onChangeText={(v) => setVerifyCode(v.replace(/\D/g, "").slice(0, 6))}
              keyboardType="number-pad"
              maxLength={6}
              autoFocus
              placeholder="000000"
              placeholderTextColor={colors.muted}
              className="bg-surface rounded-2xl px-4 min-h-[60px] text-foreground text-center font-mono"
              style={{ fontSize: 28, letterSpacing: 12 }}
            />
            <View className="flex-row gap-3">
              <Pressable onPress={() => setShowVerifyModal(false)} className="flex-1 bg-surface rounded-full min-h-[48px] items-center justify-center" accessibilityRole="button">
                <Text className="font-semibold text-foreground">{t("cancel")}</Text>
              </Pressable>
              <Pressable
                onPress={() => verifyCode.length === 6 && verifyEmail.mutate({ code: verifyCode })}
                disabled={verifyEmail.isPending || verifyCode.length !== 6}
                className="flex-1 rounded-full min-h-[48px] items-center justify-center"
                style={{ backgroundColor: verifyCode.length === 6 ? colors.primary : colors.border }}
                accessibilityRole="button"
              >
                {verifyEmail.isPending ? <ActivityIndicator color={colors.onPrimary} /> : <Text className="font-semibold text-onPrimary">{l("验证", "Verify")}</Text>}
              </Pressable>
            </View>
            <Pressable onPress={() => requestVerify.mutate({ language: l("zh", "en") as "zh" | "en" })} disabled={requestVerify.isPending} className="min-h-[40px] items-center justify-center" accessibilityRole="button">
              <Text className="text-sm text-primary font-semibold">{l("重新发送", "Resend")}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* P10: 绑定手机号 */}
      <Modal visible={showPhoneModal} onRequestClose={() => setShowPhoneModal(false)} transparent animationType="fade">
        <View className="flex-1 bg-black/50 items-center justify-center p-6">
          <View className="bg-background rounded-3xl p-6 w-full gap-4">
            <Text className="text-2xl font-bold text-foreground">{phoneStep === "number" ? l("绑定手机号", "Link phone number") : l("输入短信验证码", "Enter SMS code")}</Text>
            {phoneStep === "number" ? (
              <>
                <Text className="text-sm text-muted">{l("请使用国际格式，例如 +86 138 0013 8000。验证后可选择用短信接收验证码。", "Use international format, e.g. +86 138 0013 8000. Once verified you can receive codes by SMS.")}</Text>
                <TextInput
                  value={phoneInput}
                  onChangeText={setPhoneInput}
                  keyboardType="phone-pad"
                  autoFocus
                  placeholder="+86 138 0013 8000"
                  placeholderTextColor={colors.muted}
                  className="bg-surface rounded-2xl px-4 min-h-[52px] text-foreground"
                />
                <View className="flex-row gap-3">
                  <Pressable onPress={() => setShowPhoneModal(false)} className="flex-1 bg-surface rounded-full min-h-[48px] items-center justify-center" accessibilityRole="button">
                    <Text className="font-semibold text-foreground">{t("cancel")}</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => requestPhone.mutate({ phone: phoneInput, language: l("zh", "en") as "zh" | "en" })}
                    disabled={requestPhone.isPending || phoneInput.trim().length < 8}
                    className="flex-1 rounded-full min-h-[48px] items-center justify-center"
                    style={{ backgroundColor: phoneInput.trim().length >= 8 ? colors.primary : colors.border }}
                    accessibilityRole="button"
                  >
                    {requestPhone.isPending ? <ActivityIndicator color={colors.onPrimary} /> : <Text className="font-semibold text-onPrimary">{l("发送验证码", "Send code")}</Text>}
                  </Pressable>
                </View>
                {security.data?.phone && (
                  <Pressable onPress={() => { removePhone.mutate(); setShowPhoneModal(false); }} className="min-h-[40px] items-center justify-center" accessibilityRole="button">
                    <Text className="text-sm text-error font-semibold">{l("移除已绑定的手机号", "Remove linked phone")}</Text>
                  </Pressable>
                )}
              </>
            ) : (
              <>
                <TextInput
                  value={phoneCode}
                  onChangeText={(v) => setPhoneCode(v.replace(/\D/g, "").slice(0, 6))}
                  keyboardType="number-pad"
                  maxLength={6}
                  autoFocus
                  placeholder="000000"
                  placeholderTextColor={colors.muted}
                  className="bg-surface rounded-2xl px-4 min-h-[60px] text-foreground text-center font-mono"
                  style={{ fontSize: 28, letterSpacing: 12 }}
                />
                <View className="flex-row gap-3">
                  <Pressable onPress={() => setPhoneStep("number")} className="flex-1 bg-surface rounded-full min-h-[48px] items-center justify-center" accessibilityRole="button">
                    <Text className="font-semibold text-foreground">{l("返回", "Back")}</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => phoneCode.length === 6 && verifyPhone.mutate({ code: phoneCode })}
                    disabled={verifyPhone.isPending || phoneCode.length !== 6}
                    className="flex-1 rounded-full min-h-[48px] items-center justify-center"
                    style={{ backgroundColor: phoneCode.length === 6 ? colors.primary : colors.border }}
                    accessibilityRole="button"
                  >
                    {verifyPhone.isPending ? <ActivityIndicator color={colors.onPrimary} /> : <Text className="font-semibold text-onPrimary">{l("验证", "Verify")}</Text>}
                  </Pressable>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* P10: WebDAV 云盘目标 */}
      <Modal visible={showTargetModal} onRequestClose={() => setShowTargetModal(false)} transparent animationType="fade">
        <View className="flex-1 bg-black/50 items-center justify-center p-6">
          <View className="bg-background rounded-3xl p-6 w-full gap-3">
            <Text className="text-2xl font-bold text-foreground">{l("同步到云盘", "Cloud target")}</Text>
            <View className="flex-row bg-surface rounded-full p-1">
              {(["webdav", "s3", "gdrive"] as const).map((k) => (
                <Pressable key={k} onPress={() => setTargetKind(k)} accessibilityRole="button" accessibilityState={{ selected: targetKind === k }} className="flex-1 rounded-full min-h-[40px] items-center justify-center" style={{ backgroundColor: targetKind === k ? colors.primary : "transparent" }}>
                  <Text className={targetKind === k ? "font-semibold text-onPrimary text-xs" : "font-semibold text-foreground text-xs"}>{k === "webdav" ? "WebDAV" : k === "s3" ? "S3" : "Google Drive"}</Text>
                </Pressable>
              ))}
            </View>
            {targetKind === "webdav" && (
              <>
                <Text className="text-sm text-muted">{l("填写 WebDAV 文件夹地址与应用密码（坚果云 / Nextcloud / 群晖）。每次备份会额外上传到该文件夹下的 GoldenMemory/。", "WebDAV folder URL + app password (Nutstore / Nextcloud / Synology). Each backup is also uploaded to GoldenMemory/ there.")}</Text>
                <TextInput value={davUrl} onChangeText={setDavUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="https://dav.jianguoyun.com/dav/" placeholderTextColor={colors.muted} className="bg-surface rounded-2xl px-4 min-h-[48px] text-foreground" />
                <TextInput value={davUser} onChangeText={setDavUser} autoCapitalize="none" autoCorrect={false} placeholder={l("账号 / 邮箱", "Username / email")} placeholderTextColor={colors.muted} className="bg-surface rounded-2xl px-4 min-h-[48px] text-foreground" />
                <TextInput value={davPass} onChangeText={setDavPass} secureTextEntry placeholder={l("应用密码", "App password")} placeholderTextColor={colors.muted} className="bg-surface rounded-2xl px-4 min-h-[48px] text-foreground" />
              </>
            )}
            {targetKind === "s3" && (
              <>
                <Text className="text-sm text-muted">{l("任意 S3 兼容对象存储：AWS / MinIO / Cloudflare R2 / Backblaze B2 / 阿里云 OSS / 腾讯云 COS。", "Any S3-compatible bucket: AWS / MinIO / Cloudflare R2 / Backblaze B2 / Aliyun OSS / Tencent COS.")}</Text>
                <TextInput value={davUrl} onChangeText={setDavUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder={l("端点，如 https://s3.us-east-1.amazonaws.com", "Endpoint, e.g. https://s3.us-east-1.amazonaws.com")} placeholderTextColor={colors.muted} className="bg-surface rounded-2xl px-4 min-h-[48px] text-foreground" />
                <View className="flex-row gap-2">
                  <TextInput value={s3Bucket} onChangeText={setS3Bucket} autoCapitalize="none" autoCorrect={false} placeholder="bucket" placeholderTextColor={colors.muted} className="flex-1 bg-surface rounded-2xl px-4 min-h-[48px] text-foreground" />
                  <TextInput value={s3Region} onChangeText={setS3Region} autoCapitalize="none" autoCorrect={false} placeholder="region" placeholderTextColor={colors.muted} className="w-28 bg-surface rounded-2xl px-4 min-h-[48px] text-foreground" />
                </View>
                <TextInput value={davUser} onChangeText={setDavUser} autoCapitalize="none" autoCorrect={false} placeholder="Access Key ID" placeholderTextColor={colors.muted} className="bg-surface rounded-2xl px-4 min-h-[48px] text-foreground" />
                <TextInput value={davPass} onChangeText={setDavPass} secureTextEntry placeholder="Secret Access Key" placeholderTextColor={colors.muted} className="bg-surface rounded-2xl px-4 min-h-[48px] text-foreground" />
                <View className="flex-row gap-2 items-center">
                  <TextInput value={s3Prefix} onChangeText={setS3Prefix} autoCapitalize="none" autoCorrect={false} placeholder={l("前缀（可选）", "Prefix (optional)")} placeholderTextColor={colors.muted} className="flex-1 bg-surface rounded-2xl px-4 min-h-[48px] text-foreground" />
                  <Text className="text-xs text-muted">path-style</Text>
                  <Switch value={s3PathStyle} onValueChange={setS3PathStyle} trackColor={{ false: colors.border, true: colors.primary }} />
                </View>
              </>
            )}
            {targetKind === "gdrive" && (
              <Text className="text-sm text-muted">
                {gdriveAuth.data?.configured === false
                  ? l("服务器未配置 Google Drive（需设置 GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET）。", "Google Drive is not configured on this server (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).")
                  : l("点击「连接 Google Drive」完成授权（仅申请 drive.file 权限，只能访问本应用创建的文件）。备份将放入 GoldenMemory 文件夹。", "Tap “Connect Google Drive” to authorize (drive.file scope only — the app can only see files it created). Backups go to a GoldenMemory folder.")}
              </Text>
            )}
            <View className="flex-row gap-3">
              <Pressable onPress={() => setShowTargetModal(false)} className="flex-1 bg-surface rounded-full min-h-[48px] items-center justify-center" accessibilityRole="button">
                <Text className="font-semibold text-foreground">{t("cancel")}</Text>
              </Pressable>
              <Pressable
                onPress={submitTarget}
                disabled={setTarget.isPending || (targetKind === "webdav" && (!davUrl || !davUser || !davPass)) || (targetKind === "s3" && (!davUrl || !davUser || !davPass || !s3Bucket)) || (targetKind === "gdrive" && gdriveAuth.data?.configured === false)}
                className="flex-1 rounded-full min-h-[48px] items-center justify-center flex-row gap-1"
                style={{ backgroundColor: colors.primary, opacity: setTarget.isPending ? 0.7 : 1 }}
                accessibilityRole="button"
              >
                {setTarget.isPending ? <ActivityIndicator color={colors.onPrimary} /> : <Text className="font-semibold text-onPrimary">{targetKind === "gdrive" ? l("连接 Google Drive", "Connect Google Drive") : l("测试并保存", "Test & save")}</Text>}
              </Pressable>
            </View>

          </View>
        </View>
      </Modal>

      {/* P11: 从备份恢复 */}
      <Modal visible={showRestoreModal} onRequestClose={() => setShowRestoreModal(false)} transparent animationType="fade">
        <View className="flex-1 bg-black/50 items-center justify-center p-6">
          <View className="bg-background rounded-3xl p-6 w-full gap-3">
            <Text className="text-2xl font-bold text-foreground">{l("从备份恢复", "Restore from backup")}</Text>
            <Text className="text-sm text-muted">{l(`来源：${restoreSource?.label ?? ""} → 家庭「${family?.name ?? ""}」`, `Source: ${restoreSource?.label ?? ""} → family “${family?.name ?? ""}”`)}</Text>
            {restorePlan.isPending && <ActivityIndicator color={colors.primary} />}
            {restorePlan.data && (
              <View className="bg-surface rounded-2xl p-3 gap-1">
                <Text className="text-sm text-foreground">{l(`格式 ${restorePlan.data.format} · 导出于 ${restorePlan.data.exportedAt ? new Date(restorePlan.data.exportedAt).toLocaleDateString() : "—"}`, `Format ${restorePlan.data.format} · exported ${restorePlan.data.exportedAt ? new Date(restorePlan.data.exportedAt).toLocaleDateString() : "—"}`)}</Text>
                <Text className="text-sm text-foreground">{l(`${restorePlan.data.totalItems} 条记录：${restorePlan.data.withFiles} 条含文件，${restorePlan.data.withoutFiles} 条仅元数据，${restorePlan.data.alreadyRestored} 条已恢复过（将跳过）`, `${restorePlan.data.totalItems} items: ${restorePlan.data.withFiles} with files, ${restorePlan.data.withoutFiles} metadata-only, ${restorePlan.data.alreadyRestored} already restored (skipped)`)}</Text>
                {/* P13: 冲突策略 + 哈希去重 */}
                <Text className="text-xs text-muted mt-1">{l("同名相册已存在时：", "When an album with the same name exists:")}</Text>
                <View className="flex-row bg-background rounded-full p-1">
                  {(["merge", "copy", "skip"] as const).map((v) => (
                    <Pressable key={v} onPress={() => replan({ albumConflict: v })} accessibilityRole="button" accessibilityState={{ selected: albumConflict === v }} className="flex-1 rounded-full min-h-[34px] items-center justify-center" style={{ backgroundColor: albumConflict === v ? colors.primary : "transparent" }}>
                      <Text className="text-xs font-semibold" style={{ color: albumConflict === v ? colors.onPrimary : colors.foreground }}>{v === "merge" ? l("并入", "Merge") : v === "copy" ? l("新建副本", "Copy") : l("跳过", "Skip")}</Text>
                    </Pressable>
                  ))}
                </View>
                <Pressable onPress={() => replan({ dedupeByHash: !dedupeByHash })} accessibilityRole="checkbox" accessibilityState={{ checked: dedupeByHash }} className="flex-row items-center gap-2 min-h-[36px]">
                  <MaterialIcons name={dedupeByHash ? "check-box" : "check-box-outline-blank"} size={20} color={dedupeByHash ? colors.primary : colors.muted} />
                  <Text className="text-xs text-foreground flex-1">{l("按内容哈希去重（并入时跳过家庭里已有的同一文件）", "De-duplicate by content hash (skip files the family already has when merging)")}</Text>
                </Pressable>
                <Text className="text-xs text-foreground mt-1">
                  {l(`将导入 ${restorePlan.data.willImport} 条`, `Will import ${restorePlan.data.willImport}`)}
                  {restorePlan.data.duplicateByHash ? l(` · ${restorePlan.data.duplicateByHash} 条哈希重复`, ` · ${restorePlan.data.duplicateByHash} duplicate by hash`) : ""}
                  {restorePlan.data.skippedByStrategy ? l(` · ${restorePlan.data.skippedByStrategy} 条因策略跳过`, ` · ${restorePlan.data.skippedByStrategy} skipped by strategy`) : ""}
                </Text>
                <Text className="text-xs text-muted mt-1">{l("勾选要恢复的相册（默认全部），右侧为差异预览：", "Pick albums to restore (all by default); diff preview on the right:")}</Text>
                {restorePlan.data.albums.map((a) => {
                  const on = selectedAlbums === null || selectedAlbums.includes(a.name);
                  return (
                    <Pressable
                      key={a.name}
                      onPress={() => {
                        const all = restorePlan.data!.albums.map((x) => x.name);
                        const cur = selectedAlbums ?? all;
                        const next = on ? cur.filter((n) => n !== a.name) : [...cur, a.name];
                        setSelectedAlbums(next.length === all.length ? null : next);
                      }}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}
                      className="flex-row items-center gap-2 min-h-[36px]"
                    >
                      <MaterialIcons name={on ? "check-box" : "check-box-outline-blank"} size={20} color={on ? colors.primary : colors.muted} />
                      <Text className={on ? "text-xs text-foreground flex-1" : "text-xs text-muted flex-1"} numberOfLines={2}>
                        {a.action === "create" ? "+" : a.action === "merge" ? "↻" : a.action === "copy" ? "⧉" : "−"} {a.name} · {a.items} {l("条", "items")}
                        {a.action === "create" ? l("（新建）", " (new)") : a.action === "merge" ? l(`（并入现有 ${a.existingItems} 条）`, ` (merge into ${a.existingItems})`) : a.action === "copy" ? l(`（新建「${a.targetName}」）`, ` (new “${a.targetName}”)`) : l("（跳过）", " (skip)")}
                      </Text>
                      <Text className="text-[10px] text-muted">{a.duplicate ? l(`重复 ${a.duplicate} · `, `${a.duplicate} dup · `) : ""}{l(`导入 ${a.willImport}`, `+${a.willImport}`)}</Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
            {/* P14: 逐张预览与勾选 */}
            {restorePlan.data && !restoreJobId && (
              <Pressable
                onPress={() => {
                  if (showItemPreview) return setShowItemPreview(false);
                  setShowItemPreview(true);
                  if (familyId && restoreSource && !restorePreview.data) restorePreview.mutate({ familyId, backupId: restoreSource.backupId, importKey: restoreSource.importKey, remoteKey: restoreSource.remoteKey, targetId: restoreSource.targetId, albums: selectedAlbums ?? undefined, options: { albumConflict, dedupeByHash }, limit: 200 });
                }}
                accessibilityRole="button"
                className="flex-row items-center gap-1 min-h-[40px]"
              >
                <MaterialIcons name={showItemPreview ? "expand-less" : "photo-library"} size={18} color={colors.primary} />
                <Text className="text-sm font-semibold text-primary">{showItemPreview ? l("收起逐张预览", "Hide item preview") : l("逐张预览 / 按张勾选", "Preview items / pick individually")}</Text>
                {selectedItems && <Text className="text-xs text-muted">· {l(`已选 ${selectedItems.length} 张`, `${selectedItems.length} selected`)}</Text>}
              </Pressable>
            )}
            {showItemPreview && (
              <View className="bg-surface rounded-2xl p-2 gap-1" style={{ maxHeight: 260 }}>
                {restorePreview.isPending && <ActivityIndicator color={colors.primary} />}
                {restorePreview.data && (
                  <>
                    <View className="flex-row items-center justify-between px-1">
                      <Text className="text-[11px] text-muted">{l(`显示 ${restorePreview.data.items.length} / ${restorePreview.data.total} · 左：备份 · 右：现有`, `${restorePreview.data.items.length} / ${restorePreview.data.total} · left: backup · right: existing`)}</Text>
                      <Pressable onPress={() => setSelectedItems(null)} accessibilityRole="button" className="min-h-[32px] justify-center"><Text className="text-[11px] font-semibold text-primary">{l("全选", "Select all")}</Text></Pressable>
                    </View>
                    <ScrollView style={{ maxHeight: 220 }}>
                      {restorePreview.data.items.map((it) => {
                        const on = selectedItems === null ? it.skipReason === null : selectedItems.includes(it.id);
                        const disabled = it.skipReason === "album_skipped";
                        return (
                          <Pressable
                            key={it.id}
                            disabled={disabled}
                            onPress={() => {
                              const all = restorePreview.data!.items.filter((x) => x.skipReason !== "album_skipped").map((x) => x.id);
                              const cur = selectedItems ?? restorePreview.data!.items.filter((x) => x.skipReason === null).map((x) => x.id);
                              const next = on ? cur.filter((n) => n !== it.id) : [...cur, it.id];
                              setSelectedItems(next.length === all.length ? null : next);
                            }}
                            accessibilityRole="checkbox"
                            accessibilityState={{ checked: on, disabled }}
                            className="flex-row items-center gap-2 py-1 border-b border-border"
                            style={{ opacity: disabled ? 0.4 : 1 }}
                          >
                            <MaterialIcons name={on ? "check-box" : "check-box-outline-blank"} size={18} color={on ? colors.primary : colors.muted} />
                            <View className="w-12 h-12 rounded-lg bg-background overflow-hidden items-center justify-center">
                              {it.previewDataUrl ? <ExpoImage source={{ uri: it.previewDataUrl }} style={{ width: 48, height: 48 }} contentFit="cover" /> : <MaterialIcons name={it.type === "video" ? "videocam" : "image"} size={20} color={colors.muted} />}
                            </View>
                            <MaterialIcons name={it.existing ? "compare-arrows" : "arrow-forward"} size={16} color={it.existing ? colors.warning : colors.muted} />
                            <View className="w-12 h-12 rounded-lg bg-background overflow-hidden items-center justify-center">
                              {it.existing?.thumbnailUrl && /^https?:/.test(it.existing.thumbnailUrl) ? <ExpoImage source={{ uri: it.existing.thumbnailUrl }} style={{ width: 48, height: 48 }} contentFit="cover" /> : it.existing ? <MaterialIcons name="check" size={18} color={colors.success} /> : <MaterialIcons name="add" size={18} color={colors.muted} />}
                            </View>
                            <View className="flex-1">
                              <Text className="text-[11px] text-foreground" numberOfLines={1}>{it.title ?? `#${it.id}`} · {it.albumName}</Text>
                              <Text className="text-[10px] text-muted" numberOfLines={1}>
                                {it.skipReason === "already_restored" ? l("已恢复过", "already restored") : it.skipReason === "duplicate_hash" ? l("内容重复", "duplicate content") : it.skipReason === "album_skipped" ? l("相册跳过", "album skipped") : it.existing ? l("现有相似 · 仍将导入", "similar exists · will import") : l("新内容", "new")}
                                {it.fileSize ? ` · ${formatBytes(it.fileSize)}` : ""}{!it.hasFile ? l(" · 仅元数据", " · metadata only") : ""}
                              </Text>
                            </View>
                          </Pressable>
                        );
                      })}
                    </ScrollView>
                  </>
                )}
              </View>
            )}
            {/* P12: 后台进度 */}
            {restoreJobId && restoreJob.data && (
              <View className="gap-1">
                <View className="flex-row items-center justify-between">
                  <Text className="text-xs text-foreground">
                    {restoreJob.data.status === "queued" ? l("排队中", "Queued") : restoreJob.data.status === "running" ? l({ downloading: "下载备份", parsing: "解析清单", restoring: "恢复中", requeued: "重新排队" }[restoreJob.data.stage] ?? "处理中", { downloading: "Downloading", parsing: "Parsing", restoring: "Restoring", requeued: "Requeued" }[restoreJob.data.stage] ?? "Working") : restoreJob.data.status === "completed" ? l("已完成", "Completed") : l("失败", "Failed")}
                  </Text>
                  <Text className="text-xs text-muted">{restoreJob.data.progress}%</Text>
                </View>
                <View className="h-2 rounded-full bg-border overflow-hidden">
                  <View className="h-2 rounded-full" style={{ width: `${restoreJob.data.progress}%`, backgroundColor: restoreJob.data.status === "failed" ? colors.error : colors.primary }} />
                </View>
                {restoreJob.data.error && <Text className="text-xs text-error">{restoreJob.data.error}</Text>}
                {restoreJob.data.canUndo && (
                  <Pressable onPress={() => restoreJobId && undoRestore.mutate({ jobId: restoreJobId })} disabled={undoRestore.isPending} accessibilityRole="button" className="self-start flex-row items-center gap-1 rounded-full px-3 min-h-[36px]" style={{ backgroundColor: `${colors.error}22` }}>
                    {undoRestore.isPending ? <ActivityIndicator size="small" color={colors.error} /> : <MaterialIcons name="undo" size={16} color={colors.error} />}
                    <Text className="text-xs font-semibold text-error">{l("撤销这次恢复", "Undo this restore")}</Text>
                  </Pressable>
                )}
                {restoreJob.data.undoneAt && <Text className="text-xs text-muted">{l("此次恢复已撤销", "This restore was undone")}</Text>}
              </View>
            )}
            <Text className="text-xs text-muted">{l("恢复在后台进行，可关闭此窗口；不会覆盖现有内容，重复记录自动跳过。", "Restore runs in the background (you can close this); nothing is overwritten and duplicates are skipped.")}</Text>
            <View className="flex-row gap-3">
              <Pressable onPress={() => setShowRestoreModal(false)} className="flex-1 bg-surface rounded-full min-h-[48px] items-center justify-center" accessibilityRole="button">
                <Text className="font-semibold text-foreground">{restoreFinished ? l("关闭", "Close") : t("cancel")}</Text>
              </Pressable>
              <Pressable
                onPress={() => familyId && restoreSource && restoreAsync.mutate({ familyId, backupId: restoreSource.backupId, importKey: restoreSource.importKey, remoteKey: restoreSource.remoteKey, targetId: restoreSource.targetId, albums: selectedAlbums ?? undefined, items: selectedItems ?? undefined, options: { albumConflict, dedupeByHash } })}
                disabled={!restorePlan.data || restoreAsync.isPending || !!restoreJobId || restorePlan.data.willImport === 0 || (selectedAlbums !== null && selectedAlbums.length === 0) || (selectedItems !== null && selectedItems.length === 0)}
                className="flex-1 rounded-full min-h-[48px] items-center justify-center"
                style={{ backgroundColor: restorePlan.data && !restoreJobId && restorePlan.data.willImport > 0 && (selectedAlbums === null || selectedAlbums.length > 0) ? colors.primary : colors.border }}
                accessibilityRole="button"
              >
                {restoreAsync.isPending ? <ActivityIndicator color={colors.onPrimary} /> : <Text className="font-semibold text-onPrimary">{restoreJobId ? l("进行中…", "Running…") : l("开始恢复", "Restore")}</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* P12: 云端备份历史 */}
      <Modal visible={showCloudModal} onRequestClose={() => setShowCloudModal(false)} transparent animationType="fade">
        <View className="flex-1 bg-black/50 items-center justify-center p-6">
          <View className="bg-background rounded-3xl p-6 w-full gap-3" style={{ maxHeight: "80%" }}>
            <Text className="text-2xl font-bold text-foreground">{l("云端备份历史", "Cloud backup history")}</Text>
            {(backupStatus.data?.targets?.length ?? 0) > 1 && (
              <View className="flex-row flex-wrap gap-2">
                {backupStatus.data!.targets.map((tg) => (
                  <Pressable key={tg.id} onPress={() => setCloudTargetId(tg.id)} accessibilityRole="button" accessibilityState={{ selected: cloudTargetId === tg.id }} className="rounded-full px-3 min-h-[36px] items-center justify-center" style={{ backgroundColor: cloudTargetId === tg.id ? colors.primary : colors.surface }}>
                    <Text className="text-xs font-semibold" style={{ color: cloudTargetId === tg.id ? colors.onPrimary : colors.foreground }}>{tg.label ?? l(tg.kindLabel.zh, tg.kindLabel.en)}</Text>
                  </Pressable>
                ))}
              </View>
            )}
            {remoteList.data?.target && <Text className="text-sm text-muted">{remoteList.data.target.name ?? l(remoteList.data.target.label.zh, remoteList.data.target.label.en)} · GoldenMemory/</Text>}
            {remoteList.isLoading && <ActivityIndicator color={colors.primary} />}
            {remoteList.error && <Text className="text-sm text-error">{remoteList.error.message}</Text>}
            <ScrollView style={{ maxHeight: 360 }}>
              {remoteList.data?.entries.length === 0 && <Text className="text-sm text-muted">{l("云盘上还没有备份", "No backups on the cloud target yet")}</Text>}
              {(remoteList.data?.entries ?? []).map((e) => (
                <View key={e.key} className="flex-row items-center justify-between py-2 border-b border-border">
                  <View className="flex-1 pr-2">
                    <Text className="text-xs text-foreground" numberOfLines={1}>{e.name}</Text>
                    <Text className="text-[10px] text-muted">{e.format} · {e.bytes != null ? formatBytes(e.bytes) : "—"} · {e.modifiedAt ? formatWhen(e.modifiedAt) : "—"}</Text>
                  </View>
                  <Pressable
                    onPress={() => {
                      setShowCloudModal(false);
                      openRestore({ remoteKey: e.key, targetId: remoteList.data?.target?.id, label: e.name });
                    }}
                    disabled={e.format === "other"}
                    accessibilityLabel={l("从云端恢复", "Restore from cloud")}
                    className="min-w-[44px] min-h-[44px] items-center justify-center"
                    style={{ opacity: e.format === "other" ? 0.4 : 1 }}
                  >
                    <MaterialIcons name="settings-backup-restore" size={20} color={colors.primary} />
                  </Pressable>
                </View>
              ))}
            </ScrollView>
            <Pressable onPress={() => setShowCloudModal(false)} className="bg-surface rounded-full min-h-[48px] items-center justify-center" accessibilityRole="button">
              <Text className="font-semibold text-foreground">{l("关闭", "Close")}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* P12: 账号合并 */}
      <Modal visible={showMergeModal} onRequestClose={() => setShowMergeModal(false)} transparent animationType="fade">
        <View className="flex-1 bg-black/50 items-center justify-center p-6">
          <View className="bg-background rounded-3xl p-6 w-full gap-4">
            <Text className="text-2xl font-bold text-foreground">{l("合并另一个账户", "Merge another account")}</Text>
            {mergeStep === "email" ? (
              <>
                <Text className="text-sm text-muted">{l("输入另一个账户的邮箱。我们会把验证码发到那个邮箱，确认是您本人后，它的相册、照片、点赞、评论和登录方式都会并入当前账户，原账户被停用。可在「合并记录」中于撤销期内一键撤销，到期后原账户将被永久删除。", "Enter the other account's email. A code goes to that inbox; once confirmed, its albums, photos, likes, comments and sign-in methods move into this account and the old one is deactivated. You can undo from “Merge history” during the undo window; afterwards the old account is deleted for good.")}</Text>
                <Pressable onPress={() => setShowMergeHistory((v) => !v)} accessibilityRole="button" className="flex-row items-center gap-1 min-h-[40px]">
                  <MaterialIcons name={showMergeHistory ? "expand-less" : "history"} size={18} color={colors.primary} />
                  <Text className="text-sm font-semibold text-primary">{l("合并记录 / 撤销 / 导出 CSV", "Merge history / undo / export CSV")}</Text>
                </Pressable>
                {showMergeHistory && (
                  <View className="bg-surface rounded-2xl p-3 gap-2">
                    {mergeHistory.isLoading && <ActivityIndicator color={colors.primary} />}
                    {mergeHistory.data?.length === 0 && <Text className="text-xs text-muted">{l("还没有合并记录", "No merges yet")}</Text>}
                    {(mergeHistory.data ?? []).map((m) => {
                      const total = Object.values(m.moved).reduce((a, b) => a + b, 0);
                      return (
                        <View key={m.id} className="flex-row items-center gap-2 py-1 border-b border-border">
                          <View className="flex-1">
                            <Text className="text-xs text-foreground" numberOfLines={1}>{m.sourceEmail ?? m.sourcePhone ?? `#${m.sourceUserId}`} · {total} {l("条", "rows")}</Text>
                            <Text className="text-[10px] text-muted">
                              {formatWhen(m.createdAt)} · {m.undoneAt ? l("已撤销", "undone") : m.purgedAt ? l("已永久删除", "purged") : m.canUndo ? l(`可撤销至 ${formatWhen(m.undoDeadline!)}`, `undo until ${formatWhen(m.undoDeadline!)}`) : l("撤销期已过", "undo window closed")}
                            </Text>
                          </View>
                          {m.canUndo && (
                            <Pressable onPress={() => undoMerge.mutate({ mergeId: m.id })} disabled={undoMerge.isPending} accessibilityRole="button" className="rounded-full px-3 min-h-[36px] items-center justify-center" style={{ backgroundColor: `${colors.error}22` }}>
                              <Text className="text-xs font-semibold text-error">{l("撤销", "Undo")}</Text>
                            </Pressable>
                          )}
                        </View>
                      );
                    })}
                    <View className="flex-row gap-2">
                      <Pressable onPress={() => mergeAuditCsv.mutate({ all: false })} disabled={mergeAuditCsv.isPending} accessibilityRole="button" className="flex-1 rounded-full min-h-[40px] items-center justify-center bg-background">
                        <Text className="text-xs font-semibold text-primary">{l("导出我的审计 CSV", "Export my audit CSV")}</Text>
                      </Pressable>
                      {me.data?.role === "admin" && (
                        <Pressable onPress={() => mergeAuditCsv.mutate({ all: true })} disabled={mergeAuditCsv.isPending} accessibilityRole="button" className="flex-1 rounded-full min-h-[40px] items-center justify-center bg-background">
                          <Text className="text-xs font-semibold text-primary">{l("导出全部（管理员）", "Export all (admin)")}</Text>
                        </Pressable>
                      )}
                    </View>
                    {/* P15: per-row ownership audit */}
                    <Pressable onPress={() => setShowOwnership((v) => !v)} accessibilityRole="button" className="flex-row items-center justify-between min-h-[40px]">
                      <Text className="text-xs font-semibold text-primary">{l("数据归属审计（逐行）", "Ownership audit (per row)")}</Text>
                      <MaterialIcons name={showOwnership ? "expand-less" : "expand-more"} size={18} color={colors.primary} />
                    </Pressable>
                    {showOwnership && (
                      <View className="gap-2">
                        <Text className="text-[11px] text-muted">{l("每一行记录来自哪个合并、原归属 → 现归属、当前是否仍然生效（已撤销的会标出）。", "Every row: which merge moved it, from → to, and whether it still holds (undone ones are flagged).")}</Text>
                        {ownership.isLoading && <ActivityIndicator color={colors.primary} />}
                        {ownership.data && (
                          <>
                            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                              <Pressable onPress={() => setOwnershipTable(null)} accessibilityRole="button" className="rounded-full px-2.5 min-h-[30px] justify-center" style={{ backgroundColor: ownershipTable === null ? colors.primary : colors.background }}><Text className="text-[11px] font-semibold" style={{ color: ownershipTable === null ? colors.onPrimary : colors.foreground }}>{l("全部", "All")} {ownership.data.tables.reduce((n, t) => n + t.count, 0)}</Text></Pressable>
                              {ownership.data.tables.map((t) => (
                                <Pressable key={t.table} onPress={() => setOwnershipTable(t.table)} accessibilityRole="button" className="rounded-full px-2.5 min-h-[30px] justify-center" style={{ backgroundColor: ownershipTable === t.table ? colors.primary : colors.background }}><Text className="text-[11px] font-semibold" style={{ color: ownershipTable === t.table ? colors.onPrimary : colors.foreground }}>{t.table} {t.count}</Text></Pressable>
                              ))}
                            </ScrollView>
                            {ownership.data.merges.length > 1 && (
                              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                                <Pressable onPress={() => setOwnershipMerge(null)} accessibilityRole="button" className="rounded-full px-2.5 min-h-[28px] justify-center" style={{ backgroundColor: ownershipMerge === null ? `${colors.primary}33` : colors.background }}><Text className="text-[10px] text-foreground">{l("所有合并", "All merges")}</Text></Pressable>
                                {ownership.data.merges.map((m) => (
                                  <Pressable key={m.id} onPress={() => setOwnershipMerge(m.id)} accessibilityRole="button" className="rounded-full px-2.5 min-h-[28px] justify-center" style={{ backgroundColor: ownershipMerge === m.id ? `${colors.primary}33` : colors.background }}><Text className="text-[10px] text-foreground">#{m.id} {m.sourceEmail ?? ""} · {m.status}</Text></Pressable>
                                ))}
                              </ScrollView>
                            )}
                            {ownership.data.rows.length === 0 && <Text className="text-xs text-muted">{l("没有记录", "Nothing here")}</Text>}
                            {ownership.data.rows.slice(0, 60).map((r, i) => (
                              <View key={`${r.mergeId}-${r.table}-${r.rowId}-${i}`} className="flex-row items-center gap-2 min-h-[36px] border-b border-border">
                                <View className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: r.status === "merged" ? colors.success : r.status === "undone" ? colors.warning : colors.muted }} />
                                <View className="flex-1">
                                  <Text className="text-[11px] text-foreground" numberOfLines={1}>{r.table} #{r.rowId}{r.label ? ` · ${r.label}` : ""}{r.dropped ? l(" · 重复已删除", " · dropped duplicate") : ""}</Text>
                                  <Text className="text-[10px] text-muted">#{r.fromUserId} → #{r.toUserId} · {l("现归属", "now")} {r.currentOwnerId != null ? `#${r.currentOwnerId}` : l("已不存在", "gone")} · {l("合并", "merge")} #{r.mergeId} · {r.status === "merged" ? l("生效中", "in effect") : r.status === "undone" ? l("已撤销", "undone") : l("已清理", "purged")}</Text>
                                </View>
                              </View>
                            ))}
                            {ownership.data.total > 60 && <Text className="text-[10px] text-muted">{l(`显示前 60 / ${ownership.data.total} 行，导出 CSV 查看全部`, `Showing 60 of ${ownership.data.total} — export CSV for all`)}</Text>}
                            <Pressable onPress={() => ownershipCsv.mutate({ all: false, table: (ownershipTable ?? undefined) as never, mergeId: ownershipMerge ?? undefined })} disabled={ownershipCsv.isPending} accessibilityRole="button" className="rounded-full min-h-[40px] items-center justify-center bg-background">
                              <Text className="text-xs font-semibold text-primary">{l("导出归属审计 CSV", "Export ownership CSV")}</Text>
                            </Pressable>
                          </>
                        )}
                      </View>
                    )}
                  </View>
                )}
                <TextInput value={mergeEmail} onChangeText={setMergeEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" placeholder="other@example.com" placeholderTextColor={colors.muted} className="bg-surface rounded-2xl px-4 min-h-[52px] text-foreground" />
                <View className="flex-row gap-3">
                  <Pressable onPress={() => setShowMergeModal(false)} className="flex-1 bg-surface rounded-full min-h-[48px] items-center justify-center" accessibilityRole="button">
                    <Text className="font-semibold text-foreground">{t("cancel")}</Text>
                  </Pressable>
                  <Pressable onPress={() => requestMerge.mutate({ email: mergeEmail, language: l("zh", "en") as "zh" | "en" })} disabled={requestMerge.isPending || !/.+@.+\..+/.test(mergeEmail)} className="flex-1 rounded-full min-h-[48px] items-center justify-center" style={{ backgroundColor: /.+@.+\..+/.test(mergeEmail) ? colors.primary : colors.border }} accessibilityRole="button">
                    {requestMerge.isPending ? <ActivityIndicator color={colors.onPrimary} /> : <Text className="font-semibold text-onPrimary">{l("发送验证码", "Send code")}</Text>}
                  </Pressable>
                </View>
              </>
            ) : (
              <>
                <Text className="text-sm text-muted">{l(`请输入发送到 ${mergeEmail} 的 6 位验证码。`, `Enter the 6-digit code sent to ${mergeEmail}.`)}</Text>
                <TextInput value={mergeCode} onChangeText={(v) => setMergeCode(v.replace(/\D/g, "").slice(0, 6))} keyboardType="number-pad" maxLength={6} autoFocus placeholder="000000" placeholderTextColor={colors.muted} className="bg-surface rounded-2xl px-4 min-h-[60px] text-foreground text-center font-mono" style={{ fontSize: 28, letterSpacing: 12 }} />
                <View className="flex-row gap-3">
                  <Pressable onPress={() => setMergeStep("email")} className="flex-1 bg-surface rounded-full min-h-[48px] items-center justify-center" accessibilityRole="button">
                    <Text className="font-semibold text-foreground">{l("返回", "Back")}</Text>
                  </Pressable>
                  <Pressable onPress={() => mergeCode.length === 6 && previewMerge.mutate({ email: mergeEmail, code: mergeCode })} disabled={previewMerge.isPending || mergeCode.length !== 6} className="flex-1 rounded-full min-h-[48px] items-center justify-center" style={{ backgroundColor: mergeCode.length === 6 ? colors.primary : colors.border }} accessibilityRole="button">
                    {previewMerge.isPending ? <ActivityIndicator color={colors.onPrimary} /> : <Text className="font-semibold text-onPrimary">{l("预览合并", "Preview merge")}</Text>}
                  </Pressable>
                </View>
              </>
            )}
            {/* P14: preview + conflict wizard */}
            {mergeStep === "preview" && previewMerge.data && (
              <>
                <ScrollView style={{ maxHeight: 380 }} contentContainerStyle={{ gap: 10 }}>
                  <View className="bg-surface rounded-2xl p-3 gap-1">
                    <Text className="text-sm font-semibold text-foreground">{previewMerge.data.source.name ?? previewMerge.data.source.email} <Text className="text-xs text-muted font-normal">· {previewMerge.data.source.email}</Text></Text>
                    <Text className="text-xs text-muted">
                      {l(`注册于 ${formatWhen(previewMerge.data.source.createdAt)}`, `Joined ${formatWhen(previewMerge.data.source.createdAt)}`)}
                      {previewMerge.data.source.phone ? ` · ${previewMerge.data.source.phone}` : ""}
                      {previewMerge.data.source.hasPassword ? l(" · 有密码", " · password") : ""}
                      {previewMerge.data.source.oauthProviders.length ? ` · ${previewMerge.data.source.oauthProviders.join(" / ")}` : ""}
                    </Text>
                  </View>
                  <View className="bg-surface rounded-2xl p-3 gap-1">
                    <Text className="text-xs font-semibold text-foreground">{l("将迁移的内容", "What moves over")}</Text>
                    <View className="flex-row flex-wrap gap-1">
                      {Object.entries(previewMerge.data.counts).filter(([, n]) => n > 0).map(([k, n]) => (
                        <Text key={k} className="text-[11px] text-muted rounded-full px-2 py-1 bg-background">{`${{ media: l("照片", "photos"), albums: l("相册", "albums"), comments: l("评论", "comments"), likes: l("点赞", "likes"), families: l("创建的家庭", "families created"), loveStories: l("故事", "stories"), anniversaries: l("纪念日", "anniversaries"), shares: l("分享", "shares"), notifications: l("通知", "notifications"), studioJobs: "Studio", backups: l("备份", "backups"), pushTokens: l("设备", "devices"), oauthAccounts: "OAuth", backupTargets: l("云盘目标", "cloud targets") }[k] ?? k} ${n}`}</Text>
                      ))}
                      {Object.values(previewMerge.data.counts).every((n) => n === 0) && <Text className="text-xs text-muted">{l("该账户没有内容", "That account has no content")}</Text>}
                    </View>
                    {previewMerge.data.duplicateLikes > 0 && <Text className="text-[11px] text-muted">{l(`${previewMerge.data.duplicateLikes} 个重复点赞将合并`, `${previewMerge.data.duplicateLikes} duplicate likes will be merged`)}</Text>}
                    {previewMerge.data.fieldsToFill.length > 0 && <Text className="text-[11px] text-muted">{l(`将补齐到当前账户：${previewMerge.data.fieldsToFill.join("、")}`, `Will fill in on this account: ${previewMerge.data.fieldsToFill.join(", ")}`)}</Text>}
                  </View>
                  {previewMerge.data.familiesToJoin.length > 0 && (
                    <View className="bg-surface rounded-2xl p-3 gap-1">
                      <Text className="text-xs font-semibold text-foreground">{l("将加入的家庭", "Families you will join")}</Text>
                      {previewMerge.data.familiesToJoin.map((f) => (
                        <Text key={f.familyId} className="text-xs text-muted">+ {f.name} · {f.role}</Text>
                      ))}
                    </View>
                  )}
                  {previewMerge.data.conflicts.length > 0 && (
                    <View className="bg-surface rounded-2xl p-3 gap-2">
                      <Text className="text-xs font-semibold text-foreground">{l("两个账户都在的家庭 — 选择保留哪一方的角色", "Families both accounts belong to — pick which role to keep")}</Text>
                      {previewMerge.data.conflicts.map((c) => {
                        const pick = mergeChoices[String(c.familyId)] ?? c.defaultKeep;
                        return (
                          <View key={c.familyId} className="gap-1">
                            <Text className="text-xs text-foreground">{c.name}</Text>
                            <View className="flex-row bg-background rounded-full p-1">
                              {(["target", "source"] as const).map((side) => (
                                <Pressable key={side} onPress={() => setMergeChoices((m) => ({ ...m, [String(c.familyId)]: side }))} accessibilityRole="button" accessibilityState={{ selected: pick === side }} className="flex-1 rounded-full min-h-[34px] items-center justify-center" style={{ backgroundColor: pick === side ? colors.primary : "transparent" }}>
                                  <Text className="text-[11px] font-semibold" style={{ color: pick === side ? colors.onPrimary : colors.foreground }}>{side === "target" ? l(`当前账户 · ${c.targetRole}`, `This account · ${c.targetRole}`) : l(`对方账户 · ${c.sourceRole}`, `Other account · ${c.sourceRole}`)}</Text>
                                </Pressable>
                              ))}
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  )}
                  <Text className="text-xs text-muted">{l(`合并后可在 ${previewMerge.data.undoDays} 天内撤销。`, `You can undo within ${previewMerge.data.undoDays} days.`)}</Text>
                </ScrollView>
                <View className="flex-row gap-3">
                  <Pressable onPress={() => setMergeStep("code")} className="flex-1 bg-surface rounded-full min-h-[48px] items-center justify-center" accessibilityRole="button">
                    <Text className="font-semibold text-foreground">{l("返回", "Back")}</Text>
                  </Pressable>
                  <Pressable onPress={() => completeMerge.mutate({ email: mergeEmail, code: mergeCode, choices: mergeChoices })} disabled={completeMerge.isPending} className="flex-1 rounded-full min-h-[48px] items-center justify-center" style={{ backgroundColor: colors.error }} accessibilityRole="button">
                    {completeMerge.isPending ? <ActivityIndicator color={colors.onPrimary} /> : <Text className="font-semibold text-onPrimary">{l("确认合并", "Merge now")}</Text>}
                  </Pressable>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* P8: 设置 / 修改密码 */}
      <Modal visible={showPasswordModal} onRequestClose={() => setShowPasswordModal(false)} transparent animationType="fade">
        <View className="flex-1 bg-black/50 items-center justify-center p-6">
          <View className="bg-background rounded-3xl p-6 w-full gap-4">
            <Text className="text-2xl font-bold text-foreground">
              {passwordStatus.data?.hasPassword ? l("修改密码", "Change password") : l("设置密码", "Set a password")}
            </Text>
            {passwordStatus.data?.hasPassword && (
              <TextInput
                value={currentPassword}
                onChangeText={setCurrentPassword}
                placeholder={l("当前密码", "Current password")}
                placeholderTextColor={colors.muted}
                secureTextEntry
                className="bg-surface rounded-2xl px-4 min-h-[52px] text-foreground"
              />
            )}
            <TextInput
              value={newPassword}
              onChangeText={setNewPassword}
              placeholder={l("新密码（至少 8 位）", "New password (min 8 chars)")}
              placeholderTextColor={colors.muted}
              secureTextEntry
              className="bg-surface rounded-2xl px-4 min-h-[52px] text-foreground"
            />
            <TextInput
              value={confirmNew}
              onChangeText={setConfirmNew}
              placeholder={l("再次输入新密码", "Confirm new password")}
              placeholderTextColor={colors.muted}
              secureTextEntry
              className="bg-surface rounded-2xl px-4 min-h-[52px] text-foreground"
            />
            <View className="flex-row gap-3">
              <Pressable onPress={() => setShowPasswordModal(false)} className="flex-1 bg-surface rounded-full min-h-[48px] items-center justify-center" accessibilityRole="button">
                <Text className="font-semibold text-foreground">{t("cancel")}</Text>
              </Pressable>
              <Pressable
                onPress={submitPassword}
                disabled={changePassword.isPending}
                className="flex-1 rounded-full min-h-[48px] items-center justify-center"
                style={{ backgroundColor: colors.primary }}
                accessibilityRole="button"
              >
                {changePassword.isPending ? <ActivityIndicator color={colors.onPrimary} /> : <Text className="font-semibold text-onPrimary">{t("save")}</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
}
