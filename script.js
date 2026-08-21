// MOCK STATE ARRAYS (Tying UI elements together dynamically)
let mockStudents = [
    { id: 1, name: 'زياد أحمد علي', gender: 'ذكر', university: 'أسيوط الأهلية', phone: '01012345678', status: 'مقبول', pickup: 'موقف الفريال', returnPickup: 'موقف الفريال', goTime: '07:30 صباحاً', returnTime: '03:30 عصراً' },
    { id: 2, name: 'محمود كمال سعد', gender: 'ذكر', university: 'جامعة سفنكس', phone: '01122334455', status: 'قيد المراجعة', pickup: 'موقف الأزهر', returnPickup: 'موقف الأزهر', goTime: '08:15 صباحاً', returnTime: '02:30 ظهراً' },
    { id: 3, name: 'سارة محمد عبدالله', gender: 'أنثى', university: 'أسيوط الأهلية', phone: '01233445566', status: 'مقبول', pickup: 'شارع السادات', returnPickup: 'شارع السادات', goTime: '07:30 صباحاً', returnTime: '03:30 عصراً' },
    { id: 4, name: 'عبدالرحمن خالد بكر', gender: 'ذكر', university: 'جامعة سفنكس', phone: '01577889900', status: 'موقوف مؤقتاً', pickup: 'شركة الهواتف', returnPickup: 'شركة الهواتف', goTime: '09:00 صباحاً', returnTime: '05:00 عصراً' }
];

let mockSupervisors = [
    { id: 1, name: 'أ/ محمد رأفت', phone: '01044332211', route: 'موقف الفريال ← الأهلية' },
    { id: 2, name: 'أ/ عادل كمال', phone: '01155667788', route: 'موقف الأزهر ← سفنكس' }
];

let mockBuses = [
    { id: 1, plate: 'أ ج ص 124', capacity: 50, status: 'نشط', type: 'مرسيدس MCV 600 السياحي' },
    { id: 2, plate: 'ق ط س 459', capacity: 30, status: 'في الصيانة', type: 'تويوتا كوستر' },
    { id: 3, plate: 'ر م ب 963', capacity: 50, status: 'نشط', type: 'يوتونج فاخر 2025' }
];

// مصفوفة الرحلات والخطوط العامة النشطة (التي يراها الطالب ويتحكم بها الـ CEO)
let mockTrips = [
    { id: 1, from: 'موقف الفريال', to: 'جامعة أسيوط الأهلية', time: '07:30 صباحاً', bus: 'مرسيدس أ ج ص 124 (باص 1)', supervisor: 'أ/ محمد رأفت', status: 'متاح للحجز' },
    { id: 2, from: 'موقف الأزهر', to: 'جامعة سفنكس', time: '08:15 صباحاً', bus: 'يوتونج ط ر ق 852 (باص 2)', supervisor: 'أ/ عادل كمال', status: 'ممتلئ تماماً' }
];

let supervisorStudents = [
    { name: 'زياد أحمد علي', pickup: 'موقف الفريال', phone: '01012345678', isConfirmed: false },
    { name: 'أحمد محمود بكر', pickup: 'شارع السادات', phone: '01155667788', isConfirmed: true },
    { name: 'عبدالله يحيى منصور', pickup: 'موقف الفريال', phone: '01299887766', isConfirmed: false }
];

let activeUserRole = 'guest';

// DOMContentLoaded load execution (سريع جداً لضمان عدم التعليق)
document.addEventListener('DOMContentLoaded', () => {
    const loader = document.getElementById('loading-screen');
    if (loader) {
        // الفيد أوت السريع لإلغاء التعليق تماماً
        loader.style.opacity = '0';
        setTimeout(() => loader.style.display = 'none', 150);
    }

    // Trigger statistics animate increments safely
    animateCounter();
    
    // Initial data rendering calls
    renderAllDataTables();
    switchRole('guest'); // لتأكيد تزامن ومزامنة هيدر الملاحة تلقائياً
});

