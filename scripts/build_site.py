"""Create an isolated static artifact; the editable website stays at repo root."""
from html.parser import HTMLParser
from pathlib import Path
import shutil
import tempfile
from urllib.parse import unquote, urlsplit
from validate_data import validate_data

ROOT = Path(__file__).resolve().parents[1]


class Assets(HTMLParser):
    def __init__(self):
        super().__init__()
        self.paths = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        key = 'src' if tag in ('script', 'img') else 'href' if tag == 'link' else None
        if key and attrs.get(key):
            self.paths.append(attrs[key])


def build_site(root=ROOT):
    root = root.resolve()
    for required in ('index.html', 'assets', 'data/snapshot.json', 'data/manifest.json'):
        if not (root / required).exists():
            raise ValueError('Falta un archivo necesario para publicar: ' + required)
    parser = Assets()
    parser.feed((root / 'index.html').read_text(encoding='utf-8'))
    for ref in parser.paths:
        url = urlsplit(ref)
        if url.scheme or url.netloc or not url.path:
            continue
        if url.path.startswith('/'):
            raise ValueError('Usa rutas relativas para funcionar en /macro/: ' + ref)
        path = (root / unquote(url.path)).resolve()
        if not path.is_relative_to(root) or not path.is_file():
            raise ValueError('Recurso local no encontrado: ' + ref)
    staging = Path(tempfile.mkdtemp(prefix='.macro-build-', dir=root))
    try:
        shutil.copy2(root / 'index.html', staging / 'index.html')
        for folder in ('assets', 'data'):
            shutil.copytree(root / folder, staging / folder)
        (staging / '.nojekyll').touch()
        output = root / 'dist'
        if output.exists():
            shutil.rmtree(output)
        staging.rename(output)
    finally:
        if staging.exists():
            shutil.rmtree(staging)
    return output


if __name__ == '__main__':
    print(validate_data())
    print('Web lista para publicar:', build_site())
