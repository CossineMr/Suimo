const { ipcRenderer } = require('electron');

const slimeEl = document.getElementById('slime');
const drawIndicator = document.getElementById('drawIndicator');
const drawStatusEl = document.getElementById('drawStatus');
const drawIconEl = document.getElementById('drawIndicatorIcon');
const quitBtn = document.getElementById('quitBtn');
const edgeDetector = document.getElementById('right-edge-detector');
const controls = document.getElementById('controls');

let hideTimeout = null;

function showControls() {
    clearTimeout(hideTimeout);
    controls.classList.add('show');
}

function hideControlsLater() {
    clearTimeout(hideTimeout);
    hideTimeout = setTimeout(() => {
        controls.classList.remove('show');
    }, 2000);
}

edgeDetector.addEventListener('mouseenter', showControls);
edgeDetector.addEventListener('mouseleave', hideControlsLater);
controls.addEventListener('mouseenter', showControls);
controls.addEventListener('mouseleave', hideControlsLater);

let isDrawingMode = false;
let platforms = []; // Array of {x, y, width, height, el}
let workArea = { width: window.innerWidth, height: window.innerHeight };

// Sàn thực (trừ taskbar) — sẽ được cập nhật từ main process
let floorY = window.innerHeight;
ipcRenderer.on('work-area-height', (_event, h) => {
    floorY = h;
    workArea.height = h; // Đồng bộ workArea
    console.log('[SlimePet] floorY dã cập nhật:', floorY);
});
// Request ngay khi có thể
ipcRenderer.invoke('get-work-area-height').then(h => {
    if (h) {
        floorY = h;
        workArea.height = h;
    }
});


let slime = {
    x: workArea.width / 2, y: 0,
    vx: 0, vy: 0,
    w: 150, h: 100,
    isDragging: false,
    inAir: true,
    // Autonomous behavior variables
    state: 'IDLE', // IDLE, WANDERING, HIDING, PEEKING
    stateTimer: Date.now() + 2000,
    facingRight: true,
    behaviorFloorY: null, // Sẽ dùng floorY mặc định
    // Climbing AI data
    climbTarget: null,
    climbAttempts: 0,
    climbGiveUpUntil: 0,
    isPreparingJump: false
};

function spawnEmote(text, follow = false) {
    const el = document.createElement('div');
    el.className = 'emote-popup';
    el.textContent = text;
    document.body.appendChild(el);
    
    const updatePos = () => {
        el.style.left = (slime.x + slime.w / 2 - 12) + 'px';
        el.style.top = (slime.y - 25) + 'px'; 
    };
    
    updatePos();
    
    if (follow) {
        const interval = setInterval(updatePos, 16);
        el.addEventListener('animationend', () => {
            clearInterval(interval);
            el.remove();
        }, { once: true });
    } else {
        el.addEventListener('animationend', () => el.remove(), { once: true });
    }
}

function triggerLandSquish() {
    AudioManager.playSFX('Squish');
    slimeEl.classList.remove('land-squish');
    void slimeEl.offsetWidth; // Force reflow
    slimeEl.classList.add('land-squish');
    slimeEl.addEventListener('animationend', () => {
        slimeEl.classList.remove('land-squish');
    }, { once: true });
}

