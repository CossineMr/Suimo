const { ipcRenderer } = require('electron');

const slimeEl = document.getElementById('slime');
const drawIndicator = document.getElementById('drawIndicator');
const drawStatusEl  = document.getElementById('drawStatus');
const drawIconEl    = document.getElementById('drawIndicatorIcon');
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
function applyHoverLogic(el) {
    if (el === slimeEl) {
        // Pixel-perfect check cho bé Sui
        el.addEventListener('mousemove', (e) => {
            if (isDrawingMode || slime.isDragging) return;
            
            if (isOverSlimeBody(e.offsetX, e.offsetY)) {
                ipcRenderer.send('set-ignore-mouse-events', false);
            } else {
                ipcRenderer.send('set-ignore-mouse-events', true, { forward: true });
            }
        });
        
        el.addEventListener('mouseleave', () => {
            if (!isDrawingMode && !slime.isDragging) {
                ipcRenderer.send('set-ignore-mouse-events', true, { forward: true });
            }
        });
    } else {
        // Các thành phần UI khác dùng bounding box bình thường
        el.addEventListener('mouseenter', () => {
            if(!isDrawingMode && !slime.isDragging) ipcRenderer.send('set-ignore-mouse-events', false);
        });
        el.addEventListener('mouseleave', () => {
            if(!isDrawingMode && !slime.isDragging) ipcRenderer.send('set-ignore-mouse-events', true, { forward: true });
        });
    }
}
interactives.forEach(applyHoverLogic);
applyHoverLogic(slimeEl);

quitBtn.addEventListener('click', () => ipcRenderer.send('quit-app'));

// ==== AM THANH & NHAC (AUDIO MANAGER) ====
const AudioManager = {
    sfx: {},
    music: new Audio(),
    isPlayingMusic: false,
    playlist: [],
    currentIndex: -1,
    
    init() {
        this.music.onended = () => this.playNext();
        this.fadeIntervals = {};
        console.log('[AudioManager] Da khoi tao.');
    },

    playSFX(name, loop = false, fadeIn = false) {
        if (!loop) {
            // Khong loop (VD: Sét) -> Tao instance moi de cho phep trung am thanh (overlap)
            const audio = new Audio(`assets/audio/sfx/${name}.mp3`);
            audio.play().catch(e => console.warn(`[SFX] Khong the phat ${name}:`, e));
            return;
        }

        // Loop (VD: Mưa, Chim) -> Luu vao sfx de co the stop hoac fade
        if (!this.sfx[name]) {
            this.sfx[name] = new Audio(`assets/audio/sfx/${name}.mp3`);
        }
        this.sfx[name].loop = loop;
        
        if (fadeIn) {
            this.sfx[name].volume = 0;
            this.sfx[name].play().catch(e => console.warn(`[SFX] Khong the phat ${name}:`, e));
            
            if (this.fadeIntervals[name]) clearInterval(this.fadeIntervals[name]);
            
            this.fadeIntervals[name] = setInterval(() => {
                let v = this.sfx[name].volume;
                if (v < 0.95) {
                    this.sfx[name].volume = v + 0.02; // Tang dan
                } else {
                    this.sfx[name].volume = 1.0;
                    clearInterval(this.fadeIntervals[name]);
                }
            }, 100); // 100ms * 50 steps = 5s de dat max volume
        } else {
            this.sfx[name].volume = 1.0;
            this.sfx[name].play().catch(e => console.warn(`[SFX] Khong the phat ${name}:`, e));
        }
    },

    stopSFX(name, fadeOut = false) {
        if (this.sfx[name]) {
            if (fadeOut) {
                if (this.fadeIntervals[name]) clearInterval(this.fadeIntervals[name]);
                
                this.fadeIntervals[name] = setInterval(() => {
                    let v = this.sfx[name].volume;
                    if (v > 0.05) {
                        this.sfx[name].volume = v - 0.05; // Giam dan
                    } else {
                        this.sfx[name].volume = 0;
                        this.sfx[name].pause();
                        this.sfx[name].currentTime = 0;
                        clearInterval(this.fadeIntervals[name]);
                    }
                }, 100);
            } else {
                this.sfx[name].pause();
                this.sfx[name].currentTime = 0;
            }
        }
    },

    playMusic(index) {        if (index < 0 || index >= this.playlist.length) return;
        this.currentIndex = index;
        this.music.src = `assets/audio/music/${this.playlist[index]}`;
        this.music.play().then(() => {
            this.isPlayingMusic = true;
            this.updateUI();
        }).catch(e => console.error('[Music] Loi phat nhac:', e));
    },

    togglePlay() {
        if (this.playlist.length === 0) return;
        if (this.currentIndex === -1) this.currentIndex = 0;

        if (this.music.paused) {
            if (!this.music.src) this.playMusic(this.currentIndex);
            else this.music.play();
            this.isPlayingMusic = true;
        } else {
            this.music.pause();
            this.isPlayingMusic = false;
        }
        this.updateUI();
    },

    playNext() {
        let next = this.currentIndex + 1;
        if (next >= this.playlist.length) next = 0;
        this.playMusic(next);
    },

    updateUI() {
        const musicStatus = document.getElementById('music-status');
        const playBtn = document.getElementById('playBtn');
        
        if (this.isPlayingMusic && !this.music.paused) {
            musicStatus.style.display = 'flex';
            playBtn.textContent = '⏸️';
        } else {
            musicStatus.style.display = 'none';
            playBtn.textContent = '▶️';
        }

        // Highlight dang phat
        document.querySelectorAll('#playlist-list .music-item').forEach((el, idx) => {
            if (idx === this.currentIndex) el.classList.add('playing');
            else el.classList.remove('playing');
        });
    }
};
AudioManager.init();

