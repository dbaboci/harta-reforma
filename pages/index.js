import dynamic from 'next/dynamic'
import { useState } from 'react'

const AlbaniaMap = dynamic(() => import('../components/AlbaniaMap'), { ssr: false })

const SHARE_TARGETS = [
  { id: 'instagram', label: 'Instagram' },
  { id: 'facebook', label: 'Facebook' },
  { id: 'tiktok', label: 'TikTok' },
  { id: 'x', label: 'X' }
]

function platformShareUrl(platformId, { text, pageUrl }) {
  const safeText = encodeURIComponent(text || '')
  const safeUrl = encodeURIComponent(pageUrl || '')
  if (platformId === 'x') return `https://x.com/intent/post?text=${safeText}`
  if (platformId === 'facebook') return `https://www.facebook.com/sharer/sharer.php?u=${safeUrl}`
  if (platformId === 'instagram') return 'https://www.instagram.com/'
  if (platformId === 'tiktok') return 'https://www.tiktok.com/upload'
  return ''
}

function Icon({ name }) {
  if (name === 'instagram') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7.5 2h9A5.5 5.5 0 0 1 22 7.5v9A5.5 5.5 0 0 1 16.5 22h-9A5.5 5.5 0 0 1 2 16.5v-9A5.5 5.5 0 0 1 7.5 2Zm0 2A3.5 3.5 0 0 0 4 7.5v9A3.5 3.5 0 0 0 7.5 20h9A3.5 3.5 0 0 0 20 16.5v-9A3.5 3.5 0 0 0 16.5 4h-9Z" />
        <path d="M12 7.25A4.75 4.75 0 1 1 7.25 12 4.76 4.76 0 0 1 12 7.25Zm0 2A2.75 2.75 0 1 0 14.75 12 2.75 2.75 0 0 0 12 9.25Z" />
        <path d="M17.6 6.4a1 1 0 1 1-1 1 1 1 0 0 1 1-1Z" />
      </svg>
    )
  }
  if (name === 'facebook') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M13.5 22v-8h2.7l.5-3H13.5V9.1c0-.9.3-1.6 1.7-1.6H17V4.8c-.3 0-1.5-.1-2.9-.1-2.9 0-4.8 1.8-4.8 5V11H6.7v3h2.6v8h4.2Z" />
      </svg>
    )
  }
  if (name === 'tiktok') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M16.8 2c.6 2.6 2.1 4.1 4.2 4.4v3.2c-1.8.1-3.4-.5-4.7-1.6v6.8c0 4-2.8 7-6.8 7-3.9 0-7-3.1-7-7s3.1-7 7-7c.4 0 .8 0 1.2.1v3.5c-.4-.1-.8-.2-1.2-.2-2 0-3.6 1.6-3.6 3.6s1.6 3.6 3.6 3.6c2.1 0 3.7-1.7 3.7-4V2h3.6Z" />
      </svg>
    )
  }
  if (name === 'x') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M18.9 2H22l-6.8 7.8L22.9 22H16l-5.4-7.1L4.3 22H1.2l7.4-8.4L1 2h7l4.9 6.4L18.9 2Zm-1.1 18h1.7L7.1 4H5.3l12.5 16Z" />
      </svg>
    )
  }
  return null
}

export default function Home() {
  const [controls, setControls] = useState(null)
  const [showLabels, setShowLabels] = useState(true)
  const [shareStatus, setShareStatus] = useState('')
  const [sharing, setSharing] = useState(false)

  const handleShare = async (platformId) => {
    setShareStatus('')
    if (!controls?.loaded || controls?.error) return
    if (typeof controls?.captureScreenshot !== 'function') {
      setShareStatus('Screenshot is not available yet.')
      return
    }

    let popup = null
    try {
      const pageUrl = typeof window !== 'undefined' ? window.location.href : ''
      const text = 'Harta e Re Administrative te Shqiperise'
      const shareUrl = platformShareUrl(platformId, { text, pageUrl })
      if (shareUrl && typeof window !== 'undefined') {
        popup = window.open('', '_blank', 'noopener,noreferrer')
      }

      setSharing(true)
      const blob = await controls.captureScreenshot({ marginRatio: 0.1, background: '#ffffff' })
      const fileName = `harta-${platformId}-${Date.now()}.png`

      const preferNativeShare = platformId === 'instagram' || platformId === 'tiktok'
      if (preferNativeShare && typeof navigator !== 'undefined' && navigator.share && navigator.canShare) {
        const file = new File([blob], fileName, { type: 'image/png' })
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: 'Harta', text })
          if (popup && !popup.closed) popup.close()
          setShareStatus('Opened native share sheet with the screenshot.')
          return
        }
      }

      const objectUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = objectUrl
      a.download = fileName
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000)

      if (popup && !popup.closed) popup.location.href = shareUrl
      setShareStatus('')
    } catch (error) {
      if (popup && !popup.closed) popup.close()
      setShareStatus(`Share failed: ${error?.message || 'Unknown error'}`)
    } finally {
      setSharing(false)
    }
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>Harta e Re Administrative te Shqiperise</h1>
        <p>Kliko njesite administrative per te ndryshuar kufijte e bashkive.</p>
        <div className="actions">
          <button
            type="button"
            className="btn"
            onClick={() => controls?.reset?.()}
            disabled={!controls?.loaded || !!controls?.error}
          >
            Rifillo
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
        <div className="share">
          <div className="share-title">Shpërndaje</div>
          <div className="share-buttons" role="group" aria-label="Share map screenshot">
            {SHARE_TARGETS.map((t) => (
              <button
                key={t.id}
                type="button"
                className="icon-btn"
                onClick={() => handleShare(t.id)}
                disabled={!controls?.loaded || !!controls?.error || sharing}
                aria-label={`Share on ${t.label}`}
                title={t.label}
              >
                <Icon name={t.id} />
              </button>
            ))}
          </div>
          {shareStatus ? <div className="share-status">{shareStatus}</div> : null}
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
          max-width: min(448px, calc(100vw - 24px));
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

        .share {
          margin-top: 10px;
          padding-top: 10px;
          border-top: 1px solid rgba(148, 163, 184, 0.35);
        }

        .share-title {
          font-size: 12px;
          font-weight: 900;
          color: #0f172a;
          margin-bottom: 8px;
          letter-spacing: 0.02em;
          text-transform: uppercase;
        }

        .share-buttons {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }

        .icon-btn {
          width: 38px;
          height: 38px;
          border-radius: 12px;
          border: 1px solid rgba(203, 213, 225, 0.95);
          background: rgba(255, 255, 255, 0.92);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: transform 120ms ease, background 120ms ease, border-color 120ms ease;
        }

        .icon-btn:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }

        .icon-btn:hover:not(:disabled) {
          background: #f8fafc;
          border-color: rgba(148, 163, 184, 0.9);
          transform: translateY(-1px);
        }

        .icon-btn:focus-visible {
          outline: none;
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.35);
        }

        .icon-btn :global(svg) {
          width: 18px;
          height: 18px;
          fill: #0f172a;
        }

        .share-status {
          margin-top: 8px;
          font-size: 12px;
          color: #334155;
        }
      `}</style>
    </div>
  )
}
