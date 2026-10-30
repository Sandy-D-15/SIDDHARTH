/* =====================================
   APPLICATION STATE
===================================== */

let users = [];
let posts = [];
let notifications = [];
let currentUser = null;
let savedPosts = [];
let activeFilter = localStorage.getItem("siddverse_filter") || "latest";

/* =====================================
   API AND DATA LOADING
===================================== */

async function apiRequest(path, options = {}) {
    if (window.location.protocol === "file:") {
        throw new Error("Start the server with npm start, then open http://127.0.0.1:3000 to use the SQLite database.");
    }

    let response;
    try {
        response = await fetch(path, {
            ...options,
            headers: {
                ...(options.body ? { "Content-Type": "application/json" } : {}),
                ...options.headers
            }
        });
    } catch (error) {
        if (error instanceof TypeError) {
            throw new Error("Cannot reach the server. Start it with npm start, then open http://127.0.0.1:3000.");
        }
        throw error;
    }
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "The request could not be completed.");
    return data;
}

async function loadAppData() {
    const data = await apiRequest("/api/bootstrap");
    users = data.users;
    posts = data.posts;
    notifications = data.notifications;
    savedPosts = data.savedPosts;
    currentUser = data.currentUser;
}

async function refreshAppData() {
    await loadAppData();
    updateNavbar();
    updateStats();
    renderSuggestions();
    renderProfile();
    renderFeed();
    renderTrendingTopics();
    updateNotificationBadge();
    if (document.getElementById("notificationsPage").style.display === "block") {
        renderNotifications();
    }
}

function getSavedForCurrentUser() {
    return savedPosts;
}

/* =====================================
   AUTH
===================================== */

function showRegister() {
    document.getElementById("loginForm").style.display = "none";
    document.getElementById("registerForm").style.display = "block";
}

function showLogin() {
    document.getElementById("registerForm").style.display = "none";
    document.getElementById("loginForm").style.display = "block";
}

async function register() {
    const name = document.getElementById("registerName").value.trim();
    const username = document.getElementById("registerUsername").value.trim().toLowerCase();
    const password = document.getElementById("registerPassword").value;

    if (!name || !username || password.length < 4) {
        showToast("Enter your name, a username, and a password of at least 4 characters.");
        return;
    }

    if (!/^[a-z0-9_]{3,20}$/.test(username)) {
        showToast("Username must be 3–20 characters: letters, numbers, or underscores.");
        return;
    }

    try {
        const data = await apiRequest("/api/auth/register", {
            method: "POST",
            body: JSON.stringify({ name, username, password })
        });
        users.push(data.user);
        document.getElementById("registerPassword").value = "";
        document.getElementById("loginUsername").value = username;
        showToast("Account created successfully!");
        showLogin();
    } catch (error) {
        showToast(error.message);
    }
}

async function login() {
    const username = document.getElementById("loginUsername").value.trim().toLowerCase();
    const password = document.getElementById("loginPassword").value;

    try {
        await apiRequest("/api/auth/login", {
            method: "POST",
            body: JSON.stringify({ username, password })
        });
        document.getElementById("loginPassword").value = "";
        await loadAppData();
        startApp();
    } catch (error) {
        showToast(error.message);
    }
}

async function logout() {
    try {
        await apiRequest("/api/auth/session", { method: "DELETE" });
    } catch (error) {
        showToast(error.message);
        return;
    }
    currentUser = null;
    users = [];
    posts = [];
    notifications = [];
    savedPosts = [];
    document.getElementById("app").style.display = "none";
    document.getElementById("authPage").style.display = "flex";
    showToast("Logged out successfully.");
}

/* =====================================
   CURRENT USER
===================================== */

function getCurrentUser() {
    return users.find(u => u.username === currentUser);
}

/* =====================================
   APP INITIALIZATION
===================================== */

