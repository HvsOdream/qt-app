// ─── 디바이스/유저 ID 관리 ───
// 로그인된 경우 user.id를 우선 사용, 미로그인 시 임시 UUID
const DEVICE_ID_KEY = 'qt_device_id';

export function getDeviceId(): string {
  if (typeof window === 'undefined') return '';
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

/** 로그인 성공 시 user.id로 device_id를 교체 */
export function setDeviceIdFromUser(userId: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(DEVICE_ID_KEY, userId);
}

/** 로그아웃 시 device_id 초기화 */
export function clearDeviceId(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(DEVICE_ID_KEY);
}

/** fetch 공통 헤더 */
export function deviceHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'x-device-id': getDeviceId(),
    ...extra,
  };
}
