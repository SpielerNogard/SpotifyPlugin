/**
 * OAuth Server for Spotify Authentication
 * Uses Express to handle OAuth callback
 */

const express = require('express');
const crypto = require('crypto');
const querystring = require('querystring');

const DEFAULT_PORT = 38954; // Use a high port to avoid permission issues
const SCOPES = [
    'user-read-private',
    'user-read-email',
    'user-read-playback-state',
    'user-read-currently-playing',
    'user-modify-playback-state',
    'user-library-read',
    'user-library-modify'
].join(' ');

class OAuthServer {
    constructor(logger) {
        this.logger = logger;
        this.app = null;
        this.server = null;
        this.state = null;
        this.onAuthCallback = null;
    }

    /**
     * Generate a random string for OAuth state
     */
    generateRandomString(length) {
        return crypto.randomBytes(length).toString('hex').slice(0, length);
    }

    /**
     * Get the authorization URL for Spotify OAuth
     */
    getAuthUrl(clientId, redirectUri) {
        this.state = this.generateRandomString(16);
        
        this.logger.info(`[OAuth] Generating auth URL with clientId: ${clientId ? clientId.substring(0, 8) + '...' : 'EMPTY'}`);
        this.logger.info(`[OAuth] redirectUri: ${redirectUri}`);
        
        const authUrl = 'https://accounts.spotify.com/authorize?' + querystring.stringify({
            response_type: 'code',
            client_id: clientId,
            scope: SCOPES,
            redirect_uri: redirectUri,
            state: this.state
        });
        
        this.logger.info(`[OAuth] Generated auth URL with state: ${this.state}`);
        return authUrl;
    }

    /**
     * Start the OAuth server
     */
    start(clientId, clientSecret, redirectUri, onAuthCallback) {
        if (this.server) {
            this.logger.info('[OAuth] Server already running');
            // Return local login URL
            let port = 38954;
            try {
                const url = new URL(redirectUri);
                if (url.port) port = parseInt(url.port, 10);
            } catch (e) {}
            return `http://127.0.0.1:${port}/login`;
        }

        this.onAuthCallback = onAuthCallback;
        this.app = express();

        // Extract callback path from redirectUri
        let callbackPath = '/callback';
        try {
            const url = new URL(redirectUri);
            callbackPath = url.pathname || '/callback';
        } catch (e) {
            this.logger.warn(`[OAuth] Failed to parse redirectUri path, using default: ${callbackPath}`);
        }

        this.logger.info(`[OAuth] Setting up callback endpoint at: ${callbackPath}`);

        // Store auth URL for login redirect
        this.clientId = clientId;
        this.redirectUri = redirectUri;

        // Login endpoint - redirects to Spotify authorization
        this.app.get('/login', (req, res) => {
            const authUrl = this.getAuthUrl(this.clientId, this.redirectUri);
            this.logger.info(`[OAuth] Redirecting to Spotify authorization`);
            res.redirect(authUrl);
        });

        // Callback endpoint - dynamic path based on redirectUri
        this.app.get(callbackPath, async (req, res) => {
            const { code, error, state } = req.query;

            this.logger.info(`[OAuth] Callback received - code: ${code ? 'present' : 'missing'}, error: ${error || 'none'}`);

            if (error) {
                res.send(this.getErrorPage(error));
                return;
            }

            if (!code) {
                res.send(this.getErrorPage('No authorization code received'));
                return;
            }

            // Verify state
            if (state !== this.state) {
                this.logger.warn(`[OAuth] State mismatch: expected ${this.state}, got ${state}`);
                res.send(this.getErrorPage('State mismatch - possible CSRF attack'));
                return;
            }

            try {
                // Exchange code for tokens
                const axios = require('axios');
                const tokenResponse = await axios.post(
                    'https://accounts.spotify.com/api/token',
                    querystring.stringify({
                        grant_type: 'authorization_code',
                        code: code,
                        redirect_uri: redirectUri
                    }),
                    {
                        headers: {
                            'Content-Type': 'application/x-www-form-urlencoded',
                            'Authorization': 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
                        }
                    }
                );

                const { access_token, refresh_token, expires_in } = tokenResponse.data;
                this.logger.info(`[OAuth] Token exchange successful, expires in ${expires_in}s`);

                // Call the callback with tokens
                if (this.onAuthCallback) {
                    await this.onAuthCallback({
                        accessToken: access_token,
                        refreshToken: refresh_token,
                        expiresIn: expires_in
                    });
                }

                res.send(this.getSuccessPage());

                // Stop server after successful auth
                setTimeout(() => this.stop(), 2000);

            } catch (err) {
                this.logger.error(`[OAuth] Token exchange failed: ${err.response?.data?.error_description || err.message}`);
                res.send(this.getErrorPage(err.response?.data?.error_description || err.message));
            }
        });

        // Health check endpoint
        this.app.get('/health', (req, res) => {
            res.json({ status: 'ok' });
        });

        // Extract port from redirectUri
        let port = DEFAULT_PORT;
        try {
            const url = new URL(redirectUri);
            if (url.port) {
                port = parseInt(url.port, 10);
            }
        } catch (e) {
            this.logger.warn(`[OAuth] Failed to parse redirectUri, using default port ${DEFAULT_PORT}`);
        }

        return new Promise((resolve, reject) => {
            try {
                this.server = this.app.listen(port, '127.0.0.1', () => {
                    this.logger.info(`[OAuth] Server started on http://127.0.0.1:${port}`);
                    // Return local login URL instead of Spotify auth URL directly
                    const loginUrl = `http://127.0.0.1:${port}/login`;
                    this.logger.info(`[OAuth] Login URL: ${loginUrl}`);
                    resolve(loginUrl);
                });

                this.server.on('error', (err) => {
                    this.logger.error(`[OAuth] Server error: ${err.message}`);
                    // Clean up on error
                    this.server = null;
                    this.app = null;
                    reject(err);
                });
            } catch (err) {
                this.logger.error(`[OAuth] Failed to start server: ${err.message}`);
                // Clean up on error
                this.server = null;
                this.app = null;
                reject(err);
            }
        });
    }

