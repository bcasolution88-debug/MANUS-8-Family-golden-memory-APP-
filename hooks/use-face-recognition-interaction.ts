import { useCallback, useState } from "react";
import {
  faceRecognitionInteraction,
  PhotoWithFaces,
  PersonTag,
  PersonProfile,
} from "@/lib/face-recognition-interaction";

export function useFaceRecognitionInteraction() {
  const [stats, setStats] = useState(faceRecognitionInteraction.getStats());

  const addPhotoWithFaces = useCallback((photoData: PhotoWithFaces) => {
    faceRecognitionInteraction.addPhotoWithFaces(photoData);
    setStats(faceRecognitionInteraction.getStats());
  }, []);

  const getPhotoFaces = useCallback((photoId: string): PersonTag[] => {
    return faceRecognitionInteraction.getPhotoFaces(photoId);
  }, []);

  const getPhotosByPerson = useCallback((personId: string): PhotoWithFaces[] => {
    return faceRecognitionInteraction.getPhotosByPerson(personId);
  }, []);

  const getPersonProfile = useCallback((personId: string): PersonProfile | undefined => {
    return faceRecognitionInteraction.getPersonProfile(personId);
  }, []);

  const getAllPersonProfiles = useCallback((): PersonProfile[] => {
    return faceRecognitionInteraction.getAllPersonProfiles();
  }, []);

  const getFrequentPeople = useCallback((limit?: number): PersonProfile[] => {
    return faceRecognitionInteraction.getFrequentPeople(limit);
  }, []);

  const getRecentPeople = useCallback((days?: number, limit?: number): PersonProfile[] => {
    return faceRecognitionInteraction.getRecentPeople(days, limit);
  }, []);

  const searchPeople = useCallback((query: string): PersonProfile[] => {
    return faceRecognitionInteraction.searchPeople(query);
  }, []);

  const mergePeople = useCallback((sourcePerson: string, targetPerson: string) => {
    faceRecognitionInteraction.mergePeople(sourcePerson, targetPerson);
    setStats(faceRecognitionInteraction.getStats());
  }, []);

  const renamePerson = useCallback((personId: string, newName: string) => {
    faceRecognitionInteraction.renamePerson(personId, newName);
    setStats(faceRecognitionInteraction.getStats());
  }, []);

  return {
    stats,
    addPhotoWithFaces,
    getPhotoFaces,
    getPhotosByPerson,
    getPersonProfile,
    getAllPersonProfiles,
    getFrequentPeople,
    getRecentPeople,
    searchPeople,
    mergePeople,
    renamePerson,
  };
}
