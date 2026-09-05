'use client';

import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, LayersControl, Polyline, Marker, Popup, Tooltip } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { NH27_CORRIDOR } from '@shared/constants/corridors';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';

// Fix Leaflet's default icon issue with Next.js/Turbopack
const defaultIcon = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  tooltipAnchor: [16, -28],
  shadowSize: [41, 41]
});

// Custom pulsing red circle for OSINT events
const osintIcon = L.divIcon({
  className: 'custom-osint-marker',
  html: `<div style="width: 14px; height: 14px; background-color: #ef4444; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 10px rgba(239,68,68,0.8); animation: pulse 1.5s infinite;"></div>`,
  iconSize: [14, 14],
  iconAnchor: [7, 7]
});

// We need a CSS animation for the pulse
if (typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.innerHTML = `
    @keyframes pulse {
      0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(239,68,68,0.7); }
      70% { transform: scale(1); box-shadow: 0 0 0 10px rgba(239,68,68,0); }
      100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(239,68,68,0); }
    }
  `;
  document.head.appendChild(style);
}

interface EonetEvent {
  id: string;
  title: string;
  geometry: { date: string; coordinates: [number, number] }[];
}

interface IncidentReport {
  id: string;
  type: string;
  severity: number;
  description?: string;
  status: string;
  lat?: number;
  lng?: number;
  reporterId?: string;
  createdAt?: { toDate?: () => Date } | string;
}

