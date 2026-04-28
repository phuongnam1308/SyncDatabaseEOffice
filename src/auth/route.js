const express = require('express');
const router = express.Router();
const KeycloakAuthController = require('./KeycloakAuthController');

/**
 * @openapi
 * /api/auth-keycloak/login:
 *   get:
 *     tags: [Keycloak Auth]
 *     summary: Redirect to Keycloak login page
 *     description: Initiates OAuth2 authorization code flow by redirecting to Keycloak
 *     responses:
 *       302:
 *         description: Redirect to Keycloak login page
 */
router.get('/login', KeycloakAuthController.login);

/**
 * @openapi
 * /api/auth-keycloak/callback:
 *   get:
 *     tags: [Keycloak Auth]
 *     summary: Keycloak OAuth2 callback handler
 *     description: Handles authorization code from Keycloak and exchanges it for tokens
 *     parameters:
 *       - in: query
 *         name: code
 *         required: true
 *         schema:
 *           type: string
 *         description: Authorization code from Keycloak
 *       - in: query
 *         name: state
 *         required: true
 *         schema:
 *           type: string
 *         description: State parameter for CSRF protection
 *     responses:
 *       302:
 *         description: Redirect to frontend with tokens
 *       400:
 *         description: Invalid code or state
 */
router.get('/callback', KeycloakAuthController.callback);

/**
 * @openapi
 * /api/auth-keycloak/token-info:
 *   post:
 *     tags: [Keycloak Auth]
 *     summary: Get current token information
 *     description: Returns access token, id_token and user info from session. Auto-refreshes if expired.
 *     responses:
 *       200:
 *         description: Token information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 access_token:
 *                   type: string
 *                 id_token:
 *                   type: string
 *                 expires_at:
 *                   type: number
 *                 user:
 *                   type: object
 *       401:
 *         description: Not authenticated
 */
router.post('/token-info', KeycloakAuthController.getTokenInfo);

/**
 * @openapi
 * /api/auth-keycloak/logout:
 *   post:
 *     tags: [Keycloak Auth]
 *     summary: Logout user
 *     description: Clears session and redirects to Keycloak logout
 *     responses:
 *       302:
 *         description: Redirect to Keycloak logout
 */
router.post('/logout', KeycloakAuthController.logout);

/**
 * @openapi
 * /api/auth-keycloak/user:
 *   get:
 *     tags: [Keycloak Auth]
 *     summary: Get current user info
 *     description: Returns information about the currently logged-in user
 *     responses:
 *       200:
 *         description: User information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 userId:
 *                   type: string
 *                 username:
 *                   type: string
 *                 email:
 *                   type: string
 *                 name:
 *                   type: string
 *       401:
 *         description: Not authenticated
 */
router.get('/user', KeycloakAuthController.getCurrentUser);

module.exports = router;
