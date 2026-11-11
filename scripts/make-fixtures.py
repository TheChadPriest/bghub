"""Generate deterministic test fixtures from CC0 photos (see tests/fixtures/ATTRIBUTION.md)."""
import sys, os
from PIL import Image, ImageDraw
src_dir, out = sys.argv[1], sys.argv[2]
def p(n): return os.path.join(src_dir, n)
bag = Image.open(p("bag.jpg")).convert("RGB")
jacket = Image.open(p("jacket.jpg")).convert("RGB")
sneakers = Image.open(p("sneakers.jpg")).convert("RGB")
jacket.resize((960, 857)).save(f"{out}/jacket.jpg", quality=92)
sneakers.resize((2400, 1392)).save(f"{out}/sneakers-large.jpg", quality=90)
bag.save(f"{out}/bag.png")
bag.save(f"{out}/bag.webp", quality=92)
bag.save(f"{out}/bag.bmp")
bag.save(f"{out}/bag.tiff")
# EXIF orientation 6: stored sideways, displayed upright as 900x870
exif = Image.Exif(); exif[0x0112] = 6
bag.transpose(Image.Transpose.ROTATE_90).save(f"{out}/bag-exif-rotated.jpg", quality=92, exif=exif.tobytes())
# PNG with partially transparent foreground on transparent background
im = Image.new("RGBA", (400, 300), (0, 0, 0, 0))
d = ImageDraw.Draw(im)
d.ellipse((100, 50, 300, 250), fill=(220, 40, 40, 255))
d.rectangle((180, 120, 220, 180), fill=(40, 40, 220, 128))
im.save(f"{out}/translucent.png")
# synthetic: solid object on plain background
im = Image.new("RGB", (640, 480), (235, 235, 235))
ImageDraw.Draw(im).rounded_rectangle((200, 120, 440, 360), 30, fill=(20, 110, 60))
im.save(f"{out}/synthetic.jpg", quality=95)
open(f"{out}/corrupt.jpg", "wb").write(b"\xff\xd8\xff\xe0" + os.urandom(2000))
open(f"{out}/not-an-image.jpg", "w").write("hello, this is plain text pretending to be a jpeg\n")
open(f"{out}/vector.svg", "w").write('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>')
# a "decompression bomb": tiny PNG header claiming 60000x60000
import struct, zlib
def chunk(t, d): return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 60000, 60000, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(b"\x00" * 1000)) + chunk(b"IEND", b"")
open(f"{out}/huge-dimensions.png", "wb").write(png)
print("ok")
