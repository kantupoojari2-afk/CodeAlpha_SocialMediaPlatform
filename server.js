const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const MAX_POST_LENGTH = 280;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Helpers ----------

function makeToken(user) {
  return jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
}

// Returns the logged-in user from the Bearer token, or null if not logged in
function getViewer(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  try {
    return jwt.verify(header.slice(7), JWT_SECRET);
  } catch {
    return null;
  }
}

// Blocks a route unless the user is logged in
function requireAuth(req, res, next) {
  const viewer = getViewer(req);
  if (!viewer) return res.status(401).json({ error: 'Please log in first' });
  req.user = viewer;
  next();
}

function findUserByUsername(username) {
  return db
    .prepare('SELECT id, username, full_name, bio, created_at FROM users WHERE username = ?')
    .get(username);
}

// Shared post query: author info, like count, comment count, and whether the viewer liked it
const POST_QUERY = `
  SELECT p.id, p.content, p.created_at,
         u.id AS user_id, u.username, u.full_name,
         (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count,
         (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count,
         EXISTS (SELECT 1 FROM likes l WHERE l.post_id = p.id AND l.user_id = @viewer) AS liked_by_me
  FROM posts p
  JOIN users u ON u.id = p.user_id
`;

// params must always include `viewer` (use 0 when nobody is logged in)
function fetchPosts(whereClause, params) {
  const rows = db
    .prepare(`${POST_QUERY} ${whereClause} ORDER BY p.id DESC LIMIT 50`)
    .all(params);
  return rows.map((row) => ({ ...row, liked_by_me: !!row.liked_by_me }));
}

// ---------- Auth ----------

