import { useCallback, useState } from "react";
import { templateLibrary, Template } from "@/lib/template-library";

export function useTemplateLibrary() {
  const [favorites, setFavorites] = useState<Set<string>>(new Set());

  const getAllTemplates = useCallback(() => {
    return templateLibrary.getAllTemplates();
  }, []);

  const getTemplatesByCategory = useCallback((category: Template["category"]) => {
    return templateLibrary.getTemplatesByCategory(category);
  }, []);

  const getTemplatesBySubcategory = useCallback((subcategory: string) => {
    return templateLibrary.getTemplatesBySubcategory(subcategory);
  }, []);

  const getTemplate = useCallback((templateId: string) => {
    return templateLibrary.getTemplate(templateId);
  }, []);

  const searchTemplates = useCallback((query: string) => {
    return templateLibrary.searchTemplates(query);
  }, []);

  const addToFavorites = useCallback((templateId: string) => {
    templateLibrary.addToFavorites(templateId);
    setFavorites(prev => new Set([...prev, templateId]));
  }, []);

  const removeFromFavorites = useCallback((templateId: string) => {
    templateLibrary.removeFromFavorites(templateId);
    setFavorites(prev => {
      const newSet = new Set(prev);
      newSet.delete(templateId);
      return newSet;
    });
  }, []);

  const getFavoriteTemplates = useCallback(() => {
    return templateLibrary.getFavoriteTemplates();
  }, []);

  const isFavorite = useCallback((templateId: string) => {
    return templateLibrary.isFavorite(templateId);
  }, []);

  const getRecommendedTemplates = useCallback((count?: number) => {
    return templateLibrary.getRecommendedTemplates(count);
  }, []);

  const getAnniversaryTemplates = useCallback(() => {
    return templateLibrary.getAnniversaryTemplates();
  }, []);

  const getTemplateForAnniversary = useCallback((yearsMarked: number) => {
    return templateLibrary.getTemplateForAnniversary(yearsMarked);
  }, []);

  const cloneTemplate = useCallback((templateId: string, newName: string) => {
    return templateLibrary.cloneTemplate(templateId, newName);
  }, []);

  const getTemplateStats = useCallback(() => {
    return templateLibrary.getTemplateStats();
  }, []);

  return {
    getAllTemplates,
    getTemplatesByCategory,
    getTemplatesBySubcategory,
    getTemplate,
    searchTemplates,
    addToFavorites,
    removeFromFavorites,
    getFavoriteTemplates,
    isFavorite,
    getRecommendedTemplates,
    getAnniversaryTemplates,
    getTemplateForAnniversary,
    cloneTemplate,
    getTemplateStats,
    favorites,
  };
}
