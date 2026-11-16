// ---------- Session & helpers ----------

const API = '/api';

const state = {
  token: localStorage.getItem('token'),
  user: JSON.parse(localStorage.getItem('user') || 'null'),
};

function saveSession(token, user) {
  state.token = token;
  state.user = user;
  localStorage.setItem('token', token);
  localStorage.setItem('user', JSON.stringify(user));
}

function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  window.location.href = 'index.html';
}

// Prevents user-typed text from being interpreted as HTML
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]
  );
}

// SQLite stores UTC times like "2026-11-16 10:30:00"
function timeAgo(sqlDate) {
  const seconds = Math.floor((Date.now() - new Date(sqlDate.replace(' ', 'T') + 'Z').getTime()) / 1000);
  const units = [['year', 31536000], ['month', 2592000], ['day', 86400], ['hour', 3600], ['minute', 60]];
  for (const [name, size] of units) {
    const n = Math.floor(seconds / size);
    if (n >= 1) return `${n} ${name}${n > 1 ? 's' : ''} ago`;
  }
  return 'just now';
}

async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;

  const res = await fetch(API + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

function requireLogin() {
  if (state.token) return true;
  alert('Please log in to do that.');
  return false;
}

function renderNav() {
  const nav = document.getElementById('nav-links');
  if (!nav) return;

  if (state.user) {
    nav.innerHTML = `
      <a href="index.html">Home</a>
      <a href="profile.html?user=${encodeURIComponent(state.user.username)}">My Profile</a>
      <button id="logout-btn" class="ghost">Log out</button>`;
    document.getElementById('logout-btn').addEventListener('click', logout);
  } else {
    nav.innerHTML = `<a href="index.html">Log in / Sign up</a>`;
  }
}

// ---------- Posts, likes, comments ----------

function postCard(post) {
  const isMine = state.user && state.user.id === post.user_id;
  return `
    <article class="card post" data-id="${post.id}">
      <header>
        <a class="username" href="profile.html?user=${encodeURIComponent(post.username)}">@${escapeHtml(post.username)}</a>
        <span class="muted">· ${timeAgo(post.created_at)}</span>
      </header>
      <p class="post-content">${escapeHtml(post.content)}</p>
      <footer class="actions">
        <button data-action="like" class="${post.liked_by_me ? 'liked' : ''}">♥ <span>${post.like_count}</span></button>
        <button data-action="comments">💬 <span>${post.comment_count}</span></button>
        ${isMine ? '<button data-action="delete" class="danger">Delete</button>' : ''}
      </footer>
      <div class="comments hidden"></div>
    </article>`;
}

function renderPosts(container, posts, emptyMessage) {
  container.innerHTML = posts.length
    ? posts.map(postCard).join('')
    : `<p class="muted">${escapeHtml(emptyMessage)}</p>`;
}

async function loadFeed(container, path, emptyMessage) {
  container.innerHTML = '<p class="muted">Loading...</p>';
  try {
    renderPosts(container, await api(path), emptyMessage);
  } catch (err) {
    container.innerHTML = `<p class="error">${escapeHtml(err.message)}</p>`;
  }
}

async function renderComments(card) {
  const postId = card.dataset.id;
  const box = card.querySelector('.comments');
  const comments = await api(`/posts/${postId}/comments`);

  box.innerHTML = comments.map((c) => `
    <div class="comment">
      <a href="profile.html?user=${encodeURIComponent(c.username)}">@${escapeHtml(c.username)}</a>
      ${escapeHtml(c.content)} <span class="muted">· ${timeAgo(c.created_at)}</span>
    </div>`).join('') || '<p class="muted">No comments yet.</p>';

  if (state.token) {
    box.insertAdjacentHTML('beforeend', `
      <form class="comment-form">
        <input name="content" maxlength="200" placeholder="Write a comment..." required />
        <button type="submit">Reply</button>
      </form>`);
  }
}

// Event delegation: one set of listeners handles every post in the container
function bindPostEvents(container) {
  container.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;

    const card = btn.closest('.post');
    const postId = card.dataset.id;

    try {
      if (btn.dataset.action === 'like') {
        if (!requireLogin()) return;
        const data = await api(`/posts/${postId}/like`, { method: 'POST' });
        btn.classList.toggle('liked', data.liked);
        btn.querySelector('span').textContent = data.like_count;
      }

      if (btn.dataset.action === 'comments') {
        const box = card.querySelector('.comments');
        box.classList.toggle('hidden');
        if (!box.classList.contains('hidden')) await renderComments(card);
      }

      if (btn.dataset.action === 'delete') {
        if (!confirm('Delete this post?')) return;
        await api(`/posts/${postId}`, { method: 'DELETE' });
        card.remove();
      }
    } catch (err) {
      alert(err.message);
    }
  });

  container.addEventListener('submit', async (e) => {
    if (!e.target.matches('.comment-form')) return;
    e.preventDefault();

    const card = e.target.closest('.post');
    const input = e.target.querySelector('input');

    try {
      await api(`/posts/${card.dataset.id}/comments`, {
        method: 'POST',
        body: { content: input.value },
      });
      input.value = '';
      await renderComments(card);

      const countSpan = card.querySelector('[data-action="comments"] span');
      countSpan.textContent = Number(countSpan.textContent) + 1;
    } catch (err) {
      alert(err.message);
    }
  });
}

