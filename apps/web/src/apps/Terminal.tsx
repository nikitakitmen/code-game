'use client';
import { useEffect, useRef, useState } from 'react';
import { useGame } from '@/game/store';
import { Btn, useT } from '@/ui/kit';
import { runCommand } from '@prod/engine';

interface Line { text: string; cls?: string; }

export function TerminalApp() {
  const st = useGame();
  const { t } = useT();
  const [lines, setLines] = useState<Line[]>([{ text: 'PROD-sh — simulated shell. Type "help".', cls: 'muted' }]);
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [hIdx, setHIdx] = useState(-1);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView(); }, [lines]);

  const commands = st.content.commands.filter((c) => st.state.unlocks.commands.includes(c.id));

  const run = (cmd: string) => {
    if (!cmd.trim()) return;
    const prompt = `${st.state.company.domain ?? 'prod'}:~$ ${cmd}`;
    const out = runCommand(cmd, st.state, st.content, st.sim);
    if (out.lines[0] === '\u001bclear') {
      setLines([]);
      setInput('');
      return;
    }
    const newLines: Line[] = [{ text: prompt, cls: 'mono' }, ...out.lines.map((l) => ({ text: l, cls: out.error ? 'tag error' : 'mono tiny' }))];
    setLines((prev) => [...prev, ...newLines]);
    setHistory((h) => [...h, cmd]);
    setHIdx(-1);
    setInput('');
    // pinning as evidence
    if (out.pin && st.state.campaign.active) {
      st.dispatch({ type: 'mission.pin', token: out.pin });
    }
  };

  return (
    <div className="col" style={{ height: '100%', fontFamily: 'var(--mono)' }}>
      <div className="panel inset" style={{ flex: 1, overflow: 'auto', background: '#101317', color: '#cfe3d0', fontSize: 13 }}>
        {lines.map((l, i) => (
          <div key={i} className={l.cls} style={{ color: l.cls?.includes('error') ? '#ef6b63' : l.cls === 'muted' ? '#7f8aa0' : '#cfe3d0', whiteSpace: 'pre-wrap' }}>{l.text}</div>
        ))}
        <div ref={endRef} />
      </div>
      <div className="row">
        <span className="tiny mono">$</span>
        <input
          style={{ flex: 1 }}
          value={input}
          autoFocus
          placeholder={t('term.hint')}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') run(input);
            else if (e.key === 'ArrowUp') { const i = Math.min(history.length - 1, hIdx + 1); if (history[history.length - 1 - i]) { setHIdx(i); setInput(history[history.length - 1 - i]); } }
            else if (e.key === 'ArrowDown') { const i = Math.max(-1, hIdx - 1); setHIdx(i); setInput(i < 0 ? '' : history[history.length - 1 - i]); }
          }}
        />
      </div>
      <div className="row wrap tiny">
        {commands.slice(0, 10).flatMap((c) => c.examples.slice(0, 1)).map((ex) => (
          <Btn key={ex} sm onClick={() => run(ex)}>{ex}</Btn>
        ))}
      </div>
    </div>
  );
}
