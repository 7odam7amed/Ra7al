
// Global State
let currentUser = null;
let activeUserRole = 'guest';
let cachedUniversities = [];
let cachedStations = [];
let cachedRoutes = [];
let cachedBuses = [];
let cachedSupervisors = [];
let activeSubscriptionQR = null;
let currentSupervisorTripId = null;
let selectedStudentTrip = null;
let buySubRoutesCache = new Map();
let buySubPlansCache = new Map();
let studentTomorrowTripsCache = [];
let currentPickupTripId = null;
let displaySubscriptionIdCache = null;
// Bus image object URLs created during this session (revoked on re-render)
let activeBusImageUrls = new Set();

// SubscriptionPlanType enum → Arabic labels (source of truth: ENUMS.md).
const PLAN_TYPE_LABELS = {
    DAILY: 'يومي',
    WEEKLY: 'أسبوعي',
    MONTHLY: 'شهري',
    TERM: 'فصل دراسي'
};

// Plan duration bounds (SUBSCRIPTIONS.md: 1–730 days; DAILY fixed to exactly 1)
const MAX_PLAN_DURATION_DAYS = 730;
// Weekly usage-day allowance bounds (days_per_week: 1–7 distinct usage days)
const MAX_PLAN_DAYS_PER_WEEK = 7;

// Rejected phone helpers (client-side convenience cache for re-registration blocking)
function getRejectedPhoneSet() {
    try {
        const raw = localStorage.getItem('rahaal_rejected_phones');
        return new Set(raw ? JSON.parse(raw) : []);
    } catch (e) {
        return new Set();
    }
}

function addRejectedPhone(phone) {
    if (!phone) return;
    const set = getRejectedPhoneSet();
    const cleanStr = String(phone).trim();
    set.add(cleanStr);
    const digitsOnly = cleanStr.replace(/\D/g, '');
    if (digitsOnly) {
        set.add(digitsOnly);
        if (digitsOnly.startsWith('20')) set.add('0' + digitsOnly.slice(2));
        if (digitsOnly.startsWith('0')) set.add('20' + digitsOnly.slice(1));
    }
    localStorage.setItem('rahaal_rejected_phones', JSON.stringify(Array.from(set)));
}

function removeRejectedPhone(phone) {
    if (!phone) return;
    const set = getRejectedPhoneSet();
    const cleanStr = String(phone).trim();
    set.delete(cleanStr);
    const digitsOnly = cleanStr.replace(/\D/g, '');
    if (digitsOnly) {
        set.delete(digitsOnly);
        set.delete('0' + digitsOnly.slice(2));
        set.delete('20' + digitsOnly.slice(1));
    }
    localStorage.setItem('rahaal_rejected_phones', JSON.stringify(Array.from(set)));
}

function isPhoneRejected(phone) {
    if (!phone) return false;
    const set = getRejectedPhoneSet();
    const cleanStr = String(phone).trim();
    if (set.has(cleanStr)) return true;
    const digitsOnly = cleanStr.replace(/\D/g, '');
    if (!digitsOnly) return false;
    if (set.has(digitsOnly)) return true;
    if (digitsOnly.startsWith('20') && set.has('0' + digitsOnly.slice(2))) return true;
    if (digitsOnly.startsWith('0') && set.has('20' + digitsOnly.slice(1))) return true;
    return false;
}

function initApp() {
    // 1. Instantly hide loading screen without delay
    const loader = document.getElementById('loading-screen');
    if (loader) {
        loader.style.opacity = '0';
        setTimeout(() => { loader.style.display = 'none'; }, 100);
    }

    // 2. Initialize API Base URL in modal if present
    const cfgInput = document.getElementById('cfg-base-url');
    if (cfgInput) {
        cfgInput.value = window.CONFIG.getApiBaseUrl();
    }

    // 3. Immediately render initial view & observers so nothing waits
    const token = window.CONFIG.getAccessToken();
    const cachedUser = window.CONFIG.getCachedUser();

    if (token && cachedUser && cachedUser.is_active) {
        currentUser = cachedUser;
        updateNavUserProfile(cachedUser);
        switchRole((cachedUser.role || 'STUDENT').toLowerCase());
    } else {
        switchRole('guest');
    }

    // Populate initial selects
    populateUniversitySelects();

    // 4. Immediately initialize observers and reveal viewport elements
    initIntersectionObservers();

    // 5. Asynchronously load background data without blocking UI rendering
    loadInitialPublicData();

    // Verify session in background if token exists
    if (token) {
        restoreAuthenticatedUser().catch(() => {});
    } else {
        // Landing counters are fed from public health data only for guests.
        // CEO-only listing endpoints (users/buses/stations) intentionally are
        // NOT called without a token (they would just produce 401 noise).
        fetchLandingStats();
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}

async function restoreAuthenticatedUser() {
    try {
        const user = await window.authApi.getMe();
        if (user && user.is_active) {
            currentUser = user;
            window.CONFIG.setCachedUser(user);
            updateNavUserProfile(user);

            // Determine role
            const role = (user.role || 'STUDENT').toLowerCase();
            switchRole(role);
            // With a valid session, CEO/SUPERVISOR can feed landing stats from real totals
            fetchLandingStats();
            showToast(`أهلاً بك مجدداً يا ${user.full_name}`, 'success');
        } else {
            window.CONFIG.clearAccessToken();
            switchRole('guest');
        }
    } catch (err) {
        window.CONFIG.clearAccessToken();
        switchRole('guest');
    }
}

async function loadInitialPublicData() {
    try {
        const res = await window.universitiesApi.list({ page_size: 100 });
        let items = [];
        if (Array.isArray(res)) {
            items = res;
        } else if (res && Array.isArray(res.items)) {
            items = res.items;
        } else if (res && Array.isArray(res.data)) {
            items = res.data;
        }

        if (items.length > 0) {
            cachedUniversities = items;
            populateUniversitySelects();
        }
    } catch (e) {
        console.warn('Could not load universities initially:', e);
    }
}

function populateUniversitySelects() {
    const regUniSelect = document.getElementById('reg-university-select');
    if (regUniSelect) {
        if (cachedUniversities.length === 0) {
            regUniSelect.innerHTML = '<option value="" disabled selected>اختر الجامعة المقيد بها</option>';
        } else {
            regUniSelect.innerHTML = '<option value="" disabled selected>اختر الجامعة المقيد بها</option>';
            cachedUniversities.forEach(u => {
                regUniSelect.innerHTML += `<option value="${u.id}">${u.name}</option>`;
            });
        }
    }
}

// ============================================================
// TOAST NOTIFICATIONS
// ============================================================
function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    const colors = {
        success: 'bg-[#2ECC71] text-white border-b-4 border-[#25a55c]',
        error: 'bg-rose-500 text-white border-b-4 border-rose-600',
        info: 'bg-[#0B5DAA] text-white border-b-4 border-[#08457e]'
    };

    const icons = {
        success: 'fa-circle-check',
        error: 'fa-triangle-exclamation',
        info: 'fa-circle-info'
    };

    toast.className = `${colors[type] || colors.info} px-5 py-3 rounded-2xl shadow-xl font-bold text-xs flex items-center gap-2 pointer-events-auto transition-all transform translate-y-3 opacity-0 duration-200`;
    toast.innerHTML = `<i class="fa-solid ${icons[type] || icons.info}"></i> <span>${message}</span>`;

    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.remove('translate-y-3', 'opacity-0');
    }, 20);

    setTimeout(() => {
        toast.classList.add('translate-y-3', 'opacity-0');
        setTimeout(() => toast.remove(), 250);
    }, 3500);
}

// ============================================================
// ROLE ROUTING & VIEW CONTROLLER
// ============================================================
function switchRole(role) {
    activeUserRole = role;

    const views = {
        guest: document.getElementById('landing-view'),
        login: document.getElementById('login-view'),
        register: document.getElementById('register-view'),
        student: document.getElementById('student-view'),
        supervisor: document.getElementById('supervisor-view'),
        ceo: document.getElementById('ceo-view')
    };

    const navGuest = document.getElementById('nav-guest');
    const navActions = document.getElementById('nav-actions');
    const navUserBadge = document.getElementById('nav-user-badge');

    // Hide all views first
    Object.values(views).forEach(v => {
        if (v) v.classList.add('hidden');
    });

    if (navGuest) navGuest.classList.add('hidden');
    if (navActions) navActions.classList.add('hidden');
    if (navUserBadge) navUserBadge.classList.add('hidden');

    if (role === 'guest') {
        if (views.guest) views.guest.classList.remove('hidden');
        if (navGuest) {
            navGuest.classList.remove('hidden');
            navGuest.classList.add('md:flex');
        }
        if (navActions) {
            navActions.classList.remove('hidden');
            navActions.classList.add('flex');
        }
    } else if (role === 'login') {
        if (views.login) views.login.classList.remove('hidden');
    } else if (role === 'register') {
        if (views.register) views.register.classList.remove('hidden');
    } else if (role === 'student') {
        if (views.student) views.student.classList.remove('hidden');
        if (navUserBadge) {
            navUserBadge.classList.remove('hidden');
            navUserBadge.classList.add('flex');
        }
        loadStudentDashboard();
    } else if (role === 'supervisor') {
        if (views.supervisor) views.supervisor.classList.remove('hidden');
        if (navUserBadge) {
            navUserBadge.classList.remove('hidden');
            navUserBadge.classList.add('flex');
        }
        loadSupervisorDashboard();
    } else if (role === 'ceo') {
        if (views.ceo) views.ceo.classList.remove('hidden');
        if (navUserBadge) {
            navUserBadge.classList.remove('hidden');
            navUserBadge.classList.add('flex');
        }
        loadCeoDashboardData();
    }
}

function updateNavUserProfile(user) {
    const userDisplayName = document.getElementById('user-display-name');
    const userRoleBadge = document.getElementById('user-role-badge');

    if (userDisplayName) {
        userDisplayName.innerText = user.full_name || 'مستخدم';
    }

    if (userRoleBadge) {
        const rolesMap = {
            STUDENT: 'طالب',
            SUPERVISOR: 'مشرف',
            CEO: 'المدير التنفيذي'
        };
        userRoleBadge.innerText = rolesMap[user.role] || user.role;
    }
}

function showLogin() {
    switchRole('login');
}

function showRegister() {
    switchRole('register');
    populateUniversitySelects();
}

function logout() {
    showToast('جاري تسجيل الخروج الآمن...', 'info');
    window.CONFIG.clearAccessToken();
    currentUser = null;
    setTimeout(() => {
        switchRole('guest');
        showToast('تم تسجيل الخروج بنجاح.', 'success');
    }, 400);
}

function closeModal(modalId) {
    const m = document.getElementById(modalId);
    if (m) m.classList.add('hidden');
}

// ============================================================
// AUTHENTICATION FLOW (LOGIN / REGISTER — phone + password only, no OTP)
// ============================================================

/**
 * Handle Login Form Submit (OAuth2 password form)
 */
async function handleLoginSubmit(e) {
    e.preventDefault();
    const phone = document.getElementById('login-phone').value;
    const pass = document.getElementById('login-pass').value;
    const submitBtn = document.getElementById('btn-login-submit');

    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري التحقق...';
    }

    try {
        const tokenRes = await window.authApi.login(phone, pass);
        if (tokenRes && tokenRes.access_token) {
            window.CONFIG.setAccessToken(tokenRes.access_token);

            // Fetch user profile
            const profile = await window.authApi.getMe();
            currentUser = profile;
            window.CONFIG.setCachedUser(profile);
            updateNavUserProfile(profile);

            showToast(`تم تسجيل الدخول بنجاح. أهلاً بك يا ${profile.full_name}`, 'success');
            switchRole((profile.role || 'STUDENT').toLowerCase());
        }
    } catch (err) {
        console.error('Login error:', err);
        // Error handling is centralized in ApiClient
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<span>دخول الحساب</span>';
        }
    }
}

/**
 * Handle Card / Nomination File Selection Preview
 */
function handleCardFileSelection(input) {
    const previewContainer = document.getElementById('reg-card-preview-container');
    const previewImg = document.getElementById('reg-card-preview-img');
    const fileNameDisplay = document.getElementById('reg-card-file-name');

    if (!input.files || input.files.length === 0) {
        if (previewContainer) previewContainer.classList.add('hidden');
        return;
    }

    const file = input.files[0];
    if (fileNameDisplay) fileNameDisplay.innerText = file.name;

    if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (e) => {
            if (previewImg) {
                previewImg.src = e.target.result;
                previewImg.classList.remove('hidden');
            }
            if (previewContainer) previewContainer.classList.remove('hidden');
        };
        reader.readAsDataURL(file);
    } else {
        if (previewImg) previewImg.classList.add('hidden');
        if (previewContainer) previewContainer.classList.remove('hidden');
    }
}

/**
 * Handle Student Registration Submit (Upload ID Card -> Register -> Show Pending Status)
 * Flow per AUTHENTICATION.md §5: upload card first (multipart, field "file"),
 * then register with the returned image_path verbatim.
 */
async function handleRegisterSubmit(e) {
    e.preventDefault();

    const name = document.getElementById('reg-name').value;
    const gender = document.getElementById('reg-gender').value;
    const phone = document.getElementById('reg-phone').value;
    const uniId = document.getElementById('reg-university-select').value;
    const faculty = document.getElementById('reg-faculty').value;
    const academicYear = document.getElementById('reg-academic-year').value;
    const cardFileInput = document.getElementById('reg-card-file');
    const pass = document.getElementById('reg-pass').value;
    const confirmPass = document.getElementById('reg-confirm').value;
    const submitBtn = document.getElementById('btn-register-submit');

    if (pass !== confirmPass) {
        showToast('كلمتا المرور غير متطابقتين!', 'error');
        return;
    }

    if (!cardFileInput.files || cardFileInput.files.length === 0) {
        showToast('يرجى اختيار صورة الكارنيه الجامعي أو بطاقة الترشح للرفع.', 'error');
        return;
    }

    if (!uniId) {
        showToast('يرجى اختيار الجامعة المقيد بها.', 'error');
        return;
    }

    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري رفع المستند وتسجيل الحساب...';
    }

    try {
        // Step 1: Upload ID Card / Nomination Card (public, rate limit 10/min/IP)
        showToast('جاري رفع صورة الكارنيه / بطاقة الترشح...', 'info');
        const uploadRes = await window.authApi.uploadIdCard(cardFileInput.files[0]);

        // Find reference path in response
        const cardRefPath = uploadRes?.image_path;
        if (!cardRefPath) throw new Error('لم يُرجع الخادم مسار صورة الكارنيه. حاول رفع الصورة مرة أخرى.');

        // Step 2: Register user
        showToast('جاري تسجيل بيانات الحساب وإرسالها للمراجعة...', 'info');
        const payload = {
            full_name: name,
            phone_number: phone,
            password: pass,
            gender: gender,
            university_id: parseInt(uniId),
            faculty: faculty,
            academic_year: academicYear,
            university_id_card_image: cardRefPath
        };

        const registerRes = await window.authApi.register(payload);
        showToast('تم إرسال طلب إنشاء الحساب بنجاح! حسابك قيد مراجعة الـ CEO.', 'success');

        // Clear inputs
        document.getElementById('reg-name').value = '';
        document.getElementById('reg-phone').value = '';
        document.getElementById('reg-faculty').value = '';
        document.getElementById('reg-academic-year').value = '';
        document.getElementById('reg-pass').value = '';
        document.getElementById('reg-confirm').value = '';
        cardFileInput.value = '';
        const previewContainer = document.getElementById('reg-card-preview-container');
        if (previewContainer) previewContainer.classList.add('hidden');

        // Show pending confirmation modal (backend: status=PENDING, is_active=false)
        const pendingModal = document.getElementById('reg-pending-modal');
        if (pendingModal) {
            pendingModal.classList.remove('hidden');
        } else {
            showLogin();
        }
    } catch (err) {
        console.error('Registration error:', err);
        if (err.status === 409) {
            showToast('هذا الرقم مسجل بالفعل في النظام. يمكنك تسجيل الدخول.', 'error');
        }
        // All other statuses (404 inactive/unknown university, 422 validation, 429 rate limit)
        // are surfaced by the centralized ApiClient error handler.
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<span>إنشاء الحساب وإرسال للمراجعة</span>';
        }
    }
}

function closeRegPendingModalAndLogin() {
    const modal = document.getElementById('reg-pending-modal');
    if (modal) modal.classList.add('hidden');
    showLogin();
}

// ============================================================
// STUDENT DASHBOARD CONTROLLERS
// ============================================================
function switchStudentTab(tabId, btnElement) {
    const views = document.querySelectorAll('.student-subview');
    views.forEach(v => v.classList.add('hidden'));

    const buttons = document.querySelectorAll('.student-tab-btn');
    buttons.forEach(b => {
        b.className = "student-tab-btn px-4 py-2.5 rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 border-0 cursor-pointer fast-transition bg-transparent";
    });

    const targetView = document.getElementById(`student-tab-${tabId}`);
    if (targetView) targetView.classList.remove('hidden');

    if (btnElement) {
        btnElement.className = "student-tab-btn px-4 py-2.5 rounded-xl text-xs font-black bg-brand-primary text-white border-0 cursor-pointer fast-transition";
    }

    if (tabId === 'sub-card') {
        loadStudentDashboard();
    } else if (tabId === 'trips-booking') {
        loadStudentAvailableTrips();
        loadMyReservations();
    } else if (tabId === 'payments') {
        loadMyPayments();
    }
    // NOTE: there is no self-service profile edit endpoint in the backend
    // (STUDENTS.md §1) — the profile tab is read-only by design.
}

