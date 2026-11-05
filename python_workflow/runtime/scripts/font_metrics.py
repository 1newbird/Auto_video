"""Extract actual advances from the bundled font for deterministic layout."""
import json
import sys
from fontTools.ttLib import TTFont

with TTFont(sys.argv[1]) as font:
    advances = font['hmtx'].metrics
    print(json.dumps({'unitsPerEm': font['head'].unitsPerEm,
        'widths': {str(cp): advances[glyph][0] for cp, glyph in font.getBestCmap().items()}}))
