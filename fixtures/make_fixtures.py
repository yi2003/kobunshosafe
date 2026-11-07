#!/usr/bin/env python3
"""Generate SYNTHETIC 公文書 fixture ZIPs (架空データ only).

Layout mirrors what e-Gov / 日本年金機構 document (Qiita dokoka/9f34c336, e-Gov FAQ):
  [到達番号].xml            鑑 (cover), <?xml-stylesheet href="kagami.xsl"?>
  [書類名]([到達番号]).xml   本文, PI -> 書類種別の XSL
  [書類名]([到達番号]).csv   明細 (Shift_JIS)
  *.xsl                     XSLT 1.0 stylesheets
No real personal data. Run: python3 fixtures/make_fixtures.py
"""
import base64, io, os, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ARRIVE = "900000000000000001"  # dummy 到達番号

# 1x1-ish PNGs (solid colour, 8x8) built by hand so no deps are needed.
import struct, zlib
def png(w, h, rgb):
    raw = b"".join(b"\x00" + bytes(rgb) * w for _ in range(h))
    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))

SEAL = png(24, 24, (200, 30, 30))      # 公印 placeholder
GAIJI = png(16, 16, (30, 30, 30))      # 外字 placeholder glyph image

KAGAMI_XML = f'''<?xml version="1.0" encoding="UTF-8"?>
<?xml-stylesheet type="text/xsl" href="kagami.xsl"?>
<KAGAMI>
  <TITLE>【サンプル】健康保険・厚生年金保険 資格取得確認通知</TITLE>
  <ARRIVE_ID>{ARRIVE}</ARRIVE_ID>
  <DATE>令和8年11月7日</DATE>
  <TO>見本商事株式会社 御中</TO>
  <FROM>日本年金機構（架空） 見本年金事務所長</FROM>
  <BODY>この文書は KobunshoSafe の動作確認用に作成した架空のサンプルです。</BODY>
  <ATTACH href="資格取得確認通知書({ARRIVE}).xml">資格取得確認通知書</ATTACH>
</KAGAMI>
'''.encode("utf-8")

KAGAMI_XSL = '''<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:output method="html" encoding="UTF-8"/>
  <xsl:template match="/KAGAMI">
    <html><head><title><xsl:value-of select="TITLE"/></title>
      <style>body{font-family:serif;margin:2em} .r{text-align:right} h1{font-size:1.3em;text-align:center}</style>
    </head><body>
      <p class="r">到達番号 <span id="arrive"><xsl:value-of select="ARRIVE_ID"/></span><br/><xsl:value-of select="DATE"/></p>
      <p><xsl:value-of select="TO"/></p>
      <p class="r"><xsl:value-of select="FROM"/> <img src="images/seal.png" alt="公印" width="24" height="24"/></p>
      <h1><xsl:value-of select="TITLE"/></h1>
      <p id="kagami-body"><xsl:value-of select="BODY"/></p>
      <p>添付: <a href="{ATTACH/@href}"><xsl:value-of select="ATTACH"/></a></p>
    </body></html>
  </xsl:template>
</xsl:stylesheet>
'''.encode("utf-8")

# 本文: Shift_JIS XML + Shift_JIS XSL that xsl:includes a common stylesheet.
HONBUN_XML = f'''<?xml version="1.0" encoding="Shift_JIS"?>
<?xml-stylesheet type="text/xsl" href="7100001.xsl"?>
<DOC>
  <HEAD><NAME>資格取得確認通知書</NAME><OFFICE>見本商事株式会社</OFFICE><OFFICE_NO>00-ミホ-0000</OFFICE_NO></HEAD>
  <ROW><NO>1</NO><SHIMEI>見本 太郎</SHIMEI><GAIJI_NAME>髙</GAIJI_NAME><DATE>令和8年10月1日</DATE><HOSHU>300000</HOSHU></ROW>
  <ROW><NO>2</NO><SHIMEI>試験 花子</SHIMEI><GAIJI_NAME/><DATE>令和8年10月1日</DATE><HOSHU>280000</HOSHU></ROW>
</DOC>
'''.encode("cp932")

