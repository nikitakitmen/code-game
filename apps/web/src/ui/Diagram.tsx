'use client';
import type { DiagramDef } from '@prod/engine';

/** A tiny left-to-right node/edge diagram used in articles and explanations. */
export function Diagram({ def }: { def: DiagramDef }) {
  const n = def.nodes.length || 1;
  const toneColor = (t?: string) =>
    t === 'ok' ? 'var(--ok)' : t === 'warn' ? 'var(--warn)' : t === 'error' ? 'var(--error)' : t === 'accent' ? 'var(--accent)' : t === 'muted' ? 'var(--muted)' : 'var(--paper)';
  const w = 520;
  const gap = w / n;
  const pos: Record<string, { x: number; y: number }> = {};
  def.nodes.forEach((node, i) => { pos[node.id] = { x: 28 + i * gap, y: 40 }; });
  return (
    <svg viewBox={`0 0 ${w} 90`} style={{ width: '100%', height: 90, border: '2px solid var(--line)', background: 'var(--paper)' }}>
      {def.edges.map(([a, b, label], i) => {
        const pa = pos[a];
        const pb = pos[b];
        if (!pa || !pb) return null;
        return (
          <g key={i}>
            <line x1={pa.x + 24} y1={pa.y} x2={pb.x - 24} y2={pb.y} stroke="var(--line)" strokeWidth={2} markerEnd="url(#arrow)" />
            {label && <text x={(pa.x + pb.x) / 2} y={pa.y - 8} fontSize={9} textAnchor="middle" fill="var(--ink-soft)">{label}</text>}
          </g>
        );
      })}
      <defs>
        <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" fill="var(--line)" />
        </marker>
      </defs>
      {def.nodes.map((node) => {
        const p = pos[node.id];
        return (
          <g key={node.id}>
            <rect x={p.x - 24} y={p.y - 16} width={48} height={32} fill={toneColor(node.tone)} stroke="var(--line)" strokeWidth={2} />
            <text x={p.x} y={p.y + 3} fontSize={9} textAnchor="middle" fill="var(--ink)">{node.label.slice(0, 9)}</text>
          </g>
        );
      })}
    </svg>
  );
}
