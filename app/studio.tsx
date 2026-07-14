import { ScrollView, Text, View, Pressable, Image, FlatList } from "react-native";
import { useState } from "react";
import { useRouter } from "expo-router";
import { useLanguage } from "@/lib/language-provider";
import { useColors } from "@/hooks/use-colors";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { ScreenContainer } from "@/components/screen-container";

const VIDEO_TEMPLATES = [
  {
    id: 1,
    name: "浪漫爱情",
    nameEn: "Romantic Love",
    description: "温馨的爱情故事",
    descriptionEn: "Warm love story",
    thumbnail: "https://images.unsplash.com/photo-1511895426328-dc8714191011?w=200&q=80",
    duration: "3:00",
    music: "Romance",
  },
  {
    id: 2,
    name: "家庭聚会",
    nameEn: "Family Gathering",
    description: "欢乐的家庭时光",
    descriptionEn: "Happy family moments",
    thumbnail: "https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=200&q=80",
    duration: "2:30",
    music: "Joy",
  },
  {
    id: 3,
    name: "旅游回忆",
    nameEn: "Travel Memories",
    description: "精彩的旅游瞬间",
    descriptionEn: "Amazing travel moments",
    thumbnail: "https://images.unsplash.com/photo-1464366400600-7168b8af9bc3?w=200&q=80",
    duration: "3:30",
    music: "Adventure",
  },
  {
    id: 4,
    name: "生日庆典",
    nameEn: "Birthday Celebration",
    description: "温馨的生日派对",
    descriptionEn: "Warm birthday party",
    thumbnail: "https://images.unsplash.com/photo-1516589091380-5d8e87df6999?w=200&q=80",
    duration: "2:00",
    music: "Celebration",
  },
];

