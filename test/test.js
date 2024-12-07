import test from 'ava';
import { figureFileSpec, isMatch } from '../src/filing.js'
import { isFolderType, walk } from '../src/gdrive.js'

/**
 * valid refs
 * gd:fileid
 * gd:folderid
 * gd://path/...
 * gd:root
 * https://drive.google.com/... links for folders & files
 */
const gd = {
	folderName: 'temp',
	traverseFolderId: '1IKzLkZwaUpNsS8a0Fz4mu5l7w-sbQv-f',
	traverseFolderName: 'public/gormenghast',
	traverseFiles: [{
		id: '1rYYtwARFe9X9nZWxkaTpsFoI-zKouPus',
		filePath: 'gd://public/gormenghast/Lady_Fuchsia_Groan.pdf'
	}, {
		id: '1v5kJ5SOY2nu3DI1LKwALb3seaBpF3kWu',
		filePath: 'gd://public/gormenghast/Steerpike.pdf'
	}],
	folderId: '1ypdMgsdRyb5ggJ3oX2UdWNx0k2eSdCnV',
	fileId: '1-YBGiTRfIYcmYUMNzNJEDlEmKAbyQqz8',
	folderPath: 'public/samplepdfs',
	filePath: 'public/samplepdfs/flyer.pdf',
	root: 'root',
	folderLink: '1ypdMgsdRyb5ggJ3oX2UdWNx0k2eSdCnV?usp=drive_link',
	fileLink: '1-YBGiTRfIYcmYUMNzNJEDlEmKAbyQqz8/view?usp=drive_link',
	testFiles: ['flyer.pdf', 'somatosensory.pdf', 'example.pdf', 'drylab.pdf'].sort(),
	wilds: ['f*', 'soma*.*', '*.pdf', '*.*', '*ple.pdf', 'e?a*', '*y*'],
	wildCounts: [1, 1, 4, 4, 1, 1, 3],
	rootName: 'My Drive',
	fileLinkPath: 'public/samplepdfs/somatosensory.pdf'
}

// default cli args
const rp ={
	recurse: true
}

const unroll = async (config) => {
	const files = []
	for await (const file of config.unroller.iterator) {
		files.push (file)
	}
	return files
}

const goodDrive = (t, config) => {
	const { gdrive } = config
	t.true(gdrive.is)
	t.true(config.ok)
	t.falsy(config.error)
	return config
}

const badSpec = (t, config) => {
	const { gdrive } = config
	t.false(config.ok)
	t.truthy(config.error)
	t.is(gdrive.file, null)
	return config
}

const goodFile = (t, config) => {
	t.false(config.gdrive.isFolder)
	return goodDrive(t, config)
}
const goodFolder = (t, config) => {
	t.true(config.gdrive.isFolder)
	return goodDrive(t, config)
}

test('drive root', async t => {
	const spec = `gd:${gd.root}`
	const config = await figureFileSpec(spec, rp)
	goodFolder(t, config)
	t.is(config.gdrive.file.filePath, "gd://")
	t.true(config.gdrive.isRoot)
	t.true(config.gdrive.fileId === gd.root)
	const files = await unroll(config)
	t.is(files.length, 1)
	t.is(files[0].name, gd.rootName)
	t.is(files[0].filePath, config.gdrive.file.filePath)
	t.is(config.gdrive.file.name, gd.rootName)
});



test('drive folder id traverser', async t => {
	const spec = `gd:${gd.traverseFolderId}`
	const config = await figureFileSpec(spec, rp)
	goodFolder(t, config)
	t.is(config.gdrive.file.filePath, "gd://" + gd.traverseFolderName)
	t.is(config.gdrive.file?.id, config.gdrive.fileId)
	t.false(config.gdrive.isRoot)
	t.true(config.gdrive.fileId === gd.traverseFolderId)

	const { files, folders, em } = await walk(config)
	t.deepEqual (files.map (f=> ({id:f.file.id, filePath: f.file.filePath})), gd.traverseFiles)
	const {eventStats} = em

	t.is(eventStats.start, 1)
	t.is(eventStats.end, 1)
	t.falsy(eventStats.error)
	t.is(eventStats.folderEnd, 1)
	t.is(eventStats.folder,1)
	t.falsy(eventStats.nodata)


	folders.forEach (f=> {
		t.is (f.chunker.stats.items ,  gd.traverseFiles.length)
		t.is (f.file.filePath, 'gd://'+gd.traverseFolderName)
		t.is (f.file.id, gd.traverseFolderId)
		t.true (isFolderType (f.file))
	})

});

