const { ipcRenderer } = require('electron');

// Fonction pour envoyer le chemin du référentiel au processus principal
function sendRepositoryPath(repoPath) {
	console.log('[renderer.js] - Sending repository path:', repoPath);
    ipcRenderer.send('save-repo-path', repoPath);
}

// Vous pouvez ajouter d'autres fonctionnalités ici liées à l'interface utilisateur

// Exemple de manipulation du DOM
document.getElementById('saveButton').addEventListener('click', () => {
	console.log('[renderer.js] - Save button clicked');
    const repoPath = document.getElementById('repoPathInput').value;
    sendRepositoryPath(repoPath);
});
