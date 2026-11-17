import type { Metadata } from 'next';

// 학습실에서 홈 화면에 추가하면 학습실 주소로 바로 열리게 한다
export const metadata: Metadata = {
  title: 'BloomLens 자율 학습실',
  manifest: '/lab.webmanifest',
};

export default function LabLayout({ children }: { children: React.ReactNode }) {
  return children;
}
