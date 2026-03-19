// ─── 디바이스 ID 관리 ───
// 최초 접속 시 UUID를 생성해 localStorage에 저장하고, 이후 모든 API 요청에 헤더로 실어 보낸다.
// DB에서 device_id 컬럼으로 사용자 데이터를 격리하는 MVP용 방법.

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

/** fetch 공통 헤더에 device_id를 포함한 Headers 객체를 반환 */
export function deviceHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'x-device-id': getDeviceId(),
    ...extra,
  };
}
