"""Validate actual generated output with pyx12's independent HIPAA 5010 maps.

Use a text ack stream because the PyPI 2.3.3 CLI incorrectly opens its 999
output in binary mode on Python 3. This changes no validation rules or verdict.
"""
import io
import logging
import sys
import pyx12.params
import pyx12.x12n_document

logging.basicConfig(level=logging.WARNING)
valid = True
for filename in sys.argv[1:]:
    ack = io.StringIO()
    with open(filename, encoding="ascii") as source:
        result = pyx12.x12n_document.x12n_document(
            param=pyx12.params.params(), src_file=source,
            fd_997=ack, fd_html=None, fd_xmldoc=None, xslt_files=None,
        )
    print(f"PYX12_5010 {filename}: {'PASS' if result else 'FAIL'}")
    valid = valid and result
sys.exit(0 if valid else 1)
