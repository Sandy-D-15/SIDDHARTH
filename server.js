const { createHash, randomBytes, scryptSync, timingSafeEqual } = require("node:crypto");
const { createServer } = require("node:http");
const { readFileSync, mkdirSync } = require("node:fs");
const { extname, resolve } = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const ROOT = __dirname;
const DATA_DIR = resolve(ROOT, "data");
const DATABASE_PATH = resolve(DATA_DIR, "siddverse.sqlite");
const SESSION_COOKIE = "siddverse_session";
const SESSION_DURATION = 30 * 24 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 16 * 1024;
const MIME_TYPES = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8"
};

mkdirSync(DATA_DIR, { recursive: true });
const database = new DatabaseSync(DATABASE_PATH);
database.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
database.exec(`
    CREATE TABLE IF NOT EXISTS users (
        username TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        bio TEXT NOT NULL DEFAULT '',
        avatar TEXT NOT NULL DEFAULT '',
        cover TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS follows (
        follower_username TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
        followed_username TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
        PRIMARY KEY (follower_username, followed_username),
        CHECK (follower_username <> followed_username)
    );
    CREATE TABLE IF NOT EXISTS posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
        text TEXT NOT NULL DEFAULT '',
        image TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS likes (
        post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        username TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
        PRIMARY KEY (post_id, username)
    );
    CREATE TABLE IF NOT EXISTS comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        username TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
        text TEXT NOT NULL,
        created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS saved_posts (
        username TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
        post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        PRIMARY KEY (username, post_id)
    );
    CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recipient_username TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
        sender_username TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
        text TEXT NOT NULL,
        created_at TEXT NOT NULL,
        is_read INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        username TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS posts_created_at_idx ON posts(created_at DESC);
    CREATE INDEX IF NOT EXISTS notifications_recipient_idx ON notifications(recipient_username, id DESC);
`);

const statements = {
    userByUsername: database.prepare("SELECT * FROM users WHERE username = ?"),
    publicUsers: database.prepare("SELECT username, name, bio, avatar, cover FROM users ORDER BY username"),
    userFollows: database.prepare("SELECT followed_username FROM follows WHERE follower_username = ?"),
    userFollowers: database.prepare("SELECT follower_username FROM follows WHERE followed_username = ?"),
    postRows: database.prepare("SELECT id, username, text, image, created_at AS createdAt FROM posts ORDER BY created_at DESC, id DESC"),
    postLikes: database.prepare("SELECT username FROM likes WHERE post_id = ? ORDER BY username"),
    postComments: database.prepare("SELECT username, text, created_at AS date FROM comments WHERE post_id = ? ORDER BY id"),
    notifications: database.prepare(`
        SELECT recipient_username AS "to", sender_username AS "from", text, created_at AS date, is_read AS read
        FROM notifications WHERE recipient_username = ? ORDER BY id
    `),
    savedPosts: database.prepare("SELECT post_id FROM saved_posts WHERE username = ?"),
    insertNotification: database.prepare(`
        INSERT INTO notifications (recipient_username, sender_username, text, created_at)
        VALUES (?, ?, ?, ?)
    `)
};

function hashPassword(password, salt = randomBytes(16).toString("hex")) {
    return {
        salt,
        hash: scryptSync(password, salt, 64).toString("hex")
    };
}

function passwordMatches(password, user) {
    const candidate = Buffer.from(hashPassword(password, user.password_salt).hash, "hex");
    const stored = Buffer.from(user.password_hash, "hex");
    return candidate.length === stored.length && timingSafeEqual(candidate, stored);
}

function publicUser(username) {
    const user = statements.userByUsername.get(username);
    if (!user) return null;
    return {
        username: user.username,
        name: user.name,
        bio: user.bio,
        avatar: user.avatar,
        cover: user.cover,
        followers: statements.userFollowers.all(username).map(row => row.follower_username),
        following: statements.userFollows.all(username).map(row => row.followed_username)
    };
}

