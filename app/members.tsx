import { ScrollView, Text, View, Pressable, Image, FlatList, TextInput, Modal } from "react-native";
import { useState } from "react";
import { useRouter } from "expo-router";
import { useLanguage } from "@/lib/language-provider";
import { useColors } from "@/hooks/use-colors";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { ScreenContainer } from "@/components/screen-container";

const MOCK_MEMBERS = [
  {
    id: 1,
    name: "陈建国",
    role: "owner",
    roleName: "所有者",
    roleNameEn: "Owner",
    image: "https://images.unsplash.com/photo-1547559906-41b45c308f73?w=80&q=80",
    joinDate: "2024-01-01",
  },
  {
    id: 2,
    name: "李秀英",
    role: "admin",
    roleName: "管理员",
    roleNameEn: "Admin",
    image: "https://images.unsplash.com/photo-1566616213894-2d4e1baee5d8?w=80&q=80",
    joinDate: "2024-01-01",
  },
  {
    id: 3,
    name: "小雅",
    role: "editor",
    roleName: "编辑",
    roleNameEn: "Editor",
    image: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=80&q=80",
    joinDate: "2024-03-15",
  },
  {
    id: 4,
    name: "小明",
    role: "viewer",
    roleName: "查看",
    roleNameEn: "Viewer",
    image: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=80&q=80",
    joinDate: "2024-05-20",
  },
];

const ROLE_OPTIONS = [
  { value: "owner", label: "所有者", labelEn: "Owner", permissions: "完全控制" },
  { value: "admin", label: "管理员", labelEn: "Admin", permissions: "管理成员和内容" },
  { value: "editor", label: "编辑", labelEn: "Editor", permissions: "上传和编辑内容" },
  { value: "viewer", label: "查看", labelEn: "Viewer", permissions: "仅查看内容" },
];

