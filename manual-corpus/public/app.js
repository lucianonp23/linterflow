// PulseNet Client SPA Logic

const API_BASE = '/api/v1';

// State Management
let currentUser = null;
let currentToken = localStorage.getItem('pulse_token') || null;
let currentFeedTab = 'timeline'; // 'timeline' | 'explore'

// Demo Accounts
const DEMO_USERS = [
  { username: 'alex_dev', name: 'Alex Morgan', avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80' },
  { username: 'sarah_design', name: 'Sarah Chen', avatar: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=200&auto=format&fit=crop&q=80' },
  { username: 'tech_guru', name: 'Marcus Vance', avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&auto=format&fit=crop&q=80' },
  { username: 'elena_ai', name: 'Elena Rostova', avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&auto=format&fit=crop&q=80' },
];

// Initialize App
document.addEventListener('DOMContentLoaded', async () => {
  renderDemoUsersBar();
  setupEventListeners();

  if (currentToken) {
    await fetchCurrentUser();
  } else {
    // Default to auto-login as Alex Dev on first visit for zero-friction demo!
    await loginDemoUser('alex_dev');
  }

  loadFeed();
  loadSuggestedUsers();
});

// Setup Event Listeners
function setupEventListeners() {
  // Brand Logo Click
  document.getElementById('brandLogo').addEventListener('click', () => switchTab('timeline'));

  // Navigation Tabs
  document.getElementById('tabTimelineBtn').addEventListener('click', () => switchTab('timeline'));
  document.getElementById('tabExploreBtn').addEventListener('click', () => switchTab('explore'));
  document.getElementById('navMyProfileBtn').addEventListener('click', () => {
    if (currentUser) openProfileModal(currentUser.username);
    else openAuthModal('login');
  });

  // Post Creator Textarea
  const postInput = document.getElementById('postContentInput');
  const charCount = document.getElementById('charCount');
  postInput.addEventListener('input', () => {
    const len = postInput.value.length;
    charCount.textContent = `${len} / 280`;
  });

  // Attach Image Button
  document.getElementById('attachImageBtn').addEventListener('click', () => {
    const defaultSample = 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800';
    const url = prompt('Enter Image URL to attach to your post:', defaultSample);
    if (url && url.trim()) {
      document.getElementById('imagePreview').src = url.trim();
      document.getElementById('imagePreviewContainer').style.display = 'block';
    }
  });

  document.getElementById('removeImageBtn').addEventListener('click', () => {
    document.getElementById('imagePreview').src = '';
    document.getElementById('imagePreviewContainer').style.display = 'none';
  });

  // Publish Post Button
  document.getElementById('publishPostBtn').addEventListener('click', handlePublishPost);

  // Search Input
  const searchInput = document.getElementById('userSearchInput');
  searchInput.addEventListener('input', debounce(handleUserSearch, 300));
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-bar')) {
      document.getElementById('searchResultsDropdown').classList.remove('active');
    }
  });

  // Auth Modal Controls
  document.getElementById('closeAuthModalBtn').addEventListener('click', closeAuthModal);
  document.getElementById('authTabLogin').addEventListener('click', () => toggleAuthForm('login'));
  document.getElementById('authTabRegister').addEventListener('click', () => toggleAuthForm('register'));

  document.getElementById('loginForm').addEventListener('submit', handleLoginSubmit);
  document.getElementById('registerForm').addEventListener('submit', handleRegisterSubmit);

  // Profile Modal Controls
  document.getElementById('closeProfileModalBtn').addEventListener('click', () => {
    document.getElementById('profileModal').style.display = 'none';
  });
}

// Demo Users Switcher Bar
function renderDemoUsersBar() {
  const container = document.getElementById('demoUsersList');
  container.innerHTML = DEMO_USERS.map((user) => `
    <button class="demo-user-chip ${currentUser && currentUser.username === user.username ? 'active' : ''}" 
            onclick="loginDemoUser('${user.username}')">
      <img src="${user.avatar}" alt="${user.name}">
      <span>@${user.username}</span>
    </button>
  `).join('');
}

// Switch Tabs (Timeline vs Explore)
function switchTab(tab) {
  currentFeedTab = tab;
  document.getElementById('tabTimelineBtn').classList.toggle('active', tab === 'timeline');
  document.getElementById('tabExploreBtn').classList.toggle('active', tab === 'explore');

  const titleHeading = document.getElementById('feedTitleHeading');
  const subtitle = document.getElementById('feedSubtitle');

  if (tab === 'timeline') {
    titleHeading.textContent = 'My Timeline';
    subtitle.textContent = 'Posts from creators you follow';
  } else {
    titleHeading.textContent = 'Explore Feed';
    subtitle.textContent = 'Discover recent posts across the network';
  }

  loadFeed();
}

// Fetch Current User Info
async function fetchCurrentUser() {
  try {
    const res = await apiRequest('/auth/me');
    if (res && res.id) {
      currentUser = res;
      updateUserUI();
    } else {
      logout();
    }
  } catch (err) {
    console.error('Error fetching current user:', err);
    logout();
  }
}

// Quick Login Demo User
async function loginDemoUser(username) {
  try {
    const res = await apiRequest('/auth/login', 'POST', {
      usernameOrEmail: username,
      password: 'password123',
    });

    if (res.accessToken) {
      currentToken = res.accessToken;
      currentUser = res.user;
      localStorage.setItem('pulse_token', currentToken);
      updateUserUI();
      renderDemoUsersBar();
      showToast(`Signed in as @${username}`, 'success');
      loadFeed();
      loadSuggestedUsers();
    }
  } catch (err) {
    showToast('Failed to switch demo user: ' + err.message, 'error');
  }
}

// Login Submit Handler
async function handleLoginSubmit(e) {
  e.preventDefault();
  const usernameOrEmail = document.getElementById('loginUsername').value;
  const password = document.getElementById('loginPassword').value;

  try {
    const res = await apiRequest('/auth/login', 'POST', { usernameOrEmail, password });
    if (res.accessToken) {
      currentToken = res.accessToken;
      currentUser = res.user;
      localStorage.setItem('pulse_token', currentToken);
      updateUserUI();
      closeAuthModal();
      showToast('Logged in successfully!', 'success');
      loadFeed();
      loadSuggestedUsers();
    }
  } catch (err) {
    showToast(err.message || 'Login failed', 'error');
  }
}

// Register Submit Handler
async function handleRegisterSubmit(e) {
  e.preventDefault();
  const username = document.getElementById('regUsername').value;
  const fullName = document.getElementById('regFullName').value;
  const email = document.getElementById('regEmail').value;
  const password = document.getElementById('regPassword').value;
  const bio = document.getElementById('regBio').value;

  try {
    const res = await apiRequest('/auth/register', 'POST', {
      username,
      fullName,
      email,
      password,
      bio,
    });

    if (res.accessToken) {
      currentToken = res.accessToken;
      currentUser = res.user;
      localStorage.setItem('pulse_token', currentToken);
      updateUserUI();
      closeAuthModal();
      showToast(`Welcome to PulseNet, @${username}!`, 'success');
      loadFeed();
      loadSuggestedUsers();
    }
  } catch (err) {
    showToast(err.message || 'Registration failed', 'error');
  }
}

// Logout
function logout() {
  currentToken = null;
  currentUser = null;
  localStorage.removeItem('pulse_token');
  updateUserUI();
  renderDemoUsersBar();
  showToast('Logged out', 'success');
  loadFeed();
}

// Update User UI Elements
function updateUserUI() {
  const authHeader = document.getElementById('authHeaderState');
  const miniProfile = document.getElementById('miniProfileCard');
  const userAvatar = document.getElementById('currentUserAvatar');

  if (currentUser) {
    userAvatar.src = currentUser.avatarUrl || 'https://api.dicebear.com/7.x/bottts/svg?seed=' + currentUser.username;
    
    authHeader.innerHTML = `
      <div class="user-chip-header" onclick="openProfileModal('${currentUser.username}')" style="cursor: pointer; display: flex; align-items: center; gap: 0.5rem;">
        <img src="${currentUser.avatarUrl}" class="avatar avatar-sm" alt="Me">
        <span style="font-weight: 600; font-size: 0.88rem;">@${currentUser.username}</span>
        <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); logout();" title="Logout">
          <i class="fa-solid fa-arrow-right-from-bracket"></i>
        </button>
      </div>
    `;

    miniProfile.innerHTML = `
      <img src="${currentUser.avatarUrl}" class="avatar avatar-lg" alt="${currentUser.fullName}">
      <h3 class="mini-name">${currentUser.fullName}</h3>
      <p class="mini-handle">@${currentUser.username}</p>
      <div class="mini-stats">
        <div class="stat-item">
          <span class="stat-num" id="miniPostsCount">-</span>
          <span class="stat-lbl">Posts</span>
        </div>
        <div class="stat-item">
          <span class="stat-num" id="miniFollowersCount">-</span>
          <span class="stat-lbl">Followers</span>
        </div>
        <div class="stat-item">
          <span class="stat-num" id="miniFollowingCount">-</span>
          <span class="stat-lbl">Following</span>
        </div>
      </div>
    `;

    // Fetch details for mini card stats
    apiRequest(`/users/${currentUser.username}`).then(profile => {
      if (profile) {
        document.getElementById('miniPostsCount').textContent = profile.postsCount || 0;
        document.getElementById('miniFollowersCount').textContent = profile.followersCount || 0;
        document.getElementById('miniFollowingCount').textContent = profile.followingCount || 0;
      }
    });
  } else {
    userAvatar.src = 'https://api.dicebear.com/7.x/bottts/svg?seed=guest';
    authHeader.innerHTML = `
      <button class="btn btn-secondary" onclick="openAuthModal('login')">Sign In</button>
      <button class="btn btn-primary" onclick="openAuthModal('register')">Sign Up</button>
    `;

    miniProfile.innerHTML = `
      <div style="padding: 0.5rem;">
        <h4 style="font-size: 1rem; font-weight: 700;">Welcome to PulseNet</h4>
        <p style="font-size: 0.8rem; color: var(--text-muted); margin-top: 0.25rem;">Sign in or pick a demo profile above to start posting & following!</p>
        <button class="btn btn-primary btn-sm btn-block" onclick="openAuthModal('login')" style="margin-top: 0.85rem;">Sign In</button>
      </div>
    `;
  }
}

// Publish Short Post
async function handlePublishPost() {
  if (!currentUser) {
    openAuthModal('login');
    return;
  }

  const contentInput = document.getElementById('postContentInput');
  const content = contentInput.value.trim();
  const imageUrl = document.getElementById('imagePreview').src;
  const hasImage = document.getElementById('imagePreviewContainer').style.display !== 'none' && imageUrl;

  if (!content) {
    showToast('Please enter some post text', 'error');
    return;
  }

  try {
    const postData = { content };
    if (hasImage) postData.imageUrl = imageUrl;

    const res = await apiRequest('/posts', 'POST', postData);
    if (res && res.id) {
      contentInput.value = '';
      document.getElementById('charCount').textContent = '0 / 280';
      document.getElementById('imagePreviewContainer').style.display = 'none';
      document.getElementById('imagePreview').src = '';
      showToast('Post published!', 'success');
      loadFeed();
      updateUserUI();
    }
  } catch (err) {
    showToast(err.message || 'Failed to create post', 'error');
  }
}

// Load Feed Posts
async function loadFeed() {
  const container = document.getElementById('postsFeedContainer');
  container.innerHTML = `
    <div class="loading-spinner">
      <i class="fa-solid fa-circle-notch fa-spin"></i>
      <p>Loading ${currentFeedTab} feed...</p>
    </div>
  `;

  try {
    const endpoint = currentFeedTab === 'timeline' && currentToken ? '/feed' : '/feed/explore';
    const res = await apiRequest(endpoint);

    if (res && res.data && res.data.length > 0) {
      container.innerHTML = res.data.map(post => renderPostCard(post)).join('');
    } else {
      container.innerHTML = `
        <div class="glass-card" style="padding: 2.5rem; text-align: center; color: var(--text-muted);">
          <i class="fa-regular fa-paper-plane" style="font-size: 2.5rem; margin-bottom: 0.75rem; color: var(--primary);"></i>
          <h3>No posts found in this feed</h3>
          <p style="font-size: 0.85rem; margin-top: 0.35rem;">
            ${currentFeedTab === 'timeline' ? 'Follow users from Suggested Creators or switch to Explore Feed!' : 'Be the first to publish a post!'}
          </p>
        </div>
      `;
    }
  } catch (err) {
    console.error('Feed error:', err);
    container.innerHTML = `<div class="glass-card" style="padding: 1.5rem; color: var(--accent-pink);">Failed to load posts.</div>`;
  }
}

// Render Single Post Card
function renderPostCard(post) {
  const timeAgo = formatTimeAgo(post.createdAt);
  const mediaHtml = post.imageUrl ? `
    <div class="post-media">
      <img src="${post.imageUrl}" alt="Post attachment" loading="lazy">
    </div>
  ` : '';

  return `
    <article class="glass-card post-card" id="post-${post.id}">
      <div class="post-author-row">
        <div class="post-author-info" onclick="openProfileModal('${post.author.username}')">
          <img src="${post.author.avatarUrl}" class="avatar avatar-md" alt="${post.author.fullName}">
          <div class="author-names">
            <span class="author-fullname">${post.author.fullName}</span>
            <span class="author-handle">@${post.author.username}</span>
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 0.75rem;">
          <span class="post-time">${timeAgo}</span>
          ${post.isOwner ? `
            <button class="action-btn" onclick="deletePost('${post.id}')" title="Delete post" style="color: var(--text-dim);">
              <i class="fa-regular fa-trash-can"></i>
            </button>
          ` : ''}
        </div>
      </div>

      <div class="post-body">${escapeHtml(post.content)}</div>
      ${mediaHtml}

      <div class="post-actions-row">
        <button class="action-btn like-btn ${post.isLiked ? 'liked' : ''}" onclick="toggleLikePost('${post.id}', ${post.isLiked})">
          <i class="${post.isLiked ? 'fa-solid' : 'fa-regular'} fa-heart"></i>
          <span id="like-count-${post.id}">${post.likesCount}</span>
        </button>

        <button class="action-btn comment-btn" onclick="toggleCommentsSection('${post.id}')">
          <i class="fa-regular fa-comment"></i>
          <span id="comment-count-${post.id}">${post.commentsCount}</span>
        </button>
      </div>

      <div class="comments-section" id="comments-section-${post.id}">
        <div class="comments-list" id="comments-list-${post.id}">
          <div style="font-size: 0.8rem; color: var(--text-dim);">Loading comments...</div>
        </div>
        <form class="add-comment-form" onsubmit="handleCommentSubmit(event, '${post.id}')">
          <input type="text" id="comment-input-${post.id}" placeholder="Write a comment..." maxlength="280" required>
          <button type="submit" class="btn btn-primary btn-sm"><i class="fa-solid fa-paper-plane"></i></button>
        </form>
      </div>
    </article>
  `;
}

// Toggle Like
async function toggleLikePost(postId, isCurrentlyLiked) {
  if (!currentUser) {
    openAuthModal('login');
    return;
  }

  try {
    const method = isCurrentlyLiked ? 'DELETE' : 'POST';
    const res = await apiRequest(`/posts/${postId}/like`, method);

    if (res) {
      const card = document.getElementById(`post-${postId}`);
      const likeBtn = card.querySelector('.like-btn');
      const countSpan = document.getElementById(`like-count-${postId}`);
      
      likeBtn.classList.toggle('liked', res.isLiked);
      likeBtn.setAttribute('onclick', `toggleLikePost('${postId}', ${res.isLiked})`);
      likeBtn.querySelector('i').className = `${res.isLiked ? 'fa-solid' : 'fa-regular'} fa-heart`;
      countSpan.textContent = res.likesCount;
    }
  } catch (err) {
    showToast(err.message || 'Error updating like', 'error');
  }
}

// Delete Post
async function deletePost(postId) {
  if (!confirm('Are you sure you want to delete this post?')) return;
  try {
    await apiRequest(`/posts/${postId}`, 'DELETE');
    showToast('Post deleted', 'success');
    loadFeed();
  } catch (err) {
    showToast(err.message || 'Failed to delete post', 'error');
  }
}

// Comments Toggle
async function toggleCommentsSection(postId) {
  const section = document.getElementById(`comments-section-${postId}`);
  const isVisible = section.classList.contains('active');

  if (isVisible) {
    section.classList.remove('active');
  } else {
    section.classList.add('active');
    loadComments(postId);
  }
}

// Load Comments for Post
async function loadComments(postId) {
  const listEl = document.getElementById(`comments-list-${postId}`);
  try {
    const comments = await apiRequest(`/posts/${postId}/comments`);
    if (comments && comments.length > 0) {
      listEl.innerHTML = comments.map(c => `
        <div class="comment-item">
          <img src="${c.author.avatarUrl}" class="avatar avatar-sm" alt="${c.author.username}">
          <div class="comment-content-wrap">
            <div class="comment-header">
              <span class="comment-author">@${c.author.username}</span>
              <span class="comment-time">${formatTimeAgo(c.createdAt)}</span>
            </div>
            <p class="comment-text">${escapeHtml(c.content)}</p>
          </div>
        </div>
      `).join('');
    } else {
      listEl.innerHTML = `<div style="font-size: 0.8rem; color: var(--text-dim); text-align: center;">No comments yet. Be the first to comment!</div>`;
    }
  } catch (err) {
    listEl.innerHTML = `<div style="font-size: 0.8rem; color: var(--accent-pink);">Failed to load comments.</div>`;
  }
}

// Comment Submit Handler
async function handleCommentSubmit(e, postId) {
  e.preventDefault();
  if (!currentUser) {
    openAuthModal('login');
    return;
  }

  const input = document.getElementById(`comment-input-${postId}`);
  const content = input.value.trim();
  if (!content) return;

  try {
    const res = await apiRequest(`/posts/${postId}/comments`, 'POST', { content });
    if (res && res.id) {
      input.value = '';
      showToast('Comment posted', 'success');
      loadComments(postId);

      // Increment comment count on post card
      const countSpan = document.getElementById(`comment-count-${postId}`);
      if (countSpan) countSpan.textContent = parseInt(countSpan.textContent || '0') + 1;
    }
  } catch (err) {
    showToast(err.message || 'Failed to post comment', 'error');
  }
}

// Load Suggested Creators
async function loadSuggestedUsers() {
  const container = document.getElementById('suggestedUsersList');
  try {
    const users = await apiRequest('/users');
    if (users && users.length > 0) {
      const suggestions = users.filter(u => !u.isSelf).slice(0, 5);
      container.innerHTML = suggestions.map(u => `
        <div class="user-suggestion-item">
          <div style="display: flex; align-items: center; gap: 0.65rem; cursor: pointer;" onclick="openProfileModal('${u.username}')">
            <img src="${u.avatarUrl}" class="avatar avatar-sm" alt="${u.fullName}">
            <div style="display: flex; flex-direction: column;">
              <span style="font-weight: 700; font-size: 0.85rem;">${u.fullName}</span>
              <span style="font-size: 0.75rem; color: var(--text-muted);">@${u.username}</span>
            </div>
          </div>
          <button class="btn ${u.isFollowing ? 'btn-secondary' : 'btn-outline'} btn-sm" 
                  onclick="toggleFollowUser('${u.id}', ${u.isFollowing})">
            ${u.isFollowing ? 'Following' : 'Follow'}
          </button>
        </div>
      `).join('');
    }
  } catch (err) {
    console.error('Failed suggestions:', err);
  }
}

// Follow / Unfollow Toggle
async function toggleFollowUser(targetUserId, isCurrentlyFollowing) {
  if (!currentUser) {
    openAuthModal('login');
    return;
  }

  try {
    const method = isCurrentlyFollowing ? 'DELETE' : 'POST';
    const res = await apiRequest(`/users/${targetUserId}/follow`, method);

    if (res) {
      showToast(res.message || 'Updated follow status', 'success');
      loadSuggestedUsers();
      updateUserUI();
      if (currentFeedTab === 'timeline') loadFeed();
    }
  } catch (err) {
    showToast(err.message || 'Failed to update follow', 'error');
  }
}

// User Search Handler
async function handleUserSearch(e) {
  const query = e.target.value.trim();
  const dropdown = document.getElementById('searchResultsDropdown');

  if (!query) {
    dropdown.classList.remove('active');
    return;
  }

  try {
    const results = await apiRequest(`/users?search=${encodeURIComponent(query)}`);
    if (results && results.length > 0) {
      dropdown.innerHTML = results.map(u => `
        <div class="search-item" onclick="openProfileModal('${u.username}'); document.getElementById('searchResultsDropdown').classList.remove('active');">
          <img src="${u.avatarUrl}" class="avatar avatar-sm" alt="${u.fullName}">
          <div>
            <div style="font-weight: 700; font-size: 0.88rem;">${u.fullName}</div>
            <div style="font-size: 0.75rem; color: var(--text-muted);">@${u.username}</div>
          </div>
        </div>
      `).join('');
      dropdown.classList.add('active');
    } else {
      dropdown.innerHTML = `<div style="padding: 0.75rem; font-size: 0.8rem; color: var(--text-dim); text-align: center;">No users found matching "${escapeHtml(query)}"</div>`;
      dropdown.classList.add('active');
    }
  } catch (err) {
    console.error('Search error:', err);
  }
}

// Open Profile Modal
async function openProfileModal(username) {
  const modal = document.getElementById('profileModal');
  const body = document.getElementById('profileModalBody');
  modal.style.display = 'flex';
  body.innerHTML = `<div class="loading-spinner"><i class="fa-solid fa-circle-notch fa-spin"></i><p>Loading profile...</p></div>`;

  try {
    const profile = await apiRequest(`/users/${username}`);
    const userPosts = await apiRequest(`/posts/user/${profile.id}`);

    body.innerHTML = `
      <div style="text-align: center; margin-bottom: 1.5rem;">
        <img src="${profile.avatarUrl}" class="avatar avatar-xl" alt="${profile.fullName}">
        <h2 style="font-family: 'Outfit', sans-serif; font-size: 1.5rem; margin-top: 0.5rem;">${profile.fullName}</h2>
        <p style="color: var(--text-muted); font-size: 0.9rem;">@${profile.username}</p>
        <p style="margin-top: 0.75rem; font-size: 0.95rem; color: var(--text-main);">${escapeHtml(profile.bio || '')}</p>

        <div style="display: flex; justify-content: center; gap: 2rem; margin-top: 1.25rem; padding: 0.85rem; background: rgba(15,23,42,0.5); border-radius: var(--radius-sm);">
          <div><strong style="color:#FFF;">${profile.postsCount}</strong> <span style="font-size:0.8rem; color:var(--text-dim);">Posts</span></div>
          <div><strong style="color:#FFF;">${profile.followersCount}</strong> <span style="font-size:0.8rem; color:var(--text-dim);">Followers</span></div>
          <div><strong style="color:#FFF;">${profile.followingCount}</strong> <span style="font-size:0.8rem; color:var(--text-dim);">Following</span></div>
        </div>

        ${!profile.isSelf ? `
          <button class="btn ${profile.isFollowing ? 'btn-secondary' : 'btn-primary'} btn-block" style="margin-top: 1.25rem;"
                  onclick="toggleFollowUser('${profile.id}', ${profile.isFollowing}); openProfileModal('${profile.username}');">
            ${profile.isFollowing ? 'Following' : 'Follow User'}
          </button>
        ` : ''}
      </div>

      <h3 style="font-family:'Outfit', sans-serif; font-size: 1.1rem; margin-bottom: 1rem; border-bottom: 1px solid var(--card-border); padding-bottom: 0.5rem;">
        Posts by @${profile.username}
      </h3>

      <div style="display: flex; flex-direction: column; gap: 1rem;">
        ${userPosts && userPosts.length > 0 ? userPosts.map(p => renderPostCard(p)).join('') : '<p style="color:var(--text-dim); text-align:center;">No posts published yet.</p>'}
      </div>
    `;
  } catch (err) {
    body.innerHTML = `<div style="color: var(--accent-pink);">Failed to load profile.</div>`;
  }
}

// Modal Toggle Helpers
function openAuthModal(formType = 'login') {
  document.getElementById('authModal').style.display = 'flex';
  toggleAuthForm(formType);
}

function closeAuthModal() {
  document.getElementById('authModal').style.display = 'none';
}

function toggleAuthForm(formType) {
  const isLogin = formType === 'login';
  document.getElementById('authTabLogin').classList.toggle('active', isLogin);
  document.getElementById('authTabRegister').classList.toggle('active', !isLogin);
  document.getElementById('loginForm').style.display = isLogin ? 'flex' : 'none';
  document.getElementById('registerForm').style.display = isLogin ? 'none' : 'flex';
}

// API Request Helper Wrapper
async function apiRequest(endpoint, method = 'GET', body = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (currentToken) {
    headers['Authorization'] = `Bearer ${currentToken}`;
  }

  const config = { method, headers };
  if (body) config.body = JSON.stringify(body);

  const res = await fetch(`${API_BASE}${endpoint}`, config);
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.message || 'API request failed');
  }

  return data;
}

// Toast Notifications
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;

  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// Utilities
function formatTimeAgo(dateStr) {
  const date = new Date(dateStr);
  const seconds = Math.floor((new Date() - date) / 1000);

  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, (m) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  }[m]));
}

function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}