function startApp() {
    if (!currentUser) return;

    document.getElementById("authPage").style.display = "none";
    document.getElementById("app").style.display = "block";

    updateNavbar();
    updateStats();
    renderSuggestions();
    renderProfile();
    renderTrendingTopics();
    updateNotificationBadge();
    showHome();
    syncFilterButtons();
}

function updateNavbar() {
    const user = getCurrentUser();
    if (!user) return;

    document.getElementById("navUsername").textContent = "@" + user.username;
    const letter = user.name.charAt(0).toUpperCase();
    const avatarEl = document.getElementById("navAvatar");
    const createAvatar = document.getElementById("createAvatar");

    avatarEl.textContent = letter;
    createAvatar.textContent = letter;

    if (user.avatar) {
        avatarEl.innerHTML = `<img src="${escapeAttribute(user.avatar)}" alt="avatar" class="user-avatar-image">`;
        createAvatar.innerHTML = `<img src="${escapeAttribute(user.avatar)}" alt="avatar" class="user-avatar-image">`;
    }
}

/* =====================================
   FILTERS
===================================== */

function setFilter(mode) {
    activeFilter = mode;
    localStorage.setItem("siddverse_filter", mode);
    syncFilterButtons();
    renderFeed();
}

function syncFilterButtons() {
    document.querySelectorAll(".filter-btn").forEach(button => {
        const isActive = button.dataset.filter === activeFilter;
        button.classList.toggle("active", isActive);
        button.setAttribute("aria-pressed", String(isActive));
    });
}

