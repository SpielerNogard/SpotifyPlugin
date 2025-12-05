/**
 * Canvas Renderer for Spotify Now Playing
 * Uses @napi-rs/canvas to render playback information in Spotify style
 */

const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const path = require('path');
const fs = require('fs');

// Register system fonts for CJK support
function registerSystemFonts(logger) {
    const platform = process.platform;
    const fontPaths = [];

    if (platform === 'win32') {
        // Windows fonts
        const winFonts = path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts');
        fontPaths.push(
            { path: path.join(winFonts, 'msyh.ttc'), family: 'Microsoft YaHei' },
            { path: path.join(winFonts, 'msyhbd.ttc'), family: 'Microsoft YaHei' },
            { path: path.join(winFonts, 'simhei.ttf'), family: 'SimHei' },
            { path: path.join(winFonts, 'simsun.ttc'), family: 'SimSun' },
            { path: path.join(winFonts, 'meiryo.ttc'), family: 'Meiryo' },
            { path: path.join(winFonts, 'yugothic.ttf'), family: 'Yu Gothic' }
        );
    } else if (platform === 'darwin') {
        // macOS fonts
        fontPaths.push(
            { path: '/System/Library/Fonts/PingFang.ttc', family: 'PingFang SC' },
            { path: '/System/Library/Fonts/Hiragino Sans GB.ttc', family: 'Hiragino Sans GB' },
            { path: '/Library/Fonts/Arial Unicode.ttf', family: 'Arial Unicode MS' }
        );
    } else {
        // Linux fonts
        fontPaths.push(
            { path: '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', family: 'Noto Sans CJK' },
            { path: '/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf', family: 'Droid Sans Fallback' }
        );
    }

    let registered = false;
    for (const font of fontPaths) {
        try {
            if (fs.existsSync(font.path)) {
                GlobalFonts.registerFromPath(font.path, font.family);
                logger.info(`[CanvasRenderer] Registered font: ${font.family}`);
                registered = true;
            }
        } catch (err) {
            // Ignore font registration errors
        }
    }

    if (!registered) {
        logger.warn('[CanvasRenderer] No CJK fonts registered, some characters may not render');
    }
}

// Spotify color palette
const COLORS = {
    background: '#121212',
    cardBg: '#181818',
    primary: '#FFFFFF',
    secondary: '#B3B3B3',
    accent: '#1DB954',
    progressBg: '#404040',
    progressFill: '#1DB954'
};

// Default layout constants
const DEFAULT_WIDTH = 600;
const DEFAULT_HEIGHT = 60;

// Font family with CJK fallback
const FONT_FAMILY = 'Microsoft YaHei, PingFang SC, Hiragino Sans GB, SimHei, Noto Sans CJK, Meiryo, Yu Gothic, Arial, sans-serif';

class CanvasRenderer {
    constructor(logger) {
        this.logger = logger;
        this.albumArtCache = new Map();
        this.defaultAlbumArt = null;
        this.fontsRegistered = false;
    }

    /**
     * Ensure fonts are registered (call once)
     */
    ensureFonts() {
        if (!this.fontsRegistered) {
            registerSystemFonts(this.logger);
            this.fontsRegistered = true;
        }
    }