// ==== TRINH PHAT NHAC (MUSIC PLAYER UI) ====
const MusicPlayer = {
    library: [],
    el: null,
    isOpen: false,
    isDraggingWindow: false,
    dragOffset: { x: 0, y: 0 },

    init() {
        this.el = document.getElementById('music-player');
        this.setupEventListeners();
        this.refreshLibrary();
    },

    async refreshLibrary() {
        this.library = await ipcRenderer.invoke('get-audio-files', 'music');
        this.renderLibrary();
    },

    renderLibrary() {
        const list = document.getElementById('library-list');
        list.innerHTML = '';
        this.library.forEach(file => {
            const item = document.createElement('div');
            item.className = 'music-item';
            item.textContent = file;
            item.draggable = true;
            item.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('text/plain', file);
            });
            item.addEventListener('dblclick', () => {
                // Double click de them vao playlist
                this.addToPlaylist(file);
            });
            list.appendChild(item);
        });
    },

    addToPlaylist(file) {
        AudioManager.playlist.push(file);
        this.renderPlaylist();
    },

    renderPlaylist() {
        const list = document.getElementById('playlist-list');
        list.innerHTML = '';
        AudioManager.playlist.forEach((file, idx) => {
            const item = document.createElement('div');
            item.className = 'music-item';
            item.textContent = `${idx + 1}. ${file}`;
            item.addEventListener('click', () => AudioManager.playMusic(idx));
            list.appendChild(item);
        });
        AudioManager.updateUI();
    },

    toggle() {
        this.isOpen = !this.isOpen;
        if (this.isOpen) {
            this.el.classList.add('show');
            ipcRenderer.send('set-ignore-mouse-events', false);
        } else {
            this.el.classList.remove('show');
            if (!isDrawingMode && !slime.isDragging) ipcRenderer.send('set-ignore-mouse-events', true, { forward: true });
        }
    },

    setupEventListeners() {
        document.getElementById('closeMusicBtn').onclick = () => this.toggle();
        document.getElementById('playBtn').onclick = () => AudioManager.togglePlay();
        
        const sortSelect = document.getElementById('sortMode');
        sortSelect.onchange = () => {
            const mode = sortSelect.value;
            if (mode === 'auto') {
                AudioManager.playlist = [...this.library];
                this.renderPlaylist();
            } else if (mode === 'random') {
                AudioManager.playlist = [...this.library].sort(() => Math.random() - 0.5);
                this.renderPlaylist();
            }
        };

        // Drag and Drop files
        const playlistList = document.getElementById('playlist-list');
        playlistList.addEventListener('dragover', (e) => e.preventDefault());
        playlistList.addEventListener('drop', (e) => {
            const file = e.dataTransfer.getData('text/plain');
            if (file) this.addToPlaylist(file);
        });

        // Di chuyen cua so
        const header = this.el.querySelector('.player-header');
        header.onmousedown = (e) => {
            this.isDraggingWindow = true;
            this.dragOffset.x = e.clientX - this.el.offsetLeft;
            this.dragOffset.y = e.clientY - this.el.offsetTop;
            header.style.cursor = 'grabbing';
        };

        window.addEventListener('mousemove', (e) => {
            if (!this.isDraggingWindow) return;
            this.el.style.left = (e.clientX - this.dragOffset.x) + 'px';
            this.el.style.top = (e.clientY - this.dragOffset.y) + 'px';
            this.el.style.transform = 'none'; // Huy transform translate(-50%, -50%) khi keo
        });

        window.addEventListener('mouseup', () => {
            this.isDraggingWindow = false;
            header.style.cursor = 'move';
        });
    }
};
document.addEventListener('DOMContentLoaded', () => MusicPlayer.init());

