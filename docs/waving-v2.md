# 挥手动画第二版

> 挥手素材已由[第三版左右摆动](waving-v3.md)替代，下面保留第二版生成记录。

旧要求最后的“只有手臂在动”过于严格；新版允许轻微歪头、笑眼、肩部和头发/尾巴的跟随，腿脚继续站稳，保持角色、服装、尺度一致。

旧播放是一轮 700ms，在 1800ms 的 greeting 状态中循环，因此会反复举手、收手。新版保留图集第 3 行的四帧，以 0→1→2→1→2→1→0→3 顺序单次播放；各段时长为 260、340、320、320、320、340、300、400ms，总计 2600ms。宿主保留 2800ms，给最后收手及消息下发留余量。渲染器结束后保持末帧，直到宿主回到原任务状态；连续点击招呼会重新起播。

素材使用内置 image_gen 工具，以 `assets/portrait.png` 为角色参考。成品安装在 `assets/spritesheet.png`，仅替换第 3 行前四格，其余像素全部保持一致。源图和预览保存在 `output/waving-v2/`；该目录沿用仓库规则，不提交 Git。

安装方式：`node tools/replace-waving-row.mjs output/waving-v2/source.png`。统一按中立帧计算缩放，以脚部中心对齐原待机，避免逐帧缩放导致抖动。

## 生成提示词

Use case: identity-preserve. Edit the reference blue-haired chibi whale maid into a production animation sprite sheet for a desktop pet greeting. Output exactly FOUR full-body sprites on a transparent canvas arranged in an evenly spaced 2 by 2 grid of equal square cells, no labels, no grid lines. Each figure same scale (about 80% cell height), same center and foot baseline within its cell, generous empty margins, not cropped. Preserve exact reference identity, blue hair locks, white maid headband, bow placement, whale tail on viewer right, dress, apron whale emblem, stocking and shoe details, face proportions and illustration style. Change only expressive greeting poses. Legs and feet remain planted in exactly the same stance. Top left frame 0: gentle anticipation, her right hand (viewer left) halfway raised near shoulder, slight warm head tilt, soft smile. Top right frame 1: same right hand up beside temple waving outward, open palm, shoulders lift slightly with enthusiasm, bright friendly smile, head tilt 3 degrees. Bottom left frame 2: raised palm swings inward near face (not covering face), head gently nods the other way, smile and cheerful slightly squinted eyes, subtle hair follow through. Bottom right frame 3: hand lowered back to original neutral pose, head returns nearly upright, relaxed smile, coherent recovery. Waving hand has clear fingers, anatomy clean; left hand remains relaxed at side. Body may lean 2 degrees, hair and tail may follow slightly, never change character size or outfit design. Four continuous poses of the SAME character, not four variants. True transparent alpha background; no shadows on floor, no props, no text, no watermarks.