// Severity-coded incident pin icons
function incidentIcon(severity: number) {
  const color = severity >= 4 ? '#dc2626' : severity >= 3 ? '#d97706' : '#2563eb';
  return L.divIcon({
    className: 'incident-marker',
    html: `<div style="width:18px;height:18px;background:${color};border-radius:50%;border:2.5px solid white;box-shadow:0 0 8px ${color}88;"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

const getTimeAgo = (isoString: string) => {
  const diff = Date.now() - new Date(isoString).getTime();
  const hours = Math.floor(diff / (1000 * 60 * 60));
  if (hours === 0) {
    const minutes = Math.floor(diff / (1000 * 60));
    return `${minutes} minutes ago`;
  }
  return `${hours} hours ago`;
};

export default function CorridorMap() {
  const [events, setEvents] = useState<EonetEvent[]>([]);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(false);
  const [incidents, setIncidents] = useState<IncidentReport[]>([]);

  useEffect(() => {
    async function fetchOsint() {
      try {
        const res = await fetch('https://eonet.gsfc.nasa.gov/api/v3/events?category=10,11,15&bbox=88,22,97,28');
        if (!res.ok) throw new Error('Fetch failed');
        const data = await res.json();
        
        const timestamp = new Date().toISOString();
        const payload = { data: data.events, cachedAt: timestamp };
        
        localStorage.setItem('osint_nasa_events', JSON.stringify(payload));
        setEvents(data.events);
        setLastUpdated(timestamp);
        setIsOffline(false);
      } catch (err) {
        console.warn('EONET fetch failed, falling back to cache:', err);
        setIsOffline(true);
        const cached = localStorage.getItem('osint_nasa_events');
        if (cached) {
          const payload = JSON.parse(cached);
          setEvents(payload.data);
          setLastUpdated(payload.cachedAt);
        }
      }
    }

    fetchOsint();
  }, []);

  // Real-time Firestore subscription for incident reports with GPS data
  useEffect(() => {
    // Only subscribe when db is available (client-side)
    if (!db) return;
    const q = query(
      collection(db, 'reports'),
      where('lat', '!=', null)
    );
    const unsubscribe = onSnapshot(q, (snap) => {
      const data = snap.docs
        .map(d => ({ id: d.id, ...d.data() } as IncidentReport))
        .filter(r => r.lat != null && r.lng != null);
      setIncidents(data);
    }, () => { /* ignore errors — map still shows without incident layer */ });
    return () => unsubscribe();
  }, []);

  const center: [number, number] = [25.158, 93.01]; // Haflong approx
  const polylineCoords: [number, number][] = NH27_CORRIDOR.waypoints.map(wp => [wp.lat, wp.lng]);

  return (
    <div className="relative w-full h-[400px] rounded-[24px] overflow-hidden z-0 mb-8 bg-void shadow-[inset_0_4px_24px_rgba(0,0,0,0.5)] border border-overlay">
      {isOffline && lastUpdated && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-[1000] bg-status-watch/20 text-status-watch px-4 py-2 rounded-full text-sm font-semibold border border-status-watch/30">
          Live OSINT feed offline — last updated {getTimeAgo(lastUpdated)}.
        </div>
      )}
      
      <MapContainer center={center} zoom={8} style={{ height: '100%', width: '100%' }}>
        <LayersControl position="topright">
          <LayersControl.BaseLayer checked name="OpenStreetMap">
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name="OpenTopoMap">
            <TileLayer
              attribution='Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, <a href="http://viewfinderpanoramas.org">SRTM</a> | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)'
              url="https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png"
            />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name="ESRI World Imagery">
            <TileLayer
              attribution='Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            />
          </LayersControl.BaseLayer>
        </LayersControl>

        <Polyline positions={polylineCoords} color="#2563eb" weight={4} />

        {NH27_CORRIDOR.waypoints.map((wp, idx) => (
          <Marker key={idx} position={[wp.lat, wp.lng]} icon={defaultIcon}>
            <Tooltip>{wp.name}</Tooltip>
          </Marker>
        ))}

        {events.map((event) => {
          if (!event.geometry || event.geometry.length === 0) return null;
          // NASA returns [longitude, latitude]
          const lng = event.geometry[0].coordinates[0];
          const lat = event.geometry[0].coordinates[1];
          const date = new Date(event.geometry[0].date).toLocaleDateString();

          return (
            <Marker key={event.id} position={[lat, lng]} icon={osintIcon}>
              <Popup>
                <div className="font-semibold text-void">{event.title}</div>
                <div className="text-sm text-gray-500">Observed: {date}</div>
                <div className="text-xs text-status-critical mt-1 uppercase tracking-[0.2em] font-bold">Live OSINT Data</div>
              </Popup>
            </Marker>
          );
        })}

        {/* Live incident report pins from Firestore — real-time, color-coded by severity */}
        {incidents.map((report) => {
          const typeLabel = report.type.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
          const mapsUrl = `https://www.google.com/maps?q=${report.lat},${report.lng}`;
          const createdStr = (() => {
            if (!report.createdAt) return 'Unknown';
            if (typeof report.createdAt === 'object' && report.createdAt.toDate) {
              return report.createdAt.toDate().toLocaleString();
            }
            return new Date(report.createdAt as string).toLocaleString();
          })();
          return (
            <Marker key={report.id} position={[report.lat!, report.lng!]} icon={incidentIcon(report.severity)}>
              <Popup minWidth={200}>
                <div className="text-xs space-y-1 text-void">
                  <div className="font-bold text-sm">{typeLabel}</div>
                  <div><span className="font-semibold">Severity:</span> {report.severity}/5</div>
                  {report.description && <div><span className="font-semibold">Details:</span> {report.description}</div>}
                  <div>
                    <span className="font-semibold">GPS:</span>{' '}
                    <a href={mapsUrl} target="_blank" rel="noreferrer" className="text-accent underline">
                      {report.lat!.toFixed(4)}, {report.lng!.toFixed(4)}
                    </a>
                  </div>
                  <div><span className="font-semibold">Status:</span> {report.status}</div>
                  <div><span className="font-semibold">Filed:</span> {createdStr}</div>
                  <div className="pt-1 text-status-critical font-bold uppercase tracking-[0.2em]">🔴 Live Incident</div>
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>
    </div>
  );
}