test('drive root as folder', async t => {
	const spec = `gd://`
	const config = await figureFileSpec(spec, rp)
	goodFolder(t, config)
	t.true(config.gdrive.isRoot)
	// dont know how many there are but at least this
	const maxItems = 19
	const {files} = await walk({...config, rp: {maxItems}})
	t.true(files.length === maxItems)

});

test('drive folder id', async t => {
	const spec = `gd:${gd.folderId}`
	const config = await figureFileSpec(spec, rp)
	goodFolder(t, config)
	t.is(config.gdrive.file.filePath, "gd://" + gd.folderName)
	t.is(config.gdrive.file?.id, config.gdrive.fileId)
	t.false(config.gdrive.isRoot)
	t.true(config.gdrive.fileId === gd.folderId)

	const files = await unroll(config)
	t.is(files.length, 1)
	t.is(files[0].id, gd.folderId)
	t.is(files[0].filePath, config.gdrive.file.filePath)
});

test('drive with bad id', async t => {
	const spec = '@;gd:xyz/z/z'
	const config = await figureFileSpec(spec, rp)
	badSpec(t, config)
	t.is(config?.error?.code, 400)
});

test('drive with unknown id', async t => {
	const spec = 'gd:xyz'
	const config = await figureFileSpec(spec, rp)
	badSpec(t, config)
	t.is(config?.error?.code, 404)
});

test('drive folder link', async t => {
	const spec = `https://drive.google.com/drive/folders/${gd.folderLink}`
	const config = await figureFileSpec(spec, rp)
	goodFolder(t, config)
	t.is(config.gdrive.file?.id, config.gdrive.fileId)
	t.false(config.gdrive.isRoot)
	const files = await unroll(config)
	t.is(files.length, 1)
	t.is(files[0].id, config.gdrive.fileId)
	t.is(config.gdrive.file.filePath, "gd://" + gd.folderName)
	t.is(files[0].filePath, config.gdrive.file.filePath)
});

test('drive folder link with unknown link id link', async t => {
	const spec = 'https://drive.google.com/drive/folders/abcdef'
	const config = await figureFileSpec(spec, rp)
	badSpec(t, config)
	t.is(config?.error?.code, 404)
});

test('drive folder link with invalid link id link', async t => {
	const spec = `https://drive.google.com/drive/folders/x/${gd.folderLink}`
	const config = await figureFileSpec(spec, rp)
	badSpec(t, config)
	t.is(config?.error?.code, 400)
});

test('drive file link', async t => {
	const spec = `https://drive.google.com/file/d/${gd.fileLink}`
	const config = await figureFileSpec(spec, rp)
	goodFile(t, config)
	t.is(config.gdrive.file?.id, config.gdrive.fileId)
	const files = await unroll(config)
	t.is(files.length, 1)
	t.is(files[0].id, config.gdrive.fileId)
	t.is(files[0].filePath, "gd://" + gd.fileLinkPath)
	t.deepEqual(files[0], config.gdrive.file)

});

test('drive folder path only', async t => {
	const spec = `gd://${gd.folderPath}`
	const config = await figureFileSpec(spec, rp)
	const files = await checkFileList(t, config, spec)
	t.is(files.length, gd.testFiles.length)
	t.is(config.gdrive.unfolders.length, gd.filePath.split("/").length )
	t.deepEqual(files.map(({file}) => file.name).sort(), gd.testFiles)
});

test('drive file paths', async t => {
	await Promise.all(gd.testFiles.map(async (f) => {
		const spec = `gd://${gd.folderPath}/${f}`
		const config = await figureFileSpec(spec, rp)
		let fLength = gd.filePath.split("/").length
		if (!config.gdrive.isFolder) fLength ++
		t.is(config.gdrive.unfolders.length, fLength )
		const files = await checkFileList(t, config, spec, f)
		t.is(files.length, 1, spec)
	}))

});


const checkFileList = async (t, config, spec, f = "*") => {
	t.true(config.ok, spec)
	t.is(config.error, null, spec)
	const {files} = await walk(config)
	files.forEach(({file}) => {
		t.is(typeof (file.id), 'string', spec)
		t.false(isFolderType(file), spec)
		t.true(isMatch(`gd://${gd.folderPath}/${f}`, file.filePath), spec)
	})
	return files
}
test('drive file wilds', async t => {
	t.is(gd.wildCounts.length, gd.wilds.length)
	await Promise.all(gd.wilds.map(async (f, i) => {
		const spec = `gd://${gd.folderPath}/${f}`
		const config = await figureFileSpec(spec, rp)
		t.is(config.gdrive.unfolders.length, gd.filePath.split("/").length + 1)
		const files = await checkFileList(t, config, spec, f)
		t.is(files.length, gd.wildCounts[i], spec)
	}))

});