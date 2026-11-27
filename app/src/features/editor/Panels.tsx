import { Badge, Icon } from '@/ui';
import type { Diagnostic, Pattern } from '@/app/coreApi';

const sevIcon = { error: 'error', warning: 'alert', info: 'info' } as const;
const sevOrder = { error: 0, warning: 1, info: 2 } as const;

export function DiagnosticsList({ diagnostics, onJump, compilerReady }: { diagnostics: Diagnostic[]; onJump: (d: Diagnostic) => void; compilerReady: boolean }) {
  if (!compilerReady) {
    return (
      <div className="ed-note">
        <Icon name="info" />
        <span>The notation checker is still being built. Your text is saved; stitch counts and problems will appear here once it lands.</span>
      </div>
    );
  }
  if (diagnostics.length === 0) {
    return (
      <div className="ed-note ed-note--ok">
        <Icon name="check" />
        <span>No problems. Every round checks out.</span>
      </div>
    );
  }
  const sorted = [...diagnostics].sort((a, b) => a.line - b.line || a.col - b.col || sevOrder[a.severity] - sevOrder[b.severity]);
  return (
    <ul className="ed-diags">
      {sorted.map((d, i) => (
        <li key={i}>
          <button type="button" className="ed-diag" data-sev={d.severity} onClick={() => onJump(d)}>
            <Icon name={sevIcon[d.severity]} size={18} />
            <span className="ed-diag__body">
              <span className="ed-diag__msg">{d.message}</span>
              <span className="ed-diag__meta">
                line {d.line}, col {d.col}
                <span aria-hidden="true"> · </span>
                <code>{d.code}</code>
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function RoundsTable({ pattern, onJump }: { pattern: Pattern; onJump: (line: number) => void }) {
  const { rounds, spaces, nodes } = pattern.graph;
  const spacesByRound = new Map<number, number>();
  for (const s of spaces) if (s.kind === 'chsp') spacesByRound.set(s.round, (spacesByRound.get(s.round) ?? 0) + 1);
  return (
    <div className="ed-tablewrap">
      <table className="ed-table">
        <thead>
          <tr>
            <th scope="col">Round</th>
            <th scope="col" className="num">Stitches</th>
            <th scope="col" className="num col-change">Change</th>
            <th scope="col" className="num">Ch-sps</th>
            <th scope="col" className="num" title="Declared count annotation">Pattern says</th>
          </tr>
        </thead>
        <tbody>
          {rounds.map((r, i) => {
            const prev = i > 0 ? rounds[i - 1].stitchCount : undefined;
            const delta = prev === undefined ? undefined : r.stitchCount - prev;
            const ok = r.declaredCount === undefined || r.declaredCount === r.stitchCount;
            return (
              <tr key={r.index} onClick={() => r.src && onJump(r.src.line)} className={r.src ? 'clickable' : undefined}>
                <th scope="row">
                  {r.src ? <button type="button" className="ed-linkbtn" onClick={(e) => { e.stopPropagation(); onJump(r.src!.line); }}>{r.label}</button> : r.label}
                  {r.joined === false && r.kind === 'round' && <span className="muted small"> spiral</span>}
                </th>
                <td className="num"><strong>{r.stitchCount}</strong></td>
                <td className="num muted col-change">{delta === undefined ? '' : delta > 0 ? `+${delta}` : delta === 0 ? '±0' : `−${-delta}`}</td>
                <td className="num">{spacesByRound.get(r.index) ?? ''}</td>
                <td className="num">
                  {r.declaredCount === undefined ? <span className="muted">—</span>
                    : ok ? <Badge tone="ok"><Icon name="check" size={12} /> {r.declaredCount}</Badge>
                    : <Badge tone="error">{r.declaredCount}</Badge>}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">Total</th>
            <td className="num" colSpan={4}>
              <span className="muted">{nodes.length} nodes · {spaces.filter((s) => s.kind === 'chsp').length} chain spaces</span>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
