const path = require('path');
const PptxGenJS = require('pptxgenjs');
const html2pptx = require('/root/.codex/skills/pptx/scripts/html2pptx.js');

async function build() {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';
  pptx.author = 'Strato Space';
  pptx.company = 'Strato Space';
  pptx.subject = 'Copilot marketing discovery presentation';
  pptx.title = 'Copilot Marketing Deck';
  pptx.lang = 'ru-RU';

  const slides = [
    'slide01.html',
    'slide02.html',
    'slide03.html',
    'slide04.html',
    'slide05.html',
    'slide06.html',
    'slide07.html',
    'slide08.html',
    'slide09.html',
    'slide10.html'
  ];

  for (const file of slides) {
    await html2pptx(path.join(__dirname, 'slides', file), pptx);
  }

  const outDir = path.join('/home/strato-space/copilot', 'output');
  const outFile = path.join(outDir, 'copilot-marketing-discovery-2026-03-03.pptx');
  await pptx.writeFile({ fileName: outFile });
  process.stdout.write(`${outFile}\n`);
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
