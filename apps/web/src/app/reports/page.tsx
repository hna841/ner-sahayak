'use client';

import { useEffect, useState, useRef } from 'react';
import { collection, query, orderBy, onSnapshot, Timestamp, doc, updateDoc, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/AuthProvider';

interface Report {
  id: string;
  type: string;
  status: string;
  severity: number;
  corridorId: string;
  description?: string;
  lat?: number;
  lng?: number;
  reporterId?: string;
  photoUrl?: string;
  createdAt: Timestamp;
}

// Reports submitted within this many ms are considered "new" and get a badge
const NEW_THRESHOLD_MS = 60_000;

function isNew(report: Report): boolean {
  if (!report.createdAt) return false;
  const ts = report.createdAt?.toDate ? report.createdAt.toDate().getTime() : new Date(report.createdAt as unknown as string).getTime();
  return Date.now() - ts < NEW_THRESHOLD_MS;
}

function toTimestamp(r: Report): number {
  if (!r.createdAt) return 0;
  return r.createdAt?.toDate ? r.createdAt.toDate().getTime() : new Date(r.createdAt as unknown as string).getTime();
}

function formatTime(report: Report): string {
  const ts = toTimestamp(report);
  if (!ts) return 'Unknown';
  return new Date(ts).toLocaleString();
}

// ── Toast notification ────────────────────────────────────────────────────────
interface Toast { id: number; report: Report }

function ToastBanner({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  const typeLabel = toast.report.type.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  useEffect(() => {
    const t = setTimeout(() => onDismiss(toast.id), 8000);
    return () => clearTimeout(t);
  }, [toast.id, onDismiss]);

  return (
    <div className="flex items-center gap-3 bg-panel text-primary px-4 py-3 rounded-md mb-2 animate-pulse border-l-4 border-status-watch">
      <span className="text-xl">🚨</span>
      <div className="flex-1">
        <div className="font-semibold text-sm">NEW REPORT — {typeLabel}</div>
        <div className="text-xs text-caption">Severity {toast.report.severity}/5 · {toast.report.corridorId?.toUpperCase()}</div>
      </div>
      <button onClick={() => onDismiss(toast.id)} className="text-caption hover:text-primary text-lg leading-none transition-colors">×</button>
    </div>
  );
}

// ── Photo modal ───────────────────────────────────────────────────────────────
function PhotoModal({ url, onClose }: { url: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-void/90" onClick={onClose}>
      <div className="relative max-w-2xl w-full mx-4" onClick={e => e.stopPropagation()}>
        <button onClick={onClose} className="absolute -top-10 right-0 text-primary text-3xl leading-none">×</button>
        <img src={url} alt="Incident photo" className="w-full rounded-[24px] bg-panel" />
      </div>
    </div>
  );
}

export default function ReportsPage() {
  const { user } = useAuth();
  const [reports, setReports] = useState<Report[]>([]);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [photoModal, setPhotoModal] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const prevIdsRef = useRef<Set<string>>(new Set());
  const toastCounterRef = useRef(0);

  const dismissToast = (id: number) => setToasts(t => t.filter(x => x.id !== id));

  useEffect(() => {
    if (!user) return;

    let q;
    if (filterStatus === 'all') {
      q = query(collection(db, 'reports'), orderBy('createdAt', 'desc'));
    } else {
      q = query(
        collection(db, 'reports'),
        where('status', '==', filterStatus),
        orderBy('createdAt', 'desc')
      );
    }

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as Report[];

      // Detect genuinely new reports (not in previous snapshot) for toast
      const newOnes = data.filter(r => !prevIdsRef.current.has(r.id) && isNew(r));
      if (newOnes.length > 0 && prevIdsRef.current.size > 0) {
        // Only show toasts after initial load (prevIds populated)
        setToasts(prev => [
          ...newOnes.map(r => ({ id: ++toastCounterRef.current, report: r })),
          ...prev,
        ]);
      }
      prevIdsRef.current = new Set(data.map(r => r.id));

      setReports(data);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user, filterStatus]);

  const updateStatus = async (reportId: string, status: string) => {
    setUpdatingId(reportId);
    try {
      await updateDoc(doc(db, 'reports', reportId), { status });
    } catch (e) {
      alert('Failed to update status: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setUpdatingId(null);
    }
  };

  const shareReport = (report: Report) => {
    const typeLabel = report.type.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const locStr = (report.lat != null && report.lng != null)
      ? `${report.lat.toFixed(5)}, ${report.lng.toFixed(5)}`
      : 'Unknown';
    const text =
      `🚨 NER Sahayak Incident Report\n` +
      `Type: ${typeLabel}\n` +
      `Severity: ${report.severity}/5\n` +
      `Description: ${report.description || 'N/A'}\n` +
      `Location: ${locStr}\n` +
      `Status: ${report.status}\n` +
      `Time: ${formatTime(report)}`;
    const waUrl = `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(waUrl, '_blank');
  };

  if (!user) return null;

  return (
    <div className="p-8 max-w-7xl mx-auto">
      {/* Toast notifications — top right, stack */}
      <div className="fixed top-4 right-4 z-50 w-80">
        {toasts.map(t => <ToastBanner key={t.id} toast={t} onDismiss={dismissToast} />)}
      </div>

      {photoModal && <PhotoModal url={photoModal} onClose={() => setPhotoModal(null)} />}

      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold text-primary">Incident Reports</h1>

        <div className="flex items-center gap-3">
          <label htmlFor="status-filter" className="text-sm font-medium text-caption">Filter Status:</label>
          <select
            id="status-filter"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="bg-raised text-primary rounded-md focus:ring-accent focus:border-accent sm:text-sm p-2 outline-none border-none"
          >
            <option value="all">All Incidents</option>
            <option value="unconfirmed">Unconfirmed</option>
            <option value="confirmed">Confirmed</option>
            <option value="resolved">Resolved</option>
          </select>
        </div>
      </div>

      <div className="bg-panel rounded-[24px] overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-caption">Loading reports...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-overlay">
              <thead className="bg-raised">
                <tr>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-bold text-caption uppercase tracking-wider">Type / ID</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-bold text-caption uppercase tracking-wider">GPS Location</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-bold text-caption uppercase tracking-wider">Photo</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-bold text-caption uppercase tracking-wider">Description</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-bold text-caption uppercase tracking-wider">Sev</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-bold text-caption uppercase tracking-wider">Status</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-bold text-caption uppercase tracking-wider">Time</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-bold text-caption uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-panel divide-y divide-overlay">
                {reports.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-6 py-8 text-center text-caption">No reports found.</td>
                  </tr>
                ) : (
                  reports.map((report) => (
                    <tr key={report.id} className={`hover:bg-raised transition-colors ${isNew(report) ? 'bg-raised/50 border-l-4 border-status-watch' : ''}`}>
                      {/* Type / ID */}
                      <td className="px-4 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          {isNew(report) && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-bold bg-status-watch text-void uppercase tracking-[0.7em] animate-pulse">NEW</span>
                          )}
                          <div>
                            <div className="text-sm font-medium text-primary capitalize">{report.type.replace(/-/g, ' ')}</div>
                            <div className="text-xs text-caption font-mono">{report.id.substring(0, 8)}…</div>
                          </div>
                        </div>
                      </td>

                      {/* GPS — clickable Google Maps link */}
                      <td className="px-4 py-4 whitespace-nowrap text-sm">
                        {(report.lat != null && report.lng != null) ? (
                          <a
                            href={`https://www.google.com/maps?q=${report.lat},${report.lng}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-accent hover:underline font-mono text-xs"
                          >
                            {report.lat.toFixed(4)}, {report.lng.toFixed(4)}
                          </a>
                        ) : (
                          <span className="text-caption text-xs">No GPS</span>
                        )}
                      </td>

                      {/* Photo — thumbnail, click to full-screen modal */}
                      <td className="px-4 py-4 whitespace-nowrap">
                        {report.photoUrl ? (
                          <button onClick={() => setPhotoModal(report.photoUrl!)} className="focus:outline-none">
                            <img
                              src={report.photoUrl}
                              alt="Incident"
                              className="h-10 w-10 rounded object-cover border-none hover:ring-2 hover:ring-accent transition-all"
                            />
                          </button>
                        ) : (
                          <span className="text-xs text-caption">None</span>
                        )}
                      </td>

                      {/* Description */}
                      <td className="px-4 py-4 max-w-xs">
                        <div className="text-sm text-body truncate" title={report.description}>
                          {report.description || <span className="text-caption italic">No description</span>}
                        </div>
                      </td>

                      {/* Severity */}
                      <td className="px-4 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <div className={`h-2.5 w-2.5 rounded-sm mr-2 ${
                            report.severity >= 4 ? 'bg-status-critical' :
                            report.severity >= 3 ? 'bg-status-watch' : 'bg-status-clear'
                          }`}></div>
                          <span className="text-sm text-primary">{report.severity}/5</span>
                        </div>
                      </td>

                      {/* Status badge */}
                      <td className="px-4 py-4 whitespace-nowrap">
                        <span className={`px-2 py-0.5 inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wider rounded ${
                          report.status === 'resolved' ? 'bg-status-clear/20 text-status-clear' :
                          report.status === 'confirmed' ? 'bg-status-watch/20 text-status-watch' :
                          'bg-raised text-caption'
                        }`}>
                          {report.status}
                        </span>
                      </td>

                      {/* Time */}
                      <td className="px-4 py-4 whitespace-nowrap text-xs text-caption">
                        {formatTime(report)}
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-4 whitespace-nowrap">
                        <div className="flex flex-col gap-1">
                          {report.status === 'unconfirmed' && (
                            <button
                              onClick={() => updateStatus(report.id, 'confirmed')}
                              disabled={updatingId === report.id}
                              className="text-xs px-3 py-1 bg-transparent border border-status-watch text-status-watch rounded-[100px] hover:bg-status-watch/10 transition-colors disabled:opacity-50"
                            >
                              Confirm
                            </button>
                          )}
                          {report.status !== 'resolved' && (
                            <button
                              onClick={() => updateStatus(report.id, 'resolved')}
                              disabled={updatingId === report.id}
                              className="text-xs px-3 py-1 bg-transparent border border-status-clear text-status-clear rounded-[100px] hover:bg-status-clear/10 transition-colors disabled:opacity-50"
                            >
                              Resolve
                            </button>
                          )}
                          <button
                            onClick={() => shareReport(report)}
                            className="text-xs px-3 py-1 bg-accent text-white rounded-[100px] hover:opacity-90 transition-opacity border-none"
                          >
                            📤 Share
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
