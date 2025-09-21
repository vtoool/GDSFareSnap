Project guide for AI coding agents working on the Kayak / ITA Matrix copy-pill Chrome extension (MV3).
Goal: inject small red action pills (*I, and when applicable leg/availability pills) onto search results and itinerary pages, extract the visible itinerary text, and output GDS-style strings reliably—with zero regressions.

0) Ground rules

No new dependencies; plain JS/DOM only. Keep the footprint small and fast.

Don’t change public CSS class names used by the injected UI unless you update all references.

Never break ITA Matrix behavior while fixing Kayak (and vice-versa).

Work within MV3 (service worker + content scripts).

No network calls. All parsing is local to the page.

Prefer idempotent operations; injection must be safe to re-run frequently.

1) Repo map (top-level files)

manifest.json – MV3 manifest (matches include Kayak + Matrix).

content.js – page detector, SPA/DOM observers, result-card discovery, pill injection, click handlers, de-duplication.

converter.js – plain-text tokenizer + itinerary parser; renders *I and availability commands; provides a lightweight peek() for journey boundaries.

content.css – pill visuals, placement (overlay + inline host), high z-index.

airlines.js – airline name/code map & helpers.

popup.html / popup.js – simple settings (e.g., show availability pills).

Keep these files; do not split into modules unless absolutely necessary.

2) What the extension must do (canonical behavior)
Kayak (results page)

For each real result card, show exactly one pill group:

Default: *I plus availability buttons appropriate to the itinerary.

For multi-city: replace OB/IB with per-journey buttons like 1 MIA-VCE, 2 NAP-MIA (see §4).

The group is overlay-pinned near the card’s primary Select action; if not available, use a single inline host pinned top-right inside the card.

Clicking a pill copies the expected text (*I or availability) and shows a toast.

ITA Matrix

Results list: one pill group per itinerary row.

Itinerary Details page (after choosing an option): a single *I pill top-right in the main itinerary block (not the right sidebar).

3) Injection, page detection & de-dup
SPA & navigation

Listen to: popstate, hashchange, pageshow, and wrap history.pushState / replaceState to reschedule discovery.

Use a single MutationObserver on document.body (childList + subtree) with a short debounce (≤100ms). On tick:

Detect host (Kayak vs Matrix).

Discover result cards / detail containers.

Reconcile pill groups (create missing, remove orphans).

Card discovery (Kayak)

A valid real result card must:

Be visible,

Contain flight clues (≥2 times and ≥2 IATA airport tokens), and

Contain or be an ancestor of a visible Select button (Select, Select flight, Choose, View deal, etc.).

Explicitly ignore:

Right-rail tiles/ads/promos (e.g., “KAYAK+ai”, known ad/testid markers),

Header/footer chrome,

Collapsed ghost containers with zero size.

De-dup & stable keys

Compute a stable key per visual card (choose a consistent nearest ancestor; avoid ephemeral children).

Before inserting a group, remove any existing group with the same key.

Never mount both overlay and inline in the same card.

On Matrix, key by itinerary identity (summary/detail pair); reconcile immediately on subtree changes (no transient duplicates).

4) Multi-city support (Kayak & Matrix)
Parser responsibilities

Treat lines like “Flight N • Tue, Dec 23” as journey headers that start a new cluster with its own date context.

Airline/flight line must accept:

British Airways 596

British Airways (next line) 596

Optional “· Operated by …”—do not replace the marketing carrier.

Equipment lines (Boeing…, Airbus…, Canadair/CRJ/E-/Q400, “neo/MAX”) are never airline+flight.

Non-structural labels: Overnight flight, Long layover, Change planes in (AAA) → ignore without resetting state.

Arrival date hints: “Arrives Wed, Dec 24” adjusts the arrival calendar date for the active segment.

Route headers (“AAA to BBB on …”) are optional; assemble from nearby time/airport lines.

Journey buttons

Provide a fast peek() that returns:

{
  segments: [...],
  journeys: [{ startIdx, endIdx, origin, dest, indexHint }],
  isMultiCity: boolean
}


UI logic:

If isMultiCity or journeys.length > 1: replace OB/IB with per-journey buttons labeled
# {origin}-{dest} (e.g., 1 MIA-VCE, 2 NAP-MIA).

Clicking a journey pill copies only that journey’s output (availability or *I for that segment range).

5) Parsing engine (tokenizer/state machine)
Tokenizer

Split into trimmed lines. Normalize bullets • to spaces. Collapse whitespace.

State

currentDate, currentJourney, pendingFlight (carrier + number).

On journey header → finalize previous journey; set currentDate; start new journey.

On airline/flight line(s) → set pendingFlight (map carrier name to IATA using the code table).

Build a segment from the next 4 primitives:
depTime → depAirport → arrTime → arrAirport, applying date rollovers and “Arrives …”.

Ignore lines flagged as equipment/labels.

New airline/flight or journey header → finalize current segment/journey.

Output

Maintain the existing *I format (status SS1, booking class, /DCXX /E, etc.).

Marketing carrier drives the airline code; “operated by” is metadata only.

6) UI & CSS

Pill group container: keep existing rounded red pills, white ring, shadow.

Inline host pins top-right inside a card; overlay positions near the Select button.

Use very high stacking (z-index: 2147483000+) and isolation: isolate.

Pills must not disappear on mouse move; do not gate visibility on :hover/mouseleave.

7) Logging & diagnostics

Gate verbose logs behind a DEBUG boolean.

On parse failure, log raw text and last matched tokens; include a link to the current URL.

Add one-shot safeguards to prevent log spam (e.g., rate-limit error banners).

8) Test matrix (must pass)
Kayak — Multi-city (expanded card)

The two provided samples parse into a valid multi-line *I (no “No segments parsed…”).

UI shows *I, 1 MIA-VCE, 2 NAP-MIA; each journey button copies only its journey.

Kayak — Round-trip

Exactly one pill group per real result card; no doubles; no pills on ads/rails.

ITA Matrix — Results & Itinerary Details

One pill group per itinerary; no transient doubles when opening/closing details.

“Itinerary Details” page shows a single *I pill top-right inside the main itinerary block.

General

Equipment tokens (e.g., “RJ 900”, “A320neo”, “737-8 MAX”) never become airlines/flight numbers.

“Operated by …” keeps marketing carrier on the *I line.

9) Performance & safety

Observer callbacks must be quick; debounce work and avoid layout thrash.

Never block the main thread with heavy parsing; parse only the text you need for the active card.

Clean up observers and timers on navigation changes.

10) Definition of done (DOD)

All tests in §8 pass on current Kayak and Matrix UIs.

No duplicate pill groups across SPA updates, filtering, scrolling, or repeated openings.

Multi-city text from Kayak (bottom-right → top-left copy order) parses consistently.

No regressions in ITA Matrix placements, styling, or parsing.

Tip: If DOM shapes drift, prefer resilient heuristics (times + airports + presence of Select) over brittle classnames, and keep ad/rail filters strict.
