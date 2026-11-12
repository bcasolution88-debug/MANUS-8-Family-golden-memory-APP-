import { ActivityIndicator, Pressable, Text, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { useColors } from "@/hooks/use-colors";
import { useVoiceInput } from "@/hooks/use-voice-input";
import { useLanguage } from "@/lib/language-provider";
import { useToast } from "@/components/toast";

type MicButtonProps = {
  /** Receives the transcribed text; caller appends it to its input value. */
  onTranscript: (text: string) => void;
  disabled?: boolean;
  size?: number;
};

/**
 * Tap-to-record microphone for comment composers (P3).
 *  idle        → mic icon
 *  recording   → red stop icon + elapsed seconds (tap again to finish)
 *  uploading / transcribing → spinner
 */
export function MicButton({ onTranscript, disabled = false, size = 20 }: MicButtonProps) {
  const colors = useColors();
  const toast = useToast();
  const { t } = useLanguage();
  const voice = useVoiceInput({
    onResult: onTranscript,
    onError: (message) => toast.error(message),
  });

  const handlePress = () => {
    if (voice.isRecording) void voice.stop();
    else void voice.start();
  };

  const busy = voice.phase === "uploading" || voice.phase === "transcribing";
  const label = voice.isRecording
    ? t("voice.tapToStop")
    : busy
      ? t("voice.transcribing")
      : t("voiceInput");

  return (
    <Pressable
      onPress={handlePress}
      onLongPress={voice.isRecording ? () => void voice.cancel() : undefined}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || busy, busy }}
      className="flex-row items-center gap-1 p-2 min-w-[48px] min-h-[48px] items-center justify-center rounded-full"
      style={voice.isRecording ? { backgroundColor: `${colors.error}1A` } : undefined}
    >
      {busy ? (
        <ActivityIndicator size="small" color={colors.primary} />
      ) : (
        <MaterialIcons
          name={voice.isRecording ? "stop-circle" : "mic"}
          size={size}
          color={voice.isRecording ? colors.error : disabled ? colors.muted : colors.primary}
        />
      )}
      {voice.isRecording && (
        <View className="flex-row items-center gap-1">
          <View className="w-2 h-2 rounded-full" style={{ backgroundColor: colors.error }} />
          <Text className="text-xs font-semibold" style={{ color: colors.error }}>
            {voice.seconds}s
          </Text>
        </View>
      )}
    </Pressable>
  );
}
