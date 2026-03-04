import { useEffect, useRef, useState } from 'react'

// Snap coordinates so shared boundaries match. Keep this fairly tight so we don't create
// false "adjacencies" that make cycling jump to unrelated municipalities.
const EDGE_SNAP = 1e6

function coordKey(coord) {
  return `${Math.round(coord[0] * EDGE_SNAP)},${Math.round(coord[1] * EDGE_SNAP)}`
}

function edgeKey(a, b) {
  const first = coordKey(a)
  const second = coordKey(b)
  return first < second ? `${first}|${second}` : `${second}|${first}`
}

function getRings(geometry = {}) {
  if (!geometry || !geometry.coordinates) return []
  // Only use outer rings for boundary detection. Inner rings ("holes") would otherwise
  // be incorrectly treated as municipality borders.
  if (geometry.type === 'Polygon') return geometry.coordinates.slice(0, 1)
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.map((ringGroups) => ringGroups[0]).filter(Boolean)
  return []
}

function hslToHex(h, s, l) {
  const ss = s / 100
  const ll = l / 100
  const c = (1 - Math.abs(2 * ll - 1)) * ss
  const hh = ((h % 360) + 360) % 360
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1))
  const m = ll - c / 2
  let r1 = 0
  let g1 = 0
  let b1 = 0

  if (hh < 60) {
    r1 = c
    g1 = x
  } else if (hh < 120) {
    r1 = x
    g1 = c
  } else if (hh < 180) {
    g1 = c
    b1 = x
  } else if (hh < 240) {
    g1 = x
    b1 = c
  } else if (hh < 300) {
    r1 = x
    b1 = c
  } else {
    r1 = c
    b1 = x
  }

  const r = Math.round((r1 + m) * 255)
  const g = Math.round((g1 + m) * 255)
  const b = Math.round((b1 + m) * 255)
  const toHex = (v) => v.toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

function generateDistinctPalette(count) {
  const colors = []
  for (let i = 0; i < count; i += 1) {
    const hue = (i * 360) / count
    colors.push({ hue, hex: hslToHex(hue, 72, 52) })
  }
  return colors
}

function hueDistance(a, b) {
  const d = Math.abs(a - b) % 360
  return Math.min(d, 360 - d)
}

function assignMunicipalityColorsMaxContrast(municipalityList, municipalityAdj, paletteEntries) {
  const degree = (code) => municipalityAdj.get(code)?.size || 0
  const ordered = [...municipalityList].sort((a, b) => {
    const db = degree(b)
    const da = degree(a)
    if (db !== da) return db - da
    return a.localeCompare(b)
  })

  const available = paletteEntries.slice()
  const assigned = new Map()
  const usedHues = []

  for (const code of ordered) {
    const neighbors = municipalityAdj.get(code) || new Set()
    const neighborHues = []
    for (const neighbor of neighbors) {
      const entry = assigned.get(neighbor)
      if (entry) neighborHues.push(entry.hue)
    }

    let bestIdx = 0
    let bestScore = -1
    for (let i = 0; i < available.length; i += 1) {
      const cand = available[i]
      let score = 180
      if (neighborHues.length > 0) {
        score = neighborHues.reduce((minDist, h) => Math.min(minDist, hueDistance(cand.hue, h)), 180)
      } else if (usedHues.length > 0) {
        score = usedHues.reduce((minDist, h) => Math.min(minDist, hueDistance(cand.hue, h)), 180)
      }

      if (score > bestScore) {
        bestScore = score
        bestIdx = i
      }
    }

    const chosen = available.splice(bestIdx, 1)[0]
    assigned.set(code, chosen)
    usedHues.push(chosen.hue)
  }

  return assigned
}

function buildAdminStyle(fillColor) {
  return {
    fillColor,
    fillOpacity: 0.75,
    color: '#334155',
    weight: 1,
    opacity: 0.8
  }
}

function buildMunicipalityBorderStyle() {
  return {
    color: '#0f172a',
    weight: 3,
    opacity: 0.9,
    interactive: false
  }
}

