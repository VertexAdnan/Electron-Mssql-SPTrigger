const { app, BrowserWindow, ipcMain } = require('electron')
const sql = require('mssql')
const fs = require('fs')
const path = require('path')

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

// Stored Procedure tetikleme ve 10 saniye bekleme fonksiyonu
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

      // Her stored procedure'den sonra 10 saniye bekle
      await new Promise(resolve => setTimeout(resolve, 10000));
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

// Veritabanı gruplarını sıralı şekilde tetikleyen fonksiyon
async function triggerAllGroupsForDB (db) {
  const groups = Object.keys(
    spConfigs.find(sp => sp.name === db.name).procedures
  )

  // Her bir grup sırayla çalıştırılıyor
  for (const group of groups) {
    if (isCanceled) break;
    await triggerStoredProcedureGroup(db, group);
  }
}

const triggerDB = () => {
  isCanceled = false

  Promise.all(dbConfigs.map(async db => {
    await triggerAllGroupsForDB(db)
  }))
  .then(() => {
    console.log('All procedures executed.')
    logMessage('All procedures executed.')
  })
  .catch(err => console.error('Error executing procedures:', err))
}

ipcMain.on('get-databases', (event) => {
    const dbNames = dbConfigs.map(db => db.name);
    event.reply('databases-list', dbNames);
});

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
