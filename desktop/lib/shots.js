// Small copies of pasted screenshots: what goes to Notion is a narrow JPEG, not the full-size file (Claude reads the original).
export const SMALL_WIDTH = 900, SMALL_QUALITY = 70;

// A JPEG buffer of the screenshot at most SMALL_WIDTH wide, or null when it can't be read as an image.
// images: Electron's nativeImage (passed in, so this runs in plain Node tests too).
export function smallCopy(images, buffer) {
  try {
    const image = images.createFromBuffer(buffer);
    if (image.isEmpty()) return null;
    const {width} = image.getSize();
    return (width > SMALL_WIDTH ? image.resize({width: SMALL_WIDTH, quality: 'good'}) : image).toJPEG(SMALL_QUALITY);
  } catch { return null; }
}
