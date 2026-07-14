import { useCallback } from "react";
import { permissionManager, Role, Permission, MemberPermission } from "@/lib/permission-manager";

export function usePermissions() {
  const addMember = useCallback(
    (memberId: string, memberName: string, role: Role, expiresAt?: number) => {
      return permissionManager.addMember(memberId, memberName, role, expiresAt);
    },
    []
  );

  const removeMember = useCallback((memberId: string) => {
    permissionManager.removeMember(memberId);
  }, []);

  const updateMemberRole = useCallback((memberId: string, newRole: Role) => {
    return permissionManager.updateMemberRole(memberId, newRole);
  }, []);

  const setCustomPermissions = useCallback((memberId: string, permissions: Permission[]) => {
    return permissionManager.setCustomPermissions(memberId, permissions);
  }, []);

  const hasPermission = useCallback(
    (memberId: string, permission: Permission, resourceId?: string) => {
      return permissionManager.hasPermission(memberId, permission, resourceId);
    },
    []
  );

  const setResourcePermission = useCallback(
    (
      resourceId: string,
      resourceType: "album" | "photo" | "video" | "story",
      memberId: string,
      permissions: Permission[]
    ) => {
      permissionManager.setResourcePermission(resourceId, resourceType, memberId, permissions);
    },
    []
  );

  const getMemberPermissions = useCallback((memberId: string) => {
    return permissionManager.getMemberPermissions(memberId);
  }, []);

  const getResourceAccessList = useCallback((resourceId: string) => {
    return permissionManager.getResourceAccessList(resourceId);
  }, []);

  const getRoleTemplate = useCallback((role: Role) => {
    return permissionManager.getRoleTemplate(role);
  }, []);

  const getAllRoleTemplates = useCallback(() => {
    return permissionManager.getAllRoleTemplates();
  }, []);

  const getAllMembers = useCallback(() => {
    return permissionManager.getAllMembers();
  }, []);

  const checkPermissionConflict = useCallback((permissions: Permission[]) => {
    return permissionManager.checkPermissionConflict(permissions);
  }, []);

  const batchSetPermissions = useCallback((memberIds: string[], role: Role) => {
    return permissionManager.batchSetPermissions(memberIds, role);
  }, []);

  const getPermissionStats = useCallback(() => {
    return permissionManager.getPermissionStats();
  }, []);

  return {
    addMember,
    removeMember,
    updateMemberRole,
    setCustomPermissions,
    hasPermission,
    setResourcePermission,
    getMemberPermissions,
    getResourceAccessList,
    getRoleTemplate,
    getAllRoleTemplates,
    getAllMembers,
    checkPermissionConflict,
    batchSetPermissions,
    getPermissionStats,
  };
}
