import { ScrollView, Text, View, Pressable, Image, TextInput, FlatList } from "react-native";
import { useState } from "react";
import { useRouter } from "expo-router";
import { useLanguage } from "@/lib/language-provider";
import { useColors } from "@/hooks/use-colors";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { ScreenContainer } from "@/components/screen-container";

const MOCK_CHAPTERS = [
  {
    id: 1,
    title: "初相识",
    titleEn: "First Meeting",
    date: "1975-10-18",
    content: "那是一个秋天的午后，我在校园里第一次见到你。阳光透过树叶洒下斑驳的光影，你穿着简朴的白色连衣裙，笑容如同秋日的阳光一样温暖。我永远不会忘记那一刻，我的心跳加速，仿佛整个世界都为你而停留。",
    contentEn: "It was an autumn afternoon when I first saw you on campus. The sunlight filtered through the leaves, casting dappled shadows. You wore a simple white dress, and your smile was as warm as the autumn sun. I will never forget that moment when my heart skipped a beat.",
    image: "https://images.unsplash.com/photo-1511895426328-dc8714191011?w=400&q=80",
  },
  {
    id: 2,
    title: "相知相爱",
    titleEn: "Falling in Love",
    date: "1976-06-15",
    content: "我们一起走过校园的每个角落，在图书馆里一起读书，在食堂里分享彼此的饭菜。你用温柔的话语消解我心中的忧虑，我用行动证明我对你的爱。那些日子是我人生中最美好的时光。",
    contentEn: "We walked through every corner of campus together, studied in the library, and shared meals in the cafeteria. Your gentle words eased my worries, and my actions proved my love for you. Those days were the most beautiful time of my life.",
    image: "https://images.unsplash.com/photo-1464366400600-7168b8af9bc3?w=400&q=80",
  },
  {
    id: 3,
    title: "步入婚姻殿堂",
    titleEn: "Wedding Day",
    date: "1975-10-18",
    content: "在那个阳光灿烂的日子里，我们在众人的祝福下走进了婚姻的殿堂。你穿着洁白的婚纱，我穿着笔挺的西装，我们在神圣的誓言中承诺了一生的陪伴。那一刻，我们成为了彼此的永远。",
    contentEn: "On that sunny day, we entered the hall of marriage with everyone's blessings. You wore a white wedding dress, I wore a sharp suit, and we promised a lifetime of companionship in sacred vows. At that moment, we became each other's forever.",
    image: "https://images.unsplash.com/photo-1516589091380-5d8e87df6999?w=400&q=80",
  },
];