    /**
     * Format time in mm:ss format
     */
    formatTime(ms) {
        if (!ms || ms < 0) return '0:00';
        const totalSeconds = Math.floor(ms / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }

    /**
     * Truncate text to fit width
     */
    truncateText(ctx, text, maxWidth) {
        if (!text) return '';
        
        let truncated = text;
        let width = ctx.measureText(truncated).width;
        
        if (width <= maxWidth) return truncated;
        
        while (width > maxWidth && truncated.length > 0) {
            truncated = truncated.slice(0, -1);
            width = ctx.measureText(truncated + '...').width;
        }
        
        return truncated + '...';
    }

    /**
     * Draw rounded rectangle
     */
    roundRect(ctx, x, y, width, height, radius) {
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.lineTo(x + width - radius, y);
        ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
        ctx.lineTo(x + width, y + height - radius);
        ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
        ctx.lineTo(x + radius, y + height);
        ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
        ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
        ctx.closePath();
    }

    /**
     * Create a default album art placeholder
     */
    async createDefaultAlbumArt(size) {
        const canvas = createCanvas(size, size);
        const ctx = canvas.getContext('2d');

        // Background
        ctx.fillStyle = COLORS.cardBg;
        ctx.fillRect(0, 0, size, size);

        // Music note icon
        ctx.fillStyle = COLORS.secondary;
        ctx.font = `bold ${Math.floor(size * 0.5)}px ${FONT_FAMILY}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('♪', size / 2, size / 2);

        return canvas;
    }

    /**
     * Load album art from URL or cache
     */
    async loadAlbumArt(url, size) {
        if (!url) {
            return this.createDefaultAlbumArt(size);
        }

        // Check cache
        if (this.albumArtCache.has(url)) {
            return this.albumArtCache.get(url);
        }

        try {
            const image = await loadImage(url);
            this.albumArtCache.set(url, image);
            
            // Limit cache size
            if (this.albumArtCache.size > 50) {
                const firstKey = this.albumArtCache.keys().next().value;
                this.albumArtCache.delete(firstKey);
            }
            
            return image;
        } catch (err) {
            this.logger.error(`[CanvasRenderer] Failed to load album art: ${err.message}`);
            return this.createDefaultAlbumArt(size);
        }
    }

    /**
     * Render the now playing widget
     * @param {object} playbackData - Spotify playback data
     * @param {object} options - Render options
     * @param {number} width - Canvas width (from key style)
     * @param {number} height - Canvas height (default 60)
     */
    async render(playbackData, options = {}, width = DEFAULT_WIDTH, height = DEFAULT_HEIGHT) {
        // Ensure CJK fonts are registered
        this.ensureFonts();

        const {
            showTitle = true,
            showArtist = true,
            showAlbum = true,
            showProgress = true
        } = options;

        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');

        // Background
        ctx.fillStyle = COLORS.background;
        ctx.fillRect(0, 0, width, height);

        // If no playback data, show idle state
        if (!playbackData || !playbackData.item) {
            return this.renderIdleState(canvas, ctx, width, height);
        }

        const track = playbackData.item;
        const isPlaying = playbackData.is_playing;
        const progressMs = playbackData.progress_ms || 0;
        const durationMs = track.duration_ms || 0;

        // Album art - full height, no padding
        const albumSize = height;
        const albumImageUrl = track.album?.images?.[0]?.url || 
                             track.album?.images?.[1]?.url || 
                             track.album?.images?.[2]?.url;
        
        try {
            const albumArt = await this.loadAlbumArt(albumImageUrl, albumSize);
            
            // Draw album art - full height
            ctx.drawImage(albumArt, 0, 0, albumSize, albumSize);
        } catch (err) {
            this.logger.error(`[CanvasRenderer] Error drawing album art: ${err.message}`);
        }

        // Text area
        const textPadding = 10;
        const textX = albumSize + textPadding;
        const textMaxWidth = width - textX - textPadding;
        
        // Progress bar at the very bottom
        const progressHeight = 4;
        const progressY = height - progressHeight;
        
        // Font sizes
        const titleFontSize = 18;
        const artistFontSize = 14;
        const albumFontSize = 11;
        const timeFontSize = 11;

        // Album name - top right corner
        if (showAlbum && track.album?.name) {
            ctx.fillStyle = COLORS.secondary;
            ctx.font = `${albumFontSize}px ${FONT_FAMILY}`;
            ctx.textAlign = 'right';
            const album = this.truncateText(ctx, track.album.name, textMaxWidth * 0.5);
            ctx.fillText(album, width - textPadding, 4 + albumFontSize);
            ctx.textAlign = 'left';
        }

        // Track title - top left (after album art)
        if (showTitle && track.name) {
            ctx.fillStyle = COLORS.primary;
            ctx.font = `bold ${titleFontSize}px ${FONT_FAMILY}`;
            // Leave space for album name on the right
            const titleMaxWidth = showAlbum ? textMaxWidth * 0.55 : textMaxWidth;
            const title = this.truncateText(ctx, track.name, titleMaxWidth);
            ctx.fillText(title, textX, 4 + titleFontSize);
        }

        // Artist - below title, moved down a bit more
        if (showArtist && track.artists?.length) {
            ctx.fillStyle = COLORS.secondary;
            ctx.font = `${artistFontSize}px ${FONT_FAMILY}`;
            const artistNames = track.artists.map(a => a.name).join(', ');
            const artist = this.truncateText(ctx, artistNames, textMaxWidth);
            ctx.fillText(artist, textX, 28 + artistFontSize);
        }

        // Progress bar and time
        if (showProgress && durationMs > 0) {
            const progress = Math.min(progressMs / durationMs, 1);
            const progressWidth = width - albumSize;

            // Time label (xx:xx / xx:xx) - right above progress bar
            ctx.fillStyle = COLORS.secondary;
            ctx.font = `${timeFontSize}px ${FONT_FAMILY}`;
            ctx.textAlign = 'right';
            const timeText = `${this.formatTime(progressMs)} / ${this.formatTime(durationMs)}`;
            ctx.fillText(timeText, width - textPadding, progressY - 3);
            ctx.textAlign = 'left';

            // Background track
            ctx.fillStyle = COLORS.progressBg;
            ctx.fillRect(albumSize, progressY, progressWidth, progressHeight);

            // Progress fill
            if (progress > 0) {
                ctx.fillStyle = COLORS.progressFill;
                ctx.fillRect(albumSize, progressY, progressWidth * progress, progressHeight);
            }
        }

        // Play/Pause indicator overlay on album art
        if (!isPlaying) {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
            ctx.fillRect(0, 0, albumSize, albumSize);
            ctx.fillStyle = COLORS.primary;
            ctx.font = `${Math.floor(albumSize * 0.4)}px ${FONT_FAMILY}`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('⏸', albumSize / 2, albumSize / 2);
            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';
        }

        return canvas.toBuffer('image/png');
    }

    /**
     * Render idle state when nothing is playing
     */
    renderIdleState(canvas, ctx, width, height) {
        // Center content
        const centerX = width / 2;
        const centerY = height / 2;
        
        // Spotify icon - larger
        ctx.fillStyle = COLORS.accent;
        ctx.font = `${Math.floor(height * 0.5)}px ${FONT_FAMILY}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('♪', centerX - 60, centerY);
        
        // Text - larger
        ctx.fillStyle = COLORS.secondary;
        ctx.font = `${Math.floor(height * 0.35)}px ${FONT_FAMILY}`;
        ctx.fillText('No active playback', centerX + 50, centerY);

        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';

        return canvas.toBuffer('image/png');
    }

    /**
     * Clear album art cache
     */
    clearCache() {
        this.albumArtCache.clear();
        this.logger.info('[CanvasRenderer] Album art cache cleared');
    }
}

module.exports = CanvasRenderer;
