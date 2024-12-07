import { configError, specPrefixes, isMatch, wMatch, hasWildCards, messExit, chunkerUnwind } from "./filing.js"
import { getDriveClient } from './services.js';
import path from 'path';
import { Chunker } from 'chunkosaur';
import { Em } from './Em.js'

/**
 * each propertyu refers to an event type
 * these are tracked by the Em event emitter class
 * @typedef {object} EventStats keep track of event emits
 * @property {number} start
 * @property {number} file
 * @property {number} folder
 * @property {number} nodata
 * @property {number} error
 * @property {number} end
 */

/**
 * @typedef {object} GdEvent returned by traverser.emit
 * @property {Error} [error] any error
 * @property {object} config the config that kicked it off
 * @property {Chunker} [chunker] the chunker in operations
 * @property {File} [file] the file or folder
 */


/**
 * the ide here is to create a recursive traverser which ultimately ends up at a file
 * events are emitted at each folder or file encounter
 * the caller can use 
 * GdEvent is all or some of { error, config, file, chunker }
 * traverser
 *  .on('start', GdEvent)
 *  .on('file', GdEvent)  
 *  .on('folder', GdEvent)
 *  .on('folder-end', GdEvent)
 *  .on('end', GdEvent)
 *  .on('error', GdEvent)
 *  .on('nodata', GdEvent)
 * @param {object} p params
 * @param {object} config the filespec config
 * @return {Promise <config>} the config
 */
export const traverser = async ({ config, em }) => {

  em.it('start', { em, config })
  const {rp = {}} = config
  const {maxItems = Infinity, orderBy, recurse} = rp
  let lookedAt = 0
  const recurseTraverse = async (chunker) => {
    try {
      for await (const file of chunker.iterator) {

        // if it's a folder do an implied wildcard search 
        if (isFolderType(file)) {
          chunker = driveListChunker({
            fileName: "*",
            parentIds: [file.id],
            addFilePath: true,
            orderBy
          })
          em.it('folder', { em, file, chunker, config })
          if (recurse) await recurseTraverse(chunker)
          em.it('folder-end', { em, file, chunker, config })
        } else {
          // it was just a file
          lookedAt ++
          if (lookedAt > maxItems) return config
          em.it('file', { em, file, chunker, config })

        }
      }
    } catch (error) {
      return em.it('error', { em, config, error, chunker })
    }

  }

  let { unroller } = config
  if (unroller) {
    // need to reset the chunker if its all done
    if (unroller.eof) {
      em.it('error', { em, config, chunker: unroller, error: new Error('Chunker has already been exhausted') })
    } else {
      await recurseTraverse(unroller)
      return em.it('end', { em, config, chunker: unroller })
    }

  } else {
    em.it('nodata', { em, config })
  }

  return config
}


/**
 * 
 * @param {object} config 
 * @return {Promise <object>} testTraversered files
 */
export const walk = async (config) => {
  const em = new Em();
	let resolve = null
	let reject = null
	const done = new Promise((rs, rj) => {
		resolve = rs
		reject = rj
	})
	const files = []
	const folders = []


	em.on('error', (gdEvent) => {
		reject({ ...gdEvent, em })
	})

	em.on('file', ({ file, chunker }) => {
		files.push({
			file,
			chunker
		})
	})

	em.on('end', () => {
		resolve({
			files,
			folders,
      em
		})
	})

	em.on('nodata', () => {
		resolve({
			files,
			folders,
      em
		})
	})

	em.on('folder-end', ({ file, chunker }) => {
		folders.push({
			file,
			chunker
		})

	})

	traverser({ config, em })
	return done
}

/**
 * this would be called if we've got a file by its id and we need to assign a folder structure to it
 * @param {object} config the filespec config
 * @return {Promise <object>} the updated config
 */