// TOAST NOTIFICATION UTILITY
function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    
    const colors = {
        success: 'bg-[#2ECC71] text-white border-b-4 border-[#25a55c]',
        error: 'bg-rose-500 text-white border-b-4 border-rose-600',
        info: 'bg-[#0B5DAA] text-white border-b-4 border-[#08457e]'
    };

    toast.className = `${colors[type]} px-5 py-3 rounded-2xl shadow-xl font-bold text-xs flex items-center gap-2 pointer-events-auto transition-all transform translate-y-3 opacity-0 duration-200`;
    toast.innerHTML = `<i class="fa-solid fa-circle-info"></i> <span>${message}</span>`;
    
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.classList.remove('translate-y-3', 'opacity-0');
    }, 20);

    setTimeout(() => {
        toast.classList.add('translate-y-3', 'opacity-0');
        setTimeout(() => toast.remove(), 200);
    }, 3000);
}

// STATS INCREMENT COUNTER
function animateCounter() {
    const counters = document.querySelectorAll('[data-target]');
    counters.forEach(counter => {
        const target = +counter.getAttribute('data-target');
        let current = 0;
        const updateCount = () => {
            const increment = target / 60;
            if (current < target) {
                current = Math.ceil(current + increment);
                counter.innerText = current;
                setTimeout(updateCount, 15);
            } else {
                counter.innerText = target + (counter.getAttribute('data-target') === '98' ? '%' : '+');
            }
        };
        updateCount();
    });
}

// SYSTEM DATA RENDERING CONTROLLER
function renderAllDataTables() {
    renderStudentsTable();
    renderSupervisorsTable();
    renderBusesGrid();
    renderSupervisorStudentsList();
    renderTripsTable(); // رندر دايناميكي للرحلات المضافة
    updateCEOStatsCounters();
}

// ROLE SWITCHER ROUTER
function switchRole(role) {
    activeUserRole = role;

    const landingView = document.getElementById('landing-view');
    const loginView = document.getElementById('login-view');
    const registerView = document.getElementById('register-view');
    const studentView = document.getElementById('student-view');
    const supervisorView = document.getElementById('supervisor-view');
    const ceoView = document.getElementById('ceo-view');

    const navGuest = document.getElementById('nav-guest');
    const navActions = document.getElementById('nav-actions');
    const navUserBadge = document.getElementById('nav-user-badge');
    const userDisplayName = document.getElementById('user-display-name');

    const roles = ['guest', 'student', 'supervisor', 'ceo'];
    roles.forEach(r => {
        const btn = document.getElementById(`btn-role-${r}`);
        if (btn) {
            if (r === role) {
                btn.className = `px-2 py-1.5 text-[10px] rounded-lg font-black bg-[#0B5DAA] text-white fast-transition border-0 cursor-pointer`;
            } else {
                btn.className = `px-2 py-1.5 text-[10px] rounded-lg font-black bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 fast-transition border-0 cursor-pointer`;
            }
        }
    });

    if (landingView) landingView.classList.add('hidden');
    if (loginView) loginView.classList.add('hidden');
    if (registerView) registerView.classList.add('hidden');
    if (studentView) studentView.classList.add('hidden');
    if (supervisorView) supervisorView.classList.add('hidden');
    if (ceoView) ceoView.classList.add('hidden');

    if (navGuest) navGuest.classList.add('hidden');
    if (navActions) navActions.classList.add('hidden');
    if (navUserBadge) navUserBadge.classList.add('hidden');

    if (role === 'guest') {
        if (landingView) landingView.classList.remove('hidden');
        if (navGuest) {
            navGuest.classList.remove('hidden');
            navGuest.classList.add('md:flex');
        }
        if (navActions) {
            navActions.classList.remove('hidden');
            navActions.classList.add('flex');
        }
    } else if (role === 'student') {
        if (studentView) studentView.classList.remove('hidden');
        if (navUserBadge) {
            navUserBadge.classList.remove('hidden');
            navUserBadge.classList.add('flex');
        }
        if (userDisplayName) userDisplayName.innerText = 'طالب: زياد أحمد';
    } else if (role === 'supervisor') {
        if (supervisorView) supervisorView.classList.remove('hidden');
        if (navUserBadge) {
            navUserBadge.classList.remove('hidden');
            navUserBadge.classList.add('flex');
        }
        if (userDisplayName) userDisplayName.innerText = 'مشرف: محمد رأفت';
    } else if (role === 'ceo') {
        if (ceoView) ceoView.classList.remove('hidden');
        if (navUserBadge) {
            navUserBadge.classList.remove('hidden');
            navUserBadge.classList.add('flex');
        }
        if (userDisplayName) userDisplayName.innerText = 'المدير التنفيذي لرحال';
    }
}