// ==== CHẾ ĐỘ VẼ BẬC THANG (GIỮ PHÍM SPACE) ====
let isSpaceHeld = false;

// ==== HỆ THỐNG BÃO (STORM SYSTEM) ====
const StormSystem = {
    state: 'IDLE',
    intensityMode: 'SMALL',
    startTime: 0,
    duration: 0,
    preparingTimer: null,
    lightningTimer: null,
    rainLayer: null,
    lightningLayer: null,
    container: null,
    
    lastStormStopTime: 0,
    
    config: {
        SMALL: { maxDrops: 60, lightningFreq: 0 },
        MEDIUM: { maxDrops: 200, lightningFreq: 1 },
        HEAVY: { maxDrops: 500, lightningFreq: 3 }
    },

    init() {
        this.container = document.getElementById('storm-container');
        this.rainLayer = document.getElementById('rain-layer');
        this.lightningLayer = document.getElementById('lightning-layer');
        this.rainbowContainer = document.getElementById('rainbow-container');
        console.log('[StormSystem] Da khoi tao.');
    },

    toggle(forcedMode = null) {
        if (this.state === 'IDLE' || forcedMode) {
            this.start(forcedMode);
        } else {
            this.stop();
        }
    },

    start(mode = null) {
        this.stop(); // Reset neu dang chay
        this.state = 'PREPARING';
        this.intensityMode = mode || (['SMALL', 'MEDIUM', 'HEAVY'][Math.floor(Math.random() * 3)]);
        
        this.container.classList.add('storm-active');
        spawnEmote('☁️');
        console.log(`[Storm] Dang chuan bi... Cap do: ${this.intensityMode}`);

        // Stop Chirp when storm starts
        AudioManager.stopSFX('Chirp');

        this.preparingTimer = setTimeout(() => {
            this.beginRaining();
        }, 5000);
    },

    beginRaining() {
        if (this.state !== 'PREPARING') return;
        this.state = 'RAINING';
        this.startTime = Date.now();
        this.duration = (2 + Math.random() * 3) * 60 * 1000; // 2-5 phut
        console.log(`[Storm] Bat dau mua! Cap do: ${this.intensityMode}, Thoi gian: ${(this.duration / 60000).toFixed(1)} phut`);
        
        AudioManager.playSFX('Rain', true, true); // loop=true, fadeIn=true
        
        this.scheduleLightning();
        this.updateRain();
    },

    updateRain() {
        if (this.state !== 'RAINING') return;

        const elapsed = Date.now() - this.startTime;
        if (elapsed > this.duration) {
            this.stop();
            return;
        }

        // Tinh mat do theo parabol: y = -4(x-0.5)^2 + 1
        const x = elapsed / this.duration;
        const multiplier = -4 * Math.pow(x - 0.5, 2) + 1;
        const currentMaxDrops = this.config[this.intensityMode].maxDrops * Math.max(0.05, multiplier);

        this.adjustRainDensity(currentMaxDrops);
        requestAnimationFrame(() => this.updateRain());
    },

    adjustRainDensity(targetCount) {
        const currentCount = this.rainLayer.children.length;
        if (currentCount < targetCount) {
            const toAdd = Math.min(10, targetCount - currentCount);
            for (let i = 0; i < toAdd; i++) {
                this.createRaindrop();
            }
        }
    },

    createRaindrop() {
        const drop = document.createElement('div');
        drop.className = 'raindrop';
        // Mở rộng vùng sinh hạt sang phải (thêm 600px) để bù cho độ trượt sang trái khi rơi
        const spawnWidth = window.innerWidth + 600;
        drop.style.left = (Math.random() * spawnWidth) + 'px';
        drop.style.top = '-20px';
        const duration = 0.4 + Math.random() * 0.4;
        drop.style.animation = `rainFall ${duration}s linear forwards`;
        this.rainLayer.appendChild(drop);
        drop.addEventListener('animationend', () => drop.remove());
    },

    scheduleLightning() {
        if (this.state !== 'RAINING') return;
        const freq = this.config[this.intensityMode].lightningFreq;
        if (freq === 0) return;

        const interval = (60 / freq) * 1000;
        const nextIn = Math.random() * interval * 1.5; 

        this.lightningTimer = setTimeout(() => {
            if (this.state === 'RAINING') {
                this.triggerLightning();
                this.scheduleLightning();
            }
        }, nextIn);
    },

    triggerLightning() {
        console.log('[Storm] Sét đánh!');
        AudioManager.playSFX('Lightning');
        const x = Math.random() * 100;
        const duration = 1 + Math.random() * 0.5; // 1-1.5s
        
        this.lightningLayer.style.setProperty('--lightning-x', `${x}%`);
        this.lightningLayer.style.setProperty('--lightning-duration', `${duration}s`);
        
        this.lightningLayer.classList.remove('lightning-active');
        void this.lightningLayer.offsetWidth; 
        this.lightningLayer.classList.add('lightning-active');
    },

    stop() {
        if (this.state !== 'IDLE') {
            console.log('[Storm] Dung bao.');
            this.lastStormStopTime = Date.now();
        }
        this.state = 'IDLE';
        if (this.container) this.container.classList.remove('storm-active');
        if (this.preparingTimer) clearTimeout(this.preparingTimer);
        if (this.lightningTimer) clearTimeout(this.lightningTimer);
        if (this.rainLayer) this.rainLayer.innerHTML = '';
        if (this.lightningLayer) this.lightningLayer.classList.remove('lightning-active');
        
        AudioManager.stopSFX('Rain', true); // fadeOut=true
        // Restart Chirp if sun is showing
        const sunbeamContainer = document.getElementById('sunbeam-container');
        if (sunbeamContainer && sunbeamContainer.classList.contains('show')) {
            AudioManager.playSFX('Chirp', true);
        }
    },

    showRainbow() {
        if (!this.rainbowContainer) return;
        console.log('[Storm] Cau vong xuat hien!');
        this.rainbowContainer.classList.add('show');
        setTimeout(() => {
            this.rainbowContainer.classList.remove('show');
        }, 60000); // Bien mat sau 1 phut
    }
};

