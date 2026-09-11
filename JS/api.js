/**
 * RAHAAL - Centralized API Client
 * Full integration with the FastAPI OpenAPI specification
 */

class ApiError extends Error {
    constructor(status, message, details = null, raw = null) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.details = details;
        this.raw = raw;
    }
}

const ApiClient = {
    /**
     * Core Request Engine
     */
    async request(endpoint, options = {}) {
        const baseUrl = window.CONFIG.getApiBaseUrl();
        const url = new URL(endpoint.startsWith('http') ? endpoint : `${baseUrl}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`);

        // Append query parameters if provided
        if (options.params) {
            Object.entries(options.params).forEach(([key, value]) => {
                if (value !== undefined && value !== null && value !== '') {
                    url.searchParams.append(key, value);
                }
            });
        }

        const headers = new Headers(options.headers || {});

        // Inject Bearer Token if available
        const token = window.CONFIG.getAccessToken();
        if (token && !headers.has('Authorization')) {
            headers.set('Authorization', `Bearer ${token}`);
        }

        let body = options.body;

        // Automatically handle JSON or URLSearchParams or FormData
        if (body && typeof body === 'object' && !(body instanceof FormData) && !(body instanceof URLSearchParams)) {
            headers.set('Content-Type', 'application/json');
            body = JSON.stringify(body);
        }

        const fetchConfig = {
            method: options.method || 'GET',
            headers: headers,
            body: body
        };

        let response;
        try {
            response = await fetch(url.toString(), fetchConfig);
        } catch (networkError) {
            console.error('[API Network Error]:', networkError);
            const err = new ApiError(0, 'تعذر الاتصال بالخادم. يرجى التأكد من تشغيل الـ Backend على ' + baseUrl);
            this.handleError(err);
            throw err;
        }

        // Handle 204 No Content
        if (response.status === 204) {
            return null;
        }

        let responseData = null;
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
            try {
                responseData = await response.json();
            } catch (e) {
                responseData = null;
            }
        } else if (contentType.includes('image/') || contentType.includes('application/octet-stream')) {
            responseData = await response.blob();
            return responseData;
        } else {
            responseData = await response.text();
        }

        // Check if response is successful (2xx)
        if (response.ok) {
            return responseData;
        }

        // Format and parse error details
        const parsedMessage = this.extractErrorMessage(response.status, responseData);
        const apiError = new ApiError(response.status, parsedMessage, responseData, responseData);

        // Centralized Error Handling
        this.handleError(apiError);
        throw apiError;
    },

    /**
     * Extract human-readable error messages from FastAPI/Pydantic responses
     */
    extractErrorMessage(status, data) {
        if (!data) {
            switch (status) {
                case 400: return 'طلب غير صالح. يرجى مراجعة البيانات المدخلة.';
                case 401: return 'غير مصرح بالدخول أو انتهت صلاحية الجلسة.';
                case 403: return 'ليس لديك الصلاحيات الكافية للقيام بهذا الإجراء.';
                case 404: return 'العنصر المطلوب غير موجود في النظام.';
                case 409: return 'يوجد تعارض مع بيانات مسجلة مسبقاً.';
                case 422: return 'خطأ في التحقق من صحة البيانات المدخلة.';
                case 429: return 'تم تجاوز الحد المسموح من الطلبات. يرجى الانتظار قليلاً.';
                case 500: return 'حدث خطأ داخلي في الخادم. يرجى المحاولة لاحقاً.';
                default: return `خطأ في الطلب (رمز الحالة: ${status})`;
            }
        }

        if (typeof data === 'string') {
            return data;
        }

        // FastAPI HTTPValidationError: detail can be an array of objects
        if (Array.isArray(data.detail)) {
            return data.detail.map(item => {
                const field = item.loc ? item.loc[item.loc.length - 1] : 'الحقل';
                return `${field}: ${item.msg}`;
            }).join(' | ');
        }

        if (typeof data.detail === 'string') {
            return data.detail;
        }

        if (data.message && typeof data.message === 'string') {
            return data.message;
        }

        return `خطأ في الطلب (رمز الحالة: ${status})`;
    },

    /**
     * Centralized Error Dispatcher
     */
    handleError(error) {
        console.warn(`[API Status ${error.status}]:`, error.message, error.details);

        // Handle 401
        if (error.status === 401) {
            const rawMsg = (error.message || '').toLowerCase();
            const detailStr = typeof error.details?.detail === 'string' ? error.details.detail.toLowerCase() : '';

            // Check if 401 is due to inactive/pending account
            if (rawMsg.includes('pending') || rawMsg.includes('inactive') || rawMsg.includes('not active') || rawMsg.includes('disabled') || rawMsg.includes('approve') || rawMsg.includes('confirm') ||
                detailStr.includes('pending') || detailStr.includes('inactive') || detailStr.includes('not active') || detailStr.includes('disabled') || detailStr.includes('approve')) {
                if (window.showToast) {
                    window.showToast('حسابك قيد المراجعة والاعتماد من قبل إدارة رحال (CEO) أو تم إيقافه.', 'warning');
                }
                return;
            }

            // Normal token expiration or invalid login: clear token and return to guest/login
            const currentToken = window.CONFIG.getAccessToken();
            if (currentToken) {
                window.CONFIG.clearAccessToken();
                if (window.showToast) {
                    window.showToast('انتهت صلاحية جلستك. يرجى تسجيل الدخول مجدداً.', 'error');
                }
                if (typeof window.switchRole === 'function') {
                    window.switchRole('guest');
                    if (typeof window.showLogin === 'function') {
                        window.showLogin();
                    }
                }
            } else {
                if (window.showToast) {
                    window.showToast(error.message || 'بيانات الدخول غير صحيحة أو الحساب بانتظار اعتماد الـ CEO.', 'error');
                }
            }
            return;
        }

        // Handle other standard codes with toasts if available
        if (window.showToast) {
            if (error.status === 403) {
                window.showToast('صلاحية غير مسموحة: ' + error.message, 'error');
            } else if (error.status === 429) {
                window.showToast('تجاوزت الحد المسموح: ' + error.message, 'error');
            } else if (error.status === 422) {
                window.showToast('بيانات غير صحيحة: ' + error.message, 'error');
            } else if (error.status >= 500) {
                window.showToast('خطأ في السيرفر: ' + error.message, 'error');
            }
        }
    }
};

