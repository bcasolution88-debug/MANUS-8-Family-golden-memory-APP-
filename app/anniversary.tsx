import { ScrollView, Text, View, Pressable, Image, FlatList } from "react-native";
import { useState, useEffect } from "react";
import { useRouter } from "expo-router";
import { useLanguage } from "@/lib/language-provider";
import { useColors } from "@/hooks/use-colors";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { ScreenContainer } from "@/components/screen-container";

// Mock数据
const MOCK_ANNIVERSARY = {
  type: "金婚",
  typeCn: "金婚纪念日",
  typeEn: "Golden Anniversary",
  years: 50,
  date: "2026-07-15",
  couple: {
    name: "陈建国 & 李秀英",
    startDate: "Oct 18, 1975",
  },
  photos: [
    { id: 1, image: "https://images.unsplash.com/photo-1511895426328-dc8714191011?w=400&q=80" },
    { id: 2, image: "https://images.unsplash.com/photo-1529543544282-ea669407fca3?w=400&q=80" },
    { id: 3, image: "https://images.unsplash.com/photo-1464366400600-7168b8af9bc3?w=400&q=80" },
    { id: 4, image: "https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=400&q=80" },
    { id: 5, image: "https://images.unsplash.com/photo-1516589091380-5d8e87df6999?w=400&q=80" },
    { id: 6, image: "https://images.unsplash.com/photo-1504198458649-3128b932f49e?w=400&q=80" },
  ],
};

const ANNIVERSARY_MILESTONES = [
  { years: 25, type: "银婚", typeEn: "Silver" },
  { years: 50, type: "金婚", typeEn: "Golden" },
  { years: 60, type: "钻石婚", typeEn: "Diamond" },
  { years: 70, type: "白金婚", typeEn: "Platinum" },
];

