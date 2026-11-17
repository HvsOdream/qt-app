'use client';

// 「홈 화면에 추가」 안내 팝업
// 휴대폰 브라우저로 들어왔고 아직 홈 화면 앱으로 열지 않았을 때만 뜬다.
// 안드로이드 크롬은 설치 창을 바로 띄우고, 아이폰은 방법을 그림 순서로 안내한다.
import { useEffect, useState } from 'react';

interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const KEY = 'a2hs_later_at';
const AGAIN_AFTER_MS = 24 * 60 * 60 * 1000; // 「나중에」를 누르면 하루 뒤에 다시 안내
const NAVY = '#1B3F8B';
const SUB = '#5B6B8C';

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(display-mode: standalone)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

type Kind = 'ios' | 'android' | 'inapp';

export default function InstallPrompt({ subtitle }: { subtitle?: string }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>('android');
  const [installEvent, setInstallEvent] = useState<InstallEvent | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onPrompt = (e: Event) => { e.preventDefault(); setInstallEvent(e as InstallEvent); };
    const onInstalled = () => setOpen(false);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);

    const ua = navigator.userAgent;
    const forced = new URLSearchParams(window.location.search).get('a2hs') === '1'; // 화면 확인용
    const isIos = /iPhone|iPad|iPod/.test(ua);
    const isAndroid = /Android/.test(ua);
    const inApp = /KAKAOTALK|NAVER\(|Instagram|FBAN|FBAV|Line\//.test(ua);
    let later = 0;
    try { later = Number(localStorage.getItem(KEY) || 0); } catch { /* 저장소 사용 불가 */ }

    const timer = setTimeout(() => {
      setKind(inApp ? 'inapp' : isIos ? 'ios' : 'android');
      if (forced || ((isIos || isAndroid) && !isStandalone() && Date.now() - later > AGAIN_AFTER_MS)) setOpen(true);
    }, 0);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (!open) return null;

  const later = () => {
    try { localStorage.setItem(KEY, String(Date.now())); } catch { /* 저장소 사용 불가 */ }
    setOpen(false);
  };
  const install = async () => {
    if (!installEvent) return;
    await installEvent.prompt();
    const choice = await installEvent.userChoice.catch(() => null);
    setInstallEvent(null);
    if (choice?.outcome === 'accepted') setOpen(false);
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(window.location.href.replace(/[?&]a2hs=1/, '')); setCopied(true); } catch { /* 복사 불가 */ }
  };

  const steps: Record<Kind, string[]> = {
    ios: ['화면 아래 가운데의 공유 단추(네모에서 화살표가 올라가는 모양)를 눌러요', '목록을 내려 「홈 화면에 추가」를 눌러요', '오른쪽 위 「추가」를 누르면 끝이에요'],
    android: ['오른쪽 위 점 세 개(⋮) 메뉴를 눌러요', '「홈 화면에 추가」 또는 「앱 설치」를 눌러요', '「추가」를 누르면 끝이에요'],
    inapp: ['지금은 다른 앱 안에서 열려 있어서 추가할 수 없어요', '아래 단추로 주소를 복사해요', '사파리(아이폰)나 크롬(갤럭시)에 붙여 넣어 다시 열어 주세요'],
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-labelledby="a2hs-title"
      style={{ background: 'rgba(22,33,58,0.55)' }}>
      <div className="w-full max-w-[430px] bg-white rounded-t-[24px] sm:rounded-[24px] px-5 pt-6 pb-7 flex flex-col gap-4" style={{ color: '#16213A' }}>
        <div className="flex items-center gap-3.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon-192.png" alt="" width={56} height={56} className="rounded-[14px] shrink-0" />
          <div className="flex flex-col gap-0.5">
            <div id="a2hs-title" className="text-[19px] font-extrabold leading-snug">홈 화면에 추가해 주세요</div>
            <div className="text-[13px]" style={{ color: SUB }}>{subtitle || '앱처럼 한 번에 열리고, 화면을 넓게 쓸 수 있어요'}</div>
          </div>
        </div>

        <ol className="flex flex-col gap-2.5 rounded-[16px] p-4" style={{ background: '#F4F6FA' }}>
          {steps[kind].map((t, i) => (
            <li key={i} className="flex gap-3 items-start text-[14px] leading-relaxed">
              <span className="w-6 h-6 rounded-full text-white text-xs font-bold flex items-center justify-center shrink-0 mt-0.5" style={{ background: NAVY }}>{i + 1}</span>
              <span>{t}</span>
            </li>
          ))}
        </ol>

        <div className="flex flex-col gap-2">
          {kind === 'android' && installEvent && (
            <button type="button" onClick={install} className="h-14 rounded-[14px] text-white text-base font-bold" style={{ background: NAVY }}>
              홈 화면에 추가
            </button>
          )}
          {kind === 'inapp' && (
            <button type="button" onClick={copy} className="h-14 rounded-[14px] text-white text-base font-bold" style={{ background: NAVY }}>
              {copied ? '주소를 복사했어요' : '주소 복사'}
            </button>
          )}
          {!(kind === 'android' && installEvent) && kind !== 'inapp' && (
            <button type="button" onClick={() => setOpen(false)} className="h-14 rounded-[14px] text-white text-base font-bold" style={{ background: NAVY }}>
              추가했어요
            </button>
          )}
          <button type="button" onClick={later} className="h-11 rounded-[14px] text-[15px] font-bold" style={{ color: NAVY }}>나중에 할게요</button>
        </div>
      </div>
    </div>
  );
}
