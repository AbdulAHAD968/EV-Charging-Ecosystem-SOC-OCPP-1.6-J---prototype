"""Build the final, professionally formatted EV-SOC report: cover page, auto table of
contents, headers/footers with page numbers, then the body converted from report.md.
Usage: python3 build_report.py report.md EV_SOC_Report.docx
"""
import re, sys, os, datetime
from docx import Document
from docx.shared import Pt, Inches, RGBColor, Cm
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.section import WD_SECTION
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

NAVY = RGBColor(0x1b, 0x2a, 0x4a)
GREY = RGBColor(0x55, 0x5a, 0x63)

TEAM = [
    ("Student 1", "23I-2001", "Simulation Lead"),
    ("Student 2", "23i-2038", "Attack Generation Lead"),
    ("Student 3", "23i-2014", "Detection Lead"),
]
TITLE = "Design and Implementation of a Domain-Specific Security Operations Center"
SUBTITLE = "Idea 2: SOC for an EV Charging Ecosystem (OCPP / CSMS)"
UNIVERSITY = "National University of Computer and Emerging Sciences (FAST-NUCES)"


def set_base_styles(doc):
    normal = doc.styles["Normal"]
    normal.font.name = "Calibri"
    normal.font.size = Pt(11)
    normal.paragraph_format.space_after = Pt(6)
    for i, size in ((1, 20), (2, 15), (3, 12.5), (4, 11.5)):
        h = doc.styles[f"Heading {i}"]
        h.font.name = "Calibri"
        h.font.size = Pt(size)
        h.font.color.rgb = NAVY
        h.font.bold = True
        h.paragraph_format.space_before = Pt(16 if i == 1 else 10)
        h.paragraph_format.space_after = Pt(6)


def field(paragraph, code, text="1"):
    """Insert a Word field (e.g. TOC, PAGE, NUMPAGES) into a paragraph run."""
    run = paragraph.add_run()
    fld_begin = OxmlElement("w:fldChar"); fld_begin.set(qn("w:fldCharType"), "begin")
    instr = OxmlElement("w:instrText"); instr.set(qn("xml:space"), "preserve"); instr.text = code
    fld_sep = OxmlElement("w:fldChar"); fld_sep.set(qn("w:fldCharType"), "separate")
    t = OxmlElement("w:t"); t.text = text
    fld_end = OxmlElement("w:fldChar"); fld_end.set(qn("w:fldCharType"), "end")
    run._r.append(fld_begin); run._r.append(instr); run._r.append(fld_sep); run._r.append(t); run._r.append(fld_end)


def set_update_fields_on_open(doc):
    """Force Word to recompute fields (the TOC and page numbers) the first time the file opens."""
    settings = doc.settings.element
    uf = OxmlElement("w:updateFields"); uf.set(qn("w:val"), "true")
    settings.append(uf)


def add_cover_page(doc):
    for _ in range(4):
        doc.add_paragraph()
    p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run(UNIVERSITY); r.font.size = Pt(13); r.font.color.rgb = GREY
    p2 = doc.add_paragraph(); p2.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r2 = p2.add_run("Department of Computer Science"); r2.font.size = Pt(11); r2.font.color.rgb = GREY
    for _ in range(3):
        doc.add_paragraph()
    rule = doc.add_paragraph(); rule.alignment = WD_ALIGN_PARAGRAPH.CENTER
    rr = rule.add_run("_" * 70); rr.font.color.rgb = NAVY
    pt = doc.add_paragraph(); pt.alignment = WD_ALIGN_PARAGRAPH.CENTER
    rt = pt.add_run(TITLE); rt.font.size = Pt(26); rt.font.bold = True; rt.font.color.rgb = NAVY
    ps = doc.add_paragraph(); ps.alignment = WD_ALIGN_PARAGRAPH.CENTER
    rs = ps.add_run(SUBTITLE); rs.font.size = Pt(15); rs.font.color.rgb = GREY
    rule2 = doc.add_paragraph(); rule2.alignment = WD_ALIGN_PARAGRAPH.CENTER
    rr2 = rule2.add_run("_" * 70); rr2.font.color.rgb = NAVY
    for _ in range(3):
        doc.add_paragraph()
    sub_p = doc.add_paragraph(); sub_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    sr = sub_p.add_run("Technical Report"); sr.font.size = Pt(13); sr.bold = True
    doc.add_paragraph()
    h = doc.add_paragraph(); h.alignment = WD_ALIGN_PARAGRAPH.CENTER
    hr = h.add_run("Submitted by"); hr.bold = True; hr.font.size = Pt(12)
    table = doc.add_table(rows=1, cols=3); table.style = "Light Grid Accent 1"
    table.alignment = WD_ALIGN_PARAGRAPH.CENTER
    hdr = table.rows[0].cells
    for c, text in zip(hdr, ("Role", "ID", "Responsibility")):
        c.text = text
        for run in c.paragraphs[0].runs: run.bold = True
    for name, sid, role in TEAM:
        row = table.add_row().cells
        row[0].text = name; row[1].text = sid; row[2].text = role
    for _ in range(3):
        doc.add_paragraph()
    d = doc.add_paragraph(); d.alignment = WD_ALIGN_PARAGRAPH.CENTER
    dr = d.add_run(datetime.date.today().strftime("%B %d, %Y")); dr.font.size = Pt(11); dr.font.color.rgb = GREY
    e = doc.add_paragraph(); e.alignment = WD_ALIGN_PARAGRAPH.CENTER
    er = e.add_run("Project idea registered: Idea 2, SOC for an EV Charging Ecosystem"); er.font.size = Pt(10); er.font.color.rgb = GREY
    doc.add_page_break()