HONBUN_XSL = '''<?xml version="1.0" encoding="Shift_JIS"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:include href="common/format.xsl"/>
  <xsl:output method="html" encoding="Shift_JIS"/>
  <xsl:template match="/DOC">
    <html><head><title><xsl:value-of select="HEAD/NAME"/>（サンプル）</title>
      <link rel="stylesheet" type="text/css" href="common/doc.css"/>
    </head><body>
      <h1 id="doc-title"><xsl:value-of select="HEAD/NAME"/></h1>
      <p>事業所名称: <xsl:value-of select="HEAD/OFFICE"/>　事業所整理記号: <xsl:value-of select="HEAD/OFFICE_NO"/></p>
      <table class="grid"><tr><th>番号</th><th>氏名</th><th>資格取得年月日</th><th>報酬月額</th></tr>
        <xsl:apply-templates select="ROW"/>
      </table>
      <p class="note">※ 外字は画像で表示: <img class="gaiji" src="gaiji/G0001.png" alt="外字"/></p>
    </body></html>
  </xsl:template>
  <xsl:template match="ROW">
    <tr><td><xsl:value-of select="NO"/></td>
      <td class="name"><xsl:value-of select="SHIMEI"/></td>
      <td><xsl:value-of select="DATE"/></td>
      <td class="num"><xsl:call-template name="yen"><xsl:with-param name="v" select="HOSHU"/></xsl:call-template></td></tr>
  </xsl:template>
</xsl:stylesheet>
'''.encode("cp932")

COMMON_XSL = '''<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:template name="yen"><xsl:param name="v"/><xsl:value-of select="format-number($v, '#,##0')"/>円</xsl:template>
</xsl:stylesheet>
'''.encode("utf-8")

DOC_CSS = '''body{font-family:serif;margin:2em}
table.grid{border-collapse:collapse} table.grid td,table.grid th{border:1px solid #333;padding:2px 8px}
td.num{text-align:right}
h1{background:url("../images/seal.png") no-repeat right center;padding-right:30px}
'''.encode("utf-8")

CSV = "番号,氏名,資格取得年月日,報酬月額\r\n1,見本 太郎,令和8年10月1日,300000\r\n2,試験 花子,令和8年10月1日,280000\r\n".encode("cp932")

# A signature-ish XML with no stylesheet -> should show a friendly "XSLなし" message.
ORPHAN_XML = '''<?xml version="1.0" encoding="UTF-8"?>
<SignatureInfo><Note>署名情報（サンプル）。スタイルシートはありません。</Note></SignatureInfo>
'''.encode("utf-8")

def egov_zip():
    root = f"{ARRIVE}/"
    files = {
        root + f"{ARRIVE}.xml": KAGAMI_XML,
        root + "kagami.xsl": KAGAMI_XSL,
        root + f"資格取得確認通知書({ARRIVE}).xml": HONBUN_XML,
        root + "7100001.xsl": HONBUN_XSL,
        root + "common/format.xsl": COMMON_XSL,
        root + "common/doc.css": DOC_CSS,
        root + "images/seal.png": SEAL,
        root + "gaiji/G0001.png": GAIJI,
        root + f"資格取得確認通知書({ARRIVE}).csv": CSV,
        root + "signature-info.xml": ORPHAN_XML,
    }
    return files

# Second ZIP: no PI. Pairing by same basename, and by sole .xsl in a folder.
SIMPLE_XSL = lambda label: f'''<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:output method="html"/>
  <xsl:template match="/"><html><head><title>{label}</title></head><body><h1 class="t">{label}</h1><p class="v"><xsl:value-of select="/R/V"/></p></body></html></xsl:template>
</xsl:stylesheet>
'''.encode("utf-8")

def nenkin_zip():
    return {
        "通知書A.xml": b'<?xml version="1.0" encoding="UTF-8"?><R><V>basename-pair-ok</V></R>',
        "通知書A.xsl": SIMPLE_XSL("同名ペア"),
        "other/notice.xml": b'<?xml version="1.0" encoding="UTF-8"?><R><V>sole-xsl-ok</V></R>',
        "other/style.xsl": SIMPLE_XSL("フォルダ内唯一のXSL"),
    }

def write_zip(path, files):
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in files.items():
            zi = zipfile.ZipInfo(name, date_time=(2026, 11, 7, 7, 0, 0))
            zi.flag_bits |= 0x800  # UTF-8 filenames, as e-Gov does
            zi.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(zi, data)

if __name__ == "__main__":
    write_zip(os.path.join(HERE, "sample-egov-koubunsho.zip"), egov_zip())
    write_zip(os.path.join(HERE, "sample-pairing.zip"), nenkin_zip())
    write_zip(os.path.join(HERE, "sample-empty.zip"), {"readme.txt": b"no xml here"})
    print("wrote fixtures")
