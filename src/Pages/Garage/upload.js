// Browser side of a log upload: gzip the file with CompressionStream and
// base64 it for the JSON body. A raw hour of Accessport logging is ~10 MB,
// over Vercel's 4.5 MB request limit; gzipped it is ~2.3 MB.

// Matches the API's cap on the decoded gzip (telemetry-normalize.js).
export const MAX_GZ_BYTES = 3 * 1024 * 1024;

export const canCompress = () => typeof window !== "undefined" && "CompressionStream" in window;

function toBase64(bytes) {
  if (typeof bytes.toBase64 === "function") return bytes.toBase64();
  let s = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

/** Gzip a File. Resolves { b64, bytes } (bytes = compressed size). */
export async function gzipFile(file) {
  const stream = file.stream().pipeThrough(new CompressionStream("gzip"));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  return { b64: toBase64(bytes), bytes: bytes.length };
}

/**
 * The day a file was last modified, in local time. Accessport CSVs carry only
 * elapsed seconds, so this is the best first guess at when a log was
 * recorded; the upload preview always lets you correct it.
 */
export const fileDay = (file) => new Date(file.lastModified).toLocaleDateString("en-CA");

/** Natural order: datalog10 after datalog9, not after datalog1. */
export const naturalCompare = (a, b) =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