export default function StudioScreen() {
  const router = useRouter();
  const { t, language } = useLanguage();
  const colors = useColors();
  const [selectedTemplate, setSelectedTemplate] = useState<number | null>(null);
  const [step, setStep] = useState<"template" | "edit" | "preview">("template");

  const handleSelectTemplate = (templateId: number) => {
    setSelectedTemplate(templateId);
    setStep("edit");
  };

  const handleExport = () => {
    alert(language === "zh" ? "视频导出成功！" : "Video exported successfully!");
    router.back();
  };

  const renderTemplateItem = ({ item }: any) => (
    <Pressable
      onPress={() => handleSelectTemplate(item.id)}
      className="mb-4 bg-surface rounded-2xl overflow-hidden active:opacity-80"
    >
      <View className="relative">
        <Image
          source={{ uri: item.thumbnail }}
          className="w-full h-40"
        />
        <View className="absolute inset-0 bg-black/20 items-center justify-center">
          <MaterialIcons name="play-circle" size={48} color="white" />
        </View>
        <View className="absolute top-2 right-2 bg-black/60 rounded-full px-2 py-1">
          <Text className="text-xs text-white font-semibold">{item.duration}</Text>
        </View>
      </View>

      <View className="p-4 gap-2">
        <Text className="text-lg font-bold text-foreground">
          {language === "zh" ? item.name : item.nameEn}
        </Text>
        <Text className="text-sm text-muted">
          {language === "zh" ? item.description : item.descriptionEn}
        </Text>
        <View className="flex-row items-center gap-2 mt-2">
          <MaterialIcons name="music-note" size={16} color={colors.muted} />
          <Text className="text-xs text-muted">{item.music}</Text>
        </View>
      </View>
    </Pressable>
  );

  if (step === "template") {
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
                {language === "zh" ? "视频制作工作室" : "Video Studio"}
              </Text>
              <View className="w-10" />
            </View>

            {/* 主要内容 */}
            <View className="flex-1 px-6 py-4 gap-4">
              {/* 标题 */}
              <View className="gap-2">
                <Text className="text-2xl font-bold text-foreground">
                  {language === "zh" ? "选择模板" : "Choose Template"}
                </Text>
                <Text className="text-sm text-muted">
                  {language === "zh"
                    ? "为您的回忆选择一个精美的模板"
                    : "Choose a beautiful template for your memories"}
                </Text>
              </View>

              {/* 模板列表 */}
              <FlatList
                data={VIDEO_TEMPLATES}
                renderItem={renderTemplateItem}
                keyExtractor={(item) => item.id.toString()}
                scrollEnabled={false}
              />
            </View>
          </View>
        </ScrollView>
      </ScreenContainer>
    );
  }

  if (step === "edit") {
    const template = VIDEO_TEMPLATES.find(t => t.id === selectedTemplate);

    return (
      <ScreenContainer className="bg-background p-0">
        <ScrollView
          contentContainerStyle={{ flexGrow: 1 }}
          showsVerticalScrollIndicator={false}
        >
          <View className="flex-1">
            {/* 顶部导航 */}
            <View className="flex-row items-center justify-between px-6 py-4 bg-surface">
              <Pressable onPress={() => setStep("template")} className="p-2">
                <MaterialIcons name="arrow-back" size={24} color={colors.foreground} />
              </Pressable>
              <Text className="text-lg font-bold text-foreground">
                {language === "zh" ? "编辑视频" : "Edit Video"}
              </Text>
              <View className="w-10" />
            </View>

            {/* 主要内容 */}
            <View className="flex-1 px-6 py-4 gap-6">
              {/* 预览 */}
              <View className="gap-3">
                <Text className="text-lg font-bold text-foreground">
                  {language === "zh" ? "预览" : "Preview"}
                </Text>
                <View className="bg-black rounded-2xl overflow-hidden h-48 items-center justify-center">
                  <Image
                    source={{ uri: template?.thumbnail }}
                    className="w-full h-full"
                  />
                  <View className="absolute inset-0 items-center justify-center">
                    <MaterialIcons name="play-circle" size={64} color="white" />
                  </View>
                </View>
              </View>

              {/* 编辑选项 */}
              <View className="gap-3">
                <Text className="text-lg font-bold text-foreground">
                  {language === "zh" ? "编辑选项" : "Edit Options"}
                </Text>

                {/* 文字编辑 */}
                <Pressable className="flex-row items-center justify-between bg-surface rounded-2xl p-4 active:opacity-80">
                  <View className="flex-row items-center gap-3">
                    <MaterialIcons name="text-fields" size={24} color={colors.primary} />
                    <View>
                      <Text className="font-semibold text-foreground">
                        {language === "zh" ? "编辑文字" : "Edit Text"}
                      </Text>
                      <Text className="text-xs text-muted">
                        {language === "zh" ? "添加标题和字幕" : "Add titles and subtitles"}
                      </Text>
                    </View>
                  </View>
                  <MaterialIcons name="chevron-right" size={24} color={colors.muted} />
                </Pressable>

                {/* 音乐编辑 */}
                <Pressable className="flex-row items-center justify-between bg-surface rounded-2xl p-4 active:opacity-80">
                  <View className="flex-row items-center gap-3">
                    <MaterialIcons name="music-note" size={24} color={colors.primary} />
                    <View>
                      <Text className="font-semibold text-foreground">
                        {language === "zh" ? "选择音乐" : "Choose Music"}
                      </Text>
                      <Text className="text-xs text-muted">
                        {template?.music}
                      </Text>
                    </View>
                  </View>
                  <MaterialIcons name="chevron-right" size={24} color={colors.muted} />
                </Pressable>

                {/* 转场效果 */}
                <Pressable className="flex-row items-center justify-between bg-surface rounded-2xl p-4 active:opacity-80">
                  <View className="flex-row items-center gap-3">
                    <MaterialIcons name="animation" size={24} color={colors.primary} />
                    <View>
                      <Text className="font-semibold text-foreground">
                        {language === "zh" ? "转场效果" : "Transitions"}
                      </Text>
                      <Text className="text-xs text-muted">
                        {language === "zh" ? "设置转场效果" : "Set transition effects"}
                      </Text>
                    </View>
                  </View>
                  <MaterialIcons name="chevron-right" size={24} color={colors.muted} />
                </Pressable>

                {/* 媒体管理 */}
                <Pressable className="flex-row items-center justify-between bg-surface rounded-2xl p-4 active:opacity-80">
                  <View className="flex-row items-center gap-3">
                    <MaterialIcons name="collections" size={24} color={colors.primary} />
                    <View>
                      <Text className="font-semibold text-foreground">
                        {language === "zh" ? "管理媒体" : "Manage Media"}
                      </Text>
                      <Text className="text-xs text-muted">
                        {language === "zh" ? "添加或移除照片/视频" : "Add or remove photos/videos"}
                      </Text>
                    </View>
                  </View>
                  <MaterialIcons name="chevron-right" size={24} color={colors.muted} />
                </Pressable>
              </View>

              {/* 按钮 */}
              <View className="flex-row gap-3">
                <Pressable
                  onPress={() => setStep("preview")}
                  className="flex-1 bg-primary rounded-full py-4 items-center justify-center active:opacity-80"
                >
                  <Text className="text-white font-bold text-lg">
                    {language === "zh" ? "预览" : "Preview"}
                  </Text>
                </Pressable>

                <Pressable
                  onPress={handleExport}
                  className="flex-1 bg-green-600 rounded-full py-4 items-center justify-center active:opacity-80"
                >
                  <Text className="text-white font-bold text-lg">
                    {language === "zh" ? "导出" : "Export"}
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        </ScrollView>
      </ScreenContainer>
    );
  }

  return null;
}
