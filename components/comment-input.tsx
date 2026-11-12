import { View, TextInput, Pressable, FlatList, Text, Image } from "react-native";
import { useState, useEffect } from "react";
import { useColors } from "@/hooks/use-colors";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { searchMentionUsers } from "@/lib/messaging-system";
import { MicButton } from "@/components/mic-button";

interface CommentInputProps {
  onSubmit: (content: string, mentions: string[]) => void;
  placeholder?: string;
  isLoading?: boolean;
  /** Show the voice-to-text microphone (P3). Default true. */
  enableVoice?: boolean;
}

export function CommentInput({
  onSubmit,
  placeholder = "添加评论...",
  isLoading = false,
  enableVoice = true,
}: CommentInputProps) {
  const colors = useColors();
  const [content, setContent] = useState("");
  const [mentions, setMentions] = useState<string[]>([]);
  const [showMentionSuggestions, setShowMentionSuggestions] = useState(false);
  const [mentionSuggestions, setMentionSuggestions] = useState<Array<{
    id: string;
    name: string;
    avatar: string;
  }>>([]);

  // 检测@符号并搜索用户
  useEffect(() => {
    const lastAtIndex = content.lastIndexOf("@");
    if (lastAtIndex !== -1) {
      const query = content.substring(lastAtIndex + 1);
      if (query.length > 0 && /^[a-zA-Z0-9\u4e00-\u9fff]*$/.test(query)) {
        searchMentionUsers(query).then(setMentionSuggestions);
        setShowMentionSuggestions(true);
      } else if (query.length === 0) {
        setShowMentionSuggestions(false);
      }
    } else {
      setShowMentionSuggestions(false);
    }
  }, [content]);

  const handleMentionSelect = (userId: string, userName: string) => {
    const lastAtIndex = content.lastIndexOf("@");
    const beforeMention = content.substring(0, lastAtIndex);
    const newContent = `${beforeMention}@${userName} `;

    setContent(newContent);
    if (!mentions.includes(userId)) {
      setMentions([...mentions, userId]);
    }
    setShowMentionSuggestions(false);
  };

  const handleSubmit = () => {
    if (content.trim()) {
      onSubmit(content.trim(), mentions);
      setContent("");
      setMentions([]);
    }
  };

  return (
    <View className="gap-2">
      {/* 评论输入框 */}
      <View className="flex-row items-end gap-2 bg-surface rounded-2xl px-4 py-2">
        <TextInput
          placeholder={placeholder}
          value={content}
          onChangeText={setContent}
          multiline
          maxLength={500}
          editable={!isLoading}
          placeholderTextColor={colors.muted}
          className="flex-1 text-foreground py-2"
          style={{ maxHeight: 100 }}
        />
        {enableVoice && (
          <MicButton
            disabled={isLoading}
            onTranscript={(text) => setContent((prev) => (prev ? `${prev} ${text}` : text))}
          />
        )}
        <Pressable
          onPress={handleSubmit}
          disabled={!content.trim() || isLoading}
          className="p-2 min-w-[48px] min-h-[48px] items-center justify-center"
        >
          <MaterialIcons
            name="send"
            size={20}
            color={content.trim() ? colors.primary : colors.muted}
          />
        </Pressable>
      </View>

      {/* @提及建议 */}
      {showMentionSuggestions && mentionSuggestions.length > 0 && (
        <View className="bg-surface rounded-lg overflow-hidden border border-border">
          <FlatList
            data={mentionSuggestions}
            keyExtractor={item => item.id}
            scrollEnabled={false}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => handleMentionSelect(item.id, item.name)}
                className="flex-row items-center gap-3 px-4 py-2 active:bg-background"
              >
                <Image
                  source={{ uri: item.avatar }}
                  className="w-8 h-8 rounded-full"
                />
                <Text className="text-sm font-semibold text-foreground">
                  @{item.name}
                </Text>
              </Pressable>
            )}
          />
        </View>
      )}

      {/* 字数统计 */}
      <View className="flex-row justify-end">
        <Text className="text-xs text-muted">
          {content.length}/500
        </Text>
      </View>
    </View>
  );
}
