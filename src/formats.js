import pkg from 'string-kit'
const { format } = pkg
import is from 'is'
import { googleType } from "./gdrive.js"
import { isToday, format as dateFormat } from "date-fns";
/**
 * convert number into something like 1.1k
 * @param {string|number} size the size to be niced 
 * @returns {string}
 */
export const niceSize = (size)=>  {
  if (!size) return '-'
  size = parseInt (size)
  const K= 1024
  const points = [0,1,2,2,3,4]
  const scales = ['','k','m','g','t','p']
  const scaled =  Math.floor(Math.log(size) / Math.log(K))
  return parseFloat((size / Math.pow(K, scaled)).toFixed(points[scaled])) + scales[scaled];
}

/**
 * make an rxable string from a string with escaped special character
 * @param {string} text 
 * @returns {string}
 */
 export const niceRx = (text) => text.replace(/[-[\]{}()*+?.,\\/^$|#\s]/g, '\\$&');

 /**
  * these are the default field layouts for listing
  */
 export const lsFields = {
  id: {
    width: 58
  },
  filePath: {
    width: 70,
    title: 'path'
  },
  mimeType: {
    width: 12,
    title: "type",
    // shorten the mimetypes - we dont need all of it
    transformer: (value) => {
      return value
      .replace(new RegExp(`^${niceRx(googleType)}`), "g-")
      .replace (/^application\//,"")
      .replace (/^image\//,"")
      .replace (/^text\//,"")
    }
  },
  size: {
    width: 6,
    transformer: (value) => niceSize (value, 2)
  },
  modifiedTime: {
    title: 'modified',
    width: 18,
    transformer: (date) => isToday(date) ? dateFormat (date, "HH:MM:SS") :  dateFormat (date, "dd-MMM-yy HH:MM:SS")
  }
}

/**
 * return a format string for the withs of the ls fields content
 * @returns 
 */
const fWidth = () => {
  const keys = Reflect.ownKeys(lsFields)
  return keys.map(k => `%[R${lsFields[k].width || 10}]s`).join("")
}

/**
 * 
 * @param {object} row transform a row if any values need to be remapped accorinding to the lsFeilds 
 * @returns 
 */
export const transformRow = (row) => {

  const keys = Reflect.ownKeys(lsFields)
  return keys.map(k => {
    let value = row[k]
    const model = lsFields[k]
    if (Reflect.has(model, 'transformer')) {
      value = model.transformer(value)
    }
    if (is.undefined(value)) value = "-"
    return value
  })
}

export const fRow = (row) => {
  return format (fWidth(), ...transformRow (row))
}
export const fTitles = () => {
  const keys = Reflect.ownKeys(lsFields)
  return format(fWidth(), ...(keys.map(k => lsFields[k].title || k)))
}