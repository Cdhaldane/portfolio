// Shrink a receipt photo before upload. A 12MP shot is 3-5MB, and up to four
// of them have to fit under Vercel's 4.5MB request limit once base64'd.
// 2000px on the long edge still reads the small print on a receipt, and EXIF
// (GPS etc.) is dropped because the canvas re-encode never carries it.
const MAX_EDGE = 2000;
const QUALITY = 0.8;

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(new Error("Couldn't read that file."));
    reader.readAsDataURL(blob);
  });
}

/**
 * @param {File} file an image picked by the user
 * @returns {Promise<{ image: string, mediaType: string, previewUrl: string }>}
 */
export async function prepareReceiptPhoto(file) {
  if (!file || !file.type.startsWith("image/")) {
    throw new Error("That isn't a photo. Pick an image of the receipt.");
  }

  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("This browser can't open that photo format. Try a JPEG or PNG.");
  }

  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", QUALITY));
  if (!blob) throw new Error("Couldn't process that photo. Try another.");

  return {
    image: await blobToBase64(blob),
    mediaType: "image/jpeg",
    previewUrl: URL.createObjectURL(blob),
  };
}