// Khoi tao ngay
document.addEventListener('DOMContentLoaded', () => StormSystem.init());
// Du phong neu script chay sau DOMContentLoaded
if (document.readyState !== 'loading') StormSystem.init();

window.addEventListener('keydown', (e) => {
    // Phím số 1: Trời quang
    if (e.code === 'Digit1' || e.code === 'Numpad1') {
        const sunbeamContainer = document.getElementById('sunbeam-container');
        const clouds = document.getElementById('clouds');
        if (sunbeamContainer && clouds) {
            const isShowing = sunbeamContainer.classList.toggle('show');
            clouds.classList.toggle('show');
            console.log('[SlimePet] Che do Troi quang:', isShowing ? 'BAT' : 'TAT');

            if (isShowing && StormSystem.state === 'IDLE') {
                AudioManager.playSFX('Chirp', true);
            } else {
                AudioManager.stopSFX('Chirp');
            }

            // Neu bat nang trong vong 10s sau khi tat mua thi hien cau vong
            const stormRecentlyStopped = (Date.now() - StormSystem.lastStormStopTime) < 10000;
            if (isShowing && stormRecentlyStopped) {
                StormSystem.showRainbow();
            }
        }
    }

    // Phím số 2: Mưa Bão (Ngẫu nhiên)
    if (e.code === 'Digit2' || e.code === 'Numpad2') {
        StormSystem.toggle();
    }

    // Phím Z, X, C: Ép buộc các cấp độ mưa
    if (isDrawingMode) return; // Khong bat khi dang ve
    const key = e.key.toLowerCase();
    if (key === 'z') StormSystem.start('SMALL');
    if (key === 'x') StormSystem.start('MEDIUM');
    if (key === 'c') StormSystem.start('HEAVY');
    if (key === 'm') MusicPlayer.toggle();

    if (e.code !== 'Space' || isSpaceHeld || e.repeat) return;
    e.preventDefault();
    isSpaceHeld   = true;
    isDrawingMode = true;
    ipcRenderer.send('set-ignore-mouse-events', false);
    // Hien lai cac platform, xoa timer cu
    platforms.forEach(p => {
        if (p.timer) { clearTimeout(p.timer); p.timer = null; }
        p.el.classList.remove('hidden');
    });
    // Indicator -> san sang
    drawIndicator.className  = 'ready';
    drawIconEl.textContent   = '🎯';
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
            platformDiv.className    = 'platform interactive';
            platformDiv.style.left   = rect.left   + 'px';
            platformDiv.style.top    = rect.top    + 'px';
            platformDiv.style.width  = rect.width  + 'px';
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
        for(let i=0; i<platforms.length; i++) {
            let p = platforms[i];
            if(e.clientX >= p.x && e.clientX <= p.x + p.width && e.clientY >= p.y && e.clientY <= p.y + p.height) {
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
    drawIndicator.className  = 'drawing';
    drawIconEl.textContent   = '✏️';
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
    if(rect.width > 20 && rect.height > 20) {
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
        drawIndicator.className  = 'ready';
        drawIconEl.textContent   = '🎯';
        drawStatusEl.textContent = 'Keo chuot de ve san';
    }
});

// ==== QUYẾT ĐỊNH HÀNH VI TỰ ĐỘNG ====
function updateAutonomousBehavior() {
    if (slime.isDragging || isDrawingMode) {
        slime.state = 'IDLE';
        return;
    }

    if (Date.now() < slime.stateTimer) return;

    // Chọn hành vi tiếp theo dựa trên xác suất
    const rand = Math.random();
    
    if (slime.state === 'HIDING' || slime.state === 'PEEKING') {
        // Nếu đang nấp thì nhảy lên lại sau khi xong
        slime.state = 'WANDERING';
        slime.vy = -15; // Nhảy bật lên từ dưới sàn
        slime.vx = (Math.random() > 0.5 ? 2 : -2);
        slime.stateTimer = Date.now() + 3000 + Math.random() * 3000;
        spawnEmote('✨');
    } else if (rand < 0.15) {
        // 15% vào trạng thái nấp dưới taskbar
        slime.state = 'HIDING';
        slime.vx = 0;
        slime.stateTimer = Date.now() + 3000 + Math.random() * 2000;
        spawnEmote('...');
    } else if (rand < 0.6) {
        // 45% lang thang
        slime.state = 'WANDERING';
        slime.vx = (Math.random() > 0.5 ? 1 : -1) * (0.8 + Math.random() * 1.2);
        slime.stateTimer = Date.now() + 4000 + Math.random() * 5000;
        slime.facingRight = slime.vx > 0;
    } else {
        // 40% đứng yên
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
    slimeEl.style.top  = slime.y + 'px';
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
    drawBoxDiv.style.width  = Math.abs(w) + 'px';
    drawBoxDiv.style.height = Math.abs(h) + 'px';
    drawBoxDiv.style.left   = (w < 0 ? e.clientX : startX) + 'px';
    drawBoxDiv.style.top    = (h < 0 ? e.clientY : startY) + 'px';
});

// Hiệu ứng thả tim
function spawnHearts() {
    const heartPool = ['❤️','💖','💗','💓','💕','🧡','💛','💚','💙','💜'];
    const count = 4 + Math.floor(Math.random() * 3); // 4-6 trái tim
    for (let i = 0; i < count; i++) {
        const el = document.createElement('div');
        el.className = 'heart-particle';
        el.textContent = heartPool[Math.floor(Math.random() * heartPool.length)];
        // Vị trí: phân tán quanh đỉnh đầu bé sui
        const spawnX = slime.x + slime.w * (0.2 + Math.random() * 0.6);
        const spawnY = slime.y + slime.h * 0.2;
        el.style.left    = spawnX + 'px';
        el.style.top     = spawnY + 'px';
        el.style.fontSize = (13 + Math.random() * 11) + 'px';
        // Drift ngang ngẫu nhiên qua CSS custom property
        el.style.setProperty('--drift', ((Math.random() - 0.5) * 50) + 'px');
        el.style.animationDelay    = (Math.random() * 0.25) + 's';
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
        if(Math.abs(slime.vy) < 1) slime.vy = 0; 
    }
    
    if (nextX <= 0) {
        nextX = 0;
        slime.vx = -Math.abs(slime.vx) * 0.8;
    } else if (nextX + slime.w >= window.innerWidth) {
        nextX = window.innerWidth - slime.w;
        slime.vx = -Math.abs(slime.vx) * 0.8;
    }

    for(let p of platforms) {
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
            if(Math.abs(slime.vy) < 1.5) slime.vy = 0;
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
}

requestAnimationFrame(gameLoop);

window.addEventListener('resize', () => {
    workArea.width  = window.innerWidth;
    workArea.height = window.innerHeight;
    // Cập nhật lại floorY khi resize (thiết bị có thể thay taskbar size)
    ipcRenderer.invoke('get-work-area-height').then(h => { if (h) floorY = h; });
});
