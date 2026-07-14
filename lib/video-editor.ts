/**
 * 视频编辑和滤镜管理模块
 * 支持视频剪辑、转场、文字叠加、音乐配置、滤镜应用
 */

export interface VideoClip {
  id: string;
  uri: string;
  duration: number;
  startTime: number;
  endTime: number;
  volume: number;
  speed: number;
}

export interface TextOverlay {
  id: string;
  text: string;
  startTime: number;
  endTime: number;
  fontSize: number;
  color: string;
  fontFamily: string;
  position: {
    x: number;
    y: number;
  };
  opacity: number;
}

export interface Transition {
  id: string;
  type: "fade" | "slide" | "zoom" | "wipe" | "dissolve";
  duration: number;
  clipId: string;
}

export interface AudioTrack {
  id: string;
  uri: string;
  startTime: number;
  volume: number;
  duration: number;
}

export interface VideoFilter {
  id: string;
  type:
    | "grayscale"
    | "sepia"
    | "vintage"
    | "blur"
    | "brightness"
    | "contrast"
    | "saturation"
    | "hue";
  intensity: number; // 0-100
}

export interface VideoProject {
  id: string;
  title: string;
  description: string;
  clips: VideoClip[];
  textOverlays: TextOverlay[];
  transitions: Transition[];
  audioTracks: AudioTrack[];
  filters: VideoFilter[];
  duration: number;
  resolution: "1080p" | "720p" | "480p";
  frameRate: 24 | 30 | 60;
  createdAt: number;
  updatedAt: number;
}

class VideoEditor {
  private projects: Map<string, VideoProject> = new Map();
  private currentProjectId: string | null = null;

