import { Text, View, Pressable, ActivityIndicator, TextInput } from "react-native";
import { useEffect, useState } from "react";
import { useRouter, useLocalSearchParams } from "expo-router";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { useLanguage } from "@/lib/language-provider";
import { useColors } from "@/hooks/use-colors";
import { useAuth } from "@/hooks/use-auth";
import { useFamily } from "@/lib/family-provider";
import { useToast } from "@/components/toast";
import { ScreenContainer } from "@/components/screen-container";
import { UserAvatar } from "@/components/user-avatar";
import { parseInviteCode, setPendingInviteCode } from "@/lib/invite-link";
import { trpc } from "@/lib/trpc";

/**
 * P7 — `/join?code=XXXX` deep-link target.
 *
 *   signed out → park the code, send to login; Home replays it after sign-in
 *   signed in  → family.previewInvitation (name / inviter / members / expiry)
 *                → acceptInvitation → switchFamily → Home
 */
export default function JoinScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ code?: string }>();
  const { t, l } = useLanguage();
  const colors = useColors();
  const toast = useToast();
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { switchFamily, refresh } = useFamily();
  const [code, setCode] = useState<string>(() => parseInviteCode(params.code ?? "") ?? "");
  const [draft, setDraft] = useState("");

  useEffect(() => {
    const parsed = parseInviteCode(params.code ?? "");
    if (parsed) setCode(parsed);
  }, [params.code]);

  // Signed-out: remember the code and go sign in.
  useEffect(() => {
    if (!authLoading && !isAuthenticated && code) {
      void setPendingInviteCode(code).then(() => router.replace("/auth/login" as any));
    }
  }, [authLoading, isAuthenticated, code, router]);

  const preview = trpc.family.previewInvitation.useQuery(
    { code },
    { enabled: isAuthenticated && code.length >= 6, retry: false, staleTime: 15_000 },
  );

  const accept = trpc.family.acceptInvitation.useMutation({
    onSuccess: async ({ familyId }) => {
      await refresh();
      await switchFamily(familyId);
      toast.success(l("已加入家庭", "Joined the family"));
      router.replace("/(tabs)");
    },
    onError: (e) => toast.error(e.message),
  });

  const Header = (
    <View className="flex-row items-center justify-between px-6 py-4 bg-surface">
      <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)"))} className="p-2 min-w-[48px] min-h-[48px] items-center justify-center" accessibilityRole="button">
        <MaterialIcons name="arrow-back" size={24} color={colors.foreground} />
      </Pressable>
      <Text className="text-lg font-bold text-foreground">{l("加入家庭", "Join a family")}</Text>
      <View className="w-12" />
    </View>
  );

  // No code yet → manual entry
  if (!code) {
    return (
      <ScreenContainer className="bg-background p-0">
        {Header}
        <View className="flex-1 px-6 py-8 gap-4">
          <MaterialIcons name="group-add" size={56} color={colors.primary} style={{ alignSelf: "center" }} />
          <Text className="text-base text-muted text-center">{l("粘贴邀请链接或输入 12 位邀请码", "Paste the invite link or enter the 12-character code")}</Text>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            autoCapitalize="characters"
            autoFocus
            placeholder="ABCD1234EFGH"
            placeholderTextColor={colors.muted}
            className="bg-surface rounded-2xl px-4 min-h-[52px] text-foreground font-mono tracking-widest text-center"
            style={{ fontSize: 18 }}
          />
          <Pressable
            onPress={() => {
              const parsed = parseInviteCode(draft);
              if (!parsed) return toast.warning(l("邀请码格式不正确", "That doesn't look like an invite code"));
              setCode(parsed);
            }}
            disabled={!draft.trim()}
            className="rounded-full min-h-[52px] items-center justify-center"
            style={{ backgroundColor: draft.trim() ? colors.primary : colors.border }}
            accessibilityRole="button"
          >
            <Text className="font-semibold text-onPrimary">{t("next")}</Text>
          </Pressable>
        </View>
      </ScreenContainer>
    );
  }

  if (authLoading || !isAuthenticated || preview.isLoading) {
    return (
      <ScreenContainer className="bg-background p-0">
        {Header}
        <View className="flex-1 items-center justify-center gap-3">
          <ActivityIndicator size="large" color={colors.primary} />
          <Text className="text-sm text-muted">{l("正在核对邀请…", "Checking invitation…")}</Text>
        </View>
      </ScreenContainer>
    );
  }

  if (preview.isError || !preview.data) {
    return (
      <ScreenContainer className="bg-background p-0">
        {Header}
        <View className="flex-1 items-center justify-center gap-4 px-8">
          <MaterialIcons name="link-off" size={64} color={colors.error} />
          <Text className="text-xl font-bold text-foreground text-center">{l("邀请码无效", "Invalid invitation")}</Text>
          <Text className="text-sm text-muted text-center">{preview.error?.message ?? ""}</Text>
          <Pressable onPress={() => setCode("")} className="rounded-full px-6 min-h-[48px] items-center justify-center bg-surface" accessibilityRole="button">
            <Text className="font-semibold text-foreground">{l("重新输入", "Enter another code")}</Text>
          </Pressable>
        </View>
      </ScreenContainer>
    );
  }

  const inv = preview.data;
  const unusable = inv.status !== "pending" || inv.expired;
  const expiresText = inv.expiresAt ? new Date(inv.expiresAt).toLocaleDateString() : null;

  return (
    <ScreenContainer className="bg-background p-0">
      {Header}
      <View className="flex-1 px-6 py-8 gap-6">
        <View className="bg-surface rounded-3xl p-6 items-center gap-3">
          <View className="w-20 h-20 rounded-full items-center justify-center" style={{ backgroundColor: `${colors.primary}22` }}>
            <MaterialIcons name="family-restroom" size={40} color={colors.primary} />
          </View>
          <Text className="text-2xl font-bold text-foreground text-center">{inv.family.name}</Text>
          {inv.family.description ? <Text className="text-sm text-muted text-center">{inv.family.description}</Text> : null}
          <Text className="text-sm text-muted">{l(`${inv.family.memberCount} 位成员`, `${inv.family.memberCount} members`)}</Text>
          {inv.inviter && (
            <View className="flex-row items-center gap-2 mt-2">
              <UserAvatar avatar={inv.inviter.avatar} name={inv.inviter.name} size={28} />
              <Text className="text-sm text-foreground">{l(`${inv.inviter.name ?? "家人"} 邀请你加入`, `${inv.inviter.name ?? "A family member"} invited you`)}</Text>
            </View>
          )}
          <Text className="text-xs text-muted font-mono tracking-widest">{inv.code}</Text>
          {expiresText && !inv.expired && <Text className="text-xs text-muted">{l(`有效期至 ${expiresText}`, `Valid until ${expiresText}`)}</Text>}
        </View>

        {inv.alreadyMember ? (
          <View className="gap-3">
            <View className="flex-row items-center gap-2 bg-success/15 rounded-2xl p-4">
              <MaterialIcons name="check-circle" size={22} color={colors.success} />
              <Text className="text-sm text-foreground flex-1">{l("你已经是这个家庭的成员。", "You're already a member of this family.")}</Text>
            </View>
            <Pressable
              onPress={async () => {
                await switchFamily(inv.family.id);
                router.replace("/(tabs)");
              }}
              className="rounded-full min-h-[52px] items-center justify-center"
              style={{ backgroundColor: colors.primary }}
              accessibilityRole="button"
            >
              <Text className="font-semibold text-onPrimary">{l("前往该家庭", "Open this family")}</Text>
            </Pressable>
          </View>
        ) : unusable ? (
          <View className="flex-row items-center gap-2 bg-error/15 rounded-2xl p-4">
            <MaterialIcons name="schedule" size={22} color={colors.error} />
            <Text className="text-sm text-foreground flex-1">
              {inv.expired ? l("这个邀请已过期，请让家人重新发送。", "This invitation has expired — ask for a new one.") : l("这个邀请已被使用或撤销。", "This invitation was already used or revoked.")}
            </Text>
          </View>
        ) : (
          <Pressable
            onPress={() => accept.mutate({ code: inv.code })}
            disabled={accept.isPending}
            className="rounded-full min-h-[56px] items-center justify-center flex-row gap-2"
            style={{ backgroundColor: colors.primary }}
            accessibilityRole="button"
          >
            {accept.isPending ? <ActivityIndicator color={colors.onPrimary} /> : <MaterialIcons name="group-add" size={22} color={colors.onPrimary} />}
            <Text className="text-base font-semibold text-onPrimary">{l("加入家庭", "Join family")}</Text>
          </Pressable>
        )}
        <Pressable onPress={() => router.replace("/(tabs)")} className="min-h-[44px] items-center justify-center" accessibilityRole="button">
          <Text className="text-sm text-muted">{l("暂不加入", "Not now")}</Text>
        </Pressable>
      </View>
    </ScreenContainer>
  );
}
