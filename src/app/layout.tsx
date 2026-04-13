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
  title: "BloomLens — AI 개인화 학습 도구",
  description: "오답노트가 베이스, 유사문제 생성기가 도구. 서일대학교만의 특별한 AI 학습법.",
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
