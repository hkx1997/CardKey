import { useEffect, useId, useRef } from "react";

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        opts: {
          sitekey: string;
          callback?: (token: string) => void;
          "expired-callback"?: () => void;
          "error-callback"?: () => void;
          theme?: "auto" | "light" | "dark";
        },
      ) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId?: string) => void;
    };
    onTurnstileLoad?: () => void;
  }
}

const SCRIPT_ID = "cf-turnstile-script";
const SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=onTurnstileLoad";

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  const existing = document.getElementById(SCRIPT_ID);
  if (existing) {
    return new Promise((resolve) => {
      window.onTurnstileLoad = () => resolve();
      if (window.turnstile) resolve();
    });
  }
  return new Promise((resolve, reject) => {
    window.onTurnstileLoad = () => resolve();
    const s = document.createElement("script");
    s.id = SCRIPT_ID;
    s.src = SCRIPT_SRC;
    s.async = true;
    s.onerror = () => reject(new Error("Turnstile 脚本加载失败"));
    document.head.appendChild(s);
  });
}

/** Cloudflare Turnstile 挂件；siteKey 变化时重挂 */
export function TurnstileWidget({
  siteKey,
  onToken,
  className,
}: {
  siteKey: string;
  onToken: (token: string | null) => void;
  className?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const reactId = useId();

  useEffect(() => {
    if (!siteKey || !hostRef.current) return;
    let cancelled = false;

    void (async () => {
      try {
        await loadScript();
        if (cancelled || !hostRef.current || !window.turnstile) return;
        if (widgetId.current) {
          try {
            window.turnstile.remove(widgetId.current);
          } catch {
            /* ignore */
          }
          widgetId.current = null;
        }
        hostRef.current.innerHTML = "";
        const id = window.turnstile.render(hostRef.current, {
          sitekey: siteKey,
          theme: "auto",
          callback: (token) => onToken(token),
          "expired-callback": () => onToken(null),
          "error-callback": () => onToken(null),
        });
        widgetId.current = id;
      } catch {
        onToken(null);
      }
    })();

    return () => {
      cancelled = true;
      if (widgetId.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetId.current);
        } catch {
          /* ignore */
        }
        widgetId.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onToken 由父级稳定或可接受重挂
  }, [siteKey, reactId]);

  return (
    <div
      className={className}
      ref={hostRef}
      data-turnstile-host={reactId}
    />
  );
}

export function resetTurnstile() {
  try {
    window.turnstile?.reset();
  } catch {
    /* ignore */
  }
}