/**
 * ============================================================
 * DOMAIN-SPECIFIC API SERVICES
 * ============================================================
 */

// 1. AUTHENTICATION & REGISTRATION
const authApi = {
    /**
     * POST /api/v1/auth/upload-id-card
     * Upload student ID card file (multipart/form-data)
     */
    async uploadIdCard(file) {
        const formData = new FormData();
        formData.append('file', file);
        return ApiClient.request('/auth/upload-id-card', {
            method: 'POST',
            body: formData
        });
    },

    /**
     * POST /api/v1/auth/register
     * Register a new student account
     */
    async register(data) {
        return ApiClient.request('/auth/register', {
            method: 'POST',
            body: data
        });
    },

    /**
     * POST /api/v1/auth/verify-otp
     * Verify WhatsApp OTP code
     */
    async verifyOtp(phoneNumber, otpCode) {
        return ApiClient.request('/auth/verify-otp', {
            method: 'POST',
            body: {
                phone_number: phoneNumber,
                otp_code: otpCode
            }
        });
    },

    /**
     * POST /api/v1/auth/resend-otp
     * Request a new OTP
     */
    async resendOtp(phoneNumber) {
        return ApiClient.request('/auth/resend-otp', {
            method: 'POST',
            body: {
                phone_number: phoneNumber
            }
        });
    },

    /**
     * POST /api/v1/auth/login
     * OAuth2 Password form login
     */
    async login(username, password) {
        const params = new URLSearchParams();
        params.append('username', username.trim());
        params.append('password', password);
        params.append('grant_type', 'password');

        return ApiClient.request('/auth/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: params
        });
    },

    /**
     * GET /api/v1/auth/me
     * Retrieve currently authenticated user profile
     */
    async getMe() {
        return ApiClient.request('/auth/me');
    }
};