export default function MembersScreen() {
  const router = useRouter();
  const { t, language } = useLanguage();
  const colors = useColors();
  const [members, setMembers] = useState(MOCK_MEMBERS);
  const [inviteEmail, setInviteEmail] = useState("");
  const [selectedRole, setSelectedRole] = useState("viewer");
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showRoleModal, setShowRoleModal] = useState(false);
  const [selectedMember, setSelectedMember] = useState<any>(null);

  const handleInvite = () => {
    if (!inviteEmail.trim()) {
      alert(language === "zh" ? "请输入邮箱地址" : "Please enter email address");
      return;
    }
    alert(
      language === "zh"
        ? `邀请已发送至 ${inviteEmail}`
        : `Invitation sent to ${inviteEmail}`
    );
    setInviteEmail("");
    setShowInviteModal(false);
  };

  const handleChangeRole = (member: any, newRole: string) => {
    setMembers(
      members.map(m =>
        m.id === member.id
          ? {
              ...m,
              role: newRole,
              roleName: ROLE_OPTIONS.find(r => r.value === newRole)?.label ?? m.roleName,
            }
          : m
      )
    );
    setShowRoleModal(false);
  };

  const handleRemoveMember = (memberId: number) => {
    setMembers(members.filter(m => m.id !== memberId));
  };

  const renderMemberItem = ({ item }: any) => (
    <View className="flex-row items-center justify-between bg-surface rounded-2xl p-4 mb-3">
      <View className="flex-row items-center gap-3 flex-1">
        <Image
          source={{ uri: item.image }}
          className="w-12 h-12 rounded-full"
        />
        <View className="flex-1">
          <Text className="font-semibold text-foreground">{item.name}</Text>
          <Text className="text-xs text-muted">
            {language === "zh" ? item.roleName : item.roleNameEn} · {item.joinDate}
          </Text>
        </View>
      </View>

      {item.role !== "owner" && (
        <View className="flex-row items-center gap-2">
          <Pressable
            onPress={() => {
              setSelectedMember(item);
              setShowRoleModal(true);
            }}
            className="p-2"
          >
            <MaterialIcons name="edit" size={20} color={colors.primary} />
          </Pressable>
          <Pressable
            onPress={() => handleRemoveMember(item.id)}
            className="p-2"
          >
            <MaterialIcons name="delete" size={20} color={colors.error} />
          </Pressable>
        </View>
      )}
    </View>
  );

  return (
    <ScreenContainer className="bg-background p-0">
      <ScrollView
        contentContainerStyle={{ flexGrow: 1 }}
        showsVerticalScrollIndicator={false}
      >
        <View className="flex-1">
          {/* 顶部导航 */}
          <View className="flex-row items-center justify-between px-6 py-4 bg-surface">
            <Pressable onPress={() => router.back()} className="p-2">
              <MaterialIcons name="arrow-back" size={24} color={colors.foreground} />
            </Pressable>
            <Text className="text-lg font-bold text-foreground">
              {language === "zh" ? "家庭成员" : "Family Members"}
            </Text>
            <View className="w-10" />
          </View>

          {/* 主要内容 */}
          <View className="flex-1 px-6 py-4 gap-6">
            {/* 成员统计 */}
            <View className="bg-primary rounded-2xl p-4 gap-2">
              <Text className="text-white font-semibold">
                {language === "zh" ? "家庭成员" : "Family Members"}
              </Text>
              <View className="flex-row items-baseline gap-2">
                <Text className="text-3xl font-bold text-white">{members.length}</Text>
                <Text className="text-white/80">
                  {language === "zh" ? "位成员" : "members"}
                </Text>
              </View>
            </View>

            {/* 邀请按钮 */}
            <Pressable
              onPress={() => setShowInviteModal(true)}
              className="flex-row items-center justify-center gap-2 bg-surface rounded-full py-3 border border-primary active:opacity-80"
            >
              <MaterialIcons name="person-add" size={20} color={colors.primary} />
              <Text className="text-sm font-semibold text-primary">
                {language === "zh" ? "邀请成员" : "Invite Member"}
              </Text>
            </Pressable>

            {/* 成员列表 */}
            <View className="gap-3">
              <Text className="text-lg font-bold text-foreground">
                {language === "zh" ? "成员列表" : "Member List"}
              </Text>
              <FlatList
                data={members}
                renderItem={renderMemberItem}
                keyExtractor={(item) => item.id.toString()}
                scrollEnabled={false}
              />
            </View>

            {/* 权限说明 */}
            <View className="gap-3">
              <Text className="text-lg font-bold text-foreground">
                {language === "zh" ? "权限说明" : "Role Permissions"}
              </Text>
              {ROLE_OPTIONS.map((role) => (
                <View
                  key={role.value}
                  className="bg-surface rounded-2xl p-4 gap-1"
                >
                  <Text className="font-semibold text-foreground">
                    {language === "zh" ? role.label : role.labelEn}
                  </Text>
                  <Text className="text-sm text-muted">{role.permissions}</Text>
                </View>
              ))}
            </View>

            {/* 分享链接 */}
            <View className="gap-3">
              <Text className="text-lg font-bold text-foreground">
                {language === "zh" ? "分享链接" : "Share Link"}
              </Text>
              <View className="bg-surface rounded-2xl p-4 flex-row items-center justify-between gap-3">
                <View className="flex-1">
                  <Text className="text-xs text-muted mb-1">
                    {language === "zh" ? "邀请链接" : "Invitation Link"}
                  </Text>
                  <Text className="text-sm font-mono text-foreground" numberOfLines={1}>
                    https://golden-memory.app/invite/abc123xyz
                  </Text>
                </View>
                <Pressable className="p-2">
                  <MaterialIcons name="content-copy" size={20} color={colors.primary} />
                </Pressable>
              </View>
            </View>
          </View>
        </View>
      </ScrollView>

      {/* 邀请模态框 */}
      <Modal
        visible={showInviteModal}
        transparent
        animationType="fade"
      >
        <View className="flex-1 bg-black/50 items-center justify-center p-6">
          <View className="bg-background rounded-3xl p-6 w-full gap-4">
            <Text className="text-2xl font-bold text-foreground">
              {language === "zh" ? "邀请成员" : "Invite Member"}
            </Text>

            <View className="gap-2">
              <Text className="text-sm font-semibold text-foreground">
                {language === "zh" ? "邮箱地址" : "Email Address"}
              </Text>
              <TextInput
                placeholder={language === "zh" ? "输入邮箱地址" : "Enter email address"}
                value={inviteEmail}
                onChangeText={setInviteEmail}
                keyboardType="email-address"
                placeholderTextColor={colors.muted}
                className="bg-surface rounded-2xl px-4 py-3 text-foreground"
              />
            </View>

            <View className="flex-row gap-3">
              <Pressable
                onPress={() => setShowInviteModal(false)}
                className="flex-1 bg-surface rounded-full py-3 items-center justify-center active:opacity-80"
              >
                <Text className="font-semibold text-foreground">
                  {language === "zh" ? "取消" : "Cancel"}
                </Text>
              </Pressable>
              <Pressable
                onPress={handleInvite}
                className="flex-1 bg-primary rounded-full py-3 items-center justify-center active:opacity-80"
              >
                <Text className="font-semibold text-white">
                  {language === "zh" ? "发送邀请" : "Send Invite"}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* 角色选择模态框 */}
      <Modal
        visible={showRoleModal}
        transparent
        animationType="fade"
      >
        <View className="flex-1 bg-black/50 items-center justify-center p-6">
          <View className="bg-background rounded-3xl p-6 w-full gap-4 max-h-96">
            <Text className="text-2xl font-bold text-foreground">
              {language === "zh" ? "更改角色" : "Change Role"}
            </Text>

            <ScrollView showsVerticalScrollIndicator={false}>
              {ROLE_OPTIONS.map((role) => (
                <Pressable
                  key={role.value}
                  onPress={() => handleChangeRole(selectedMember, role.value)}
                  className={`p-4 rounded-2xl mb-2 ${
                    selectedMember?.role === role.value
                      ? "bg-primary"
                      : "bg-surface"
                  }`}
                >
                  <Text
                    className={`font-semibold ${
                      selectedMember?.role === role.value
                        ? "text-white"
                        : "text-foreground"
                    }`}
                  >
                    {language === "zh" ? role.label : role.labelEn}
                  </Text>
                  <Text
                    className={`text-sm ${
                      selectedMember?.role === role.value
                        ? "text-white/80"
                        : "text-muted"
                    }`}
                  >
                    {role.permissions}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>

            <Pressable
              onPress={() => setShowRoleModal(false)}
              className="bg-surface rounded-full py-3 items-center justify-center active:opacity-80"
            >
              <Text className="font-semibold text-foreground">
                {language === "zh" ? "关闭" : "Close"}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
}