export default function StoriesScreen() {
  const router = useRouter();
  const { t, language } = useLanguage();
  const colors = useColors();
  const [chapters, setChapters] = useState(MOCK_CHAPTERS);
  const [selectedChapter, setSelectedChapter] = useState<number | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");

  const handleEditChapter = (chapter: any) => {
    setSelectedChapter(chapter.id);
    setEditTitle(language === "zh" ? chapter.title : chapter.titleEn);
    setEditContent(language === "zh" ? chapter.content : chapter.contentEn);
    setEditMode(true);
  };

  const handleSaveChapter = () => {
    if (selectedChapter && editTitle && editContent) {
      setChapters(
        chapters.map(c =>
          c.id === selectedChapter
            ? {
                ...c,
                title: editTitle,
                content: editContent,
              }
            : c
        )
      );
      setEditMode(false);
      setSelectedChapter(null);
    }
  };

  const handleAddChapter = () => {
    setSelectedChapter(null);
    setEditTitle("");
    setEditContent("");
    setEditMode(true);
  };

  const renderChapterItem = ({ item }: any) => (
    <Pressable
      onPress={() => handleEditChapter(item)}
      className="mb-4 bg-surface rounded-2xl overflow-hidden"
    >
      <View className="flex-row">
        <Image
          source={{ uri: item.image }}
          className="w-24 h-24"
        />
        <View className="flex-1 p-3 gap-2 justify-between">
          <View>
            <Text className="text-lg font-bold text-foreground">
              {language === "zh" ? item.title : item.titleEn}
            </Text>
            <Text className="text-xs text-muted">{item.date}</Text>
          </View>
          <Text className="text-sm text-muted" numberOfLines={2}>
            {language === "zh" ? item.content : item.contentEn}
          </Text>
        </View>
      </View>
    </Pressable>
  );

  if (editMode) {
    return (
      <ScreenContainer className="bg-background p-0">
        <ScrollView
          contentContainerStyle={{ flexGrow: 1 }}
          showsVerticalScrollIndicator={false}
        >
          <View className="flex-1">
            {/* 顶部导航 */}
            <View className="flex-row items-center justify-between px-6 py-4 bg-surface">
              <Pressable onPress={() => setEditMode(false)} className="p-2">
                <MaterialIcons name="arrow-back" size={24} color={colors.foreground} />
              </Pressable>
              <Text className="text-lg font-bold text-foreground">
                {language === "zh" ? "编辑故事" : "Edit Story"}
              </Text>
              <View className="w-10" />
            </View>

            {/* 编辑内容 */}
            <View className="flex-1 px-6 py-4 gap-4">
              <View className="gap-2">
                <Text className="text-lg font-bold text-foreground">
                  {language === "zh" ? "标题" : "Title"}
                </Text>
                <TextInput
                  placeholder={language === "zh" ? "输入标题" : "Enter title"}
                  value={editTitle}
                  onChangeText={setEditTitle}
                  placeholderTextColor={colors.muted}
                  className="bg-surface rounded-2xl px-4 py-3 text-foreground"
                />
              </View>

              <View className="gap-2 flex-1">
                <Text className="text-lg font-bold text-foreground">
                  {language === "zh" ? "内容" : "Content"}
                </Text>
                <TextInput
                  placeholder={language === "zh" ? "输入故事内容" : "Enter story content"}
                  value={editContent}
                  onChangeText={setEditContent}
                  placeholderTextColor={colors.muted}
                  className="bg-surface rounded-2xl px-4 py-3 text-foreground flex-1"
                  multiline
                  textAlignVertical="top"
                />
              </View>

              <View className="flex-row gap-3">
                <Pressable
                  onPress={() => setEditMode(false)}
                  className="flex-1 bg-surface rounded-full py-3 items-center justify-center active:opacity-80"
                >
                  <Text className="font-semibold text-foreground">
                    {language === "zh" ? "取消" : "Cancel"}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={handleSaveChapter}
                  className="flex-1 bg-primary rounded-full py-3 items-center justify-center active:opacity-80"
                >
                  <Text className="font-semibold text-white">
                    {language === "zh" ? "保存" : "Save"}
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        </ScrollView>
      </ScreenContainer>
    );
  }

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
              {language === "zh" ? "爱情故事" : "Love Story"}
            </Text>
            <Pressable className="p-2">
              <MaterialIcons name="share" size={24} color={colors.foreground} />
            </Pressable>
          </View>

          {/* 主要内容 */}
          <View className="flex-1 px-6 py-4 gap-6">
            {/* 标题和描述 */}
            <View className="gap-2">
              <Text className="text-2xl font-bold text-foreground">
                {language === "zh" ? "我们的故事" : "Our Story"}
              </Text>
              <Text className="text-sm text-muted">
                {language === "zh"
                  ? "记录我们相知相爱的每一个时刻"
                  : "Record every moment of our love story"}
              </Text>
            </View>

            {/* 时间轴 */}
            <View className="gap-4">
              {chapters.map((chapter, index) => (
                <View key={chapter.id} className="flex-row gap-4">
                  {/* 时间轴点 */}
                  <View className="items-center gap-2">
                    <View
                      className="w-4 h-4 rounded-full border-2"
                      style={{ borderColor: colors.primary }}
                    />
                    {index < chapters.length - 1 && (
                      <View
                        className="w-0.5 h-20"
                        style={{ backgroundColor: colors.border }}
                      />
                    )}
                  </View>

                  {/* 章节卡片 */}
                  <Pressable
                    onPress={() => handleEditChapter(chapter)}
                    className="flex-1 bg-surface rounded-2xl p-4 gap-3 active:opacity-80"
                  >
                    <View className="gap-1">
                      <Text className="text-lg font-bold text-foreground">
                        {language === "zh" ? chapter.title : chapter.titleEn}
                      </Text>
                      <Text className="text-xs text-muted">{chapter.date}</Text>
                    </View>
                    <Text className="text-sm text-muted" numberOfLines={3}>
                      {language === "zh" ? chapter.content : chapter.contentEn}
                    </Text>
                    {chapter.image && (
                      <Image
                        source={{ uri: chapter.image }}
                        className="w-full h-24 rounded-lg"
                      />
                    )}
                  </Pressable>
                </View>
              ))}
            </View>

            {/* 添加新章节按钮 */}
            <Pressable
              onPress={handleAddChapter}
              className="flex-row items-center justify-center gap-2 bg-primary rounded-full py-3 active:opacity-80"
            >
              <MaterialIcons name="add" size={24} color="white" />
              <Text className="text-white font-bold text-lg">
                {language === "zh" ? "添加新章节" : "Add New Chapter"}
              </Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
