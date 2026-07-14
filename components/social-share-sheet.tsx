import { View, Text, Pressable, ScrollView, Image } from "react-native";
import { useState } from "react";
import { useColors } from "@/hooks/use-colors";
import { useLanguage } from "@/lib/language-provider";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useSocialShare } from "@/hooks/use-social-share";
import { ShareCard } from "@/lib/social-share-manager";

interface SocialShareSheetProps {
  card: ShareCard;
  onClose?: () => void;
}

export function SocialShareSheet({ card, onClose }: SocialShareSheetProps) {
  const colors = useColors();
  const { language } = useLanguage();
  const { shareToWeChat, shareToFacebook, shareToInstagram, generateQRCode, copyShareLink } =
    useSocialShare();
  const [loading, setLoading] = useState(false);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [showQRCode, setShowQRCode] = useState(false);

  const handleShare = async (platform: "wechat" | "facebook" | "instagram") => {
    setLoading(true);
    try {
      switch (platform) {
        case "wechat":
          await shareToWeChat(card);
          break;
        case "facebook":
          await shareToFacebook(card);
          break;
        case "instagram":
          await shareToInstagram(card);
          break;
      }
      alert(
        language === "zh"
          ? `已分享到${platform === "wechat" ? "微信" : platform === "facebook" ? "Facebook" : "Instagram"}`
          : `Shared to ${platform}`
      );
    } catch (error) {
      alert(language === "zh" ? "分享失败，请重试" : "Failed to share, please try again");
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateQRCode = async () => {
    setLoading(true);
    try {
      const qr = await generateQRCode(card.url);
      setQrCode(qr);
      setShowQRCode(true);
    } catch (error) {
      alert(language === "zh" ? "生成二维码失败" : "Failed to generate QR code");
    } finally {
      setLoading(false);
    }
  };

  const handleCopyLink = async () => {
    setLoading(true);
    try {
      await copyShareLink(card.url);
      alert(language === "zh" ? "链接已复制到剪贴板" : "Link copied to clipboard");
    } catch (error) {
      alert(language === "zh" ? "复制失败，请重试" : "Failed to copy, please try again");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View className="bg-surface rounded-t-3xl">
      <ScrollView showsVerticalScrollIndicator={false} className="p-6">
        {/* 标题 */}
        <View className="gap-2 mb-6">
          <Text className="text-2xl font-bold text-foreground">
            {language === "zh" ? "分享到社交媒体" : "Share to Social Media"}
          </Text>
          <Text className="text-sm text-muted">
            {language === "zh" ? "选择您想要分享的平台" : "Choose a platform to share"}
          </Text>
        </View>

        {/* 分享卡片预览 */}
        <View className="bg-background rounded-xl p-4 mb-6 gap-3">
          <Image
            source={{ uri: card.image }}
            className="w-full h-40 rounded-lg bg-muted"
          />
          <View className="gap-1">
            <Text className="text-base font-bold text-foreground" numberOfLines={2}>
              {card.title}
            </Text>
            <Text className="text-sm text-muted" numberOfLines={2}>
              {card.description}
            </Text>
          </View>
        </View>

        {/* 分享选项 */}
        <View className="gap-3 mb-6">
          {/* 微信 */}
          <Pressable
            onPress={() => handleShare("wechat")}
            disabled={loading}
            className={`flex-row items-center gap-3 bg-background rounded-xl p-4 active:opacity-80 ${
              loading ? "opacity-50" : ""
            }`}
          >
            <View className="w-12 h-12 rounded-full bg-green-500 items-center justify-center">
              <MaterialIcons name="chat" size={24} color="white" />
            </View>
            <View className="flex-1">
              <Text className="text-base font-semibold text-foreground">
                {language === "zh" ? "微信" : "WeChat"}
              </Text>
              <Text className="text-xs text-muted">
                {language === "zh" ? "分享给微信好友或群组" : "Share with WeChat friends"}
              </Text>
            </View>
            <MaterialIcons name="chevron-right" size={24} color={colors.muted} />
          </Pressable>

          {/* Facebook */}
          <Pressable
            onPress={() => handleShare("facebook")}
            disabled={loading}
            className={`flex-row items-center gap-3 bg-background rounded-xl p-4 active:opacity-80 ${
              loading ? "opacity-50" : ""
            }`}
          >
            <View className="w-12 h-12 rounded-full bg-blue-600 items-center justify-center">
              <MaterialIcons name="people" size={24} color="white" />
            </View>
            <View className="flex-1">
              <Text className="text-base font-semibold text-foreground">Facebook</Text>
              <Text className="text-xs text-muted">
                {language === "zh" ? "分享到Facebook" : "Share to Facebook"}
              </Text>
            </View>
            <MaterialIcons name="chevron-right" size={24} color={colors.muted} />
          </Pressable>

          {/* Instagram */}
          <Pressable
            onPress={() => handleShare("instagram")}
            disabled={loading}
            className={`flex-row items-center gap-3 bg-background rounded-xl p-4 active:opacity-80 ${
              loading ? "opacity-50" : ""
            }`}
          >
            <View className="w-12 h-12 rounded-full bg-gradient-to-r from-purple-500 to-pink-500 items-center justify-center">
              <MaterialIcons name="photo-camera" size={24} color="white" />
            </View>
            <View className="flex-1">
              <Text className="text-base font-semibold text-foreground">Instagram</Text>
              <Text className="text-xs text-muted">
                {language === "zh" ? "分享到Instagram" : "Share to Instagram"}
              </Text>
            </View>
            <MaterialIcons name="chevron-right" size={24} color={colors.muted} />
          </Pressable>
        </View>

        {/* 其他选项 */}
        <View className="gap-3 mb-6">
          {/* 生成二维码 */}
          <Pressable
            onPress={handleGenerateQRCode}
            disabled={loading}
            className={`flex-row items-center gap-3 bg-background rounded-xl p-4 active:opacity-80 ${
              loading ? "opacity-50" : ""
            }`}
          >
            <View className="w-12 h-12 rounded-full bg-purple-500 items-center justify-center">
              <MaterialIcons name="qr-code-2" size={24} color="white" />
            </View>
            <View className="flex-1">
              <Text className="text-base font-semibold text-foreground">
                {language === "zh" ? "生成二维码" : "Generate QR Code"}
              </Text>
              <Text className="text-xs text-muted">
                {language === "zh" ? "生成分享链接的二维码" : "Generate QR code for sharing"}
              </Text>
            </View>
            <MaterialIcons name="chevron-right" size={24} color={colors.muted} />
          </Pressable>

          {/* 复制链接 */}
          <Pressable
            onPress={handleCopyLink}
            disabled={loading}
            className={`flex-row items-center gap-3 bg-background rounded-xl p-4 active:opacity-80 ${
              loading ? "opacity-50" : ""
            }`}
          >
            <View className="w-12 h-12 rounded-full bg-orange-500 items-center justify-center">
              <MaterialIcons name="link" size={24} color="white" />
            </View>
            <View className="flex-1">
              <Text className="text-base font-semibold text-foreground">
                {language === "zh" ? "复制链接" : "Copy Link"}
              </Text>
              <Text className="text-xs text-muted">
                {language === "zh" ? "复制分享链接到剪贴板" : "Copy sharing link to clipboard"}
              </Text>
            </View>
            <MaterialIcons name="chevron-right" size={24} color={colors.muted} />
          </Pressable>
        </View>

        {/* 二维码预览 */}
        {showQRCode && qrCode && (
          <View className="bg-background rounded-xl p-4 mb-6 items-center gap-4">
            <Text className="text-base font-semibold text-foreground">
              {language === "zh" ? "分享二维码" : "Share QR Code"}
            </Text>
            <Image source={{ uri: qrCode }} className="w-40 h-40 rounded-lg" />
            <Text className="text-xs text-muted text-center">
              {language === "zh"
                ? "扫描此二维码即可打开分享内容"
                : "Scan this QR code to open the shared content"}
            </Text>
          </View>
        )}

        {/* 关闭按钮 */}
        <Pressable
          onPress={onClose}
          className="bg-muted/20 rounded-lg py-3 items-center mb-4"
        >
          <Text className="text-base font-semibold text-foreground">
            {language === "zh" ? "关闭" : "Close"}
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}
