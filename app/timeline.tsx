import { ScrollView, Text, View, Pressable, Image, FlatList, TextInput } from "react-native";
import { useState } from "react";
import { useRouter } from "expo-router";
import { useLanguage } from "@/lib/language-provider";
import { useColors } from "@/hooks/use-colors";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { ScreenContainer } from "@/components/screen-container";

const MOCK_EVENTS = [
  {
    id: 1,
    type: "upload",
    typeEn: "Upload",
    user: "小雅",
    userEn: "Xiaoya",
    action: "上传了",
    actionEn: "uploaded",
    content: "3张照片到相册",
    contentEn: "3 photos to album",
    album: "家庭聚会",
    albumEn: "Family Gathering",
    timestamp: "2026-07-12 14:30",
    avatar: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=80&q=80",
    thumbnail: "https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=100&q=80",
  },
  {
    id: 2,
    type: "comment",
    typeEn: "Comment",
    user: "小明",
    userEn: "Xiaoming",
    action: "评论了",
    actionEn: "commented on",
    content: "太美了！",
    contentEn: "So beautiful!",
    album: "金婚纪念",
    albumEn: "Golden Anniversary",
    timestamp: "2026-07-12 13:15",
    avatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=80&q=80",
    thumbnail: "https://images.unsplash.com/photo-1511895426328-dc8714191011?w=100&q=80",
  },
  {
    id: 3,
    type: "like",
    typeEn: "Like",
    user: "陈建国",
    userEn: "Chen Jianguo",
    action: "赞了",
    actionEn: "liked",
    content: "照片",
    contentEn: "photo",
    album: "旅游回忆",
    albumEn: "Travel Memories",
    timestamp: "2026-07-12 12:00",
    avatar: "https://images.unsplash.com/photo-1547559906-41b45c308f73?w=80&q=80",
    thumbnail: "https://images.unsplash.com/photo-1464366400600-7168b8af9bc3?w=100&q=80",
  },
  {
    id: 4,
    type: "story",
    typeEn: "Story",
    user: "李秀英",
    userEn: "Li Xiuying",
    action: "发布了",
    actionEn: "published",
    content: "新的故事章节",
    contentEn: "new story chapter",
    album: "爱情故事",
    albumEn: "Love Story",
    timestamp: "2026-07-12 10:45",
    avatar: "https://images.unsplash.com/photo-1566616213894-2d4e1baee5d8?w=80&q=80",
    thumbnail: "https://images.unsplash.com/photo-1511895426328-dc8714191011?w=100&q=80",
  },
  {
    id: 5,
    type: "share",
    typeEn: "Share",
    user: "小雅",
    userEn: "Xiaoya",
    action: "分享了",
    actionEn: "shared",
    content: "相册到微信",
    contentEn: "album to WeChat",
    album: "家庭聚会",
    albumEn: "Family Gathering",
    timestamp: "2026-07-11 16:20",
    avatar: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=80&q=80",
    thumbnail: "https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=100&q=80",
  },
];

const TIME_FILTERS = [
  { id: 1, name: "今天", nameEn: "Today" },
  { id: 2, name: "本周", nameEn: "This Week" },
  { id: 3, name: "本月", nameEn: "This Month" },
  { id: 4, name: "全部", nameEn: "All" },
];

const EVENT_TYPES = [
  { id: 1, name: "全部", nameEn: "All" },
  { id: 2, name: "上传", nameEn: "Upload" },
  { id: 3, name: "评论", nameEn: "Comment" },
  { id: 4, name: "点赞", nameEn: "Like" },
  { id: 5, name: "故事", nameEn: "Story" },
];

