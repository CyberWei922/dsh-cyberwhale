from pathlib import Path
import json
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT=Path(__file__).resolve().parent
BASE=ROOT.parents[2]/'individual-draft/idle_01.png'
src=Image.open(BASE).convert('RGBA')
A=np.asarray(src).copy()
DONORS={
 'gaze-a_04':'exec-2cd01659-512b-4751-9f18-3a1c44d04984.png',
 'waving_01':'exec-1611098e-7363-4af7-be01-e4ec833c7950.png',
 'running-right_02':'exec-f2359196-e8b8-45f7-bcda-389f5d50a9fe.png',
}
GEN=Path('/Users/wei/.codex/generated_images/01a0f084-2610-7c82-8591-be76395602bc')
donors={}
for name,file in DONORS.items():
 im=Image.open(GEN/file).convert('RGBA'); im.save(ROOT/(name+'-ai-source.png'))
 im=im.resize(src.size,Image.Resampling.LANCZOS)
 # Remove negligible generation residue from the transparent background.
 ar=np.asarray(im).copy(); ar[ar[:,:,3]<20]=0
 donors[name]=Image.fromarray(ar)

def polygon_mask(polys):
 m=Image.new('L',src.size,0);d=ImageDraw.Draw(m)
 for p in polys:d.polygon(p,fill=255)
 return m

def translate(im,dx,dy):
 return im.transform(src.size,Image.Transform.AFFINE,(1,0,-dx,0,1,-dy),Image.Resampling.BICUBIC)

def face_patch(base,donor,dx,dy):
 patch=np.asarray(translate(donor,dx,dy)).copy()
 weight=np.asarray(Image.open(ROOT.parent/'pixel-proof/face-mask-v2.png')).astype(float)/255
 # Retain the iris blues: the previous blink-only hair repair is unnecessary here.
 ar=np.asarray(base).copy()
 ar[:,:,:3]=np.rint(ar[:,:,:3]*(1-weight[:,:,None])+patch[:,:,:3]*weight[:,:,None]).astype('uint8')
 return Image.fromarray(ar),weight>0

reports=[]
outputs={}
def save_frame(name,out,support,notes):
 arr=np.asarray(out); changed=np.any(A!=arr,axis=2)
 bbox=out.getbbox()
 report={'name':name,'canvas':list(out.size),'mode':out.mode,
  'changed_pixels':int(changed.sum()),'changed_pixels_outside_edit_mask':int((changed&~support).sum()),
  'source_alpha_bbox':list(src.getbbox()),'output_alpha_bbox':list(bbox),
  'height_px':bbox[3]-bbox[1],'foot_y':bbox[3]-1,
  'passes_canvas_and_fixed_pixels':bool(out.size==(512,560) and not (changed&~support).any()),
  'passes_height_and_ground':bool(abs(bbox[3]-bbox[1]-477)<=2 and bbox[3]-1==534),
  'notes':notes,
  'limitation':'Pixel checks verify fixed regions and geometry; they do not certify frill counts or anatomical quality.'}
 reports.append(report);outputs[name]=out
 out.save(ROOT/(name+'.png'))
 Image.fromarray((support*255).astype('uint8')).save(ROOT/(name+'-edit-mask.png'))
 Image.blend(src,out,.5).save(ROOT/(name+'-overlay-50.png'))

# A: full-face patch registered to the original landmarks.
gaze,face_support=face_patch(src,donors['gaze-a_04'],-3,-1)
save_frame('gaze-a_04',gaze,face_support,'Only the face interior changes. Original hair, outline, mouth and body retained.')

# B: recover newly exposed pixels behind the old arm, then paste the raised arm.
wave=donors['waving_01']
old_arm=polygon_mask([[(184,315),(196,302),(198,331),(200,340),(179,365),(179,377),(162,393),(147,397),(129,386),(127,378),(139,368),(142,355),(159,348),(175,333)]])
new_arm=polygon_mask([[(136,267),(141,261),(145,266),(145,257),(151,255),(155,264),(158,256),(165,257),(167,273),(171,268),(176,267),(177,274),(170,290),(179,290),(183,298),(179,307),(180,317),(186,317),(198,310),(198,329),(187,335),(175,343),(161,338),(150,323),(145,311),(136,306),(134,297),(142,289)]])
old_soft=old_arm.filter(ImageFilter.GaussianBlur(2))
arm_mask=Image.fromarray(np.maximum(np.asarray(old_soft),np.asarray(new_arm)))
# Restore the original collar frills and waistband at the shoulder boundary.
am=np.asarray(arm_mask).copy()
rr,gg,bb=A[:,:,:3].astype(float).transpose(2,0,1)
protected=np.zeros(am.shape,bool)
protected[289:341,194:]=True
protected &= (rr>180)&(gg>180)&(bb>180)
am[protected]=0
am[332:348,200:]=0
arm_mask=Image.fromarray(am)
out=Image.composite(wave,src,arm_mask)
# Protect torso pixels at the shoulder join; the arm is the only patch.
support=np.asarray(arm_mask)>0
save_frame('waving_01',out,support,'Raised viewer-left arm. Original face, opposite arm, torso, apron, legs and tail retained outside arm mask. Revealed hair behind old arm is supplied by the generated patch.')

# C: move the generated legs onto the original ground baseline.
run=translate(donors['running-right_02'],0,4)
newlegs=polygon_mask([[(182,451),(238,451),(238,463),(224,475),(213,490),(204,502),(194,506),(181,505),(174,494),(175,471)],[(245,450),(286,450),(293,489),(308,510),(313,524),(310,534),(292,539),(276,535),(263,519),(257,495),(248,474)]])
# Alpha cleanup within legs only, keeping the tail separate.
pa=np.asarray(run).copy()
leg_support=np.asarray(newlegs)>0
pa[~leg_support]=0
pa[535:,:,:]=0
run_layer=Image.fromarray(pa)
ar=A.copy()
# Clear original legs but keep the original skirt ruffles, tail and opaque boundaries.
oldlegs=polygon_mask([[(188,451),(242,451),(245,535),(188,535)],[(241,451),(282,451),(283,535),(241,535)]])
erase=np.asarray(oldlegs)>0
# Source tail begins on the right of the stocking; retain those pixels.
erase[:,281:]=False
# Preserve the actual skirt/frill pixels at the upper joint.
erase[:453]=False
ar[erase]=0
out=Image.alpha_composite(Image.fromarray(ar),run_layer)
# Restore the source skirt as the foreground layer at the thigh joints.
ar=np.asarray(out).copy()
ar[:453]=A[:453]
out=Image.fromarray(ar)
out,face_support=face_patch(out,donors['gaze-a_04'],-3,-1)
support=erase|leg_support|face_support
save_frame('running-right_02',out,support,'Rightward gaze and one walking phase. Skirt and apron remain original; generated legs are composited below the hem. No upward body shift, following the fixed-height priority.')

(ROOT/'validation.json').write_text(json.dumps(reports,ensure_ascii=False,indent=2)+'\n')
board=Image.new('RGB',(2048,600),(230,233,240));d=ImageDraw.Draw(board)
for i,(name,im) in enumerate([('REFERENCE',src)]+list(outputs.items())):
 d.text((i*512+16,12),name,fill=(35,45,65));board.paste(im,(i*512,36),im)
board.save(ROOT/'comparison.png')
print(json.dumps(reports,ensure_ascii=False,indent=2))
