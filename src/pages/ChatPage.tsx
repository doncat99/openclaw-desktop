// ═══════════════════════════════════════════════════════════
// ChatPage — Multi-session chat with tab bar
// ═══════════════════════════════════════════════════════════

import { ChatTabs } from '@/components/Chat/ChatTabs';
import { ChatView } from '@/components/Chat/ChatView';

export function ChatPage() {
  return (
    <div className="flex flex-col h-full">
      <ChatTabs />
      <ChatView />
    </div>
  );
}