const refolder = async (config) => {
  const { gdrive } = config

  // the input is a single file in the file property
  const { file, unfolders } = gdrive
  if (!file) return configError(config, `no file metadata found for ${config.paths.fileSpec}`, 400)

  gdrive.unfolders = []
  const root = await getRoot()

  const recurseParents = async (fileId) => {

    // get the file from cache - it should already be there 
    const file = getFromFileCache(fileId, true)

    // there should be a parent except if we're doing the root

    if (fileId !== root.id) {
      const parents = file.parents
      if (parents.length !== 1) return configError(config, `multiple parents not supported - ${config.paths.fileSpec}`, 400)
      // get the parent - not supporting multiple parents 
      const [parentId] = parents

      // if the parent isnt in cache, then get it
      let parentFile = getFromFileCache(parentId)
      if (!parentFile) {
        const pf = await getDriveById({ fileId: parentId })

        if (pf.error) {
          return configError(config, pf.error.toString(), pf.error.code)
        }
        parentFile = pf.file
      }

      if (!isFolderType(parentFile)) {
        return configError(config, `${parentFile.name} is not a folder- it's ${parentFile.mimeType}`, 400)
      }
      // these will actually be in reverse order so we need to sort that out later
      gdrive.unfolders.push([parentFile.id])

      // let's go again
      return await recurseParents(parentFile.id)

    }
    return config
  }

  // kick it off
  config = await recurseParents(file.id)

  // the folders are in the wrong order reverse and addd the root
  config.gdrive.unfolders = config.gdrive.unfolders.reverse()

  // for single id style fetches, we can poke the filepath in here for convenience
  config.gdrive.file = { ...file, filePath: getFilePath(file.id) }
  config.gdrive.fileIds = [file.id]
  config.unroller = unroller(config.gdrive.fileIds)
  return config
}

/**
 * handles unravelling file paths in drive
 * @param {object} config 
 * @returns {Promise <object>} updated config with a chunker to retrieve selected files
 */
export const unfolder = async (config) => {

  const { gdrive, rp } = config
  const {orderBy} = config
  // split the filespec into fragments
  config.ok = true
  const fp = config.paths.folderPath
  gdrive.isRoot = config.paths.fileSpec === specPrefixes.drivePath
  const splits = fp.split('/')
  // special treatment for gd:// which implies gd:root
  if (!gdrive.isRoot) {
    config = checkSplits(config, splits)
    if (!config.ok) return config
  }

  // get the root
  const root = await getRoot()
  gdrive.unfolders = [[root.id]]

  // if it's the root gd:// we're pretty much done
  if (gdrive.isRoot) {
    gdrive.isFolder = true
    const chunker = driveListChunker({
      fileName: "*",
      addFilePath: true,
      parentIds: [root.id],
      orderBy
    })
    gdrive.unfolders.push([])
    config.unroller = chunker
    return config
  }

  // pass through the folder structure
  const recurseFolders = async () => {

    const [fileName] = splits.splice(0, 1)

    // there can be multiple folders matching so we need a chunker for each one
    // we can get the folder content from cache, so we only need the id
    const [parentIds] = gdrive.unfolders.slice(-1)

    // new slot for this folder
    const folderMatches = []

    // each matched parent folder
    const chunker = driveListChunker({
      fileName,
      parentIds,
      foldersOnly: Boolean(splits.length),
      orderBy
    })
    for await (const folder of chunker.iterator) {
      folderMatches.push(folder.id)
    }

    // record the matches
    gdrive.unfolders.push(folderMatches)
    if (splits.length) return await recurseFolders()


    // make a chunker to return the matched files
    config.gdrive.fileIds = (gdrive.unfolders.slice(-1)[0]).flat()
    config.unroller = unroller(config.gdrive.fileIds)
    return config


  }

  // kick it off
  return recurseFolders()

}

/**
 * figure out filepath by traversing back across parents
 * @param {string} fileId 
 * @returns  {string} the filePath
 */
export const getFilePath = (fileId) => {
  let file = getFromFileCache(fileId, true)
  const filePaths = []
  while (file.parents) {
    filePaths.push(file.name)
    file = getFromFileCache(file.parents[0], true)
  }
  return specPrefixes.drivePath + filePaths.reverse().join('/')
}


/**
 * a chunker to return the meta data for all seldcted files
 * @param {string[]} fileIds 
 * @returns {Chunker}
 */
const unroller = (fileIds) => {


  // emulate a chunker to return file meta data
  let feed = [...fileIds]
  return new Chunker({
    fetcher: () => {

      if (!feed.length) return {
        done: true
      }
      const [id] = (feed.splice(0, 1))
      const file = getFromFileCache(id, true)
      return {
        values: [{ ...file, filePath: getFilePath(file.id) }]
      }
    }
  })

}

/**
 * meta data is kept here
 */
let fileCache = null
export const getFileCache = () => {
  if (!fileCache) fileCache = new Map()
  return fileCache
}
export const addToFileCache = (file) => {
  const fc = getFileCache()
  if (!file || !file.id) throw `file meta missing while adding to fileCache`
  if (typeof file.id !== 'string') throw `expected file id to be to a string its ${typeof file.id}`
  fc.set(file.id, file)
  return file
}

export const getFromFileCache = (id, exitOnFail = false) => {
  const fc = getFileCache()
  if (!id) messExit(`missing id while getting from fileCache`)
  if (fc.has(id)) return fc.get(id)
  if (exitOnFail) messExit(`failed to find folder ${id} in cache`)
  return null
}

