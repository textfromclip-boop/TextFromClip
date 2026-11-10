import React, { useRef } from 'react';
import { RevisionPack } from '../types';
import { formatTimestamp } from '../server/utils/formatters';
import {
  buildCardSheet,
  buildMindMapLayout,
  buildSketchLessons,
  pickKeyDefinition,
  visualColor,
} from '../utils/packVisuals';

const SANS = "Inter, system-ui, -apple-system, 'Segoe UI', sans-serif";
const INK = '#0B0F1A';

function fileBase(title: string): string {
  return (
    (title || 'revision-pack')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50) || 'revision-pack'
  );
}

/** Renders an inline <svg> to a PNG download (2x). Fonts fall back to system sans in the image. */
export function downloadSvgAsPng(svg: SVGSVGElement, fileName: string, scale = 2): void {
  const vb = svg.viewBox.baseVal;
  const w = vb.width || svg.clientWidth;
  const h = vb.height || svg.clientHeight;
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(w));
  clone.setAttribute('height', String(h));
  const xml = new XMLSerializer().serializeToString(clone);
  const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }));
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }, 'image/png');
  };
  img.onerror = () => URL.revokeObjectURL(url);
  img.src = url;
}

const DotGrid: React.FC<{ id: string; w: number; h: number }> = ({ id, w, h }) => (
  <>
    <defs>
      <pattern id={id} width="22" height="22" patternUnits="userSpaceOnUse">
        <circle cx="1.5" cy="1.5" r="1" fill="#FFFFFF" opacity="0.07" />
      </pattern>
    </defs>
    <rect width={w} height={h} fill={INK} />
    <rect width={w} height={h} fill={`url(#${id})`} />
  </>
);

