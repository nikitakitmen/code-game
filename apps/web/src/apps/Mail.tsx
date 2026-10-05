'use client';
import { useState } from 'react';
import { useGame } from '@/game/store';
import { Btn, Empty, useT } from '@/ui/kit';
import { clockParts } from '@prod/engine';

export function MailApp() {
  const st = useGame();
  const { t, tr } = useT();
  const mail = [...st.state.mail].reverse();
  const [openId, setOpenId] = useState<string | null>(mail[0]?.id ?? null);
  const current = mail.find((m) => m.id === openId);
  const npc = (id: string) => st.content.npcs.find((n) => n.id === id);

  const markRead = (id: string) => {
    setOpenId(id);
    if (!st.state.mail.find((m) => m.id === id)?.read) st.dispatch({ type: 'mail.read', id });
  };

  return (
    <div style={{ display: 'flex', height: '100%', gap: 0 }}>
      <div style={{ width: 200, borderRight: '2px solid var(--line)', overflow: 'auto', flex: 'none' }}>
        <div className="tiny muted" style={{ padding: 4 }}>{t('mail.inbox')} ({st.state.mail.filter((m) => !m.read).length})</div>
        {mail.length === 0 && <Empty>{t('mail.empty')}</Empty>}
        {mail.map((m) => {
          const n = npc(m.from);
          return (
            <div key={m.id} onClick={() => markRead(m.id)} style={{ padding: '4px 6px', cursor: 'pointer', borderBottom: '1px solid var(--line)', background: openId === m.id ? 'var(--accent)' : m.read ? 'transparent' : 'var(--paper-2)', color: openId === m.id ? 'var(--accent-ink)' : 'inherit' }}>
              <div className="tiny" style={{ fontWeight: m.read ? 400 : 700 }}>{n ? tr(n.name) : m.from}</div>
              <div className="tiny" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tr(m.subject)}</div>
            </div>
          );
        })}
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 10 }}>
        {current ? <MailBody id={current.id} /> : <Empty>{t('mail.empty')}</Empty>}
      </div>
    </div>
  );
}

function MailBody({ id }: { id: string }) {
  const st = useGame();
  const { t, tr } = useT();
  const m = st.state.mail.find((x) => x.id === id)!;
  const npc = st.content.npcs.find((n) => n.id === m.from);
  const mission = m.missionId ? st.content.missions[m.missionId] : undefined;
  const dlg = mission?.dialogue?.find((d) => d.id === m.dialogue);
  const active = st.state.campaign.active;
  const answered = m.dialogue && active?.choices?.[m.dialogue];
  const cp = clockParts(m.at);

  return (
    <div className="col">
      <div className="spread">
        <h2 style={{ margin: 0 }}>{tr(m.subject)}</h2>
        <span className="tiny muted">D{cp.day} {cp.hhmm}</span>
      </div>
      <div className="tiny muted">{t('mail.from')}: {npc ? `${tr(npc.name)} — ${tr(npc.role)}` : m.from}</div>
      <hr />
      <div className="small" style={{ whiteSpace: 'pre-wrap' }}>{tr(m.body)}</div>
      {npc?.signature && <div className="tiny muted" style={{ marginTop: 8 }}>{tr(npc.signature)}</div>}
      {dlg && !answered && (
        <div className="panel" style={{ marginTop: 10 }}>
          <div className="tiny muted">{tr(dlg.text)}</div>
          <div className="col" style={{ marginTop: 6 }}>
            {dlg.choices.map((c) => (
              <Btn key={c.id} sm onClick={() => st.dialogue(dlg.id, c.id)}>{tr(c.text)}</Btn>
            ))}
          </div>
        </div>
      )}
      {dlg && answered && (
        <div className="tiny" style={{ marginTop: 8 }}>→ {tr(dlg.choices.find((c) => c.id === answered)?.text)}</div>
      )}
    </div>
  );
}
