document.getElementById('saveButton').addEventListener('click', () => {
    const repoPath = document.getElementById('repoPathInput').value;

	console.log('[renderer.js] - Sending repository path:', repoPath);
    window.electron.send('save-repo-path', repoPath);
});
