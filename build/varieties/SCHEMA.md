# Variety data format

One JSON file per crop group in this folder (`warm.json`, `cool.json`, …). `build/build.py` merges them
into `data.js`. Each file maps **crop id** (the `id` in `build/crops.py`) → crop entry:

```json
{
  "tomato": {
    "basis": "transplant",
    "varieties": [
      { "name": "Early Girl", "type": "slicer", "days": 57,
        "tags": ["short-season", "hybrid"],
        "notes": "Reliable early slicer; a good pick where summers are short or cool." }
    ]
  },
  "peach": {
    "varieties": [
      { "name": "Reliance", "type": "freestone", "chill": 1000, "years": "2–3", "ripens": "mid",
        "zones": [4, 8], "tags": ["cold-hardy", "self-fertile"],
        "notes": "One of the hardiest peaches; blossoms survive late cold snaps." }
    ]
  }
}
```

## Crop entry

| field | required | meaning |
|---|---|---|
| `basis` | annuals only | What `days` counts from: `"transplant"` (set out seedlings), `"sow"` (direct seeding), `"slips"`, `"sets"`, `"tubers"`, `"cloves"`. Use the convention seed catalogs use for that crop, and keep it the same for every variety of the crop. |
| `varieties` | yes | 4–8 rows (up to ~14 for crops with many important types, e.g. tomato, pepper). |

## Variety row

**All crops**

| field | required | meaning |
|---|---|---|
| `name` | yes | Name as sold, e.g. `"Sun Gold"`, `"Honeycrisp"`. Real, widely sold varieties only: what a US home gardener finds on seed racks, at nurseries and in major catalogs (Johnny's, Burpee, Baker Creek, Territorial, Stark Bros, Raintree, Dave Wilson). |
| `type` | yes | Short lowercase category within the crop: `"cherry"`, `"paste"`, `"bell"`, `"hot"`, `"chinense"`, `"pole"`, `"romaine"`, `"Japanese plum"`, `"southern highbush"`… |
| `notes` | yes | ONE line, ≤ 140 characters: what makes it distinct and when you'd choose it. Written for gardeners **anywhere in the continental US** — say "where summers are short" / "in hot climates", never "here" or a specific town. |
| `tags` | optional | Any of the vocabulary below that clearly applies. |

**Annual crops** (anything with `basis`)

| field | required | meaning |
|---|---|---|
| `days` | yes | Integer days to maturity / first harvest, counted from `basis`, as listed by major seed catalogs. For a range, use the midpoint. |

**Perennials, fruit trees, berries, vines** (no `basis`)

| field | required | meaning |
|---|---|---|
| `years` | yes | Years from planting a nursery plant to first real crop, as a string: `"1"`, `"2–3"`. |
| `ripens` | yes | `"early"`, `"mid"`, `"late"` relative to other varieties of that crop, or `"everbearing"` / `"year-round"` where that's the point. |
| `chill` | fruit that needs winter chill | Integer **chill hours** (hours between 32–45 °F) the variety needs to fruit well, from nursery/extension listings. Use `null` for crops with no chill requirement (citrus, avocado, tropical fruit, most herbs). |
| `zones` | optional | `[min, max]` USDA zones for this variety when it differs meaningfully from the crop's range (e.g. extra-hardy apples, low-chill peaches). `b` halves are `.5`: zone 8b = `8.5`. |

## Tag vocabulary

`short-season` `heat-tolerant` `bolt-resistant` `cold-hardy` `disease-resistant` `compact` `container`
`heirloom` `hybrid` `open-pollinated` `low-chill` `high-chill` `self-fertile` `needs-pollinizer`
`everbearing` `june-bearing` `day-neutral` `thornless` `seedless` `storage` `long-day` `short-day`
`day-neutral-onion` `parthenocarpic` `determinate` `indeterminate`

## Accuracy rules

- Only include varieties and numbers you are confident are correct. **Omit rather than guess.**
  If unsure about a figure, check it (a quick web search of a major catalog or extension page) or leave the row out.
- For every crop, deliberately include picks for difficult climates where they exist:
  short-season (cool/short summers), heat-tolerant, bolt-resistant, low-chill (mild winters) and cold-hardy (zones 3–4).
- Don't include commercial-only or rare collector varieties.