// Tự động đo độ dày pixel trong suốt phía dưới của PNG
let OFFSET_BOTTOM = 0;
function detectBottomPadding(imgEl) {
    const canvas = document.createElement('canvas');
    canvas.width = imgEl.naturalWidth;
    canvas.height = imgEl.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(imgEl, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    // Quét từ dưới lên, tìm hàng đầu tiên có alpha > 0
    for (let row = canvas.height - 1; row >= 0; row--) {
        for (let col = 0; col < canvas.width; col++) {
            const alpha = data[(row * canvas.width + col) * 4 + 3];
            if (alpha > 10) {
                // Hàng 'row' là hàng pixel thực dưới cùng
                const transparentRows = canvas.height - 1 - row;
                // Tỉ lệ scale theo chiều cao hiển thị thực tế
                OFFSET_BOTTOM = Math.round(transparentRows * (imgEl.clientHeight / canvas.height));
                console.log(`[SlimePet] Đã phát hiện bottom padding: ${OFFSET_BOTTOM}px`);
                return;
            }
        }
    }
}

// ==== KIỂM TRA ĐIỂM CHẠM CHÍNH XÁC (ALPHA MASK) ====
let slimePixelData = null;
let slimeHitCanvas = document.createElement('canvas');
let slimeHitCtx = slimeHitCanvas.getContext('2d');

function prepareSlimeHitData() {
    if (!slimeEl.naturalWidth) return;
    slimeHitCanvas.width = slimeEl.naturalWidth;
    slimeHitCanvas.height = slimeEl.naturalHeight;
    slimeHitCtx.clearRect(0, 0, slimeHitCanvas.width, slimeHitCanvas.height);
    slimeHitCtx.drawImage(slimeEl, 0, 0);
    slimePixelData = slimeHitCtx.getImageData(0, 0, slimeHitCanvas.width, slimeHitCanvas.height).data;
    console.log('[SlimePet] Đã chuẩn bị dữ liệu Hit-test.');
}

function isOverSlimeBody(offsetX, offsetY) {
    if (!slimePixelData) return false;

    // Tính toán tỉ lệ scale giữa hiển thị và tự nhiên
    const scaleX = slimeHitCanvas.width / slimeEl.clientWidth;
    const scaleY = slimeHitCanvas.height / slimeEl.clientHeight;

    let px = offsetX * scaleX;
    let py = offsetY * scaleY;

    // Xử lý nếu đang bị lật (flipped)
    if (slimeEl.classList.contains('flipped')) {
        px = slimeHitCanvas.width - px;
    }

    px = Math.floor(px);
    py = Math.floor(py);

    if (px < 0 || px >= slimeHitCanvas.width || py < 0 || py >= slimeHitCanvas.height) return false;

    const index = (py * slimeHitCanvas.width + px) * 4;
    const alpha = slimePixelData[index + 3];

    return alpha > 30; // Ngưỡng alpha để tính là chạm
}

// ==== HỆ THỐNG KIỂM TRA ĐIỂM CHẠM TẬP TRUNG (MOUSE INTERACTION) ====
function checkMouseInteraction(mx, my) {
    if (isDrawingMode || slime.isDragging) {
        ipcRenderer.send('set-ignore-mouse-events', false);
        return;
    }

    let shouldBlock = false;

    // 1. Kiểm tra bé Sui (Pixel-perfect)
    const slimeRect = slimeEl.getBoundingClientRect();
    if (mx >= slimeRect.left && mx <= slimeRect.right &&
        my >= slimeRect.top && my <= slimeRect.bottom) {
        if (isOverSlimeBody(mx - slimeRect.left, my - slimeRect.top)) {
            shouldBlock = true;
            slimeEl.classList.add('sui-glow');
        } else {
            slimeEl.classList.remove('sui-glow');
        }
    } else {
        slimeEl.classList.remove('sui-glow');
    }

    // 2. Kiểm tra cửa sổ Manager (nếu đang mở)
    if (!shouldBlock && typeof SuiManager !== 'undefined' && SuiManager.isOpen) {
        const rect = SuiManager.el.getBoundingClientRect();
        if (mx >= rect.left && mx <= rect.right && 
            my >= rect.top && my <= rect.bottom) {
            shouldBlock = true;
        }
    }

    // 3. Kiểm tra các nút UI khác (như quitBtn, music-status, controls)
    if (!shouldBlock) {
        const interactives = document.querySelectorAll('.interactive:not(#slime):not(#sui-manager)');
        for (let el of interactives) {
            if (el.offsetWidth > 0 && el.offsetHeight > 0) {
                const rect = el.getBoundingClientRect();
                if (mx >= rect.left && mx <= rect.right && 
                    my >= rect.top && my <= rect.bottom) {
                    shouldBlock = true;
                    break;
                }
            }
        }
    }

    // Gửi tín hiệu cho Electron
    if (shouldBlock) {
        ipcRenderer.send('set-ignore-mouse-events', false);
    } else {
        ipcRenderer.send('set-ignore-mouse-events', true, { forward: true });
    }
}

window.addEventListener('mousemove', (e) => {
    checkMouseInteraction(e.clientX, e.clientY);
});

quitBtn.addEventListener('click', () => ipcRenderer.send('quit-app'));

// ==== AM THANH & NHAC (AUDIO MANAGER) & TRINH PHAT NHAC (MUSIC PLAYER UI) DA DUOC CHUYEN SANG music_player.js ====


// ==== CHẾ ĐỘ VẼ BẬC THANG (GIỮ PHÍM SPACE) ====
let isSpaceHeld = false;

// ==== HỆ THỐNG BÃO & HIỆU ỨNG THỜI TIẾT ĐÃ ĐƯỢC CHUYỂN SANG features/weather_effects.js ====

window.addEventListener('keydown', (e) => {
    // Nếu đang tập trung vào ô nhập liệu thì không xử lý phím tắt hệ thống
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
        return;
    }

    if (isDrawingMode) return; 
    const key = e.key.toLowerCase();
    if (key === 'm') SuiManager.toggle();

    if (e.code === 'Space') {
        if (!isSpaceHeld) {
            isSpaceHeld = true;
            isDrawingMode = true;
            ipcRenderer.send('set-ignore-mouse-events', false);
            // Emote tò mò khi bắt đầu chế độ vẽ (chỉ hiện 1 lần)
            spawnEmote('🧐', true);
            
            // Hien lai cac platform, xoa timer cu
            platforms.forEach(p => {
                if (p.timer) { clearTimeout(p.timer); p.timer = null; }
                p.el.classList.remove('hidden');
            });
            // Indicator -> san sang
            drawIndicator.className = 'ready';
            drawIconEl.textContent = '🎯';
            drawStatusEl.textContent = 'Keo chuot de ve san';
        }
        e.preventDefault();
        return;
    }
});