  /**
   * 创建新项目
   */
  createProject(title: string, description: string = ""): VideoProject {
    const projectId = `project_${Date.now()}`;
    const project: VideoProject = {
      id: projectId,
      title,
      description,
      clips: [],
      textOverlays: [],
      transitions: [],
      audioTracks: [],
      filters: [],
      duration: 0,
      resolution: "1080p",
      frameRate: 30,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.projects.set(projectId, project);
    this.currentProjectId = projectId;
    return project;
  }

  /**
   * 获取项目
   */
  getProject(projectId: string): VideoProject | undefined {
    return this.projects.get(projectId);
  }

  /**
   * 添加视频剪辑
   */
  addClip(projectId: string, clip: Omit<VideoClip, "id">): VideoClip {
    const project = this.projects.get(projectId);
    if (!project) throw new Error("Project not found");

    const clipId = `clip_${Date.now()}`;
    const newClip: VideoClip = {
      ...clip,
      id: clipId,
    };

    project.clips.push(newClip);
    this.updateProjectDuration(projectId);
    project.updatedAt = Date.now();

    return newClip;
  }

  /**
   * 删除视频剪辑
   */
  removeClip(projectId: string, clipId: string): void {
    const project = this.projects.get(projectId);
    if (!project) throw new Error("Project not found");

    project.clips = project.clips.filter(c => c.id !== clipId);
    project.transitions = project.transitions.filter(t => t.clipId !== clipId);
    this.updateProjectDuration(projectId);
    project.updatedAt = Date.now();
  }

  /**
   * 添加文字叠加
   */
  addTextOverlay(projectId: string, text: TextOverlay): TextOverlay {
    const project = this.projects.get(projectId);
    if (!project) throw new Error("Project not found");

    project.textOverlays.push(text);
    project.updatedAt = Date.now();

    return text;
  }

  /**
   * 删除文字叠加
   */
  removeTextOverlay(projectId: string, textId: string): void {
    const project = this.projects.get(projectId);
    if (!project) throw new Error("Project not found");

    project.textOverlays = project.textOverlays.filter(t => t.id !== textId);
    project.updatedAt = Date.now();
  }

  /**
   * 添加转场效果
   */
  addTransition(projectId: string, transition: Transition): Transition {
    const project = this.projects.get(projectId);
    if (!project) throw new Error("Project not found");

    project.transitions.push(transition);
    project.updatedAt = Date.now();

    return transition;
  }

  /**
   * 删除转场效果
   */
  removeTransition(projectId: string, transitionId: string): void {
    const project = this.projects.get(projectId);
    if (!project) throw new Error("Project not found");

    project.transitions = project.transitions.filter(t => t.id !== transitionId);
    project.updatedAt = Date.now();
  }

  /**
   * 添加音乐轨道
   */
  addAudioTrack(projectId: string, audio: AudioTrack): AudioTrack {
    const project = this.projects.get(projectId);
    if (!project) throw new Error("Project not found");

    project.audioTracks.push(audio);
    project.updatedAt = Date.now();

    return audio;
  }

  /**
   * 删除音乐轨道
   */
  removeAudioTrack(projectId: string, audioId: string): void {
    const project = this.projects.get(projectId);
    if (!project) throw new Error("Project not found");

    project.audioTracks = project.audioTracks.filter(a => a.id !== audioId);
    project.updatedAt = Date.now();
  }

  /**
   * 添加滤镜
   */
  addFilter(projectId: string, filter: VideoFilter): VideoFilter {
    const project = this.projects.get(projectId);
    if (!project) throw new Error("Project not found");

    project.filters.push(filter);
    project.updatedAt = Date.now();

    return filter;
  }

  /**
   * 删除滤镜
   */
  removeFilter(projectId: string, filterId: string): void {
    const project = this.projects.get(projectId);
    if (!project) throw new Error("Project not found");

    project.filters = project.filters.filter(f => f.id !== filterId);
    project.updatedAt = Date.now();
  }

  /**
   * 获取可用的转场类型
   */
  getTransitionTypes(): Array<Transition["type"]> {
    return ["fade", "slide", "zoom", "wipe", "dissolve"];
  }

  /**
   * 获取可用的滤镜类型
   */
  getFilterTypes(): Array<VideoFilter["type"]> {
    return [
      "grayscale",
      "sepia",
      "vintage",
      "blur",
      "brightness",
      "contrast",
      "saturation",
      "hue",
    ];
  }

  /**
   * 导出视频
   */
  async exportVideo(
    projectId: string,
    options: {
      resolution?: "1080p" | "720p" | "480p";
      frameRate?: 24 | 30 | 60;
      bitrate?: number;
    } = {}
  ): Promise<string> {
    const project = this.projects.get(projectId);
    if (!project) throw new Error("Project not found");

    console.log("Exporting video:", {
      projectId,
      title: project.title,
      duration: project.duration,
      options,
    });

    // 模拟导出
    await new Promise(resolve => setTimeout(resolve, 2000));

    const exportedVideoUri = `file:///video_${Date.now()}.mp4`;
    return exportedVideoUri;
  }

  /**
   * 更新项目时长
   */
  private updateProjectDuration(projectId: string): void {
    const project = this.projects.get(projectId);
    if (!project) return;

    let maxDuration = 0;
    project.clips.forEach(clip => {
      const clipEnd = clip.startTime + (clip.endTime - clip.startTime);
      maxDuration = Math.max(maxDuration, clipEnd);
    });

    project.duration = maxDuration;
  }

  /**
   * 获取项目列表
   */
  getAllProjects(): VideoProject[] {
    return Array.from(this.projects.values());
  }

  /**
   * 删除项目
   */
  deleteProject(projectId: string): void {
    this.projects.delete(projectId);
    if (this.currentProjectId === projectId) {
      this.currentProjectId = null;
    }
  }

  /**
   * 获取当前项目
   */
  getCurrentProject(): VideoProject | null {
    if (!this.currentProjectId) return null;
    return this.projects.get(this.currentProjectId) || null;
  }

  /**
   * 设置当前项目
   */
  setCurrentProject(projectId: string): void {
    if (this.projects.has(projectId)) {
      this.currentProjectId = projectId;
    }
  }
}

// 导出单例
export const videoEditor = new VideoEditor();
