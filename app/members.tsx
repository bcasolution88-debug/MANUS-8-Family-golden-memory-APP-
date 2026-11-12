import { ScrollView, Text, View, Pressable, TextInput, Modal, ActivityIndicator, RefreshControl } from "react-native";
import { UserAvatar } from "@/components/user-avatar";
import { useState } from "react";
import { useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { useLanguage } from "@/lib/language-provider";
import { useColors } from "@/hooks/use-colors";
import { useAuth } from "@/hooks/use-auth";
import { useFamilyId } from "@/hooks/use-family-id";
import { useBackHandler } from "@/hooks/use-back-handler";
import { useToast } from "@/components/toast";
import { ScreenContainer } from "@/components/screen-container";
import { FamilySwitcher } from "@/components/family-switcher";
import { trpc } from "@/lib/trpc";
import { shareInvite } from "@/lib/invite-link";

type Role = "owner" | "admin" | "editor" | "viewer";
type AssignableRole = Exclude<Role, "owner">;

const ROLE_OPTIONS: { value: AssignableRole; label: string; labelEn: string; permissions: string; permissionsEn: string }[] = [
  { value: "admin", label: "管理员", labelEn: "Admin", permissions: "管理成员和所有内容", permissionsEn: "Manage members and all content" },
  { value: "editor", label: "编辑", labelEn: "Editor", permissions: "上传和编辑自己的内容", permissionsEn: "Upload and edit own content" },
  { value: "viewer", label: "查看", labelEn: "Viewer", permissions: "仅查看内容", permissionsEn: "View only" },
];

const ROLE_LABEL: Record<Role, [string, string]> = {
  owner: ["所有者", "Owner"],
  admin: ["管理员", "Admin"],
  editor: ["编辑", "Editor"],
  viewer: ["查看", "Viewer"],
};

/**
 * Members (P6 — real data).
 * family.getMembers → list; inviteByEmail (existing user → added immediately,
 * otherwise a 7-day code) ; listInvitations / revokeInvitation ; updateMemberRole
 * (owner immutable) ; removeMember (owner never, self-leave allowed).
 * Admin-only actions are hidden for editors / viewers.
 */
export default function MembersScreen() {
  const router = useRouter();
  const { t, l, language } = useLanguage();
  const colors = useColors();
  const toast = useToast();
  const utils = trpc.useUtils();
  const { user } = useAuth();
  const { familyId, family, isAuthenticated } = useFamilyId();

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<AssignableRole>("editor");
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [roleTarget, setRoleTarget] = useState<{ userId: number; name: string; role: Role } | null>(null);
  const [removeTarget, setRemoveTarget] = useState<{ userId: number; name: string } | null>(null);
  const [lastCode, setLastCode] = useState<string | null>(null);

  useBackHandler(showInviteModal || !!roleTarget || !!removeTarget, () => {
    setShowInviteModal(false);
    setRoleTarget(null);
    setRemoveTarget(null);
    return true;
  });

  /* ------------------------------ data ------------------------------ */

  const members = trpc.family.getMembers.useQuery({ familyId: familyId ?? 0 }, { enabled: isAuthenticated && !!familyId });
  const invites = trpc.family.listInvitations.useQuery({ familyId: familyId ?? 0 }, { enabled: isAuthenticated && !!familyId });

  const me = members.data?.find((m) => m.userId === user?.id);
  const isAdmin = me?.role === "owner" || me?.role === "admin";
  const isOwner = me?.role === "owner";

  const invalidate = () => Promise.all([utils.family.getMembers.invalidate(), utils.family.listInvitations.invalidate(), utils.family.getUserFamilies.invalidate()]);

  const invite = trpc.family.inviteByEmail.useMutation({
    onSuccess: async (r) => {
      await invalidate();
      setInviteEmail("");
      setShowInviteModal(false);
      if (r.status === "added") {
        toast.success(l("对方已是用户，已直接加入家庭", "Already a user — added to the family"));
      } else {
        setLastCode(r.code);
        await Clipboard.setStringAsync(r.code);
        toast.success(l(`邀请码 ${r.code} 已复制，7 天内有效`, `Code ${r.code} copied — valid 7 days`));
      }
    },
    onError: (e) => toast.error(e.message),
  });
  const revokeInvite = trpc.family.revokeInvitation.useMutation({
    onSuccess: () => invalidate(),
    onError: (e) => toast.error(e.message),
  });
  const updateRole = trpc.family.updateMemberRole.useMutation({
    onSuccess: async () => {
      await invalidate();
      setRoleTarget(null);
      toast.success(l("角色已更新", "Role updated"));
    },
    onError: (e) => toast.error(e.message),
  });
  const remove = trpc.family.removeMember.useMutation({
    onSuccess: async (_r, vars) => {
      await invalidate();
      setRemoveTarget(null);
      if (vars.userId === user?.id) {
        toast.success(l("已退出家庭", "You left the family"));
        router.replace("/(tabs)" as any);
      } else {
        toast.success(l("成员已移除", "Member removed"));
      }
    },
    onError: (e) => toast.error(e.message),
  });

  const locale = language === "zh" ? "zh-CN" : "en-US";
  const list = members.data ?? [];

  /* ----------------------------- render ----------------------------- */

  return (
    <ScreenContainer className="bg-background p-0">
      <ScrollView
        contentContainerStyle={{ flexGrow: 1 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={members.isRefetching} onRefresh={() => invalidate()} tintColor={colors.primary} />}
      >
        <View className="flex-1">
          <View className="flex-row items-center justify-between px-6 py-4 bg-surface">
            <Pressable onPress={() => router.back()} className="p-2 min-w-[48px] min-h-[48px] items-center justify-center">
              <MaterialIcons name="arrow-back" size={24} color={colors.foreground} />
            </Pressable>
            <Text className="text-lg font-bold text-foreground">{t("familyMembers")}</Text>
            {isAdmin ? (
              <Pressable
                onPress={() => setShowInviteModal(true)}
                accessibilityLabel={t("members.inviteMember")}
                className="p-2 min-w-[48px] min-h-[48px] items-center justify-center"
              >
                <MaterialIcons name="person-add" size={24} color={colors.primary} />
              </Pressable>
            ) : (
              <View className="w-12" />
            )}
          </View>

          <View className="flex-1 px-6 py-4 gap-6">
            {!isAuthenticated ? (
              <Empty icon="lock-outline" text={t("messages.signInToSee")} />
            ) : (
              <>
                {/* 家庭 */}
                <FamilySwitcher variant="row" />

                {/* 成员列表 */}
                <View className="gap-3">
                  <View className="flex-row items-center justify-between">
                    <Text className="text-lg font-bold text-foreground">{t("members.memberList")}</Text>
                    <Text className="text-sm text-muted">
                      {list.length} {t("members.members")}
                    </Text>
                  </View>
                  {members.isLoading ? (
                    <ActivityIndicator color={colors.primary} />
                  ) : members.isError ? (
                    <Empty icon="cloud-off" text={t("messages.loadFailed")} />
                  ) : (
                    list.map((m) => {
                      const role = m.role as Role;
                      const isMe = m.userId === user?.id;
                      const name = m.user.name ?? t("notif.someone");
                      const canEdit = isAdmin && role !== "owner" && !isMe;
                      const canRemove = (isAdmin && role !== "owner" && !isMe) || (isMe && role !== "owner");
                      return (
                        <View key={m.id} className="flex-row items-center justify-between bg-surface rounded-2xl p-4 min-h-[72px]">
                          <View className="flex-row items-center gap-3 flex-1">
                            <UserAvatar avatar={m.user.avatar} name={name} size={48} bgClassName="bg-primary" textClassName="text-onPrimary" />
                            <View className="flex-1">
                              <View className="flex-row items-center gap-2">
                                <Text className="font-semibold text-foreground" numberOfLines={1}>{name}</Text>
                                {isMe && <Text className="text-xs text-primary font-semibold">{l("我", "me")}</Text>}
                                {role === "owner" && <MaterialIcons name="star" size={14} color={colors.primary} />}
                              </View>
                              <Text className="text-xs text-muted">
                                {l(...ROLE_LABEL[role])} · {new Date(m.joinedAt).toLocaleDateString(locale)}
                              </Text>
                            </View>
                          </View>
                          <View className="flex-row items-center">
                            {canEdit && (
                              <Pressable
                                onPress={() => setRoleTarget({ userId: m.userId, name, role })}
                                accessibilityLabel={t("members.changeRole")}
                                className="p-2 min-w-[48px] min-h-[48px] items-center justify-center"
                              >
                                <MaterialIcons name="edit" size={20} color={colors.primary} />
                              </Pressable>
                            )}
                            {canRemove && (
                              <Pressable
                                onPress={() => setRemoveTarget({ userId: m.userId, name })}
                                accessibilityLabel={isMe ? l("退出家庭", "Leave family") : l("移除成员", "Remove member")}
                                className="p-2 min-w-[48px] min-h-[48px] items-center justify-center"
                              >
                                <MaterialIcons name={isMe ? "logout" : "person-remove"} size={20} color={colors.error} />
                              </Pressable>
                            )}
                          </View>
                        </View>
                      );
                    })
                  )}
                </View>

                {/* 待接受邀请 */}
                {isAdmin && (invites.data?.length ?? 0) > 0 && (
                  <View className="gap-3">
                    <Text className="text-lg font-bold text-foreground">{l("待接受的邀请", "Pending invitations")}</Text>
                    {invites.data!.map((inv) => (
                      <View key={inv.id} className="flex-row items-center justify-between bg-surface rounded-2xl p-4 min-h-[64px]">
                        <View className="flex-1 gap-0.5">
                          <Text className="font-semibold text-foreground" numberOfLines={1}>{inv.invitedEmail}</Text>
                          <Text className="text-xs text-muted">
                            {inv.invitationCode} · {inv.expiresAt ? `${l("有效至", "until")} ${new Date(inv.expiresAt).toLocaleDateString(locale)}` : ""}
                          </Text>
                        </View>
                        <Pressable
                          onPress={async () => {
                            if (inv.invitationCode) {
                              await Clipboard.setStringAsync(inv.invitationCode);
                              toast.success(t("share.shareLinkCopiedTo"));
                            }
                          }}
                          accessibilityLabel={l("复制邀请码", "Copy code")}
                          className="p-2 min-w-[48px] min-h-[48px] items-center justify-center"
                        >
                          <MaterialIcons name="content-copy" size={18} color={colors.primary} />
                        </Pressable>
                        <Pressable
                          onPress={() => inv.invitationCode && shareInvite(inv.invitationCode, family?.name ?? "", l(true, false))}
                          accessibilityLabel={l("分享邀请链接", "Share invite link")}
                          className="p-2 min-w-[48px] min-h-[48px] items-center justify-center"
                        >
                          <MaterialIcons name="share" size={18} color={colors.primary} />
                        </Pressable>
                        <Pressable
                          onPress={() => revokeInvite.mutate({ id: inv.id })}
                          disabled={revokeInvite.isPending}
                          className="p-2 min-w-[48px] min-h-[48px] items-center justify-center"
                        >
                          <MaterialIcons name="close" size={18} color={colors.error} />
                        </Pressable>
                      </View>
                    ))}
                  </View>
                )}

                {/* 邀请按钮 */}
                {isAdmin && (
                  <Pressable
                    onPress={() => setShowInviteModal(true)}
                    className="flex-row items-center justify-center gap-2 bg-primary rounded-full py-3 min-h-[48px] active:opacity-80"
                  >
                    <MaterialIcons name="person-add" size={20} color={colors.onPrimary} />
                    <Text className="text-onPrimary font-bold text-lg">{t("members.inviteMember")}</Text>
                  </Pressable>
                )}

                {/* 权限说明 */}
                <View className="gap-3">
                  <Text className="text-lg font-bold text-foreground">{t("members.rolePermissions")}</Text>
                  <View className="bg-surface rounded-2xl p-4 gap-3">
                    <View className="flex-row items-start gap-3">
                      <MaterialIcons name="star" size={18} color={colors.primary} />
                      <View className="flex-1">
                        <Text className="font-semibold text-foreground">{l("所有者", "Owner")}</Text>
                        <Text className="text-xs text-muted">{l("家庭创建者，完全控制，不可移除", "Family creator; full control; cannot be removed")}</Text>
                      </View>
                    </View>
                    {ROLE_OPTIONS.map((r) => (
                      <View key={r.value} className="flex-row items-start gap-3">
                        <MaterialIcons name={r.value === "admin" ? "admin-panel-settings" : r.value === "editor" ? "edit" : "visibility"} size={18} color={colors.muted} />
                        <View className="flex-1">
                          <Text className="font-semibold text-foreground">{l(r.label, r.labelEn)}</Text>
                          <Text className="text-xs text-muted">{l(r.permissions, r.permissionsEn)}</Text>
                        </View>
                      </View>
                    ))}
                  </View>
                </View>
              </>
            )}
          </View>
        </View>
      </ScrollView>

      {/* 邀请弹层 */}
      <Modal visible={showInviteModal} transparent animationType="fade" onRequestClose={() => setShowInviteModal(false)}>
        <View className="flex-1 bg-black/50 items-center justify-center p-6">
          <View className="bg-background rounded-3xl p-6 w-full gap-4">
            <Text className="text-2xl font-bold text-foreground">{t("members.inviteMember")}</Text>
            <Text className="text-xs text-muted">{l(`邀请加入「${family?.name ?? ""}」`, `Invite to “${family?.name ?? ""}”`)}</Text>
            <View className="gap-2">
              <Text className="text-sm font-semibold text-foreground">{t("common.emailAddress")}</Text>
              <TextInput
                placeholder={t("common.enterEmailAddress")}
                value={inviteEmail}
                onChangeText={setInviteEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoFocus
                placeholderTextColor={colors.muted}
                className="bg-surface rounded-2xl px-4 py-3 min-h-[48px] text-foreground"
              />
            </View>
            <View className="gap-2">
              <Text className="text-sm font-semibold text-foreground">{t("selectRole")}</Text>
              <View className="flex-row gap-2">
                {ROLE_OPTIONS.map((r) => (
                  <Pressable
                    key={r.value}
                    onPress={() => setInviteRole(r.value)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: inviteRole === r.value }}
                    className={`flex-1 py-2 min-h-[44px] items-center justify-center rounded-full ${inviteRole === r.value ? "bg-primary" : "bg-surface"}`}
                  >
                    <Text className={`text-sm font-semibold ${inviteRole === r.value ? "text-onPrimary" : "text-foreground"}`}>{l(r.label, r.labelEn)}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
            <Text className="text-xs text-muted">
              {l("若对方已注册会立即加入；否则生成 7 天有效的邀请码，请发送给对方在「切换家庭 → 邀请码加入」中使用。", "Existing users are added right away; otherwise a 7-day code is generated for them to redeem under Switch family → Join.")}
            </Text>
            <View className="flex-row gap-3">
              <Pressable onPress={() => setShowInviteModal(false)} className="flex-1 bg-surface rounded-full py-3 min-h-[48px] items-center justify-center active:opacity-80">
                <Text className="font-semibold text-foreground">{t("cancel")}</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  if (!inviteEmail.trim()) return toast.warning(t("common.pleaseEnterEmailAddress"));
                  if (familyId) invite.mutate({ familyId, email: inviteEmail.trim(), role: inviteRole });
                }}
                disabled={invite.isPending}
                className="flex-1 bg-primary rounded-full py-3 min-h-[48px] items-center justify-center active:opacity-80"
              >
                {invite.isPending ? <ActivityIndicator color={colors.onPrimary} /> : <Text className="font-semibold text-onPrimary">{t("common.sendInvite")}</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* 更改角色 */}
      <Modal visible={!!roleTarget} transparent animationType="fade" onRequestClose={() => setRoleTarget(null)}>
        <View className="flex-1 bg-black/50 items-center justify-center p-6">
          <View className="bg-background rounded-3xl p-6 w-full gap-4">
            <Text className="text-2xl font-bold text-foreground">{t("members.changeRole")}</Text>
            <Text className="text-sm text-muted">{roleTarget?.name}</Text>
            {ROLE_OPTIONS.filter((r) => isOwner || r.value !== "admin" || roleTarget?.role === "admin").map((r) => {
              const current = roleTarget?.role === r.value;
              return (
                <Pressable
                  key={r.value}
                  disabled={current || updateRole.isPending}
                  onPress={() => roleTarget && updateRole.mutate({ familyId: familyId!, userId: roleTarget.userId, role: r.value })}
                  className={`flex-row items-center justify-between p-4 min-h-[56px] rounded-2xl ${current ? "bg-primary/15" : "bg-surface"} active:opacity-80`}
                >
                  <View className="flex-1">
                    <Text className={`font-semibold ${current ? "text-primary" : "text-foreground"}`}>{l(r.label, r.labelEn)}</Text>
                    <Text className="text-xs text-muted">{l(r.permissions, r.permissionsEn)}</Text>
                  </View>
                  {current && <MaterialIcons name="check-circle" size={22} color={colors.primary} />}
                </Pressable>
              );
            })}
            <Pressable onPress={() => setRoleTarget(null)} className="bg-surface rounded-full py-3 min-h-[48px] items-center justify-center">
              <Text className="font-semibold text-foreground">{t("cancel")}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* 移除 / 退出确认 */}
      <Modal visible={!!removeTarget} transparent animationType="fade" onRequestClose={() => setRemoveTarget(null)}>
        <View className="flex-1 bg-black/50 items-center justify-center p-6">
          <View className="bg-background rounded-3xl p-6 w-full gap-4">
            <View className="flex-row items-center gap-2">
              <MaterialIcons name="warning" size={24} color={colors.error} />
              <Text className="text-2xl font-bold text-foreground">
                {removeTarget?.userId === user?.id ? l("退出家庭", "Leave family") : l("移除成员", "Remove member")}
              </Text>
            </View>
            <Text className="text-sm text-muted">
              {removeTarget?.userId === user?.id
                ? l("退出后将无法查看该家庭的相册，需重新受邀才能加入。", "You will lose access to this family's albums until invited again.")
                : l(`确定要移除「${removeTarget?.name ?? ""}」吗？对方将立即失去访问权限。`, `Remove “${removeTarget?.name ?? ""}”? They lose access immediately.`)}
            </Text>
            <View className="flex-row gap-3">
              <Pressable onPress={() => setRemoveTarget(null)} className="flex-1 bg-surface rounded-full py-3 min-h-[48px] items-center justify-center">
                <Text className="font-semibold text-foreground">{t("cancel")}</Text>
              </Pressable>
              <Pressable
                disabled={remove.isPending}
                onPress={() => removeTarget && familyId && remove.mutate({ familyId, userId: removeTarget.userId })}
                className="flex-1 rounded-full py-3 min-h-[48px] items-center justify-center"
                style={{ backgroundColor: colors.error }}
              >
                {remove.isPending ? <ActivityIndicator color="#fff" /> : <Text className="font-semibold text-white">{l("确认", "Confirm")}</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* 最近生成的邀请码 */}
      {lastCode && (
        <Pressable
          onPress={async () => {
            await Clipboard.setStringAsync(lastCode);
            toast.success(t("share.shareLinkCopiedTo"));
          }}
          className="absolute bottom-6 left-6 right-6 bg-surface border border-primary rounded-2xl p-4 flex-row items-center justify-between"
        >
          <View className="flex-1">
            <Text className="text-xs text-muted">{l("最新邀请码（点击复制）", "Latest invite code (tap to copy)")}</Text>
            <Text className="text-lg font-bold text-primary tracking-widest font-mono">{lastCode}</Text>
          </View>
          <Pressable
            onPress={() => shareInvite(lastCode, family?.name ?? "", l(true, false))}
            hitSlop={8}
            accessibilityLabel={l("分享邀请链接", "Share invite link")}
            className="min-w-[44px] min-h-[44px] items-center justify-center"
          >
            <MaterialIcons name="share" size={20} color={colors.primary} />
          </Pressable>
          <Pressable onPress={() => setLastCode(null)} hitSlop={8} className="min-w-[44px] min-h-[44px] items-center justify-center">
            <MaterialIcons name="close" size={20} color={colors.muted} />
          </Pressable>
        </Pressable>
      )}
    </ScreenContainer>
  );
}

function Empty({ icon, text }: { icon: keyof typeof MaterialIcons.glyphMap; text: string }) {
  const colors = useColors();
  return (
    <View className="items-center justify-center gap-2 py-16">
      <MaterialIcons name={icon} size={48} color={colors.muted} />
      <Text className="text-base font-semibold text-foreground text-center">{text}</Text>
    </View>
  );
}
