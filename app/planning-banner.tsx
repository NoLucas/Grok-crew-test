'use client';

import Link from 'next/link';
import { useLanguage } from './language';

export function PlanningBanner({ current }: { current: string }) {
  const { t } = useLanguage();
  const liveHere = current === 'production' || current === 'bots';
  return (
    <aside className={`planning-banner${liveHere ? ' live' : ''}`} role="note">
      <div>
        <b>{t('데스크톱이 기본 작업 공간입니다', 'Desktop is the default workspace', '桌面是默认工作区', 'デスクトップが基本の作業空間です')}</b>
        <p>
          {liveHere
            ? t(
                '이 페이지에서도 렌더나 봇 기록이 되지만, 타임라인 편집과 Instagram·TikTok·YouTube 게시는 데스크톱에서 하세요.',
                'This page can still render or record bots, but timeline edits and Instagram, TikTok, and YouTube publishing belong on Desktop.',
                '此页面仍可渲染或记录机器人，但时间线编辑以及 Instagram、TikTok、YouTube 发布请使用桌面。',
                'このページでもレンダーやボット記録はできますが、タイムライン編集と Instagram・TikTok・YouTube 公開はデスクトップで行ってください。',
              )
            : t(
                '이 페이지는 기획·미리보기입니다. 실제 편집, 렌더, 게시는 데스크톱에서 합니다.',
                'This page is for planning and preview. Real edits, renders, and publishes happen on Desktop.',
                '此页面用于策划和预览。真正的编辑、渲染和发布在桌面进行。',
                'このページは企画とプレビューです。実際の編集・レンダー・公開はデスクトップで行います。',
              )}
        </p>
      </div>
      <Link href="/">{t('데스크톱 열기', 'Open Desktop', '打开桌面', 'デスクトップを開く')}</Link>
    </aside>
  );
}
