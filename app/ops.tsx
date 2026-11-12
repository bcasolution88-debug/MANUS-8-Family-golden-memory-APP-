import { ScrollView, Text, View, Pressable, ActivityIndicator, RefreshControl, TextInput, Switch, Modal } from "react-native";
import { useState } from "react";
import { useRouter } from "expo-router";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { useLanguage } from "@/lib/language-provider";
import { useColors } from "@/hooks/use-colors";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/components/toast";
import { ScreenContainer } from "@/components/screen-container";
import { trpc } from "@/lib/trpc";

/**
 * P11 — 运维面板 (admin only). Consumes `ops.channels` and exposes the
 * one-tap channel tests so a deployer can verify production wiring from the
 * app instead of tailing logs.
 */
const formatBytesShort = (n: number) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)} MB` : n >= 1024 ? `${(n / 1024).toFixed(0)} KB` : `${n} B`);

export default function OpsScreen() {
  const router = useRouter();
  const { l } = useLanguage();
  const colors = useColors();
  const toast = useToast();
  const { isAuthenticated } = useAuth();
  const me = trpc.auth.me.useQuery(undefined, { enabled: isAuthenticated, staleTime: 30_000 });
  const isAdmin = me.data?.role === "admin";
  const channels = trpc.ops.channels.useQuery(undefined, { enabled: isAuthenticated && isAdmin, staleTime: 15_000, retry: false });
  const testMail = trpc.ops.testMail.useMutation({
    onSuccess: (r) => (r.delivered ? toast.success(l(`测试邮件已发送到 ${r.to}（${r.transport}）`, `Test email sent to ${r.to} (${r.transport})`)) : toast.error(r.error ?? l("发送失败", "Send failed"))),
    onError: (e) => toast.error(e.message),
  });
  const testSms = trpc.ops.testSms.useMutation({
    onSuccess: (r) => (r.delivered ? toast.success(l(`测试短信已发送到 ${r.to}（${r.transport}）`, `Test SMS sent to ${r.to} (${r.transport})`)) : toast.error(r.error ?? l("发送失败", "Send failed"))),
    onError: (e) => toast.error(e.message),
  });
  // P12: success-rate history
  const [hours, setHours] = useState<24 | 72 | 168>(24);
  const metrics = trpc.ops.metrics.useQuery({ hours }, { enabled: isAuthenticated && isAdmin, staleTime: 30_000, retry: false });
  const evaluateAlerts = trpc.ops.evaluateAlerts.useMutation({
    onSuccess: (r) => toast.success(r.alerted.length ? l(`已对 ${r.alerted.join(", ")} 发出告警`, `Alerted on ${r.alerted.join(", ")}`) : l("所有通道成功率正常", "All channels healthy")),
    onError: (e) => toast.error(e.message),
  });
  const KIND_LABEL: Record<string, { zh: string; en: string; icon: keyof typeof MaterialIcons.glyphMap }> = {
    push: { zh: "推送投递", en: "Push delivery", icon: "notifications-active" },
    backup: { zh: "备份", en: "Backups", icon: "backup" },
    backup_remote: { zh: "云盘同步", en: "Cloud copy", icon: "cloud-upload" },
    studio: { zh: "Studio 渲染", en: "Studio renders", icon: "movie-creation" },
    restore: { zh: "恢复", en: "Restores", icon: "settings-backup-restore" },
    mail: { zh: "邮件", en: "Mail", icon: "mail" },
    sms: { zh: "短信", en: "SMS", icon: "sms" },
    push_open: { zh: "推送打开", en: "Push opens", icon: "touch-app" },
    alert: { zh: "告警投递", en: "Alert delivery", icon: "campaign" },
  };
  // P13: per-kind alert rules + channels + A/B copy comparison
  const utils = trpc.useUtils();
  const rules = trpc.ops.alertRules.useQuery(undefined, { enabled: isAuthenticated && isAdmin, staleTime: 15_000, retry: false });
  const alertChannels = trpc.ops.alertChannels.useQuery(undefined, { enabled: isAuthenticated && isAdmin, staleTime: 15_000, retry: false });
  const setRule = trpc.ops.setAlertRule.useMutation({ onSuccess: () => utils.ops.alertRules.invalidate(), onError: (e) => toast.error(e.message) });
  const silence = trpc.ops.silenceAlert.useMutation({
    onSuccess: (r) => {
      utils.ops.alertRules.invalidate();
      toast.success(r.silencedUntil ? l(`已静默至 ${new Date(r.silencedUntil).toLocaleString()}`, `Silenced until ${new Date(r.silencedUntil).toLocaleString()}`) : l("已取消静默", "Unsilenced"));
    },
    onError: (e) => toast.error(e.message),
  });
  const [showChannelModal, setShowChannelModal] = useState(false);
  const [chKind, setChKind] = useState<"webhook" | "slack" | "wecom" | "dingtalk">("webhook");
  const [chName, setChName] = useState("");
  const [chUrl, setChUrl] = useState("");
  const [chSecret, setChSecret] = useState("");
  const [chTier, setChTier] = useState<1 | 2 | 3>(1);
  // P14: incidents + A/B reset
  const [incidentFilter, setIncidentFilter] = useState<"active" | "resolved">("active");
  const incidents = trpc.ops.incidents.useQuery({ status: incidentFilter, take: 30 }, { enabled: isAuthenticated && isAdmin, staleTime: 15_000, retry: false, refetchInterval: 60_000 });
  const [ackNote, setAckNote] = useState("");
  const [ackId, setAckId] = useState<number | null>(null);
  const [openTimeline, setOpenTimeline] = useState<number | null>(null);
  const ackIncident = trpc.ops.ackIncident.useMutation({
    onSuccess: () => {
      utils.ops.incidents.invalidate();
      setAckId(null);
      setAckNote("");
      toast.success(l("已确认，升级链已停止", "Acknowledged — escalation stopped"));
    },
    onError: (e) => toast.error(e.message),
  });
  const resetAb = trpc.ops.resetCopyExperiment.useMutation({ onSuccess: () => { utils.ops.metrics.invalidate(); toast.success(l("A/B 实验已重置", "A/B experiment reset")); }, onError: (e) => toast.error(e.message) });
  // P15: on-call roster + handovers
  const onCall = trpc.ops.onCall.useQuery(undefined, { enabled: isAuthenticated && isAdmin, staleTime: 30_000, retry: false });
  const [showShiftModal, setShowShiftModal] = useState(false);
  const [shiftUser, setShiftUser] = useState<number | null>(null);
  const [shiftWeekday, setShiftWeekday] = useState<number>(1);
  const [shiftStart, setShiftStart] = useState("9");
  const [shiftEnd, setShiftEnd] = useState("18");
  const [shiftTier, setShiftTier] = useState<1 | 2 | 3>(1);
  const [showHandover, setShowHandover] = useState(false);
  const [handoverTo, setHandoverTo] = useState<number | null>(null);
  const [handoverNote, setHandoverNote] = useState("");
  const addShift = trpc.ops.addShift.useMutation({ onSuccess: () => { utils.ops.onCall.invalidate(); setShowShiftModal(false); toast.success(l("已添加班次", "Shift added")); }, onError: (e) => toast.error(e.message) });
  const updateShift = trpc.ops.updateShift.useMutation({ onSuccess: () => utils.ops.onCall.invalidate(), onError: (e) => toast.error(e.message) });
  const removeShift = trpc.ops.removeShift.useMutation({ onSuccess: () => utils.ops.onCall.invalidate(), onError: (e) => toast.error(e.message) });
  const handover = trpc.ops.handover.useMutation({ onSuccess: () => { utils.ops.onCall.invalidate(); setShowHandover(false); setHandoverNote(""); toast.success(l("已交接", "Handed over")); }, onError: (e) => toast.error(e.message) });
  // P15: orphan sweep
  const orphanScans = trpc.ops.orphanScans.useQuery({ take: 5 }, { enabled: isAuthenticated && isAdmin, staleTime: 30_000, retry: false });
  const scanOrphans = trpc.ops.scanOrphans.useMutation({ onSuccess: (r) => { utils.ops.orphanScans.invalidate(); toast.success(r.unsupported ? l("存储后端不支持列举，已记录", "Storage cannot list objects; recorded") : l(`扫描 ${r.scanned} 个对象，孤儿 ${r.orphans} 个`, `Scanned ${r.scanned}, ${r.orphans} orphans`)); }, onError: (e) => toast.error(e.message) });
  const purgeOrphans = trpc.ops.purgeOrphans.useMutation({ onSuccess: (r) => { utils.ops.orphanScans.invalidate(); toast.success(r.unsupported ? l("存储后端不支持删除", "Storage cannot delete objects") : l(`已删除 ${r.deleted} 个，失败 ${r.failed}`, `Deleted ${r.deleted}, failed ${r.failed}`)); }, onError: (e) => toast.error(e.message) });
  const [openScan, setOpenScan] = useState<number | null>(null);
  const addChannel = trpc.ops.addAlertChannel.useMutation({
    onSuccess: () => {
      utils.ops.alertChannels.invalidate();
      setShowChannelModal(false);
      setChName("");
      setChUrl("");
      setChSecret("");
      setChTier(1);
      toast.success(l("告警通道已添加（测试消息已送达）", "Alert channel added (test message delivered)"));
    },
    onError: (e) => toast.error(e.message),
  });
  const updateChannel = trpc.ops.updateAlertChannel.useMutation({ onSuccess: () => utils.ops.alertChannels.invalidate(), onError: (e) => toast.error(e.message) });
  const removeChannel = trpc.ops.removeAlertChannel.useMutation({ onSuccess: () => utils.ops.alertChannels.invalidate(), onError: (e) => toast.error(e.message) });
  const testChannel = trpc.ops.testAlertChannel.useMutation({
    onSuccess: (r) => {
      utils.ops.alertChannels.invalidate();
      if (r.ok) toast.success(l("测试消息已送达", "Test message delivered"));
      else toast.error(r.error);
    },
    onError: (e) => toast.error(e.message),
  });
  const [editKind, setEditKind] = useState<string | null>(null);
  const [editRate, setEditRate] = useState("80");
  const [editSamples, setEditSamples] = useState("5");
  const [editWindow, setEditWindow] = useState("6");
  const openRule = (r: { kind: string; minRate: number; minSamples: number; windowHours: number }) => {
    setEditKind(r.kind);
    setEditRate(String(Math.round(r.minRate * 100)));
    setEditSamples(String(r.minSamples));
    setEditWindow(String(r.windowHours));
  };
  const ab = metrics.data?.ab;
  const abOpens = (ab?.A ?? 0) + (ab?.B ?? 0);
  const testPush = trpc.push.test.useMutation({
    onSuccess: (r) => toast.success(l(`推送：成功 ${r.sent} · 失败 ${r.failed} · 跳过 ${r.skipped}`, `Push: ${r.sent} sent · ${r.failed} failed · ${r.skipped} skipped`)),
    onError: (e) => toast.error(e.message),
  });

  const d = channels.data;
  const statusDot = (ok: boolean | null | undefined) => (
    <View className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: ok === null || ok === undefined ? colors.muted : ok ? colors.success : colors.error }} />
  );

  const Card = ({ icon, title, ok, lines, hint, action }: { icon: keyof typeof MaterialIcons.glyphMap; title: string; ok: boolean | null; lines: string[]; hint?: string | null; action?: { label: string; onPress: () => void; busy: boolean; disabled?: boolean } }) => (
    <View className="bg-surface rounded-2xl p-4 gap-2">
      <View className="flex-row items-center gap-3">
        <MaterialIcons name={icon} size={24} color={colors.primary} />
        <Text className="font-semibold text-foreground flex-1">{title}</Text>
        {statusDot(ok)}
      </View>
      {lines.map((ln, i) => (
        <Text key={i} className="text-xs text-muted font-mono">
          {ln}
        </Text>
      ))}
      {hint ? (
        <View className="flex-row gap-2 items-start rounded-xl p-2" style={{ backgroundColor: `${colors.warning}22` }}>
          <MaterialIcons name="lightbulb" size={16} color={colors.warning} />
          <Text className="text-xs text-foreground flex-1">{hint}</Text>
        </View>
      ) : null}
      {action && (
        <Pressable
          onPress={action.onPress}
          disabled={action.busy || action.disabled}
          accessibilityRole="button"
          className="self-start flex-row items-center gap-1 rounded-full px-3 min-h-[40px]"
          style={{ backgroundColor: `${colors.primary}22`, opacity: action.disabled ? 0.5 : 1 }}
        >
          {action.busy ? <ActivityIndicator size="small" color={colors.primary} /> : <MaterialIcons name="play-arrow" size={18} color={colors.primary} />}
          <Text className="text-sm font-semibold text-primary">{action.label}</Text>
        </Pressable>
      )}
    </View>
  );

  if (me.isFetched && !isAdmin) {
    return (
      <ScreenContainer className="bg-background p-0">
        <View className="flex-1 items-center justify-center gap-4 px-8">
          <MaterialIcons name="admin-panel-settings" size={56} color={colors.muted} />
          <Text className="text-base text-muted text-center">{l("运维面板仅管理员可见。", "The ops panel is only available to administrators.")}</Text>
          <Pressable onPress={() => router.back()} className="rounded-full px-6 min-h-[48px] items-center justify-center" style={{ backgroundColor: colors.primary }} accessibilityRole="button">
            <Text className="font-semibold text-onPrimary">{l("返回", "Back")}</Text>
          </Pressable>
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer className="bg-background p-0">
      <View className="flex-row items-center gap-2 px-4 pt-2 pb-3">
        <Pressable onPress={() => router.back()} className="min-w-[48px] min-h-[48px] items-center justify-center" accessibilityRole="button" accessibilityLabel={l("返回", "Back")}>
          <MaterialIcons name="arrow-back" size={24} color={colors.foreground} />
        </Pressable>
        <Text className="text-xl font-bold text-foreground flex-1">{l("运维面板", "Ops panel")}</Text>
        <Pressable onPress={() => channels.refetch()} className="min-w-[48px] min-h-[48px] items-center justify-center" accessibilityRole="button" accessibilityLabel={l("刷新", "Refresh")}>
          <MaterialIcons name="refresh" size={22} color={colors.primary} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }} refreshControl={<RefreshControl refreshing={channels.isFetching} onRefresh={() => channels.refetch()} tintColor={colors.primary} />}>
        {channels.isLoading && <ActivityIndicator color={colors.primary} />}
        {channels.error && <Text className="text-sm text-error">{channels.error.message}</Text>}
        {d && (
          <>
            <Card
              icon="mail"
              title={l("邮件通道", "Mail channel")}
              ok={d.mail.configured ? d.mail.transport !== "resend" || d.mail.domainStatus === "verified" : false}
              lines={[
                `transport: ${d.mail.transport}`,
                `from: ${d.mail.from}`,
                ...(d.mail.transport === "resend" ? [`domain ${d.mail.fromDomain ?? "?"}: ${d.mail.domainStatus}`, ...(d.mail.pendingRecords.length ? [`pending DNS: ${d.mail.pendingRecords.join(", ")}`] : [])] : []),
                ...(d.mail.smtpDependency ? [`nodemailer: ${d.mail.smtpDependency}`] : []),
              ]}
              hint={d.mail.hint}
              action={{ label: l("发送测试邮件给我", "Send test email to me"), onPress: () => testMail.mutate({}), busy: testMail.isPending, disabled: !d.mail.configured }}
            />
            <Card
              icon="sms"
              title={l("短信通道", "SMS channel")}
              ok={d.sms.configured}
              lines={[`transport: ${d.sms.transport}`]}
              hint={d.sms.hint}
              action={{ label: l("发送测试短信给我", "Send test SMS to me"), onPress: () => testSms.mutate(), busy: testSms.isPending, disabled: !d.sms.configured }}
            />
            <Card
              icon="notifications-active"
              title={l("推送（Expo Push）", "Push (Expo)")}
              ok={d.push.configured ? true : null}
              lines={[`access token: ${d.push.configured ? "set" : "not set (unauthenticated mode)"}`]}
              hint={d.push.hint}
              action={{ label: l("推送到我的设备", "Push to my devices"), onPress: () => testPush.mutate(), busy: testPush.isPending }}
            />
            <Card
              icon="memory"
              title={l("Redis / 多实例协调", "Redis / coordination")}
              ok={d.redis === "redis"}
              lines={[`rate limit store: ${d.redis}`, `coordination: ${d.coordination.backend}`, `leader: ${d.coordination.isLeader ? "this instance" : "another instance"}`, `instance: ${d.coordination.instance}`, ...(d.coordination.since ? [`since: ${new Date(d.coordination.since).toLocaleString()}`] : [])]}
              hint={d.redis === "memory" ? l("未配置 REDIS_URL：限流与调度均为单实例模式。", "REDIS_URL not set: rate limits and schedulers run in single-instance mode.") : null}
            />
            <Card icon="movie-creation" title={l("Studio 渲染队列", "Studio render queue")} ok={true} lines={[`active: ${d.studio.active} / ${d.studio.concurrency}`, `worker: ${d.studio.workerId}`]} />

            {/* P12: 历史曲线 + 告警 */}
            <View className="flex-row items-center justify-between mt-2">
              <Text className="text-lg font-bold text-foreground">{l("成功率历史", "Success-rate history")}</Text>
              <View className="flex-row bg-surface rounded-full p-1">
                {([24, 72, 168] as const).map((h) => (
                  <Pressable key={h} onPress={() => setHours(h)} accessibilityRole="button" accessibilityState={{ selected: hours === h }} className="rounded-full px-3 min-h-[32px] items-center justify-center" style={{ backgroundColor: hours === h ? colors.primary : "transparent" }}>
                    <Text className={hours === h ? "text-xs font-semibold text-onPrimary" : "text-xs font-semibold text-foreground"}>{h === 24 ? "24h" : h === 72 ? "3d" : "7d"}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
            {metrics.isLoading && <ActivityIndicator color={colors.primary} />}
            {metrics.data &&
              metrics.data.summary.map((sm) => {
                const series = metrics.data!.series[sm.kind] ?? [];
                const maxTotal = Math.max(1, ...series.map((b) => b.total));
                const bad = sm.rate !== null && sm.rate < metrics.data!.alert.minRate;
                const label = KIND_LABEL[sm.kind] ?? { zh: sm.kind, en: sm.kind, icon: "insights" as const };
                return (
                  <View key={sm.kind} className="bg-surface rounded-2xl p-4 gap-2">
                    <View className="flex-row items-center gap-3">
                      <MaterialIcons name={label.icon} size={22} color={colors.primary} />
                      <Text className="font-semibold text-foreground flex-1">{l(label.zh, label.en)}</Text>
                      <Text className="text-sm font-bold" style={{ color: sm.rate === null ? colors.muted : bad ? colors.error : colors.success }}>
                        {sm.rate === null ? "—" : `${Math.round(sm.rate * 100)}%`}
                      </Text>
                    </View>
                    <Text className="text-xs text-muted">
                      {sm.total} {l("次", "runs")} · {sm.ok} {l("成功", "ok")}
                      {sm.avgMs != null ? ` · ${l("平均", "avg")} ${sm.avgMs >= 1000 ? `${(sm.avgMs / 1000).toFixed(1)}s` : `${sm.avgMs}ms`}` : ""}
                      {sm.lastFailure ? ` · ${l("最近失败", "last failure")} ${new Date(sm.lastFailure.at).toLocaleTimeString()}${sm.lastFailure.detail ? `: ${sm.lastFailure.detail}` : ""}` : ""}
                    </Text>
                    {/* bar chart: height = volume, colour split = ok vs failed */}
                    <View className="flex-row items-end gap-[2px]" style={{ height: 48 }} accessibilityLabel={l("每小时成功 / 失败柱状图", "Hourly ok / failed bars")}>
                      {series.map((b) => {
                        const h = Math.max(b.total ? 3 : 1, Math.round((b.total / maxTotal) * 48));
                        const okH = b.total ? Math.round((b.ok / b.total) * h) : 0;
                        return (
                          <View key={b.hour} className="flex-1 justify-end" style={{ height: 48 }}>
                            <View style={{ height: h - okH, backgroundColor: b.total ? colors.error : "transparent", borderTopLeftRadius: 2, borderTopRightRadius: 2 }} />
                            <View style={{ height: okH, backgroundColor: b.total ? colors.success : colors.border, borderBottomLeftRadius: 2, borderBottomRightRadius: 2, borderTopLeftRadius: okH === h ? 2 : 0, borderTopRightRadius: okH === h ? 2 : 0 }} />
                          </View>
                        );
                      })}
                    </View>
                  </View>
                );
              })}
            {metrics.data && (
              <View className="bg-surface rounded-2xl p-4 gap-2">
                <Text className="font-semibold text-foreground">{l("告警", "Alerts")}</Text>
                <Text className="text-xs text-muted">
                  {l(`过去 ${metrics.data.alert.windowHours} 小时成功率低于 ${Math.round(metrics.data.alert.minRate * 100)}%（且样本 ≥ 5）时邮件通知 ALERT_EMAIL 或全体管理员，每通道 6 小时冷却。`, `Email ALERT_EMAIL (or all admins) when a channel's ${metrics.data.alert.windowHours}h success rate drops below ${Math.round(metrics.data.alert.minRate * 100)}% (≥ 5 samples); 6h cooldown per channel.`)}
                </Text>
                <Pressable onPress={() => evaluateAlerts.mutate()} disabled={evaluateAlerts.isPending} accessibilityRole="button" className="self-start flex-row items-center gap-1 rounded-full px-3 min-h-[40px]" style={{ backgroundColor: `${colors.primary}22` }}>
                  {evaluateAlerts.isPending ? <ActivityIndicator size="small" color={colors.primary} /> : <MaterialIcons name="campaign" size={18} color={colors.primary} />}
                  <Text className="text-sm font-semibold text-primary">{l("立即评估并发送告警", "Evaluate & alert now")}</Text>
                </Pressable>
              </View>
            )}

            {/* P13: per-kind alert rules */}
            {rules.data && (
              <View className="bg-surface rounded-2xl p-4 gap-3">
                <View className="flex-row items-center justify-between">
                  <Text className="font-semibold text-foreground">{l("告警规则（按通道）", "Alert rules (per channel)")}</Text>
                  <Text className="text-xs text-muted">{l("阈值 / 样本 / 窗口 · 点击编辑", "rate / samples / window · tap to edit")}</Text>
                </View>
                {rules.data.map((r) => {
                  const label = KIND_LABEL[r.kind] ?? { zh: r.kind, en: r.kind, icon: "insights" as const };
                  const silenced = r.silencedUntil && new Date(r.silencedUntil).getTime() > Date.now();
                  return (
                    <View key={r.kind} className="flex-row items-center gap-2 py-1" style={{ opacity: r.enabled ? 1 : 0.5 }}>
                      <MaterialIcons name={label.icon} size={18} color={colors.muted} />
                      <Pressable onPress={() => openRule(r)} accessibilityRole="button" className="flex-1 min-h-[44px] justify-center">
                        <Text className="text-sm text-foreground">
                          {l(label.zh, label.en)} {r.custom ? <Text className="text-xs text-primary">{l("（自定义）", "(custom)")}</Text> : null}
                        </Text>
                        <Text className="text-xs text-muted">
                          {`≥ ${Math.round(r.minRate * 100)}% · ${l("样本", "n")} ≥ ${r.minSamples} · ${r.windowHours}h`}
                          {silenced ? ` · ${l("静默至", "silenced until")} ${new Date(r.silencedUntil!).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() => silence.mutate({ kind: r.kind, minutes: silenced ? 0 : 120 })}
                        accessibilityRole="button"
                        accessibilityLabel={silenced ? l("取消静默", "Unsilence") : l("静默 2 小时", "Silence 2h")}
                        className="w-11 h-11 items-center justify-center rounded-full"
                      >
                        <MaterialIcons name={silenced ? "notifications-off" : "notifications-paused"} size={20} color={silenced ? colors.warning : colors.muted} />
                      </Pressable>
                      <Switch value={r.enabled} onValueChange={(v) => setRule.mutate({ kind: r.kind, enabled: v })} trackColor={{ true: colors.primary }} />
                    </View>
                  );
                })}
              </View>
            )}

            {/* P13: alert channels */}
            {alertChannels.data && (
              <View className="bg-surface rounded-2xl p-4 gap-3">
                <View className="flex-row items-center justify-between">
                  <Text className="font-semibold text-foreground">{l("告警通道", "Alert channels")}</Text>
                  <Pressable onPress={() => setShowChannelModal(true)} accessibilityRole="button" className="flex-row items-center gap-1 rounded-full px-3 min-h-[40px]" style={{ backgroundColor: `${colors.primary}22` }}>
                    <MaterialIcons name="add" size={18} color={colors.primary} />
                    <Text className="text-sm font-semibold text-primary">{l("添加", "Add")}</Text>
                  </Pressable>
                </View>
                {alertChannels.data.channels.length === 0 && <Text className="text-xs text-muted">{l("尚未配置 Webhook / Slack / 企业微信 / 钉钉；告警仅发邮件。", "No Webhook / Slack / WeCom / DingTalk yet — alerts go by email only.")}</Text>}
                {alertChannels.data.channels.map((c) => {
                  const kindLabel = alertChannels.data!.kinds.find((k) => k.kind === c.kind);
                  return (
                    <View key={c.id} className="flex-row items-center gap-2 py-1" style={{ opacity: c.enabled ? 1 : 0.5 }}>
                      {statusDot(c.lastStatus === null ? null : c.lastStatus === "ok")}
                      <View className="flex-1">
                        <Text className="text-sm text-foreground">
                          {c.name} <Text className="text-xs text-muted">· {kindLabel ? l(kindLabel.zh, kindLabel.en) : c.kind}</Text>
                        </Text>
                        <Text className="text-xs text-muted" numberOfLines={1}>
                          {c.lastError ? c.lastError : c.lastSentAt ? l(`最近发送 ${new Date(c.lastSentAt).toLocaleString()}`, `Last sent ${new Date(c.lastSentAt).toLocaleString()}`) : l("尚未发送", "Never sent")}
                        </Text>
                      </View>
                      <Pressable onPress={() => testChannel.mutate({ id: c.id })} disabled={testChannel.isPending} accessibilityRole="button" accessibilityLabel={l("测试", "Test")} className="w-11 h-11 items-center justify-center rounded-full">
                        <MaterialIcons name="send" size={18} color={colors.primary} />
                      </Pressable>
                      <Pressable onPress={() => updateChannel.mutate({ id: c.id, tier: (c.tier % 3) + 1 })} accessibilityRole="button" accessibilityLabel={l(`升级层级 T${c.tier}，点击切换`, `Escalation tier T${c.tier}, tap to change`)} className="rounded-full px-2 min-h-[32px] justify-center" style={{ backgroundColor: c.tier === 1 ? `${colors.primary}22` : c.tier === 2 ? `${colors.warning}33` : `${colors.error}22` }}>
                        <Text className="text-xs font-bold" style={{ color: c.tier === 1 ? colors.primary : c.tier === 2 ? colors.warning : colors.error }}>T{c.tier}</Text>
                      </Pressable>
                      <Switch value={c.enabled} onValueChange={(v) => updateChannel.mutate({ id: c.id, enabled: v })} trackColor={{ true: colors.primary }} />
                      <Pressable onPress={() => removeChannel.mutate({ id: c.id })} accessibilityRole="button" accessibilityLabel={l("删除", "Remove")} className="w-11 h-11 items-center justify-center rounded-full">
                        <MaterialIcons name="delete-outline" size={20} color={colors.error} />
                      </Pressable>
                    </View>
                  );
                })}
              </View>
            )}

            {/* P14: incidents — escalation chain + ack + timeline */}
            {incidents.data && (
              <View className="bg-surface rounded-2xl p-4 gap-3">
                <View className="flex-row items-center justify-between">
                  <Text className="font-semibold text-foreground">{l("告警事件", "Incidents")}</Text>
                  <View className="flex-row bg-background rounded-full p-0.5">
                    {(["active", "resolved"] as const).map((f) => (
                      <Pressable key={f} onPress={() => setIncidentFilter(f)} accessibilityRole="button" className="rounded-full px-3 min-h-[32px] justify-center" style={{ backgroundColor: incidentFilter === f ? colors.primary : "transparent" }}>
                        <Text className="text-xs font-semibold" style={{ color: incidentFilter === f ? "#fff" : colors.foreground }}>{f === "active" ? l("进行中", "Active") : l("已恢复", "Resolved")}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
                <Text className="text-xs text-muted">{l(`未确认 ${incidents.data.escalateAfterMin} 分钟后升级到 T2 通道，${incidents.data.escalateAfterMin * 2} 分钟后 T3；确认后停止升级，通道恢复正常自动关闭。`, `Escalates to T2 channels after ${incidents.data.escalateAfterMin} min un-acked, T3 after ${incidents.data.escalateAfterMin * 2}; ack stops the chain; auto-resolves when healthy.`)}</Text>
                {incidents.data.incidents.length === 0 && <Text className="text-xs text-muted">{incidentFilter === "active" ? l("当前没有进行中的告警事件 🎉", "No active incidents 🎉") : l("暂无已恢复事件", "No resolved incidents")}</Text>}
                {incidents.data.incidents.map((inc) => {
                  const label = KIND_LABEL[inc.kind] ?? { zh: inc.kind, en: inc.kind, icon: "insights" as const };
                  const tone = inc.status === "open" ? colors.error : inc.status === "acked" ? colors.warning : colors.success;
                  return (
                    <View key={inc.id} className="gap-1 py-1 border-b border-border">
                      <View className="flex-row items-center gap-2">
                        <View className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: tone }} />
                        <MaterialIcons name={label.icon} size={18} color={colors.muted} />
                        <Pressable onPress={() => setOpenTimeline(openTimeline === inc.id ? null : inc.id)} accessibilityRole="button" className="flex-1 min-h-[44px] justify-center">
                          <Text className="text-sm text-foreground">
                            {l(label.zh, label.en)} <Text className="text-xs font-bold" style={{ color: tone }}>T{inc.tier}</Text> <Text className="text-xs text-muted">· {inc.status === "open" ? l("未确认", "open") : inc.status === "acked" ? l("已确认", "acked") : l("已恢复", "resolved")}</Text>
                          </Text>
                          <Text className="text-xs text-muted">
                            {new Date(inc.openedAt).toLocaleString()} · {inc.ratePct != null ? `${inc.ratePct}%` : "—"} / {inc.samples ?? "—"}
                            {inc.ackNote ? ` · ${inc.ackNote}` : ""}
                          </Text>
                        </Pressable>
                        {inc.status === "open" && (
                          <Pressable onPress={() => setAckId(inc.id)} accessibilityRole="button" className="rounded-full px-3 min-h-[36px] justify-center" style={{ backgroundColor: `${colors.warning}33` }}>
                            <Text className="text-xs font-semibold" style={{ color: colors.warning }}>{l("确认", "Ack")}</Text>
                          </Pressable>
                        )}
                      </View>
                      {openTimeline === inc.id && (
                        <View className="ml-5 pl-3 gap-1" style={{ borderLeftWidth: 2, borderLeftColor: colors.border }}>
                          {inc.timeline.map((ev, i) => (
                            <Text key={i} className="text-[11px] text-muted">
                              {new Date(ev.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {ev.event}{ev.by ? ` · #${ev.by}` : ""}{ev.detail ? ` · ${ev.detail}` : ""}
                            </Text>
                          ))}
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>
            )}

            {/* P15: on-call roster + rotation */}
            {onCall.data && (
              <View className="bg-surface rounded-2xl p-4 gap-3">
                <View className="flex-row items-center justify-between">
                  <Text className="font-semibold text-foreground">{l("值班排班", "On-call roster")}</Text>
                  <View className="flex-row gap-2">
                    <Pressable onPress={() => { setHandoverTo(onCall.data!.admins[0]?.id ?? null); setShowHandover(true); }} accessibilityRole="button" className="rounded-full px-3 min-h-[36px] justify-center" style={{ backgroundColor: `${colors.warning}33` }}>
                      <Text className="text-xs font-semibold" style={{ color: colors.warning }}>{l("手动交接", "Hand over")}</Text>
                    </Pressable>
                    <Pressable onPress={() => { setShiftUser(onCall.data!.admins[0]?.id ?? null); setShowShiftModal(true); }} accessibilityRole="button" className="rounded-full px-3 min-h-[36px] justify-center" style={{ backgroundColor: colors.primary }}>
                      <Text className="text-xs font-semibold text-white">{l("添加班次", "Add shift")}</Text>
                    </Pressable>
                  </View>
                </View>
                <Text className="text-xs text-muted">{l("告警打开 / 升级时，除通道外还会直接邮件 + 短信通知对应层级的当班人；无排班时回退到第一位管理员。值班人变化自动记录交接。", "On open / escalate the on-duty admin for that tier also gets mail + SMS; falls back to the first admin without a shift. Duty changes are logged as handovers.")}</Text>
                <View className="flex-row gap-2">
                  {onCall.data.duty.map((d) => {
                    const who = onCall.data!.admins.find((a) => a.id === d.userId);
                    return (
                      <View key={d.tier} className="flex-1 bg-background rounded-xl p-2 gap-0.5">
                        <Text className="text-[11px] text-muted">T{d.tier} {l("当班", "on duty")}</Text>
                        <Text className="text-sm font-semibold text-foreground" numberOfLines={1}>{who?.name ?? who?.email ?? (d.userId ? `#${d.userId}` : "—")}</Text>
                        <Text className="text-[10px] text-muted">{d.fallback ? l("回退", "fallback") : d.shiftId ? l("排班", "shift") : l("无人", "none")}{who?.smsReady ? " · SMS" : ""}</Text>
                      </View>
                    );
                  })}
                </View>
                {onCall.data.shifts.length === 0 && <Text className="text-xs text-muted">{l("还没有班次，添加后按周重复。", "No shifts yet — add weekly ones.")}</Text>}
                {onCall.data.shifts.map((sft) => {
                  const who = onCall.data!.admins.find((a) => a.id === sft.userId);
                  const WD = [l("日", "Sun"), l("一", "Mon"), l("二", "Tue"), l("三", "Wed"), l("四", "Thu"), l("五", "Fri"), l("六", "Sat")];
                  return (
                    <View key={sft.id} className="flex-row items-center gap-2 py-1 border-b border-border">
                      <Pressable onPress={() => updateShift.mutate({ id: sft.id, tier: ((sft.tier % 3) + 1) as 1 | 2 | 3 })} accessibilityRole="button" className="rounded-full px-2 min-h-[28px] justify-center" style={{ backgroundColor: `${colors.primary}22` }}>
                        <Text className="text-[11px] font-bold" style={{ color: colors.primary }}>T{sft.tier}</Text>
                      </Pressable>
                      <View className="flex-1">
                        <Text className="text-sm text-foreground" numberOfLines={1}>{who?.name ?? who?.email ?? `#${sft.userId}`}</Text>
                        <Text className="text-[11px] text-muted">
                          {sft.kind === "weekly" ? `${l("周", "")}${WD[sft.weekday ?? 0]}${l("", "")} ${sft.startHour}:00–${sft.endHour}:00 ${sft.tz}` : `${sft.startsAt ? new Date(sft.startsAt).toLocaleString() : ""} → ${sft.endsAt ? new Date(sft.endsAt).toLocaleString() : ""}`}
                          {sft.note ? ` · ${sft.note}` : ""}
                        </Text>
                      </View>
                      <Switch value={sft.enabled} onValueChange={(v) => updateShift.mutate({ id: sft.id, enabled: v })} />
                      <Pressable onPress={() => removeShift.mutate({ id: sft.id })} accessibilityRole="button" accessibilityLabel={l("删除班次", "Remove shift")} className="w-9 h-9 items-center justify-center">
                        <MaterialIcons name="delete-outline" size={18} color={colors.error} />
                      </Pressable>
                    </View>
                  );
                })}
                {onCall.data.handovers.length > 0 && (
                  <View className="gap-1">
                    <Text className="text-xs font-semibold text-muted">{l("最近交接", "Recent handovers")}</Text>
                    {onCall.data.handovers.slice(0, 5).map((h) => {
                      const nm = (id: number | null) => onCall.data!.admins.find((a) => a.id === id)?.name ?? (id ? `#${id}` : "—");
                      return <Text key={h.id} className="text-[11px] text-muted">{new Date(h.createdAt).toLocaleString()} · T{h.tier} · {nm(h.fromUserId)} → {nm(h.toUserId)} · {h.reason === "manual" ? l("手动", "manual") : l("轮值", "auto")}{h.openIncidents.length ? ` · ${h.openIncidents.length} ${l("个进行中事件", "open")}` : ""}{h.note ? ` · ${h.note}` : ""}</Text>;
                    })}
                  </View>
                )}
              </View>
            )}

            {/* P15: object-storage orphan sweep */}
            {orphanScans.data && (
              <View className="bg-surface rounded-2xl p-4 gap-3">
                <View className="flex-row items-center justify-between">
                  <Text className="font-semibold text-foreground">{l("存储孤儿清理", "Storage orphans")}</Text>
                  <Pressable onPress={() => scanOrphans.mutate({})} disabled={scanOrphans.isPending} accessibilityRole="button" className="rounded-full px-3 min-h-[36px] justify-center" style={{ backgroundColor: colors.primary, opacity: scanOrphans.isPending ? 0.6 : 1 }}>
                    <Text className="text-xs font-semibold text-white">{scanOrphans.isPending ? l("扫描中…", "Scanning…") : l("立即扫描", "Scan now")}</Text>
                  </Pressable>
                </View>
                <Text className="text-xs text-muted">{l(`列举 families/ 下对象并与数据库引用比对；仅 ${orphanScans.data.minAgeHours}h 前的未引用对象算孤儿。撤销恢复已自动删除其上传的对象。每周自动扫描，不自动删除。`, `Lists families/ objects vs DB references; only unreferenced objects older than ${orphanScans.data.minAgeHours}h count. Undo-restore already deletes its own uploads. Weekly auto-scan, never auto-purges.`)}</Text>
                {orphanScans.data.scans.length === 0 && <Text className="text-xs text-muted">{l("还没有扫描记录", "No scans yet")}</Text>}
                {orphanScans.data.scans.map((sc) => (
                  <View key={sc.id} className="gap-1 py-1 border-b border-border">
                    <Pressable onPress={() => setOpenScan(openScan === sc.id ? null : sc.id)} accessibilityRole="button" className="flex-row items-center gap-2 min-h-[44px]">
                      <MaterialIcons name={sc.error ? "error-outline" : sc.deletedAt ? "check-circle" : "folder-open"} size={18} color={sc.error ? colors.error : sc.deletedAt ? colors.success : colors.muted} />
                      <View className="flex-1">
                        <Text className="text-sm text-foreground">{new Date(sc.createdAt).toLocaleString()} · {l("扫描", "scanned")} {sc.scanned} · {l("孤儿", "orphans")} {sc.orphans} ({formatBytesShort(sc.orphanBytes)})</Text>
                        <Text className="text-[11px] text-muted">{sc.error ? sc.error : sc.deletedAt ? l(`已清理 ${sc.deletedCount} 个 · ${new Date(sc.deletedAt).toLocaleString()}`, `Purged ${sc.deletedCount} · ${new Date(sc.deletedAt).toLocaleString()}`) : sc.familyId ? l(`家庭 #${sc.familyId}`, `family #${sc.familyId}`) : l("全部家庭", "all families")}</Text>
                      </View>
                      {!sc.deletedAt && !sc.error && sc.orphans > 0 && (
                        <Pressable onPress={() => purgeOrphans.mutate({ scanId: sc.id })} disabled={purgeOrphans.isPending} accessibilityRole="button" className="rounded-full px-3 min-h-[36px] justify-center" style={{ backgroundColor: `${colors.error}22` }}>
                          <Text className="text-xs font-semibold" style={{ color: colors.error }}>{l("清理", "Purge")}</Text>
                        </Pressable>
                      )}
                    </Pressable>
                    {openScan === sc.id && sc.keys.length > 0 && (
                      <View className="ml-6 gap-0.5">
                        {sc.keys.slice(0, 30).map((k) => <Text key={k.key} className="text-[10px] text-muted" numberOfLines={1}>{k.key.split("/").slice(-2).join("/")} · {formatBytesShort(k.bytes ?? 0)}</Text>)}
                        {sc.keys.length > 30 && <Text className="text-[10px] text-muted">… {l(`共 ${sc.orphans} 个`, `${sc.orphans} total`)}</Text>}
                      </View>
                    )}
                  </View>
                ))}
              </View>
            )}

            {/* P13: A/B copy experiment */}
            {metrics.data && (
              <View className="bg-surface rounded-2xl p-4 gap-2">
                <Text className="font-semibold text-foreground">{l("推送文案 A/B", "Push copy A/B")}</Text>
                <Text className="text-xs text-muted">
                  {l(
                    `PUSH_COPY_EXPERIMENT=1 时按用户稳定分流 A（现有文案）/ B（更亲切、emoji 开头）；点击通知上报「推送打开」指标并带变体标记。过去 ${hours} 小时共 ${abOpens} 次打开。`,
                    `With PUSH_COPY_EXPERIMENT=1 users are split 50/50 into A (current copy) / B (warmer, emoji-led); taps report a “push open” metric tagged with the variant. ${abOpens} opens in the last ${hours}h.`,
                  )}
                </Text>
                <View className="flex-row gap-2">
                  {(["A", "B"] as const).map((v) => {
                    const n = ab?.[v] ?? 0;
                    const pct = abOpens ? Math.round((n / abOpens) * 100) : 0;
                    return (
                      <View key={v} className="flex-1 rounded-xl p-3" style={{ backgroundColor: `${colors.primary}11` }}>
                        <Text className="text-xs text-muted">{l(`变体 ${v}`, `Variant ${v}`)} {v === "A" ? l("· 现有", "· current") : l("· 亲切版", "· warm")}</Text>
                        <Text className="text-lg font-bold text-foreground">{n}</Text>
                        <Text className="text-xs text-muted">{l(`打开 · ${pct}%`, `opens · ${pct}%`)}</Text>
                      </View>
                    );
                  })}
                </View>
                {ab && Object.keys(ab.byType).length > 0 && (
                  <View className="flex-row flex-wrap gap-1 pt-1">
                    {Object.entries(ab.byType).map(([t, c]) => (
                      <Text key={t} className="text-xs text-muted rounded-full px-2 py-1 bg-background">{`${t}: A ${c.A} / B ${c.B}`}</Text>
                    ))}
                  </View>
                )}
                {ab && !ab.enabled && <Text className="text-xs" style={{ color: colors.warning }}>{l("实验未开启（所有用户均为 A）", "Experiment off — everyone sees A")}</Text>}
                {ab?.stats && (
                  <View className="flex-row items-center justify-between pt-1">
                    <Text className="text-xs text-muted">
                      {ab.winner
                        ? l(`已自动选优：变体 ${ab.winner} 对全员生效`, `Auto-promoted: variant ${ab.winner} for everyone`)
                        : l(`累计 A ${ab.stats.openA}/${ab.stats.sentA} · B ${ab.stats.openB}/${ab.stats.sentB}；两臂各 ≥ ${ab.minSentPerArm} 次且提升 ≥ ${Math.round(ab.minLift * 100)}% 后自动选优`, `Cumulative A ${ab.stats.openA}/${ab.stats.sentA} · B ${ab.stats.openB}/${ab.stats.sentB}; auto-promotes once both arms ≥ ${ab.minSentPerArm} sends and lift ≥ ${Math.round(ab.minLift * 100)}%`)}
                    </Text>
                    <Pressable onPress={() => resetAb.mutate()} disabled={resetAb.isPending} accessibilityRole="button" className="rounded-full px-3 min-h-[32px] justify-center bg-background">
                      <Text className="text-xs font-semibold text-primary">{l("重置", "Reset")}</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            )}
          </>
        )}
      </ScrollView>

      {/* P14: ack incident */}
      {/* P15: add shift */}
      <Modal visible={showShiftModal} transparent animationType="fade" onRequestClose={() => setShowShiftModal(false)}>
        <Pressable className="flex-1 bg-black/50 justify-center px-6" onPress={() => setShowShiftModal(false)}>
          <Pressable className="bg-surface rounded-2xl p-5 gap-3" onPress={() => {}}>
            <Text className="text-lg font-bold text-foreground">{l("添加每周班次", "Add weekly shift")}</Text>
            <Text className="text-xs text-muted">{l("值班人", "Person")}</Text>
            <View className="flex-row flex-wrap gap-2">
              {(onCall.data?.admins ?? []).map((a) => (
                <Pressable key={a.id} onPress={() => setShiftUser(a.id)} accessibilityRole="button" className="rounded-full px-3 min-h-[36px] justify-center" style={{ backgroundColor: shiftUser === a.id ? colors.primary : colors.background }}>
                  <Text className="text-xs font-semibold" style={{ color: shiftUser === a.id ? "#fff" : colors.foreground }}>{a.name ?? a.email ?? `#${a.id}`}</Text>
                </Pressable>
              ))}
            </View>
            <Text className="text-xs text-muted">{l("星期", "Weekday")}</Text>
            <View className="flex-row gap-1">
              {[l("日", "S"), l("一", "M"), l("二", "T"), l("三", "W"), l("四", "T"), l("五", "F"), l("六", "S")].map((d, i) => (
                <Pressable key={i} onPress={() => setShiftWeekday(i)} accessibilityRole="button" className="flex-1 rounded-full min-h-[36px] items-center justify-center" style={{ backgroundColor: shiftWeekday === i ? colors.primary : colors.background }}>
                  <Text className="text-xs font-semibold" style={{ color: shiftWeekday === i ? "#fff" : colors.foreground }}>{d}</Text>
                </Pressable>
              ))}
            </View>
            <View className="flex-row gap-2">
              <View className="flex-1 gap-1"><Text className="text-xs text-muted">{l("开始（时）", "Start hour")}</Text><TextInput value={shiftStart} onChangeText={setShiftStart} keyboardType="number-pad" className="bg-background rounded-xl px-3 min-h-[44px] text-foreground" /></View>
              <View className="flex-1 gap-1"><Text className="text-xs text-muted">{l("结束（时）", "End hour")}</Text><TextInput value={shiftEnd} onChangeText={setShiftEnd} keyboardType="number-pad" className="bg-background rounded-xl px-3 min-h-[44px] text-foreground" /></View>
              <View className="gap-1"><Text className="text-xs text-muted">{l("层级", "Tier")}</Text>
                <View className="flex-row bg-background rounded-xl p-0.5 min-h-[44px] items-center">
                  {([1, 2, 3] as const).map((t) => (
                    <Pressable key={t} onPress={() => setShiftTier(t)} accessibilityRole="button" className="rounded-lg px-2 min-h-[36px] justify-center" style={{ backgroundColor: shiftTier === t ? colors.primary : "transparent" }}>
                      <Text className="text-xs font-bold" style={{ color: shiftTier === t ? "#fff" : colors.foreground }}>T{t}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            </View>
            <View className="flex-row gap-2 justify-end">
              <Pressable onPress={() => setShowShiftModal(false)} accessibilityRole="button" className="rounded-full px-4 min-h-[44px] justify-center"><Text className="text-foreground">{l("取消", "Cancel")}</Text></Pressable>
              <Pressable onPress={() => shiftUser && addShift.mutate({ userId: shiftUser, kind: "weekly", weekday: shiftWeekday, startHour: Math.min(24, Math.max(0, Number(shiftStart) || 0)), endHour: Math.min(24, Math.max(0, Number(shiftEnd) || 24)), tier: shiftTier })} disabled={!shiftUser || addShift.isPending} accessibilityRole="button" className="rounded-full px-4 min-h-[44px] justify-center" style={{ backgroundColor: colors.primary, opacity: !shiftUser || addShift.isPending ? 0.6 : 1 }}>
                <Text className="text-white font-semibold">{l("保存", "Save")}</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
      {/* P15: manual handover */}
      <Modal visible={showHandover} transparent animationType="fade" onRequestClose={() => setShowHandover(false)}>
        <Pressable className="flex-1 bg-black/50 justify-center px-6" onPress={() => setShowHandover(false)}>
          <Pressable className="bg-surface rounded-2xl p-5 gap-3" onPress={() => {}}>
            <Text className="text-lg font-bold text-foreground">{l("手动交接（T1，24 小时）", "Manual handover (T1, 24 h)")}</Text>
            <View className="flex-row flex-wrap gap-2">
              {(onCall.data?.admins ?? []).map((a) => (
                <Pressable key={a.id} onPress={() => setHandoverTo(a.id)} accessibilityRole="button" className="rounded-full px-3 min-h-[36px] justify-center" style={{ backgroundColor: handoverTo === a.id ? colors.primary : colors.background }}>
                  <Text className="text-xs font-semibold" style={{ color: handoverTo === a.id ? "#fff" : colors.foreground }}>{a.name ?? a.email ?? `#${a.id}`}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput value={handoverNote} onChangeText={setHandoverNote} placeholder={l("交接备注（可选）", "Note (optional)")} placeholderTextColor={colors.muted} className="bg-background rounded-xl px-3 min-h-[44px] text-foreground" maxLength={300} />
            <View className="flex-row gap-2 justify-end">
              <Pressable onPress={() => setShowHandover(false)} accessibilityRole="button" className="rounded-full px-4 min-h-[44px] justify-center"><Text className="text-foreground">{l("取消", "Cancel")}</Text></Pressable>
              <Pressable onPress={() => handoverTo && handover.mutate({ toUserId: handoverTo, tier: 1, note: handoverNote || undefined })} disabled={!handoverTo || handover.isPending} accessibilityRole="button" className="rounded-full px-4 min-h-[44px] justify-center" style={{ backgroundColor: colors.warning, opacity: !handoverTo || handover.isPending ? 0.6 : 1 }}>
                <Text className="text-white font-semibold">{l("交接", "Hand over")}</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
      <Modal visible={ackId !== null} transparent animationType="fade" onRequestClose={() => setAckId(null)}>
        <Pressable className="flex-1 bg-black/50 justify-center px-6" onPress={() => setAckId(null)}>
          <Pressable className="bg-background rounded-3xl p-5 gap-3" onPress={() => undefined}>
            <Text className="text-lg font-bold text-foreground">{l("确认告警", "Acknowledge incident")}</Text>
            <Text className="text-xs text-muted">{l("确认后升级链停止、不再提醒；事件保留到通道恢复正常后自动关闭。", "Stops escalation and reminders; the incident stays until the channel is healthy again.")}</Text>
            <TextInput value={ackNote} onChangeText={setAckNote} placeholder={l("备注（可选，如：正在联系供应商）", "Note (optional, e.g. contacting vendor)")} placeholderTextColor={colors.muted} className="bg-surface rounded-xl px-4 min-h-[48px]" style={{ color: colors.foreground }} />
            <Pressable onPress={() => ackId && ackIncident.mutate({ id: ackId, note: ackNote.trim() || undefined })} disabled={ackIncident.isPending} accessibilityRole="button" className="min-h-[48px] items-center justify-center rounded-2xl bg-primary">
              {ackIncident.isPending ? <ActivityIndicator color="#fff" /> : <Text className="text-sm font-semibold text-white">{l("确认", "Acknowledge")}</Text>}
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* P13: rule editor */}
      <Modal visible={!!editKind} transparent animationType="fade" onRequestClose={() => setEditKind(null)}>
        <Pressable className="flex-1 bg-black/50 justify-center px-6" onPress={() => setEditKind(null)}>
          <Pressable className="bg-background rounded-3xl p-5 gap-3" onPress={() => undefined}>
            <Text className="text-lg font-bold text-foreground">{l("编辑告警规则", "Edit alert rule")} · {editKind && (KIND_LABEL[editKind] ? l(KIND_LABEL[editKind]!.zh, KIND_LABEL[editKind]!.en) : editKind)}</Text>
            {[
              { label: l("最低成功率 %", "Min success rate %"), value: editRate, set: setEditRate },
              { label: l("最少样本数", "Min samples"), value: editSamples, set: setEditSamples },
              { label: l("窗口（小时）", "Window (hours)"), value: editWindow, set: setEditWindow },
            ].map((f) => (
              <View key={f.label} className="gap-1">
                <Text className="text-xs text-muted">{f.label}</Text>
                <TextInput value={f.value} onChangeText={f.set} keyboardType="number-pad" className="bg-surface rounded-xl px-4 min-h-[48px] text-foreground" style={{ color: colors.foreground }} />
              </View>
            ))}
            <View className="flex-row gap-2 pt-1">
              <Pressable onPress={() => editKind && setRule.mutate({ kind: editKind as never, reset: true }, { onSuccess: () => setEditKind(null) })} accessibilityRole="button" className="flex-1 min-h-[48px] items-center justify-center rounded-2xl bg-surface">
                <Text className="text-sm text-muted">{l("恢复默认", "Reset to default")}</Text>
              </Pressable>
              <Pressable
                onPress={() => editKind && setRule.mutate({ kind: editKind as never, minRatePct: Math.min(100, Math.max(0, Number(editRate) || 0)), minSamples: Math.max(1, Number(editSamples) || 1), windowHours: Math.max(1, Number(editWindow) || 1) }, { onSuccess: () => setEditKind(null) })}
                disabled={setRule.isPending}
                accessibilityRole="button"
                className="flex-1 min-h-[48px] items-center justify-center rounded-2xl bg-primary"
              >
                <Text className="text-sm font-semibold text-white">{l("保存", "Save")}</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* P13: add channel */}
      <Modal visible={showChannelModal} transparent animationType="fade" onRequestClose={() => setShowChannelModal(false)}>
        <Pressable className="flex-1 bg-black/50 justify-center px-6" onPress={() => setShowChannelModal(false)}>
          <Pressable className="bg-background rounded-3xl p-5 gap-3" onPress={() => undefined}>
            <Text className="text-lg font-bold text-foreground">{l("添加告警通道", "Add alert channel")}</Text>
            <View className="flex-row flex-wrap gap-2">
              {(alertChannels.data?.kinds ?? []).map((k) => (
                <Pressable key={k.kind} onPress={() => setChKind(k.kind)} accessibilityRole="button" className="rounded-full px-3 min-h-[40px] justify-center" style={{ backgroundColor: chKind === k.kind ? colors.primary : `${colors.primary}22` }}>
                  <Text className="text-sm font-semibold" style={{ color: chKind === k.kind ? "#fff" : colors.primary }}>{l(k.zh, k.en)}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput value={chName} onChangeText={setChName} placeholder={l("名称（如：值班群）", "Name (e.g. On-call room)")} placeholderTextColor={colors.muted} className="bg-surface rounded-xl px-4 min-h-[48px]" style={{ color: colors.foreground }} />
            <TextInput value={chUrl} onChangeText={setChUrl} autoCapitalize="none" autoCorrect={false} placeholder={chKind === "slack" ? "https://hooks.slack.com/services/…" : chKind === "wecom" ? "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=…" : chKind === "dingtalk" ? "https://oapi.dingtalk.com/robot/send?access_token=…" : "https://example.com/hooks/golden-memory"} placeholderTextColor={colors.muted} className="bg-surface rounded-xl px-4 min-h-[48px]" style={{ color: colors.foreground }} />
            {(chKind === "dingtalk" || chKind === "webhook") && (
              <TextInput value={chSecret} onChangeText={setChSecret} autoCapitalize="none" autoCorrect={false} secureTextEntry placeholder={chKind === "dingtalk" ? l("加签密钥（可选）", "Signing secret (optional)") : l("Bearer 令牌（可选）", "Bearer token (optional)")} placeholderTextColor={colors.muted} className="bg-surface rounded-xl px-4 min-h-[48px]" style={{ color: colors.foreground }} />
            )}
            <View className="flex-row items-center gap-2">
              <Text className="text-xs text-muted">{l("升级层级", "Escalation tier")}</Text>
              {([1, 2, 3] as const).map((t) => (
                <Pressable key={t} onPress={() => setChTier(t)} accessibilityRole="button" accessibilityState={{ selected: chTier === t }} className="rounded-full px-3 min-h-[36px] justify-center" style={{ backgroundColor: chTier === t ? colors.primary : `${colors.primary}22` }}>
                  <Text className="text-xs font-semibold" style={{ color: chTier === t ? "#fff" : colors.primary }}>{t === 1 ? l("T1 立即", "T1 now") : t === 2 ? l("T2 未确认后", "T2 unacked") : l("T3 二次升级", "T3 2nd")}</Text>
                </Pressable>
              ))}
            </View>
            <Text className="text-xs text-muted">{l("保存前会先发送一条测试消息；URL 与密钥加密存储，不会再次显示。", "A test message is sent before saving; URL and secret are stored encrypted and never shown again.")}</Text>
            <Pressable
              onPress={() => addChannel.mutate({ kind: chKind, name: chName.trim() || l("告警通道", "Alert channel"), url: chUrl.trim(), secret: chSecret.trim() || undefined, test: true, tier: chTier })}
              disabled={addChannel.isPending || chUrl.trim().length < 12}
              accessibilityRole="button"
              className="min-h-[48px] items-center justify-center rounded-2xl bg-primary"
              style={{ opacity: chUrl.trim().length < 12 ? 0.5 : 1 }}
            >
              {addChannel.isPending ? <ActivityIndicator color="#fff" /> : <Text className="text-sm font-semibold text-white">{l("测试并保存", "Test & save")}</Text>}
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </ScreenContainer>
  );
}
