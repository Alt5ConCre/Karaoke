import { useBackground } from '../state/useBackground.ts'
import { BACKGROUND_NONE, backgroundPosterUrl } from '../lib/backgrounds.ts'

/**
 * BackgroundPicker — choose the loop that plays behind a song.
 *
 * A row of poster thumbnails (one per built-in loop, plus "None"), a switch to
 * show/hide the layer, and a dim slider so lyrics stay readable over a bright
 * loop. Every control writes straight to the shared store, so the change is
 * instant on the stage and remembered on this device.
 */
export function BackgroundPicker() {
  const { background, loops, setId, setEnabled, setDim } = useBackground()

  return (
    <section className="bg-picker" aria-label="Background video">
      <header className="bg-picker__head">
        <h3 className="bg-picker__title">Background</h3>
        <label className="bg-picker__toggle">
          <input
            type="checkbox"
            checked={background.enabled}
            onChange={(event) => setEnabled(event.target.checked)}
          />
          <span>Show behind the song</span>
        </label>
      </header>

      <div className="bg-picker__grid" role="radiogroup" aria-label="Choose a background">
        <button
          type="button"
          role="radio"
          aria-checked={background.id === BACKGROUND_NONE}
          className={`bg-swatch bg-swatch--none${
            background.id === BACKGROUND_NONE ? ' is-active' : ''
          }`}
          onClick={() => setId(BACKGROUND_NONE)}
        >
          <span className="bg-swatch__name">No background</span>
        </button>

        {loops.map((loop) => {
          const active = background.id === loop.id
          return (
            <button
              key={loop.id}
              type="button"
              role="radio"
              aria-checked={active}
              className={`bg-swatch${active ? ' is-active' : ''}`}
              onClick={() => setId(loop.id)}
              title={loop.name}
            >
              <img
                className="bg-swatch__img"
                src={backgroundPosterUrl(loop.id)}
                alt=""
                loading="lazy"
              />
              <span className="bg-swatch__name">{loop.name}</span>
            </button>
          )
        })}
      </div>

      <label className={`bg-picker__dim${background.enabled ? '' : ' is-disabled'}`}>
        <span className="bg-picker__dim-label">Dim</span>
        <input
          type="range"
          min={0}
          max={0.85}
          step={0.05}
          value={background.dim}
          disabled={!background.enabled}
          onChange={(event) => setDim(Number(event.target.value))}
          aria-label="Background dimming"
        />
      </label>
    </section>
  )
}
