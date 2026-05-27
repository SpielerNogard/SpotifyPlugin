/**
 * Spotify Web API Client
 * Handles all Spotify API requests with automatic token refresh
 */

const axios = require('axios');
const querystring = require('querystring');

const SPOTIFY_API_BASE = 'https://api.spotify.com/v1';

class RateLimitError extends Error {
    constructor(until) {
        super(`Rate limited until ${new Date(until).toISOString()}`);
        this.name = 'RateLimitError';
        this.rateLimitedUntil = until;
        this.retryAfterMs = Math.max(0, until - Date.now());
    }
}

class SpotifyAPI {
    constructor(logger, configManager) {
        this.logger = logger;
        this.configManager = configManager;
        this.accessToken = null;
        this.refreshToken = null;
        this.tokenExpiresAt = null;
        this.clientId = null;
        this.clientSecret = null;
        this.rateLimitedUntil = 0;
        this.consecutive429 = 0;
    }

    /**
     * Initialize with config
     */
    init(config) {
        this.clientId = config.clientId;
        this.clientSecret = config.clientSecret;
        this.accessToken = config.accessToken;
        this.refreshToken = config.refreshToken;
        if (config.tokenExpiresAt) {
            this.tokenExpiresAt = new Date(config.tokenExpiresAt);
        }
        this.logger.info('[SpotifyAPI] Initialized');
    }

    /**
     * Set tokens after OAuth
     */
    setTokens(accessToken, refreshToken, expiresIn) {
        this.accessToken = accessToken;
        this.refreshToken = refreshToken;
        this.tokenExpiresAt = new Date(Date.now() + expiresIn * 1000);
        this.logger.info(`[SpotifyAPI] Tokens set, expires at ${this.tokenExpiresAt.toISOString()}`);
    }

    /**
     * Check if tokens are valid
     */
    isAuthenticated() {
        return !!(this.accessToken && this.refreshToken);
    }

    /**
     * Snapshot for UI status display.
     */
    getStatus() {
        return {
            authenticated: this.isAuthenticated(),
            rateLimitedUntil: this.rateLimitedUntil > Date.now() ? this.rateLimitedUntil : 0,
        };
    }

    /**
     * Check if token needs refresh (5 min buffer)
     */
    needsRefresh() {
        if (!this.tokenExpiresAt) return true;
        return Date.now() >= this.tokenExpiresAt.getTime() - 5 * 60 * 1000;
    }

    /**
     * Exponential backoff used when 429 response lacks Retry-After header.
     * Returns seconds, capped at 60s.
     */
    _fallbackBackoff() {
        return Math.min(60, Math.pow(2, this.consecutive429 + 1));
    }

