# chessgo.in Compliance Recon

**Scope**: assessment only. No scraping, no bulk fetching, no puzzle-content harvesting was performed. A handful of pages (`robots.txt`, homepage, `/policy/terms`) were fetched once each, purely to read policy/structure — the same as a human visiting the site to read its terms.

## What the site is

`chessgo.in` (title: "ChessGo.In | Printable Chess Puzzles") is a commercial SvelteKit web app, hosted on Vercel behind Cloudflare, built by an individual developer ("Sharath") in partnership with a FIDE instructor. Its product is **generating printable PDF chess puzzle worksheets/tests** for coaches and teachers (nav: `/puzzles`, `/create`, `/training`, `/articles`, `/shared`, `/profile/dashboard/tournaments`, `/login`). It has a paid "premium" tier (~$19, "Lifetime Premium Access" per its terms).

**Most importantly**: the site's own footer states **"Puzzles by Lichess."** ChessGo.in is a UI/worksheet-generation layer on top of the same Lichess CC0 puzzle database this project already pulled from directly in Part 1 — it is not an independent puzzle source.

## robots.txt

`https://chessgo.in/robots.txt`:

```
User-agent: *
Disallow:
```

Fully permissive — no paths are disallowed for any crawler. This alone would not block automated access.

## Terms of Service (`/policy/terms`, last updated 22 March 2026)

Key clause, quoted verbatim:

> "Intellectual Property: The content, design, and intellectual property rights of this website are owned by us or licensed to us. You may not reproduce, distribute, or use any content from this website without obtaining prior written permission. You are however free to use puzzles, test PDFs, Study PDFs in any way you want."

Reading of this clause:
- The general rule is **no reproduction/distribution/use of site content without prior written permission**.
- The carve-out ("free to use puzzles, test PDFs, Study PDFs in any way you want") reads as being about the **worksheets/PDFs a user generates through the tool for their own teaching use** (consistent with the product being a worksheet generator for coaches) — not a blanket license to bulk-copy their puzzle database or wholesale mirror their content into a third-party app/dataset. It's permission to print and hand out the PDF you made, not permission to scrape the underlying puzzle set.
- No API, developer docs, or bulk data-export path is advertised anywhere in the site's navigation, homepage, or terms. There is no `/api`, `/developers`, or `/docs` route in the nav; `/create` is a worksheet builder for end users, not a programmatic export.
- No explicit license grant (e.g. CC0, MIT, "free to redistribute") is stated anywhere for the puzzle data itself — the opposite: content is asserted as owned/licensed IP with reproduction restricted by default.

## Technical access notes

- The homepage and `/policy/terms` returned **HTTP 403** to the WebFetch tool (likely Cloudflare bot-management blocking that tool's request fingerprint), but rendered normally to a plain `curl` request carrying an ordinary desktop-browser User-Agent header. So there's no CAPTCHA or hard bot-wall in front of a normal browser — but the site is Cloudflare-fronted and does actively differentiate/block some automated clients, which is a further practical (not just legal) obstacle to any bulk/programmatic pull.

## Recommendation

**Do not pull puzzle data from chessgo.in.** Reasons, in order of weight:

1. **No unique data.** Their own footer credits "Puzzles by Lichess" — their puzzle content originates from the exact same Lichess CC0 database already used directly for Part 1. There is nothing to gain by going through chessgo.in that isn't already available, with clearer licensing, straight from the source.
2. **Terms of Service problem.** Their ToS defaults to "no reproduction/distribution/use of site content without prior written permission," and the one carve-out is narrowly about personally-generated worksheet PDFs, not a bulk-use license for third-party apps.
3. **No API/export offered.** There's no sanctioned programmatic path (no `/api`, no docs, no export feature) — any automated pull would necessarily mean scraping rendered pages, which the ToS doesn't clearly authorize and which their Cloudflare setup is already positioned to push back on.

**Conclusion: proceed with Lichess (direct, CC0, unambiguous) as the sole puzzle source for this app, as already done in Part 1. chessgo.in is out of scope for data acquisition.**
