// Use the bundled XSLT engine even where native XSLT still exists, so behavior is identical
// before and after Chrome 158. Never auto-transform this page.
window.xsltDontAutoloadXmlDocs = true;
window.xsltPolyfillQuiet = true;