window.addEventListener('keyup', (e) => {
    if (e.code !== 'Space' || !isSpaceHeld) return;
    isSpaceHeld = false;

    // Hoan thien hinh dang ve do (neu co)
    if (isDrawingBox && drawBoxDiv) {
        isDrawingBox = false;
        const rect = drawBoxDiv.getBoundingClientRect();
        drawBoxDiv.remove();
        drawBoxDiv = null;
        if (rect.width > 20 && rect.height > 20) {
            const platformDiv = document.createElement('div');
            platformDiv.className = 'platform interactive';
            platformDiv.style.left = rect.left + 'px';
            platformDiv.style.top = rect.top + 'px';
            platformDiv.style.width = rect.width + 'px';
            platformDiv.style.height = rect.height + 'px';
            applyHoverLogic(platformDiv);
            document.body.appendChild(platformDiv);
            platforms.push({ x: rect.left, y: rect.top, width: rect.width, height: rect.height, el: platformDiv, timer: null });
        }
    }

    // Thoat che do ve
    isDrawingMode = false;
    ipcRenderer.send('set-ignore-mouse-events', true, { forward: true });
    drawIndicator.className = '';

    // An platform va bat dau dem nguoc 10s
    platforms.forEach(p => {
        p.el.classList.add('hidden');
        if (p.timer) clearTimeout(p.timer);
        p.timer = setTimeout(() => {
            const index = platforms.indexOf(p);
            if (index !== -1) { p.el.remove(); platforms.splice(index, 1); }
        }, 10000);
    });
});

let isDrawingBox = false;
let startX, startY;
let drawBoxDiv = null;

window.addEventListener('mousedown', (e) => {
    if (!isDrawingMode || e.target.closest('#controls')) return;

    if (e.button === 2) { // Bấm chuột phải để xóa platform
        for (let i = 0; i < platforms.length; i++) {
            let p = platforms[i];
            if (e.clientX >= p.x && e.clientX <= p.x + p.width && e.clientY >= p.y && e.clientY <= p.y + p.height) {
                p.el.remove();
                platforms.splice(i, 1);
                return;
            }
        }
        return;
    }

    isDrawingBox = true;
    startX = e.clientX;
    startY = e.clientY;

    drawBoxDiv = document.createElement('div');
    drawBoxDiv.id = 'draw-box';
    drawBoxDiv.style.left = startX + 'px';
    drawBoxDiv.style.top = startY + 'px';
    document.body.appendChild(drawBoxDiv);

    // Indicator -> dang ve
    drawIndicator.className = 'drawing';
    drawIconEl.textContent = '✏️';
    drawStatusEl.textContent = 'Đang vẽ...';
});

window.addEventListener('mousemove', (e) => {
    if (!isDrawingBox) return;
    let w = e.clientX - startX;
    let h = e.clientY - startY;
    drawBoxDiv.style.width = Math.abs(w) + 'px';
    drawBoxDiv.style.height = Math.abs(h) + 'px';
    drawBoxDiv.style.left = (w < 0 ? e.clientX : startX) + 'px';
    drawBoxDiv.style.top = (h < 0 ? e.clientY : startY) + 'px';
});

window.addEventListener('mouseup', (e) => {
    if (!isDrawingBox) return;
    isDrawingBox = false;

    let rect = drawBoxDiv.getBoundingClientRect();
    if (rect.width > 20 && rect.height > 20) {
        let platformDiv = document.createElement('div');
        platformDiv.className = 'platform interactive';
        platformDiv.style.left = rect.left + 'px';
        platformDiv.style.top = rect.top + 'px';
        platformDiv.style.width = rect.width + 'px';
        platformDiv.style.height = rect.height + 'px';

        applyHoverLogic(platformDiv);
        document.body.appendChild(platformDiv);

        let newPlatform = { x: rect.left, y: rect.top, width: rect.width, height: rect.height, el: platformDiv, timer: null };
        platforms.push(newPlatform);
    }

    drawBoxDiv.remove();
    drawBoxDiv = null;

    // Neu van giu Space -> tro lai san sang
    if (isSpaceHeld) {
        drawIndicator.className = 'ready';
        drawIconEl.textContent = '🎯';
        drawStatusEl.textContent = 'Nhấn giữ chuột và phím space để vẽ sàn';
    }
});

// ==== HỆ THỐNG QUẢN LÝ SỰ KIỆN ====
const EventManager = {
    events: [],
    currentIndex: -1,
    activeEvent: null,

    register(eventObj) {
        this.events.push(eventObj);
        console.log(`[EventManager] Đã đăng ký sự kiện: ${eventObj.name}`);
    },

    startNext() {
        this.currentIndex++;
        if (this.currentIndex < this.events.length) {
            this.activeEvent = this.events[this.currentIndex];
            console.log(`[EventManager] Bắt đầu sự kiện: ${this.activeEvent.name}`);
            if (this.activeEvent.init) this.activeEvent.init();
        } else {
            this.activeEvent = null;
            // console.log("[EventManager] Tất cả sự kiện đã hoàn thành.");
        }
    },

    onEventFinished(eventObj) {
        if (this.activeEvent === eventObj) {
            console.log(`[EventManager] Sự kiện kết thúc: ${eventObj.name}`);
            this.startNext();
        }
    },

    update() {
        if (this.activeEvent && this.activeEvent.update) {
            return this.activeEvent.update(); // Trả về true nếu sự kiện đang chiếm quyền điều khiển
        }
        return false;
    }
};