function initializeDemoData() {
    if (database.prepare("SELECT COUNT(*) AS count FROM users").get().count > 0) return;

    const demoUsers = [
        { name: "Siddhant", username: "siddhant", password: "1234", bio: "Building ideas that matter. 🚀" },
        { name: "Priya Sharma", username: "priya", password: "1234", bio: "Photography & Travel 📸" },
        { name: "Rahul Patil", username: "rahul", password: "1234", bio: "Coding enthusiast 💻" }
    ];

    database.exec("BEGIN IMMEDIATE");
    try {
        const insertUser = database.prepare(`
            INSERT INTO users (username, name, password_salt, password_hash, bio)
            VALUES (?, ?, ?, ?, ?)
        `);
        for (const user of demoUsers) {
            const password = hashPassword(user.password);
            insertUser.run(user.username, user.name, password.salt, password.hash, user.bio);
        }

        const insertFollow = database.prepare("INSERT INTO follows (follower_username, followed_username) VALUES (?, ?)");
        for (const [follower, followed] of [
            ["priya", "siddhant"], ["rahul", "siddhant"],
            ["siddhant", "priya"], ["priya", "rahul"]
        ]) insertFollow.run(follower, followed);

        const insertPost = database.prepare("INSERT INTO posts (username, text, image, created_at) VALUES (?, ?, ?, ?)");
        const insertLike = database.prepare("INSERT INTO likes (post_id, username) VALUES (?, ?)");
        const insertComment = database.prepare("INSERT INTO comments (post_id, username, text, created_at) VALUES (?, ?, ?, ?)");
        const now = Date.now();
        const firstPost = insertPost.run(
            "siddhant",
            "Just launched a fresh idea for a student community app. Feedback would help a lot!",
            "",
            new Date(now - 30 * 60 * 1000).toISOString()
        ).lastInsertRowid;
        const secondPost = insertPost.run(
            "priya",
            "Weekend photo walk and a new reel idea. What do you think of this aesthetic?",
            "https://images.unsplash.com/photo-1493246507139-91e8fad9978e?auto=format&fit=crop&w=1200&q=80",
            new Date(now - 90 * 60 * 1000).toISOString()
        ).lastInsertRowid;
        const thirdPost = insertPost.run(
            "rahul",
            "Building a cleaner UI always feels like a productivity boost. Small improvements matter a lot.",
            "",
            new Date(now - 180 * 60 * 1000).toISOString()
        ).lastInsertRowid;

        insertLike.run(firstPost, "priya");
        insertLike.run(secondPost, "siddhant");
        insertLike.run(secondPost, "rahul");
        insertComment.run(firstPost, "rahul", "This looks awesome!", new Date(now - 20 * 60 * 1000).toISOString());
        insertComment.run(secondPost, "siddhant", "Love the vibe.", new Date(now - 80 * 60 * 1000).toISOString());
        insertComment.run(thirdPost, "priya", "Totally agree.", new Date(now - 170 * 60 * 1000).toISOString());
        database.exec("COMMIT");
    } catch (error) {
        database.exec("ROLLBACK");
        throw error;
    }
}

initializeDemoData();

function jsonResponse(response, status, value, extraHeaders = {}) {
    response.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        ...extraHeaders
    });
    response.end(JSON.stringify(value));
}

function readJson(request) {
    return new Promise((resolveBody, reject) => {
        let body = "";
        request.on("data", chunk => {
            body += chunk;
            if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
                reject(Object.assign(new Error("Request body is too large."), { status: 413 }));
                request.destroy();
            }
        });
        request.on("end", () => {
            if (!body) {
                resolveBody({});
                return;
            }
            try {
                resolveBody(JSON.parse(body));
            } catch {
                reject(Object.assign(new Error("Request body must be valid JSON."), { status: 400 }));
            }
        });
        request.on("error", reject);
    });
}

function getSessionToken(request) {
    const cookieHeader = request.headers.cookie || "";
    const cookie = cookieHeader.split(";").map(value => value.trim())
        .find(value => value.startsWith(`${SESSION_COOKIE}=`));
    return cookie ? decodeURIComponent(cookie.slice(SESSION_COOKIE.length + 1)) : "";
}

function getAuthenticatedUser(request) {
    const token = getSessionToken(request);
    if (!token) return null;
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const session = database.prepare(`
        SELECT username FROM sessions WHERE token_hash = ? AND expires_at > ?
    `).get(tokenHash, Date.now());
    if (!session) return null;
    return publicUser(session.username);
}

