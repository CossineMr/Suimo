/**
 * AIService - Xử lý giao tiếp với AI (Gemini) để thẩm định và lập kế hoạch
 */
const AIService = {
    apiKey: '', // Để trống, người dùng có thể nhập key thật vào đây sau
    isSimulated: true, // Chạy chế độ mô phỏng nếu chưa có key

    async validateTask(description, files) {
        console.log('[AIService] Bắt đầu thẩm định:', description);
        
        if (this.isSimulated || !this.apiKey) {
            return this.simulateValidation(description, files);
        }

        // TODO: Kết nối Gemini API thật ở đây
        // const genAI = new GoogleGenerativeAI(this.apiKey);
        // ...
    },

    async generatePlan(description) {
        console.log('[AIService] Bắt đầu lập kế hoạch cho:', description);
        
        if (this.isSimulated || !this.apiKey) {
            return this.simulatePlanning(description);
        }

        // TODO: Kết nối Gemini API thật ở đây
        // Yêu cầu AI trả về định dạng JSON
    },

    // --- MÔ PHỎNG (SIMULATION) ---

    simulateValidation(description, files) {
        return new Promise((resolve) => {
            setTimeout(() => {
                const len = description.length;
                let response = '';
                
                if (len < 20 && files.length === 0) {
                    response = "Mô tả này ngắn quá, Sui thấy chưa đủ thông tin. Bạn có thể nói rõ hơn hoặc gửi thêm file/ảnh để Sui đánh giá khối lượng công việc không?";
                } else if (files.length > 0) {
                    response = `Sui đã nhận được ${files.length} tệp tin. Có vẻ đây là một nhiệm vụ khá "khoai" đấy! Sui đã phân tích xong và sẵn sàng lên kế hoạch giúp bạn.`;
                } else {
                    response = "Sui đã hiểu mục tiêu của bạn. Công việc này đòi hỏi sự tập trung nhất định. Hãy nhấn 'Lập kế hoạch' để xem lộ trình Sui đề xuất nhé!";
                }
                
                const isReady = len >= 20 || files.length > 0;
                resolve({ message: response, isReady: isReady });
            }, 1500); // Giả lập độ trễ mạng
        });
    },

    simulatePlanning(description) {
        return new Promise((resolve) => {
            setTimeout(() => {
                // Phân tích độ dài mô tả để tạo timeline giả lập
                const isComplex = description.length > 50;
                
                let plan = [];
                if (isComplex) {
                    plan = [
                        { type: 'work', label: 'Tập trung cao độ - Phần 1', duration: 45, eventName: null },
                        { type: 'break', label: 'Giải lao & Thư giãn mắt', duration: 10, eventName: 'none' },
                        { type: 'work', label: 'Tập trung cao độ - Phần 2', duration: 45, eventName: null },
                        { type: 'break', label: 'Giải lao giữa giờ', duration: 15, eventName: 'none' },
                        { type: 'work', label: 'Hoàn thiện & Tổng kết', duration: 30, eventName: null }
                    ];
                } else {
                    plan = [
                        { type: 'work', label: 'Xử lý công việc', duration: 30, eventName: null },
                        { type: 'break', label: 'Nghỉ ngơi ngắn', duration: 5, eventName: 'none' },
                        { type: 'work', label: 'Hoàn thành', duration: 25, eventName: null }
                    ];
                }
                
                resolve(plan);
            }, 2000);
        });
    }
};

// Expose để dùng global
window.AIService = AIService;
