import dynamic from 'next/dynamic'
import { useState } from 'react'

const AlbaniaMap = dynamic(() => import('../components/AlbaniaMap'), { ssr: false })

export default function Home() {
  const [controls, setControls] = useState(null)
  const [showLabels, setShowLabels] = useState(true)

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>Krijo Harten e re Administrative te Shqiperise</h1>
        <p>Kliko njesite administrative per te ndryshuar kufijte e bashkive.</p>
        <div className="actions">
          <button
            type="button"
            className="btn"
            onClick={() => controls?.reset?.()}
            disabled={!controls?.loaded || !!controls?.error}
          >
            Reset
          </button>
          <label className="toggle">
            <input
              type="checkbox"
              checked={showLabels}
              onChange={(e) => setShowLabels(e.target.checked)}
              disabled={!controls?.loaded || !!controls?.error}
            />
            <span>Shfaq emrat e bashkive</span>
          </label>
        </div>
      </header>
      <AlbaniaMap onControls={setControls} showMunicipalityLabels={showLabels} />
      <style jsx>{`
        .app-shell {
          background: #ffffff;
          min-height: 100vh;
          margin: 0;
          padding: 0;
          box-sizing: border-box;
          font-family: "Trebuchet MS", "Gill Sans", "Gill Sans MT", Calibri, sans-serif;
        }
        .app-header {
          position: fixed;
          left: 12px;
          top: 12px;
          z-index: 1000;
          padding: 12px 14px;
          border-radius: 12px;
          background: rgba(255, 255, 255, 0.92);
          box-shadow: 0 10px 24px rgba(0, 0, 0, 0.10);
          backdrop-filter: blur(8px);
          max-width: min(560px, calc(100vw - 24px));
        }
        .app-header h1 {
          margin: 0 0 8px;
          font-size: 22px;
          color: #0f172a;
        }
        .app-header p {
          margin: 0;
          color: #334155;
          font-size: 13px;
        }

        .actions {
          margin-top: 10px;
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }

        .btn {
          appearance: none;
          border: 1px solid #cbd5e1;
          background: #ffffff;
          color: #0f172a;
          font-weight: 700;
          font-size: 12px;
          padding: 7px 10px;
          border-radius: 10px;
          cursor: pointer;
        }

        .btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .btn:hover:not(:disabled) {
          background: #f8fafc;
        }

        .toggle {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          font-size: 12px;
          color: #0f172a;
          user-select: none;
        }

        .toggle input {
          width: 14px;
          height: 14px;
        }
      `}</style>
    </div>
  )
}
