/**
 * TaskPlanner - Trợ lý quản lý nhiệm vụ thông minh của Sui
 */
const TaskPlanner = {
    state: 'DESCRIBING', // DESCRIBING, VALIDATING, PLANNING, EXECUTING
    currentStep: 0,
    steps: ['step-describe', 'step-validate', 'step-plan', 'step-execute'],
    
    taskData: {
        description: '',
        files: [],
        timeline: [],
        useMusic: false,
        useBreaks: false
    },

    init() {
        this.setupEventListeners();
        console.log('[TaskPlanner] Đã khởi tạo.');
    },

    setupEventListeners() {
        // Điều hướng giữa các bước
        document.getElementById('btn-next-to-validate').onclick = () => this.goToStep(1);
        document.getElementById('btn-back-to-describe').onclick = () => this.goToStep(0);
        document.getElementById('btn-next-to-plan').onclick = () => this.goToStep(2);
        document.getElementById('btn-back-to-validate').onclick = () => this.goToStep(1);
        document.getElementById('btn-confirm-plan').onclick = () => this.finishPlanning();
        document.getElementById('btn-cancel-task').onclick = () => this.goToStep(0);

        // Upload file
        const fileInput = document.getElementById('task-file-input');
        document.getElementById('btn-upload-trigger').onclick = () => fileInput.click();
        fileInput.onchange = (e) => this.handleFileUpload(e);

        // Chat trong bước thẩm định
        document.getElementById('btn-send-chat').onclick = () => this.handleChat();
        document.getElementById('task-chat-input').onkeydown = (e) => {
            if (e.key === 'Enter') this.handleChat();
        };
    },

    goToStep(idx) {
        this.currentStep = idx;
        const stepId = this.steps[idx];
        const panes = document.querySelectorAll('.task-step');
        panes.forEach(p => p.classList.remove('active'));
        document.getElementById(stepId).classList.add('active');

        // Cập nhật indicator
        const dots = document.querySelectorAll('.step-dots .dot');
        dots.forEach((dot, i) => {
            if (i === idx) dot.classList.add('active');
            else dot.classList.remove('active');
        });

        // Xử lý logic đặc thù cho từng bước khi vừa bước vào
        if (stepId === 'step-validate') {
            this.taskData.description = document.getElementById('task-description').value;
            this.startValidation();
        } else if (stepId === 'step-plan') {
            this.generateTimeline();
        }

        if (typeof spawnEmote === 'function') {
            const emotes = ['📝', '🧐', '📅', '🚀'];
            spawnEmote(emotes[idx] || '✨');
        }
    },

    // --- BƯỚC 2: THẨM ĐỊNH (VALIDATION) ---
    startValidation() {
        const chatContainer = document.getElementById('sui-validation-chat');
        chatContainer.innerHTML = ''; // Reset chat
        this.addChatMessage('sui', 'Sui đang xem xét mục tiêu của bạn...');
        
        // Gửi thông tin cho AI
        this.processAIValidation();
    },

    async processAIValidation() {
        if (typeof AIService === 'undefined' || this.isProcessingAI) return;
        
        this.isProcessingAI = true;
        // Hiển thị trạng thái đang gõ
        const typingId = this.addTypingIndicator();
        
        try {
            const result = await AIService.validateTask(this.taskData.description, this.taskData.files);
            this.addChatMessage('sui', result.message);
            document.getElementById('btn-next-to-plan').disabled = !result.isReady;
        } catch (err) {
            console.error('[TaskPlanner] Lỗi AI:', err);
            this.addChatMessage('sui', 'Sui hơi choáng một chút, bạn thử nói lại được không?');
        } finally {
            this.removeTypingIndicator(typingId);
            this.isProcessingAI = false;
        }
    },

    async handleChat() {
        const input = document.getElementById('task-chat-input');
        const text = input.value.trim();
        if (!text) return;

        this.addChatMessage('user', text);
        input.value = '';
        
        // Nối thêm thông tin vào description
        this.taskData.description += "\\n" + text;
        this.processAIValidation();
    },

    handleFileUpload(e) {
        const files = Array.from(e.target.files);
        if (files.length === 0) return;
        
        this.taskData.files = this.taskData.files.concat(files);
        this.addChatMessage('user', `[Đã tải lên tệp: ${files.map(f => f.name).join(', ')}]`);
        
        this.processAIValidation();
    },

    addChatMessage(sender, text) {
        const chatContainer = document.getElementById('sui-validation-chat');
        const msg = document.createElement('div');
        msg.className = `message ${sender}`;
        msg.textContent = text;
        chatContainer.appendChild(msg);
        chatContainer.scrollTop = chatContainer.scrollHeight;
    },

    addTypingIndicator() {
        const chatContainer = document.getElementById('sui-validation-chat');
        const msg = document.createElement('div');
        msg.className = `message sui typing-indicator`;
        msg.id = 'typing-' + Date.now();
        msg.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
        chatContainer.appendChild(msg);
        chatContainer.scrollTop = chatContainer.scrollHeight;
        return msg.id;
    },

    removeTypingIndicator(id) {
        const el = document.getElementById(id);
        if (el) el.remove();
    },

    // --- BƯỚC 3: LẬP KẾ HOẠCH (PLANNING) ---
    async generateTimeline() {
        const container = document.getElementById('task-timeline');
        container.innerHTML = '<div style="text-align: center; padding: 20px;">Sui đang tính toán lộ trình tối ưu... ⏳</div>';

        if (typeof AIService !== 'undefined') {
            const plan = await AIService.generatePlan(this.taskData.description);
            this.taskData.timeline = plan;
        }
        
        this.renderTimeline();
    },

    renderTimeline() {
        const container = document.getElementById('task-timeline');
        container.innerHTML = '';

        this.taskData.timeline.forEach((item, idx) => {
            const el = document.createElement('div');
            el.className = `timeline-item ${item.type}`;
            
            let contentHtml = `
                <div class="timeline-time">
                    <input type="number" min="1" max="120" value="${item.duration}" class="duration-input" data-idx="${idx}" style="width: 50px; background: rgba(0,0,0,0.3); color: white; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 2px 5px;"> phút
                </div>
                <div class="timeline-content">${item.label}</div>
            `;

            if (item.type === 'break') {
                contentHtml += `
                    <select class="break-select" data-idx="${idx}">
                        <option value="none">-- Nghỉ tự do --</option>
                        ${this.getAvailableEventsOptions(item.eventName)}
                    </select>
                `;
            }

            el.innerHTML = contentHtml;
            container.appendChild(el);
        });

        // Lắng nghe thay đổi thời lượng
        container.querySelectorAll('.duration-input').forEach(input => {
            input.onchange = (e) => {
                const idx = e.target.dataset.idx;
                let val = parseInt(e.target.value);
                if (isNaN(val) || val < 1) val = 1;
                this.taskData.timeline[idx].duration = val;
                e.target.value = val;
            };
        });

        // Lắng nghe thay đổi sự kiện nghỉ ngơi
        container.querySelectorAll('.break-select').forEach(select => {
            select.onchange = (e) => {
                const idx = e.target.dataset.idx;
                const eventName = e.target.value;
                this.taskData.timeline[idx].eventName = eventName;
                
                // Nếu sự kiện có thời lượng đề xuất, có thể tự động cập nhật input duration ở đây
                const ev = this.getEventByName(eventName);
                if (ev && ev.estimatedDuration) {
                    this.taskData.timeline[idx].duration = ev.estimatedDuration;
                    this.renderTimeline(); // Render lại để cập nhật input
                }
            };
        });
    },

    getAvailableEventsOptions(selected) {
        if (typeof EventManager === 'undefined' || !EventManager.events) return '';
        return EventManager.events.map(ev => 
            `<option value="${ev.name}" ${selected === ev.name ? 'selected' : ''}>${ev.name}</option>`
        ).join('');
    },

    getEventByName(name) {
        if (typeof EventManager === 'undefined' || !EventManager.events) return null;
        return EventManager.events.find(ev => ev.name === name);
    },

    finishPlanning() {
        // Hỏi về nhạc trước khi bắt đầu
        const wantMusic = confirm('Sui có nên chuẩn bị nhạc nền cho bạn không?');
        if (wantMusic && typeof SuiManager !== 'undefined') {
            SuiManager.switchTab('music');
            this.taskData.useMusic = true;
        }

        const wantBreaks = confirm('Bạn có muốn Sui tự động kích hoạt các sự kiện giải lao đã chọn không?');
        this.taskData.useBreaks = wantBreaks;

        this.goToStep(3);
        this.startExecution();
    },

    // --- BƯỚC 4: THỰC HIỆN (EXECUTION) ---
    startExecution() {
        console.log('[TaskPlanner] Bắt đầu thực hiện nhiệm vụ!');
        this.currentIntervalIdx = 0;
        this.runInterval();
    },

    runInterval() {
        if (this.currentIntervalIdx >= this.taskData.timeline.length) {
            this.finishTask();
            return;
        }

        const interval = this.taskData.timeline[this.currentIntervalIdx];
        this.intervalSecondsLeft = interval.duration * 60;
        this.intervalTotalSeconds = this.intervalSecondsLeft;

        // Cập nhật UI UI
        document.getElementById('current-task-name').textContent = interval.label;
        document.getElementById('task-progress').style.width = '0%';
        
        // Quản lý Nhạc & Sự kiện
        if (interval.type === 'work') {
            document.querySelector('.active-task-card').style.borderColor = '#63b3ff';
            // Bật nhạc nếu đang tắt và người dùng có chọn
            if (this.taskData.useMusic && typeof AudioManager !== 'undefined') {
                if (!AudioManager.isPlayingMusic) {
                    AudioManager.togglePlay(); // Play
                }
            }
        } else if (interval.type === 'break') {
            document.querySelector('.active-task-card').style.borderColor = '#fbbf24';
            // Tạm dừng nhạc nếu đang phát
            if (this.taskData.useMusic && typeof AudioManager !== 'undefined') {
                if (AudioManager.isPlayingMusic) {
                    AudioManager.togglePlay(); // Pause
                }
            }
            
            // Kích hoạt sự kiện
            if (interval.eventName && interval.eventName !== 'none') {
                const ev = this.getEventByName(interval.eventName);
                if (ev && typeof EventManagerUI !== 'undefined') {
                    console.log(`[TaskPlanner] Kích hoạt sự kiện nghỉ ngơi: ${ev.name}`);
                    EventManagerUI.triggerEvent(ev);
                }
            }
        }

        // Tìm thời gian đến quãng nghỉ tiếp theo (nếu đang làm việc)
        if (interval.type === 'work') {
            let nextBreakTime = 0;
            for (let i = this.currentIntervalIdx + 1; i < this.taskData.timeline.length; i++) {
                if (this.taskData.timeline[i].type === 'break') {
                    nextBreakTime = this.taskData.timeline[i].duration;
                    break;
                }
            }
            if (nextBreakTime > 0) {
                document.getElementById('next-break-info').textContent = `Giải lao tiếp theo sau chặng này`;
            } else {
                document.getElementById('next-break-info').textContent = `Chặng làm việc cuối cùng`;
            }
        } else {
            document.getElementById('next-break-info').textContent = `Đang giải lao... Thư giãn nhé!`;
        }

        this.startTimerInterval();
    },

    startTimerInterval() {
        if (this.timerInterval) clearInterval(this.timerInterval);
        
        const timerEl = document.getElementById('main-timer');
        const progressEl = document.getElementById('task-progress');

        const updateDisplay = () => {
            const h = Math.floor(this.intervalSecondsLeft / 3600).toString().padStart(2, '0');
            const m = Math.floor((this.intervalSecondsLeft % 3600) / 60).toString().padStart(2, '0');
            const s = (this.intervalSecondsLeft % 60).toString().padStart(2, '0');
            timerEl.textContent = `${h}:${m}:${s}`;
            
            const pct = 100 - ((this.intervalSecondsLeft / this.intervalTotalSeconds) * 100);
            progressEl.style.width = `${pct}%`;
            
            this.updateBubblePosition();
        };

        updateDisplay();

        let tickCount = 0;
        this.timerInterval = setInterval(() => {
            this.intervalSecondsLeft--;
            tickCount++;
            updateDisplay();

            // Nhắc nhở/Động viên ngẫu nhiên mỗi 1-2 phút
            if (this.taskData.timeline[this.currentIntervalIdx].type === 'work' && tickCount % 90 === 0) {
                this.shoutEncouragement();
            }

            if (this.intervalSecondsLeft <= 0) {
                clearInterval(this.timerInterval);
                this.currentIntervalIdx++;
                
                if (this.currentIntervalIdx < this.taskData.timeline.length) {
                    const next = this.taskData.timeline[this.currentIntervalIdx];
                    if (next.type === 'break') {
                        this.showDesktopBubble('Giờ nghỉ đến rồi! Thả lỏng thôi nào chủ nhân ơi~ 🎈');
                    } else {
                        this.showDesktopBubble('Quay lại làm việc thôi! Cố gắng lên nhé! 💪');
                    }
                }
                
                this.runInterval();
            }
        }, 1000);
    },

    showDesktopBubble(text, duration = 4000) {
        const bubble = document.getElementById('sui-desktop-bubble');
        const content = bubble.querySelector('.bubble-content');
        
        content.textContent = text;
        bubble.classList.add('show');
        
        this.updateBubblePosition();

        if (this.bubbleTimeout) clearTimeout(this.bubbleTimeout);
        this.bubbleTimeout = setTimeout(() => {
            bubble.classList.remove('show');
        }, duration);
    },

    updateBubblePosition() {
        if (typeof slime === 'undefined') return;
        const bubble = document.getElementById('sui-desktop-bubble');
        if (!bubble.classList.contains('show')) return;

        // Vị trí dựa trên tọa độ của Sui (từ renderer.js)
        const bx = slime.x + slime.w / 2 - 20;
        const by = slime.y - 70;

        bubble.style.left = bx + 'px';
        bubble.style.top = by + 'px';
        
        // Nếu Sui đang ở sát lề phải, lật bong bóng
        if (bx + 250 > window.innerWidth) {
            bubble.classList.add('flip');
            bubble.style.left = (slime.x + slime.w / 2 - 230) + 'px';
        } else {
            bubble.classList.remove('flip');
        }
    },

    shoutEncouragement() {
        const quotes = [
            'Chủ nhân đang làm rất tốt! Sui tự hào về bạn lắm~ ❤️',
            'Sắp đến giờ nghỉ rồi, cố thêm chút nữa thôi! 💪',
            'Đừng quên uống nước nhé, sức khỏe là trên hết! 💧',
            'Tập trung vào nào, Sui đang cổ vũ bạn đây! ✨',
            'Hoàn thành nốt chặng này rồi mình cùng giải lao nhé! 🎈',
            'Chủ nhân giỏi quá, Sui tin bạn sẽ làm được! 🌟'
        ];
        const randomQuote = quotes[Math.floor(Math.random() * quotes.length)];
        this.showDesktopBubble(randomQuote);
        if (typeof spawnEmote === 'function') spawnEmote('✨');
    },

    finishTask() {
        document.getElementById('current-task-name').textContent = 'Hoàn thành xuất sắc! 🎉';
        document.getElementById('main-timer').textContent = '00:00:00';
        document.getElementById('task-progress').style.width = '100%';
        document.getElementById('next-break-info').textContent = '';
        
        if (typeof spawnEmote === 'function') spawnEmote('🥳');
        
        // Dọn dẹp
        if (this.timerInterval) clearInterval(this.timerInterval);
        
        // Sau 3 giây quay về màn hình đầu
        setTimeout(() => {
            this.goToStep(0);
            this.taskData = { description: '', files: [], timeline: [], useMusic: false, useBreaks: false };
        }, 3000);
    }
};

// Khởi tạo khi trang web load
document.addEventListener('DOMContentLoaded', () => TaskPlanner.init());
