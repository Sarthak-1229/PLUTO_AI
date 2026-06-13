// Crop individual poses from pluto-sprites.png
// Image is 1024x1193, 3x3 grid with text labels at the bottom of each cell
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const assetsDir = path.join(__dirname, 'assets');
if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir);

async function crop() {
  const meta = await sharp('pluto-sprites.png').metadata();
  console.log(`Source image: ${meta.width}x${meta.height}`);

  // Image is 1024 x 1193, 3 columns x 3 rows
  // Each cell is ~341 x 397
  // Text labels at BOTTOM of each cell (~60px tall including spacing)
  // For row 0: no top offset needed. For rows 1,2: skip the text from previous row's bottom
  
  const cellW = Math.floor(meta.width / 3);   // 341
  const cellH = Math.floor(meta.height / 3);  // 397
  
  // Row 0 text bleeds into top of row 1, etc.
  // Safe approach: for row>0, start 60px into the cell (skip prev row's label),
  // and for all rows, end 60px before bottom (skip this row's label)
  const topPad = 60;   // skip text label area from previous row
  const botPad = 60;   // skip text label area for this row

  const poses = [
    { name: 'idle',    col: 0, row: 0 },
    { name: 'blink',   col: 1, row: 0 },
    { name: 'happy',   col: 2, row: 0 },
    { name: 'sleep',   col: 0, row: 1 },
    { name: 'sad',     col: 1, row: 1 },
    { name: 'walk',    col: 2, row: 1 },
    { name: 'sleep2',  col: 0, row: 2 },
    { name: 'sad2',    col: 1, row: 2 },
    { name: 'walk2',   col: 2, row: 2 },
  ];

  for (const p of poses) {
    const left = p.col * cellW;
    // For row 0, start at top. For other rows, skip label text area
    const topOffset = p.row === 0 ? 0 : topPad;
    const top = p.row * cellH + topOffset;
    const spriteH = cellH - botPad - topOffset;
    
    // Ensure we don't exceed image bounds
    const extractH = Math.min(spriteH, meta.height - top);
    const extractW = Math.min(cellW, meta.width - left);
    
    const outPath = path.join(assetsDir, `pluto-${p.name}.png`);

    await sharp('pluto-sprites.png')
      .extract({ left, top, width: extractW, height: extractH })
      .png()
      .toFile(outPath);

    console.log(`Cropped: ${p.name} -> ${outPath} (${extractW}x${extractH} from ${left},${top})`);
  }

  console.log('\nDone! All sprites saved to assets/');
}

crop().catch(console.error);
