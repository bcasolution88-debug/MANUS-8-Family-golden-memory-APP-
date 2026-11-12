import { ScrollView, Text, View, Pressable, ActivityIndicator, RefreshControl } from "react-native";
import { useRouter } from "expo-router";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { ScreenContainer } from "@/components/screen-container";
import { SignedImage } from "@/components/signed-image";
import { useLanguage } from "@/lib/language-provider";
import { useColors } from "@/hooks/use-colors";
import { useFamilyId } from "@/hooks/use-family-id";
import { trpc } from "@/lib/trpc";

/**
 * Album tab (P5 — real data). Vertical album cards for the user's family:
 * album.list for the cards, album.stats per card for photo / video counts,
 * family.getMembers to resolve the creator. Tap → /album?albumId=.
 */
export default function AlbumTabScreen() {
  const router = useRouter();
  const { t, l, language } = useLanguage();
  const colors = useColors();
  const { familyId, isAuthenticated, isLoading: familyLoading } = useFamilyId();

  const albums = trpc.album.list.useQuery(
    { familyId: familyId ?? 0, take: 100 },
    { enabled: isAuthenticated && !!familyId },
  );
  const members = trpc.family.getMembers.useQuery(
    { familyId: familyId ?? 0 },
    { enabled: isAuthenticated && !!familyId, staleTime: 60_000 },
  );

  const nameOf = (userId: number) => members.data?.find((m) => m.userId === userId)?.user.name ?? t("notif.someone");
  const locale = language === "zh" ? "zh-CN" : "en-US";
  const data = albums.data ?? [];
  const totalMedia = data.reduce((s, a) => s + a.mediaCount, 0);

  return (
    <ScreenContainer className="flex-1 bg-background">
      <ScrollView
        contentContainerStyle={{ flexGrow: 1 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={albums.isRefetching} onRefresh={() => albums.refetch()} tintColor={colors.primary} />}
      >
        <View className="gap-6 pb-6">
          {/* Header */}
          <View className="gap-2">
            <Text className="text-3xl font-bold text-foreground">{t("album")}</Text>
            <Text className="text-base text-muted">
              {data.length} {t("album")} · {totalMedia} {t("photos")}
            </Text>
          </View>

          {/* Create / upload */}
          <Pressable
            onPress={() => router.push("/album/new" as any)}
            accessibilityRole="button"
            className="bg-primary rounded-lg py-4 min-h-[56px] items-center flex-row justify-center gap-2 active:opacity-80"
          >
            <MaterialIcons name="add-a-photo" size={24} color={colors.onPrimary} />
            <Text className="text-onPrimary font-bold text-base">{t("createAlbum")}</Text>
          </Pressable>

          {/* States */}
          {!isAuthenticated ? (
            <Empty icon="lock-outline" text={t("messages.signInToSee")} />
          ) : familyLoading || albums.isLoading ? (
            <ActivityIndicator color={colors.primary} className="py-12" />
          ) : albums.isError ? (
            <Empty icon="cloud-off" text={t("messages.loadFailed")} />
          ) : data.length === 0 ? (
            <Empty icon="photo-library" text={l("还没有相册，点击上方按钮创建第一个", "No albums yet — tap above to create the first one")} />
          ) : (
            <View className="gap-3">
              {data.map((album) => (
                <AlbumCard
                  key={album.id}
                  album={album}
                  creator={nameOf(album.createdBy)}
                  date={new Date(album.createdAt).toLocaleDateString(locale)}
                  onPress={() => router.push({ pathname: "/album", params: { albumId: String(album.id) } } as any)}
                />
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

type AlbumRow = {
  id: number;
  name: string;
  isPrivate: boolean;
  mediaCount: number;
};

function AlbumCard({ album, creator, date, onPress }: { album: AlbumRow; creator: string; date: string; onPress: () => void }) {
  const { t } = useLanguage();
  const colors = useColors();
  const stats = trpc.album.stats.useQuery({ id: album.id }, { staleTime: 30_000 });
  const cover = trpc.media.getMediaList.useQuery({ albumId: album.id, take: 1 }, { staleTime: 60_000 });
  const coverId = cover.data?.[0]?.id;

  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={album.name} className="bg-surface rounded-lg overflow-hidden gap-3 active:opacity-80">
      <View className="relative h-40 overflow-hidden">
        {coverId ? (
          <SignedImage mediaId={coverId} className="w-full h-full" />
        ) : (
          <View className="w-full h-full items-center justify-center bg-surface">
            <MaterialIcons name="photo-library" size={40} color={colors.muted} />
          </View>
        )}
        {album.isPrivate && (
          <View className="absolute top-3 right-3 bg-black/60 rounded-lg px-2 py-1 flex-row items-center gap-1">
            <MaterialIcons name="lock" size={12} color="white" />
            <Text className="text-white text-xs font-semibold">{t("privacy")}</Text>
          </View>
        )}
      </View>

      <View className="gap-2 px-4 pb-4">
        <Text className="text-lg font-bold text-foreground" numberOfLines={1}>{album.name}</Text>
        <View className="flex-row gap-4">
          <View className="flex-row items-center gap-1">
            <MaterialIcons name="photo" size={16} color={colors.muted} />
            <Text className="text-sm text-muted">{stats.data?.photoCount ?? album.mediaCount}</Text>
          </View>
          <View className="flex-row items-center gap-1">
            <MaterialIcons name="videocam" size={16} color={colors.muted} />
            <Text className="text-sm text-muted">{stats.data?.videoCount ?? 0}</Text>
          </View>
          <View className="flex-row items-center gap-1">
            <MaterialIcons name="favorite" size={16} color={colors.muted} />
            <Text className="text-sm text-muted">{stats.data?.likeCount ?? 0}</Text>
          </View>
        </View>
        <View className="flex-row items-center justify-between pt-2 border-t border-border">
          <View className="flex-row items-center gap-2">
            <View className="w-8 h-8 rounded-full bg-primary items-center justify-center">
              <Text className="text-onPrimary text-xs font-bold">{creator.charAt(0)}</Text>
            </View>
            <View>
              <Text className="text-xs font-semibold text-foreground">{creator}</Text>
              <Text className="text-xs text-muted">{date}</Text>
            </View>
          </View>
          <MaterialIcons name="chevron-right" size={24} color={colors.muted} />
        </View>
      </View>
    </Pressable>
  );
}

function Empty({ icon, text }: { icon: keyof typeof MaterialIcons.glyphMap; text: string }) {
  const colors = useColors();
  return (
    <View className="items-center justify-center gap-2 py-16">
      <MaterialIcons name={icon} size={48} color={colors.muted} />
      <Text className="text-base font-semibold text-foreground text-center px-6">{text}</Text>
    </View>
  );
}
