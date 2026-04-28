const logger = require('../../utils/logger');
const KeycloakAuthService = require('./KeycloakAuthService');

/**
 * Middleware to check if user has valid Keycloak session
 */
const keycloakAuthRequired = (req, res, next) => {
  try {
    if (!req.session || !req.session.keycloakTokens) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required. Please login with Keycloak first.',
        redirectTo: '/api/auth-keycloak/login',
      });
    }

    // Check if token is still valid
    if (!KeycloakAuthService.isTokenValid(req.session.keycloakTokens.expires_at)) {
      // Try to refresh token
      if (req.session.keycloakTokens.refresh_token) {
        KeycloakAuthService.refreshAccessToken(req.session.keycloakTokens.refresh_token)
          .then((refreshed) => {
            req.session.keycloakTokens = {
              ...req.session.keycloakTokens,
              access_token: refreshed.access_token,
              id_token: refreshed.id_token,
              expires_at: refreshed.expires_at,
            };
            next();
          })
          .catch((err) => {
            logger.warn('[keycloakAuthRequired] Token refresh failed:', err.message);
            res.status(401).json({
              success: false,
              message: 'Session expired. Please login again.',
              redirectTo: '/api/auth-keycloak/login',
            });
          });
      } else {
        return res.status(401).json({
          success: false,
          message: 'Session expired. Please login again.',
          redirectTo: '/api/auth-keycloak/login',
        });
      }
    } else {
      next();
    }
  } catch (error) {
    logger.error('[keycloakAuthRequired] Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Authentication check failed',
    });
  }
};

/**
 * Middleware to attach Keycloak tokens to request for use in API calls
 */
const attachKeycloakTokens = (req, res, next) => {
  if (req.session && req.session.keycloakTokens) {
    req.keycloakTokens = req.session.keycloakTokens;
    req.keycloakUser = req.session.user;
  }
  next();
};

module.exports = {
  keycloakAuthRequired,
  attachKeycloakTokens,
};
