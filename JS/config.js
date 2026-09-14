
const CONFIG = {
    DEFAULT_API_BASE_URL: 'https://ra7al-backend-two.vercel.app/api/v1',

    STORAGE_KEYS: {
        TOKEN: 'rahaal_access_token',
        USER: 'rahaal_user_data',
        API_BASE_URL: 'rahaal_api_base_url',
        PENDING_PHONE: 'rahaal_pending_otp_phone'
    },

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

    setApiBaseUrl(url) {
        if (!url) {
            localStorage.removeItem(this.STORAGE_KEYS.API_BASE_URL);
        } else {
            localStorage.setItem(this.STORAGE_KEYS.API_BASE_URL, url.trim().replace(/\/+$/, ''));
        }
    },

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

window.CONFIG = CONFIG;
