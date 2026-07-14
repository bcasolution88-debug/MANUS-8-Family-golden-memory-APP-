/**
 * 实时消息和评论互动系统
 * 支持@提及、消息通知、未读计数等功能
 */

export interface Message {
  id: string;
  senderId: string;
  senderName: string;
  senderAvatar: string;
  content: string;
  mentions: string[]; // @提及的用户ID列表
  timestamp: number;
  isRead: boolean;
  type: "message" | "comment" | "reply";
  parentId?: string; // 回复的消息ID
  mediaUrl?: string; // 附加的媒体URL
  reactions: Record<string, string[]>; // 表情反应 { emoji: [userId1, userId2] }
}

export interface Comment {
  id: string;
  authorId: string;
  authorName: string;
  authorAvatar: string;
  content: string;
  mentions: string[];
  timestamp: number;
  likes: number;
  liked: boolean;
  replies: Comment[];
  mediaId: string;
  mediaType: "photo" | "video" | "story";
}

export interface UnreadCount {
  messages: number;
  comments: number;
  mentions: number;
  total: number;
}

/**
 * 发送消息
 */
export async function sendMessage(
  content: string,
  mentions: string[] = [],
  mediaUrl?: string
): Promise<Message> {
  try {
    const message: Message = {
      id: `msg_${Date.now()}`,
      senderId: "current_user",
      senderName: "当前用户",
      senderAvatar: "https://via.placeholder.com/40",
      content,
      mentions,
      timestamp: Date.now(),
      isRead: true,
      type: "message",
      mediaUrl,
      reactions: {},
    };

    console.log("Message sent:", message);
    return message;
  } catch (error) {
    console.error("Failed to send message:", error);
    throw error;
  }
}

/**
 * 发送评论
 */
export async function addComment(
  mediaId: string,
  mediaType: "photo" | "video" | "story",
  content: string,
  mentions: string[] = []
): Promise<Comment> {
  try {
    const comment: Comment = {
      id: `comment_${Date.now()}`,
      authorId: "current_user",
      authorName: "当前用户",
      authorAvatar: "https://via.placeholder.com/40",
      content,
      mentions,
      timestamp: Date.now(),
      likes: 0,
      liked: false,
      replies: [],
      mediaId,
      mediaType,
    };

    console.log("Comment added:", comment);
    return comment;
  } catch (error) {
    console.error("Failed to add comment:", error);
    throw error;
  }
}

/**
 * 回复评论
 */
export async function replyToComment(
  parentCommentId: string,
  content: string,
  mentions: string[] = []
): Promise<Comment> {
  try {
    const reply: Comment = {
      id: `reply_${Date.now()}`,
      authorId: "current_user",
      authorName: "当前用户",
      authorAvatar: "https://via.placeholder.com/40",
      content,
      mentions,
      timestamp: Date.now(),
      likes: 0,
      liked: false,
      replies: [],
      mediaId: "",
      mediaType: "photo",
    };

    console.log("Reply added:", reply);
    return reply;
  } catch (error) {
    console.error("Failed to reply to comment:", error);
    throw error;
  }
}

/**
 * 点赞评论
 */
export async function likeComment(commentId: string): Promise<void> {
  try {
    console.log("Comment liked:", commentId);
  } catch (error) {
    console.error("Failed to like comment:", error);
    throw error;
  }
}

/**
 * 删除评论
 */
export async function deleteComment(commentId: string): Promise<void> {
  try {
    console.log("Comment deleted:", commentId);
  } catch (error) {
    console.error("Failed to delete comment:", error);
    throw error;
  }
}

/**
 * 添加表情反应
 */
export async function addReaction(
  messageId: string,
  emoji: string
): Promise<void> {
  try {
    console.log("Reaction added:", { messageId, emoji });
  } catch (error) {
    console.error("Failed to add reaction:", error);
    throw error;
  }
}

/**
 * 标记消息为已读
 */
export async function markAsRead(messageId: string): Promise<void> {
  try {
    console.log("Message marked as read:", messageId);
  } catch (error) {
    console.error("Failed to mark message as read:", error);
    throw error;
  }
}

/**
 * 标记所有消息为已读
 */
export async function markAllAsRead(): Promise<void> {
  try {
    console.log("All messages marked as read");
  } catch (error) {
    console.error("Failed to mark all as read:", error);
    throw error;
  }
}

/**
 * 获取未读计数
 */
export async function getUnreadCount(): Promise<UnreadCount> {
  try {
    // 模拟获取未读计数
    return {
      messages: 3,
      comments: 5,
      mentions: 2,
      total: 10,
    };
  } catch (error) {
    console.error("Failed to get unread count:", error);
    return {
      messages: 0,
      comments: 0,
      mentions: 0,
      total: 0,
    };
  }
}

/**
 * 获取消息列表
 */
export async function getMessages(limit: number = 20): Promise<Message[]> {
  try {
    // 模拟消息列表
    return [
      {
        id: "msg_1",
        senderId: "user_1",
        senderName: "小明",
        senderAvatar: "https://via.placeholder.com/40",
        content: "你好，这是一条消息",
        mentions: [],
        timestamp: Date.now() - 3600000,
        isRead: true,
        type: "message",
        reactions: {},
      },
    ];
  } catch (error) {
    console.error("Failed to get messages:", error);
    return [];
  }
}

/**
 * 获取评论列表
 */
export async function getComments(
  mediaId: string,
  limit: number = 20
): Promise<Comment[]> {
  try {
    // 模拟评论列表
    return [
      {
        id: "comment_1",
        authorId: "user_1",
        authorName: "小明",
        authorAvatar: "https://via.placeholder.com/40",
        content: "这张照片很漂亮！",
        mentions: [],
        timestamp: Date.now() - 7200000,
        likes: 5,
        liked: false,
        replies: [],
        mediaId,
        mediaType: "photo",
      },
    ];
  } catch (error) {
    console.error("Failed to get comments:", error);
    return [];
  }
}

/**
 * 搜索@提及的用户
 */
export async function searchMentionUsers(query: string): Promise<Array<{
  id: string;
  name: string;
  avatar: string;
}>> {
  try {
    // 模拟搜索结果
    const mockUsers = [
      { id: "user_1", name: "小明", avatar: "https://via.placeholder.com/40" },
      { id: "user_2", name: "小红", avatar: "https://via.placeholder.com/40" },
      { id: "user_3", name: "小刚", avatar: "https://via.placeholder.com/40" },
    ];

    return mockUsers.filter(user =>
      user.name.toLowerCase().includes(query.toLowerCase())
    );
  } catch (error) {
    console.error("Failed to search mention users:", error);
    return [];
  }
}

/**
 * 获取提及我的消息
 */
export async function getMentions(limit: number = 20): Promise<Message[]> {
  try {
    // 模拟提及消息
    return [];
  } catch (error) {
    console.error("Failed to get mentions:", error);
    return [];
  }
}

/**
 * 设置消息已读状态变化监听
 */
export function setupMessageListener(
  onMessageReceived?: (message: Message) => void,
  onUnreadCountChanged?: (count: UnreadCount) => void
): () => void {
  // 返回清理函数
  return () => {
    console.log("Message listeners cleaned up");
  };
}
