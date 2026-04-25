/**
 * js/main.js
 *
 * Frontend JavaScript for the CyberWatch Kenya homepage.
 *
 * WHAT THIS FILE DOES:
 * 1. Fetches scam posts from the backend API
 * 2. Renders them as cards in a grid
 * 3. Handles search and category filtering
 * 4. Opens full post in a modal
 * 5. Handles newsletter subscription form
 * 6. Handles scam report form
 */

// ─────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────

const API = 'https://cyberwatch-kenya.onrender.com/api';

// State
let currentPage = 1;
let currentCategory = 'All';
let currentSearch = '';
let searchDebounceTimer = null;

// ─────────────────────────────────────────────
// INIT — runs when page loads
// ─────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  loadPosts();
  loadStats();
});

// ─────────────────────────────────────────────
// LOAD POSTS FROM API
// ─────────────────────────────────────────────

async function loadPosts() {
  const grid = document.getElementById('alertsGrid');
  const countEl = document.getElementById('resultCount');

  grid.innerHTML = `
    <div class="loading-overlay" style="grid-column:1/-1;">
      <div class="spinner"></div>
      <span>Fetching latest alerts...</span>
    </div>
  `;

  try {
    // Build URL with filters
    const params = new URLSearchParams({
      page: currentPage,
      limit: 9
    });
    if (currentCategory !== 'All') params.set('category', currentCategory);
    if (currentSearch) params.set('search', currentSearch);

    const res = await fetch(`${API}/newsletters?${params}`);
    const data = await res.json();

    if (!data.success) throw new Error(data.message);

    const { data: posts, total, pages } = data;

    // Update result count
    countEl.textContent = `${total} alert${total !== 1 ? 's' : ''} found`;

    if (posts.length === 0) {
      grid.innerHTML = `
        <div style="grid-column:1/-1; text-align:center; padding:60px; color:var(--muted);">
          <div style="font-size:48px; margin-bottom:16px;">🔍</div>
          <p>No scam alerts found for your search.</p>
          <button class="btn btn-outline btn-sm" style="margin-top:16px;" onclick="setCategory('All', document.querySelector('.filter-chip'))">
            Clear Filters
          </button>
        </div>
      `;
      return;
    }

    // Render cards
    grid.innerHTML = posts.map(post => renderPostCard(post)).join('');

    // Render pagination
    renderPagination(currentPage, pages);

  } catch (err) {
    grid.innerHTML = `
      <div style="grid-column:1/-1; text-align:center; padding:60px;">
        <div class="alert alert-error">
          ❌ Failed to load posts. Make sure the backend server is running on port 5000.
        </div>
        <button class="btn btn-outline btn-sm" style="margin-top:16px;" onclick="loadPosts()">
          Try Again
        </button>
      </div>
    `;
  }
}

// ─────────────────────────────────────────────
// RENDER A SINGLE POST CARD
// ─────────────────────────────────────────────

function renderPostCard(post) {
  const categoryClass = getCategoryClass(post.category);
  const date = new Date(post.createdAt).toLocaleDateString('en-KE', {
    day: 'numeric', month: 'short', year: 'numeric'
  });
  const excerpt = post.description.substring(0, 180).replace(/\n/g, ' ') + '...';

  return `
    <div class="card scam-card" onclick="openPost('${post._id}')">
      <div class="scam-card-header">
        <h3 class="scam-card-title">${escapeHTML(post.title)}</h3>
        <span class="category-badge ${categoryClass}">${post.category}</span>
      </div>
      <p class="scam-card-excerpt">${escapeHTML(excerpt)}</p>
      <div class="scam-card-footer">
        <span>📅 ${date}</span>
        <span>👤 ${escapeHTML(post.author)}</span>
        <span style="color:var(--cyan);">Read more →</span>
      </div>
    </div>
  `;
}

// ─────────────────────────────────────────────
// OPEN POST IN MODAL
// ─────────────────────────────────────────────

