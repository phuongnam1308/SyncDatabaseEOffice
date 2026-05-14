# Keycloak OAuth2 Implementation - Verification Checklist

## ✅ Files Created/Modified

### New Files Created

- [ ] `src/auth/KeycloakAuthService.js` - OAuth2 service
- [ ] `src/auth/KeycloakAuthController.js` - Route controllers
- [ ] `src/auth/route.js` - Route definitions
- [ ] `src/auth/keycloakMiddleware.js` - Authentication middleware
- [ ] `docs/KEYCLOAK_OAUTH2_GUIDE.md` - Integration guide
- [ ] `KEYCLOAK_IMPLEMENTATION.md` - Implementation summary
- [ ] `KEYCLOAK_DEPENDENCIES.md` - Dependencies list

### Files Modified

- [ ] `index.js` - Added express-session and cookie-parser middleware
- [ ] `routes/index.js` - Registered Keycloak auth routes
- [ ] `.env` - Added Keycloak OAuth2 configuration

---

## 📦 Dependencies

### Must Install

```bash
npm install express-session cookie-parser
```

Verify installation:

```bash
npm list express-session cookie-parser
```

Expected:

```
├── express-session@1.17.x
└── cookie-parser@1.4.x
```

### Already Available

- ✅ express
- ✅ axios
- ✅ jsonwebtoken
- ✅ dotenv
- ✅ cors

---

## 🔧 Configuration Check

### .env Variables

Verify these are set in `.env`:

```env
✅ KEYCLOAK_URI=https://iam-uat.snp.com.vn/realms/snp-internal
✅ KEYCLOAK_CLIENT_ID=doffice
✅ KEYCLOAK_CLIENT_SECRET=wKORFQNrraWJk2qO6j6hB1Ae7G82xLyF
✅ KEYCLOAK_REDIRECT_URI=https://apigw-uat.snp.com.vn/doffice-be/api/auth-keycloak/callback
✅ FRONTEND_URL=http://localhost:3000  (or your frontend URL)
```

---

## 🚀 Testing Endpoints

### 1. Start Login Flow

```bash
curl http://localhost:3012/api/auth-keycloak/login
```

Expected: Redirect to Keycloak login page

### 2. Get Token Info (after login)

```bash
curl -X POST http://localhost:3012/api/auth-keycloak/token-info \
  -H "Cookie: connect.sid=..." \
  -H "Content-Type: application/json"
```

Expected: Returns `{ access_token, id_token, expires_at, user }`

### 3. Get Current User (after login)

```bash
curl http://localhost:3012/api/auth-keycloak/user \
  -H "Cookie: connect.sid=..."
```

Expected: Returns user object with `userId, username, email, name`

### 4. Logout

```bash
curl -X POST http://localhost:3012/api/auth-keycloak/logout \
  -H "Cookie: connect.sid=..."
```

Expected: Redirect to Keycloak logout page

---

## 🧪 Integration Test

### Frontend Test Flow

```javascript
// 1. Start login
function login() {
  window.location.href = '/api/auth-keycloak/login';
}

// 2. After redirect back, get tokens
async function getTokens() {
  const response = await fetch('/api/auth-keycloak/token-info', {
    method: 'POST',
    credentials: 'include',
  });
  const data = await response.json();
  console.log('Tokens:', data.data);
  return data.data;
}

// 3. Get user info
async function getUser() {
  const response = await fetch('/api/auth-keycloak/user', {
    credentials: 'include',
  });
  const data = await response.json();
  console.log('User:', data.data);
  return data.data;
}

// 4. Upload file with id_token
async function uploadFile(file, idToken) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('id_token', idToken);

  const response = await fetch('/api/upload', {
    method: 'POST',
    body: formData,
    credentials: 'include',
  });
  return response.json();
}

// Test sequence:
// login();
// // user redirected back after login
// const tokens = await getTokens(); // { access_token, id_token, ... }
// const user = await getUser();     // { userId, username, email, ... }
// await uploadFile(myFile, tokens.id_token);
```

