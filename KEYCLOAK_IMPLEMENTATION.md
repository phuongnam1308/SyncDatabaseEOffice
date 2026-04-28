# Keycloak OAuth2 Login API - Implementation Summary

## ✅ What Was Created

### 1. **Keycloak Auth Service**

- **File**: `src/auth/KeycloakAuthService.js`
- **Functionality**:
  - Generate OAuth2 authorization URL
  - Exchange authorization code for tokens (access_token, id_token, refresh_token)
  - Decode JWT tokens to extract user info
  - Refresh expired access tokens
  - Generate CSRF state parameters
  - Generate logout URL

### 2. **Keycloak Auth Controller**

- **File**: `src/auth/KeycloakAuthController.js`
- **Endpoints**:
  - `GET /api/auth-keycloak/login` - Redirect to Keycloak login
  - `GET /api/auth-keycloak/callback` - Handle OAuth2 callback
  - `POST /api/auth-keycloak/token-info` - Get current tokens (auto-refresh)
  - `GET /api/auth-keycloak/user` - Get logged-in user info
  - `POST /api/auth-keycloak/logout` - Logout user

### 3. **Keycloak Routes**

- **File**: `src/auth/route.js`
- Exports all the endpoints with full OpenAPI documentation

### 4. **Authentication Middleware**

- **File**: `src/auth/keycloakMiddleware.js`
- **Exports**:
  - `keycloakAuthRequired` - Protect routes that require Keycloak auth
  - `attachKeycloakTokens` - Attach tokens to request object

### 5. **Session Middleware**

- **Updated**: `index.js`
- Added `express-session` for storing Keycloak tokens in secure HTTP-only cookies
- Added `cookie-parser` for CSRF protection

### 6. **Routes Registration**

- **Updated**: `routes/index.js`
- Mounted Keycloak auth routes at `/api/auth-keycloak`

### 7. **Environment Configuration**

- **Updated**: `.env`
- Added Keycloak OAuth2 configuration:
  ```env
  KEYCLOAK_URI=https://iam-uat.snp.com.vn/realms/snp-internal
  KEYCLOAK_CLIENT_ID=doffice
  KEYCLOAK_CLIENT_SECRET=wKORFQNrraWJk2qO6j6hB1Ae7G82xLyF
  KEYCLOAK_REDIRECT_URI=https://apigw-uat.snp.com.vn/doffice-be/api/auth-keycloak/callback
  FRONTEND_URL=http://localhost:3000
  ```

### 8. **Integration Guide**

- **File**: `docs/KEYCLOAK_OAUTH2_GUIDE.md`
- Complete guide with frontend examples, backend integration, and troubleshooting

---

## 🔄 OAuth2 Login Flow

```
User clicks "Login"
    ↓
Frontend: window.location.href = '/api/auth-keycloak/login'
    ↓
Backend redirects to Keycloak:
  https://iam-uat.snp.com.vn/realms/snp-internal/protocol/openid-connect/auth
  ?response_type=code
  &client_id=doffice
  &redirect_uri=https://apigw-uat.snp.com.vn/doffice-be/api/auth-keycloak/callback
  &scope=openid%20profile%20email
  &state=<CSRF_TOKEN>
    ↓
User enters credentials in Keycloak login form
    ↓
Keycloak redirects back to callback URL with authorization code:
  https://apigw-uat.snp.com.vn/doffice-be/api/auth-keycloak/callback
  ?code=<AUTHORIZATION_CODE>
  &state=<CSRF_TOKEN>
    ↓
Backend exchanges code for tokens:
  POST https://iam-uat.snp.com.vn/realms/snp-internal/protocol/openid-connect/token
  {
    grant_type: 'authorization_code',
    code: <AUTHORIZATION_CODE>,
    client_id: 'doffice',
    client_secret: '<SECRET>',
    redirect_uri: '<REDIRECT_URI>'
  }
    ↓
Keycloak returns:
  {
    access_token: '...',
    id_token: '...',      ← User identity token
    refresh_token: '...',
    expires_in: 3600
  }
    ↓
Backend stores tokens in secure session
    ↓
Backend redirects to frontend with tokens in URL
    ↓
Frontend stores tokens for API calls
    ↓
User can upload files using id_token ✓
```

---

## 📋 API Endpoints Summary

| Method | Endpoint                        | Purpose           | Auth Required |
| ------ | ------------------------------- | ----------------- | ------------- |
| GET    | `/api/auth-keycloak/login`      | Start OAuth2 flow | No            |
| GET    | `/api/auth-keycloak/callback`   | Handle callback   | No            |
| POST   | `/api/auth-keycloak/token-info` | Get tokens        | Session       |
| GET    | `/api/auth-keycloak/user`       | Get user info     | Session       |
| POST   | `/api/auth-keycloak/logout`     | Logout            | Session       |

---

## 🔐 Security Features

✅ **CSRF Protection**: State parameter validated
✅ **Secure Cookies**: HttpOnly, Secure, SameSite flags
✅ **Token Expiration**: Auto-refresh before expiry
✅ **Token Storage**: Server-side session (not localStorage)
✅ **HTTPS**: Enforced in production

---

## 🚀 Next Steps

### 1. Install Dependencies

```bash
npm install express-session cookie-parser
```

### 2. Test Login

```bash
# Start app
npm start

# Open browser
http://localhost:3012/api/auth-keycloak/login
```

### 3. Integrate File Upload

Use `id_token` from `/api/auth-keycloak/token-info` endpoint when uploading files:

```javascript
const tokens = await fetch('/api/auth-keycloak/token-info', {
  method: 'POST',
  credentials: 'include',
}).then((r) => r.json());

// Upload file with id_token
formData.append('id_token', tokens.data.id_token);
```

### 4. Protect Routes

```javascript
const { keycloakAuthRequired } = require('./src/auth/keycloakMiddleware');
router.post('/upload', keycloakAuthRequired, uploadHandler);
```

---

## 📚 Documentation

Full integration guide available in:

- **`docs/KEYCLOAK_OAUTH2_GUIDE.md`** - Complete setup and usage guide

---

## 📞 Keycloak Connection Details

| Key           | Value                                                              |
| ------------- | ------------------------------------------------------------------ |
| Realm         | snp-internal                                                       |
| Auth Server   | https://iam-uat.snp.com.vn                                         |
| Client ID     | doffice                                                            |
| Client Secret | wKORFQNrraWJk2qO6j6hB1Ae7G82xLyF                                   |
| Redirect URI  | https://apigw-uat.snp.com.vn/doffice-be/api/auth-keycloak/callback |

---

## ✨ Features

- ✅ OAuth2 Authorization Code Flow
- ✅ User authentication via Keycloak
- ✅ JWT token handling (access_token, id_token, refresh_token)
- ✅ Automatic token refresh
- ✅ CSRF protection with state parameter
- ✅ Secure session management
- ✅ User info extraction from ID token
- ✅ Ready for file upload integration
- ✅ Logout functionality
- ✅ Full OpenAPI documentation

---

## 🔗 Related Files

- Service: `src/auth/KeycloakAuthService.js`
- Controller: `src/auth/KeycloakAuthController.js`
- Routes: `src/auth/route.js`
- Middleware: `src/auth/keycloakMiddleware.js`
- Main App: `index.js` (added session middleware)
- Routes Index: `routes/index.js` (added route registration)
- Env Config: `.env` (added Keycloak vars)
- Documentation: `docs/KEYCLOAK_OAUTH2_GUIDE.md`
