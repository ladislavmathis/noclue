"""Renders PRIVACY.md to docs/site/privacy.html. Run: python3 -I scripts/build-privacy-page.py"""
import html
import pathlib
import re

root = pathlib.Path(__file__).resolve().parent.parent
md = (root / 'PRIVACY.md').read_text(encoding='utf-8')


def inline(t):
    t = html.escape(t, quote=False)
    t = re.sub(r'`([^`]+)`', r'<code>\1</code>', t)
    t = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', t)
    t = re.sub(r'^_(.+)_$', r'<em>\1</em>', t)
    t = re.sub(r'(https://[^\s)<]+)', r'<a href="\1">\1</a>', t)
    return t


out = []
for block in md.strip().split('\n\n'):
    lines = block.split('\n')
    if block.startswith('# '):
        out.append(f'<h1>{inline(block[2:])}</h1>')
    elif block.startswith('## '):
        out.append(f'<h2>{inline(block[3:])}</h2>')
    elif lines[0].startswith('|'):
        rows = [[c.strip() for c in l.strip('|').split('|')] for l in lines if not re.match(r'^\|\s*-', l)]
        head = ''.join(f'<th>{inline(c)}</th>' for c in rows[0])
        body = ''.join('<tr>' + ''.join(f'<td>{inline(c)}</td>' for c in r) + '</tr>' for r in rows[1:])
        out.append(f'<div class="table-scroll"><table><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table></div>')
    elif lines[0].startswith('- '):
        items, cur = [], ''
        for l in lines:
            if l.startswith('- '):
                if cur:
                    items.append(cur)
                cur = l[2:]
            else:
                cur += ' ' + l.strip()
        items.append(cur)
        out.append('<ul>' + ''.join(f'<li>{inline(i)}</li>' for i in items) + '</ul>')
    else:
        out.append(f'<p>{inline(" ".join(l.strip() for l in lines))}</p>')

body = '\n'.join(out)
page = f'''<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>noclue privacy policy</title>
    <link rel="icon" href="img/favicon.svg" />
    <link rel="stylesheet" href="style.css" />
  </head>
  <body>
    <div class="wrap">
      <header class="top"><a class="logo" href="./"><img src="img/noclue-icon.svg" alt="" />noclue</a><nav><a href="./">Home</a></nav></header>
      <main class="prose">
{body}
      </main>
      <footer><span>noclue by <a href="https://ignition.sk">ignition.sk</a></span><span>Generated from PRIVACY.md</span></footer>
    </div>
  </body>
</html>
'''
(root / 'docs/site/privacy.html').write_text(page, encoding='utf-8')
print('wrote docs/site/privacy.html')
