import { Suspense } from "react";

import { ChatApp } from "@/components/ChatApp";

export default function ChatPage() {
  // ChatApp reads ?c= from the URL, which needs a Suspense boundary.
  return (
    <Suspense>
      <ChatApp />
    </Suspense>
  );
}