// DARK MODE CONTROLLER
function toggleDarkMode() {
    document.documentElement.classList.toggle('dark');
    showToast('تم تغيير نمط الإضاءة بنجاح والتكامل مع الهوية المظلمة لرحال.', 'success');
}

// LOGOUT LOGIC
function logout() {
    showToast('جاري تسجيل خروجك الآمن من رحال...', 'info');
    setTimeout(() => {
        switchRole('guest');
        showToast('تم تسجيل الخروج بنجاح. أهلاً بك كزائر في الموقع.', 'success');
    }, 600);
}

// EXCEL/PDF EXPORT TRIGGER
function exportTo(format) {
    showToast(`جاري سحب الجداول وتجهيز تقرير البيانات بصيغة ${format}...`, 'info');
    setTimeout(() => {
        showToast(`تم حفظ وتحميل ملف التقرير بنجاح!`, 'success');
    }, 1000);
}

// AUTHENTICATION INTERACTIVE TRIGGERS
function showLogin() {
    switchRole('none');
    const loginView = document.getElementById('login-view');
    if (loginView) loginView.classList.remove('hidden');
}

// REGISTRATION TRIGGER
function showRegister() {
    switchRole('none');
    const registerView = document.getElementById('register-view');
    if (registerView) registerView.classList.remove('hidden');
}

function handleLoginSubmit(e) {
    e.preventDefault();
    const phone = document.getElementById('login-phone').value;
    showToast('جاري التحقق من هوية الطالب أو المشرف ومطابقة الصلاحيات...', 'info');
    
    setTimeout(() => {
        if (phone.startsWith('010')) {
            showToast('تم التحقق بنجاح. مرحباً بعودتك في بوابة الطالب زياد أحمد.', 'success');
            switchRole('student');
        } else if (phone.startsWith('011')) {
            showToast('تم التحقق بنجاح. مرحباً بعودتك مشرفنا الفاضل محمد رأفت.', 'success');
            switchRole('supervisor');
        } else if (phone.startsWith('012') || phone.length > 5) {
            showToast('تم التحقق بنجاح. مرحباً بالقائد التنفيذي لشركة رحال.', 'success');
            switchRole('ceo');
        } else {
            showToast('يرجى التحقق من الرقم المكتوب أو كتابة رقم يبدأ بـ 010 أو 011 لتجربة المحاكاة.', 'error');
        }
    }, 800);
}

function handleRegisterSubmit(e) {
    e.preventDefault();
    const name = document.getElementById('reg-name').value;
    const gender = document.getElementById('reg-gender').value;
    const phone = document.getElementById('reg-phone').value;
    const uni = document.getElementById('reg-university').value;

    showToast('جاري رفع صورة الكارنيه الجامعي والتدقيق في البيانات واللوائح...', 'info');
    setTimeout(() => {
        mockStudents.push({
            id: mockStudents.length + 1,
            name: name,
            gender: gender,
            university: uni,
            phone: phone,
            status: 'قيد المراجعة',
            pickup: 'موقف الفريال',
            returnPickup: 'موقف الفريال',
            goTime: '07:30 صباحاً',
            returnTime: '03:30 عصراً'
        });
        renderAllDataTables();
        showToast('تم إنشاء وتفعيل حسابك كطالب بنجاح وهو الآن قيد المراجعة!', 'success');
        showLogin();
    }, 1000);
}

