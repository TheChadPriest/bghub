"""Generate HEIC test fixtures from CC0 source photos using pillow-heif (libheif + x265).
Usage: python scripts/make-heic-fixtures.py <bag.jpg> <outdir>"""
import sys
from PIL import Image
import pillow_heif
pillow_heif.register_heif_opener()
src, out = sys.argv[1], sys.argv[2]
im = Image.open(src).convert("RGB")
im.save(f"{out}/bag.heic", quality=90)
# portrait-orientation case: store pixels rotated plus an EXIF orientation=6 (rotate 90 CW on display)
rot = im.transpose(Image.Transpose.ROTATE_90)  # stored sideways
exif = Image.Exif(); exif[0x0112] = 6
rot.save(f"{out}/bag-rotated.heic", quality=90, exif=exif.tobytes())
# multi-image container: two frames, primary is first
small = im.resize((im.width // 2, im.height // 2))
pillow_heif.from_pillow(im).save(f"{out}/bag-multi.heic", quality=80, append_images=[small]) if False else None
heif = pillow_heif.from_pillow(im)
heif.add_from_pillow(small)
heif.save(f"{out}/bag-multi.heic", quality=80)
for n in ["bag.heic", "bag-rotated.heic", "bag-multi.heic"]:
    h = pillow_heif.open_heif(f"{out}/{n}")
    print(n, len(h), [(x.size, x.info.get("primary")) for x in h])
