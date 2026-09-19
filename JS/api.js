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

/**
 * Centralized Egyptian Phone Normalizer
 * Normalizes common Egyptian phone numbers to E.164 (+20XXXXXXXXXX) format.
 * Prevents double-prefixing (+2020..., +20+20...).
 *
 * Supported inputs:
 *  - 01012345678      -> +201012345678
 *  - 201012345678     -> +201012345678
 *  - +201012345678    -> +201012345678
 *  - +20 101 234 5678 -> +201012345678
 *  - 010 1234 5678    -> +201012345678
 *  - 00201012345678   -> +201012345678
 *  - 1012345678       -> +201012345678
 */
function normalizePhoneNumber(phone) {
    if (!phone || typeof phone !== 'string') return phone;

    // Convert Arabic-Indic numerals to Latin digits
    const arabicIndicDigits = ['٠','١','٢','٣','٤','٥','٦','٧','٨','٩'];
    let str = phone.replace(/[٠-٩]/g, d => arabicIndicDigits.indexOf(d));

    // Strip whitespace, dashes, parentheses, dots
    str = str.replace(/[\s\-\(\)\.]/g, '').trim();

    // Prevent duplicate prefixes (e.g. +20+20..., +20201..., 20201...)
    while (str.startsWith('+20+20')) str = '+20' + str.slice(6);
    while (str.startsWith('+20201')) str = '+20' + str.slice(5);
    while (str.startsWith('20201')) str = '20' + str.slice(4);

    // If starts with 0020..., convert 00 to +
    if (str.startsWith('0020')) str = '+' + str.slice(2);

    // If starts with +20:
    if (str.startsWith('+20')) {
        const after20 = str.slice(3);
        // If user typed +20010..., remove the extraneous 0 after +20
        if (after20.startsWith('0') && after20.length === 11) {
            return '+20' + after20.slice(1);
        }
        return str;
    }

    // If starts with 20 (without +):
    if (str.startsWith('20')) {
        const after20 = str.slice(2);
        // If user typed 20010... (20 + 010...), remove the extraneous 0
        if (after20.startsWith('0') && after20.length === 11) {
            return '+20' + after20.slice(1);
        }
        // If 20 followed by Egyptian mobile prefix (10, 11, 12, 15) and 8 digits
        if (/^1[0125][0-9]{8}$/.test(after20)) {
            return '+20' + after20;
        }
        // If 20 + other digit sequence
        if (/^[0-9]{9,13}$/.test(after20)) {
            return '+' + str;
        }
    }

    // If starts with 01 (standard local 11 digits: 010, 011, 012, 015)
    if (/^01[0125][0-9]{8}$/.test(str)) {
        return '+20' + str.slice(1);
    }

    // If 10 digits starting with 10, 11, 12, 15 (omitted leading 0)
    if (/^1[0125][0-9]{8}$/.test(str)) {
        return '+20' + str;
    }

    // Any other number starting with +: keep as is
    if (str.startsWith('+')) return str;

    // Return string as-is for malformed inputs to be handled by backend/validation
    return str;
}

