const BaseController = require('../../controllers/BaseController');
const KeycloakAuthService = require('./KeycloakAuthService');
const logger = require('../../utils/logger');

class KeycloakAuthController extends BaseController {
  constructor() {
    super();
  }

  /**
   * GET /api/auth-keycloak/login
   * Redirect user to Keycloak login page
   */
  login = (req, res) => {
    try {
      const state = require('crypto').randomBytes(32).toString('hex');
      const loginUrl = KeycloakAuthService.getLoginUrl(state);

      logger.info('[KeycloakAuthController] Redirecting to Keycloak login:', loginUrl);

      // Store state in session/cookie for CSRF verification
      res.cookie('keycloak_state', state, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 600000, // 10 minutes
      });

      return res.redirect(loginUrl);
    } catch (error) {
      logger.error('[KeycloakAuthController] Login error:', error);
      return this.serverError(res, 'Keycloak login failed', 500, error);
    }
  };

  /**
   * GET /api/auth-keycloak/callback
   * Handle Keycloak callback with authorization code
   */
  callback = this.asyncHandler(async (req, res) => {
    try {
      const { code, state, error, error_description } = req.query;

      // Check for errors from Keycloak
      if (error) {
        logger.warn('[KeycloakAuthController] Keycloak returned error:', error, error_description);
        return this.clientError(res, `Keycloak error: ${error_description || error}`, 400);
      }

      // Verify CSRF token
      const storedState = req.cookies.keycloak_state;
      if (!state || state !== storedState) {
        logger.warn('[KeycloakAuthController] CSRF token mismatch');
        return this.clientError(res, 'Invalid state parameter (CSRF check failed)', 400);
      }

      if (!code) {
        logger.warn('[KeycloakAuthController] Missing authorization code');
        return this.clientError(res, 'Missing authorization code', 400);
      }

      // Exchange authorization code for tokens
      const tokens = await KeycloakAuthService.exchangeCodeForToken(code);

      // Get user information from ID token
      const userInfo = KeycloakAuthService.getUserInfoFromToken(tokens.id_token);

      logger.info('[KeycloakAuthController] User authenticated:', userInfo?.username);

      // Store tokens in session
      req.session.keycloakTokens = {
        access_token: tokens.access_token,
        id_token: tokens.id_token,
        refresh_token: tokens.refresh_token,
        expires_at: tokens.expires_at,
      };

      req.session.user = userInfo;

      // Clear state cookie
      res.clearCookie('keycloak_state');

      // Redirect to frontend with tokens in query or store in secure session
      // Option 1: Redirect with tokens in URL (less secure, but works for SPA)
      const redirectUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/auth/callback?access_token=${tokens.access_token}&id_token=${tokens.id_token}`;

      logger.info('[KeycloakAuthController] Redirecting to frontend callback');
      return res.redirect(redirectUrl);
    } catch (error) {
      logger.error('[KeycloakAuthController] Callback error:', error);
      return this.serverError(res, error.message || 'Keycloak callback failed', 500, error);
    }
  });

  /**
   * POST /api/auth-keycloak/token-info
   * Get token information from session
   */
  getTokenInfo = this.asyncHandler(async (req, res) => {
    try {
      if (!req.session || !req.session.keycloakTokens) {
        return this.clientError(res, 'No active Keycloak session', 401);
      }

      const tokens = req.session.keycloakTokens;
      const userInfo = req.session.user;

      // Check if token needs refresh
      if (!KeycloakAuthService.isTokenValid(tokens.expires_at)) {
        if (tokens.refresh_token) {
          const refreshed = await KeycloakAuthService.refreshAccessToken(tokens.refresh_token);
          req.session.keycloakTokens = {
            ...tokens,
            access_token: refreshed.access_token,
            id_token: refreshed.id_token,
            expires_at: refreshed.expires_at,
          };
          logger.info('[KeycloakAuthController] Token refreshed');
        }
      }

      return this.success(res, {
        access_token: req.session.keycloakTokens.access_token,
        id_token: req.session.keycloakTokens.id_token,
        expires_at: req.session.keycloakTokens.expires_at,
        user: userInfo,
      });
    } catch (error) {
      logger.error('[KeycloakAuthController] Token info error:', error);
      return this.serverError(res, error.message || 'Failed to get token info', 500, error);
    }
  });

  /**
   * POST /api/auth-keycloak/logout
   * Logout user
   */
  logout = this.asyncHandler(async (req, res) => {
    try {
      const logoutUrl = KeycloakAuthService.getLogoutUrl();

      logger.info('[KeycloakAuthController] User logged out');

      // Clear session
      if (req.session) {
        req.session.destroy(() => {
          res.clearCookie('connect.sid'); // or whatever session cookie name you use
          return res.redirect(logoutUrl);
        });
      } else {
        return res.redirect(logoutUrl);
      }
    } catch (error) {
      logger.error('[KeycloakAuthController] Logout error:', error);
      return this.serverError(res, 'Logout failed', 500, error);
    }
  });

  /**
   * GET /api/auth-keycloak/user
   * Get current logged-in user info
   */
  getCurrentUser = this.asyncHandler(async (req, res) => {
    try {
      if (!req.session || !req.session.user) {
        return this.clientError(res, 'Not authenticated', 401);
      }

      return this.success(res, req.session.user);
    } catch (error) {
      logger.error('[KeycloakAuthController] Get current user error:', error);
      return this.serverError(res, 'Failed to get user info', 500, error);
    }
  });
}

module.exports = new KeycloakAuthController();
