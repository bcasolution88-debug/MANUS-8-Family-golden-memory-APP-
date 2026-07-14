import { ScrollView, Text, View, Pressable, Image, Dimensions } from "react-native";
import { useState } from "react";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useLanguage } from "@/lib/language-provider";
import { useColors } from "@/hooks/use-colors";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { ScreenContainer } from "@/components/screen-container";

const { width } = Dimensions.get("window");

const MOCK_VIDEO = {
  id: 1,
  title: "家庭聚会 2026",
  titleEn: "Family Gathering 2026",
  thumbnail: "https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=400&q=80",
  duration: "3:45",
  uploadDate: "2026-07-12",
  uploader: "小雅",
  uploaderEn: "Xiaoya",
  uploaderAvatar: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=100&q=80",
  views: 234,
  likes: 45,
  comments: 12,
  description: "这是一个美好的家庭聚会时刻，记录了全家人的欢笑和温暖。",
  descriptionEn: "A beautiful family gathering moment, recording the laughter and warmth of the whole family.",
  tags: ["家庭", "聚会", "2026"],
  tagsEn: ["Family", "Gathering", "2026"],
  liked: false,
};

const VIDEO_FILTERS = [
  { id: 1, name: "原始", nameEn: "Original", icon: "image" },
  { id: 2, name: "黑白", nameEn: "B&W", icon: "photo-filter" },
  { id: 3, name: "怀旧", nameEn: "Vintage", icon: "palette" },
  { id: 4, name: "鲜艳", nameEn: "Vivid", icon: "brightness-high" },
];

const VIDEO_EFFECTS = [
  { id: 1, name: "无", nameEn: "None", icon: "check" },
  { id: 2, name: "淡入淡出", nameEn: "Fade", icon: "animation" },
  { id: 3, name: "缩放", nameEn: "Zoom", icon: "zoom-in" },
  { id: 4, name: "旋转", nameEn: "Rotate", icon: "rotate-right" },
];

