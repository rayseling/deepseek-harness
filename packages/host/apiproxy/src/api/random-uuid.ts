/**
 * Browser-safe UUID minting for wire correlation.
 *
 * `crypto.randomUUID` is a secure-context-only Web API. A page served over
 * plain HTTP from anything but a loopback authority — a LAN address, a
 * reverse-proxied host — is not a secure context, so the method is `undefined`
 * there and the first minted id throws before the app can boot. `getRandomValues`
 * carries no such restriction and is the one CSPRNG primitive browsers and Node
 * both always expose, so every id minted in a browser page comes from here.
 *
 * api/ contract layer: zero Node dependencies, importable from the browser.
 */

/**
 * Mint an RFC 4122 version 4 UUID without requiring a secure context.
 * @returns a UUID whose randomness comes from `crypto.getRandomValues()`.
 */
export function randomUuid(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16))
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  view.setUint8(6, view.getUint8(6) & 0x0f | 0x40)
  view.setUint8(8, view.getUint8(8) & 0x3f | 0x80)
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
