# c4s-plugin-spreadsheets

Plugin claude4spec (tier bazowy). Repozytorium kodu pluginu — briefy/patche żyją w repo spec,
osiągane wyłącznie przez CLI `c4s`.

## c4s

Wartości używane przez współdzielony skill `c4s-brief-implementer` (podstawiane w każdy
`--project '<slug>' --workspace '<workspace>'` oraz w manifest smoke env-runnera):

- `c4s.project`: `c4s-plugin-spreadsheets`
- `c4s.workspace`: `default`
- `c4s.pluginRepo`: `git@github.com:InHarness/c4s-plugin-spreadsheets.git`  <!-- brak skonfigurowanego remote; URL wg konwencji InHarness — zweryfikuj przy pierwszym pushu -->
- `c4s.entityTypes`: `[spreadsheet]`

## Skille

Skill `c4s-brief-implementer` jest **współdzielony** — `.claude/skills/c4s-brief-implementer`
to symlink do `claude4spec-private/skills/brief-implementer-plugin` (gitignorowany, lokalny).
**Nie uruchamiaj tu `c4s install-skills`** — nadpisze symlink zarządzaną kopią i cofnie centralizację.
Edytuj źródło w private repo; zmiana propaguje się do wszystkich podlinkowanych repo.