    /**
     * Refresh the access token
     */
    async refreshAccessToken() {
        if (!this.refreshToken || !this.clientId || !this.clientSecret) {
            throw new Error('Missing refresh token or credentials');
        }

        this.logger.info('[SpotifyAPI] Refreshing access token...');

        try {
            const response = await axios.post(
                'https://accounts.spotify.com/api/token',
                querystring.stringify({
                    grant_type: 'refresh_token',
                    refresh_token: this.refreshToken
                }),
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Authorization': 'Basic ' + Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')
                    }
                }
            );

            this.accessToken = response.data.access_token;
            this.tokenExpiresAt = new Date(Date.now() + response.data.expires_in * 1000);
            
            // Some refresh responses include a new refresh token
            if (response.data.refresh_token) {
                this.refreshToken = response.data.refresh_token;
            }

            this.logger.info('[SpotifyAPI] Token refreshed successfully');

            // Save to config
            if (this.configManager) {
                await this.configManager.saveTokens({
                    accessToken: this.accessToken,
                    refreshToken: this.refreshToken,
                    tokenExpiresAt: this.tokenExpiresAt.toISOString()
                });
            }

            return true;
        } catch (err) {
            this.logger.error(`[SpotifyAPI] Token refresh failed: ${err.response?.data?.error_description || err.message}`);
            throw err;
        }
    }

    /**
     * Make an authenticated API request.
     * @param {string} method
     * @param {string} endpoint
     * @param {*} data
     * @param {object} opts
     * @param {boolean} opts.allow204 - if true, returns null on HTTP 204 instead of throwing
     */
    async request(method, endpoint, data = null, opts = {}) {
        // Pre-check: short-circuit during active rate-limit window
        if (this.rateLimitedUntil > Date.now()) {
            throw new RateLimitError(this.rateLimitedUntil);
        }

        // Refresh token if needed
        if (this.needsRefresh()) {
            try {
                await this.refreshAccessToken();
            } catch (err) {
                this.logger.error('[SpotifyAPI] Failed to refresh token, clearing auth');
                this.accessToken = null;
                throw new Error('Authentication expired');
            }
        }

        if (!this.accessToken) {
            throw new Error('Not authenticated');
        }

        try {
            const config = {
                method,
                url: `${SPOTIFY_API_BASE}${endpoint}`,
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`
                }
            };

            if (data) {
                config.data = data;
                config.headers['Content-Type'] = 'application/json';
            }

            const response = await axios(config);

            if (opts.allow204 && response.status === 204) {
                this.consecutive429 = 0;
                return null;
            }

            this.consecutive429 = 0;
            return response.data;
        } catch (err) {
            if (err.response?.status === 401) {
                this.logger.warn('[SpotifyAPI] Got 401, attempting token refresh');
                await this.refreshAccessToken();
                return this.request(method, endpoint, data, opts);
            }
            if (err.response?.status === 403) {
                this.logger.error('[SpotifyAPI] 403 Forbidden - This feature may require Spotify Premium or reauthorization');
                throw new Error('Spotify Premium required or please reconnect your account');
            }
            if (err.response?.status === 429) {
                const headerVal = err.response.headers?.['retry-after'];
                const retryAfterSec = parseInt(headerVal, 10) || this._fallbackBackoff();
                this.rateLimitedUntil = Date.now() + retryAfterSec * 1000;
                this.consecutive429 += 1;
                this.logger.warn(`[SpotifyAPI] 429 from ${endpoint}, backing off ${retryAfterSec}s`);
                throw new RateLimitError(this.rateLimitedUntil);
            }
            if (opts.allow204 && err.response?.status === 204) {
                this.consecutive429 = 0;
                return null;
            }
            throw err;
        }
    }

    /**
     * Get current user profile
     */
    async getCurrentUser() {
        return this.request('GET', '/me');
    }

    /**
     * Get current playback state
     */
    async getCurrentPlayback() {
        try {
            const response = await axios.get(`${SPOTIFY_API_BASE}/me/player`, {
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`
                }
            });
            
            // 204 means no active playback
            if (response.status === 204 || !response.data) {
                return null;
            }
            
            return response.data;
        } catch (err) {
            if (err.response?.status === 401) {
                await this.refreshAccessToken();
                return this.getCurrentPlayback();
            }
            if (err.response?.status === 204) {
                return null;
            }
            throw err;
        }
    }

    /**
     * Start or resume playback
     */
    async play() {
        try {
            await this.request('PUT', '/me/player/play');
            this.logger.info('[SpotifyAPI] Playback started');
        } catch (err) {
            // 404 means no active device
            if (err.response?.status === 404) {
                this.logger.warn('[SpotifyAPI] No active device for playback');
            }
            throw err;
        }
    }

    /**
     * Pause playback
     */
    async pause() {
        try {
            await this.request('PUT', '/me/player/pause');
            this.logger.info('[SpotifyAPI] Playback paused');
        } catch (err) {
            if (err.response?.status === 404) {
                this.logger.warn('[SpotifyAPI] No active device for pause');
            }
            throw err;
        }
    }

    /**
     * Skip to next track
     */
    async next() {
        try {
            await this.request('POST', '/me/player/next');
            this.logger.info('[SpotifyAPI] Skipped to next track');
        } catch (err) {
            if (err.response?.status === 404) {
                this.logger.warn('[SpotifyAPI] No active device for next');
            }
            throw err;
        }
    }

    /**
     * Skip to previous track
     */
    async previous() {
        try {
            await this.request('POST', '/me/player/previous');
            this.logger.info('[SpotifyAPI] Skipped to previous track');
        } catch (err) {
            if (err.response?.status === 404) {
                this.logger.warn('[SpotifyAPI] No active device for previous');
            }
            throw err;
        }
    }

    /**
     * Set shuffle state
     */
    async setShuffle(state) {
        try {
            await this.request('PUT', `/me/player/shuffle?state=${state}`);
            this.logger.info(`[SpotifyAPI] Shuffle set to ${state}`);
        } catch (err) {
            if (err.response?.status === 404) {
                this.logger.warn('[SpotifyAPI] No active device for shuffle');
            }
            throw err;
        }
    }

    /**
     * Set repeat mode: off, context, track
     */
    async setRepeat(state) {
        try {
            await this.request('PUT', `/me/player/repeat?state=${state}`);
            this.logger.info(`[SpotifyAPI] Repeat set to ${state}`);
        } catch (err) {
            if (err.response?.status === 404) {
                this.logger.warn('[SpotifyAPI] No active device for repeat');
            }
            throw err;
        }
    }

    /**
     * Check if tracks are saved in user's library
     */
    async checkSavedTracks(trackIds) {
        const ids = Array.isArray(trackIds) ? trackIds.join(',') : trackIds;
        return this.request('GET', `/me/tracks/contains?ids=${ids}`);
    }

    /**
     * Save tracks to user's library
     */
    async saveTracks(trackIds) {
        const ids = Array.isArray(trackIds) ? trackIds : [trackIds];
        await this.request('PUT', '/me/tracks', { ids });
        this.logger.info(`[SpotifyAPI] Saved ${ids.length} track(s) to library`);
    }

    /**
     * Remove tracks from user's library
     */
    async removeTracks(trackIds) {
        const ids = Array.isArray(trackIds) ? trackIds : [trackIds];
        await this.request('DELETE', '/me/tracks', { ids });
        this.logger.info(`[SpotifyAPI] Removed ${ids.length} track(s) from library`);
    }

    /**
     * Get album art as buffer
     */
    async getAlbumArt(url) {
        if (!url) return null;
        
        try {
            const response = await axios.get(url, {
                responseType: 'arraybuffer'
            });
            return Buffer.from(response.data);
        } catch (err) {
            this.logger.error(`[SpotifyAPI] Failed to fetch album art: ${err.message}`);
            return null;
        }
    }

    /**
     * Clear authentication
     */
    clearAuth() {
        this.accessToken = null;
        this.refreshToken = null;
        this.tokenExpiresAt = null;
        this.consecutive429 = 0;
        this.logger.info('[SpotifyAPI] Authentication cleared');
    }
}

module.exports = SpotifyAPI;
module.exports.SpotifyAPI = SpotifyAPI;
module.exports.RateLimitError = RateLimitError;

