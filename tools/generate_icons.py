"""Render the existing geometric SVG design as iOS/PWA PNG icons."""
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[1] / "dist" / "icons"
root.mkdir(parents=True, exist_ok=True)


def bezier(a, b, c, d):
    return [tuple((1-t)**3*a[k] + 3*(1-t)**2*t*b[k] + 3*(1-t)*t*t*c[k] + t**3*d[k] for k in range(2)) for t in [i/100 for i in range(101)]]


points = bezier((256,100),(206,169),(140,240),(140,303))
points += bezier((140,303),(140,367),(192,419),(256,419))
points += bezier((256,419),(320,419),(372,367),(372,303))
points += bezier((372,303),(372,240),(306,169),(256,100))
for name, size in [("apple-touch-icon",180),("icon-192",192),("icon-512",512)]:
    scale = size * 4 / 512
    image = Image.new("RGB", (size*4,size*4), "#075e60")
    draw = ImageDraw.Draw(image)
    draw.polygon([(round(x*scale),round(y*scale)) for x,y in points], fill="#e7f3ed")
    for a,b in [((211,303),(301,303)),((256,258),(256,348))]:
        draw.line([(round(x*scale),round(y*scale)) for x,y in [a,b]], fill="#075e60", width=round(22*scale))
        for x,y in [a,b]:
            draw.ellipse(((x-11)*scale,(y-11)*scale,(x+11)*scale,(y+11)*scale), fill="#075e60")
    image.resize((size,size), Image.Resampling.LANCZOS).save(root / f"{name}.png")
print("Generated 180, 192 and 512 px icons")
