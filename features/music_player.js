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
        this.music.onended = () => this.playNext();
        this.fadeIntervals = {};
        
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

// ==== QUẢN LÝ CỬA SỔ CHUNG (SUI MANAGER) ====
const SuiManager = {
    library: [],
    el: null,
    isOpen: false,
    activeTabId: 'music', // Mặc định là tab nhạc
    isDraggingWindow: false,
    dragOffset: { x: 0, y: 0 },

    init() {
        this.el = document.getElementById('sui-manager');
        this.setupEventListeners();
        this.refreshLibrary();
        
        // Tải lại tab cuối cùng nếu có lưu
        const lastTab = localStorage.getItem('sui_last_tab');
        if (lastTab) {
            this.switchTab(lastTab);
        }
    },

    async refreshLibrary() {
        const { ipcRenderer } = require('electron');
        this.library = await ipcRenderer.invoke('get-audio-files', 'music');
        this.originalLibrary = [...this.library];
        this.renderLibrary();
    },

    switchTab(tabId) {
        this.activeTabId = tabId;
        localStorage.setItem('sui_last_tab', tabId);

        // Cập nhật giao diện tab
        document.querySelectorAll('.tab').forEach(tab => {
            if (tab.dataset.tab === tabId) tab.classList.add('active');
            else tab.classList.remove('active');
        });

        // Cập nhật panel hiển thị
        document.querySelectorAll('.tab-pane').forEach(pane => {
            if (pane.id === `tab-${tabId}`) pane.classList.add('active');
            else pane.classList.remove('active');
        });

        // Nếu chuyển sang tab sự kiện, hãy cập nhật danh sách
        if (tabId === 'events' && typeof EventManagerUI !== 'undefined') {
            EventManagerUI.render();
        }
    },

    executeSort() {
        const mode = this.currentSortMode || 'manual';
        if (mode === 'default') {
            AudioManager.playlist = [...this.originalLibrary];
            this.renderPlaylist();
        } else if (mode === 'random') {
            AudioManager.playlist.sort(() => Math.random() - 0.5);
            this.renderPlaylist();
        } else if (mode === 'manual') {
            this.renderPlaylist();
        }
    },

    getDragAfterElement(container, y) {
        const draggableElements = [...container.querySelectorAll('.music-item')];
        return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;
            if (offset < 0 && offset > closest.offset) {
                return { offset: offset, element: child };
            } else {
                return closest;
            }
        }, { offset: Number.NEGATIVE_INFINITY }).element;
    },

    renderLibrary() {
        const list = document.getElementById('library-list');
        if (!list) return;
        list.innerHTML = '';
        this.library.forEach(file => {
            const item = document.createElement('div');
            item.className = 'music-item';
            item.textContent = file;
            item.draggable = true;
            item.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('source', 'library');
                e.dataTransfer.setData('text/plain', file);
            });
            item.addEventListener('dblclick', () => {
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
        if (!list) return;
        list.innerHTML = '';
        AudioManager.playlist.forEach((file, idx) => {
            const item = document.createElement('div');
            item.className = 'music-item';
            item.textContent = `${idx + 1}. ${file}`;
            item.dataset.file = file;
            item.draggable = true;
            item.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('source', 'playlist');
                e.dataTransfer.setData('idx', idx.toString());
            });
            item.addEventListener('click', () => AudioManager.playMusic(idx));
            list.appendChild(item);
        });
        AudioManager.updateUI();
    },

    toggle() {
        const { ipcRenderer } = require('electron');
        this.isOpen = !this.isOpen;
        if (this.isOpen) {
            this.el.classList.add('show');
            ipcRenderer.send('set-ignore-mouse-events', false);
            // Khi mở ra, nếu là tab sự kiện thì render lại cho chắc
            if (this.activeTabId === 'events' && typeof EventManagerUI !== 'undefined') {
                EventManagerUI.render();
            }
        } else {
            this.el.classList.remove('show');
            if (typeof isDrawingMode !== 'undefined' && typeof slime !== 'undefined') {
                if (!isDrawingMode && !slime.isDragging) ipcRenderer.send('set-ignore-mouse-events', true, { forward: true });
            } else {
                ipcRenderer.send('set-ignore-mouse-events', true, { forward: true });
            }
        }
    },

    setupEventListeners() {
        const { ipcRenderer } = require('electron');
        
        // Đóng cửa sổ
        document.getElementById('closeManagerBtn').onclick = () => this.toggle();
        
        // Chuyển Tab
        document.querySelectorAll('.tab').forEach(tab => {
            tab.onclick = () => this.switchTab(tab.dataset.tab);
        });

        // Controls nhạc
        document.getElementById('playBtn').onclick = () => AudioManager.togglePlay();
        document.getElementById('refreshLibraryBtn').onclick = () => this.refreshLibrary();

        const sortActionBtn = document.getElementById('sortActionBtn');
        const sortDropdownBtn = document.getElementById('sortDropdownBtn');
        const sortDropdownMenu = document.getElementById('sortDropdownMenu');
        const modeItems = sortDropdownMenu.querySelectorAll('div');

        this.currentSortMode = 'manual';

        sortDropdownBtn.onclick = (e) => {
            e.stopPropagation();
            sortDropdownMenu.classList.toggle('show');
        };

        window.addEventListener('click', () => {
            if (sortDropdownMenu.classList.contains('show')) {
                sortDropdownMenu.classList.remove('show');
            }
        });

        modeItems.forEach(item => {
            item.onclick = (e) => {
                e.stopPropagation();
                this.currentSortMode = item.dataset.mode;
                sortActionBtn.textContent = item.textContent;

                modeItems.forEach(i => i.classList.remove('active'));
                item.classList.add('active');

                sortDropdownMenu.classList.remove('show');
            }
        });

        sortActionBtn.onclick = () => {
            this.executeSort();
        };

        // Drag and Drop files
        const playlistList = document.getElementById('playlist-list');
        playlistList.addEventListener('dragover', (e) => {
            e.preventDefault();
            const afterElement = this.getDragAfterElement(playlistList, e.clientY);
            const items = playlistList.querySelectorAll('.music-item');
            items.forEach(item => item.classList.remove('drag-over-top', 'drag-over-bottom'));

            if (afterElement) {
                afterElement.classList.add('drag-over-top');
            } else if (items.length > 0) {
                items[items.length - 1].classList.add('drag-over-bottom');
            }
        });

        playlistList.addEventListener('dragleave', (e) => {
            const items = playlistList.querySelectorAll('.music-item');
            items.forEach(item => item.classList.remove('drag-over-top', 'drag-over-bottom'));
        });

        playlistList.addEventListener('drop', (e) => {
            e.preventDefault();
            const items = playlistList.querySelectorAll('.music-item');
            items.forEach(item => item.classList.remove('drag-over-top', 'drag-over-bottom'));

            const source = e.dataTransfer.getData('source');
            const afterElement = this.getDragAfterElement(playlistList, e.clientY);

            const currentPlayingSong = (AudioManager.currentIndex >= 0 && AudioManager.currentIndex < AudioManager.playlist.length)
                ? AudioManager.playlist[AudioManager.currentIndex]
                : null;

            if (source === 'library') {
                const file = e.dataTransfer.getData('text/plain');
                if (!file) return;

                if (afterElement) {
                    const insertIdx = AudioManager.playlist.indexOf(afterElement.dataset.file);
                    AudioManager.playlist.splice(insertIdx, 0, file);
                } else {
                    AudioManager.playlist.push(file);
                }
            } else if (source === 'playlist') {
                const dragIdx = parseInt(e.dataTransfer.getData('idx'), 10);
                if (isNaN(dragIdx)) return;

                const file = AudioManager.playlist[dragIdx];
                AudioManager.playlist.splice(dragIdx, 1);

                if (afterElement) {
                    const insertIdx = AudioManager.playlist.indexOf(afterElement.dataset.file);
                    AudioManager.playlist.splice(insertIdx, 0, file);
                } else {
                    AudioManager.playlist.push(file);
                }
            }

            if (currentPlayingSong) {
                AudioManager.currentIndex = AudioManager.playlist.indexOf(currentPlayingSong);
            }

            this.renderPlaylist();
        });

        // Di chuyển cửa sổ
        const header = this.el.querySelector('.window-header');
        header.onmousedown = (e) => {
            if (e.target.closest('.header-controls') || e.target.closest('.tab')) return;
            this.isDraggingWindow = true;
            this.dragOffset.x = e.clientX - this.el.offsetLeft;
            this.dragOffset.y = e.clientY - this.el.offsetTop;
            header.style.cursor = 'grabbing';
        };

        window.addEventListener('mousemove', (e) => {
            if (!this.isDraggingWindow) return;
            this.el.style.left = (e.clientX - this.dragOffset.x) + 'px';
            this.el.style.top = (e.clientY - this.dragOffset.y) + 'px';
            this.el.style.transform = 'none';
        });

        window.addEventListener('mouseup', () => {
            this.isDraggingWindow = false;
            header.style.cursor = 'move';
        });
    }
};
document.addEventListener('DOMContentLoaded', () => SuiManager.init());