// Khởi chạy sau khi tất cả script đã load
window.addEventListener('load', async () => {
    // Tải trước các âm thanh VFX/SFX
    if (typeof AudioManager !== 'undefined') {
        // Tải SFX quan trọng trước
        await AudioManager.preloadSFX(['Squish', 'Lightning', 'Rain', 'CardboardBoxDrop']);
        // Tải nhạc nền sự kiện sau
        AudioManager.preloadMusic('birthday_song', 'event/birthday_module/audio/Happy Birthday To You.mp3');
    }

    setTimeout(() => {
        EventManager.startNext();
    }, 1000); // Đợi 1 chút để đảm bảo mọi thứ đã sẵn sàng
});

// Đảm bảo AudioContext được resume ngay khi người dùng tương tác lần đầu
window.addEventListener('mousedown', () => {
    if (typeof AudioManager !== 'undefined' && AudioManager.audioContext) {
        if (AudioManager.audioContext.state === 'suspended') {
            AudioManager.audioContext.resume();
        }
    }
}, { once: true });

// ==== QUYẾT ĐỊNH HÀNH VI TỰ ĐỘNG ====
function updateAutonomousBehavior() {
    if (slime.isDragging) {
        slime.state = 'IDLE';
        return;
    }

    // Kiểm tra xem có sự kiện nào đang chiếm quyền điều khiển không
    if (EventManager.update()) {
        return;
    }

    // Chế độ leo bậc thang (CLIMBING) - Chỉ chạy khi KHÔNG ở chế độ vẽ
    if (!isDrawingMode && platforms.length > 0 && Date.now() > slime.climbGiveUpUntil) {
        if (!slime.climbMode) slime.climbMode = 'ASCENDING';
        if (!slime.climbHistory) slime.climbHistory = [];

        // Hỗ trợ mục tiêu giả (mặt đất)
        let hasValidTarget = slime.climbTarget && (platforms.includes(slime.climbTarget) || slime.climbTarget.isFloorMock);

        // Tìm bậc thang mục tiêu nếu chưa có hoặc mục tiêu đã biến mất
        if (!hasValidTarget) {
            // Xác định xem đang ở trên sàn nhà hay trên bậc thang
            let currentPlatform = platforms.find(p => 
                slime.x + slime.w > p.x && slime.x < p.x + p.width && 
                Math.abs(slime.y + slime.h - OFFSET_BOTTOM - p.y) < 30
            );

            if (!currentPlatform) {
                // Đang ở dưới đất
                if (slime.climbMode === 'DESCENDING') {
                    // Xuống tới đất rồi! Hoàn thành hành trình.
                    slime.climbMode = 'ASCENDING';
                    slime.climbHistory = [];
                    spawnEmote('🐾', true);
                    slime.climbTarget = null;
                    slime.climbGiveUpUntil = Date.now() + 5000;
                } else {
                    // Bắt đầu leo lên
                    slime.climbMode = 'ASCENDING';
                    slime.climbHistory = [];
                    let lowest = platforms[0];
                    platforms.forEach(p => { if (p.y > lowest.y) lowest = p; });
                    slime.climbTarget = lowest;
                    slime.climbAttempts = 0;
                    slime.isRunningUp = false;
                    spawnEmote('!', true);
                }
            } else {
                // Đang ở trên một bậc thang
                if (slime.climbMode === 'ASCENDING') {
                    let closest = null;
                    let minDist = 500;
                    let isHighest = true;

                    platforms.forEach(p => {
                        if (p.y < currentPlatform.y - 10) isHighest = false;
                        if (p === currentPlatform) return;
                        if (p.y > currentPlatform.y + 10) return; // Chỉ tìm bậc cao hơn hoặc ngang bằng
                        const dist = Math.abs((p.x + p.width / 2) - (currentPlatform.x + currentPlatform.width / 2));
                        if (dist < minDist) {
                            minDist = dist;
                            closest = p;
                        }
                    });

                    if (isHighest) {
                        slime.climbMode = 'CELEBRATING';
                        slime.celebrateTimer = Date.now() + 3000;
                        spawnEmote('🥳', true);
                        slime.climbTarget = null;
                    } else if (closest) {
                        slime.climbTarget = closest;
                        slime.climbAttempts = 0;
                        slime.isRunningUp = false;
                        spawnEmote('💨', true);
                    } else {
                        slime.climbMode = 'CELEBRATING';
                        slime.celebrateTimer = Date.now() + 3000;
                        spawnEmote('🥳', true);
                        slime.climbTarget = null;
                    }
                } else if (slime.climbMode === 'CELEBRATING') {
                    if (Date.now() < slime.celebrateTimer) {
                        if (!slime.inAir && Math.random() < 0.1) {
                            slime.vy = -6 - Math.random() * 4;
                            slime.vx = 0;
                            slime.inAir = true;
                            const emotes = ['🥳', '🎉', '✨', '🎵'];
                            spawnEmote(emotes[Math.floor(Math.random() * emotes.length)], true);
                        }
                        return; // Bỏ qua phần tính toán leo trèo khi đang ăn mừng
                    } else {
                        slime.climbMode = 'DESCENDING';
                        slime.climbTarget = null; // Kích hoạt vòng lặp tìm mục tiêu mới
                    }
                } else if (slime.climbMode === 'DESCENDING') {
                    let prevPlatform = null;
                    while (slime.climbHistory.length > 0) {
                        prevPlatform = slime.climbHistory.pop();
                        if (prevPlatform !== currentPlatform && platforms.includes(prevPlatform)) {
                            break;
                        } else {
                            prevPlatform = null;
                        }
                    }

                    if (prevPlatform) {
                        slime.climbTarget = prevPlatform;
                        slime.climbAttempts = 0;
                        slime.isRunningUp = false;
                        spawnEmote('⬇️', true);
                    } else {
                        // Mục tiêu giả: Mặt đất ngay bên dưới
                        slime.climbTarget = {
                            x: currentPlatform.x,
                            y: currentFloorY,
                            width: currentPlatform.width,
                            isFloorMock: true
                        };
                        slime.climbAttempts = 0;
                        slime.isRunningUp = false;
                        spawnEmote('⬇️', true);
                    }
                }
            }
        }

        if (slime.climbTarget && slime.climbMode !== 'CELEBRATING') {
            slime.state = 'CLIMBING';
            const target = slime.climbTarget;
            const targetCenterX = target.x + target.width / 2;
            const suiCenterX = slime.x + slime.w / 2;
            const dist = targetCenterX - suiCenterX;

            if (!slime.inAir) {
                if (!slime.climbSubState) slime.climbSubState = 'EVALUATING';

                let edgeLeft = -10000;
                let edgeRight = 10000;
                let currentPlatform = null;

                // Xác định nền đang đứng
                for (let p of platforms) {
                    if (slime.x + slime.w > p.x && slime.x < p.x + p.width && 
                        Math.abs(slime.y + slime.h - OFFSET_BOTTOM - p.y) < 5) {
                        currentPlatform = p;
                        edgeLeft = p.x + slime.w/2;
                        edgeRight = p.x + p.width - slime.w/2;
                        break;
                    }
                }

                // Xác định mép bật nhảy (frontEdge) và giới hạn lùi (backEdge)
                let frontEdge, backEdge;
                if (currentPlatform) {
                    if (targetCenterX >= edgeLeft && targetCenterX <= edgeRight) {
                        frontEdge = targetCenterX; // Mục tiêu nằm ngay trên nền này
                        backEdge = dist > 0 ? edgeLeft : edgeRight;
                    } else {
                        frontEdge = dist > 0 ? edgeRight : edgeLeft;
                        backEdge = dist > 0 ? edgeLeft : edgeRight;
                    }
                } else {
                    // Đứng dưới sàn
                    frontEdge = targetCenterX - (dist > 0 ? 80 : -80);
                    backEdge = dist > 0 ? frontEdge - 500 : frontEdge + 500;
                }

                let jumpDist_edge = Math.abs(targetCenterX - frontEdge);
                let jumpDist_current = Math.abs(targetCenterX - suiCenterX);

                // Tính toán đạn đạo (Projectile Physics)
                let targetDeltaY = target.y - (slime.y + slime.h - OFFSET_BOTTOM);
                let vy = -13.5; // Tăng nhẹ lực nhảy để bù cho trọng lực 0.6
                if (targetDeltaY < -60) vy = -14.5;
                if (targetDeltaY < -120) vy = -16.5;
                if (targetDeltaY < -200) vy = -18.5;
                vy = vy - (slime.climbAttempts * 1.0); 

                // Thời gian bay T (với g=0.6, a=0.3, 2a=0.6)
                let discriminant = vy * vy + targetDeltaY * 1.2; // targetDeltaY * 2 * g? No.
                // a*t^2 + b*t + c = 0 => 0.3*t^2 + vy*t - targetDeltaY = 0
                // discriminant = vy^2 - 4 * 0.3 * (-targetDeltaY) = vy^2 + 1.2 * targetDeltaY
                let tInAir = discriminant >= 0 ? (-vy + Math.sqrt(discriminant)) / 0.6 : (-vy) / 0.6;

                // ĐÁNH GIÁ TRẠNG THÁI (EVALUATING)
                if (slime.climbSubState === 'EVALUATING') {
                    let reqVx_current = jumpDist_current / tInAir;
                    let reqVx_edge = jumpDist_edge / tInAir;
                    
                    if (reqVx_current <= 3.5) {
                        // Vị trí hiện tại đã có thể nhảy tới (nhảy đứng)
                        slime.climbSubState = 'JUMPING_CURRENT';
                    } else if (reqVx_edge <= 3.5) {
                        // Chạy tới mép là có thể nhảy đứng tới
                        slime.climbSubState = 'MOVING_TO_EDGE';
                    } else {
                        // Vẫn quá xa, phải lùi lại để lấy đà nhảy từ mép
                        slime.climbSubState = 'BACKING_UP';
                        let neededRunningVx = reqVx_edge - 3.5; // Vận tốc cần bù đắp từ chạy lấy đà
                        slime.reqRunup = neededRunningVx * 30; // 30px lùi cho mỗi đơn vị vận tốc thiếu
                        
                        slime.targetStartX = dist > 0 ? frontEdge - slime.reqRunup : frontEdge + slime.reqRunup;
                        // Giới hạn điểm bắt đầu lấy đà không vượt quá mép sau của nền
                        if (dist > 0 && slime.targetStartX < backEdge) slime.targetStartX = backEdge;
                        if (dist < 0 && slime.targetStartX > backEdge) slime.targetStartX = backEdge;
                    }
                }

                let shouldJump = false;
                let actualVx = 0;
                let jumpDirection = dist > 0 ? 1 : -1;

                if (slime.climbSubState === 'JUMPING_CURRENT') {
                    shouldJump = true;
                    actualVx = jumpDist_current / tInAir;
                    if (actualVx > 3.5) actualVx = 3.5;
                } 
                else if (slime.climbSubState === 'MOVING_TO_EDGE') {
                    let distToFront = frontEdge - suiCenterX;
                    if (Math.abs(distToFront) > 10) {
                        slime.facingRight = distToFront > 0;
                        slime.vx = (slime.facingRight ? 1 : -1) * 3; // Đi bộ tới mép
                    } else {
                        shouldJump = true;
                        actualVx = Math.abs(targetCenterX - suiCenterX) / tInAir;
                        if (actualVx > 3.5) actualVx = 3.5;
                        jumpDirection = targetCenterX > suiCenterX ? 1 : -1;
                    }
                }
                else if (slime.climbSubState === 'BACKING_UP') {
                    let distToStart = slime.targetStartX - suiCenterX;
                    if (Math.abs(distToStart) > 10) {
                        slime.facingRight = distToStart > 0;
                        slime.vx = (slime.facingRight ? 1 : -1) * 2; // Đi bộ lùi lại
                    } else {
                        slime.climbSubState = 'RUNNING_UP';
                    }
                }
                else if (slime.climbSubState === 'RUNNING_UP') {
                    let distToFront = frontEdge - suiCenterX;
                    if (Math.abs(distToFront) > 10) {
                        slime.facingRight = distToFront > 0;
                        slime.vx = (slime.facingRight ? 1 : -1) * 5; // Chạy nhanh lấy đà
                        if (Math.random() < 0.1) spawnEmote('💨', true);
                    } else {
                        shouldJump = true;
                        // Tính lực bật thực tế dựa trên quãng đường lùi khả dụng
                        let actualRunup = Math.abs(frontEdge - slime.targetStartX);
                        let reqVx_edge = jumpDist_edge / tInAir;
                        actualVx = 3.5 + (actualRunup / 30);
                        if (actualVx > reqVx_edge) actualVx = reqVx_edge; // Tránh bay lố
                        jumpDirection = targetCenterX > frontEdge ? 1 : -1;
                    }
                }

                if (shouldJump) {
                    if (!slime.isPreparingJump) {
                        slime.isPreparingJump = true;
                        slime.vx = 0;
                        setTimeout(() => {
                            if (slime.climbTarget === target) {
                                spawnEmote('💦', true);
                                
                                if (actualVx < 1.5 && Math.abs(targetCenterX - suiCenterX) >= 10) actualVx = 1.5;
                                if (Math.abs(targetCenterX - suiCenterX) < 10) actualVx = 0; // Nhảy thẳng đứng
                                
                                slime.vy = vy;
                                slime.vx = jumpDirection * actualVx;
                                slime.inAir = true; 
                                slime.climbSubState = 'EVALUATING'; // Reset trạng thái cho lần tính toán sau
                            }
                            slime.isPreparingJump = false;
                        }, 150);
                    }
                }
            } else {
                // Đang nhảy, nếu rơi xuống quá sâu thì tính là trượt
                if (slime.vy > 0 && slime.y > target.y + 100) {
                    slime.climbAttempts++;
                    if (slime.climbAttempts >= 3) {
                        spawnEmote('😞', true);
                        slime.climbTarget = null;
                        slime.climbGiveUpUntil = Date.now() + 10000;
                    }
                }
            }

            if (slime.facingRight) slimeEl.classList.remove('flipped');
            else slimeEl.classList.add('flipped');
            return;
        }
    }

    if (Date.now() < slime.stateTimer) return;

    // Chọn hành vi tiếp theo dựa trên xác suất
    const rand = Math.random();

    if (slime.state === 'HIDING' || slime.state === 'PEEKING') {
        // Nếu đang nấp thì nhảy lên lại sau khi xong
        slime.state = 'WANDERING';
        slime.vy = -15; // Nhảy bật lên từ dưới sàn
        slime.vx = (Math.random() > 0.5 ? 2.5 : -2.5);
        slime.stateTimer = Date.now() + 3000 + Math.random() * 3000;
        spawnEmote('✨');
    } else if (rand < 0.1) {
        // 10% vào trạng thái nấp dưới taskbar
        slime.state = 'HIDING';
        slime.vx = 0;
        slime.stateTimer = Date.now() + 3000 + Math.random() * 2000;
        spawnEmote('...');
    } else if (rand < 0.7) {
        // 60% lang thang (tăng từ 45%)
        slime.state = 'WANDERING';
        slime.vx = (Math.random() > 0.5 ? 1 : -1) * (1.2 + Math.random() * 1.8);
        slime.stateTimer = Date.now() + 4000 + Math.random() * 5000;
        slime.facingRight = slime.vx > 0;
    } else {
        // 30% đứng yên
        slime.state = 'IDLE';
        slime.vx = 0;
        slime.stateTimer = Date.now() + 2000 + Math.random() * 3000;
    }

    // Cập nhật class CSS
    if (slime.facingRight) slimeEl.classList.remove('flipped');
    else slimeEl.classList.add('flipped');
}

