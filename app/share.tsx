import { ScrollView, Text, View, Pressable, Image, TextInput, FlatList, Modal } from "react-native";
import { useState } from "react";
import { useRouter } from "expo-router";
import { useLanguage } from "@/lib/language-provider";
import { useColors } from "@/hooks/use-colors";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { ScreenContainer } from "@/components/screen-container";

const SHARE_OPTIONS = [
  {
    id: 1,
    name: "微信",
    nameEn: "WeChat",
    icon: "wechat",
    color: "#09B981",
  },
  {
    id: 2,
    name: "QQ",
    nameEn: "QQ",
    icon: "qq",
    color: "#0084FF",
  },
  {
    id: 3,
    name: "微博",
    nameEn: "Weibo",
    icon: "weibo",
    color: "#E1306C",
  },
  {
    id: 4,
    name: "Instagram",
    nameEn: "Instagram",
    icon: "instagram",
    color: "#E1306C",
  },
  {
    id: 5,
    name: "Facebook",
    nameEn: "Facebook",
    icon: "facebook",
    color: "#1877F2",
  },
  {
    id: 6,
    name: "WhatsApp",
    nameEn: "WhatsApp",
    icon: "whatsapp",
    color: "#25D366",
  },
];

const SHARED_ALBUMS = [
  {
    id: 1,
    name: "家庭聚会",
    nameEn: "Family Gathering",
    link: "https://golden-memory.app/share/abc123",
    qrCode: "https://images.unsplash.com/photo-1579546069876-e67f89e7e269?w=150&q=80",
    views: 234,
    shares: 45,
  },
  {
    id: 2,
    name: "金婚纪念",
    nameEn: "Golden Anniversary",
    link: "https://golden-memory.app/share/def456",
    qrCode: "https://images.unsplash.com/photo-1579546069876-e67f89e7e269?w=150&q=80",
    views: 567,
    shares: 89,
  },
];

