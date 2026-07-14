import { useEffect, useState } from "react";
import { getUnreadCount, UnreadCount } from "@/lib/messaging-system";

export function useUnreadCount() {
  const [unreadCount, setUnreadCount] = useState<UnreadCount>({
    messages: 0,
    comments: 0,
    mentions: 0,
    total: 0,
  });

  useEffect(() => {
    const fetchUnreadCount = async () => {
      try {
        const count = await getUnreadCount();
        setUnreadCount(count);
      } catch (error) {
        console.error("Failed to fetch unread count:", error);
      }
    };

    fetchUnreadCount();

    // 定期更新未读计数
    const interval = setInterval(fetchUnreadCount, 5000);

    return () => clearInterval(interval);
  }, []);

  return unreadCount;
}
