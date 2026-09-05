import { auth, fdb } from './firebase.js';
import { onSnapshot, doc, collection } from 'firebase/firestore';

import { initAuth, login, demoLogin, googleLogin } from './auth.js';
import { SyncEngine } from './sync.js';
import { submitReport } from './report-form.js';
import { renderStatusBoard, subscribeCorridorUpdates } from './status-board.js';
import { renderCorridorMap, startLiveLocationTracking } from './map.js';
import { initSafeRouteButton, updateSafeRouteButton } from './safe-route.js';
import { setLanguage, getLanguage, t } from './i18n.js';
import { plainLanguageRisk } from './risk.js';

// ── GPS state — updated in background, never blocks form submission ──────────
let _gpsCoords = { lat: null, lng: null };

function startGpsWatch() {
  const dot = document.getElementById('gps-dot');
  const label = document.getElementById('gps-label');
  if (!navigator.geolocation) {
    label.textContent = '📍 GPS not available';
    return;
  }
  label.textContent = '📍 Acquiring GPS...';
  dot.style.background = '#f59e0b'; // amber = acquiring

  navigator.geolocation.watchPosition(
    (pos) => {
      _gpsCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      const acc = Math.round(pos.coords.accuracy);
      label.textContent = `📍 ${_gpsCoords.lat.toFixed(5)}, ${_gpsCoords.lng.toFixed(5)} (±${acc}m)`;
      dot.style.background = '#15803d'; // green = locked
    },
    () => {
      // Permission denied or timeout — silent fallback, form still works
      label.textContent = '📍 GPS unavailable — location omitted';
      dot.style.background = '#64748b';
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
  );
}

// ── Photo preview — no network, instant on file select ───────────────────────
document.getElementById('report-photo').addEventListener('change', (e) => {
  const file = e.target.files[0];
  const preview = document.getElementById('photo-preview');
  if (file) {
    preview.src = URL.createObjectURL(file);
    preview.style.display = 'block';
  } else {
    preview.style.display = 'none';
    preview.src = '';
  }
});

// ── Confirmation overlay ─────────────────────────────────────────────────────
function showConfirmation({ type, severity, description, coords, photoObjectUrl }) {
  const overlay = document.getElementById('confirm-overlay');
  const confirmPhoto = document.getElementById('confirm-photo');
  const details = document.getElementById('confirm-details');

  if (photoObjectUrl) {
    confirmPhoto.src = photoObjectUrl;
    confirmPhoto.style.display = 'block';
  } else {
    confirmPhoto.style.display = 'none';
  }

  const typeLabel = type.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const locStr = (coords.lat != null)
    ? `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`
    : 'Location unavailable';
  const now = new Date().toLocaleString();

  details.innerHTML = `
    <div><strong style="color:var(--text-primary)">Type:</strong> ${typeLabel}</div>
    <div><strong style="color:var(--text-primary)">Severity:</strong> ${severity}/5</div>
    <div><strong style="color:var(--text-primary)">Description:</strong> ${description}</div>
    <div><strong style="color:var(--text-primary)">GPS:</strong> ${locStr}</div>
    <div><strong style="color:var(--text-primary)">Filed at:</strong> ${now}</div>
    <div style="margin-top:0.5rem;font-size:0.75rem;color:var(--status-watch);">⏳ Stored locally — will sync to control room when online</div>
  `;

  // Share text works fully offline (navigator.share for text needs no network)
  const shareText =
    `🚨 NER Sahayak Incident Report\n` +
    `Type: ${typeLabel}\n` +
    `Severity: ${severity}/5\n` +
    `Description: ${description}\n` +
    `Location: ${locStr}\n` +
    `Time: ${now}\n` +
    `Status: Pending sync to Control Room`;

  document.getElementById('confirm-share').onclick = async () => {
    if (navigator.share) {
      try { await navigator.share({ title: 'NER Sahayak Incident Report', text: shareText }); return; }
      catch { /* cancelled — fall through */ }
    }
    try {
      await navigator.clipboard.writeText(shareText);
      alert('Report details copied to clipboard!');
    } catch {
      alert(shareText); // last resort
    }
  };

  document.getElementById('confirm-close').onclick = () => {
    overlay.classList.add('hidden');
    if (photoObjectUrl) URL.revokeObjectURL(photoObjectUrl);
  };

  overlay.classList.remove('hidden');
}

// ── i18n ─────────────────────────────────────────────────────────────────────
const appTitle = document.getElementById('app-title');
const authView = document.getElementById('auth-view');
const appView = document.getElementById('app-view');
const langSelect = document.getElementById('lang-select');
const authSubmit = document.getElementById('auth-submit');
const reportSubmit = document.getElementById('report-submit');
const severityInput = document.getElementById('report-severity');
const riskPreview = document.getElementById('risk-preview');

langSelect.value = getLanguage();
langSelect.addEventListener('change', (e) => {
  setLanguage(e.target.value);
  updateTranslations();
});

function updateTranslations() {
  appTitle.textContent = t('app.name') || 'NER Sahayak';
  document.getElementById('login-title').textContent = 'Control Room Login';
  authSubmit.textContent = 'Login';
  document.getElementById('status-title').textContent = t('status.title') || 'Corridor Status (NH-27)';
  document.getElementById('report-title').textContent = t('report.title') || 'Submit Report';
  document.getElementById('severity-label').textContent = t('report.severityLabel') || 'Severity (1-5)';
  document.getElementById('report-submit').textContent = t('report.submit') || 'Submit Report';
  updateSafeRouteButton();
  updateRiskPreview();
}

// ── Auth flow ─────────────────────────────────────────────────────────────────
initAuth(auth, (user) => {
  if (user) {
    authView.classList.add('hidden');
    appView.classList.remove('hidden');

    startGpsWatch(); // non-blocking; GPS runs in background while form is visible

    const syncEngine = new SyncEngine(fdb);
    syncEngine.start();

    window.addEventListener('nersahayak:sync', () => {
      import('./status-board.js').then(m => m.renderPendingBadge());
    });

    subscribeCorridorUpdates(fdb, onSnapshot, collection, doc);
    renderCorridorMap().then(() => {
      startLiveLocationTracking();
      initSafeRouteButton();
    });
  } else {
    authView.classList.remove('hidden');
    appView.classList.add('hidden');
  }
});

authSubmit.addEventListener('click', async () => {
  const email = document.getElementById('auth-email').value;
  const pass = document.getElementById('auth-pass').value;
  if (email && pass) {
    try { await login(auth, email, pass); }
    catch (e) { alert('Login failed: ' + e.message); }
  }
});

document.getElementById('auth-demo').addEventListener('click', async () => {
  try { await demoLogin(auth, fdb); }
  catch (e) { alert('Demo Login failed: ' + e.message); }
});

document.getElementById('auth-google').addEventListener('click', async () => {
  try { await googleLogin(auth, fdb); }
  catch (e) { alert('Google Login failed: ' + e.message); }
});

// ── Report Form ───────────────────────────────────────────────────────────────
function updateRiskPreview() {
  const sev = parseInt(severityInput.value, 10);
  const type = document.getElementById('report-type').value;
  const risk = plainLanguageRisk({ severity: sev / 5, type, weatherImpact: 0, roadCondition: 0 }, t);
  riskPreview.textContent = risk.message + ' (' + risk.score + ')';
}

severityInput.addEventListener('input', updateRiskPreview);
document.getElementById('report-type').addEventListener('change', updateRiskPreview);

reportSubmit.addEventListener('click', async () => {
  const type = document.getElementById('report-type').value;
  const sev = parseInt(severityInput.value, 10);
  const desc = document.getElementById('report-desc').value;
  const photoInput = document.getElementById('report-photo');
  const photoFile = photoInput.files[0];

  if (!desc) {
    alert(t('common.error') || 'Please enter a description');
    return;
  }

  reportSubmit.disabled = true;
  reportSubmit.textContent = 'Filing...';

  // Snapshot coords and photo URL before clearing the form
  const photoObjectUrl = photoFile ? URL.createObjectURL(photoFile) : null;
  const coords = { ..._gpsCoords };

  try {
    await submitReport({ type, severity: sev, description: desc, photoFile });

    document.getElementById('report-desc').value = '';
    photoInput.value = '';
    document.getElementById('photo-preview').style.display = 'none';
    document.getElementById('photo-preview').src = '';

    showConfirmation({ type, severity: sev, description: desc, coords, photoObjectUrl });
  } catch (e) {
    alert('Failed to file report: ' + e.message);
    if (photoObjectUrl) URL.revokeObjectURL(photoObjectUrl);
  } finally {
    reportSubmit.disabled = false;
    reportSubmit.textContent = t('report.submit') || 'Submit Report';
  }
});

// ── Initial renders ───────────────────────────────────────────────────────────
updateTranslations();
renderStatusBoard();

// Register Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      console.log('SW registered:', reg.scope);
    }).catch(err => {
      console.log('SW registration failed:', err);
    });
  });
}
