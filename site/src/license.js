// Owner-signed license keys (JP1.<payload>.<signature>, Ed25519), checked on the website like the app does
// (desktop/lib/license.js): the payload when the signature matches the owner's public key, else null.
const unb64 = text => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - text.length % 4) % 4)), c => c.charCodeAt(0));

export async function verifyLicense(text, publicKey) {
  const parts = String(text || '').trim().split('.');
  if (parts.length !== 3 || parts[0] !== 'JP1' || !publicKey) return null;
  try {
    const key = await crypto.subtle.importKey('raw', unb64(publicKey), {name: 'Ed25519'}, false, ['verify']);
    if (!await crypto.subtle.verify({name: 'Ed25519'}, key, unb64(parts[2]), new TextEncoder().encode(parts[1]))) return null;
    const payload = JSON.parse(new TextDecoder().decode(unb64(parts[1])));
    if (!payload.id || (payload.until && payload.until < new Date().toISOString().slice(0, 10))) return null;
    return payload;
  } catch {
    return null;
  }
}
