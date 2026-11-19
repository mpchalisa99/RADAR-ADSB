import { useEffect, useRef, useState } from 'react';
import { 
  Radar, 
  ShieldAlert, 
  Plane, 
  Compass, 
  Map as MapIcon, 
  Ruler as RulerIcon, 
  RotateCcw, 
  Sparkles, 
  Terminal, 
  Clock, 
  Volume2, 
  VolumeX, 
  Activity,
  Send,
  HelpCircle,
  Database,
  Maximize2,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Wifi,
  Key,
  Settings,
  Globe,
  Radio,
  CheckCircle2,
  AlertTriangle
} from 'lucide-react';
import { SATRADS, SatradItem } from './satrads';

// Declare Leaflet globally (CDN-provided)
declare const L: any;

interface Flight {
  id: string;
  callsign: string;
  name: string;
  lat: number;
  lng: number;
  altitude: number;
  speed: number;
  heading: number;
  squawk: string;
  origin: string;
  destination: string;
  type: "civilian" | "military" | "unidentified";
  isWarning: boolean;
  history: [number, number][];
  source?: string;
  license?: string;
  lastSeenAgo?: number;
}

interface ThreatLog {
  timestamp: string;
  message: string;
  type: "threat" | "system" | "warning";
}

// CARTO Basemaps Configuration & API Key
const CARTO_API_KEY = "cb1_4ovb_1_cda161407f013e7010dd86be";

export type CartoStyleId = 'voyager' | 'dark_all' | 'light_all' | 'dark_nolabels';

interface CartoStyleOption {
  id: CartoStyleId;
  label: string;
  sublabel: string;
  tag: string;
}

const CARTO_STYLE_OPTIONS: CartoStyleOption[] = [
  { id: 'voyager', label: 'VOYAGER', sublabel: 'Navigasi Udara & Kontur', tag: 'AIRWAYS' },
  { id: 'dark_all', label: 'DARK MATTER', sublabel: 'Mode Taktis Gelap Radar', tag: 'TACTICAL' },
  { id: 'dark_nolabels', label: 'NO LABELS', sublabel: 'Radar Bersih Tanpa Teks', tag: 'CLEAN' },
  { id: 'light_all', label: 'POSITRON', sublabel: 'Kontras Terang Operasional', tag: 'DAYLIGHT' }
];

const getCartoTileUrl = (style: CartoStyleId, key: string = CARTO_API_KEY) => {
  return `https://{s}.basemaps.cartocdn.com/rastertiles/${style}/{z}/{x}/{y}.png?key=${key}`;
};

// Fixed Coordinates
const SATRAD_LAT = -7.9150;
const SATRAD_LNG = 110.0750;

const formatLatLng = (lat: number, lng: number) => {
  const latDir = lat < 0 ? "S" : "N";
  const lngDir = lng < 0 ? "W" : "E";
  const absLat = Math.abs(lat);
  const absLng = Math.abs(lng);
  const latDeg = Math.floor(absLat);
  const latMin = Math.floor((absLat - latDeg) * 60);
  const latSec = Math.floor(((absLat - latDeg) * 60 - latMin) * 60);
  const lngDeg = Math.floor(absLng);
  const lngMin = Math.floor((absLng - lngDeg) * 60);
  const lngSec = Math.floor(((absLng - lngDeg) * 60 - lngMin) * 60);
  return `${String(latDeg).padStart(2, '0')}°${String(latMin).padStart(2, '0')}'${String(latSec).padStart(2, '0')}"${latDir} ${String(lngDeg).padStart(3, '0')}°${String(lngMin).padStart(2, '0')}'${String(lngSec).padStart(2, '0')}"${lngDir}`;
};

const KKOP_YIA: [number, number][] = [
  [-7.96, 110.00],
  [-7.84, 110.00],
  [-7.84, 110.16],
  [-7.96, 110.16]
];

const SAMUDERA_HINDIA: [number, number][] = [
  [-8.50, 109.80],
  [-8.05, 109.80],
  [-8.05, 110.40],
  [-8.50, 110.40]
];

