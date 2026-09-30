from pathlib import Path
import json
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

root=Path(__file__).resolve().parent
src=Image.open(root/'idle_01.png').convert('RGBA')
donor_path=Path('/Users/wei/.codex/generated_images/01a0f084-2610-7c82-8591-be76395602bc/exec-eed70227-f9dc-4882-ab3c-481764767533.png')
donor=Image.open(donor_path).convert('RGBA')
donor.save(root/'face-v2-ai-source.png')
# Register the generated face to the original mouth and facial contour.
factor=512/donor.width
registered=donor.transform(src.size,Image.Transform.AFFINE,(1/factor,0,-6/factor,0,1/factor,-2/factor),Image.Resampling.BICUBIC)
a=np.asarray(src).copy()
r,g,b=a[:,:,:3].astype(float).transpose(2,0,1)
skin=(r>175)&(g>110)&(r>g*1.025)&(r>b*1.08)
region=np.zeros((560,512),bool)
region[181:282,169:301]=True
mask=Image.fromarray(((skin&region)*255).astype('uint8'))
d=ImageDraw.Draw(mask)
# Include the old eyes fully, so no old eyelash or iris outline survives.
for poly in [
 [(171,223),(179,217),(188,212),(198,212),(207,217),(212,223),(215,233),(216,244),(212,250),(203,254),(188,254),(179,249),(174,241)],
 [(251,223),(256,216),(265,211),(277,210),(287,215),(292,221),(296,221),(295,231),(291,241),(286,249),(277,253),(265,253),(257,249),(253,241)],
]: d.polygon(poly,fill=255)
# Retain the original mouth and face outline. Only visible interior skin is replaced.
d.rectangle((220,255,247,273),fill=0)
support=np.asarray(mask)>0
support |= np.asarray(Image.open(root/'edit-mask.png'))>0
soft=mask.filter(ImageFilter.MinFilter(7)).filter(ImageFilter.GaussianBlur(3.0))
w=np.asarray(soft).astype(float)/255
w[~support]=0
# Keep removal of the original eyes opaque; feather only the face perimeter.
eyes=Image.open(root/'edit-mask.png')
w[np.asarray(eyes)>0]=1
# Keep the reference's forehead and its fine junction with the bangs.
w[:210,:]=0
patch=np.asarray(registered).copy()
# Generated bangs must never be pasted into original skin. Extend adjacent skin there.
pr,pg,pb=patch[:,:,:3].astype(float).transpose(2,0,1)
blue=(pb>pr*1.08)&(pb>pg*1.02)&(pr>40)&(pg>65)&support
for y,x in zip(*np.where(blue)):
    candidates=[xx for xx in range(max(169,x-30),min(301,x+31)) if patch[y,xx,0]>190 and patch[y,xx,0]>patch[y,xx,2]*1.08 and patch[y,xx,1]>160]
    if candidates:
        xx=min(candidates,key=lambda xx:abs(xx-x))
        patch[y,x,:3]=patch[y,xx,:3]
    else: patch[y,x,:3]=[253,233,217]
out_arr=a.copy()
out_arr[:,:,:3]=np.rint(a[:,:,:3]*(1-w[:,:,None])+patch[:,:,:3]*w[:,:,None]).astype('uint8')
out=Image.fromarray(out_arr)
out.save(root/'idle_03-v2.png')
Image.fromarray(np.rint(w*255).astype('uint8')).save(root/'face-mask-v2.png')
changed=np.any(a!=out_arr,axis=2)
report={'canvas':list(out.size),'alpha_identical':bool(np.array_equal(a[:,:,3],out_arr[:,:,3])),
 'changed_pixels_outside_face_mask':int(np.sum(changed&~support)),
 'source_alpha_bbox':list(src.getbbox()),'output_alpha_bbox':list(out.getbbox()),
 'height_px':out.getbbox()[3]-out.getbbox()[1],'foot_y':out.getbbox()[3]-1,
 'method':'AI face redraw, registered and composited inside original face mask; original mouth retained.',
 'passed_pixel_invariants':bool(not np.any(changed&~support) and np.array_equal(a[:,:,3],out_arr[:,:,3]))}
(root/'validation-v2.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
board=Image.new('RGB',(1536,594),(230,233,240))
d=ImageDraw.Draw(board)
for i,(im,label) in enumerate([(src,'REFERENCE'),(Image.open(root/'idle_03.png'),'V1 EYES ONLY'),(out,'V2 FACE COMPOSITE')]):
 d.text((i*512+16,10),label,fill=(35,45,65));board.paste(im,(i*512,34),im)
board.save(root/'comparison-v2.png')
out.crop((160,195,302,285)).resize((710,450)).save(root/'face-after-v2.png')
print(json.dumps(report,ensure_ascii=False,indent=2))
