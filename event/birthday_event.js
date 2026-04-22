// ==== HÀNH VI SỰ KIỆN SINH NHẬT MẸ TÔI ====

const BirthdayEvent = {
    name: 'Sự kiện Sinh nhật',
    state: 'WAITING', // WAITING, MARK_SHOWN, FALLING, LANDED, MOVING_TO_PRESENT, PUSHING_PRESENT, OPENING_PRESENT, FINISHED
    present: null,
    exclamation: null,

    init() {
        console.log("[BirthdayEvent] Đã khởi chạy. Đang chờ 10s để hiện dấu chấm than...");
        setTimeout(() => {
            this.showExclamation();
        }, 10000);
    },

    showExclamation() {
        if (this.state !== 'WAITING') return;
        this.state = 'MARK_SHOWN';
        
        this.exclamation = document.createElement('div');
        this.exclamation.className = 'exclamation-mark interactive';
        this.exclamation.textContent = '!';
        this.exclamation.title = 'Nhấp vào đây!';
        
        // Đảm bảo applyHoverLogic tồn tại (từ renderer.js)
        if (typeof applyHoverLogic === 'function') {
            applyHoverLogic(this.exclamation);
        }
        
        document.body.appendChild(this.exclamation);

        this.exclamation.addEventListener('click', () => {
            this.startFalling();
        });
    },

    startFalling() {
        this.state = 'FALLING';
        if (this.exclamation) {
            this.exclamation.remove();
            this.exclamation = null;
        }

        this.present = document.createElement('img');
        this.present.src = 'assets/FallingPresent.svg';
        this.present.className = 'falling-gift interactive';
        const giftWidth = 150;
        const minX = 120; // Đủ chỗ cho Sui đứng bên trái
        const maxX = window.innerWidth - 270; // Đủ chỗ cho Sui đứng bên phải
        const randomX = Math.random() * (maxX - minX) + minX;
        this.present.style.left = randomX + 'px';
        document.body.appendChild(this.present);

        if (typeof applyHoverLogic === 'function') {
            applyHoverLogic(this.present);
        }

        this.present.addEventListener('animationend', (e) => {
            // Kiểm tra nếu là animation rơi (fallGift) thì mới xử lý tiếp đất
            if (e.animationName !== 'fallGift') return;
            this.onLanded();
        });
    },

    onLanded() {
        this.state = 'LANDED';
        
        // Capture current position but snap to floorY if available
        let targetTop = window.getComputedStyle(this.present).top;
        if (typeof floorY !== 'undefined') {
            targetTop = (floorY - 135) + 'px'; // 135px là chiều cao ước tính của hộp quà
        }
        this.present.style.top = targetTop;
        this.present.style.animation = ''; // Xóa inline style để class-based animation có thể chạy
        void this.present.offsetWidth; // Force reflow
        
        // Chuyển sang trạng thái nằm im trên sàn
        this.present.src = 'assets/Present.svg';
        this.present.classList.remove('falling-gift');
        this.present.classList.add('present-landed');
        
        // Hiệu ứng lắc lư khi chạm đất
        this.present.classList.add('sui-wobble');
        
        if (typeof spawnEmote === 'function') spawnEmote('🎁');
        if (typeof spawnHearts === 'function') spawnHearts();

        this.present.addEventListener('click', () => {
            if (this.state === 'LANDED') {
                this.startPushing();
            }
        });
    },

    startPushing() {
        const centerX = window.innerWidth / 2;
        const rect = this.present.getBoundingClientRect();
        const presentCenter = rect.left + rect.width / 2;

        slime.targetPresentSide = (presentCenter < centerX) ? 'left' : 'right';
        slime.vy = -12;
        this.state = 'MOVING_TO_PRESENT';
        if (typeof spawnEmote === 'function') spawnEmote('!');
    },

    update() {
        // 1. Cập nhật vị trí dấu chấm than nếu đang hiện
        if (this.state === 'MARK_SHOWN' && this.exclamation) {
            this.exclamation.style.left = (slime.x + slime.w / 2 - 10) + 'px';
            this.exclamation.style.top = (slime.y - 40) + 'px';
            return false; // Chưa chiếm quyền điều khiển Sui hoàn toàn
        }

        // 2. Sui di chuyển đến cạnh hộp quà
        if (this.state === 'MOVING_TO_PRESENT') {
            if (this.present && document.body.contains(this.present)) {
                const rect = this.present.getBoundingClientRect();
                let targetX = slime.targetPresentSide === 'left' ? rect.left - slime.w + 40 : rect.right - 40;
                
                // Giới hạn targetX trong màn hình để Sui không bị kẹt ở cạnh
                targetX = Math.max(0, Math.min(window.innerWidth - slime.w, targetX));
                
                const dist = targetX - slime.x;

                if (Math.abs(dist) < 10) {
                    this.state = 'PUSHING_PRESENT';
                    slime.vx = 0;
                } else {
                    slime.facingRight = dist > 0;
                    slime.vx = slime.facingRight ? 4 : -4;
                }
            } else {
                this.state = 'FINISHED';
                EventManager.onEventFinished(this);
            }
            
            if (slime.facingRight) slimeEl.classList.remove('flipped');
            else slimeEl.classList.add('flipped');
            return true; // Chiếm quyền điều khiển Sui
        }

        // 3. Sui đẩy hộp quà vào giữa
        if (this.state === 'PUSHING_PRESENT') {
            if (this.present && document.body.contains(this.present)) {
                const centerX = window.innerWidth / 2;
                const rect = this.present.getBoundingClientRect();
                const presentCenter = rect.left + rect.width / 2;
                const distToCenter = centerX - presentCenter;

                if (Math.abs(distToCenter) < 10) {
                    this.state = 'OPENING_PRESENT';
                    slime.vx = 0;
                    
                    // Bắt đầu hiệu ứng mở quà (rung lắc + lớn dần)
                    this.present.classList.add('present-opening');
                    if (typeof spawnEmote === 'function') spawnEmote('❓');

                    setTimeout(() => {
                        if (this.present) {
                            this.present.src = 'assets/OpenPresent.svg';
                            this.present.classList.remove('present-opening');
                            this.present.classList.add('present-opened');
                            
                            // Xuất hiện bức ảnh từ bên trong hộp quà
                            this.showBirthdayPhoto();
                        }
                        if (typeof spawnEmote === 'function') spawnEmote('✨');
                        if (typeof spawnHearts === 'function') spawnHearts();
                    }, 2000);
                } else {
                    slime.facingRight = distToCenter > 0;
                    slime.vx = slime.facingRight ? 2 : -2;
                    const currentLeft = parseFloat(this.present.style.left) || rect.left;
                    this.present.style.left = (currentLeft + slime.vx) + 'px';
                }
            } else {
                this.state = 'FINISHED';
                EventManager.onEventFinished(this);
            }

            if (slime.facingRight) slimeEl.classList.remove('flipped');
            else slimeEl.classList.add('flipped');
            return true; // Chiếm quyền điều khiển Sui
        }

        // 4. Chờ hộp quà mở
        if (this.state === 'OPENING_PRESENT') {
            slime.vx = 0;
            if (this.present) {
                const rect = this.present.getBoundingClientRect();
                slime.facingRight = (rect.left + rect.width / 2) > slime.x;
            }
            if (slime.facingRight) slimeEl.classList.remove('flipped');
            else slimeEl.classList.add('flipped');
            return true;
        }

        return false;
    },

    showBirthdayPhoto() {
        const photoSrc = 'assets/HappyBirthDayMum.png';
        
        // Tạo overlay
        const overlay = document.createElement('div');
        overlay.id = 'birthday-overlay';
        overlay.className = 'interactive'; // Thêm class interactive
        document.body.appendChild(overlay);
        
        // Tạo ảnh
        const photo = document.createElement('img');
        photo.src = photoSrc;
        photo.className = 'birthday-photo photo-hidden interactive'; // Thêm class interactive
        
        // Áp dụng logic hover để Electron không bỏ qua sự kiện chuột
        if (typeof applyHoverLogic === 'function') {
            applyHoverLogic(overlay);
            applyHoverLogic(photo);
        }

        // Vị trí ban đầu: tại hộp quà, thu nhỏ
        const rect = this.present.getBoundingClientRect();
        photo.style.left = (rect.left + rect.width / 2) + 'px';
        photo.style.top = (rect.top + 10) + 'px'; // Xuất hiện từ phía trên hộp quà một chút
        photo.style.width = '20px';
        photo.style.height = 'auto';
        photo.style.transform = 'translate(-50%, -50%)';
        
        document.body.appendChild(photo);
        
        // Tạo dàn nến
        const candleContainer = document.createElement('div');
        candleContainer.className = 'candle-container';
        for (let i = 0; i < 15; i++) {
            const candle = document.createElement('div');
            candle.className = 'candle';
            const flame = document.createElement('div');
            flame.className = 'flame';
            candle.appendChild(flame);
            candleContainer.appendChild(candle);
        }
        document.body.appendChild(candleContainer);

        // Kích hoạt animation
        setTimeout(() => {
            // Đảm bảo cửa sổ nhận diện sự kiện chuột khi hiện ảnh
            if (typeof ipcRenderer !== 'undefined') {
                ipcRenderer.send('set-ignore-mouse-events', false);
            }
            
            overlay.classList.add('show');
            photo.classList.remove('photo-hidden');
            
            // Di chuyển ra giữa màn hình và lớn dần
            photo.style.left = '50%';
            photo.style.top = '50%';
            photo.style.width = '600px'; // Kích thước đích

            // Sau khi ảnh ra giữa thì bắt đầu tối nền, hiện nến và phát nhạc
            setTimeout(() => {
                overlay.classList.add('dimmer');
                candleContainer.classList.add('show');
                
                // Phát nhạc
                let audio;
                if (typeof AudioManager !== 'undefined') {
                    audio = AudioManager.playPreloadedMusic('birthday_song');
                    if (!audio) {
                        audio = new Audio('assets/audio/music/Happy Birthday To You.mp3');
                        audio.play().catch(err => console.error("Không thể phát nhạc:", err));
                    }
                } else {
                    audio = new Audio('assets/audio/music/Happy Birthday To You.mp3');
                    audio.play().catch(err => console.error("Không thể phát nhạc:", err));
                }
                
                if (audio) {
                    audio.onended = () => {
                        // Khi nhạc kết thúc: sáng nền, ẩn nến và bắn pháo hoa
                        overlay.classList.remove('dimmer');
                        candleContainer.classList.remove('show');
                        setTimeout(() => candleContainer.remove(), 1000);
                        
                        this.fireConfetti();
                    };
                }
            }, 800); // Đợi ảnh di chuyển xong
        }, 100);

        // Đóng khi nhấp đúp vào overlay (vị trí bất kì ngoài bức ảnh)
        let lastClickTime = 0;
        overlay.addEventListener('click', () => {
            const currentTime = new Date().getTime();
            const clickDelay = currentTime - lastClickTime;
            
            if (clickDelay < 300 && clickDelay > 0) {
                // Double click: Đóng ảnh
                this.closeBirthdayPhoto(photo, overlay);
                // Ẩn thông báo ngay lập tức nếu đang hiện
                const notification = document.getElementById('birthday-notification');
                if (notification) notification.classList.remove('show');
            } else {
                // Single click: Hiện thông báo
                this.showNotification("Nhấp đúp chuột vào vùng bên ngoài để đóng ảnh");
            }
            lastClickTime = currentTime;
        });
    },

    showNotification(message) {
        let notification = document.getElementById('birthday-notification');
        if (!notification) {
            notification = document.createElement('div');
            notification.id = 'birthday-notification';
            notification.className = 'birthday-notification';
            document.body.appendChild(notification);
        }
        
        notification.innerHTML = `<span class="notification-icon">💡</span> <span>${message}</span>`;
        notification.classList.add('show');
        
        if (this.notificationTimer) clearTimeout(this.notificationTimer);
        this.notificationTimer = setTimeout(() => {
            notification.classList.remove('show');
        }, 3000);
    },

    closeBirthdayPhoto(photo, overlay) {
        overlay.classList.remove('show');
        photo.classList.add('photo-closing');
        
        const suiRect = slimeEl.getBoundingClientRect();
        const targetX = (suiRect.left + suiRect.width / 2) + 'px';
        const targetY = (suiRect.top + suiRect.height / 2) + 'px';

        // 1. Thu nhỏ ảnh và đi vào bên trong bé Sui
        photo.style.left = targetX;
        photo.style.top = targetY;
        photo.style.width = '10px';
        photo.style.opacity = '0';

        // 2. Thu nhỏ hộp quà và đi vào bên trong bé Sui
        if (this.present) {
            this.present.style.transition = 'all 0.6s cubic-bezier(0.5, 0, 0.75, 0)';
            this.present.style.left = targetX;
            this.present.style.top = targetY;
            this.present.style.scale = '0.05';
            this.present.style.opacity = '0';
            this.present.style.pointerEvents = 'none';
        }

        setTimeout(() => {
            photo.remove();
            overlay.remove();
            if (this.present) {
                this.present.remove();
                this.present = null;
            }
            this.state = 'FINISHED';
            EventManager.onEventFinished(this);
            if (typeof spawnEmote === 'function') spawnEmote('❤️');
            
            // Khôi phục lại trạng thái ignore mouse events
            if (typeof ipcRenderer !== 'undefined') {
                ipcRenderer.send('set-ignore-mouse-events', true, { forward: true });
            }
        }, 600);
    },

    fireConfetti() {
        const colors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff', '#ffffff', '#ff9900', '#ff66b2', '#ccff00'];
        
        // 1. Pháo bắn từ 2 bên (dưới góc màn hình)
        for (let i = 0; i < 40; i++) {
            setTimeout(() => this.createParticle(colors, 'left'), Math.random() * 500);
            setTimeout(() => this.createParticle(colors, 'right'), Math.random() * 500);
        }
        
        // 2. Ruy băng rơi từ trên cao xuống (liên tục trong một khoảng thời gian)
        let ribbonCount = 0;
        const ribbonInterval = setInterval(() => {
            this.createRibbon(colors);
            ribbonCount++;
            if (ribbonCount > 40) clearInterval(ribbonInterval);
        }, 150);
        
        // 3. Confetti rơi từ trên cao
        for (let i = 0; i < 60; i++) {
            setTimeout(() => this.createParticle(colors, 'top'), Math.random() * 2000);
        }
    },

    createParticle(colors, type) {
        const p = document.createElement('div');
        p.className = 'confetti';
        p.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
        
        // Kích thước ngẫu nhiên
        const size = 5 + Math.random() * 10;
        p.style.width = size + 'px';
        p.style.height = (size * (0.6 + Math.random() * 0.8)) + 'px';
        
        if (type === 'left') {
            p.style.animation = `confettiShotLeft ${1.5 + Math.random() * 1.5}s ease-out forwards`;
        } else if (type === 'right') {
            p.style.animation = `confettiShotRight ${1.5 + Math.random() * 1.5}s ease-out forwards`;
        } else {
            p.style.left = Math.random() * 100 + 'vw';
            p.style.top = '-10vh';
            p.style.animation = `confettiFall ${4 + Math.random() * 4}s linear forwards`;
        }
        
        document.body.appendChild(p);
        p.addEventListener('animationend', () => p.remove(), { once: true });
    },

    createRibbon(colors) {
        const r = document.createElement('div');
        r.className = 'ribbon';
        r.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
        r.style.left = Math.random() * 100 + 'vw';
        
        // Độ dài ngẫu nhiên
        r.style.height = (20 + Math.random() * 40) + 'px';
        
        const fallDuration = 5 + Math.random() * 4;
        const swayDuration = 2 + Math.random() * 2;
        r.style.animation = `ribbonFall ${fallDuration}s linear forwards, ribbonSway ${swayDuration}s ease-in-out infinite`;
        
        document.body.appendChild(r);
        r.addEventListener('animationend', () => r.remove(), { once: true });
    }
};

// Đăng ký sự kiện vào hệ thống
if (typeof EventManager !== 'undefined') {
    EventManager.register(BirthdayEvent);
}
