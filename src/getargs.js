import { createRequire } from "module";
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import is from 'is'
import { getJsonFile, messExit } from "./filing.js";
import {lsCli} from "./lists.js"
import {cpCli} from "./copy.js"

export const runParams = async () => {
  const defaultArgs = await getDefaultArgs()

  return yargs(hideBin(process.argv))
    .commands('cp <copySource> <copyTarget>', 'copy', (cp)=> {
      cp.positional ('copySource', {
        describe: 'source file spec',
        type: 'string'  
      }).positional ('copyTarget', {
        describe: 'target spec',
        type: 'string'  
      })
    },(args)=> {
      return cpCli (args)
    })
    .commands('ls <listSource>', 'list', (ls)=> {
      ls.positional ('listSource', {
        describe: 'list file',
        type: 'string'  
      })
    },(args)=> {
      return lsCli (args)
    })
    .commands('mv <mvSource> <mvTarget>', 'rename', (mv)=> {
      mv.positional ('mvSource', {
        describe: 'rename file from',
        type: 'string'  
      }).positional ('mvTarget', {
        describe: 'rename file to',
        type: 'string'  
      })
    },(args)=> {
      console.info(`...renaming ${args.mvSource} to ${args.mvTarget}`)
    })
    .strict(true)
    .check((argv, options) => {
      // check the correct types
      const errors = options.boolean.filter(f => f !== "help" && f !== "version")
        .filter(f => !is.boolean(argv[f]) && !is.undefined(argv[f]))
        .concat(
          options.number.filter(f => !is.number(argv[f])),
          options.string.filter(f => !is.string(argv[f]) && !is.undefined(argv[f]))
        )
      if (errors.length) {
        console.log('...these args were invalid type', errors.join(","))
        throw new Error(`...these args were invalid type ${errors.join(",")}`)
      }
      return !errors.length
    }, true)
    .version("1.0.0")
    .options({
      recurse: {
        default: defaultArgs.recurse || false,
        description: "whether to recurse folder contents",
        alias: "r",
        type: 'boolean'
      },
      orderBy: {
        default: defaultArgs.orderBy || 'name asc,modifiedTime desc',
        description: "name of drive propert(ies) to sort by eg name,modifiedTime desc",
        alias: "o",
        type: 'string'
      },
      maxItems: {
        default: defaultArgs.maxItems || Infinity,
        description: "max Items to process",
        alias: "m",
        type: 'number'
      },
      offset: {
        default: defaultArgs.offset || 0,
        description: "start at this offset in the upload list",
        alias: "offset",
        type: 'number'
      },
      chunkSize: {
        default: defaultArgs.chunkSize || 500,
        description: "items per page to read from gemini uploads API",
        alias: "c",
        type: 'number'
      },
      threshold: {
        default: defaultArgs.threshold || 10,
        description: "threshold at which to start flushing output",
        alias: "t",
        type: 'number'
      },
      brief: {
        default: defaultArgs.brief || false,
        description: "only show minimal info",
        alias: "b",
        type: "boolean"
      }

    })
    .argv

}


const getDefaultArgs = async () => {
  // this sets local defaults for yargs
  const defaultsFile = 'gdutil.json'
  const defaults = await getJsonFile(defaultsFile, false)

  if (!defaults) {
    // console.log (`...no ${defaultsFile} found - using standard defaults`)
    return {}
  } else {
    return defaults
  }
  
}