export default function ShareScreen() {
  const router = useRouter();
  const { t, language } = useLanguage();
  const colors = useColors();
  const [selectedAlbum, setSelectedAlbum] = useState(1);
  const [showQRModal, setShowQRModal] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [shareMessage, setShareMessage] = useState("");

  const currentAlbum = SHARED_ALBUMS.find(a => a.id === selectedAlbum);

  const handleShare = (platform: string) => {
    alert(
      language === "zh"
        ? `分享到 ${platform}`
        : `Share to ${platform}`
    );
  };

  const handleCopyLink = () => {
    alert(
      language === "zh"
        ? "分享链接已复制到剪贴板"
        : "Share link copied to clipboard"
    );
  };

  const handleSendInvite = () => {
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

  const renderShareOption = ({ item }: any) => (
    <Pressable
      onPress={() => handleShare(language === "zh" ? item.name : item.nameEn)}
      className="flex-1 mx-2 mb-4 active:opacity-80"
    >
      <View className="gap-2 items-center">
        <View
          className="w-16 h-16 rounded-full items-center justify-center"
          style={{ backgroundColor: item.color + "20" }}
        >
          <MaterialIcons
            name="share"
            size={28}
            color={item.color}
          />
        </View>
        <Text className="text-sm font-semibold text-foreground text-center">
          {language === "zh" ? item.name : item.nameEn}
        </Text>
      </View>
    </Pressable>
  );

  const renderSharedAlbum = ({ item }: any) => (
    <Pressable
      onPress={() => setSelectedAlbum(item.id)}
      className={`mb-3 rounded-2xl p-4 ${
        selectedAlbum === item.id ? "bg-primary/20 border-2 border-primary" : "bg-surface"
      }`}
    >
      <View className="gap-2">
        <Text className="text-lg font-bold text-foreground">
          {language === "zh" ? item.name : item.nameEn}
        </Text>
        <View className="flex-row gap-4">
          <View className="flex-row items-center gap-1">
            <MaterialIcons name="visibility" size={16} color={colors.muted} />
            <Text className="text-xs text-muted">{item.views}</Text>
          </View>
          <View className="flex-row items-center gap-1">
            <MaterialIcons name="share" size={16} color={colors.muted} />
            <Text className="text-xs text-muted">{item.shares}</Text>
          </View>
        </View>
      </View>
    </Pressable>
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
              {language === "zh" ? "分享" : "Share"}
            </Text>
            <View className="w-10" />
          </View>

          {/* 主要内容 */}
          <View className="flex-1 px-6 py-4 gap-6">
            {/* 选择相册 */}
            <View className="gap-3">
              <Text className="text-lg font-bold text-foreground">
                {language === "zh" ? "选择相册" : "Select Album"}
              </Text>
              <FlatList
                data={SHARED_ALBUMS}
                renderItem={renderSharedAlbum}
                keyExtractor={(item) => item.id.toString()}
                scrollEnabled={false}
              />
            </View>

            {/* 分享链接和二维码 */}
            {currentAlbum && (
              <View className="gap-3">
                <Text className="text-lg font-bold text-foreground">
                  {language === "zh" ? "分享链接" : "Share Link"}
                </Text>

                <View className="bg-surface rounded-2xl p-4 gap-3">
                  {/* 分享链接 */}
                  <View className="gap-2">
                    <Text className="text-sm text-muted">
                      {language === "zh" ? "链接地址" : "Link Address"}
                    </Text>
                    <View className="flex-row items-center gap-2 bg-background rounded-lg px-3 py-2">
                      <Text className="flex-1 text-xs text-foreground font-mono">
                        {currentAlbum.link}
                      </Text>
                      <Pressable onPress={handleCopyLink} className="p-2">
                        <MaterialIcons name="content-copy" size={18} color={colors.primary} />
                      </Pressable>
                    </View>
                  </View>

                  {/* 二维码 */}
                  <View className="gap-2">
                    <Text className="text-sm text-muted">
                      {language === "zh" ? "二维码" : "QR Code"}
                    </Text>
                    <Pressable
                      onPress={() => setShowQRModal(true)}
                      className="items-center py-4 active:opacity-80"
                    >
                      <Image
                        source={{ uri: currentAlbum.qrCode }}
                        className="w-32 h-32 rounded-lg"
                      />
                    </Pressable>
                  </View>
                </View>
              </View>
            )}

            {/* 社交分享 */}
            <View className="gap-3">
              <Text className="text-lg font-bold text-foreground">
                {language === "zh" ? "分享到社交媒体" : "Share to Social Media"}
              </Text>
              <FlatList
                data={SHARE_OPTIONS}
                renderItem={renderShareOption}
                keyExtractor={(item) => item.id.toString()}
                numColumns={3}
                scrollEnabled={false}
                columnWrapperStyle={{ gap: 0 }}
              />
            </View>

            {/* 分享消息 */}
            <View className="gap-3">
              <Text className="text-lg font-bold text-foreground">
                {language === "zh" ? "分享消息" : "Share Message"}
              </Text>
              <TextInput
                placeholder={language === "zh" ? "输入分享消息（可选）" : "Enter share message (optional)"}
                value={shareMessage}
                onChangeText={setShareMessage}
                placeholderTextColor={colors.muted}
                className="bg-surface rounded-2xl px-4 py-3 text-foreground h-24"
                multiline
                maxLength={200}
              />
              <Text className="text-xs text-muted text-right">
                {shareMessage.length}/200
              </Text>
            </View>

            {/* 邀请成员 */}
            <View className="gap-3">
              <Text className="text-lg font-bold text-foreground">
                {language === "zh" ? "邀请成员" : "Invite Members"}
              </Text>
              <Pressable
                onPress={() => setShowInviteModal(true)}
                className="flex-row items-center justify-center gap-2 bg-primary rounded-full py-3 active:opacity-80"
              >
                <MaterialIcons name="person-add" size={20} color="white" />
                <Text className="text-white font-bold text-lg">
                  {language === "zh" ? "邀请成员" : "Invite Members"}
                </Text>
              </Pressable>
            </View>

            {/* 分享统计 */}
            {currentAlbum && (
              <View className="gap-3">
                <Text className="text-lg font-bold text-foreground">
                  {language === "zh" ? "分享统计" : "Share Statistics"}
                </Text>
                <View className="flex-row gap-3">
                  <View className="flex-1 bg-surface rounded-2xl p-4 items-center gap-2">
                    <MaterialIcons name="visibility" size={28} color={colors.primary} />
                    <Text className="text-2xl font-bold text-foreground">
                      {currentAlbum.views}
                    </Text>
                    <Text className="text-xs text-muted">
                      {language === "zh" ? "浏览次数" : "Views"}
                    </Text>
                  </View>
                  <View className="flex-1 bg-surface rounded-2xl p-4 items-center gap-2">
                    <MaterialIcons name="share" size={28} color={colors.primary} />
                    <Text className="text-2xl font-bold text-foreground">
                      {currentAlbum.shares}
                    </Text>
                    <Text className="text-xs text-muted">
                      {language === "zh" ? "分享次数" : "Shares"}
                    </Text>
                  </View>
                </View>
              </View>
            )}
          </View>
        </View>
      </ScrollView>

      {/* 二维码模态框 */}
      <Modal
        visible={showQRModal}
        transparent
        animationType="fade"
      >
        <View className="flex-1 bg-black/50 items-center justify-center p-6">
          <View className="bg-background rounded-3xl p-6 gap-4 items-center">
            <Text className="text-2xl font-bold text-foreground">
              {language === "zh" ? "分享二维码" : "Share QR Code"}
            </Text>
            {currentAlbum && (
              <Image
                source={{ uri: currentAlbum.qrCode }}
                className="w-48 h-48 rounded-lg"
              />
            )}
            <Pressable
              onPress={() => setShowQRModal(false)}
              className="bg-primary rounded-full px-6 py-3 active:opacity-80"
            >
              <Text className="text-white font-bold">
                {language === "zh" ? "关闭" : "Close"}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* 邀请成员模态框 */}
      <Modal
        visible={showInviteModal}
        transparent
        animationType="fade"
      >
        <View className="flex-1 bg-black/50 items-center justify-center p-6">
          <View className="bg-background rounded-3xl p-6 w-full gap-4">
            <Text className="text-2xl font-bold text-foreground">
              {language === "zh" ? "邀请成员" : "Invite Members"}
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
                onPress={handleSendInvite}
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
    </ScreenContainer>
  );
}
