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
  const { t } = useLanguage();
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
              {t("uploadFlow.selectMedia")}
            </Text>

            <Pressable
              onPress={handleSelectMedia}
              className="border-2 border-dashed border-primary rounded-lg p-8 items-center justify-center active:opacity-80"
            >
              <MaterialIcons name="cloud-upload" size={48} color={colors.primary} />
              <Text className="text-primary font-semibold mt-4">
                {t("uploadFlow.tapToSelectPhotos")}
              </Text>
              <Text className="text-muted text-sm mt-2">
                {t("uploadFlow.supportsJpgPngMp4")}
              </Text>
            </Pressable>

            <View className="gap-2">
              <Text className="text-sm font-semibold text-muted">
                {t("uploadFlow.tips")}
              </Text>
              <Text className="text-xs text-muted leading-relaxed">
                {t("uploadFlow.max10FilesPer")}
              </Text>
            </View>
          </View>
        )}

        {step === "edit" && (
          <View className="gap-6">
            <Text className="text-lg font-bold text-foreground">
              {t("uploadFlow.editMediaInfo")}
            </Text>

            {/* 已选媒体预览 */}
            <View className="gap-2">
              <Text className="text-sm font-semibold text-foreground">
                {t("uploadFlow.selectedFiles")}
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
                {t("title")}
              </Text>
              <TextInput
                value={title}
                onChangeText={setTitle}
                placeholder={t("uploadFlow.enterTitleOptional")}
                className="border border-border rounded-lg px-4 py-3 text-foreground"
                placeholderTextColor={colors.muted}
              />
            </View>

            {/* 描述 */}
            <View className="gap-2">
              <Text className="text-sm font-semibold text-foreground">
                {t("description")}
              </Text>
              <TextInput
                value={description}
                onChangeText={setDescription}
                placeholder={t("common.enterDescriptionOptional")}
                multiline
                numberOfLines={4}
                className="border border-border rounded-lg px-4 py-3 text-foreground"
                placeholderTextColor={colors.muted}
              />
            </View>

            {/* 标签 */}
            <View className="gap-2">
              <Text className="text-sm font-semibold text-foreground">
                {t("uploadFlow.tags")}
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
                {t("uploading")}
              </Text>
            </View>

            {uploadProgress === 100 && (
              <View className="gap-2 items-center">
                <MaterialIcons name="check-circle" size={48} color={colors.primary} />
                <Text className="text-lg font-bold text-foreground">
                  {t("uploadFlow.uploadComplete")}
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
            {t("cancel")}
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
            <Text className="text-onPrimary font-semibold">
              {step === "select"
                ? t("next")
                : t("uploadFlow.upload")}
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}