/**
 * a chunker to page through drive api list
 * @param {object} p 
 * @returns {Chunker}
 */
export const driveListChunker = ({
  queryParams,
  maxItems = Infinity,
  chunkSize = 100,
  offset = 0,
  fileName,
  parentIds,
  addFilePath = false,
  foldersOnly,
  orderBy
} = {}) => {

  // define a fetcher to handle paging
  const fetcher = async ({ meta, chunker, stats }) => {
    const { eof, target, pageToken, maxItems, chunkSize, offset, parentIds, fileName, queryParams } = meta

    // if we're done (reached maxitems or the last one had no nextpagetoken)
    if (eof || stats.items >= meta.maxItems + offset) {
      return { done: true }
    }

    // get a page - make sure we dont get more than the max items
    const pageSize = Math.min(chunkSize, maxItems - stats.items + offset)
    const { files, error, nextPageToken } = await getFilesInFolder({
      pageToken,
      pageSize,
      fileName,
      queryParams,
      parentIds,
      foldersOnly,
      orderBy
    })

    // just let this be dealt with upstream
    if (error) throw error

    // prepare for next fetch
    chunker.meta = { ...meta, pageToken: nextPageToken, eof: !nextPageToken }

    // if there's no more there'll be no next Page
    return files ? {
      values: addFilePath ? files.map(f => ({ ...f, filePath: getFilePath(f.id) })) : files
    } : {
      done: true
    }
  }

  // define a chunker to get a generator
  const chunker = new Chunker({
    fetcher,
    meta: {
      fileName,
      maxItems,
      chunkSize,
      offset,
      parentIds,
      queryParams
    }
  })

  return chunker
}

/**
 * these are the minimum fields we should pick up
 */
const minFields = "id,name,mimeType,parents,size,modifiedTime"
export const googleType = 'application/vnd.google-apps.'
const folderType = `${googleType}folder`
/**
 * is a drive file a drive folder
 * @param {object} p file meta data
 * @param {string} p.mimeType the mimetype of the file
 * @returns 
 */
export const isFolderType = ({ mimeType } = {}) => mimeType === folderType


export const isFolderTypeFromCache = (id) => {
  const folder = getFromFileCache(id, true)
  return isFolderType(folder)
}

/**
 * gets files in this folder with slected name - only does 1 page
 * @param {object} p 
 * @param {string} p.fileName the final filename
 * @param {string[]} [p.parentIds=[]] any parents to add to the query
 * @param {number} [p.pageSize=100] how many to get at once
 * @returns 
 */
const getFilesInFolder = async ({ fileName = "", parentIds = [], pageSize = 100, queryParams = {}, pageToken, foldersOnly, orderBy }) => {
  const drive = getDriveClient()

  // drive doesnt really support wildcards.
  // instead if we detect wilcard chars, we'll just get everything then filter out the matches

  const qFrags = []
  if (fileName && !hasWildCards(fileName)) qFrags.push(`(name = '${fileName}')`)
  if (parentIds.length) qFrags.push('(' + parentIds.map(folderId => `'${folderId}' in parents`).join(" OR ") + ')')
  const fields = fixFields(queryParams.fields)
  const listParams = {
    fields: `nextPageToken,files(${fields})`
  }
  if (foldersOnly) qFrags.push(`(mimeType = '${folderType}')`)
  if (qFrags.length) listParams.q = qFrags.join(" AND ")
  if (orderBy) listParams.orderBy = orderBy
  try {
    const list = await drive.files.list({
      ...listParams,
      pageSize,
      pageToken
    })
    let files = list.data.files
    // no point in bothering to check for * match as it will all match
    if (fileName !== "*" && hasWildCards(fileName)) {
      const wildMatch = wMatch(fileName)
      files = files.filter(f => wildMatch(f.name))
    }

    // add these to the file cache for later
    files.forEach(f => addToFileCache(f))
    const nextPageToken = list.data.nextPageToken

    return {
      files,
      nextPageToken
    }
  } catch (error) {
    console.error(error)
    return {
      error
    }
  }
}

const fixFields = (fields = "") => {
  // remove dups
  const sf = new Set(fields.split(",").concat(minFields.split(",")).filter(f => f.trim()))
  return Array.from(sf).join(",")
}

/**
 * make sure we have the min fields specified anyway
 */
const fixQueryParams = (queryParams = {}) => {
  return {
    ...queryParams,
    fields: fixFields(queryParams.fields)
  }
}

/**
 * get a drive file by id
 * @param {object} p
 * @param {string} p.fileId the fileID (root for My Drive) 
 * @param {object} p.queryParams add any queryparams required
 * @returns {Promise <object>} {file, error}
 */
