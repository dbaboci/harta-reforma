import { useEffect, useRef, useState } from 'react'

// Snap coordinates so shared boundaries match even when polygons aren't numerically identical.
// Too tight => internal borders look like "outer" borders (thick outlines around small units).
// Too loose => false merges. This value is a pragmatic middle ground.
const EDGE_SNAP = 1e5

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

function pointOnSegment(point, a, b, epsilon = 1e-10) {
  const [px, py] = point
  const [ax, ay] = a
  const [bx, by] = b
  const cross = (px - ax) * (by - ay) - (py - ay) * (bx - ax)
  if (Math.abs(cross) > epsilon) return false
  const dot = (px - ax) * (bx - ax) + (py - ay) * (by - ay)
  if (dot < -epsilon) return false
  const lenSq = (bx - ax) * (bx - ax) + (by - ay) * (by - ay)
  if (dot - lenSq > epsilon) return false
  return true
}

function pointInRing(point, ring) {
  // Ray casting with boundary-inclusive check.
  const [x, y] = point
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j]
    const b = ring[i]
    if (pointOnSegment(point, a, b)) return true
    const xi = a[0]
    const yi = a[1]
    const xj = b[0]
    const yj = b[1]
    const intersect = (yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi + 0.0) + xi
    if (intersect) inside = !inside
  }
  return inside
}

function pointInAnyPolygon(point, polygons) {
  for (const poly of polygons) {
    const { bbox, rings } = poly
    if (point[0] < bbox[0] || point[0] > bbox[2] || point[1] < bbox[1] || point[1] > bbox[3]) continue
    for (const ring of rings) {
      if (pointInRing(point, ring)) return true
    }
  }
  return false
}

function pointInPolygon(point, polygon) {
  const { bbox, rings } = polygon
  if (point[0] < bbox[0] || point[0] > bbox[2] || point[1] < bbox[1] || point[1] > bbox[3]) return false
  for (const ring of rings) {
    if (pointInRing(point, ring)) return true
  }
  return false
}

function interiorPointForPolygon(polygon) {
  const { bbox, rings } = polygon
  if (!bbox || !rings || rings.length === 0) return null
  const ring = rings[0]
  if (!Array.isArray(ring) || ring.length < 3) return null

  // Try bbox center first.
  const center = [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2]
  if (pointInRing(center, ring)) return center

  // Try a few edge midpoints (more likely to land inside for concave polygons than centroid).
  const attempts = Math.min(12, ring.length - 1)
  for (let i = 0; i < attempts; i += 1) {
    const a = ring[i]
    const b = ring[i + 1]
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
    if (pointInRing(mid, ring)) return mid
  }

  return center
}

