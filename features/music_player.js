const AudioManager = {
    sfx: {},
    preloadedSFX: {}, // Stores AudioBuffers
    preloadedMusic: {}, // Stores Blob URLs
    music: new Audio(),
    isPlayingMusic: false,
    playlist: [],
    currentIndex: -1,
    audioContext: null,

    init() {
        this.music.onended = () => this.handleSongEnded();
        this.fadeIntervals = {};
        this.isLooping = false;
        this.currentRepeatCount = 0; // Số lần đã lặp bài hiện tại
        
        // Initialize AudioContext on first interaction or init
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        } catch (e) {
            console.error('[AudioManager] Khong the khoi tao AudioContext:', e);
        }
        
        console.log('[AudioManager] Da khoi tao.');
    },

    playSFX(name, loop = false, fadeIn = false) {
        if (!loop) {
            // Sử dụng Web Audio API cho SFX không loop (cực nhanh)
            if (this.preloadedSFX[name] && this.audioContext) {
                if (this.audioContext.state === 'suspended') {
                    this.audioContext.resume();
                }
                const source = this.audioContext.createBufferSource();
                source.buffer = this.preloadedSFX[name];
                source.connect(this.audioContext.destination);
                source.start(0);
                return;
            }
            
            // Dự phòng nếu chưa preload hoặc AudioContext lỗi
            const audio = new Audio(`assets/audio/sfx/${name}.mp3`);
            audio.play().catch(e => console.warn(`[SFX] Khong the phat ${name}:`, e));
            return;
        }

        // Loop (VD: Mưa, Chim) -> Luu vao sfx để co the stop hoac fade
        if (!this.sfx[name]) {
            const url = `assets/audio/sfx/${name}.mp3`;
            this.sfx[name] = new Audio(url);
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

    playMusic(index) {
        if (index < 0 || index >= this.playlist.length) return;
        this.currentIndex = index;
        const songData = this.playlist[index];
        const fileName = typeof songData === 'string' ? songData : songData.file;
        
        this.music.src = `assets/audio/music/${fileName}`;
        this.music.play().then(() => {
            this.isPlayingMusic = true;
            this.updateUI();
        }).catch(e => console.error('[Music] Loi phat nhac:', e));
    },

    handleSongEnded() {
        const songData = this.playlist[this.currentIndex];
        const maxRepeat = (songData && songData.repeatCount) ? songData.repeatCount : 0;

        if (this.currentRepeatCount < maxRepeat) {
            this.currentRepeatCount++;
            console.log(`[AudioManager] Lặp lại bài hát (${this.currentRepeatCount}/${maxRepeat})`);
            this.music.currentTime = 0;
            this.music.play();
        } else {
            this.currentRepeatCount = 0;
            this.playNext();
        }
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
        if (next >= this.playlist.length) {
            if (this.isLooping) next = 0;
            else {
                this.isPlayingMusic = false;
                this.updateUI();
                return;
            }
        }
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
    },

    // ==== PHƯƠNG THỨC TẢI TRƯỚC (PRELOAD) ====
    async preloadSFX(names) {
        for (const name of names) {
            if (!this.preloadedSFX[name]) {
                try {
                    const response = await fetch(`assets/audio/sfx/${name}.mp3`);
                    const arrayBuffer = await response.arrayBuffer();
                    const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
                    this.preloadedSFX[name] = audioBuffer;
                    console.log(`[AudioManager] Đã nạp SFX vào bộ nhớ: ${name}`);
                } catch (e) {
                    console.error(`[AudioManager] Lỗi nạp SFX ${name}:`, e);
                }
            }
        }
    },

    async preloadMusic(name, path) {
        if (!this.preloadedMusic[name]) {
            try {
                // Tải file dưới dạng Blob và tạo URL để cache mạnh hơn
                const response = await fetch(path);
                const blob = await response.blob();
                const url = URL.createObjectURL(blob);
                this.preloadedMusic[name] = url;
                console.log(`[AudioManager] Đã nạp nhạc vào bộ nhớ: ${name}`);
            } catch (e) {
                console.error(`[AudioManager] Lỗi nạp nhạc ${name}:`, e);
            }
        }
    },

    playPreloadedMusic(name) {
        if (this.preloadedMusic[name]) {
            const audio = new Audio();
            audio.src = this.preloadedMusic[name];
            audio.play().catch(e => console.error(`[Music] Không thể phát nhạc preload ${name}:`, e));
            return audio;
        } else {
            console.warn(`[Music] Nhạc preload ${name} không tồn tại.`);
            return null;
        }
    }
};
AudioManager.init();



