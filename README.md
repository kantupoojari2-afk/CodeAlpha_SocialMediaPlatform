# CodeAlpha – Task 2: Social Media Platform

A mini social media app with user profiles, posts, comments, likes and follows.

**Tech stack:** Express.js (backend), SQLite via better-sqlite3 (database), HTML / CSS / JavaScript (frontend), JWT + bcrypt (authentication).

## Features

- **User registration and login** with hashed passwords and JWT tokens
- **User profiles** with full name, bio, post count, follower and following counts
- **Edit profile** (name and bio)
- **Posts**: create, view and delete your own posts (max 280 characters)
- **Comments**: add comments on any post (max 200 characters)
- **Like / unlike** posts
- **Follow / unfollow** users
- **Home feed** showing your posts and posts from people you follow; **Explore** page for logged-out visitors

## Project structure

```
CodeAlpha_SocialMediaPlatform/
├── server.js          # Express server and REST API routes
├── db.js              # SQLite connection and table creation
├── package.json
├── public/
│   ├── index.html     # Feed, login and signup
│   ├── profile.html   # User profile page
│   ├── css/style.css
│   └── js/app.js      # Frontend logic (fetch API calls, rendering)
└── README.md
```

## Database schema

| Table      | Columns                                                                 |
|------------|-------------------------------------------------------------------------|
| `users`    | id, username, email, password (hashed), full_name, bio, created_at      |
| `posts`    | id, user_id, content, created_at                                        |
| `comments` | id, post_id, user_id, content, created_at                               |
| `likes`    | user_id, post_id, created_at (composite primary key, one like per user) |
| `follows`  | follower_id, following_id, created_at (composite primary key)           |

## How to run

1. Install Node.js 18 or newer.
2. Open a terminal in the project folder and install dependencies:
   ```bash
   npm install
   ```
3. Start the server:
   ```bash
   npm start
   ```
4. Open **http://localhost:3000** in your browser.

To change the port or the JWT secret, set environment variables before starting:
```bash
PORT=4000 JWT_SECRET=my-secret npm start
```

The database file `socialmedia.db` is created automatically on first run.

## API endpoints

| Method | Endpoint                         | Auth | Description                          |
|--------|----------------------------------|------|--------------------------------------|
| POST   | `/api/auth/register`             | No   | Create an account                    |
| POST   | `/api/auth/login`                | No   | Log in with username or email        |
| GET    | `/api/users/:username`           | No   | Get a profile with counts            |
| PUT    | `/api/users/me`                  | Yes  | Update your name and bio             |
| POST   | `/api/users/:username/follow`    | Yes  | Follow or unfollow a user (toggle)   |
| GET    | `/api/posts/feed`                | Yes  | Your feed (own + followed users)     |
| GET    | `/api/posts/explore`             | No   | All posts                            |
| GET    | `/api/posts/user/:username`      | No   | All posts by one user                |
| POST   | `/api/posts`                     | Yes  | Create a post                        |
| DELETE | `/api/posts/:id`                 | Yes  | Delete your own post                 |
| POST   | `/api/posts/:id/like`            | Yes  | Like or unlike a post (toggle)       |
| GET    | `/api/posts/:id/comments`        | No   | List comments on a post              |
| POST   | `/api/posts/:id/comments`        | Yes  | Comment on a post                    |
| DELETE | `/api/comments/:id`              | Yes  | Delete your own comment              |

## Suggested test flow

1. Register two accounts (for example `alice` and `bob`) in two different browser windows or one normal window and one private window.
2. Create a post as `alice`.
3. Log in as `bob`, open Explore, and like and comment on Alice's post.
4. Open `alice`'s profile from the post and click **Follow**.
5. Check that Alice's posts appear on Bob's home feed.
6. Edit your profile name and bio from **My Profile**.
