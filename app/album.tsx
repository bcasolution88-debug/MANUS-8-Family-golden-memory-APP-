import { ScrollView, Text, View, Pressable, Image, FlatList, TextInput } from "react-native";
import { useState } from "react";
import { useRouter } from "expo-router";
import { useLanguage } from "@/lib/language-provider";
import { useColors } from "@/hooks/use-colors";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { ScreenContainer } from "@/components/screen-container";

const MOCK_ALBUMS = [
  {
    id: 1,
    title: "家庭聚会",
    titleEn: "Family Gathering",
    category: "聚会",
    categoryEn: "Gathering",
    thumbnail: "https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=200&q=80",
    count: 24,
    date: "2026-06-18",
  },
  {
    id: 2,
    title: "金婚纪念",
    titleEn: "Golden Anniversary",
    category: "纪念",
    categoryEn: "Memorial",
    thumbnail: "https://images.unsplash.com/photo-1511895426328-dc8714191011?w=200&q=80",
    count: 48,
    date: "2026-05-15",
  },
  {
    id: 3,
    title: "旅游回忆",
    titleEn: "Travel Memories",
    category: "旅游",
    categoryEn: "Travel",
    thumbnail: "https://images.unsplash.com/photo-1464366400600-7168b8af9bc3?w=200&q=80",
    count: 32,
    date: "2026-04-20",
  },
  {
    id: 4,
    title: "日常生活",
    titleEn: "Daily Life",
    category: "日常",
    categoryEn: "Daily",
    thumbnail: "https://images.unsplash.com/photo-1516589091380-5d8e87df6999?w=200&q=80",
    count: 156,
    date: "2026-03-10",
  },
  {
    id: 5,
    title: "生日派对",
    titleEn: "Birthday Party",
    category: "聚会",
    categoryEn: "Gathering",
    thumbnail: "https://images.unsplash.com/photo-1504198458649-3128b932f49e?w=200&q=80",
    count: 18,
    date: "2026-02-28",
  },
  {
    id: 6,
    title: "春节活动",
    titleEn: "Spring Festival",
    category: "聚会",
    categoryEn: "Gathering",
    thumbnail: "https://images.unsplash.com/photo-1529543544282-ea669407fca3?w=200&q=80",
    count: 42,
    date: "2026-02-01",
  },
];

const CATEGORIES = [
  { id: 0, name: "全部", nameEn: "All" },
  { id: 1, name: "日常", nameEn: "Daily" },
  { id: 2, name: "聚会", nameEn: "Gathering" },
  { id: 3, name: "旅游", nameEn: "Travel" },
  { id: 4, name: "纪念", nameEn: "Memorial" },
];

const SORT_OPTIONS = [
  { id: 1, name: "最新", nameEn: "Newest" },
  { id: 2, name: "最旧", nameEn: "Oldest" },
  { id: 3, name: "名称", nameEn: "Name" },
  { id: 4, name: "数量", nameEn: "Count" },
];

