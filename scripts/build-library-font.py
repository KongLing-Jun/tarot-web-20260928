"""Subset an official Noto Serif SC font for the card library.

Usage: python scripts/build-library-font.py SOURCE_FONT OUTPUT_WOFF2
Requires fonttools and brotli. The source font is supplied locally, not downloaded.
"""
import sys
from pathlib import Path
from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

if len(sys.argv) != 3:
    raise SystemExit(__doc__)
root = Path(__file__).resolve().parents[1]
sources = ['app/library/page.tsx', 'components/cards/CardDetail.tsx', 'lib/tarot/cards.ts']
text = ''.join((root / source).read_text(encoding='utf-8') for source in sources)
brand = (root / 'miniprogram/brand.js').read_text(encoding='utf-8')
text += brand + brand.upper()  # Include canonical name and title/uppercase wordmarks.
font = TTFont(sys.argv[1])
if 'fvar' in font:
    font = instantiateVariableFont(font, {'wght': 400})
options = subset.Options()
options.flavor = 'woff2'
subsetter = subset.Subsetter(options=options)
subsetter.populate(text=text)
subsetter.subset(font)
for record in font['name'].names:
    if record.nameID in (1, 4, 6, 16):
        value = 'MiyingLibrarySerif' if record.nameID == 6 else 'Miying Library Serif'
        record.string = value.encode(record.getEncoding())
font.flavor = 'woff2'
destination = Path(sys.argv[2])
destination.parent.mkdir(parents=True, exist_ok=True)
font.save(destination)
print(f'Saved {len(font.getBestCmap())} code points to {destination}')
