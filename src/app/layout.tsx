import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BloomLens — AI 개인화 학습 도구",
  description: "센서인은 BloomLens로 성장한다. 시험지를 찍으면 AI 개인화 학습 도구가 도와줘요.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "BloomLens",
  },
};

export const viewport: Viewport = {
  themeColor: "#0a2265",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <head>
        <link
          href="https://hangeul.pstatic.net/hangeul_static/css/nanum-square-neo.css"
          rel="stylesheet"
        />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
      </head>
      <body className="antialiased" style={{ fontFamily: "'NanumSquareNeo', sans-serif" }}>
        {children}
      </body>
    </html>
  );
}
