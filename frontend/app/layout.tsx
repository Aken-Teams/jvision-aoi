import type { Metadata } from "next";
import "./globals.css";
const runtime = process.env.APP_MODE === "runtime";
export const metadata: Metadata = runtime
  ? { title: "JVision 檢測站", description: "產線檢測操作畫面" }
  : { title: "JVision AOI Studio", description: "工廠內部 AI 視覺檢測工作站" };
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