export default function AnniversaryScreen() {
  const router = useRouter();
  const { t, language } = useLanguage();
  const colors = useColors();
  const [timeLeft, setTimeLeft] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0 });

  useEffect(() => {
    const calculateTimeLeft = () => {
      const anniversary = new Date(MOCK_ANNIVERSARY.date).getTime();
      const now = new Date().getTime();
      const diff = anniversary - now;

      if (diff > 0) {
        setTimeLeft({
          days: Math.floor(diff / (1000 * 60 * 60 * 24)),
          hours: Math.floor((diff / (1000 * 60 * 60)) % 24),
          minutes: Math.floor((diff / 1000 / 60) % 60),
          seconds: Math.floor((diff / 1000) % 60),
        });
      }
    };

    calculateTimeLeft();
    const timer = setInterval(calculateTimeLeft, 1000);
    return () => clearInterval(timer);
  }, []);

  const renderPhotoGrid = () => (
    <View className="flex-row flex-wrap gap-2">
      {MOCK_ANNIVERSARY.photos.slice(0, 5).map((photo) => (
        <Image
          key={photo.id}
          source={{ uri: photo.image }}
          className="flex-1 min-w-[30%] h-24 rounded-lg"
        />
      ))}
      {MOCK_ANNIVERSARY.photos.length > 5 && (
        <View
          className="flex-1 min-w-[30%] h-24 rounded-lg items-center justify-center"
          style={{ backgroundColor: colors.surface }}
        >
          <Text className="text-lg font-bold text-foreground">
            +{MOCK_ANNIVERSARY.photos.length - 5}
          </Text>
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
              {language === "zh" ? "金婚纪念日" : "Golden Anniversary"}
            </Text>
            <Pressable className="p-2">
              <MaterialIcons name="notifications" size={24} color={colors.foreground} />
            </Pressable>
          </View>

          {/* 主要内容 */}
          <View className="flex-1 px-6 py-4 gap-6">
            {/* 纪念日类型标签 */}
            <View className="bg-yellow-100 rounded-full px-4 py-2 self-center">
              <Text className="text-sm font-semibold text-yellow-800">
                🏆 {language === "zh" ? MOCK_ANNIVERSARY.typeCn : MOCK_ANNIVERSARY.typeEn} · {MOCK_ANNIVERSARY.years}周年
              </Text>
            </View>

            {/* 倒计时卡片 */}
            <View
              className="rounded-3xl p-6 gap-4"
              style={{ backgroundColor: colors.primary }}
            >
              <Text className="text-center text-white font-semibold">
                {language === "zh" ? "金 婚 之 喜" : "GOLDEN ANNIVERSARY"}
              </Text>

              {/* 倒计时数字 */}
              <View className="flex-row justify-around gap-2">
                {[
                  { value: timeLeft.days, label: language === "zh" ? "天" : "DD" },
                  { value: timeLeft.hours, label: language === "zh" ? "时" : "HH" },
                  { value: timeLeft.minutes, label: language === "zh" ? "分" : "MM" },
                  { value: timeLeft.seconds, label: language === "zh" ? "秒" : "SS" },
                ].map((item, index) => (
                  <View key={index} className="flex-1 items-center gap-1">
                    <View
                      className="w-full rounded-lg py-3 items-center justify-center"
                      style={{ backgroundColor: "rgba(255,255,255,0.2)" }}
                    >
                      <Text className="text-2xl font-bold text-white">
                        {String(item.value).padStart(2, "0")}
                      </Text>
                    </View>
                    <Text className="text-xs text-white/80">{item.label}</Text>
                  </View>
                ))}
              </View>
            </View>

            {/* 长辈信息 */}
            <View className="bg-surface rounded-3xl p-6 gap-4 items-center">
              <View className="flex-row items-center gap-3">
                <Image
                  source={{ uri: "https://images.unsplash.com/photo-1547559906-41b45c308f73?w=80&q=80" }}
                  className="w-12 h-12 rounded-full"
                />
                <Image
                  source={{ uri: "https://images.unsplash.com/photo-1566616213894-2d4e1baee5d8?w=80&q=80" }}
                  className="w-12 h-12 rounded-full"
                />
              </View>
              <View className="items-center gap-1">
                <Text className="text-lg font-bold text-foreground">
                  {MOCK_ANNIVERSARY.couple.name}
                </Text>
                <Text className="text-sm text-muted">
                  Together since {MOCK_ANNIVERSARY.couple.startDate}
                </Text>
              </View>
            </View>

            {/* 纪念日里程碑 */}
            <View className="gap-3">
              <View className="flex-row justify-between gap-2">
                {ANNIVERSARY_MILESTONES.map((milestone, index) => (
                  <View
                    key={index}
                    className={`flex-1 rounded-2xl p-3 items-center gap-1 ${
                      milestone.years === MOCK_ANNIVERSARY.years
                        ? "bg-yellow-100"
                        : "bg-surface"
                    }`}
                  >
                    <Text
                      className={`text-lg font-bold ${
                        milestone.years === MOCK_ANNIVERSARY.years
                          ? "text-yellow-800"
                          : "text-foreground"
                      }`}
                    >
                      {milestone.years}
                    </Text>
                    <Text
                      className={`text-xs ${
                        milestone.years === MOCK_ANNIVERSARY.years
                          ? "text-yellow-700"
                          : "text-muted"
                      }`}
                    >
                      {language === "zh" ? milestone.type : milestone.typeEn}
                    </Text>
                  </View>
                ))}
              </View>
            </View>

            {/* 快速操作按钮 */}
            <View className="flex-row gap-3">
              <Pressable
                onPress={() => router.push("/studio")}
                className="flex-1 bg-primary rounded-2xl py-4 items-center justify-center active:opacity-80 gap-2"
              >
                <MaterialIcons name="video-library" size={20} color="white" />
                <Text className="text-sm font-semibold text-white text-center">
                  {language === "zh" ? "制作视频" : "Make Video"}
                </Text>
              </Pressable>

              <Pressable
                onPress={() => router.push("/stories")}
                className="flex-1 bg-amber-600 rounded-2xl py-4 items-center justify-center active:opacity-80 gap-2"
              >
                <MaterialIcons name="edit" size={20} color="white" />
                <Text className="text-sm font-semibold text-white text-center">
                  {language === "zh" ? "写故事" : "Write Story"}
                </Text>
              </Pressable>
            </View>

            {/* 纪念相册 */}
            <View className="gap-3">
              <View className="flex-row items-center justify-between">
                <Text className="text-lg font-bold text-foreground">
                  {language === "zh" ? "纪念相册" : "Photo Gallery"}
                </Text>
                <Pressable>
                  <Text className="text-sm text-primary font-semibold">
                    {language === "zh" ? "查看全部" : "View All"}
                  </Text>
                </Pressable>
              </View>
              {renderPhotoGrid()}
            </View>

            {/* 送祝福按钮 */}
            <Pressable className="bg-primary rounded-full py-4 items-center justify-center active:opacity-80 gap-2">
              <MaterialIcons name="favorite" size={20} color="white" />
              <Text className="text-white font-bold text-lg">
                {language === "zh" ? "送祝福" : "Send Blessings"}
              </Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
