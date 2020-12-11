const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const arch = require('arch');
const os = require('os');
const fs = require('fs');
const logging = require('./logging');
const bootstrap = require('./bootstrap');
const speedometer = require('./speedometer');
const updater = require('./updater');

process.on("uncaughtException", err => {
    const stack = err.stack ? err.stack : `${err.name}: ${err.message}`;
    logging.log('ERROR', 'Unerwarteter Fehler:\n' + stack);
    dialog.showErrorBox(
        'Ein unerwarteter Fehler ist aufgetreten',
        'Bei der Ausführung des MyFTBLaunchers ist ein Fehler aufgetreten.'
            + '\nBitte versuche es erneut oder wende dich bei häufigerem Auftreten an den Support mit der folgenden Fehlermeldung:'
            + '\n\n' + stack
    );
    process.exit(1);
});

logging.init(path.join(os.homedir(), 'myftblauncher-bootstrap.log'));
const dir = (process.env.APPDATA || (process.platform == 'darwin' ? process.env.HOME + '/Library/Application Support' : process.env.HOME + "/.local/share")) + '/MyFTBLauncher';
logging.log('INFO', 'Launcher-Version: ' + app.getVersion());
logging.log('INFO', '    NodeJS-Version: ' + process.versions.node);
logging.log('INFO', '    Electron-Version: ' + process.versions.electron);
logging.log('INFO', '    Chrome-Version: ' + process.versions.chrome);
logging.log('INFO', 'Ausführverzeichnis: ' + __dirname);
logging.log('INFO', 'Launcherverzeichnis: ' + dir);

let mainWindow;
let config = {};

try {
    let configFilePath = path.join(os.homedir(), 'myftblauncher-config.json');
    if (fs.existsSync(configFilePath)) {
        config = JSON.parse(fs.readFileSync(configFilePath));
    }
} catch (e) {
    logging.log('ERROR', 'Fehler beim Einlesen der Konfigurationsdatei: ' + e)
}

function createWindow () {
    mainWindow = new BrowserWindow({
        width: 320,
        height: 480,
        frame: false,
        transparent: true,
        webPreferences: {
            nodeIntegration: false,
            preload: path.join(__dirname, 'public', 'preload.js'),
            enableRemoteModule: true
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
    logging.log('FATAL', text + ': ' + err);
    dialog.showMessageBox({
        type: 'error',
        title: 'MyFTB Launcher',
        message: text + '\nBitte versuche es erneut oder wende dich bei häufigerem Auftreten an den Support\n' + err
    }).then(() => app.exit(1));
}

function doIndex(index, baseDir, cb) {
    if ('channels' in config) {
        if (index in config['channels']) {
            logging.log('INFO', 'Verwende benutzerdefinierten Kanal ' + config['channels'][index] + ' für Index ' + index);
            index = config['channels'][index] + '_' + index;
        }
    }

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

    bootstrap.checkIndex('/' + index + '.json', baseDir, speed, (err, prom) => {
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
    doIndex('launcher-macos', dir, (err) => {
        if (err) {
            return showError('Die Integrität des Launchers konnte nicht überprüft werden', err);
        }

        let executable = path.join(dir, 'MyFTBLauncher.app', 'Contents', 'MacOS', 'MyFTBLauncher');
        logging.log('INFO', 'Starte Launcher: ' + executable);
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
    doIndex('launcher', dir, (err) => {
        if (err) {
            return showError('Die Integrität des Launchers konnte nicht überprüft werden', err);
        }

        updateProgress('Überprüfe Dateien', 'Java', 0);
        doIndex('jre-' + osStr, path.join(dir, 'runtime'), (err) => {
            if (err) {
                return showError('Die Integrität der Java Runtime Environment konnte nicht überprüft werden', err);
            }

            updateProgress('Überprüfe Dateien', 'JCEF', 0);
            doIndex('jcef-' + osStr, path.join(dir, 'jcef'), (err) => {
                if (err) {
                    return showError('Die Integrität des Chromium Embedded Framework konnte nicht überprüft werden', err);
                }
    
                let javaExecutable = path.join(dir, 'runtime', 'bin', 'java' + (os === 'windows' ? '.exe' : ''));
                let javaArgs = ['-XX:+UseG1GC', '-Djava.library.path=' + path.join(dir, 'jcef'), '-Dlauncher.app.path=' + process.argv[0], '-jar', path.join(dir, 'launcher.jar')];
                let processEnv = {};
                Object.assign(processEnv, process.env);
                processEnv.LD_LIBRARY_PATH = path.join(dir, 'runtime', 'lib', arch() === 'x64' ? 'amd64' : 'i386');
                logging.log('INFO', 'Starte Launcher: ' + javaExecutable + ' ' + javaArgs);
                spawn(
                    javaExecutable, javaArgs,
                    {cwd: dir, detached: true, env: processEnv}
                );
                app.quit();
            });
        });
    });
}

ipcMain.once('start', () => {
    logging.log('INFO', 'Überprüfe auf Bootstrapper-Updates');
    updateProgress('Überprüfe auf Updates', 'Launcher', 0);
    updater((err, status) => {
        if (err) {
            logging.log('ERROR', 'Fehler bei der Updateüberprüfung: ' + JSON.stringify(err));
        } else {
            logging.log('INFO', 'Updateüberprüfung abgeschlossen: ' + JSON.stringify(status.info));

            if (status.installer) {
                logging.log('INFO', 'State Launcher zum Abschluss von Update neu');
                status.installer();
                return;
            }
        }

        if (process.platform === 'darwin') {
            installApp();
        } else {
            install();
        }
    });
});