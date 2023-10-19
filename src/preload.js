const { contextBridge, ipcRenderer, shell } = require('electron');

contextBridge.exposeInMainWorld('electron', {
    send: (channel, data) => {
        // Whitelisted channels can be sent from the preload to the main process
        let validChannels = ['save-repo-path'];

        if (validChannels.includes(channel)) {
            ipcRenderer.send(channel, data);
        }
    }
});
