import { useEffect, useRef, useState } from 'react'

// Snap coordinates so shared boundaries match.
// Keep this fairly tight to avoid accidental edge-key collisions, which create gaps on the coastline.
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
    weight: 1.5,
    opacity: 0.9,
    interactive: false
  }
}

function buildCountryOutlineStyle() {
  return {
    color: '#0b1220',
    weight: 4,
    opacity: 0.95,
    lineCap: 'round',
    lineJoin: 'round',
    interactive: false
  }
}

function getReadableTextColor(backgroundHex) {
  const hex = String(backgroundHex || '').replace('#', '').trim()
  if (hex.length !== 3 && hex.length !== 6) return '#0b1220'

  const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex
  const r = parseInt(full.slice(0, 2), 16)
  const g = parseInt(full.slice(2, 4), 16)
  const b = parseInt(full.slice(4, 6), 16)
  if (![r, g, b].every(Number.isFinite)) return '#0b1220'

  // Relative luminance (sRGB).
  const srgb = [r, g, b].map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  const luminance = 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2]
  return luminance < 0.5 ? '#ffffff' : '#0b1220'
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

function ringSignedAreaAndCentroid(ring) {
  if (!Array.isArray(ring)) return { areaSigned: 0, centroid: null }
  let n = ring.length
  if (n < 3) return { areaSigned: 0, centroid: null }

  const first = ring[0]
  const last = ring[n - 1]
  if (first && last && first[0] === last[0] && first[1] === last[1]) n -= 1
  if (n < 3) return { areaSigned: 0, centroid: null }

  let sumCross = 0
  let sumCx = 0
  let sumCy = 0

  for (let i = 0; i < n; i += 1) {
    const a = ring[i]
    const b = ring[(i + 1) % n]
    if (!a || !b) continue
    const ax = a[0]
    const ay = a[1]
    const bx = b[0]
    const by = b[1]
    const cross = ax * by - bx * ay
    sumCross += cross
    sumCx += (ax + bx) * cross
    sumCy += (ay + by) * cross
  }

  const areaSigned = sumCross / 2
  if (!Number.isFinite(areaSigned) || areaSigned === 0) return { areaSigned: 0, centroid: null }
  const cx = sumCx / (6 * areaSigned)
  const cy = sumCy / (6 * areaSigned)
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return { areaSigned: 0, centroid: null }
  return { areaSigned, centroid: [cx, cy] }
}