// 2. USERS MANAGEMENT (CEO)
const usersApi = {
    async list(params = {}) {
        return ApiClient.request('/users', { params });
    },
    async createSupervisor(data) {
        return ApiClient.request('/users/supervisors', {
            method: 'POST',
            body: data
        });
    },
    async getById(userId) {
        return ApiClient.request(`/users/${userId}`);
    },
    async update(userId, data) {
        return ApiClient.request(`/users/${userId}`, {
            method: 'PATCH',
            body: data
        });
    },
    async updateRole(userId, role) {
        return ApiClient.request(`/users/${userId}/role`, {
            method: 'PATCH',
            body: { role }
        });
    },
    async updateStatus(userId, isActive) {
        return ApiClient.request(`/users/${userId}/status`, {
            method: 'PATCH',
            body: { is_active: isActive }
        });
    },
    async confirmUser(userId) {
        return this.updateStatus(userId, true);
    },
    async rejectUser(userId) {
        return this.updateStatus(userId, false);
    },
    async getIdCard(userId) {
        return ApiClient.request(`/users/${userId}/id-card`);
    }
};

// 3. UNIVERSITIES
const universitiesApi = {
    async list(params = {}) {
        return ApiClient.request('/universities', { params });
    },
    async getById(universityId) {
        return ApiClient.request(`/universities/${universityId}`);
    },
    async create(data) {
        return ApiClient.request('/universities', {
            method: 'POST',
            body: data
        });
    },
    async update(universityId, data) {
        return ApiClient.request(`/universities/${universityId}`, {
            method: 'PATCH',
            body: data
        });
    },
    async delete(universityId) {
        return ApiClient.request(`/universities/${universityId}`, {
            method: 'DELETE'
        });
    }
};

// 4. BUSES FLEET
const busesApi = {
    async list(params = {}) {
        return ApiClient.request('/buses', { params });
    },
    async getById(busId) {
        return ApiClient.request(`/buses/${busId}`);
    },
    async create(data) {
        return ApiClient.request('/buses', {
            method: 'POST',
            body: data
        });
    },
    async update(busId, data) {
        return ApiClient.request(`/buses/${busId}`, {
            method: 'PATCH',
            body: data
        });
    },
    async updateStatus(busId, status) {
        return ApiClient.request(`/buses/${busId}/status`, {
            method: 'PATCH',
            body: { status }
        });
    },
    async delete(busId) {
        return ApiClient.request(`/buses/${busId}`, {
            method: 'DELETE'
        });
    }
};

// 5. STATIONS / GATHERINGS
const stationsApi = {
    async list(params = {}) {
        return ApiClient.request('/stations', { params });
    },
    async getById(stationId) {
        return ApiClient.request(`/stations/${stationId}`);
    },
    async create(data) {
        return ApiClient.request('/stations', {
            method: 'POST',
            body: data
        });
    },
    async update(stationId, data) {
        return ApiClient.request(`/stations/${stationId}`, {
            method: 'PATCH',
            body: data
        });
    },
    async updateStatus(stationId, isActive) {
        return ApiClient.request(`/stations/${stationId}/status`, {
            method: 'PATCH',
            body: { is_active: isActive }
        });
    },
    async delete(stationId) {
        return ApiClient.request(`/stations/${stationId}`, {
            method: 'DELETE'
        });
    }
};