// ==== VẬT LÝ ====

slimeEl.onload = () => {
    slime.w = slimeEl.clientWidth || 150;
    slime.h = slimeEl.clientHeight || 100;
    detectBottomPadding(slimeEl);
    prepareSlimeHitData();
};

// ==== THAO TAC BE SUI ====

// Chuột trái giữ: kéo bé sui (dùng Pointer Capture để bắt mouseup chính xác)
slimeEl.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || isDrawingMode) return;
    e.preventDefault();
    slime.isDragging = true;
    slime.vx = 0; slime.vy = 0;
    slimeEl.setPointerCapture(e.pointerId); // "kẹp" pointer vào sui
    ipcRenderer.send('set-ignore-mouse-events', false);
});

slimeEl.addEventListener('pointermove', (e) => {
    if (!slime.isDragging) return;
    slime.x = e.clientX - slime.w / 2;
    slime.y = e.clientY - slime.h / 2;
    slimeEl.style.left = slime.x + 'px';
    slimeEl.style.top = slime.y + 'px';
});

slimeEl.addEventListener('pointerup', (e) => {
    if (!slime.isDragging || e.button !== 0) return;
    slime.isDragging = false;
    slime.vy = 2;
    slimeEl.releasePointerCapture(e.pointerId);
    checkMouseInteraction(e.clientX, e.clientY);
});

