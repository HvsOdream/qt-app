import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const nanum = localFont({
  src: [
    { path: "./fonts/NanumSquareNeoOTF-Lt.otf", weight: "300", style: "normal" },
    { path: "./fonts/NanumSquareNeoOTF-Rg.otf", weight: "400", style: "normal" },
    { path: "./fonts/NanumSquareNeoOTF-Bd.otf", weight: "700", style: "normal" },
  ],
  variable: "--font-nanum",
  display: "swap",
});

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
      <body className={`${nanum.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
