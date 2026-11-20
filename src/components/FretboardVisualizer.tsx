import React, {useMemo} from 'react';

export interface ActiveFretNote {
  /** 1 = lowest string (bottom of tab), stringCount = highest string (top of tab) */
  stringNumber: number;
  fret: number;
  isDead?: boolean;
  isGhost?: boolean;
}

interface FretboardVisualizerProps {
  /** MIDI pitches from highest string to lowest string, e.g. [64, 59, 55, 50, 45, 40] */
  tuning: number[];
  trackName: string;
  isPercussion: boolean;
  activeNotes: ActiveFretNote[];
  capo?: number;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const INLAY_FRETS = [3, 5, 7, 9, 12, 15, 17, 19, 21];
const DOUBLE_INLAY_FRET = 12;
const FRET_COUNT = 22;

function midiToNoteName(midi: number): string {
  const normalized = ((midi % 12) + 12) % 12;
  return NOTE_NAMES[normalized] ?? '';
}

function getFretPositions(count: number, startX: number, usableWidth: number): number[] {
  // Authentic tapered guitar fret spacing using 12th root of 2 geometry
  const raw: number[] = [0];
  let pos = 0;
  let remaining = 1;
  for (let i = 1; i <= count; i++) {
    const step = remaining / 17.817;
    pos += step;
    remaining -= step;
    raw.push(pos);
  }
  const total = raw[raw.length - 1] || 1;
  return raw.map((v) => startX + (v / total) * usableWidth);
}

export const FretboardVisualizer: React.FC<FretboardVisualizerProps> = ({
  tuning,
  trackName,
  isPercussion,
  activeNotes,
  capo = 0,
}) => {
  const stringCount = tuning.length > 0 ? tuning.length : 6;
  const effectiveTuning = tuning.length > 0 ? tuning : [64, 59, 55, 50, 45, 40];

  const viewWidth = 1120;
  const boardLeft = 64;
  const boardRight = 1098;
  const boardTop = 20;
  const stringSpacing = stringCount <= 4 ? 24 : stringCount <= 6 ? 19 : 16;
  const boardHeight = (stringCount - 1) * stringSpacing + 28;
  const viewHeight = boardTop + boardHeight + 24;

  const fretX = useMemo(
    () => getFretPositions(FRET_COUNT, boardLeft, boardRight - boardLeft),
    [],
  );

  // Build quick lookup: rowIndex (0 = top/highest string) -> active notes
  const notesByKey = useMemo(() => {
    const map = new Map<string, ActiveFretNote>();
    for (const n of activeNotes) {
      if (n.stringNumber >= 1 && n.stringNumber <= stringCount && n.fret >= 0 && n.fret <= FRET_COUNT) {
        const rowIndex = stringCount - n.stringNumber;
        map.set(`${rowIndex}:${n.fret}`, n);
      }
    }
    return map;
  }, [activeNotes, stringCount]);

  if (isPercussion) {
    return (
      <div className="bg-[#181B20] border-t border-white/10 px-4 py-3 flex items-center justify-between text-xs text-zinc-400">
        <span className="font-medium text-zinc-200">{trackName}</span>
        <span>Schlagzeugspur aktiv — wähle eine Gitarren- oder Bassspur für das Live-Griffbrett.</span>
      </div>
    );
  }

  return (
    <div className="bg-[#16181D] border-t border-white/10 select-none overflow-x-auto">
      <div className="min-w-[740px] max-w-[1440px] mx-auto px-3 pt-1.5 pb-1">
        <div className="flex items-center justify-between text-[11px] text-zinc-400 px-1 mb-0.5">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-medium text-zinc-200 truncate">{trackName}</span>
            <span aria-hidden="true" className="text-zinc-600">·</span>
            <span className="font-mono tabular-nums text-zinc-400">
              {effectiveTuning
                .slice()
                .reverse()
                .map((m) => midiToNoteName(m))
                .join(' ')}
            </span>
            {capo > 0 && (
              <>
                <span aria-hidden="true" className="text-zinc-600">·</span>
                <span className="text-amber-400 font-mono tabular-nums">Kapodaster Bund {capo}</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-2 font-mono tabular-nums text-zinc-400 shrink-0">
            {activeNotes.length > 0 ? (
              <span>
                {activeNotes
                  .map((n) => {
                    const row = stringCount - n.stringNumber;
                    const openMidi = effectiveTuning[row] ?? 40;
                    const noteName = midiToNoteName(openMidi + n.fret + capo);
                    return `${noteName} (${n.fret})`;
                  })
                  .join(' · ')}
              </span>
            ) : (
              <span className="text-zinc-500">Live-Griffbrett bereit</span>
            )}
          </div>
        </div>

        <svg
          viewBox={`0 0 ${viewWidth} ${viewHeight}`}
          className="w-full h-auto block"
          role="img"
          aria-label={`Live-Griffbrett für ${trackName}`}
        >
          <defs>
            <linearGradient id="rosewood-neck" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2A201B" />
              <stop offset="50%" stopColor="#231A16" />
              <stop offset="100%" stopColor="#1B1411" />
            </linearGradient>
            <linearGradient id="fret-wire" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#94A3B8" />
              <stop offset="50%" stopColor="#E2E8F0" />
              <stop offset="100%" stopColor="#64748B" />
            </linearGradient>
          </defs>

          {/* Fingerboard wood */}
          <rect
            x={boardLeft}
            y={boardTop}
            width={boardRight - boardLeft}
            height={boardHeight}
            rx={4}
            fill="url(#rosewood-neck)"
            stroke="rgba(255,255,255,0.08)"
            strokeWidth={1}
          />

          {/* Nut */}
          <rect
            x={boardLeft - 4}
            y={boardTop}
            width={6}
            height={boardHeight}
            rx={1.5}
            fill="#E7E2D8"
          />

          {/* Capo bar if present */}
          {capo > 0 && capo <= FRET_COUNT && (
            <rect
              x={fretX[capo] - 4}
              y={boardTop - 3}
              width={5}
              height={boardHeight + 6}
              rx={2}
              fill="#F59E0B"
              opacity={0.85}
            />
          )}

          {/* Fret inlays */}
          {INLAY_FRETS.map((f) => {
            const cx = (fretX[f - 1] + fretX[f]) / 2;
            const cy = boardTop + boardHeight / 2;
            if (f === DOUBLE_INLAY_FRET) {
              const offset = Math.max(18, boardHeight * 0.24);
              return (
                <g key={`inlay-${f}`}>
                  <circle cx={cx} cy={cy - offset} r={4.2} fill="rgba(241, 245, 249, 0.22)" />
                  <circle cx={cx} cy={cy + offset} r={4.2} fill="rgba(241, 245, 249, 0.22)" />
                </g>
              );
            }
            return (
              <circle
                key={`inlay-${f}`}
                cx={cx}
                cy={cy}
                r={4.2}
                fill="rgba(241, 245, 249, 0.22)"
              />
            );
          })}

          {/* Fret wires & fret numbers */}
          {fretX.map((x, idx) => {
            if (idx === 0) return null;
            const labelX = (fretX[idx - 1] + x) / 2;
            const showNumber = INLAY_FRETS.includes(idx) || idx === 1;
            return (
              <g key={`fret-${idx}`}>
                <line
                  x1={x}
                  y1={boardTop}
                  x2={x}
                  y2={boardTop + boardHeight}
                  stroke="url(#fret-wire)"
                  strokeWidth={idx === 12 ? 2.1 : 1.5}
                  opacity={0.75}
                />
                {showNumber && (
                  <text
                    x={labelX}
                    y={boardTop + boardHeight + 16}
                    textAnchor="middle"
                    fill="#71717A"
                    fontSize={10.5}
                    fontFamily="JetBrains Mono, monospace"
                  >
                    {idx}
                  </text>
                )}
              </g>
            );
          })}

          {/* Strings & open-string labels */}
          {effectiveTuning.map((midi, rowIdx) => {
            const y = boardTop + 14 + rowIdx * stringSpacing;
            // Thicker lower strings (higher rowIdx)
            const thickness = 1 + (rowIdx / Math.max(1, stringCount - 1)) * 1.65;
            const isOpenActive = notesByKey.has(`${rowIdx}:0`);
            const openLabel = midiToNoteName(midi);

            return (
              <g key={`string-${rowIdx}`}>
                {/* Open string note name on left */}
                <text
                  x={22}
                  y={y + 4}
                  textAnchor="middle"
                  fill={isOpenActive ? '#60A5FA' : '#A1A1AA'}
                  fontSize={11.5}
                  fontWeight={isOpenActive ? 700 : 500}
                  fontFamily="JetBrains Mono, monospace"
                >
                  {openLabel}
                </text>

                {/* String wire */}
                <line
                  x1={boardLeft - 2}
                  y1={y}
                  x2={boardRight}
                  y2={y}
                  stroke={isOpenActive ? '#60A5FA' : rowIdx >= stringCount - 3 ? '#CBD5E1' : '#E2E8F0'}
                  strokeWidth={thickness}
                  opacity={isOpenActive ? 1 : 0.72}
                />

                {/* Active open-string ring at nut */}
                {isOpenActive && (
                  <g>
                    <circle
                      cx={boardLeft - 14}
                      cy={y}
                      r={8.5}
                      fill="#2563EB"
                      stroke="#93C5FD"
                      strokeWidth={1.5}
                    />
                    <text
                      x={boardLeft - 14}
                      y={y + 3.5}
                      textAnchor="middle"
                      fill="#FFFFFF"
                      fontSize={10}
                      fontWeight={700}
                      fontFamily="JetBrains Mono, monospace"
                    >
                      0
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {/* Active fretted notes */}
          {Array.from(notesByKey.entries()).map(([key, note]) => {
            if (note.fret === 0) return null;
            const rowIdx = stringCount - note.stringNumber;
            const y = boardTop + 14 + rowIdx * stringSpacing;
            const cx = (fretX[note.fret - 1] + fretX[note.fret]) / 2;
            const radius = Math.min(9.5, (fretX[note.fret] - fretX[note.fret - 1]) * 0.42);
            const r = Math.max(7.5, radius);

            return (
              <g key={`active-${key}`}>
                <circle
                  cx={cx}
                  cy={y}
                  r={r + 3.5}
                  fill="rgba(59, 130, 246, 0.28)"
                />
                <circle
                  cx={cx}
                  cy={y}
                  r={r}
                  fill={note.isDead ? '#52525B' : '#2563EB'}
                  stroke="#DBEAFE"
                  strokeWidth={1.5}
                />
                <text
                  x={cx}
                  y={y + 3.5}
                  textAnchor="middle"
                  fill="#FFFFFF"
                  fontSize={note.fret >= 10 ? 9.5 : 10.5}
                  fontWeight={700}
                  fontFamily="JetBrains Mono, monospace"
                >
                  {note.isDead ? 'X' : note.fret}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
};
