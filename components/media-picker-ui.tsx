import { View, Text, FlatList, Pressable, Image, ScrollView } from "react-native";
import { useState, useEffect } from "react";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useColors } from "@/hooks/use-colors";
import { useLanguage } from "@/lib/language-provider";
import { useMediaLibrary, MediaAsset, MediaAlbum } from "@/hooks/use-media-library";

interface MediaPickerUIProps {
  onMediaSelected?: (media: MediaAsset[]) => void;
  multiSelect?: boolean;
  mediaType?: "photo" | "video" | "all";
}

export function MediaPickerUI({
  onMediaSelected,
  multiSelect = true,
  mediaType = "all",
}: MediaPickerUIProps) {
  const colors = useColors();
  const { language } = useLanguage();
  const {
    albums,
    recentAssets,
    permissionStatus,
    isLoading,
    requestPermission,
    getAlbums,
    getAlbumAssets,
    getRecentAssets,
  } = useMediaLibrary();

  const [selectedAlbum, setSelectedAlbum] = useState<MediaAlbum | null>(null);
  const [albumAssets, setAlbumAssets] = useState<MediaAsset[]>([]);
  const [selectedMedia, setSelectedMedia] = useState<Set<string>>(new Set());
  const [showAlbumList, setShowAlbumList] = useState(true);

  useEffect(() => {
    // 初始化权限和加载相册
    const initialize = async () => {
      if (!permissionStatus.hasPermission) {
        await requestPermission();
      }
      await getAlbums();
      await getRecentAssets(20);
    };

    initialize();
  }, []);

  const handleAlbumSelect = async (album: MediaAlbum) => {
    setSelectedAlbum(album);
    setShowAlbumList(false);
    const assets = await getAlbumAssets(album.id, 100);
    setAlbumAssets(assets);
  };

  const handleMediaToggle = (mediaId: string) => {
    if (!multiSelect) {
      setSelectedMedia(new Set([mediaId]));
      onMediaSelected?.([{ id: mediaId } as MediaAsset]);
      return;
    }

    const newSelected = new Set(selectedMedia);
    if (newSelected.has(mediaId)) {
      newSelected.delete(mediaId);
    } else {
      newSelected.add(mediaId);
    }
    setSelectedMedia(newSelected);
  };

  const handleConfirm = () => {
    const selected = albumAssets.filter(asset => selectedMedia.has(asset.id));
    onMediaSelected?.(selected);
  };

  const filteredAssets = albumAssets.filter(asset => {
    if (mediaType === "all") return true;
    return asset.mediaType === mediaType;
  });

  const renderMediaItem = ({ item }: { item: MediaAsset }) => {
    const isSelected = selectedMedia.has(item.id);

    return (
      <Pressable
        onPress={() => handleMediaToggle(item.id)}
        className="flex-1 m-1 relative"
      >
        <Image
          source={{ uri: item.uri }}
          className="w-full aspect-square rounded-lg"
        />

        {/* 视频标记 */}
        {item.mediaType === "video" && (
          <View className="absolute bottom-2 right-2 flex-row items-center gap-1 bg-black/60 px-2 py-1 rounded">
            <MaterialIcons name="play-arrow" size={14} color="white" />
            <Text className="text-xs text-white font-semibold">
              {Math.floor((item.duration || 0) / 60)}:{((item.duration || 0) % 60)
                .toString()
                .padStart(2, "0")}
            </Text>
          </View>
        )}

        {/* 选择复选框 */}
        {multiSelect && (
          <Pressable
            onPress={() => handleMediaToggle(item.id)}
            className={`absolute top-2 right-2 w-6 h-6 rounded-full border-2 items-center justify-center ${
              isSelected
                ? "bg-primary border-primary"
                : "bg-transparent border-white"
            }`}
          >
            {isSelected && (
              <MaterialIcons name="check" size={16} color="white" />
            )}
          </Pressable>
        )}
      </Pressable>
    );
  };

  const renderAlbumItem = ({ item }: { item: MediaAlbum }) => (
    <Pressable
      onPress={() => handleAlbumSelect(item)}
      className="flex-row items-center gap-3 p-4 bg-surface rounded-lg mb-2 active:opacity-70"
    >
      <View className="w-16 h-16 bg-primary/20 rounded-lg items-center justify-center">
        <MaterialIcons name="photo-library" size={32} color={colors.primary} />
      </View>
      <View className="flex-1">
        <Text className="text-base font-semibold text-foreground">
          {item.title}
        </Text>
        <Text className="text-sm text-muted">
          {language === "zh" ? `${item.assetCount}张` : `${item.assetCount} items`}
        </Text>
      </View>
      <MaterialIcons name="chevron-right" size={24} color={colors.muted} />
    </Pressable>
  );

  if (!permissionStatus.hasPermission) {
    return (
      <View className="flex-1 items-center justify-center gap-4 p-6">
        <MaterialIcons name="photo-library" size={64} color={colors.muted} />
        <Text className="text-lg font-semibold text-foreground text-center">
          {language === "zh"
            ? "需要访问相册权限"
            : "Permission required to access photos"}
        </Text>
        <Pressable
          onPress={requestPermission}
          className="bg-primary px-6 py-3 rounded-full active:opacity-80"
        >
          <Text className="text-white font-semibold">
            {language === "zh" ? "授予权限" : "Grant Permission"}
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      {/* 顶部导航 */}
      <View className="flex-row items-center justify-between px-4 py-4 bg-surface border-b border-border">
        {!showAlbumList && (
          <Pressable onPress={() => setShowAlbumList(true)} className="p-2">
            <MaterialIcons name="arrow-back" size={24} color={colors.foreground} />
          </Pressable>
        )}
        <Text className="text-lg font-bold text-foreground flex-1">
          {showAlbumList
            ? language === "zh"
              ? "选择相册"
              : "Select Album"
            : selectedAlbum?.title}
        </Text>
        {!showAlbumList && selectedMedia.size > 0 && (
          <Pressable
            onPress={handleConfirm}
            className="bg-primary px-4 py-2 rounded-full active:opacity-80"
          >
            <Text className="text-white font-semibold text-sm">
              {language === "zh" ? `确定(${selectedMedia.size})` : `Done(${selectedMedia.size})`}
            </Text>
          </Pressable>
        )}
      </View>

      {/* 内容区域 */}
      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <MaterialIcons name="hourglass-empty" size={48} color={colors.muted} />
          <Text className="text-muted mt-2">
            {language === "zh" ? "加载中..." : "Loading..."}
          </Text>
        </View>
      ) : showAlbumList ? (
        // 相册列表
        <ScrollView className="flex-1 p-4">
          {/* 最近使用 */}
          {recentAssets.length > 0 && (
            <View className="mb-6">
              <Text className="text-base font-semibold text-foreground mb-3">
                {language === "zh" ? "最近" : "Recent"}
              </Text>
              <FlatList
                data={recentAssets.slice(0, 6)}
                renderItem={renderMediaItem}
                keyExtractor={item => item.id}
                numColumns={3}
                scrollEnabled={false}
                columnWrapperStyle={{ gap: 4 }}
              />
            </View>
          )}

          {/* 相册列表 */}
          <Text className="text-base font-semibold text-foreground mb-3">
            {language === "zh" ? "相册" : "Albums"}
          </Text>
          {albums.map(album => (
            <View key={album.id}>
              {renderAlbumItem({ item: album })}
            </View>
          ))}
        </ScrollView>
      ) : (
        // 媒体网格
        <FlatList
          data={filteredAssets}
          renderItem={renderMediaItem}
          keyExtractor={item => item.id}
          numColumns={3}
          columnWrapperStyle={{ gap: 4, paddingHorizontal: 4 }}
          contentContainerStyle={{ paddingVertical: 4 }}
        />
      )}
    </View>
  );
}
