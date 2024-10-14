const { app, BrowserWindow, ipcMain } = require('electron')
const sql = require('mssql')
const fs = require('fs')
const path = require('path')

//require('electron-reload')(__dirname)

// app.disableHardwareAcceleration();

let mainWindow

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1024,
    height: 768,
    icon: 'images/logo.ico',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  })

  mainWindow.setMenu(null)
  mainWindow.loadFile('index.html')

  triggerDB()
}

app.whenReady().then(() => {
    initializeLogFile();
    logMessage('Uygulama başlatıldı.');
    createWindow();
})

const dbConfigPath = path.join(__dirname, 'dbconfig.json')
const dbConfigs = JSON.parse(fs.readFileSync(dbConfigPath, 'utf8')).databases

const spConfigPath = path.join(__dirname, 'storedProcedures.json')
const spConfigs = JSON.parse(fs.readFileSync(spConfigPath, 'utf8')).databases

let isCanceled = false

const logFilePath = path.join(__dirname, 'server-logs.txt');

async function triggerStoredProcedureGroup (db, group) {
  if (isCanceled) return

  const spConfig = spConfigs.find(sp => sp.name === db.name)
  const spGroup = spConfig.procedures[group]

  if (!spGroup) {
    mainWindow.webContents.send('sp-status', {
      db: db.name,
      tarih: getCurrentDateTime(),
      message: `Group ${group} not found.`
    })
    logMessage(`Group ${group} not found.`)
    return
  }

  try {
    const connection = await sql.connect(db.config)

    if(!connection) logMessage('connection failed: ', connection)

    for (const sp of spGroup.procedures) {
      if (isCanceled) break
      mainWindow.webContents.send('sp-status', {
        db: db.name,
        tarih: getCurrentDateTime(),
        message: `${sp} executing in group ${group}.`
      })
      logMessage(`${sp} executing in group ${group}.`)
      const result = await sql.query(`EXEC ${sp}`)
      mainWindow.webContents.send('sp-status', {
        db: db.name,
        tarih: getCurrentDateTime(),
        message: `${sp} executed in group ${group}.`
      })
      logMessage(`${sp} executed in group ${group}.`)

      mainWindow.webContents.send('sp-tarih', {
        db: db.name,
        tarih: getCurrentDateTime()
      })
    }
  } catch (err) {
    mainWindow.webContents.send('sp-status', {
      db: db.name,
      tarih: getCurrentDateTime(),
      message: `Error in group ${group}: ${err.message}`
    })
    logMessage(err.message);
  } finally {
    sql.close()
    const timeout = spConfig.procedures[group].timeout;
    setTimeout(() => triggerStoredProcedureGroup(db, group), timeout); // Timeout sonrası tekrar tetikle
  }
}

function initializeLogFile() {
    if (!fs.existsSync(logFilePath)) {
        fs.writeFileSync(logFilePath, ''); 
    } else {
        fs.truncateSync(logFilePath, 0);
    }
}

function logMessage(message) {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${message}\n`;

    fs.appendFile(logFilePath, logEntry, (err) => {
        if (err) {
            console.error('Log yazma hatası:', err);
        }
    });
}

function triggerAllGroupsForDB (db) {
  const groups = Object.keys(
    spConfigs.find(sp => sp.name === db.name).procedures
  )
  return Promise.all(
    groups.map(group => triggerStoredProcedureGroup(db, group))
  )
}

const triggerDB = () => {
  isCanceled = false

  Promise.all(dbConfigs.map(db => triggerAllGroupsForDB(db)))
    .then(() => {
      console.log('All procedures executed.')
      logMessage('All procedures executed.')

      // Her grup için interval belirle
      dbConfigs.forEach(db => {
        const groups = Object.keys(
          spConfigs.find(sp => sp.name === db.name).procedures
        )
        groups.forEach(group => {
          const timeout = spConfigs.find(sp => sp.name === db.name).procedures[group].timeout;
          setTimeout(() => {
            if (!isCanceled) {
              console.log(
                `Re-triggering group ${group} for database ${db.name}`
              )
              logMessage(`Re-triggering group ${group} for database ${db.name}`)
              triggerStoredProcedureGroup(db, group)
            }
          }, timeout)
        })
      })
    })
    .catch(err => console.error('Error executing procedures:', err))
}

ipcMain.on('get-databases', (event) => {
    const dbNames = dbConfigs.map(db => db.name);
    event.reply('databases-list', dbNames);
});

function getCurrentDateTime () {
  const now = new Date()

  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0') // Months are zero-based
  const day = String(now.getDate()).padStart(2, '0')
  const hours = String(now.getHours()).padStart(2, '0')
  const minutes = String(now.getMinutes()).padStart(2, '0')
  const seconds = String(now.getSeconds()).padStart(2, '0')

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
}

ipcMain.on('trigger-sp', () => {
  triggerDB()
})

ipcMain.on('cancel-sp', () => {
  isCanceled = true
})