const ApiClient = {
    normalizePhoneNumber,

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

        // Surface rate-limit window (ERRORS.md §5: honor Retry-After seconds)
        const retryAfterHeader = response.headers.get('Retry-After');
        if (retryAfterHeader) {
            const parsedRetry = parseInt(retryAfterHeader, 10);
            apiError.retryAfterSeconds = Number.isFinite(parsedRetry) ? parsedRetry : null;
        }

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

        // Handle other standard codes with toasts if available (ERRORS.md §6)
        if (window.showToast) {
            if (error.status === 403) {
                // Backend detail messages are user-appropriate (RBAC.md §5): pending / rejected / not assigned...
                window.showToast(error.message || 'ليس لديك الصلاحيات الكافية للقيام بهذا الإجراء.', 'error');
            } else if (error.status === 404) {
                window.showToast(error.message || 'العنصر المطلوب غير موجود.', 'error');
            } else if (error.status === 409) {
                window.showToast(error.message || 'يوجد تعارض مع بيانات مسجلة مسبقاً.', 'error');
            } else if (error.status === 422) {
                window.showToast(error.message || 'بيانات غير صحيحة.', 'error');
            } else if (error.status === 429) {
                const retryInfo = error.retryAfterSeconds ? ` (أعد المحاولة بعد ${error.retryAfterSeconds} ثانية)` : '';
                window.showToast('تجاوزت الحد المسموح من الطلبات' + retryInfo + '.', 'error');
            } else if (error.status >= 500) {
                window.showToast('خطأ في السيرفر: ' + error.message, 'error');
            }
        }
    },

    /**
     * Fetch an authorized binary resource (e.g. bus/ID-card images) as a Blob.
     * The Authorization header is attached, so the result must be used via
     * URL.createObjectURL() — never through a plain <img src>.
     */
    async requestBlob(endpoint) {
        const baseUrl = window.CONFIG.getApiBaseUrl();
        const url = new URL(`${baseUrl}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`);

        const headers = new Headers();
        const token = window.CONFIG.getAccessToken();
        if (token) {
            headers.set('Authorization', `Bearer ${token}`);
        }

        let response;
        try {
            response = await fetch(url.toString(), { method: 'GET', headers });
        } catch (networkError) {
            throw new ApiError(0, 'تعذر الاتصال بالخادم.');
        }

        if (!response.ok) {
            let errorData = null;
            const contentType = response.headers.get('content-type') || '';
            if (contentType.includes('application/json')) {
                try { errorData = await response.json(); } catch (e) { errorData = null; }
            }
            const err = new ApiError(response.status, this.extractErrorMessage(response.status, errorData), errorData, errorData);
            this.handleError(err);
            throw err;
        }

        return await response.blob();
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
        const payload = data ? { ...data } : {};
        if (payload.phone_number) {
            payload.phone_number = normalizePhoneNumber(payload.phone_number);
        }
        return ApiClient.request('/auth/register', {
            method: 'POST',
            body: payload
        });
    },

    /**
     * POST /api/v1/auth/login
     * OAuth2 Password form login
     */
    async login(username, password) {
        const params = new URLSearchParams();
        const normalizedPhone = normalizePhoneNumber(username);
        params.append('username', normalizedPhone);
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
    async listPending(params = {}) {
        return ApiClient.request('/users/pending', { params });
    },
    async createSupervisor(data) {
        const payload = data ? { ...data } : {};
        if (payload.phone_number) {
            payload.phone_number = normalizePhoneNumber(payload.phone_number);
        }
        return ApiClient.request('/users/supervisors', {
            method: 'POST',
            body: payload
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
    /**
     * PATCH /users/{user_id}/status — CEO.
     * Body must contain at least one of is_active / status.
     * NOTE: do NOT send "ACTIVE" — it is a legacy input alias only (ENUMS.md);
     * the API always returns APPROVED.
     */
    async updateStatus(userId, isActive) {
        return ApiClient.request(`/users/${userId}/status`, {
            method: 'PATCH',
            body: { is_active: Boolean(isActive) }
        });
    },
    async approve(userId) {
        return ApiClient.request(`/users/${userId}/approve`, {
            method: 'PATCH'
        });
    },
    async reject(userId, reason = '') {
        return ApiClient.request(`/users/${userId}/reject`, {
            method: 'PATCH',
            body: reason ? { reason } : {}
        });
    },
    /**
     * GET /users/{user_id}/id-card — streams image bytes (CEO / owner student).
     */
    async getIdCard(userId) {
        return ApiClient.requestBlob(`/users/${userId}/id-card`);
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
    /**
     * POST /buses — CEO. JSON (no image) or multipart/form-data (with image,
     * field "image"). Never send a bus image as base64 JSON (FILE_UPLOADS.md).
     */
    async create(data, imageFile = null) {
        if (imageFile) {
            const formData = new FormData();
            Object.entries(data).forEach(([key, value]) => {
                if (value !== undefined && value !== null && value !== '') {
                    formData.append(key, String(value));
                }
            });
            formData.append('image', imageFile);
            return ApiClient.request('/buses', {
                method: 'POST',
                body: formData
            });
        }
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
    },
    async getImageMetadata(busId) {
        return ApiClient.request(`/buses/${busId}/image/metadata`);
    },
    /**
     * GET /buses/{bus_id}/image — streams authorized bytes as a Blob.
     * Access: CEO any bus, assigned supervisor, or student with a CONFIRMED
     * reservation on a trip using this bus (RBAC.md §4).
     */
    async getImage(busId) {
        return ApiClient.requestBlob(`/buses/${busId}/image`);
    },
    async updateImage(busId, file) {
        const formData = new FormData();
        formData.append('image', file);
        return ApiClient.request(`/buses/${busId}/image`, {
            method: 'PATCH',
            body: formData
        });
    },
    async deleteImage(busId) {
        return ApiClient.request(`/buses/${busId}/image`, {
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

// 6. ROUTES & PICKUP POINTS (ROUTES.md: a route is a logical container of
// pickup points — no origin/destination/distance/duration/supervisor, and
// RouteStop no longer exists).
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
    async delete(routeId) {
        return ApiClient.request(`/routes/${routeId}`, {
            method: 'DELETE'
        });
    },
    // Pickup points live under a route (exactly one route per point,
    // no latitude/longitude — PickupPointResponse).
    async listPickupPoints(routeId) {
        return ApiClient.request(`/routes/${routeId}/pickup-points`);
    },
    async addPickupPoint(routeId, data) {
        return ApiClient.request(`/routes/${routeId}/pickup-points`, {
            method: 'POST',
            body: data
        });
    },
    async updatePickupPoint(routeId, pointId, data) {
        return ApiClient.request(`/routes/${routeId}/pickup-points/${pointId}`, {
            method: 'PATCH',
            body: data
        });
    },
    async deletePickupPoint(routeId, pointId) {
        return ApiClient.request(`/routes/${routeId}/pickup-points/${pointId}`, {
            method: 'DELETE'
        });
    }
};

// 7. TRIPS & TRIP STOPS (TRIPS.md: one direction per trip, no fare; trip
// times are DERIVED from the ordered stops).
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
    // Route's registered pickup points (step 2 of trip creation — CEO).
    async getRoutePoints(routeId) {
        return ApiClient.request(`/trips/route-points/${routeId}`);
    },
    // Ordered stops of a trip (TripStopResponse[]).
    async listStops(tripId) {
        return ApiClient.request(`/trips/${tripId}/stops`);
    },
    /**
     * Fetch the pickup points of the trip's route (GET /trips/route-points/{route_id}).
     * Used by the supervisor scan form: the scan's pickup_point_id must be one of
     * the trip's stops and must match the student's selected point, so the
     * selectable options come from the trip's own route — never a hardcoded list.
     */
    async listTripPickupPoints(tripId) {
        const trip = await ApiClient.request(`/trips/${tripId}`);
        const routeId = trip?.route_id ?? trip?.route?.id;
        if (!routeId) return [];
        const route = await ApiClient.request(`/trips/route-points/${routeId}`);
        return Array.isArray(route?.pickup_points) ? route.pickup_points : [];
    },
    // Replace the trip's ordered stop sequence: { stops: [...] }.
    async updateStops(tripId, stopsArray) {
        return ApiClient.request(`/trips/${tripId}/stops`, {
            method: 'PATCH',
            body: { stops: stopsArray }
        });
    }
};

// 8. RESERVATIONS / DAILY TRANSPORTATION (RESERVATIONS.md: one directed
// booking per row — one student + one trip (one direction) + one service
// date; max one OUTBOUND + one RETURN per student per service date).
const reservationsApi = {
    /**
     * POST /reservations — book a trip seat.
     * Body: { trip_id, selected_pickup_point_id, service_date? }
     * The pickup point is the boarding point for OUTBOUND trips and the
     * drop-off point for RETURN trips; it must be one of the trip's stops.
     * service_date is OPTIONAL: defaults to TOMORROW server-side; direction
     * is derived from the trip (client cannot choose it).
     */
    async book(data) {
        return ApiClient.request('/reservations', {
            method: 'POST',
            body: data
        });
    },
    /**
     * GET /reservations/upcoming-trips — ALL upcoming SCHEDULED trips for the
     * student (StudentTripViewResponse[] with booking_state AVAILABLE/BOOKED/FULL).
     */
    async listUpcomingTrips(params = {}) {
        return ApiClient.request('/reservations/upcoming-trips', { params });
    },
    /**
     * GET /reservations/my/selection — the student's bookings for a date
     * (defaults to TOMORROW; up to two: one OUTBOUND + one RETURN).
     */
    async getMySelection(params = {}) {
        return ApiClient.request('/reservations/my/selection', { params });
    },
    /**
     * PUT /reservations/my/selection — replace the student's existing booking
     * in the SAME direction as the new trip for the resolved service date
     * (same body as POST). Response: ReservationResponse.
     */
    async updateMySelection(data) {
        return ApiClient.request('/reservations/my/selection', {
            method: 'PUT',
            body: data
        });
    },
    async listAdmin(params = {}) {
        return ApiClient.request('/reservations', { params });
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

// 9. PAYMENTS (PAYMENTS.md: payments are created automatically with each
// subscription request; POST /payments is retired — always 422. Digital
// methods require BOTH a transaction reference AND a receipt image before
// verification).
const paymentsApi = {
    async listAdmin(params = {}) {
        return ApiClient.request('/payments', { params });
    },
    async listMy(params = {}) {
        return ApiClient.request('/payments/my', { params });
    },
    async getById(paymentId) {
        return ApiClient.request(`/payments/${paymentId}`);
    },
    /**
     * POST /payments/{payment_id}/receipt — owner STUDENT only, multipart
     * field "image" (JPEG/PNG/WEBP ≤ 5 MB). Advances the digital payment
     * PENDING → SUBMITTED. Receipts live in a PRIVATE bucket; viewing goes
     * through GET /payments/{id}/receipt (authorized stream).
     */
    async uploadReceipt(paymentId, file) {
        const formData = new FormData();
        formData.append('image', file);
        return ApiClient.request(`/payments/${paymentId}/receipt`, {
            method: 'POST',
            body: formData
        });
    },
    /**
     * GET /payments/{payment_id}/receipt — streams the receipt image bytes
     * (owner student / CEO / SUPERVISOR). Never a public URL.
     */
    async getReceipt(paymentId) {
        return ApiClient.requestBlob(`/payments/${paymentId}/receipt`);
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
    },
    async renew(subscriptionId) {
        return ApiClient.request(`/subscriptions/${subscriptionId}/renew`, {
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

// Expose all domain APIs and normalizers to the global window
window.normalizePhoneNumber = normalizePhoneNumber;
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
