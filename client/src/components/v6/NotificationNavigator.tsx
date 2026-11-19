import { useEffect } from "react";
import { useLocation } from "wouter";

/**
 * A clicked notification opens the conversation it belongs to.
 *
 * The service worker focuses an open window and sends `navigate`; without
 * a listener here the window only came to the front, on whatever page it
 * happened to be showing.
 */
export default function NotificationNavigator() {
  const [, navigate] = useLocation();

  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator))
      return;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; url?: unknown } | null;
      if (!data || data.type !== "navigate" || typeof data.url !== "string")
        return;
      // Only an in-app path. A notification must not turn into an open
      // redirect.
      if (!data.url.startsWith("/") || data.url.startsWith("//")) return;
      navigate(data.url);
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () =>
      navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [navigate]);

  return null;
}