function getFilteredPosts() {
    const me = getCurrentUser();
    const following = me ? me.following : [];
    const saved = getSavedForCurrentUser();

    let filtered = [...posts];

    if (activeFilter === "following") {
        filtered = filtered.filter(post => post.username === currentUser || following.includes(post.username));
    } else if (activeFilter === "trending") {
        filtered = filtered.filter(post => post.likes.length >= 1 || post.comments.length >= 1).sort((a, b) => {
            const scoreA = a.likes.length + a.comments.length * 2;
            const scoreB = b.likes.length + b.comments.length * 2;
            return scoreB - scoreA;
        });
    } else if (activeFilter === "saved") {
        filtered = filtered.filter(post => saved.includes(post.id));
    }

    return filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

/* =====================================
   CREATE POST
===================================== */

async function createPost() {
    const text = document.getElementById("postText").value.trim();
    const image = document.getElementById("imageURL").value.trim();

    if (!text && !image) {
        showToast("Write something first!");
        return;
    }

    try {
        await apiRequest("/api/posts", {
            method: "POST",
            body: JSON.stringify({ text, image })
        });
        document.getElementById("postText").value = "";
        document.getElementById("imageURL").value = "";
        await refreshAppData();
        showToast("Post published 🚀");
    } catch (error) {
        showToast(error.message);
    }
}

/* =====================================
   FEED RENDERING
===================================== */

function renderFeed(list = getFilteredPosts()) {
    const feed = document.getElementById("feed");
    feed.innerHTML = "";

    if (list.length === 0) {
        const query = document.getElementById("searchInput").value.trim();
        let heading = "No posts yet";
        let message = "Be the first to share something with your community.";

        if (query) {
            heading = `No results for "${query}"`;
            message = "Try another search term.";
        } else if (activeFilter === "saved") {
            heading = "No saved posts yet";
            message = "Save a post and it will appear here.";
        } else if (activeFilter === "following") {
            heading = "No posts from your circle yet";
            message = "Follow people or share a post to fill your feed.";
        } else if (activeFilter === "trending") {
            heading = "Nothing trending yet";
            message = "Posts with likes and comments will show up here.";
        }

        feed.innerHTML = `
            <div class="post-card empty-state">
                <h3>${escapeHTML(heading)}</h3>
                <p>${escapeHTML(message)}</p>
            </div>
        `;
        return;
    }

    list.forEach(post => feed.appendChild(createPostElement(post)));
}

function createPostElement(post) {
    const user = users.find(u => u.username === post.username);
    const div = document.createElement("div");
    div.className = "post-card";

    const liked = post.likes.includes(currentUser);
    const canDelete = post.username === currentUser;
    const saved = getSavedForCurrentUser().includes(post.id);
    const userInitial = user ? user.name.charAt(0).toUpperCase() : "U";
    const profileImage = user && user.avatar ? `<img src="${escapeAttribute(user.avatar)}" alt="" class="user-avatar-image">` : `<div class="avatar" aria-hidden="true">${userInitial}</div>`;

    const commentsHTML = post.comments.map(c => `
        <div class="comment"><strong>@${escapeHTML(c.username)}</strong>${escapeHTML(c.text)}</div>
    `).join("");

    const createdAt = new Date(post.createdAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

    div.innerHTML = `
        <div class="post-header">
            <div class="user-info">
                ${profileImage}
                <div>
                    <div class="user-name">${user ? escapeHTML(user.name) : post.username}</div>
                    <div class="username">@${escapeHTML(post.username)}</div>
                </div>
            </div>
            ${canDelete ? `<button class="post-menu" type="button" aria-label="Delete post" onclick="deletePost(${post.id})">🗑️</button>` : ""}
        </div>

        <div class="post-meta">${createdAt}</div>

        ${post.text ? `<div class="post-text">${escapeHTML(post.text)}</div>` : ""}
        ${post.image ? `<img class="post-image" src="${escapeAttribute(post.image)}" alt="Image attached to post">` : ""}

        <div class="post-actions">
            <button class="action-btn ${liked ? "liked" : ""}" type="button" aria-label="${liked ? "Unlike" : "Like"} post" aria-pressed="${liked}" onclick="toggleLike(${post.id})">${liked ? "❤️" : "🤍"} ${post.likes.length}</button>
            <button class="action-btn" type="button" aria-label="Write a comment" onclick="focusComment(${post.id})">💬 ${post.comments.length}</button>
            <button class="action-btn" type="button" onclick="sharePost(${post.id})">🔗 Share</button>
            <button class="action-btn" type="button" aria-pressed="${saved}" onclick="toggleSave(${post.id})">${saved ? "🔖 Saved" : "📌 Save"}</button>
        </div>

        <div class="comments">
            ${commentsHTML}
            <input class="comment-input" id="comment-${post.id}" aria-label="Write a comment" placeholder="Write a comment..." onkeydown="commentEnter(event, ${post.id})">
        </div>
    `;

    const postImage = div.querySelector(".post-image");
    if (postImage) {
        postImage.addEventListener("error", () => {
            const fallback = document.createElement("p");
            fallback.className = "image-fallback";
            fallback.textContent = "This image could not be loaded.";
            postImage.replaceWith(fallback);
        }, { once: true });
    }

    return div;
}

/* =====================================
   LIKE / SAVE / COMMENT
===================================== */

async function toggleLike(postId) {
    try {
        await apiRequest(`/api/posts/${postId}/like`, { method: "POST" });
        await refreshAppData();
    } catch (error) {
        showToast(error.message);
    }
}

async function toggleSave(postId) {
    if (!currentUser) return;

    try {
        const result = await apiRequest(`/api/posts/${postId}/save`, { method: "POST" });
        await refreshAppData();
        showToast(result.saved ? "Post saved successfully." : "Post removed from saved items.");
    } catch (error) {
        showToast(error.message);
    }
}

function commentEnter(event, postId) {
    if (event.key === "Enter") {
        addComment(postId);
    }
}

function focusComment(postId) {
    const input = document.getElementById("comment-" + postId);
    if (input) input.focus();
}

async function addComment(postId) {
    const input = document.getElementById("comment-" + postId);
    if (!input) return;

    const text = input.value.trim();
    if (!text) return;

    const post = posts.find(p => p.id === postId);
    if (!post) return;

    try {
        await apiRequest(`/api/posts/${postId}/comments`, {
            method: "POST",
            body: JSON.stringify({ text })
        });
        await refreshAppData();
    } catch (error) {
        showToast(error.message);
    }
}

/* =====================================
   DELETE / SHARE / FOLLOW / SUGGESTIONS
===================================== */

async function deletePost(postId) {
    const post = posts.find(p => p.id === postId);
    if (!post) return;

    if (post.username !== currentUser) {
        showToast("You can delete only your own posts.");
        return;
    }

    if (!confirm("Delete this post?")) return;

    try {
        await apiRequest(`/api/posts/${postId}`, { method: "DELETE" });
        await refreshAppData();
        showToast("Post deleted.");
    } catch (error) {
        showToast(error.message);
    }
}

function sharePost(postId) {
    const post = posts.find(p => p.id === postId);
    if (!post) return;

    const shareText = `Check this post on SiddVerse: ${post.text || "A fresh update from the community"}`;

    if (navigator.share) {
        navigator.share({ title: "SiddVerse", text: shareText }).catch(error => {
            if (error.name !== "AbortError") showToast("Unable to share this post.");
        });
    } else {
        if (!navigator.clipboard) {
            showToast("Sharing is not available in this browser.");
            return;
        }
        navigator.clipboard.writeText(shareText)
            .then(() => showToast("Post copied to clipboard!"))
            .catch(() => showToast("Unable to copy the post link."));
    }
}

async function toggleFollow(username) {
    if (username === currentUser) return;

    try {
        const result = await apiRequest(`/api/users/${encodeURIComponent(username)}/follow`, { method: "POST" });
        await refreshAppData();
        showToast(result.following ? `You are now following @${username}` : `Unfollowed @${username}`);
    } catch (error) {
        showToast(error.message);
    }
}

function renderSuggestions() {
    const container = document.getElementById("suggestions");
    if (!container) return;

    const me = getCurrentUser();
    if (!me) return;

    container.innerHTML = "";

    users.filter(u => u.username !== currentUser).slice(0, 5).forEach(user => {
        const following = me.following.includes(user.username);
        const div = document.createElement("div");
        div.className = "user-suggestion";

        div.innerHTML = `
            <div class="user-info">
                <div class="avatar" aria-hidden="true">${escapeHTML(user.name.charAt(0).toUpperCase())}</div>
                <div>
                    <strong>${escapeHTML(user.name)}</strong>
                    <div class="username">@${escapeHTML(user.username)}</div>
                </div>
            </div>
            <button class="follow-btn" type="button">${following ? "Following" : "Follow"}</button>
        `;

        div.querySelector(".follow-btn").addEventListener("click", () => toggleFollow(user.username));
        container.appendChild(div);
    });
}

/* =====================================
   PROFILE
===================================== */

function showProfile() {
    setActiveNavigation("profile");
    document.getElementById("homePage").style.display = "none";
    document.getElementById("notificationsPage").style.display = "none";
    document.getElementById("profilePage").style.display = "block";
    renderProfile();
}

function showHome() {
    setActiveNavigation("home");
    document.getElementById("profilePage").style.display = "none";
    document.getElementById("notificationsPage").style.display = "none";
    document.getElementById("homePage").style.display = "block";
    renderFeed();
}

function showNotifications() {
    setActiveNavigation("notifications");
    document.getElementById("homePage").style.display = "none";
    document.getElementById("profilePage").style.display = "none";
    document.getElementById("notificationsPage").style.display = "block";
    renderNotifications();
}

function setActiveNavigation(page) {
    document.querySelectorAll(".side-item[data-page]").forEach(item => {
        const active = item.dataset.page === page;
        item.classList.toggle("active", active);
        if (active) {
            item.setAttribute("aria-current", "page");
        } else {
            item.removeAttribute("aria-current");
        }
    });
}

function renderProfile() {
    const user = getCurrentUser();
    if (!user) return;

    document.getElementById("profileName").textContent = user.name;
    document.getElementById("profileUsername").textContent = "@" + user.username;
    document.getElementById("profileBio").textContent = user.bio;
    document.getElementById("profileAvatar").textContent = user.name.charAt(0).toUpperCase();
    document.getElementById("profileCover").style.background = user.cover ? `url("${escapeAttribute(user.cover)}") center/cover no-repeat` : "linear-gradient(120deg,#7c3aed,#ec4899,#06b6d4)";

    document.getElementById("followerCount").textContent = user.followers.length;
    document.getElementById("followingCount").textContent = user.following.length;
    document.getElementById("postCount").textContent = posts.filter(p => p.username === currentUser).length;
    document.getElementById("sidePostCount").textContent = posts.filter(p => p.username === currentUser).length;
    document.getElementById("sideFollowerCount").textContent = user.followers.length;
    document.getElementById("sideFollowingCount").textContent = user.following.length;

    const profilePosts = document.getElementById("profilePosts");
    profilePosts.innerHTML = "";

    const myPosts = posts.filter(p => p.username === currentUser);
    if (myPosts.length === 0) {
        profilePosts.innerHTML = `<div class="post-card empty-state"><h3>No posts yet</h3><p>Share your first update and start your story.</p></div>`;
        return;
    }

    myPosts.forEach(post => profilePosts.appendChild(createPostElement(post)));
}

function openEditProfile() {
    const user = getCurrentUser();
    document.getElementById("editName").value = user.name;
    document.getElementById("editBio").value = user.bio;
    document.getElementById("editAvatar").value = user.avatar || "";
    document.getElementById("editCover").value = user.cover || "";
    document.getElementById("editModal").style.display = "flex";
}

function closeEditProfile() {
    document.getElementById("editModal").style.display = "none";
}

async function saveProfile() {
    const user = getCurrentUser();
    const profile = {
        name: document.getElementById("editName").value.trim() || user.name,
        bio: document.getElementById("editBio").value.trim(),
        avatar: document.getElementById("editAvatar").value.trim(),
        cover: document.getElementById("editCover").value.trim()
    };

    try {
        await apiRequest("/api/profile", {
            method: "PATCH",
            body: JSON.stringify(profile)
        });
        closeEditProfile();
        await refreshAppData();
        showToast("Profile updated successfully!");
    } catch (error) {
        showToast(error.message);
    }
}

/* =====================================
   SEARCH + NOTIFICATIONS + TRENDING
===================================== */

function searchContent() {
    const query = document.getElementById("searchInput").value.trim().toLowerCase();
    if (!query) {
        renderFeed();
        return;
    }

    const results = posts.filter(post => {
        const user = users.find(u => u.username === post.username);
        const haystack = `${post.text} ${post.username} ${user ? user.name : ""}`.toLowerCase();
        return haystack.includes(query);
    });

    renderFeed(results);
}

function renderNotifications() {
    const container = document.getElementById("notificationList");
    const myNotifications = notifications
        .filter(notification => notification.to === currentUser)
        .reverse();

    container.innerHTML = "";

    if (myNotifications.length === 0) {
        container.innerHTML = `
            <div class="post-card empty-state">
                <h3>You're all caught up</h3>
                <p>When someone interacts with you, you'll see it here.</p>
            </div>
        `;
        return;
    }

    myNotifications.forEach(notification => {
        const sender = users.find(user => user.username === notification.from);
        const item = document.createElement("article");
        item.className = `notification-item${notification.read ? "" : " unread"}`;

        const avatar = document.createElement("div");
        avatar.className = "avatar";
        avatar.setAttribute("aria-hidden", "true");
        avatar.textContent = sender ? sender.name.charAt(0).toUpperCase() : "U";

        const content = document.createElement("div");
        content.className = "notification-content";

        const message = document.createElement("p");
        const username = document.createElement("strong");
        username.textContent = "@" + notification.from;
        message.append(username, document.createTextNode(" " + notification.text));

        const date = document.createElement("time");
        date.className = "notification-date";
        date.textContent = notification.date && !Number.isNaN(Date.parse(notification.date))
            ? new Date(notification.date).toLocaleString()
            : "";
        if (date.textContent) date.dateTime = notification.date;

        content.append(message, date);
        item.append(avatar, content);
        container.appendChild(item);
    });
}

async function markAllNotificationsRead() {
    try {
        await apiRequest("/api/notifications/read", { method: "POST" });
        await refreshAppData();
    } catch (error) {
        showToast(error.message);
    }
}

function updateNotificationBadge() {
    const badge = document.getElementById("notificationBadge");
    if (!badge) return;

    const unreadCount = notifications.filter(notification =>
        notification.to === currentUser && !notification.read
    ).length;

    badge.hidden = unreadCount === 0;
    badge.textContent = unreadCount > 99 ? "99+" : String(unreadCount);
    document.querySelector(".notification-button").setAttribute(
        "aria-label",
        unreadCount > 0 ? `Show notifications, ${unreadCount} unread` : "Show notifications"
    );
}

function renderTrendingTopics() {
    const container = document.getElementById("trendingTopics");
    if (!container) return;

    const topics = {};
    posts.forEach(post => {
        const text = post.text.toLowerCase();
        ["technology", "ai", "design", "travel", "coding", "photography", "college", "community"].forEach(term => {
            if (text.includes(term)) topics[term] = (topics[term] || 0) + 1;
        });
    });

    const items = Object.entries(topics).sort((a, b) => b[1] - a[1]).slice(0, 5);
    container.innerHTML = "";

    if (items.length === 0) {
        container.innerHTML = `<p class="empty-state">Topics will appear as people share posts.</p>`;
        return;
    }

    items.forEach(([label, count]) => {
        const item = document.createElement("div");
        item.className = "trend-item";
        item.innerHTML = `<span>#${label}</span><small>${count} posts</small>`;
        container.appendChild(item);
    });
}

/* =====================================
   DARK MODE / CREATE POST FOCUS / TOAST
===================================== */

function toggleDarkMode() {
    document.body.classList.toggle("dark");
    localStorage.setItem("siddverse_dark", document.body.classList.contains("dark"));
    document.querySelector(".nav-actions .icon-btn").setAttribute(
        "aria-pressed",
        String(document.body.classList.contains("dark"))
    );
}

function focusCreatePost() {
    showHome();
    document.getElementById("postText").focus();
}

function showToast(message) {
    const toast = document.getElementById("toast");
    toast.textContent = message;
    toast.style.display = "block";
    setTimeout(() => {
        toast.style.display = "none";
    }, 2500);
}

function updateStats() {
    const me = getCurrentUser();
    if (!me) return;

    const myPosts = posts.filter(p => p.username === currentUser).length;
    document.getElementById("statPosts").textContent = myPosts;
    document.getElementById("statFollowers").textContent = me.followers.length;
    document.getElementById("statFollowing").textContent = me.following.length;
    document.getElementById("statSaved").textContent = getSavedForCurrentUser()
        .filter(postId => posts.some(post => post.id === postId)).length;
}

/* =====================================
   SECURITY HELPERS
===================================== */

function escapeHTML(text) {
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function escapeAttribute(text) {
    return String(text)
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

/* =====================================
   INITIALIZE
===================================== */

if (localStorage.getItem("siddverse_dark") === "true") {
    document.body.classList.add("dark");
    document.querySelector(".nav-actions .icon-btn").setAttribute("aria-pressed", "true");
}

document.querySelectorAll(".filter-btn").forEach(button => {
    button.addEventListener("click", () => setFilter(button.dataset.filter));
});

apiRequest("/api/bootstrap")
    .then(data => {
        if (!data.authenticated) return;
        users = data.users;
        posts = data.posts;
        notifications = data.notifications;
        savedPosts = data.savedPosts;
        currentUser = data.currentUser;
        startApp();
    })
    .catch(error => {
        if (error.message !== "Please log in to continue.") {
            showToast("Cannot connect to SiddVerse. Start the server with npm start.");
        }
    });
