const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    transparent: true,      // Nền tàng hình
    frame: false,           // Bỏ viền
    alwaysOnTop: true,      // Nổi lềnh phềnh
    skipTaskbar: true,      // Ẩn icon dưới taskbar cho giống pet
    type: 'toolbar',        // Giúp Windows nhận diện là tiện ích, dễ nằm dưới taskbar hơn
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.bounds;
  // Giảm 1 pixel chiều cao để tránh bị Windows coi là Fullscreen app (giúp taskbar đè lên được)
  mainWindow.setBounds({ x: 0, y: 0, width, height: height - 1 }); 
  
  mainWindow.setAlwaysOnTop(true, 'normal'); // Cấp độ normal thường nằm dưới Taskbar
  mainWindow.setIgnoreMouseEvents(true, { forward: true });

  mainWindow.loadFile('index.html');

  // Giao tiếp bật / tắt chế độ xuyên chuột
  ipcMain.on('set-ignore-mouse-events', (event, ignore, options) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if(win) win.setIgnoreMouseEvents(ignore, options);
  });

  ipcMain.on('quit-app', () => {
    app.quit();
  });

  // Cung cấp work area bottom (đỉnh của taskbar)
  const getFloor = () => {
    const { workArea } = screen.getPrimaryDisplay();
    // Nếu taskbar ở dưới: workArea.height là tọa độ đỉnh taskbar
    // Nếu taskbar ở trên: floor là đáy màn hình (y + height)
    // Tổng quát: floor là đáy của WorkArea
    return workArea.y + workArea.height;
  };

  ipcMain.handle('get-work-area-height', () => {
    return getFloor();
  });

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.send('work-area-height', getFloor());
  });

  // Quét tệp âm thanh
  ipcMain.handle('get-audio-files', async (event, folderType) => {
    const baseDir = path.join(__dirname, 'assets', 'audio', folderType);
    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true });
      return [];
    }
    try {
      const files = fs.readdirSync(baseDir);
      return files.filter(f => /\.(mp3|wav|ogg|m4a)$/i.test(f));
    } catch (err) {
      console.error(err);
      return [];
    }
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});