// ---------- Home page ----------

async function initHome() {
  const authSection = document.getElementById('auth-section');
  const composer = document.getElementById('composer');
  const feed = document.getElementById('feed');
  const feedTitle = document.getElementById('feed-title');
  const feedPath = state.token ? '/posts/feed' : '/posts/explore';
  const emptyMessage = state.token
    ? 'Nothing here yet. Create a post or follow someone!'
    : 'No posts yet. Log in and be the first to post!';

  if (state.token) {
    composer.classList.remove('hidden');
    feedTitle.textContent = 'Your feed';
  } else {
    authSection.classList.remove('hidden');
    feedTitle.textContent = 'Explore';
  }

  await loadFeed(feed, feedPath, emptyMessage);
  bindPostEvents(feed);

  // Create post
  const postForm = document.getElementById('post-form');
  const textarea = postForm.querySelector('textarea');
  const charCount = document.getElementById('char-count');

  textarea.addEventListener('input', () => {
    charCount.textContent = `${textarea.value.length}/280`;
  });

  postForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/posts', { method: 'POST', body: { content: textarea.value } });
      textarea.value = '';
      charCount.textContent = '0/280';
      await loadFeed(feed, feedPath, emptyMessage);
    } catch (err) {
      alert(err.message);
    }
  });

  // Login / register tabs
  const loginForm = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');
  const showLogin = document.getElementById('show-login');
  const showRegister = document.getElementById('show-register');
  const authError = document.getElementById('auth-error');

  function switchTab(toLogin) {
    loginForm.classList.toggle('hidden', !toLogin);
    registerForm.classList.toggle('hidden', toLogin);
    showLogin.classList.toggle('active', toLogin);
    showRegister.classList.toggle('active', !toLogin);
    authError.textContent = '';
  }
  showLogin.addEventListener('click', () => switchTab(true));
  showRegister.addEventListener('click', () => switchTab(false));

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const data = await api('/auth/login', { method: 'POST', body: Object.fromEntries(new FormData(loginForm)) });
      saveSession(data.token, data.user);
      location.reload();
    } catch (err) {
      authError.textContent = err.message;
    }
  });

  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const data = await api('/auth/register', { method: 'POST', body: Object.fromEntries(new FormData(registerForm)) });
      saveSession(data.token, data.user);
      location.reload();
    } catch (err) {
      authError.textContent = err.message;
    }
  });
}

// ---------- Profile page ----------

function renderProfileHeader(el, p) {
  let actions = '';
  if (p.is_me) {
    actions = `<button id="edit-btn" class="ghost">Edit profile</button>`;
  } else if (state.token) {
    actions = p.is_following
      ? `<button id="follow-btn" class="ghost">Following</button>`
      : `<button id="follow-btn">Follow</button>`;
  }

  el.innerHTML = `
    <div class="profile-top">
      <div class="avatar">${escapeHtml(p.username[0].toUpperCase())}</div>
      <div>
        <h2>${escapeHtml(p.full_name || p.username)}</h2>
        <p class="muted">@${escapeHtml(p.username)}</p>
        <p>${escapeHtml(p.bio)}</p>
      </div>
      <div class="profile-actions">${actions}</div>
    </div>
    <div class="stats">
      <span><strong>${p.post_count}</strong> posts</span>
      <span><strong>${p.follower_count}</strong> followers</span>
      <span><strong>${p.following_count}</strong> following</span>
    </div>
    <form id="edit-form" class="hidden">
      <input name="full_name" maxlength="50" placeholder="Full name" value="${escapeHtml(p.full_name)}" />
      <textarea name="bio" maxlength="160" placeholder="Bio">${escapeHtml(p.bio)}</textarea>
      <button type="submit">Save</button>
    </form>`;

  document.getElementById('follow-btn')?.addEventListener('click', async () => {
    if (!requireLogin()) return;
    try {
      await api(`/users/${encodeURIComponent(p.username)}/follow`, { method: 'POST' });
      location.reload();
    } catch (err) {
      alert(err.message);
    }
  });

  document.getElementById('edit-btn')?.addEventListener('click', () => {
    document.getElementById('edit-form').classList.toggle('hidden');
  });

  document.getElementById('edit-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/users/me', { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) });
      location.reload();
    } catch (err) {
      alert(err.message);
    }
  });
}

async function initProfile() {
  const header = document.getElementById('profile-header');
  const postsBox = document.getElementById('posts');
  const username = new URLSearchParams(location.search).get('user') || state.user?.username;

  if (!username) {
    header.innerHTML = '<p class="error">No user specified. Log in or open a profile link.</p>';
    return;
  }

  try {
    const profile = await api(`/users/${encodeURIComponent(username)}`);
    renderProfileHeader(header, profile);
    await loadFeed(postsBox, `/posts/user/${encodeURIComponent(username)}`, 'No posts yet.');
    bindPostEvents(postsBox);
  } catch (err) {
    header.innerHTML = `<p class="error">${escapeHtml(err.message)}</p>`;
  }
}

// ---------- Start ----------

document.addEventListener('DOMContentLoaded', () => {
  renderNav();
  const page = document.body.dataset.page;
  if (page === 'home') initHome();
  if (page === 'profile') initProfile();
});