// STUDENT DASHBOARD CONTROLLERS (تأكيد حجز مقعد الغد بالخانات الخمسة الكاملة)
function bookStudentTrip() {
    const pickup = document.getElementById('student-pickup').value;
    const uni = document.getElementById('student-uni-select').value;
    const goTime = document.getElementById('student-go-time-select').value;
    const returnPickup = document.getElementById('student-return-pickup').value;
    const returnTime = document.getElementById('student-return-time-select').value;
    
    showToast(`جاري حجز مقعدك على حافلات رحال المتجهة إلى ${uni}...`, 'info');
    setTimeout(() => {
        supervisorStudents.push({
            name: 'زياد أحمد علي',
            pickup: pickup,
            phone: '01012345678',
            isConfirmed: false
        });
        renderAllDataTables();
        showToast(`تم الحجز! الذهاب من: ${pickup} (${goTime}) | العودة إلى: ${returnPickup} (${returnTime}) | الجامعة: ${uni}`, 'success');
    }, 600);
}

function saveStudentProfileChanges() {
    const name = document.getElementById('profile-name-val').value;
    showToast('جاري تحديث سجلات البروفايل للرحلات والاشتراكات...', 'info');
    setTimeout(() => {
        showToast(`تم تحديث اسمك بنجاح إلى: ${name}`, 'success');
    }, 600);
}

// SUPERVISOR DASHBOARD CONTROLLERS
function renderSupervisorStudentsList() {
    const tbody = document.getElementById('supervisor-student-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    const totalReserved = supervisorStudents.length;
    const totalConfirmed = supervisorStudents.filter(s => s.isConfirmed).length;
    
    const statStudents = document.getElementById('sup-stat-students');
    if (statStudents) {
        statStudents.innerText = `${totalConfirmed} صعدوا / ${totalReserved} حاجزا`;
    }

    supervisorStudents.forEach((st, index) => {
        tbody.innerHTML += `
            <tr class="hover:bg-slate-50/50 dark:hover:bg-slate-950/20 transition">
                <td class="p-4 font-bold text-slate-800 dark:text-white">${st.name}</td>
                <td class="p-4 font-semibold text-slate-500 dark:text-slate-400">${st.pickup}</td>
                <td class="p-4 font-mono text-slate-600 dark:text-slate-300 font-bold">${st.phone}</td>
                <td class="p-4">
                    <span class="px-2.5 py-1 rounded-xl text-[10px] font-black ${
                        st.isConfirmed ? 'bg-emerald-500/15 text-emerald-500' : 'bg-amber-500/15 text-amber-500'
                    }">
                        ${st.isConfirmed ? 'تم تأكيد الصعود بالباص' : 'لم يصعد بعد'}
                    </span>
                </td>
                <td class="p-4 text-center">
                    <button onclick="toggleStudentPresence(${index})" class="${
                        st.isConfirmed ? 'bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 border-rose-500/10' : 'bg-[#0B5DAA] text-white hover:bg-[#6AB9FF] hover:text-[#081B33]'
                    } font-black text-[10px] px-3.5 py-1.5 rounded-lg border fast-transition shadow-sm cursor-pointer">
                        ${st.isConfirmed ? 'إلغاء التأكيد' : 'تأكيد الركوب'}
                    </button>
                </td>
            </tr>
        `;
    });
}

// TOGGLE PRESENCE
function toggleStudentPresence(index) {
    supervisorStudents[index].isConfirmed = !supervisorStudents[index].isConfirmed;
    renderSupervisorStudentsList();
    showToast('تم تحديث كشف الركوب للطالب بنجاح وتوثيق الحضور.', 'success');
}

function filterSupervisorStudents(val) {
    const tbody = document.getElementById('supervisor-student-tbody');
    if (!tbody) return;
    const rows = tbody.querySelectorAll('tr');
    rows.forEach(row => {
        const name = row.children[0].innerText;
        if (name.includes(val)) {
            row.classList.remove('hidden');
        } else {
            row.classList.add('hidden');
        }
    });
}

// SCAN QR MODAL
function scanQRModal() {
    showToast('جاري فتح ماسح كاميرا الـ QR Code...', 'info');
    setTimeout(() => {
        const unconfirmed = supervisorStudents.find(s => !s.isConfirmed);
        if (unconfirmed) {
            unconfirmed.isConfirmed = true;
            renderSupervisorStudentsList();
            showToast(`تم مسح الكود بنجاح وتأكيد حضور وصعود الطالب: ${unconfirmed.name}`, 'success');
        } else {
            showToast('تم تأكيد صعود جميع الطلاب المشتركين بباستك بالفعل!', 'info');
        }
    }, 1000);
}

// RENDER DYNAMIC TRIPS (الربط التفاعلي المباشر للرحلات التي يضيفها الـ CEO)
function renderTripsTable() {
    const studentTbody = document.getElementById('student-trips-tbody');
    if (studentTbody) {
        studentTbody.innerHTML = '';
        mockTrips.forEach(trip => {
            studentTbody.innerHTML += `
                <tr class="hover:bg-slate-50/50 dark:hover:bg-slate-950/20 transition animate-[fadeIn_0.1s_ease-out]">
                    <td class="p-4 font-bold text-slate-800 dark:text-white">${trip.from} ← ${trip.to}</td>
                    <td class="p-4 font-bold text-brand-primary dark:text-brand-secondary">${trip.time}</td>
                    <td class="p-4 font-mono font-bold">${trip.bus}</td>
                    <td class="p-4">${trip.supervisor}</td>
                    <td class="p-4">
                        <span class="bg-emerald-500/10 text-emerald-500 px-2.5 py-1 rounded-full font-bold">${trip.status}</span>
                    </td>
                </tr>
            `;
        });
    }
}

// CEO DASHBOARD CONTROLLERS
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
}

