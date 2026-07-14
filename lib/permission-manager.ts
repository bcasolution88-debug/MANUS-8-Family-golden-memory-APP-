/**
 * 家庭成员权限管理模块
 * 支持细粒度的权限控制、角色定义、权限模板
 */

export type Permission =
  | "view"
  | "edit"
  | "delete"
  | "share"
  | "comment"
  | "like"
  | "download"
  | "manage_members"
  | "manage_permissions";

export type Role = "admin" | "editor" | "viewer" | "guest";

export interface RoleTemplate {
  role: Role;
  permissions: Permission[];
  description: string;
}

export interface MemberPermission {
  memberId: string;
  memberName: string;
  role: Role;
  customPermissions?: Permission[];
  createdAt: number;
  expiresAt?: number; // 权限过期时间
}

export interface ResourcePermission {
  resourceId: string;
  resourceType: "album" | "photo" | "video" | "story";
  permissions: Map<string, Permission[]>; // memberId -> permissions
}

class PermissionManager {
  private roleTemplates: Map<Role, RoleTemplate> = new Map();
  private memberPermissions: Map<string, MemberPermission> = new Map();
  private resourcePermissions: Map<string, ResourcePermission> = new Map();

  constructor() {
    this.initializeRoleTemplates();
  }

  /**
   * 初始化角色模板
   */
  private initializeRoleTemplates(): void {
    this.roleTemplates.set("admin", {
      role: "admin",
      permissions: [
        "view",
        "edit",
        "delete",
        "share",
        "comment",
        "like",
        "download",
        "manage_members",
        "manage_permissions",
      ],
      description: "Full access to all features and member management",
    });

    this.roleTemplates.set("editor", {
      role: "editor",
      permissions: [
        "view",
        "edit",
        "delete",
        "share",
        "comment",
        "like",
        "download",
      ],
      description: "Can edit and manage content",
    });

    this.roleTemplates.set("viewer", {
      role: "viewer",
      permissions: ["view", "comment", "like", "download"],
      description: "Can view and comment on content",
    });

    this.roleTemplates.set("guest", {
      role: "guest",
      permissions: ["view"],
      description: "Can only view content",
    });
  }

  /**
   * 添加家庭成员
   */
  addMember(
    memberId: string,
    memberName: string,
    role: Role,
    expiresAt?: number
  ): MemberPermission {
    const permission: MemberPermission = {
      memberId,
      memberName,
      role,
      createdAt: Date.now(),
      expiresAt,
    };

    this.memberPermissions.set(memberId, permission);
    console.log(`Member added: ${memberName} (${role})`);

    return permission;
  }

  /**
   * 移除家庭成员
   */
  removeMember(memberId: string): void {
    this.memberPermissions.delete(memberId);

    // 删除该成员的所有资源权限
    this.resourcePermissions.forEach(resource => {
      resource.permissions.delete(memberId);
    });

    console.log(`Member removed: ${memberId}`);
  }

  /**
   * 更新成员角色
   */
  updateMemberRole(memberId: string, newRole: Role): MemberPermission | null {
    const permission = this.memberPermissions.get(memberId);
    if (!permission) return null;

    permission.role = newRole;
    permission.customPermissions = undefined;
    console.log(`Member role updated: ${memberId} -> ${newRole}`);

    return permission;
  }

  /**
   * 设置自定义权限
   */
  setCustomPermissions(
    memberId: string,
    permissions: Permission[]
  ): MemberPermission | null {
    const memberPerm = this.memberPermissions.get(memberId);
    if (!memberPerm) return null;

    memberPerm.customPermissions = permissions;
    console.log(`Custom permissions set for member: ${memberId}`);

    return memberPerm;
  }

  /**
   * 检查成员权限
   */
  hasPermission(
    memberId: string,
    permission: Permission,
    resourceId?: string
  ): boolean {
    // 检查成员是否存在且权限未过期
    const memberPerm = this.memberPermissions.get(memberId);
    if (!memberPerm) return false;

    if (memberPerm.expiresAt && memberPerm.expiresAt < Date.now()) {
      return false;
    }

    // 如果指定了资源，检查资源级别的权限
    if (resourceId) {
      const resourcePerm = this.resourcePermissions.get(resourceId);
      if (resourcePerm) {
        const memberResourcePerms = resourcePerm.permissions.get(memberId);
        if (memberResourcePerms) {
          return memberResourcePerms.includes(permission);
        }
      }
    }

    // 检查角色权限或自定义权限
    const permissions =
      memberPerm.customPermissions ||
      this.roleTemplates.get(memberPerm.role)?.permissions ||
      [];

    return permissions.includes(permission);
  }

