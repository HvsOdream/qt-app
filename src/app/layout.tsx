import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "QT 큐티 — AI 오답 튜터",
  description: "틀린 문제 찍으면 유사 문제 생성 + 해설 + 오답 분석",
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
