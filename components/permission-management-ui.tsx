import React, { useState } from "react";
import { View, Text, ScrollView, Pressable, TextInput } from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useLanguage } from "@/lib/language-provider";
import { cn } from "@/lib/utils";

export interface PermissionMember {
  id: string;
  name: string;
  email: string;
  role: "owner" | "admin" | "member" | "viewer" | "guest";
  joinedAt: number;
  avatar?: string;
}

export interface PermissionManagementUIProps {
  familyId: string;
  members: PermissionMember[];
  currentUserRole: "owner" | "admin" | "member" | "viewer" | "guest";
  onRoleChange?: (memberId: string, newRole: string) => void;
  onRemoveMember?: (memberId: string) => void;
  onInviteMember?: (email: string) => void;
  onGenerateInviteLink?: () => void;
}

export function PermissionManagementUI({
  familyId,
  members,
  currentUserRole,
  onRoleChange,
  onRemoveMember,
  onInviteMember,
  onGenerateInviteLink,
}: PermissionManagementUIProps) {
  const colors = useColors();
  const { t } = useLanguage();
  const [inviteEmail, setInviteEmail] = useState("");
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [showRoleMenu, setShowRoleMenu] = useState(false);

  const roleOptions = [
    { value: "owner", label: "所有者 / Owner" },
    { value: "admin", label: "管理员 / Admin" },
    { value: "member", label: "成员 / Member" },
    { value: "viewer", label: "查看者 / Viewer" },
    { value: "guest", label: "访客 / Guest" },
  ];

  const canManageRoles = currentUserRole === "owner" || currentUserRole === "admin";

  const handleInvite = () => {
    if (inviteEmail.trim()) {
      onInviteMember?.(inviteEmail);
      setInviteEmail("");
    }
  };

  const handleRoleChange = (memberId: string, newRole: string) => {
    onRoleChange?.(memberId, newRole);
    setShowRoleMenu(false);
    setSelectedMemberId(null);
  };

  const handleRemoveMember = (memberId: string) => {
    onRemoveMember?.(memberId);
  };

  return (
    <ScreenContainer className="flex-1">
      <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
        <View className="p-4 gap-6">
          {/* 标题 */}
          <View className="gap-2">
            <Text className="text-2xl font-bold text-foreground">
              {t("permissionManagement") || "权限管理"}
            </Text>
            <Text className="text-sm text-muted">
              {t("manageFamily") || "管理家庭成员和权限"}
            </Text>
          </View>

          {/* 邀请成员部分 */}
          {canManageRoles && (
            <View className="bg-surface rounded-lg p-4 gap-3">
              <Text className="font-semibold text-foreground">
                {t("inviteMembers") || "邀请成员"}
              </Text>

              <View className="flex-row gap-2">
                <TextInput
                  className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-foreground"
                  placeholder={t("emailAddress") || "邮箱地址"}
                  placeholderTextColor={colors.muted}
                  value={inviteEmail}
                  onChangeText={setInviteEmail}
                  keyboardType="email-address"
                />
                <Pressable
                  className="bg-primary rounded-lg px-4 py-2 justify-center"
                  onPress={handleInvite}
                >
                  <Text className="text-background font-semibold text-sm">
                    {t("invite") || "邀请"}
                  </Text>
                </Pressable>
              </View>

              <Pressable
                className="bg-background border border-border rounded-lg px-3 py-2"
                onPress={onGenerateInviteLink}
              >
                <Text className="text-primary font-semibold text-center">
                  {t("generateInviteLink") || "生成邀请链接"}
                </Text>
              </Pressable>
            </View>
          )}

          {/* 成员列表 */}
          <View className="gap-3">
            <Text className="font-semibold text-foreground">
              {t("members") || "成员"} ({members.length})
            </Text>

            {members.map((member: PermissionMember) => (
              <View
                key={member.id}
                className="bg-surface rounded-lg p-4 flex-row items-center justify-between"
              >
                <View className="flex-1 gap-1">
                  <Text className="font-semibold text-foreground">{member.name}</Text>
                  <Text className="text-xs text-muted">{member.email}</Text>
                  <Text className="text-xs text-muted">
                    {t("joinedAt") || "加入于"}: {new Date(member.joinedAt).toLocaleDateString()}
                  </Text>
                </View>

                <View className="gap-2 items-end">
                  {canManageRoles ? (
                    <Pressable
                      className="bg-primary rounded-lg px-3 py-1"
                      onPress={() => {
                        setSelectedMemberId(member.id);
                        setShowRoleMenu(true);
                      }}
                    >
                      <Text className="text-background text-xs font-semibold">
                        {member.role.toUpperCase()}
                      </Text>
                    </Pressable>
                  ) : (
                    <View className="bg-border rounded-lg px-3 py-1">
                      <Text className="text-foreground text-xs font-semibold">
                        {member.role.toUpperCase()}
                      </Text>
                    </View>
                  )}

                  {canManageRoles && member.role !== "owner" && (
                    <Pressable
                      className="bg-error rounded-lg px-3 py-1"
                      onPress={() => handleRemoveMember(member.id)}
                    >
                      <Text className="text-background text-xs font-semibold">
                        {t("remove") || "移除"}
                      </Text>
                    </Pressable>
                  )}
                </View>
              </View>
            ))}
          </View>

          {/* 角色菜单 */}
          {showRoleMenu && selectedMemberId && (
            <View className="bg-surface rounded-lg p-3 gap-2">
              <Text className="font-semibold text-foreground text-sm">
                {t("selectRole") || "选择角色"}
              </Text>

              {roleOptions.map(option => (
                <Pressable
                  key={option.value}
                  className="bg-background rounded-lg px-3 py-2"
                  onPress={() => handleRoleChange(selectedMemberId, option.value)}
                >
                  <Text className="text-foreground text-sm">{option.label}</Text>
                </Pressable>
              ))}

              <Pressable
                className="bg-border rounded-lg px-3 py-2 mt-2"
                onPress={() => {
                  setShowRoleMenu(false);
                  setSelectedMemberId(null);
                }}
              >
                <Text className="text-foreground text-sm text-center">
                  {t("cancel") || "取消"}
                </Text>
              </Pressable>
            </View>
          )}

          {/* 权限说明 */}
          <View className="bg-surface rounded-lg p-4 gap-3">
            <Text className="font-semibold text-foreground">
              {t("rolePermissions") || "角色权限说明"}
            </Text>

            <View className="gap-2 text-xs">
              <Text className="text-foreground">
                <Text className="font-semibold">Owner / 所有者：</Text> 完全控制权限
              </Text>
              <Text className="text-foreground">
                <Text className="font-semibold">Admin / 管理员：</Text> 管理内容和成员
              </Text>
              <Text className="text-foreground">
                <Text className="font-semibold">Member / 成员：</Text> 查看、编辑和分享
              </Text>
              <Text className="text-foreground">
                <Text className="font-semibold">Viewer / 查看者：</Text> 仅查看和下载
              </Text>
              <Text className="text-foreground">
                <Text className="font-semibold">Guest / 访客：</Text> 仅查看
              </Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