// 6. ROUTES & STOPS
const routesApi = {
    async list(params = {}) {
        return ApiClient.request('/routes', { params });
    },
    async getById(routeId) {
        return ApiClient.request(`/routes/${routeId}`);
    },
    async create(data) {
        return ApiClient.request('/routes', {
            method: 'POST',
            body: data
        });
    },
    async update(routeId, data) {
        return ApiClient.request(`/routes/${routeId}`, {
            method: 'PATCH',
            body: data
        });
    },
    async updateStatus(routeId, isActive) {
        return ApiClient.request(`/routes/${routeId}/status`, {
            method: 'PATCH',
            body: { is_active: isActive }
        });
    },
    async assignSupervisor(routeId, supervisorId) {
        return ApiClient.request(`/routes/${routeId}/supervisor`, {
            method: 'PATCH',
            body: { supervisor_id: supervisorId }
        });
    },
    async delete(routeId) {
        return ApiClient.request(`/routes/${routeId}`, {
            method: 'DELETE'
        });
    },
    // Intermediate Stops
    async getStops(routeId) {
        return ApiClient.request(`/routes/${routeId}/stops`);
    },
    async addStop(routeId, data) {
        return ApiClient.request(`/routes/${routeId}/stops`, {
            method: 'POST',
            body: data
        });
    },
    async reorderStops(routeId, stopsArray) {
        return ApiClient.request(`/routes/${routeId}/stops/reorder`, {
            method: 'PATCH',
            body: { stops: stopsArray }
        });
    },
    async updateStop(routeId, routeStopId, stopOrder) {
        return ApiClient.request(`/routes/${routeId}/stops/${routeStopId}`, {
            method: 'PATCH',
            body: { stop_order: stopOrder }
        });
    },
    async removeStop(routeId, routeStopId) {
        return ApiClient.request(`/routes/${routeId}/stops/${routeStopId}`, {
            method: 'DELETE'
        });
    }
};

// 7. TRIPS & PICKUP POINTS
const tripsApi = {
    async list(params = {}) {
        return ApiClient.request('/trips', { params });
    },
    async getById(tripId) {
        return ApiClient.request(`/trips/${tripId}`);
    },
    async create(data) {
        return ApiClient.request('/trips', {
            method: 'POST',
            body: data
        });
    },
    async update(tripId, data) {
        return ApiClient.request(`/trips/${tripId}`, {
            method: 'PATCH',
            body: data
        });
    },
    async updateStatus(tripId, status) {
        return ApiClient.request(`/trips/${tripId}/status`, {
            method: 'PATCH',
            body: { status }
        });
    },
    async delete(tripId) {
        return ApiClient.request(`/trips/${tripId}`, {
            method: 'DELETE'
        });
    },
    // Pickup Points on Trip
    async listPickupPoints(tripId) {
        return ApiClient.request(`/trips/${tripId}/pickup-points`);
    },
    async addPickupPoint(tripId, data) {
        return ApiClient.request(`/trips/${tripId}/pickup-points`, {
            method: 'POST',
            body: data
        });
    },
    async updatePickupPoint(tripId, pointId, data) {
        return ApiClient.request(`/trips/${tripId}/pickup-points/${pointId}`, {
            method: 'PATCH',
            body: data
        });
    },
    async deletePickupPoint(tripId, pointId) {
        return ApiClient.request(`/trips/${tripId}/pickup-points/${pointId}`, {
            method: 'DELETE'
        });
    }
};

// 8. RESERVATIONS / BOOKINGS
const reservationsApi = {
    async book(tripId) {
        return ApiClient.request('/reservations', {
            method: 'POST',
            body: { trip_id: tripId }
        });
    },
    async listAdmin(params = {}) {
        return ApiClient.request('/reservations', { params });
    },
    async listAvailableTrips(params = {}) {
        return ApiClient.request('/reservations/available-trips', { params });
    },
    async listMy(params = {}) {
        return ApiClient.request('/reservations/my', { params });
    },
    async getById(reservationId) {
        return ApiClient.request(`/reservations/${reservationId}`);
    },
    async cancel(reservationId) {
        return ApiClient.request(`/reservations/${reservationId}/cancel`, {
            method: 'PATCH'
        });
    }
};

