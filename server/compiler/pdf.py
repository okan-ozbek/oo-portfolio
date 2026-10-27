"""Inspect the compiled PDF and replace URI annotations without changing page layout."""
import sys, json, hashlib
from pypdf import PdfReader, PdfWriter
from pypdf.generic import NameObject, TextStringObject

def annotations(page):
    value = page.get('/Annots')
    return value.get_object() if value is not None else []

mode, source = sys.argv[1:3]
reader = PdfReader(source, strict=False)
if reader.is_encrypted or not 1 <= len(reader.pages) <= 30:
    raise ValueError('Resumes must have 1–30 unencrypted pages.')
if mode == 'rewrite':
    mapping = json.load(open(sys.argv[4], encoding='utf8'))
    writer = PdfWriter()
    writer.clone_document_from_reader(reader)
    # Do not carry active document actions or embedded files into a public resume.
    for key in ['/OpenAction', '/AA']:
        writer._root_object.pop(NameObject(key), None)
    if '/Names' in writer._root_object:
        names = writer._root_object['/Names'].get_object()
        for key in ['/JavaScript', '/EmbeddedFiles']:
            names.pop(NameObject(key), None)
    for page in writer.pages:
        page.pop(NameObject('/AA'), None)
        for ref in annotations(page):
            annotation = ref.get_object()
            annotation.pop(NameObject('/AA'), None)
            action = annotation.get('/A')
            if action:
                action = action.get_object()
                if action.get('/S') == '/URI':
                    uri = str(action.get('/URI', ''))
                    if uri in mapping:
                        action[NameObject('/URI')] = TextStringObject(mapping[uri])
                elif action.get('/S') != '/GoTo':
                    annotation.pop(NameObject('/A'), None)
    with open(sys.argv[3], 'wb') as stream:
        writer.write(stream)
    reader = PdfReader(sys.argv[3])

links = {}
for number, page in enumerate(reader.pages, 1):
    for ref in annotations(page):
        action = ref.get_object().get('/A')
        if not action or action.get_object().get('/S') != '/URI':
            continue
        uri = str(action.get_object().get('/URI', ''))
        if not uri or len(uri) > 2048:
            continue
        if uri not in links:
            links[uri] = dict(key=hashlib.sha256(uri.encode()).hexdigest()[:24], destination=uri, occurrences=0, pages=[])
        links[uri]['occurrences'] += 1
        if number not in links[uri]['pages']:
            links[uri]['pages'].append(number)
if len(links) > 100:
    raise ValueError('A resume can contain at most 100 different destinations.')
print(json.dumps(dict(pages=len(reader.pages), links=list(links.values()))))