function mapDataErrors(data) {
  if (!data || typeof data !== 'object' || data.type !== 'FeatureCollection') {
    return 'GeoJSON must be a FeatureCollection'
  }
  if (!Array.isArray(data.features)) return 'GeoJSON must expose a features array'
  if (data.features.length === 0) return 'GeoJSON contains no features'
  return null
}

function getOrCreateSet(map, key) {
  if (!map.has(key)) map.set(key, new Set())
  return map.get(key)
}

function adminKey(props) {
  const muni = String(props?.CODE_MUNIC || '').trim()
  const admun = String(props?.CODE_ADMUN || '').trim()
  if (!muni || !admun) return ''
  return `${muni}:${admun}`
}

export default function AlbaniaMap() {
  const mapRef = useRef(null)
  const layerRef = useRef(null)
  const resetRef = useRef(null)
  const [loadError, setLoadError] = useState(null)
  const [loaded, setLoaded] = useState(false)
  const [featureCount, setFeatureCount] = useState(null)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return

    let cancelled = false
    let map
    let rafId = null
    let timeoutId = null

    const run = async () => {
      try {
        const leafletModule = await import('leaflet')
        const L = leafletModule.default || leafletModule
        if (cancelled) return

        const mapContainer = mapRef.current
        if (!mapContainer) return

        // Fallback view so something is visible even if fitBounds is delayed/cancelled in dev refresh.
        // Disable built-in UI controls; we render our own overlay UI.
        map = L.map(mapContainer, {
          preferCanvas: true,
          zoomControl: false,
          attributionControl: false
        }).setView([41.34, 20.0], 7)

        const canvasRenderer = L.canvas({ padding: 0.5 })

        const response = await fetch('/adm_units_munis_with_polygons.geojson')
        if (!response.ok) throw new Error(`GET ${response.status}`)

        const data = await response.json()
        if (cancelled) return
        const dataError = mapDataErrors(data)
        if (dataError) throw new Error(dataError)

        setFeatureCount(data.features.length)

        const adminRegistryById = new Map()
        const adminAssignedMunicipality = new Map() // adminId -> municipalityCode
        const adminOriginalMunicipality = new Map() // adminId -> municipalityCode
        const edgeOwners = new Map()
        const adminAdjacency = new Map()
        const municipalityCodes = new Set()
        const municipalityAdjacency = new Map()

        for (const feature of data.features) {
          const props = feature?.properties || {}
          const muniCode = String(props.CODE_MUNIC || '')
          const adminId = adminKey(props)
          if (!adminId || !muniCode) continue

          adminAssignedMunicipality.set(adminId, muniCode)
          if (!adminOriginalMunicipality.has(adminId)) adminOriginalMunicipality.set(adminId, muniCode)
          municipalityCodes.add(muniCode)
          getOrCreateSet(municipalityAdjacency, muniCode)

          const rings = getRings(feature.geometry)
          for (const ring of rings) {
            if (!Array.isArray(ring) || ring.length < 4) continue

            for (let i = 0; i < ring.length - 1; i += 1) {
              const a = ring[i]
              const b = ring[i + 1]
              const key = edgeKey(a, b)

              const seen = edgeOwners.get(key)
              if (seen) {
                seen.admins.add(adminId)
                seen.munis.add(muniCode)
              } else {
                edgeOwners.set(key, {
                  a,
                  b,
                  admins: new Set([adminId]),
                  munis: new Set([muniCode])
                })
              }
            }
          }
        }

        const municipalityList = Array.from(municipalityCodes).sort((a, b) => a.localeCompare(b))
        const palette = generateDistinctPalette(Math.max(61, municipalityList.length))

        for (const edge of edgeOwners.values()) {
          if (edge.munis.size >= 2) {
            const munis = Array.from(edge.munis)
            for (let i = 0; i < munis.length; i += 1) {
              for (let j = i + 1; j < munis.length; j += 1) {
                const a = String(munis[i])
                const b = String(munis[j])
                getOrCreateSet(municipalityAdjacency, a).add(b)
                getOrCreateSet(municipalityAdjacency, b).add(a)
              }
            }
          }
        }

        const assignedColors = assignMunicipalityColorsMaxContrast(municipalityList, municipalityAdjacency, palette)
        const municipalityColor = new Map()
        for (const municipalityCode of municipalityList) {
          municipalityColor.set(municipalityCode, assignedColors.get(municipalityCode)?.hex || palette[0].hex)
        }

        const getMunicipalityColor = (municipalityCode) => {
          return municipalityColor.get(String(municipalityCode)) || palette[0].hex
        }

        // Draw only borders between different municipalities (based on original CODE_MUNIC).
        // Avoid treating "unshared" edges as borders, since coordinate mismatches can make internal edges look unshared.
        const municipalityBorderLatLngs = []
        for (const edge of edgeOwners.values()) {
          if (edge.munis.size < 2) continue
          municipalityBorderLatLngs.push([
            [edge.a[1], edge.a[0]],
            [edge.b[1], edge.b[0]]
          ])
        }

        for (const edge of edgeOwners.values()) {
          const admins = Array.from(edge.admins)
          if (admins.length >= 2) {
            for (let i = 0; i < admins.length; i += 1) {
              for (let j = i + 1; j < admins.length; j += 1) {
                const aAdmin = admins[i]
                const bAdmin = admins[j]
                getOrCreateSet(adminAdjacency, aAdmin).add(bAdmin)
                getOrCreateSet(adminAdjacency, bAdmin).add(aAdmin)
              }
            }
          }
        }

        const adminLayer = L.geoJSON(data, {
          renderer: canvasRenderer,
          onEachFeature: (feature, layerItem) => {
            const props = feature?.properties || {}
            const muniCode = String(props.CODE_MUNIC || '')
            const adminId = adminKey(props)

            if (!adminId) return

            adminRegistryById.set(adminId, layerItem)
            const initialColor = getMunicipalityColor(muniCode)
            layerItem.setStyle(buildAdminStyle(initialColor))

            layerItem.bindTooltip(props.NAME_ADMIN || `Admin Unit ${adminId}`)

            layerItem.on('click', () => {
              const currentMunicipality = String(adminAssignedMunicipality.get(adminId) || muniCode)
              const originalMunicipality = String(adminOriginalMunicipality.get(adminId) || muniCode)

              // Recompute candidates on every click:
              // home municipality + the CURRENT municipalities of adjacent admin units.
              const candidates = new Set([originalMunicipality])
              const neighbors = adminAdjacency.get(adminId) || new Set()
              for (const neighborId of neighbors) {
                const neighborAssigned = adminAssignedMunicipality.get(neighborId)
                const neighborOriginal = adminOriginalMunicipality.get(neighborId)
                const muni = String(neighborAssigned || neighborOriginal || '')
                if (muni) candidates.add(muni)
              }

              if (candidates.size < 2) return

              const choices = Array.from(candidates).sort((a, b) => a.localeCompare(b))
              const effectiveCurrent = choices.includes(currentMunicipality) ? currentMunicipality : originalMunicipality
              const currentIndex = choices.indexOf(effectiveCurrent)
              const nextMunicipality = choices[(Math.max(0, currentIndex) + 1) % choices.length]

              adminAssignedMunicipality.set(adminId, nextMunicipality)
              layerItem.setStyle(buildAdminStyle(getMunicipalityColor(nextMunicipality)))
            })
          }
        })

        if (cancelled) return
        adminLayer.addTo(map)

        const municipalityBorderLayer = L.polyline(municipalityBorderLatLngs, {
          ...buildMunicipalityBorderStyle(),
          renderer: canvasRenderer
        })
        municipalityBorderLayer.addTo(map)

        layerRef.current = adminLayer

        resetRef.current = () => {
          adminAssignedMunicipality.clear()
          adminLayer.eachLayer((layerItem) => {
            const props = layerItem?.feature?.properties || {}
            const fromGeoJson = String(props.CODE_MUNIC || '')
            const adminId = adminKey(props)
            if (!adminId || !fromGeoJson) return

            const originalMunicipality = String(adminOriginalMunicipality.get(adminId) || fromGeoJson)
            adminAssignedMunicipality.set(adminId, originalMunicipality)
            layerItem.setStyle(buildAdminStyle(getMunicipalityColor(originalMunicipality)))
          })
        }

        const bounds = adminLayer.getBounds()
        map.invalidateSize()
        if (bounds?.isValid && bounds.isValid()) {
          const doFit = () => {
            if (cancelled || !map) return
            map.invalidateSize()
            const freshBounds = adminLayer.getBounds()
            if (!freshBounds?.isValid || !freshBounds.isValid()) return
            map.fitBounds(freshBounds, { padding: [24, 24], maxZoom: 12 })
          }
          if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
            rafId = window.requestAnimationFrame(doFit)
            timeoutId = window.setTimeout(doFit, 0)
          } else {
            doFit()
          }
        }

        setLoaded(true)
      } catch (error) {
        if (!cancelled) {
          setLoadError(`Failed to load map data: ${error?.message || 'Unknown error'}`)
          setLoaded(true)
          if (map && map.remove) map.remove()
        }
      }
    }

    run()

    return () => {
      cancelled = true
      if (typeof window !== 'undefined') {
        if (rafId !== null && typeof window.cancelAnimationFrame === 'function') window.cancelAnimationFrame(rafId)
        if (timeoutId !== null) window.clearTimeout(timeoutId)
      }
      layerRef.current?.remove()
      resetRef.current = null
      if (map) map.remove()
    }
  }, [])

  return (
    <div className="map-wrapper">
      <div ref={mapRef} className="map-root" />
      <aside className="map-legend">
        <h2>Albania Admin Units</h2>
        <p>Each municipality has a unique color (61-color palette). Admin units start colored by their municipality.</p>
        <p>Click an admin unit on a municipality border to cycle it into adjacent municipalities (based on current neighbors).</p>
        <button
          className="reset"
          type="button"
          onClick={() => resetRef.current?.()}
          disabled={!loaded || !!loadError}
        >
          Reset
        </button>
        {featureCount !== null && <p>Loaded features: {featureCount}</p>}
        {loadError && <p className="error">{loadError}</p>}
        {!loaded && !loadError && <p>Loading Albania administrative map…</p>}
      </aside>
      <style jsx>{`
        .map-wrapper {
          position: fixed;
          inset: 0;
          width: 100vw;
          height: 100vh;
          overflow: hidden;
          background: #ffffff;
        }

        .map-root {
          width: 100vw;
          height: 100vh;
          display: block;
          background: #ffffff;
        }

        .map-legend {
          position: absolute;
          top: 12px;
          right: 12px;
          background: rgba(255, 255, 255, 0.95);
          padding: 10px 12px;
          border-radius: 10px;
          z-index: 800;
          max-width: 360px;
          font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
          line-height: 1.35;
          font-size: 12px;
          box-shadow: 0 10px 24px rgba(0, 0, 0, .08);
          transition: transform 160ms ease, opacity 160ms ease;
          opacity: 0.9;
        }

        .map-legend:hover {
          opacity: 1;
          transform: translateY(-1px);
        }

        .map-legend h2 {
          margin: 0 0 6px;
          font-size: 14px;
        }

        .map-legend p {
          margin: 0 0 6px;
          color: #334155;
        }

        .map-legend p:last-child {
          margin-bottom: 0;
        }

        .reset {
          appearance: none;
          border: 1px solid #cbd5e1;
          background: #ffffff;
          color: #0f172a;
          font-weight: 700;
          font-size: 12px;
          padding: 6px 10px;
          border-radius: 10px;
          cursor: pointer;
          margin: 2px 0 8px;
        }

        .reset:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .reset:hover:not(:disabled) {
          background: #f8fafc;
        }

        .error {
          color: #991b1b;
          font-weight: 600;
        }
      `}</style>
    </div>
  )
}
