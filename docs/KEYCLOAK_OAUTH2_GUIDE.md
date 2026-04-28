# Keycloak OAuth2 Login Integration Guide

## Overview

This guide explains how to use the new Keycloak OAuth2 authentication flow for login and file uploads.

## API Endpoints

### 1. Start Keycloak Login

```
GET /api/auth-keycloak/login
```

Redirects user to Keycloak login page at `https://iam-uat.snp.com.vn/realms/snp-internal`

**Usage (Frontend):**

```javascript
// Redirect to login
window.location.href = '/api/auth-keycloak/login';
```

### 2. Keycloak Callback Handler

```
GET /api/auth-keycloak/callback?code=<AUTH_CODE>&state=<STATE>
```

Automatically called by Keycloak after user logs in. Exchanges authorization code for tokens.

**Flow:**

1. User logs in at Keycloak
2. Keycloak redirects to: `https://apigw-uat.snp.com.vn/doffice-be/api/auth-keycloak/callback?code=...&state=...`
3. Server exchanges code for tokens
4. Tokens stored in session
5. Redirects back to frontend with tokens in URL (optional)

### 3. Get Token Information

```
POST /api/auth-keycloak/token-info
Content-Type: application/json

Response:
{
  "success": true,
  "data": {
    "access_token": "eyJhbGc...",
    "id_token": "eyJhbGc...",
    "expires_at": 1234567890000,
    "user": {
      "userId": "f2d92a70-b3ba-432b-b70b-311e57e11c64",
      "username": "vanthutc01",
      "email": "vault@example.com",
      "name": "Full Name",
      "givenName": "First",
      "familyName": "Last"
    }
  }
}
```

**Auto-Features:**

- Automatically refreshes token if expired
- Returns fresh access_token and id_token for file uploads

### 4. Get Current User Info

```
GET /api/auth-keycloak/user

Response:
{
  "success": true,
  "data": {
    "userId": "f2d92a70-b3ba-432b-b70b-311e57e11c64",
    "username": "vanthutc01",
    "email": "vault@example.com",
    "name": "Full Name"
  }
}
```

### 5. Logout

```
POST /api/auth-keycloak/logout

Response: Redirect to Keycloak logout page
```

---

## Frontend Implementation Example

### Step 1: Login Button

```html
<button onclick="startKeycloakLogin()">Đăng nhập với Keycloak</button>

<script>
  function startKeycloakLogin() {
    // Redirect to backend login endpoint
    window.location.href = '/api/auth-keycloak/login';
  }
</script>
```

### Step 2: Handle Callback (if storing tokens in localStorage)

```javascript
// After return from callback, extract tokens from URL
const params = new URLSearchParams(window.location.search);
const accessToken = params.get('access_token');
const idToken = params.get('id_token');

if (accessToken && idToken) {
  localStorage.setItem('keycloak_access_token', accessToken);
  localStorage.setItem('keycloak_id_token', idToken);
  // Clear URL
  window.history.replaceState({}, document.title, window.location.pathname);
}
```

### Step 3: Get Tokens for API Calls

```javascript
async function getKeycloakTokens() {
  const response = await fetch('/api/auth-keycloak/token-info', {
    method: 'POST',
    credentials: 'include', // Include session cookies
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    if (response.status === 401) {
      window.location.href = '/api/auth-keycloak/login';
      return null;
    }
    throw new Error('Failed to get tokens');
  }

  const data = await response.json();
  return data.data; // Returns { access_token, id_token, user, expires_at }
}
```

### Step 4: Upload File with ID Token

```javascript
async function uploadFileWithKeycloak(file) {
  // Get tokens
  const tokens = await getKeycloakTokens();
  if (!tokens) return;

  const formData = new FormData();
  formData.append('file', file);
  formData.append('id_token', tokens.id_token); // Send ID token to server
  formData.append('user_id', tokens.user.userId);

  const response = await fetch('/api/upload', {
    method: 'POST',
    credentials: 'include',
    headers: {
      Authorization: `Bearer ${tokens.access_token}`, // Use access token
    },
    body: formData,
  });

  return response.json();
}
```