const getDriveById = async ({ fileId }, { queryParams = {} } = {}) => {

  // drive output
  const drive = getDriveClient()
  // add basic fields
  const fq = fixQueryParams(queryParams)

  try {
    const file = await drive.files.get({
      fileId,
      ...fq
    })
    return {
      file: addToFileCache(file.data)
    }
  } catch (error) {
    return {
      error
    }
  }

}




/**
 * get the drive root
 * @returns {Promise <File>} the root
 */
const getRoot = async () => {
  let root = getFromFileCache('root')
  if (!root) {
    const { file, error } = await getDriveById({ fileId: 'root' })
    if (error) {
      messExit('failed to get drive root ' + error.toString())
    }
    root = file
  }
  return Promise.resolve(root)
}

/**
 * extra validation on the folderpath split
 * @param {object} config 
 * @param {*} splits 
 * @returns {object} config
 */
const checkSplits = (config, splits) => {
  if (splits.filter(f => f).length !== splits.length) {
    // this'll catch stuff like a//b
    return configError(config, `Invalid filespec ${config.paths.folderPath}`, 400)
  }
  return config
}




// drive folders are gd://x/y/z
export const isDrivePath = (config) =>
  config.paths.fileSpec.match(specPrefixes.rxDrivePath)

// a driveid is specified like this gd:id
export const isDriveId = (config) => config.paths.protocol === specPrefixes.driveProtocol

// this is the link you get from get link when sharing a drive file
export const isDriveLink = (config) =>
  config.paths.protocol === specPrefixes.driveLinkProtocol && config.paths.hostName === specPrefixes.driveLinkHostName

export const isDriveFolderLink = (config) =>
  isDriveLink(config) && config.paths.path === specPrefixes.driveFolderLink + config.gdrive.fileId

export const isDriveFileLink = (config) =>
  isDriveLink(config) && config.paths.path === specPrefixes.driveFileLink + config.gdrive.fileId

export const handleDrivePath = async (config) => {
  const { gdrive } = config
  gdrive.is = true

  const folders = await unfolder(config)
  // the list of folder are in unfolders
  // we can construct the file property from the last one
  if (config.ok) {
    const [file] = gdrive.unfolders.slice(-1)
    gdrive.file = file
  }
  return config
}

export const handleDriveId = async (config) => {
  const { gdrive, paths } = config
  // it could be a file/folder id or a path
  gdrive.is = true

  gdrive.fileId = paths.fileName
  return validateAndRefolder(config)
}

export const handleDriveList = async (config) => {
  const files = await chunkerUnwind(config.unroller)
  return {
    config,
    files
  }
}

const validateDrive = async (config) => {
  // possibilites are
  // gd:id, gd:root
  const { gdrive } = config
  // see if its a good id 
  const { file, error } = await getDriveById(gdrive)
  if (!error) {
    gdrive.file = file
    gdrive.isFolder = isFolderType(gdrive.file)
    gdrive.isRoot = gdrive.file?.name === 'My Drive'
    config.ok = true
  } else {
    return configError(config, error.toString(), error.code)
  }
  return config
}

export const handleDriveLink = async (config) => {
  const { gdrive, paths } = config
  // check if its a good drive link
  gdrive.is = true

  gdrive.fileId = paths.fileName
  const folderLink = isDriveFolderLink(config)
  const fileLink = !folderLink && isDriveFileLink(config)
  const fileId = path.basename(paths.fileName)
  if (!folderLink && !fileLink) {
    return configError(config, 'badly constructed link ' + paths.fileSpec, 400)
  }
  return validateAndRefolder(config)

}

const validateAndRefolder = async (config) => {
  config = await validateDrive(config)
  if (config.ok) {
    // figure out the folder path for this file
    return refolder(config)
  }
  return config

}

const createFolder = async ({ parentId, name }) => {

}
export const handleToDriveCopy = async ({ sourceConfig, targetConfig }) => {

  // see which of the output folders exist
  const { unfolders } = targetConfig.gdrive
  const folderPaths = [""].concat(targetConfig.paths.folderPath.split("/"))
  console.log(folderPaths)
  unfolders.forEach((folders, i) => {
    const name = folderPaths[i]
    if (!folders.length) {
      console.log('creating folder', name)
    } else if (folders.length > 1) {
      console.log('ambiguous')
    } else {
      const folder = getFromFileCache(folders[0], true)
      if (folder.name !== name) {
        console.log(folder, name)
      }
    }

  })

  // iterate through all the input files
  for await (const file of sourceConfig.unroller.iterator) {
    console.log(file.filePath)
  }
  return {
    sourceConfig,
    targetConfig
  }
}
