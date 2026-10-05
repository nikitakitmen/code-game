'use client';
import { useRef, type ReactNode } from 'react';
import { useWM, type WinState } from './windows';
import { APP_MAP } from './registry';
import { useT } from '@/ui/kit';

export function WindowFrame({ win }: { win: WinState }) {
  const wm = useWM();
  const { t } = useT();
  const def = APP_MAP[win.id];
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const focused = wm.focusedId === win.id;
  if (!def || win.minimized) return null;

  const onTitleDown = (e: React.PointerEvent) => {
    if (win.maximized) return;
    wm.focus(win.id);
    dragRef.current = { dx: e.clientX - win.x, dy: e.clientY - win.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    (e.currentTarget as HTMLElement).classList.add('grabbing');
  };
  const onTitleMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const x = Math.max(-win.w + 80, Math.min(window.innerWidth - 40, e.clientX - dragRef.current.dx));
    const y = Math.max(28, Math.min(window.innerHeight - 30, e.clientY - dragRef.current.dy));
    wm.move(win.id, x, y);
  };
  const onTitleUp = (e: React.PointerEvent) => {
    dragRef.current = null;
    (e.currentTarget as HTMLElement).classList.remove('grabbing');
  };

  const resizeRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const onResizeDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    wm.focus(win.id);
    resizeRef.current = { x: e.clientX, y: e.clientY, w: win.w, h: win.h };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onResizeMove = (e: React.PointerEvent) => {
    if (!resizeRef.current) return;
    wm.resize(win.id, resizeRef.current.w + (e.clientX - resizeRef.current.x), resizeRef.current.h + (e.clientY - resizeRef.current.y));
  };
  const onResizeUp = () => { resizeRef.current = null; };

  const Body: ReactNode = <def.Component arg={win.arg} />;

  return (
    <div
      className={`window ${focused ? 'focused' : ''}`}
      style={{ left: win.x, top: win.y, width: win.w, height: win.h, zIndex: win.z }}
      onMouseDown={() => wm.focus(win.id)}
    >
      <div className="titlebar" onPointerDown={onTitleDown} onPointerMove={onTitleMove} onPointerUp={onTitleUp} onDoubleClick={() => wm.toggleMax(win.id)}>
        <button className="t-btn" title={t('win.close')} onClick={(e) => { e.stopPropagation(); wm.close(win.id); }}>✕</button>
        <button className="t-btn" title={t('win.min')} onClick={(e) => { e.stopPropagation(); wm.minimize(win.id); }}>–</button>
        <span className="t-title">{def.icon} {t(`app.${win.id}`)}</span>
        <button className="t-btn" title={t('win.zoom')} onClick={(e) => { e.stopPropagation(); wm.toggleMax(win.id); }}>▢</button>
      </div>
      <div className="win-body">{Body}</div>
      {!win.maximized && (
        <div className="win-resize" onPointerDown={onResizeDown} onPointerMove={onResizeMove} onPointerUp={onResizeUp} />
      )}
    </div>
  );
}