function polygonAreaAbsAndCentroid({ bbox, rings } = {}) {
  if (!Array.isArray(rings) || rings.length === 0) {
    if (bbox) return { areaAbs: 0, centroid: [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2] }
    return { areaAbs: 0, centroid: null }
  }

  let sumA = 0
  let sumX = 0
  let sumY = 0

  for (const ring of rings) {
    const { areaSigned, centroid } = ringSignedAreaAndCentroid(ring)
    if (!centroid) continue
    const a = Math.abs(areaSigned)
    if (!Number.isFinite(a) || a <= 0) continue
    sumA += a
    sumX += centroid[0] * a
    sumY += centroid[1] * a
  }

  if (sumA > 0) return { areaAbs: sumA, centroid: [sumX / sumA, sumY / sumA] }
  if (bbox) return { areaAbs: 0, centroid: [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2] }
  return { areaAbs: 0, centroid: null }
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

export default function AlbaniaMap({ onControls, showMunicipalityLabels }) {
  const mapRef = useRef(null)
  const layerRef = useRef(null)
  const resetRef = useRef(null)
  const recomputeBordersRef = useRef(null)
  const updateLabelsRef = useRef(null)
  const clearLabelsRef = useRef(null)
  const showLabelsRef = useRef(false)
  const [loadError, setLoadError] = useState(null)
  const [loaded, setLoaded] = useState(false)
  const [featureCount, setFeatureCount] = useState(null)

  useEffect(() => {
    showLabelsRef.current = !!showMunicipalityLabels
    if (showLabelsRef.current) {
      updateLabelsRef.current?.()
    } else {
      clearLabelsRef.current?.()
    }
  }, [showMunicipalityLabels])

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

        const outlinePaneName = 'country-outline'
        if (!map.getPane(outlinePaneName)) map.createPane(outlinePaneName)
        const outlinePane = map.getPane(outlinePaneName)
        if (outlinePane) {
          outlinePane.style.zIndex = '450'
          outlinePane.style.pointerEvents = 'none'
        }

        const canvasRenderer = L.canvas({ padding: 0.5 })
        const outlineRenderer = L.svg({ pane: outlinePaneName })

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
        const municipalityNameByCode = new Map()

        for (const feature of data.features) {
          const props = feature?.properties || {}
          const muniCode = String(props.CODE_MUNIC || '')
          const adminId = adminKey(props)
          if (!adminId || !muniCode) continue

          adminAssignedMunicipality.set(adminId, muniCode)
          if (!adminOriginalMunicipality.has(adminId)) adminOriginalMunicipality.set(adminId, muniCode)
          municipalityCodes.add(muniCode)
          getOrCreateSet(municipalityAdjacency, muniCode)
          if (!municipalityNameByCode.has(muniCode)) {
            const nm = String(props.NAME_MUNIC || '').trim()
            if (nm) municipalityNameByCode.set(muniCode, nm)
          }

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
              const bbox = [minLon, minLat, maxLon, maxLat]
              const { areaAbs, centroid } = polygonAreaAbsAndCentroid({ bbox, rings })
              adminGeometryIndex.set(adminId, { bbox, rings, areaAbs, centroid })
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

        const polygonList = Array.from(adminGeometryIndex.entries()).map(([adminId, geom]) => ({
          adminId,
          bbox: geom.bbox,
          rings: geom.rings
        }))

        const containedAdminIds = new Set()

        const computeCurrentMunicipalityBorderLatLngs = () => {
          // Borders between different CURRENT municipalities (interior borders only).
          const borderLatLngs = []
          for (const edge of edgeOwners.values()) {
            const admins = Array.from(edge.admins)

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
            containedAdminIds.add(inner.adminId)
            getOrCreateSet(adminAdjacency, inner.adminId).add(bestContainer)
            getOrCreateSet(adminAdjacency, bestContainer).add(inner.adminId)
          }
        }

        // Country outline (legacy check): draw only edges that are truly exterior to the union of all admin polygons.
        // This is more expensive and can be too strict for some datasets; the primary outline path below does
        // NOT rely on this check and instead derives the outline as the largest closed loop of unshared edges.
        const isExteriorEdge = (edge) => {
          const a = edge.a
          const b = edge.b
          const dx = b[0] - a[0]
          const dy = b[1] - a[1]
          const len = Math.hypot(dx, dy)
          if (!Number.isFinite(len) || len <= 0) return false

          const mx = (a[0] + b[0]) / 2
          const my = (a[1] + b[1]) / 2
          const nx = -dy / len
          const ny = dx / len

          const base = 2e-5
          const maxEps = Math.min(2e-4, len * 0.25)

          // Multiple attempts to avoid landing exactly on the boundary due to floating-point snaps.
          for (let attempt = 0; attempt < 5; attempt += 1) {
            const eps = Math.min(maxEps, base * 2 ** attempt)
            if (!Number.isFinite(eps) || eps <= 0) continue

            const p1 = [mx + nx * eps, my + ny * eps]
            const p2 = [mx - nx * eps, my - ny * eps]
            const in1 = pointInAnyPolygon(p1, polygonList)
            const in2 = pointInAnyPolygon(p2, polygonList)
            if (in1 !== in2) return true
          }

          return false
        }

        const snapPt = (pt) => [
          Math.round(pt[0] * EDGE_SNAP) / EDGE_SNAP,
          Math.round(pt[1] * EDGE_SNAP) / EDGE_SNAP
        ]

        // Stitch exterior edges into longer polylines so the national outline is continuous
        // (drawing thousands of 2-point segments looks like "dots" due to end-caps).
        const outlineAdj = new Map() // pointKey -> Set(pointKey)
        const outlinePointByKey = new Map() // pointKey -> [lon, lat]
        const outlineEdgeList = [] // [{ aKey, bKey }]
        const outlineEdgeSet = new Set() // edgeKey(a,b) where a/b are snapped coords

        const coordKeyFromSnapped = (coord) => coordKey(coord)

        for (const edge of edgeOwners.values()) {
          if (edge.admins.size !== 1) continue
          const a = snapPt(edge.a)
          const b = snapPt(edge.b)
          const aKey = coordKeyFromSnapped(a)
          const bKey = coordKeyFromSnapped(b)
          if (!aKey || !bKey || aKey === bKey) continue
          const eKey = aKey < bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`
          if (outlineEdgeSet.has(eKey)) continue
          outlineEdgeSet.add(eKey)
          outlineEdgeList.push({ aKey, bKey })
          outlinePointByKey.set(aKey, a)
          outlinePointByKey.set(bKey, b)
          getOrCreateSet(outlineAdj, aKey).add(bKey)
          getOrCreateSet(outlineAdj, bKey).add(aKey)
        }

        const visitedOutlineEdges = new Set()
        const edgeKeyFromKeys = (ka, kb) => (ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`)

        const takeNext = (curr, prev) => {
          const neighbors = outlineAdj.get(curr)
          if (!neighbors || neighbors.size === 0) return null
          for (const n of neighbors) {
            if (n === prev) continue
            const ek = edgeKeyFromKeys(curr, n)
            if (visitedOutlineEdges.has(ek)) continue
            return n
          }
          // If the only unvisited edge is back to prev, allow it (useful for tiny rings).
          if (prev) {
            const ek = edgeKeyFromKeys(curr, prev)
            if (!visitedOutlineEdges.has(ek)) return prev
          }
          return null
        }

        const extendForward = (chainKeys) => {
          let guard = 0
          while (guard < 200000) {
            guard += 1
            const n = chainKeys.length
            if (n < 2) break
            const prev = chainKeys[n - 2]
            const curr = chainKeys[n - 1]
            const next = takeNext(curr, prev)
            if (!next) break
            const ek = edgeKeyFromKeys(curr, next)
            visitedOutlineEdges.add(ek)
            chainKeys.push(next)
            if (next === chainKeys[0]) break
          }
        }

        const extendBackward = (chainKeys) => {
          let guard = 0
          while (guard < 200000) {
            guard += 1
            const n = chainKeys.length
            if (n < 2) break
            const curr = chainKeys[0]
            const next = chainKeys[1]
            // Walk backward from curr: pick a neighbor not equal to next.
            const neighbors = outlineAdj.get(curr)
            if (!neighbors || neighbors.size === 0) break
            let prev = null
            for (const nKey of neighbors) {
              if (nKey === next) continue
              const ek = edgeKeyFromKeys(curr, nKey)
              if (visitedOutlineEdges.has(ek)) continue
              prev = nKey
              break
            }
            if (!prev) break
            const ek = edgeKeyFromKeys(curr, prev)
            visitedOutlineEdges.add(ek)
            chainKeys.unshift(prev)
            if (prev === chainKeys[chainKeys.length - 1]) break
          }
        }

        const outlineChains = []
        for (const { aKey, bKey } of outlineEdgeList) {
          const startEk = edgeKeyFromKeys(aKey, bKey)
          if (visitedOutlineEdges.has(startEk)) continue
          visitedOutlineEdges.add(startEk)
          const chainKeys = [aKey, bKey]
          extendForward(chainKeys)
          extendBackward(chainKeys)
          if (chainKeys.length >= 2) outlineChains.push(chainKeys)
        }

        const chainToLatLngs = (chainKeys) => {
          const latLngs = []
          for (const k of chainKeys) {
            const pt = outlinePointByKey.get(k)
            if (!pt) continue
            latLngs.push([pt[1], pt[0]])
          }
          return latLngs
        }

        const getChainStats = (chainKeys) => {
          let minLon = Infinity
          let minLat = Infinity
          let maxLon = -Infinity
          let maxLat = -Infinity
          let seen = 0

          for (const k of chainKeys) {
            const pt = outlinePointByKey.get(k)
            if (!pt) continue
            seen += 1
            minLon = Math.min(minLon, pt[0])
            minLat = Math.min(minLat, pt[1])
            maxLon = Math.max(maxLon, pt[0])
            maxLat = Math.max(maxLat, pt[1])
          }

          const isClosed = chainKeys[0] === chainKeys[chainKeys.length - 1]
          const area = seen > 0 ? Math.max(0, (maxLon - minLon) * (maxLat - minLat)) : 0
          return { isClosed, area, pointCount: chainKeys.length }
        }

        let bestChain = null
        let bestStats = null
        for (const chainKeys of outlineChains) {
          const stats = getChainStats(chainKeys)
          if (!stats.isClosed) continue
          if (!bestStats) {
            bestChain = chainKeys
            bestStats = stats
            continue
          }
          if (stats.area > bestStats.area || (stats.area === bestStats.area && stats.pointCount > bestStats.pointCount)) {
            bestChain = chainKeys
            bestStats = stats
          }
        }

        let countryOutlineLatLngs = []
        if (bestChain) {
          const latLngs = chainToLatLngs(bestChain)
          if (latLngs.length >= 2) countryOutlineLatLngs = [latLngs]
        } else {
          // Fallback: render all stitched unshared-edge polylines.
          countryOutlineLatLngs = outlineChains.map(chainToLatLngs).filter((latLngs) => latLngs.length >= 2)
        }

        // Secondary fallback: if for some reason unshared-edge stitching produced nothing, try the legacy
        // exterior-edge test (more expensive; only run when needed).
        if (countryOutlineLatLngs.length === 0) {
          const legacyAdj = new Map()
          const legacyPointByKey = new Map()
          const legacyEdgeList = []
          const legacyEdgeSet = new Set()

          for (const edge of edgeOwners.values()) {
            if (edge.admins.size !== 1) continue
            if (!isExteriorEdge(edge)) continue
            const a = snapPt(edge.a)
            const b = snapPt(edge.b)
            const aKey = coordKeyFromSnapped(a)
            const bKey = coordKeyFromSnapped(b)
            if (!aKey || !bKey || aKey === bKey) continue
            const eKey = aKey < bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`
            if (legacyEdgeSet.has(eKey)) continue
            legacyEdgeSet.add(eKey)
            legacyEdgeList.push({ aKey, bKey })
            legacyPointByKey.set(aKey, a)
            legacyPointByKey.set(bKey, b)
            getOrCreateSet(legacyAdj, aKey).add(bKey)
            getOrCreateSet(legacyAdj, bKey).add(aKey)
          }

          const legacyVisited = new Set()
          const takeLegacyNext = (curr, prev) => {
            const neighbors = legacyAdj.get(curr)
            if (!neighbors || neighbors.size === 0) return null
            for (const n of neighbors) {
              if (n === prev) continue
              const ek = edgeKeyFromKeys(curr, n)
              if (legacyVisited.has(ek)) continue
              return n
            }
            if (prev) {
              const ek = edgeKeyFromKeys(curr, prev)
              if (!legacyVisited.has(ek)) return prev
            }
            return null
          }

          const extendLegacyForward = (chainKeys) => {
            let guard = 0
            while (guard < 200000) {
              guard += 1
              const n = chainKeys.length
              if (n < 2) break
              const prev = chainKeys[n - 2]
              const curr = chainKeys[n - 1]
              const next = takeLegacyNext(curr, prev)
              if (!next) break
              const ek = edgeKeyFromKeys(curr, next)
              legacyVisited.add(ek)
              chainKeys.push(next)
              if (next === chainKeys[0]) break
            }
          }

          const extendLegacyBackward = (chainKeys) => {
            let guard = 0
            while (guard < 200000) {
              guard += 1
              const n = chainKeys.length
              if (n < 2) break
              const curr = chainKeys[0]
              const next = chainKeys[1]
              const neighbors = legacyAdj.get(curr)
              if (!neighbors || neighbors.size === 0) break
              let prev = null
              for (const nKey of neighbors) {
                if (nKey === next) continue
                const ek = edgeKeyFromKeys(curr, nKey)
                if (legacyVisited.has(ek)) continue
                prev = nKey
                break
              }
              if (!prev) break
              const ek = edgeKeyFromKeys(curr, prev)
              legacyVisited.add(ek)
              chainKeys.unshift(prev)
              if (prev === chainKeys[chainKeys.length - 1]) break
            }
          }

          const legacyLatLngsList = []
          for (const { aKey, bKey } of legacyEdgeList) {
            const startEk = edgeKeyFromKeys(aKey, bKey)
            if (legacyVisited.has(startEk)) continue
            legacyVisited.add(startEk)
            const chainKeys = [aKey, bKey]
            extendLegacyForward(chainKeys)
            extendLegacyBackward(chainKeys)
            const latLngs = []
            for (const k of chainKeys) {
              const pt = legacyPointByKey.get(k)
              if (!pt) continue
              latLngs.push([pt[1], pt[0]])
            }
            if (latLngs.length >= 2) legacyLatLngsList.push(latLngs)
          }

          countryOutlineLatLngs = legacyLatLngsList
        }

        const labelsLayer = L.layerGroup()

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
              if (showLabelsRef.current) updateLabelsRef.current?.()
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

        const countryOutlineLayer = L.polyline(countryOutlineLatLngs, {
          ...buildCountryOutlineStyle(),
          renderer: outlineRenderer,
          pane: outlinePaneName
        })
        countryOutlineLayer.addTo(map)

        layerRef.current = adminLayer

        const clearLabels = () => {
          labelsLayer.clearLayers()
          if (map.hasLayer(labelsLayer)) map.removeLayer(labelsLayer)
        }

        const updateLabels = () => {
          labelsLayer.clearLayers()
          if (!map.hasLayer(labelsLayer)) labelsLayer.addTo(map)

          const muniBounds = new Map()
          const muniAgg = new Map() // muniCode -> { sumA, sumX, sumY, polygons: [] }
          for (const [adminId, layerItem] of adminRegistryById.entries()) {
            const assigned = adminAssignedMunicipality.get(adminId)
            const original = adminOriginalMunicipality.get(adminId)
            const muniCode = String(assigned || original || '').trim()
            if (!muniCode) continue
            const b = layerItem.getBounds?.()
            if (!b || !b.isValid || !b.isValid()) continue

            const existing = muniBounds.get(muniCode)
            if (existing) {
              existing.extend(b)
            } else {
              muniBounds.set(muniCode, b.clone ? b.clone() : b)
            }

            const geom = adminGeometryIndex.get(adminId)
            if (!geom) continue
            if (!muniAgg.has(muniCode)) muniAgg.set(muniCode, { sumA: 0, sumX: 0, sumY: 0, polygons: [] })
            const agg = muniAgg.get(muniCode)
            agg.polygons.push({ bbox: geom.bbox, rings: geom.rings })
            if (geom.areaAbs > 0 && Array.isArray(geom.centroid)) {
              agg.sumA += geom.areaAbs
              agg.sumX += geom.centroid[0] * geom.areaAbs
              agg.sumY += geom.centroid[1] * geom.areaAbs
            }
          }

          const allMuniCodes = new Set([...muniBounds.keys(), ...muniAgg.keys()])
          allMuniCodes.forEach((muniCode) => {
            const bounds = muniBounds.get(muniCode)
            const agg = muniAgg.get(muniCode)
            let centerLatLng = null

            if (agg && agg.sumA > 0 && agg.polygons.length > 0) {
              const centerLonLat = [agg.sumX / agg.sumA, agg.sumY / agg.sumA]
              if (pointInAnyPolygon(centerLonLat, agg.polygons)) {
                centerLatLng = [centerLonLat[1], centerLonLat[0]]
              }
            }

            if (!centerLatLng && agg && agg.polygons.length > 0) {
              let bestPoly = null
              let bestArea = -Infinity
              for (const poly of agg.polygons) {
                const a = (poly.bbox[2] - poly.bbox[0]) * (poly.bbox[3] - poly.bbox[1])
                if (a > bestArea) {
                  bestArea = a
                  bestPoly = poly
                }
              }

              const candidates = bestPoly ? [bestPoly, ...agg.polygons] : agg.polygons
              for (const poly of candidates) {
                const probe = interiorPointForPolygon(poly)
                if (!probe) continue
                if (!pointInPolygon(probe, poly)) continue
                centerLatLng = [probe[1], probe[0]]
                break
              }
            }

            if (!centerLatLng && bounds) {
              const center = bounds.getCenter()
              centerLatLng = [center.lat, center.lng]
            }

            if (!centerLatLng) return
            const label = municipalityNameByCode.get(muniCode) || muniCode
            const fill = getMunicipalityColor(muniCode)
            const textColor = getReadableTextColor(fill)
            const borderColor = textColor === '#ffffff' ? 'rgba(255,255,255,0.38)' : 'rgba(15,23,42,0.24)'
            const textShadow = textColor === '#ffffff' ? '0 1px 2px rgba(0,0,0,0.35)' : 'none'
            const html = `<div class="muni-label-inner" style="background:${fill};color:${textColor};border-color:${borderColor};text-shadow:${textShadow}">${label}</div>`
            const icon = L.divIcon({
              className: 'muni-label',
              html,
              iconSize: null
            })
            L.marker(centerLatLng, { icon, interactive: false, keyboard: false }).addTo(labelsLayer)
          })
        }

        clearLabelsRef.current = clearLabels
        updateLabelsRef.current = updateLabels
        if (showLabelsRef.current) updateLabels()

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
          if (showLabelsRef.current) updateLabels()
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
      updateLabelsRef.current = null
      clearLabelsRef.current = null
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

        :global(.muni-label) {
          background: transparent;
          border: none;
          width: 0;
          height: 0;
          overflow: visible;
          position: relative;
        }

        :global(.muni-label-inner) {
          background: rgba(255, 255, 255, 0.95);
          color: #0b1220;
          border: 1px solid rgba(15, 23, 42, 0.18);
          border-radius: 10px;
          padding: 4px 8px;
          font-weight: 800;
          font-size: 11px;
          line-height: 1.1;
          box-shadow: 0 10px 22px rgba(0, 0, 0, 0.10);
          white-space: nowrap;
          pointer-events: none;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          text-align: center;
          transform: translate(-50%, -50%);
          position: absolute;
          left: 0;
          top: 0;
        }
      `}</style>
    </div>
  )
}