// Dự phòng: nếu pointer bị mất (alt-tab, v.v.)
slimeEl.addEventListener('lostpointercapture', (e) => {
    if (slime.isDragging) {
        slime.isDragging = false;
        slime.vy = 2;
        checkMouseInteraction(e.clientX, e.clientY);
    }
});

// mousemove cho drawing box
window.addEventListener('mousemove', (e) => {
    if (slime.isDragging) return; // pointer events đã xử lý drag
    if (!isDrawingBox) return;
    let w = e.clientX - startX;
    let h = e.clientY - startY;
    drawBoxDiv.style.width = Math.abs(w) + 'px';
    drawBoxDiv.style.height = Math.abs(h) + 'px';
    drawBoxDiv.style.left = (w < 0 ? e.clientX : startX) + 'px';
    drawBoxDiv.style.top = (h < 0 ? e.clientY : startY) + 'px';
});

// Hiệu ứng thả tim
function spawnHearts() {
    const heartPool = ['❤️', '💖', '💗', '💓', '💕', '🧡', '💛', '💚', '💙', '💜'];
    const count = 4 + Math.floor(Math.random() * 3); // 4-6 trái tim
    for (let i = 0; i < count; i++) {
        const el = document.createElement('div');
        el.className = 'heart-particle';
        el.textContent = heartPool[Math.floor(Math.random() * heartPool.length)];
        // Vị trí: phân tán quanh đỉnh đầu bé sui
        const spawnX = slime.x + slime.w * (0.2 + Math.random() * 0.6);
        const spawnY = slime.y + slime.h * 0.2;
        el.style.left = spawnX + 'px';
        el.style.top = spawnY + 'px';
        el.style.fontSize = (13 + Math.random() * 11) + 'px';
        // Drift ngang ngẫu nhiên qua CSS custom property
        el.style.setProperty('--drift', ((Math.random() - 0.5) * 50) + 'px');
        el.style.animationDelay = (Math.random() * 0.25) + 's';
        el.style.animationDuration = (0.9 + Math.random() * 0.4) + 's';
        document.body.appendChild(el);
        el.addEventListener('animationend', () => el.remove(), { once: true });
    }
}