// UPDATE CEO COUNTERS
function updateCEOStatsCounters() {
    const studentsCount = document.getElementById('stat-ceo-students-count');
    const supsCount = document.getElementById('stat-ceo-sups-count');
    const busesCount = document.getElementById('stat-ceo-buses-count');

    if (studentsCount) studentsCount.innerText = mockStudents.length;
    if (supsCount) supsCount.innerText = mockSupervisors.length;
    if (busesCount) busesCount.innerText = mockBuses.length;
}

// Students Subview Management (مطور بالكامل بمطابقة التفضيلات مع الأزرار الأربعة الصريحة لتسهيل العمل لمدير رحال)
function renderStudentsTable() {
    const tbody = document.getElementById('ceo-students-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    mockStudents.forEach(st => {
        tbody.innerHTML += `
            <tr class="hover:bg-slate-50/50 dark:hover:bg-slate-950/20 transition animate-[fadeIn_0.1s_ease-out]">
                <td class="p-4 font-black text-slate-800 dark:text-white">${st.name}</td>
                <td class="p-4 font-semibold text-slate-500 dark:text-slate-400">${st.university}</td>
                <td class="p-4 font-mono font-bold text-slate-600 dark:text-slate-300">${st.phone}</td>
                <td class="p-4">
                    <span class="px-2.5 py-1 rounded-xl text-[10px] font-black ${
                        st.status === 'مقبول' ? 'bg-emerald-500/15 text-emerald-500' :
                        st.status === 'قيد المراجعة' ? 'bg-amber-500/15 text-amber-500' : 
                        st.status === 'موقوف مؤقتاً' ? 'bg-orange-500/15 text-orange-500' : 'bg-rose-500/15 text-rose-500'
                    }">${st.status}</span>
                </td>
                <td class="p-4 text-center space-x-1 flex items-center justify-center gap-1.5 flex-wrap">
                    <!-- زر تفاصيل الملف الكامل لعرض كل البيانات المدخلة في مودال فاخر ومضيء -->
                    <button onclick="viewStudentDetails(${st.id})" class="bg-blue-500/10 text-blue-500 border border-blue-500/20 font-black text-[10px] px-2.5 py-1.5 rounded-lg fast-transition hover:bg-blue-500 hover:text-white cursor-pointer border-0"><i class="fa-solid fa-magnifying-glass"></i> تفاصيل</button>
                    
                    <!-- الخيار الأول: اعتماد الحساب وتنشيط تصريح ركوب حافلات رحال -->
                    <button onclick="setStudentStatus(${st.id}, 'مقبول')" class="bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 font-black text-[10px] px-2.5 py-1.5 rounded-lg fast-transition hover:bg-emerald-500 hover:text-white cursor-pointer border-0"><i class="fa-solid fa-check"></i> اعتماد</button>
                    
                    <!-- الخيار الثاني: توقيف مؤقت للحساب -->
                    <button onclick="setStudentStatus(${st.id}, 'موقوف مؤقتاً')" class="bg-amber-500/10 text-amber-500 border border-amber-500/20 font-black text-[10px] px-2.5 py-1.5 rounded-lg fast-transition hover:bg-amber-500 hover:text-white cursor-pointer border-0"><i class="fa-solid fa-pause"></i> توقيف</button>
                    
                    <!-- الخيار الثالث: رفض الحساب وإبطال الكارنيه -->
                    <button onclick="setStudentStatus(${st.id}, 'مرفوض')" class="bg-rose-500/10 text-rose-500 border border-rose-500/20 font-black text-[10px] px-2.5 py-1.5 rounded-lg fast-transition hover:bg-rose-500 hover:text-white cursor-pointer border-0"><i class="fa-solid fa-xmark"></i> رفض</button>
                    
                    <!-- الخيار الرابع: حذف الحساب نهائياً -->
                    <button onclick="deleteStudent(${st.id})" class="bg-red-600 text-white font-black text-[10px] px-2.5 py-1.5 rounded-lg fast-transition hover:bg-red-700 cursor-pointer border-0"><i class="fa-solid fa-trash"></i> حذف</button>
                </td>
            </tr>
        `;
    });
}

