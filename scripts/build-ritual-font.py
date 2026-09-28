"""Build the scoped ritual font from a locally supplied official Noto Serif CJK source.

Usage: python scripts/build-ritual-font.py SOURCE_FONT OUTPUT_WOFF2
Install fonttools and brotli in the local Python environment first.
Source revision and license are recorded beside the generated font.
"""
import sys
from pathlib import Path
from fontTools import subset
from fontTools.ttLib import TTFont

if len(sys.argv) != 3:
    raise SystemExit(__doc__)
root = Path(__file__).resolve().parents[1]
text = '我可以如何更清楚地表达自己的想法？'
brand = (root / 'miniprogram/brand.js').read_text(encoding='utf-8')
text += brand + brand.upper()  # Include canonical name and title/uppercase wordmarks.
for source in [root / 'app/reading/page.tsx', *sorted((root / 'components').rglob('*.tsx')), *sorted((root / 'lib/tarot').glob('*.ts'))]:
    text += source.read_text(encoding='utf-8')
font = TTFont(sys.argv[1])
options = subset.Options()
options.flavor = 'woff2'
subsetter = subset.Subsetter(options=options)
subsetter.populate(text=text)
subsetter.subset(font)
font.flavor = 'woff2'
font.save(sys.argv[2])
print(f'Saved {len(font.getBestCmap())} Unicode code points to {sys.argv[2]}')