async function loadStudentDashboard() {
    if (!currentUser) return;

    // Header info
    const nameElem = document.getElementById('student-header-name');
    const metaElem = document.getElementById('student-header-meta');
    if (nameElem) nameElem.innerText = currentUser.full_name || 'الطالب';
    if (metaElem) metaElem.innerText = `${currentUser.faculty || 'الكلية'} | ${currentUser.academic_year || 'الفرقة'}`;

    // Profile tab (read-only: the backend has no student self-service profile
    // update endpoint — STUDENTS.md §1)
    const profName = document.getElementById('prof-name');
    const profFaculty = document.getElementById('prof-faculty');
    const profYear = document.getElementById('prof-academic-year');
    const profPhone = document.getElementById('prof-phone');
    if (profName) profName.value = currentUser.full_name || '';
    if (profFaculty) profFaculty.value = currentUser.faculty || '';
    if (profYear) profYear.value = currentUser.academic_year || '';
    if (profPhone) profPhone.innerText = currentUser.phone_number || '--';

    // Load subscription (prefer ACTIVE; otherwise show the most recent one so payment state stays visible)
    try {
        const subsRes = await window.subscriptionsApi.listMy({ page_size: 10 });
        const items = subsRes?.items || [];
        const activeSub = items.find(s => s.status === 'ACTIVE');
        const displaySub = activeSub || items[0] || null;

        if (displaySub) {
            displaySubscriptionIdCache = displaySub.id;
            setElementText('sub-stat-plan', displaySub.plan?.name || PLAN_TYPE_LABELS[displaySub.plan_type] || displaySub.plan_type || 'باقة نقل');
            setElementText('sub-stat-duration', displaySub.duration_days != null ? `${displaySub.duration_days} يوم` : '--');
            setElementText('sub-stat-days-per-week', displaySub.days_per_week != null ? `${displaySub.days_per_week} يوم/أسبوع` : '--');
            setElementText('sub-stat-rides', `${displaySub.used_qr_usages ?? displaySub.boarding_count ?? 0} رحلة`);

            // Weekly usage-day accounting from SubscriptionDetailResponse (QR_AND_BOARDING.md §5).
            // usage_days_this_week counts DISTINCT calendar DAYS (outbound + return same day = ONE day).
            // Never compute allowances client-side — display the API fields only.
            const usageLine = document.getElementById('sub-stat-week-usage');
            if (usageLine) {
                if (displaySub.usage_days_this_week != null || displaySub.remaining_usage_days_this_week != null) {
                    usageLine.textContent = `${displaySub.usage_days_this_week ?? 0} / ${displaySub.days_per_week ?? '--'} يوم`;
                    usageLine.classList.remove('hidden');
                } else {
                    // Deleted-plan edge case: fall back to dates + used count only.
                    usageLine.textContent = `المستخدم إجمالي: ${displaySub.used_qr_usages ?? 0}`;
                    usageLine.classList.remove('hidden');
                }
            }

            // QR is valid only for ACTIVE subscriptions — the backend rejects GET /subscriptions/{id}/qr otherwise.
            if (displaySub.status === 'ACTIVE') {
                loadStudentQRCode(displaySub.id);
            } else {
                renderNonActiveSubscriptionState(displaySub);
            }
            loadStudentBoardingHistory(displaySub.id);
        } else {
            renderEmptyQRCode('لا يوجد اشتراك نشط حالياً. اضغط على "شراء اشتراك جديد" للبدء.');
            setQrStatusBadge(null);
            setElementText('student-qr-route-name', 'باقة النقل الجامعي');
            setElementText('student-qr-validity', 'الصلاحية: -- إلى --');
        }
    } catch (e) {
        console.warn('Could not load student subscriptions:', e);
        renderEmptyQRCode('تعذر تحميل بيانات الاشتراك');
        setQrStatusBadge(null);
    }
}

async function loadStudentQRCode(subId) {
    const qrBox = document.getElementById('student-qrcode-box');
    if (!qrBox) return;
    qrBox.innerHTML = '<i class="fa-solid fa-spinner fa-spin text-2xl text-slate-400"></i>';

    try {
        const qrData = await window.subscriptionsApi.getQr(subId);
        if (qrData && qrData.qr_payload) {
            qrBox.innerHTML = '';
            new QRCode(qrBox, {
                text: qrData.qr_payload,
                width: 160,
                height: 160,
                colorDark: "#081B33",
                colorLight: "#ffffff",
                correctLevel: QRCode.CorrectLevel.H
            });

            setElementText('student-qr-route-name', 'باقة النقل الجامعي');
            setElementText('student-qr-validity', `الصلاحية: من ${qrData.valid_from || '--'} إلى ${qrData.valid_until || '--'}`);
            setQrStatusBadge(qrData.status || 'ACTIVE');
        } else {
            renderEmptyQRCode('تعذر إنشاء كود الـ QR');
        }
    } catch (e) {
        // GET /subscriptions/{id}/qr returns 422 unless the subscription is ACTIVE.
        renderEmptyQRCode('كود QR متاح فقط بعد تفعيل الاشتراك (تأكيد الدفع).');
        setQrStatusBadge(null);
    }
}

function renderEmptyQRCode(msg) {
    const qrBox = document.getElementById('student-qrcode-box');
    if (qrBox) {
        qrBox.innerHTML = `<div class="text-center p-3 text-slate-400 text-xs font-bold"><i class="fa-solid fa-ticket text-2xl mb-1 block"></i>${msg}</div>`;
    }
}

function setElementText(id, text) {
    const el = document.getElementById(id);
    if (el) el.innerText = text;
}

function setQrStatusBadge(status) {
    const badge = document.getElementById('student-qr-status');
    if (!badge) return;
    const map = {
        ACTIVE: { text: 'نشط', cls: 'bg-emerald-500/10 text-emerald-500' },
        PENDING: { text: 'بانتظار التفعيل', cls: 'bg-amber-500/10 text-amber-500' },
        EXPIRED: { text: 'منتهي', cls: 'bg-slate-500/10 text-slate-400' },
        CANCELLED: { text: 'ملغي', cls: 'bg-rose-500/10 text-rose-500' }
    };
    const conf = (status && map[status]) || { text: status || 'لا يوجد', cls: 'bg-slate-500/10 text-slate-400' };
    badge.innerText = conf.text;
    badge.className = `px-2 py-0.5 rounded-full text-[10px] font-black ${conf.cls}`;
}

function renderNonActiveSubscriptionState(sub) {
    const status = sub?.status;
    const payStatus = sub?.payment_status || sub?.payment?.status || null;
    let msg;
    if (status === 'PENDING') {
        msg = payStatus === 'SUBMITTED'
            ? 'تم إرسال إثبات الدفع — الاشتراك بانتظار تأكيد الإدارة. سيظهر كود QR بعد الاعتماد.'
            : 'الاشتراك بانتظار الدفع وتأكيد الإدارة. سيظهر كود QR بعد تفعيل الاشتراك.';
    } else if (status === 'EXPIRED') {
        msg = 'انتهت صلاحية هذا الاشتراك. يمكنك تجديده للحصول على كود QR جديد.';
    } else if (status === 'CANCELLED') {
        msg = 'تم إلغاء هذا الاشتراك.';
    } else {
        msg = `الاشتراك بحالة ${status || 'غير معروفة'} — كود QR متاح فقط للاشتراكات النشطة.`;
    }
    renderEmptyQRCode(msg);
    setQrStatusBadge(status);
    setElementText('student-qr-route-name', 'باقة النقل الجامعي');
    setElementText('student-qr-validity', (sub?.start_date && sub?.end_date) ? `الصلاحية: من ${sub.start_date} إلى ${sub.end_date}` : 'الصلاحية: -- إلى --');
}