// تفاصيل الملف الكامل وعرض كل المعلومات التي يدخلها الطالب في المودال بالتفصيل
function viewStudentDetails(id) {
    const student = mockStudents.find(s => s.id === id);
    if (!student) return;

    // إسقاط البيانات الموحدة داخل المودال بدقة متناهية
    document.getElementById('det-name').innerText = student.name;
    document.getElementById('det-phone').innerText = student.phone;
    document.getElementById('det-uni').innerText = student.university;
    document.getElementById('det-gender').innerText = student.gender;
    
    document.getElementById('det-pickup').innerText = student.pickup;
    document.getElementById('det-gotime').innerText = student.goTime;
    document.getElementById('det-returnpickup').innerText = student.returnPickup;
    document.getElementById('det-returntime').innerText = student.returnTime;
    
    document.getElementById('det-card-text').innerText = `ID_${student.id}_CARD_APPROVED`;

    // إعداد أزرار العمليات السريعة من داخل المودال نفسه لتسريع اتخاذ القرار
    const modalActions = document.getElementById('det-modal-actions');
    modalActions.innerHTML = `
        <button onclick="setStudentStatus(${student.id}, 'مقبول'); closeModal('view-student-modal');" class="flex-1 bg-emerald-500 text-white font-bold py-2 rounded-xl text-xs cursor-pointer border-0"><i class="fa-solid fa-check"></i> اعتماد الحساب</button>
        <button onclick="setStudentStatus(${student.id}, 'موقوف مؤقتاً'); closeModal('view-student-modal');" class="flex-1 bg-amber-500 text-white font-bold py-2 rounded-xl text-xs cursor-pointer border-0"><i class="fa-solid fa-pause"></i> توقيف مؤقت</button>
        <button onclick="setStudentStatus(${student.id}, 'مرفوض'); closeModal('view-student-modal');" class="flex-1 bg-rose-500 text-white font-bold py-2 rounded-xl text-xs cursor-pointer border-0"><i class="fa-solid fa-xmark"></i> رفض</button>
    `;

    const modal = document.getElementById('view-student-modal');
    if (modal) modal.classList.remove('hidden');
}

