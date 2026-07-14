import { View, Text, Pressable } from "react-native";
import { useColors } from "@/hooks/use-colors";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { UploadTask } from "@/lib/advanced-upload";

interface CircularProgressUploadProps {
  task: UploadTask;
  onPause?: () => void;
  onResume?: () => void;
  onCancel?: () => void;
}

export function CircularProgressUpload({
  task,
  onPause,
  onResume,
  onCancel,
}: CircularProgressUploadProps) {
  const colors = useColors();
  const circumference = 2 * Math.PI * 45; // 半径45
  const strokeDashoffset = circumference - (task.percentage / 100) * circumference;

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const formatTime = (seconds: number): string => {
    if (seconds < 60) return `${Math.ceil(seconds)}s`;
    if (seconds < 3600) {
      const m = Math.floor(seconds / 60);
      const s = Math.ceil(seconds % 60);
      return `${m}m ${s}s`;
    }
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}m`;
  };

  return (
    <View className="bg-surface rounded-2xl p-6 gap-4">
      {/* 进度圆形 */}
      <View className="items-center">
        <View className="relative w-32 h-32 items-center justify-center">
          {/* 背景圆形 */}
          <View
            className="absolute rounded-full border-8"
            style={{
              width: 120,
              height: 120,
              borderColor: colors.border,
            }}
          />

          {/* 进度圆形 */}
          <View
            className="absolute rounded-full border-8"
            style={{
              width: 120,
              height: 120,
              borderColor: colors.primary,
              borderTopColor: colors.primary,
              borderRightColor: colors.primary,
              borderBottomColor: "transparent",
              borderLeftColor: "transparent",
              transform: [{ rotate: `${(task.percentage / 100) * 360}deg` }],
            }}
          />

          {/* 中心内容 */}
          <View className="items-center gap-1">
            <Text className="text-3xl font-bold text-foreground">
              {task.percentage}%
            </Text>
            <Text className="text-xs text-muted">
              {formatFileSize(task.uploadedSize)} / {formatFileSize(task.fileSize)}
            </Text>
          </View>
        </View>
      </View>

      {/* 文件信息 */}
      <View className="gap-2">
        <View className="flex-row items-center justify-between">
          <Text className="text-sm font-semibold text-foreground flex-1" numberOfLines={1}>
            {task.fileName}
          </Text>
          <View
            className={`px-2 py-1 rounded-full ${
              task.status === "completed"
                ? "bg-success/20"
                : task.status === "failed"
                ? "bg-error/20"
                : task.status === "paused"
                ? "bg-warning/20"
                : "bg-primary/20"
            }`}
          >
            <Text
              className={`text-xs font-semibold ${
                task.status === "completed"
                  ? "text-success"
                  : task.status === "failed"
                  ? "text-error"
                  : task.status === "paused"
                  ? "text-warning"
                  : "text-primary"
              }`}
            >
              {task.status === "uploading"
                ? "上传中"
                : task.status === "paused"
                ? "已暂停"
                : task.status === "completed"
                ? "已完成"
                : task.status === "failed"
                ? "失败"
                : "等待中"}
            </Text>
          </View>
        </View>

        {/* 上传统计 */}
        {task.status === "uploading" && (
          <View className="flex-row items-center justify-between">
            <Text className="text-xs text-muted">
              速度: {(task.speed / (1024 * 1024)).toFixed(2)} MB/s
            </Text>
            <Text className="text-xs text-muted">
              剩余: {formatTime(task.estimatedTime)}
            </Text>
          </View>
        )}

        {/* 错误信息 */}
        {task.error && (
          <View className="bg-error/20 rounded-lg px-3 py-2 flex-row gap-2">
            <MaterialIcons name="error" size={16} color={colors.error} />
            <Text className="flex-1 text-xs text-error">{task.error}</Text>
          </View>
        )}
      </View>

      {/* 操作按钮 */}
      <View className="flex-row gap-2">
        {task.status === "uploading" && (
          <Pressable
            onPress={onPause}
            className="flex-1 flex-row items-center justify-center gap-2 bg-warning/20 rounded-lg py-2 active:opacity-80"
          >
            <MaterialIcons name="pause" size={18} color={colors.warning} />
            <Text className="text-sm font-semibold text-warning">暂停</Text>
          </Pressable>
        )}

        {task.status === "paused" && (
          <Pressable
            onPress={onResume}
            className="flex-1 flex-row items-center justify-center gap-2 bg-primary/20 rounded-lg py-2 active:opacity-80"
          >
            <MaterialIcons name="play-arrow" size={18} color={colors.primary} />
            <Text className="text-sm font-semibold text-primary">继续</Text>
          </Pressable>
        )}

        <Pressable
          onPress={onCancel}
          className="flex-1 flex-row items-center justify-center gap-2 bg-error/20 rounded-lg py-2 active:opacity-80"
        >
          <MaterialIcons name="close" size={18} color={colors.error} />
          <Text className="text-sm font-semibold text-error">取消</Text>
        </Pressable>
      </View>
    </View>
  );
}
