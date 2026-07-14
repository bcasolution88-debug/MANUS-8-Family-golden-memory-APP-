import { ScrollView, Text, View, Pressable, Image, TextInput, FlatList } from "react-native";
import { useState } from "react";
import { useRouter } from "expo-router";
import { useLanguage } from "@/lib/language-provider";
import { useColors } from "@/hooks/use-colors";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { ScreenContainer } from "@/components/screen-container";

const CATEGORIES = [
  { id: 1, name: "日常", nameEn: "Daily", icon: "image" },
  { id: 2, name: "聚会", nameEn: "Gathering", icon: "people" },
  { id: 3, name: "旅游", nameEn: "Travel", icon: "flight-takeoff" },
  { id: 4, name: "纪念", nameEn: "Memorial", icon: "favorite" },
  { id: 5, name: "其他", nameEn: "Other", icon: "more" },
];

export default function UploadScreen() {
  const router = useRouter();
  const { t, language } = useLanguage();
  const colors = useColors();
  const [selectedCategory, setSelectedCategory] = useState(1);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [selectedMedia, setSelectedMedia] = useState<any[]>([
    { id: 1, type: "image", uri: "https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=200&q=80" },
    { id: 2, type: "video", uri: "https://images.unsplash.com/photo-1516589091380-5d8e87df6999?w=200&q=80" },
  ]);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploading, setUploading] = useState(false);

  const handleSelectMedia = () => {
    // TODO: 集成图片/视频选择器
  };

  const handleUpload = async () => {
    if (!title || selectedMedia.length === 0) {
      alert(language === "zh" ? "请填写标题并选择媒体" : "Please enter title and select media");
      return;
    }

    setUploading(true);
    // 模拟上传进度
    for (let i = 0; i <= 100; i += 10) {
      await new Promise(resolve => setTimeout(resolve, 200));
      setUploadProgress(i);
    }
    setUploading(false);
    setUploadProgress(0);
    router.back();
  };

  const renderMediaItem = ({ item }: any) => (
    <View className="relative">
      <Image
        source={{ uri: item.uri }}
        className="w-20 h-20 rounded-lg"
      />
      {item.type === "video" && (
        <View className="absolute inset-0 items-center justify-center rounded-lg bg-black/30">
          <MaterialIcons name="play-circle" size={32} color="white" />
        </View>
      )}
      <Pressable
        onPress={() => setSelectedMedia(selectedMedia.filter(m => m.id !== item.id))}
        className="absolute -top-2 -right-2 bg-error rounded-full p-1"
      >
        <MaterialIcons name="close" size={16} color="white" />
      </Pressable>
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
              {language === "zh" ? "上传照片/视频" : "Upload Photos/Videos"}
            </Text>
            <View className="w-10" />
          </View>

          {/* 主要内容 */}
          <View className="flex-1 px-6 py-4 gap-6">
            {/* 媒体选择区域 */}
            <View className="gap-3">
              <Text className="text-lg font-bold text-foreground">
                {language === "zh" ? "选择媒体" : "Select Media"}
              </Text>

              {selectedMedia.length > 0 ? (
                <View className="gap-3">
                  <FlatList
                    data={selectedMedia}
                    renderItem={renderMediaItem}
                    keyExtractor={(item) => item.id.toString()}
                    numColumns={4}
                    scrollEnabled={false}
                    columnWrapperStyle={{ gap: 12 }}
                  />
                  <Pressable
                    onPress={handleSelectMedia}
                    className="flex-row items-center justify-center gap-2 bg-surface rounded-2xl py-3 border border-dashed border-primary active:opacity-80"
                  >
                    <MaterialIcons name="add" size={24} color={colors.primary} />
                    <Text className="text-sm font-semibold text-primary">
                      {language === "zh" ? "添加更多" : "Add More"}
                    </Text>
                  </Pressable>
                </View>
              ) : (
                <Pressable
                  onPress={handleSelectMedia}
                  className="bg-surface rounded-2xl py-12 items-center justify-center border border-dashed border-border active:opacity-80 gap-2"
                >
                  <MaterialIcons name="add-photo-alternate" size={48} color={colors.muted} />
                  <Text className="text-sm font-semibold text-foreground">
                    {language === "zh" ? "点击选择照片或视频" : "Click to select photos or videos"}
                  </Text>
                  <Text className="text-xs text-muted">
                    {language === "zh" ? "支持JPG、PNG、MP4格式" : "Supports JPG, PNG, MP4 formats"}
                  </Text>
                </Pressable>
              )}
            </View>

            {/* 分类选择 */}
            <View className="gap-3">
              <Text className="text-lg font-bold text-foreground">
                {language === "zh" ? "分类" : "Category"}
              </Text>
              <FlatList
                data={CATEGORIES}
                renderItem={({ item }) => (
                  <Pressable
                    onPress={() => setSelectedCategory(item.id)}
                    className={`flex-1 rounded-2xl py-3 items-center justify-center gap-1 ${
                      selectedCategory === item.id
                        ? "bg-primary"
                        : "bg-surface"
                    }`}
                  >
                    <MaterialIcons
                      name={item.icon as any}
                      size={20}
                      color={selectedCategory === item.id ? "white" : colors.foreground}
                    />
                    <Text
                      className={`text-xs font-semibold ${
                        selectedCategory === item.id
                          ? "text-white"
                          : "text-foreground"
                      }`}
                    >
                      {language === "zh" ? item.name : item.nameEn}
                    </Text>
                  </Pressable>
                )}
                keyExtractor={(item) => item.id.toString()}
                numColumns={5}
                scrollEnabled={false}
                columnWrapperStyle={{ gap: 8 }}
              />
            </View>

            {/* 标题和描述 */}
            <View className="gap-3">
              <View className="gap-2">
                <Text className="text-lg font-bold text-foreground">
                  {language === "zh" ? "标题" : "Title"}
                </Text>
                <TextInput
                  placeholder={language === "zh" ? "输入标题" : "Enter title"}
                  value={title}
                  onChangeText={setTitle}
                  placeholderTextColor={colors.muted}
                  className="bg-surface rounded-2xl px-4 py-3 text-foreground"
                  maxLength={50}
                />
                <Text className="text-xs text-muted text-right">
                  {title.length}/50
                </Text>
              </View>

              <View className="gap-2">
                <Text className="text-lg font-bold text-foreground">
                  {language === "zh" ? "描述" : "Description"}
                </Text>
                <TextInput
                  placeholder={language === "zh" ? "输入描述（可选）" : "Enter description (optional)"}
                  value={description}
                  onChangeText={setDescription}
                  placeholderTextColor={colors.muted}
                  className="bg-surface rounded-2xl px-4 py-3 text-foreground h-24"
                  multiline
                  maxLength={200}
                />
                <Text className="text-xs text-muted text-right">
                  {description.length}/200
                </Text>
              </View>
            </View>

            {/* 上传进度 */}
            {uploading && (
              <View className="gap-2">
                <View className="flex-row items-center justify-between">
                  <Text className="text-sm font-semibold text-foreground">
                    {language === "zh" ? "上传中" : "Uploading"}
                  </Text>
                  <Text className="text-sm font-semibold text-primary">
                    {uploadProgress}%
                  </Text>
                </View>
                <View
                  className="w-full h-2 rounded-full overflow-hidden"
                  style={{ backgroundColor: colors.surface }}
                >
                  <View
                    className="h-full bg-primary"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </View>
              </View>
            )}

            {/* 上传按钮 */}
            <Pressable
              onPress={handleUpload}
              disabled={uploading || selectedMedia.length === 0 || !title}
              className={`rounded-full py-4 items-center justify-center active:opacity-80 ${
                uploading || selectedMedia.length === 0 || !title
                  ? "bg-muted/50"
                  : "bg-primary"
              }`}
            >
              <Text className="text-white font-bold text-lg">
                {uploading
                  ? language === "zh"
                    ? "上传中..."
                    : "Uploading..."
                  : language === "zh"
                  ? "确认上传"
                  : "Confirm Upload"}
              </Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