// ---------------------------------------------------------------------------------------------
// Mind map
// ---------------------------------------------------------------------------------------------
export const MindMapVisual: React.FC<{
  pack: RevisionPack;
  onSeek?: (seconds: number, quote: string) => void;
}> = ({ pack, onSeek }) => {
  const ref = useRef<SVGSVGElement>(null);
  const layout = buildMindMapLayout(pack);
  const { center } = layout;

  if (layout.nodes.length === 0) {
    return <p className="text-sm text-muted">This pack has no note sections to map yet.</p>;
  }

  return (
    <div>
      <div className="rounded-lg overflow-hidden border border-rule">
        <svg
          ref={ref}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          className="w-full h-auto block"
          role="group"
          aria-label={`Mind map of ${pack.title}`}
          fontFamily={SANS}
        >
          <DotGrid id="mm-dots" w={layout.width} h={layout.height} />

          {layout.nodes.map((n) => {
            const sx = n.side === 'left' ? center.x : center.x + center.width;
            const sy = center.y + center.height / 2;
            const dx = Math.abs(n.anchorX - sx) * 0.55;
            const c1x = n.side === 'left' ? sx - dx : sx + dx;
            const c2x = n.side === 'left' ? n.anchorX + dx : n.anchorX - dx;
            return (
              <path
                key={`p-${n.id}`}
                d={`M ${sx} ${sy} C ${c1x} ${sy}, ${c2x} ${n.anchorY}, ${n.anchorX} ${n.anchorY}`}
                stroke={n.color}
                strokeWidth="2.5"
                fill="none"
                opacity="0.85"
              />
            );
          })}

          {/* Centre */}
          <rect x={center.x} y={center.y} width={center.width} height={center.height} rx="12" fill="#FFFFFF" />
          {center.lines.map((line, i) => {
            const startY = center.y + center.height / 2 - ((center.lines.length - 1) * 24) / 2 + 7;
            return (
              <text
                key={i}
                x={center.x + center.width / 2}
                y={startY + i * 24}
                textAnchor="middle"
                fontSize="19"
                fontWeight="700"
                fill={INK}
              >
                {line}
              </text>
            );
          })}

          {/* Branches */}
          {layout.nodes.map((n) => (
            <g
              key={n.id}
              onClick={() => onSeek?.(n.startSeconds, n.quote)}
              style={{ cursor: onSeek ? 'pointer' : 'default' }}
              role={onSeek ? 'button' : undefined}
              tabIndex={onSeek ? 0 : undefined}
              aria-label={onSeek ? `${n.fullHeading}. Play lecture at ${formatTimestamp(n.startSeconds)}` : undefined}
              onKeyDown={(e) => {
                if (onSeek && (e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault();
                  onSeek(n.startSeconds, n.quote);
                }
              }}
            >
              <title>{`${n.fullHeading} · From lecture ${formatTimestamp(n.startSeconds)}`}</title>
              <rect x={n.x} y={n.y} width={n.width} height={n.height} rx="10" fill="#1B2030" stroke="#FFFFFF" strokeOpacity="0.08" />
              <rect x={n.x} y={n.y + 8} width="4" height={n.height - 16} rx="2" fill={n.color} />
              <text x={n.x + 20} y={n.y + 29} fontSize="17" fontWeight="700" fill="#FFFFFF">
                {n.heading}
              </text>
              <text x={n.x + 20} y={n.y + 51} fontSize="13" fill="#9CA3AF">
                {n.sub}
              </text>
            </g>
          ))}

          <text x={layout.width - 20} y={layout.height - 14} textAnchor="end" fontSize="12" fill="#6B7280">
            LearnFromClip · every branch links to the lecture
          </text>
        </svg>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        <button
          type="button"
          onClick={() => ref.current && downloadSvgAsPng(ref.current, `${fileBase(pack.title)}-mindmap.png`)}
          className="px-3 py-2 rounded-md border border-rule bg-surface font-medium text-ink hover:border-ink transition-colors"
        >
          Download mind map (PNG)
        </button>
        <span className="text-muted">Tap a branch to jump to that moment in the lecture.</span>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------------------------
// Card sheet
// ---------------------------------------------------------------------------------------------
export const CardSheetVisual: React.FC<{ pack: RevisionPack }> = ({ pack }) => {
  const ref = useRef<SVGSVGElement>(null);
  const items = buildCardSheet(pack, 6);
  const cols = 2;
  const tileW = 440;
  const tileH = 220;
  const gap = 24;
  const pad = 40;
  const headerH = 78;
  const rows = Math.ceil(items.length / cols);
  const width = pad * 2 + cols * tileW + (cols - 1) * gap;
  const height = headerH + pad + rows * tileH + (rows - 1) * gap + 44;

  if (items.length === 0) return <p className="text-sm text-muted">This pack has no flashcards yet.</p>;

  return (
    <div>
      <div className="rounded-lg overflow-hidden border border-rule">
        <svg
          ref={ref}
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-auto block"
          role="img"
          aria-label={`Flashcard sheet for ${pack.title}`}
          fontFamily={SANS}
        >
          <DotGrid id="cs-dots" w={width} h={height} />
          <text x={pad} y={50} fontSize="26" fontWeight="700" fill="#FFFFFF">
            {pack.title.length > 56 ? `${pack.title.slice(0, 55)}…` : pack.title}
          </text>
          <text x={pad} y={74} fontSize="14" fill="#9CA3AF">
            {`${items.length} of ${pack.flashcards.length} flashcards`}
          </text>
          {items.map((it, i) => {
            const x = pad + (i % cols) * (tileW + gap);
            const y = headerH + pad / 2 + Math.floor(i / cols) * (tileH + gap);
            return (
              <g key={it.number}>
                <rect x={x} y={y} width={tileW} height={tileH} rx="14" fill="#1B2030" stroke="#FFFFFF" strokeOpacity="0.08" />
                <rect x={x} y={y} width={tileW} height="5" rx="2.5" fill={it.color} />
                <text x={x + 26} y={y + 38} fontSize="14" fontWeight="600" fill={it.color} fontFamily="'JetBrains Mono', ui-monospace, monospace">
                  {it.number}
                </text>
                {it.front.map((line, li) => (
                  <text key={li} x={x + 26} y={y + 72 + li * 29} fontSize="23" fontWeight="700" fill="#FFFFFF">
                    {line}
                  </text>
                ))}
                {it.back.map((line, li) => (
                  <text key={li} x={x + 26} y={y + tileH - 20 - (it.back.length - 1 - li) * 18} fontSize="13" fill="#9CA3AF">
                    {line}
                  </text>
                ))}
              </g>
            );
          })}
          <text x={width - pad} y={height - 16} textAnchor="end" fontSize="12" fill="#6B7280">
            LearnFromClip
          </text>
        </svg>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        <button
          type="button"
          onClick={() => ref.current && downloadSvgAsPng(ref.current, `${fileBase(pack.title)}-flashcards.png`)}
          className="px-3 py-2 rounded-md border border-rule bg-surface font-medium text-ink hover:border-ink transition-colors"
        >
          Download card sheet (PNG)
        </button>
        <span className="text-muted">Question on the card, answer underneath. Good for sharing a quick revision sheet.</span>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------------------------
// Sketchnotes (self-contained inline styles so the same markup can be printed in a new window)
// ---------------------------------------------------------------------------------------------
const HAND = "'Caveat', 'Segoe Print', 'Bradley Hand', cursive";

const hl = (color = '#FFF06A'): React.CSSProperties => ({
  background: `linear-gradient(transparent 55%, ${color} 55%, ${color} 92%, transparent 92%)`,
  padding: '0 4px',
  boxDecorationBreak: 'clone',
  WebkitBoxDecorationBreak: 'clone',
});

export const SKETCH_PRINT_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Caveat:wght@500;700&display=swap');
  body { margin: 0; padding: 24px; background: #fff; }
  @page { margin: 12mm; }
`;

export const SketchnotesVisual: React.FC<{ pack: RevisionPack }> = ({ pack }) => {
  const pageRef = useRef<HTMLDivElement>(null);
  const lessons = buildSketchLessons(pack, 7);
  const keyDef = pickKeyDefinition(pack);

  if (lessons.length === 0) return <p className="text-sm text-muted">This pack has no notes to sketch yet.</p>;

  const print = () => {
    if (!pageRef.current) return;
    const w = window.open('', '_blank', 'width=900,height=1100');
    if (!w) return;
    w.document.open();
    w.document.write(
      `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${fileBase(pack.title)} sketchnotes</title><style>${SKETCH_PRINT_CSS}</style></head><body>${pageRef.current.outerHTML}</body></html>`
    );
    w.document.close();
    w.focus();
    const fonts: Promise<unknown> | undefined = (w.document as any).fonts?.ready;
    Promise.race([fonts || Promise.resolve(), new Promise((r) => setTimeout(r, 3500))]).then(() =>
      setTimeout(() => {
        try {
          w.print();
        } catch {
          // user can press Ctrl+P
        }
      }, 150)
    );
  };

  return (
    <div>
      <div
        ref={pageRef}
        dir="auto"
        style={{
          fontFamily: HAND,
          background: '#FDFDF9',
          color: '#1E2A5A',
          border: '1px solid #E3E3DE',
          borderRadius: 8,
          padding: '28px 30px 26px',
          maxWidth: 720,
          lineHeight: 1.25,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <h4 style={{ margin: 0, fontFamily: HAND, fontWeight: 700, fontSize: 34, fontStyle: 'normal' }}>
            <span style={hl()}>{pack.title}</span>
          </h4>
          <span style={{ fontSize: 19, opacity: 0.75 }}>LearnFromClip sketchnotes</span>
        </div>

        <p style={{ margin: '18px 0 6px', fontSize: 26, fontWeight: 700 }}>
          <span style={hl()}>Key lessons:</span>
        </p>

        <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {lessons.map((l, i) => (
            <li key={l.number} style={{ display: 'flex', gap: 12, margin: '12px 0' }}>
              <span
                style={{
                  flex: '0 0 auto',
                  width: 30,
                  height: 30,
                  borderRadius: '50%',
                  border: `2px solid ${visualColor(i + 1)}`,
                  color: '#1E2A5A',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 20,
                  fontWeight: 700,
                  marginTop: 2,
                }}
              >
                {l.number}
              </span>
              <span style={{ flex: 1 }}>
                <span style={{ fontSize: 25, fontWeight: 700 }}>
                  <span style={hl(i % 2 ? '#C9F0FF' : '#FFF06A')}>{l.heading}</span>
                </span>
                <br />
                <span style={{ fontSize: 21, opacity: 0.88 }}>• {l.line}</span>{' '}
                <span style={{ fontSize: 16, opacity: 0.82, whiteSpace: 'nowrap' }}>
                  ({formatTimestamp(l.startSeconds)})
                </span>
              </span>
            </li>
          ))}
        </ol>

        {keyDef && (
          <div style={{ marginTop: 18, borderTop: '2px dashed #C9CDE0', paddingTop: 12 }}>
            <p style={{ margin: 0, fontSize: 26, fontWeight: 700 }}>
              <span style={hl('#D6F5C8')}>Worth remembering:</span>
            </p>
            <p style={{ margin: '6px 0 0', fontSize: 22 }}>
              <strong>{keyDef.term}:</strong> {keyDef.text}
            </p>
          </div>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        <button
          type="button"
          onClick={print}
          className="px-3 py-2 rounded-md border border-rule bg-surface font-medium text-ink hover:border-ink transition-colors"
        >
          Print or save as PDF
        </button>
        <span className="text-muted">Built from your verified notes. The time next to each line is where it was said.</span>
      </div>
    </div>
  );
};
