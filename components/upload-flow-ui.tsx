import { View, Text, ScrollView, Pressable, TextInput } from "react-native";
import { useState } from "react";
import { useColors } from "@/hooks/use-colors";
import { useLanguage } from "@/lib/language-provider";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

interface UploadFlowUIProps {
  onUploadComplete?: (mediaData: any) => void;
  onCancel?: () => void;
}

export function UploadFlowUI({ onUploadComplete, onCancel }: UploadFlowUIProps) {
  const colors = useColors();
  const { language } = useLanguage();
  const [step, setStep] = useState<"select" | "edit" | "progress">("select");
  const [selectedMedia, setSelectedMedia] = useState<any[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [uploadProgress, setUploadProgress] = useState(0);

  const availableTags = ["family", "celebration", "memories", "daily", "special"];

  const handleSelectMedia = () => {
    // 模拟媒体选择
    setSelectedMedia([
      { id: "1", type: "photo", name: "photo1.jpg", size: 2048 },
      { id: "2", type: "video", name: "video1.mp4", size: 51200 },
    ]);
    setStep("edit");
  };

  const handleStartUpload = () => {
    setStep("progress");
    // 模拟上传进度
    const interval = setInterval(() => {
      setUploadProgress(prev => {
        if (prev >= 100) {
          clearInterval(interval);
          onUploadComplete?.({
            title,
            description,
            tags: selectedTags,
            media: selectedMedia,
          });
          return 100;
        }
        return prev + Math.random() * 30;
      });
    }, 500);
  };

  const toggleTag = (tag: string) => {
    setSelectedTags(prev =>
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    );
  };

  return (
    <View className="flex-1 bg-background">
      {/* 步骤指示器 */}
      <View className="flex-row items-center justify-between px-4 py-6 bg-surface border-b border-border">
        {["select", "edit", "progress"].map((s, idx) => (
          <View key={s} className="flex-1 items-center">
            <View
              className={`w-8 h-8 rounded-full items-center justify-center ${
                step === s ? "bg-primary" : "bg-muted"
              }`}
            >
              <Text className="text-white text-xs font-bold">{idx + 1}</Text>
            </View>
            {idx < 2 && (
              <View
                className={`flex-1 h-1 ${step === s || step === "progress" ? "bg-primary" : "bg-border"}`}
              />
            )}
          </View>
        ))}
      </View>

      {/* 内容区域 */}
      <ScrollView className="flex-1 px-4 py-6">
        {step === "select" && (
          <View className="gap-6">
            <Text className="text-lg font-bold text-foreground">
              {language === "zh" ? "选择媒体文件" : "Select Media"}
            </Text>

            <Pressable
              onPress={handleSelectMedia}
              className="border-2 border-dashed border-primary rounded-lg p-8 items-center justify-center active:opacity-80"
            >
              <MaterialIcons name="cloud-upload" size={48} color={colors.primary} />
              <Text className="text-primary font-semibold mt-4">
                {language === "zh" ? "点击选择照片或视频" : "Tap to select photos or videos"}
              </Text>
              <Text className="text-muted text-sm mt-2">
                {language === "zh" ? "支持 JPG, PNG, MP4 格式" : "Supports JPG, PNG, MP4 formats"}
              </Text>
            </Pressable>

            <View className="gap-2">
              <Text className="text-sm font-semibold text-muted">
                {language === "zh" ? "提示" : "Tips"}
              </Text>
              <Text className="text-xs text-muted leading-relaxed">
                {language === "zh"
                  ? "• 单次最多上传 10 个文件\n• 单个文件大小不超过 500MB\n• 建议使用 WiFi 网络上传"
                  : "• Max 10 files per upload\n• Max 500MB per file\n• WiFi recommended"}
              </Text>
            </View>
          </View>
        )}

        {step === "edit" && (
          <View className="gap-6">
            <Text className="text-lg font-bold text-foreground">
              {language === "zh" ? "编辑媒体信息" : "Edit Media Info"}
            </Text>

            {/* 已选媒体预览 */}
            <View className="gap-2">
              <Text className="text-sm font-semibold text-foreground">
                {language === "zh" ? "已选择文件" : "Selected Files"}
              </Text>
              {selectedMedia.map(media => (
                <View
                  key={media.id}
                  className="flex-row items-center gap-3 p-3 rounded-lg bg-surface border border-border"
                >
                  <MaterialIcons
                    name={media.type === "photo" ? "image" : "videocam"}
                    size={24}
                    color={colors.primary}
                  />
                  <View className="flex-1">
                    <Text className="text-sm font-semibold text-foreground">{media.name}</Text>
                    <Text className="text-xs text-muted">
                      {(media.size / 1024).toFixed(1)} KB
                    </Text>
                  </View>
                </View>
              ))}
            </View>

            {/* 标题 */}
            <View className="gap-2">
              <Text className="text-sm font-semibold text-foreground">
                {language === "zh" ? "标题" : "Title"}
              </Text>
              <TextInput
                value={title}
                onChangeText={setTitle}
                placeholder={language === "zh" ? "输入标题（可选）" : "Enter title (optional)"}
                className="border border-border rounded-lg px-4 py-3 text-foreground"
                placeholderTextColor={colors.muted}
              />
            </View>

            {/* 描述 */}
            <View className="gap-2">
              <Text className="text-sm font-semibold text-foreground">
                {language === "zh" ? "描述" : "Description"}
              </Text>
              <TextInput
                value={description}
                onChangeText={setDescription}
                placeholder={language === "zh" ? "输入描述（可选）" : "Enter description (optional)"}
                multiline
                numberOfLines={4}
                className="border border-border rounded-lg px-4 py-3 text-foreground"
                placeholderTextColor={colors.muted}
              />
            </View>

            {/* 标签 */}
            <View className="gap-2">
              <Text className="text-sm font-semibold text-foreground">
                {language === "zh" ? "分类标签" : "Tags"}
              </Text>
              <View className="flex-row flex-wrap gap-2">
                {availableTags.map(tag => (
                  <Pressable
                    key={tag}
                    onPress={() => toggleTag(tag)}
                    className={`px-4 py-2 rounded-full border ${
                      selectedTags.includes(tag)
                        ? "bg-primary border-primary"
                        : "bg-surface border-border"
                    }`}
                  >
                    <Text
                      className={`text-sm font-semibold ${
                        selectedTags.includes(tag) ? "text-white" : "text-foreground"
                      }`}
                    >
                      {tag}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          </View>
        )}

        {step === "progress" && (
          <View className="gap-6 items-center justify-center py-12">
            <View className="w-24 h-24 rounded-full border-4 border-primary/20 border-t-primary items-center justify-center">
              <Text className="text-2xl font-bold text-primary">
                {Math.round(uploadProgress)}%
              </Text>
            </View>

            <View className="w-full gap-2">
              <View className="w-full h-2 bg-muted rounded-full overflow-hidden">
                <View
                  className="h-full bg-primary"
                  style={{ width: `${uploadProgress}%` }}
                />
              </View>
              <Text className="text-center text-sm text-muted">
                {language === "zh" ? "上传中..." : "Uploading..."}
              </Text>
            </View>

            {uploadProgress === 100 && (
              <View className="gap-2 items-center">
                <MaterialIcons name="check-circle" size={48} color={colors.primary} />
                <Text className="text-lg font-bold text-foreground">
                  {language === "zh" ? "上传完成！" : "Upload Complete!"}
                </Text>
              </View>
            )}
          </View>
        )}
      </ScrollView>

      {/* 底部按钮 */}
      <View className="flex-row gap-3 p-4 border-t border-border bg-surface">
        <Pressable
          onPress={onCancel}
          className="flex-1 border border-border rounded-lg py-3 items-center active:opacity-80"
        >
          <Text className="text-foreground font-semibold">
            {language === "zh" ? "取消" : "Cancel"}
          </Text>
        </Pressable>

        {step !== "progress" && (
          <Pressable
            onPress={() => {
              if (step === "select") {
                handleSelectMedia();
              } else if (step === "edit") {
                handleStartUpload();
              }
            }}
            className="flex-1 bg-primary rounded-lg py-3 items-center active:opacity-80"
          >
            <Text className="text-white font-semibold">
              {step === "select"
                ? language === "zh"
                  ? "下一步"
                  : "Next"
                : language === "zh"
                  ? "开始上传"
                  : "Upload"}
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}
