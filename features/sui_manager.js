/**
 * SuiManager - Quản lý cửa sổ chính của Sui (Âm nhạc, Sự kiện, Nhiệm vụ)
 */
const SuiManager = {
    library: [],
    el: null,
    isOpen: false,
    activeTabId: 'music', // Mặc định là tab nhạc
    isDraggingWindow: false,
    dragOffset: { x: 0, y: 0 },

    init() {
        this.el = document.getElementById('sui-manager');
        this.backdrop = document.getElementById('manager-backdrop');
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
        const mode = this.currentSortMode || 'default';
        
        // Lưu bài hát đang phát (nếu có)
        const currentSongFile = (AudioManager.currentIndex >= 0 && AudioManager.playlist[AudioManager.currentIndex]) 
            ? AudioManager.playlist[AudioManager.currentIndex].file 
            : null;

        let newList = [];
        if (mode === 'default') {
            // Lấy toàn bộ TVN và sắp xếp A-Z
            newList = this.originalLibrary.map(f => ({ file: f, repeatCount: 0 }));
            newList.sort((a, b) => a.file.localeCompare(b.file, undefined, {sensitivity: 'base', numeric: true}));
        } else if (mode === 'random') {
            // Lấy toàn bộ TVN và xáo trộn
            newList = this.originalLibrary.map(f => ({ file: f, repeatCount: 0 }));
            for (let i = newList.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [newList[i], newList[j]] = [newList[j], newList[i]];
            }
        }

        if (newList.length > 0) {
            AudioManager.playlist = newList;
            
            // Tìm lại vị trí bài đang phát trong danh sách mới
            if (currentSongFile) {
                AudioManager.currentIndex = AudioManager.playlist.findIndex(s => s.file === currentSongFile);
            }
            
            this.renderPlaylist();
            if (typeof spawnEmote === 'function') spawnEmote('🔀');
        } else {
            console.warn('[SuiManager] Thư viện trống, không có gì để sắp xếp.');
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
        AudioManager.playlist.push({ file: file, repeatCount: 0 });
        this.renderPlaylist();
    },

    renderPlaylist() {
        const list = document.getElementById('playlist-list');
        if (!list) return;
        list.innerHTML = '';
        AudioManager.playlist.forEach((songData, idx) => {
            const file = songData.file;
            const item = document.createElement('div');
            item.className = 'music-item';
            
            const nameSpan = document.createElement('span');
            nameSpan.className = 'music-name';
            nameSpan.textContent = `${idx + 1}. ${file}`;
            nameSpan.onclick = () => AudioManager.playMusic(idx);
            
            const controls = document.createElement('div');
            controls.className = 'music-item-controls';
            controls.innerHTML = `
                <span class="repeat-label">Lặp:</span>
                <input type="number" min="0" max="99" value="${songData.repeatCount}" class="repeat-count-input" title="Số lần lặp lại bài này">
            `;
            
            const repeatInput = controls.querySelector('input');
            repeatInput.onclick = (e) => e.stopPropagation();
            repeatInput.onchange = (e) => {
                let val = parseInt(e.target.value);
                if (isNaN(val) || val < 0) val = 0;
                AudioManager.playlist[idx].repeatCount = val;
                e.target.value = val;
            };

            item.appendChild(nameSpan);
            item.appendChild(controls);

            item.dataset.file = file;
            item.draggable = true;
            item.addEventListener('dragstart', (e) => {
                item.classList.add('dragging-internal');
                e.dataTransfer.setData('source', 'playlist');
                e.dataTransfer.setData('idx', idx.toString());
            });
            item.addEventListener('dragend', () => {
                item.classList.remove('dragging-internal');
                const pList = document.getElementById('playlist-list');
                if (pList) {
                    const items = pList.querySelectorAll('.music-item');
                    items.forEach(i => i.classList.remove('drag-over-insert', 'drag-over-swap', 'drag-over-bottom'));
                }
            });
            
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
            this.isDraggingWindow = false; // Reset trạng thái kéo
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

        this.currentSortMode = 'default';

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
                const oldMode = this.currentSortMode;
                this.currentSortMode = item.dataset.mode;
                sortActionBtn.textContent = item.textContent;

                // Cập nhật giao diện menu
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
            const items = playlistList.querySelectorAll('.music-item');
            items.forEach(item => item.classList.remove('drag-over-insert', 'drag-over-swap', 'drag-over-bottom'));

            const afterElement = this.getDragAfterElement(playlistList, e.clientY);
            
            // Luôn hiển thị feedback kiểu chèn (Insert) để đồng nhất
            if (afterElement) {
                afterElement.classList.add('drag-over-insert');
            } else if (items.length > 0) {
                items[items.length - 1].classList.add('drag-over-bottom');
            }
        });

        playlistList.addEventListener('dragleave', (e) => {
            const items = playlistList.querySelectorAll('.music-item');
            items.forEach(item => item.classList.remove('drag-over-insert', 'drag-over-swap', 'drag-over-bottom'));
        });

        playlistList.addEventListener('drop', (e) => {
            e.preventDefault();
            const items = playlistList.querySelectorAll('.music-item');
            items.forEach(item => item.classList.remove('drag-over-insert', 'drag-over-swap', 'drag-over-bottom'));

            const source = e.dataTransfer.getData('source');
            const afterElement = this.getDragAfterElement(playlistList, e.clientY);

            const currentPlayingSong = (AudioManager.currentIndex >= 0 && AudioManager.currentIndex < AudioManager.playlist.length)
                ? AudioManager.playlist[AudioManager.currentIndex]
                : null;

            if (source === 'library') {
                const file = e.dataTransfer.getData('text/plain');
                if (!file) return;

                const songData = { file: file, repeatCount: 0 };

                if (afterElement) {
                    const insertIdx = AudioManager.playlist.findIndex(s => s.file === afterElement.dataset.file);
                    AudioManager.playlist.splice(insertIdx, 0, songData);
                } else {
                    AudioManager.playlist.push(songData);
                }
            } else if (source === 'playlist') {
                const dragIdx = parseInt(e.dataTransfer.getData('idx'), 10);
                if (isNaN(dragIdx)) return;

                // Lưu dữ liệu bài hát cũ và xóa nó khỏi danh sách
                const songData = AudioManager.playlist[dragIdx];
                AudioManager.playlist.splice(dragIdx, 1);
                
                if (afterElement) {
                    const insertIdx = AudioManager.playlist.findIndex(s => s.file === afterElement.dataset.file);
                    AudioManager.playlist.splice(insertIdx, 0, songData);
                } else {
                    // Nếu không có afterElement, nghĩa là thả vào cuối danh sách
                    AudioManager.playlist.push(songData);
                }
                
                console.log(`[SuiManager] Đã di chuyển bài hát: ${songData.file}`);
            }

            if (currentPlayingSong) {
                AudioManager.currentIndex = AudioManager.playlist.indexOf(currentPlayingSong);
            }

            this.renderPlaylist();
        });

        // Kéo thả bài hát từ DSP về Thư viện (để xóa khỏi DSP)
        const libraryList = document.getElementById('library-list');
        libraryList.addEventListener('dragover', (e) => e.preventDefault());
        libraryList.addEventListener('drop', (e) => {
            e.preventDefault();
            const source = e.dataTransfer.getData('source');
            if (source === 'playlist') {
                const dragIdx = parseInt(e.dataTransfer.getData('idx'), 10);
                if (!isNaN(dragIdx)) {
                    const currentPlayingSong = (AudioManager.currentIndex >= 0) ? AudioManager.playlist[AudioManager.currentIndex] : null;
                    
                    console.log(`[SuiManager] Xóa bài hát khỏi DSP: ${AudioManager.playlist[dragIdx]}`);
                    AudioManager.playlist.splice(dragIdx, 1);
                    
                    // Cập nhật lại chỉ mục bài đang phát
                    if (currentPlayingSong) {
                        AudioManager.currentIndex = AudioManager.playlist.indexOf(currentPlayingSong);
                    }
                    
                    this.renderPlaylist();
                    if (typeof spawnEmote === 'function') spawnEmote('🗑️');
                }
            }
        });

        // Di chuyển cửa sổ
        const header = this.el.querySelector('.window-header');
        header.onmousedown = (e) => {
            if (e.target.closest('.header-controls') || e.target.closest('.tab')) return;
            this.isDraggingWindow = true;
            
            // Tạm thời tắt transition để tránh hiệu ứng "lướt" khi bắt đầu kéo
            this.el.style.transition = 'none';
            
            const rect = this.el.getBoundingClientRect();
            this.dragOffset.x = e.clientX - rect.left;
            this.dragOffset.y = e.clientY - rect.top;
            
            // Chuyển từ transform sang absolute position để tránh giật khi kéo
            this.el.style.transform = 'none';
            this.el.style.left = rect.left + 'px';
            this.el.style.top = rect.top + 'px';
            this.el.style.margin = '0';
            
            header.style.cursor = 'grabbing';
        };

        window.addEventListener('mousemove', (e) => {
            if (!this.isDraggingWindow) return;
            this.el.style.left = (e.clientX - this.dragOffset.x) + 'px';
            this.el.style.top = (e.clientY - this.dragOffset.y) + 'px';
        });

        window.addEventListener('mouseup', () => {
            if (this.isDraggingWindow) {
                this.isDraggingWindow = false;
                header.style.cursor = 'move';
                // Khôi phục lại transition sau khi thả chuột
                this.el.style.transition = '';
            }
        });

        // Nút Loop
        const loopBtn = document.getElementById('loopBtn');
        loopBtn.onclick = () => {
            AudioManager.isLooping = !AudioManager.isLooping;
            loopBtn.classList.toggle('active', AudioManager.isLooping);
            if (typeof spawnEmote === 'function') spawnEmote(AudioManager.isLooping ? '🔁' : '➡️');
        };
    }
};
document.addEventListener('DOMContentLoaded', () => SuiManager.init());
