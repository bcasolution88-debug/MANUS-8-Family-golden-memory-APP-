import { ScrollView, Text, View, Pressable, Image, FlatList } from "react-native";
import { useState, useEffect } from "react";
import { useRouter } from "expo-router";
import { useLanguage } from "@/lib/language-provider";
import { useColors } from "@/hooks/use-colors";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { ScreenContainer } from "@/components/screen-container";

// Mock data - 将来从API获取
const MOCK_FAMILY = {
  name: "陈爸爸 & 陈妈妈",
  nameEn: "Dad & Mom",
  yearsTogetherCn: "幸福 50 年",
  yearsTogetherEn: "Together for 50 wonderful years",
  memberCount: 11,
  members: [
    { id: 1, name: "陈爸爸", role: "长辈", image: "https://images.unsplash.com/photo-1547559906-41b45c308f73?w=100&q=80" },
    { id: 2, name: "陈妈妈", role: "主角", image: "https://images.unsplash.com/photo-1566616213894-2d4e1baee5d8?w=100&q=80" },
    { id: 3, name: "小雅", role: "管理", image: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=100&q=80" },
    { id: 4, name: "小明", role: "", image: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&q=80" },
    { id: 5, name: "晶晶", role: "", image: "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=100&q=80" },
  ],
};

const MOCK_ANNIVERSARY = {
  type: "金婚",
  typeCn: "金婚纪念日",
  typeEn: "Golden Anniversary",
  years: 50,
  daysUntil: 0,
  date: "2026-07-15",
};

const MOCK_TIMELINE = [
  {
    id: 1,
    date: "06/18",
    dayOfWeek: "Wed",
    title: "家庭年度聚会",
    titleEn: "Annual Family Reunion",
    description: "今年的家庭聚会，爸妈笑得格外开心。",
    descriptionEn: "This year's family gathering, parents were especially happy.",
    image: "https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=400&q=80",
    author: "小雅",
    likes: 42,
    comments: 8,
    mediaCount: 12,
  },
  {
    id: 2,
    date: "05/12",
    dayOfWeek: "Sun",
    title: "金婚纪念日派对",
    titleEn: "Golden Anniversary Celebration",
    description: "50年相守，感谢有你。",
    descriptionEn: "50 years together, thank you for being there.",
    image: "https://images.unsplash.com/photo-1511895426328-dc8714191011?w=400&q=80",
    author: "小明",
    likes: 88,
    comments: 24,
    mediaCount: 12,
  },
];

export default function HomeScreen() {
  const router = useRouter();
  const { t, language } = useLanguage();
  const colors = useColors();
  const [daysUntilAnniversary, setDaysUntilAnniversary] = useState(0);

  useEffect(() => {
    // 计算纪念日倒计时
    const today = new Date();
    const anniversary = new Date(MOCK_ANNIVERSARY.date);
    const diff = anniversary.getTime() - today.getTime();
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
    setDaysUntilAnniversary(Math.max(0, days));
  }, []);

  const renderTimelineItem = ({ item }: any) => (
    <Pressable
      onPress={() => router.push(`/photo/${item.id}`)}
      className="mb-4 bg-surface rounded-2xl overflow-hidden"
    >
      <View className="flex-row">
        {/* 左侧日期 */}
        <View className="w-16 bg-primary/10 items-center justify-center py-4">
          <Text className="text-lg font-bold text-primary">{item.date}</Text>
          <Text className="text-xs text-muted">{item.dayOfWeek}</Text>
        </View>

        {/* 右侧内容 */}
        <View className="flex-1 p-3 gap-2">
          {/* 标题和媒体计数 */}
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-2 flex-1">
              <MaterialIcons name="image" size={16} color={colors.muted} />
              <Text className="text-sm text-muted">{item.mediaCount}</Text>
              <Text className="text-sm font-semibold text-foreground flex-1">
                {language === "zh" ? item.title : item.titleEn}
              </Text>
            </View>
          </View>

          {/* 描述 */}
          <Text className="text-xs text-muted" numberOfLines={2}>
            {language === "zh" ? item.description : item.descriptionEn}
          </Text>

          {/* 作者和交互 */}
          <View className="flex-row items-center justify-between mt-2">
            <View className="flex-row items-center gap-2">
              <Image
                source={{ uri: item.image }}
                className="w-6 h-6 rounded-full"
              />
              <Text className="text-xs text-muted">{item.author}</Text>
            </View>
            <View className="flex-row items-center gap-3">
              <View className="flex-row items-center gap-1">
                <MaterialIcons name="favorite" size={14} color={colors.muted} />
                <Text className="text-xs text-muted">{item.likes}</Text>
              </View>
              <View className="flex-row items-center gap-1">
                <MaterialIcons name="comment" size={14} color={colors.muted} />
                <Text className="text-xs text-muted">{item.comments}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* 缩略图 */}
        <Image
          source={{ uri: item.image }}
          className="w-16 h-24"
        />
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
          {/* 顶部导航栏 */}
          <View className="flex-row items-center justify-between px-6 py-4 bg-surface">
            <View>
              <Text className="text-lg font-bold text-foreground">
                {language === "zh" ? "家庭共享相册" : "Family Shared Album"}
              </Text>
              <Text className="text-xs text-muted uppercase">GOLDEN MEMORY</Text>
            </View>
            <Pressable className="relative">
              <MaterialIcons name="notifications" size={24} color={colors.foreground} />
              <View
                className="absolute -top-1 -right-1 w-5 h-5 rounded-full items-center justify-center"
                style={{ backgroundColor: colors.error }}
              >
                <Text className="text-xs font-bold text-white">3</Text>
              </View>
            </Pressable>
          </View>

          {/* 主要内容 */}
          <View className="flex-1 px-6 py-4 gap-6">
            {/* 我们的幸福卡片 */}
            <View className="bg-gradient-to-b from-primary/10 to-surface rounded-3xl p-6 gap-4">
              <View className="flex-row items-center gap-3">
                <View
                  className="w-16 h-16 rounded-full items-center justify-center"
                  style={{ backgroundColor: colors.primary }}
                >
                  <MaterialIcons name="favorite" size={32} color="white" />
                </View>
                <View className="flex-1">
                  <Text className="text-lg font-bold text-foreground">
                    {t("ourFamily")} 💍
                  </Text>
                  <Text className="text-sm text-muted">
                    {language === "zh"
                      ? `Our Family Album · ${MOCK_FAMILY.memberCount} Members`
                      : `Our Family Album · ${MOCK_FAMILY.memberCount} Members`}
                  </Text>
                </View>
              </View>

              {/* 家庭成员头像圈 */}
              <View className="flex-row items-center gap-2">
                {MOCK_FAMILY.members.slice(0, 5).map((member, index) => (
                  <Image
                    key={member.id}
                    source={{ uri: member.image }}
                    className="w-10 h-10 rounded-full border-2"
                    style={{ borderColor: colors.background, marginLeft: index > 0 ? -8 : 0 }}
                  />
                ))}
                {MOCK_FAMILY.memberCount > 5 && (
                  <View
                    className="w-10 h-10 rounded-full items-center justify-center border-2"
                    style={{ borderColor: colors.background, backgroundColor: colors.surface }}
                  >
                    <Text className="text-xs font-bold text-foreground">
                      +{MOCK_FAMILY.memberCount - 5}
                    </Text>
                  </View>
                )}
              </View>

              {/* 长辈信息 */}
              <View className="gap-1">
                <Text className="text-sm font-semibold text-foreground">
                  {MOCK_FAMILY.name}
                </Text>
                <Text className="text-xs text-muted">
                  {language === "zh" ? MOCK_FAMILY.yearsTogetherCn : MOCK_FAMILY.yearsTogetherEn}
                </Text>
              </View>
            </View>

            {/* 纪念日倒计时卡片 */}
            <Pressable
              onPress={() => router.push("/anniversary")}
              className="bg-gradient-to-r from-yellow-400 to-yellow-500 rounded-3xl p-6 gap-3"
            >
              <View className="flex-row items-center justify-between">
                <View>
                  <Text className="text-sm font-semibold text-white/80">
                    🏆 {language === "zh" ? "金婚纪念日" : "Golden Anniversary"} · {MOCK_ANNIVERSARY.years}年
                  </Text>
                  <Text className="text-lg font-bold text-white">
                    {daysUntilAnniversary} {language === "zh" ? "天后" : "Days Until"}
                  </Text>
                </View>
                <MaterialIcons name="arrow-forward" size={24} color="white" />
              </View>
            </Pressable>

            {/* 快速操作按钮 */}
            <View className="grid grid-cols-2 gap-3">
              <Pressable
                onPress={() => router.push("/upload")}
                className="bg-primary rounded-2xl py-4 items-center justify-center active:opacity-80 gap-2"
              >
                <MaterialIcons name="add-photo-alternate" size={24} color="white" />
                <Text className="text-sm font-semibold text-white text-center">
                  {language === "zh" ? "创建相册" : "Create Album"}
                </Text>
              </Pressable>

              <Pressable
                onPress={() => router.push("/studio")}
                className="bg-blue-500 rounded-2xl py-4 items-center justify-center active:opacity-80 gap-2"
              >
                <MaterialIcons name="video-library" size={24} color="white" />
                <Text className="text-sm font-semibold text-white text-center">
                  {language === "zh" ? "制作视频" : "Make Video"}
                </Text>
              </Pressable>
            </View>

            {/* 回忆时光标题 */}
            <View className="flex-row items-center justify-between">
              <Text className="text-lg font-bold text-foreground">
                {language === "zh" ? "回忆时光" : "Timeline"}
              </Text>
              <Pressable>
                <Text className="text-sm text-primary font-semibold">
                  {language === "zh" ? "更多" : "More"}
                </Text>
              </Pressable>
            </View>

            {/* 时间线列表 */}
            <FlatList
              data={MOCK_TIMELINE}
              renderItem={renderTimelineItem}
              keyExtractor={(item) => item.id.toString()}
              scrollEnabled={false}
            />

            {/* 家庭成员区域 */}
            <View className="gap-3">
              <View className="flex-row items-center justify-between">
                <Text className="text-lg font-bold text-foreground">
                  {language === "zh" ? "家庭成员" : "Family Members"}
                </Text>
                <Pressable               onPress={() => router.push("/members")}>
                  <Text className="text-sm text-primary font-semibold">
                    {language === "zh" ? "管理" : "Manage"}
                  </Text>
                </Pressable>
              </View>

              {/* 成员卡片网格 */}
              <View className="flex-row flex-wrap gap-2">
                {MOCK_FAMILY.members.map((member) => (
                  <Pressable
                    key={member.id}
                    className="flex-1 min-w-[45%] bg-surface rounded-2xl p-3 items-center gap-2"
                  >
                    <Image
                      source={{ uri: member.image }}
                      className="w-12 h-12 rounded-full"
                    />
                    <Text className="text-xs font-semibold text-foreground text-center">
                      {member.name}
                    </Text>
                    {member.role && (
                      <Text className="text-xs text-muted">{member.role}</Text>
                    )}
                  </Pressable>
                ))}
              </View>

              {/* 邀请按钮 */}
              <Pressable className="bg-surface rounded-2xl py-3 items-center justify-center active:opacity-80 flex-row gap-2">
                <MaterialIcons name="person-add" size={18} color={colors.primary} />
                <Text className="text-sm font-semibold text-primary">
                  {language === "zh" ? "邀请" : "Invite"}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
