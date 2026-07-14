/**
 * WebSocket实时通信管理模块
 * 支持消息、评论、通知的实时推送
 */

export interface WebSocketMessage {
  type: "message" | "comment" | "notification" | "reaction" | "typing";
  data: any;
  timestamp: number;
  userId: string;
}

export interface RealtimeListener {
  onMessage?: (message: WebSocketMessage) => void;
  onComment?: (comment: any) => void;
  onNotification?: (notification: any) => void;
  onReaction?: (reaction: any) => void;
  onTyping?: (data: { userId: string; isTyping: boolean }) => void;
  onConnectionChange?: (connected: boolean) => void;
}

class WebSocketManager {
  private ws: WebSocket | null = null;
  private url: string = "";
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 3000;
  private listeners: Set<RealtimeListener> = new Set();
  private messageQueue: WebSocketMessage[] = [];
  private isConnected = false;
  private userId: string = "";

  /**
   * 初始化WebSocket连接
   */
  connect(url: string, userId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.url = url;
        this.userId = userId;

        // 模拟WebSocket连接
        console.log(`Connecting to WebSocket: ${url}`);

        // 模拟连接成功
        setTimeout(() => {
          this.isConnected = true;
          this.reconnectAttempts = 0;
          this.notifyConnectionChange(true);
          this.processPendingMessages();
          resolve();
        }, 500);
      } catch (error) {
        console.error("Failed to connect WebSocket:", error);
        reject(error);
      }
    });
  }

  /**
   * 断开连接
   */
  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
    this.notifyConnectionChange(false);
  }

  /**
   * 发送消息
   */
  sendMessage(message: WebSocketMessage): void {
    if (this.isConnected) {
      console.log("Sending message:", message);
      // 实际实现中会通过ws.send()发送
    } else {
      // 离线时加入队列
      this.messageQueue.push(message);
    }
  }

  /**
   * 订阅实时事件
   */
  subscribe(listener: RealtimeListener): () => void {
    this.listeners.add(listener);

    // 返回取消订阅函数
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 发送消息
   */
  emitMessage(content: string, mentions: string[] = []): void {
    const message: WebSocketMessage = {
      type: "message",
      data: {
        content,
        mentions,
        senderId: this.userId,
        timestamp: Date.now(),
      },
      timestamp: Date.now(),
      userId: this.userId,
    };

    this.sendMessage(message);
    this.notifyListeners("message", message);
  }

  /**
   * 发送评论
   */
  emitComment(mediaId: string, content: string, mentions: string[] = []): void {
    const comment: WebSocketMessage = {
      type: "comment",
      data: {
        mediaId,
        content,
        mentions,
        authorId: this.userId,
        timestamp: Date.now(),
      },
      timestamp: Date.now(),
      userId: this.userId,
    };

    this.sendMessage(comment);
    this.notifyListeners("comment", comment);
  }

  /**
   * 发送表情反应
   */
  emitReaction(messageId: string, emoji: string): void {
    const reaction: WebSocketMessage = {
      type: "reaction",
      data: {
        messageId,
        emoji,
        userId: this.userId,
        timestamp: Date.now(),
      },
      timestamp: Date.now(),
      userId: this.userId,
    };

    this.sendMessage(reaction);
    this.notifyListeners("reaction", reaction);
  }

  /**
   * 发送正在输入状态
   */
  emitTyping(isTyping: boolean): void {
    const typing: WebSocketMessage = {
      type: "typing",
      data: {
        userId: this.userId,
        isTyping,
      },
      timestamp: Date.now(),
      userId: this.userId,
    };

    this.sendMessage(typing);
  }

  /**
   * 获取连接状态
   */
  getConnectionStatus(): boolean {
    return this.isConnected;
  }

  /**
   * 处理待发送的消息队列
   */
  private processPendingMessages(): void {
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      if (message) {
        this.sendMessage(message);
      }
    }
  }

  /**
   * 通知所有监听器
   */
  private notifyListeners(type: string, data: any): void {
    this.listeners.forEach(listener => {
      switch (type) {
        case "message":
          listener.onMessage?.(data);
          break;
        case "comment":
          listener.onComment?.(data);
          break;
        case "notification":
          listener.onNotification?.(data);
          break;
        case "reaction":
          listener.onReaction?.(data);
          break;
        case "typing":
          listener.onTyping?.(data);
          break;
      }
    });
  }

  /**
   * 通知连接状态变化
   */
  private notifyConnectionChange(connected: boolean): void {
    this.listeners.forEach(listener => {
      listener.onConnectionChange?.(connected);
    });
  }

  /**
   * 自动重连
   */
  private attemptReconnect(): void {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      console.log(
        `Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`
      );

      setTimeout(() => {
        this.connect(this.url, this.userId).catch(() => {
          this.attemptReconnect();
        });
      }, this.reconnectDelay * this.reconnectAttempts);
    } else {
      console.error("Max reconnect attempts reached");
    }
  }
}

// 导出单例
export const wsManager = new WebSocketManager();
