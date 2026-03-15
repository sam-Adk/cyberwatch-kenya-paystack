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
  const isFormData = options.body instanceof FormData;
  const res = await fetch(url, {
    ...options,
    headers: {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      'Authorization': `Bearer ${token}`,
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

// ─────────────────────────────────────────────
// AUDIENCE SELECTOR
// ─────────────────────────────────────────────

function selectAudience(value) {
  // Check the right radio
  const radio = document.querySelector(`input[name="postAudience"][value="${value}"]`);
  if (radio) radio.checked = true;

  // Update visual highlight on all cards
  ['all','free','premium'].forEach(v => {
    const card = document.getElementById(`aud-${v}`);
    if (card) card.classList.remove('selected');
  });
  const selected = document.getElementById(`aud-${value}`);
  if (selected) selected.classList.add('selected');
}

// Set default highlight on page load
document.addEventListener('DOMContentLoaded', () => {
  selectAudience('all');
  removeImage();
});

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
  if (name === 'analytics')   loadAnalytics();
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
  const imageUrl      = document.getElementById('postImageUrl').value;
  const imagePublicId = document.getElementById('postImagePublicId').value;
  const body = { title, category, description, author, published, tags, audience, imageUrl: imageUrl || null, imagePublicId: imagePublicId || null };

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
  selectAudience(post.audience || 'all');
  if (post.imageUrl) {
    document.getElementById('postImageUrl').value      = post.imageUrl;
    document.getElementById('postImagePublicId').value = post.imagePublicId || '';
    document.getElementById('imagePreview').src        = post.imageUrl;
    document.getElementById('imageFileName').textContent = 'Current image';
    document.getElementById('imageUploadPlaceholder').classList.add('hidden');
    document.getElementById('imagePreviewWrap').classList.remove('hidden');
  } else {
    removeImage();
  }
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
  selectAudience('all');
  removeImage();
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
// SEND NEWSLETTER — audience modal
// ─────────────────────────────────────────────

let _sendingPostId = null;
let _sendingAudience = 'all';

function sendNewsletter(id) {
  const post = allPosts.find(p => p._id === id);
  if (!post) return;

  _sendingPostId = id;
  _sendingAudience = 'all';

  // Set modal title
  document.getElementById('sendModalTitle').textContent = `"${post.title}"`;

  // Reset selection to "all"
  selectSendAudience('all');

  // Show modal
  document.getElementById('sendModal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function toggleSMS() {
  const cb    = document.getElementById('smsToggle');
  const track = document.getElementById('smsToggleTrack');
  const thumb = document.getElementById('smsToggleThumb');
  cb.checked = !cb.checked;
  if (cb.checked) {
    track.style.background = 'rgba(0,204,255,0.2)';
    track.style.borderColor = '#00ccff';
    thumb.style.background = '#00ccff';
    thumb.style.transform = 'translateX(20px)';
  } else {
    track.style.background = '#1a2a1a';
    track.style.borderColor = '#2a4a2a';
    thumb.style.background = '#557755';
    thumb.style.transform = 'translateX(0)';
  }
}

function selectSendAudience(value) {
  _sendingAudience = value;
  ['all','free','premium'].forEach(v => {
    const card = document.getElementById(`saud-${v}`);
    if (!card) return;
    card.style.borderColor = '';
    card.style.background  = '';
  });
  const selected = document.getElementById(`saud-${value}`);
  if (selected) {
    selected.style.borderColor = value === 'premium' ? '#00ccff' : 'var(--green)';
    selected.style.background  = value === 'premium' ? 'rgba(0,204,255,0.07)' : 'rgba(0,255,65,0.07)';
  }
}

function closeSendModal() {
  document.getElementById('sendModal').classList.add('hidden');
  document.body.style.overflow = '';
  _sendingPostId = null;
  // Reset SMS toggle
  const cb = document.getElementById('smsToggle');
  if (cb) { cb.checked = false; toggleSMS(); cb.checked = false; }
}

async function confirmSendNewsletter() {
  if (!_sendingPostId) return;

  const btn = document.getElementById('sendConfirmBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Sending...';

  try {
    const sendSMS = document.getElementById('smsToggle')?.checked || false;
    const res = await authFetch(`${API}/newsletters/${_sendingPostId}/send`, {
      method: 'POST',
      body: JSON.stringify({ audience: _sendingAudience, sendSMS })
    });
    const data = await res.json();

    closeSendModal();

    if (data.success) {
      showToast(`✅ ${data.message}`);
      loadPosts();
      loadDashboardStats();
    } else {
      showToast(`❌ ${data.message}`, 'error');
    }
  } catch (err) {
    showToast('❌ Failed to send. Try again.', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '📧 Send Now';
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
        <td class="font-mono" style="font-size:12px;color:${s.phone ? 'var(--green)' : 'var(--muted)'};">
          ${s.phone ? '📱 ' + escapeHTML(s.phone) : '—'}
        </td>
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

// ─────────────────────────────────────────────
// SEND WEEKLY DIGEST MANUALLY
// ─────────────────────────────────────────────

async function sendTestDigest() {
  if (!confirm('Send the Weekly Digest NOW to all premium subscribers?\n\nThis will email a summary of the past 7 days\' alerts.')) return;

  const btn = event.target;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Sending...';

  try {
    const res  = await authFetch(`${API}/newsletters/admin/send-digest`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast('⭐ ' + data.message);
    } else {
      showToast('❌ ' + data.message, 'error');
    }
  } catch (err) {
    showToast('❌ Failed to send digest', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '⭐ Send Weekly Digest Now';
  }
}

// ─────────────────────────────────────────────
// IMAGE UPLOAD
// ─────────────────────────────────────────────

async function handleImageSelect(input) {
  if (input.files && input.files[0]) {
    await uploadImage(input.files[0]);
  }
}

function handleImageDrop(event) {
  event.preventDefault();
  document.getElementById('imageUploadArea').style.borderColor = '';
  const file = event.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) {
    uploadImage(file);
  }
}

async function uploadImage(file) {
  if (file.size > 5 * 1024 * 1024) {
    showToast('❌ Image must be under 5MB', 'error');
    return;
  }

  // Show spinner
  document.getElementById('imageUploadPlaceholder').classList.add('hidden');
  document.getElementById('imagePreviewWrap').classList.add('hidden');
  document.getElementById('imageUploadSpinner').classList.remove('hidden');

  const formData = new FormData();
  formData.append('image', file);

  try {
    const res  = await authFetch(`${API}/upload/image`, { method: 'POST', body: formData, headers: {} });
    const data = await res.json();

    document.getElementById('imageUploadSpinner').classList.add('hidden');

    if (data.success) {
      document.getElementById('postImageUrl').value      = data.imageUrl;
      document.getElementById('postImagePublicId').value = data.publicId;
      document.getElementById('imagePreview').src        = data.imageUrl;
      document.getElementById('imageFileName').textContent = file.name;
      document.getElementById('imagePreviewWrap').classList.remove('hidden');
      document.getElementById('imageUploadArea').style.borderColor = 'var(--green)';
      showToast('✅ Image uploaded!');
    } else {
      document.getElementById('imageUploadPlaceholder').classList.remove('hidden');
      showToast('❌ ' + data.message, 'error');
    }
  } catch (err) {
    document.getElementById('imageUploadSpinner').classList.add('hidden');
    document.getElementById('imageUploadPlaceholder').classList.remove('hidden');
    showToast('❌ Upload failed', 'error');
  }
}

function removeImage() {
  document.getElementById('postImageUrl').value      = '';
  document.getElementById('postImagePublicId').value = '';
  document.getElementById('imagePreview').src        = '';
  document.getElementById('imageFileName').textContent = '';
  document.getElementById('imageUploadPlaceholder').classList.remove('hidden');
  document.getElementById('imagePreviewWrap').classList.add('hidden');
  document.getElementById('imageUploadSpinner').classList.add('hidden');
  document.getElementById('imageUploadArea').style.borderColor = '';
  document.getElementById('imageFileInput').value = '';
}

// ─────────────────────────────────────────────
// ANALYTICS
// ─────────────────────────────────────────────

async function loadAnalytics() {
  // Single combined fetch with 10s timeout
  const token = localStorage.getItem('cwk_token');

  const makeRequest = (url) => {
    return Promise.race([
      fetch(url, { headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 10000))
    ]);
  };

  // --- STATS ---
  try {
    const res  = await makeRequest(`${API}/analytics/stats`);
    const data = await res.json();

    if (data.success) {
      const { stats, topPages, dailyStats } = data;

      document.getElementById('statTotalViews').textContent  = (stats.totalViews  || 0).toLocaleString();
      document.getElementById('statTodayViews').textContent  = (stats.todayViews  || 0).toLocaleString();
      document.getElementById('statWeekViews').textContent   = (stats.weekViews   || 0).toLocaleString();
      document.getElementById('statMonthViews').textContent  = (stats.monthViews  || 0).toLocaleString();

      const updated = document.getElementById('analyticsUpdated');
      if (updated) updated.textContent = 'Updated ' + new Date().toLocaleTimeString('en-KE');

      // Top pages
      const PAGE_NAMES_LOCAL = {
        '/': '🏠 Homepage', '/index.html': '🏠 Homepage',
        '/about.html': '👤 About', '/pricing.html': '💰 Pricing',
        '/scam-map.html': '🗺️ Scam Map', '/subscribe.html': '📧 Subscribe',
        '/login.html': '🔑 Login',
      };

      const topList = document.getElementById('topPagesList');
      if (topList) {
        if (!topPages || topPages.length === 0) {
          topList.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted);font-size:13px;">No page data yet</div>';
        } else {
          const maxV = topPages[0].count;
          topList.innerHTML = topPages.map(p => {
            const name = PAGE_NAMES_LOCAL[p._id] || p._id;
            const pct  = Math.round((p.count / maxV) * 100);
            return `<div style="margin-bottom:14px;">
              <div style="display:flex;justify-content:space-between;margin-bottom:5px;">
                <span style="font-size:13px;color:#ccc;">${name}</span>
                <span style="font-family:var(--font-mono);font-size:12px;color:var(--green);">${p.count}</span>
              </div>
              <div style="height:4px;background:var(--surface2);border-radius:2px;overflow:hidden;">
                <div style="width:${pct}%;height:100%;background:#00ff41;border-radius:2px;"></div>
              </div>
            </div>`;
          }).join('');
        }
      }

      // Daily chart
      const chartEl  = document.getElementById('dailyChart');
      const labelsEl = document.getElementById('dailyChartLabels');
      if (chartEl && dailyStats && dailyStats.length > 0) {
        const maxDay = Math.max(...dailyStats.map(d => d.count));
        chartEl.innerHTML = dailyStats.map(d => {
          const h       = maxDay > 0 ? Math.max(4, Math.round((d.count / maxDay) * 180)) : 4;
          const isToday = d._id === new Date().toISOString().slice(0,10);
          return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;" title="${d._id}: ${d.count} views">
            <span style="font-family:var(--font-mono);font-size:9px;color:var(--muted);">${d.count > 0 ? d.count : ''}</span>
            <div style="width:100%;height:${h}px;background:${isToday ? '#00ff41' : 'rgba(0,255,65,0.3)'};border-radius:2px 2px 0 0;"></div>
          </div>`;
        }).join('');
        if (labelsEl) labelsEl.innerHTML = dailyStats.map(d => {
          const dt = new Date(d._id);
          return `<div style="flex:1;text-align:center;font-family:var(--font-mono);font-size:9px;color:var(--muted);">${dt.getDate()}/${dt.getMonth()+1}</div>`;
        }).join('');
      } else if (chartEl) {
        chartEl.innerHTML = '<div style="text-align:center;width:100%;padding:40px 0;color:var(--muted);font-size:12px;">No visit data yet</div>';
      }
    }
  } catch (err) {
    console.error('Analytics stats error:', err.message);
    ['statTotalViews','statTodayViews','statWeekViews','statMonthViews'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = err.message === 'timeout' ? '...' : '—';
    });
  }

  // --- VISITORS ---
  const vLog = document.getElementById('inlineVisitorLog');
  if (!vLog) return;

  try {
    const res  = await makeRequest(`${API}/analytics/visitors?filter=all&page=1&limit=100`);
    const data = await res.json();
    const visitors = data.visitors || [];

    if (visitors.length === 0) {
      vLog.innerHTML = `<div style="text-align:center;padding:32px;color:var(--muted);">
        <div style="font-size:32px;margin-bottom:10px;">👁️</div>
        No visits recorded yet — they will appear here once people browse your site.
      </div>`;
      return;
    }

    const PAGE_NAMES_LOCAL = {
      '/': '🏠 Homepage', '/index.html': '🏠 Homepage',
      '/about.html': '👤 About', '/pricing.html': '💰 Pricing',
      '/scam-map.html': '🗺️ Scam Map', '/subscribe.html': '📧 Subscribe',
      '/login.html': '🔑 Login',
    };

    vLog.innerHTML = `<table style="width:100%;border-collapse:collapse;">
      <thead><tr style="background:#060e06;position:sticky;top:0;">
        <th style="padding:10px 14px;text-align:left;font-family:var(--font-mono);font-size:10px;color:var(--green);border-bottom:1px solid var(--border);">PAGE</th>
        <th style="padding:10px 14px;text-align:left;font-family:var(--font-mono);font-size:10px;color:var(--green);border-bottom:1px solid var(--border);">TIME</th>
        <th style="padding:10px 14px;text-align:left;font-family:var(--font-mono);font-size:10px;color:var(--green);border-bottom:1px solid var(--border);">FROM</th>
        <th style="padding:10px 14px;text-align:left;font-family:var(--font-mono);font-size:10px;color:var(--green);border-bottom:1px solid var(--border);">DEVICE</th>
      </tr></thead>
      <tbody>
        ${visitors.map(v => {
          const name    = PAGE_NAMES_LOCAL[v.page] || v.page;
          const ua      = v.userAgent || '';
          const isMob   = /iPhone|Android.*Mobile/i.test(ua);
          const browser = /Chrome/i.test(ua) && !/Edg/i.test(ua) ? 'Chrome'
                        : /Firefox/i.test(ua) ? 'Firefox'
                        : /Safari/i.test(ua) && !/Chrome/i.test(ua) ? 'Safari'
                        : /Edg/i.test(ua) ? 'Edge' : 'Browser';
          const diff    = Date.now() - new Date(v.createdAt).getTime();
          const mins    = Math.floor(diff/60000);
          const hours   = Math.floor(diff/3600000);
          const days    = Math.floor(diff/86400000);
          const time    = mins < 1 ? '🟢 Just now'
                        : mins < 60 ? mins + 'm ago'
                        : hours < 24 ? hours + 'h ago'
                        : days + 'd ago';
          const isNew   = diff < 300000;
          const ref     = v.referrer ? v.referrer.replace(/https?:\/\/(www\.)?/,'').substring(0,28) : '— Direct';
          return `<tr onmouseover="this.style.background='rgba(0,255,65,0.03)'" onmouseout="this.style.background=''" style="border-bottom:1px solid rgba(255,255,255,0.04);">
            <td style="padding:9px 14px;font-size:13px;color:#ddd;">${name}</td>
            <td style="padding:9px 14px;font-size:11px;color:${isNew?'#00ff41':'var(--muted)'};font-family:var(--font-mono);">${time}</td>
            <td style="padding:9px 14px;font-size:11px;color:var(--muted);">${ref}</td>
            <td style="padding:9px 14px;font-size:11px;color:var(--muted);">${isMob?'📱':'🖥️'} ${browser}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
    <div style="padding:10px 14px;border-top:1px solid var(--border);font-family:var(--font-mono);font-size:10px;color:#334433;">
      ${data.total || visitors.length} total visits
    </div>`;

  } catch (err) {
    vLog.innerHTML = `<div style="text-align:center;padding:32px;color:var(--muted);font-size:13px;">
      ${err.message === 'timeout'
        ? '⏱️ Loading timed out — Render may be waking up. Try clicking Analytics again in 30 seconds.'
        : '❌ ' + err.message}
    </div>`;
  }
}

// ─────────────────────────────────────────────
// VISITOR LOG
// ─────────────────────────────────────────────

let _visitorFilter = 'all';
let _visitorPage   = 1;
let _visitorTotal  = 0;
let _visitorPages  = 1;

const PAGE_NAMES = {
  '/':             '🏠 Homepage',
  '/index.html':   '🏠 Homepage',
  '/about.html':   '👤 About',
  '/pricing.html': '💰 Pricing',
  '/scam-map.html':'🗺️ Scam Map',
  '/subscribe.html':'📧 Subscribe',
  '/login.html':   '🔑 Login',
};

const DEVICE_ICONS = {
  mobile:  '📱',
  tablet:  '📱',
  desktop: '🖥️',
};

function detectDevice(ua) {
  if (!ua) return '🖥️ Desktop';
  if (/iPhone|Android.*Mobile|Mobile/i.test(ua)) return '📱 Mobile';
  if (/iPad|Tablet|Android(?!.*Mobile)/i.test(ua)) return '📱 Tablet';
  return '🖥️ Desktop';
}

function detectBrowser(ua) {
  if (!ua) return 'Unknown';
  if (/Chrome/i.test(ua) && !/Edg/i.test(ua)) return 'Chrome';
  if (/Firefox/i.test(ua)) return 'Firefox';
  if (/Safari/i.test(ua) && !/Chrome/i.test(ua)) return 'Safari';
  if (/Edg/i.test(ua)) return 'Edge';
  if (/MSIE|Trident/i.test(ua)) return 'IE';
  return 'Browser';
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins < 1)   return '🟢 Just now';
  if (mins < 60)  return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return new Date(dateStr).toLocaleDateString('en-KE', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
}

async function openVisitorLog(filter = 'all') {
  // Map 'month' to 'all' since backend only supports all/today/week
  if (filter === 'month') filter = 'all';

  _visitorFilter = filter;
  _visitorPage   = 1;

  // Update active filter buttons safely
  ['all','today','week'].forEach(f => {
    const btn = document.getElementById(`vFilter-${f}`);
    if (!btn) return;
    if (f === filter) {
      btn.style.borderColor = 'var(--green)';
      btn.style.color = 'var(--green)';
      btn.style.background = 'rgba(0,255,65,0.08)';
    } else {
      btn.style.borderColor = '';
      btn.style.color = '';
      btn.style.background = '';
    }
  });

  const labels = { all: 'All Time', today: 'Today', week: 'This Week' };
  const subtitle = document.getElementById('visitorLogSubtitle');
  if (subtitle) subtitle.textContent = `Showing: ${labels[filter] || 'All Time'}`;

  const modal = document.getElementById('visitorLogModal');
  if (modal) {
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  // Show debug info
  const debugBar = document.getElementById('visitorDebugBar');
  if (debugBar) {
    const token = localStorage.getItem('cwk_token');
    debugBar.textContent = token
      ? `✅ Token: ${token.substring(0,20)}... | API: ${API} | Filter: ${filter}`
      : '❌ NO TOKEN FOUND — you may not be logged in';
    debugBar.style.color = token ? '#334433' : '#ff2244';
  }

  await fetchVisitors();
}

function closeVisitorLog() {
  document.getElementById('visitorLogModal').classList.add('hidden');
  document.body.style.overflow = '';
}

async function fetchVisitors() {
  const tbody = document.getElementById('visitorTableBody');
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:40px;color:var(--muted);">
    <div class="spinner" style="margin:0 auto 10px;"></div>Loading...
  </td></tr>`;

  const token = localStorage.getItem('cwk_token');
  if (!token) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:32px;color:var(--red);">❌ Not logged in</td></tr>`;
    return;
  }

  const url = `${API}/analytics/visitors?filter=${_visitorFilter}&page=${_visitorPage}&limit=50`;

  // 8 second timeout using Promise.race
  const fetchPromise = fetch(url, {
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
  });

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Request timed out after 8s')), 8000)
  );

  try {
    const res = await Promise.race([fetchPromise, timeoutPromise]);

    if (res.status === 401) {
      tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:32px;color:var(--red);">❌ Session expired — please refresh the page</td></tr>`;
      return;
    }

    if (!res.ok) {
      tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:32px;color:var(--red);">❌ Server error: ${res.status}</td></tr>`;
      return;
    }

    const data = await res.json();
    const visitors = data.visitors || [];

    if (visitors.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:40px;">
        <div style="font-size:32px;margin-bottom:12px;">👁️</div>
        <div style="color:var(--muted);font-size:14px;">No visits recorded yet for this period.</div>
        <div style="color:#334433;font-size:12px;margin-top:8px;font-family:var(--font-mono);">
          Visits will appear here once people browse your site.
        </div>
      </td></tr>`;
      document.getElementById('visitorCount').textContent    = '0 visits';
      document.getElementById('visitorPageInfo').textContent = '';
      document.getElementById('vPrevBtn').disabled = true;
      document.getElementById('vNextBtn').disabled = true;
      return;
    }

    _visitorTotal = data.total  || visitors.length;
    _visitorPages = data.pages  || 1;

    tbody.innerHTML = visitors.map(v => {
      const pageName = PAGE_NAMES[v.page] || v.page;
      const device   = detectDevice(v.userAgent);
      const browser  = detectBrowser(v.userAgent);
      const time     = timeAgo(v.createdAt);
      const isRecent = v.createdAt && (Date.now() - new Date(v.createdAt)) < 300000;
      const referrer = v.referrer
        ? v.referrer.replace(/https?:\/\/(www\.)?/, '').substring(0, 35)
        : '— Direct';

      return `<tr style="border-bottom:1px solid rgba(255,255,255,0.04);"
                  onmouseover="this.style.background='rgba(0,255,65,0.03)'"
                  onmouseout="this.style.background=''">
        <td style="padding:12px 16px;font-size:13px;color:#fff;font-weight:500;">${pageName}</td>
        <td style="padding:12px 16px;font-size:12px;color:${isRecent ? '#00ff41' : 'var(--muted)'};font-family:var(--font-mono);">${time}</td>
        <td style="padding:12px 16px;font-size:12px;color:var(--muted);" title="${v.referrer || 'Direct'}">${referrer}</td>
        <td style="padding:12px 16px;font-size:12px;color:var(--muted);">${device} · ${browser}</td>
      </tr>`;
    }).join('');

    document.getElementById('visitorCount').textContent =
      `${_visitorTotal.toLocaleString()} total visit${_visitorTotal !== 1 ? 's' : ''}`;
    document.getElementById('visitorPageInfo').textContent =
      `Page ${_visitorPage} of ${_visitorPages}`;
    document.getElementById('vPrevBtn').disabled = _visitorPage <= 1;
    document.getElementById('vNextBtn').disabled = _visitorPage >= _visitorPages;

  } catch (err) {
    const msg = err.name === 'AbortError' ? 'Request timed out after 8 seconds' : err.message;
    const tbody2 = document.getElementById('visitorTableBody');
    if (tbody2) tbody2.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:32px;color:var(--red);">
      ❌ ${msg}
    </td></tr>`;
  }
}

async function changeVisitorPage(dir) {
  const newPage = _visitorPage + dir;
  if (newPage < 1 || newPage > _visitorPages) return;
  _visitorPage = newPage;
  await fetchVisitors();
}

// ─────────────────────────────────────────────
// VISITORS MODAL
// ─────────────────────────────────────────────

let _visitorsFilter = 'all';
let _visitorsPage   = 1;

const PAGE_LABELS = {
  '/':             '🏠 Homepage',
  '/index.html':   '🏠 Homepage',
  '/about.html':   '👤 About',
  '/pricing.html': '💰 Pricing',
  '/scam-map.html':'🗺️ Scam Map',
  '/subscribe.html':'📧 Subscribe',
  '/login.html':   '🔑 Login',
  '/dashboard.html':'⚙️ Dashboard',
};

const DEVICE_ICON = (ua) => {
  if (!ua) return '🖥️';
  if (/mobile|android|iphone/i.test(ua)) return '📱';
  if (/tablet|ipad/i.test(ua)) return '📟';
  return '🖥️';
};

const BROWSER_NAME = (ua) => {
  if (!ua) return 'Unknown';
  if (/Chrome\//.test(ua) && !/Edg\//.test(ua)) return 'Chrome';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Safari\//.test(ua) && !/Chrome/.test(ua)) return 'Safari';
  if (/Edg\//.test(ua)) return 'Edge';
  if (/OPR\//.test(ua)) return 'Opera';
  return 'Browser';
};

function openVisitorsModal(filter = 'all') {
  _visitorsFilter = filter;
  _visitorsPage   = 1;
  document.getElementById('visitorsModal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  fetchVisitors();
}

function closeVisitorsModal() {
  document.getElementById('visitorsModal').classList.add('hidden');
  document.body.style.overflow = '';
}

function filterVisitors(filter) {
  _visitorsFilter = filter;
  _visitorsPage   = 1;
  // Update tab styles
  ['all','today','week'].forEach(f => {
    const btn = document.getElementById(`vf${f.charAt(0).toUpperCase() + f.slice(1)}`);
    if (btn) {
      btn.style.background = f === filter ? 'var(--green)' : 'transparent';
      btn.style.color      = f === filter ? '#000' : 'var(--muted)';
      btn.style.fontWeight = f === filter ? '700' : '400';
    }
  });
  fetchVisitors();
}

async function fetchVisitors() {
  const wrap = document.getElementById('visitorsListWrap');
  wrap.innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted);"><div class="spinner" style="margin:0 auto 12px;"></div>Loading...</div>';

  try {
    const res  = await authFetch(`${API}/analytics/visitors?filter=${_visitorsFilter}&page=${_visitorsPage}&limit=30`);
    const data = await res.json();

    if (!data.success || data.visitors.length === 0) {
      wrap.innerHTML = `<div style="text-align:center;padding:40px;color:var(--muted);">
        <div style="font-size:40px;margin-bottom:12px;">👁️</div>
        No visitors found for this period.
      </div>`;
      document.getElementById('visitorsPagination').innerHTML = '';
      return;
    }

    // Update subtitle
    const filterLabel = { all: 'All Time', today: 'Today', week: 'This Week' }[_visitorsFilter];
    document.getElementById('visitorsModalSubtitle').textContent =
      `${data.total.toLocaleString()} visits — ${filterLabel} — Page ${data.page} of ${data.pages}`;

    // Build visitor rows
    wrap.innerHTML = `
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr style="background:var(--surface2);">
            <th style="padding:10px 16px;text-align:left;font-family:var(--font-mono);font-size:10px;color:var(--muted);letter-spacing:1px;border-bottom:1px solid var(--border);">PAGE</th>
            <th style="padding:10px 16px;text-align:left;font-family:var(--font-mono);font-size:10px;color:var(--muted);letter-spacing:1px;border-bottom:1px solid var(--border);">DEVICE</th>
            <th style="padding:10px 16px;text-align:left;font-family:var(--font-mono);font-size:10px;color:var(--muted);letter-spacing:1px;border-bottom:1px solid var(--border);">REFERRER</th>
            <th style="padding:10px 16px;text-align:right;font-family:var(--font-mono);font-size:10px;color:var(--muted);letter-spacing:1px;border-bottom:1px solid var(--border);">TIME</th>
          </tr>
        </thead>
        <tbody>
          ${data.visitors.map(v => {
            const pageLabel = PAGE_LABELS[v.page] || v.page;
            const device    = DEVICE_ICON(v.userAgent);
            const browser   = BROWSER_NAME(v.userAgent);
            const referrer  = v.referrer
              ? v.referrer.replace(/https?:\/\/(www\.)?/, '').split('/')[0].substring(0, 30)
              : 'Direct';
            const time = new Date(v.createdAt).toLocaleString('en-KE', {
              day: 'numeric', month: 'short',
              hour: '2-digit', minute: '2-digit'
            });
            const isNew = (Date.now() - new Date(v.createdAt)) < 3600000; // last 1hr

            return `
              <tr style="border-bottom:1px solid rgba(255,255,255,0.04);transition:background 0.15s;" onmouseover="this.style.background='rgba(0,255,65,0.03)'" onmouseout="this.style.background='transparent'">
                <td style="padding:12px 16px;">
                  <div style="display:flex;align-items:center;gap:8px;">
                    ${isNew ? '<span style="width:6px;height:6px;background:#00ff41;border-radius:50%;flex-shrink:0;animation:pulse 1.5s infinite;"></span>' : ''}
                    <span style="font-size:13px;color:#ddd;">${pageLabel}</span>
                  </div>
                </td>
                <td style="padding:12px 16px;">
                  <span style="font-size:16px;">${device}</span>
                  <span style="font-size:12px;color:var(--muted);margin-left:4px;">${browser}</span>
                </td>
                <td style="padding:12px 16px;">
                  <span style="font-size:12px;color:var(--muted);font-family:var(--font-mono);">${escapeHTML(referrer)}</span>
                </td>
                <td style="padding:12px 16px;text-align:right;">
                  <span style="font-size:11px;color:var(--muted);font-family:var(--font-mono);">${time}</span>
                </td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>`;

    // Pagination
    const paginEl = document.getElementById('visitorsPagination');
    if (data.pages > 1) {
      paginEl.innerHTML = `
        <span style="font-size:12px;color:var(--muted);">
          Showing ${((data.page-1)*30)+1}–${Math.min(data.page*30, data.total)} of ${data.total.toLocaleString()} visits
        </span>
        <div style="display:flex;gap:8px;">
          <button onclick="changeVisitorsPage(${data.page - 1})"
            style="padding:6px 14px;border:1px solid var(--border);background:none;color:${data.page > 1 ? '#fff' : 'var(--muted)'};border-radius:6px;cursor:${data.page > 1 ? 'pointer' : 'default'};font-size:12px;"
            ${data.page <= 1 ? 'disabled' : ''}>← Prev</button>
          <span style="padding:6px 14px;font-size:12px;color:var(--muted);font-family:var(--font-mono);">
            ${data.page} / ${data.pages}
          </span>
          <button onclick="changeVisitorsPage(${data.page + 1})"
            style="padding:6px 14px;border:1px solid var(--border);background:none;color:${data.page < data.pages ? '#fff' : 'var(--muted)'};border-radius:6px;cursor:${data.page < data.pages ? 'pointer' : 'default'};font-size:12px;"
            ${data.page >= data.pages ? 'disabled' : ''}>Next →</button>
        </div>`;
    } else {
      paginEl.innerHTML = `<span style="font-size:12px;color:var(--muted);">${data.total.toLocaleString()} total visits</span>`;
    }

  } catch (err) {
    wrap.innerHTML = '<div style="text-align:center;padding:40px;color:var(--red);">❌ Failed to load visitors</div>';
    console.error('Visitors error:', err);
  }
}

function changeVisitorsPage(page) {
  _visitorsPage = page;
  fetchVisitors();
}

// ─────────────────────────────────────────────
// TEST SMS
// ─────────────────────────────────────────────

function openTestSMS() {
  document.getElementById('testSMSModal').classList.remove('hidden');
  document.getElementById('testSMSResult').innerHTML = '';
  document.body.style.overflow = 'hidden';
}

function closeTestSMS() {
  document.getElementById('testSMSModal').classList.add('hidden');
  document.body.style.overflow = '';
}

async function sendTestSMS() {
  const phone = document.getElementById('testSMSPhone').value.trim();
  const resultEl = document.getElementById('testSMSResult');
  const btn = document.getElementById('testSMSBtn');

  if (!phone) {
    resultEl.innerHTML = '<div class="alert alert-error">⚠️ Please enter a phone number</div>';
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Sending...';
  resultEl.innerHTML = '';

  try {
    const res  = await authFetch(`${API}/newsletters/admin/test-sms`, {
      method: 'POST',
      body: JSON.stringify({ phone })
    });
    const data = await res.json();

    if (data.success) {
      resultEl.innerHTML = `<div class="alert alert-success">${data.message}</div>`;
      showToast('✅ Test SMS sent!');
    } else {
      resultEl.innerHTML = `<div class="alert alert-error">❌ ${data.message}</div>`;
      // Show full result for debugging
      if (data.result) {
        resultEl.innerHTML += `<pre style="font-size:10px;color:var(--muted);margin-top:8px;overflow:auto;">${JSON.stringify(data.result, null, 2)}</pre>`;
      }
    }
  } catch (err) {
    resultEl.innerHTML = '<div class="alert alert-error">❌ Cannot connect to server</div>';
  } finally {
    btn.disabled = false;
    btn.innerHTML = '📱 Send Test SMS';
  }
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
