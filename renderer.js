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
    behaviorFloorY: null // Sẽ dùng floorY mặc định
};

function spawnEmote(text) {
    const el = document.createElement('div');
    el.className = 'emote-popup';
    el.textContent = text;
    el.style.left = (slime.x + slime.w / 2 - 10) + 'px';
    el.style.top = (slime.y + 55) + 'px'; // Hạ thấp vị trí hơn nữa
    document.body.appendChild(el);
    el.addEventListener('animationend', () => el.remove(), { once: true });
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

const interactives = document.querySelectorAll('.interactive');
let isSlimeHovered = false;

function applyHoverLogic(el) {
    if (el === slimeEl) {
        // Pixel-perfect check cho bé Sui
        el.addEventListener('mousemove', (e) => {
            if (isDrawingMode || slime.isDragging) return;

            // Dự phòng nếu hit data chưa kịp chuẩn bị
            if (!slimePixelData && slimeEl.naturalWidth) {
                prepareSlimeHitData();
            }

            if (isOverSlimeBody(e.offsetX, e.offsetY)) {
                if (!isSlimeHovered) {
                    isSlimeHovered = true;
                    ipcRenderer.send('set-ignore-mouse-events', false);
                    slimeEl.classList.add('sui-glow');
                }
            } else {
                if (isSlimeHovered) {
                    isSlimeHovered = false;
                    ipcRenderer.send('set-ignore-mouse-events', true, { forward: true });
                    slimeEl.classList.remove('sui-glow');
                }
            }
        });

        el.addEventListener('mouseleave', () => {
            if (isSlimeHovered) {
                isSlimeHovered = false;
                if (!isDrawingMode && !slime.isDragging) {
                    ipcRenderer.send('set-ignore-mouse-events', true, { forward: true });
                }
                slimeEl.classList.remove('sui-glow');
            }
        });
    } else {
        // Các thành phần UI khác dùng bounding box bình thường
        el.addEventListener('mouseenter', () => {
            if (!isDrawingMode && !slime.isDragging) ipcRenderer.send('set-ignore-mouse-events', false);
        });
        el.addEventListener('mouseleave', () => {
            if (!isDrawingMode && !slime.isDragging) ipcRenderer.send('set-ignore-mouse-events', true, { forward: true });
        });
    }
}
interactives.forEach(applyHoverLogic);
applyHoverLogic(slimeEl);

quitBtn.addEventListener('click', () => ipcRenderer.send('quit-app'));

// ==== AM THANH & NHAC (AUDIO MANAGER) & TRINH PHAT NHAC (MUSIC PLAYER UI) DA DUOC CHUYEN SANG music_player.js ====


// ==== CHẾ ĐỘ VẼ BẬC THANG (GIỮ PHÍM SPACE) ====
let isSpaceHeld = false;

// ==== HỆ THỐNG BÃO & HIỆU ỨNG THỜI TIẾT ĐÃ ĐƯỢC CHUYỂN SANG features/weather_effects.js ====

window.addEventListener('keydown', (e) => {
    if (isDrawingMode) return; // Khong bat khi dang ve
    const key = e.key.toLowerCase();
    if (key === 'm') MusicPlayer.toggle();

    if (e.code !== 'Space' || isSpaceHeld || e.repeat) return;
    e.preventDefault();
    isSpaceHeld = true;
    isDrawingMode = true;
    ipcRenderer.send('set-ignore-mouse-events', false);
    // Hien lai cac platform, xoa timer cu
    platforms.forEach(p => {
        if (p.timer) { clearTimeout(p.timer); p.timer = null; }
        p.el.classList.remove('hidden');
    });
    // Indicator -> san sang
    drawIndicator.className = 'ready';
    drawIconEl.textContent = '🎯';
    drawStatusEl.textContent = 'Keo chuot de ve san';
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

    // An platform va bat dau dem nguoc 5s
    platforms.forEach(p => {
        p.el.classList.add('hidden');
        if (p.timer) clearTimeout(p.timer);
        p.timer = setTimeout(() => {
            const index = platforms.indexOf(p);
            if (index !== -1) { p.el.remove(); platforms.splice(index, 1); }
        }, 5000);
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
        AudioManager.preloadMusic('birthday_song', 'assets/audio/music/Happy Birthday To You.mp3');
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
    if (slime.isDragging || isDrawingMode) {
        slime.state = 'IDLE';
        return;
    }

    // Kiểm tra xem có sự kiện nào đang chiếm quyền điều khiển không
    if (EventManager.update()) {
        return;
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
    if (!isDrawingMode) ipcRenderer.send('set-ignore-mouse-events', true, { forward: true });
});

// Dự phòng: nếu pointer bị mất (alt-tab, v.v.)
slimeEl.addEventListener('lostpointercapture', () => {
    if (slime.isDragging) {
        slime.isDragging = false;
        slime.vy = 2;
        if (!isDrawingMode) ipcRenderer.send('set-ignore-mouse-events', true, { forward: true });
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

    slime.vy += 0.5; // Trọng lực
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
        let isIntersectingX = (nextX + slime.w > p.x) && (nextX < p.x + p.width);

        if (isFalling && wasAbove && isIntersectingX && nextY + slime.h - OFFSET_BOTTOM >= p.y) {
            nextY = p.y - slime.h + OFFSET_BOTTOM;

            // Nếu vừa rơi xuống và chạm bệ mờ
            if (slime.inAir) {
                const emotes = ['?', '!', '?!', '...', '✨', '🐾'];
                spawnEmote(emotes[Math.floor(Math.random() * emotes.length)]);
                triggerLandSquish();
                slime.inAir = false; // Đã chạm đất
            }

            slime.vy = -slime.vy * 0.6;
            if (Math.abs(slime.vy) < 1.5) slime.vy = 0;
        }
    }

    // Nếu không chạm bệ but chạm sàn
    if (nextY + slime.h - OFFSET_BOTTOM >= floorY - 2) {
        slime.inAir = false;
    } else if (slime.vy > 1 || slime.isDragging) {
        // Nếu đang rơi hoặc đang bị kéo thì tính là đang ở trên không
        slime.inAir = true;
    }

    // update autonomous friction check using the already declared currentFloorY
    if (slime.vy === 0 && slime.y + slime.h - OFFSET_BOTTOM >= currentFloorY - 5) {
        slime.vx = slime.vx * 0.98;
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

