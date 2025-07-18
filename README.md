# agregore-cli

Run  p2p web scripts from the CLI, no browser required.

**Work in progress!**

## CLI

```
npx agregore --help

agregore run <script> [...opts]
agregore eval "Some code" [...opts]

--no-https: Disable loading scripts from HTTPS
--no-http:  Disable loading scripts from HTTP
--no-ipfs: Disable loading scripts from IPFS
--no-hyper: Disable loading scripts from hypercore-protocol
--root: The root folder to persist data to (defaults to current folder)
--help: Show this text
```

```
npm i -g agregore
agregore run hyper://blog.mauve.moe/example.js
agregore eval '(await fetch("hyper://agregore.mauve.moe/index.md")).text()'
echo "4+20" | agregore eval
agregore repl
```

### Currently missing before being "stable":

- `file://` support
- Persistence
- More APIs?

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
