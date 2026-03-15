import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "QT 큐티 — AI 과학 문제 생성기",
  description: "중학교 2학년 과학 AI 문제 생성 서비스",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
