"use client";

import { useCallback, type MouseEvent, type ReactNode } from "react";
import { selectTab } from "@/components/Panel";
import { writeWatching } from "@/components/watching";

/**
 * A "Watch on Peacock" link that plays in the Sports stage instead of leaving.
 *
 * Still a real link underneath: a modified or middle click opens the site in a
 * tab of the board's own browser, the same escape hatch every tile keeps.
 */
export function StreamLink({
  url,
  service,
  title,
  className,
  children,
}: {
  url: string;
  service: string;
  title: string;
  className?: string;
  children: ReactNode;
}) {
  const open = useCallback(
    (event: MouseEvent) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (event.button !== 0) return;
      event.preventDefault();
      writeWatching({
        kind: "stream",
        key: url,
        title,
        channel: service,
        href: url,
        at: Date.now(),
        origin: "sports",
      });
      selectTab("center", "sports");
    },
    [url, service, title],
  );

  return (
    <a className={className} href={url} target="_blank" rel="noreferrer" onClick={open}>
      {children}
    </a>
  );
}