export default function AlbumScreen() {
  const router = useRouter();
  const { t, language } = useLanguage();
  const colors = useColors();
  const [searchText, setSearchText] = useState("");
  const [selectedCategory, setSelectedCategory] = useState(0);
  const [selectedSort, setSelectedSort] = useState(1);
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [selectedAlbums, setSelectedAlbums] = useState<number[]>([]);

  const filteredAlbums = MOCK_ALBUMS.filter(album => {
    const matchesSearch =
      (language === "zh" ? album.title : album.titleEn)
        .toLowerCase()
        .includes(searchText.toLowerCase());
    const matchesCategory =
      selectedCategory === 0 ||
      (language === "zh" ? album.category : album.categoryEn) ===
        (language === "zh"
          ? CATEGORIES.find(c => c.id === selectedCategory)?.name
          : CATEGORIES.find(c => c.id === selectedCategory)?.nameEn);
    return matchesSearch && matchesCategory;
  });

  const toggleAlbumSelection = (albumId: number) => {
    setSelectedAlbums(
      selectedAlbums.includes(albumId)
        ? selectedAlbums.filter(id => id !== albumId)
        : [...selectedAlbums, albumId]
    );
  };

  const renderAlbumGrid = () => (
    <View className="flex-row flex-wrap gap-3">
      {filteredAlbums.map((album) => (
        <Pressable
          key={album.id}
          onPress={() => {
            if (selectedAlbums.length > 0) {
              toggleAlbumSelection(album.id);
            } else {
              router.push(`/album/${album.id}`);
            }
          }}
          onLongPress={() => toggleAlbumSelection(album.id)}
          className="flex-1 min-w-[48%] active:opacity-80"
        >
          <View className="relative">
            <Image
              source={{ uri: album.thumbnail }}
              className="w-full h-40 rounded-2xl"
            />
            {selectedAlbums.includes(album.id) && (
              <View className="absolute inset-0 bg-black/40 rounded-2xl items-center justify-center">
                <MaterialIcons name="check-circle" size={48} color="white" />
              </View>
            )}
            <View className="absolute top-2 right-2 bg-black/60 rounded-full px-2 py-1">
              <Text className="text-xs text-white font-semibold">
                {album.count} {language === "zh" ? "张" : ""}
              </Text>
            </View>
          </View>

          <View className="mt-2 gap-1">
            <Text className="text-sm font-bold text-foreground">
              {language === "zh" ? album.title : album.titleEn}
            </Text>
            <View className="flex-row items-center justify-between">
              <Text className="text-xs text-muted">
                {language === "zh" ? album.category : album.categoryEn}
              </Text>
              <Text className="text-xs text-muted">{album.date}</Text>
            </View>
          </View>
        </Pressable>
      ))}
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
            <Text className="text-lg font-bold text-foreground">
              {language === "zh" ? "相册" : "Albums"}
            </Text>
            <Pressable className="p-2">
              <MaterialIcons name="notifications" size={24} color={colors.foreground} />
            </Pressable>
          </View>

          {/* 主要内容 */}
          <View className="flex-1 px-6 py-4 gap-4">
            {/* 搜索框 */}
            <View className="flex-row items-center gap-2 bg-surface rounded-full px-4 py-2">
              <MaterialIcons name="search" size={20} color={colors.muted} />
              <TextInput
                placeholder={language === "zh" ? "搜索相册..." : "Search albums..."}
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

            {/* 分类和排序 */}
            <View className="gap-3">
              {/* 分类滚动条 */}
              <FlatList
                data={CATEGORIES}
                renderItem={({ item }) => (
                  <Pressable
                    onPress={() => setSelectedCategory(item.id)}
                    className={`px-4 py-2 rounded-full ${
                      selectedCategory === item.id
                        ? "bg-primary"
                        : "bg-surface"
                    }`}
                  >
                    <Text
                      className={`text-sm font-semibold ${
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
                horizontal
                showsHorizontalScrollIndicator={false}
                scrollEnabled={true}
              />

              {/* 排序按钮 */}
              <View className="flex-row items-center justify-between">
                <Text className="text-sm font-semibold text-foreground">
                  {filteredAlbums.length} {language === "zh" ? "个相册" : "albums"}
                </Text>
                <Pressable
                  onPress={() => setShowSortMenu(!showSortMenu)}
                  className="flex-row items-center gap-1 px-3 py-2 rounded-full bg-surface active:opacity-80"
                >
                  <MaterialIcons name="sort" size={18} color={colors.foreground} />
                  <Text className="text-sm font-semibold text-foreground">
                    {SORT_OPTIONS.find(s => s.id === selectedSort)?.[language === "zh" ? "name" : "nameEn"]}
                  </Text>
                </Pressable>
              </View>

              {/* 排序菜单 */}
              {showSortMenu && (
                <View className="bg-surface rounded-2xl p-2 gap-1">
                  {SORT_OPTIONS.map((option) => (
                    <Pressable
                      key={option.id}
                      onPress={() => {
                        setSelectedSort(option.id);
                        setShowSortMenu(false);
                      }}
                      className={`px-4 py-2 rounded-lg ${
                        selectedSort === option.id ? "bg-primary/20" : ""
                      }`}
                    >
                      <Text
                        className={`text-sm font-semibold ${
                          selectedSort === option.id
                            ? "text-primary"
                            : "text-foreground"
                        }`}
                      >
                        {language === "zh" ? option.name : option.nameEn}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </View>

            {/* 相册网格 */}
            {filteredAlbums.length > 0 ? (
              renderAlbumGrid()
            ) : (
              <View className="flex-1 items-center justify-center gap-2">
                <MaterialIcons name="image-not-supported" size={48} color={colors.muted} />
                <Text className="text-lg font-semibold text-foreground">
                  {language === "zh" ? "没有找到相册" : "No albums found"}
                </Text>
              </View>
            )}

            {/* 批量操作按钮 */}
            {selectedAlbums.length > 0 && (
              <View className="flex-row gap-3 bg-surface rounded-2xl p-4">
                <Pressable className="flex-1 py-2 items-center justify-center rounded-lg bg-primary active:opacity-80">
                  <Text className="text-white font-semibold">
                    {language === "zh" ? "删除" : "Delete"}
                  </Text>
                </Pressable>
                <Pressable className="flex-1 py-2 items-center justify-center rounded-lg bg-blue-500 active:opacity-80">
                  <Text className="text-white font-semibold">
                    {language === "zh" ? "分享" : "Share"}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setSelectedAlbums([])}
                  className="flex-1 py-2 items-center justify-center rounded-lg bg-surface border border-border active:opacity-80"
                >
                  <Text className="text-foreground font-semibold">
                    {language === "zh" ? "取消" : "Cancel"}
                  </Text>
                </Pressable>
              </View>
            )}
          </View>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
