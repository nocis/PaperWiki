# Typed relations live in paper frontmatter, not the citation map

The `## Relations` section of a paper page (temporal/cross-topic links between
papers) is now also persisted structurally as `relations[]` in paper
frontmatter, so the citation graph can render typed edges without parsing
markdown. We chose paper frontmatter over extending `data/citations/map.json`:
relations are analysis output owned by the paper page (like `cites[]`), while
the citation map is a derived file specific to bibliography matching. Lint
keeps body and frontmatter in sync and verifies relation slugs, so legacy
pages backfill on the next lint run without recompiling.