def add_toc_page(doc):
    h = doc.add_heading("Table of Contents", level=1)
    p = doc.add_paragraph()
    field(p, 'TOC \\o "1-3" \\h \\z \\u', "Right-click here and choose Update Field (or press F9) to generate the table of contents.")
    doc.add_page_break()


def add_header_footer(doc):
    section = doc.sections[0]
    section.different_first_page_header_footer = False
    header = section.header
    hp = header.paragraphs[0]; hp.text = ""
    hr = hp.add_run(TITLE); hr.font.size = Pt(8); hr.font.color.rgb = GREY
    hp.alignment = WD_ALIGN_PARAGRAPH.CENTER
    footer = section.footer
    fp = footer.paragraphs[0]; fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r1 = fp.add_run("Page "); r1.font.size = Pt(9); r1.font.color.rgb = GREY
    field(fp, "PAGE", "1")
    r2 = fp.add_run(" of "); r2.font.size = Pt(9); r2.font.color.rgb = GREY
    field(fp, "NUMPAGES", "1")
    for run in fp.runs: run.font.size = Pt(9); run.font.color.rgb = GREY


def runs(p, text):
    for part in re.split(r"(\*\*[^*]+\*\*|`[^`]+`)", text):
        if part.startswith("**"): p.add_run(part[2:-2]).bold = True
        elif part.startswith("`"):
            r = p.add_run(part[1:-1]); r.font.name = "Consolas"; r.font.size = Pt(9)
        elif part: p.add_run(part)


def add_body(doc, md_path, base):
    lines = open(md_path, encoding="utf-8").read().split("\n")
    i = 0
    while i < len(lines):
        l = lines[i]
        if l.startswith("```"):
            i += 1; buf = []
            while not lines[i].startswith("```"): buf.append(lines[i]); i += 1
            p = doc.add_paragraph(); r = p.add_run("\n".join(buf)); r.font.name = "Consolas"; r.font.size = Pt(8)
            p.paragraph_format.left_indent = Inches(0.25)
        elif l.startswith("#"):
            n = len(l) - len(l.lstrip("#"))
            doc.add_heading(l[n:].strip(), min(n, 4))
        elif l.startswith("!["):
            m = re.match(r"!\[(.*?)\]\((.*?)\)", l)
            path = os.path.join(base, m.group(2))
            doc.add_picture(path, width=Inches(6.2))
            doc.paragraphs[-1].alignment = WD_ALIGN_PARAGRAPH.CENTER
            c = doc.add_paragraph(m.group(1)); c.alignment = WD_ALIGN_PARAGRAPH.CENTER
            c.runs[0].italic = True; c.runs[0].font.size = Pt(9); c.runs[0].font.color.rgb = GREY
        elif l.startswith("|"):
            rows = []
            while i < len(lines) and lines[i].startswith("|"):
                if not re.match(r"^\|[\s:|-]+\|$", lines[i]):
                    rows.append([c.strip() for c in lines[i].strip("|").split("|")])
                i += 1
            t = doc.add_table(rows=len(rows), cols=len(rows[0])); t.style = "Light Grid Accent 1"
            for r, row in enumerate(rows):
                for c, txt in enumerate(row):
                    cell = t.cell(r, c); cell.text = ""
                    runs(cell.paragraphs[0], txt)
                    for rr in cell.paragraphs[0].runs:
                        rr.font.size = Pt(8.5)
                        rr.bold = rr.bold or r == 0
            doc.add_paragraph()
            continue
        elif re.match(r"^\s*[-*] ", l):
            runs(doc.add_paragraph(style="List Bullet"), re.sub(r"^\s*[-*] ", "", l))
        elif re.match(r"^\d+\. ", l):
            runs(doc.add_paragraph(style="List Number"), re.sub(r"^\d+\. ", "", l))
        elif l.strip():
            runs(doc.add_paragraph(), l)
        i += 1


def main(md_path, out_path):
    base = os.path.dirname(os.path.abspath(md_path))
    doc = Document()
    for s in doc.sections:
        s.left_margin = s.right_margin = Inches(0.9)
        s.top_margin = s.bottom_margin = Inches(0.8)
    set_base_styles(doc)
    add_cover_page(doc)
    add_toc_page(doc)
    add_header_footer(doc)
    add_body(doc, md_path, base)
    set_update_fields_on_open(doc)
    doc.save(out_path)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
