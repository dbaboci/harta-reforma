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
          min-height: 100vh;
          background: #ffffff;
          padding: 16px;
          box-sizing: border-box;
          font-family: "Trebuchet MS", "Gill Sans", "Gill Sans MT", Calibri, sans-serif;
        }
        .app-header {
          max-width: 1100px;
          margin: 0 auto 12px;
          padding: 0 4px 8px;
        }
        .app-header h1 {
          margin: 0 0 8px;
          font-size: 30px;
          color: #0f172a;
        }
        .app-header p {
          margin: 0;
          color: #334155;
        }
      `}</style>
    </div>
  )
}