export default function TimelineScreen() {
  const router = useRouter();
  const { t, language } = useLanguage();
  const colors = useColors();
  const [searchText, setSearchText] = useState("");
  const [selectedTimeFilter, setSelectedTimeFilter] = useState(1);
  const [selectedEventType, setSelectedEventType] = useState(1);
  const [events, setEvents] = useState(MOCK_EVENTS);

  const getEventIcon = (type: string) => {
    switch (type) {
      case "upload":
        return "cloud-upload";
      case "comment":
        return "message";
      case "like":
        return "favorite";
      case "story":
        return "edit";
      case "share":
        return "share";
      default:
        return "info";
    }
  };

  const getEventColor = (type: string) => {
    switch (type) {
      case "upload":
        return colors.primary;
      case "comment":
        return "#3b82f6";
      case "like":
        return "#ef4444";
      case "story":
        return "#8b5cf6";
      case "share":
        return "#10b981";
      default:
        return colors.primary;
    }
  };

  const filteredEvents = events.filter(event => {
    const matchesSearch =
      (language === "zh" ? event.user : event.userEn)
        .toLowerCase()
        .includes(searchText.toLowerCase()) ||
      (language === "zh" ? event.content : event.contentEn)
        .toLowerCase()
        .includes(searchText.toLowerCase());
    const matchesType =
      selectedEventType === 1 ||
      (language === "zh" ? event.type : event.typeEn) ===
        (language === "zh"
          ? EVENT_TYPES.find(t => t.id === selectedEventType)?.name
          : EVENT_TYPES.find(t => t.id === selectedEventType)?.nameEn);
    return matchesSearch && matchesType;
  });

  const renderEventItem = ({ item }: any) => (
    <Pressable
      onPress={() => router.push(`/photo/${item.id}`)}
      className="mb-4 bg-surface rounded-2xl p-4 flex-row gap-3 active:opacity-80"
    >
      {/* 左侧时间轴 */}
      <View className="items-center gap-2">
        <View
          className="w-10 h-10 rounded-full items-center justify-center"
          style={{ backgroundColor: getEventColor(item.type) + "20" }}
        >
          <MaterialIcons
            name={getEventIcon(item.type) as any}
            size={20}
            color={getEventColor(item.type)}
          />
        </View>
      </View>

      {/* 中间内容 */}
      <View className="flex-1 gap-2">
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center gap-2 flex-1">
            <Image
              source={{ uri: item.avatar }}
              className="w-8 h-8 rounded-full"
            />
            <Text className="font-semibold text-foreground">
              {language === "zh" ? item.user : item.userEn}
            </Text>
          </View>
          <Text className="text-xs text-muted">{item.timestamp.split(" ")[1]}</Text>
        </View>

        <Text className="text-sm text-muted">
          <Text className="font-semibold">
            {language === "zh" ? item.action : item.actionEn}
          </Text>
          {" "}
          {language === "zh" ? item.content : item.contentEn}
        </Text>

        {item.thumbnail && (
          <Image
            source={{ uri: item.thumbnail }}
            className="w-16 h-16 rounded-lg"
          />
        )}
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
            <Text className="text-lg font-bold text-foreground">
              {language === "zh" ? "时间线" : "Timeline"}
            </Text>
            <Pressable className="p-2">
              <MaterialIcons name="filter-list" size={24} color={colors.foreground} />
            </Pressable>
          </View>

          {/* 主要内容 */}
          <View className="flex-1 px-6 py-4 gap-4">
            {/* 搜索框 */}
            <View className="flex-row items-center gap-2 bg-surface rounded-full px-4 py-2">
              <MaterialIcons name="search" size={20} color={colors.muted} />
              <TextInput
                placeholder={language === "zh" ? "搜索事件..." : "Search events..."}
                value={searchText}
                onChangeText={setSearchText}
                placeholderTextColor={colors.muted}
                className="flex-1 text-foreground"
              />
              {searchText && (
                <Pressable onPress={() => setSearchText("")}>
                  <MaterialIcons name="close" size={20} color={colors.muted} />
                </Pressable>
              )}
            </View>

            {/* 时间筛选 */}
            <FlatList
              data={TIME_FILTERS}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => setSelectedTimeFilter(item.id)}
                  className={`px-4 py-2 rounded-full ${
                    selectedTimeFilter === item.id
                      ? "bg-primary"
                      : "bg-surface"
                  }`}
                >
                  <Text
                    className={`text-sm font-semibold ${
                      selectedTimeFilter === item.id
                        ? "text-white"
                        : "text-foreground"
                    }`}
                  >
                    {language === "zh" ? item.name : item.nameEn}
                  </Text>
                </Pressable>
              )}
              keyExtractor={(item) => item.id.toString()}
              horizontal
              showsHorizontalScrollIndicator={false}
              scrollEnabled={true}
            />

            {/* 事件类型筛选 */}
            <FlatList
              data={EVENT_TYPES}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => setSelectedEventType(item.id)}
                  className={`px-3 py-1 rounded-full mr-2 ${
                    selectedEventType === item.id
                      ? "bg-primary"
                      : "bg-surface"
                  }`}
                >
                  <Text
                    className={`text-xs font-semibold ${
                      selectedEventType === item.id
                        ? "text-white"
                        : "text-foreground"
                    }`}
                  >
                    {language === "zh" ? item.name : item.nameEn}
                  </Text>
                </Pressable>
              )}
              keyExtractor={(item) => item.id.toString()}
              horizontal
              showsHorizontalScrollIndicator={false}
              scrollEnabled={true}
            />

            {/* 事件列表 */}
            {filteredEvents.length > 0 ? (
              <FlatList
                data={filteredEvents}
                renderItem={renderEventItem}
                keyExtractor={(item) => item.id.toString()}
                scrollEnabled={false}
              />
            ) : (
              <View className="flex-1 items-center justify-center gap-2">
                <MaterialIcons name="event-note" size={48} color={colors.muted} />
                <Text className="text-lg font-semibold text-foreground">
                  {language === "zh" ? "没有事件" : "No events"}
                </Text>
              </View>
            )}
          </View>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
