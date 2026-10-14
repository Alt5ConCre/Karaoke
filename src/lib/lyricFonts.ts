/**
 * Lyric fonts bundled with the app.
 *
 * Every font is an OFL file shipped in `public/fonts/` and declared with
 * `@font-face` in `index.css`; nothing is fetched at runtime. The default is
 * Radio Canada, matching the rest of the interface.
 */

export interface LyricFont {
  id: string
  name: string
  /** CSS `font-family` value to apply. */
  stack: string
}

const FALLBACK = 'system-ui, -apple-system, "Segoe UI", sans-serif'

export const DEFAULT_FONT_ID = 'radio-canada'

export const LYRIC_FONTS: LyricFont[] = [
  { id: 'radio-canada', name: 'Radio Canada', stack: `"Radio Canada", ${FALLBACK}` },
  { id: 'archivo-black', name: 'Archivo Black', stack: `"Archivo Black", ${FALLBACK}` },
  { id: 'anton', name: 'Anton', stack: `"Anton", ${FALLBACK}` },
  { id: 'bungee', name: 'Bungee', stack: `"Bungee", ${FALLBACK}` },
  { id: 'lilita-one', name: 'Lilita One', stack: `"Lilita One", ${FALLBACK}` },
]

const FONT_IDS = new Set(LYRIC_FONTS.map((font) => font.id))

/** True when `id` names a bundled font. */
export function isKnownFont(id: string): boolean {
  return FONT_IDS.has(id)
}

/** The CSS `font-family` for a font id (falls back to the default). */
export function fontStack(id: string): string {
  const font = LYRIC_FONTS.find((entry) => entry.id === id)
  return font ? font.stack : LYRIC_FONTS[0].stack
}