// Chuột phải: thả tim + hoạt ảnh ngẫu nhiên
slimeEl.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (isDrawingMode || slime.isDragging) return;

    // Luôn thả tim
    spawnHearts();

    const actions = ['wobble', 'wobble', 'jump', 'jump'];
    const pick = actions[Math.floor(Math.random() * actions.length)];

    if (pick === 'wobble') {
        slimeEl.classList.remove('sui-wobble');
        void slimeEl.offsetWidth;
        slimeEl.classList.add('sui-wobble');
        slimeEl.addEventListener('animationend', () => {
            slimeEl.classList.remove('sui-wobble');
        }, { once: true });
    } else if (pick === 'jump') {
        AudioManager.playSFX('Squish');
        slimeEl.classList.remove('sui-squish');
        void slimeEl.offsetWidth;
        slimeEl.classList.add('sui-squish');
        slimeEl.addEventListener('animationend', () => {
            slimeEl.classList.remove('sui-squish');
        }, { once: true });
        slime.vy = -15;
        slime.vx += (Math.random() - 0.5) * 3;
    }
});

function gameLoop() {
    requestAnimationFrame(gameLoop);
    if (slime.isDragging) return;

    // OFFSET_BOTTOM tự động phát hiện từ pixel trong suốt phía dưới PNG

    updateAutonomousBehavior();

    slime.vy += 0.6; // Trọng lực tăng lên 0.6 để cảm giác nặng và thật hơn
    let nextX = slime.x + slime.vx;
    let nextY = slime.y + slime.vy;

    // Xác định sàn cho trạng thái hiện tại (núp dưới taskbar hay đứng trên)
    let currentFloorY = floorY;
    if (slime.state === 'HIDING' || slime.state === 'PEEKING') {
        currentFloorY = window.innerHeight + 20; // Chui xuống sâu hơn một chút để núp kỹ sau taskbar
    }

    if (nextY + slime.h - OFFSET_BOTTOM > currentFloorY) {
        nextY = currentFloorY - slime.h + OFFSET_BOTTOM;
        // Chỉ squish nếu rơi với vận tốc đủ mạnh
        if (slime.vy > 2) triggerLandSquish();
        slime.vy = -slime.vy * 0.7;
        if (Math.abs(slime.vy) < 1) slime.vy = 0;
    }

    if (nextX <= 0) {
        nextX = 0;
        slime.vx = -Math.abs(slime.vx) * 0.8;
    } else if (nextX + slime.w >= window.innerWidth) {
        nextX = window.innerWidth - slime.w;
        slime.vx = -Math.abs(slime.vx) * 0.8;
    }

    for (let p of platforms) {
        let isFalling = slime.vy > 0;
        let wasAbove = (slime.y + slime.h - OFFSET_BOTTOM) <= p.y + 10;
        
        // Thu hẹp vùng tiếp xúc chân (chỉ lấy 30% ở giữa chiều rộng nhân vật)
        let footWidth = slime.w * 0.3;
        let footX = nextX + (slime.w - footWidth) / 2;
        let isIntersectingX = (footX + footWidth > p.x) && (footX < p.x + p.width);

        if (isFalling && wasAbove && isIntersectingX && nextY + slime.h - OFFSET_BOTTOM >= p.y) {
            nextY = p.y - slime.h + OFFSET_BOTTOM;

            // Nếu vừa rơi xuống và chạm bệ mờ
            if (slime.inAir) {
                const emotes = ['?', '!', '?!', '...', '✨', '🐾'];
                // Giảm tỷ lệ hiện emote khi đáp để tránh spam (chỉ hiện 30% số lần chạm)
                if (Math.random() < 0.3) {
                    spawnEmote(emotes[Math.floor(Math.random() * emotes.length)]);
                }
                triggerLandSquish();
                slime.inAir = false; // Đã chạm đất
                slime.climbSubState = 'EVALUATING'; // Reset tính toán AI
                
                if (slime.climbTarget === p) {
                    slime.climbTarget = null; // Đã tới đích, reset mục tiêu để tìm mục tiêu mới
                    if (slime.climbMode === 'ASCENDING') {
                        if (!slime.climbHistory) slime.climbHistory = [];
                        if (slime.climbHistory[slime.climbHistory.length - 1] !== p) {
                            slime.climbHistory.push(p);
                        }
                    }
                }
            }

            slime.vy = -slime.vy * 0.1; // Giảm độ nẩy xuống tối thiểu (10%)
            if (Math.abs(slime.vy) < 2.0) slime.vy = 0; // Triệt tiêu lực nẩy nhanh hơn
        }
    }

    // Nếu không chạm bệ but chạm sàn
    if (nextY + slime.h - OFFSET_BOTTOM >= floorY - 2) {
        if (slime.inAir) {
            slime.climbSubState = 'EVALUATING'; // Reset tính toán AI
            slime.climbTarget = null; // Chạm sàn thì xoá mục tiêu cũ (nếu có)
        }
        slime.inAir = false;
    } else if (Math.abs(slime.vy) > 1 || slime.isDragging) {
        // Nếu đang rơi, nhảy lên hoặc đang bị kéo thì tính là đang ở trên không
        slime.inAir = true;
    }

    // update autonomous friction check
    if (!slime.inAir) {
        if (slime.y + slime.h - OFFSET_BOTTOM >= currentFloorY - 5) {
            slime.vx = slime.vx * 0.95; // Ma sát trên sàn
        } else {
            // Ma sát cực mạnh trên bậc thang để tránh trượt (gần như dừng lập tức)
            slime.vx = slime.vx * 0.1;
            if (Math.abs(slime.vx) < 0.1) slime.vx = 0;
        }
    }

    slime.x = nextX;
    slime.y = nextY;
    slimeEl.style.left = slime.x + 'px';
    slimeEl.style.top = slime.y + 'px';

    // Thêm hiệu ứng nhún nhảy khi di chuyển
    if (Math.abs(slime.vx) > 0.1 && !slime.inAir) {
        slimeEl.classList.add('moving');
    } else {
        slimeEl.classList.remove('moving');
    }
}

requestAnimationFrame(gameLoop);

window.addEventListener('resize', () => {
    workArea.width = window.innerWidth;
    workArea.height = window.innerHeight;
    // Cập nhật lại floorY khi resize (thiết bị có thể thay taskbar size)
    ipcRenderer.invoke('get-work-area-height').then(h => { if (h) floorY = h; });
});

// ==== HÀNH VI SỰ KIỆN SINH NHẬT MẸ TÔI ĐÃ ĐƯỢC CHUYỂN SANG birthday_event.js ====

