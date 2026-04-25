/**
 * EventManagerUI - Quản lý giao diện cho tab Sự kiện
 */
const EventManagerUI = {
    droppedFiles: [],

    init() {
        this.setupEventListeners();
        this.render();
    },

    setupEventListeners() {
        const pane = document.getElementById('tab-events');
        if (!pane) return;

        pane.addEventListener('dragover', (e) => {
            e.preventDefault();
            pane.classList.add('drag-over');
        });

        pane.addEventListener('dragleave', () => {
            pane.classList.remove('drag-over');
        });

        pane.addEventListener('drop', (e) => {
            e.preventDefault();
            pane.classList.remove('drag-over');
            const files = Array.from(e.dataTransfer.files);
            if (files.length > 0) {
                this.handleDrop(files);
            }
        });

        const clearBtn = document.getElementById('clearEventFilesBtn');
        if (clearBtn) {
            clearBtn.onclick = () => {
                this.droppedFiles = [];
                this.renderFiles();
            };
        }
    },

    handleDrop(files) {
        this.droppedFiles = this.droppedFiles.concat(files);
        if (typeof spawnEmote === 'function') spawnEmote('📎');
        this.renderFiles();
    },

    render() {
        const container = document.getElementById('event-list');
        if (!container) return;

        if (typeof EventManager === 'undefined' || !EventManager.events) {
            container.innerHTML = '<p style="text-align:center; padding:20px; color:rgba(255,255,255,0.5);">Không có hệ thống sự kiện.</p>';
        } else if (EventManager.events.length === 0) {
            container.innerHTML = '<p style="text-align:center; padding:20px; color:rgba(255,255,255,0.5);">Chưa có sự kiện nào được đăng ký.</p>';
        } else {
            container.innerHTML = '';
            EventManager.events.forEach(event => {
                const card = this.createEventCard(event);
                container.appendChild(card);
            });
        }

        this.renderFiles();
    },

    renderFiles() {
        const list = document.getElementById('event-files-list');
        if (!list) return;

        if (this.droppedFiles.length === 0) {
            list.innerHTML = '<p style="text-align:center; padding:15px; color:rgba(255,255,255,0.3); font-size: 12px;">Kéo thả tệp vào đây để đính kèm...</p>';
            return;
        }

        list.innerHTML = '';
        this.droppedFiles.forEach((file, idx) => {
            const item = document.createElement('div');
            item.className = 'music-item'; // Dùng chung style cho đẹp
            item.style.cursor = 'default';
            item.innerHTML = `
                <span>${idx + 1}. ${file.name}</span>
                <span style="font-size: 10px; opacity: 0.5; margin-left: 10px;">(${(file.size / 1024).toFixed(1)} KB)</span>
            `;
            list.appendChild(item);
        });
    },

    createEventCard(event) {
        const card = document.createElement('div');
        card.className = 'event-card';

        // Xác định icon và mô tả dựa trên tên sự kiện
        let icon = '🎁';
        let description = 'Một sự kiện đặc biệt dành cho bạn.';
        
        if (event.name.includes('Sinh nhật')) {
            icon = '🎂';
            description = 'Sự kiện kỷ niệm sinh nhật mẹ của chủ nhân.';
        }

        // Trạng thái hiển thị
        let statusText = 'Đang chờ';
        let statusClass = 'waiting';
        
        if (event.state === 'FINISHED') {
            statusText = 'Đã hoàn thành';
            statusClass = 'finished';
        } else if (event.state && event.state !== 'WAITING') {
            statusText = 'Đang diễn ra';
            statusClass = 'active';
        }

        card.innerHTML = `
            <div class="event-info">
                <div class="event-icon">${icon}</div>
                <div class="event-details">
                    <h5>${event.name}</h5>
                    <p>${description}</p>
                    <span class="event-status ${statusClass}">${statusText}</span>
                </div>
            </div>
            <div class="event-actions">
                <button class="btn-trigger" ${event.state !== 'WAITING' && event.state !== 'MARK_SHOWN' && event.state !== 'FINISHED' ? 'disabled' : ''}>
                    ${event.state === 'FINISHED' ? 'Chạy lại' : 'Kích hoạt'}
                </button>
            </div>
        `;

        const triggerBtn = card.querySelector('.btn-trigger');
        triggerBtn.onclick = () => {
            if (typeof EventManager !== 'undefined') {
                this.triggerEvent(event);
            }
        };

        return card;
    },

    triggerEvent(event) {
        console.log(`[EventManagerUI] Yêu cầu kích hoạt thủ công: ${event.name}`);
        
        // Nếu là BirthdayEvent
        if (event.name.includes('Sinh nhật')) {
            // Reset trạng thái nếu đã xong
            if (event.state === 'FINISHED') {
                event.state = 'WAITING';
            }
            
            // Kích hoạt ngay lập tức
            if (event.showExclamation) {
                event.showExclamation();
                
                // Đóng cửa sổ manager để người dùng thấy sự kiện
                if (typeof SuiManager !== 'undefined') {
                    SuiManager.toggle();
                }
            }
        }
    }
};
