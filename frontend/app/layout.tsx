import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "JVision AOI Studio",
  description: "工廠內部 AI 視覺檢測工作站",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
