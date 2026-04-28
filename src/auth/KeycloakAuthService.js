const axios = require('axios');
const jwt = require('jsonwebtoken');
const logger = require('../../utils/logger');

class KeycloakAuthService {
  constructor() {
    this.keycloakUri = process.env.KEYCLOAK_URI || 'https://iam-uat.snp.com.vn/realms/snp-internal';
    this.clientId = process.env.KEYCLOAK_CLIENT_ID || 'doffice';
    this.clientSecret = process.env.KEYCLOAK_CLIENT_SECRET || 'wKORFQNrraWJk2qO6j6hB1Ae7G82xLyF';
    this.redirectUri =
      process.env.KEYCLOAK_REDIRECT_URI ||
      'https://apigw-uat.snp.com.vn/doffice-be/api/auth-keycloak/callback';
    this.tokenCache = new Map();
  }

  /**
   * Tạo URL redirect đến Keycloak login
   */
  getLoginUrl(state = '') {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      scope: 'openid profile email',
      state: state || this._generateState(),
    });

    return `${this.keycloakUri}/protocol/openid-connect/auth?${params.toString()}`;
  }

  /**
   * Exchange authorization code for tokens
   */
  async exchangeCodeForToken(authCode) {
    try {
      const tokenUrl = `${this.keycloakUri}/protocol/openid-connect/token`;
      const params = new URLSearchParams();
      params.append('grant_type', 'authorization_code');
      params.append('code', authCode);
      params.append('client_id', this.clientId);
      params.append('client_secret', this.clientSecret);
      params.append('redirect_uri', this.redirectUri);

      logger.info('[KeycloakAuthService] Exchanging authorization code for tokens...');

      const response = await axios.post(tokenUrl, params, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 10000,
      });

      const { access_token, id_token, refresh_token, expires_in } = response.data;

      if (!access_token || !id_token) {
        throw new Error('Missing access_token or id_token from Keycloak response');
      }

      logger.info('[KeycloakAuthService] Successfully exchanged code for tokens');

      return {
        access_token,
        id_token,
        refresh_token,
        expires_in,
        expires_at: Date.now() + expires_in * 1000,
      };
    } catch (error) {
      logger.error('[KeycloakAuthService] Failed to exchange code for tokens:', error.message);
      throw new Error(`Keycloak token exchange failed: ${error.message}`);
    }
  }

  /**
   * Decode JWT token (without verification - for getting user info)
   */
  decodeToken(token) {
    try {
      const decoded = jwt.decode(token);
      return decoded;
    } catch (error) {
      logger.error('[KeycloakAuthService] Failed to decode token:', error.message);
      return null;
    }
  }

  /**
   * Get user info from ID token
   */
  getUserInfoFromToken(idToken) {
    const decoded = this.decodeToken(idToken);
    if (!decoded) {
      return null;
    }

    return {
      userId: decoded.sub,
      username: decoded.preferred_username,
      email: decoded.email,
      name: decoded.name,
      givenName: decoded.given_name,
      familyName: decoded.family_name,
      realmAccess: decoded.realm_access,
    };
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshAccessToken(refreshToken) {
    try {
      const tokenUrl = `${this.keycloakUri}/protocol/openid-connect/token`;
      const params = new URLSearchParams();
      params.append('grant_type', 'refresh_token');
      params.append('refresh_token', refreshToken);
      params.append('client_id', this.clientId);
      params.append('client_secret', this.clientSecret);

      logger.info('[KeycloakAuthService] Refreshing access token...');

      const response = await axios.post(tokenUrl, params, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 10000,
      });

      const { access_token, id_token, expires_in } = response.data;

      logger.info('[KeycloakAuthService] Successfully refreshed access token');

      return {
        access_token,
        id_token,
        expires_in,
        expires_at: Date.now() + expires_in * 1000,
      };
    } catch (error) {
      logger.error('[KeycloakAuthService] Failed to refresh token:', error.message);
      throw new Error(`Keycloak token refresh failed: ${error.message}`);
    }
  }

  /**
   * Verify token is still valid
   */
  isTokenValid(expiresAt) {
    return Date.now() < expiresAt - 60000; // 60 second buffer
  }

  /**
   * Logout từ Keycloak
   */
  getLogoutUrl(redirectUri = '') {
    const params = new URLSearchParams({
      redirect_uri: redirectUri || this.redirectUri,
    });
    return `${this.keycloakUri}/protocol/openid-connect/logout?${params.toString()}`;
  }

  /**
   * Generate random state for CSRF protection
   */
  _generateState() {
    return require('crypto').randomBytes(32).toString('hex');
  }
}

module.exports = new KeycloakAuthService();
