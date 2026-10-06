import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { useGame } from '@/game/store';
import { Modals } from '@/os/Modals';
import { MenuBar } from '@/os/MenuBar';

/**
 * A fake backend with the real revision rule: PUT /save is rejected (409) unless its
 * base_revision matches the stored one. Registration copies the guest save into a fresh
 * account profile, which starts its own revision sequence.
 */
function fakeServer() {
  const server = { save: null as { state: unknown; revision: number } | null, puts: [] as number[] };
  // @ts-expect-error test stub
  global.fetch = async (url: string, init: RequestInit = {}) => {
    const path = String(url).replace(/^.*\/api\/v1/, '');
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
    if (method === 'POST' && path === '/auth/register') {
      server.save = { state: useGame.getState().state, revision: 1 };
      return json(201, { token: 'test-token', user: { id: 1, email: body.email, locale: 'en' } });
    }
    if (method === 'POST' && path === '/auth/logout') {
      server.save = null; // the next requests come from a new, empty guest profile
      return json(200, { ok: true });
    }
    if (method === 'POST' && path === '/guest') return json(201, { guest_token: 'new-guest', guest_uuid: 'u', profile_id: 2 });
    if (method === 'GET' && path === '/save') return json(200, { save: server.save });
    if (method === 'PUT' && path === '/save') {
      server.puts.push(body.base_revision);
      if (server.save && body.base_revision !== server.save.revision) return json(409, { message: 'Save conflict' });
      server.save = { state: body.state, revision: (server.save?.revision ?? 0) + 1 };
      return json(200, { save: { revision: server.save.revision } });
    }
    return json(200, {});
  };
  return server;
}

beforeEach(() => {
  cleanup();
  localStorage.clear();
  useGame.getState().resetGame();
});

describe('guest → account', () => {
  it('registering keeps progress and the first account save is accepted (no stale guest revision)', async () => {
    const server = fakeServer();
    localStorage.setItem('prod.guestToken', 'guest-token');
    useGame.getState().dispatch({ type: 'company.setName', name: 'Guest Shop' });
    useGame.setState({ revision: 7 }); // the guest profile's last saved revision

    useGame.getState().openModal({ kind: 'auth' });
    render(<Modals />);
    const [email, password] = [document.querySelector('input[type=email]')!, document.querySelector('input[type=password]')!];
    fireEvent.change(email, { target: { value: 'player@example.test' } });
    fireEvent.change(password, { target: { value: 'test-password' } });
    fireEvent.click(screen.getAllByText('Create account').at(-1)!);

    await waitFor(() => expect(useGame.getState().saveStatus).toBe('saved'));
    expect(useGame.getState().authed).toBe(true);
    expect(server.puts).toEqual([1]);
    expect(useGame.getState().revision).toBe(2);
    expect(useGame.getState().state.company.name).toBe('Guest Shop');
    expect(localStorage.getItem('prod.guestToken')).toBeNull();
  });

  it('logging out continues as a fresh guest profile instead of a tokenless "saved" session', async () => {
    fakeServer();
    localStorage.setItem('prod.authToken', 'test-token');
    useGame.setState({ authed: true, saveStatus: 'saved', revision: 3 });
    render(<MenuBar />);
    fireEvent.click(screen.getAllByText('PROD').find((el) => el.classList.contains('menu-item'))!);
    fireEvent.click(screen.getByText('Log out'));

    await waitFor(() => expect(localStorage.getItem('prod.guestToken')).toBe('new-guest'));
    await waitFor(() => expect(useGame.getState().saveStatus).toBe('local'));
    expect(useGame.getState().authed).toBe(false);
    expect(localStorage.getItem('prod.authToken')).toBeNull();
  });
});