async function openPost(id) {
  const overlay = document.getElementById('modalOverlay');
  const content = document.getElementById('modalContent');

  overlay.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  content.innerHTML = '<div class="loading-overlay"><div class="spinner"></div><span>Loading...</span></div>';

  try {
    const res = await fetch(`${API}/newsletters/${id}`);
    const data = await res.json();
    const post = data.data;

    const date = new Date(post.createdAt).toLocaleDateString('en-KE', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });

    const categoryClass = getCategoryClass(post.category);
    const formattedContent = post.description
      .split('\n')
      .map(line => line.trim() ? `<p style="margin-bottom:10px;">${escapeHTML(line)}</p>` : '<br>')
      .join('');

    const tagsHTML = post.tags && post.tags.length
      ? post.tags.map(t => `<span style="background:rgba(0,255,65,0.1); border:1px solid rgba(0,255,65,0.2); color:var(--green); padding:2px 10px; border-radius:12px; font-size:11px; font-family:var(--font-mono); margin-right:6px;">#${t}</span>`).join('')
      : '';

    content.innerHTML = `
      <div>
        <div style="margin-bottom:16px;">
          <span class="category-badge ${categoryClass}">${post.category}</span>
        </div>
        <h2 style="color:#fff; font-size:1.4rem; line-height:1.3; margin-bottom:16px;">${escapeHTML(post.title)}</h2>
        <div style="display:flex; gap:20px; font-size:12px; color:var(--muted); font-family:var(--font-mono); margin-bottom:24px; flex-wrap:wrap;">
          <span>📅 ${date}</span>
          <span>👤 ${escapeHTML(post.author)}</span>
        </div>
        <div style="border-left:3px solid var(--green); padding-left:16px; color:var(--text); font-size:14px; line-height:1.7;">
          ${formattedContent}
        </div>
        ${tagsHTML ? `<div style="margin-top:20px;">${tagsHTML}</div>` : ''}
        <div style="margin-top:24px; padding-top:20px; border-top:1px solid var(--border); font-size:13px; color:var(--muted);">
          <strong style="color:var(--red);">⚠️ Stay Safe:</strong> If you've encountered this scam,
          <a href="#report" onclick="closeModal()">report it here</a> to help protect others.
        </div>
      </div>
    `;

  } catch (err) {
    content.innerHTML = '<div class="alert alert-error">Failed to load post.</div>';
  }
}

function closeModal() {
  document.getElementById('modalOverlay').classList.add('hidden');
  document.body.style.overflow = '';
}

function closeModalOnOverlay(e) {
  if (e.target === document.getElementById('modalOverlay')) closeModal();
}

// ─────────────────────────────────────────────
// SEARCH & FILTER
// ─────────────────────────────────────────────

function setCategory(cat, el) {
  currentCategory = cat;
  currentPage = 1;

  // Update active chip
  document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
  if (el) el.classList.add('active');

  loadPosts();
}

function debounceSearch() {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    currentSearch = document.getElementById('searchInput').value.trim();
    currentPage = 1;
    loadPosts();
  }, 400);
}

// ─────────────────────────────────────────────
// PAGINATION
// ─────────────────────────────────────────────

function renderPagination(current, total) {
  const el = document.getElementById('pagination');
  if (total <= 1) { el.innerHTML = ''; return; }

  let html = '';
  for (let i = 1; i <= total; i++) {
    html += `<button class="page-btn ${i === current ? 'active' : ''}" onclick="goToPage(${i})">${i}</button>`;
  }
  el.innerHTML = html;
}

function goToPage(page) {
  currentPage = page;
  loadPosts();
  document.getElementById('alerts').scrollIntoView({ behavior: 'smooth' });
}

// ─────────────────────────────────────────────
// SUBSCRIPTION FORM
// ─────────────────────────────────────────────

