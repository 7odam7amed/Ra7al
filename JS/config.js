/**
 * RAHAAL - Frontend Configuration
 * Manages Base URL and Token storage with dynamic environment variable support.
 */

const CONFIG = {
    // Default Base URL matching the FastAPI backend specification
    DEFAULT_API_BASE_URL: 'http://localhost:8000/api/v1',

    // Key names for localStorage
    STORAGE_KEYS: {
        TOKEN: 'rahaal_access_token',
        USER: 'rahaal_user_data',
        API_BASE_URL: 'rahaal_api_base_url',
        PENDING_PHONE: 'rahaal_pending_otp_phone'
    },

    /**
     * Get active API Base URL.
     * Priority: window.__ENV__.API_BASE_URL -> localStorage -> DEFAULT_API_BASE_URL
     */
    getApiBaseUrl() {
        if (window.__ENV__ && window.__ENV__.API_BASE_URL) {
            return window.__ENV__.API_BASE_URL.replace(/\/+$/, '');
        }
        const savedUrl = localStorage.getItem(this.STORAGE_KEYS.API_BASE_URL);
        if (savedUrl) {
            return savedUrl.replace(/\/+$/, '');
        }
        return this.DEFAULT_API_BASE_URL;
    },

    /**
     * Set custom API Base URL
     */
    setApiBaseUrl(url) {
        if (!url) {
            localStorage.removeItem(this.STORAGE_KEYS.API_BASE_URL);
        } else {
            localStorage.setItem(this.STORAGE_KEYS.API_BASE_URL, url.trim().replace(/\/+$/, ''));
        }
    },

    /**
     * Token management
     */
    getAccessToken() {
        return localStorage.getItem(this.STORAGE_KEYS.TOKEN);
    },

    setAccessToken(token) {
        if (token) {
            localStorage.setItem(this.STORAGE_KEYS.TOKEN, token);
        } else {
            this.clearAccessToken();
        }
    },

    clearAccessToken() {
        localStorage.removeItem(this.STORAGE_KEYS.TOKEN);
        localStorage.removeItem(this.STORAGE_KEYS.USER);
    },

    /**
     * Saved user profile caching
     */
    getCachedUser() {
        try {
            const raw = localStorage.getItem(this.STORAGE_KEYS.USER);
            return raw ? JSON.parse(raw) : null;
        } catch (e) {
            return null;
        }
    },

    setCachedUser(user) {
        if (user) {
            localStorage.setItem(this.STORAGE_KEYS.USER, JSON.stringify(user));
        } else {
            localStorage.removeItem(this.STORAGE_KEYS.USER);
        }
    },

    /**
     * Pending OTP verification phone number
     */
    getPendingPhone() {
        return localStorage.getItem(this.STORAGE_KEYS.PENDING_PHONE);
    },

    setPendingPhone(phone) {
        if (phone) {
            localStorage.setItem(this.STORAGE_KEYS.PENDING_PHONE, phone);
        } else {
            localStorage.removeItem(this.STORAGE_KEYS.PENDING_PHONE);
        }
    }
};

// Expose globally
window.CONFIG = CONFIG;
