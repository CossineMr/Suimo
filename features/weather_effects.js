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

// ==== PHÍM TẮT THỜI TIẾT ====
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
    if (typeof isDrawingMode !== 'undefined' && isDrawingMode) return; // Khong bat khi dang ve
    const key = e.key.toLowerCase();
    if (key === 'z') StormSystem.start('SMALL');
    if (key === 'x') StormSystem.start('MEDIUM');
    if (key === 'c') StormSystem.start('HEAVY');
});
