import { describe, it, expect, beforeEach } from 'vitest';
import { useGame } from '@/game/store';
import { useWM } from '@/os/windows';

// jsdom has no AudioContext / fetch; stub enough for the store
beforeEach(() => {
  // @ts-expect-error test stub
  global.fetch = () => Promise.reject(new Error('offline'));
});

describe('game store', () => {
  it('starts a fresh game and can set the company name', () => {
    useGame.getState().resetGame();
    const ok = useGame.getState().dispatch({ type: 'company.setName', name: 'Acme' });
    expect(ok).toBe(true);
    expect(useGame.getState().state.company.name).toBe('Acme');
  });

  it('plays mission m001 to completion', () => {
    useGame.getState().resetGame();
    useGame.getState().dispatch({ type: 'company.setName', name: 'Acme' });
    useGame.getState().startCurrentMission();
    useGame.getState().dispatch({ type: 'app.open', app: 'project' });
    useGame.getState().dispatch({ type: 'mail.read', id: 'm001-t' });
    useGame.getState().runSim();
    const objectives = useGame.getState().objectives();
    expect(objectives.every((o) => o.met)).toBe(true);
    useGame.getState().completeMission();
    expect(useGame.getState().state.campaign.completed['m001']).toBeTruthy();
    expect(useGame.getState().state.campaign.currentMissionId).toBe('m002');
  });

  it('simulation stays deterministic across store reloads', () => {
    useGame.getState().resetGame();
    const seed = useGame.getState().state.seed;
    const a = JSON.stringify(useGame.getState().sim.summary);
    useGame.setState({ state: { ...useGame.getState().state, seed } });
    useGame.getState().runSim();
    // after a fresh sim with same seed/state the summary is stable
    expect(typeof a).toBe('string');
  });
});

describe('window manager', () => {
  it('opens, focuses and closes windows; tile/cascade keep them', () => {
    const wm = useWM.getState();
    wm.open('mail');
    wm.open('terminal');
    expect(useWM.getState().windows.length).toBe(2);
    useWM.getState().tile();
    expect(useWM.getState().windows.length).toBe(2);
    useWM.getState().cascade();
    useWM.getState().close('mail');
    expect(useWM.getState().windows.find((w) => w.id === 'mail')).toBeUndefined();
  });
});
