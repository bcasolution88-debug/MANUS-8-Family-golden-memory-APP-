import { useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { useColors } from "@/hooks/use-colors";
import { useFamily } from "@/lib/family-provider";
import { useLanguage } from "@/lib/language-provider";
import { useToast } from "@/components/toast";
import { trpc } from "@/lib/trpc";

type Props = {
  /** Compact chip (header) or full-width row (Me page). */
  variant?: "chip" | "row";
};

/**
 * Family switcher (P6). Tapping opens a bottom sheet listing every family the
 * user belongs to, with the active one checked, plus "Create family" and
 * "Join with code" (accepts an invitation code). Hidden when the user has a
 * single family and no invite to redeem — the chip still renders the name.
 */
export function FamilySwitcher({ variant = "chip" }: Props) {
  const colors = useColors();
  const toast = useToast();
  const { t, l } = useLanguage();
  const { families, family, switchFamily, refresh, isAuthenticated } = useFamily();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"list" | "create" | "join">("list");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");

  const createFamily = trpc.family.createFamily.useMutation({
    onSuccess: async (f) => {
      await refresh();
      if (f?.id) await switchFamily(f.id);
      toast.success(l("家庭已创建", "Family created"));
      setName("");
      setMode("list");
      setOpen(false);
    },
    onError: (e) => toast.error(e.message),
  });
  const accept = trpc.family.acceptInvitation.useMutation({
    onSuccess: async (r) => {
      await refresh();
      await switchFamily(r.familyId);
      toast.success(l("已加入家庭", "Joined the family"));
      setCode("");
      setMode("list");
      setOpen(false);
    },
    onError: (e) => toast.error(e.message),
  });

  if (!isAuthenticated) return null;

  const trigger =
    variant === "chip" ? (
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={l("切换家庭", "Switch family")}
        className="flex-row items-center gap-1 px-3 py-2 min-h-[40px] rounded-full bg-surface active:opacity-80"
      >
        <MaterialIcons name="home" size={16} color={colors.primary} />
        <Text className="text-sm font-semibold text-foreground" numberOfLines={1}>
          {family?.name ?? l("选择家庭", "Choose family")}
        </Text>
        <MaterialIcons name="expand-more" size={18} color={colors.muted} />
      </Pressable>
    ) : (
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        className="flex-row items-center justify-between bg-surface rounded-2xl p-4 min-h-[64px] active:opacity-80"
      >
        <View className="flex-row items-center gap-3 flex-1">
          <MaterialIcons name="family-restroom" size={24} color={colors.primary} />
          <View className="flex-1">
            <Text className="font-semibold text-foreground">{l("当前家庭", "Current family")}</Text>
            <Text className="text-xs text-muted" numberOfLines={1}>
              {family?.name ?? l("未加入任何家庭", "No family yet")}
              {families.length > 1 ? ` · ${l(`共 ${families.length} 个`, `${families.length} total`)}` : ""}
            </Text>
          </View>
        </View>
        <MaterialIcons name="swap-horiz" size={24} color={colors.muted} />
      </Pressable>
    );

  return (
    <>
      {trigger}
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => (mode === "list" ? setOpen(false) : setMode("list"))}>
        <Pressable className="flex-1 bg-black/50 justify-end" onPress={() => setOpen(false)}>
          <Pressable className="bg-background rounded-t-3xl p-6 gap-4" onPress={() => undefined}>
            <View className="flex-row items-center justify-between">
              <Text className="text-xl font-bold text-foreground">
                {mode === "list" ? l("切换家庭", "Switch family") : mode === "create" ? l("创建家庭", "Create family") : l("使用邀请码加入", "Join with code")}
              </Text>
              {mode !== "list" && (
                <Pressable onPress={() => setMode("list")} hitSlop={8} className="min-w-[44px] min-h-[44px] items-center justify-center">
                  <MaterialIcons name="arrow-back" size={22} color={colors.foreground} />
                </Pressable>
              )}
            </View>

            {mode === "list" && (
              <>
                <ScrollView className="max-h-72">
                  {families.map((f) => {
                    const active = f.id === family?.id;
                    return (
                      <Pressable
                        key={f.id}
                        onPress={async () => {
                          await switchFamily(f.id);
                          setOpen(false);
                        }}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: active }}
                        className={`flex-row items-center justify-between py-3 px-3 min-h-[56px] rounded-2xl mb-1 ${active ? "bg-primary/15" : ""}`}
                      >
                        <View className="flex-1">
                          <Text className={`text-base font-semibold ${active ? "text-primary" : "text-foreground"}`}>{f.name}</Text>
                          {f.description ? (
                            <Text className="text-xs text-muted" numberOfLines={1}>
                              {f.description}
                            </Text>
                          ) : null}
                        </View>
                        {active && <MaterialIcons name="check-circle" size={22} color={colors.primary} />}
                      </Pressable>
                    );
                  })}
                  {families.length === 0 && <Text className="text-sm text-muted text-center py-6">{l("还没有家庭，先创建一个吧", "No family yet — create one")}</Text>}
                </ScrollView>
                <View className="flex-row gap-3">
                  <Pressable onPress={() => setMode("create")} className="flex-1 flex-row items-center justify-center gap-2 bg-primary rounded-full py-3 min-h-[48px] active:opacity-80">
                    <MaterialIcons name="add" size={18} color={colors.onPrimary} />
                    <Text className="font-semibold text-onPrimary">{l("创建家庭", "Create")}</Text>
                  </Pressable>
                  <Pressable onPress={() => setMode("join")} className="flex-1 flex-row items-center justify-center gap-2 bg-surface rounded-full py-3 min-h-[48px] active:opacity-80">
                    <MaterialIcons name="vpn-key" size={18} color={colors.primary} />
                    <Text className="font-semibold text-foreground">{l("邀请码加入", "Join")}</Text>
                  </Pressable>
                </View>
              </>
            )}

            {mode === "create" && (
              <>
                <TextInput
                  placeholder={l("家庭名称，如：陈家", "Family name, e.g. The Chens")}
                  value={name}
                  onChangeText={setName}
                  autoFocus
                  maxLength={100}
                  placeholderTextColor={colors.muted}
                  className="bg-surface rounded-2xl px-4 py-3 min-h-[48px] text-foreground"
                />
                <Pressable
                  onPress={() => name.trim() && createFamily.mutate({ name: name.trim() })}
                  disabled={!name.trim() || createFamily.isPending}
                  className="bg-primary rounded-full py-3 min-h-[48px] items-center justify-center active:opacity-80"
                  style={!name.trim() ? { opacity: 0.5 } : undefined}
                >
                  {createFamily.isPending ? <ActivityIndicator color={colors.onPrimary} /> : <Text className="font-semibold text-onPrimary">{t("save")}</Text>}
                </Pressable>
              </>
            )}

            {mode === "join" && (
              <>
                <TextInput
                  placeholder={l("输入 12 位邀请码", "Enter the 12-character code")}
                  value={code}
                  onChangeText={(v) => setCode(v.toUpperCase())}
                  autoFocus
                  autoCapitalize="characters"
                  maxLength={16}
                  placeholderTextColor={colors.muted}
                  className="bg-surface rounded-2xl px-4 py-3 min-h-[48px] text-foreground font-mono tracking-widest"
                />
                <Pressable
                  onPress={() => code.trim().length >= 6 && accept.mutate({ code: code.trim() })}
                  disabled={code.trim().length < 6 || accept.isPending}
                  className="bg-primary rounded-full py-3 min-h-[48px] items-center justify-center active:opacity-80"
                  style={code.trim().length < 6 ? { opacity: 0.5 } : undefined}
                >
                  {accept.isPending ? <ActivityIndicator color={colors.onPrimary} /> : <Text className="font-semibold text-onPrimary">{l("加入", "Join")}</Text>}
                </Pressable>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}
