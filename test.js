#!/usr/bin/env -S node --experimental-vm-modules

import assert from 'node:assert'

import Agregore from './index.js'

const agregore = await new Agregore()

await agregore.init()

const toFetch = 'https://blog.mauve.moe/esm.js'

await assert.doesNotReject(async () => {
  const response = await agregore.fetch(toFetch)

  assert(response.ok, 'Able to fetch from HTTPS')

  console.log(await response.text())
}, 'Able to fetch')

await assert.doesNotThrow(() => {
  const result = agregore.eval('400 + 20')

  assert.equal(result, 420, 'Got correct result from eval')
}, 'Able to evaluate JS')

await assert.doesNotReject(async () => {
  const module = await agregore.import(toFetch)

  module.default()
}, 'Able to import module')

await assert.doesNotReject(async () => {
  const p2pURL = 'hyper://blog.mauve.moe/esm.js'

  const module = await agregore.import(p2pURL)

  module.default()
}, 'Able to import module from hyper://')

await agregore.close()
console.log('Done!')
