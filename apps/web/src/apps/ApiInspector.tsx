'use client';
import { useState } from 'react';
import { useGame } from '@/game/store';
import { Btn, Empty, Panel, useT } from '@/ui/kit';
import { SettingsPanel } from '@/ui/Settings';
import { callApi, type ApiRequest, type HttpMethod } from '@prod/engine';

export function ApiApp() {
  const st = useGame();
  const { t, tr } = useT();
  // every server endpoint can be called; JSON APIs first
  const apiEps = st.state.world.endpoints.filter((e) => !e.disabled && e.target === 'backend').sort((a, b) => Number(!!b.api) - Number(!!a.api));
  const [method, setMethod] = useState<HttpMethod>('GET');
  const [path, setPath] = useState(apiEps[0]?.path ?? '/api/v1/products');
  const [auth, setAuth] = useState<ApiRequest['auth']>('none');
  const [body, setBody] = useState<ApiRequest['body']>('none');
  const [origin, setOrigin] = useState<'same' | 'other'>('same');
  const [res, setRes] = useState<ReturnType<typeof callApi> | null>(null);

  if (!st.state.unlocks.apps.includes('api')) return <Empty>{t('common.locked')}</Empty>;

  const send = () => {
    const r = callApi(st.state, st.content, st.sim, { method, path, auth, body, origin });
    setRes(r);
    if (r.pin && st.state.campaign.active) st.dispatch({ type: 'mission.pin', token: r.pin });
  };

  return (
    <div className="col">
      <Panel>
        <div className="row wrap">
          <select value={method} onChange={(e) => setMethod(e.target.value as HttpMethod)}>
            {(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as HttpMethod[]).map((m) => <option key={m}>{m}</option>)}
          </select>
          <input style={{ flex: 1, minWidth: 180 }} value={path} onChange={(e) => setPath(e.target.value)} />
          <Btn primary onClick={send}>Send</Btn>
        </div>
        <div className="row wrap tiny" style={{ marginTop: 6 }}>
          <label>auth <select value={auth} onChange={(e) => setAuth(e.target.value as ApiRequest['auth'])}>{['none', 'user', 'admin', 'other-user'].map((a) => <option key={a}>{a}</option>)}</select></label>
          <label>body <select value={body} onChange={(e) => setBody(e.target.value as ApiRequest['body'])}>{['none', 'valid', 'invalid', 'malicious'].map((a) => <option key={a}>{a}</option>)}</select></label>
          <label>origin <select value={origin} onChange={(e) => setOrigin(e.target.value as 'same' | 'other')}>{['same', 'other'].map((a) => <option key={a}>{a}</option>)}</select></label>
        </div>
        <div className="row wrap tiny" style={{ marginTop: 4 }}>
          {apiEps.map((e) => <Btn key={e.id} sm onClick={() => { setMethod(e.method); setPath(e.path); }}>{e.method} {e.path}</Btn>)}
        </div>
      </Panel>
      {res && (
        <Panel title="Response">
          <div className="spread"><span className={`tag ${res.status >= 500 ? 'error' : res.status >= 400 ? 'warn' : 'ok'}`}>{res.status} {res.statusText}</span></div>
          <div className="tiny mono">{Object.entries(res.headers).map(([k, v]) => `${k}: ${v}`).join('\n')}</div>
          <pre className="panel inset mono tiny" style={{ whiteSpace: 'pre-wrap' }}>{res.body}</pre>
          {res.notes.map((n) => <div key={n} className="tag warn tiny" style={{ marginTop: 4 }}>{apiNote(n, tr)}</div>)}
        </Panel>
      )}
      <SettingsPanel app="api" />
    </div>
  );
}

function apiNote(key: string, tr: (x: { en: string; ru: string }) => string): string {
  const NOTES: Record<string, { en: string; ru: string }> = {
    'api.note.always200': { en: '⚠ Returned 200 while hiding an error in the body — clients can’t branch on it.', ru: '⚠ Вернулось 200 с ошибкой в теле — клиент не может ветвиться.' },
    'api.note.corsMissing': { en: '⚠ No CORS header — a browser would block this cross-origin call.', ru: '⚠ Нет заголовка CORS — браузер заблокирует межоригинный вызов.' },
    'api.note.corsWildcardCredentials': { en: '⚠ Wildcard CORS with credentials is refused by browsers.', ru: '⚠ CORS * с учётными данными браузер отвергает.' },
    'api.note.noRoleCheck': { en: '⚠ Admin action with no role check (broken access control).', ru: '⚠ Админ-действие без проверки роли (сломанный доступ).' },
    'api.note.idor': { en: "⚠ IDOR: returned another user's object.", ru: '⚠ IDOR: вернулся чужой объект.' },
    'api.note.noValidation': { en: '⚠ Invalid input accepted (no validation).', ru: '⚠ Невалидный ввод принят (нет валидации).' },
    'api.note.sqli': { en: '⚠ SQL injection: the input leaked other rows.', ru: '⚠ SQL-инъекция: ввод вытащил чужие строки.' },
    'api.note.xssStored': { en: '⚠ Stored unescaped — XSS will run in viewers’ browsers.', ru: '⚠ Сохранено без экранирования — XSS выполнится у посетителей.' },
    'api.note.escaped': { en: '✓ Content escaped on output.', ru: '✓ Контент экранирован при выводе.' },
    'api.note.breaking': { en: '⚠ Field renamed vs the v1 contract — old clients break.', ru: '⚠ Поле переименовано относительно v1 — старые клиенты ломаются.' },
  };
  return NOTES[key] ? tr(NOTES[key]) : key;
}
