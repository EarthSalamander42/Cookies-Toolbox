const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const readdirp = require('readdirp');

const file_blacklist = [
	'soundevents_soundscapes_core.vsndevts',
	'testkv3_soundevents_diagnostics.vsndevts',
];
const configPath = path.join(app.getPath('userData'), 'config.json');
let mainWindow;
let promptWindow;

function sendConfigError() {
	dialog.showErrorBox('Invalid Repository', 'The repository path is not valid. Please make sure the path is correct and the repository has the necessary files. The directory must contain a file called "steam.inf".');
}

async function readConfig() {
	try {
		return JSON.parse(await fs.readFile(configPath, 'utf-8'));
	} catch (error) {
		console.error('Error reading config file:', error);
		return {};
	}
}

async function isRepositoryPathConfigured() {
	const config = await readConfig();

	// console.log('repositoryPath:', config.repositoryPath);
	return !!config.repositoryPath;
}

async function saveRepositoryPath(repoPath) {
	try {
		const isValid = await isRepoPathValid(repoPath);
		// console.log('Repository path is valid:', isValid);

		if (!isValid) {
			sendConfigError();
			return;
		}

		const config = {
			repositoryPath: repoPath
		};

		await fs.writeFile(configPath, JSON.stringify(config, null, 2));
		console.log('Repository path saved to configuration.');

		generateKeyValues();
	} catch (error) {
		sendConfigError();
		console.error('Error while saving repository path:', error);
	}
}

async function isRepoPathValid(repoPath) {
	try {
		const infFilePath = path.join(repoPath, 'steam.inf');
		const data = await fs.readFile(infFilePath, 'utf-8');
		const lines = data.split('\n');
		const appIDLine = lines.find(line => line.startsWith('appID'));
		if (!appIDLine) return false;
		const appID = appIDLine.split('=')[1].trim();

		return appID === '570';
	} catch (error) {
		console.error('Error occurred while checking repository path validity:', error);
		return false;
	}
}

ipcMain.on('save-repo-path', (event, repoPath) => {
	console.log('Received repository path:', repoPath);
	saveRepositoryPath(repoPath);
});

function createPromptWindow() {
	promptWindow = new BrowserWindow({
		width: 800,
		height: 400,
		parent: mainWindow,
		modal: true,
		show: false,
		icon: path.join(__dirname, 'images/frostrose.png'),
		webPreferences: {
			contextIsolation: true,
			preload: path.join(__dirname, 'preload.js')
		}
	});

	promptWindow.loadURL(`file://${path.join(__dirname, 'prompt.html')}`);

	promptWindow.once('ready-to-show', () => {
		promptWindow.show();
	});
}

function extractVSNDData(data) {
	const lines = data.split('\n');
	const keyValuePairs = {};
	let key = '';
	let bracketCount = 0;

	for (let line of lines) {
		// remove comments
		line = line.trim();

		// skip empty lines
		if (line.length === 0) {
			continue;
		}

		// skip special lines
		if (line.startsWith('<!--')) {
			continue;
		}

		// count brackets
		for (let i = 0; i < line.length; i++) {
			if (line[i] === '{') {
				bracketCount++;
			} else if (line[i] === '}') {
				bracketCount--;
			}
		}

		// Create keyvalue pairs
		if (bracketCount === 1 && line.includes('=')) {
			key = line.split('=')[0].trim();
			keyValuePairs[key] = { vsnd_files: [] };
		// Add vsnd files to keyvalue pairs
		} else if (line.startsWith('"') && line.endsWith('.vsnd",') || line.endsWith('.vsnd"')) {
			if (line.endsWith(",")) {
				line = line.slice(1, -2);
			}

			if (line.endsWith('"')) { 
				line = line.slice(0, -1);
			}
			
			if (line.startsWith('vsnd_files = "')) {
				line = line.slice(14);
			}

			keyValuePairs[key].vsnd_files.push(line);
		}
	}

	return keyValuePairs;
}

async function createMainWindow() {
	mainWindow = new BrowserWindow({
		width: 1000,
		height: 600,
		icon: path.join(__dirname, 'images/frostrose.png'),
		webPreferences: {
			contextIsolation: true,
			preload: path.join(__dirname, 'preload.js')
		}
	});

	mainWindow.loadFile('index.html');

	if (promptWindow) {
		promptWindow.close();
	}
}

async function createConfigFileIfNotExists() {
	try {
		await fs.access(configPath);
	} catch (error) {
		if (error.code === 'ENOENT') {
			try {
				await fs.writeFile(configPath, JSON.stringify({}));
				console.log('Config file created.');
			} catch (error) {
				console.error('Error creating config file:', error);
			}
		}
	}
}

async function generateKeyValues() {
	console.log('Generate keyvalues script started.');
	const config = await readConfig();

	if (!config.repositoryPath) {
		sendConfigError();
		console.error('Repository path not configured.');
		return;
	}

	const repositoryPath = config.repositoryPath;
	const isValid = await isRepoPathValid(repositoryPath);

	if (!isValid) {
		sendConfigError();
		console.error('Repository path is invalid:', repositoryPath);
		return;
	}

	let startTime = new Date().getTime();

	await fs.writeFile('keyvalues.json', '{\n');

	try {
		const files = await readdirp.promise(repositoryPath, { fileFilter: '*.vsndevts' });
		console.log(`Found ${files.length} .vsndevts files.`);

		for (const file of files) {
			if (file_blacklist.includes(file.basename)) {
				// console.log(`Skipping file ${file.basename}...`);
				continue;
			}

			const filePath = path.join(repositoryPath, file.path);
			// console.log(`Reading file ${filePath}...`);

			try {
				const data = await fs.readFile(filePath, 'utf8');
				const keyValuePairs = extractVSNDData(data);
				let jsonData = JSON.stringify(keyValuePairs, null, 2);

				// console.log(`Writing file ${filePath}...`);

				// delete first and last line
				let lines = jsonData.split('\n');
				lines.shift();
				lines.pop();

				// add comma to last line
				lines[lines.length - 1] += ',';
				jsonData = lines.join('\n');

				await fs.appendFile('keyvalues.json', jsonData + '\n');
			} catch (error) {
				console.error(`Error while processing file ${filePath}:`, error);
			}
		}

		// delete last comma
		await fs.truncate('keyvalues.json', (await fs.stat('keyvalues.json')).size - 2);

		const endTime = new Date().getTime();
		const timeDiff = endTime - startTime;
		const timeDiffSeconds = timeDiff / 1000;
		const timeDiffSecondsRounded = timeDiffSeconds.toFixed(2);

		console.log(`Reading all files took ${timeDiffSecondsRounded} seconds.`);
	} catch (error) {
		sendConfigError();
		console.error('Error occurred during file reading:', error);
	}

	await fs.appendFile('keyvalues.json', '\n}');
	createMainWindow();
}

app.whenReady().then(async () => {
	await createConfigFileIfNotExists();
	const has_config = await isRepositoryPathConfigured();

	if (has_config) {
		generateKeyValues();
	} else {
		createPromptWindow();
	}
});

app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') {
		app.quit();
	}
});

app.on('activate', async () => {
	if (BrowserWindow.getAllWindows().length === 0) {
		const has_config = await isRepositoryPathConfigured();

		if (has_config) {
			generateKeyValues();
		} else {
			createPromptWindow();
		}
	}
});
