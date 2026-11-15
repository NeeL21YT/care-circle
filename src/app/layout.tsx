import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AnnouncerProvider } from "@/components/a11y/announcer";
import { DISPLAY_BOOT_SCRIPT, DisplaySettingsProvider } from "@/components/a11y/display-settings";
import { RouteFocus } from "@/components/a11y/route-focus";

export const metadata: Metadata = {
  title: { default: "Care Circle", template: "%s · Care Circle" },
  description: "Medication reminders, appointments and care coordination for older adults and the people who support them.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Never block pinch-zoom: low-vision users rely on it (WCAG 1.4.4 / 1.4.10).
  themeColor: "#0b6b63",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: DISPLAY_BOOT_SCRIPT }} />
      </head>
      {/* suppressHydrationWarning: browser extensions (e.g. ColorZilla) inject attributes into <body>. */}
      <body className="min-h-dvh" suppressHydrationWarning>
        <a href="#main-content" className="sr-only sr-only-focusable rounded-xl bg-primary font-bold text-primary-foreground">
          Skip to main content
        </a>
        <DisplaySettingsProvider>
          <AnnouncerProvider>
            <RouteFocus />
            {children}
          </AnnouncerProvider>
        </DisplaySettingsProvider>
      </body>
    </html>
  );
}
