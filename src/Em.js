import EventEmitter from 'node:events';
import * as changeCase from "change-case";

export class Em {
 
  constructor (){
    this.eventStats = {}
    this.emitter = new EventEmitter ()
  }

  getProp (name) {
    return changeCase.camelCase (name)
  }
  
/**
 * @param {string} name event name 
 * @param  {...any} args the args to emit
 * @returns emitter
 */
  it (name, ...args){
    const prop = this.getProp (name)
    if (!Reflect.has (this.eventStats,prop)) this.eventStats [prop] = 0
    this.eventStats [prop] ++
    this.emitter.emit (name, ...args)
    return this.emitter
  }

  on (...args) {
    return this.emitter.on (...args)
  }
}