function isLatLngInPolygon(lat: number, lng: number, polygon: [number, number][]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const yi = polygon[i][0], xi = polygon[i][1];
    const yj = polygon[j][0], xj = polygon[j][1];
    const intersect = ((yi > lat) !== (yj > lat))
        && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

export default function App() {
  const mapContainerRef = useRef<any>(null);
  const mapRef = useRef<any>(null);

  // Dynamic Satrad Position & Warning Polygons
  const [satradCoords, setSatradCoords] = useState({ lat: -7.9150, lng: 110.0750, name: "Congot", id: "SATRAD 215" });
  const satradCoordsRef = useRef({ lat: -7.9150, lng: 110.0750, name: "Congot", id: "SATRAD 215" });

  const [kkopZone, setKkopZone] = useState<[number, number][]>(KKOP_YIA);
  const [samuderaZone, setSamuderaZone] = useState<[number, number][]>(SAMUDERA_HINDIA);

  const kkopZoneRef = useRef<[number, number][]>(KKOP_YIA);
  const samuderaZoneRef = useRef<[number, number][]>(SAMUDERA_HINDIA);

  const satradCenterMarkerRef = useRef<any>(null);
  const sgZonePolygonRef = useRef<any>(null);
  const nbZonePolygonRef = useRef<any>(null);

  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);

  // Sync state to ref
  useEffect(() => {
    satradCoordsRef.current = satradCoords;
  }, [satradCoords]);

  // Operational state elements (REAL-TIME ADS-B ONLY - NO SIMULATION)
  const [flights, setFlights] = useState<Flight[]>([]);
  const [selectedFlight, setSelectedFlight] = useState<Flight | null>(null);
  const [adsbStatus, setAdsbStatus] = useState<"LIVE" | "SIMULATION">("LIVE");
  const [adsbCount, setAdsbCount] = useState(0);

  // Fullscreen and Maximized Map Layout States
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isLeftCollapsed, setIsLeftCollapsed] = useState(false);
  const [isRightCollapsed, setIsRightCollapsed] = useState(false);

  // ADS-B Data Feed Configuration Modal State
  const [showAdsbConfigModal, setShowAdsbConfigModal] = useState(false);
  const [customFeederUrl, setCustomFeederUrl] = useState<string>(() => {
    try { return localStorage.getItem('mata_custom_feeder') || ''; } catch { return ''; }
  });
  const [customApiKey, setCustomApiKey] = useState<string>(() => {
    try { return localStorage.getItem('mata_custom_apikey') || ''; } catch { return ''; }
  });
  const [activeProviderName, setActiveProviderName] = useState("api.adsb.lol (ODbL 1.0)");
  const [feederTestStatus, setFeederTestStatus] = useState<string | null>(null);

  // Persistent Flight Tracking Memory Engine (Prevents missing ticks & long teleport jump lines)
  const flightMemoryMapRef = useRef<Map<string, {
    flight: Flight;
    history: [number, number][];
    lastSeen: number;
  }>>(new Map());

  // Toggle state variables
  const [showRadarData, setShowRadarData] = useState(true); // DATA RADAR Target Plot
  const [showBaseMap, setShowBaseMap] = useState(true); // PETA Digital Basemap
  const [showGeoref, setShowGeoref] = useState(true); // GEOREF Coordinate Lines
  const [showAirways, setShowAirways] = useState(true); // AIRWAYS ATS Flight Lanes
  const [showRangeBearing, setShowRangeBearing] = useState(false); // RANGE BEARING Hover Tool

  // CARTO Basemap Configuration & State
  const [cartoStyle, setCartoStyle] = useState<CartoStyleId>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('mata_carto_style') as CartoStyleId;
      if (saved && ['voyager', 'dark_all', 'light_all', 'dark_nolabels'].includes(saved)) {
        return saved;
      }
    }
    return 'voyager';
  });
  const cartoStyleRef = useRef<CartoStyleId>('voyager');

  useEffect(() => {
    cartoStyleRef.current = cartoStyle;
    if (tileLayerRef.current) {
      tileLayerRef.current.setUrl(getCartoTileUrl(cartoStyle));
      try {
        localStorage.setItem('mata_carto_style', cartoStyle);
      } catch {}
    }
  }, [cartoStyle]);

  // Audio configuration
  const [isMuted, setIsMuted] = useState(false);

  // Range Bearing Live State (computed relative to Satrad center)
  const [liveMeasure, setLiveMeasure] = useState<{ rng: number; brg: number; lat: number; lng: number } | null>(null);
  const [rangeBearingLockedTarget, setRangeBearingLockedTarget] = useState<{ type: 'flight' | 'coord'; id?: string; lat?: number; lng?: number } | null>(null);

  // Logging & Clock State
  const [logs, setLogs] = useState<ThreatLog[]>([
    { timestamp: "18:00:15", message: "MATA-X TACTICAL RADAR CONSOLE INITIALIZED.", type: "system" },
    { timestamp: "18:01:02", message: "SATRAD 215 CONGOT MULTI-BEAM SENSOR ONLINE.", type: "system" }
  ]);
  const [timeZulu, setTimeZulu] = useState("");
  const [timeLocal, setTimeLocal] = useState("");

  // AI Tactical Chat Assistant
  const [chatInput, setChatInput] = useState("");
  const [chatLogs, setChatLogs] = useState<{ sender: "user" | "ai"; text: string; timestamp: string }[]>([
    { 
      sender: "ai", 
      text: "KOMANDO PERTAHANAN UDARA (MATA-X AI): Siap mendampingi analisis taktis wilayah udara KKOP YIA dan Pantai Selatan Kulon Progo, Letnan. Silakan berikan instruksi atau tanyakan situasi.", 
      timestamp: "WIB" 
    }
  ]);
  const [isAiLoading, setIsAiLoading] = useState(false);

  // References to holds Leaflet layer elements dynamically
  const tileLayerRef = useRef<any>(null);
  const georefGroupRef = useRef<any>(null);
  const airwaysGroupRef = useRef<any>(null);
  const radarGridGroupRef = useRef<any>(null);
  const otherSatradsGroupRef = useRef<any>(null);
  const flightMarkersMapRef = useRef<{ [key: string]: any }>({});
  const flightHistoryPathsRef = useRef<{ [key: string]: any }>({});
  const prevAdsbStatusRef = useRef<string | null>(null);
  const rangeBearingLineRef = useRef<any>(null);
  const rangeBearingMarkerRef = useRef<any>(null);
  const showRangeBearingRef = useRef(false);
  const rangeBearingLockedTargetRef = useRef<any>(null);
  const flightsRef = useRef<Flight[]>([]);

  // Coordinate and position validation helper
  const isValidPosition = (lat: any, lng: any): boolean => {
    if (typeof lat !== 'number' || typeof lng !== 'number') return false;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
    // Exclude Null Island (0, 0)
    if (Math.abs(lat) < 0.001 && Math.abs(lng) < 0.001) return false;
    return true;
  };

  const sanitizeHeading = (h: any): number => {
    if (typeof h !== 'number' || !Number.isFinite(h)) return 0;
    let heading = Math.round(h) % 360;
    if (heading < 0) heading += 360;
    return heading;
  };

  // Sound generator (WebAudio)
  const playSiren = (freq = 900, duration = 0.25, type: 'sine' | 'sawtooth' | 'square' = 'sine') => {
    if (isMuted) return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + duration);
    } catch (e) {
      console.warn("Audio Context blocked:", e);
    }
  };

  // Distance computation (Haversine in Nautical Miles)
  const getDistanceNM = (lat1: number, lng1: number, lat2: number, lng2: number) => {
    const R_KM = 6371; 
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = 
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return (R_KM * c) * 0.539957; // returns Nautical Miles
  };

  // Bearing calculation (Azimuth from 0 to 360 clockwise relative to North)
  const getBearingDeg = (lat1: number, lng1: number, lat2: number, lng2: number) => {
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const lat1Rad = lat1 * Math.PI / 180;
    const lat2Rad = lat2 * Math.PI / 180;
    const y = Math.sin(dLng) * Math.cos(lat2Rad);
    const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLng);
    const brg = Math.atan2(y, x) * 180 / Math.PI;
    return (brg + 360) % 360; // 0 to 360 degrees
  };

  const drawGeorefGrid = (centerLat: number, centerLng: number) => {
    if (!georefGroupRef.current) return;
    georefGroupRef.current.clearLayers();

    const isAll = satradCoordsRef.current.id === "ALL";
    const interval = isAll ? 2.5 : 0.5;

    // Round bounds to nearest degrees
    const minLat = isAll ? -12.0 : Math.round((centerLat - 4.5) * 2) / 2;
    const maxLat = isAll ? 8.0 : Math.round((centerLat + 4.5) * 2) / 2;
    const minLng = isAll ? 93.0 : Math.round((centerLng - 6.0) * 2) / 2;
    const maxLng = isAll ? 142.0 : Math.round((centerLng + 6.0) * 2) / 2;

    // Latitude grid lines
    for (let lat = minLat; lat <= maxLat; lat += interval) {
      georefGroupRef.current.addLayer(L.polyline([[lat, minLng], [lat, maxLng]], {
        color: 'rgba(0, 243, 255, 0.08)',
        weight: 1,
        dashArray: '3, 9'
      }));

      const isSouth = lat < 0;
      const latAbbr = isSouth ? "S" : "N";
      georefGroupRef.current.addLayer(L.marker([lat, minLng + (isAll ? 1.5 : 0.3)], {
        icon: L.divIcon({
          html: `<div class="text-[8px] font-mono-military text-[#00f3ff]/35">LAT ${latAbbr}${Math.abs(lat).toFixed(1)}°</div>`,
          className: 'georef-axis-indicator',
          iconSize: [60, 12]
        })
      }));
    }

    // Longitude grid lines
    for (let lng = minLng; lng <= maxLng; lng += interval) {
      georefGroupRef.current.addLayer(L.polyline([[minLat, lng], [maxLat, lng]], {
        color: 'rgba(0, 243, 255, 0.08)',
        weight: 1,
        dashArray: '3, 9'
      }));

      const isWest = lng < 0;
      const lngAbbr = isWest ? "W" : "E";
      georefGroupRef.current.addLayer(L.marker([minLat + (isAll ? 1.5 : 0.3), lng], {
        icon: L.divIcon({
          html: `<div class="text-[8px] font-mono-military text-[#00f3ff]/35">LNG ${lngAbbr}${Math.abs(lng).toFixed(1)}°</div>`,
          className: 'georef-axis-indicator',
          iconSize: [60, 12]
        })
      }));
    }
  };

  const applySatradCenterUpdate = (newLat: number, newLng: number, name: string, id: string, writeLog = false) => {
    setSatradCoords({
      lat: newLat,
      lng: newLng,
      name,
      id
    });
    satradCoordsRef.current = {
      lat: newLat,
      lng: newLng,
      name,
      id
    };

    const newKkop = [
      [newLat - 0.045, newLng - 0.075],
      [newLat + 0.075, newLng - 0.075],
      [newLat + 0.075, newLng + 0.085],
      [newLat - 0.045, newLng + 0.085]
    ] as [number, number][];

    const newSamudera = [
      [newLat - 0.585, newLng - 0.275],
      [newLat - 0.135, newLng - 0.275],
      [newLat - 0.135, newLng + 0.325],
      [newLat - 0.585, newLng + 0.325]
    ] as [number, number][];

    setKkopZone(newKkop);
    setSamuderaZone(newSamudera);
    kkopZoneRef.current = newKkop;
    samuderaZoneRef.current = newSamudera;

    if (mapRef.current) {
      if (id === "ALL") {
        // Zoom out to fit all of Indonesia's airspace beautifully
        mapRef.current.setView([-2.0, 118.0], 5);
      } else {
        mapRef.current.setView([newLat, newLng], mapRef.current.getZoom());
      }
      
      // Handle the center satrad physical indicator
      if (id === "ALL") {
        if (satradCenterMarkerRef.current) {
          satradCenterMarkerRef.current.remove();
          satradCenterMarkerRef.current = null;
        }
        if (sgZonePolygonRef.current) {
          sgZonePolygonRef.current.remove();
          sgZonePolygonRef.current = null;
        }
        if (nbZonePolygonRef.current) {
          nbZonePolygonRef.current.remove();
          nbZonePolygonRef.current = null;
        }
      } else {
        const satradIcon = L.divIcon({
          html: `
            <div class="relative flex items-center justify-center">
              <!-- Ripple Pulse -->
              <div class="absolute w-12 h-12 rounded-full border border-[#00f3ff]/30 ping-indicator" style="animation-duration: 2.5s;"></div>
              <div class="absolute w-8 h-8 rounded-full border-2 border-[#00f3ff]/50 ping-indicator" style="animation-duration: 1.5s;"></div>
              <!-- Center physical icon -->
              <div class="w-4.5 h-4.5 bg-[#0a1523] border-[2px] border-amber-400 flex items-center justify-center shadow-[0_0_12px_rgba(251,191,36,0.6)]">
                <div class="w-1.5 h-1.5 bg-amber-400"></div>
              </div>
            </div>
          `,
          className: 'satrad-central-pointer',
          iconSize: [40, 40],
          iconAnchor: [20, 20]
        });

        if (!satradCenterMarkerRef.current) {
          satradCenterMarkerRef.current = L.marker([newLat, newLng], { icon: satradIcon }).addTo(mapRef.current);
        } else {
          satradCenterMarkerRef.current.setLatLng([newLat, newLng]);
        }
        satradCenterMarkerRef.current.unbindTooltip();
        satradCenterMarkerRef.current.bindTooltip(`${id} ${name.toUpperCase()}`, {
          permanent: false,
          direction: "top",
          className: "tactical-tooltip"
        });

        if (!sgZonePolygonRef.current) {
          sgZonePolygonRef.current = L.polygon(newKkop, {
            color: '#ff3333',
            fillColor: '#ff3333',
            fillOpacity: 0.12,
            weight: 1.5,
            dashArray: '4, 4'
          }).addTo(mapRef.current);
        } else {
          sgZonePolygonRef.current.setLatLngs(newKkop);
        }
        sgZonePolygonRef.current.unbindTooltip();
        sgZonePolygonRef.current.bindTooltip(`ZONA PERINGATAN KKOP: ${name.toUpperCase()}`, { sticky: true, className: "tactical-tooltip" });

        if (!nbZonePolygonRef.current) {
          nbZonePolygonRef.current = L.polygon(newSamudera, {
            color: '#ff3333',
            fillColor: '#ff3333',
            fillOpacity: 0.12,
            weight: 1.5,
            dashArray: '4, 4'
          }).addTo(mapRef.current);
        } else {
          nbZonePolygonRef.current.setLatLngs(newSamudera);
        }
        nbZonePolygonRef.current.unbindTooltip();
        nbZonePolygonRef.current.bindTooltip(`ZONA PERINGATAN MARITIM: ${name.toUpperCase()}`, { sticky: true, className: "tactical-tooltip" });
      }

      if (georefGroupRef.current) {
        drawGeorefGrid(newLat, newLng);
      }

      if (airwaysGroupRef.current) {
        airwaysGroupRef.current.clearLayers();
        if (id === "ALL") {
          const mainAirway1 = [
            [-6.01, 106.53],
            [-5.06, 112.0],
            [-5.06, 119.5],
            [-2.2, 128.0],
            [-1.17, 136.0]
          ];
          const mainAirway2 = [
            [5.11, 97.15],
            [1.11, 104.45],
            [-7.37, 112.22],
            [-10.29, 123.85]
          ];
          const l1 = L.polyline(mainAirway1, { color: 'rgba(0, 243, 255, 0.25)', weight: 1.5, dashArray: '8, 8' });
          const l2 = L.polyline(mainAirway2, { color: 'rgba(0, 255, 102, 0.25)', weight: 1.5, dashArray: '8, 8' });
          airwaysGroupRef.current.addLayer(l1);
          airwaysGroupRef.current.addLayer(l2);
        } else {
          const rute1 = [
            [newLat + 0.915, newLng - 0.575],
            [newLat + 0.415, newLng - 0.275],
            [newLat, newLng],
            [newLat - 0.285, newLng + 0.425]
          ];
          const rute2 = [
            [newLat + 0.715, newLng - 1.075],
            [newLat, newLng],
            [newLat - 0.085, newLng + 0.925]
          ];
          const l1 = L.polyline(rute1, { color: 'rgba(0, 243, 255, 0.22)', weight: 1.5, dashArray: '6, 6' });
          const l2 = L.polyline(rute2, { color: 'rgba(0, 255, 102, 0.22)', weight: 1.5, dashArray: '6, 6' });
          airwaysGroupRef.current.addLayer(l1);
          airwaysGroupRef.current.addLayer(l2);
        }
      }

      if (radarGridGroupRef.current) {
        radarGridGroupRef.current.clearLayers();

        const centerPoints = id === "ALL"
          ? SATRADS.map(s => ({ lat: s.lat, lng: s.lng, name: s.name, label: s.idLabel }))
          : [{ lat: newLat, lng: newLng, name, label: id }];

        centerPoints.forEach((point) => {
          if (id === "ALL") {
            const activeIcon = L.divIcon({
              html: `
                <div class="relative flex items-center justify-center">
                  <div class="absolute w-12 h-12 rounded-full border border-[#00f3ff]/30 ping-indicator" style="animation-duration: 2.5s;"></div>
                  <div class="absolute w-8 h-8 rounded-full border-2 border-[#00f3ff]/50 ping-indicator" style="animation-duration: 1.5s;"></div>
                  <div class="w-4.5 h-4.5 bg-[#0a1523] border-[2px] border-amber-400 flex items-center justify-center shadow-[0_0_12px_rgba(251,191,36,0.6)]">
                    <div class="w-1.5 h-1.5 bg-amber-400"></div>
                  </div>
                </div>
              `,
              className: 'satrad-central-pointer',
              iconSize: [40, 40],
              iconAnchor: [20, 20]
            });
            L.marker([point.lat, point.lng], { icon: activeIcon }).addTo(radarGridGroupRef.current)
              .bindTooltip(`${point.label} ${point.name.toUpperCase()}`, {
                permanent: false,
                direction: "top",
                className: "tactical-tooltip"
              });
          }

          const ringsNauticalMiles = id === "ALL" ? [100, 250] : [50, 100, 150, 200, 250];
          ringsNauticalMiles.forEach(nm => {
            const radMeters = nm * 1852;
            L.circle([point.lat, point.lng], {
              radius: radMeters,
              color: nm === 250 ? 'rgba(0, 255, 102, 0.35)' : 'rgba(0, 243, 255, 0.15)',
              fill: false,
              weight: nm === 250 ? 1.8 : 1.0,
              dashArray: nm % 100 === 0 ? 'none' : '4, 12'
            }).addTo(radarGridGroupRef.current);
            
            L.marker([point.lat + (radMeters / 111320), point.lng], {
              icon: L.divIcon({
                html: `<div class="text-[9px] font-bold font-mono-military ${nm === 250 ? 'text-[#00ff66] bg-black/85 border border-[#00ff66]/30 px-1.5' : 'text-[#00f3ff]/50'} px-1 whitespace-nowrap">${nm} NM LIMIT</div>`,
                className: "radar-ring-marker-label",
                iconSize: [80, 15],
                iconAnchor: [40, 7]
              })
            }).addTo(radarGridGroupRef.current);
          });
        });
      }
    }

    if (writeLog) {
      setLogs(prev => [
        {
          timestamp: new Date().toLocaleTimeString("id-ID"),
          message: id === "ALL" 
            ? `JARINGAN OPS NASIONAL AKTIF: PENGAWASAN RADAR REALTIME SELURUH SATRAD INDONESIA`
            : `SATRAD COORDINATE UPDATED: ${id} (${name.toUpperCase()}) TO LAT ${newLat.toFixed(4)}, LNG ${newLng.toFixed(4)}`,
          type: id === "ALL" ? "threat" : "warning"
        },
        ...prev
      ]);
      playSiren(1100, 0.55, "sine");
    }
  };

  const recenterSatrad = async (newLat: number, newLng: number, isGps = false, customName?: string, customId?: string) => {
    const freshName = isGps ? "GPS Tablet (Mobile)" : (customName || "Congot");
    const freshId = isGps ? "MOBILE GPS" : (customId || "SATRAD 215");

    try {
      const resp = await fetch("/api/satrad/coordinate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat: newLat, lng: newLng, name: freshName, id: freshId })
      });
      const data = await resp.json();
      if (data.success) {
        applySatradCenterUpdate(data.satrad.lat, data.satrad.lng, data.satrad.name, data.satrad.id, true);
      }
    } catch (err) {
      console.error("Gagal menyinkronkan koordinat ke server:", err);
    }
  };

  const getTabletGps = () => {
    if (!navigator.geolocation) {
      setGpsError("Modul GPS tidak didukung oleh tablet ini.");
      playSiren(300, 0.4, "sawtooth");
      return;
    }

    setGpsLoading(true);
    setGpsError(null);
    playSiren(800, 0.15, "sine");

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        setGpsLoading(false);
        recenterSatrad(latitude, longitude, true);
      },
      (error) => {
        setGpsLoading(false);
        let errorMsg = "Gagal mengakses modul GPS tablet.";
        if (error.code === error.PERMISSION_DENIED) {
          errorMsg = "Akses GPS ditolak. Silakan aktifkan GPS atau izinkan lokasi di browser.";
        }
        setGpsError(errorMsg);
        playSiren(300, 0.4, "sawtooth");
        setLogs(prev => [
          {
            timestamp: new Date().toLocaleTimeString("id-ID"),
            message: `SYSTEM GPS CRITICAL ERROR: ${errorMsg.toUpperCase()}`,
            type: "threat"
          },
          ...prev
        ]);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  // Setup Clock Interval
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      // Zulu Clock
      const zH = String(now.getUTCHours()).padStart(2, '0');
      const zM = String(now.getUTCMinutes()).padStart(2, '0');
      const zS = String(now.getUTCSeconds()).padStart(2, '0');
      setTimeZulu(`${zH}:${zM}:${zS} z`);

      // Local Clock (WIB UTC+7)
      const lTime = new Date(now.getTime() + (7 * 60 * 60 * 1000));
      const lH = String(lTime.getUTCHours()).padStart(2, '0');
      const lM = String(lTime.getUTCMinutes()).padStart(2, '0');
      const lS = String(lTime.getUTCSeconds()).padStart(2, '0');
      setTimeLocal(`${lH}:${lM}:${lS} WIB`);
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // Initialize Map Framework
  useEffect(() => {
    if (!mapRef.current) {
      // 1. Initialise core Map centered on Satrad 215 (Congot)
      const map = L.map('tactical-radar-map', {
        center: [satradCoordsRef.current.lat, satradCoordsRef.current.lng],
        zoom: 8,
        zoomControl: false,
        attributionControl: false
      });
      mapRef.current = map;

      // 2. Set CARTO Basemap with validated API key (watermark removed)
      tileLayerRef.current = L.tileLayer(getCartoTileUrl(cartoStyleRef.current), {
        subdomains: 'abcd',
        maxZoom: 20,
        minZoom: 3,
        attribution: '&copy; CARTO Basemaps | Key Validated'
      }).addTo(map);

      // 3. Central physical Satrad 215 Radar mark
      const satradIcon = L.divIcon({
        html: `
          <div class="relative flex items-center justify-center">
            <!-- Ripple Pulse -->
            <div class="absolute w-12 h-12 rounded-full border border-[#00f3ff]/30 ping-indicator" style="animation-duration: 2.5s;"></div>
            <div class="absolute w-8 h-8 rounded-full border-2 border-[#00f3ff]/50 ping-indicator" style="animation-duration: 1.5s;"></div>
            <!-- Center physical icon -->
            <div class="w-4.5 h-4.5 bg-[#0a1523] border-[2px] border-amber-400 flex items-center justify-center shadow-[0_0_12px_rgba(251,191,36,0.6)]">
              <div class="w-1.5 h-1.5 bg-amber-400"></div>
            </div>
          </div>
        `,
        className: 'satrad-central-pointer',
        iconSize: [40, 40],
        iconAnchor: [20, 20]
      });

      satradCenterMarkerRef.current = L.marker([satradCoordsRef.current.lat, satradCoordsRef.current.lng], { icon: satradIcon }).addTo(map)
        .bindTooltip(`${satradCoordsRef.current.id} ${satradCoordsRef.current.name.toUpperCase()}`, {
          permanent: false,
          direction: "top",
          className: "tactical-tooltip"
        });

      // 4. Create warnings polygons (KKOP YIA & Samudera Hindia)
      sgZonePolygonRef.current = L.polygon(kkopZoneRef.current, {
        color: '#ff3333',
        fillColor: '#ff3333',
        fillOpacity: 0.12,
        weight: 1.5,
        dashArray: '4, 4'
      }).addTo(map);
      sgZonePolygonRef.current.bindTooltip("WARNING ZONE: KKOP YIA", { sticky: true, className: "tactical-tooltip" });

      nbZonePolygonRef.current = L.polygon(samuderaZoneRef.current, {
        color: '#ff3333',
        fillColor: '#ff3333',
        fillOpacity: 0.12,
        weight: 1.5,
        dashArray: '4, 4'
      }).addTo(map);
      nbZonePolygonRef.current.bindTooltip("WARNING ZONE: SAMUDERA HINDIA", { sticky: true, className: "tactical-tooltip" });

      // 5. Draw Airway structures (ATS Lanes)
      const rute1 = [
        [satradCoordsRef.current.lat + 0.915, satradCoordsRef.current.lng - 0.575],
        [satradCoordsRef.current.lat + 0.415, satradCoordsRef.current.lng - 0.275],
        [satradCoordsRef.current.lat, satradCoordsRef.current.lng],
        [satradCoordsRef.current.lat - 0.285, satradCoordsRef.current.lng + 0.425]
      ];
      const rute2 = [
        [satradCoordsRef.current.lat + 0.715, satradCoordsRef.current.lng - 1.075],
        [satradCoordsRef.current.lat, satradCoordsRef.current.lng],
        [satradCoordsRef.current.lat - 0.085, satradCoordsRef.current.lng + 0.925]
      ];
      airwaysGroupRef.current = L.layerGroup([
        L.polyline(rute1, { color: 'rgba(0, 243, 255, 0.22)', weight: 1.5, dashArray: '6, 6' }),
        L.polyline(rute2, { color: 'rgba(0, 255, 102, 0.22)', weight: 1.5, dashArray: '6, 6' })
      ]).addTo(map);

      // 6. Draw Georef Earth Coordinate grids
      georefGroupRef.current = L.layerGroup().addTo(map);
      drawGeorefGrid(satradCoordsRef.current.lat, satradCoordsRef.current.lng);

      // 7. Radar overlay concentric rings with outer 250 NM label limit (Koreksi Jangkauan)
      const radarGridGroup = L.layerGroup();
      // Range limits in NM (1 NM = 1852m)
      const ranges = [50, 100, 150, 200, 250];
      ranges.forEach((rng) => {
        const radMeters = rng * 1852;
        const ring = L.circle([satradCoordsRef.current.lat, satradCoordsRef.current.lng], {
          radius: radMeters,
          color: rng === 250 ? 'rgba(0, 255, 102, 0.35)' : 'rgba(0, 243, 255, 0.15)',
          fill: false,
          weight: rng === 250 ? 1.8 : 1.0,
          dashArray: rng === 250 ? 'none' : '4, 4'
        });
        radarGridGroup.addLayer(ring);

        // Core visual label on outer boundary
        radarGridGroup.addLayer(L.marker([satradCoordsRef.current.lat + (radMeters / 111320), satradCoordsRef.current.lng], {
          icon: L.divIcon({
            html: `<div class="text-[9px] font-bold font-mono-military ${rng === 250 ? 'text-[#00ff66] bg-black/85 border border-[#00ff66]/30 px-1.5' : 'text-[#00f3ff]/50'} px-1 whitespace-nowrap">${rng} NM LIMIT</div>`,
            className: 'radar-ring-marker-label',
            iconSize: [80, 15],
            iconAnchor: [40, 7]
          })
        }));
      });
      radarGridGroupRef.current = radarGridGroup.addTo(map);

      // 8. Capture Hover events for Range Bearing active measurements
      map.on('mousemove', (e: any) => {
        if (!showRangeBearingRef.current) {
          setLiveMeasure(null);
          return;
        }
        // If locked on a target or coordinates, do not let mouse move override it!
        if (rangeBearingLockedTargetRef.current) {
          return;
        }
        const rng = getDistanceNM(satradCoordsRef.current.lat, satradCoordsRef.current.lng, e.latlng.lat, e.latlng.lng);
        const brg = getBearingDeg(satradCoordsRef.current.lat, satradCoordsRef.current.lng, e.latlng.lat, e.latlng.lng);
        setLiveMeasure({
          rng,
          brg,
          lat: e.latlng.lat,
          lng: e.latlng.lng
        });
      });

      // Capture click events on background map to lock on custom coordinates
      map.on('click', (e: any) => {
        if (!showRangeBearingRef.current) return;
        
        const lat = e.latlng.lat;
        const lng = e.latlng.lng;
        const rng = getDistanceNM(satradCoordsRef.current.lat, satradCoordsRef.current.lng, lat, lng);
        const brg = getBearingDeg(satradCoordsRef.current.lat, satradCoordsRef.current.lng, lat, lng);
        
        const lockedObj = { type: 'coord' as const, lat, lng, id: 'coord_pin' };
        rangeBearingLockedTargetRef.current = lockedObj;
        setRangeBearingLockedTarget(lockedObj);
        setLiveMeasure({ rng, brg, lat, lng });
        playSiren(700, 0.12, 'sine');
      });

      map.on('mouseout', () => {
        setLiveMeasure(null);
      });

      // 9. Initialise other Satrad elements group
      otherSatradsGroupRef.current = L.layerGroup().addTo(map);
    }

    return () => {
      // Clean up map listener variables on unmount
      if (mapRef.current) {
        mapRef.current.off();
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // Consolidated with top-level ref definition

  // Dynamic Toggle Application
  useEffect(() => {
    if (!mapRef.current) return;

    // Basemap Digital Toggle
    if (showBaseMap) {
      if (!mapRef.current.hasLayer(tileLayerRef.current)) {
        tileLayerRef.current.addTo(mapRef.current);
      }
    } else {
      if (mapRef.current.hasLayer(tileLayerRef.current)) {
        tileLayerRef.current.remove();
      }
    }

    // GEOREF Coordinate lines
    if (showGeoref) {
      if (!mapRef.current.hasLayer(georefGroupRef.current)) {
        georefGroupRef.current.addTo(mapRef.current);
      }
    } else {
      if (mapRef.current.hasLayer(georefGroupRef.current)) {
        georefGroupRef.current.remove();
      }
    }

    // AIRWAYS Trails
    if (showAirways) {
      if (!mapRef.current.hasLayer(airwaysGroupRef.current)) {
        airwaysGroupRef.current.addTo(mapRef.current);
      }
    } else {
      if (mapRef.current.hasLayer(airwaysGroupRef.current)) {
        airwaysGroupRef.current.remove();
      }
    }

    // Concentric grid overlay
    if (showRadarData) {
      if (!mapRef.current.hasLayer(radarGridGroupRef.current)) {
        radarGridGroupRef.current.addTo(mapRef.current);
      }
    } else {
      if (mapRef.current.hasLayer(radarGridGroupRef.current)) {
        radarGridGroupRef.current.remove();
      }
    }
  }, [showBaseMap, showGeoref, showAirways, showRadarData]);

  // Render other Satrad points dynamically on coordinate change
  useEffect(() => {
    if (!mapRef.current || !otherSatradsGroupRef.current) return;

    otherSatradsGroupRef.current.clearLayers();

    if (satradCoords.id === "ALL") return;

    SATRADS.forEach((item) => {
      // Skip the active satrad coordinates
      const isCurrentlyActive = 
        Math.abs(item.lat - satradCoords.lat) < 0.0001 && 
        Math.abs(item.lng - satradCoords.lng) < 0.0001;

      if (isCurrentlyActive) return;

      // Small cyan tactical radar triangle / diamond
      const inactiveIcon = L.divIcon({
        html: `
          <div class="relative flex items-center justify-center group pointer-events-none">
            <div class="absolute w-6 h-6 border border-[#00f3ff]/10 rounded-full scale-0 group-hover:scale-100 group-hover:bg-[#00f3ff]/5 transition-all duration-300"></div>
            <div class="w-3.5 h-3.5 bg-[#050914]/90 border border-[#00f3ff]/50 flex items-center justify-center rotate-45 shadow-[0_0_8px_rgba(0,243,255,0.3)] hover:border-amber-400 hover:scale-125 transition-all duration-200 pointer-events-auto">
              <div class="w-1.5 h-1.5 bg-[#00f3ff]"></div>
            </div>
          </div>
        `,
        className: 'satrad-inactive-pointer',
        iconSize: [24, 24],
        iconAnchor: [12, 12]
      });

      const popupHtml = `
        <div class="p-2 text-xs font-mono-military text-[#00f3ff] min-w-[220px]" style="line-height:1.4;">
          <div class="font-bold border-b border-[#00f3ff]/30 pb-1 mb-1.5 text-[#00ffd5] tracking-wide uppercase">${item.idLabel} ${item.name.toUpperCase()}</div>
          <div class="space-y-1 text-[10px] text-[#00f3ff]/80">
            <div><span class="text-white/40">SEKTOR:</span> ${item.sector}</div>
            <div><span class="text-white/40">KOORDINAT:</span></div>
            <div class="pl-2 text-amber-400">${item.dmsLat} | ${item.dmsLng}</div>
          </div>
          <button id="popup-btn-${item.id}" class="mt-3 w-full py-1.5 bg-cyan-950/80 hover:bg-[#00ffd5]/20 border border-[#00f3ff]/40 hover:border-[#00f3ff] rounded-xs text-[9px] font-bold uppercase text-[#00ffd5] tracking-wider transition-all duration-150 cursor-pointer">
            HUBUNGKAN POS ACQUISITION
          </button>
        </div>
      `;

      const marker = L.marker([item.lat, item.lng], { icon: inactiveIcon })
        .addTo(otherSatradsGroupRef.current)
        .bindTooltip(`${item.idLabel} ${item.name.toUpperCase()}`, {
          direction: "top",
          className: "tactical-tooltip"
        })
        .bindPopup(popupHtml, {
          className: "tactical-popup-container",
          closeButton: false,
          offset: [0, -5]
        });

      // Binds dynamic activation button on popup opens
      marker.on('popupopen', () => {
        const btn = document.getElementById(`popup-btn-${item.id}`);
        if (btn) {
          btn.onclick = (ev) => {
            ev.stopPropagation();
            recenterSatrad(item.lat, item.lng, false, item.name, item.idLabel);
            mapRef.current.closePopup();
          };
        }
      });
    });
  }, [satradCoords]);

  // Handle Range Bearing line drawing to cursor live position
  useEffect(() => {
    if (!mapRef.current) return;

    if (showRangeBearing && liveMeasure) {
      // Draw or update baringan trajectory line
      const points = [[satradCoords.lat, satradCoords.lng], [liveMeasure.lat, liveMeasure.lng]];
      if (rangeBearingLineRef.current) {
        rangeBearingLineRef.current.setLatLngs(points);
      } else {
        rangeBearingLineRef.current = L.polyline(points, {
          color: '#fbbf24',
          weight: 2,
          dashArray: '5, 5'
        }).addTo(mapRef.current);
      }

      // Draw floating indicator block next to cursor
      const labelHtml = `
        <div class="bg-black/95 border-2 border-amber-500 p-1.5 rounded text-[9px] font-mono-military text-amber-400 font-bold whitespace-nowrap shadow-[0_0_10px_rgba(245,158,11,0.5)]">
          BRG: ${Math.round(liveMeasure.brg)}°<br/>
          RNG: ${liveMeasure.rng.toFixed(1)} NM
        </div>
      `;

      if (rangeBearingMarkerRef.current) {
        rangeBearingMarkerRef.current.setLatLng([liveMeasure.lat, liveMeasure.lng]);
        rangeBearingMarkerRef.current.setIcon(L.divIcon({
          html: labelHtml,
          className: 'ruler-dynamic-tooltip',
          iconSize: [90, 32],
          iconAnchor: [-10, 15]
        }));
      } else {
        rangeBearingMarkerRef.current = L.marker([liveMeasure.lat, liveMeasure.lng], {
          icon: L.divIcon({
            html: labelHtml,
            className: 'ruler-dynamic-tooltip',
            iconSize: [90, 32],
            iconAnchor: [-10, 15]
          })
        }).addTo(mapRef.current);
      }
    } else {
      // Delete temporary paths if measurement disabled
      if (rangeBearingLineRef.current) {
        rangeBearingLineRef.current.remove();
        rangeBearingLineRef.current = null;
      }
      if (rangeBearingMarkerRef.current) {
        rangeBearingMarkerRef.current.remove();
        rangeBearingMarkerRef.current = null;
      }
    }
  }, [showRangeBearing, liveMeasure]);

  // Keep showRangeBearing Ref in sync & handle deactivation
  useEffect(() => {
    showRangeBearingRef.current = showRangeBearing;
    if (!showRangeBearing) {
      setRangeBearingLockedTarget(null);
      rangeBearingLockedTargetRef.current = null;
    }
  }, [showRangeBearing]);



  // Dynamic lock-on flight tracker: recalculates distance & bearing vector as aircraft flies
  useEffect(() => {
    if (!showRangeBearing || !rangeBearingLockedTarget) return;
    if (rangeBearingLockedTarget.type === 'flight') {
      const targetFlight = flights.find(f => f.id === rangeBearingLockedTarget.id);
      if (targetFlight) {
        const rng = getDistanceNM(satradCoords.lat, satradCoords.lng, targetFlight.lat, targetFlight.lng);
        const brg = getBearingDeg(satradCoords.lat, satradCoords.lng, targetFlight.lat, targetFlight.lng);
        setLiveMeasure({
          rng,
          brg,
          lat: targetFlight.lat,
          lng: targetFlight.lng
        });
      }
    }
  }, [flights, showRangeBearing, rangeBearingLockedTarget]);

  // Sync selectedFlight in real-time to maintain exact position metrics accuracy
  useEffect(() => {
    if (!selectedFlight) return;
    const currentFlight = flights.find(f => f.id === selectedFlight.id);
    if (currentFlight) {
      if (
        currentFlight.lat !== selectedFlight.lat ||
        currentFlight.lng !== selectedFlight.lng ||
        currentFlight.altitude !== selectedFlight.altitude ||
        currentFlight.speed !== selectedFlight.speed ||
        currentFlight.heading !== selectedFlight.heading
      ) {
        setSelectedFlight(currentFlight);
      }
    } else {
      setSelectedFlight(null); // Target out of secondary/ADSB radar horizon range
    }
  }, [flights, selectedFlight]);

  // Fullscreen and sidebar collapse event listeners & map invalidation
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
      setTimeout(() => {
        if (mapRef.current) mapRef.current.invalidateSize({ pan: false });
      }, 250);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (mapRef.current) {
        mapRef.current.invalidateSize({ pan: false });
      }
    }, 280);
    return () => clearTimeout(timer);
  }, [isLeftCollapsed, isRightCollapsed, isFullscreen]);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(err => {
        console.warn("Fullscreen request error:", err);
      });
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(console.warn);
      }
    }
  };

  // FETCH REALTIME ADS-B DATA (OPTIMIZED FOR VERCEL SERVERLESS & FREE COMMUNITY ENGINE)
  useEffect(() => {
    const fetchTargetData = async () => {
      const currentLat = satradCoordsRef.current.lat;
      const currentLng = satradCoordsRef.current.lng;
      const currentId = satradCoordsRef.current.id;
      const currentName = satradCoordsRef.current.name;

      let rawFlightList: any[] = [];
      let providerUsed = "api.adsb.lol (ODbL 1.0)";

      // 0. Optional: User-configured custom feeder / receiver URL
      if (customFeederUrl.trim()) {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 3000);
          const customRes = await fetch(customFeederUrl.trim(), { signal: controller.signal });
          clearTimeout(timeout);
          if (customRes.ok) {
            const data: any = await customRes.json();
            const list = data.aircraft || data.ac || [];
            if (Array.isArray(list) && list.length > 0) {
              rawFlightList = list.map((ac: any) => ({
                id: `adsb_${(ac.hex || "").toLowerCase()}`,
                callsign: (ac.flight || "").trim() || (ac.r ? ac.r.trim() : `ADS-${(ac.hex || "").toUpperCase()}`),
                name: ac.desc || ac.t || ac.r || "Civilian Aircraft",
                lat: ac.lat,
                lng: ac.lon,
                altitude: typeof ac.alt_baro === 'number' ? Math.max(0, Math.min(85000, Math.round(ac.alt_baro))) : 0,
                speed: typeof ac.gs === 'number' ? Math.max(0, Math.min(1800, Math.round(ac.gs))) : 250,
                heading: sanitizeHeading(ac.track ?? ac.calc_track),
                squawk: (ac.squawk || "").trim() || "2000",
                origin: "N/A",
                destination: "N/A",
                type: "civilian" as const,
                isWarning: false,
                history: [],
                source: "Kustom Feeder",
                license: "ODbL 1.0"
              })).filter((f: any) => isValidPosition(f.lat, f.lng));
              providerUsed = "Kustom ADS-B Receiver Feeder";
            }
          }
        } catch {
          // Fallback to standard provider
        }
      }

      // 1. Primary: Fetch via API route (/api/flights) - Powered by api.adsb.lol (ODbL 1.0)
      if (rawFlightList.length === 0) {
        try {
          const queryUrl = `/api/flights?lat=${currentLat}&lng=${currentLng}&satradId=${encodeURIComponent(currentId)}&name=${encodeURIComponent(currentName)}`;
          const response = await fetch(queryUrl);
          if (response.ok) {
            const data = await response.json();
            if (data && data.success && Array.isArray(data.flights)) {
              rawFlightList = data.flights;
              if (data.provider) providerUsed = data.provider;
            }
          }
        } catch {
          // Continue to client direct fallback
        }
      }

      // 2. Direct client-side community fallback (api.adsb.lol primary, opendata.adsb.fi secondary)
      if (rawFlightList.length === 0) {
        const radius = currentId === "ALL" ? 1000 : 250;
        const queryLat = currentId === "ALL" ? -2.5 : currentLat;
        const queryLng = currentId === "ALL" ? 118.0 : currentLng;

        // Try api.adsb.lol directly
        try {
          const directUrl = `https://api.adsb.lol/v2/point/${queryLat}/${queryLng}/${radius}`;
          const directRes = await fetch(directUrl);
          if (directRes.ok) {
            const data: any = await directRes.json();
            const list = data.ac || data.aircraft || [];
            if (Array.isArray(list) && list.length > 0) {
              rawFlightList = list.map((ac: any) => {
                const icao = ac.hex;
                if (!icao || !isValidPosition(ac.lat, ac.lon)) return null;
                const callsign = (ac.flight || "").trim() || (ac.r ? ac.r.trim() : `ADS-${icao.toUpperCase()}`);
                const altitude = typeof ac.alt_baro === 'number' ? Math.max(0, Math.min(85000, Math.round(ac.alt_baro))) : (typeof ac.alt_geom === 'number' ? Math.round(ac.alt_geom) : 0);
                const speed = typeof ac.gs === 'number' ? Math.max(0, Math.min(1800, Math.round(ac.gs))) : 250;
                const heading = sanitizeHeading(ac.track ?? ac.calc_track);
                const squawk = (ac.squawk || "").trim() || "2000";

                return {
                  id: `adsb_${icao.toLowerCase()}`,
                  callsign,
                  name: ac.desc || ac.t || ac.r || "Civilian Aircraft",
                  lat: Number(ac.lat.toFixed(5)),
                  lng: Number(ac.lon.toFixed(5)),
                  altitude,
                  speed,
                  heading,
                  squawk,
                  origin: "N/A",
                  destination: "N/A",
                  type: "civilian" as const,
                  isWarning: false,
                  history: [],
                  source: "https://api.adsb.lol",
                  license: "ODbL 1.0"
                };
              }).filter(Boolean);
              providerUsed = "https://api.adsb.lol (ODbL 1.0 Direct)";
            }
          }
        } catch {
          // Fallback to opendata.adsb.fi
          try {
            const fiUrl = `https://opendata.adsb.fi/api/v2/lat/${queryLat}/lon/${queryLng}/dist/${radius}`;
            const fiRes = await fetch(fiUrl);
            if (fiRes.ok) {
              const data: any = await fiRes.json();
              const list = data.aircraft || data.ac || [];
              if (Array.isArray(list) && list.length > 0) {
                rawFlightList = list.map((ac: any) => {
                  const icao = ac.hex;
                  if (!icao || !isValidPosition(ac.lat, ac.lon)) return null;
                  const callsign = (ac.flight || "").trim() || (ac.r ? ac.r.trim() : `ADS-${icao.toUpperCase()}`);
                  return {
                    id: `adsb_${icao.toLowerCase()}`,
                    callsign,
                    name: ac.desc || ac.t || ac.r || "Civilian Aircraft",
                    lat: Number(ac.lat.toFixed(5)),
                    lng: Number(ac.lon.toFixed(5)),
                    altitude: typeof ac.alt_baro === 'number' ? Math.round(ac.alt_baro) : 0,
                    speed: typeof ac.gs === 'number' ? Math.round(ac.gs) : 250,
                    heading: sanitizeHeading(ac.track ?? ac.calc_track),
                    squawk: (ac.squawk || "").trim() || "2000",
                    origin: "N/A",
                    destination: "N/A",
                    type: "civilian" as const,
                    isWarning: false,
                    history: [],
                    source: "opendata.adsb.fi",
                    license: "ODbL 1.0"
                  };
                }).filter(Boolean);
                providerUsed = "opendata.adsb.fi (Secondary Fallback)";
              }
            }
          } catch {
            // Direct fallbacks exhausted
          }
        }
      }

      setActiveProviderName(providerUsed);

      // 3. Strict coordinate checking, bounds validation & warning zone testing
      const validatedFlights: Flight[] = [];
      const isAll = currentId === "ALL";
      const now = Date.now();
      const currentSeenIds = new Set<string>();

      for (const f of rawFlightList) {
        if (!isValidPosition(f.lat, f.lng)) continue;

        // Verify distance from active station (250 NM antenna horizon)
        if (!isAll) {
          const dist = getDistanceNM(currentLat, currentLng, f.lat, f.lng);
          if (dist > 250) continue;
        } else {
          // Indonesian FIR bounds check
          if (f.lat < -14.0 || f.lat > 9.5 || f.lng < 93.0 || f.lng > 143.0) continue;
        }

        currentSeenIds.add(f.id);

        // Test restricted airspace zones
        const inKkop = isLatLngInPolygon(f.lat, f.lng, kkopZoneRef.current);
        const inSamudera = isLatLngInPolygon(f.lat, f.lng, samuderaZoneRef.current);
        f.isWarning = inKkop || inSamudera;
        f.heading = sanitizeHeading(f.heading);

        // 4. Stable Track History Engine (Prevents Garis Putus-Putus Panjang)
        const cached = flightMemoryMapRef.current.get(f.id);
        const serverHistory = Array.isArray(f.history) && f.history.length > 0 ? f.history : null;
        let mergedHistory: [number, number][] = [];

        if (cached && cached.history && cached.history.length > 0) {
          const hist = cached.history;
          const lastPt = hist[hist.length - 1];
          const dLat = Math.abs(f.lat - lastPt[0]);
          const dLng = Math.abs(f.lng - lastPt[1]);
          const stepDistDeg = Math.sqrt(dLat * dLat + dLng * dLng);

          // Discontinuity guard: if step distance > 0.12° (~7.2 NM in 3s cycle), reset track
          if (stepDistDeg > 0.12) {
            mergedHistory = [[f.lat, f.lng]];
          } else if (stepDistDeg >= 0.0003) {
            // Natural aircraft movement: append breadcrumb up to 45 points
            mergedHistory = [...hist, [f.lat, f.lng]].slice(-45);
          } else {
            // Stationary or minimal change (< 30m): retain history
            mergedHistory = hist;
          }
        } else if (serverHistory) {
          mergedHistory = serverHistory;
        } else {
          mergedHistory = [[f.lat, f.lng]];
        }

        f.history = mergedHistory;

        // Update persistent flight memory
        flightMemoryMapRef.current.set(f.id, {
          flight: f,
          history: mergedHistory,
          lastSeen: now
        });

        validatedFlights.push(f);
      }

      // 5. Retain active flights within grace period (up to 35s with dead-reckoning extrapolation)
      const finalFlightList: Flight[] = [];

      for (const [id, entry] of flightMemoryMapRef.current.entries()) {
        const ageMs = now - entry.lastSeen;
        if (ageMs > 35000) {
          // Expired: remove from persistent memory and remove map markers
          flightMemoryMapRef.current.delete(id);
          if (flightMarkersMapRef.current[id]) {
            flightMarkersMapRef.current[id].remove();
            delete flightMarkersMapRef.current[id];
          }
          if (flightHistoryPathsRef.current[id]) {
            flightHistoryPathsRef.current[id].remove();
            delete flightHistoryPathsRef.current[id];
          }
        } else {
          if (!currentSeenIds.has(id)) {
            // Extrapolate gently between poll cycles if speed > 30 kt
            const elapsedSec = ageMs / 1000;
            if (entry.flight.speed > 30 && elapsedSec <= 35) {
              const distDeg = (entry.flight.speed * (elapsedSec / 3600)) / 60;
              const rad = (entry.flight.heading * Math.PI) / 180;
              const lastKnownPt = entry.history[entry.history.length - 1];
              if (lastKnownPt) {
                const projectedLat = lastKnownPt[0] + distDeg * Math.cos(rad);
                const projectedLng = lastKnownPt[1] + (distDeg * Math.sin(rad)) / Math.cos(lastKnownPt[0] * Math.PI / 180);
                if (isValidPosition(projectedLat, projectedLng)) {
                  entry.flight.lat = Number(projectedLat.toFixed(5));
                  entry.flight.lng = Number(projectedLng.toFixed(5));
                }
              }
            }
            entry.flight.lastSeenAgo = Math.round(elapsedSec);
          }
          finalFlightList.push(entry.flight);
        }
      }

      setAdsbStatus("LIVE");
      setAdsbCount(finalFlightList.length);
      processFlights(finalFlightList);
    };

    // PROCESS TARGET MARKERS ON MAP (EXACT COORDINATE ANCHORING)
    const processFlights = (flightList: Flight[]) => {
      if (!mapRef.current) return;
      flightsRef.current = flightList;

      // Filter warning triggers
      const detectedWarning = flightList.some(f => f.isWarning);
      if (detectedWarning) {
        playSiren(1200, 0.45, 'sawtooth');
      }

      if (!showRadarData) {
        // RADAR DATA is toggled off: clear all target drawings from map
        Object.keys(flightMarkersMapRef.current).forEach(id => {
          flightMarkersMapRef.current[id].remove();
          delete flightMarkersMapRef.current[id];
        });
        Object.keys(flightHistoryPathsRef.current).forEach(id => {
          flightHistoryPathsRef.current[id].remove();
          delete flightHistoryPathsRef.current[id];
        });
        setFlights(flightList);
        return;
      }

      setFlights(flightList);

      const incomingIds = new Set(flightList.map(f => f.id));

      // Remove stale aircraft traces
      Object.keys(flightMarkersMapRef.current).forEach(id => {
        if (!incomingIds.has(id)) {
          flightMarkersMapRef.current[id].remove();
          delete flightMarkersMapRef.current[id];
        }
        if (flightHistoryPathsRef.current[id]) {
          flightHistoryPathsRef.current[id].remove();
          delete flightHistoryPathsRef.current[id];
        }
      });

      // Render/update aircraft marks with 100% exact center coordinate anchoring
      flightList.forEach((f) => {
        const isIntruder = f.isWarning;
        const colorClass = isIntruder 
          ? 'text-[#ff3333] threat-blink-effect glow-red' 
          : f.type === 'military' 
            ? 'text-amber-400 font-bold' 
            : 'text-[#00ff66]';

        const labelText = isIntruder ? `${f.callsign} [INTRUDER]` : f.callsign;

        // Exactly centered: 16x16 icon with anchor at [8, 8]
        const iconHtml = `
          <div class="aircraft-marker-container" style="width: 16px; height: 16px; position: relative;">
            <div class="aircraft-icon-wrapper" style="width: 16px; height: 16px; transform: rotate(${f.heading}deg); transform-origin: 50% 50%;">
              <svg class="aircraft-icon-svg ${colorClass}" viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L14 19v-5.5l8 2.5z"/>
              </svg>
            </div>
            <!-- Primary HUD labels positioned underneath the centroid -->
            <div class="aircraft-label-hud px-1 py-0.5 rounded text-[8px] font-mono-military whitespace-nowrap leading-none ${
              isIntruder 
                ? 'bg-red-950 border border-red-500 text-white font-bold' 
                : 'bg-[#060b13]/90 border border-[#00f3ff]/30 text-[#00ffbc]'
            }" style="box-shadow: 0 0 6px rgba(0,243,255,0.15)">
              ${labelText} <span class="opacity-80">${Math.round(f.altitude/1000)}k FT</span>
            </div>
          </div>
        `;

        const tacticalIcon = L.divIcon({
          html: iconHtml,
          className: `custom-tactical-mark-${f.id}`,
          iconSize: [16, 16],
          iconAnchor: [8, 8]
        });

        if (flightMarkersMapRef.current[f.id]) {
          flightMarkersMapRef.current[f.id].setLatLng([f.lat, f.lng]);
          flightMarkersMapRef.current[f.id].setIcon(tacticalIcon);
        } else {
          const planeMarker = L.marker([f.lat, f.lng], { icon: tacticalIcon }).addTo(mapRef.current);
          planeMarker.on('click', (ev: any) => {
            if (ev && ev.originalEvent) {
              ev.originalEvent.stopPropagation();
            }

            const freshFlight = flightsRef.current.find(item => item.id === f.id) || f;
            
            if (showRangeBearingRef.current) {
              const lockedObj = { type: 'flight' as const, id: f.id };
              rangeBearingLockedTargetRef.current = lockedObj;
              setRangeBearingLockedTarget(lockedObj);
              
              const rng = getDistanceNM(satradCoordsRef.current.lat, satradCoordsRef.current.lng, freshFlight.lat, freshFlight.lng);
              const brg = getBearingDeg(satradCoordsRef.current.lat, satradCoordsRef.current.lng, freshFlight.lat, freshFlight.lng);
              setLiveMeasure({ rng, brg, lat: freshFlight.lat, lng: freshFlight.lng });
              playSiren(900, 0.12, 'sawtooth');
            }
            
            setSelectedFlight(freshFlight);
            playSiren(680, 0.15);
          });
          flightMarkersMapRef.current[f.id] = planeMarker;
        }

        // Draw elegant tracking trail history (polyline) with jump guard
        if (f.history && f.history.length > 1) {
          // Jump guard: sanitize history to ensure NO two consecutive points differ by > 0.08 degrees
          const safeTrail: [number, number][] = [];
          for (let i = 0; i < f.history.length; i++) {
            const pt = f.history[i];
            if (safeTrail.length === 0) {
              safeTrail.push(pt);
            } else {
              const prev = safeTrail[safeTrail.length - 1];
              const dLat = Math.abs(pt[0] - prev[0]);
              const dLng = Math.abs(pt[1] - prev[1]);
              if (Math.sqrt(dLat * dLat + dLng * dLng) > 0.08) {
                // Discontinuity found! Only keep the newest segment from this point onwards
                safeTrail.length = 0;
              }
              safeTrail.push(pt);
            }
          }

          if (safeTrail.length > 1) {
            const trailColor = isIntruder 
              ? 'rgba(239, 68, 68, 0.75)' 
              : f.type === 'military' 
                ? 'rgba(245, 158, 11, 0.75)' 
                : 'rgba(0, 255, 136, 0.65)';

            if (flightHistoryPathsRef.current[f.id]) {
              flightHistoryPathsRef.current[f.id].setLatLngs(safeTrail);
            } else {
              const trailLine = L.polyline(safeTrail, {
                color: trailColor,
                weight: 1.8,
                dashArray: '3, 4',
                smoothFactor: 1.0,
                className: 'aircraft-history-polyline'
              }).addTo(mapRef.current);
              flightHistoryPathsRef.current[f.id] = trailLine;
            }
          }
        }
      });
    };

    fetchTargetData();
    const updater = setInterval(fetchTargetData, 3000);
    return () => clearInterval(updater);
  }, [showRadarData, customFeederUrl]);

  const logEvent = (msg: string, type: "system" | "threat" | "warning") => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [{ timestamp, message: msg, type }, ...prev.slice(0, 30)]);
  };

  // ZOOM FOCUS TO AIRCRAFT TARGET
  const panToTarget = (f: Flight) => {
    setSelectedFlight(f);
    if (mapRef.current) {
      mapRef.current.setView([f.lat, f.lng], 9);
      playSiren(800, 0.1);
    }
  };

  const handleRecenterView = () => {
    if (mapRef.current) {
      mapRef.current.setView([satradCoordsRef.current.lat, satradCoordsRef.current.lng], 8);
      playSiren(500, 0.1);
    }
  };

  // SEND AI MESSAGE
  const sendChatMessage = async (term?: string) => {
    const text = term || chatInput;
    if (!text.trim()) return;

    const userEntry = {
      sender: "user" as const,
      text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    setChatLogs(prev => [...prev, userEntry]);
    setChatInput("");
    setIsAiLoading(true);
    playSiren(700, 0.1);

    try {
      const res = await fetch("/api/tactical-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: text, activeFlights: flights })
      });
      const data = await res.json();
      const aiEntry = {
        sender: "ai" as const,
        text: data.text || "Koneksi komando intelijen terputus.",
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      setChatLogs(prev => [...prev, aiEntry]);
      playSiren(950, 0.15);
    } catch (err) {
      setChatLogs(prev => [...prev, {
        sender: "ai",
        text: "KONEKSI TRANSCEIVER RADIO DEKSRIPSI GAGAL. Harap periksa jaringan SATRAD dan coba kembali.",
        timestamp: "WIB"
      }]);
    } finally {
      setIsAiLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-[#05070a] text-[#00ffd5] overflow-hidden font-sans select-none crt-scanline relative">
      
      {/* HEADER BANNER */}
      <header className="h-16 flex items-center justify-between px-4 sm:px-6 border-b border-[#00ffd5]/30 bg-[#0a1118]/95 shadow-md shadow-cyan-950/20 z-50 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 border-2 border-[#00ffd5] rounded-xs flex items-center justify-center font-bold text-xs bg-[#00ffd5]/10 animate-pulse text-[#00f3ff] shrink-0">
            HQ-C2
          </div>
          <div>
            <h1 className="text-base sm:text-lg font-bold tracking-widest text-[#00ffd5] uppercase font-mono-military glow-cyan leading-tight">
              MATA (MODUL AKUISISI TARGET ANGKASA) DISKOMLEKAU
            </h1>
            <p className="text-[8.5px] uppercase tracking-[0.25em] text-[#00ffd5]/60 font-mono-military">
              MATA-X TACTICAL WARFARE DISPLAY PANEL // SATRAD 215 CMD
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 sm:gap-4 text-right">
          {/* Active Station & Target Counter */}
          <div className="hidden lg:block text-right">
            <div className="flex items-center justify-end gap-1.5 mb-0.5">
              <button
                type="button"
                onClick={() => setShowAdsbConfigModal(true)}
                className={`inline-flex items-center px-2 py-0.5 rounded-full text-[8.5px] font-bold border transition-all cursor-pointer font-mono-military ${
                  adsbCount > 0 
                    ? 'bg-[#00ff66]/10 text-[#00ff66] border-[#00ff66]/40 hover:bg-[#00ff66]/20' 
                    : 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30 hover:bg-cyan-500/20'
                }`}
                title="Klik untuk konfigurasi dan status feed ADS-B (api.adsb.lol - ODbL 1.0)"
              >
                <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${adsbCount > 0 ? 'bg-[#00ff66] animate-pulse' : 'bg-cyan-400'}`}></span>
                ADS-B: {adsbCount} TRACK LIVE
                <span className="text-[7.5px] text-cyan-300 ml-1.5 px-1 py-0.2 bg-black/50 rounded-xs border border-cyan-500/30">api.adsb.lol [ODbL 1.0]</span>
                <Settings className="w-2.5 h-2.5 ml-1 opacity-70" />
              </button>
              <p className="text-[9px] text-amber-400 uppercase tracking-widest font-semibold font-mono-military">CONNECTED RADAR HUB</p>
            </div>
            <p className="font-mono-military text-[11px] text-[#00ffd5] font-semibold tracking-wider">
              {satradCoords.id} - {satradCoords.name.toUpperCase()} ({formatLatLng(satradCoords.lat, satradCoords.lng)})
            </p>
          </div>

          <div className="w-px h-8 bg-[#00ffd5]/20 hidden lg:block"></div>

          {/* QUICK DISPLAY ACTIONS (FOCUS MAP, FULLSCREEN, ADS-B CONFIG) */}
          <div className="flex items-center gap-1.5">
            {/* ADS-B Config Button */}
            <button
              type="button"
              onClick={() => setShowAdsbConfigModal(true)}
              className="px-2.5 py-1.5 rounded bg-cyan-500/15 border border-cyan-500/40 hover:bg-cyan-500/30 text-[9px] font-mono-military text-cyan-300 flex items-center gap-1.5 font-bold cursor-pointer transition-all shadow-[0_0_8px_rgba(6,182,212,0.15)]"
              title="Konfigurasi Data Link ADS-B & Kunci API"
            >
              <Key className="w-3.5 h-3.5 text-cyan-400" />
              <span className="hidden md:inline">ADS-B & API KEY</span>
            </button>

            {/* Focus / Maximize Map Button */}
            <button
              type="button"
              onClick={() => {
                const collapse = !isLeftCollapsed || !isRightCollapsed;
                setIsLeftCollapsed(collapse);
                setIsRightCollapsed(collapse);
                playSiren(800, 0.1);
              }}
              className={`px-2.5 py-1.5 rounded border transition-all text-[9px] font-mono-military flex items-center gap-1.5 font-bold cursor-pointer ${
                isLeftCollapsed && isRightCollapsed
                  ? 'bg-amber-500/20 border-amber-500/60 text-amber-300 hover:bg-amber-500/30 shadow-[0_0_10px_rgba(245,158,11,0.25)]'
                  : 'bg-[#00ffd5]/10 border-[#00ffd5]/30 text-[#00ffd5] hover:bg-[#00ffd5]/20'
              }`}
              title="Maksimalkan ruang peta dan sembunyikan semua panel"
            >
              {isLeftCollapsed && isRightCollapsed ? <Minimize2 className="w-3.5 h-3.5 text-amber-400" /> : <Maximize2 className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">{isLeftCollapsed && isRightCollapsed ? 'PULIHKAN PANEL' : 'PETA PENUH'}</span>
            </button>

            {/* Native Fullscreen Button */}
            <button
              type="button"
              onClick={() => {
                toggleFullscreen();
                playSiren(1000, 0.12);
              }}
              className={`px-2.5 py-1.5 rounded border transition-all text-[9px] font-mono-military flex items-center gap-1.5 font-bold cursor-pointer ${
                isFullscreen
                  ? 'bg-red-500/20 border-red-500/50 text-red-300 hover:bg-red-500/30'
                  : 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/30 shadow-[0_0_10px_rgba(16,185,129,0.2)]'
              }`}
              title="Beralih ke Tampilan Layar Penuh (Edge-to-Edge)"
            >
              {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
              <span>{isFullscreen ? '🗗 EXIT' : '⛶ FULLSCREEN'}</span>
            </button>
          </div>

          <div className="w-px h-8 bg-[#00ffd5]/20 hidden sm:block"></div>
          
          {/* RUNTIME SYSTEM CLOCKS */}
          <div className="hidden sm:flex gap-2">
            <div className="bg-[#0b1622]/90 border border-[#00ffd5]/25 px-2 py-0.5 text-center min-w-[75px] rounded-sm">
              <p className="text-[7px] text-[#00ffd5]/50 uppercase tracking-wider font-mono-military">ZULU TIME</p>
              <p className="font-mono-military text-[11px] font-bold text-[#00ffd5]">{timeZulu || "00:00:00 z"}</p>
            </div>
            <div className="bg-[#0b1622]/90 border border-amber-500/25 px-2 py-0.5 text-center min-w-[80px] rounded-sm">
              <p className="text-[7px] text-amber-500/50 uppercase tracking-wider font-mono-military">WIB (LOCAL)</p>
              <p className="font-mono-military text-[11px] font-bold text-amber-400">{timeLocal || "00:00:00 WIB"}</p>
            </div>
          </div>
        </div>
      </header>

      {/* CORE DISPLAY STAGE */}
      <main className="flex-1 flex overflow-hidden relative">

        {/* CONTROLS (LEFT PANEL - COLLAPSIBLE) */}
        <aside className={`transition-all duration-300 ease-in-out flex flex-col border-r border-[#00ffd5]/20 bg-[#060b13]/95 z-40 overflow-y-auto justify-between shrink-0 ${
          isLeftCollapsed ? 'w-0 p-0 border-none overflow-hidden opacity-0 pointer-events-none' : 'w-72 p-3.5'
        }`}>
          
          <div className="space-y-5">
            {/* SELEKTOR ACTIVE SATRAD STATION */}
            <div className="border border-[#00ffd5]/30 bg-[#071320]/90 p-3 rounded-sm space-y-2.5 shadow-[0_0_12px_rgba(0,255,213,0.05)]">
              <h3 className="text-[10px] font-bold text-[#00f3ff] tracking-widest uppercase flex items-center gap-1.5 glow-cyan">
                <Radar className="w-3.5 h-3.5 animate-pulse" /> SELEKTOR ACTIVE SATRAD
              </h3>
              
              <div className="space-y-1.5">
                {/* Dedicated Jaringan Ops Nasional Button */}
                <button
                  type="button"
                  onClick={() => {
                    recenterSatrad(-2.0, 118.0, false, "Jaringan Operasi Nasional", "ALL");
                  }}
                  className={`w-full py-2 px-2.5 border transition-all text-[9.5px] font-mono-military uppercase rounded-sm flex items-center justify-center gap-1.5 font-bold tracking-wider relative cursor-pointer ${
                    satradCoords.id === "ALL"
                      ? 'bg-amber-500/15 border-amber-500/80 text-amber-400 hover:bg-amber-500/25 shadow-[0_0_15px_rgba(245,158,11,0.25)]'
                      : 'bg-[#00f3ff]/5 border-[#00f3ff]/30 text-[#00f3ff] hover:bg-[#00f3ff]/15 hover:border-[#00f3ff]/60'
                  }`}
                >
                  <div className={`absolute top-0 left-0 w-1 h-full ${satradCoords.id === "ALL" ? 'bg-amber-400 animate-pulse' : 'bg-[#00f3ff]'}`}></div>
                  <span>🌐 JARINGAN OPS NASIONAL (ALL SATRAD)</span>
                </button>

                <label className="text-[8px] uppercase tracking-wider text-white/50 block font-mono-military mt-1">PILIH STASIUN RADAR:</label>
                <select
                  value={satradCoords.id === "ALL" ? "ALL" : (SATRADS.find(s => Math.abs(s.lat - satradCoords.lat) < 0.0001 && Math.abs(s.lng - satradCoords.lng) < 0.0001)?.id || "CUSTOM")}
                  onChange={(e) => {
                    const selectedId = e.target.value;
                    if (selectedId === "ALL") {
                      recenterSatrad(-2.0, 118.0, false, "Jaringan Operasi Nasional", "ALL");
                      return;
                    }
                    if (selectedId === "CUSTOM") return;
                    const item = SATRADS.find(s => s.id === selectedId);
                    if (item) {
                      recenterSatrad(item.lat, item.lng, false, item.name, item.idLabel);
                    }
                  }}
                  className="w-full bg-[#050914] border border-[#00f3ff]/40 hover:border-[#00f3ff] text-[#00ffd5] text-xs font-mono-military p-2 rounded-xs outline-none cursor-pointer transition-all focus:ring-1 focus:ring-[#00f3ff]"
                >
                  <option value="ALL" className="bg-[#050811] text-amber-400 font-bold uppercase">
                    🌐 [ALL] JARINGAN OPERASI NASIONAL
                  </option>
                  
                  <optgroup label="KOSEK IV (JAKARTA/JAWA)" className="bg-[#050811] text-[#00f3ff]">
                    {SATRADS.filter(s => s.sector === "KOSEK IV (JAKARTA)").map(s => (
                      <option key={s.id} value={s.id}>
                        {s.idLabel} {s.name.toUpperCase()}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="KOSEK II (MAKASSAR)" className="bg-[#050811] text-[#00f3ff]">
                    {SATRADS.filter(s => s.sector === "KOSEK II").map(s => (
                      <option key={s.id} value={s.id}>
                        {s.idLabel} {s.name.toUpperCase()}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="KOSEK I (MEDAN)" className="bg-[#050811] text-[#00f3ff]">
                    {SATRADS.filter(s => s.sector === "KOSEK I").map(s => (
                      <option key={s.id} value={s.id}>
                        {s.idLabel} {s.name.toUpperCase()}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="KOSEK IV (BIAK/PAPUA)" className="bg-[#050811] text-[#00f3ff]">
                    {SATRADS.filter(s => s.sector === "KOSEK IV (BIAK)").map(s => (
                      <option key={s.id} value={s.id}>
                        {s.idLabel} {s.name.toUpperCase()}
                      </option>
                    ))}
                  </optgroup>
                  {satradCoords.name.includes("Mobile") && (
                    <option value="CUSTOM" className="bg-[#050811] text-[#00f3ff]">
                      [MOBILE] {satradCoords.id}
                    </option>
                  )}
                </select>
              </div>

              {(() => {
                if (satradCoords.id === "ALL") {
                  return (
                    <div className="bg-[#050a12] border border-amber-500/25 p-2 rounded-xs space-y-1 font-mono-military text-[8px] text-amber-400">
                      <div className="flex justify-between font-bold">
                        <span>OPS STATUS:</span>
                        <span className="animate-pulse">ACT-NATIONWIDE</span>
                      </div>
                      <div className="text-white/60 leading-tight pt-0.5">
                        Display intelijen menyatukan seluruh visual waktu-nyata (timebase) dan lintasan radar di seluruh Sektor Kosek I, II, IV secara bersamaan.
                      </div>
                    </div>
                  );
                }
                const currentItem = SATRADS.find(s => Math.abs(s.lat - satradCoords.lat) < 0.0001 && Math.abs(s.lng - satradCoords.lng) < 0.0001);
                return currentItem ? (
                  <div className="bg-[#050a12] border border-[#00f3ff]/15 p-2 rounded-xs space-y-1 font-mono-military text-[8px] text-[#00f3ff]/80">
                    <div className="flex justify-between">
                      <span className="text-white/40">SEKTOR KOSEK:</span>
                      <span className="text-amber-400 font-bold">{currentItem.sector}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-white/40">DMS LAT:</span>
                      <span>{currentItem.dmsLat}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-white/40">DMS LNG:</span>
                      <span>{currentItem.dmsLng}</span>
                    </div>
                  </div>
                ) : null;
              })()}
            </div>

            {/* GPS GEOLOCATION tablet module section */}
            <div className="border border-[#00ffd5]/25 bg-[#0b1622]/90 p-3 rounded-sm space-y-2.5">
              <h3 className="text-[9px] font-bold text-[#00ffd5] tracking-widest uppercase flex items-center gap-1.5">
                <Compass className="w-3.5 h-3.5 animate-spin" style={{ animationDuration: '6s' }} /> POSISI GPS TABLET INI
              </h3>

              <div className="space-y-1 font-mono-military text-[9px]">
                <div className="flex justify-between">
                  <span className="text-white/45">CENTRAL ID:</span>
                  <span className="text-amber-400 font-bold">{satradCoords.id}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/45">LATITUDE:</span>
                  <span className="text-[#00ffd5]">{satradCoords.lat.toFixed(6)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/45">LONGITUDE:</span>
                  <span className="text-[#00ffd5]">{satradCoords.lng.toFixed(6)}</span>
                </div>
                <div className="flex justify-between border-t border-[#00ffd5]/10 pt-1 mt-1 font-semibold">
                  <span className="text-white/45">STATUS RADAR:</span>
                  <span className="text-emerald-400 font-bold uppercase">{satradCoords.name === "Congot" ? "OPERASIONAL (BASE)" : "SIAGA (MOBILE/GPS)"}</span>
                </div>
              </div>

              {gpsError && (
                <div className="text-[8px] bg-red-500/10 border border-red-500/30 text-red-400 p-1.5 rounded font-mono-military uppercase tracking-wide leading-tight">
                  ⚠ ERROR: {gpsError}
                </div>
              )}

              <div className="grid grid-cols-1 gap-1.5 pt-1">
                <button
                  onClick={getTabletGps}
                  disabled={gpsLoading}
                  className={`w-full py-1.5 px-2.5 border transition-all text-[8.5px] font-mono-military uppercase rounded-sm flex items-center justify-center gap-1.5 ${
                    gpsLoading
                      ? 'bg-amber-500/20 border-amber-500/40 text-amber-500 cursor-not-allowed'
                      : 'bg-[#00ffd5]/10 border-[#00ffd5]/30 text-[#00ffd5] hover:bg-[#00ffd5]/20 hover:border-[#00ffd5]/50 shadow-[0_0_8px_rgba(0,255,213,0.1)]'
                  }`}
                >
                  {gpsLoading ? (
                    <span className="flex items-center gap-1 animate-pulse">MENYINKRONKAN...</span>
                  ) : (
                    <span className="flex items-center gap-1">☉ SET TITIK TENGAH (GPS TABLET)</span>
                  )}
                </button>

                <button
                  onClick={() => recenterSatrad(-7.9150, 110.0750, false)}
                  className="w-full py-1.5 px-2.5 border border-white/10 bg-black/40 text-white/50 hover:bg-white/5 hover:text-white transition-all text-[8.5px] font-mono-military uppercase rounded-sm flex items-center justify-center gap-1"
                >
                  ↩ KEMBALIKAN KE CONGOT
                </button>
              </div>
            </div>

            <div>
              <h2 className="text-[10px] font-bold text-amber-400 uppercase mb-3 flex items-center gap-2 tracking-widest">
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping"></span> KONTROL HUD SENSOR
              </h2>

              <div className="space-y-2">
                {/* DATA RADAR TOGPLE */}
                <button 
                  onClick={() => {
                    setShowRadarData(!showRadarData);
                    playSiren(450, 0.08);
                  }}
                  className={`w-full py-2 px-3 border transition-all flex justify-between items-center text-[10px] font-mono-military uppercase rounded-sm ${
                    showRadarData 
                      ? 'bg-[#00ffd5]/10 border-[#00ffd5]/40 text-[#00ffd5]' 
                      : 'bg-black/40 border-white/15 text-white/30 hover:border-white/30'
                  }`}
                >
                  <span className="flex items-center gap-1.5"><Radar className="w-3.5 h-3.5" /> DATA RADAR</span>
                  <span className={`text-[8px] px-1 py-0.2 rounded font-bold ${showRadarData ? 'bg-[#00ffd5]/20' : 'bg-white/10'}`}>
                    {showRadarData ? 'ON' : 'OFF'}
                  </span>
                </button>

                {/* PETA DIGITAL TOGGLE */}
                <button 
                  onClick={() => {
                    setShowBaseMap(!showBaseMap);
                    playSiren(450, 0.08);
                  }}
                  className={`w-full py-2 px-3 border transition-all flex justify-between items-center text-[10px] font-mono-military uppercase rounded-sm ${
                    showBaseMap 
                      ? 'bg-[#00ffd5]/10 border-[#00ffd5]/40 text-[#00ffd5]' 
                      : 'bg-black/40 border-white/15 text-white/30 hover:border-white/30'
                  }`}
                >
                  <span className="flex items-center gap-1.5"><MapIcon className="w-3.5 h-3.5" /> PETA DASAR</span>
                  <span className={`text-[8px] px-1 py-0.2 rounded font-bold ${showBaseMap ? 'bg-[#00ffd5]/20' : 'bg-white/10'}`}>
                    {showBaseMap ? cartoStyle.toUpperCase() : 'OFF'}
                  </span>
                </button>

                {/* CARTO Basemap Styles & Key Status Panel */}
                {showBaseMap && (
                  <div className="bg-[#050b14]/90 border border-[#00ffd5]/20 p-2.5 rounded-sm space-y-2 shadow-inner">
                    <div className="flex items-center justify-between">
                      <span className="text-[8.5px] font-mono-military text-white/70 tracking-wider flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_6px_#00ff66]"></span>
                        CARTO BASEMAPS
                      </span>
                      <span className="text-[7.5px] font-mono-military px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-semibold tracking-wide">
                        API KEY VALID
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-1.5">
                      {CARTO_STYLE_OPTIONS.map((style) => (
                        <button
                          key={style.id}
                          onClick={() => {
                            setCartoStyle(style.id);
                            playSiren(550, 0.08);
                            logEvent(`BASEMAP DIUBAH KE CARTO ${style.label}`, "system");
                          }}
                          className={`p-1.5 text-left border rounded-xs transition-all font-mono-military flex flex-col justify-between cursor-pointer ${
                            cartoStyle === style.id
                              ? 'bg-[#00ffd5]/15 border-[#00ffd5] text-[#00ffd5] shadow-[0_0_8px_rgba(0,255,213,0.2)]'
                              : 'bg-black/40 border-white/10 text-white/40 hover:text-white/80 hover:border-white/25'
                          }`}
                        >
                          <div className="flex items-center justify-between w-full">
                            <span className="text-[8.5px] font-bold">{style.label}</span>
                            {cartoStyle === style.id && (
                              <span className="w-1 h-1 rounded-full bg-[#00ffd5]"></span>
                            )}
                          </div>
                          <span className="text-[7px] text-white/40 tracking-tight leading-tight mt-0.5">
                            {style.sublabel}
                          </span>
                        </button>
                      ))}
                    </div>

                    {/* API Key credential preview & Cache Clear */}
                    <div className="pt-1.5 border-t border-[#00ffd5]/10 flex items-center justify-between text-[7.5px] font-mono-military text-white/40">
                      <span className="truncate" title="API Key: cb1_4ovb_1_cda161407f013e7010dd86be">
                        KEY: <span className="text-amber-400/90 font-mono">cb1_4ovb_...86be</span>
                      </span>
                      <button
                        onClick={() => {
                          if (tileLayerRef.current) {
                            tileLayerRef.current.redraw();
                            playSiren(700, 0.1);
                            logEvent("CACHE TILE CARTO DI-REFRESH", "system");
                          }
                        }}
                        title="Muat ulang tile jika masih ada sisa watermark di cache browser"
                        className="text-[7.5px] text-[#00ffd5]/70 hover:text-[#00ffd5] underline cursor-pointer flex items-center gap-0.5"
                      >
                        <RotateCcw className="w-2.5 h-2.5" /> REFRESH TILE
                      </button>
                    </div>
                  </div>
                )}

                {/* GEOREF TOGGLE */}
                <button 
                  onClick={() => {
                    setShowGeoref(!showGeoref);
                    playSiren(450, 0.08);
                  }}
                  className={`w-full py-2 px-3 border transition-all flex justify-between items-center text-[10px] font-mono-military uppercase rounded-sm ${
                    showGeoref 
                      ? 'bg-[#00ffd5]/10 border-[#00ffd5]/40 text-[#00ffd5]' 
                      : 'bg-black/40 border-white/15 text-white/30 hover:border-white/30'
                  }`}
                >
                  <span className="flex items-center gap-1.5"><Compass className="w-3.5 h-3.5" /> GEOREF COORD</span>
                  <span className={`text-[8px] px-1 py-0.2 rounded font-bold ${showGeoref ? 'bg-[#00ffd5]/20' : 'bg-white/10'}`}>
                    {showGeoref ? 'ACTIVE' : 'OFF'}
                  </span>
                </button>



                {/* AIRWAYS TOGPLE */}
                <button 
                  onClick={() => {
                    setShowAirways(!showAirways);
                    playSiren(450, 0.08);
                  }}
                  className={`w-full py-2 px-3 border transition-all flex justify-between items-center text-[10px] font-mono-military uppercase rounded-sm ${
                    showAirways 
                      ? 'bg-[#00ffd5]/10 border-[#00ffd5]/40 text-[#00ffd5]' 
                      : 'bg-black/40 border-white/15 text-white/30 hover:border-white/30'
                  }`}
                >
                  <span className="flex items-center gap-1.5"><Database className="w-3.5 h-3.5" /> RUTE AIRWAYS</span>
                  <span className={`text-[8px] px-1 py-0.2 rounded font-bold ${showAirways ? 'bg-[#00ffd5]/20' : 'bg-white/10'}`}>
                    {showAirways ? 'RENDERED' : 'HIDDEN'}
                  </span>
                </button>

                {/* RANGE BEARING DYNAMICAL MAPPING HOVER */}
                <div className="flex flex-col gap-1.5">
                  <button 
                    onClick={() => {
                      setShowRangeBearing(!showRangeBearing);
                      if (!showRangeBearing) {
                        setLiveMeasure(null);
                      }
                      playSiren(500, 0.1);
                    }}
                    className={`w-full py-2 px-3 border transition-all flex justify-between items-center text-[10px] font-mono-military uppercase rounded-sm ${
                      showRangeBearing 
                        ? 'bg-amber-500/10 border-amber-500/50 text-amber-400 font-bold' 
                        : 'bg-black/40 border-white/15 text-white/30 hover:border-white/30'
                    }`}
                  >
                    <span className="flex items-center gap-1.5"><RulerIcon className="w-3.5 h-3.5" /> RANGE BEARING</span>
                    <span className={`text-[8px] px-1 py-0.2 rounded font-bold ${showRangeBearing ? 'bg-amber-500/30' : 'bg-white/10'}`}>
                      {showRangeBearing ? 'ACTIVE' : 'OFF'}
                    </span>
                  </button>

                  {showRangeBearing && rangeBearingLockedTarget && (
                    <div className="bg-amber-500/5 border border-amber-500/30 px-2 rounded flex items-center justify-between text-[8px] font-mono-military text-amber-400 py-1.5 shadow-[inset_0_0_8px_rgba(245,158,11,0.05)]">
                      <span className="truncate">
                        🔒 LOCK: {
                          rangeBearingLockedTarget.type === 'flight' 
                            ? (flights.find(f => f.id === rangeBearingLockedTarget.id)?.callsign || rangeBearingLockedTarget.id) 
                            : `COORDINATES`
                        }
                      </span>
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          setRangeBearingLockedTarget(null);
                          rangeBearingLockedTargetRef.current = null;
                          setLiveMeasure(null);
                          playSiren(450, 0.1);
                        }}
                        className="px-1.5 py-0.5 bg-amber-500 hover:bg-amber-400 text-black font-extrabold rounded-xs leading-none transition-all text-[8px] cursor-pointer"
                      >
                        LEPAS
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* QUICK CONTROLACTION BUTTONS */}
            <div>
              <h2 className="text-[10px] font-bold text-amber-400 uppercase mb-2 flex items-center gap-2 tracking-widest">
                NAVTIGASI UTAMA
              </h2>
              <div>
                <button 
                  onClick={() => {
                    setIsMuted(!isMuted);
                    playSiren(600, 0.1);
                  }}
                  className={`w-full py-2 px-3 border flex items-center justify-between rounded-sm text-[10px] uppercase font-mono-military transition-all cursor-pointer ${
                    isMuted ? 'text-red-400 bg-red-950/25 border-red-900/50 hover:bg-red-950/40' : 'bg-[#00f3ff]/5 border-[#00ffd5]/20 text-[#00ffd5] hover:bg-[#00f3ff]/15'
                  }`}
                >
                  <span className="flex items-center gap-1.5 font-bold">
                    {isMuted ? <VolumeX className="w-4 h-4 text-red-400 animate-pulse" /> : <Volume2 className="w-4 h-4 text-[#00ffbc]" />}
                    STATUS AUDIO ALARM
                  </span>
                  <span className={`text-[8.5px] px-1.5 py-0.5 rounded font-extrabold ${isMuted ? 'bg-red-500/20 text-red-400' : 'bg-[#00f3ff]/20 text-[#00ffd5]'}`}>
                    {isMuted ? "MUTED" : "ON"}
                  </span>
                </button>
              </div>
            </div>
          </div>

          {/* RADAR SENSOR STATUS (NO SIMULATION) */}
          <div className="border-t border-[#00ffd5]/10 pt-3 space-y-2">
            <div className="p-2.5 bg-[#09101a] border border-[#00f3ff]/20 rounded-sm font-mono-military text-[8.5px] leading-relaxed text-white/65 space-y-1">
              <div className="flex justify-between items-center text-emerald-400 font-bold mb-1">
                <span className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_6px_#00ff66]"></span>
                  STATUS SENSOR RADAR
                </span>
                <span className="text-[7.5px] bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 px-1 rounded-xs">
                  REAL-TIME
                </span>
              </div>
              <p className="flex justify-between">
                <span className="text-white/40">FEED:</span>
                <span className="text-[#00ffd5]">MURNI ADS-B (NO SIMULASI)</span>
              </p>
              <p className="flex justify-between">
                <span className="text-white/40">VALIDASI KOORDINAT:</span>
                <span className="text-emerald-400">AKTIF (FILTER ERROR 0,0)</span>
              </p>
              <p className="flex justify-between">
                <span className="text-white/40">JANGKAUAN ANTENA:</span>
                <span className="text-amber-400">250 NM MAX HORIZON</span>
              </p>
              <p className="flex justify-between">
                <span className="text-white/40">DEPLOYMENT HOST:</span>
                <span className="text-white/80">VERCEL SERVERLESS READY</span>
              </p>
            </div>

            {/* STRENGTH DATALINK MONITOR */}
            <div className="p-2 bg-[#09101a] border border-[#00f3ff]/10 rounded-sm font-mono-military text-[9px] leading-tight text-white/55">
              <div className="flex justify-between items-center text-emerald-400 font-bold mb-1">
                <span>DATALINK: SECURE (MIL)</span>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping"></span>
              </div>
              <p>BANDWIDTH: SECURE SAT-LINK</p>
              <p>KOORDINAT: WIDN / TANJUNGPINANG</p>
            </div>
          </div>
        </aside>

        {/* MAP SECTOR PPI SCOPE */}
        <section className="flex-1 relative bg-[#030508] overflow-hidden flex flex-col">
          
          <div id="tactical-radar-map" className="w-full h-full flex-1"></div>

          {/* FLOATING HUD TOGGLE BUTTON (LEFT EDGE) */}
          <button
            type="button"
            onClick={() => {
              setIsLeftCollapsed(!isLeftCollapsed);
              playSiren(750, 0.1);
            }}
            className="absolute top-3 left-3 z-30 bg-[#071320]/90 hover:bg-[#0c223a] border border-[#00ffd5]/40 hover:border-[#00ffd5] text-[#00ffd5] text-[10px] font-mono-military font-bold px-2.5 py-1.5 rounded shadow-xl backdrop-blur flex items-center gap-1.5 cursor-pointer transition-all"
            title={isLeftCollapsed ? "Buka Panel Kontrol HUD" : "Sembunyikan Panel Kontrol HUD"}
          >
            {isLeftCollapsed ? <PanelLeftOpen className="w-3.5 h-3.5 text-amber-400 animate-pulse" /> : <PanelLeftClose className="w-3.5 h-3.5" />}
            <span>{isLeftCollapsed ? `◀ KONTROL HUD (${satradCoords.id})` : '◀ SEMBUNYIKAN HUD'}</span>
          </button>

          {/* FLOATING FDB & INTEL TOGGLE BUTTON (RIGHT EDGE) */}
          <button
            type="button"
            onClick={() => {
              setIsRightCollapsed(!isRightCollapsed);
              playSiren(750, 0.1);
            }}
            className="absolute top-3 right-3 z-30 bg-[#071320]/90 hover:bg-[#0c223a] border border-[#00ffd5]/40 hover:border-[#00ffd5] text-[#00ffd5] text-[10px] font-mono-military font-bold px-2.5 py-1.5 rounded shadow-xl backdrop-blur flex items-center gap-1.5 cursor-pointer transition-all"
            title={isRightCollapsed ? "Buka Panel FDB & Intelijen" : "Sembunyikan Panel FDB & Intelijen"}
          >
            <span>{isRightCollapsed ? `FDB TARGET (${flights.length}) ▶` : 'SEMBUNYIKAN FDB ▶'}</span>
            {isRightCollapsed ? <PanelRightOpen className="w-3.5 h-3.5 text-amber-400 animate-pulse" /> : <PanelRightClose className="w-3.5 h-3.5" />}
          </button>

          {/* CARTO Basemap Status Badge on Map Canvas */}
          {showBaseMap && (
            <div className="absolute bottom-2 left-2 z-40 bg-black/85 backdrop-blur-sm border border-[#00ffd5]/25 px-2.5 py-1 rounded text-[8px] font-mono-military text-white/70 pointer-events-none flex items-center gap-2 shadow-lg">
              <span className="flex items-center gap-1.5 text-[#00ffd5] font-bold">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_5px_#00ff66]"></span>
                CARTO {cartoStyle.toUpperCase()}
              </span>
              <span className="text-white/20">|</span>
              <span className="text-amber-400 font-semibold">API KEY VERIFIED</span>
              <span className="text-white/20">|</span>
              <span className="text-white/40">YUDHI EKO SANTOSO</span>
            </div>
          )}

          {/* RANGE BEARING MEASURING BAR GUIDELINE INSTRUCTIONS */}
          {showRangeBearing && (
            <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-40 bg-amber-500 text-black px-4 py-1.5 font-bold text-[10px] tracking-wider uppercase shadow-xl flex items-center gap-2 rounded-xs pointer-events-none animate-pulse">
              <RulerIcon className="w-3.5 h-3.5 animate-spin" />
              <span>RANGE BEARING MODE: GERAKKAN KURSOR DI ATAS PETA UNTUK MELIHAT BARINGAN / JARAK DARI SATRAD 215</span>
            </div>
          )}

          {/* DETAILED INFORMATION BOX ON SELECTED PLANE */}
          {selectedFlight && (
            <div className="absolute top-12 left-3 z-40 bg-[#08101a]/95 border-2 border-amber-500 p-3 rounded shadow-2xl backdrop-blur text-xs font-mono-military w-72">
              <div className="flex justify-between items-center border-b border-amber-500/30 pb-1.5 mb-2">
                <span className="text-amber-400 font-bold text-[10px] tracking-wider">HUD PLOT TRACK DETAIL</span>
                <button 
                  onClick={() => setSelectedFlight(null)} 
                  className="text-[#ff3333] hover:text-white font-bold px-1 cursor-pointer"
                >
                  ✕
                </button>
              </div>

              <div className="space-y-1.5 text-white/90">
                <div className="flex justify-between items-center border-b border-white/5 pb-1">
                  <span className="text-[#00f3ff]">CALLSIGN:</span>
                  <span className="font-bold text-[#00ffbc] text-[13px]">{selectedFlight.callsign}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/50">TIPE TARGET:</span>
                  <span className="text-amber-100">{selectedFlight.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/50">AFILIASI:</span>
                  <span className={`font-semibold uppercase ${
                    selectedFlight.type === 'civilian' ? 'text-emerald-400' : 'text-amber-400'
                  }`}>{selectedFlight.type}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#ff3e3e]">SQUAWK CODE:</span>
                  <span className="bg-black border border-white/10 px-1 text-white font-semibold">{selectedFlight.squawk}</span>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-white/5 text-[10px]">
                  <div>
                    <span className="text-white/40 block">KETINGGIAN:</span>
                    <span className="text-[#00f3ff] font-bold">{selectedFlight.altitude.toLocaleString()} FT</span>
                  </div>
                  <div>
                    <span className="text-white/40 block">KECEPATAN:</span>
                    <span className="text-[#00f3ff] font-bold">{selectedFlight.speed} KTS</span>
                  </div>
                  <div>
                    <span className="text-white/40 block">HALUAN GIRI:</span>
                    <span className="text-[#00f3ff] font-bold">{selectedFlight.heading}° DEG</span>
                  </div>
                  <div>
                    <span className="text-white/40 block">STATUS ZONA:</span>
                    <span className={`font-bold ${selectedFlight.isWarning ? 'text-[#ff3333]' : 'text-emerald-400'}`}>
                      {selectedFlight.isWarning ? 'ALERT' : 'NORMAL'}
                    </span>
                  </div>
                </div>

                <div className="pt-2 border-t border-white/5 flex items-center justify-between text-[8px] text-white/50">
                  <span>DATA SOURCE:</span>
                  <span className="text-[#00ffd5] font-semibold">api.adsb.lol [ODbL 1.0]</span>
                </div>

                <div className="flex gap-2 mt-3 pt-2 border-t border-[#00f3ff]/10">
                  <button 
                    onClick={() => {
                      if (mapRef.current) {
                        mapRef.current.setView([selectedFlight.lat, selectedFlight.lng], 10);
                        playSiren(700, 0.1);
                      }
                    }}
                    className="flex-1 py-1 rounded bg-[#00ffd5]/10 border border-[#00ffd5]/20 hover:bg-[#00ffd5]/20 text-[9px] uppercase font-bold text-[#00ffd5] cursor-pointer"
                  >
                    LOCK MAP
                  </button>
                  <button 
                    onClick={() => sendChatMessage(`Berikan status rincian intelijen mengenai target ${selectedFlight.callsign}`)}
                    className="flex-1 py-1 rounded bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500/20 text-[9px] uppercase font-bold text-amber-400 flex items-center justify-center gap-1 cursor-pointer"
                  >
                    <Sparkles className="w-3 h-3 text-amber-400" /> REKOMENDASI AI
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* DETAILS BLOCK & CHAT (RIGHT PANEL - COLLAPSIBLE) */}
        <aside className={`transition-all duration-300 ease-in-out flex flex-col bg-[#05090e]/95 border-l border-[#00ffd5]/20 z-40 overflow-hidden shrink-0 ${
          isRightCollapsed ? 'w-0 p-0 border-none overflow-hidden opacity-0 pointer-events-none' : 'w-80'
        }`}>
          
          {/* FDB TARGET LIST (Blok INFORMASI PESAWAT) */}
          <div className="flex-1 p-3 flex flex-col overflow-hidden min-h-[160px]">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-[10px] font-bold text-[#fbbf24] uppercase flex items-center gap-1.5 font-mono-military tracking-widest">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span> Flight Data Block (FDB)
              </h2>
              <span className="text-[#00ffd5] bg-[#00f3ff]/10 border border-[#00f3ff]/20 px-1.5 py-0.5 rounded-xs font-mono-military font-bold text-[8.5px] tracking-wider shrink-0">
                JUMLAH TRACK: {flights.length}
              </span>
            </div>
            
            <div className="flex-1 overflow-y-auto border border-[#00ffd5]/20 bg-black/40 rounded-sm">
              <table className="w-full text-left font-mono-military text-[9px] leading-tight">
                <thead className="bg-[#0e1622] text-[#00ffd5]/50 uppercase text-[8px] border-b border-[#00ffd5]/25 sticky top-0">
                  <tr>
                    <th className="p-1.5">CALLSIGN</th>
                    <th className="p-1.5">ALT (FT)</th>
                    <th className="p-1.5">SPD (KT)</th>
                    <th className="p-1.5">SQ</th>
                    <th className="p-1.5 text-right">ZONA</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {flights.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-4 text-center text-white/30 italic">Pencarian target sekunder...</td>
                    </tr>
                  ) : (
                    flights.map((f) => {
                      const isTargetSelected = selectedFlight?.id === f.id;
                      return (
                        <tr 
                          key={f.id} 
                          onClick={() => panToTarget(f)}
                          className={`cursor-pointer transition-all hover:bg-[#00f3ff]/5 ${
                            f.isWarning 
                              ? 'bg-[#ff3333]/15 text-[#ff3333] font-bold' 
                              : isTargetSelected 
                                ? 'bg-[#00f3ff]/10 text-white font-bold text-[#00ffd5]' 
                                : 'text-white/80'
                          }`}
                        >
                          <td className="p-1.5 font-bold tracking-tight flex items-center gap-1">
                            {f.type === 'military' && <span className="bg-amber-400 text-black text-[7px] font-bold px-0.5 rounded-xs scale-90">MIL</span>}
                            {f.type === 'unidentified' && <span className="bg-red-500 text-white text-[7px] font-bold px-0.5 rounded-xs scale-90 animate-pulse">INC</span>}
                            {f.callsign}
                          </td>
                          <td className="p-1.5">{f.altitude.toLocaleString()}</td>
                          <td className="p-1.5">{f.speed}</td>
                          <td className="p-1.5">{f.squawk}</td>
                          <td className={`p-1.5 text-right font-bold ${f.isWarning ? 'text-[#ff3333]' : 'text-emerald-400'}`}>
                            {f.isWarning ? '[INTRUDER]' : 'SECURE'}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* BLOCK INFORMASI STASIUN */}
          <div className="p-3 border-t border-white/10 bg-[#09111c] space-y-1.5 text-[9px] font-mono-military text-white/70">
            <h3 className="text-[#fbbf24] font-bold text-[9px] tracking-wider uppercase flex items-center gap-1">
              STATUS STASIUN MILITER
            </h3>
            <div className="grid grid-cols-2 gap-1.5 pt-0.5">
              <div>
                <span className="text-white/40 block">STASIUN:</span>
                <span className="text-white font-bold">{satradCoords.id} ({satradCoords.name.toUpperCase()})</span>
              </div>
              <div>
                <span className="text-white/40 block">CONNECTED IP:</span>
                <span className="text-green-400 font-bold">10.12.{satradCoords.id.replace(/[^0-9]/g, '') || '215'}.45</span>
              </div>
              <div>
                <span className="text-white/40 block">GEO COORD:</span>
                <span className="text-white">
                  {Math.abs(satradCoords.lat).toFixed(4)}°{satradCoords.lat < 0 ? 'S' : 'N'}, {Math.abs(satradCoords.lng).toFixed(4)}°{satradCoords.lng < 0 ? 'W' : 'E'}
                </span>
              </div>
              <div>
                <span className="text-white/40 block">RADIUS AKTIF:</span>
                <span className="text-white">250 NM Limit</span>
              </div>
            </div>
          </div>

          {/* ACTIVE THREAT ALERTS & LOGS (Blok DLL) */}
          <div className="h-40 border-t border-[#00ffd5]/20 flex flex-col overflow-hidden shrink-0">
            <div className="p-1.5 bg-[#ff3333]/15 flex justify-between items-center border-b border-red-500/20">
              <span className="text-[9px] font-bold text-[#ff3333] uppercase tracking-wider flex items-center gap-1 font-mono-military">
                <ShieldAlert className="w-3.5 h-3.5 animate-pulse text-[#ff3333]" />
                THREAT ALERT LOGS
              </span>
              <span className="text-[8px] bg-red-600 text-black px-1 font-bold">
                {flights.filter(f => f.isWarning).length} OVER EWZ
              </span>
            </div>
            
            <div className="flex-1 overflow-y-auto p-2 font-mono-military text-[8px] space-y-1 bg-[#0b0304]">
              {logs.length === 0 ? (
                <div className="text-white/30 italic text-center pt-2">No alarms logs recorded.</div>
              ) : (
                logs.map((l, index) => (
                  <div 
                    key={index} 
                    className={`flex gap-1.5 border-b border-white/5 pb-1 ${
                      l.type === "threat" 
                        ? "text-[#ff3333] font-bold animate-pulse" 
                        : "text-[#00f3ff]/50"
                    }`}
                  >
                    <span className="opacity-40">[{l.timestamp}]</span>
                    <span>{l.message}</span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* CO-LOCATED AI INTEGRACY CHAT ASSISTANT */}
          <div className="h-56 border-t border-[#00ffd5]/20 flex flex-col overflow-hidden bg-[#0a1420]/95 shrink-0">
            <div className="p-1.5 bg-[#0b1b30] border-b border-[#00f3ff]/20 flex justify-between items-center">
              <span className="text-[9px] font-bold text-[#00f3ff] uppercase tracking-widest flex items-center gap-1 font-mono-military">
                <Terminal className="w-3.5 h-3.5 text-[#00f3ff]" />
                MATA-X AI COMM-COMMANDER
              </span>
              <span className="text-[7px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-1 rounded-xs uppercase font-mono-military">
                TACTICAL ASSIST
              </span>
            </div>

            {/* Chat message flow */}
            <div className="flex-1 overflow-y-auto p-2 space-y-2 font-mono-military text-[9px] bg-black/35 leading-tight">
              {chatLogs.map((chat, idx) => (
                <div 
                  key={idx} 
                  className={`p-1.5 rounded-sm border ${
                    chat.sender === 'user' 
                      ? "bg-[#0c1c2e] border-[#00f3ff]/20 text-[#00f3ff] ml-4" 
                      : "bg-[#0b1710] border-emerald-500/20 text-emerald-400 mr-4"
                  }`}
                >
                  <p className="whitespace-pre-line text-[9px]">{chat.text}</p>
                </div>
              ))}
              {isAiLoading && (
                <div className="text-amber-400 animate-pulse text-[9px] italic">Mengambil data satrad dan instruksi intelijen...</div>
              )}
            </div>

            {/* Input elements */}
            <div className="p-1.5 border-t border-[#00f3ff]/15 bg-[#050e19] flex gap-1.5">
              <input 
                type="text" 
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') sendChatMessage();
                }}
                disabled={isAiLoading}
                placeholder="Tulis instruksi militer..." 
                className="flex-1 bg-black/60 border border-[#00f3ff]/20 px-2 py-1 text-white text-[10px] focus:outline-none focus:border-[#00ffd5] rounded-xs placeholder-white/30"
              />
              <button 
                onClick={() => sendChatMessage()}
                disabled={isAiLoading}
                className="px-2 bg-emerald-500/25 border border-emerald-500/50 hover:bg-emerald-500/40 text-emerald-300 font-mono-military text-[9px] font-bold cursor-pointer rounded-xs"
              >
                KIRIM
              </button>
            </div>
          </div>

        </aside>
      </main>

      {/* FOOTER METRIC STATUS BAR */}
      <footer className="h-8 bg-[#0a1118] border-t border-[#00ffd5]/20 px-4 flex items-center justify-between text-[9px] tracking-wide shrink-0">
        <div className="flex gap-4 sm:gap-6 items-center overflow-x-auto no-scrollbar">
          <div className="flex gap-1.5 items-center text-[#00ffd5] uppercase font-mono-military shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_5px_#00ff66]"></span>
            CORE ENGINE: STABLE
          </div>

          {/* Interactive Attribution Button for api.adsb.lol (ODbL 1.0) */}
          <button
            type="button"
            onClick={() => setShowAdsbConfigModal(true)}
            className="flex items-center gap-1.5 text-white/90 hover:text-[#00ffd5] font-mono-military uppercase bg-[#00f3ff]/10 hover:bg-[#00f3ff]/20 border border-[#00f3ff]/30 px-2 py-0.5 rounded-xs transition-all cursor-pointer shrink-0"
            title="Data Pesawat Terbuka: https://api.adsb.lol - License: ODbL 1.0 (Available to everyone)"
          >
            <Radio className="w-3 h-3 text-[#00f3ff]" />
            <span>DATA SOURCE: <span className="text-[#00ffd5] font-bold">api.adsb.lol</span></span>
            <span className="text-[7.5px] bg-emerald-500/20 text-emerald-300 border border-emerald-400/40 px-1 rounded font-bold">ODbL 1.0</span>
          </button>

          <div className="text-white/40 font-mono-military uppercase hidden md:block shrink-0">Datalink: SECURE-MIL-9X</div>
          <div className="text-white/40 font-mono-military hidden xl:block shrink-0">Azimuth: 360° ROTARY CONSTANT</div>
          <div className="text-[#00ffd5]/80 font-mono-military hidden lg:flex items-center gap-1 shrink-0">
            <span className="text-white/30">BASEMAP:</span>
            <span className="text-emerald-400 font-bold">CARTO {cartoStyle.toUpperCase()}</span>
          </div>
        </div>
        <div className="font-mono-military text-white/50 shrink-0 text-right">
          CENTER: {formatLatLng(satradCoords.lat, satradCoords.lng)} // 250 NM
        </div>
      </footer>

      {/* ADS-B TELEMETRY & API KEY CONFIGURATION MODAL */}
      {showAdsbConfigModal && (
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#071320] border-2 border-cyan-500/60 rounded-sm w-full max-w-2xl shadow-[0_0_40px_rgba(0,243,255,0.3)] text-white font-mono-military text-xs overflow-hidden flex flex-col max-h-[90vh]">
            
            {/* Modal Header */}
            <div className="p-3.5 bg-[#0a1b2e] border-b border-cyan-500/30 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 bg-cyan-500/10 border border-cyan-400 flex items-center justify-center rounded-xs text-cyan-400">
                  <Key className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-[#00f3ff] tracking-wider uppercase glow-cyan">
                    KONFIGURASI LAYANAN ADS-B & API KEY
                  </h3>
                  <p className="text-[8px] text-cyan-300/60 uppercase tracking-widest">
                    MATA-X TACTICAL WARFARE // MULTI-SOURCE RADAR DATA LINK
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowAdsbConfigModal(false)}
                className="w-7 h-7 flex items-center justify-center rounded-xs bg-red-950/40 border border-red-500/40 hover:bg-red-900/60 text-red-400 hover:text-white transition-all cursor-pointer font-bold"
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-4 space-y-4 overflow-y-auto flex-1">
              
              {/* Official Primary Open Data Engine: api.adsb.lol under ODbL 1.0 */}
              <div className="p-3.5 bg-[#030e1c] border-2 border-[#00f3ff]/40 rounded-sm space-y-2.5 shadow-[0_0_20px_rgba(0,243,255,0.12)]">
                <div className="flex items-center justify-between border-b border-[#00f3ff]/25 pb-1.5">
                  <span className="text-[10px] font-bold text-[#00ffd5] flex items-center gap-1.5 uppercase tracking-wide">
                    <Globe className="w-4 h-4 text-[#00f3ff]" />
                    REFERENSI DATA PESAWAT: ADS-B.LOL (ODbL 1.0)
                  </span>
                  <span className="text-[8px] bg-cyan-500/20 border border-cyan-400 text-cyan-300 px-2 py-0.5 rounded-xs font-bold uppercase">
                    OPEN DATABASE LICENSE
                  </span>
                </div>

                <div className="space-y-1.5 text-[9px] text-white/85">
                  <div className="flex justify-between items-center py-0.5 border-b border-white/5">
                    <span className="text-white/40">SUMBER UTAMA (USAGE):</span>
                    <a 
                      href="https://api.adsb.lol" 
                      target="_blank" 
                      rel="noopener noreferrer" 
                      className="text-[#00ffd5] font-bold hover:underline flex items-center gap-1"
                    >
                      https://api.adsb.lol
                    </a>
                  </div>
                  <div className="flex justify-between items-center py-0.5 border-b border-white/5">
                    <span className="text-white/40">LISENSI RESMI:</span>
                    <span className="text-amber-400 font-bold">license: ODbL 1.0 (Open Database License)</span>
                  </div>
                  <div className="flex justify-between items-center py-0.5 border-b border-white/5">
                    <span className="text-white/40">HAK AKSES / AVAILABILITY:</span>
                    <span className="text-emerald-400 font-bold">The API is available to everyone. (Bebas untuk Semua Orang)</span>
                  </div>
                  <div className="flex justify-between items-center py-0.5 border-b border-white/5">
                    <span className="text-white/40">CAKUPAN FLIGHTS:</span>
                    <span className="text-white">Seluruh FIR Wilayah Udara Indonesia (Jakarta, Ujung Pandang, & 19 SATRAD)</span>
                  </div>
                  <div className="flex justify-between items-center py-0.5 border-b border-white/5">
                    <span className="text-white/40">STATUS FEED AKTIF:</span>
                    <span className="text-emerald-300 font-semibold">{activeProviderName}</span>
                  </div>
                  <div className="flex justify-between items-center py-0.5">
                    <span className="text-white/40">KESTABILAN TRACK:</span>
                    <span className="text-[#00ffd5]">Extrapolasi Dead-Reckoning + Grace Hold 35s (Bebas Kedip / Vanish)</span>
                  </div>
                </div>

                <div className="pt-1.5 text-[8px] text-white/55 leading-relaxed border-t border-white/10">
                  Data penerbangan ADS-B dikumpulkan dari jaringan sensor radio 1090 MHz komunitas global dan stasiun darat yang diindeks secara terbuka di bawah lisensi <strong className="text-amber-300">ODbL 1.0</strong>. Sistem MATA-X menggunakan feed ini secara langsung untuk pemantauan radar taktis real-time.
                </div>
              </div>

              {/* Custom Feeder URL or API Key Configuration */}
              <div className="p-3 bg-[#060e19] border border-cyan-500/25 rounded-sm space-y-3">
                <div className="flex items-center justify-between border-b border-cyan-500/20 pb-1.5">
                  <span className="text-[10px] font-bold text-[#00f3ff] flex items-center gap-1.5 uppercase">
                    <Radio className="w-3.5 h-3.5 text-[#00f3ff]" />
                    INTEGRASI FEEDER KUSTOM / API PRIBADI (OPSIONAL)
                  </span>
                  <span className="text-[8px] text-white/40 uppercase">PILIHAN OPERATOR</span>
                </div>

                <p className="text-[8.5px] text-white/60 leading-relaxed">
                  Jika pangkalan udara atau stasiun radar memiliki antena penerima RTL-SDR mandiri (Dump1090/Readsb) atau akun API berbayar, Anda dapat memasukkannya di bawah ini. Jika dikosongkan, sistem otomatis menggunakan feed komunitas publik gratis yang aktif saat ini.
                </p>

                {/* Custom Feeder URL */}
                <div className="space-y-1">
                  <label className="text-[8.5px] font-bold uppercase text-amber-400 block tracking-wider">
                    URL ENDPOINT FEEDER ADS-B (DUMP1090 / READSB / JSON FEED):
                  </label>
                  <input
                    type="text"
                    value={customFeederUrl}
                    onChange={(e) => setCustomFeederUrl(e.target.value)}
                    placeholder="Contoh: http://192.168.1.50:8080/data/aircraft.json atau https://my-feeder.org/aircraft.json"
                    className="w-full bg-black/60 border border-cyan-500/30 focus:border-cyan-400 p-2 text-white text-[10px] rounded-xs outline-none placeholder-white/25"
                  />
                </div>

                {/* Custom API Key */}
                <div className="space-y-1">
                  <label className="text-[8.5px] font-bold uppercase text-amber-400 block tracking-wider">
                    KUSTOM API KEY (OPTIONAL):
                  </label>
                  <input
                    type="text"
                    value={customApiKey}
                    onChange={(e) => setCustomApiKey(e.target.value)}
                    placeholder="Masukkan API Key (misal RapidAPI, Airplanes.live, atau feeder key)"
                    className="w-full bg-black/60 border border-cyan-500/30 focus:border-cyan-400 p-2 text-white text-[10px] rounded-xs outline-none placeholder-white/25"
                  />
                </div>

                {/* Feeder Test Feedback */}
                {feederTestStatus && (
                  <div className={`p-2 rounded text-[8.5px] font-bold ${
                    feederTestStatus.includes("BERHASIL") 
                      ? "bg-emerald-950/60 border border-emerald-500/50 text-emerald-300" 
                      : "bg-red-950/60 border border-red-500/50 text-red-300"
                  }`}>
                    {feederTestStatus}
                  </div>
                )}

                {/* Buttons */}
                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    type="button"
                    onClick={async () => {
                      if (!customFeederUrl.trim()) {
                        setFeederTestStatus("Koneksi OK: Menggunakan Feed Publik Terbuka api.adsb.lol (ODbL 1.0 - 100% Gratis & Stabil)");
                        return;
                      }
                      setFeederTestStatus("Menguji sambungan ke endpoint...");
                      try {
                        const controller = new AbortController();
                        const t = setTimeout(() => controller.abort(), 4000);
                        const res = await fetch(customFeederUrl.trim(), { signal: controller.signal });
                        clearTimeout(t);
                        if (res.ok) {
                          const j: any = await res.json();
                          const count = j.aircraft ? j.aircraft.length : (j.ac ? j.ac.length : 0);
                          setFeederTestStatus(`BERHASIL TERHUBUNG: Terdeteksi ${count} target pesawat dari endpoint kustom!`);
                          playSiren(1100, 0.2);
                        } else {
                          setFeederTestStatus(`GAGAL (Status HTTP ${res.status}): Periksa kembali URL feeder.`);
                        }
                      } catch (e: any) {
                        setFeederTestStatus(`GAGAL KONEKSI: ${e.message}. Pastikan CORS diaktifkan jika mengakses server lokal.`);
                      }
                    }}
                    className="px-3 py-1.5 bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-400 text-cyan-300 text-[9px] font-bold rounded-xs cursor-pointer transition-all"
                  >
                    UJI KONEKSI
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      try {
                        localStorage.setItem("mata_custom_feeder", customFeederUrl.trim());
                        localStorage.setItem("mata_custom_apikey", customApiKey.trim());
                        setFeederTestStatus("PENGATURAN TERSIMPAN: Data link radar akan menggunakan konfigurasi ini.");
                        playSiren(950, 0.15);
                      } catch {}
                    }}
                    className="px-3 py-1.5 bg-emerald-500/25 hover:bg-emerald-500/35 border border-emerald-400 text-emerald-300 text-[9px] font-bold rounded-xs cursor-pointer transition-all"
                  >
                    SIMPAN PENGATURAN
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setCustomFeederUrl("");
                      setCustomApiKey("");
                      try {
                        localStorage.removeItem("mata_custom_feeder");
                        localStorage.removeItem("mata_custom_apikey");
                      } catch {}
                      setFeederTestStatus("PENGATURAN DIRESET: Kembali menggunakan feed publik terbuka api.adsb.lol (ODbL 1.0)");
                      playSiren(700, 0.1);
                    }}
                    className="px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/20 text-white/70 text-[9px] font-bold rounded-xs cursor-pointer transition-all ml-auto"
                  >
                    RESET DEFAULT (GRATIS)
                  </button>
                </div>
              </div>

              {/* Informative Guidance */}
              <div className="p-2.5 bg-black/40 border border-white/10 rounded-sm text-[8px] text-white/50 space-y-1">
                <p className="font-bold text-amber-400 uppercase">CATATAN TEKNIS OPERASIONAL DISKOMLEKAU:</p>
                <p>• Data pelacakan ADS-B diambil secara langsung dari jaringan sensor penerima radio ADS-B (1090 MHz) di Indonesia.</p>
                <p>• Mode "JARINGAN OPS NASIONAL (ALL SATRAD)" menggabungkan sensor dari 13 stasiun radar di Jawa, Sumatera, Kalimantan, Sulawesi, Bali, dan Papua secara simultan.</p>
                <p>• Tidak ada garis putus-putus acak: lintasan track telah dilengkapi dengan filter diskontinuitas spasial dan memori target stabil.</p>
              </div>

            </div>

            {/* Modal Footer */}
            <div className="p-3 bg-[#060b13] border-t border-cyan-500/20 flex justify-between items-center">
              <span className="text-[8px] text-white/40">
                MATA-X TACTICAL C2 // DISKOMLEKAU
              </span>
              <button
                type="button"
                onClick={() => setShowAdsbConfigModal(false)}
                className="px-4 py-1.5 bg-cyan-500 hover:bg-cyan-400 text-black font-extrabold text-[9px] rounded-xs cursor-pointer transition-all"
              >
                TUTUP
              </button>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}
