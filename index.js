const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const { autoUpdater } = require("electron-updater")
const { spawn } = require('child_process');
const path = require('path');
const arch = require('arch');
const bootstrap = require('./bootstrap/bootstrap');
const speedometer = require('./speedometer');

autoUpdater.checkForUpdatesAndNotify();

const dir = (process.env.APPDATA || (process.platform == 'darwin' ? process.env.HOME + '/Library/Application Support' : process.env.HOME + "/.local/share")) + '/MyFTBLauncher';

let mainWindow;

function createWindow () {
    mainWindow = new BrowserWindow({
        width: 320,
        height: 480,
        frame: false,
        transparent: true,
        webPreferences: {
            nodeIntegration: false,
            preload: path.join(__dirname, 'public', 'preload.js')
        }
    });
    mainWindow.loadURL('file://' + __dirname + '/public/index.html');
    //mainWindow.webContents.openDevTools();
    mainWindow.on('closed', () => mainWindow = null);
}
  
app.on('ready', createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
  
app.on('activate', () => {
    if (mainWindow === null) {
        createWindow();
    }
});

function updateProgress(title, subtitle, progress, speed) {
    if (mainWindow) {
        mainWindow.webContents.send('update-progress', title, subtitle, speed, progress);
    }
}

function showError(text, err) {
    dialog.showMessageBox({
        type: 'error',
        title: 'MyFTB Launcher',
        message: text + '\nBitte versuche es erneut oder wende dich bei häufigerem Auftreten an den Support\n' + err
    }, () => app.quit());
}

function doIndex(index, baseDir, cb) {
    let progress = 0;
    let speed = speedometer();
    let interval = setInterval(() => {
        let transferRate = (speed() / 1000000).toFixed(2);
        if (transferRate > 0) {
            updateProgress(false, false, false, transferRate + ' MB/s');
        }
    }, 500);
    interval.unref();

    updateProgress(false, false, false, 'reset');

    bootstrap.checkIndex(index, baseDir, speed, (err, prom) => {
        if (err) {
            console.error(err);
            return cb(err);
        }

        prom.then(val => {
            clearInterval(interval);
            cb(false);
        }).catch(err => {
            clearInterval(interval);
            cb(err);
        });
    }, length => () => {
        progress++;
        updateProgress(false, false, progress / length * 100);
    });
}

function installApp() {
    updateProgress('Überprüfe Dateien', 'Launcher', 0);
    doIndex('/launcher-macos.json', dir, (err) => {
        if (err) {
            return showError('Die Integrität des Launchers konnte nicht überprüft werden', err);
        }

        let executable = path.join(dir, 'MyFTBLauncher.app', 'Contents', 'MacOS', 'MyFTBLauncher');
        spawn(executable, [], {cwd: dir, detached: true});
        app.quit();
    });
}

function install() {
    let os = 'linux';
    if (process.platform === 'win32') {
        os = 'windows';
    }

    let osStr = os + (arch() === 'x64' ? '-x64': '');

    updateProgress('Überprüfe Dateien', 'Launcher', 0);
    doIndex('/launcher.json', dir, (err) => {
        if (err) {
            return showError('Die Integrität des Launchers konnte nicht überprüft werden', err);
        }

        updateProgress('Überprüfe Dateien', 'Java', 0);
        doIndex('/jre-' + osStr + '.json', path.join(dir, 'runtime'), (err) => {
            if (err) {
                return showError('Die Integrität der Java Runtime Environment konnte nicht überprüft werden', err);
            }

            updateProgress('Überprüfe Dateien', 'JCEF', 0);
            doIndex('/jcef-' + osStr + '.json', path.join(dir, 'jcef'), (err) => {
                if (err) {
                    return showError('Die Integrität des Chromium Embedded Framework konnte nicht überprüft werden', err);
                }
    
                let javaExecutable = path.join(dir, 'runtime', 'bin', 'java' + (os === 'windows' ? '.exe' : ''));
                let processEnv = {};
                Object.assign(processEnv, process.env);
                processEnv.LD_LIBRARY_PATH = path.join(dir, 'runtime', 'lib', arch() === 'x64' ? 'amd64' : 'i386');
                spawn(
                    javaExecutable, ['-XX:+UseG1GC', '-Djava.library.path=' + path.join(dir, 'jcef'), '-Dlauncher.app.path=' + process.argv[0], '-jar', path.join(dir, 'launcher.jar')],
                    {cwd: dir, detached: true, env: processEnv}
                );
                app.quit();
            });
        });
    });
}

ipcMain.once('start', () => {
    if (process.platform === 'darwin') {
        installApp();
    } else {
        install();
    }
});