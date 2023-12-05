const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
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
		icon: path.join(__dirname, '../images/frostrose.png'),
		webPreferences: {
			contextIsolation: true,
			preload: path.join(__dirname, 'preload.js')
		}
	});

	promptWindow.loadURL(`file://${path.join(__dirname, 'prompt.html')}`);

	// Open links in default browser
	promptWindow.webContents.setWindowOpenHandler(({ url }) => {
		shell.openExternal(url);
		return { action: 'deny' };
	});

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
		icon: path.join(__dirname, '../images/frostrose.png'),
		webPreferences: {
			contextIsolation: true,
			nativewindowopen: true,
			preload: path.join(__dirname, 'preload.js')
		}
	});

	mainWindow.loadFile('src/index.html');

	mainWindow.webContents.setWindowOpenHandler(({ url }) => {
		shell.openExternal(url);
		return { action: 'deny' };
	});

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

async function generateItemKeyValues() {
	console.log('Generate item keyvalues script started.');
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

	await fs.writeFile('item_keyvalues.json', '\n');

	try {
		// read a items_game.txt and extract the item ID given a part of the item name
		const items_game_path = path.join(repositoryPath, 'scripts/items/items_game.txt');
		const items_game_data = await fs.readFile(items_game_path, 'utf8');
		console.log(`Reading file items_game.txt...`);
		const lines = items_game_data.split('\n');
		const itemIDs = {};

		for (const line of lines) {
			if (line.startsWith('	"')) {
				const category = line.split('"')[1];

				if (category === 'items') {
					for (let i = 0; i < lines.length; i++) {
						if (lines[i].startsWith('		"')) {
							const itemID = lines[i].replace(/[\t"]/g, '');

							// console.log(itemID);
							// console.log(parseInt(itemID));
							if (parseInt(itemID) > 0) {
								// console.log(`Found item ID ${itemID}`);
								// itemName should be 2 lines below itemID
								const itemName = lines[i + 2];

								// Use a regular expression to match values inside double quotation marks
								let matches = itemName.match(/"([^"]*)"/g);

								// Extract the two values
								if (matches && matches.length === 2) {
									// Assuming there are two matches
									let firstValue = matches[0].replace(/"/g, '');
									let secondValue = matches[1].replace(/"/g, '');
									
									if (firstValue && firstValue == "name") {
										// console.log("First Value:", firstValue);
										// console.log("Second Value:", secondValue);

										itemIDs[itemID] = secondValue;
									}
								} else {
									console.log("No matches found.");
								}
							}
						}
					}
				}
			}
		}

		const endTime = new Date().getTime();
		const timeDiff = endTime - startTime;
		const timeDiffSeconds = timeDiff / 1000;
		const timeDiffSecondsRounded = timeDiffSeconds.toFixed(2);

		const cleanedJSON = {};

		for (const key in itemIDs) {
			const cleanedKey = key.replace(/\r/g, '');
			cleanedJSON[cleanedKey] = itemIDs[key];
		}

		// Now write the itemIDs to a json file
		console.log(`Writing item IDs to item_keyvalues.json...`);
		await fs.appendFile('item_keyvalues.json', JSON.stringify(cleanedJSON, null, 2) + '\n');

		console.log(`Reading all files took ${timeDiffSecondsRounded} seconds.`);
	} catch (error) {
		console.error('Error occurred while reading items_game.txt:', error);
	}


}

app.whenReady().then(async () => {
	await createConfigFileIfNotExists();
	const has_config = await isRepositoryPathConfigured();

	if (has_config) {
		generateKeyValues();
		generateItemKeyValues();
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