app.post('/api/auth/register', async (req, res) => {
  const username = String(req.body.username || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const full_name = String(req.body.full_name || '').trim().slice(0, 50);

  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
    return res.status(400).json({ error: 'Username must be 3-20 characters: letters, numbers or underscore' });
  }
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    return res.status(400).json({ error: 'Please enter a valid email' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  const taken = db
    .prepare('SELECT 1 FROM users WHERE username = ? OR email = ?')
    .get(username, email);
  if (taken) return res.status(409).json({ error: 'Username or email already exists' });

  const hash = await bcrypt.hash(password, 10);
  const { lastInsertRowid } = db
    .prepare('INSERT INTO users (username, email, password, full_name) VALUES (?, ?, ?, ?)')
    .run(username, email, hash, full_name);

  const user = db
    .prepare('SELECT id, username, full_name, bio FROM users WHERE id = ?')
    .get(lastInsertRowid);
  res.status(201).json({ token: makeToken(user), user });
});

app.post('/api/auth/login', async (req, res) => {
  const login = String(req.body.login || '').trim();
  const password = String(req.body.password || '');

  const row = db
    .prepare('SELECT * FROM users WHERE username = ? OR email = ?')
    .get(login, login.toLowerCase());

  if (!row || !(await bcrypt.compare(password, row.password))) {
    return res.status(401).json({ error: 'Wrong username/email or password' });
  }

  const user = { id: row.id, username: row.username, full_name: row.full_name, bio: row.bio };
  res.json({ token: makeToken(user), user });
});

// ---------- Users & profiles ----------

app.get('/api/users/:username', (req, res) => {
  const user = findUserByUsername(req.params.username);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const viewer = getViewer(req);
  const stats = db
    .prepare(`
      SELECT
        (SELECT COUNT(*) FROM posts   WHERE user_id = @id)       AS post_count,
        (SELECT COUNT(*) FROM follows WHERE following_id = @id)  AS follower_count,
        (SELECT COUNT(*) FROM follows WHERE follower_id = @id)   AS following_count
    `)
    .get({ id: user.id });

  const isFollowing = !!(
    viewer &&
    db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?').get(viewer.id, user.id)
  );

  res.json({
    ...user,
    ...stats,
    is_following: isFollowing,
    is_me: !!viewer && viewer.id === user.id,
  });
});

app.put('/api/users/me', requireAuth, (req, res) => {
  const full_name = String(req.body.full_name || '').trim().slice(0, 50);
  const bio = String(req.body.bio || '').trim().slice(0, 160);
  db.prepare('UPDATE users SET full_name = ?, bio = ? WHERE id = ?').run(full_name, bio, req.user.id);
  res.json(findUserByUsername(req.user.username));
});

// Toggles follow / unfollow
app.post('/api/users/:username/follow', requireAuth, (req, res) => {
  const target = findUserByUsername(req.params.username);
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.id === req.user.id) return res.status(400).json({ error: "You can't follow yourself" });

  const existing = db
    .prepare('SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?')
    .get(req.user.id, target.id);

  if (existing) {
    db.prepare('DELETE FROM follows WHERE follower_id = ? AND following_id = ?').run(req.user.id, target.id);
  } else {
    db.prepare('INSERT INTO follows (follower_id, following_id) VALUES (?, ?)').run(req.user.id, target.id);
  }
  res.json({ following: !existing });
});

// ---------- Posts ----------

// Home feed: my posts + posts from people I follow
app.get('/api/posts/feed', requireAuth, (req, res) => {
  res.json(
    fetchPosts(
      `WHERE p.user_id = @viewer
          OR p.user_id IN (SELECT following_id FROM follows WHERE follower_id = @viewer)`,
      { viewer: req.user.id }
    )
  );
});

// Explore: all posts, works without login
app.get('/api/posts/explore', (req, res) => {
  const viewer = getViewer(req);
  res.json(fetchPosts('WHERE 1 = 1', { viewer: viewer ? viewer.id : 0 }));
});

// All posts by one user
app.get('/api/posts/user/:username', (req, res) => {
  const viewer = getViewer(req);
  res.json(
    fetchPosts('WHERE u.username = @username', {
      viewer: viewer ? viewer.id : 0,
      username: req.params.username,
    })
  );
});

app.post('/api/posts', requireAuth, (req, res) => {
  const content = String(req.body.content || '').trim();
  if (!content) return res.status(400).json({ error: 'Post cannot be empty' });
  if (content.length > MAX_POST_LENGTH) {
    return res.status(400).json({ error: `Posts can be at most ${MAX_POST_LENGTH} characters` });
  }

  const { lastInsertRowid } = db
    .prepare('INSERT INTO posts (user_id, content) VALUES (?, ?)')
    .run(req.user.id, content);

  const post = fetchPosts('WHERE p.id = @postId', { viewer: req.user.id, postId: lastInsertRowid })[0];
  res.status(201).json(post);
});

app.delete('/api/posts/:id', requireAuth, (req, res) => {
  const post = db.prepare('SELECT user_id FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  if (post.user_id !== req.user.id) return res.status(403).json({ error: 'You can only delete your own posts' });

  db.prepare('DELETE FROM posts WHERE id = ?').run(req.params.id);
  res.json({ deleted: true });
});

// ---------- Likes ----------

// Toggles like / unlike
app.post('/api/posts/:id/like', requireAuth, (req, res) => {
  const postId = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM posts WHERE id = ?').get(postId)) {
    return res.status(404).json({ error: 'Post not found' });
  }

  const liked = db
    .prepare('SELECT 1 FROM likes WHERE user_id = ? AND post_id = ?')
    .get(req.user.id, postId);

  if (liked) {
    db.prepare('DELETE FROM likes WHERE user_id = ? AND post_id = ?').run(req.user.id, postId);
  } else {
    db.prepare('INSERT INTO likes (user_id, post_id) VALUES (?, ?)').run(req.user.id, postId);
  }

  const { like_count } = db
    .prepare('SELECT COUNT(*) AS like_count FROM likes WHERE post_id = ?')
    .get(postId);
  res.json({ liked: !liked, like_count });
});

// ---------- Comments ----------

app.get('/api/posts/:id/comments', (req, res) => {
  const comments = db
    .prepare(`
      SELECT c.id, c.content, c.created_at, c.user_id, u.username
      FROM comments c
      JOIN users u ON u.id = c.user_id
      WHERE c.post_id = ?
      ORDER BY c.id ASC
    `)
    .all(req.params.id);
  res.json(comments);
});

app.post('/api/posts/:id/comments', requireAuth, (req, res) => {
  const content = String(req.body.content || '').trim();
  if (!content) return res.status(400).json({ error: 'Comment cannot be empty' });
  if (content.length > 200) return res.status(400).json({ error: 'Comments can be at most 200 characters' });

  const postId = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM posts WHERE id = ?').get(postId)) {
    return res.status(404).json({ error: 'Post not found' });
  }

  const { lastInsertRowid } = db
    .prepare('INSERT INTO comments (post_id, user_id, content) VALUES (?, ?, ?)')
    .run(postId, req.user.id, content);

  const comment = db
    .prepare(`
      SELECT c.id, c.content, c.created_at, c.user_id, u.username
      FROM comments c JOIN users u ON u.id = c.user_id
      WHERE c.id = ?
    `)
    .get(lastInsertRowid);
  res.status(201).json(comment);
});

app.delete('/api/comments/:id', requireAuth, (req, res) => {
  const comment = db.prepare('SELECT user_id FROM comments WHERE id = ?').get(req.params.id);
  if (!comment) return res.status(404).json({ error: 'Comment not found' });
  if (comment.user_id !== req.user.id) return res.status(403).json({ error: 'You can only delete your own comments' });

  db.prepare('DELETE FROM comments WHERE id = ?').run(req.params.id);
  res.json({ deleted: true });
});

// ---------- Fallbacks ----------

app.use('/api', (req, res) => res.status(404).json({ error: 'Route not found' }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Server error' });
});

app.listen(PORT, () => {
  console.log(`SocialHub running at http://localhost:${PORT}`);
});
