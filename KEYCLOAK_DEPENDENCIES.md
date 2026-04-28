# Required Dependencies for Keycloak OAuth2 Integration

## Install with npm

```bash
npm install express-session cookie-parser jwt-decode
```

## Dependencies Overview

| Package           | Version           | Purpose                                    |
| ----------------- | ----------------- | ------------------------------------------ |
| `express-session` | ^1.17.0+          | Server-side session storage for tokens     |
| `cookie-parser`   | ^1.4.5+           | Parse and handle cookies for CSRF          |
| `jwt-decode`      | ^3.1.0+           | Decode JWT tokens (optional, for frontend) |
| `express`         | already installed | HTTP framework                             |
| `axios`           | already installed | HTTP client for Keycloak API               |
| `jsonwebtoken`    | already installed | JWT handling                               |

## Already Installed

These packages are already in your project:

- ✅ `express` - Core framework
- ✅ `axios` - HTTP calls to Keycloak
- ✅ `jsonwebtoken` - JWT operations
- ✅ `dotenv` - Environment variables
- ✅ `cors` - CORS handling

## Check Installation

```bash
# Verify all dependencies are installed
npm list express-session cookie-parser

# Install missing ones
npm install express-session cookie-parser jwt-decode --save
```

## package.json Update

Add to your package.json if not already present:

```json
{
  "dependencies": {
    "express": "^4.x",
    "express-session": "^1.17.0",
    "cookie-parser": "^1.4.5",
    "jwt-decode": "^3.1.0",
    "axios": "^0.x",
    "jsonwebtoken": "^9.x",
    "dotenv": "^16.x",
    "cors": "^2.x"
  }
}
```

## Optional: Frontend Dependencies

For frontend integration (if needed):

```bash
npm install jwt-decode axios
```

## Troubleshooting

### "Cannot find module 'express-session'"

```bash
npm install express-session cookie-parser
npm list express-session
```

### "Session is not stored"

- Ensure `express-session` is loaded BEFORE routes
- Check in `index.js` that middleware order is correct

### "Cookies not working"

- Ensure `cookie-parser` is loaded after `express-session`
- Check browser DevTools → Application → Cookies

## Verify Installation

Test the installation by running:

```bash
node -e "require('express-session'); require('cookie-parser'); console.log('✓ Dependencies installed successfully')"
```

Expected output:

```
✓ Dependencies installed successfully
```

## Production Deployment

For production, ensure all dependencies are in `package-lock.json`:

```bash
npm ci  # Install exact versions from package-lock.json
```
