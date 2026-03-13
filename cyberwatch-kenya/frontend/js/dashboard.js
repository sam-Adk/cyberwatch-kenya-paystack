/**
 * js/dashboard.js
 *
 * Admin Dashboard JavaScript.
 *
 * WHAT THIS FILE DOES:
 * 1. Checks if user is logged in (has JWT token)
 * 2. Loads admin data: posts, subscribers, reports
 * 3. Handles creating, editing, deleting posts
 * 4. Handles sending newsletters via email
 * 5. Manages tab navigation
 */

const API = 'https://cyberwatch-kenya.onrender.com/api';

// ─────────────────────────────────────────────
// AUTH GUARD — redirect if not logged in
// ─────────────────────────────────────────────

const token = localStorage.getItem('cwk_token');
const user = JSON.parse(localStorage.getItem('cwk_user') || '{}');

if (!token) {
  window.location.href = 'login.html';
}

// ─────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // Show admin name
  document.getElementById('adminName').textContent = `// ${user.name || 'Admin'}`;
  document.getElementById('dashDate').textContent = new Date().toLocaleDateString('en-KE', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  // Load all data
  loadDashboardStats();
  loadPosts();
  loadSubscribers();
  loadReports();
});

// ─────────────────────────────────────────────
// HELPER: Authenticated fetch
// Every API call that requires admin must include the JWT token
// ─────────────────────────────────────────────

