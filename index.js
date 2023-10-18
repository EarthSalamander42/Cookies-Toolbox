const electron = require('electron');
const { app, BrowserWindow, ipcMain } = electron;
const path = require('path');
const fs = require('fs').promises;
const readdirp = require('readdirp');

const file_blacklist = [
	'soundevents_soundscapes_core.vsndevts',
	'testkv3_soundevents_diagnostics.vsndevts',
];
let mainWindow;
let promptWindow;
const configPath = path.join(app.getPath('userData'), 'config.json');

async function readConfig() {
  try {
    const data = await fs.readFile(configPath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading config file:', error);
    return {};
  }
}

async function isRepositoryPathConfigured() {
  const config = await readConfig();
  return !!config.repositoryPath;
}

async function saveRepositoryPath(repoPath) {
    try {
        const config = {
            repositoryPath: repoPath
        };
        await fs.writeFile(configPath, JSON.stringify(config, null, 2));
        console.log('Repository path saved to configuration.');
    } catch (error) {
        console.error('Error while saving repository path:', error);
    }
}

function createPromptWindow() {
  promptWindow = new BrowserWindow({
    width: 800,
    height: 400,
    parent: mainWindow,
    modal: true,
    show: false,
    icon: path.join(__dirname, 'images/frostrose.png'), // Spécifiez le chemin de votre icône ici
    webPreferences: {
      nodeIntegration: true
    }
  });

  promptWindow.loadURL(`file://${path.join(__dirname, 'prompt.html')}`);

  promptWindow.once('ready-to-show', () => {
    promptWindow.show();
  });

  promptWindow.webContents.on('did-finish-load', () => {
        const pathToSend = path.toString(); // convertir l'objet en chaîne de caractères
        promptWindow.webContents.send('repository-path', pathToSend);
    });

  ipcMain.on('repository-path', (event, path) => {
	console.log('Received repository path:', path);
    // Stockez le chemin du référentiel dans la configuration ou la base de données locale ici
    // Fermez la fenêtre contextuelle ici
    promptWindow.close();
    // Continuez avec le chargement de l'application ici
    createMainWindow();
  });
}

ipcMain.on('save-repo-path', (event, repoPath) => {
	console.log('Received repository path:', repoPath);
    saveRepositoryPath(repoPath);
});

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

			// fail-safe
			keyValuePairs[key].vsnd_files.push(line);
		}
	}

	return keyValuePairs;
}

async function createMainWindow() {
	console.log('Generate keyvalues script started.');

	const directoryPath = path.join(__dirname, '../dota_vpk_updates/soundevents/');
	let startTime = new Date().getTime();

	await fs.writeFile('keyvalues.json', '{\n');

	try {
		const files = await readdirp.promise(directoryPath, { fileFilter: '*.vsndevts' });

		console.log(`Found ${files.length} .vsndevts files.`);

		for (const file of files) {
			if (file_blacklist.includes(file.basename)) {
				// console.log(`Skipping file ${file.basename}...`);
				continue;
			}

			const filePath = path.join(directoryPath, file.path);
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
		console.error('Error occurred during file reading:', error);
	}

	await fs.appendFile('keyvalues.json', '\n}');

	mainWindow = new BrowserWindow({
		width: 1000,
		height: 600,
        icon: path.join(__dirname, 'images/frostrose.png'), // Spécifiez le chemin de votre icône ici
		webPreferences: {
			nodeIntegration: true
		}
	});

	mainWindow.loadFile('index.html');
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

app.whenReady().then(async () => {
  await createConfigFileIfNotExists();
  const has_config = await isRepositoryPathConfigured();
  console.log('App is ready, path configured:', has_config);

  if (has_config) {
    createMainWindow();
  } else {
    createPromptWindow();
  }
});

app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') {
		app.quit();
	}
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    if (isRepositoryPathConfigured()) {
      createMainWindow();
    } else {
      createPromptWindow();
    }
  }
});