// التسمية الديناميكية لتاريخ خدمة الغد (التواريخ دائماً كما يعيدها الخادم — لا حسابات محلية للسماحية).
function getTomorrowLabel() {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toLocaleDateString('ar-EG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

function getTomorrowDateISO() {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
}

function setTomorrowLabels() {
    const el = document.getElementById('student-tomorrow-label');
    if (el) el.textContent = getTomorrowLabel();
}

async function loadStudentBoardingHistory(subId) {
    const tbody = document.getElementById('student-boarding-history-tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="4" class="p-4 text-center text-slate-400"><i class="fa-solid fa-spinner fa-spin"></i> جاري التحميل...</td></tr>';

    try {
        if (!subId) {
            subId = displaySubscriptionIdCache;
        }

        if (!subId) {
            tbody.innerHTML = '<tr><td colspan="4" class="p-6 text-center text-slate-400 font-bold">لا يوجد سجل ركوب مسجل حتى الآن</td></tr>';
            return;
        }

        const history = await window.subscriptionsApi.getHistory(subId);
        if (Array.isArray(history) && history.length > 0) {
            tbody.innerHTML = '';
            history.forEach(item => {
                const isOutbound = item.direction === 'OUTBOUND';
                tbody.innerHTML += `
                    <tr class="hover:bg-slate-50/50 dark:hover:bg-slate-950/20 transition">
                        <td class="p-4">
                            <span class="px-2 py-0.5 rounded-md text-[10px] font-black ${isOutbound ? 'bg-blue-500/15 text-blue-500' : 'bg-emerald-500/15 text-emerald-500'}">
                                ${isOutbound ? 'ذهاب (Outbound)' : 'عودة (Return)'}
                            </span>
                        </td>
                        <td class="p-4 font-bold">${item.pickup_point_name || `محطة #${item.pickup_point_id}`}</td>
                        <td class="p-4 font-bold text-slate-600 dark:text-slate-300">${item.supervisor_name || `مشرف #${item.supervisor_id}`}</td>
                        <td class="p-4 font-mono font-bold text-slate-400">${new Date(item.boarded_at).toLocaleString('ar-EG')}</td>
                    </tr>
                `;
            });
        } else {
            tbody.innerHTML = '<tr><td colspan="4" class="p-6 text-center text-slate-400 font-bold">لم يتم تسجيل أي عمليات صعود بهذا الاشتراك بعد</td></tr>';
        }
    } catch (e) {
        tbody.innerHTML = '<tr><td colspan="4" class="p-4 text-center text-rose-500 font-bold">تعذر تحميل سجل الصعود</td></tr>';
    }
}

async function loadStudentAvailableTrips() {
    const tbody = document.getElementById('student-available-trips-tbody');
    const status = document.getElementById('student-available-trips-status');
    if (!tbody) return;
    if (status) status.classList.add('hidden');
    setTomorrowLabels();
    tbody.innerHTML = '<tr><td colspan="5" class="p-6 text-center text-slate-400"><i class="fa-solid fa-spinner fa-spin"></i> جاري تحميل رحلات الغد...</td></tr>';

    try {
        const res = await window.reservationsApi.listAvailableTrips({ page_size: 100 });
        const trips = Array.isArray(res) ? res : (res?.items || []);
        studentTomorrowTripsCache = trips;

        if (trips.length > 0) {
            tbody.innerHTML = '';
            trips.forEach(t => {
                const dep = t.departure_time ? new Date(t.departure_time).toLocaleString('ar-EG', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : '--';
                const svcDate = t.departure_time ? new Date(t.departure_time).toLocaleDateString('ar-EG', { weekday: 'long', month: 'long', day: 'numeric' }) : '--';
                const routeName = t.route?.name || `خط #${t.route_id}`;
                const available = t.available_seats;
                const seatsBadge = available > 0
                    ? `<span class="px-2.5 py-1 rounded-full text-[10px] font-black bg-emerald-500/15 text-emerald-500">متاح ${available}</span>`
                    : `<span class="px-2.5 py-1 rounded-full text-[10px] font-black bg-rose-500/15 text-rose-500">ممتلئ</span>`;
                const points = Array.isArray(t.pickup_points) ? t.pickup_points : [];
                const bookBtn = points.length
                    ? `<button onclick="openSelectTransportationModal(${Number(t.id)})" class="btn-gradient text-white text-[11px] font-black px-4 py-1.5 rounded-xl hover:scale-105 fast-transition border-0 cursor-pointer shadow-sm">اختر الرحلة</button>`
                    : `<span class="text-[10px] text-slate-400">لا توجد نقاط تجمع معرفة</span>`;
                tbody.innerHTML += `
                    <tr class="hover:bg-slate-50/50 dark:hover:bg-slate-950/20 transition">
                        <td class="p-4 font-bold text-slate-800 dark:text-white">${routeName}</td>
                        <td class="p-4 font-mono text-slate-500">${svcDate}</td>
                        <td class="p-4 font-mono text-slate-500">${dep}</td>
                        <td class="p-4">${seatsBadge}</td>
                        <td class="p-4 text-center">${bookBtn}</td>
                    </tr>
                `;
            });
        } else {
            tbody.innerHTML = '<tr><td colspan="5" class="p-6 text-center text-slate-400 font-bold">لا توجد رحلات متاحة للغد حالياً. يرجى المحاولة لاحقاً.</td></tr>';
        }
    } catch (e) {
        const message = e?.message || 'حدث خطأ أثناء تحميل رحلات الغد.';
        tbody.innerHTML = `<tr><td colspan="5" class="p-6 text-center text-rose-500 font-bold">تعذر تحميل رحلات الغد: ${message}</td></tr>`;
    }
}

// فتح مودال اختيار المواصلات: نقاط الذهاب/العودة من نقاط الرحلة نفسها فقط.
function openSelectTransportationModal(tripId) {
    const trip = (studentTomorrowTripsCache || []).find(t => Number(t.id) === Number(tripId));
    if (!trip) {
        showToast('تعذر العثور على بيانات الرحلة. حدّث القائمة وحاول مجدداً.', 'error');
        return;
    }

    const points = Array.isArray(trip.pickup_points) ? trip.pickup_points : [];
    if (!points.length) {
        showToast('لا توجد نقاط تجمع معرفة لهذه الرحلة. اطلب من الإدارة تعيينها أولاً.', 'warning');
        return;
    }

    const optionsHtml = points
        .map(p => `<option value="${Number(p.id)}">${p.name || `نقطة #${p.id}`}</option>`)
        .join('');

    const routeName = trip.route?.name || `رحلة #${trip.id}`;
    const dep = trip.departure_time ? new Date(trip.departure_time).toLocaleString('ar-EG', { weekday: 'long', hour: '2-digit', minute: '2-digit' }) : '--';

    const modal = document.getElementById('select-transportation-modal');
    if (!modal) return;
    modal.dataset.tripId = String(Number(trip.id));
    setElementText('sel-trans-trip-context', `${routeName} • ${dep} • ${getTomorrowLabel()}`);

    const outSel = document.getElementById('sel-trans-outbound');
    const retSel = document.getElementById('sel-trans-return');
    if (outSel) outSel.innerHTML = optionsHtml;
    if (retSel) retSel.innerHTML = optionsHtml;

    const modeSel = document.getElementById('sel-trans-direction-mode');
    if (modeSel) modeSel.value = 'BOTH';
    toggleReturnSelectorForMode();

    modal.classList.remove('hidden');
}

function toggleReturnSelectorForMode() {
    const mode = document.getElementById('sel-trans-direction-mode')?.value || 'BOTH';
    const container = document.getElementById('sel-trans-return-container');
    if (container) {
        container.classList.toggle('hidden', mode === 'OUTBOUND_ONLY');
    }
}

async function handleSelectTransportationSubmit(e) {
    e.preventDefault();

    const modal = document.getElementById('select-transportation-modal');
    if (!modal) return;
    const tripId = Number(modal.dataset.tripId);
    const submitBtn = e.submitter || modal.querySelector('button[type="submit"]');
    const mode = document.getElementById('sel-trans-direction-mode').value;
    const outVal = document.getElementById('sel-trans-outbound').value;
    const retVal = document.getElementById('sel-trans-return')?.value;
    const outboundId = outVal ? Number(outVal) : null;
    const returnId = retVal ? Number(retVal) : null;

    // متطلبات نقاط الاتجاه (نفس قواعد الخادم — ReservationCreateRequest):
    if (!Number.isInteger(tripId) || tripId <= 0) { showToast('رقم الرحلة غير صالح.', 'error'); return; }
    if (mode !== 'RETURN_ONLY' && (!Number.isInteger(outboundId) || outboundId <= 0)) {
        showToast('يرجى اختيار نقطة تجمع الذهاب.', 'error'); return;
    }
    if (mode !== 'OUTBOUND_ONLY' && (!Number.isInteger(returnId) || returnId <= 0)) {
        showToast('يرجى اختيار نقطة تجمع العودة.', 'error'); return;
    }

    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.dataset.origText = submitBtn.innerText;
        submitBtn.innerText = '⏳ جاري تأكيد الحجز...';
    }

    try {
        // ReservationCreateRequest: trip + points + direction ONLY.
        // The service date is decided by the backend (tomorrow) — never sent.
        await window.reservationsApi.book({
            trip_id: tripId,
            outbound_pickup_point_id: outboundId,
            return_pickup_point_id: returnId,
            direction_mode: mode
        });
        showToast('تم تأكيد مواصلات الغد بنجاح! اعرض كود QR للمشرف يوم الرحلة.', 'success');
        closeModal('select-transportation-modal');
        loadMyReservations();
    } catch (err) {
        console.error('Create transportation selection error:', err);
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerText = submitBtn.dataset.origText || 'تأكيد الحجز';
        }
    }
}

async function loadMyReservations() {
    const tbody = document.getElementById('student-my-reservations-tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="5" class="p-6 text-center text-slate-400"><i class="fa-solid fa-spinner fa-spin"></i> جاري التحميل...</td></tr>';

    try {
        const res = await window.reservationsApi.listMy({ page_size: 50 });
        const items = res?.items || [];

        if (items.length > 0) {
            tbody.innerHTML = '';
            items.forEach(r => {
                const isConfirmed = r.status === 'CONFIRMED';
                // تاريخ الخدمة (الغد) هو المعيار — وليس تاريخ إنشاء الحجز.
                const svcDate = r.service_date ? new Date(`${r.service_date}T00:00:00`).toLocaleDateString('ar-EG') : '--';
                const isTomorrow = r.service_date === getTomorrowDateISO();
                const tripInfo = r.trip?.route?.name ? `${r.trip.route.name}` : `رحلة #${r.trip_id}`;
                const dirLabel = r.direction_mode === 'OUTBOUND_ONLY' ? 'ذهاب فقط'
                    : r.direction_mode === 'RETURN_ONLY' ? 'عودة فقط' : 'ذهاب وعودة';
                tbody.innerHTML += `
                    <tr class="hover:bg-slate-50/50 dark:hover:bg-slate-950/20 transition">
                        <td class="p-4 font-mono font-bold">#${r.id}</td>
                        <td class="p-4 font-bold text-slate-800 dark:text-white">${tripInfo}<span class="block text-[10px] text-slate-400">${dirLabel}</span></td>
                        <td class="p-4 font-mono text-slate-400">${svcDate}${isTomorrow ? '<span class="block text-[10px] font-black text-emerald-500">الغد</span>' : ''}</td>
                        <td class="p-4">
                            <span class="px-2.5 py-1 rounded-full text-[10px] font-black ${isConfirmed ? 'bg-emerald-500/15 text-emerald-500' : 'bg-rose-500/15 text-rose-500'}">
                                ${isConfirmed ? 'مؤكد' : 'ملغي'}
                            </span>
                        </td>
                        <td class="p-4 text-center">
                            ${isConfirmed && isTomorrow ? `
                                <button onclick="cancelMyReservation(${r.id})" class="text-rose-500 hover:text-rose-600 font-black text-xs hover:underline bg-transparent border-0 cursor-pointer">
                                    إلغاء الحجز
                                </button>
                            ` : '<span class="text-slate-400 text-xs">--</span>'}
                        </td>
                    </tr>
                `;
            });
        } else {
            tbody.innerHTML = '<tr><td colspan="5" class="p-6 text-center text-slate-400 font-bold">لا توجد حجوزات مسجلة باسمك</td></tr>';
        }
    } catch (e) {
        tbody.innerHTML = '<tr><td colspan="5" class="p-6 text-center text-rose-500 font-bold">تعذر تحميل قائمة الحجوزات</td></tr>';
    }
}

async function cancelMyReservation(resId) {
    if (!confirm('هل أنت متأكد من رغبتك بإلغاء هذا الحجز؟')) return;

    try {
        await window.reservationsApi.cancel(resId);
        showToast('تم إلغاء الحجز بنجاح وتحرير المقعد.', 'success');
        loadMyReservations();
        loadStudentAvailableTrips();
    } catch (e) {
        console.error('Cancel reservation error:', e);
    }
}

async function loadMyPayments() {
    const tbody = document.getElementById('student-my-payments-tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6" class="p-6 text-center text-slate-400"><i class="fa-solid fa-spinner fa-spin"></i> جاري التحميل...</td></tr>';

    try {
        const res = await window.paymentsApi.listMy({ page_size: 50 });
        const items = res?.items || [];

        if (items.length > 0) {
            tbody.innerHTML = '';
            items.forEach(p => {
                const statusColors = {
                    PENDING: 'bg-amber-500/15 text-amber-500',
                    SUBMITTED: 'bg-blue-500/15 text-blue-500',
                    VERIFIED: 'bg-emerald-500/15 text-emerald-500',
                    REJECTED: 'bg-rose-500/15 text-rose-500',
                    CANCELLED: 'bg-slate-500/15 text-slate-500'
                };
                const statusLabels = {
                    PENDING: 'قيد الانتظار',
                    SUBMITTED: 'تم تقديم الإثبات',
                    VERIFIED: 'مقبول ومعتمد',
                    REJECTED: 'مرفوض',
                    CANCELLED: 'ملغي'
                };

                tbody.innerHTML += `
                    <tr class="hover:bg-slate-50/50 dark:hover:bg-slate-950/20 transition">
                        <td class="p-4 font-mono font-bold">#${p.id}</td>
                        <td class="p-4 font-mono font-bold text-slate-800 dark:text-white">${p.amount} ${p.currency}</td>
                        <td class="p-4 font-bold">${p.method}</td>
                        <td class="p-4 font-mono text-slate-500 dark:text-slate-400">${p.transaction_reference || 'لا يوجد'}</td>
                        <td class="p-4">
                            <span class="px-2.5 py-1 rounded-full text-[10px] font-black ${statusColors[p.status] || 'bg-slate-500/10 text-slate-400'}">
                                ${statusLabels[p.status] || p.status}
                            </span>
                        </td>
                        <td class="p-4 text-center">
                            ${p.status === 'PENDING' ? `
                                <button onclick="openSubmitPaymentModal(${p.id})" class="btn-gradient text-white text-[10px] font-bold px-3 py-1.5 rounded-lg border-0 cursor-pointer shadow-sm">
                                    تقديم إثبات الدفع
                                </button>
                            ` : '<span class="text-slate-400 text-xs">--</span>'}
                        </td>
                    </tr>
                `;
            });
        } else {
            tbody.innerHTML = '<tr><td colspan="6" class="p-6 text-center text-slate-400 font-bold">لا توجد عمليات دفع مسجلة</td></tr>';
        }
    } catch (e) {
        tbody.innerHTML = '<tr><td colspan="6" class="p-6 text-center text-rose-500 font-bold">تعذر تحميل سجل المدفوعات</td></tr>';
    }
}

function openSubmitPaymentModal(paymentId) {
    document.getElementById('submit-pay-id').value = paymentId;
    document.getElementById('submit-pay-ref').value = '';
    document.getElementById('submit-pay-notes').value = '';
    const modal = document.getElementById('submit-payment-modal');
    if (modal) modal.classList.remove('hidden');
}

async function handleSubmitPaymentProof(e) {
    e.preventDefault();
    const paymentId = document.getElementById('submit-pay-id').value;
    const ref = document.getElementById('submit-pay-ref').value;
    const notes = document.getElementById('submit-pay-notes').value;

    try {
        await window.paymentsApi.submitProof(paymentId, { transaction_reference: ref, notes: notes });
        showToast('تم تقديم إثبات التحويل بنجاح! سيتم مراجعته من الإدارة.', 'success');
        closeModal('submit-payment-modal');
        loadMyPayments();
    } catch (e) {
        console.error('Submit payment proof error:', e);
    }
}

// عرض تفاصيل الباقة المختارة (القيم الحقيقية من الخادم — لا افتراضات WEEKLY=7/MONTHLY=30/TERM=90).
function renderBuySubPlanDetails() {
    const box = document.getElementById('buy-sub-plan-details');
    if (!box) return;
    const planSelect = document.getElementById('buy-sub-plan-select');
    const plan = buySubPlansCache.get(Number(planSelect?.value));
    if (!plan) {
        box.classList.add('hidden');
        box.innerHTML = '';
        return;
    }
    const typeLabel = PLAN_TYPE_LABELS[plan.plan_type] || plan.plan_type || '';
    const duration = plan.duration_days != null ? `${plan.duration_days} يوم اشتراك` : '--';
    const dpw = plan.days_per_week != null ? `${plan.days_per_week} أيام مواصلات/أسبوع` : '--';
    const price = plan.price != null ? `${plan.price} ${plan.currency || 'EGP'}` : '--';
    box.classList.remove('hidden');
    box.innerHTML = `
        <div><i class="fa-solid fa-id-card ml-1"></i> ${typeLabel} — ${duration}</div>
        <div><i class="fa-solid fa-bus ml-1"></i> ${dpw}</div>
        <div><i class="fa-solid fa-tag ml-1"></i> ${price}</div>
    `;
}

function onBuySubPlanChange() {
    renderBuySubPlanDetails();
    toggleRefFieldHint();
}

// إظهار/إخفاء شرط المرجع حسب طريقة الدفع: الرقمي يوجبه، النقد لا يطلبه.
function toggleRefFieldHint() {
    const method = document.getElementById('buy-sub-pay-method')?.value;
    const label = document.getElementById('buy-sub-ref-label');
    const hint = document.getElementById('buy-sub-ref-hint');
    const refInput = document.getElementById('buy-sub-ref');
    const isDigital = method === 'VODAFONE_CASH' || method === 'INSTAPAY';
    if (label) label.textContent = isDigital ? 'رقم مرجع التحويل (مطلوب)' : 'رقم مرجع التحويل (اختياري للدفع النقدي)';
    if (hint) hint.classList.toggle('hidden', !isDigital);
    if (refInput) {
        if (isDigital) refInput.setAttribute('required', '');
        else refInput.removeAttribute('required');
    }
}

function onBuySubPayMethodChange() {
    toggleRefFieldHint();
}

async function openBuySubscriptionModal(selectedTripId = null, preselectedPlanId = null) {
    const modal = document.getElementById('buy-subscription-modal');
    if (!modal) return;

    const planSelect = document.getElementById('buy-sub-plan-select');
    const startDate = document.getElementById('buy-sub-start-date');
    const refInput = document.getElementById('buy-sub-ref');
    const payMethod = document.getElementById('buy-sub-pay-method');

    // تاريخ البدء الافتراضي: اليوم (الـ API يرفض أي تاريخ في الماضي).
    if (startDate) {
        startDate.value = new Date().toISOString().slice(0, 10);
    }
    if (refInput) refInput.value = '';
    if (payMethod) payMethod.value = 'CASH';
    toggleRefFieldHint();

    modal.classList.remove('hidden');

    // تحميل الباقات المتاحة (الاشتراك = باقة + تاريخ بداية + دفع فقط).
    try {
        planSelect.innerHTML = '<option value="">⏳ جاري تحميل الباقات...</option>';
        const plansRes = await window.subscriptionPlansApi.listAvailable();
        const plans = Array.isArray(plansRes) ? plansRes : (plansRes?.items || []);
        buySubPlansCache = new Map(plans.map(p => [Number(p.id), p]));
        planSelect.innerHTML = '<option value="">اختر باقة الاشتراك</option>';
        plans.forEach(p => {
            const dpw = p.days_per_week != null ? ` • ${p.days_per_week} أيام نقل/أسبوع` : '';
            planSelect.innerHTML += `<option value="${p.id}" ${Number(p.id) === Number(preselectedPlanId) ? 'selected' : ''}>${p.name} (${p.price} ${p.currency || 'EGP'} / ${p.duration_days} يوم${dpw})</option>`;
        });
        if (!plans.length) {
            planSelect.innerHTML += '<option value="" disabled>لا توجد باقات نشطة حاليًا</option>';
        }
        renderBuySubPlanDetails();
    } catch (planErr) {
        planSelect.innerHTML = '<option value="">تعذر تحميل الباقات</option>';
        showToast('تعذر تحميل باقات الاشتراك', 'error');
    }
}

async function handleBuySubscriptionSubmit(e) {
    e.preventDefault();

    const submitBtn = e.submitter || document.querySelector('#buy-subscription-modal button[type="submit"]');
    const planId = parseInt(document.getElementById('buy-sub-plan-select').value);
    const payMethod = document.getElementById('buy-sub-pay-method').value;
    const startDate = document.getElementById('buy-sub-start-date').value || null;
    const transRef = (document.getElementById('buy-sub-ref').value || '').trim() || null;

    if (!Number.isInteger(planId) || planId <= 0) { showToast('يرجى اختيار باقة الاشتراك.', 'error'); return; }
    if ((payMethod === 'VODAFONE_CASH' || payMethod === 'INSTAPAY') && !transRef) {
        showToast('الدفع الرقمي يتطلب رقم مرجع التحويل. إن لم يتوفر الآن اختر الدفع نقدًا.', 'error');
        return;
    }

    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.dataset.origText = submitBtn.innerText;
        submitBtn.innerText = '⏳ جاري تنفيذ الاشتراك...';
    }

    try {
        // SubscriptionCreateRequest (SUBSCRIPTIONS.md): plan_id + start_date +
        // payment_method (+ transaction_reference for digital methods).
        // NO route/trip/pickup fields — transportation is selected per day later.
        const payload = {
            plan_id: planId,
            start_date: startDate,
            payment_method: payMethod,
            transaction_reference: transRef
        };

        const res = await window.subscriptionsApi.create(payload);
        const isPending = !res || res.status === 'PENDING';
        showToast(isPending
            ? 'تم إنشاء الاشتراك! الحالة: بانتظار تأكيد الدفع من الإدارة قبل ظهور كود QR.'
            : 'تم إنشاء الاشتراك بنجاح!', 'success');
        closeModal('buy-subscription-modal');
        loadStudentDashboard();
    } catch (err) {
        console.error('Buy subscription error:', err);
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerText = submitBtn.dataset.origText || 'تأكيد وشراء الاشتراك';
        }
    }
}

// NOTE: there is no student self-service profile update endpoint in the
// backend (STUDENTS.md §1). PATCH /users/{id} is CEO-only, so the profile
// tab intentionally displays read-only data.

// ============================================================
// SUPERVISOR DASHBOARD CONTROLLERS
// ============================================================
async function loadSupervisorDashboard() {
    if (!currentUser) return;

    const nameElem = document.getElementById('supervisor-header-name');
    if (nameElem) nameElem.innerText = currentUser.full_name || 'مشرف';

    try {
        // Load scheduled trips
        const tripsRes = await window.tripsApi.list({ page_size: 50 });
        const allTrips = tripsRes?.items || [];
        const supTrips = allTrips.filter(t => t.supervisor_id === currentUser.id);
        const displayTrips = supTrips.length > 0 ? supTrips : allTrips;

        const select = document.getElementById('supervisor-trip-select');
        if (select) {
            select.innerHTML = '<option value="">اختر الرحلة للبدء</option>';
            displayTrips.forEach(t => {
                const rName = t.route?.name || `خط #${t.route_id}`;
                const depTime = new Date(t.departure_time).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' });
                select.innerHTML += `<option value="${t.id}">${rName} | ${depTime} (${t.status})</option>`;
            });

            if (displayTrips.length > 0) {
                select.value = displayTrips[0].id;
                currentSupervisorTripId = displayTrips[0].id;
                onSupervisorTripChanged();
            }
        }
    } catch (e) {
        console.warn('Could not load supervisor trips:', e);
    }
}

async function onSupervisorTripChanged() {
    const select = document.getElementById('supervisor-trip-select');
    if (!select || !select.value) return;

    currentSupervisorTripId = parseInt(select.value);

    // Load Manifest and Records
    loadSupervisorTripStudents();
    loadSupervisorTripRecords();
}

async function loadSupervisorTripStudents() {
    if (!currentSupervisorTripId) return;

    const tbody = document.getElementById('supervisor-manifest-tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="5" class="p-6 text-center text-slate-400"><i class="fa-solid fa-spinner fa-spin"></i> جاري تحميل كشف الركاب...</td></tr>';

    try {
        const students = await window.boardingApi.getTripStudents(currentSupervisorTripId);

        let total = students?.length || 0;
        let outboundCount = 0;
        let returnCount = 0;

        if (Array.isArray(students) && students.length > 0) {
            tbody.innerHTML = '';
            students.forEach(st => {
                if (st.outbound_boarded) outboundCount++;
                if (st.return_boarded) returnCount++;

                tbody.innerHTML += `
                    <tr class="hover:bg-slate-50/50 dark:hover:bg-slate-950/20 transition">
                        <td class="p-4 font-black text-slate-800 dark:text-white">${st.student_name}</td>
                        <td class="p-4 font-semibold text-slate-500 dark:text-slate-400">${st.outbound_pickup || st.return_pickup || 'لم تُحدد نقطة'}</td>
                        <td class="p-4 font-mono font-bold text-slate-600 dark:text-slate-300">
                            <span dir="ltr">${st.subscription_status || '--'}</span>
                            ${st.payment_status ? `<span class="block text-[10px] font-bold ${st.payment_status === 'VERIFIED' ? 'text-emerald-500' : 'text-amber-500'}">${st.payment_status}</span>` : ''}
                        </td>
                        <td class="p-4">
                            <span class="px-2 py-0.5 rounded-lg text-[10px] font-black ${st.outbound_boarded ? 'bg-emerald-500/15 text-emerald-500' : 'bg-amber-500/15 text-amber-500'}">
                                ${st.outbound_boarded ? 'تم الصعود' : 'لم يصعد'}
                            </span>
                        </td>
                        <td class="p-4">
                            <span class="px-2 py-0.5 rounded-lg text-[10px] font-black ${st.return_boarded ? 'bg-emerald-500/15 text-emerald-500' : 'bg-slate-500/15 text-slate-400'}">
                                ${st.return_boarded ? 'تم الصعود' : 'لم يصعد'}
                            </span>
                        </td>
                    </tr>
                `;
            });
        } else {
            tbody.innerHTML = '<tr><td colspan="5" class="p-6 text-center text-slate-400 font-bold">لا يوجد طلاب مشتركين في مسار هذه الرحلة بعد</td></tr>';
        }

        // Update stat counters
        document.getElementById('sup-stat-total-students').innerText = total;
        document.getElementById('sup-stat-outbound-boarded').innerText = outboundCount;
        document.getElementById('sup-stat-return-boarded').innerText = returnCount;
    } catch (e) {
        tbody.innerHTML = '<tr><td colspan="5" class="p-6 text-center text-rose-500 font-bold">تعذر تحميل كشف ركاب الرحلة</td></tr>';
    }
}

async function loadSupervisorTripRecords() {
    if (!currentSupervisorTripId) return;

    const list = document.getElementById('supervisor-records-list');
    if (!list) return;

    try {
        const records = await window.boardingApi.getTripRecords(currentSupervisorTripId);

        if (Array.isArray(records) && records.length > 0) {
            list.innerHTML = '';
            records.forEach(r => {
                const isOutbound = r.direction === 'OUTBOUND';
                const timeStr = new Date(r.boarded_at).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
                list.innerHTML += `
                    <div class="p-3 bg-slate-50 dark:bg-slate-900/60 rounded-2xl flex items-center justify-between border border-slate-200/50 dark:border-slate-800/50">
                        <div>
                            <p class="font-black text-xs text-slate-800 dark:text-white">${r.student_name || `طالب #${r.student_id}`}</p>
                            <p class="text-[10px] text-slate-400">${r.pickup_point_name || 'نقطة التجمع'} • <span class="${isOutbound ? 'text-blue-500' : 'text-emerald-500'} font-bold">${isOutbound ? 'ذهاب' : 'عودة'}</span></p>
                        </div>
                        <span class="font-mono text-xs font-bold text-slate-500">${timeStr}</span>
                    </div>
                `;
            });
        } else {
            list.innerHTML = '<p class="text-xs text-slate-400 text-center py-6">لا توجد عمليات صعود موثقة حتى الآن</p>';
        }
    } catch (e) {
        list.innerHTML = '<p class="text-xs text-rose-500 text-center py-4">تعذر تحميل سجل الصعود</p>';
    }
}

function filterSupervisorManifest(query) {
    const tbody = document.getElementById('supervisor-manifest-tbody');
    if (!tbody) return;
    const rows = tbody.querySelectorAll('tr');
    rows.forEach(r => {
        const text = r.innerText.toLowerCase();
        if (text.includes(query.toLowerCase())) {
            r.classList.remove('hidden');
        } else {
            r.classList.add('hidden');
        }
    });
}

async function openSupervisorScanModal() {
    if (!currentSupervisorTripId) {
        showToast('يرجى اختيار رحلة أولاً.', 'error');
        return;
    }

    const modal = document.getElementById('supervisor-scan-modal');
    if (!modal) return;

    // Load pickup points for this trip
    try {
        const pickupSelect = document.getElementById('scan-pickup-point-select');
        pickupSelect.innerHTML = '<option value="">جاري التحميل...</option>';

        const points = await window.tripsApi.listPickupPoints(currentSupervisorTripId);
        pickupSelect.innerHTML = '';
        if (Array.isArray(points) && points.length > 0) {
            points.forEach(p => {
                pickupSelect.innerHTML += `<option value="${p.id}">${p.name} (#${p.sequence})</option>`;
            });
        } else {
            // The scan endpoint validates the pickup point belongs to the trip
            // and matches the student's configured point — never fake an id.
            pickupSelect.innerHTML = '<option value="">لا توجد نقاط تجمع معرفة لهذه الرحلة</option>';
            pickupSelect.disabled = true;
            showToast('لا توجد نقاط تجمع لهذه الرحلة. اطلب من الإدارة تعيينها أولاً.', 'warning');
        }

        document.getElementById('scan-qr-token-input').value = '';
        modal.classList.remove('hidden');
    } catch (e) {
        showToast('تعذر تحميل نقاط التجمع للرحلة', 'error');
    }
}

async function handleSupervisorScanSubmit(e) {
    e.preventDefault();

    const qrToken = document.getElementById('scan-qr-token-input').value.trim();
    const direction = document.getElementById('scan-direction-select').value;
    const pickupPointId = parseInt(document.getElementById('scan-pickup-point-select').value);

    if (!qrToken) {
        showToast('يرجى إدخال أو مسح كود الـ QR الخاص بالطالب.', 'error');
        return;
    }
    if (!Number.isInteger(pickupPointId) || pickupPointId <= 0) {
        showToast('يرجى اختيار نقطة الركوب الصحيحة لهذه الرحلة.', 'error');
        return;
    }

    try {
        const res = await window.boardingApi.scan({
            qr_token: qrToken,
            trip_id: currentSupervisorTripId,
            direction: direction,
            pickup_point_id: pickupPointId
        });

        const studentName = res.student?.full_name || 'الطالب';
        // usage_days_this_week / remaining_usage_days_this_week هي أيام استخدام مميزة —
        // الذهاب والعودة في نفس اليوم = يوم واحد (QR_AND_BOARDING.md).
        const usageInfo = (res.usage_days_this_week != null && res.remaining_usage_days_this_week != null)
            ? ` • استخدام الأسبوع: ${res.usage_days_this_week} يوم • المتبقي: ${res.remaining_usage_days_this_week} يوم`
            : '';
        showToast(`تم تأكيد صعود الطالب (${studentName}) بنجاح!${usageInfo}`, 'success');
        closeModal('supervisor-scan-modal');
        loadSupervisorTripStudents();
        loadSupervisorTripRecords();
    } catch (err) {
        console.error('Scan error:', err);
    }
}

// ============================================================
// CEO DASHBOARD CONTROLLERS
// ============================================================
function switchCeoTab(tabId, btnElement) {
    const views = document.querySelectorAll('.ceo-subview');
    views.forEach(v => v.classList.add('hidden'));

    const buttons = document.querySelectorAll('.ceo-tab-btn');
    buttons.forEach(b => {
        b.className = "ceo-tab-btn w-full flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-bold transition-all text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800 border-0 text-right cursor-pointer bg-transparent";
    });

    const targetView = document.getElementById(`${tabId}-view`);
    if (targetView) targetView.classList.remove('hidden');

    if (btnElement) {
        btnElement.className = "ceo-tab-btn w-full flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-bold transition-all bg-brand-primary text-white border-0 text-right cursor-pointer";
    }

    // Lazy load tab data
    if (tabId === 'ceo-main') loadCeoDashboardData();
    else if (tabId === 'ceo-users') loadCeoUsers();
    else if (tabId === 'ceo-supervisors') loadCeoSupervisors();
    else if (tabId === 'ceo-universities') loadCeoUniversities();
    else if (tabId === 'ceo-buses') loadCeoBuses();
    else if (tabId === 'ceo-stations') loadCeoStations();
    else if (tabId === 'ceo-routes') loadCeoRoutes();
    else if (tabId === 'ceo-trips') loadCeoTrips();
    else if (tabId === 'ceo-payments') loadCeoPayments();
    else if (tabId === 'ceo-plans') loadCeoSubscriptionPlans();
    else if (tabId === 'ceo-boarding') loadCeoBoardingRecords();
}

// Helper functions for user status detection (UserStatus enum: ENUMS.md)
function isUserInactive(u) {
    if (!u) return false;
    const statusStr = (u.status || '').toString().trim().toUpperCase();
    if (statusStr === 'INACTIVE' || statusStr === 'REJECTED') {
        return true;
    }
    if (u.is_active === false) return true;
    return false;
}

function isUserActive(u) {
    if (!u) return false;
    if (isUserInactive(u)) return false;
    const statusStr = (u.status || '').toString().trim().toUpperCase();
    // NOTE: 'ACTIVE' is a legacy input alias only — the API always returns APPROVED.
    if (statusStr === 'APPROVED') return true;
    return false;
}

function isUserPending(u) {
    if (!u) return false;
    return (u.status || '').toString().trim().toUpperCase() === 'PENDING';
}

let ceoLoadedUsersList = [];

async function loadCeoDashboardData() {
    try {
        const [usersRes, pendingUsersRes, busesRes, tripsRes, subsRes] = await Promise.allSettled([
            window.usersApi.list({ page_size: 100 }),
            window.usersApi.listPending({ page_size: 100 }),
            window.busesApi.list({ page_size: 1 }),
            window.tripsApi.list({ page_size: 1 }),
            window.subscriptionsApi.listAll({ page_size: 1 })
        ]);

        const allUsersRaw = usersRes.status === 'fulfilled' ? usersRes.value : null;
        const allUsers = Array.isArray(allUsersRaw) ? allUsersRaw : (allUsersRaw?.items || allUsersRaw?.data || allUsersRaw?.users || []);
        const totalUsers = (allUsersRaw && typeof allUsersRaw.total === 'number') ? allUsersRaw.total : allUsers.length;

        // Pending count comes from the dedicated GET /users/pending queue (status=PENDING)
        const pendingUsersRaw = pendingUsersRes.status === 'fulfilled' ? pendingUsersRes.value : null;
        const pendingUsers = Array.isArray(pendingUsersRaw) ? pendingUsersRaw : (pendingUsersRaw?.items || pendingUsersRaw?.data || pendingUsersRaw?.users || []);
        
        // Combine to find all unique pending users
        const combined = [...allUsers, ...pendingUsers];
        const uniqueUsersMap = new Map();
        combined.forEach(u => { if (u && u.id) uniqueUsersMap.set(u.id, u); });
        const allUniqueUsers = Array.from(uniqueUsersMap.values());

        const pendingCount = allUniqueUsers.filter(u => isUserPending(u) && (u.role || '').toUpperCase() === 'STUDENT').length;

        const busesCount = busesRes.status === 'fulfilled' ? (busesRes.value?.total ?? (Array.isArray(busesRes.value) ? busesRes.value.length : 0)) : 0;
        const tripsCount = tripsRes.status === 'fulfilled' ? (tripsRes.value?.total ?? (Array.isArray(tripsRes.value) ? tripsRes.value.length : 0)) : 0;
        const subsCount = subsRes.status === 'fulfilled' ? (subsRes.value?.total ?? (Array.isArray(subsRes.value) ? subsRes.value.length : 0)) : 0;

        const statUsers = document.getElementById('stat-ceo-users-count');
        if (statUsers) statUsers.innerText = totalUsers;

        const statPending = document.getElementById('stat-ceo-pending-count');
        if (statPending) statPending.innerText = pendingCount;

        const statBuses = document.getElementById('stat-ceo-buses-count');
        if (statBuses) statBuses.innerText = busesCount;

        const statTrips = document.getElementById('stat-ceo-trips-count');
        if (statTrips) statTrips.innerText = tripsCount;

        const statSubs = document.getElementById('stat-ceo-subs-count');
        if (statSubs) statSubs.innerText = subsCount;

        // Update sidebar pending badge
        const badgeElem = document.getElementById('ceo-pending-badge');
        if (badgeElem) {
            if (pendingCount > 0) {
                badgeElem.innerText = `${pendingCount} جديد`;
                badgeElem.classList.remove('hidden');
            } else {
                badgeElem.classList.add('hidden');
            }
        }
    } catch (e) {
        console.warn('Could not load CEO overview metrics:', e);
    }
}

// 1. CEO: Users Management
async function loadCeoUsers() {
    const tbody = document.getElementById('ceo-users-tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6" class="p-6 text-center text-slate-400"><i class="fa-solid fa-spinner fa-spin"></i> جاري تحميل المستخدمين والطلاب...</td></tr>';

    const roleFilter = document.getElementById('ceo-users-role-filter')?.value || null;
    const statusFilter = document.getElementById('ceo-users-status-filter')?.value || '';

    try {
        const params = { page_size: 100 };
        if (roleFilter) params.role = roleFilter;
        if (statusFilter === 'active') params.status = 'APPROVED';

        // The "inactive" UI bucket covers both INACTIVE and REJECTED accounts
        const [primaryRes, pendingRes, rejectedRes] = await Promise.allSettled([
            window.usersApi.list(statusFilter === 'inactive' ? { ...params, status: 'INACTIVE' } : params),
            (statusFilter === '' || statusFilter === 'pending') ? window.usersApi.listPending({ page_size: 100 }) : Promise.resolve(null),
            statusFilter === 'inactive' ? window.usersApi.list({ ...params, status: 'REJECTED' }) : Promise.resolve(null)
        ]);

        const primaryRaw = primaryRes.status === 'fulfilled' ? primaryRes.value : null;
        let primaryItems = Array.isArray(primaryRaw) ? primaryRaw : (primaryRaw?.items || primaryRaw?.data || primaryRaw?.users || []);

        let pendingItems = [];
        if (pendingRes.status === 'fulfilled' && pendingRes.value) {
            const raw = pendingRes.value;
            pendingItems = Array.isArray(raw) ? raw : (raw?.items || raw?.data || raw?.users || []);
        }

        let rejectedItems = [];
        if (rejectedRes.status === 'fulfilled' && rejectedRes.value) {
            const raw = rejectedRes.value;
            rejectedItems = Array.isArray(raw) ? raw : (raw?.items || raw?.data || raw?.users || []);
        }

        // Merge and deduplicate by user ID
        const mergedMap = new Map();
        [...primaryItems, ...pendingItems, ...rejectedItems].forEach(u => {
            if (u && u.id) mergedMap.set(u.id, u);
        });
        let items = Array.from(mergedMap.values());

        // Store globally for instant search
        ceoLoadedUsersList = items;

        filterCeoUsersList();
    } catch (e) {
        console.error('Load CEO users error:', e);
        tbody.innerHTML = '<tr><td colspan="6" class="p-6 text-center text-rose-500 font-bold">تعذر تحميل بيانات المستخدمين من السيرفر</td></tr>';
    }
}

// Helper function to resolve university name dynamically
function getUniversityName(u) {
    if (!u) return 'غير محدد';
    if (u.university && typeof u.university === 'object' && u.university.name) {
        return u.university.name;
    }
    if (u.university_name && typeof u.university_name === 'string') {
        return u.university_name;
    }
    if (typeof u.university === 'string' && u.university.trim() && isNaN(u.university)) {
        return u.university;
    }
    const uniId = u.university_id || u.universityId || (typeof u.university === 'number' ? u.university : parseInt(u.university));
    if (uniId && !isNaN(uniId)) {
        const found = cachedUniversities.find(uni => uni.id === parseInt(uniId) || uni.id === uniId);
        if (found && found.name) return found.name;
        return `جامعة #${uniId}`;
    }
    return 'غير محدد';
}

function filterCeoUsersList() {
    const tbody = document.getElementById('ceo-users-tbody');
    if (!tbody) return;

    const roleFilter = document.getElementById('ceo-users-role-filter')?.value || '';
    const statusFilter = document.getElementById('ceo-users-status-filter')?.value || '';
    const searchQuery = (document.getElementById('ceo-users-search')?.value || '').trim().toLowerCase();

    let items = [...ceoLoadedUsersList];

    // Filter by Role
    if (roleFilter) {
        items = items.filter(u => (u.role || '').toString().toUpperCase() === roleFilter.toUpperCase());
    }

    // Filter by Status
    if (statusFilter === 'pending') {
        items = items.filter(u => isUserPending(u));
    } else if (statusFilter === 'active') {
        items = items.filter(u => isUserActive(u));
    } else if (statusFilter === 'inactive') {
        items = items.filter(u => isUserInactive(u));
    }

    // Filter by Search Query (Name, Phone, Faculty, or University)
    if (searchQuery) {
        items = items.filter(u => {
            const name = (u.full_name || '').toLowerCase();
            const phone = (u.phone_number || '').toLowerCase();
            const faculty = (u.faculty || '').toLowerCase();
            const uni = getUniversityName(u).toLowerCase();
            return name.includes(searchQuery) || phone.includes(searchQuery) || faculty.includes(searchQuery) || uni.includes(searchQuery);
        });
    }

    // Sort: Pending users always at the top, then by ID descending (newest first)
    items.sort((a, b) => {
        const aPending = isUserPending(a);
        const bPending = isUserPending(b);
        if (aPending && !bPending) return -1;
        if (!aPending && bPending) return 1;
        return (b.id || 0) - (a.id || 0);
    });

    // Update Summary Badge
    const pendingCount = ceoLoadedUsersList.filter(u => isUserPending(u) && (u.role || '').toUpperCase() === 'STUDENT').length;
    const badgeSummary = document.getElementById('ceo-users-summary-badge');
    if (badgeSummary) {
        badgeSummary.innerText = `الكل: ${ceoLoadedUsersList.length} | قيد المراجعة: ${pendingCount}`;
        if (pendingCount > 0) {
            badgeSummary.className = 'text-[11px] font-black px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-600 border border-amber-500/30 animate-pulse';
        } else {
            badgeSummary.className = 'text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500';
        }
    }

    // Update sidebar badge
    const sidebarBadge = document.getElementById('ceo-pending-badge');
    if (sidebarBadge) {
        if (pendingCount > 0) {
            sidebarBadge.innerText = `${pendingCount} جديد`;
            sidebarBadge.classList.remove('hidden');
        } else {
            sidebarBadge.classList.add('hidden');
        }
    }

    renderCeoUsersTable(items);
}

function renderCeoUsersTable(items) {
    const tbody = document.getElementById('ceo-users-tbody');
    if (!tbody) return;

    if (items.length > 0) {
        tbody.innerHTML = '';
        items.forEach(u => {
            const isPending = isUserPending(u);
            const isActive = isUserActive(u);
            const isInactive = isUserInactive(u);
            const userRole = (u.role || 'STUDENT').toString().toUpperCase();
            const uniName = getUniversityName(u);
            const facultyInfo = u.faculty ? `${u.faculty} ${u.academic_year ? `(${u.academic_year})` : ''}` : 'غير محدد';

            tbody.innerHTML += `
                <tr class="transition ${isPending ? 'bg-amber-500/5 hover:bg-amber-500/10 border-r-4 border-r-amber-500' : 'hover:bg-slate-50/50 dark:hover:bg-slate-950/20'}">
                    <td class="p-4">
                        <div class="flex items-center gap-2">
                            <span class="font-black text-slate-800 dark:text-white">${u.full_name || 'بدون اسم'}</span>
                            ${isPending ? '<span class="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-500/20 text-amber-600 dark:text-amber-400 rounded-md text-[10px] font-black border border-amber-500/30"><i class="fa-solid fa-clock"></i> قيد المراجعة</span>' : ''}
                        </div>
                        <div class="text-[10px] text-slate-400 mt-0.5">معرف الحساب: #${u.id}</div>
                    </td>
                    <td class="p-4 font-mono font-bold text-slate-600 dark:text-slate-300" dir="ltr">${u.phone_number || '--'}</td>
                    <td class="p-4">
                        <span class="px-2 py-0.5 rounded-md text-[10px] font-black ${
                            userRole === 'CEO' ? 'bg-purple-500/15 text-purple-500' :
                            userRole === 'SUPERVISOR' ? 'bg-blue-500/15 text-blue-500' : 'bg-slate-500/15 text-slate-500 dark:text-slate-300'
                        }">
                            ${userRole === 'STUDENT' ? 'طالب (STUDENT)' : (userRole === 'SUPERVISOR' ? 'مشرف (SUPERVISOR)' : userRole)}
                        </span>
                    </td>
                    <td class="p-4">
                        <div class="inline-flex items-center gap-1.5 font-bold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800/80 px-2.5 py-1 rounded-lg text-xs">
                            <i class="fa-solid fa-graduation-cap text-[#0B5DAA] dark:text-[#6AB9FF]"></i>
                            <span>${uniName}</span>
                        </div>
                    </td>
                    <td class="p-4 text-xs font-bold text-slate-600 dark:text-slate-400">${facultyInfo}</td>
                    <td class="p-4">
                        <span class="px-2.5 py-1 rounded-full text-[10px] font-black inline-flex items-center gap-1.5 ${
                            isActive 
                                ? 'bg-emerald-500/15 text-emerald-500 border border-emerald-500/20' 
                                : (isPending 
                                    ? 'bg-amber-500/15 text-amber-500 border border-amber-500/30' 
                                    : 'bg-rose-500/15 text-rose-500 border border-rose-500/20')
                        }">
                            ${isActive ? '<i class="fa-solid fa-circle-check"></i> معتمد ونشط' : (isPending ? '<i class="fa-solid fa-hourglass-half"></i> بانتظار الاعتماد (Pending)' : '<i class="fa-solid fa-ban"></i> غير نشط (Inactive / معطل)')}
                        </span>
                    </td>
                    <td class="p-4 text-center">
                        <div class="flex items-center justify-center gap-1.5 flex-wrap">
                            <button onclick="viewCeoUserDetails(${u.id})" title="عرض تفاصيل الحساب والكارنيه" class="bg-blue-500/10 text-blue-500 hover:bg-blue-500 hover:text-white font-bold text-[10px] px-2.5 py-1.5 rounded-lg fast-transition border-0 cursor-pointer flex items-center gap-1">
                                <i class="fa-solid fa-id-card"></i> الكارنيه / الملف
                            </button>
                            ${isPending ? `
                                <button onclick="confirmCeoUser(${u.id})" title="اعتماد وتأكيد الحساب" class="bg-emerald-500 text-white hover:bg-emerald-600 font-bold text-[10px] px-3 py-1.5 rounded-lg fast-transition shadow-sm border-0 cursor-pointer flex items-center gap-1">
                                    <i class="fa-solid fa-check"></i> اعتماد الحساب
                                </button>
                                <button onclick="rejectCeoUser(${u.id})" title="رفض الحساب" class="bg-rose-500/10 text-rose-500 hover:bg-rose-500 hover:text-white font-bold text-[10px] px-2.5 py-1.5 rounded-lg fast-transition border-0 cursor-pointer flex items-center gap-1">
                                    <i class="fa-solid fa-xmark"></i> رفض
                                </button>
                            ` : (isActive ? `
                                <button onclick="rejectCeoUser(${u.id})" title="تعطيل أو إلغاء اعتماد الحساب" class="bg-rose-500/10 text-rose-500 hover:bg-rose-500 hover:text-white font-bold text-[10px] px-2.5 py-1.5 rounded-lg fast-transition border-0 cursor-pointer flex items-center gap-1">
                                    <i class="fa-solid fa-ban"></i> تعطيل
                                </button>
                            ` : `
                                <button onclick="confirmCeoUser(${u.id})" title="إعادة تفعيل الحساب" class="bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500 hover:text-white font-bold text-[10px] px-2.5 py-1.5 rounded-lg fast-transition border-0 cursor-pointer flex items-center gap-1">
                                    <i class="fa-solid fa-rotate-left"></i> تفعيل
                                </button>
                            `)}
                        </div>
                    </td>
                </tr>
            `;
        });
    } else {
        tbody.innerHTML = '<tr><td colspan="7" class="p-6 text-center text-slate-400 font-bold">لا يوجد مستخدمين مطابقين للبحث أو الفلتر المحدد</td></tr>';
    }
}

async function confirmCeoUser(userId) {
    try {
        const user = ceoLoadedUsersList.find(u => u.id === userId);
        if (user && isUserInactive(user)) {
            // REJECTED accounts cannot be re-approved (USERS.md §1) — only
            // INACTIVE ones can be reactivated via the status endpoint.
            if ((user.status || '').toUpperCase() === 'REJECTED') {
                showToast('الحسابات المرفوضة لا يمكن اعتمادها مرة أخرى من النظام.', 'error');
                return;
            }
            await window.usersApi.updateStatus(userId, true);
        } else {
            await window.usersApi.approve(userId);
        }
        showToast('تم اعتماد وتأكيد حساب الطالب بنجاح! يمكنه الآن تسجيل الدخول وحجز الرحلات.', 'success');
        loadCeoUsers();
        loadCeoDashboardData();
    } catch (e) {
        console.error('Confirm user error:', e);
    }
}

async function rejectCeoUser(userId) {
    try {
        const user = ceoLoadedUsersList.find(u => u.id === userId);
        if (isUserPending(user)) {
            await window.usersApi.reject(userId);
            showToast('تم رفض طلب التسجيل بنجاح.', 'info');
        } else if (isUserActive(user)) {
            await window.usersApi.updateStatus(userId, false);
            showToast('تم تعطيل الحساب بنجاح.', 'info');
        } else {
            showToast('لا يمكن رفض أو تعطيل حساب مرفوض بالفعل.', 'error');
            return;
        }
        loadCeoUsers();
        loadCeoDashboardData();
    } catch (e) {
        console.error('Reject user error:', e);
    }
}

async function viewCeoUserDetails(userId) {
    try {
        const user = await window.usersApi.getById(userId);
        if (!user) return;

        const isPending = isUserPending(user);
        const isActive = isUserActive(user);
        const isInactive = isUserInactive(user);

        document.getElementById('det-name').innerText = user.full_name || '--';
        document.getElementById('det-phone').innerText = user.phone_number || '--';
        document.getElementById('det-role').innerText = user.role || '--';
        document.getElementById('det-gender').innerText = user.gender === 'MALE' ? 'ذكر' : 'أنثى';
        const detUni = document.getElementById('det-university');
        if (detUni) {
            detUni.innerHTML = `<i class="fa-solid fa-graduation-cap"></i> <span>${getUniversityName(user)}</span>`;
        }
        document.getElementById('det-faculty').innerText = `${user.faculty || '--'} (${user.academic_year || '--'})`;
        
        const statusElem = document.getElementById('det-phone-verified');
        if (statusElem) {
            statusElem.innerHTML = isActive 
                ? '<span class="text-emerald-500 font-black">🟢 معتمد ونشط</span>' 
                : (isPending 
                    ? '<span class="text-amber-500 font-black">🟡 قيد المراجعة والاعتماد (Pending)</span>' 
                    : '<span class="text-rose-500 font-black">🔴 غير نشط (Inactive / معطل)</span>');
        }

        // Actions
        const actionsElem = document.getElementById('det-modal-actions');
        if (actionsElem) {
            if (isPending) {
                actionsElem.innerHTML = `
                    <button onclick="confirmCeoUser(${user.id}); closeModal('view-student-modal');" class="flex-1 bg-emerald-500 hover:bg-emerald-600 text-white font-bold py-2.5 rounded-xl text-xs border-0 cursor-pointer shadow-md flex items-center justify-center gap-1.5">
                        <i class="fa-solid fa-check"></i> تأكيد واعتماد الحساب
                    </button>
                    <button onclick="rejectCeoUser(${user.id}); closeModal('view-student-modal');" class="flex-1 bg-rose-500/10 hover:bg-rose-500 hover:text-white text-rose-500 font-bold py-2.5 rounded-xl text-xs border-0 cursor-pointer flex items-center justify-center gap-1.5">
                        <i class="fa-solid fa-xmark"></i> رفض الطلب
                    </button>
                `;
            } else if (isActive) {
                actionsElem.innerHTML = `
                    <button onclick="rejectCeoUser(${user.id}); closeModal('view-student-modal');" class="flex-1 bg-rose-500 hover:bg-rose-600 text-white font-bold py-2.5 rounded-xl text-xs border-0 cursor-pointer shadow-md flex items-center justify-center gap-1.5">
                        <i class="fa-solid fa-ban"></i> إلغاء الاعتماد / تعطيل الحساب
                    </button>
                `;
            } else {
                actionsElem.innerHTML = `
                    <button onclick="confirmCeoUser(${user.id}); closeModal('view-student-modal');" class="flex-1 bg-emerald-500 hover:bg-emerald-600 text-white font-bold py-2.5 rounded-xl text-xs border-0 cursor-pointer shadow-md flex items-center justify-center gap-1.5">
                        <i class="fa-solid fa-rotate-left"></i> إعادة تفعيل الحساب
                    </button>
                `;
            }
        }

        // Card image & open link
        const imgElem = document.getElementById('det-card-img');
        const fallbackElem = document.getElementById('det-card-fallback');
        const openLink = document.getElementById('det-card-open-link');

        if ((user.role || '').toUpperCase() === 'STUDENT') {
            try {
                const blob = await window.usersApi.getIdCard(userId);
                if (blob instanceof Blob) {
                    const objectUrl = URL.createObjectURL(blob);
                    imgElem.src = objectUrl;
                    imgElem.classList.remove('hidden');
                    fallbackElem.classList.add('hidden');
                    if (openLink) {
                        openLink.href = objectUrl;
                        openLink.classList.remove('hidden');
                    }
                } else {
                    imgElem.classList.add('hidden');
                    fallbackElem.innerText = 'لا توجد صورة كارنيه أو بطاقة ترشح متاحة';
                    fallbackElem.classList.remove('hidden');
                    if (openLink) openLink.classList.add('hidden');
                }
            } catch (err) {
                imgElem.classList.add('hidden');
                fallbackElem.innerText = 'صورة الكارنيه / بطاقة الترشح غير متوفرة أو محفوظة كمرجع محلي';
                fallbackElem.classList.remove('hidden');
                if (openLink) openLink.classList.add('hidden');
            }
        } else {
            imgElem.classList.add('hidden');
            fallbackElem.innerText = 'لا يتطلب رفع كارنيه لهذا الحساب';
            fallbackElem.classList.remove('hidden');
            if (openLink) openLink.classList.add('hidden');
        }

        const modal = document.getElementById('view-student-modal');
        if (modal) modal.classList.remove('hidden');
    } catch (e) {
        showToast('تعذر جلب تفاصيل المستخدم', 'error');
    }
}

async function toggleUserStatus(userId, currentStatus) {
    try {
        await window.usersApi.updateStatus(userId, !currentStatus);
        showToast(`تم ${currentStatus ? 'تعطيل' : 'تنشيط'} الحساب بنجاح.`, 'success');
        loadCeoUsers();
        loadCeoDashboardData();
    } catch (e) {
        console.error('Toggle status error:', e);
    }
}

// 2. CEO: Supervisors Management
async function loadCeoSupervisors() {
    const tbody = document.getElementById('ceo-supervisors-tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="5" class="p-6 text-center text-slate-400"><i class="fa-solid fa-spinner fa-spin"></i> جاري التحميل...</td></tr>';

    try {
        const res = await window.usersApi.list({ role: 'SUPERVISOR', page_size: 50 });
        const items = res?.items || [];

        if (items.length > 0) {
            tbody.innerHTML = '';
            items.forEach(s => {
                tbody.innerHTML += `
                    <tr class="hover:bg-slate-50/50 dark:hover:bg-slate-950/20 transition">
                        <td class="p-4 font-black text-slate-800 dark:text-white">${s.full_name}</td>
                        <td class="p-4 font-mono font-bold text-slate-600 dark:text-slate-300">${s.phone_number}</td>
                        <td class="p-4 font-bold text-slate-500">${s.gender === 'MALE' ? 'ذكر' : 'أنثى'}</td>
                        <td class="p-4 font-bold text-emerald-500">${s.is_active ? 'نشط' : 'معطل'}</td>
                        <td class="p-4 text-center">
                            <button onclick="toggleUserStatus(${s.id}, ${s.is_active})" class="text-rose-500 hover:underline font-bold text-xs bg-transparent border-0 cursor-pointer">
                                ${s.is_active ? 'تعطيل' : 'تفعيل'}
                            </button>
                        </td>
                    </tr>
                `;
            });
        } else {
            tbody.innerHTML = '<tr><td colspan="5" class="p-6 text-center text-slate-400 font-bold">لا يوجد مشرفين مسجلين</td></tr>';
        }
    } catch (e) {
        tbody.innerHTML = '<tr><td colspan="5" class="p-6 text-center text-rose-500 font-bold">تعذر تحميل المشرفين</td></tr>';
    }
}

function openAddSupervisorModal() {
    document.getElementById('new-sup-name').value = '';
    document.getElementById('new-sup-phone').value = '';
    document.getElementById('new-sup-pass').value = '';
    const modal = document.getElementById('add-supervisor-modal');
    if (modal) modal.classList.remove('hidden');
}

async function handleCreateSupervisorSubmit(e) {
    e.preventDefault();
    const name = document.getElementById('new-sup-name').value;
    const phone = document.getElementById('new-sup-phone').value;
    const pass = document.getElementById('new-sup-pass').value;
    const gender = document.getElementById('new-sup-gender').value;

    try {
        await window.usersApi.createSupervisor({
            full_name: name,
            phone_number: phone,
            password: pass,
            gender: gender
        });
        showToast('تم إنشاء حساب المشرف بنجاح!', 'success');
        closeModal('add-supervisor-modal');
        loadCeoSupervisors();
    } catch (err) {
        console.error('Create supervisor error:', err);
    }
}

// 3. CEO: Universities Management
async function loadCeoUniversities() {
    const tbody = document.getElementById('ceo-universities-tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="4" class="p-6 text-center text-slate-400"><i class="fa-solid fa-spinner fa-spin"></i> جاري التحميل...</td></tr>';

    try {
        const res = await window.universitiesApi.list({ page_size: 50 });
        const items = res?.items || [];

        if (items.length > 0) {
            tbody.innerHTML = '';
            items.forEach(u => {
                const isAct = u.is_active;
                const createdDate = new Date(u.created_at).toLocaleDateString('ar-EG');
                tbody.innerHTML += `
                    <tr class="hover:bg-slate-50/50 dark:hover:bg-slate-950/20 transition">
                        <td class="p-4 font-black text-slate-800 dark:text-white">${u.name}</td>
                        <td class="p-4">
                            <span class="px-2.5 py-1 rounded-full text-[10px] font-black ${isAct ? 'bg-emerald-500/15 text-emerald-500' : 'bg-rose-500/15 text-rose-500'}">
                                ${isAct ? 'نشطة' : 'متوقفة'}
                            </span>
                        </td>
                        <td class="p-4 font-mono text-slate-400">${createdDate}</td>
                        <td class="p-4 text-center space-x-1 flex items-center justify-center gap-2">
                            <button onclick="editUniversity(${u.id}, '${u.name}')" class="text-blue-500 hover:underline font-bold text-xs bg-transparent border-0 cursor-pointer"><i class="fa-solid fa-pen"></i> تعديل</button>
                            <button onclick="deleteUniversity(${u.id})" class="text-rose-500 hover:underline font-bold text-xs bg-transparent border-0 cursor-pointer"><i class="fa-solid fa-trash"></i> حذف</button>
                        </td>
                    </tr>
                `;
            });
        } else {
            tbody.innerHTML = '<tr><td colspan="4" class="p-6 text-center text-slate-400 font-bold">لا توجد جامعات مسجلة بالنظام</td></tr>';
        }
    } catch (e) {
        tbody.innerHTML = '<tr><td colspan="4" class="p-6 text-center text-rose-500 font-bold">تعذر تحميل الجامعات</td></tr>';
    }
}

function openAddUniversityModal() {
    document.getElementById('uni-edit-id').value = '';
    document.getElementById('uni-name-input').value = '';
    const modal = document.getElementById('add-university-modal');
    if (modal) modal.classList.remove('hidden');
}

function editUniversity(id, name) {
    document.getElementById('uni-edit-id').value = id;
    document.getElementById('uni-name-input').value = name;
    const modal = document.getElementById('add-university-modal');
    if (modal) modal.classList.remove('hidden');
}

async function handleSaveUniversitySubmit(e) {
    e.preventDefault();
    const id = document.getElementById('uni-edit-id').value;
    const name = document.getElementById('uni-name-input').value;

    try {
        if (id) {
            await window.universitiesApi.update(id, { name: name });
            showToast('تم تعديل اسم الجامعة بنجاح.', 'success');
        } else {
            await window.universitiesApi.create({ name: name });
            showToast('تمت إضافة الجامعة بنجاح.', 'success');
        }
        closeModal('add-university-modal');
        await loadInitialPublicData();
        loadCeoUniversities();
    } catch (err) {
        console.error('Save university error:', err);
    }
}

async function deleteUniversity(id) {
    if (!confirm('هل أنت متأكد من حذف هذه الجامعة؟')) return;
    try {
        await window.universitiesApi.delete(id);
        showToast('تم حذف الجامعة بنجاح.', 'success');
        await loadInitialPublicData();
        loadCeoUniversities();
    } catch (err) {
        console.error('Delete university error:', err);
    }
}

// 4. CEO: Buses Fleet Management & Bus Image Support
//
// Bus images live in a PRIVATE backend bucket (BUSES.md §3). image_url is an
// internal storage reference — never a fetchable URL. Display goes through
// GET /buses/{id}/image/metadata + GET /buses/{id}/image (authorized blob).
function revokeBusImageUrls() {
    activeBusImageUrls.forEach(url => URL.revokeObjectURL(url));
    activeBusImageUrls.clear();
}

function handleBusImageSelect(input) {
    // Preview elements are scoped to the input's own modal to avoid duplicate IDs
    // across the add-bus modal and the replace-image modal.
    const scope = input.closest('.glass-card') || document;
    const previewContainer = scope.querySelector('.bus-image-preview-container');
    const previewImg = scope.querySelector('.bus-image-preview-img');

    if (!input.files || input.files.length === 0) {
        if (previewContainer) previewContainer.classList.add('hidden');
        return;
    }

    const file = input.files[0];
    // Client-side pre-check mirrors FILE_UPLOADS.md (server remains authoritative)
    const okExt = /\.(jpe?g|png|webp)$/i.test(file.name);
    const okMime = ['image/jpeg', 'image/png', 'image/webp'].includes(file.type);
    if (!okExt || !okMime) {
        showToast('صيغة الصورة غير مدعومة. المسموح: JPG / PNG / WEBP.', 'error');
        input.value = '';
        if (previewContainer) previewContainer.classList.add('hidden');
        return;
    }
    if (file.size > 5 * 1024 * 1024) {
        showToast('حجم الصورة يتجاوز الحد الأقصى 5 ميجابايت.', 'error');
        input.value = '';
        if (previewContainer) previewContainer.classList.add('hidden');
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        if (previewImg) previewImg.src = e.target.result;
        if (previewContainer) previewContainer.classList.remove('hidden');
    };
    reader.readAsDataURL(file);
}

function clearBusImagePreview() {
    const fileInput = document.getElementById('new-bus-image-file');
    // Clear previews in every modal (add-bus + replace-image)
    document.querySelectorAll('.bus-image-preview-container').forEach(c => c.classList.add('hidden'));
    document.querySelectorAll('.bus-image-preview-img').forEach(img => { img.src = ''; });
    if (fileInput) fileInput.value = '';
    const replaceInput = document.getElementById('bus-image-replace-file');
    if (replaceInput) replaceInput.value = '';
}

/**
 * Fetch the authorized bus image (blob) and attach it to the card's <img>.
 * Handles the "no image" case (404 from the stream endpoint) as a placeholder.
 */
async function attachBusImage(busId, imgElement, placeholderContainer) {
    try {
        const meta = await window.busesApi.getImageMetadata(busId);
        if (!meta || meta.has_image !== true || !imgElement) return;

        const blob = await window.busesApi.getImage(busId);
        if (blob instanceof Blob) {
            const objectUrl = URL.createObjectURL(blob);
            activeBusImageUrls.add(objectUrl);
            imgElement.src = objectUrl;
            imgElement.classList.remove('hidden');
            if (placeholderContainer) placeholderContainer.classList.add('hidden');
        }
    } catch (e) {
        // 404 = no image (or no relationship) — leave the placeholder in place.
        console.warn(`No bus image displayed for bus #${busId}:`, e?.message);
    }
}

async function loadCeoBuses() {
    const grid = document.getElementById('ceo-buses-grid');
    if (!grid) return;
    grid.innerHTML = '<div class="col-span-3 text-center py-10 text-slate-400"><i class="fa-solid fa-spinner fa-spin"></i> جاري تحميل أسطول الباصات...</div>';

    try {
        const res = await window.busesApi.list({ page_size: 50 });
        const items = res?.items || (Array.isArray(res) ? res : []);
        cachedBuses = items;
        revokeBusImageUrls();

        if (items.length > 0) {
            grid.innerHTML = '';
            items.forEach(bus => {
                const statusColors = {
                    ACTIVE: 'bg-emerald-500/15 text-emerald-500 border border-emerald-500/30',
                    INACTIVE: 'bg-slate-500/15 text-slate-400 border border-slate-500/30',
                    MAINTENANCE: 'bg-amber-500/15 text-amber-500 border border-amber-500/30'
                };
                const statusLabels = {
                    ACTIVE: 'نشط',
                    INACTIVE: 'معطل',
                    MAINTENANCE: 'في الصيانة'
                };

                grid.innerHTML += `
                    <div class="glass-card rounded-3xl overflow-hidden hover:scale-[1.02] transition border border-slate-200/50 dark:border-slate-800/50 shadow-md flex flex-col justify-between">
                        <div class="relative w-full h-40 bg-slate-900 overflow-hidden group">
                            <div class="w-full h-full flex items-center justify-center text-4xl" data-bus-image-placeholder="${bus.id}">🚌</div>
                            <img src="" alt="${bus.bus_number}" data-bus-image="${bus.id}" class="hidden absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-300">
                            <div class="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/20 pointer-events-none"></div>
                            <span class="absolute top-3 right-3 px-2.5 py-1 rounded-full text-[10px] font-black backdrop-blur-md ${statusColors[bus.status] || 'bg-slate-500/50 text-white'}">
                                ${statusLabels[bus.status] || bus.status}
                            </span>
                            <span class="absolute bottom-2 right-3 font-black text-white text-sm drop-shadow-md flex items-center gap-1.5">
                                <i class="fa-solid fa-bus text-[#6AB9FF]"></i> ${bus.bus_number || `باص #${bus.id}`}
                            </span>
                        </div>
                        <div class="p-6 pt-3 space-y-3 flex-1 flex flex-col justify-between">
                            <div>
                                <p class="text-xs text-slate-400 font-bold mt-1">اللوحة: <span class="font-mono text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-lg">${bus.license_plate}</span></p>
                                <p class="text-[11px] text-slate-400 font-bold mt-1">السعة: ${bus.capacity} مقعد • الموديل: ${bus.model || 'سياحي'}${bus.year ? ` • ${bus.year}` : ''}</p>
                            </div>
                            <div class="flex gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
                                <select onchange="updateBusStatus(${bus.id}, this.value)" class="flex-1 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-2 py-1.5 text-[10px] font-bold">
                                    <option value="ACTIVE" ${bus.status === 'ACTIVE' ? 'selected' : ''}>نشط</option>
                                    <option value="MAINTENANCE" ${bus.status === 'MAINTENANCE' ? 'selected' : ''}>صيانة</option>
                                    <option value="INACTIVE" ${bus.status === 'INACTIVE' ? 'selected' : ''}>إيقاف</option>
                                </select>
                                <button onclick="openReplaceBusImageModal(${bus.id}, '${(bus.bus_number || '').replace(/'/g, "\\'")}', ${bus.image_url ? 'true' : 'false'})" title="تغيير / حذف صورة الحافلة" class="bg-blue-500/10 text-blue-500 hover:bg-blue-500 hover:text-white p-2 rounded-xl text-xs border-0 cursor-pointer fast-transition">
                                    <i class="fa-solid fa-image"></i>
                                </button>
                                <button onclick="deleteBus(${bus.id})" title="حذف الحافلة" class="bg-rose-500/10 text-rose-500 hover:bg-rose-500 hover:text-white p-2 rounded-xl text-xs border-0 cursor-pointer fast-transition">
                                    <i class="fa-solid fa-trash"></i>
                                </button>
                            </div>
                        </div>
                    </div>
                `;
            });

            // Load authorized images asynchronously (metadata → blob stream)
            items.forEach(bus => {
                const img = grid.querySelector(`[data-bus-image="${bus.id}"]`);
                const placeholder = grid.querySelector(`[data-bus-image-placeholder="${bus.id}"]`);
                if (img && placeholder) {
                    attachBusImage(bus.id, img, placeholder);
                }
            });
        } else {
            grid.innerHTML = '<div class="col-span-3 text-center py-10 text-slate-400 font-bold">لا توجد حافلات مسجلة بالأسطول</div>';
        }
    } catch (e) {
        grid.innerHTML = '<div class="col-span-3 text-center py-10 text-rose-500 font-bold">تعذر تحميل أسطول الباصات</div>';
    }
}

function openAddBusModal() {
    document.getElementById('bus-edit-id').value = '';
    document.getElementById('new-bus-number').value = '';
    document.getElementById('new-bus-plate').value = '';
    document.getElementById('new-bus-capacity').value = '50';
    document.getElementById('new-bus-model').value = '';
    document.getElementById('new-bus-year').value = '2024';
    clearBusImagePreview();
    const modal = document.getElementById('add-bus-modal');
    if (modal) modal.classList.remove('hidden');
}

async function handleSaveBusSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('bus-edit-id').value;
    const busNumber = document.getElementById('new-bus-number').value;
    const plate = document.getElementById('new-bus-plate').value;
    const cap = parseInt(document.getElementById('new-bus-capacity').value);
    const model = document.getElementById('new-bus-model').value;
    const yearInput = document.getElementById('new-bus-year').value;
    const year = yearInput ? parseInt(yearInput) : null;
    const fileInput = document.getElementById('new-bus-image-file');
    const imageFile = (fileInput && fileInput.files && fileInput.files.length > 0) ? fileInput.files[0] : null;

    try {
        const payload = {
            bus_number: busNumber,
            license_plate: plate,
            capacity: cap,
            model: model,
            year: year
        };

        if (id) {
            await window.busesApi.update(id, payload);
            showToast('تم تعديل بيانات الحافلة بنجاح.', 'success');
        } else {
            // multipart/form-data when an image is included, JSON otherwise
            await window.busesApi.create(payload, imageFile);
            showToast('تمت إضافة الحافلة للأسطول بنجاح.', 'success');
        }
        clearBusImagePreview();
        closeModal('add-bus-modal');
        loadCeoBuses();
    } catch (err) {
        console.error('Save bus error:', err);
    }
}

// ---- Replace / remove bus image (CEO) ----
let currentBusImageId = null;

function openReplaceBusImageModal(busId, busNumber, hasImage) {
    currentBusImageId = busId;
    const ctx = document.getElementById('bus-image-modal-context');
    if (ctx) ctx.innerText = `الحافلة: ${busNumber || `#${busId}`}`;
    const removeBtn = document.getElementById('bus-image-remove-btn');
    if (removeBtn) {
        if (hasImage) {
            removeBtn.classList.remove('hidden');
        } else {
            removeBtn.classList.add('hidden');
        }
    }
    const fileInput = document.getElementById('bus-image-replace-file');
    if (fileInput) fileInput.value = '';
    const modal = document.getElementById('bus-image-modal');
    if (modal) modal.classList.remove('hidden');
}

async function handleReplaceBusImageSubmit(e) {
    e.preventDefault();
    if (!currentBusImageId) return;
    const fileInput = document.getElementById('bus-image-replace-file');
    if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
        showToast('يرجى اختيار صورة جديدة أولاً.', 'error');
        return;
    }
    try {
        await window.busesApi.updateImage(currentBusImageId, fileInput.files[0]);
        showToast('تم تحديث صورة الحافلة بنجاح.', 'success');
        closeModal('bus-image-modal');
        loadCeoBuses();
    } catch (err) {
        console.error('Replace bus image error:', err);
    }
}

async function removeBusImage() {
    if (!currentBusImageId) return;
    if (!confirm('هل أنت متأكد من إزالة صورة هذه الحافلة؟')) return;
    try {
        await window.busesApi.deleteImage(currentBusImageId);
        showToast('تم إزالة صورة الحافلة.', 'success');
        closeModal('bus-image-modal');
        loadCeoBuses();
    } catch (err) {
        console.error('Remove bus image error:', err);
    }
}

async function updateBusStatus(busId, status) {
    try {
        await window.busesApi.updateStatus(busId, status);
        showToast('تم تحديث حالة الحافلة بنجاح.', 'success');
        loadCeoBuses();
    } catch (err) {
        console.error('Update bus status error:', err);
    }
}

async function deleteBus(busId) {
    if (!confirm('هل أنت متأكد من حذف هذه الحافلة من الأسطول؟')) return;
    try {
        await window.busesApi.delete(busId);
        showToast('تم حذف الحافلة من الأسطول.', 'success');
        loadCeoBuses();
    } catch (err) {
        console.error('Delete bus error:', err);
    }
}

// 5. CEO: Stations Management
async function loadCeoStations() {
    const tbody = document.getElementById('ceo-stations-tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="5" class="p-6 text-center text-slate-400"><i class="fa-solid fa-spinner fa-spin"></i> جاري التحميل...</td></tr>';

    try {
        const res = await window.stationsApi.list({ page_size: 100 });
        const items = res?.items || (Array.isArray(res) ? res : []);
        cachedStations = items;

        if (items.length > 0) {
            tbody.innerHTML = '';
            items.forEach(st => {
                const isAct = st.is_active;
                tbody.innerHTML += `
                    <tr class="hover:bg-slate-50/50 dark:hover:bg-slate-950/20 transition">
                        <td class="p-4 font-black text-slate-800 dark:text-white">${st.name}</td>
                        <td class="p-4 font-mono font-bold text-slate-500">${st.code}</td>
                        <td class="p-4 text-slate-500 text-xs">${st.address || 'أسيوط'}</td>
                        <td class="p-4">
                            <span class="px-2.5 py-1 rounded-full text-[10px] font-black ${isAct ? 'bg-emerald-500/15 text-emerald-500' : 'bg-rose-500/15 text-rose-500'}">
                                ${isAct ? 'نشطة' : 'معطلة'}
                            </span>
                        </td>
                        <td class="p-4 text-center space-x-1 flex items-center justify-center gap-2">
                            <button onclick="toggleStationStatus(${st.id}, ${isAct})" class="text-blue-500 hover:underline font-bold text-xs bg-transparent border-0 cursor-pointer">
                                ${isAct ? 'إيقاف' : 'تفعيل'}
                            </button>
                            <button onclick="deleteStation(${st.id})" class="text-rose-500 hover:underline font-bold text-xs bg-transparent border-0 cursor-pointer">
                                حذف
                            </button>
                        </td>
                    </tr>
                `;
            });
        } else {
            tbody.innerHTML = '<tr><td colspan="5" class="p-6 text-center text-slate-400 font-bold">لا توجد محطات مسجلة</td></tr>';
        }
    } catch (e) {
        tbody.innerHTML = '<tr><td colspan="5" class="p-6 text-center text-rose-500 font-bold">تعذر تحميل المحطات</td></tr>';
    }
}

function openAddStationModal() {
    document.getElementById('station-edit-id').value = '';
    document.getElementById('station-name-input').value = '';
    document.getElementById('station-code-input').value = '';
    document.getElementById('station-address-input').value = '';
    document.getElementById('station-lat-input').value = '27.1809';
    document.getElementById('station-lng-input').value = '31.1837';
    const modal = document.getElementById('add-station-modal');
    if (modal) modal.classList.remove('hidden');
}

async function handleSaveStationSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('station-edit-id').value;
    const name = document.getElementById('station-name-input').value;
    const code = document.getElementById('station-code-input').value;
    const addr = document.getElementById('station-address-input').value;
    const lat = parseFloat(document.getElementById('station-lat-input').value);
    const lng = parseFloat(document.getElementById('station-lng-input').value);

    try {
        const payload = { name, code, address: addr, latitude: lat, longitude: lng };
        if (id) {
            await window.stationsApi.update(id, payload);
            showToast('تم تعديل المحطة بنجاح.', 'success');
        } else {
            await window.stationsApi.create(payload);
            showToast('تمت إضافة المحطة بنجاح.', 'success');
        }
        closeModal('add-station-modal');
        loadCeoStations();
    } catch (err) {
        console.error('Save station error:', err);
    }
}

async function toggleStationStatus(stationId, currentStatus) {
    try {
        await window.stationsApi.updateStatus(stationId, !currentStatus);
        showToast('تم تحديث حالة المحطة بنجاح.', 'success');
        loadCeoStations();
    } catch (err) {
        console.error('Toggle station error:', err);
    }
}

async function deleteStation(stationId) {
    if (!confirm('هل أنت متأكد من حذف هذه المحطة؟')) return;
    try {
        await window.stationsApi.delete(stationId);
        showToast('تم حذف المحطة بنجاح.', 'success');
        loadCeoStations();
    } catch (err) {
        console.error('Delete station error:', err);
    }
}

// 6. CEO: Routes & Stops Management (Dynamic Waypoints)
function addRouteWaypointRow(selectedStationId = '') {
    const container = document.getElementById('route-waypoints-container');
    if (!container) return;

    const rowId = 'wp-row-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    const row = document.createElement('div');
    row.id = rowId;
    row.className = 'flex items-center gap-2 bg-slate-50 dark:bg-slate-900/80 p-2 rounded-xl border border-slate-200 dark:border-slate-800';

    let optionsHtml = '<option value="">اختر محطة نقطة التوقف</option>';
    if (cachedStations && cachedStations.length > 0) {
        cachedStations.forEach(st => {
            optionsHtml += `<option value="${st.id}" ${st.id == selectedStationId ? 'selected' : ''}>${st.name} (${st.code || 'محطة'})</option>`;
        });
    }

    row.innerHTML = `
        <span class="text-[11px] font-bold text-brand-primary dark:text-[#6AB9FF] whitespace-nowrap flex items-center gap-1">
            <i class="fa-solid fa-location-dot"></i> نقطة توقف:
        </span>
        <select class="route-waypoint-station flex-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none">
            ${optionsHtml}
        </select>
        <button type="button" onclick="removeRouteWaypointRow('${rowId}')" title="حذف نقطة التوقف" class="bg-rose-500/10 hover:bg-rose-500 text-rose-500 hover:text-white rounded-lg px-2.5 py-1.5 text-xs font-bold fast-transition border-0 cursor-pointer">
            <i class="fa-solid fa-trash-can"></i>
        </button>
    `;

    container.appendChild(row);
}

function removeRouteWaypointRow(rowId) {
    const row = document.getElementById(rowId);
    if (row) row.remove();
}

async function loadCeoRoutes() {
    const tbody = document.getElementById('ceo-routes-tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6" class="p-6 text-center text-slate-400"><i class="fa-solid fa-spinner fa-spin"></i> جاري التحميل...</td></tr>';

    try {
        const res = await window.routesApi.list({ page_size: 50 });
        const items = res?.items || (Array.isArray(res) ? res : []);
        cachedRoutes = items;

        if (items.length > 0) {
            tbody.innerHTML = '';
            items.forEach(r => {
                const originName = r.origin_station?.name || `محطة #${r.origin_station_id}`;
                const destName = r.destination_station?.name || `محطة #${r.destination_station_id}`;
                tbody.innerHTML += `
                    <tr class="hover:bg-slate-50/50 dark:hover:bg-slate-950/20 transition">
                        <td class="p-4 font-black text-slate-800 dark:text-white">${r.route_number} - ${r.name}</td>
                        <td class="p-4 font-bold text-slate-600 dark:text-slate-300">${originName} ← ${destName}</td>
                        <td class="p-4 font-mono font-bold text-slate-500">${r.distance_km || 15} كم / ${r.estimated_duration_minutes || 30} دقيقة</td>
                        <td class="p-4 font-bold text-slate-600 dark:text-slate-300">${r.supervisor_id ? `مشرف #${r.supervisor_id}` : 'غير معين'}</td>
                        <td class="p-4">
                            <span class="px-2.5 py-1 rounded-full text-[10px] font-black ${r.is_active ? 'bg-emerald-500/15 text-emerald-500' : 'bg-rose-500/15 text-rose-500'}">
                                ${r.is_active ? 'نشط' : 'متوقف'}
                            </span>
                        </td>
                        <td class="p-4 text-center space-x-1 flex items-center justify-center gap-2">
                            <button onclick="openManageRouteStopsModal(${r.id}, '${r.name}')" class="bg-blue-500/10 text-blue-500 font-bold text-[10px] px-2.5 py-1.5 rounded-lg hover:bg-blue-500 hover:text-white border-0 cursor-pointer">
                                <i class="fa-solid fa-list-ol"></i> التوقفات
                            </button>
                            <button onclick="deleteRoute(${r.id})" class="text-rose-500 hover:underline font-bold text-xs bg-transparent border-0 cursor-pointer">
                                <i class="fa-solid fa-trash"></i>
                            </button>
                        </td>
                    </tr>
                `;
            });
        } else {
            tbody.innerHTML = '<tr><td colspan="6" class="p-6 text-center text-slate-400 font-bold">لا توجد خطوط سير مسجلة</td></tr>';
        }
    } catch (e) {
        tbody.innerHTML = '<tr><td colspan="6" class="p-6 text-center text-rose-500 font-bold">تعذر تحميل خطوط السير</td></tr>';
    }
}

async function openAddRouteModal() {
    // Populate stations and active supervisors
    const [_, supsRes] = await Promise.all([
        loadCeoStations(),
        window.usersApi.list({ role: 'SUPERVISOR', is_active: true, page_size: 100 }).catch(() => null)
    ]);
    cachedSupervisors = supsRes?.items || [];

    const originSelect = document.getElementById('route-origin-select');
    const destSelect = document.getElementById('route-dest-select');
    const supSelect = document.getElementById('route-sup-select');

    if (originSelect) originSelect.innerHTML = '<option value="">اختر محطة الانطلاق</option>';
    if (destSelect) destSelect.innerHTML = '<option value="">اختر محطة الوصول</option>';
    if (supSelect) {
        supSelect.innerHTML = '<option value="">بدون مشرف</option>';
        cachedSupervisors.forEach(s => {
            supSelect.innerHTML += `<option value="${s.id}">${s.full_name}</option>`;
        });
    }

    cachedStations.forEach(st => {
        if (originSelect) originSelect.innerHTML += `<option value="${st.id}">${st.name}</option>`;
        if (destSelect) destSelect.innerHTML += `<option value="${st.id}">${st.name}</option>`;
    });

    document.getElementById('route-edit-id').value = '';
    document.getElementById('route-number-input').value = '';
    document.getElementById('route-name-input').value = '';
    const distInput = document.getElementById('route-dist-input');
    if (distInput) distInput.value = '15.0';
    const durInput = document.getElementById('route-dur-input');
    if (durInput) durInput.value = '30';

    // Reset waypoints container and add 1 initial row
    const waypointsContainer = document.getElementById('route-waypoints-container');
    if (waypointsContainer) {
        waypointsContainer.innerHTML = '';
        addRouteWaypointRow();
    }

    const modal = document.getElementById('add-route-modal');
    if (modal) modal.classList.remove('hidden');
}

async function handleSaveRouteSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('route-edit-id').value;
    const num = document.getElementById('route-number-input').value;
    const name = document.getElementById('route-name-input').value;
    const originId = parseInt(document.getElementById('route-origin-select').value);
    const destId = parseInt(document.getElementById('route-dest-select').value);
    const distElem = document.getElementById('route-dist-input');
    const dist = distElem ? parseFloat(distElem.value) : 15.0;
    const durElem = document.getElementById('route-dur-input');
    const dur = durElem ? parseInt(durElem.value) : 30;
    const supElem = document.getElementById('route-sup-select');
    const supId = (supElem && supElem.value) ? parseInt(supElem.value) : null;

    try {
        const payload = {
            route_number: num,
            name: name,
            origin_station_id: originId,
            destination_station_id: destId,
            distance_km: dist || 15.0,
            estimated_duration_minutes: dur || 30,
            supervisor_id: supId
        };

        let routeId = id;
        if (id) {
            await window.routesApi.update(id, payload);
            showToast('تم تحديث خط السير بنجاح.', 'success');
        } else {
            const created = await window.routesApi.create(payload);
            routeId = created?.id;
            showToast('تم إنشاء خط السير بنجاح.', 'success');
        }

        // Save dynamic waypoints / stop points if present
        if (routeId) {
            const waypointSelects = document.querySelectorAll('.route-waypoint-station');
            let order = 1;
            for (const sel of waypointSelects) {
                const stationId = parseInt(sel.value);
                if (stationId && !isNaN(stationId)) {
                    try {
                        await window.routesApi.addStop(routeId, {
                            station_id: stationId,
                            stop_order: order++
                        });
                    } catch (stopErr) {
                        console.warn('Could not add waypoint stop to route:', stopErr);
                    }
                }
            }
        }

        closeModal('add-route-modal');
        loadCeoRoutes();
    } catch (err) {
        console.error('Save route error:', err);
    }
}

async function deleteRoute(id) {
    if (!confirm('هل أنت متأكد من حذف خط السير هذا وكافة توقفاته؟')) return;
    try {
        await window.routesApi.delete(id);
        showToast('تم حذف خط السير بنجاح.', 'success');
        loadCeoRoutes();
    } catch (err) {
        console.error('Delete route error:', err);
    }
}

async function openManageRouteStopsModal(routeId, routeName) {
    document.getElementById('current-stops-route-id').value = routeId;
    document.getElementById('route-stops-title').innerText = `توقفات ومحطات خط السير: ${routeName}`;

    // Populate station dropdown
    await loadCeoStations();
    const stationSelect = document.getElementById('new-stop-station-select');
    stationSelect.innerHTML = '<option value="">اختر محطة لإضافتها</option>';
    cachedStations.forEach(st => {
        stationSelect.innerHTML += `<option value="${st.id}">${st.name}</option>`;
    });

    loadRouteStopsList(routeId);

    const modal = document.getElementById('route-stops-modal');
    if (modal) modal.classList.remove('hidden');
}

async function loadRouteStopsList(routeId) {
    const list = document.getElementById('route-stops-list');
    if (!list) return;
    list.innerHTML = '<p class="text-center text-xs text-slate-400 py-4"><i class="fa-solid fa-spinner fa-spin"></i> جاري التحميل...</p>';

    try {
        const stops = await window.routesApi.getStops(routeId);
        if (Array.isArray(stops) && stops.length > 0) {
            list.innerHTML = '';
            stops.forEach(s => {
                list.innerHTML += `
                    <div class="p-3 bg-slate-50 dark:bg-slate-900 rounded-xl flex items-center justify-between border border-slate-200 dark:border-slate-800">
                        <div class="flex items-center gap-3">
                            <span class="w-6 h-6 rounded-full bg-[#0B5DAA] text-white flex items-center justify-center font-bold text-xs">${s.stop_order}</span>
                            <span class="font-bold text-xs">${s.station?.name || `محطة #${s.station_id}`}</span>
                        </div>
                        <button onclick="removeRouteStop(${routeId}, ${s.id})" class="text-rose-500 hover:text-rose-600 text-xs font-bold bg-transparent border-0 cursor-pointer"><i class="fa-solid fa-trash"></i></button>
                    </div>
                `;
            });
        } else {
            list.innerHTML = '<p class="text-center text-xs text-slate-400 py-4">لا توجد محطات توقف وسيطة لهذا الخط بعد</p>';
        }
    } catch (e) {
        list.innerHTML = '<p class="text-center text-xs text-rose-500 py-4">تعذر تحميل التوقفات</p>';
    }
}

async function handleAddRouteStopSubmit(e) {
    e.preventDefault();
    const routeId = parseInt(document.getElementById('current-stops-route-id').value);
    const stationId = parseInt(document.getElementById('new-stop-station-select').value);
    const stopOrder = parseInt(document.getElementById('new-stop-order').value);

    try {
        await window.routesApi.addStop(routeId, { station_id: stationId, stop_order: stopOrder });
        showToast('تمت إضافة محطة التوقف بنجاح.', 'success');
        document.getElementById('new-stop-order').value = '';
        loadRouteStopsList(routeId);
    } catch (err) {
        console.error('Add stop error:', err);
    }
}

async function removeRouteStop(routeId, stopId) {
    try {
        await window.routesApi.removeStop(routeId, stopId);
        showToast('تم حذف المحطة من الخط.', 'success');
        loadRouteStopsList(routeId);
    } catch (err) {
        console.error('Remove stop error:', err);
    }
}

// 7. CEO: Scheduled Trips Management
async function loadCeoTrips() {
    const tbody = document.getElementById('ceo-trips-tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="7" class="p-6 text-center text-slate-400"><i class="fa-solid fa-spinner fa-spin"></i> جاري التحميل...</td></tr>';

    try {
        const res = await window.tripsApi.list({ page_size: 50 });
        const items = res?.items || [];

        if (items.length > 0) {
            tbody.innerHTML = '';
            items.forEach(t => {
                const rName = t.route?.name || `خط #${t.route_id}`;
                const busPlate = t.bus?.license_plate || `باص #${t.bus_id}`;
                const supName = t.supervisor?.full_name || `مشرف #${t.supervisor_id}`;
                const depTime = new Date(t.departure_time).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' });

                tbody.innerHTML += `
                    <tr class="hover:bg-slate-50/50 dark:hover:bg-slate-950/20 transition">
                        <td class="p-4 font-black text-slate-800 dark:text-white">${rName}</td>
                        <td class="p-4 font-mono font-bold text-slate-600 dark:text-slate-300">${busPlate}</td>
                        <td class="p-4 font-bold text-slate-600 dark:text-slate-300">${supName}</td>
                        <td class="p-4 font-mono font-bold text-brand-primary dark:text-brand-secondary">${depTime}</td>
                        <td class="p-4 font-mono font-bold">${t.fare_amount} EGP</td>
                        <td class="p-4">
                            <span class="px-2.5 py-1 rounded-full text-[10px] font-black ${t.status === 'SCHEDULED' ? 'bg-blue-500/15 text-blue-500' : 'bg-emerald-500/15 text-emerald-500'}">
                                ${t.status}
                            </span>
                        </td>
                        <td class="p-4 text-center">
                            <button onclick="openManagePickupPointsModal(${t.id})" class="text-brand-primary hover:underline font-bold text-xs bg-transparent border-0 cursor-pointer ml-3">
                                نقاط التجمع (${Array.isArray(t.pickup_points) ? t.pickup_points.length : 0})
                            </button>
                            <button onclick="deleteScheduledTrip(${t.id})" class="text-rose-500 hover:underline font-bold text-xs bg-transparent border-0 cursor-pointer">
                                حذف
                            </button>
                        </td>
                    </tr>
                `;
            });
        } else {
            tbody.innerHTML = '<tr><td colspan="7" class="p-6 text-center text-slate-400 font-bold">لا توجد رحلات مجدولة بالنظام</td></tr>';
        }
    } catch (e) {
        tbody.innerHTML = '<tr><td colspan="7" class="p-6 text-center text-rose-500 font-bold">تعذر تحميل جدول الرحلات</td></tr>';
    }
}

async function openAddTripModal() {
    // Populate routes, buses, supervisors
    const [routesRes, busesRes, supsRes] = await Promise.all([
        window.routesApi.list({ is_active: true, page_size: 100 }),
        window.busesApi.list({ status: 'ACTIVE', page_size: 100 }),
        window.usersApi.list({ role: 'SUPERVISOR', is_active: true, page_size: 100 })
    ]);

    const routeSelect = document.getElementById('trip-route-select');
    const busSelect = document.getElementById('trip-bus-select');
    const supSelect = document.getElementById('trip-supervisor-select');

    routeSelect.innerHTML = '';
    (routesRes?.items || []).forEach(r => {
        routeSelect.innerHTML += `<option value="${r.id}">${r.route_number} - ${r.name}</option>`;
    });

    busSelect.innerHTML = '';
    (busesRes?.items || []).forEach(b => {
        busSelect.innerHTML += `<option value="${b.id}">${b.bus_number} (${b.license_plate}) - ${b.capacity} مقعد</option>`;
    });

    supSelect.innerHTML = '';
    (supsRes?.items || []).forEach(s => {
        supSelect.innerHTML += `<option value="${s.id}">${s.full_name}</option>`;
    });

    const modal = document.getElementById('add-trip-modal');
    if (modal) modal.classList.remove('hidden');
}

async function handleCreateScheduledTripSubmit(e) {
    e.preventDefault();

    const routeId = parseInt(document.getElementById('trip-route-select').value);
    const busId = parseInt(document.getElementById('trip-bus-select').value);
    const supId = parseInt(document.getElementById('trip-supervisor-select').value);
    const depTime = document.getElementById('trip-departure-input').value;
    const arrTime = document.getElementById('trip-arrival-input').value;
    const fare = document.getElementById('trip-fare-input').value;
    const capVal = document.getElementById('trip-capacity-input').value;
    const cap = capVal ? parseInt(capVal) : null;

    try {
        const payload = {
            route_id: routeId,
            bus_id: busId,
            supervisor_id: supId,
            departure_time: new Date(depTime).toISOString(),
            estimated_arrival_time: new Date(arrTime).toISOString(),
            fare_amount: fare,
            passenger_capacity: cap
        };

        await window.tripsApi.create(payload);
        showToast('تمت جدولة الرحلة بنجاح!', 'success');
        closeModal('add-trip-modal');
        loadCeoTrips();
    } catch (err) {
        console.error('Schedule trip error:', err);
    }
}

async function deleteScheduledTrip(tripId) {
    if (!confirm('هل أنت متأكد من حذف هذه الرحلة المجدولة؟')) return;
    try {
        await window.tripsApi.delete(tripId);
        showToast('تم حذف الرحلة المجدولة بنجاح.', 'success');
        loadCeoTrips();
    } catch (err) {
        console.error('Delete trip error:', err);
    }
}

// 7b. CEO: Trip Pickup (Gathering) Points — required for students to subscribe
async function openManagePickupPointsModal(tripId) {
    currentPickupTripId = Number(tripId);
    const modal = document.getElementById('manage-pickup-points-modal');
    if (!modal) return;

    const ctx = document.getElementById('pickup-trip-context');
    if (ctx) ctx.innerText = `رقم الرحلة: #${currentPickupTripId}`;

    const nameInput = document.getElementById('pickup-name-input');
    const addressInput = document.getElementById('pickup-address-input');
    if (nameInput) nameInput.value = '';
    if (addressInput) addressInput.value = '';

    modal.classList.remove('hidden');
    await loadTripPickupPoints();
}

async function loadTripPickupPoints() {
    const tbody = document.getElementById('pickup-points-tbody');
    if (!tbody || !currentPickupTripId) return;
    tbody.innerHTML = '<tr><td colspan="4" class="p-4 text-center text-slate-400"><i class="fa-solid fa-spinner fa-spin"></i> جاري التحميل...</td></tr>';

    try {
        const res = await window.tripsApi.listPickupPoints(currentPickupTripId);
        const items = Array.isArray(res) ? res : (res?.items || []);

        if (items.length > 0) {
            tbody.innerHTML = '';
            items.forEach(p => {
                tbody.innerHTML += `
                    <tr class="hover:bg-slate-50/50 dark:hover:bg-slate-950/20 transition">
                        <td class="p-3 font-bold text-slate-800 dark:text-white">${p.name}</td>
                        <td class="p-3 text-slate-500 dark:text-slate-400">${p.address || '—'}</td>
                        <td class="p-3 font-mono font-bold">${p.sequence}</td>
                        <td class="p-3 text-center">
                            <button onclick="deletePickupPoint(${p.id})" class="text-rose-500 hover:underline font-bold text-xs bg-transparent border-0 cursor-pointer">حذف</button>
                        </td>
                    </tr>
                `;
            });
        } else {
            tbody.innerHTML = '<tr><td colspan="4" class="p-4 text-center text-slate-400 font-bold">لا توجد نقاط تجمع لهذه الرحلة بعد</td></tr>';
        }

        const seqInput = document.getElementById('pickup-sequence-input');
        if (seqInput) {
            const maxSeq = items.reduce((max, p) => Math.max(max, Number(p.sequence) || 0), 0);
            seqInput.value = items.length ? maxSeq + 1 : 1;
        }
    } catch (e) {
        tbody.innerHTML = '<tr><td colspan="4" class="p-4 text-center text-rose-500 font-bold">تعذر تحميل نقاط التجمع</td></tr>';
    }
}

async function handleAddPickupPoint(e) {
    e.preventDefault();
    if (!currentPickupTripId) return;

    const name = document.getElementById('pickup-name-input').value.trim();
    const address = document.getElementById('pickup-address-input').value.trim();
    const sequence = parseInt(document.getElementById('pickup-sequence-input').value);

    if (!name) { showToast('يرجى إدخال اسم نقطة التجمع.', 'error'); return; }
    if (!Number.isInteger(sequence) || sequence < 1) { showToast('الترتيب (Sequence) يجب أن يكون رقماً صحيحاً ≥ 1.', 'error'); return; }

    try {
        const payload = { name, sequence };
        if (address) payload.address = address;
        await window.tripsApi.addPickupPoint(currentPickupTripId, payload);
        showToast('تمت إضافة نقطة التجمع بنجاح.', 'success');
        document.getElementById('pickup-name-input').value = '';
        document.getElementById('pickup-address-input').value = '';
        await loadTripPickupPoints();
        loadCeoTrips();
    } catch (err) {
        console.error('Add pickup point error:', err);
    }
}

async function deletePickupPoint(pointId) {
    if (!currentPickupTripId) return;
    if (!confirm('هل أنت متأكد من حذف نقطة التجمع هذه؟')) return;
    try {
        await window.tripsApi.deletePickupPoint(currentPickupTripId, pointId);
        showToast('تم حذف نقطة التجمع.', 'success');
        await loadTripPickupPoints();
        loadCeoTrips();
    } catch (err) {
        console.error('Delete pickup point error:', err);
    }
}

// 8. CEO: Payments Verification
async function loadCeoPayments() {
    const tbody = document.getElementById('ceo-payments-tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="7" class="p-6 text-center text-slate-400"><i class="fa-solid fa-spinner fa-spin"></i> جاري التحميل...</td></tr>';

    try {
        const res = await window.paymentsApi.listAdmin({ page_size: 50 });
        const items = res?.items || [];

        if (items.length > 0) {
            tbody.innerHTML = '';
            items.forEach(p => {
                const stName = p.student?.full_name || `طالب #${p.student_id}`;
                const isPending = p.status === 'PENDING' || p.status === 'SUBMITTED';

                tbody.innerHTML += `
                    <tr class="hover:bg-slate-50/50 dark:hover:bg-slate-950/20 transition">
                        <td class="p-4 font-mono font-bold">#${p.id}</td>
                        <td class="p-4 font-black text-slate-800 dark:text-white">${stName}</td>
                        <td class="p-4 font-mono font-bold text-slate-800 dark:text-white">${p.amount} ${p.currency}</td>
                        <td class="p-4 font-bold">${p.method}</td>
                        <td class="p-4 font-mono text-slate-400">${p.transaction_reference || 'لا يوجد'}</td>
                        <td class="p-4">
                            <span class="px-2.5 py-1 rounded-full text-[10px] font-black ${p.status === 'VERIFIED' ? 'bg-emerald-500/15 text-emerald-500' : 'bg-amber-500/15 text-amber-500'}">
                                ${p.status}
                            </span>
                        </td>
                        <td class="p-4 text-center space-x-1 flex items-center justify-center gap-2">
                            ${isPending ? `
                                <button onclick="verifyPayment(${p.id})" class="bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500 hover:text-white font-bold text-[10px] px-2.5 py-1.5 rounded-lg border-0 cursor-pointer">
                                    <i class="fa-solid fa-check"></i> اعتماد
                                </button>
                                <button onclick="rejectPayment(${p.id})" class="bg-rose-500/10 text-rose-500 hover:bg-rose-500 hover:text-white font-bold text-[10px] px-2.5 py-1.5 rounded-lg border-0 cursor-pointer">
                                    <i class="fa-solid fa-xmark"></i> رفض
                                </button>
                            ` : '<span class="text-slate-400 text-xs">تمت المعالجة</span>'}
                        </td>
                    </tr>
                `;
            });
        } else {
            tbody.innerHTML = '<tr><td colspan="7" class="p-6 text-center text-slate-400 font-bold">لا توجد عمليات دفع مسجلة</td></tr>';
        }
    } catch (e) {
        tbody.innerHTML = '<tr><td colspan="7" class="p-6 text-center text-rose-500 font-bold">تعذر تحميل المدفوعات</td></tr>';
    }
}

async function verifyPayment(paymentId) {
    if (!confirm('هل ترغب بتأكيد واعتماد هذا الدفع المالي وتسوية الحجز؟')) return;
    try {
        await window.paymentsApi.verify(paymentId);
        showToast('تم اعتماد الدفع بنجاح!', 'success');
        loadCeoPayments();
    } catch (err) {
        console.error('Verify payment error:', err);
    }
}

async function rejectPayment(paymentId) {
    const reason = prompt('يرجى كتابة سبب رفض هذا الدفع:', 'رقم التحويل غير مطابق');
    if (reason === null) return;
    try {
        await window.paymentsApi.reject(paymentId, reason);
        showToast('تم رفض عملية الدفع.', 'info');
        loadCeoPayments();
    } catch (err) {
        console.error('Reject payment error:', err);
    }
}

// 9. CEO: Subscription Plans Management
async function loadCeoSubscriptionPlans() {
    const tbody = document.getElementById('ceo-plans-tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="7" class="p-6 text-center text-slate-400"><i class="fa-solid fa-spinner fa-spin"></i> جاري التحميل...</td></tr>';

    try {
        const res = await window.subscriptionPlansApi.listAdmin({ page_size: 50 });
        const items = res?.items || [];

        if (items.length > 0) {
            tbody.innerHTML = '';
            items.forEach(p => {
                const isAct = p.is_active;
                tbody.innerHTML += `
                    <tr class="hover:bg-slate-50/50 dark:hover:bg-slate-950/20 transition">
                        <td class="p-4 font-black text-slate-800 dark:text-white">${p.name}</td>
                        <td class="p-4 font-bold text-blue-500">${p.plan_type}</td>
                        <td class="p-4 font-mono font-bold">${p.duration_days} يوم</td>
                        <td class="p-4 font-mono font-bold">${p.days_per_week ?? '--'} يوم/أسبوع</td>
                        <td class="p-4 font-mono font-bold text-emerald-500">${p.price} ${p.currency}</td>
                        <td class="p-4">
                            <span class="px-2.5 py-1 rounded-full text-[10px] font-black ${isAct ? 'bg-emerald-500/15 text-emerald-500' : 'bg-rose-500/15 text-rose-500'}">
                                ${isAct ? 'نشطة' : 'متوقفة'}
                            </span>
                        </td>
                        <td class="p-4 text-center">
                            <button onclick="openEditPlanModal(${p.id}, '${(p.name || '').replace(/'/g, "\\'")}', '${p.plan_type || ''}', '${p.price ?? ''}', ${p.duration_days ?? 'null'}, ${p.days_per_week ?? 'null'})" class="text-brand-primary hover:underline font-bold text-xs bg-transparent border-0 cursor-pointer ml-2">
                                تعديل
                            </button>
                            <button onclick="togglePlanStatus(${p.id}, ${isAct})" class="text-blue-500 hover:underline font-bold text-xs bg-transparent border-0 cursor-pointer">
                                ${isAct ? 'إيقاف الباقة' : 'تفعيل الباقة'}
                            </button>
                        </td>
                    </tr>
                `;
            });
        } else {
            tbody.innerHTML = '<tr><td colspan="7" class="p-6 text-center text-slate-400 font-bold">لا توجد باقات مسجلة</td></tr>';
        }
    } catch (e) {
        tbody.innerHTML = '<tr><td colspan="7" class="p-6 text-center text-rose-500 font-bold">تعذر تحميل الباقات</td></tr>';
    }
}

function openAddPlanModal() {
    document.getElementById('plan-name-input').value = '';
    document.getElementById('plan-price-input').value = '';
    document.getElementById('plan-duration-input').value = '';
    const dpwInput = document.getElementById('plan-days-per-week-input');
    if (dpwInput) dpwInput.value = '';
    updatePlanDurationHint();
    const modal = document.getElementById('add-plan-modal');
    if (modal) modal.classList.remove('hidden');
}

/**
 * Keep the duration field aligned with the selected plan type.
 * DAILY is fixed to exactly 1 day; every other type is CEO-defined (1–730).
 * (SUBSCRIPTIONS.md §1 — never assume WEEKLY=7 / MONTHLY=30 / TERM=90.)
 */
function onPlanTypeChange() {
    updatePlanDurationHint();
}

function updatePlanDurationHint() {
    const type = document.getElementById('plan-type-select')?.value || 'WEEKLY';
    const input = document.getElementById('plan-duration-input');
    const hint = document.getElementById('plan-duration-hint');
    if (!input) return;

    if (type === 'DAILY') {
        input.value = '1';
        input.min = '1';
        input.max = '1';
        input.readOnly = true;
        if (hint) hint.textContent = 'الباقة اليومية ثابتة المدة: يوم واحد فقط.';
    } else {
        input.readOnly = false;
        input.min = '1';
        input.max = String(MAX_PLAN_DURATION_DAYS);
        if (hint) hint.textContent = `مدة حرة يحددها المدير التنفيذي: من 1 إلى ${MAX_PLAN_DURATION_DAYS} يوم (مثال: WEEKLY + 8 أيام، MONTHLY + 45 يوماً، TERM + 120 يوماً).`;
    }
}

async function handleCreatePlanSubmit(e) {
    e.preventDefault();
    const name = document.getElementById('plan-name-input').value;
    const type = document.getElementById('plan-type-select').value;
    const price = document.getElementById('plan-price-input').value;
    const durVal = document.getElementById('plan-duration-input').value;
    const dur = durVal ? parseInt(durVal) : null;
    const dpwVal = document.getElementById('plan-days-per-week-input')?.value;
    const dpw = dpwVal ? parseInt(dpwVal) : null;

    // Mirror backend validation (SUBSCRIPTIONS.md §1) — server remains authoritative.
    if (!Number.isInteger(dur) || dur < 1 || dur > MAX_PLAN_DURATION_DAYS) {
        showToast(`المدة يجب أن تكون بين 1 و ${MAX_PLAN_DURATION_DAYS} يوماً.`, 'error');
        return;
    }
    if (type === 'DAILY' && dur !== 1) {
        showToast('الباقة اليومية (DAILY) مدتها يوم واحد فقط.', 'error');
        return;
    }
    if (!Number.isInteger(dpw) || dpw < 1 || dpw > MAX_PLAN_DAYS_PER_WEEK) {
        showToast(`أيام المواصلات الأسبوعية يجب أن تكون بين 1 و ${MAX_PLAN_DAYS_PER_WEEK}.`, 'error');
        return;
    }
    const priceNum = parseFloat(price);
    if (!Number.isFinite(priceNum) || priceNum <= 0) {
        showToast('يرجى إدخال سعر صحيح أكبر من صفر.', 'error');
        return;
    }

    try {
        await window.subscriptionPlansApi.create({
            name: name,
            plan_type: type,
            price: price,
            duration_days: dur,
            days_per_week: dpw
        });
        showToast('تمت إضافة باقة الاشتراك بنجاح!', 'success');
        closeModal('add-plan-modal');
        loadCeoSubscriptionPlans();
    } catch (err) {
        console.error('Create plan error:', err);
    }
}

async function togglePlanStatus(planId, currentStatus) {
    try {
        await window.subscriptionPlansApi.updateStatus(planId, !currentStatus);
        showToast('تم تحديث حالة الباقة بنجاح.', 'success');
        loadCeoSubscriptionPlans();
    } catch (err) {
        console.error('Toggle plan error:', err);
    }
}

// فتح مودال تعديل الباقة (PATCH /subscription-plans/{id}):
// الاسم/السعر/المدة/أيام الأسبوع فقط — نوع الباقة غير قابل للتعديل في الـAPI.
function openEditPlanModal(planId, name, planType, price, durationDays, daysPerWeek) {
    const modal = document.getElementById('edit-plan-modal');
    if (!modal) return;

    document.getElementById('edit-plan-id').value = planId;
    document.getElementById('edit-plan-type').value = PLAN_TYPE_LABELS[planType] || planType || '--';
    document.getElementById('edit-plan-name-input').value = name || '';
    document.getElementById('edit-plan-price-input').value = price != null ? String(price) : '';

    const durInput = document.getElementById('edit-plan-duration-input');
    const durHint = document.getElementById('edit-plan-duration-hint');
    durInput.value = durationDays != null ? String(durationDays) : '';
    if (planType === 'DAILY') {
        // نفس قاعدة الإنشاء: DAILY ثابتة بيوم واحد.
        durInput.value = '1';
        durInput.min = '1';
        durInput.max = '1';
        durInput.readOnly = true;
        if (durHint) durHint.textContent = 'الباقة اليومية ثابتة المدة: يوم واحد فقط.';
    } else {
        durInput.readOnly = false;
        durInput.min = '1';
        durInput.max = String(MAX_PLAN_DURATION_DAYS);
        if (durHint) durHint.textContent = `مدة حرة يحددها المدير التنفيذي: من 1 إلى ${MAX_PLAN_DURATION_DAYS} يوم.`;
    }

    document.getElementById('edit-plan-days-per-week-input').value = daysPerWeek != null ? String(daysPerWeek) : '';
    modal.classList.remove('hidden');
}

async function handleUpdatePlanSubmit(e) {
    e.preventDefault();

    const planId = parseInt(document.getElementById('edit-plan-id').value);
    const name = document.getElementById('edit-plan-name-input').value.trim();
    const price = document.getElementById('edit-plan-price-input').value;
    const durVal = document.getElementById('edit-plan-duration-input').value;
    const dur = durVal ? parseInt(durVal) : null;
    const dpwVal = document.getElementById('edit-plan-days-per-week-input').value;
    const dpw = dpwVal ? parseInt(dpwVal) : null;

    if (!Number.isInteger(planId) || planId <= 0) { showToast('رقم الباقة غير صالح.', 'error'); return; }
    if (!name) { showToast('يرجى إدخال اسم الباقة.', 'error'); return; }

    // نفس قواعد التحقق في الإنشاء (نفسها في الخادم — SUBSCRIPTIONS.md §1).
    if (!Number.isInteger(dur) || dur < 1 || dur > MAX_PLAN_DURATION_DAYS) {
        showToast(`المدة يجب أن تكون بين 1 و ${MAX_PLAN_DURATION_DAYS} يوماً.`, 'error');
        return;
    }
    if (!Number.isInteger(dpw) || dpw < 1 || dpw > MAX_PLAN_DAYS_PER_WEEK) {
        showToast(`أيام المواصلات الأسبوعية يجب أن تكون بين 1 و ${MAX_PLAN_DAYS_PER_WEEK}.`, 'error');
        return;
    }
    const priceNum = parseFloat(price);
    if (!Number.isFinite(priceNum) || priceNum <= 0) {
        showToast('يرجى إدخال سعر صحيح أكبر من صفر.', 'error');
        return;
    }

    try {
        await window.subscriptionPlansApi.update(planId, {
            name: name,
            price: price,
            duration_days: dur,
            days_per_week: dpw
        });
        showToast('تم تحديث الباقة بنجاح! الاشتراكات الجديدة فقط تستخدم القيم الجديدة.', 'success');
        closeModal('edit-plan-modal');
        loadCeoSubscriptionPlans();
    } catch (err) {
        console.error('Update plan error:', err);
    }
}

// 10. CEO: All Boarding Records
async function loadCeoBoardingRecords() {
    const tbody = document.getElementById('ceo-boarding-tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6" class="p-6 text-center text-slate-400"><i class="fa-solid fa-spinner fa-spin"></i> جاري التحميل...</td></tr>';

    try {
        const res = await window.boardingApi.listAllRecords({ page_size: 50 });
        const items = res?.items || [];

        if (items.length > 0) {
            tbody.innerHTML = '';
            items.forEach(r => {
                const stName = r.student_name || `طالب #${r.student_id}`;
                const supName = r.supervisor_name || `مشرف #${r.supervisor_id}`;
                const timeStr = new Date(r.boarded_at).toLocaleString('ar-EG');
                const isOutbound = r.direction === 'OUTBOUND';

                tbody.innerHTML += `
                    <tr class="hover:bg-slate-50/50 dark:hover:bg-slate-950/20 transition">
                        <td class="p-4 font-black text-slate-800 dark:text-white">${stName}</td>
                        <td class="p-4 font-bold text-slate-600 dark:text-slate-300">رحلة #${r.trip_id}</td>
                        <td class="p-4 font-bold text-slate-600 dark:text-slate-300">${supName}</td>
                        <td class="p-4">
                            <span class="px-2 py-0.5 rounded-md text-[10px] font-black ${isOutbound ? 'bg-blue-500/15 text-blue-500' : 'bg-emerald-500/15 text-emerald-500'}">
                                ${isOutbound ? 'ذهاب' : 'عودة'}
                            </span>
                        </td>
                        <td class="p-4 font-bold">${r.pickup_point_name || `نقطة #${r.pickup_point_id}`}</td>
                        <td class="p-4 font-mono text-slate-400">${timeStr}</td>
                    </tr>
                `;
            });
        } else {
            tbody.innerHTML = '<tr><td colspan="6" class="p-6 text-center text-slate-400 font-bold">لا توجد سجلات صعود عامة بعد</td></tr>';
        }
    } catch (e) {
        tbody.innerHTML = '<tr><td colspan="6" class="p-6 text-center text-rose-500 font-bold">تعذر تحميل سجلات الصعود</td></tr>';
    }
}

// ============================================================
// API CONFIG MODAL HELPERS
// ============================================================
function openApiConfigModal() {
    const modal = document.getElementById('api-config-modal');
    const input = document.getElementById('cfg-base-url');
    if (input) input.value = window.CONFIG.getApiBaseUrl();
    if (modal) modal.classList.remove('hidden');
}

function saveApiConfig() {
    const input = document.getElementById('cfg-base-url');
    if (input) {
        window.CONFIG.setApiBaseUrl(input.value);
        showToast('تم حفظ عنوان الـ Backend بنجاح: ' + window.CONFIG.getApiBaseUrl(), 'success');
        closeModal('api-config-modal');
    }
}

async function testApiHealth() {
    const statusElem = document.getElementById('cfg-health-status');
    if (statusElem) {
        statusElem.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري الاتصال بالخادم...';
        statusElem.className = 'text-xs font-mono text-slate-500';
    }

    const baseUrl = document.getElementById('cfg-base-url')?.value || window.CONFIG.getApiBaseUrl();
    const rootUrl = baseUrl.replace(/\/api\/v1\/?$/, '');

    try {
        const res = await fetch(`${rootUrl}/health`);
        if (res.ok) {
            const data = await res.json();
            if (statusElem) {
                statusElem.innerText = `متصل بنجاح: status=${data.status}`;
                statusElem.className = 'text-xs font-mono text-emerald-500 font-bold';
            }
            showToast('تم الاتصال بالـ Backend بنجاح!', 'success');
        } else {
            throw new Error(`Status ${res.status}`);
        }
    } catch (e) {
        if (statusElem) {
            statusElem.innerText = 'فشل الاتصال: تأكد من تشغيل الخادم والـ CORS.';
            statusElem.className = 'text-xs font-mono text-rose-500 font-bold';
        }
        showToast('فشل الاتصال بالخادم على ' + rootUrl, 'error');
    }
}

// ============================================================
// LANDING PAGE DYNAMIC STATS & INTERSECTION OBSERVER ANIMATIONS
// ============================================================

let landingStatsLoaded = false;
let statsData = {
    students: 0,
    buses: 0,
    stations: 0,
    punctuality: 100
};

/**
 * Fetch dynamic counts from backend and update counter targets.
 * Uses the public /health/db probe to know the backend is alive; detailed
 * totals come from CEO-only listing endpoints, so they are only fetched when
 * an authenticated session exists. Guests see the punctuality counter only.
 */
async function fetchLandingStats() {
    try {
        let backendReachable = false;
        try {
            const baseUrl = window.CONFIG.getApiBaseUrl();
            const rootUrl = baseUrl.replace(/\/api\/v1\/?$/, '');
            const res = await fetch(`${rootUrl}/health/db`);
            if (res.ok) {
                const data = await res.json();
                backendReachable = data?.database === 'connected';
            }
        } catch (healthErr) {
            backendReachable = false;
        }

        let students = 0, buses = 0, stations = 0;
        if (backendReachable && window.CONFIG.getAccessToken()) {
            const [usersRes, busesRes, stationsRes] = await Promise.allSettled([
                window.usersApi.list({ role: 'STUDENT', page_size: 1 }),
                window.busesApi.list({ page_size: 1 }),
                window.stationsApi.list({ page_size: 1 })
            ]);

            if (usersRes.status === 'fulfilled' && usersRes.value && typeof usersRes.value.total === 'number') {
                students = usersRes.value.total;
            }
            if (busesRes.status === 'fulfilled' && busesRes.value && typeof busesRes.value.total === 'number') {
                buses = busesRes.value.total;
            }
            if (stationsRes.status === 'fulfilled' && stationsRes.value && typeof stationsRes.value.total === 'number') {
                stations = stationsRes.value.total;
            }
        }

        statsData.students = students;
        statsData.buses = buses;
        statsData.stations = stations;

        const elStudents = document.getElementById('landing-stat-students');
        const elBuses = document.getElementById('landing-stat-buses');
        const elStations = document.getElementById('landing-stat-stations');
        const elPunctuality = document.getElementById('landing-stat-punctuality');

        if (elStudents) elStudents.setAttribute('data-target', statsData.students);
        if (elBuses) elBuses.setAttribute('data-target', statsData.buses);
        if (elStations) elStations.setAttribute('data-target', statsData.stations);
        if (elPunctuality) elPunctuality.setAttribute('data-target', statsData.punctuality);

        landingStatsLoaded = true;
    } catch (e) {
        console.warn('[Landing Stats Fetch Error]:', e);
    }
}

/**
 * Smooth Counter Animation using requestAnimationFrame with easeOutCubic
 */
function animateCounter(element) {
    if (!element) return;
    const target = parseInt(element.getAttribute('data-target') || '0', 10);
    const suffix = element.getAttribute('data-suffix') || '';
    const duration = target === 0 ? 300 : 1500; // ms
    const startTime = performance.now();
    element.dataset.animated = 'true';

    function update(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        // Ease out cubic
        const easeProgress = 1 - Math.pow(1 - progress, 3);
        const currentVal = Math.floor(easeProgress * target);

        element.innerText = `${currentVal.toLocaleString('en-US')}${suffix}`;

        if (progress < 1) {
            requestAnimationFrame(update);
        } else {
            element.innerText = `${target.toLocaleString('en-US')}${suffix}`;
        }
    }

    requestAnimationFrame(update);
}

/**
 * Check and reveal elements that are already above or within the viewport upon reload
 */
function checkInitialVisibility() {
    if (window.scrollY === 0) return; // Top of page, leave everything to natural scroll observer

    const windowHeight = window.innerHeight || document.documentElement.clientHeight;

    // 1. Check Stagger Containers
    document.querySelectorAll('.stagger-container').forEach(container => {
        const rect = container.getBoundingClientRect();
        if (rect.top < windowHeight && rect.bottom > 0) {
            const children = container.querySelectorAll('.scroll-reveal');
            children.forEach((child, index) => {
                child.style.transitionDelay = `${index * 70}ms`;
                child.classList.add('is-visible');
            });
        } else if (rect.bottom <= 0) {
            const children = container.querySelectorAll('.scroll-reveal');
            children.forEach(child => {
                child.style.transitionDelay = '0ms';
                child.classList.add('is-visible');
            });
        }
    });

    // 2. Check standalone scroll reveals
    document.querySelectorAll('.scroll-reveal:not(.stagger-container .scroll-reveal)').forEach(el => {
        const rect = el.getBoundingClientRect();
        if (rect.top < windowHeight) {
            el.classList.add('is-visible');
        }
    });
}

/**
 * Initialize Intersection Observers for:
 * 1. Staggered reveal of Cards & Steps
 * 2. Counter animation when stats section enters viewport
 */
function initIntersectionObservers() {
    if (!('IntersectionObserver' in window)) {
        document.querySelectorAll('.scroll-reveal').forEach(el => el.classList.add('is-visible'));
        document.querySelectorAll('.stat-counter').forEach(el => {
            const target = el.getAttribute('data-target') || '0';
            const suffix = el.getAttribute('data-suffix') || '';
            el.innerText = `${target}${suffix}`;
        });
        return;
    }

    // 1. Observer for Stagger Containers (Cards & Steps)
    const staggerContainers = document.querySelectorAll('.stagger-container:not(#stats-section .stagger-container)');
    const containerObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const children = entry.target.querySelectorAll('.scroll-reveal');
                children.forEach((child, index) => {
                    child.style.transitionDelay = `${index * 70}ms`;
                    child.classList.add('is-visible');
                });
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.1 });

    staggerContainers.forEach(container => containerObserver.observe(container));

    // Standalone scroll reveals
    const standaloneReveals = document.querySelectorAll('.scroll-reveal:not(.stagger-container .scroll-reveal)');
    const revealObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('is-visible');
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.1 });
    standaloneReveals.forEach(el => revealObserver.observe(el));

    // 2. Dedicated Observer for Stats Section & Counters
    const statsSection = document.getElementById('stats-section');
    if (statsSection) {
        const statsObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    // Reveal stat cards
                    const statCards = entry.target.querySelectorAll('.scroll-reveal');
                    statCards.forEach((card, index) => {
                        card.style.transitionDelay = `${index * 70}ms`;
                        card.classList.add('is-visible');
                    });

                    // Start counting numbers
                    const counters = entry.target.querySelectorAll('.stat-counter');
                    counters.forEach((counter, idx) => {
                        if (counter.dataset.animated !== 'true') {
                            setTimeout(() => {
                                animateCounter(counter);
                            }, idx * 70);
                        }
                    });

                    observer.unobserve(entry.target);
                }
            });
        }, { threshold: 0.15 });

        statsObserver.observe(statsSection);
    }

    // Check visibility if page was reloaded midway down
    if (window.scrollY > 0) {
        checkInitialVisibility();
    }
}
