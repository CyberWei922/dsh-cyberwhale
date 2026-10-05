# 向下注视的眼睛修复

本次使用内置 `image_gen` 编辑现有素材，修复 112.5°、135°、157.5°、180°、202.5°、225°、247.5° 共七个方向。旧的蓝色阈值分割把部分眼线包含进虹膜层，向下位移后形成重复深色弧线与白缝。

最终运行时文件为 `assets/spritesheet.png`（2816 × 4235，每格 352 × 385）。仅修改第 9 行第 5–7 格、第 10 行第 0–3 格的眼睛局部，行列从 0 开始计数；其余像素与所有 alpha 值逐像素验证不变。只读取和检查图片、运行无界面验证，没有操作桌面应用。

生成源图、原图备份、接图脚本、放大对比和像素验证记录保存在本地 `output/gaze-repair-v2/`。`generated.png` 是 AI 修复后的供体，`integrate.mjs` 按现有图集定位眼睛，先清除旧处理残留，再接入供体的眼睛内部；不再使用颜色阈值移动睫毛。生成源图不能整张替换原图集。旧 `regenerated-pet-2026-09-30/tools/build_frames.py` 为历史生成脚本，不能用其中的 `look()` 覆盖本次修复。

- 生成源图 SHA-256：`4bdfd63ecf1aed37e55a51c552ff0c0804887dd9b08cdd6940105e781f7105aa`
- 完成时图集 SHA-256：`e950bf8f59011bed6f858944769b6c535ecc50671533c6b94175d2aa9b8bd540`
- 完整画面检查：修复方向与相邻未改方向的排列见本地 `output/gaze-repair-v2/directions.png`。

## 生成提示词

Use case: precise-object-edit / identity-preserve. Asset type: production gaze sprite sheet repair. Edit the attached 1024x512 transparent sheet IN PLACE. It contains exactly 8 same-size chibi blue-haired whale maid head-and-shoulder sprites in a rigid 4-column x 2-row equal 256px cell grid. Preserve this exact canvas, grid, positions, proportions, pixel-art/anime painting style, hair, single upper lash contour, face shape, mouth, costume, colors, and transparent alpha. ONLY repair the interiors of the TWO EYES in the first SEVEN cells. The bottom-right eighth sprite is the untouched neutral reference. In the current seven sprites, a mistaken displaced copy of the upper lash creates a dark second arch inside each eye separated by a pale white stripe. Remove that duplicated inner arch and unnatural stripe: each eye must have ONE fixed upper eyelid/lash, continuous natural white sclera and a single smoothly painted blue iris/pupil with coherent highlights. Keep the original round open-eye shape and large blue irises. Do not add eyebrows, double eyelids, squinting, or sleepy eyes. Preserve the following subtle gaze directions (viewer coordinates) in reading order: top row 1 down-right shallow (112.5 degrees from up clockwise), 2 down-right (135), 3 down and slightly right (157.5), 4 straight down (180). Bottom row 1 down and slightly left (202.5), 2 down-left (225), 3 left and slightly down (247.5), 4 neutral original unchanged. Both eyes look toward the same target, with small restrained iris offsets, never cross-eyed. The iris is naturally clipped by the fixed eyelid aperture. Do not move the eyelashes or distort the eye outline to indicate direction. No head turns or tilts. Every sprite has identical fixed head geometry. Keep everything outside the interior of the two eyes identical to the attached image. No labels, no text, no cell borders, no new shadows, no background. This is a surgical repair of eye artwork for an existing game animation, not a character redesign.

