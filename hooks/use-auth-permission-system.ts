import { useCallback, useState } from "react";
import {
  authPermissionSystem,
  User,
  Session,
  UserRole,
  ResourceType,
  PermissionAction,
  FamilyMember,
} from "@/lib/auth-permission-system";

export function useAuthPermissionSystem() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [currentSession, setCurrentSession] = useState<Session | null>(null);
  const [stats, setStats] = useState(authPermissionSystem.getStats());

  const registerUser = useCallback(
    async (email: string, name: string, password: string, familyId: string) => {
      const user = await authPermissionSystem.registerUser(email, name, password, familyId);
      setCurrentUser(user);
      setStats(authPermissionSystem.getStats());
      return user;
    },
    []
  );

  const oauthLogin = useCallback(
    async (
      provider: "google" | "facebook",
      accessToken: string,
      profile: { email: string; name: string; avatar?: string }
    ) => {
      const { user, session } = await authPermissionSystem.oauthLogin(provider, accessToken, profile);
      setCurrentUser(user);
      setCurrentSession(session);
      setStats(authPermissionSystem.getStats());
      return { user, session };
    },
    []
  );

  const validateSession = useCallback((sessionId: string) => {
    const isValid = authPermissionSystem.validateSession(sessionId);
    if (isValid) {
      setStats(authPermissionSystem.getStats());
    }
    return isValid;
  }, []);

  const refreshToken = useCallback((sessionId: string) => {
    const session = authPermissionSystem.refreshToken(sessionId);
    if (session) {
      setCurrentSession(session);
      setStats(authPermissionSystem.getStats());
    }
    return session;
  }, []);

  const logout = useCallback((sessionId: string) => {
    authPermissionSystem.logout(sessionId);
    setCurrentUser(null);
    setCurrentSession(null);
    setStats(authPermissionSystem.getStats());
  }, []);

  const checkPermission = useCallback(
    (
      userId: string,
      resourceType: ResourceType,
      action: PermissionAction,
      familyId: string
    ) => {
      return authPermissionSystem.checkPermission(userId, resourceType, action, familyId);
    },
    []
  );

  const updateUserRole = useCallback((userId: string, newRole: UserRole, familyId: string) => {
    const success = authPermissionSystem.updateUserRole(userId, newRole, familyId);
    if (success) {
      setStats(authPermissionSystem.getStats());
    }
    return success;
  }, []);

  const getFamilyMembers = useCallback((familyId: string): FamilyMember[] => {
    return authPermissionSystem.getFamilyMembers(familyId);
  }, []);

  const getUser = useCallback((userId: string) => {
    return authPermissionSystem.getUser(userId);
  }, []);

  const getSession = useCallback((sessionId: string) => {
    return authPermissionSystem.getSession(sessionId);
  }, []);

  const cleanupExpiredSessions = useCallback(() => {
    authPermissionSystem.cleanupExpiredSessions();
    setStats(authPermissionSystem.getStats());
  }, []);

  return {
    currentUser,
    currentSession,
    stats,
    registerUser,
    oauthLogin,
    validateSession,
    refreshToken,
    logout,
    checkPermission,
    updateUserRole,
    getFamilyMembers,
    getUser,
    getSession,
    cleanupExpiredSessions,
  };
}
