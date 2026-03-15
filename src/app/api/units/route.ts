import { NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';

export async function GET() {
  try {
    const supabase = getServiceClient();

    // 대단원 → 중단원 → 소단원 트리 구조로 조회
    const { data: units, error } = await supabase
      .from('units')
      .select('*')
      .order('level', { ascending: true })
      .order('sort_order', { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // 트리 구조로 변환
    const level1 = units.filter((u) => u.level === 1);
    const level2 = units.filter((u) => u.level === 2);
    const level3 = units.filter((u) => u.level === 3);

    const tree = level1.map((l1) => ({
      ...l1,
      children: level2
        .filter((l2) => l2.parent_id === l1.id)
        .map((l2) => ({
          ...l2,
          children: level3.filter((l3) => l3.parent_id === l2.id),
        })),
    }));

    return NextResponse.json({ units: tree });
  } catch (error) {
    console.error('단원 조회 오류:', error);
    return NextResponse.json(
      { error: '단원 목록을 가져오는 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