// تغيير الحالة دايناميكياً وتفاعلياً مع تحديث كشوفات الألوان والإشعارات
function setStudentStatus(id, newStatus) {
    const student = mockStudents.find(s => s.id === id);
    if (student) {
        student.status = newStatus;
        renderAllDataTables();
        
        const msgs = {
            'مقبول': 'تم اعتماد حساب الطالب بنجاح وتنشيط تصريح ركوب حافلات رحال الآمن.',
            'موقوف مؤقتاً': 'تم إيقاف حساب الطالب والاشتراك مؤقتاً بنجاح.',
            'مرفوض': 'تم رفض الحساب وتوثيق مبررات الرفض بقاعدة البيانات.'
        };
        showToast(msgs[newStatus] || 'تم تحديث حالة الحساب بنجاح', 'success');
    }
}

function deleteStudent(id) {
    if (confirm('هل ترغب بتأكيد حذف هذا الطالب واستبعاده من رحلات رحال بشكل نهائي؟')) {
        mockStudents = mockStudents.filter(s => s.id !== id);
        renderAllDataTables();
        showToast('تم شطب الطالب نهائياً من كشوفات رحال بنجاح.', 'success');
    }
}

function searchStudentsTable(val) {
    const tbody = document.getElementById('ceo-students-tbody');
    if (!tbody) return;
    const rows = tbody.querySelectorAll('tr');
    rows.forEach(row => {
        const name = row.children[0].innerText;
        if (name.includes(val)) {
            row.classList.remove('hidden');
        } else {
            row.classList.add('hidden');
        }
    });
}

// CEO Supervisors Subview Management
function renderSupervisorsTable() {
    const tbody = document.getElementById('ceo-supervisors-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    mockSupervisors.forEach(sup => {
        tbody.innerHTML += `
            <tr class="hover:bg-slate-50/50 dark:hover:bg-slate-950/20 transition animate-[fadeIn_0.1s_ease-out]">
                <td class="p-4 font-black text-slate-800 dark:text-white">${sup.name}</td>
                <td class="p-4 font-mono font-bold text-slate-600 dark:text-slate-300">${sup.phone}</td>
                <td class="p-4 font-semibold text-slate-500 dark:text-slate-400">${sup.route}</td>
                <td class="p-4 text-center">
                    <button onclick="deleteSupervisor(${sup.id})" class="text-rose-500 hover:text-rose-600 font-black hover:underline bg-transparent border-0 cursor-pointer">حذف المشرف</button>
                </td>
            </tr>
        `;
    });
}

function openAddSupervisorModal() {
    const modal = document.getElementById('add-supervisor-modal');
    if (modal) modal.classList.remove('hidden');
}

function closeModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.classList.add('hidden');
}

function saveNewSupervisor() {
    const name = document.getElementById('new-sup-name').value;
    const phone = document.getElementById('new-sup-phone').value;
    const route = document.getElementById('new-sup-route').value;

    if (name && phone && route) {
        mockSupervisors.push({
            id: mockSupervisors.length + 1,
            name: name,
            phone: phone,
            route: route
        });
        renderAllDataTables();
        closeModal('add-supervisor-modal');
        showToast('تم تسجيل المشرف وإضافته للنظام والمحاكاة بنجاح!', 'success');
        
        // Reset fields
        document.getElementById('new-sup-name').value = '';
        document.getElementById('new-sup-phone').value = '';
        document.getElementById('new-sup-route').value = '';
    } else {
        showToast('يرجى ملء جميع الحقول المطلوبة لتسجيل المشرف.', 'error');
    }
}

function deleteSupervisor(id) {
    if (confirm('هل أنت متأكد من رغبتك في حذف هذا المشرف وتفريغ الحافلة؟')) {
        mockSupervisors = mockSupervisors.filter(s => s.id !== id);
        renderAllDataTables();
        showToast('تم استبعاد المشرف وحذف بياناته.', 'success');
    }
}

