import { ScrollView, Text, View, Pressable, Image, FlatList } from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { useLanguage } from "@/lib/language-provider";
import { useColors } from "@/hooks/use-colors";
import { useState } from "react";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

interface Album {
  id: string;
  name: string;
  thumbnail: string;
  photoCount: number;
  videoCount: number;
  createdBy: string;
  createdDate: string;
  isPrivate: boolean;
}

export default function AlbumScreen() {
  const { t } = useLanguage();
  const colors = useColors();

  const [albums, setAlbums] = useState<Album[]>([
    {
      id: '1',
      name: '家庭年度聚会',
      thumbnail: 'https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=200&q=80',
      photoCount: 12,
      videoCount: 2,
      createdBy: '小雅',
      createdDate: '2025-06-18',
      isPrivate: false,
    },
    {
      id: '2',
      name: '金婚纪念日派对',
      thumbnail: 'https://images.unsplash.com/photo-1511895426328-dc8714191011?w=200&q=80',
      photoCount: 24,
      videoCount: 5,
      createdBy: '小明',
      createdDate: '2025-05-12',
      isPrivate: false,
    },
    {
      id: '3',
      name: '春节家庭聚餐',
      thumbnail: 'https://images.unsplash.com/photo-1529543544282-ea669407fca3?w=200&q=80',
      photoCount: 18,
      videoCount: 3,
      createdBy: '陈妈妈',
      createdDate: '2025-02-10',
      isPrivate: true,
    },
    {
      id: '4',
      name: '旅游回忆',
      thumbnail: 'https://images.unsplash.com/photo-1464366400600-7168b8af9bc3?w=200&q=80',
      photoCount: 36,
      videoCount: 8,
      createdBy: '陈爸爸',
      createdDate: '2025-01-15',
      isPrivate: false,
    },
  ]);

  const totalPhotos = albums.reduce((sum, a) => sum + a.photoCount, 0);
  const totalVideos = albums.reduce((sum, a) => sum + a.videoCount, 0);

  return (
    <ScreenContainer className="flex-1 bg-background">
      <ScrollView
        contentContainerStyle={{ flexGrow: 1 }}
        showsVerticalScrollIndicator={false}
      >
        <View className="gap-6 pb-6">
          {/* Header */}
          <View className="gap-2">
            <Text className="text-3xl font-bold text-foreground">
              {t('album')}
            </Text>
            <Text className="text-base text-muted">
              {albums.length} {t('album')} · {totalPhotos} {t('photos')} · {totalVideos} {t('videos')}
            </Text>
          </View>

          {/* Create Album Button */}
          <Pressable className="bg-primary rounded-lg py-4 items-center flex-row justify-center gap-2">
            <MaterialIcons name="add-a-photo" size={24} color="white" />
            <Text className="text-white font-bold text-base">
              {t('createAlbum')}
            </Text>
          </Pressable>

          {/* Albums Grid */}
          <View className="gap-3">
            {albums.map((album) => (
              <Pressable
                key={album.id}
                className="bg-surface rounded-lg overflow-hidden gap-3"
              >
                {/* Thumbnail */}
                <View className="relative h-40 overflow-hidden">
                  <Image
                    source={{ uri: album.thumbnail }}
                    className="w-full h-full"
                  />
                  {album.isPrivate && (
                    <View className="absolute top-3 right-3 bg-black bg-opacity-60 rounded-lg px-2 py-1 flex-row items-center gap-1">
                      <MaterialIcons name="lock" size={12} color="white" />
                      <Text className="text-white text-xs font-semibold">
                        {t('privacy')}
                      </Text>
                    </View>
                  )}
                </View>

                {/* Album Info */}
                <View className="gap-2 px-4 pb-4">
                  <Text className="text-lg font-bold text-foreground">
                    {album.name}
                  </Text>

                  <View className="flex-row gap-4">
                    <View className="flex-row items-center gap-1">
                      <MaterialIcons name="photo" size={16} color={colors.muted} />
                      <Text className="text-sm text-muted">
                        {album.photoCount}
                      </Text>
                    </View>
                    <View className="flex-row items-center gap-1">
                      <MaterialIcons name="videocam" size={16} color={colors.muted} />
                      <Text className="text-sm text-muted">
                        {album.videoCount}
                      </Text>
                    </View>
                  </View>

                  <View className="flex-row items-center justify-between pt-2 border-t border-border">
                    <View className="flex-row items-center gap-2">
                      <View className="w-8 h-8 rounded-full bg-primary items-center justify-center">
                        <Text className="text-white text-xs font-bold">
                          {album.createdBy.charAt(0)}
                        </Text>
                      </View>
                      <View>
                        <Text className="text-xs font-semibold text-foreground">
                          {album.createdBy}
                        </Text>
                        <Text className="text-xs text-muted">
                          {album.createdDate}
                        </Text>
                      </View>
                    </View>
                    <MaterialIcons
                      name="chevron-right"
                      size={24}
                      color={colors.muted}
                    />
                  </View>
                </View>
              </Pressable>
            ))}
          </View>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
