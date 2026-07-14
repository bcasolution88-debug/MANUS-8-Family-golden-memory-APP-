/**
 * 实时WebSocket通信管理
 * 集成Socket.io实现消息、通知的实时推送
 */

export type MessageType = "comment" | "like" | "share" | "mention" | "system" | "typing";

export interface RealtimeMessage {
  id: string;
  type: MessageType;
  senderId: string;
  senderName: string;
  content: string;
  resourceId: string;
  resourceType: string;
  timestamp: number;
  metadata?: Record<string, any>;
}

export interface ConnectionStatus {
  connected: boolean;
  connecting: boolean;
  lastConnected?: number;
  reconnectAttempts: number;
  error?: string;
}

export type MessageHandler = (message: RealtimeMessage) => void;
export type ConnectionHandler = (connected: boolean) => void;

class RealtimeWebSocket {
  private messageHandlers: Map<string, Set<MessageHandler>> = new Map();
  private connectionHandlers: Set<ConnectionHandler> = new Set();
  private connectionStatus: ConnectionStatus = {
    connected: false,
    connecting: false,
    reconnectAttempts: 0,
  };
  private messageQueue: RealtimeMessage[] = [];
  private reconnectInterval = 5000;
  private maxReconnectAttempts = 10;
  private userId?: string;
  private familyId?: string;

  /**
   * 初始化连接
   */
  async connect(userId: string, familyId: string): Promise<void> {
    if (this.connectionStatus.connected || this.connectionStatus.connecting) {
      return;
    }

    this.userId = userId;
    this.familyId = familyId;
    this.connectionStatus.connecting = true;

    try {
      console.log("Connecting to WebSocket...");

      // 模拟WebSocket连接
      await new Promise(resolve => setTimeout(resolve, 500));

      this.connectionStatus.connected = true;
      this.connectionStatus.connecting = false;
      this.connectionStatus.lastConnected = Date.now();
      this.connectionStatus.reconnectAttempts = 0;

      console.log("WebSocket connected");

      // 通知连接处理器
      this.notifyConnectionHandlers(true);

      // 处理消息队列
      this.processMessageQueue();
    } catch (error) {
      console.error("Failed to connect:", error);
      this.connectionStatus.connecting = false;
      this.connectionStatus.error = String(error);

      // 重新连接
      if (this.connectionStatus.reconnectAttempts < this.maxReconnectAttempts) {
        this.connectionStatus.reconnectAttempts++;
        setTimeout(() => this.connect(userId, familyId), this.reconnectInterval);
      }
    }
  }

  /**
   * 断开连接
   */
  disconnect(): void {
    if (this.connectionStatus.connected) {
      console.log("Disconnecting from WebSocket...");
      this.connectionStatus.connected = false;
      this.notifyConnectionHandlers(false);
    }
  }

  /**
   * 发送消息
   */
  async sendMessage(message: Omit<RealtimeMessage, "id" | "timestamp">): Promise<void> {
    const fullMessage: RealtimeMessage = {
      ...message,
      id: `msg_${Date.now()}`,
      timestamp: Date.now(),
    };

    if (this.connectionStatus.connected) {
      try {
        console.log("Sending message:", fullMessage.id);
        // 模拟发送
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        console.error("Failed to send message:", error);
        this.messageQueue.push(fullMessage);
      }
    } else {
      this.messageQueue.push(fullMessage);
      console.log("Message queued (offline):", fullMessage.id);
    }
  }

  /**
   * 接收消息（模拟）
   */
  receiveMessage(message: RealtimeMessage): void {
    console.log("Message received:", message.id);

    // 调用相应的处理器
    const handlers = this.messageHandlers.get(message.type);
    if (handlers) {
      handlers.forEach(handler => handler(message));
    }

    // 调用通用处理器
    const allHandlers = this.messageHandlers.get("*");
    if (allHandlers) {
      allHandlers.forEach(handler => handler(message));
    }
  }

  /**
   * 订阅消息类型
   */
  subscribe(messageType: string, handler: MessageHandler): () => void {
    if (!this.messageHandlers.has(messageType)) {
      this.messageHandlers.set(messageType, new Set());
    }

    this.messageHandlers.get(messageType)!.add(handler);
    console.log(`Subscribed to ${messageType}`);

    // 返回取消订阅函数
    return () => {
      this.messageHandlers.get(messageType)?.delete(handler);
      console.log(`Unsubscribed from ${messageType}`);
    };
  }

  /**
   * 订阅连接状态
   */
  onConnectionChange(handler: ConnectionHandler): () => void {
    this.connectionHandlers.add(handler);
    console.log("Connection handler registered");

    // 返回取消订阅函数
    return () => {
      this.connectionHandlers.delete(handler);
      console.log("Connection handler unregistered");
    };
  }

  /**
   * 获取连接状态
   */
  getConnectionStatus(): ConnectionStatus {
    return { ...this.connectionStatus };
  }

  /**
   * 是否已连接
   */
  isConnected(): boolean {
    return this.connectionStatus.connected;
  }

  /**
   * 获取消息队列
   */
  getMessageQueue(): RealtimeMessage[] {
    return [...this.messageQueue];
  }

  /**
   * 清空消息队列
   */
  clearMessageQueue(): void {
    this.messageQueue = [];
    console.log("Message queue cleared");
  }

  /**
   * 通知连接处理器
   */
  private notifyConnectionHandlers(connected: boolean): void {
    this.connectionHandlers.forEach(handler => {
      try {
        handler(connected);
      } catch (error) {
        console.error("Error in connection handler:", error);
      }
    });
  }

  /**
   * 处理消息队列
   */
  private async processMessageQueue(): Promise<void> {
    while (this.messageQueue.length > 0 && this.connectionStatus.connected) {
      const message = this.messageQueue.shift();
      if (message) {
        try {
          await this.sendMessage(message);
        } catch (error) {
          console.error("Failed to process queued message:", error);
          this.messageQueue.unshift(message);
          break;
        }
      }
    }
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    connected: boolean;
    connecting: boolean;
    queuedMessages: number;
    reconnectAttempts: number;
    lastConnected?: number;
  } {
    return {
      connected: this.connectionStatus.connected,
      connecting: this.connectionStatus.connecting,
      queuedMessages: this.messageQueue.length,
      reconnectAttempts: this.connectionStatus.reconnectAttempts,
      lastConnected: this.connectionStatus.lastConnected,
    };
  }
}

// 导出单例
export const realtimeWebSocket = new RealtimeWebSocket();
