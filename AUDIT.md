# Lexicon Audit: spores.garden

Audit of all custom AT Protocol lexicons defined in `/lexicons/`, compared against established conventions from official Bluesky lexicons (`app.bsky.*`), the [Lexicon Style Guide](https://atproto.com/guides/lexicon-style-guide), and third-party lexicons (`com.whtwnd.blog.entry`, `blue.linkat.board`, `fyi.unravel.frontpage.vote`, etc.).

## Inventory

| NSID | Purpose | Key | Category |
|------|---------|-----|----------|
| `garden.spores.site.config` | Site title/subtitle | `self` | Config |
| `garden.spores.site.sections` | Layout/section definitions | `self` | Config |
| `garden.spores.site.profile` | Custom profile (separate from bsky) | *(missing)* | Config |
| `garden.spores.site.content` | User-authored content blocks | *(missing)* | Content |
| `garden.spores.content.image` | Uploaded images | `tid` | Content |
| `garden.spores.social.flower` | "Like"/follow for a garden | `tid` | Social |
| `garden.spores.social.takenFlower` | Collected/bookmarked flower | `tid` | Social |
| `garden.spores.item.specialSpore` | CTF-style capture record | `tid` | Gamification |
| `garden.spores.guestbook.entry` | Visitor guestbook message | *(missing)* | Social |

## What They Do

### Config layer (`garden.spores.site.*`)

Three singletons that define a garden. `config` stores the site title/subtitle. `sections` defines which records to display and in which layout. `profile` is an app-specific profile override (independent of `app.bsky.actor.profile`).

### Content layer (`garden.spores.site.content`, `garden.spores.content.image`)

User-authored records. Content blocks hold markdown/html/text (up to 50KB). Image records hold a blob ref with optional title.

### Social layer (`garden.spores.social.*`, `garden.spores.guestbook.entry`)

Cross-user interactions. A `flower` is planted in someone else's garden (analogous to a follow). A `takenFlower` is a bookmark/collection of a flower from another garden. Guestbook entries are visitor messages stored in the *visitor's* repo and discovered via backlinks.

### Gamification (`garden.spores.item.specialSpore`)

A capture-the-flag mechanic. 10% of gardens get a spore (deterministic from DID). Any user can "steal" it by creating a new capture record referencing the origin DID. Current holder is determined by the most recent backlinked record.

## NSID Hierarchy

The hierarchy is well-organized and follows the ATP convention of `<reversed-domain>.<group>.<name>`:

- `garden.spores.site.*` -- site-specific config/content
- `garden.spores.content.*` -- media content
- `garden.spores.social.*` -- social interactions
- `garden.spores.item.*` -- collectible items
- `garden.spores.guestbook.*` -- guestbook

Groupings are logical. Names use correct `lowerCamelCase`. `takenFlower` and `specialSpore` are valid per spec, though slightly verbose compared to canonical patterns (`like`, `follow`, `block`).

## Issues

### 1. `key` field uses `"self"` instead of `"literal:self"`

**Affected:** `garden.spores.site.config`, `garden.spores.site.sections`

The official convention (used by `app.bsky.actor.profile`, `blue.linkat.board`) is `"key": "literal:self"`. The `literal:` prefix explicitly tells tooling this is a fixed-key singleton. These lexicons use the non-standard `"key": "self"`.

**Reference:** `app.bsky.actor.profile` uses `"key": "literal:self"`.

### 2. Missing `key` field entirely

**Affected:** `garden.spores.site.profile`, `garden.spores.site.content`, `garden.spores.guestbook.entry`

Every record lexicon should declare its key type. Without it, tooling and validators can't enforce key constraints.

- `site.profile` should be `"key": "literal:self"` (singleton)
- `site.content` should be `"key": "tid"` (collection)
- `guestbook.entry` should be `"key": "tid"` (collection)

### 3. `takenFlower.sourceDid` should be `subject`

**Affected:** `garden.spores.social.takenFlower`

Across every official ATP interaction lexicon, the primary target is named `subject`:

| Lexicon | Field | Type |
|---------|-------|------|
| `app.bsky.feed.like` | `subject` | strongRef |
| `app.bsky.graph.follow` | `subject` | DID |
| `app.bsky.graph.block` | `subject` | DID |
| `fyi.unravel.frontpage.vote` | `subject` | strongRef |
| `garden.spores.social.flower` | `subject` | DID |
| `garden.spores.social.takenFlower` | **`sourceDid`** | DID |

Using `sourceDid` breaks this convention and makes the record less discoverable to generic ATP tooling (backlink indexers typically look for `subject` fields).

### 4. Missing `maxGraphemes` on string fields

**Affected:** All lexicons with `maxLength` constraints

The ATP style guide recommends specifying **both** `maxLength` (byte limit) and `maxGraphemes` (user-visible character limit). The ratio is typically ~10:1 (e.g., `maxGraphemes: 64, maxLength: 640`). All string fields in these lexicons only specify `maxLength`. This matters because a single emoji or CJK character can be multiple bytes.

**Reference:** `app.bsky.actor.profile` uses `"maxGraphemes": 64, "maxLength": 640` for `displayName`.

### 5. `garden.spores.site.profile` duplicates `app.bsky.actor.profile`

The profile lexicon has nearly identical fields to `app.bsky.actor.profile` (displayName, description, avatar, banner, createdAt).

- **Pro:** Users can have a different garden identity than their Bluesky identity
- **Con:** Duplication of effort; users may expect their bsky profile to carry over
- **Assessment:** Acceptable if intentional. Consider documenting the relationship in the lexicon description (e.g., "Overrides app.bsky.actor.profile for this garden. Falls back to Bluesky profile when not set.").

### 6. `garden.spores.site.config` has no required fields

Neither `title` nor `subtitle` is required. The spec says config is "required to load a garden," but the record itself can be empty. This follows the `app.bsky.actor.profile` pattern (zero required fields), which is fine for forward-compatibility -- you can never un-require a field. But if `title` is practically necessary, consider making it required.

### 7. `garden.spores.site.content` -- `createdAt` should be required

For timestamped content records, `createdAt` is required in virtually all ATP lexicons (`app.bsky.feed.post`, `app.bsky.feed.like`, `app.bsky.graph.follow`, etc.). This content record has it as optional. Since content blocks are chronological (TID-keyed), `createdAt` should be required.

### 8. `garden.spores.content.image` -- blob `accept` uses wildcard

This lexicon uses `"accept": ["image/*"]` while official lexicons enumerate specific types (`["image/png", "image/jpeg"]`). The wildcard is more permissive, which may be intentional for a garden that should accept any image format. Just be aware this means SVGs, TIFFs, BMPs, etc. are all valid. If that's desired, the wildcard is fine.

**Reference:** `app.bsky.actor.profile` uses `"accept": ["image/png", "image/jpeg"]`.

### 9. `garden.spores.site.sections` -- stored vs generated contradiction

The `sections` lexicon defines a full PDS-stored record schema. However, the spec states sections are "never written to PDS" and are "generated deterministically from DID." This is contradictory. Either:

- Sections are stored in PDS (and the spec is outdated), or
- Sections are generated client-side (and the lexicon is dead code)

Clarify which is true. If sections are purely generated, remove the lexicon.

### 10. Missing field descriptions

**Affected:** `flower`, `takenFlower`, `specialSpore`, `image`

The ATP style guide recommends describing ambiguous fields, especially generic names like `subject`. Examples:

- `flower.subject` -- should say "DID of the garden owner receiving the flower"
- `specialSpore.subject` -- should say "DID of the origin garden where this spore was first created"
- `takenFlower.sourceDid` -- should say "DID of the garden the flower was taken from"

## Proposed Changes

### High priority

| Change | Effort |
|--------|--------|
| Fix `key` on singletons: `"self"` -> `"literal:self"` for `site.config` and `site.sections` | Low |
| Add missing `key` fields: `"literal:self"` on `site.profile`, `"tid"` on `site.content` and `guestbook.entry` | Low |
| Rename `takenFlower.sourceDid` -> `subject` (convention alignment + backlink indexer compatibility) | Medium (requires code changes) |

### Medium priority

| Change | Effort |
|--------|--------|
| Add `maxGraphemes` to all string fields that have `maxLength` | Low |
| Make `createdAt` required on `site.content` | Low |
| Add field descriptions to `flower`, `takenFlower`, `specialSpore`, `image` | Low |

### Low priority

| Change | Effort |
|--------|--------|
| Clarify `site.sections` -- is it stored or generated? Remove lexicon if unused | Low |
| Consider enumerating `image.accept` types explicitly vs wildcard | Low |
| Document `site.profile` relationship to `app.bsky.actor.profile` in lexicon description | Low |

### No change needed

| Item | Reason |
|------|--------|
| `site.config` having no required fields | Follows `app.bsky.actor.profile` pattern; forward-compatible |
| `site.profile` existing separately from bsky profile | Acceptable if intentional |
| NSID hierarchy and naming | Well-organized, follows conventions |
| `knownValues` usage (not `enum`) for string enums | Correct per style guide |
