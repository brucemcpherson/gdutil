#!/usr/bin/env node
/**
 * manage uploads storage & drive & local
 */
import { runParams } from './src/getargs.js'

// entry point
const main = async () => {
  
  // get args from cli
  return runParams()

}

main()