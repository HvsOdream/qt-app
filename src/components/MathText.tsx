// 수식이 섞인 문제 글 표시: 부등호를 정리하고 홀로 쓰인 영문자만 기울인다
import React from 'react';

export default function MathText({ text, className = '' }: { text: string; className?: string }) {
  const processed = text
    .replace(/>=|≥/g, '≥')
    .replace(/<=|≤/g, '≤')
    .replace(/(?<![<\w])<(?![<=\w])/g, '＜')
    .replace(/(?<![<\w])>(?![>=\w])/g, '＞');

  const parts = processed.split(/(?<![a-zA-Z가-힣0-9])([a-zA-Z])(?=[^a-zA-Z가-힣]|$)/g);
  const elements: React.ReactNode[] = [];
  parts.forEach((part, i) => {
    if (part && /^[a-zA-Z]$/.test(part)) {
      elements.push(
        <span key={i} style={{ fontStyle: 'italic', fontFamily: 'Georgia, "Times New Roman", serif' }}>
          {part}
        </span>
      );
    } else if (part) {
      elements.push(<span key={i}>{part}</span>);
    }
  });
  return <span className={className}>{elements}</span>;
}
