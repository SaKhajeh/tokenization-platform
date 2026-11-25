import type { Metadata, Viewport } from "next";
import "@tp/ui/styles.css";
import "./app.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "صندوق پژوهش و فناوری — تأمین مالی و سرمایه‌گذاری",
  description: "سرمایه‌گذاری در طرح‌های ارزیابی‌شده‌ی صندوق و درخواست تأمین مالی",
  manifest: "/manifest.webmanifest",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#0A2A66" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fa" dir="rtl">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
