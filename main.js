const { app, BrowserWindow, ipcMain } = require('electron')
const sql = require('mssql')
const fs = require('fs')
const path = require('path')

require('electron-reload')(__dirname)

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

app.whenReady().then(createWindow)

const dbConfigPath = path.join(__dirname, 'dbconfig.json')
const dbConfigs = JSON.parse(fs.readFileSync(dbConfigPath, 'utf8')).databases

const spConfigPath = path.join(__dirname, 'storedProcedures.json')
const spConfigs = JSON.parse(fs.readFileSync(spConfigPath, 'utf8')).databases

let isCanceled = false

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
    return
  }

  try {
    await sql.connect(db.config)
    for (const sp of spGroup.procedures) {
      // Change to access `procedures` array
      if (isCanceled) break
      mainWindow.webContents.send('sp-status', {
        db: db.name,
        tarih: getCurrentDateTime(),
        message: `${sp} executing in group ${group}.`
      })
      const result = await sql.query(`EXEC ${sp}`)
      mainWindow.webContents.send('sp-status', {
        db: db.name,
        tarih: getCurrentDateTime(),
        message: `${sp} executed in group ${group}.`
      })

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
  } finally {
    sql.close()
  }
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
  setInterval(() => {
    mainWindow.webContents.send('sp-status', {
      db: 'FIRAT',
      message: `TEST.`,
      tarih: getCurrentDateTime()
    })
  }, 1000)

  isCanceled = false

  Promise.all(dbConfigs.map(db => triggerAllGroupsForDB(db)))
    .then(() => {
      console.log('All procedures executed.')

      // Set up the timeout for each database group
      dbConfigs.forEach(db => {
        const groups = Object.keys(
          spConfigs.find(sp => sp.name === db.name).procedures
        )
        groups.forEach(group => {
          const timeout = spConfigs.find(sp => sp.name === db.name).procedures[
            group
          ].timeout
          setTimeout(() => {
            if (!isCanceled) {
              console.log(
                `Re-triggering group ${group} for database ${db.name}`
              )
              triggerStoredProcedureGroup(db, group)
            }
          }, timeout)
        })
      })
    })
    .catch(err => console.error('Error executing procedures:', err))
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
