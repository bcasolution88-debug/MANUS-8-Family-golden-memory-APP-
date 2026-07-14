/**
 * 用户认证和权限系统
 * 完善OAuth登录流程、用户会话管理、家庭成员权限控制、角色定义
 */

export type UserRole = "owner" | "admin" | "member" | "viewer" | "guest";
export type ResourceType = "album" | "photo" | "video" | "story" | "family";
export type PermissionAction = "view" | "edit" | "delete" | "share" | "download" | "comment";

export interface User {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  role: UserRole;
  familyId: string;
  createdAt: number;
  lastLogin?: number;
  verified: boolean;
}

export interface Session {
  id: string;
  userId: string;
  token: string;
  refreshToken: string;
  expiresAt: number;
  createdAt: number;
  lastActivity: number;
  deviceInfo?: {
    userAgent: string;
    ip: string;
  };
}

export interface Permission {
  id: string;
  role: UserRole;
  resourceType: ResourceType;
  actions: PermissionAction[];
}

export interface RolePermissionMap {
  owner: Permission[];
  admin: Permission[];
  member: Permission[];
  viewer: Permission[];
  guest: Permission[];
}

export interface FamilyMember {
  userId: string;
  role: UserRole;
  joinedAt: number;
  permissions?: Permission[];
}

class AuthPermissionSystem {
  private users: Map<string, User> = new Map();
  private sessions: Map<string, Session> = new Map();
  private familyMembers: Map<string, Map<string, FamilyMember>> = new Map(); // familyId -> userId -> member
  private rolePermissions: RolePermissionMap = this.initializeRolePermissions();
  private sessionTimeout = 24 * 60 * 60 * 1000; // 24小时

  /**
   * 初始化角色权限映射
   */
  private initializeRolePermissions(): RolePermissionMap {
    return {
      owner: [
        {
          id: "owner_all",
          role: "owner",
          resourceType: "family",
          actions: ["view", "edit", "delete", "share", "download", "comment"],
        },
        {
          id: "owner_album",
          role: "owner",
          resourceType: "album",
          actions: ["view", "edit", "delete", "share", "download", "comment"],
        },
        {
          id: "owner_photo",
          role: "owner",
          resourceType: "photo",
          actions: ["view", "edit", "delete", "share", "download", "comment"],
        },
      ],
      admin: [
        {
          id: "admin_album",
          role: "admin",
          resourceType: "album",
          actions: ["view", "edit", "delete", "share", "download", "comment"],
        },
        {
          id: "admin_photo",
          role: "admin",
          resourceType: "photo",
          actions: ["view", "edit", "delete", "share", "download", "comment"],
        },
      ],
      member: [
        {
          id: "member_album",
          role: "member",
          resourceType: "album",
          actions: ["view", "share", "download", "comment"],
        },
        {
          id: "member_photo",
          role: "member",
          resourceType: "photo",
          actions: ["view", "share", "download", "comment"],
        },
      ],
      viewer: [
        {
          id: "viewer_album",
          role: "viewer",
          resourceType: "album",
          actions: ["view", "download"],
        },
        {
          id: "viewer_photo",
          role: "viewer",
          resourceType: "photo",
          actions: ["view", "download"],
        },
      ],
      guest: [
        {
          id: "guest_album",
          role: "guest",
          resourceType: "album",
          actions: ["view"],
        },
        {
          id: "guest_photo",
          role: "guest",
          resourceType: "photo",
          actions: ["view"],
        },
      ],
    };
  }

  /**
   * 注册用户
   */
  async registerUser(
    email: string,
    name: string,
    password: string,
    familyId: string
  ): Promise<User> {
    try {
      console.log(`Registering user: ${email}`);

      // 模拟注册延迟
      await new Promise(resolve => setTimeout(resolve, 500));

      const user: User = {
        id: `user_${Date.now()}`,
        email,
        name,
        role: "member",
        familyId,
        createdAt: Date.now(),
        verified: false,
      };

      this.users.set(user.id, user);

      // 添加到家庭成员
      if (!this.familyMembers.has(familyId)) {
        this.familyMembers.set(familyId, new Map());
      }

      this.familyMembers.get(familyId)!.set(user.id, {
        userId: user.id,
        role: "member",
        joinedAt: Date.now(),
      });

      console.log(`User registered: ${user.id}`);
      return user;
    } catch (error) {
      console.error("Registration failed:", error);
      throw error;
    }
  }

