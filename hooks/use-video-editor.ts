import { useCallback, useState } from "react";
import { videoEditor, VideoProject, VideoClip, TextOverlay, Transition, AudioTrack, VideoFilter } from "@/lib/video-editor";

export function useVideoEditor() {
  const [currentProject, setCurrentProject] = useState<VideoProject | null>(null);

  const createProject = useCallback((title: string, description?: string) => {
    const project = videoEditor.createProject(title, description);
    setCurrentProject(project);
    return project;
  }, []);

  const getProject = useCallback((projectId: string) => {
    return videoEditor.getProject(projectId);
  }, []);

  const addClip = useCallback((projectId: string, clip: Omit<VideoClip, "id">) => {
    return videoEditor.addClip(projectId, clip);
  }, []);

  const removeClip = useCallback((projectId: string, clipId: string) => {
    videoEditor.removeClip(projectId, clipId);
  }, []);

  const addTextOverlay = useCallback((projectId: string, text: TextOverlay) => {
    return videoEditor.addTextOverlay(projectId, text);
  }, []);

  const removeTextOverlay = useCallback((projectId: string, textId: string) => {
    videoEditor.removeTextOverlay(projectId, textId);
  }, []);

  const addTransition = useCallback((projectId: string, transition: Transition) => {
    return videoEditor.addTransition(projectId, transition);
  }, []);

  const removeTransition = useCallback((projectId: string, transitionId: string) => {
    videoEditor.removeTransition(projectId, transitionId);
  }, []);

  const addAudioTrack = useCallback((projectId: string, audio: AudioTrack) => {
    return videoEditor.addAudioTrack(projectId, audio);
  }, []);

  const removeAudioTrack = useCallback((projectId: string, audioId: string) => {
    videoEditor.removeAudioTrack(projectId, audioId);
  }, []);

  const addFilter = useCallback((projectId: string, filter: VideoFilter) => {
    return videoEditor.addFilter(projectId, filter);
  }, []);

  const removeFilter = useCallback((projectId: string, filterId: string) => {
    videoEditor.removeFilter(projectId, filterId);
  }, []);

  const exportVideo = useCallback(
    async (projectId: string, options?: any) => {
      return videoEditor.exportVideo(projectId, options);
    },
    []
  );

  const getTransitionTypes = useCallback(() => {
    return videoEditor.getTransitionTypes();
  }, []);

  const getFilterTypes = useCallback(() => {
    return videoEditor.getFilterTypes();
  }, []);

  const getAllProjects = useCallback(() => {
    return videoEditor.getAllProjects();
  }, []);

  const deleteProject = useCallback((projectId: string) => {
    videoEditor.deleteProject(projectId);
  }, []);

  return {
    currentProject,
    createProject,
    getProject,
    addClip,
    removeClip,
    addTextOverlay,
    removeTextOverlay,
    addTransition,
    removeTransition,
    addAudioTrack,
    removeAudioTrack,
    addFilter,
    removeFilter,
    exportVideo,
    getTransitionTypes,
    getFilterTypes,
    getAllProjects,
    deleteProject,
  };
}