// CEO Buses Subview Management
function renderBusesGrid() {
    const grid = document.getElementById('ceo-buses-grid');
    if (!grid) return;
    grid.innerHTML = '';
    mockBuses.forEach(bus => {
        grid.innerHTML += `
            <div class="glass-card p-6 rounded-3xl space-y-4 hover:scale-[1.03] animate-[fadeIn_0.1s_ease-out]">
                <div class="flex items-center justify-between">
                    <span class="text-3xl">🚌</span>
                    <span class="px-2.5 py-1 rounded-full text-[10px] font-black ${
                        bus.status === 'نشط' ? 'bg-emerald-500/15 text-emerald-500' : 'bg-rose-500/15 text-rose-500'
                    }">
                        ${bus.status}
                    </span>
                </div>
                <div>
                    <h4 class="font-black text-sm text-slate-800 dark:text-white">${bus.type}</h4>
                    <p class="text-xs text-slate-400 font-bold mt-1">لوحات الحافلة: <span class="font-mono text-slate-600 dark:text-slate-300">${bus.plate}</span></p>
                    <p class="text-[10px] text-slate-400 font-bold">سعة المقاعد: ${bus.capacity} مقعد</p>
                </div>
                <button onclick="deleteBus(${bus.id})" class="w-full bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/15 text-[10px] font-black py-2.5 rounded-xl transition cursor-pointer border-0">
                    حذف الحافلة من الأسطول
                </button>
            </div>
        `;
    });
}

function openAddBusModal() {
    const modal = document.getElementById('add-bus-modal');
    if (modal) modal.classList.remove('hidden');
}

function saveNewBus() {
    const plate = document.getElementById('new-bus-plate').value;
    const cap = document.getElementById('new-bus-capacity').value;
    const type = document.getElementById('new-bus-type').value;

    if (plate && cap && type) {
        mockBuses.push({
            id: mockBuses.length + 1,
            plate: plate,
            capacity: cap,
            status: 'نشط',
            type: type
        });
        renderAllDataTables();
        closeModal('add-bus-modal');
        showToast('تمت إضافة الباص بنجاح وتجهيز طاقة المقاعد للرحلات.', 'success');
        
        document.getElementById('new-bus-plate').value = '';
        document.getElementById('new-bus-capacity').value = '';
        document.getElementById('new-bus-type').value = '';
    } else {
        showToast('يرجى كتابة كافة بيانات الحافلة المرفقة.', 'error');
    }
}

function deleteBus(id) {
    if (confirm('هل أنت متأكد من بيع أو استبعاد هذه الحافلة نهائياً؟')) {
        mockBuses = mockBuses.filter(b => b.id !== id);
        renderAllDataTables();
        showToast('تم استبعاد وحذف الباص من نظام رحال.', 'success');
    }
}

// CEO Trip Creator Management (يضيف مباشرة خط سير مخصص بـ من، إلى، الساعة)
function handleCreateTripSubmit(e) {
    e.preventDefault();
    const sup = document.getElementById('trip-supervisor').value;
    const from = document.getElementById('trip-from').value;
    const to = document.getElementById('trip-to').value;
    const time = document.getElementById('trip-time').value;
    const bus = document.getElementById('trip-bus').value;

    if (from && to && time) {
        showToast('جاري تجميع وحفظ خط السير الجديد لرحال...', 'info');
        setTimeout(() => {
            // إدراج خط السير الجديد تفاعلياً داخل قائمة الرحلات لكي يظهر للطالب فوراً
            mockTrips.push({
                id: mockTrips.length + 1,
                from: from,
                to: to,
                time: time,
                bus: bus,
                supervisor: sup,
                status: 'متاح للحجز'
            });
            renderAllDataTables();
            showToast(`تم إنشاء خط السير الجديد بنجاح وإتاحته فوراً للطلاب: من ${from} إلى ${to} الساعة ${time}`, 'success');
            switchCeoTab('ceo-main');
        }, 1000);
    } else {
        showToast('يرجى تحديد تفاصيل خط السير بدقة (من، إلى، الوقت).', 'error');
    }
}
