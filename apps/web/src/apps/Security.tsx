'use client';
import { useGame } from '@/game/store';
import { useWM } from '@/os/windows';
import { Btn, Panel, useT, Why } from '@/ui/kit';
import { VULNS, type ConfigValue } from '@prod/engine';

export function SecurityApp() {
  const st = useGame();
  const wm = useWM();
  const { t, tr } = useT();
  const w = st.state.world;
  const vulns = st.sim.vulns;
  const setApp = (key: string, value: ConfigValue) => st.dispatch({ type: 'app.set', key, value });

  const securitySettings = st.content.settings.filter((s) => s.area === 'security' && st.state.unlocks.settings.includes(s.key));

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
                <Why node={def.knowledge} />
              </span>
            </div>
          );
        })}
      </Panel>

      {securitySettings.length > 0 && (
        <Panel title="Hardening">
          {securitySettings.map((s) => (
            <SettingRow key={s.key} setting={s} value={w.app[s.key]} onChange={(v) => setApp(s.key, v)} />
          ))}
        </Panel>
      )}

      <Panel title="Access & secrets">
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

function SettingRow({ setting, value, onChange }: { setting: import('@prod/engine').SettingDef; value: ConfigValue; onChange: (v: ConfigValue) => void }) {
  const { tr } = useT();
  return (
    <label className="tiny" title={tr(setting.help)}>
      <div className="spread">
        <span>{tr(setting.label)}</span>
        {setting.type === 'bool' ? (
          <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
        ) : setting.type === 'enum' ? (
          <select value={String(value)} onChange={(e) => { const opt = setting.options!.find((o) => String(o.value) === e.target.value); onChange(opt ? (opt.value as ConfigValue) : e.target.value); }}>
            {setting.options!.map((o) => <option key={String(o.value)} value={String(o.value)}>{tr(o.label)}</option>)}
          </select>
        ) : (
          <input type="number" value={Number(value)} onChange={(e) => onChange(Number(e.target.value))} />
        )}
      </div>
    </label>
  );
}
