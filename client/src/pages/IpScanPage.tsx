import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { IpScanHost, IpScanResult, NetInterface } from '../types';

type Filter = 'all' | 'free' | 'busy';

function CopyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect
        x="8"
        y="8"
        width="11"
        height="13"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <path
        d="M5 16V6.5A1.5 1.5 0 0 1 6.5 5H15"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

async function copyText(text: string) {
  await navigator.clipboard.writeText(text);
}

export function IpScanPage() {
  const [ifaces, setIfaces] = useState<NetInterface[]>([]);
  const [ifaceKey, setIfaceKey] = useState('');
  const [cidr, setCidr] = useState('');
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [result, setResult] = useState<IpScanResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .listNetworkInterfaces()
      .then((data) => {
        if (cancelled) return;
        setIfaces(data.interfaces);
        const first = data.interfaces[0];
        if (first) {
          setIfaceKey(`${first.name}|${first.address}`);
          setCidr(first.cidr);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Не удалось получить интерфейсы');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = useMemo(() => {
    const hosts = result?.hosts || [];
    if (filter === 'free') return hosts.filter((h) => h.status === 'free');
    if (filter === 'busy') return hosts.filter((h) => h.status === 'busy');
    return hosts;
  }, [result, filter]);

  function onIfaceChange(value: string) {
    setIfaceKey(value);
    const found = ifaces.find((item) => `${item.name}|${item.address}` === value);
    if (found) setCidr(found.cidr);
  }

  async function flashCopied(label: string) {
    setCopied(label);
    window.setTimeout(() => setCopied(''), 1600);
  }

  async function runScan() {
    setError('');
    setScanning(true);
    try {
      const data = await api.scanSubnet(cidr.trim());
      setResult(data);
      setFilter('all');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка сканирования');
    } finally {
      setScanning(false);
    }
  }

  async function copyIp(host: IpScanHost) {
    await copyText(host.ip);
    await flashCopied(host.ip);
  }

  async function copyFree() {
    const list = (result?.hosts || [])
      .filter((h) => h.status === 'free')
      .map((h) => h.ip)
      .join('\n');
    if (!list) return;
    await copyText(list);
    await flashCopied('свободные адреса');
  }

  return (
    <div className="page page--wide">
      <div className="page-hero">
        <div className="page-hero-row">
          <Link className="page-back" to="/extras" title="Назад" aria-label="Назад">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M15 6 9 12l6 6"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </Link>
          <h1>Сканер свободных IP</h1>
        </div>
        <p>
          Выберите интерфейс или укажите CIDR. Занятость определяется по ответу
          ping и записи в ARP. Хосты без ICMP и без ARP могут отображаться как
          свободные.
        </p>
      </div>

      <div className="panel stack">
        <form
          className="ip-scan-form"
          onSubmit={(e) => {
            e.preventDefault();
            void runScan();
          }}
        >
          <label>
            Интерфейс
            <select
              value={ifaceKey}
              onChange={(e) => onIfaceChange(e.target.value)}
              disabled={scanning}
            >
              {ifaces.length === 0 ? (
                <option value="">Нет IPv4-интерфейсов</option>
              ) : (
                ifaces.map((item) => (
                  <option key={`${item.name}|${item.address}`} value={`${item.name}|${item.address}`}>
                    {item.name} · {item.address} · {item.cidr}
                  </option>
                ))
              )}
            </select>
          </label>
          <label>
            Подсеть
            <input
              type="text"
              value={cidr}
              onChange={(e) => setCidr(e.target.value)}
              placeholder="192.168.1.0/24"
              disabled={scanning}
              autoComplete="off"
            />
          </label>
          <button type="submit" className="btn" disabled={scanning || !cidr.trim()}>
            {scanning ? 'Сканирование…' : 'Сканировать'}
          </button>
        </form>
        {error ? <div className="error">{error}</div> : null}
        {copied ? <div className="muted">Скопировано: {copied}</div> : null}

        {result ? (
          <>
            <div className="ip-scan-stats">
              <article>
                <strong>{result.totals.total}</strong>
                <span>адресов · {result.cidr}</span>
              </article>
              <article>
                <strong>{result.totals.busy}</strong>
                <span>занято</span>
              </article>
              <article className="is-free">
                <strong>{result.totals.free}</strong>
                <span>свободно</span>
              </article>
              <article>
                <strong>{(result.elapsedMs / 1000).toFixed(1)} с</strong>
                <span>время сканирования</span>
              </article>
            </div>

            <div className="toolbar-row">
              <div className="period-pills" role="tablist" aria-label="Фильтр адресов">
                {(
                  [
                    ['all', `Все · ${result.totals.total}`],
                    ['free', `Свободные · ${result.totals.free}`],
                    ['busy', `Занятые · ${result.totals.busy}`],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    className={`period-pill${filter === id ? ' is-active' : ''}`}
                    aria-selected={filter === id}
                    onClick={() => setFilter(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="btn secondary"
                onClick={() => void copyFree()}
                disabled={!result.totals.free}
                title="Копировать свободные адреса"
              >
                <CopyIcon />
                Свободные IP
              </button>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>IP</th>
                    <th>Статус</th>
                    <th>Имя</th>
                    <th>MAC</th>
                    <th>Ответ</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((host) => (
                    <tr key={host.ip}>
                      <td>
                        <code>{host.ip}</code>
                      </td>
                      <td>
                        <span className={`badge ${host.status === 'free' ? 'ok' : ''}`}>
                          {host.status === 'free'
                            ? 'свободен'
                            : host.self
                              ? 'этот узел'
                              : 'занят'}
                        </span>
                      </td>
                      <td>{host.hostname || '—'}</td>
                      <td>{host.mac || '—'}</td>
                      <td>{host.rttMs != null ? `${host.rttMs} мс` : '—'}</td>
                      <td>
                        <button
                          type="button"
                          className="btn-icon"
                          title="Копировать IP"
                          aria-label="Копировать IP"
                          onClick={() => void copyIp(host)}
                        >
                          <CopyIcon />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p className="muted" style={{ margin: 0 }}>
            Результат появится после сканирования. Для типичной /24 это несколько
            секунд.
          </p>
        )}
      </div>
    </div>
  );
}
