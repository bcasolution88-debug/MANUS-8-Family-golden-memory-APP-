import { ScrollView, Text, View, Pressable, TextInput, Switch, ActivityIndicator } from "react-native";
import { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { useLanguage } from "@/lib/language-provider";
import { useColors } from "@/hooks/use-colors";
import { useFamilyId } from "@/hooks/use-family-id";
import { useToast } from "@/components/toast";
import { ScreenContainer } from "@/components/screen-container";
import { FamilySwitcher } from "@/components/family-switcher";
import { trpc } from "@/lib/trpc";

const CATEGORIES = [
  { id: "daily", name: "日常", nameEn: "Daily", icon: "image" },
  { id: "gathering", name: "聚会", nameEn: "Gathering", icon: "people" },
  { id: "travel", name: "旅游", nameEn: "Travel", icon: "flight-takeoff" },
  { id: "memorial", name: "纪念", nameEn: "Memorial", icon: "favorite" },
  { id: "other", name: "其他", nameEn: "Other", icon: "more-horiz" },
] as const;
type Category = (typeof CATEGORIES)[number]["id"];

/**
 * Create album form (P6). Replaces the old "创建相册 → /upload" shortcut.
 * Name + category + description + private toggle → album.create → on success
 * jumps to the upload screen pre-targeted at the new album.
 */
export default function NewAlbumScreen() {
  const router = useRouter();
  const { t, l } = useLanguage();
  const colors = useColors();
  const toast = useToast();
  const utils = trpc.useUtils();
  const { familyId, isAuthenticated } = useFamilyId();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<Category>("daily");
  const [isPrivate, setIsPrivate] = useState(false);
  // P8: pre-fill from the user's "default private albums" preference (only until the user touches the switch)
  const prefs = trpc.preferences.get.useQuery(undefined, { enabled: isAuthenticated, staleTime: 60_000 });
  const [privateTouched, setPrivateTouched] = useState(false);
  useEffect(() => {
    if (!privateTouched && prefs.data) setIsPrivate(prefs.data.defaultPrivateAlbums);
  }, [prefs.data, privateTouched]);

  const create = trpc.album.create.useMutation({
    onSuccess: async (album) => {
      await Promise.all([utils.album.list.invalidate(), utils.album.stats.invalidate()]);
      toast.success(l("相册已创建", "Album created"));
      router.replace({ pathname: "/upload", params: { albumId: String(album.id) } } as any);
    },
    onError: (e) => toast.error(e.message),
  });

  const canSubmit = !!familyId && name.trim().length > 0 && !create.isPending;

  return (
    <ScreenContainer className="bg-background p-0">
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
        <View className="flex-row items-center justify-between px-6 py-4 bg-surface">
          <Pressable onPress={() => router.back()} className="p-2 min-w-[48px] min-h-[48px] items-center justify-center">
            <MaterialIcons name="arrow-back" size={24} color={colors.foreground} />
          </Pressable>
          <Text className="text-lg font-bold text-foreground">{t("createAlbum")}</Text>
          <View className="w-12" />
        </View>

        <View className="flex-1 px-6 py-4 gap-6">
          {!isAuthenticated ? (
            <View className="items-center gap-3 py-16">
              <MaterialIcons name="lock-outline" size={48} color={colors.muted} />
              <Text className="text-lg font-semibold text-foreground">{t("messages.signInToSee")}</Text>
            </View>
          ) : (
            <>
              {/* 所属家庭 */}
              <View className="gap-2">
                <Text className="text-sm text-muted">{l("所属家庭", "Family")}</Text>
                <FamilySwitcher variant="row" />
              </View>

              {/* 名称 */}
              <View className="gap-2">
                <Text className="text-lg font-bold text-foreground">{t("title")}</Text>
                <TextInput
                  placeholder={l("相册名称，如：2026 春节团圆", "Album name, e.g. Spring Festival 2026")}
                  value={name}
                  onChangeText={setName}
                  autoFocus
                  maxLength={60}
                  placeholderTextColor={colors.muted}
                  className="bg-surface rounded-2xl px-4 py-3 min-h-[48px] text-foreground"
                />
                <Text className="text-xs text-muted text-right">{name.length}/60</Text>
              </View>

              {/* 分类 */}
              <View className="gap-2">
                <Text className="text-lg font-bold text-foreground">{t("upload.category")}</Text>
                <View className="flex-row flex-wrap gap-2">
                  {CATEGORIES.map((c) => {
                    const on = category === c.id;
                    return (
                      <Pressable
                        key={c.id}
                        onPress={() => setCategory(c.id)}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: on }}
                        className={`flex-row items-center gap-1 px-4 py-2 min-h-[44px] rounded-full ${on ? "bg-primary" : "bg-surface"}`}
                      >
                        <MaterialIcons name={c.icon as any} size={16} color={on ? colors.onPrimary : colors.foreground} />
                        <Text className={`text-sm font-semibold ${on ? "text-onPrimary" : "text-foreground"}`}>{l(c.name, c.nameEn)}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              {/* 描述 */}
              <View className="gap-2">
                <Text className="text-lg font-bold text-foreground">{t("description")}</Text>
                <TextInput
                  placeholder={t("common.enterDescriptionOptional")}
                  value={description}
                  onChangeText={setDescription}
                  multiline
                  maxLength={300}
                  placeholderTextColor={colors.muted}
                  className="bg-surface rounded-2xl px-4 py-3 text-foreground h-28"
                  textAlignVertical="top"
                />
                <Text className="text-xs text-muted text-right">{description.length}/300</Text>
              </View>

              {/* 私密 */}
              <View className="flex-row items-center justify-between bg-surface rounded-2xl p-4 min-h-[64px]">
                <View className="flex-row items-center gap-3 flex-1">
                  <MaterialIcons name={isPrivate ? "lock" : "lock-open"} size={24} color={isPrivate ? colors.primary : colors.muted} />
                  <View className="flex-1">
                    <Text className="font-semibold text-foreground">{l("私密相册", "Private album")}</Text>
                    <Text className="text-xs text-muted">{l("仅创建者与管理员可见，上传不通知家人", "Only you and admins can see it; uploads don't notify the family")}</Text>
                  </View>
                </View>
                <Switch value={isPrivate} onValueChange={(v) => { setPrivateTouched(true); setIsPrivate(v); }} trackColor={{ true: colors.primary }} thumbColor="#fff" />
              </View>

              {/* 提交 */}
              <Pressable
                onPress={() =>
                  familyId &&
                  create.mutate({ familyId, name: name.trim(), description: description.trim() || undefined, category, isPrivate })
                }
                disabled={!canSubmit}
                accessibilityRole="button"
                className={`rounded-full py-4 min-h-[56px] items-center justify-center flex-row gap-2 active:opacity-80 ${canSubmit ? "bg-primary" : "bg-muted/50"}`}
              >
                {create.isPending ? (
                  <ActivityIndicator color={colors.onPrimary} />
                ) : (
                  <>
                    <MaterialIcons name="add-photo-alternate" size={20} color={canSubmit ? colors.onPrimary : "#fff"} />
                    <Text className={`font-bold text-lg ${canSubmit ? "text-onPrimary" : "text-white"}`}>{l("创建并上传照片", "Create & add photos")}</Text>
                  </>
                )}
              </Pressable>
            </>
          )}
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
