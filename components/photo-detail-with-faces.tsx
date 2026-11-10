import React, { useState } from "react";
import { View, Text, ScrollView, Pressable, Image } from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useLanguage } from "@/lib/language-provider";
import { useFaceRecognitionInteraction } from "@/hooks/use-face-recognition-interaction";

export interface PhotoDetailWithFacesProps {
  photoId: string;
  photoUrl: string;
  onPersonTagPress?: (personId: string) => void;
  onFilterByPerson?: (personId: string) => void;
}

export function PhotoDetailWithFaces({
  photoId,
  photoUrl,
  onPersonTagPress,
  onFilterByPerson,
}: PhotoDetailWithFacesProps) {
  const colors = useColors();
  const { t } = useLanguage();
  const { getPhotoFaces } = useFaceRecognitionInteraction();
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);

  const faces = getPhotoFaces(photoId);

  const handlePersonTagPress = (personId: string) => {
    setSelectedPersonId(personId);
    onPersonTagPress?.(personId);
  };

  const handleFilterByPerson = (personId: string) => {
    onFilterByPerson?.(personId);
  };

  return (
    <ScreenContainer className="flex-1">
      <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
        <View className="p-4 gap-4">
          {/* 照片展示 */}
          <View className="rounded-lg overflow-hidden bg-surface">
            <Image
              source={{ uri: photoUrl }}
              style={{ width: "100%", height: 300 }}
              resizeMode="cover"
            />
          </View>

          {/* 人物标签部分 */}
          {faces.length > 0 && (
            <View className="gap-3">
              <View className="flex-row items-center justify-between">
                <Text className="text-lg font-bold text-foreground">
                  {t("peopleInPhoto") || "照片中的人物"} ({faces.length})
                </Text>
                <Text className="text-xs text-muted">
                  {t("clickToFilter") || "点击筛选"}
                </Text>
              </View>

              {/* 人物标签网格 */}
              <View className="gap-2">
                {faces.map(face => (
                  <Pressable
                    key={face.personId}
                    className={`bg-surface rounded-lg p-3 flex-row items-center justify-between ${
                      selectedPersonId === face.personId ? "border-2 border-primary" : ""
                    }`}
                    onPress={() => handlePersonTagPress(face.personId)}
                  >
                    <View className="flex-1 flex-row items-center gap-3">
                      {face.avatar && (
                        <Image
                          source={{ uri: face.avatar }}
                          style={{ width: 40, height: 40, borderRadius: 20 }}
                        />
                      )}
                      <View className="flex-1">
                        <Text className="font-semibold text-foreground">{face.name}</Text>
                        <Text className="text-xs text-muted">
                          {t("confidence") || "置信度"}: {(face.confidence * 100).toFixed(0)}%
                        </Text>
                      </View>
                    </View>

                    <Pressable
                      className="bg-primary rounded-lg px-3 py-1"
                      onPress={() => handleFilterByPerson(face.personId)}
                    >
                      <Text className="text-background text-xs font-semibold">
                        {t("filter") || "筛选"}
                      </Text>
                    </Pressable>
                  </Pressable>
                ))}
              </View>

              {/* 快速操作 */}
              <View className="flex-row gap-2">
                <Pressable className="flex-1 bg-primary rounded-lg py-2">
                  <Text className="text-background text-center font-semibold">
                    {t("shareWithPeople") || "分享给这些人"}
                  </Text>
                </Pressable>
                <Pressable className="flex-1 bg-surface border border-border rounded-lg py-2">
                  <Text className="text-foreground text-center font-semibold">
                    {t("editTags") || "编辑标签"}
                  </Text>
                </Pressable>
              </View>
            </View>
          )}

          {/* 无人物检测提示 */}
          {faces.length === 0 && (
            <View className="bg-surface rounded-lg p-4 items-center gap-2">
              <Text className="text-foreground font-semibold">
                {t("noFacesDetected") || "未检测到人物"}
              </Text>
              <Text className="text-sm text-muted text-center">
                {t("noFacesMessage") || "此照片中未检测到任何人物"}
              </Text>
            </View>
          )}

          {/* 照片信息 */}
          <View className="bg-surface rounded-lg p-4 gap-2">
            <Text className="font-semibold text-foreground">
              {t("photoInfo") || "照片信息"}
            </Text>
            <Text className="text-sm text-muted">ID: {photoId}</Text>
            <Text className="text-sm text-muted">
              {t("uploadedAt") || "上传时间"}: {new Date().toLocaleString()}
            </Text>
          </View>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
