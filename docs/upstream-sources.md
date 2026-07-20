# Steam upstream source register

Last reviewed: 2026-07-20

This register is the approval boundary for outbound Steam operations. An
endpoint is not eligible for an adapter merely because it is Steam-operated or
currently reachable. Every best-effort source must have a fixed request shape, a
validated response contract, an explicit data classification, a bounded call
cost, a cache decision, and its own startup-validated disable switch.

All approved requests use `GET`, HTTPS, the shared response-byte limit, redirect
revalidation, cancellation, and the existing Steam host allowlist. Contract
validation failures return `BEST_EFFORT_SOURCE_CHANGED`; raw bodies, request
arguments, credentials, and user-specific payloads are never emitted or durably
stored.

## Approved best-effort sources

### Public wishlist with bounded store enrichment

- **Status:** approved with privacy and enrichment constraints.
- **Request:**
  `https://api.steampowered.com/IWishlistService/GetWishlistSortedFiltered/v1/?input_json={encoded-json}`.
  Steam's own
  [`GetSupportedAPIList`](https://api.steampowered.com/ISteamWebAPIUtil/GetSupportedAPIList/v1/)
  advertises the operation, but Steam does not publish a stable response-schema
  reference, so the adapter remains best-effort. The fixed encoded object
  contains the SteamID64, controlled language/country/realm context, a bounded
  positive `page_size`, `start_index`, empty filters/share token, and a fixed
  request for basic information and all purchase options.
- **Observed contract:** `{ response: { items?: [...] } }`; every item has
  unsigned `appid`, `priority`, and Unix-seconds `date_added`. Only the
  requested range receives optional `store_item` enrichment with an app ID,
  success/visibility flags, optional name, and optional best purchase option.
  Price values are decimal strings representing minor units; discounted options
  may include original minor units, discount percentage, and active discounts.
  The endpoint still returns all wishlist IDs, so `page_size` bounds enrichment,
  not response length; the adapter must discard non-page items after validation
  and retain the shared response-byte ceiling. An exact empty `response` is
  ambiguous between hidden and empty data and must be treated conservatively as
  unavailable/private rather than a known empty wishlist. Currency is omitted
  unless it is provided by the response or a separately controlled
  country-to-currency policy; formatted price strings are never parsed.
- **Data classification:** public-but-personal preference data for the wishlist;
  public regional catalog data for normalized per-app enrichment.
- **Cost:** one call per tool page. The response is sliced locally with an
  opaque cursor because upstream pagination limits enrichment but not the
  returned ID list.
- **Cache:** no wishlist result cache; Steam currently returns
  `no-cache, no-store`. Exact in-flight coalescing is allowed.
- **Disable switch:** `STEAM_BEST_EFFORT_WISHLIST_ENABLED`.
- **Drift risks:** optional fields, string-encoded minor units, no upstream
  pagination semantics, full-list response size, privacy/empty ambiguity,
  default-filter behavior, and missing purchase options for delisted or
  region-restricted apps.

### Store search

- **Status:** approved as a bounded resolver, not a generic search proxy.
- **Request:**
  `https://store.steampowered.com/api/storesearch/?term={query}&l={language}&cc={country}`.
- **Observed contract:** `{ total, items[] }`; an item has numeric `id`, `type`,
  `name`, and optional `tiny_image`, price, metascore, platform, and controller
  fields. Current probes return a fixed maximum of ten results and ignore
  attempted pagination/count parameters. The adapter therefore accepts only
  nonblank bounded text and returns at most ten validated app candidates.
- **Data classification:** public catalog response; the query remains a tool
  argument.
- **Cost:** one call per search.
- **Cache:** no retained query cache because its key contains a tool argument;
  exact in-flight coalescing only.
- **Disable switch:** `STEAM_BEST_EFFORT_STORE_SEARCH_ENABLED`.
- **Drift risks:** undocumented ranking, result cap, optional fields,
  localization, and unknown rate limits.

### Store details and deal fields

- **Status:** approved for one app per call.
- **Request:**
  `https://store.steampowered.com/api/appdetails?appids={AppId}&cc={country}&l={language}&filters=basic,developers,publishers,genres,categories,price_overview,release_date`.
- **Observed contract:** an object keyed by decimal app ID. A present app has
  `{ success: true, data }` with matching `steam_appid`, name, optional
  description, developer/publisher arrays, genre/category descriptors, optional
  `price_overview`, and release information. A missing or unavailable app has
  `{ success: false }`. The adapter discards unmodeled HTML-bearing fields.
- **Data classification:** public regional catalog and price data.
- **Cost:** one call per app. Multi-app requests are not approved because
  current behavior is filter-sensitive and can return HTTP 400.
- **Cache:** fifteen-minute public cache keyed by app ID, country, language, and
  selected contract version; exact request coalescing is allowed.
- **Disable switch:** `STEAM_BEST_EFFORT_STORE_DETAILS_ENABLED`.
- **Drift risks:** undocumented filters, localized release-date text, regional
  availability, optional price data, and ambiguous `success: false` semantics.
  Deal data comes only from validated `price_overview`; no separate deal source
  is approved.

### Steam Deck compatibility

- **Status:** approved as an independently optional game facet.
- **Request:**
  `https://store.steampowered.com/saleaction/ajaxgetdeckappcompatibilityreport?nAppID={AppId}`.
- **Observed contract:** `{ success: 1, results }`; populated results include
  `resolved_category` and optional resolved compatibility items. Categories map
  as `0=unknown`, `1=unsupported`, `2=playable`, and `3=verified`, consistent
  with Steam's documented
  [Deck compatibility ratings](https://partner.steamgames.com/doc/steamdeck/compat).
  Empty results are unavailable, not invented compatibility.
- **Data classification:** public catalog compatibility data.
- **Cost:** one call per app.
- **Cache:** fifteen-minute public cache keyed by app ID.
- **Disable switch:** `STEAM_BEST_EFFORT_DECK_COMPATIBILITY_ENABLED`.
- **Drift risks:** undocumented endpoint and wrapper, optional localized detail
  items, and empty results for unknown apps.

## Supported optional source

Aggregate Steam reviews are not best-effort. Valve documents
[`GET /appreviews/{appid}`](https://partner.steamgames.com/doc/store/getreviews)
and its JSON query parameters. The server may request only the aggregate summary
using fixed `json=1`, `language=all`, `purchase_type=all`, and `num_per_page=0`.
It validates `success` and `query_summary`, costs one call, uses a five-minute
public cache, and has the independent optional-facet switch
`STEAM_GAME_REVIEWS_ENABLED`. Failure remains partial to consolidated game
details, but schema drift uses the supported-upstream error policy rather than
`BEST_EFFORT_SOURCE_CHANGED`.

## Rejected initial candidates

- **Legacy wishlist JSON:**
  `store.steampowered.com/wishlist/profiles/{steamid}/wishlistdata/` now
  redirects to the store home page and is not an approved fallback.
- **Unenriched wishlist operation:** `IWishlistService/GetWishlist/v1` remains a
  live-probe candidate but is not the primary adapter because it is unpaginated,
  returns IDs only, and cannot satisfy the price/availability contract.
- **Per-app community tag scraping:** Steam app-page HTML is large, localized,
  age-gated, and unstable. Use accurately labeled genres and categories from
  store details. The global tag vocabulary is not evidence that a tag belongs to
  an app.
- **Separate deal sources:** no additional source is necessary while validated
  regional `price_overview` supplies current price and discount facts.
- **Non-Steam sources:** ProtonDB, SteamDB, third-party recommendation services,
  and generic web scraping remain outside v1 scope.

## Change control

Adding a source or materially expanding a request requires updating this
register, adding scrubbed fixtures and a disabled-by-default live probe, and
reviewing privacy, cost, caching, and rollback. Operations may disable any
best-effort adapter independently without changing the shared supported Steam
client or rolling back the service.
