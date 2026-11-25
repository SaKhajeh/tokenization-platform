import type { Metadata } from "next";
import "@tp/ui/styles.css";
import "./app.css";
import { Providers } from "./providers";

export const metadata: Metadata = { title: "پنل صندوق — سامانه‌ی تأمین مالی", robots: { index: false, follow: false } };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fa" dir="rtl">
      <body><Providers>{children}</Providers></body>
    </html>
  );
}
