const { autoUpdater } = require("electron-updater");

function installAndRestart() {
    setImmediate(() => autoUpdater.quitAndInstall());
}

function check(cb) {
    if (process.platform === 'darwin') {
        return cb(false, {info: 'Überspringe Autoupdate unter macOS'});
    }

    autoUpdater.doCheckForUpdates()
        .then(result => {
            if (result.downloadPromise) {
                return result.downloadPromise
                    .then(result => cb(false, {info: result, installer: installAndRestart}))
                    .catch(err => cb(err));
            }

            return cb(false, {info: result});
        })
        .catch(err => cb(err));
}

module.exports = check;