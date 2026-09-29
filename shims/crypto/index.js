/**
 * Browser stand-in for Node's built-in `crypto` module.
 *
 * @massalabs/massa-web3 calls `require('crypto')` only on its Node code
 * path (guarded by an `isNode()` check); in the browser it uses
 * `window.crypto`. esbuild still has to resolve the specifier when
 * bundling for the browser, so this package (installed as
 * `"crypto": "file:shims/crypto"`) gives it something empty to resolve.
 * Nothing in here is ever called at runtime.
 */
module.exports = {};
