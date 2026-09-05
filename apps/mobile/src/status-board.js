import { db } from './db.js';

export async function renderStatusBoard() {
  const corridor = await db.corridorState.get('nh-27');
  const districts = await db.districts.toArray();

  const el = document.getElementById('status-board');
  if (!el) return;

  if (districts.length === 0) {
    el.innerHTML = '<div style="padding:1rem; text-align:center; color:#64748b;">No district data found</div>';
    return;
  }

  el.innerHTML = districts.map((d, i) => {
    const score = d.currentRiskScore || 0;
    const isCritical = score >= 0.7;
    const isWatch = score >= 0.3 && score < 0.7;
    const color = isCritical ? 'var(--status-critical)' : (isWatch ? 'var(--status-watch)' : 'var(--status-clear)');
    const filter = isCritical ? 'filter="drop-shadow(0 0 4px var(--status-critical))"' : '';
    
    // Circle r=40, circumference = 2 * PI * 40 = 251.2
    const circumference = 251.2;
    const targetOffset = circumference * (1 - score);
    
    const shortName = d.id === 'dima-hasao' ? 'Dima Hasao' : (d.id === 'cachar' ? 'Cachar' : d.id);
    
    return `
      <div class="gauge-container">
        <svg viewBox="0 0 100 100" width="100" height="100">
          <circle cx="50" cy="50" r="40" fill="transparent" stroke="var(--panel)" stroke-width="8" transform="rotate(-90 50 50)" />
          <circle 
            class="gauge-arc" id="gauge-arc-${i}"
            cx="50" cy="50" r="40" fill="transparent" 
            stroke="${color}" stroke-width="8" 
            stroke-dasharray="${circumference}" 
            stroke-dashoffset="${circumference}" 
            transform="rotate(-90 50 50)"
            stroke-linecap="round"
            ${filter}
            data-target="${targetOffset}"
          />
          <text id="gauge-text-${i}" x="50" y="47" class="gauge-text-score" data-score="${score * 100}">0</text>
          <text x="50" y="68" class="gauge-text-label">RISK</text>
        </svg>
        <span class="gauge-name">${shortName}</span>
      </div>
    `;
  }).join('');

  // Trigger animation after DOM flush
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      districts.forEach((d, i) => {
        const arc = document.getElementById(`gauge-arc-${i}`);
        const textElement = document.getElementById(`gauge-text-${i}`);
        if (arc && textElement) {
          // Animate the stroke
          arc.style.strokeDashoffset = arc.getAttribute('data-target');
          
          // Animate the number counting up
          const targetScore = parseFloat(textElement.getAttribute('data-score'));
          const duration = 1500; // matches CSS transition 1.5s
          const startTime = performance.now();
          
          const animateText = (currentTime) => {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);
            // ease-out cubic
            const easeProgress = 1 - Math.pow(1 - progress, 3);
            
            textElement.textContent = Math.round(easeProgress * targetScore);
            
            if (progress < 1) {
              requestAnimationFrame(animateText);
            } else {
              textElement.textContent = Math.round(targetScore);
            }
          };
          
          requestAnimationFrame(animateText);
        }
      });
    });
  });
}

export function subscribeCorridorUpdates(fdb, onSnapshot, collection, doc) {
  const corridorRef = doc(fdb, 'corridors', 'nh-27');
  const corridorUnsub = onSnapshot(corridorRef, async (snap) => {
    if (snap.exists()) {
      await db.corridorState.put({ corridorId: 'nh-27', ...snap.data() });
      renderStatusBoard();
    }
  });

  const districtsRef = collection(fdb, 'districts');
  const districtsUnsub = onSnapshot(districtsRef, async (snap) => {
    for (const d of snap.docs) {
      await db.districts.put({ id: d.id, ...d.data() });
    }
    renderStatusBoard();
  });

  return () => {
    corridorUnsub();
    districtsUnsub();
  };
}

/**
 * Updates the pending-report badge count in the UI immediately after a report
 * is written to the local IndexedDB outbox — no network call.
 */
export async function renderPendingBadge() {
  const count = await db.outbox.count();
  const badge = document.getElementById('pending-badge');
  if (badge) {
    badge.textContent = count > 0 ? `${count} pending` : '';
    if (count > 0) {
      badge.classList.remove('hidden');
      badge.style.display = 'inline';
    } else {
      badge.classList.add('hidden');
      badge.style.display = 'none';
    }
  }
}
