// task sepcific: genai information extraction using gemini

import { Storage } from '@google-cloud/storage'
import { GoogleAuth } from 'google-auth-library'
import { google } from "googleapis";

/**
 * these will populated on demand if required
 */
let storageClient = null
let driveClient = null


export const getDriveClient = () => {
  if (!driveClient) {
    const auth =  getDriveAuth()
    driveClient =  google.drive({version: 'v3', auth});
  }
  return driveClient
}



// This is the gemini key from the gemini ai studio
const getKey = ({ key = "GEMINI_API_KEY" } = {}) => {
  const apiKey = process.env[key]
  if (!apiKey) {
    console.log (`missing api-key - set ${key} value in env with export ${key}=your api key`)
    process.exit(1)
  }
  return apiKey
}

/**
 * generate an auth object from apikey in env
 * @returns {object} auth
 */
export const getAuth = (key) => new GoogleAuth().fromAPIKey(getKey(key))

export const getDriveAuth = () => {
  const scopes = ["https://www.googleapis.com/auth/drive"]
  const auth = new google.auth.GoogleAuth({
    scopes
  })
  return auth
}



/**
 * we'll be using adc credentials so no need for any special auth here
 * @returns {Storage}
 */
export const getStorageClient = () => {
  if (!storageClient) {
    storageClient = new Storage();
  }
  return storageClient
}


