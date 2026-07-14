import { ScrollView, Text, View, Pressable, Image, TextInput, FlatList } from "react-native";
import { useState } from "react";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useLanguage } from "@/lib/language-provider";
import { useColors } from "@/hooks/use-colors";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { ScreenContainer } from "@/components/screen-container";

// Mock数据
const MOCK_PHOTO = {
  id: 1,
  image: "https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=800&q=80",
  title: "家庭年度聚会",
  titleEn: "Annual Family Reunion",
  description: "今年的家庭聚会，爸妈笑得格外开心。",
  descriptionEn: "This year's family gathering, parents were especially happy.",
  author: "小雅",
  date: "2026-06-18",
  likes: 42,
  liked: false,
  comments: [
    { id: 1, author: "小明", text: "太开心了！", textEn: "So happy!", likes: 5 },
    { id: 2, author: "晶晶", text: "爸妈看起来很幸福", textEn: "Parents look so happy", likes: 3 },
  ],
  mediaCount: 12,
};

export default function PhotoDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const { t, language } = useLanguage();
  const colors = useColors();
  const [liked, setLiked] = useState(MOCK_PHOTO.liked);
  const [likes, setLikes] = useState(MOCK_PHOTO.likes);
  const [comment, setComment] = useState("");
  const [comments, setComments] = useState(MOCK_PHOTO.comments);

  const handleLike = () => {
    setLiked(!liked);
    setLikes(liked ? likes - 1 : likes + 1);
  };

  const handleAddComment = () => {
    if (comment.trim()) {
      setComments([
        ...comments,
        {
          id: comments.length + 1,
          author: "你",
          text: comment,
          textEn: comment,
          likes: 0,
        },
      ]);
      setComment("");
    }
  };

  const renderComment = ({ item }: any) => (
    <View className="flex-row gap-3 mb-4">
      <View
        className="w-10 h-10 rounded-full items-center justify-center"
        style={{ backgroundColor: colors.primary }}
      >
        <Text className="text-white font-bold text-sm">{item.author[0]}</Text>
      </View>
      <View className="flex-1 gap-1">
        <View className="flex-row items-center justify-between">
          <Text className="font-semibold text-foreground">{item.author}</Text>
          <Pressable>
            <MaterialIcons name="favorite-border" size={16} color={colors.muted} />
          </Pressable>
        </View>
        <Text className="text-sm text-foreground">
          {language === "zh" ? item.text : item.textEn}
        </Text>
        <Text className="text-xs text-muted">{item.likes} {t("likes")}</Text>
      </View>
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
              {language === "zh" ? "照片详情" : "Photo Details"}
            </Text>
            <Pressable className="p-2">
              <MaterialIcons name="more-vert" size={24} color={colors.foreground} />
            </Pressable>
          </View>

          {/* 照片 */}
          <Image
            source={{ uri: MOCK_PHOTO.image }}
            className="w-full h-80"
          />

          {/* 主要内容 */}
          <View className="flex-1 px-6 py-4 gap-4">
            {/* 标题和描述 */}
            <View className="gap-2">
              <Text className="text-2xl font-bold text-foreground">
                {language === "zh" ? MOCK_PHOTO.title : MOCK_PHOTO.titleEn}
              </Text>
              <Text className="text-sm text-muted">
                {language === "zh" ? MOCK_PHOTO.description : MOCK_PHOTO.descriptionEn}
              </Text>
            </View>

            {/* 作者信息和日期 */}
            <View className="flex-row items-center justify-between py-3 border-b border-border">
              <View className="flex-row items-center gap-2">
                <View
                  className="w-10 h-10 rounded-full items-center justify-center"
                  style={{ backgroundColor: colors.primary }}
                >
                  <Text className="text-white font-bold">{MOCK_PHOTO.author[0]}</Text>
                </View>
                <View>
                  <Text className="font-semibold text-foreground">{MOCK_PHOTO.author}</Text>
                  <Text className="text-xs text-muted">{MOCK_PHOTO.date}</Text>
                </View>
              </View>
              <Pressable className="px-3 py-1 rounded-full bg-surface">
                <Text className="text-sm font-semibold text-primary">
                  {language === "zh" ? "关注" : "Follow"}
                </Text>
              </Pressable>
            </View>

            {/* 交互按钮 */}
            <View className="flex-row items-center justify-around py-3 border-b border-border">
              <Pressable
                onPress={handleLike}
                className="flex-row items-center gap-2 active:opacity-80"
              >
                <MaterialIcons
                  name={liked ? "favorite" : "favorite-border"}
                  size={24}
                  color={liked ? colors.error : colors.muted}
                />
                <Text className="font-semibold text-foreground">{likes}</Text>
              </Pressable>

              <Pressable className="flex-row items-center gap-2 active:opacity-80">
                <MaterialIcons name="comment" size={24} color={colors.muted} />
                <Text className="font-semibold text-foreground">{comments.length}</Text>
              </Pressable>

              <Pressable className="flex-row items-center gap-2 active:opacity-80">
                <MaterialIcons name="share" size={24} color={colors.muted} />
                <Text className="font-semibold text-foreground">
                  {language === "zh" ? "分享" : "Share"}
                </Text>
              </Pressable>
            </View>

            {/* 评论区 */}
            <View className="gap-3">
              <Text className="text-lg font-bold text-foreground">
                {language === "zh" ? "评论" : "Comments"} ({comments.length})
              </Text>

              {/* 评论输入框 */}
              <View className="flex-row items-center gap-2 bg-surface rounded-full px-4 py-2">
                <TextInput
                  placeholder={language === "zh" ? "写评论..." : "Write a comment..."}
                  value={comment}
                  onChangeText={setComment}
                  placeholderTextColor={colors.muted}
                  className="flex-1 text-foreground"
                />
                <Pressable
                  onPress={handleAddComment}
                  disabled={!comment.trim()}
                  className="p-2"
                >
                  <MaterialIcons
                    name="send"
                    size={20}
                    color={comment.trim() ? colors.primary : colors.muted}
                  />
                </Pressable>
              </View>

              {/* 评论列表 */}
              <FlatList
                data={comments}
                renderItem={renderComment}
                keyExtractor={(item) => item.id.toString()}
                scrollEnabled={false}
              />
            </View>
          </View>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
