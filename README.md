# agregore-cli

Run  p2p web scripts from the CLI, no browser required.

**Work in progress!**

## TODO:

- Use vm module to set up environment
- Inject browser APIs
	- Reuse as much as possible from existing [globals](https://nodejs.org/api/globals.html)
- Set up dynamic fetch map `<scheme> => fetch()`
- Wrap map with a `fetch()` API which can understand schemes
- Inject `fetch()` into VM
- Add custom linker which uses `fetch()`
- Register `http://` and `https://`
- Register `file://` protocol scheme, limit to local folder or below
- Register p2p protocol schemes (dynamic require?)
	- ipfs/ipns/ipld/pubsub
	- hyper
- Publish as downloadable binary
- Figure out import maps