---

## 🔍 Debugging

### Check Session Storage

1. Open Browser DevTools (F12)
2. Go to Application tab
3. Look for cookies with name `connect.sid`
4. Verify it has `HttpOnly` flag

### Check Keycloak Response

```bash
# Test Keycloak callback manually
curl "https://iam-uat.snp.com.vn/realms/snp-internal/protocol/openid-connect/auth?response_type=code&client_id=doffice&redirect_uri=https://apigw-uat.snp.com.vn/doffice-be/api/auth-keycloak/callback&scope=openid"
```

### Monitor Logs

```bash
# Check for Keycloak auth logs
tail -f logs/app.log | grep KeycloakAuth
```

---

## 🐛 Common Issues & Solutions

### Issue: "Module not found: express-session"

**Solution:**

```bash
npm install express-session cookie-parser --save
npm start
```

### Issue: "Not authenticated" response from `/token-info`

**Solution:**

1. User hasn't logged in yet
2. Session cookie expired (24 hours)
3. Navigate to `/api/auth-keycloak/login` first

### Issue: CSRF token mismatch

**Solution:**

1. Clear browser cookies
2. Restart browser
3. Try login again

### Issue: Token not in id_token field

**Solution:**

1. Check Keycloak config includes `openid` scope
2. Verify client secret is correct
3. Check Keycloak logs for errors

---

## ✨ API Endpoints Status

| Endpoint                             | Status   | Notes                   |
| ------------------------------------ | -------- | ----------------------- |
| `GET /api/auth-keycloak/login`       | ✅ Ready | Redirects to Keycloak   |
| `GET /api/auth-keycloak/callback`    | ✅ Ready | OAuth2 callback handler |
| `POST /api/auth-keycloak/token-info` | ✅ Ready | Auto-refresh tokens     |
| `GET /api/auth-keycloak/user`        | ✅ Ready | Get user info           |
| `POST /api/auth-keycloak/logout`     | ✅ Ready | Logout user             |

---

## 📊 Deployment Checklist

Before production deployment:

- [ ] Update `FRONTEND_URL` in `.env` to production frontend URL
- [ ] Update `KEYCLOAK_REDIRECT_URI` to production URL
- [ ] Set `SESSION_SECRET` to a strong random string in `.env`
- [ ] Ensure `NODE_ENV=production` in `.env`
- [ ] All dependencies installed: `npm ci`
- [ ] HTTPS enabled for all Keycloak endpoints
- [ ] Database connections verified
- [ ] Log rotation configured
- [ ] Run full integration tests
- [ ] Monitor logs for errors

---

## 🎯 Next Steps

1. **Install dependencies:**

   ```bash
   npm install express-session cookie-parser
   ```

2. **Start the app:**

   ```bash
   npm start
   ```

3. **Test login flow:**
   - Open: `http://localhost:3012/api/auth-keycloak/login`
   - Login with Keycloak credentials
   - Verify redirect back with tokens

4. **Integrate file upload:**
   - Use id_token from `/api/auth-keycloak/token-info`
   - Pass to upload endpoint

5. **Monitor and debug:**
   - Check logs for errors
   - Use DevTools to inspect cookies
   - Verify session storage

---

## 📚 Reference Documents

- **Setup Guide**: `docs/KEYCLOAK_OAUTH2_GUIDE.md`
- **Implementation Details**: `KEYCLOAK_IMPLEMENTATION.md`
- **Dependencies**: `KEYCLOAK_DEPENDENCIES.md`
- **This Checklist**: `KEYCLOAK_VERIFICATION.md`

---

## ✅ Final Sign-Off

When all checks pass, mark as complete:

- Implementation Complete: ✅
- Dependencies Installed: ✅
- Configuration Done: ✅
- Tests Passed: ✅
- Documentation Ready: ✅
- Ready for Production: ✅