    /**
     * Stop the OAuth server
     */
    stop() {
        if (this.server) {
            this.server.close(() => {
                this.logger.info('[OAuth] Server stopped');
            });
            this.server = null;
            this.app = null;
        }
    }

    /**
     * Generate success HTML page
     */
    getSuccessPage() {
        return `
<!DOCTYPE html>
<html>
<head>
    <title>Spotify Connected</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #191414;
            color: white;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
        }
        .container {
            text-align: center;
            padding: 40px;
        }
        .icon {
            font-size: 64px;
            color: #1DB954;
            margin-bottom: 20px;
        }
        h1 {
            color: #1DB954;
            margin-bottom: 10px;
        }
        p {
            color: #b3b3b3;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="icon">✓</div>
        <h1>Successfully Connected!</h1>
        <p>You can close this window and return to FlexDesigner.</p>
    </div>
</body>
</html>
        `;
    }

    /**
     * Generate error HTML page
     */
    getErrorPage(error) {
        return `
<!DOCTYPE html>
<html>
<head>
    <title>Connection Failed</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #191414;
            color: white;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
        }
        .container {
            text-align: center;
            padding: 40px;
        }
        .icon {
            font-size: 64px;
            color: #e22134;
            margin-bottom: 20px;
        }
        h1 {
            color: #e22134;
            margin-bottom: 10px;
        }
        p {
            color: #b3b3b3;
        }
        .error {
            background: rgba(226, 33, 52, 0.1);
            padding: 15px;
            border-radius: 8px;
            margin-top: 20px;
            font-family: monospace;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="icon">✗</div>
        <h1>Connection Failed</h1>
        <p>Something went wrong during authentication.</p>
        <div class="error">${error}</div>
    </div>
</body>
</html>
        `;
    }
}

module.exports = OAuthServer;

