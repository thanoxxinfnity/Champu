'use client';

import { useMemo, useState } from 'react';
import {
  LIGHT_THEME,
  renderDeck,
  renderDocument,
  starterDeck,
  TERMINAL_THEME,
  toCsv,
  toSpreadsheetXml,
  type DeckSpec,
  type Slide,
  type SlideLayout,
} from '@/lib/suites/studio/deck';
import { renderMarkdown } from '@/components/markdown';
import { useWorkspace } from '@/lib/store';
import { downloadText } from '@/lib/zip';

const LAYOUTS: SlideLayout[] = ['title', 'section', 'bullets', 'split', 'quote', 'code', 'image', 'stats', 'end'];

const field = 'mono w-full rounded border bg-transparent px-2 py-1.5 text-[11px] outline-none';
const fieldStyle = { borderColor: 'var(--line)', color: 'var(--ink)' } as const;

type Mode = 'deck' | 'document' | 'sheet';

export function Studio() {
  const upsertFile = useWorkspace((s) => s.upsertFile);
  const setRightPaneTab = useWorkspace((s) => s.setRightPaneTab);

  const [mode, setMode] = useState<Mode>('deck');
  const [deck, setDeck] = useState<DeckSpec>(() => starterDeck('Chomugiri Deck'));
  const [selected, setSelected] = useState(0);
  const [docTitle, setDocTitle] = useState('Technical Brief');
  const [docBody, setDocBody] = useState('## Summary\n\nReplace this with the document body. Markdown is supported.\n\n- Point one\n- Point two\n');
  const [sheetTitle, setSheetTitle] = useState('Projections');
  const [sheetText, setSheetText] = useState('Quarter,Revenue,Cost\nQ1,120000,84000\nQ2,148000,91000\nQ3,171000,98000');

  const slide = deck.slides[selected];

  const html = useMemo(() => {
    if (mode === 'deck') return renderDeck(deck);
    if (mode === 'document') {
      return renderDocument({ title: docTitle, theme: LIGHT_THEME, body: renderMarkdown(docBody), pageSize: 'a4' });
    }
    return '';
  }, [mode, deck, docTitle, docBody]);

  const sheet = useMemo(() => {
    const rows = sheetText.split('\n').filter(Boolean).map((r) => r.split(','));
    return { title: sheetTitle, columns: rows[0] ?? [], rows: rows.slice(1) };
  }, [sheetText, sheetTitle]);

  const patchSlide = (patch: Partial<Slide>) =>
    setDeck((d) => ({ ...d, slides: d.slides.map((s, i) => (i === selected ? { ...s, ...patch } : s)) }));

  const openPreview = () => {
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const toFileManager = () => {
    if (mode === 'sheet') {
      upsertFile({ kind: 'file', path: `${sheetTitle.replace(/\W+/g, '-').toLowerCase()}.csv`, language: 'text', content: toCsv(sheet), complete: true, bytes: toCsv(sheet).length });
    } else {
      const name = mode === 'deck' ? `${deck.title.replace(/\W+/g, '-').toLowerCase()}.html` : `${docTitle.replace(/\W+/g, '-').toLowerCase()}.html`;
      upsertFile({ kind: 'file', path: name, language: 'html', content: html, complete: true, bytes: new TextEncoder().encode(html).length });
    }
    setRightPaneTab('files');
  };

  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-72 shrink-0 flex-col overflow-y-auto border-r" style={{ borderColor: 'var(--line)' }}>
        <div className="flex shrink-0 border-b" style={{ borderColor: 'var(--line)' }}>
          {(['deck', 'document', 'sheet'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className="mono flex-1 px-2 py-2 text-[10.5px] transition-colors"
              style={{
                background: mode === m ? 'color-mix(in oklab, var(--accent) 12%, transparent)' : undefined,
                color: mode === m ? 'var(--accent)' : 'var(--ink-dim)',
              }}
            >
              {m}
            </button>
          ))}
        </div>

        {mode === 'deck' && (
          <>
            <div className="space-y-1.5 border-b p-3" style={{ borderColor: 'var(--line)' }}>
              <input value={deck.title} onChange={(e) => setDeck({ ...deck, title: e.target.value })} className={field} style={fieldStyle} placeholder="deck title" />
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => setDeck({ ...deck, theme: deck.theme.background === '#09090b' ? LIGHT_THEME : TERMINAL_THEME })}
                  className="mono flex-1 rounded border px-2 py-1.5 text-[10px]"
                  style={{ borderColor: 'var(--line)', color: 'var(--ink-dim)' }}
                >
                  {deck.theme.background === '#09090b' ? 'dark' : 'light'}
                </button>
                <button
                  type="button"
                  onClick={() => setDeck({ ...deck, aspect: deck.aspect === '4:3' ? '16:9' : '4:3' })}
                  className="mono flex-1 rounded border px-2 py-1.5 text-[10px]"
                  style={{ borderColor: 'var(--line)', color: 'var(--ink-dim)' }}
                >
                  {deck.aspect ?? '16:9'}
                </button>
              </div>
            </div>

            <div className="border-b p-2" style={{ borderColor: 'var(--line)' }}>
              <div className="mb-1 flex items-center px-1">
                <span className="mono text-[9px] uppercase tracking-[0.1em]" style={{ color: 'var(--ink-faint)' }}>
                  slides · {deck.slides.length}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setDeck({ ...deck, slides: [...deck.slides, { layout: 'bullets', title: 'New slide', bullets: ['Point'] }] });
                    setSelected(deck.slides.length);
                  }}
                  className="mono ml-auto text-[10px]"
                  style={{ color: 'var(--accent)' }}
                >
                  + add
                </button>
              </div>

              {deck.slides.map((s, i) => (
                <div key={i} className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setSelected(i)}
                    className="min-w-0 flex-1 truncate rounded px-2 py-1 text-left text-[11px]"
                    style={{
                      background: selected === i ? 'color-mix(in oklab, var(--accent) 12%, transparent)' : undefined,
                      color: selected === i ? 'var(--accent)' : 'var(--ink-dim)',
                    }}
                  >
                    <span className="mono mr-1.5 text-[9px]" style={{ color: 'var(--ink-faint)' }}>{String(i + 1).padStart(2, '0')}</span>
                    {s.title ?? s.body?.slice(0, 24) ?? s.layout}
                  </button>
                  {deck.slides.length > 1 && (
                    <button
                      type="button"
                      onClick={() => {
                        setDeck({ ...deck, slides: deck.slides.filter((_, j) => j !== i) });
                        setSelected((prev) => Math.max(0, Math.min(prev, deck.slides.length - 2)));
                      }}
                      className="mono shrink-0 text-[10px]"
                      style={{ color: 'var(--color-rose)' }}
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>

            {slide && (
              <div className="space-y-1.5 p-3">
                <label className="block">
                  <span className="mono block text-[9px] uppercase" style={{ color: 'var(--ink-faint)' }}>layout</span>
                  <select
                    value={slide.layout}
                    onChange={(e) => patchSlide({ layout: e.target.value as SlideLayout })}
                    className={field}
                    style={{ ...fieldStyle, background: 'var(--surface)' }}
                  >
                    {LAYOUTS.map((l) => (
                      <option key={l} value={l}>{l}</option>
                    ))}
                  </select>
                </label>

                <input value={slide.title ?? ''} onChange={(e) => patchSlide({ title: e.target.value })} className={field} style={fieldStyle} placeholder="title" />
                <input value={slide.subtitle ?? ''} onChange={(e) => patchSlide({ subtitle: e.target.value })} className={field} style={fieldStyle} placeholder="subtitle / attribution" />

                {(slide.layout === 'bullets' || slide.layout === 'split') && (
                  <textarea
                    value={(slide.bullets ?? []).join('\n')}
                    onChange={(e) => patchSlide({ bullets: e.target.value.split('\n') })}
                    rows={5}
                    className={`${field} resize-y`}
                    style={fieldStyle}
                    placeholder="one bullet per line — **bold**, *italic*, `code` supported"
                  />
                )}

                {(slide.layout === 'quote' || slide.layout === 'title' || slide.layout === 'end' || slide.layout === 'split') && (
                  <textarea
                    value={slide.body ?? ''}
                    onChange={(e) => patchSlide({ body: e.target.value })}
                    rows={3}
                    className={`${field} resize-y`}
                    style={fieldStyle}
                    placeholder="body text"
                  />
                )}

                {slide.layout === 'code' && (
                  <textarea
                    value={slide.code?.source ?? ''}
                    onChange={(e) => patchSlide({ code: { language: slide.code?.language ?? 'typescript', source: e.target.value } })}
                    rows={7}
                    className={`${field} resize-y`}
                    style={fieldStyle}
                    placeholder="source code"
                  />
                )}

                {slide.layout === 'stats' && (
                  <textarea
                    value={(slide.stats ?? []).map((s) => `${s.value}|${s.label}`).join('\n')}
                    onChange={(e) =>
                      patchSlide({
                        stats: e.target.value.split('\n').filter(Boolean).map((line) => {
                          const [value, label] = line.split('|');
                          return { value: value ?? '', label: label ?? '' };
                        }),
                      })
                    }
                    rows={4}
                    className={`${field} resize-y`}
                    style={fieldStyle}
                    placeholder="value|label per line — e.g. 4.2×|throughput gain"
                  />
                )}

                {(slide.layout === 'image' || slide.layout === 'split') && (
                  <input
                    value={slide.image?.src ?? ''}
                    onChange={(e) => patchSlide({ image: { src: e.target.value, alt: slide.image?.alt ?? '', caption: slide.image?.caption } })}
                    className={field}
                    style={fieldStyle}
                    placeholder="image URL or data: URI"
                  />
                )}
              </div>
            )}
          </>
        )}

        {mode === 'document' && (
          <div className="space-y-1.5 p-3">
            <input value={docTitle} onChange={(e) => setDocTitle(e.target.value)} className={field} style={fieldStyle} placeholder="document title" />
            <textarea
              value={docBody}
              onChange={(e) => setDocBody(e.target.value)}
              rows={20}
              className={`${field} resize-y`}
              style={fieldStyle}
              placeholder="markdown body"
            />
          </div>
        )}

        {mode === 'sheet' && (
          <div className="space-y-1.5 p-3">
            <input value={sheetTitle} onChange={(e) => setSheetTitle(e.target.value)} className={field} style={fieldStyle} placeholder="sheet title" />
            <textarea
              value={sheetText}
              onChange={(e) => setSheetText(e.target.value)}
              rows={16}
              className={`${field} resize-y`}
              style={fieldStyle}
              placeholder="CSV — first row is the header"
            />
            <p className="text-[10px] leading-[1.45]" style={{ color: 'var(--ink-faint)' }}>
              Exports as CSV, or as SpreadsheetML which Excel, LibreOffice and Numbers open with live cell types.
            </p>
          </div>
        )}

        <div className="mt-auto space-y-1.5 border-t p-3" style={{ borderColor: 'var(--line)' }}>
          {mode !== 'sheet' && (
            <>
              <button type="button" onClick={openPreview} className="mono w-full rounded px-3 py-2 text-[11px] font-medium" style={{ background: 'var(--accent)', color: '#04150e' }}>
                open · print to PDF
              </button>
              <button
                type="button"
                onClick={() => downloadText(html, mode === 'deck' ? `${deck.title.replace(/\W+/g, '-').toLowerCase()}.html` : `${docTitle.replace(/\W+/g, '-').toLowerCase()}.html`, 'text/html')}
                className="mono w-full rounded border px-3 py-1.5 text-[10.5px]"
                style={{ borderColor: 'var(--line)', color: 'var(--ink-dim)' }}
              >
                download .html
              </button>
            </>
          )}

          {mode === 'sheet' && (
            <>
              <button
                type="button"
                onClick={() => downloadText(toCsv(sheet), `${sheetTitle.replace(/\W+/g, '-').toLowerCase()}.csv`, 'text/csv')}
                className="mono w-full rounded px-3 py-2 text-[11px] font-medium"
                style={{ background: 'var(--accent)', color: '#04150e' }}
              >
                download .csv
              </button>
              <button
                type="button"
                onClick={() => downloadText(toSpreadsheetXml(sheet), `${sheetTitle.replace(/\W+/g, '-').toLowerCase()}.xml`, 'application/vnd.ms-excel')}
                className="mono w-full rounded border px-3 py-1.5 text-[10.5px]"
                style={{ borderColor: 'var(--line)', color: 'var(--ink-dim)' }}
              >
                download SpreadsheetML
              </button>
            </>
          )}

          <button type="button" onClick={toFileManager} className="mono w-full rounded border px-3 py-1.5 text-[10.5px]" style={{ borderColor: 'var(--line)', color: 'var(--ink-dim)' }}>
            → file manager
          </button>
        </div>
      </div>

      <div className="min-w-0 flex-1" style={{ background: 'var(--surface)' }}>
        {mode === 'sheet' ? (
          <div className="h-full overflow-auto p-4">
            <table className="mono w-full border-collapse text-[11.5px]">
              <thead>
                <tr>
                  {sheet.columns.map((col, i) => (
                    <th key={i} className="border px-2 py-1.5 text-left" style={{ borderColor: 'var(--line)', background: 'var(--panel)', color: 'var(--ink)' }}>
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sheet.rows.map((row, i) => (
                  <tr key={i}>
                    {row.map((cell, j) => (
                      <td key={j} className="border px-2 py-1" style={{ borderColor: 'var(--line)', color: 'var(--ink-dim)' }}>
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <iframe
            title="preview"
            srcDoc={html}
            className="h-full w-full border-0"
            sandbox="allow-scripts allow-same-origin allow-modals"
          />
        )}
      </div>
    </div>
  );
}