  /**
   * OAuth登录
   */
  async oauthLogin(
    provider: "google" | "facebook",
    accessToken: string,
    profile: { email: string; name: string; avatar?: string }
  ): Promise<{ user: User; session: Session }> {
    try {
      console.log(`OAuth login: ${provider}`);

      // 模拟OAuth验证延迟
      await new Promise(resolve => setTimeout(resolve, 800));

      // 查找或创建用户
      let user = Array.from(this.users.values()).find(u => u.email === profile.email);

      if (!user) {
        user = {
          id: `user_${Date.now()}`,
          email: profile.email,
          name: profile.name,
          avatar: profile.avatar,
          role: "member",
          familyId: `family_${Date.now()}`,
          createdAt: Date.now(),
          verified: true,
        };

        this.users.set(user.id, user);

        // 创建家庭
        this.familyMembers.set(user.familyId, new Map());
        this.familyMembers.get(user.familyId)!.set(user.id, {
          userId: user.id,
          role: "owner",
          joinedAt: Date.now(),
        });
      }

      // 创建会话
      const session = this.createSession(user.id);

      console.log(`OAuth login successful: ${user.id}`);
      return { user, session };
    } catch (error) {
      console.error("OAuth login failed:", error);
      throw error;
    }
  }

  /**
   * 创建会话
   */
  private createSession(userId: string): Session {
    const session: Session = {
      id: `session_${Date.now()}`,
      userId,
      token: this.generateToken(),
      refreshToken: this.generateToken(),
      expiresAt: Date.now() + this.sessionTimeout,
      createdAt: Date.now(),
      lastActivity: Date.now(),
    };

    this.sessions.set(session.id, session);
    console.log(`Session created: ${session.id}`);

    return session;
  }

  /**
   * 生成令牌
   */
  private generateToken(): string {
    return Buffer.from(Math.random().toString()).toString("base64").substring(0, 32);
  }

  /**
   * 验证会话
   */
  validateSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);

    if (!session) {
      return false;
    }

    if (session.expiresAt < Date.now()) {
      this.sessions.delete(sessionId);
      return false;
    }

    // 更新最后活动时间
    session.lastActivity = Date.now();
    return true;
  }

  /**
   * 刷新令牌
   */
  refreshToken(sessionId: string): Session | null {
    const session = this.sessions.get(sessionId);

    if (!session || session.expiresAt < Date.now()) {
      return null;
    }

    session.token = this.generateToken();
    session.expiresAt = Date.now() + this.sessionTimeout;

    return session;
  }

  /**
   * 登出
   */
  logout(sessionId: string): void {
    this.sessions.delete(sessionId);
    console.log(`Session logged out: ${sessionId}`);
  }

  /**
   * 检查权限
   */
  checkPermission(
    userId: string,
    resourceType: ResourceType,
    action: PermissionAction,
    familyId: string
  ): boolean {
    const user = this.users.get(userId);
    if (!user || user.familyId !== familyId) {
      return false;
    }

    const permissions = this.rolePermissions[user.role];
    const hasPermission = permissions.some(
      p => p.resourceType === resourceType && p.actions.includes(action)
    );

    console.log(
      `Permission check: ${userId} ${action} ${resourceType} - ${hasPermission ? "granted" : "denied"}`
    );

    return hasPermission;
  }

  /**
   * 更新用户角色
   */
  updateUserRole(userId: string, newRole: UserRole, familyId: string): boolean {
    const user = this.users.get(userId);
    if (!user || user.familyId !== familyId) {
      return false;
    }

    user.role = newRole;

    const member = this.familyMembers.get(familyId)?.get(userId);
    if (member) {
      member.role = newRole;
    }

    console.log(`User role updated: ${userId} -> ${newRole}`);
    return true;
  }

  /**
   * 获取家庭成员
   */
  getFamilyMembers(familyId: string): FamilyMember[] {
    const members = this.familyMembers.get(familyId);
    if (!members) {
      return [];
    }

    return Array.from(members.values());
  }

  /**
   * 获取用户
   */
  getUser(userId: string): User | undefined {
    return this.users.get(userId);
  }

  /**
   * 获取会话
   */
  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    totalUsers: number;
    activeSessions: number;
    families: number;
  } {
    const activeSessions = Array.from(this.sessions.values()).filter(
      s => s.expiresAt > Date.now()
    ).length;

    return {
      totalUsers: this.users.size,
      activeSessions,
      families: this.familyMembers.size,
    };
  }

  /**
   * 清理过期会话
   */
  cleanupExpiredSessions(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (session.expiresAt < now) {
        this.sessions.delete(id);
      }
    }

    console.log("Expired sessions cleaned up");
  }
}

// 导出单例
export const authPermissionSystem = new AuthPermissionSystem();