// 9. PAYMENTS
const paymentsApi = {
    async create(data) {
        return ApiClient.request('/payments', {
            method: 'POST',
            body: data
        });
    },
    async listAdmin(params = {}) {
        return ApiClient.request('/payments', { params });
    },
    async listMy(params = {}) {
        return ApiClient.request('/payments/my', { params });
    },
    async getById(paymentId) {
        return ApiClient.request(`/payments/${paymentId}`);
    },
    async submitProof(paymentId, data) {
        return ApiClient.request(`/payments/${paymentId}/submit`, {
            method: 'PATCH',
            body: data
        });
    },
    async cancel(paymentId) {
        return ApiClient.request(`/payments/${paymentId}/cancel`, {
            method: 'PATCH'
        });
    },
    async verify(paymentId) {
        return ApiClient.request(`/payments/${paymentId}/verify`, {
            method: 'PATCH'
        });
    },
    async reject(paymentId, rejectionReason = '') {
        return ApiClient.request(`/payments/${paymentId}/reject`, {
            method: 'PATCH',
            body: { rejection_reason: rejectionReason }
        });
    }
};

// 10. SUBSCRIPTION PLANS
const subscriptionPlansApi = {
    async listAdmin(params = {}) {
        return ApiClient.request('/subscription-plans', { params });
    },
    async listAvailable() {
        return ApiClient.request('/subscriptions/plans');
    },
    async getById(planId) {
        return ApiClient.request(`/subscription-plans/${planId}`);
    },
    async create(data) {
        return ApiClient.request('/subscription-plans', {
            method: 'POST',
            body: data
        });
    },
    async update(planId, data) {
        return ApiClient.request(`/subscription-plans/${planId}`, {
            method: 'PATCH',
            body: data
        });
    },
    async updateStatus(planId, isActive) {
        return ApiClient.request(`/subscription-plans/${planId}/status`, {
            method: 'PATCH',
            body: { is_active: isActive }
        });
    }
};

// 11. SUBSCRIPTIONS
const subscriptionsApi = {
    async create(data) {
        return ApiClient.request('/subscriptions', {
            method: 'POST',
            body: data
        });
    },
    async listAll(params = {}) {
        return ApiClient.request('/subscriptions', { params });
    },
    async listMy(params = {}) {
        return ApiClient.request('/subscriptions/my', { params });
    },
    async getById(subscriptionId) {
        return ApiClient.request(`/subscriptions/${subscriptionId}`);
    },
    async getQr(subscriptionId) {
        return ApiClient.request(`/subscriptions/${subscriptionId}/qr`);
    },
    async getHistory(subscriptionId, params = {}) {
        return ApiClient.request(`/subscriptions/${subscriptionId}/history`, { params });
    },
    async cancel(subscriptionId) {
        return ApiClient.request(`/subscriptions/${subscriptionId}/cancel`, {
            method: 'PATCH'
        });
    }
};

// 12. BOARDING & QR SCANNING
const boardingApi = {
    async scan(data) {
        return ApiClient.request('/boarding/scan', {
            method: 'POST',
            body: data
        });
    },
    async getTripStudents(tripId) {
        return ApiClient.request(`/boarding/trips/${tripId}/students`);
    },
    async getTripRecords(tripId) {
        return ApiClient.request(`/boarding/trips/${tripId}/records`);
    },
    async listAllRecords(params = {}) {
        return ApiClient.request('/boarding/records', { params });
    }
};

// Expose all domain APIs to the global window
window.ApiClient = ApiClient;
window.authApi = authApi;
window.usersApi = usersApi;
window.universitiesApi = universitiesApi;
window.busesApi = busesApi;
window.stationsApi = stationsApi;
window.routesApi = routesApi;
window.tripsApi = tripsApi;
window.reservationsApi = reservationsApi;
window.paymentsApi = paymentsApi;
window.subscriptionPlansApi = subscriptionPlansApi;
window.subscriptionsApi = subscriptionsApi;
window.boardingApi = boardingApi;