export default function VideoDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const { t, language } = useLanguage();
  const colors = useColors();
  const [isPlaying, setIsPlaying] = useState(false);
  const [liked, setLiked] = useState(MOCK_VIDEO.liked);
  const [selectedFilter, setSelectedFilter] = useState(1);
  const [selectedEffect, setSelectedEffect] = useState(1);
  const [showEditPanel, setShowEditPanel] = useState(false);

  const handleLike = () => {
    setLiked(!liked);
  };

  const handleShare = () => {
    router.push("/share");
  };

  const handleDownload = () => {
    alert(language === "zh" ? "视频已下载" : "Video downloaded");
  };

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
              {language === "zh" ? "视频详情" : "Video Detail"}
            </Text>
            <Pressable className="p-2">
              <MaterialIcons name="more-vert" size={24} color={colors.foreground} />
            </Pressable>
          </View>

          {/* 主要内容 */}
          <View className="flex-1 px-6 py-4 gap-4">
            {/* 视频播放器 */}
            <View className="bg-black rounded-2xl overflow-hidden gap-2">
              <Image
                source={{ uri: MOCK_VIDEO.thumbnail }}
                className="w-full h-48"
              />
              <View className="absolute inset-0 items-center justify-center">
                <Pressable
                  onPress={() => setIsPlaying(!isPlaying)}
                  className="w-16 h-16 rounded-full bg-white/80 items-center justify-center active:opacity-80"
                >
                  <MaterialIcons
                    name={isPlaying ? "pause" : "play-arrow"}
                    size={32}
                    color="black"
                  />
                </Pressable>
              </View>
              <View className="absolute bottom-2 right-2 bg-black/70 rounded-lg px-2 py-1">
                <Text className="text-white text-xs font-bold">
                  {MOCK_VIDEO.duration}
                </Text>
              </View>
            </View>

            {/* 视频信息 */}
            <View className="gap-3">
              <Text className="text-2xl font-bold text-foreground">
                {language === "zh" ? MOCK_VIDEO.title : MOCK_VIDEO.titleEn}
              </Text>

              <View className="flex-row items-center justify-between">
                <View className="flex-row items-center gap-2">
                  <Image
                    source={{ uri: MOCK_VIDEO.uploaderAvatar }}
                    className="w-10 h-10 rounded-full"
                  />
                  <View>
                    <Text className="font-semibold text-foreground">
                      {language === "zh" ? MOCK_VIDEO.uploader : MOCK_VIDEO.uploaderEn}
                    </Text>
                    <Text className="text-xs text-muted">{MOCK_VIDEO.uploadDate}</Text>
                  </View>
                </View>
                <Pressable className="bg-primary rounded-full px-4 py-2 active:opacity-80">
                  <Text className="text-white font-semibold text-sm">
                    {language === "zh" ? "关注" : "Follow"}
                  </Text>
                </Pressable>
              </View>

              {/* 统计信息 */}
              <View className="flex-row gap-4 py-3 border-t border-b border-border">
                <View className="flex-1 items-center">
                  <Text className="text-lg font-bold text-foreground">
                    {MOCK_VIDEO.views}
                  </Text>
                  <Text className="text-xs text-muted">
                    {language === "zh" ? "播放" : "Views"}
                  </Text>
                </View>
                <View className="flex-1 items-center">
                  <Text className="text-lg font-bold text-foreground">
                    {liked ? MOCK_VIDEO.likes + 1 : MOCK_VIDEO.likes}
                  </Text>
                  <Text className="text-xs text-muted">
                    {language === "zh" ? "赞" : "Likes"}
                  </Text>
                </View>
                <View className="flex-1 items-center">
                  <Text className="text-lg font-bold text-foreground">
                    {MOCK_VIDEO.comments}
                  </Text>
                  <Text className="text-xs text-muted">
                    {language === "zh" ? "评论" : "Comments"}
                  </Text>
                </View>
              </View>

              {/* 描述 */}
              <View className="gap-2">
                <Text className="text-sm text-foreground">
                  {language === "zh" ? MOCK_VIDEO.description : MOCK_VIDEO.descriptionEn}
                </Text>
                <View className="flex-row flex-wrap gap-2">
                  {(language === "zh" ? MOCK_VIDEO.tags : MOCK_VIDEO.tagsEn).map(
                    (tag, index) => (
                      <View
                        key={index}
                        className="bg-surface rounded-full px-3 py-1"
                      >
                        <Text className="text-xs text-primary font-semibold">
                          #{tag}
                        </Text>
                      </View>
                    )
                  )}
                </View>
              </View>

              {/* 操作按钮 */}
              <View className="flex-row gap-2">
                <Pressable
                  onPress={handleLike}
                  className="flex-1 flex-row items-center justify-center gap-2 bg-surface rounded-full py-3 active:opacity-80"
                >
                  <MaterialIcons
                    name={liked ? "favorite" : "favorite-border"}
                    size={20}
                    color={liked ? colors.error : colors.primary}
                  />
                  <Text className="font-semibold text-foreground">
                    {language === "zh" ? "赞" : "Like"}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={handleShare}
                  className="flex-1 flex-row items-center justify-center gap-2 bg-surface rounded-full py-3 active:opacity-80"
                >
                  <MaterialIcons name="share" size={20} color={colors.primary} />
                  <Text className="font-semibold text-foreground">
                    {language === "zh" ? "分享" : "Share"}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={handleDownload}
                  className="flex-1 flex-row items-center justify-center gap-2 bg-surface rounded-full py-3 active:opacity-80"
                >
                  <MaterialIcons name="download" size={20} color={colors.primary} />
                  <Text className="font-semibold text-foreground">
                    {language === "zh" ? "下载" : "Download"}
                  </Text>
                </Pressable>
              </View>

              {/* 编辑按钮 */}
              <Pressable
                onPress={() => setShowEditPanel(!showEditPanel)}
                className="flex-row items-center justify-center gap-2 bg-primary rounded-full py-3 active:opacity-80"
              >
                <MaterialIcons name="edit" size={20} color="white" />
                <Text className="font-semibold text-white text-lg">
                  {language === "zh" ? "编辑视频" : "Edit Video"}
                </Text>
              </Pressable>

              {/* 编辑面板 */}
              {showEditPanel && (
                <View className="gap-4 bg-surface rounded-2xl p-4">
                  {/* 滤镜选择 */}
                  <View className="gap-2">
                    <Text className="font-semibold text-foreground">
                      {language === "zh" ? "滤镜" : "Filters"}
                    </Text>
                    <View className="flex-row gap-2">
                      {VIDEO_FILTERS.map((filter) => (
                        <Pressable
                          key={filter.id}
                          onPress={() => setSelectedFilter(filter.id)}
                          className={`flex-1 rounded-lg py-2 items-center gap-1 ${
                            selectedFilter === filter.id
                              ? "bg-primary"
                              : "bg-background"
                          }`}
                        >
                          <MaterialIcons
                            name={filter.icon as any}
                            size={20}
                            color={
                              selectedFilter === filter.id
                                ? "white"
                                : colors.foreground
                            }
                          />
                          <Text
                            className={`text-xs font-semibold ${
                              selectedFilter === filter.id
                                ? "text-white"
                                : "text-foreground"
                            }`}
                          >
                            {language === "zh" ? filter.name : filter.nameEn}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>

                  {/* 效果选择 */}
                  <View className="gap-2">
                    <Text className="font-semibold text-foreground">
                      {language === "zh" ? "效果" : "Effects"}
                    </Text>
                    <View className="flex-row gap-2">
                      {VIDEO_EFFECTS.map((effect) => (
                        <Pressable
                          key={effect.id}
                          onPress={() => setSelectedEffect(effect.id)}
                          className={`flex-1 rounded-lg py-2 items-center gap-1 ${
                            selectedEffect === effect.id
                              ? "bg-primary"
                              : "bg-background"
                          }`}
                        >
                          <MaterialIcons
                            name={effect.icon as any}
                            size={20}
                            color={
                              selectedEffect === effect.id
                                ? "white"
                                : colors.foreground
                            }
                          />
                          <Text
                            className={`text-xs font-semibold ${
                              selectedEffect === effect.id
                                ? "text-white"
                                : "text-foreground"
                            }`}
                          >
                            {language === "zh" ? effect.name : effect.nameEn}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>

                  {/* 导出按钮 */}
                  <Pressable className="bg-primary rounded-full py-3 items-center justify-center active:opacity-80">
                    <Text className="text-white font-bold text-lg">
                      {language === "zh" ? "导出视频" : "Export Video"}
                    </Text>
                  </Pressable>
                </View>
              )}
            </View>
          </View>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
