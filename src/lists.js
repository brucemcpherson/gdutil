
import { figureFileSpec, configExit } from "./filing.js"
import { isFolderType, handleDriveList, traverser, googleType } from "./gdrive.js"
import { Em } from './Em.js'
import { fTitles, fRow } from './formats.js'



/**
 * list given source and display
 * @param {object} rp cli args 
 * @return {Promise <object>} {config, files}
 */
export const lsCli = async (rp) => {


  const { listSource, brief } = rp
  const config = await figureFileSpec(listSource, rp)

  // get an event emitter with stats
  // TODO later on we'll add an option to show stats
  const em = new Em();

  // report error and exit
  if (!config.ok) {
    configExit(config)
  }
  // brief is just the filePath, otherwise we need titles
  if (!brief) {
    // column titles
    console.info(fTitles())
  }

  const fileRow = (file) => {
    if (brief) {
      console.info(file.filePath)
    } else {
      console.info(fRow(file))
    }
  }
  // when traversing is done, we resolve
  const done = new Promise((resolve, reject) => {

    em.on('file', ({ file }) => fileRow(file))
      .on('folder', ({ file }) => fileRow(file))
      .on('end', resolve)
      .on('error', ({ error }) => reject(error))
      .on('nodata', ({ error }) => reject(error))
  })
  // start traversing the file tree
  traverser({ config, em })

  // this will get resolved when travering is done
  return done
}





