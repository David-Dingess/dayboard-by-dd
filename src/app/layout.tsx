import type { Metadata, Viewport } from "next";
import { Wallpaper } from "@/components/Wallpaper";
import { loadSettings } from "@/lib/settings";
import { screenZoom, wallpaperGreys } from "@/lib/screen";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dayboard",
  description: "Everything worth knowing is coming up.",
  // A private board. Nothing here should ever be indexed.
  robots: { index: false, follow: false, nocache: true },
};

export const viewport: Viewport = {
  themeColor: "#101216",
  width: "device-width",
  initialScale: 1,
};

/**
 * No header. This is a second-monitor dashboard on one monitor, so every pixel of chrome
 * is a pixel not showing something useful — the panels carry their own titles
 * and the only navigation is the toggle at the bottom of each column.
 *
 * THE SETTINGS THAT ARE A FACT ABOUT THE WHOLE PAGE are stamped on <html>
 * here: the zone and the agent URL as data attributes (lib/runtime.ts reads
 * them in the browser), the screen preset and wallpaper state for the CSS, and
 * the ground colour as a custom property the palette derives from. Read on
 * every request, uncached, so a save in the settings menu reaches the next
 * render — see lib/settings.ts.
 *
 * `auto` is resolved by an inline script before first paint: the board was
 * drawn for 3440x1440 and everything else is that board scaled, so the script
 * measures the window and sets the zoom the CSS wants. Doing it in an effect
 * would paint the wrong size for a frame on every reload.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  const s = loadSettings();
  const zoom = screenZoom(s.board.screen);
  const greys = wallpaperGreys(s.appearance.background);
  const ground = s.appearance.wallpaper ? greys.seam : s.appearance.background;

  return (
    <html
      lang="en"
      data-tz={s.location.timezone || undefined}
      data-agent={s.pc.agentUrl}
      data-screen={s.board.screen}
      data-wallpaper={s.appearance.wallpaper ? "on" : "off"}
      style={
        {
          "--bg-user": s.appearance.background,
          "--bg-ground": ground,
          // Omitted on auto, deliberately: the inline script below measures
          // the window and sets it once, and a property React does not manage
          // survives every re-render. Stamping 1 here would put it back to 1
          // on the first refresh tick.
          ...(zoom === null ? {} : { "--board-zoom": zoom }),
        } as React.CSSProperties
      }
    >
      <body>
        {s.board.screen === "auto" && (
          <script
            dangerouslySetInnerHTML={{
              __html:
                "(function(){function apply(){var w=window.innerWidth,h=window.innerHeight;if(!w||!h)return;" +
                "var z=Math.min(h/1440,w/2560);z=Math.max(0.5,Math.min(2,z));" +
                "document.documentElement.style.setProperty('--board-zoom',z.toFixed(3));}" +
                "apply();window.addEventListener('resize',apply);})();",
            }}
          />
        )}
        <Wallpaper enabled={s.appearance.wallpaper} greys={greys} />
        {children}
      </body>
    </html>
  );
}