---

## Backend Integration with FileUploadService

### Protect Upload Routes

```javascript
// routes/index.js
const { keycloakAuthRequired, attachKeycloakTokens } = require('../src/auth/keycloakMiddleware');

// Only allow authenticated Keycloak users to upload
router.post('/upload', keycloakAuthRequired, attachKeycloakTokens, uploadController.handleUpload);
```

### Use Keycloak Tokens in FileUploadService

```javascript
// services/FileUploadService.js

async uploadFile(req, res) {
  try {
    // Get Keycloak tokens from request
    const { id_token, access_token } = req.keycloakTokens || {};
    const user = req.keycloakUser || {};

    if (!id_token) {
      return res.status(401).json({ error: 'Keycloak authentication required' });
    }

    // TODO: Use id_token for MinIO authentication
    // ID token contains user identity and can be used to:
    // 1. Verify user identity
    // 2. Create scoped MinIO credentials
    // 3. Log file uploads with user context

    // ... rest of upload logic
  } catch (error) {
    logger.error('Upload error:', error);
    res.status(500).json({ error: error.message });
  }
}
```

---

## Token Details

### ID Token (from Keycloak)

Contains user identity information. Decoded payload example:

```json
{
  "sub": "f2d92a70-b3ba-432b-b70b-311e57e11c64",
  "preferred_username": "vanthutc01",
  "email": "vault@example.com",
  "name": "Full Name",
  "given_name": "First",
  "family_name": "Last",
  "realm_access": {
    "roles": ["user", "offline_access"]
  },
  "exp": 1234567890,
  "iat": 1234567890
}
```

### Access Token (from Keycloak)

Bearer token for API authentication. Use in Authorization header:

```
Authorization: Bearer {access_token}
```

---

## Environment Variables

```env
# Keycloak OAuth2 Configuration
KEYCLOAK_URI=https://iam-uat.snp.com.vn/realms/snp-internal
KEYCLOAK_CLIENT_ID=doffice
KEYCLOAK_CLIENT_SECRET=wKORFQNrraWJk2qO6j6hB1Ae7G82xLyF
KEYCLOAK_REDIRECT_URI=https://apigw-uat.snp.com.vn/doffice-be/api/auth-keycloak/callback
FRONTEND_URL=http://localhost:3000
```

---

## Security Considerations

1. **HTTPS Only**: Always use HTTPS in production
2. **CSRF Protection**: State parameter automatically validated
3. **Secure Cookies**: Session cookies marked as HttpOnly and Secure
4. **Token Expiration**: Access tokens auto-refreshed before expiration
5. **Same-Site Policy**: Cookies use SameSite=Strict

---

## Troubleshooting

### "Not authenticated" response

- User needs to login first: `GET /api/auth-keycloak/login`
- Session may have expired: redirect to login again

### "CSRF token mismatch"

- State parameter validation failed
- Possible cross-site attack or browser cookie issue
- Clear cookies and try again

### Token refresh fails

- Refresh token expired (max 30 days typically)
- User needs to login again

### MinIO uploads fail after Keycloak login

- Ensure `id_token` is sent to upload endpoint
- Verify token is not expired
- Check MinIO policy allows the Keycloak user

---

## API Route Map

```
Authentication:
  GET  /api/auth-keycloak/login           → Start OAuth2 flow
  GET  /api/auth-keycloak/callback        → Handle OAuth2 callback
  POST /api/auth-keycloak/token-info      → Get current tokens
  GET  /api/auth-keycloak/user            → Get current user info
  POST /api/auth-keycloak/logout          → Logout

Protected Routes (require Keycloak auth):
  POST /api/upload                        → Upload file (needs id_token)
  GET  /api/profile                       → User profile
  ... other authenticated endpoints
```