  /**
   * 为资源设置权限
   */
  setResourcePermission(
    resourceId: string,
    resourceType: "album" | "photo" | "video" | "story",
    memberId: string,
    permissions: Permission[]
  ): void {
    let resourcePerm = this.resourcePermissions.get(resourceId);

    if (!resourcePerm) {
      resourcePerm = {
        resourceId,
        resourceType,
        permissions: new Map(),
      };
      this.resourcePermissions.set(resourceId, resourcePerm);
    }

    resourcePerm.permissions.set(memberId, permissions);
    console.log(`Resource permissions set: ${resourceId} -> ${memberId}`);
  }

  /**
   * 获取成员的所有权限
   */
  getMemberPermissions(memberId: string): Permission[] {
    const memberPerm = this.memberPermissions.get(memberId);
    if (!memberPerm) return [];

    return (
      memberPerm.customPermissions ||
      this.roleTemplates.get(memberPerm.role)?.permissions ||
      []
    );
  }

  /**
   * 获取资源的访问成员列表
   */
  getResourceAccessList(resourceId: string): Array<{
    memberId: string;
    memberName: string;
    permissions: Permission[];
  }> {
    const resourcePerm = this.resourcePermissions.get(resourceId);
    if (!resourcePerm) return [];

    const accessList: Array<{
      memberId: string;
      memberName: string;
      permissions: Permission[];
    }> = [];

    resourcePerm.permissions.forEach((permissions, memberId) => {
      const memberPerm = this.memberPermissions.get(memberId);
      if (memberPerm) {
        accessList.push({
          memberId,
          memberName: memberPerm.memberName,
          permissions,
        });
      }
    });

    return accessList;
  }

  /**
   * 获取角色模板
   */
  getRoleTemplate(role: Role): RoleTemplate | undefined {
    return this.roleTemplates.get(role);
  }

  /**
   * 获取所有角色模板
   */
  getAllRoleTemplates(): RoleTemplate[] {
    return Array.from(this.roleTemplates.values());
  }

  /**
   * 获取所有成员
   */
  getAllMembers(): MemberPermission[] {
    return Array.from(this.memberPermissions.values());
  }

  /**
   * 检查权限冲突
   */
  checkPermissionConflict(
    permissions: Permission[]
  ): {
    hasConflict: boolean;
    conflicts: string[];
  } {
    const conflicts: string[] = [];

    // 检查逻辑冲突
    if (permissions.includes("delete") && !permissions.includes("edit")) {
      conflicts.push("Cannot delete without edit permission");
    }

    if (permissions.includes("manage_permissions") && !permissions.includes("manage_members")) {
      conflicts.push("Cannot manage permissions without managing members");
    }

    return {
      hasConflict: conflicts.length > 0,
      conflicts,
    };
  }

  /**
   * 批量设置权限
   */
  batchSetPermissions(
    memberIds: string[],
    role: Role
  ): MemberPermission[] {
    const updated: MemberPermission[] = [];

    memberIds.forEach(memberId => {
      const memberPerm = this.memberPermissions.get(memberId);
      if (memberPerm) {
        memberPerm.role = role;
        memberPerm.customPermissions = undefined;
        updated.push(memberPerm);
      }
    });

    console.log(`Batch permissions updated for ${updated.length} members`);
    return updated;
  }

  /**
   * 获取权限统计
   */
  getPermissionStats(): {
    totalMembers: number;
    adminCount: number;
    editorCount: number;
    viewerCount: number;
    guestCount: number;
    expiredPermissions: number;
  } {
    let adminCount = 0;
    let editorCount = 0;
    let viewerCount = 0;
    let guestCount = 0;
    let expiredCount = 0;

    this.memberPermissions.forEach(perm => {
      if (perm.expiresAt && perm.expiresAt < Date.now()) {
        expiredCount++;
      } else {
        switch (perm.role) {
          case "admin":
            adminCount++;
            break;
          case "editor":
            editorCount++;
            break;
          case "viewer":
            viewerCount++;
            break;
          case "guest":
            guestCount++;
            break;
        }
      }
    });

    return {
      totalMembers: this.memberPermissions.size,
      adminCount,
      editorCount,
      viewerCount,
      guestCount,
      expiredPermissions: expiredCount,
    };
  }
}

// 导出单例
export const permissionManager = new PermissionManager();
