// ==== HÀNH VI SỰ KIỆN SINH NHẬT MẸ TÔI ====

const BirthdayEvent = {
    name: 'Sự kiện Sinh nhật',
    state: 'WAITING', // WAITING, MARK_SHOWN, FALLING, LANDED, MOVING_TO_PRESENT, PUSHING_PRESENT, FINISHED
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
        const randomX = Math.random() * (window.innerWidth - 170) + 10;
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
                    this.state = 'FINISHED';
                    slime.vx = 0;
                    spawnEmote('✨');
                    spawnHearts();
                    EventManager.onEventFinished(this);
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

        return false;
    }
};

// Đăng ký sự kiện vào hệ thống
if (typeof EventManager !== 'undefined') {
    EventManager.register(BirthdayEvent);
}
