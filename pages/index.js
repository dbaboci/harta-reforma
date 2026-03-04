import dynamic from 'next/dynamic'

const AlbaniaMap = dynamic(() => import('../components/AlbaniaMap'), { ssr: false })

export default function Home() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>Krijo Harten e re Administrative te Shqiperise</h1>
        <p>Kliko njesite administrative per te ndryshuar kufijte e bashkive.</p>
      </header>
      <AlbaniaMap />
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
      `}</style>
    </div>
  )
}
