from pathlib import Path
import json
import numpy as np
from PIL import Image, ImageDraw

root=Path(__file__).resolve().parent
src=Image.open(root.parents[2]/'individual-draft/idle_01.png').convert('RGBA')
a=np.asarray(src)
names=['gaze-a_04','waving_01','running-right_02']
# Independent original-image anchors, not derived from the editing masks.
anchors={
 'hair_and_headdress_top':(90,58,395,180),
 'right_hair_bow':(317,176,372,212),
 'brooch_and_collar_center':(215,287,263,327),
 'waistband_center':(208,331,273,343),
 'apron_whale':(229,377,274,418),
}
results=[]
ims=[]
for name in names:
 im=Image.open(root/(name+'.png')).convert('RGBA');b=np.asarray(im);ims.append(im)
 anchor_results={}
 fixed=np.zeros(a.shape[:2],bool)
 for label,(x0,y0,x1,y1) in anchors.items():
  aa=a[y0:y1,x0:x1];bb=b[y0:y1,x0:x1]
  anchor_results[label]={'changed_pixels':int(np.any(aa!=bb,axis=2).sum()),'box':[x0,y0,x1,y1]}
  fixed[y0:y1,x0:x1]=a[y0:y1,x0:x1,3]>200
 ys,xs=np.where(fixed)
 candidates=[]
 for dy in range(-6,7):
  for dx in range(-6,7):
   error=np.abs(a[ys,xs].astype(float)-b[ys+dy,xs+dx].astype(float)).mean()
   candidates.append((float(error),dx,dy))
 candidates.sort()
 # Alpha centroid is intentionally allowed to move when limbs move.
 def centroid(im):
  al=np.asarray(im)[:,:,3].astype(float);y,x=np.indices(al.shape)
  return [float((x*al).sum()/al.sum()),float((y*al).sum()/al.sum())]
 results.append({'name':name,'size':list(im.size),'alpha_bbox':list(im.getbbox()),
  'fixed_anchors':anchor_results,
  'best_anchor_translation_px':list(candidates[0][1:]),
  'best_anchor_rgba_error':candidates[0][0],
  'next_best_translation_error':candidates[1][0],
  'source_alpha_centroid':centroid(src),'output_alpha_centroid':centroid(im),
  'interpretation':'Unchanged anchors remain at identical canvas coordinates. Alpha centroid shifts due to the local pose, not a whole-character translation.'})

# All panels share a single fixed canvas. Alternate source and sample in place.
frames=[]
for images in [[src]*3,ims]:
 board=Image.new('RGB',(1536,594),(230,233,240));d=ImageDraw.Draw(board)
 for i,(name,im) in enumerate(zip(names,images)):
  d.text((i*512+12,10),name,fill=(35,45,65))
  board.paste(im,(i*512,34),im)
  d.line((i*512+70,568,i*512+445,568),fill=(165,174,186))
 frames.append(board)
# Shared palette prevents changing background colors during playback.
palette=frames[0].quantize(colors=255)
frames=[im.quantize(palette=palette,dither=Image.Dither.NONE) for im in frames]
frames[0].save(root/'fixed-position-toggle.gif',save_all=True,append_images=frames[1:],duration=[900,900],loop=0,disposal=2)
(root/'alignment-check.json').write_text(json.dumps(results,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(results,ensure_ascii=False,indent=2))
