import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';

export async function DELETE(request: NextRequest) {
  try {
    const deviceId = request.headers.get('x-device-id') || 'unknown';
    const supabase = getServiceClient();

    // 해당 device_id의 데이터만 삭제 (다른 사용자 데이터 보호)
    const { error: e1 } = await supabase
      .from('quiz_results')
      .delete()
      .eq('device_id', deviceId);

    const { error: e2 } = await supabase
      .from('question_bank')
      .delete()
      .eq('device_id', deviceId);

    if (e1 || e2) {
      console.error('reset-db 오류:', e1, e2);
      return NextResponse.json({ error: '초기화 실패' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, message: '데이터 초기화 완료' });
  } catch (err) {
    console.error('reset-db 예외:', err);
    return NextResponse.json({ error: '초기화 오류' }, { status: 500 });
  }
}