async function authFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`, // JWT token in header
      ...(options.headers || {})
    }
  });

  // If token expired, redirect to login
  if (res.status === 401) {
    localStorage.removeItem('cwk_token');
    localStorage.removeItem('cwk_user');
    window.location.href = 'login.html';
    return;
  }

  return res;
}

// ─────────────────────────────────────────────
// TAB NAVIGATION
// ─────────────────────────────────────────────

function showTab(name, linkEl) {
  // Hide all panels
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  // Show selected
  document.getElementById(`tab-${name}`).classList.add('active');

  // Update sidebar active state
  document.querySelectorAll('.sidebar-nav a').forEach(a => a.classList.remove('active'));
  if (linkEl) linkEl.classList.add('active');

  // Always reload fresh data when switching tabs
  if (name === 'subscribers') loadSubscribers();
  if (name === 'reports')     loadReports();
  if (name === 'overview')    loadDashboardStats();
}

// ─────────────────────────────────────────────
// DASHBOARD STATS
// ─────────────────────────────────────────────

async function loadDashboardStats() {
  try {
    const [postsRes, subsRes, reportsRes] = await Promise.all([
      authFetch(`${API}/newsletters/admin/all`),
      authFetch(`${API}/subscribers/admin/list`),
      authFetch(`${API}/subscribers/admin/reports`)
    ]);

    const postsData = await postsRes.json();
    const subsData = await subsRes.json();
    const reportsData = await reportsRes.json();

    const posts = postsData.data || [];
    const published = posts.filter(p => p.published).length;

    const allSubs    = subsData.data || [];
    const activeSubs = allSubs.filter(s => s.active).length;
    const premiumSubs = allSubs.filter(s => s.plan === 'premium' && s.active).length;

    document.getElementById('totalPosts').textContent = posts.length;
    document.getElementById('publishedPosts').textContent = published;
    document.getElementById('totalSubs').textContent = `${activeSubs} active`;
    document.getElementById('totalReports').textContent = (reportsData.data || []).length;

    // Also update homepage stats if elements exist
    const statPosts = document.getElementById('statPosts');
    const statSubs = document.getElementById('statSubscribers');
    if (statPosts) statPosts.textContent = published;
    if (statSubs) statSubs.textContent = subsData.total || 0;

  } catch (err) {
    console.error('Stats load error:', err);
  }
}

// ─────────────────────────────────────────────
// LOAD POSTS TABLE
// ─────────────────────────────────────────────

let allPosts = [];

async function loadPosts() {
  const tbody = document.getElementById('postsTableBody');

  try {
    const res = await authFetch(`${API}/newsletters/admin/all`);
    const data = await res.json();
    allPosts = data.data || [];

    if (allPosts.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:40px; color:var(--muted);">No posts yet. <a href="#" onclick="showTab('newpost', null)">Create your first post.</a></td></tr>`;
      return;
    }

    tbody.innerHTML = allPosts.map(post => {
      const audienceLabel = {
        'all':     '<span style="background:rgba(0,255,65,0.15);color:#00ff41;font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;">📡 All</span>',
        'free':    '<span style="background:rgba(100,200,100,0.15);color:#88cc88;font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;">🆓 Free</span>',
        'premium': '<span style="background:rgba(0,204,255,0.15);color:#00ccff;font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;">⭐ Premium</span>'
      }[post.audience || 'all'];

      const sendBtn = !post.sentToSubscribers
        ? `<button class="btn btn-outline btn-sm" onclick="sendNewsletter('${post._id}')" title="Send to ${post.audience === 'premium' ? 'premium' : post.audience === 'free' ? 'free' : 'all'} subscribers">📧 Send</button>`
        : '<span style="font-size:11px; color:var(--muted);">✅ Sent</span>';

      return `
      <tr>
        <td style="max-width:240px; font-weight:600;">${escapeHTML(post.title)}</td>
        <td><span class="category-badge ${getCategoryClass(post.category)}">${post.category}</span></td>
        <td>${audienceLabel}</td>
        <td><span class="status-badge ${post.published ? 'status-published' : 'status-draft'}">${post.published ? 'Published' : 'Draft'}</span></td>
        <td class="font-mono" style="font-size:11px; color:var(--muted);">${new Date(post.createdAt).toLocaleDateString('en-KE')}</td>
        <td>
          <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center;">
            <button class="btn btn-outline btn-sm" onclick="editPost('${post._id}')">✏️</button>
            <button class="btn btn-outline btn-sm" onclick="togglePublish('${post._id}', ${post.published})" title="${post.published ? 'Unpublish' : 'Publish'}">
              ${post.published ? '🙈' : '📢'}
            </button>
            ${sendBtn}
            <button class="btn btn-danger btn-sm" onclick="deletePost('${post._id}')">🗑️</button>
          </div>
        </td>
      </tr>`;
    }).join('');

  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="alert alert-error">Failed to load posts.</div></td></tr>`;
  }
}

// ─────────────────────────────────────────────
// CREATE / EDIT POST
// ─────────────────────────────────────────────

async function savePost() {
  const id = document.getElementById('editingPostId').value;
  const title = document.getElementById('postTitle').value.trim();
  const category = document.getElementById('postCategory').value;
  const description = document.getElementById('postContent').value.trim();
  const tagsStr = document.getElementById('postTags').value.trim();
  const author = document.getElementById('postAuthor').value.trim();
  const published = document.getElementById('postPublished').checked;
  const audience = document.querySelector('input[name="postAudience"]:checked')?.value || 'all';
  const alertBox = document.getElementById('postFormAlert');
  const btn = document.getElementById('savePostBtn');

  alertBox.innerHTML = '';

  if (!title) { alertBox.innerHTML = '<div class="alert alert-error">Title is required.</div>'; return; }
  if (!category) { alertBox.innerHTML = '<div class="alert alert-error">Category is required.</div>'; return; }
  if (!description) { alertBox.innerHTML = '<div class="alert alert-error">Content is required.</div>'; return; }

  const tags = tagsStr ? tagsStr.split(',').map(t => t.trim()).filter(Boolean) : [];
  const body = { title, category, description, author, published, tags, audience };

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Saving...';

  try {
    const url = id ? `${API}/newsletters/${id}` : `${API}/newsletters`;
    const method = id ? 'PUT' : 'POST';

    const res = await authFetch(url, {
      method,
      body: JSON.stringify(body)
    });
    const data = await res.json();

    if (data.success) {
      alertBox.innerHTML = `<div class="alert alert-success">✅ Post ${id ? 'updated' : 'created'} successfully!</div>`;
      clearPostForm();
      loadPosts();
      loadDashboardStats();
    } else {
      const msg = data.errors ? data.errors[0].msg : data.message;
      alertBox.innerHTML = `<div class="alert alert-error">❌ ${msg}</div>`;
    }

  } catch (err) {
    alertBox.innerHTML = '<div class="alert alert-error">❌ Server error. Please try again.</div>';
  } finally {
    btn.disabled = false;
    btn.innerHTML = '💾 Save Post';
  }
}

function editPost(id) {
  const post = allPosts.find(p => p._id === id);
  if (!post) return;

  document.getElementById('editingPostId').value = post._id;
  document.getElementById('postTitle').value = post.title;
  document.getElementById('postCategory').value = post.category;
  document.getElementById('postContent').value = post.description;
  document.getElementById('postTags').value = (post.tags || []).join(', ');
  document.getElementById('postAuthor').value = post.author;
  document.getElementById('postPublished').checked = post.published;
  // Set audience radio
  const audRadio = document.querySelector(`input[name="postAudience"][value="${post.audience || 'all'}"]`);
  if (audRadio) audRadio.click();
  document.getElementById('postFormTitle').textContent = 'Edit Post';

  showTab('newpost', null);
  window.scrollTo(0, 0);
}

function clearPostForm() {
  document.getElementById('editingPostId').value = '';
  document.getElementById('postTitle').value = '';
  document.getElementById('postCategory').value = '';
  document.getElementById('postContent').value = '';
  document.getElementById('postTags').value = '';
  document.getElementById('postAuthor').value = 'CyberWatch Kenya Team';
  document.getElementById('postPublished').checked = false;
  const allRadio = document.querySelector('input[name="postAudience"][value="all"]');
  if (allRadio) allRadio.click();
  document.getElementById('postFormTitle').textContent = 'New Post';
  document.getElementById('postFormAlert').innerHTML = '';
}

// ─────────────────────────────────────────────
// TOGGLE PUBLISH STATUS
// ─────────────────────────────────────────────

async function togglePublish(id, currentStatus) {
  try {
    const res = await authFetch(`${API}/newsletters/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ published: !currentStatus })
    });
    const data = await res.json();
    if (data.success) loadPosts();
  } catch (err) {
    alert('Failed to update post status.');
  }
}

