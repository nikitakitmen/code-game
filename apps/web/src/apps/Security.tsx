'use client';
import { useGame } from '@/game/store';
import { useWM } from '@/os/windows';
import { Btn, Panel, useT, Why } from '@/ui/kit';
import { PinBtn } from '@/ui/Pin';
import { SettingsPanel } from '@/ui/Settings';
import { VULNS, pin } from '@prod/engine';

export function SecurityApp() {
  const st = useGame();
  const wm = useWM();
  const { t } = useT();
  const w = st.state.world;
  const vulns = st.sim.vulns;
  const users = w.tables.find((tb) => tb.name === 'users');
  const pwd = users?.columns.find((c) => c.name.startsWith('password'));

  return (
    <div className="col">
      <Panel title={`${t('sec.vulns')} (${vulns.length})`}>
        {vulns.length === 0 && <div className="tiny tag ok">{t('sec.none')}</div>}
        {vulns.map((id) => {
          const def = VULNS.find((v) => v.id === id)!;
          return (
            <div key={id} className="spread" style={{ borderBottom: '1px solid var(--line)', padding: '3px 0' }}>
              <span className="tiny">⚠ {id}</span>
              <span className="row">
                <span className={`tag ${def.severity === 'critical' || def.severity === 'high' ? 'error' : 'warn'}`}>{def.severity}</span>
                <PinBtn token={pin.vuln(id)} />
                <Why node={def.knowledge} />
              </span>
            </div>
          );
        })}
      </Panel>

      {users && pwd && (
        <Panel title={t('sec.passwords')}>
          <div className="spread tiny">
            <span className="mono">{users.name}.{pwd.name}: {String(w.app.passwordStorage ?? 'plaintext')}</span>
            <PinBtn token={pin.column('security', users.name, pwd.name)} />
          </div>
        </Panel>
      )}

      <SettingsPanel app="security" title={t('sec.hardening')} />

      <Panel title={t('sec.access')}>
        <div className="tiny">Admins: {w.security.employees.filter((e) => e.role === 'admin').length} / {w.security.employees.length}</div>
        {w.security.employees.map((e) => (
          <div key={e.id} className="spread tiny">
            <span>{e.name}</span>
            <select value={e.role} onChange={(ev) => st.dispatch({ type: 'security.setRole', employee: e.id, role: ev.target.value })}>
              {w.security.roles.map((r) => <option key={r.id} value={r.id}>{r.id}</option>)}
            </select>
          </div>
        ))}
        {w.security.secrets.map((s) => (
          <div key={s.id} className="spread tiny">
            <span>{s.name} {s.inGitHistory ? '⚠ in git' : ''} {s.rotatedAt ? '✓ rotated' : ''}</span>
            <Btn sm onClick={() => st.dispatch({ type: 'security.rotateSecret', id: s.id })}>rotate</Btn>
          </div>
        ))}
        {w.security.deps.map((d) => (
          <div key={d.name} className="spread tiny">
            <span>{d.name}@{d.version} {d.cve ? '⚠ CVE' : ''}</span>
            {d.cve && <Btn sm onClick={() => st.dispatch({ type: 'security.upgradeDep', name: d.name })}>upgrade</Btn>}
          </div>
        ))}
      </Panel>

      {st.state.unlocks.apps.includes('attacklab') && <Btn onClick={() => wm.open('attacklab')}>☠ {t('app.attacklab')}</Btn>}
    </div>
  );
}
