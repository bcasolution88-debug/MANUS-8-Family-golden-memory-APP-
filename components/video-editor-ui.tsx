import { View, Text, ScrollView, Pressable, FlatList } from "react-native";
import { useState, useCallback } from "react";
import { useColors } from "@/hooks/use-colors";
import { useLanguage } from "@/lib/language-provider";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useVideoEditor } from "@/hooks/use-video-editor";
import { VideoProject, VideoClip, Transition, VideoFilter } from "@/lib/video-editor";

interface VideoEditorUIProps {
  projectId: string;
  onExport?: (videoUri: string) => void;
}

export function VideoEditorUI({ projectId, onExport }: VideoEditorUIProps) {
  const colors = useColors();
  const { language } = useLanguage();
  const videoEditor = useVideoEditor();
  const [project, setProject] = useState<VideoProject | null>(null);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeTab, setActiveTab] = useState<"clips" | "effects" | "text" | "audio">("clips");
  const [exporting, setExporting] = useState(false);

  // 加载项目
  const loadProject = useCallback(() => {
    const proj = videoEditor.getProject(projectId);
    if (proj) {
      setProject(proj);
    }
  }, [projectId, videoEditor]);

  // 播放/暂停
  const handlePlayPause = useCallback(() => {
    setIsPlaying(!isPlaying);
  }, [isPlaying]);

  // 导出视频
  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      const videoUri = await videoEditor.exportVideo(projectId);
      onExport?.(videoUri);
    } catch (error) {
      console.error("Export failed:", error);
    } finally {
      setExporting(false);
    }
  }, [projectId, videoEditor, onExport]);

  if (!project) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Text className="text-foreground">{language === "zh" ? "加载中..." : "Loading..."}</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      {/* 预览区域 */}
      <View className="bg-black h-64 items-center justify-center">
        <View className="w-full h-full bg-gray-900 items-center justify-center">
          <MaterialIcons name="videocam" size={64} color="white" />
          <Text className="text-white mt-4">
            {language === "zh" ? "视频预览" : "Video Preview"}
          </Text>
          <Text className="text-gray-400 text-sm mt-2">
            {currentTime.toFixed(1)}s / {project.duration.toFixed(1)}s
          </Text>
        </View>
      </View>

      {/* 播放控制 */}
      <View className="flex-row items-center justify-center gap-4 py-4 px-4 bg-surface border-b border-border">
        <Pressable
          onPress={handlePlayPause}
          className="w-12 h-12 rounded-full bg-primary items-center justify-center active:opacity-80"
        >
          <MaterialIcons
            name={isPlaying ? "pause" : "play-arrow"}
            size={24}
            color="white"
          />
        </Pressable>

        {/* 时间轴滑块 */}
        <View className="flex-1 h-1 bg-muted rounded-full">
          <View
            className="h-full bg-primary rounded-full"
            style={{
              width: `${(currentTime / project.duration) * 100}%`,
            }}
          />
        </View>

        <Text className="text-sm text-muted w-12">
          {Math.floor(currentTime / 60)}:{String(Math.floor(currentTime % 60)).padStart(2, "0")}
        </Text>
      </View>

      {/* 标签页 */}
      <View className="flex-row border-b border-border bg-surface">
        {["clips", "effects", "text", "audio"].map(tab => (
          <Pressable
            key={tab}
            onPress={() => setActiveTab(tab as any)}
            className={`flex-1 py-3 items-center border-b-2 ${
              activeTab === tab ? "border-primary" : "border-transparent"
            }`}
          >
            <Text
              className={`text-sm font-semibold ${
                activeTab === tab ? "text-primary" : "text-muted"
              }`}
            >
              {tab === "clips"
                ? language === "zh"
                  ? "剪辑"
                  : "Clips"
                : tab === "effects"
                  ? language === "zh"
                    ? "效果"
                    : "Effects"
                  : tab === "text"
                    ? language === "zh"
                      ? "文字"
                      : "Text"
                    : language === "zh"
                      ? "音乐"
                      : "Audio"}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* 内容区域 */}
      <ScrollView className="flex-1 px-4 py-4">
        {activeTab === "clips" && (
          <View className="gap-3">
            <Text className="text-base font-semibold text-foreground mb-2">
              {language === "zh" ? "视频剪辑" : "Video Clips"}
            </Text>
            {project.clips.length === 0 ? (
              <View className="items-center justify-center py-8">
                <MaterialIcons name="video-library" size={48} color={colors.muted} />
                <Text className="text-muted mt-2">
                  {language === "zh" ? "还没有添加剪辑" : "No clips added"}
                </Text>
              </View>
            ) : (
              project.clips.map(clip => (
                <Pressable
                  key={clip.id}
                  onPress={() => setSelectedClipId(clip.id)}
                  className={`p-3 rounded-lg border-2 ${
                    selectedClipId === clip.id
                      ? "border-primary bg-primary/10"
                      : "border-border bg-surface"
                  }`}
                >
                  <View className="flex-row items-center gap-3">
                    <View className="w-12 h-12 rounded bg-muted items-center justify-center">
                      <MaterialIcons name="videocam" size={24} color={colors.foreground} />
                    </View>
                    <View className="flex-1">
                      <Text className="text-sm font-semibold text-foreground">
                        {clip.id}
                      </Text>
                      <Text className="text-xs text-muted">
                        {((clip.endTime - clip.startTime) / 1000).toFixed(1)}s
                      </Text>
                    </View>
                    <Text className="text-xs text-muted">{clip.volume * 100}%</Text>
                  </View>
                </Pressable>
              ))
            )}
          </View>
        )}

        {activeTab === "effects" && (
          <View className="gap-3">
            <Text className="text-base font-semibold text-foreground mb-2">
              {language === "zh" ? "滤镜效果" : "Filters"}
            </Text>
            <View className="gap-2">
              {videoEditor.getFilterTypes().map(filterType => (
                <Pressable
                  key={filterType}
                  className="p-3 rounded-lg bg-surface border border-border active:opacity-80"
                >
                  <Text className="text-sm font-semibold text-foreground capitalize">
                    {filterType}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {activeTab === "text" && (
          <View className="gap-3">
            <Text className="text-base font-semibold text-foreground mb-2">
              {language === "zh" ? "文字叠加" : "Text Overlays"}
            </Text>
            {project.textOverlays.length === 0 ? (
              <View className="items-center justify-center py-8">
                <MaterialIcons name="text-fields" size={48} color={colors.muted} />
                <Text className="text-muted mt-2">
                  {language === "zh" ? "还没有添加文字" : "No text overlays"}
                </Text>
              </View>
            ) : (
              project.textOverlays.map(text => (
                <View key={text.id} className="p-3 rounded-lg bg-surface border border-border">
                  <Text className="text-sm font-semibold text-foreground" numberOfLines={1}>
                    {text.text}
                  </Text>
                  <Text className="text-xs text-muted mt-1">
                    {(text.startTime / 1000).toFixed(1)}s - {(text.endTime / 1000).toFixed(1)}s
                  </Text>
                </View>
              ))
            )}
          </View>
        )}

        {activeTab === "audio" && (
          <View className="gap-3">
            <Text className="text-base font-semibold text-foreground mb-2">
              {language === "zh" ? "音乐轨道" : "Audio Tracks"}
            </Text>
            {project.audioTracks.length === 0 ? (
              <View className="items-center justify-center py-8">
                <MaterialIcons name="music-note" size={48} color={colors.muted} />
                <Text className="text-muted mt-2">
                  {language === "zh" ? "还没有添加音乐" : "No audio tracks"}
                </Text>
              </View>
            ) : (
              project.audioTracks.map(audio => (
                <View key={audio.id} className="p-3 rounded-lg bg-surface border border-border">
                  <Text className="text-sm font-semibold text-foreground" numberOfLines={1}>
                    {audio.id}
                  </Text>
                  <Text className="text-xs text-muted mt-1">
                    {(audio.duration / 1000).toFixed(1)}s @ {audio.volume * 100}%
                  </Text>
                </View>
              ))
            )}
          </View>
        )}
      </ScrollView>

      {/* 导出按钮 */}
      <View className="p-4 border-t border-border bg-surface">
        <Pressable
          onPress={handleExport}
          disabled={exporting}
          className={`bg-primary rounded-lg py-3 items-center active:opacity-80 ${
            exporting ? "opacity-50" : ""
          }`}
        >
          <View className="flex-row items-center gap-2">
            <MaterialIcons
              name="download"
              size={20}
              color="white"
            />
            <Text className="text-white font-semibold">
              {exporting
                ? language === "zh"
                  ? "导出中..."
                  : "Exporting..."
                : language === "zh"
                  ? "导出视频"
                  : "Export Video"}
            </Text>
          </View>
        </Pressable>
      </View>
    </View>
  );
}