export default function AlbaniaMap({ onControls }) {
  const mapRef = useRef(null)
  const layerRef = useRef(null)
  const resetRef = useRef(null)
  const recomputeBordersRef = useRef(null)
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
        const adminGeometryIndex = new Map() // adminId -> { bbox: [minLon,minLat,maxLon,maxLat], rings: [ring,...] }
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
          if (!adminGeometryIndex.has(adminId)) {
            let minLon = Infinity
            let minLat = Infinity
            let maxLon = -Infinity
            let maxLat = -Infinity
            for (const ring of rings) {
              for (const pt of ring || []) {
                const lon = pt[0]
                const lat = pt[1]
                if (lon < minLon) minLon = lon
                if (lat < minLat) minLat = lat
                if (lon > maxLon) maxLon = lon
                if (lat > maxLat) maxLat = lat
              }
            }
            if (Number.isFinite(minLon)) {
              adminGeometryIndex.set(adminId, { bbox: [minLon, minLat, maxLon, maxLat], rings })
            }
          }
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
                  munis: new Set([muniCode]),
                  exterior: null
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

        // Precompute which "unshared" edges are truly exterior (not inside any other admin polygon).
        // This avoids thick outlines around enclaves where boundaries fail to stitch numerically.
        const polygonList = Array.from(adminGeometryIndex.entries()).map(([adminId, geom]) => ({
          adminId,
          bbox: geom.bbox,
          rings: geom.rings
        }))

        for (const edge of edgeOwners.values()) {
          if (edge.admins.size !== 1) continue
          const [ownerId] = Array.from(edge.admins)
          const owner = adminGeometryIndex.get(ownerId)
          if (!owner) {
            edge.exterior = true
            continue
          }
          const mid = [(edge.a[0] + edge.b[0]) / 2, (edge.a[1] + edge.b[1]) / 2]
          const candidates = []
          for (const poly of polygonList) {
            if (poly.adminId === ownerId) continue
            // Quick bbox reject.
            if (mid[0] < poly.bbox[0] || mid[0] > poly.bbox[2] || mid[1] < poly.bbox[1] || mid[1] > poly.bbox[3]) {
              continue
            }
            candidates.push(poly)
          }
          // If midpoint is inside any other polygon, this edge is not exterior.
          edge.exterior = !pointInAnyPolygon(mid, candidates)
        }

        const computeCurrentMunicipalityBorderLatLngs = () => {
          // Outer outline + borders between different CURRENT municipalities.
          const borderLatLngs = []
          for (const edge of edgeOwners.values()) {
            const admins = Array.from(edge.admins)

            // Outer boundary edge.
            if (admins.length === 1) {
              if (!edge.exterior) continue
              borderLatLngs.push([
                [edge.a[1], edge.a[0]],
                [edge.b[1], edge.b[0]]
              ])
              continue
            }

            // Interior edge: only consider clean edges shared by exactly 2 admin units.
            // If 3+ appear, it's likely an edge-key collision and drawing it causes stray borders.
            if (admins.length !== 2) continue

            // Draw if the two admin units currently belong to different municipalities.
            const muniSet = new Set()
            for (const adminId of admins) {
              const assigned = adminAssignedMunicipality.get(adminId)
              const original = adminOriginalMunicipality.get(adminId)
              const muni = String(assigned || original || '')
              if (muni) muniSet.add(muni)
              if (muniSet.size >= 2) break
            }

            if (muniSet.size >= 2) {
              borderLatLngs.push([
                [edge.a[1], edge.a[0]],
                [edge.b[1], edge.b[0]]
              ])
            }
          }

          return borderLatLngs
        }

        for (const edge of edgeOwners.values()) {
          // Only treat clean shared edges as adjacency. If 3+ admin units appear on a single edge key,
          // that's almost always a snap/topology collision and creates bogus "neighbors".
          if (edge.admins.size !== 2) continue
          const [aAdmin, bAdmin] = Array.from(edge.admins)
          getOrCreateSet(adminAdjacency, aAdmin).add(bAdmin)
          getOrCreateSet(adminAdjacency, bAdmin).add(aAdmin)
        }

        // Enclave handling: if an admin unit is fully contained inside another, add adjacency so it can
        // cycle into the containing unit's municipality assignment.
        for (const inner of polygonList) {
          const probe = interiorPointForPolygon(inner)
          if (!probe) continue

          let bestContainer = null
          let bestArea = Infinity
          for (const outer of polygonList) {
            if (outer.adminId === inner.adminId) continue
            if (probe[0] < outer.bbox[0] || probe[0] > outer.bbox[2] || probe[1] < outer.bbox[1] || probe[1] > outer.bbox[3]) {
              continue
            }
            if (!pointInPolygon(probe, outer)) continue

            const area = (outer.bbox[2] - outer.bbox[0]) * (outer.bbox[3] - outer.bbox[1])
            if (area < bestArea) {
              bestArea = area
              bestContainer = outer.adminId
            }
          }

          if (bestContainer) {
            getOrCreateSet(adminAdjacency, inner.adminId).add(bestContainer)
            getOrCreateSet(adminAdjacency, bestContainer).add(inner.adminId)
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
              recomputeBordersRef.current?.()
            })
          }
        })

        if (cancelled) return
        adminLayer.addTo(map)

        const municipalityBorderLayer = L.polyline(computeCurrentMunicipalityBorderLatLngs(), {
          ...buildMunicipalityBorderStyle(),
          renderer: canvasRenderer
        })
        municipalityBorderLayer.addTo(map)

        layerRef.current = adminLayer

        const recomputeBorders = () => {
          const next = computeCurrentMunicipalityBorderLatLngs()
          municipalityBorderLayer.setLatLngs(next)
          if (typeof municipalityBorderLayer.redraw === 'function') municipalityBorderLayer.redraw()
        }
        recomputeBordersRef.current = recomputeBorders

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
          recomputeBorders()
        }

        if (typeof onControls === 'function') {
          onControls({
            reset: () => resetRef.current?.(),
            recomputeBorders: () => recomputeBordersRef.current?.(),
            loaded: true,
            error: null
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
          const message = `Failed to load map data: ${error?.message || 'Unknown error'}`
          setLoadError(message)
          setLoaded(true)
          if (typeof onControls === 'function') {
            onControls({
              reset: () => {},
              recomputeBorders: () => {},
              loaded: true,
              error: message
            })
          }
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
      recomputeBordersRef.current = null
      if (typeof onControls === 'function') onControls(null)
      if (map) map.remove()
    }
  }, [])

  return (
    <div className="map-wrapper">
      <div ref={mapRef} className="map-root" />
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
      `}</style>
    </div>
  )
}