// ─────────────────────────────────────────────
// DELETE POST
// ─────────────────────────────────────────────

async function deletePost(id) {
  if (!confirm('Are you sure you want to delete this post? This cannot be undone.')) return;

  try {
    const res = await authFetch(`${API}/newsletters/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      loadPosts();
      loadDashboardStats();
    }
  } catch (err) {
    alert('Failed to delete post.');
  }
}

// ─────────────────────────────────────────────
// SEND NEWSLETTER EMAIL
// ─────────────────────────────────────────────

async function sendNewsletter(id) {
  const post = allPosts.find(p => p._id === id);
  if (!post) return;

  const audienceLabel = {
    'all': 'ALL subscribers (free + premium)',
    'free': 'FREE subscribers only',
    'premium': 'PREMIUM subscribers only'
  }[post.audience || 'all'];

  if (!confirm(`Send "${post.title}" to ${audienceLabel}?\n\nThis action cannot be undone.`)) return;

  try {
    const res = await authFetch(`${API}/newsletters/${id}/send`, { method: 'POST' });
    const data = await res.json();

    if (data.success) {
      alert(`✅ ${data.message}`);
      loadPosts();
    } else {
      alert(`❌ ${data.message}`);
    }
  } catch (err) {
    alert('❌ Failed to send newsletter. Check email configuration in .env');
  }
}

// ─────────────────────────────────────────────
// LOAD SUBSCRIBERS
// ─────────────────────────────────────────────

async function loadSubscribers() {
  const tbody = document.getElementById('subsTableBody');
  const countEl = document.getElementById('subCount');

  try {
    const res = await authFetch(`${API}/subscribers/admin/list`);
    const data = await res.json();
    const subs = data.data || [];

    countEl.textContent = `${data.total} total`;

    if (subs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:40px; color:var(--muted);">No subscribers yet.</td></tr>';
      return;
    }

    tbody.innerHTML = subs.map(s => `
      <tr>
        <td style="font-weight:600;">${escapeHTML(s.name)}</td>
        <td class="font-mono" style="font-size:12px;">${escapeHTML(s.email)}</td>
        <td>
          ${s.plan === 'premium'
            ? '<span style="background:#00ccff;color:#000;font-size:10px;font-weight:800;padding:3px 10px;border-radius:10px;letter-spacing:1px;">⭐ PREMIUM</span>'
            : '<span style="background:rgba(0,255,65,0.15);color:#00ff41;font-size:10px;font-weight:700;padding:3px 10px;border-radius:10px;">📡 FREE</span>'
          }
        </td>
        <td><span class="status-badge ${s.active ? 'status-published' : 'status-draft'}">${s.active ? 'Active' : 'Inactive'}</span></td>
        <td class="font-mono" style="font-size:11px; color:var(--muted);">${new Date(s.createdAt).toLocaleDateString('en-KE')}</td>
      </tr>
    `).join('');

  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="4"><div class="alert alert-error">Failed to load subscribers.</div></td></tr>';
  }
}

// ─────────────────────────────────────────────
// LOAD SCAM REPORTS
// ─────────────────────────────────────────────

async function loadReports() {
  const tbody = document.getElementById('reportsTableBody');

  try {
    const res = await authFetch(`${API}/subscribers/admin/reports`);
    const data = await res.json();
    const reports = data.data || [];

    if (reports.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:40px; color:var(--muted);">No reports submitted yet.</td></tr>';
      return;
    }

    // Store reports globally so viewReport() can look them up safely
    window._cwkReports = reports;

    tbody.innerHTML = reports.map((r, index) => `
      <tr>
        <td style="font-weight:600;">${escapeHTML(r.reporterName)}</td>
        <td><span class="category-badge ${getCategoryClass(r.scamType)}">${r.scamType}</span></td>
        <td style="color:var(--muted); font-size:13px;">${escapeHTML(r.platform || '—')}</td>
        <td class="font-mono" style="font-size:12px; color:${r.amountLost > 0 ? 'var(--red)' : 'var(--muted)'};">
          ${r.amountLost > 0 ? `KSh ${r.amountLost.toLocaleString()}` : '—'}
        </td>
        <td><span class="status-badge ${r.status === 'published' ? 'status-published' : 'status-draft'}">${r.status}</span></td>
        <td class="font-mono" style="font-size:11px; color:var(--muted);">${new Date(r.createdAt).toLocaleDateString('en-KE')}</td>
        <td>
          <button class="btn btn-outline btn-sm" onclick="viewReport(${index})" style="font-size:11px; padding:4px 10px;">
            👁 View
          </button>
        </td>
      </tr>
    `).join('');

  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="6"><div class="alert alert-error">Failed to load reports.</div></td></tr>';
  }
}

// ─────────────────────────────────────────────
// LOGOUT
// ─────────────────────────────────────────────

// ─────────────────────────────────────────────
// VIEW REPORT MODAL
// ─────────────────────────────────────────────

function viewReport(index) {
  const r = window._cwkReports[index];
  if (!r) return;
  const modal = document.getElementById('reportModal');
  const content = document.getElementById('reportModalContent');

  const amountText = r.amountLost > 0
    ? `<span style="color:var(--red); font-weight:700;">KSh ${Number(r.amountLost).toLocaleString()}</span>`
    : '<span style="color:var(--muted);">None reported</span>';

  content.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:24px;">
      <div>
        <h2 style="margin:0 0 6px; color:#fff; font-size:1.3rem;">Scam Report Details</h2>
        <span class="category-badge ${getCategoryClass(r.scamType)}">${r.scamType}</span>
      </div>
      <span class="status-badge ${r.status === 'published' ? 'status-published' : 'status-draft'}">${r.status}</span>
    </div>

    <!-- Reporter Info -->
    <div style="background:var(--surface2); border:1px solid var(--border); border-radius:var(--radius); padding:20px; margin-bottom:16px;">
      <div style="font-family:var(--font-mono); font-size:11px; color:var(--green); letter-spacing:2px; margin-bottom:12px;">REPORTER INFO</div>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
        <div>
          <div style="font-size:11px; color:var(--muted); margin-bottom:3px;">NAME</div>
          <div style="color:#fff; font-weight:600;">${escapeHTML(r.reporterName)}</div>
        </div>
        <div>
          <div style="font-size:11px; color:var(--muted); margin-bottom:3px;">EMAIL</div>
          <div style="color:#fff;">${escapeHTML(r.reporterEmail || 'Not provided')}</div>
        </div>
        <div>
          <div style="font-size:11px; color:var(--muted); margin-bottom:3px;">PLATFORM</div>
          <div style="color:#fff;">${escapeHTML(r.platform || 'Not specified')}</div>
        </div>
        <div>
          <div style="font-size:11px; color:var(--muted); margin-bottom:3px;">AMOUNT LOST</div>
          <div>${amountText}</div>
        </div>
        <div>
          <div style="font-size:11px; color:var(--muted); margin-bottom:3px;">DATE REPORTED</div>
          <div style="color:#fff; font-family:var(--font-mono); font-size:13px;">${new Date(r.createdAt).toLocaleDateString('en-KE', { day:'numeric', month:'long', year:'numeric' })}</div>
        </div>
      </div>
    </div>

    <!-- Description -->
    <div style="background:var(--surface2); border:1px solid var(--border); border-radius:var(--radius); padding:20px; margin-bottom:16px;">
      <div style="font-family:var(--font-mono); font-size:11px; color:var(--green); letter-spacing:2px; margin-bottom:12px;">HOW THE SCAM HAPPENED</div>
      <p style="margin:0; color:#ccc; line-height:1.8; font-size:14px; white-space:pre-wrap;">${escapeHTML(r.description)}</p>
    </div>

    <!-- Actions -->
    <div style="display:flex; gap:12px; margin-top:8px;">
      <button class="btn btn-primary" onclick="publishReport('${r._id}')">
        📢 Publish as Alert
      </button>
      <button class="btn btn-outline" onclick="closeReportModal()">
        Close
      </button>
    </div>
  `;

  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeReportModal() {
  document.getElementById('reportModal').classList.add('hidden');
  document.body.style.overflow = '';
}

async function publishReport(reportId) {
  if (!confirm('Publish this report as a public scam alert? This will email ALL active subscribers.')) return;

  // Show loading state on button
  const btn = event.target;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Sending...';

  try {
    const res = await authFetch(`${API}/subscribers/admin/reports/${reportId}/publish`, { method: 'PUT' });
    const data = await res.json();

    if (data.success) {
      showToast(`✅ Published! Sent to ${data.sent} subscriber${data.sent !== 1 ? 's' : ''}.`);
      closeReportModal();
      loadReports();
    } else {
      showToast(`❌ ${data.message || 'Failed to publish'}`, 'error');
      btn.disabled = false;
      btn.innerHTML = '📢 Publish as Alert';
    }
  } catch (err) {
    console.error('Publish error:', err);
    showToast('❌ Cannot connect to server', 'error');
    btn.disabled = false;
    btn.innerHTML = '📢 Publish as Alert';
  }
}

function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.style.cssText = `
    position:fixed; bottom:24px; right:24px; z-index:9999;
    background:${type === 'error' ? '#ff2244' : '#00ff41'};
    color:${type === 'error' ? '#fff' : '#000'};
    padding:12px 24px; border-radius:8px; font-weight:700;
    font-size:14px; box-shadow:0 4px 20px rgba(0,0,0,0.5);
    animation: slideIn 0.3s ease;
  `;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

function logout() {
  if (confirm('Logout from the dashboard?')) {
    localStorage.removeItem('cwk_token');
    localStorage.removeItem('cwk_user');
    window.location.href = 'login.html';
  }
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function getCategoryClass(category) {
  const map = {
    'Phishing': 'phishing', 'Crypto Scam': 'crypto',
    'Employment Scam': 'employment', 'Mobile Money Scam': 'mobile-money',
    'Romance Scam': 'romance', 'E-commerce Fraud': 'ecommerce',
    'Investment Scam': 'crypto', 'Impersonation': 'phishing', 'Online Fraud': 'phishing'
  };
  return map[category] || 'other';
}

function escapeHTML(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
