'use client';
import { useGame } from '@/game/store';
import { useT } from '@/ui/kit';
import { sameToken, type EvidenceToken } from '@prod/engine';

/** "📌 Pin as evidence" for something an app shows; visible while a mission is being investigated. */
export function PinBtn({ token }: { token: EvidenceToken }) {
  const st = useGame();
  const { t } = useT();
  const active = st.state.campaign.active;
  if (!active) return null;
  const pinned = active.pinned.some((p) => sameToken(p, token));
  return (
    <button
      className={`btn sm ${pinned ? 'primary' : ''}`}
      title={pinned ? t('common.pinned') : t('common.pin')}
      data-pin={`${token.app}:${token.kind}:${token.key}`}
      disabled={pinned}
      onClick={(e) => {
        e.stopPropagation();
        st.dispatch({ type: 'mission.pin', token });
      }}
    >
      📌
    </button>
  );
}
