from pathlib import Path
import json
import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT.parents[2] / 'individual-draft/idle_01.png'
src = Image.open(SOURCE).convert('RGBA')
scale = 4

def bezier(points, n=80):
    p = np.asarray(points, dtype=float)
    return [tuple(((1-t)**3*p[0]+3*(1-t)**2*t*p[1]+3*(1-t)*t*t*p[2]+t**3*p[3])*scale) for t in np.linspace(0,1,n)]

# The masks follow the visible eye outlines and exclude the hair and eyebrows.
contours = [
    [(171,223),(179,217),(188,212),(198,212),(207,217),(212,223),(215,233),(216,244),(212,250),(203,254),(188,254),(179,249),(174,241)],
    [(251,223),(256,216),(265,211),(277,210),(287,215),(292,221),(296,221),(295,231),(291,241),(286,249),(277,253),(265,253),(257,249),(253,241)],
]
mask_hi = Image.new('L', (512*scale,560*scale),0)
md = ImageDraw.Draw(mask_hi)
for contour in contours:
    md.polygon([(x*scale,y*scale) for x,y in contour],fill=255)
mask = mask_hi.resize(src.size,Image.Resampling.LANCZOS)
# Clamp antialias ringing to a narrow, explicit eye-only editing boundary.
mask_arr = np.asarray(mask).copy()
mask_arr[mask_arr < 5] = 0
mask = Image.fromarray(mask_arr)

patch = Image.new('RGBA',src.size)
arr = np.zeros((560,512,4),dtype=np.uint8)
for y in range(560):
    t = np.clip((y-210)/46,0,1)
    color = np.array([255,235,219])*(1-t)+np.array([255,227,209])*t
    arr[y,:,:3] = color.astype(np.uint8)
    arr[y,:,3] = 255
patch = Image.fromarray(arr).resize((512*scale,560*scale))
draw = ImageDraw.Draw(patch)
ink = (17,28,60,255)
for points in [
    [(175,236),(185,229),(203,228),(213,234)],
    [(254,234),(265,227),(282,228),(292,235)],
]:
    draw.line(bezier(points), fill=ink, width=3*scale)
# Tapered lash ends keep the reference's dark-blue drawing style.
for triangle in [
    [(175,236),(172,231),(183,233)],
    [(178,234),(176,229),(186,232)],
    [(292,235),(296,230),(284,232)],
    [(289,233),(291,228),(281,231)],
]:
    draw.polygon([(x*scale,y*scale) for x,y in triangle],fill=ink)
patch = patch.resize(src.size,Image.Resampling.LANCZOS)
out = Image.composite(patch,src,mask)
# Explicitly retain original alpha throughout, including edited pixels.
out.putalpha(src.getchannel('A'))
out.save(ROOT/'idle_03.png')
src.save(ROOT/'idle_01.png')
mask.save(ROOT/'edit-mask.png')
a,b = np.asarray(src),np.asarray(out)
changed = np.any(a!=b,axis=2)
outside = mask_arr==0
ys,xs = np.where(changed)
report = {
    'source':str(SOURCE), 'output':str(ROOT/'idle_03.png'),
    'method':'Deterministic local composite; no AI-generated material used.',
    'canvas':list(out.size),'mode':out.mode,
    'alpha_identical':bool(np.array_equal(a[:,:,3],b[:,:,3])),
    'source_alpha_bbox':list(src.getbbox()),'output_alpha_bbox':list(out.getbbox()),
    'height_px':out.getbbox()[3]-out.getbbox()[1], 'foot_y':out.getbbox()[3]-1,
    'changed_pixels':int(changed.sum()),
    'changed_pixels_outside_mask':int(changed[outside].sum()),
    'change_bbox':[int(xs.min()),int(ys.min()),int(xs.max()+1),int(ys.max()+1)],
    'passed':bool(out.size==(512,560) and np.array_equal(a[:,:,3],b[:,:,3]) and not changed[outside].any()),
    'scope':'Validates blinking/local editing only; does not validate waving or walking.',
}
(ROOT/'validation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
# Comparison on a neutral backdrop for human inspection.
board=Image.new('RGB',(1024,594),(230,233,240))
d=ImageDraw.Draw(board)
d.text((16,10),'REFERENCE',fill=(35,45,65))
d.text((528,10),'LOCAL BLINK EDIT',fill=(35,45,65))
board.paste(src,(0,34),src)
board.paste(out,(512,34),out)
board.save(ROOT/'comparison.png')
overlay=Image.blend(src,out,0.5)
overlay.save(ROOT/'overlay-50.png')
out.crop((160,195,302,275)).resize((852,480)).save(ROOT/'face-after.png')
print(json.dumps(report,ensure_ascii=False,indent=2))