async function subscribeUser() {
  const name = document.getElementById('subName').value.trim();
  const email = document.getElementById('subEmail').value.trim();
  const btn = document.getElementById('subscribeBtn');
  const alertBox = document.getElementById('subscribeAlert');

  alertBox.innerHTML = '';

  if (!name) { alertBox.innerHTML = '<div class="alert alert-error">⚠️ Please enter your name.</div>'; return; }
  if (!email) { alertBox.innerHTML = '<div class="alert alert-error">⚠️ Please enter your email.</div>'; return; }
  if (!isValidEmail(email)) { alertBox.innerHTML = '<div class="alert alert-error">⚠️ Please enter a valid email address.</div>'; return; }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>';

  try {
    const res = await fetch(`${API}/subscribers/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email })
    });
    const data = await res.json();

    if (data.success) {
      alertBox.innerHTML = `<div class="alert alert-success">✅ ${data.message}</div>`;
      document.getElementById('subName').value = '';
      document.getElementById('subEmail').value = '';
    } else {
      const msg = data.errors ? data.errors[0].msg : data.message;
      alertBox.innerHTML = `<div class="alert alert-error">❌ ${msg}</div>`;
    }

  } catch (err) {
    alertBox.innerHTML = '<div class="alert alert-error">❌ Server error. Please try again.</div>';
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Subscribe →';
  }
}

// ─────────────────────────────────────────────
// SCAM REPORT FORM
// ─────────────────────────────────────────────

function showReportThanks(name, type, platform) {
  document.getElementById('reportThanksName').textContent = `Your report has been logged, ${name}!`;
  document.getElementById('thanksSummaryType').textContent = type || '—';
  document.getElementById('thanksSummaryPlatform').textContent = platform || 'Not specified';
  document.getElementById('reportThanksOverlay').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeReportThanks() {
  document.getElementById('reportThanksOverlay').classList.add('hidden');
  document.body.style.overflow = '';
}

async function submitScamReport() {
  const name = document.getElementById('reportName').value.trim();
  const email = document.getElementById('reportEmail').value.trim();
  const type = document.getElementById('reportType').value;
  const platform = document.getElementById('reportPlatform').value.trim();
  const amount = document.getElementById('reportAmount').value || 0;
  const county = document.getElementById('reportCounty')?.value || '';
  const description = document.getElementById('reportDescription').value.trim();
  const btn = document.getElementById('reportBtn');
  const alertBox = document.getElementById('reportAlert');

  alertBox.innerHTML = '';

  if (!name) { alertBox.innerHTML = '<div class="alert alert-error">⚠️ Please enter your name.</div>'; return; }
  if (!type) { alertBox.innerHTML = '<div class="alert alert-error">⚠️ Please select the type of scam.</div>'; return; }
  if (description.length < 30) { alertBox.innerHTML = '<div class="alert alert-error">⚠️ Please describe the scam in more detail (at least 30 characters).</div>'; return; }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Submitting...';

  try {
    const res = await fetch(`${API}/subscribers/report-scam`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reporterName: name,
        reporterEmail: email,
        scamType: type,
        platform,
        county,
        amountLost: parseInt(amount),
        description
      })
    });
    const data = await res.json();

    if (data.success) {
      // Clear form
      ['reportName','reportEmail','reportPlatform','reportAmount','reportDescription'].forEach(id => document.getElementById(id).value = '');
      document.getElementById('reportType').value = '';
      if(document.getElementById('reportCounty')) document.getElementById('reportCounty').value = '';
      alertBox.innerHTML = '';

      // Show thank you modal
      showReportThanks(name, type, platform);
    } else {
      const msg = data.errors ? data.errors[0].msg : data.message;
      alertBox.innerHTML = `<div class="alert alert-error">❌ ${msg}</div>`;
    }

  } catch (err) {
    alertBox.innerHTML = '<div class="alert alert-error">❌ Server error. Please try again.</div>';
  } finally {
    btn.disabled = false;
    btn.innerHTML = '🚨 Submit Report';
  }
}

// ─────────────────────────────────────────────
// LOAD STATS (for hero counters)
// ─────────────────────────────────────────────


// ─────────────────────────────────────────────
// SCAM CHECKER
// ─────────────────────────────────────────────

async function runCheck() {
  const input   = document.getElementById('checkerInput');
  const results = document.getElementById('checkerResults');
  const btn     = document.getElementById('checkerBtn');
  const query   = input?.value.trim();

  if (!query || query.length < 3) {
    if (results) results.innerHTML = `
      <div style="text-align:center;padding:16px;color:#ff6600;font-size:13px;">
        ⚠️ Please enter at least 3 characters to search.
      </div>`;
    return;
  }

  btn.textContent = '...';
  btn.disabled    = true;
  results.innerHTML = `
    <div style="text-align:center;padding:24px;color:#6b8a6b;font-size:13px;">
      <div style="width:20px;height:20px;border:2px solid rgba(0,255,65,0.2);border-top-color:#00ff41;border-radius:50%;animation:spin 0.7s linear infinite;margin:0 auto 10px;"></div>
      Checking database...
    </div>`;

  try {
    const res  = await fetch(`${API}/check?q=${encodeURIComponent(query)}`);
    const data = await res.json();

    if (!data.found) {
      results.innerHTML = `
        <div style="background:rgba(0,255,65,0.06);border:1px solid rgba(0,255,65,0.2);border-radius:12px;padding:20px;text-align:center;">
          <div style="font-size:36px;margin-bottom:10px;">✅</div>
          <div style="font-size:16px;font-weight:700;color:#00ff41;margin-bottom:6px;">Not Found in Our Database</div>
          <div style="font-size:13px;color:#6b8a6b;line-height:1.7;margin-bottom:16px;">
            No reports found for <strong style="color:#fff;">"${escapeHTML(query)}"</strong>.<br>
            This doesn't guarantee it's safe — always verify independently.
          </div>
          <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
            <a href="#report" style="background:rgba(0,255,65,0.1);border:1px solid rgba(0,255,65,0.3);color:#00ff41;padding:8px 18px;border-radius:8px;text-decoration:none;font-size:12px;font-weight:700;">
              🚨 Report this number
            </a>
            <a href="subscribe.html" style="background:#00ff41;color:#000;padding:8px 18px;border-radius:8px;text-decoration:none;font-size:12px;font-weight:700;">
              🛡️ Get Free Alerts
            </a>
          </div>
        </div>`;
    } else {
      const typeColors = {
        'Mobile Money Scam': '#ff6600',
        'Phishing':          '#ff2244',
        'Crypto Scam':       '#ff2244',
        'Employment Scam':   '#ffcc00',
        'Romance Scam':      '#ff6600',
        'E-commerce Fraud':  '#ffcc00',
        'Investment Scam':   '#ff2244',
        'Impersonation':     '#ff6600',
        'Online Fraud':      '#ffcc00',
        'Other':             '#888888'
      };

      const resultsHTML = data.results.map(r => {
        const color = typeColors[r.category] || '#888';
        const date  = new Date(r.date).toLocaleDateString('en-KE', { day:'numeric', month:'short', year:'numeric' });
        return `
          <div style="background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.06);border-left:3px solid ${color};border-radius:0 10px 10px 0;padding:14px 16px;margin-bottom:10px;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;flex-wrap:wrap;gap:6px;">
              <span style="background:${color};color:#000;font-size:10px;font-weight:800;padding:2px 10px;border-radius:10px;letter-spacing:1px;">${r.category}</span>
              <span style="font-family:'Courier New',monospace;font-size:10px;color:#334433;">${date}</span>
            </div>
            ${r.platform ? `<div style="font-size:11px;color:#557755;margin-bottom:6px;font-family:'Courier New',monospace;">Platform: ${escapeHTML(r.platform)}</div>` : ''}
            <p style="margin:0;font-size:13px;color:#aabbaa;line-height:1.6;">${escapeHTML(r.preview)}</p>
            ${r.lost > 0 ? `<div style="margin-top:6px;font-size:11px;color:#ff4444;font-family:'Courier New',monospace;">⚠️ KSh ${r.lost.toLocaleString()} reported lost</div>` : ''}
          </div>`;
      }).join('');

      results.innerHTML = `
        <div style="background:rgba(255,34,68,0.08);border:1px solid rgba(255,34,68,0.3);border-radius:12px;padding:16px 20px;margin-bottom:16px;text-align:center;">
          <div style="font-size:32px;margin-bottom:8px;">🚨</div>
          <div style="font-size:16px;font-weight:800;color:#ff2244;margin-bottom:4px;">
            WARNING — ${data.count} Report${data.count !== 1 ? 's' : ''} Found
          </div>
          <div style="font-size:13px;color:#aabbaa;">
            <strong style="color:#fff;">"${escapeHTML(query)}"</strong> has been reported by Kenyans. Be very careful.
          </div>
        </div>
        ${resultsHTML}
        <div style="background:rgba(0,255,65,0.05);border:1px solid rgba(0,255,65,0.15);border-radius:10px;padding:16px;text-align:center;margin-top:8px;">
          <p style="font-size:13px;color:#6b8a6b;margin:0 0 12px;">Subscribe to get warned before these scams reach you</p>
          <a href="subscribe.html" style="display:inline-block;background:#00ff41;color:#000;padding:10px 24px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:800;">
            🛡️ Get Free Scam Alerts →
          </a>
        </div>`;
    }
  } catch (err) {
    results.innerHTML = `
      <div style="text-align:center;padding:16px;color:#ff6600;font-size:13px;">
        ❌ Could not connect. Please try again.
      </div>`;
  } finally {
    btn.textContent = 'CHECK →';
    btn.disabled    = false;
  }
}

async function loadStats() {
  try {
    const [postsRes, subsRes, reportsRes] = await Promise.all([
      fetch(`${API}/newsletters`),
      fetch(`${API}/subscribers/count`),
      fetch(`${API}/subscribers/reports/count`)
    ]);

    const postsData   = await postsRes.json();
    const subsData    = await subsRes.json().catch(() => ({ count: 0 }));
    const reportsData = await reportsRes.json().catch(() => ({ count: 0 }));

    const totalPosts   = postsData.total   || 0;
    const totalSubs    = subsData.count    || 0;
    const totalReports = reportsData.count || 0;

    // Hero stats (top of page)
    animateCounter('statPosts',       totalPosts);
    animateCounter('statSubscribers', 1250);

    // Social proof stats (lower section)
    animateCounter('proStatSubs',    1250,    '+');
    animateCounter('proStatAlerts',  totalPosts,   '+');
    animateCounter('proStatReports', totalReports, '+');

  } catch (e) {
    console.error('Stats error:', e);
    // Fallback so numbers show something
    ['statSubscribers','proStatSubs'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = '—';
    });
  }
}

function animateCounter(id, target, suffix = '') {
  const el = document.getElementById(id);
  if (!el) return;
  const numTarget = parseInt(target) || 0;
  if (numTarget === 0) { el.textContent = '0' + suffix; return; }
  let count = 0;
  const duration = 1500;
  const startTime = performance.now();
  function step(now) {
    const elapsed  = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased    = 1 - Math.pow(1 - progress, 3); // ease out cubic
    count = Math.floor(numTarget * eased);
    el.textContent = count.toLocaleString() + suffix;
    if (progress < 1) requestAnimationFrame(step);
    else el.textContent = numTarget.toLocaleString() + suffix;
  }
  requestAnimationFrame(step);
}

// ─────────────────────────────────────────────
// NAVBAR MOBILE TOGGLE
// ─────────────────────────────────────────────

function toggleNav() {
  document.getElementById('navLinks').classList.toggle('open');
}

// ─────────────────────────────────────────────
// HELPER FUNCTIONS
// ─────────────────────────────────────────────

function getCategoryClass(category) {
  const map = {
    'Phishing': 'phishing',
    'Crypto Scam': 'crypto',
    'Employment Scam': 'employment',
    'Mobile Money Scam': 'mobile-money',
    'Romance Scam': 'romance',
    'E-commerce Fraud': 'ecommerce',
    'Investment Scam': 'crypto',
    'Impersonation': 'phishing',
    'Online Fraud': 'phishing',
  };
  return map[category] || 'other';
}

function escapeHTML(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isValidEmail(email) {
  return /^\S+@\S+\.\S+$/.test(email);
}