function createSession(username) {
    const token = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    database.prepare("INSERT INTO sessions (token_hash, username, expires_at) VALUES (?, ?, ?)")
        .run(tokenHash, username, Date.now() + SESSION_DURATION);
    return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DURATION / 1000}`;
}

function clearSession(request) {
    const token = getSessionToken(request);
    if (token) {
        const tokenHash = createHash("sha256").update(token).digest("hex");
        database.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
    }
    return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

function isValidOptionalUrl(value) {
    if (value === "") return true;
    try {
        const url = new URL(value);
        return url.protocol === "https:" || url.protocol === "http:";
    } catch {
        return false;
    }
}

function getBootstrap(username) {
    const users = statements.publicUsers.all().map(row => ({
        ...row,
        followers: statements.userFollowers.all(row.username).map(item => item.follower_username),
        following: statements.userFollows.all(row.username).map(item => item.followed_username)
    }));
    const posts = statements.postRows.all().map(post => ({
        ...post,
        id: Number(post.id),
        likes: statements.postLikes.all(post.id).map(row => row.username),
        comments: statements.postComments.all(post.id)
    }));
    const notifications = statements.notifications.all(username).map(notification => ({
        ...notification,
        read: Boolean(notification.read)
    }));
    const savedPosts = statements.savedPosts.all(username).map(row => Number(row.post_id));
    return { users, posts, notifications, savedPosts };
}

async function handleApi(request, response, url) {
    const { pathname } = url;
    const method = request.method;

    if (pathname === "/api/auth/register" && method === "POST") {
        const body = await readJson(request);
        const name = typeof body.name === "string" ? body.name.trim() : "";
        const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
        const password = typeof body.password === "string" ? body.password : "";
        if (!name || name.length > 80 || !/^[a-z0-9_]{3,20}$/.test(username) || password.length < 4 || password.length > 128) {
            return jsonResponse(response, 400, { error: "Enter a name, a valid username, and a password of at least 4 characters." });
        }
        if (statements.userByUsername.get(username)) {
            return jsonResponse(response, 409, { error: "Username already exists." });
        }
        const passwordData = hashPassword(password);
        database.prepare(`
            INSERT INTO users (username, name, password_salt, password_hash, bio)
            VALUES (?, ?, ?, ?, ?)
        `).run(username, name, passwordData.salt, passwordData.hash, "Welcome to SiddVerse! ✨");
        return jsonResponse(response, 201, { user: publicUser(username) });
    }

    if (pathname === "/api/auth/login" && method === "POST") {
        const body = await readJson(request);
        const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
        const password = typeof body.password === "string" ? body.password : "";
        const user = statements.userByUsername.get(username);
        if (!user || !passwordMatches(password, user)) {
            return jsonResponse(response, 401, { error: "Invalid username or password." });
        }
        const cookie = createSession(username);
        return jsonResponse(response, 200, { user: publicUser(username) }, { "Set-Cookie": cookie });
    }

    if (pathname === "/api/auth/session" && method === "DELETE") {
        return jsonResponse(response, 200, { ok: true }, { "Set-Cookie": clearSession(request) });
    }

    if (pathname === "/api/bootstrap" && method === "GET") {
        const user = getAuthenticatedUser(request);
        if (!user) return jsonResponse(response, 200, { authenticated: false });
        return jsonResponse(response, 200, { authenticated: true, currentUser: user.username, ...getBootstrap(user.username) });
    }

    const user = getAuthenticatedUser(request);
    if (!user) return jsonResponse(response, 401, { error: "Please log in to continue." });

    if (pathname === "/api/posts" && method === "POST") {
        const body = await readJson(request);
        const text = typeof body.text === "string" ? body.text.trim() : "";
        const image = typeof body.image === "string" ? body.image.trim() : "";
        if ((!text && !image) || text.length > 5000 || image.length > 2048 || !isValidOptionalUrl(image)) {
            return jsonResponse(response, 400, { error: "Add post text or a valid HTTP(S) image URL. Posts are limited to 5,000 characters." });
        }
        const result = database.prepare(`
            INSERT INTO posts (username, text, image, created_at) VALUES (?, ?, ?, ?)
        `).run(user.username, text, image, new Date().toISOString());
        return jsonResponse(response, 201, { id: Number(result.lastInsertRowid) });
    }

    const postMatch = pathname.match(/^\/api\/posts\/(\d+)(?:\/(like|comments|save))?$/);
    if (postMatch) {
        const postId = Number(postMatch[1]);
        const action = postMatch[2] || "";
        const post = database.prepare("SELECT id, username FROM posts WHERE id = ?").get(postId);
        if (!post) return jsonResponse(response, 404, { error: "Post not found." });

        if (!action && method === "DELETE") {
            if (post.username !== user.username) return jsonResponse(response, 403, { error: "You can delete only your own posts." });
            database.prepare("DELETE FROM posts WHERE id = ?").run(postId);
            return jsonResponse(response, 200, { ok: true });
        }

        if (action === "like" && method === "POST") {
            const existing = database.prepare("SELECT 1 FROM likes WHERE post_id = ? AND username = ?").get(postId, user.username);
            if (existing) {
                database.prepare("DELETE FROM likes WHERE post_id = ? AND username = ?").run(postId, user.username);
            } else {
                database.prepare("INSERT INTO likes (post_id, username) VALUES (?, ?)").run(postId, user.username);
                if (post.username !== user.username) {
                    statements.insertNotification.run(post.username, user.username, "liked your post ❤️", new Date().toISOString());
                }
            }
            return jsonResponse(response, 200, { liked: !existing });
        }

        if (action === "comments" && method === "POST") {
            const body = await readJson(request);
            const text = typeof body.text === "string" ? body.text.trim() : "";
            if (!text || text.length > 1000) return jsonResponse(response, 400, { error: "Comments must contain 1–1,000 characters." });
            database.prepare(`
                INSERT INTO comments (post_id, username, text, created_at) VALUES (?, ?, ?, ?)
            `).run(postId, user.username, text, new Date().toISOString());
            if (post.username !== user.username) {
                statements.insertNotification.run(post.username, user.username, "commented on your post 💬", new Date().toISOString());
            }
            return jsonResponse(response, 201, { ok: true });
        }

        if (action === "save" && method === "POST") {
            const existing = database.prepare("SELECT 1 FROM saved_posts WHERE username = ? AND post_id = ?").get(user.username, postId);
            if (existing) {
                database.prepare("DELETE FROM saved_posts WHERE username = ? AND post_id = ?").run(user.username, postId);
            } else {
                database.prepare("INSERT INTO saved_posts (username, post_id) VALUES (?, ?)").run(user.username, postId);
            }
            return jsonResponse(response, 200, { saved: !existing });
        }
    }

    const followMatch = pathname.match(/^\/api\/users\/([a-z0-9_]{3,20})\/follow$/);
    if (followMatch && method === "POST") {
        const target = followMatch[1];
        if (target === user.username) return jsonResponse(response, 400, { error: "You cannot follow yourself." });
        if (!statements.userByUsername.get(target)) return jsonResponse(response, 404, { error: "User not found." });
        const existing = database.prepare("SELECT 1 FROM follows WHERE follower_username = ? AND followed_username = ?").get(user.username, target);
        if (existing) {
            database.prepare("DELETE FROM follows WHERE follower_username = ? AND followed_username = ?").run(user.username, target);
        } else {
            database.prepare("INSERT INTO follows (follower_username, followed_username) VALUES (?, ?)").run(user.username, target);
            statements.insertNotification.run(target, user.username, "started following you 👥", new Date().toISOString());
        }
        return jsonResponse(response, 200, { following: !existing });
    }

    if (pathname === "/api/profile" && method === "PATCH") {
        const body = await readJson(request);
        const name = typeof body.name === "string" ? body.name.trim() : "";
        const bio = typeof body.bio === "string" ? body.bio.trim() : "";
        const avatar = typeof body.avatar === "string" ? body.avatar.trim() : "";
        const cover = typeof body.cover === "string" ? body.cover.trim() : "";
        if (!name || name.length > 80 || bio.length > 300 || avatar.length > 2048 || cover.length > 2048 ||
            !isValidOptionalUrl(avatar) || !isValidOptionalUrl(cover)) {
            return jsonResponse(response, 400, { error: "Check the profile fields. Names are required, bios are limited to 300 characters, and image links must be HTTP(S)." });
        }
        database.prepare("UPDATE users SET name = ?, bio = ?, avatar = ?, cover = ? WHERE username = ?")
            .run(name, bio, avatar, cover, user.username);
        return jsonResponse(response, 200, { user: publicUser(user.username) });
    }

    if (pathname === "/api/notifications/read" && method === "POST") {
        database.prepare("UPDATE notifications SET is_read = 1 WHERE recipient_username = ?").run(user.username);
        return jsonResponse(response, 200, { ok: true });
    }

    return jsonResponse(response, 404, { error: "API endpoint not found." });
}

function serveStatic(response, url) {
    const requestedPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
    if (!["/index.html", "/script.js", "/style.css"].includes(requestedPath)) {
        response.writeHead(404);
        response.end("Not found");
        return;
    }

    try {
        const filePath = resolve(ROOT, requestedPath.slice(1));
        const contents = readFileSync(filePath);
        response.writeHead(200, {
            "Content-Type": MIME_TYPES[extname(filePath)] || "application/octet-stream",
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "no-cache"
        });
        response.end(contents);
    } catch (error) {
        if (error.code === "ENOENT" || error.code === "EISDIR") {
            response.writeHead(404);
            response.end("Not found");
            return;
        }
        throw error;
    }
}

const server = createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    try {
        if (url.pathname.startsWith("/api/")) {
            await handleApi(request, response, url);
        } else if (request.method === "GET" || request.method === "HEAD") {
            serveStatic(response, url);
        } else {
            jsonResponse(response, 405, { error: "Method not allowed." });
        }
    } catch (error) {
        if (response.headersSent) {
            response.destroy(error);
            return;
        }
        if (error.status) {
            jsonResponse(response, error.status, { error: error.message });
            return;
        }
        console.error(error);
        jsonResponse(response, 500, { error: "An unexpected server error occurred." });
    }
});

const port = Number(process.env.PORT || 3000);
server.listen(port, "127.0.0.1", () => {
    const address = server.address();
    console.log(`SiddVerse is running at http://127.0.0.1:${address.port}`);
    console.log(`SQLite database: ${DATABASE_PATH}`);
});

function closeDatabase() {
    server.close(() => {
        database.close();
    });
}

process.on("SIGINT", closeDatabase);
process.on("SIGTERM", closeDatabase);
