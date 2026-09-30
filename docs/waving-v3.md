# 左右挥手与待机眨眼

> 当前招手素材已更新为[自然招手版](waving-v5.md)，原比例短手臂、自然屈肘、小幅左右摆动。6 秒眨眼时序保持。

本版替换了第二版挥手素材：举手后保持手掌高度基本稳定，前臂、手腕向左右摆动，不再用上下移动和点头作为挥手。准备和收手各播放一次，中间左右摆动两次；沿用 2600ms 单次播放和 2800ms 宿主状态时长。

待机眨眼周期从 1100ms 改为 6000ms，只延长睁眼帧，眨眼过渡仍为 110、110、140、140ms。其他状态的节奏保持原样。

使用内置 image_gen 编辑 `output/waving-v2/source.png`，新源图及预览保存到 `output/waving-v3/`。运行时成品为 `assets/spritesheet.png`；安装工具验证仅第 3 行前四格像素发生变化。

安装命令：`node tools/replace-waving-row.mjs output/waving-v3/source.png assets/spritesheet.png output/waving-v3`。

## 生成提示词

Use case: identity-preserve. Edit this exact transparent 2x2 desktop pet greeting sprite sheet. Preserve character identity, art style, scale, outfit, face proportions, blue hair, headband, whale tail, dress and apron emblem. Four full-body poses, equal 2x2 cells, transparent alpha, no cropping, no text. CRITICAL correction: middle poses top-right and bottom-left must show SIDE-TO-SIDE HORIZONTAL WAVING, never up-down arm pumping. In both poses the SAME right hand (viewer left) is held at EYE LEVEL, fingers upright, palm facing viewer, elbow bent and held at exactly the SAME shoulder-height position, upper arm and shoulder fixed. Top-right: forearm and palm lean OUTWARD to viewer left; palm center horizontally left of shoulder, fingertips around eye-level. Bottom-left: forearm and palm lean INWARD to viewer right, hand beside cheek without covering eyes. Palm center and fingertips must have the SAME VERTICAL HEIGHT as top-right (within a few pixels), but horizontal displacement clearly visible. This is a hand oscillating left/right like a metronome, wrist gently tilts left/right; do NOT lower the hand in bottom-left. Same OPEN eyes and friendly small smile in BOTH wave extremes; head position nearly identical, no nodding. Top-left preparation: hand near upper chest, elbow bent preparing to lift. Bottom-right recovery: hand relaxed down and original neutral stance. All figures aligned same foot baseline within each cell and same full-body height, head size, leg length, camera; feet planted, no body bounce. All other artwork and character details unchanged. Transparent background.
