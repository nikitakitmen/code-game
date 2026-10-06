import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { useGame } from '@/game/store';
import { useWM, onAppOpened } from '@/os/windows';
import { Desktop } from '@/os/Desktop';
import { MailApp } from '@/apps/Mail';

beforeEach(() => {
  cleanup();
  // @ts-expect-error test stub: no backend in jsdom
  global.fetch = () => Promise.reject(new Error('offline'));
  useWM.setState({ windows: [], focusedId: null, topZ: 10 });
  useGame.getState().resetGame();
});

describe('PROD OS window launches reach the game (app.open bridge)', () => {
  it('opening any app window records app.open for that canonical app id', () => {
    for (const id of ['project', 'mail', 'browser', 'files', 'terminal', 'help']) {
      act(() => useWM.getState().open(id));
      expect(useGame.getState().state.openedApps).toContain(id);
      expect(useGame.getState().facts[`app.opened.${id}`]).toBe(true);
    }
  });

  it('only a closed → open transition is a launch: focus and restore are not', () => {
    const launches: string[] = [];
    const off = onAppOpened((id) => launches.push(id));
    const wm = () => useWM.getState();
    act(() => wm().open('project'));
    act(() => wm().focus('project'));
    act(() => wm().open('project')); // already open → focus only
    act(() => wm().minimize('project'));
    act(() => wm().open('project')); // restore from minimize
    expect(launches).toEqual(['project']);
    act(() => wm().close('project'));
    act(() => wm().open('project')); // closed → open again
    expect(launches).toEqual(['project', 'project']);
    off();
  });

  it('m001 is completed with the mouse: double-click Project, read the mail, complete', () => {
    const g = () => useGame.getState();
    g().dispatch({ type: 'company.setName', name: 'UI Shop' });
    g().startCurrentMission();
    expect(g().state.campaign.active?.id).toBe('m001');
    expect(g().facts['app.opened.project']).toBeUndefined();

    render(<Desktop />);
    // the real desktop icon → Window Manager → app.open → Game Store
    const icon = screen.getAllByText('Project').find((el) => el.classList.contains('dicon-label'))!;
    fireEvent.doubleClick(icon.parentElement!);
    expect(useWM.getState().windows.some((w) => w.id === 'project')).toBe(true);
    expect(g().state.openedApps).toContain('project');

    // read the trigger mail in the Mail app
    cleanup();
    render(<MailApp />);
    const trigger = g().state.mail.find((m) => m.id === 'm001-t')!;
    fireEvent.click(screen.getAllByText(trigger.subject.en)[0]);
    expect(g().state.mail.find((m) => m.id === 'm001-t')?.read).toBe(true);

    // the mission dock now offers completion
    cleanup();
    render(<Desktop />);
    act(() => g().runSim());
    expect(g().objectives().every((o) => o.met)).toBe(true);
    fireEvent.click(screen.getByText('Complete mission'));
    expect(g().state.campaign.completed['m001']).toBeTruthy();
    expect(g().state.campaign.currentMissionId).toBe('m002');
  });

  it('the – button minimizes a window without crashing the desktop, and it can be restored', () => {
    useGame.getState().dispatch({ type: 'company.setName', name: 'UI Shop' });
    render(<Desktop />);
    act(() => useWM.getState().open('project'));
    fireEvent.click(screen.getAllByTitle('Minimize').at(-1)!);
    expect(useWM.getState().windows.find((w) => w.id === 'project')?.minimized).toBe(true);
    act(() => useWM.getState().open('project'));
    expect(useWM.getState().windows.find((w) => w.id === 'project')?.minimized).toBe(false);
    expect(screen.getAllByTitle('Minimize').length).toBeGreaterThan(0);
  });
});
